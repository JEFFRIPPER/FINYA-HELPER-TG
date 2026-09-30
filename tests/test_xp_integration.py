"""Real Telegram updates through FINYA handlers, without contacting Telegram."""

import importlib
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from telegram import Update, User
from telegram.error import BadRequest
from telegram.ext import MessageHandler, MessageReactionHandler

from activity_xp import ActivityXP

CHANNEL = -1001192817776
GROUP = -100555
NOW = int(datetime(2026, 9, 30, 12, tzinfo=timezone.utc).timestamp())


def comment_update(mid=2, *, chat_id=GROUP, text="Хороший новый пост", edited=False):
    root = {"message_id": 1, "date": NOW, "chat": {"id": chat_id, "type": "supergroup"},
            "is_automatic_forward": True,
            "sender_chat": {"id": CHANNEL, "type": "channel", "title": "Squad"},
            "forward_origin": {"type": "channel", "date": NOW,
                               "chat": {"id": CHANNEL, "type": "channel", "title": "Squad"},
                               "message_id": 100}, "text": "Пост канала"}
    msg = {"message_id": mid, "date": NOW, "chat": {"id": chat_id, "type": "supergroup"},
           "from": {"id": 10, "first_name": "Alice <&>", "is_bot": False},
           "reply_to_message": root, "text": text}
    return Update.de_json({"update_id": mid, "edited_message" if edited else "message": msg}, None)


def reaction_update(mid=1, *, chat_id=GROUP):
    return Update.de_json({"update_id": 3, "message_reaction": {
        "chat": {"id": chat_id, "type": "supergroup"}, "message_id": mid, "date": NOW,
        "user": {"id": 20, "first_name": "Bob", "is_bot": False},
        "old_reaction": [], "new_reaction": [{"type": "emoji", "emoji": "👍"}],
    }}, None)


class XPIntegrationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123456789:offline-test-token"}):
            cls.bot = importlib.import_module("bot")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.xp = ActivityXP(Path(self.temp.name) / "xp.sqlite3", clock=lambda: NOW)
        self.old_state = self.bot.STATE
        self.bot.STATE = self.bot.default_state()
        self.env_patch = patch.dict(os.environ, {"XP_DISCUSSION_CHAT_ID": ""})
        self.env_patch.start()
        self.context = NS(bot_data={"activity_xp": self.xp, "xp_chat_id": GROUP},
                          user_data={}, args=[], bot=NS(id=123,
                          send_message=AsyncMock(), get_chat=AsyncMock(return_value=NS(linked_chat_id=GROUP)),
                          get_chat_member=AsyncMock(return_value=NS(status="administrator"))))

    def tearDown(self):
        self.bot.STATE = self.old_state
        self.env_patch.stop()
        self.xp.close()
        self.temp.cleanup()

    async def test_real_comment_and_reaction_do_not_add_group_users_to_broadcast(self):
        update = comment_update()
        await self.bot.activity_message(update, self.context)
        await self.bot.activity_reaction(reaction_update(), self.context)
        self.assertEqual(self.xp.profile(update.effective_user)["xp"], 5)
        self.assertEqual(self.xp.profile(User(20, "Bob", False))["xp"], 1)
        self.assertEqual(self.bot.STATE["users"], {})
        self.context.bot.send_message.assert_not_awaited()

    async def test_other_chats_edited_messages_and_maintenance_ignored(self):
        await self.bot.activity_message(comment_update(chat_id=-100999), self.context)
        await self.bot.activity_reaction(reaction_update(chat_id=-100999), self.context)
        await self.bot.activity_message(comment_update(edited=True), self.context)
        self.bot.STATE["maintenance"] = True
        await self.bot.activity_message(comment_update(), self.context)
        self.assertEqual(self.xp.leaderboard(), [])

    def test_real_handlers_route_reactions_and_exclude_edits(self):
        builder = MagicMock()
        for name in ("token", "connect_timeout", "read_timeout", "write_timeout",
                     "get_updates_connect_timeout", "get_updates_read_timeout", "post_init", "post_stop", "post_shutdown"):
            getattr(builder, name).return_value = builder
        with patch.object(self.bot.Application, "builder", return_value=builder):
            self.bot._run_bot()
        app = builder.build.return_value
        handlers = [c.args[0] for c in app.add_handler.call_args_list]
        reaction = next(h for h in handlers if isinstance(h, MessageReactionHandler))
        self.assertTrue(reaction.check_update(reaction_update()))
        observer = next(h for h in handlers if isinstance(h, MessageHandler) and h.callback == self.bot.activity_message)
        self.assertTrue(observer.check_update(comment_update()))
        self.assertFalse(observer.check_update(comment_update(edited=True)))
        self.assertIn("message_reaction", app.run_polling.call_args.kwargs["allowed_updates"])

    async def test_auto_discovers_linked_group_and_manual_binding_takes_precedence(self):
        self.assertEqual(await self.bot.resolve_xp_chat(self.context.bot, self.context.bot_data), GROUP)
        self.bot.STATE["xp_discussion_chat_id"] = -100777
        self.assertEqual(await self.bot.resolve_xp_chat(self.context.bot, self.context.bot_data), -100777)
        self.assertEqual(self.context.bot.get_chat.await_count, 1)

    async def test_only_owner_can_bind_group_and_bot_admin_rights_required(self):
        update = NS(effective_user=User(999, "Imposter", False, username="THKC_SQUAD_CREATOR"),
                    effective_chat=NS(type="supergroup", id=GROUP), message=NS(reply_text=AsyncMock()))
        await self.bot.xp_chat_command(update, self.context)
        update.message.reply_text.assert_not_awaited()
        update.effective_user = User(self.bot.OWNER_USER_ID, "Owner", False)
        self.context.bot.get_chat_member.return_value = NS(status="member")
        await self.bot.xp_chat_command(update, self.context)
        self.assertIsNone(self.bot.STATE["xp_discussion_chat_id"])
        self.context.bot.get_chat_member.return_value = NS(status="administrator")
        with patch.object(self.bot, "save_state", new_callable=AsyncMock) as save:
            await self.bot.xp_chat_command(update, self.context)
            save.assert_awaited_once()
        self.assertEqual(self.bot.STATE["xp_discussion_chat_id"], GROUP)

    async def test_setup_reports_missing_admin_rights_and_no_group(self):
        self.context.bot.get_chat_member.return_value = NS(status="member")
        text = await self.bot.xp_setup_text(self.context)
        self.assertIn("назначь Финю администратором", text)
        self.context.bot.get_chat.return_value = NS(linked_chat_id=None)
        self.assertIn("не найдена", await self.bot.xp_setup_text(self.context))

    async def test_promotion_only_goes_to_known_private_users(self):
        user = User(10, "Alice", False)
        for i in range(20):
            award = self.xp.award(user, GROUP, i, "comment", NOW - 1200 + i * 60)
        self.assertTrue(award.promoted)
        await self.bot.notify_xp_promotion(user, award, self.context)
        self.context.bot.send_message.assert_not_awaited()
        self.bot.STATE["users"]["10"] = {"blocked": False}
        await self.bot.notify_xp_promotion(user, award, self.context)
        self.context.bot.send_message.assert_awaited_once()
        self.assertIn("II · Звено", self.context.bot.send_message.call_args.kwargs["text"])

    async def test_profile_escaping_and_large_rating_does_not_exceed_photo_caption(self):
        user = User(10, "Alice <&>", False)
        self.assertIn("Alice &lt;&amp;&gt;", self.bot.xp_profile_text(user, self.context))
        for i in range(10):
            actor = User(100 + i, "<&>" * 30, False)
            self.xp.award(actor, GROUP, i, "comment", NOW)
        text = self.bot.xp_top_text(self.context)
        self.assertLess(len(text), 4096)
        query = NS(message=NS(photo=True, reply_text=AsyncMock()),
                   edit_message_caption=AsyncMock(), edit_message_text=AsyncMock())
        await self.bot.edit_or_send(query, text, self.bot.xp_keyboard())
        query.message.reply_text.assert_awaited_once()
        query.edit_message_caption.assert_not_awaited()

    async def test_unchanged_profile_refresh_does_not_raise(self):
        query = NS(message=NS(photo=False), edit_message_text=AsyncMock(
            side_effect=BadRequest("Message is not modified")))
        await self.bot.edit_or_send(query, "Профиль")

    async def test_group_profile_button_does_not_opt_user_into_private_broadcasts(self):
        query = NS(data="xp:profile", answer=AsyncMock(), message=NS(photo=False),
                   edit_message_text=AsyncMock())
        update = NS(callback_query=query, effective_user=User(10, "Alice", False),
                    effective_chat=NS(type="supergroup"))
        self.context.user_data["awaiting_feedback"] = True
        await self.bot.button(update, self.context)
        self.assertEqual(self.bot.STATE["users"], {})
        self.assertNotIn("awaiting_feedback", self.context.user_data)
        self.assertIn("I · Искра", query.edit_message_text.call_args.kwargs["text"])


if __name__ == "__main__":
    unittest.main()
