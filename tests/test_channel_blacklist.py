import asyncio
import copy
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from telegram import Chat, ChatMemberLeft, ChatMemberMember, ChatMemberUpdated, Update, User
from telegram.error import BadRequest, Forbidden, NetworkError, RetryAfter

from channel_blacklist import ChannelBlacklist


CHANNEL_ID = -1001234567890
USER_ID = 12345
OWNER_ID = 7221285861
KEY = f"{CHANNEL_ID}:{USER_ID}"
LEAVE_DATE = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)


def make_update(*, chat_type="channel", chat_id=CHANNEL_ID, user_id=USER_ID,
                actor_id=None, old_status="member", new_status="left", is_bot=False,
                date=LEAVE_DATE):
    user = User(id=user_id, first_name="Subscriber", is_bot=is_bot, username="subscriber")
    actor = user if actor_id is None else User(id=actor_id, first_name="Actor", is_bot=False)
    chat = Chat(id=chat_id, type=chat_type, title="THKC SQUAD", username="THKC_SQUAD")
    old_member = ChatMemberMember(user) if old_status == "member" else SimpleNamespace(
        status=old_status, user=user
    )
    new_member = ChatMemberLeft(user) if new_status == "left" else SimpleNamespace(
        status=new_status, user=user
    )
    event = ChatMemberUpdated(chat=chat, from_user=actor, date=date,
                              old_chat_member=old_member, new_chat_member=new_member)
    return Update(update_id=1, chat_member=event)


def current_member(status="left", *, is_bot=False):
    return SimpleNamespace(status=status, user=SimpleNamespace(id=USER_ID, is_bot=is_bot),
                           until_date=datetime.fromtimestamp(0, timezone.utc))


class ChannelBlacklistTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.state = {}
        self.persisted = []

        async def persist():
            self.persisted.append(copy.deepcopy(self.state))

        self.save = AsyncMock(side_effect=persist)
        self.bot = SimpleNamespace(
            get_chat_member=AsyncMock(return_value=current_member()),
            ban_chat_member=AsyncMock(return_value=True),
        )
        self.context = SimpleNamespace(bot=self.bot)
        self.engine = ChannelBlacklist(
            self.state, self.save, lambda chat: chat.id == CHANNEL_ID, OWNER_ID
        )

    async def test_leave_is_persisted_before_permanent_ban(self):
        async def ban(**kwargs):
            self.assertEqual(self.persisted[-1]["channel_blacklist"][KEY]["status"], "pending")
            self.assertEqual(self.persisted[-1]["channel_blacklist"][KEY]["attempts"], 1)
            self.assertEqual(kwargs, {"chat_id": CHANNEL_ID, "user_id": USER_ID})
            return True

        self.bot.ban_chat_member.side_effect = ban
        await self.engine.handle_update(make_update(), self.context)
        self.bot.ban_chat_member.assert_awaited_once()
        record = self.state["channel_blacklist"][KEY]
        self.assertEqual(record["status"], "banned")
        self.assertEqual(record["username"], "subscriber")
        self.assertEqual(record["full_name"], "Subscriber")
        self.assertEqual(record["left_at"], LEAVE_DATE.timestamp())
        self.assertEqual(self.persisted[-1]["channel_blacklist"][KEY]["status"], "banned")

    async def test_nonvoluntary_exits_and_protected_users_are_ignored(self):
        ignored = [
            {"chat_type": "supergroup"}, {"chat_type": "group"},
            {"chat_id": -1009876543210}, {"actor_id": 98765},
            {"old_status": "administrator"}, {"old_status": "creator"},
            {"old_status": "left"}, {"old_status": "kicked"},
            {"new_status": "kicked"}, {"new_status": "member"},
            {"user_id": OWNER_ID}, {"is_bot": True},
        ]
        for kwargs in ignored:
            with self.subTest(kwargs=kwargs):
                await self.engine.handle_update(make_update(**kwargs), self.context)
        await self.engine.handle_update(Update(update_id=1), self.context)
        self.assertEqual(self.state["channel_blacklist"], {})
        self.save.assert_not_awaited()
        self.bot.get_chat_member.assert_not_awaited()
        self.bot.ban_chat_member.assert_not_awaited()

    async def test_duplicate_and_older_events_do_not_repeat_ban(self):
        await self.engine.handle_update(make_update(), self.context)
        await self.engine.handle_update(make_update(), self.context)
        await self.engine.handle_update(
            make_update(date=LEAVE_DATE - timedelta(seconds=1)), self.context
        )
        self.bot.ban_chat_member.assert_awaited_once()
        self.assertEqual(self.state["channel_blacklist"][KEY]["attempts"], 1)

    async def test_new_leave_after_later_readmission_is_processed(self):
        await self.engine.handle_update(make_update(), self.context)
        await self.engine.handle_update(
            make_update(date=LEAVE_DATE + timedelta(seconds=1)), self.context
        )
        self.assertEqual(self.bot.ban_chat_member.await_count, 2)
        self.assertEqual(self.state["channel_blacklist"][KEY]["left_at"],
                         LEAVE_DATE.timestamp() + 1)

    async def test_save_failure_prevents_telegram_requests(self):
        self.save.side_effect = OSError("Disk is full")
        with self.assertRaises(OSError):
            await self.engine.handle_update(make_update(), self.context)
        self.bot.get_chat_member.assert_not_awaited()
        self.bot.ban_chat_member.assert_not_awaited()

    async def test_network_failure_is_pending_until_due_then_retried(self):
        self.bot.ban_chat_member.side_effect = [NetworkError("Connection lost"), True]
        with patch("channel_blacklist.time.time", return_value=1000):
            await self.engine.handle_update(make_update(), self.context)
            record = self.state["channel_blacklist"][KEY]
            self.assertEqual(record["status"], "pending")
            self.assertEqual(record["retry_at"], 1015)
            self.assertIn("Ошибка соединения", record["last_error"])
            await self.engine.retry_pending(self.bot)
            self.bot.ban_chat_member.assert_awaited_once()
        with patch("channel_blacklist.time.time", return_value=1015):
            await self.engine.retry_pending(self.bot)
        self.assertEqual(record["status"], "banned")
        self.assertEqual(record["last_error"], "")
        self.assertEqual(record["attempts"], 2)

    async def test_retry_after_respects_telegram_delay(self):
        for delay in (60, timedelta(seconds=60)):
            with self.subTest(delay=delay):
                self.state["channel_blacklist"].clear()
                self.bot.ban_chat_member.side_effect = RetryAfter(delay)
                with patch("channel_blacklist.time.time", return_value=1000):
                    await self.engine.handle_update(make_update(), self.context)
                record = self.state["channel_blacklist"][KEY]
                self.assertEqual(record["status"], "pending")
                self.assertEqual(record["retry_at"], 1061)

    async def test_rights_errors_are_visible_as_failed_and_retry_when_rights_return(self):
        for error in (Forbidden("Not enough rights"), BadRequest("User not found")):
            with self.subTest(error=error):
                self.state["channel_blacklist"].clear()
                self.bot.ban_chat_member.side_effect = [error, True]
                with patch("channel_blacklist.time.time", return_value=1000):
                    await self.engine.handle_update(make_update(), self.context)
                record = self.state["channel_blacklist"][KEY]
                self.assertEqual(record["status"], "failed")
                self.assertEqual(record["retry_at"], 1300)
                self.assertTrue(record["last_error"])
                self.assertNotIn(str(error), record["last_error"])
                self.assertEqual(self.persisted[-1]["channel_blacklist"][KEY]["status"], "failed")
                with patch("channel_blacklist.time.time", return_value=1300):
                    await self.engine.retry_pending(self.bot)
                self.assertEqual(record["status"], "banned")

    async def test_pending_record_is_resumed_by_new_instance_after_restart(self):
        self.bot.ban_chat_member.side_effect = NetworkError("Timeout")
        with patch("channel_blacklist.time.time", return_value=1000):
            await self.engine.handle_update(make_update(), self.context)
        reloaded = copy.deepcopy(self.persisted[-1])
        restarted = ChannelBlacklist(reloaded, AsyncMock(), lambda chat: True, OWNER_ID)
        self.bot.ban_chat_member.side_effect = None
        with patch("channel_blacklist.time.time", return_value=1016):
            await restarted.retry_pending(self.bot)
        self.assertEqual(reloaded["channel_blacklist"][KEY]["status"], "banned")
        self.assertEqual(reloaded["channel_blacklist"][KEY]["attempts"], 2)

    async def test_retry_checks_current_admin_bot_and_owner_protection(self):
        self.bot.ban_chat_member.side_effect = NetworkError("Timeout")
        with patch("channel_blacklist.time.time", return_value=1000):
            await self.engine.handle_update(make_update(), self.context)
        self.bot.ban_chat_member.reset_mock()
        record = self.state["channel_blacklist"][KEY]
        cases = [("administrator", False, USER_ID), ("creator", False, USER_ID),
                 ("left", True, USER_ID), ("left", False, OWNER_ID)]
        for status, is_bot, user_id in cases:
            with self.subTest(status=status, is_bot=is_bot, user_id=user_id):
                record.update(status="pending", retry_at=0, user_id=user_id)
                self.bot.get_chat_member.return_value = current_member(status, is_bot=is_bot)
                await self.engine.retry_pending(self.bot)
                self.assertEqual(record["status"], "failed")
        self.bot.ban_chat_member.assert_not_awaited()

    async def test_current_admin_is_also_protected_on_initial_event(self):
        self.bot.get_chat_member.return_value = current_member("administrator")
        await self.engine.handle_update(make_update(), self.context)
        self.bot.ban_chat_member.assert_not_awaited()
        self.assertEqual(self.state["channel_blacklist"][KEY]["status"], "failed")

    async def test_already_banned_is_confirmed_without_second_ban(self):
        self.bot.get_chat_member.return_value = current_member("kicked")
        await self.engine.handle_update(make_update(), self.context)
        self.bot.ban_chat_member.assert_not_awaited()
        self.assertEqual(self.state["channel_blacklist"][KEY]["status"], "banned")

    async def test_failed_lookup_never_bans_without_role_check(self):
        self.bot.get_chat_member.side_effect = NetworkError("Lookup failed")
        await self.engine.handle_update(make_update(), self.context)
        self.bot.ban_chat_member.assert_not_awaited()
        self.assertEqual(self.state["channel_blacklist"][KEY]["status"], "pending")

    async def test_existing_temporary_ban_is_made_permanent(self):
        self.bot.get_chat_member.return_value = current_member("kicked")
        self.bot.get_chat_member.return_value.until_date = LEAVE_DATE + timedelta(days=1)
        await self.engine.handle_update(make_update(), self.context)
        self.bot.ban_chat_member.assert_awaited_once_with(chat_id=CHANNEL_ID, user_id=USER_ID)
        self.assertEqual(self.state["channel_blacklist"][KEY]["status"], "banned")

    async def test_retry_ignores_records_for_another_channel(self):
        self.bot.ban_chat_member.side_effect = NetworkError("Timeout")
        await self.engine.handle_update(make_update(), self.context)
        self.bot.ban_chat_member.reset_mock()
        self.bot.get_chat_member.reset_mock()
        self.state["channel_blacklist"][KEY].update(chat_id=-1009999999999, retry_at=0)
        await self.engine.retry_pending(self.bot)
        self.bot.ban_chat_member.assert_not_awaited()
        self.bot.get_chat_member.assert_not_awaited()

    async def test_raw_network_error_details_are_never_stored(self):
        self.bot.ban_chat_member.side_effect = NetworkError(
            "https://api.telegram.org/botTOP_SECRET/banChatMember is unavailable"
        )
        await self.engine.handle_update(make_update(), self.context)
        self.assertNotIn("TOP_SECRET", self.state["channel_blacklist"][KEY]["last_error"])
        self.assertNotIn("https://", self.state["channel_blacklist"][KEY]["last_error"])

    async def test_concurrent_event_and_retries_only_issue_one_ban(self):
        entered = asyncio.Event()
        release = asyncio.Event()

        async def ban(**kwargs):
            entered.set()
            await release.wait()
            return True

        self.bot.ban_chat_member.side_effect = ban
        first = asyncio.create_task(self.engine.handle_update(make_update(), self.context))
        await asyncio.wait_for(entered.wait(), timeout=2)
        duplicate = asyncio.create_task(self.engine.handle_update(make_update(), self.context))
        retry_one = asyncio.create_task(self.engine.retry_pending(self.bot))
        retry_two = asyncio.create_task(self.engine.retry_pending(self.bot))
        release.set()
        await asyncio.wait_for(asyncio.gather(first, duplicate, retry_one, retry_two), timeout=2)
        self.bot.ban_chat_member.assert_awaited_once()
        self.assertEqual(self.state["channel_blacklist"][KEY]["status"], "banned")


if __name__ == "__main__":
    unittest.main()
