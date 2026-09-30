"""Owner commands, independent group delivery and Family XP routing."""

import importlib
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

from telegram import Update, User

from activity_xp import ActivityXP
from channel_relay import ChannelRelay

SOURCE = -1001192817776
FAMILY = -100555
NOW = 1790778000


class RelayIntegrationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123456789:offline-test-token"}):
            cls.bot = importlib.import_module("bot")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.activity = ActivityXP(Path(self.temp.name) / "xp.sqlite3", clock=lambda: NOW)
        self.relay = ChannelRelay(self.activity, clock=lambda: NOW)
        self.old_state = self.bot.STATE
        self.bot.STATE = self.bot.default_state()
        self.env_patch = patch.dict(os.environ, {"XP_DISCUSSION_CHAT_ID": ""})
        self.env_patch.start()
        self.owner = User(self.bot.OWNER_USER_ID, "Owner", False)
        self.update = NS(effective_user=self.owner, effective_chat=NS(id=FAMILY, type="supergroup", title="Family <&>"),
                         message=NS(reply_text=AsyncMock()))
        self.context = NS(args=[], user_data={}, bot_data={"activity_xp": self.activity,
                          "channel_relay": self.relay, "xp_chat_id": -100777}, bot=NS(
                          id=123, get_chat=AsyncMock(return_value=NS(id=SOURCE, linked_chat_id=None)),
                          get_chat_member=AsyncMock(return_value=NS(status="administrator")),
                          copy_message=AsyncMock(return_value=NS(message_id=100)), send_message=AsyncMock()))

    def tearDown(self):
        self.bot.STATE = self.old_state
        self.env_patch.stop()
        self.activity.close()
        self.temp.cleanup()

    async def test_stranger_cannot_enable_disable_or_retry_with_owner_username(self):
        self.update.effective_user = User(99, "Fake", False, username="THKC_SQUAD_CREATOR")
        for command in (self.bot.posts_on_command, self.bot.posts_off_command, self.bot.posts_retry_command):
            await command(self.update, self.context)
        self.assertEqual(self.relay.status(), [])
        self.update.message.reply_text.assert_not_awaited()
        self.context.bot.get_chat.assert_not_awaited()

    async def test_owner_binds_real_chat_then_disables_it(self):
        await self.bot.posts_on_command(self.update, self.context)
        self.assertTrue(self.relay.enabled(FAMILY))
        await self.bot.posts_on_command(self.update, self.context)
        self.assertIn("уже включены", self.update.message.reply_text.call_args.args[0])
        await self.bot.posts_off_command(self.update, self.context)
        self.assertFalse(self.relay.enabled(FAMILY))

    async def test_private_chat_missing_admin_and_native_discussions_do_not_enable(self):
        self.update.effective_chat.type = "private"
        await self.bot.posts_on_command(self.update, self.context)
        self.assertEqual(self.relay.status(), [])
        self.update.effective_chat.type = "supergroup"
        self.context.bot.get_chat_member.return_value = NS(status="member")
        await self.bot.posts_on_command(self.update, self.context)
        self.assertEqual(self.relay.status(), [])
        self.context.bot.get_chat_member.return_value = NS(status="administrator")
        self.context.bot.get_chat.return_value = NS(id=SOURCE, linked_chat_id=FAMILY)
        await self.bot.posts_on_command(self.update, self.context)
        self.assertEqual(self.relay.status(), [])
        self.assertIn("Telegram присылает посты сам", self.update.message.reply_text.call_args.args[0])

    async def test_family_enqueue_works_without_private_subscribers_and_with_personal_toggle_off(self):
        self.relay.enable(FAMILY, "Family")
        self.bot.STATE["channel_broadcast_enabled"] = False
        update = Update.de_json({"update_id": 1, "channel_post": {
            "message_id": 42, "date": NOW, "chat": {"id": SOURCE, "type": "channel",
            "username": "THKC_SQUAD", "title": "SQUAD"}, "text": "Свежий пост"}}, None)
        with patch.object(self.bot, "save_state", new_callable=AsyncMock):
            await self.bot.channel_post(update, self.context)
            await self.bot.channel_post(update, self.context)
        self.assertEqual(self.relay.status()[0]["pending"], 1)
        await self.relay.deliver_next(self.context.bot)
        self.context.bot.copy_message.assert_awaited_once()
        self.assertEqual(self.context.bot.copy_message.call_args.kwargs["chat_id"], FAMILY)

    async def test_unrelated_channel_cannot_enqueue_posts(self):
        self.relay.enable(FAMILY, "Family")
        update = Update.de_json({"update_id": 1, "channel_post": {
            "message_id": 42, "date": NOW, "chat": {"id": -100999, "type": "channel",
            "username": "other", "title": "Other"}, "text": "Чужой пост"}}, None)
        await self.bot.channel_post(update, self.context)
        self.assertEqual(self.relay.status()[0]["pending"], 0)

    async def test_xp_counts_family_replies_and_reactions_without_changing_original_xp_group(self):
        self.relay.enable(FAMILY, "Family")
        msg = NS(chat_id=SOURCE, message_id=42, date=datetime.fromtimestamp(NOW, timezone.utc))
        self.relay.enqueue(msg, "https://t.me/THKC_SQUAD/42")
        await self.relay.deliver_next(self.context.bot)
        post = {"message_id": 100, "date": NOW, "chat": {"id": FAMILY, "type": "supergroup"},
                "from": {"id": 123, "is_bot": True, "first_name": "Finya"}, "text": "Пост"}
        comment = Update.de_json({"update_id": 2, "message": {
            "message_id": 101, "date": NOW, "chat": {"id": FAMILY, "type": "supergroup"},
            "from": {"id": 10, "first_name": "Alice", "is_bot": False},
            "reply_to_message": post, "text": "Обсуждаем пост"}}, None)
        await self.bot.activity_message(comment, self.context)
        reaction = Update.de_json({"update_id": 3, "message_reaction": {
            "chat": {"id": FAMILY, "type": "supergroup"}, "message_id": 100, "date": NOW,
            "user": {"id": 10, "first_name": "Alice", "is_bot": False},
            "old_reaction": [], "new_reaction": [{"type": "emoji", "emoji": "👍"}]}}, None)
        await self.bot.activity_reaction(reaction, self.context)
        self.assertEqual(self.activity.profile(comment.effective_user)["xp"], 6)
        self.assertEqual(self.context.bot_data["xp_chat_id"], -100777)
        self.assertEqual(self.bot.STATE["users"], {})
        self.relay.disable(FAMILY)
        # The posting switch doesn't invalidate already registered XP threads.
        self.assertTrue(self.relay.has_target(FAMILY))

    async def test_admin_status_is_private_owner_only_and_escapes_group_title(self):
        self.relay.enable(FAMILY, "Family <&>")
        query = NS(from_user=self.owner, message=NS(chat=NS(type="private"), photo=False),
                   edit_message_text=AsyncMock())
        await self.bot.handle_admin_callback(query, self.context, "posts")
        self.assertIn("Family &lt;&amp;&gt;", query.edit_message_text.call_args.kwargs["text"])
        query.edit_message_text.reset_mock()
        query.message.chat.type = "supergroup"
        await self.bot.handle_admin_callback(query, self.context, "posts")
        query.edit_message_text.assert_not_awaited()

    async def test_owner_manual_retry_requires_post_id_and_only_retries_that_post(self):
        self.relay.enable(FAMILY, "Family")
        for mid in (42, 43):
            self.relay.enqueue(NS(chat_id=SOURCE, message_id=mid,
                               date=datetime.fromtimestamp(NOW, timezone.utc)), f"https://t.me/THKC_SQUAD/{mid}")
        with self.activity.db:
            self.activity.db.execute("UPDATE relay_outbox SET status='uncertain'")
        await self.bot.posts_retry_command(self.update, self.context)
        self.assertEqual(self.relay.status()[0]["uncertain"], 2)
        self.context.args = ["42"]
        await self.bot.posts_retry_command(self.update, self.context)
        self.assertEqual(self.relay.status()[0]["uncertain"], 1)
        self.assertEqual(self.relay.status()[0]["pending"], 1)

    async def test_application_lifecycle_creates_outbox_and_closes_it_after_stopping_tasks(self):
        folder = Path(self.temp.name) / "startup"
        folder.mkdir()
        app = NS(bot_data={}, bot=self.context.bot)
        with patch.object(self.bot, "STATE_DIR", folder), patch.object(self.bot, "RUNTIME_DIR", folder), \
             patch.object(self.bot, "HEARTBEAT_PATH", folder / "heartbeat.txt"):
            await self.bot.post_init(app)
            store = app.bot_data["activity_xp"]
            self.assertEqual(app.bot_data["channel_relay"].status(), [])
            await self.bot.post_stop(app)
            await self.bot.post_stop(app)
            self.assertEqual(app.bot_data.get("background_tasks", []), [])
            self.assertNotIn("channel_relay", app.bot_data)
            import sqlite3
            with self.assertRaises(sqlite3.ProgrammingError):
                store.db.execute("SELECT 1")


if __name__ == "__main__":
    unittest.main()
