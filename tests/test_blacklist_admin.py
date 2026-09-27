"""Offline integration checks: owner access, escaping, paging and update routing."""
import asyncio
import copy
import importlib
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from telegram import User
from telegram.error import BadRequest, Forbidden
from telegram.ext import ChatMemberHandler


class BlacklistAdminTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123456789:offline-test-token"}):
            cls.bot = importlib.import_module("bot")

    def setUp(self):
        self.old_state = self.bot.STATE
        self.bot.STATE = self.bot.default_state()
        self.owner = User(self.bot.OWNER_USER_ID, "Owner", False)
        self.query = SimpleNamespace(
            from_user=self.owner,
            message=SimpleNamespace(chat=SimpleNamespace(type="private")),
            edit_message_text=AsyncMock(),
        )
        self.context = SimpleNamespace(user_data={}, bot=SimpleNamespace(
            id=123, get_chat_member=AsyncMock(return_value=SimpleNamespace(
                status="administrator", can_restrict_members=True))))

    def tearDown(self):
        self.bot.STATE = self.old_state

    def add_records(self, count):
        for n in range(count):
            self.bot.STATE["channel_blacklist"][str(n)] = {
                "chat_id": self.bot.BLACKLIST_CHANNEL_ID, "user_id": 2000 + n,
                "full_name": '<Alice & Bob>', "username": 'alice',
                "left_at": 1700000000 + n, "status": "banned", "last_error": None,
            }

    async def test_owner_sees_empty_list_and_permission_status(self):
        await self.bot.handle_admin_callback(self.query, self.context, "blacklist")
        text = self.query.edit_message_text.call_args.kwargs["text"]
        self.assertIn("список пуст", text)
        self.assertIn("Автобан: включён", text)
        self.assertTrue(text.startswith("<b>"))

    async def test_stranger_with_owner_username_cannot_access_any_page(self):
        self.query.from_user = User(222, "Stranger", False, username="THKC_SQUAD_CREATOR")
        for action in ("blacklist", "blacklist:1"):
            await self.bot.handle_admin_callback(self.query, self.context, action)
        self.query.edit_message_text.assert_not_awaited()
        self.context.bot.get_chat_member.assert_not_awaited()

    async def test_owner_cannot_publish_list_in_group(self):
        self.query.message.chat.type = "supergroup"
        await self.bot.handle_admin_callback(self.query, self.context, "blacklist")
        self.query.edit_message_text.assert_not_awaited()

    async def test_pagination_escaping_newest_first_and_other_channel_hidden(self):
        self.add_records(7)
        other = copy.deepcopy(self.bot.STATE["channel_blacklist"]["0"])
        other.update(chat_id=-100999, full_name="Other channel")
        self.bot.STATE["channel_blacklist"]["other"] = other
        await self.bot.handle_admin_callback(self.query, self.context, "blacklist")
        payload = self.query.edit_message_text.call_args.kwargs
        self.assertIn("Записей: 7", payload["text"])
        self.assertIn("Страница 1 из 2", payload["text"])
        self.assertIn("&lt;Alice &amp; Bob&gt;", payload["text"])
        self.assertNotIn("Other channel", payload["text"])
        self.assertIn("ID: 2006", payload["text"])
        self.assertNotIn("ID: 2000", payload["text"])
        callbacks = [b.callback_data for row in payload["reply_markup"].inline_keyboard for b in row]
        self.assertIn("admin:blacklist:1", callbacks)
        await self.bot.handle_admin_callback(self.query, self.context, "blacklist:99")
        text = self.query.edit_message_text.call_args.kwargs["text"]
        self.assertIn("Страница 2 из 2", text)
        self.assertIn("ID: 2000", text)
        self.assertNotIn("ID: 2006", text)

    async def test_permission_failure_and_failed_ban_never_claim_success(self):
        self.add_records(1)
        self.bot.STATE["channel_blacklist"]["0"].update(status="failed", last_error="Нет прав <admin>")
        self.context.bot.get_chat_member.side_effect = Forbidden("Denied")
        await self.bot.handle_admin_callback(self.query, self.context, "blacklist")
        text = self.query.edit_message_text.call_args.kwargs["text"]
        self.assertIn("Бан подтверждён: 0", text)
        self.assertIn("Бан не выполнен", text)
        self.assertIn("&lt;admin&gt;", text)
        self.assertIn("не удалось проверить права", text)

    async def test_refresh_of_unchanged_message_is_safe(self):
        self.query.edit_message_text.side_effect = BadRequest("Message is not modified")
        await self.bot.handle_admin_callback(self.query, self.context, "blacklist:0")

    async def test_invalid_page_ignored_and_entering_list_cancels_composition(self):
        await self.bot.handle_admin_callback(self.query, self.context, "blacklist:nope")
        self.query.edit_message_text.assert_not_awaited()
        self.context.user_data["admin_action"] = "broadcast"
        await self.bot.handle_admin_callback(self.query, self.context, "blacklist")
        self.assertNotIn("admin_action", self.context.user_data)

    async def test_records_survive_actual_state_save_reload_and_old_state_migrates(self):
        self.add_records(2)
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            with patch.object(self.bot, "STATE_PATH", folder / "state.json"), \
                 patch.object(self.bot, "RUNTIME_DIR", folder), \
                 patch.object(self.bot, "STATE_LOCK", asyncio.Lock()):
                await self.bot.save_state()
                restored = self.bot.load_state()
                self.assertEqual(restored["channel_blacklist"], self.bot.STATE["channel_blacklist"])
                (folder / "state.json").write_text('{"users": {"1": {}}}', encoding="utf-8")
                restored = self.bot.load_state()
                self.assertEqual(restored["channel_blacklist"], {})
                self.assertIn("1", restored["users"])

    async def test_registered_handler_explicit_subscription_and_queued_updates_retained(self):
        builder = MagicMock()
        for method in ("token", "connect_timeout", "read_timeout", "write_timeout",
                       "get_updates_connect_timeout", "get_updates_read_timeout", "post_init", "post_stop", "post_shutdown"):
            getattr(builder, method).return_value = builder
        app = builder.build.return_value
        with patch.object(self.bot.Application, "builder", return_value=builder):
            self.bot._run_bot()
        handlers = [c.args[0] for c in app.add_handler.call_args_list]
        handler = next(h for h in handlers if isinstance(h, ChatMemberHandler))
        self.assertEqual(handler.chat_member_types, ChatMemberHandler.CHAT_MEMBER)
        self.assertEqual(handler.callback, self.bot.CHANNEL_BLACKLIST.handle_update)
        self.assertIn("chat_member", app.run_polling.call_args.kwargs["allowed_updates"])
        self.assertFalse(app.run_polling.call_args.kwargs["drop_pending_updates"])

    def test_pinned_channel_id_and_admin_entry(self):
        self.assertTrue(self.bot.is_blacklist_channel(SimpleNamespace(type="channel", id=-1001192817776)))
        self.assertFalse(self.bot.is_blacklist_channel(SimpleNamespace(type="channel", id=-100123)))
        callbacks = [b.callback_data for row in self.bot.admin_keyboard().inline_keyboard for b in row]
        self.assertIn("admin:blacklist", callbacks)


if __name__ == "__main__":
    unittest.main()
