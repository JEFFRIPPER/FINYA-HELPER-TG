"""Outbox persistence, deduplication, retries and trusted XP roots."""

import asyncio
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import httpx
from telegram.error import BadRequest, Forbidden, NetworkError, RetryAfter

from activity_xp import ActivityXP
from channel_relay import ChannelRelay

NOW = 1790778000
SOURCE = -1001192817776
TARGET = -100555


class RelayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "xp.sqlite3"
        self.now = NOW
        self.activity = ActivityXP(self.path, clock=lambda: self.now)
        self.relay = ChannelRelay(self.activity, clock=lambda: self.now)
        self.relay.enable(TARGET, "Squad Family")
        self.bot = NS(get_chat=AsyncMock(return_value=NS(linked_chat_id=None)),
                      copy_message=AsyncMock(return_value=NS(message_id=100)))

    def tearDown(self):
        self.activity.close()
        self.temp.cleanup()

    def enqueue(self, mid=10, *, date=None):
        msg = NS(chat_id=SOURCE, message_id=mid,
                 date=datetime.fromtimestamp(self.now if date is None else date, timezone.utc))
        return self.relay.enqueue(msg, f"https://t.me/THKC_SQUAD/{mid}")

    def row(self, mid=10):
        return self.activity.db.execute(
            "SELECT * FROM relay_outbox WHERE source_message_id=?", (mid,)
        ).fetchone()

    async def test_duplicate_source_and_concurrent_workers_only_copy_once(self):
        self.assertEqual(self.enqueue(), 1)
        self.assertEqual(self.enqueue(), 0)
        await asyncio.gather(self.relay.deliver_next(self.bot), self.relay.deliver_next(self.bot))
        self.bot.copy_message.assert_awaited_once()
        payload = self.bot.copy_message.call_args.kwargs
        self.assertEqual(payload["chat_id"], TARGET)
        self.assertEqual(payload["from_chat_id"], SOURCE)
        self.assertEqual(payload["reply_markup"].inline_keyboard[0][0].url, "https://t.me/THKC_SQUAD/10")
        self.assertEqual(self.row()["status"], "sent")
        self.assertEqual(self.activity.message_record(TARGET, 100)["root_id"], 100)

    async def test_pending_and_delivered_posts_survive_restart(self):
        self.enqueue()
        self.enqueue(11)
        await self.relay.deliver_next(self.bot)
        self.activity.close()
        self.activity = ActivityXP(self.path, clock=lambda: self.now)
        self.relay = ChannelRelay(self.activity, clock=lambda: self.now)
        self.assertTrue(self.relay.enabled(TARGET))
        self.assertEqual(self.enqueue(), 0)
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.bot.copy_message.await_count, 2)
        self.assertEqual(self.row()["status"], "sent")

    async def test_two_workers_sharing_persistent_database_do_not_copy_same_post(self):
        self.enqueue()
        other_activity = ActivityXP(self.path, clock=lambda: self.now)
        other_relay = ChannelRelay(other_activity, clock=lambda: self.now)
        try:
            await asyncio.gather(self.relay.deliver_next(self.bot), other_relay.deliver_next(self.bot))
            self.bot.copy_message.assert_awaited_once()
        finally:
            other_activity.close()

    async def test_disable_cancels_pending_and_reenable_only_accepts_new_posts(self):
        self.enqueue()
        self.relay.disable(TARGET)
        self.assertFalse(await self.relay.deliver_next(self.bot))
        self.assertEqual(self.row()["status"], "cancelled")
        self.now += 20
        self.relay.enable(TARGET, "Family")
        self.assertEqual(self.enqueue(11, date=NOW), 0)
        self.assertEqual(self.enqueue(12), 1)
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.bot.copy_message.call_args.kwargs["message_id"], 12)

    async def test_retry_after_obeys_telegram_delay(self):
        self.enqueue()
        self.bot.copy_message.side_effect = [RetryAfter(10), NS(message_id=100)]
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "pending")
        self.assertFalse(await self.relay.deliver_next(self.bot))
        self.now += 11
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "sent")

    async def test_connection_failure_retries_but_ambiguous_network_error_does_not(self):
        self.enqueue()
        safe = NetworkError("Connection failure")
        safe.__cause__ = httpx.ConnectError("No connection")
        self.bot.copy_message.side_effect = safe
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "pending")
        self.now += 15
        self.bot.copy_message.side_effect = NetworkError("Unknown send result")
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "uncertain")
        self.assertFalse(await self.relay.deliver_next(self.bot))
        self.assertEqual(self.relay.retry_uncertain(TARGET), 1)
        self.bot.copy_message.side_effect = None
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "sent")

    async def test_network_error_during_metadata_lookup_is_safe_to_retry(self):
        self.enqueue()
        self.bot.get_chat.side_effect = NetworkError("metadata unavailable")
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "pending")
        self.bot.copy_message.assert_not_awaited()

    async def test_missing_rights_retry_and_bad_request_is_permanent(self):
        self.enqueue()
        self.bot.copy_message.side_effect = Forbidden("No rights")
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "pending")
        self.now += 60
        self.bot.copy_message.side_effect = BadRequest("Message cannot be copied")
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "failed")
        self.assertFalse(await self.relay.deliver_next(self.bot))
        self.assertNotIn("Message cannot be copied", self.row()["error"])

    async def test_native_discussion_group_never_gets_second_copy(self):
        self.enqueue()
        self.bot.get_chat.return_value = NS(linked_chat_id=TARGET)
        await self.relay.deliver_next(self.bot)
        self.bot.copy_message.assert_not_awaited()
        self.assertEqual(self.row()["status"], "native")

    async def test_manual_retry_is_scoped_to_selected_post_and_group(self):
        self.relay.enable(-100777, "Other group")
        self.enqueue()
        self.enqueue(11)
        with self.activity.db:
            self.activity.db.execute("UPDATE relay_outbox SET status='uncertain'")
        self.assertEqual(self.relay.retry_uncertain(TARGET, 10), 1)
        pending = self.activity.db.execute("SELECT * FROM relay_outbox WHERE status='pending'").fetchall()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["target_chat_id"], TARGET)
        self.assertEqual(pending[0]["source_message_id"], 10)

    async def test_explicit_bad_request_rights_error_retries_after_rights_return(self):
        self.enqueue()
        self.bot.copy_message.side_effect = [BadRequest("Not enough rights to send photos"), NS(message_id=100)]
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "pending")
        self.now += 60
        await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "sent")

    async def test_sending_crash_and_task_cancellation_are_not_silently_replayed(self):
        self.enqueue()
        self.activity.db.execute("UPDATE relay_outbox SET status='sending'")
        self.activity.db.commit()
        self.relay = ChannelRelay(self.activity, clock=lambda: self.now)
        self.assertEqual(self.row()["status"], "uncertain")
        self.relay.retry_uncertain(TARGET)
        self.bot.copy_message.side_effect = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await self.relay.deliver_next(self.bot)
        self.assertEqual(self.row()["status"], "uncertain")

    async def test_reply_and_reaction_to_copied_post_earn_xp_but_general_chat_does_not(self):
        self.enqueue()
        await self.relay.deliver_next(self.bot)
        actor = NS(id=10, is_bot=False, full_name="Alice", username="alice")
        post = NS(message_id=100, chat=NS(id=TARGET), is_automatic_forward=False,
                  sender_chat=None, forward_origin=None, from_user=NS(id=123, is_bot=True))
        comment = NS(message_id=101, chat=NS(id=TARGET), from_user=actor, reply_to_message=post,
                     is_automatic_forward=False, forward_origin=None, sender_chat=None,
                     text="Обсуждаем пост", caption=None, date=datetime.fromtimestamp(self.now, timezone.utc))
        self.assertEqual(self.activity.comment(comment, SOURCE).points, 5)
        event = NS(user=actor, actor_chat=None, new_reaction=("👍",), old_reaction=(),
                   chat=NS(id=TARGET), message_id=100, date=comment.date)
        self.assertEqual(self.activity.reaction(event).points, 1)
        comment.message_id = 102
        comment.reply_to_message = None
        self.assertIsNone(self.activity.comment(comment, SOURCE))


if __name__ == "__main__":
    unittest.main()
