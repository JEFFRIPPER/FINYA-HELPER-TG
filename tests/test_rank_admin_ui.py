"""Offline owner flows for rank management, with temporary XP storage only."""

import copy
import importlib
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

from telegram import User

from activity_xp import ActivityXP, MAX_XP


OWNER = 7221285861
NOW = 1_791_024_000


class RankAdminUITests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123456789:offline-test-token"}):
            cls.bot = importlib.import_module("bot")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.xp = ActivityXP(Path(self.temp.name) / "xp.sqlite3", clock=lambda: NOW)
        self.old_state = self.bot.STATE
        self.bot.STATE = self.bot.default_state()
        self.owner = User(OWNER, "Owner", False)
        self.member = User(10, "Alice <&>", False, username="alice")
        self.xp.award(self.member, -100555, 1, "comment", NOW)
        self.query = NS(
            data="admin:xp", from_user=self.owner, answer=AsyncMock(),
            message=NS(chat=NS(type="private", id=OWNER), photo=False,
                       reply_text=AsyncMock()),
            edit_message_text=AsyncMock(), edit_message_caption=AsyncMock(),
        )
        self.context = NS(
            bot_data={"activity_xp": self.xp}, user_data={}, args=[],
            bot=NS(id=123, send_message=AsyncMock(), get_chat=AsyncMock(),
                   get_chat_member=AsyncMock(return_value=NS(status="administrator"))),
        )
        self.track_patch = patch.object(self.bot, "track_user", new_callable=AsyncMock)
        self.save_patch = patch.object(self.bot, "save_state", new_callable=AsyncMock)
        self.track_patch.start()
        self.save_patch.start()

    def tearDown(self):
        self.track_patch.stop()
        self.save_patch.stop()
        self.bot.STATE = self.old_state
        self.xp.close()
        self.temp.cleanup()

    async def action(self, action):
        self.query.data = "admin:" + action
        await self.bot.handle_admin_callback(self.query, self.context, action)

    def callbacks(self):
        call = self.query.edit_message_text.call_args
        if call is None:
            call = self.query.message.reply_text.call_args
        markup = call.kwargs.get("reply_markup")
        return [button.callback_data for row in markup.inline_keyboard for button in row]

    def screen(self):
        call = self.query.edit_message_text.call_args
        if call is None:
            call = self.query.message.reply_text.call_args
        return call.kwargs["text"]

    def message_update(self, text, *, user=None, chat_type="private"):
        user = user or self.owner
        message = NS(text=text, chat=NS(type=chat_type, id=user.id),
                     from_user=user, reply_text=AsyncMock(), reply_photo=AsyncMock())
        return NS(effective_user=user, effective_chat=message.chat,
                  effective_message=message, message=message)

    async def message(self, text, *, user=None, chat_type="private"):
        update = self.message_update(text, user=user, chat_type=chat_type)
        await self.bot.text_message(update, self.context)
        return update

    def pending_token(self):
        token = self.context.user_data["rank_admin_pending"]["token"]
        self.assertIn("admin:xp:confirm:" + token, self.callbacks())
        return token

    async def preview_rank(self, roman="IX", user_id=10):
        await self.action(f"xp:user:{user_id}")
        await self.action(f"xp:choose:{user_id}:{roman}")
        return self.pending_token()

    async def confirm_rank(self, roman="IX", user_id=10):
        token = await self.preview_rank(roman, user_id)
        await self.action("xp:confirm:" + token)
        return token

    def profile(self):
        return self.xp.profile(self.member)

    def assert_no_rank_composition(self):
        self.assertNotIn("rank_admin", self.context.user_data)
        self.assertNotIn("rank_admin_pending", self.context.user_data)
        self.assertNotIn("admin_action", self.context.user_data)

    async def test_admin_entry_opens_users_and_search(self):
        await self.action("xp")
        callbacks = self.callbacks()
        self.assertTrue(any(value.startswith("admin:xp:users") for value in callbacks))
        self.assertIn("admin:xp:find", callbacks)
        self.assertIn("admin:menu", callbacks)
        self.assertEqual(self.profile()["xp"], 5)

    async def test_imposter_with_owner_username_cannot_read_or_confirm(self):
        token = await self.preview_rank()
        snapshot = copy.deepcopy(self.context.user_data)
        stranger = User(99, "Imposter", False, username="THKC_SQUAD_CREATOR")
        self.query.from_user = stranger
        self.query.edit_message_text.reset_mock()
        for action in ("xp", "xp:users", "xp:user:10", "xp:rank:10",
                       "xp:choose:10:IX", "xp:history:10", "xp:confirm:" + token):
            await self.action(action)
        self.query.edit_message_text.assert_not_awaited()
        self.assertEqual(self.context.user_data, snapshot)
        self.assertEqual(self.profile()["xp"], 5)
        self.assertNotIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))
        self.query.from_user = self.owner
        await self.action("xp:add:10")
        await self.message("250", user=stranger)
        self.assertNotIn("rank_admin_pending", self.context.user_data)
        self.assertEqual(self.profile()["xp"], 5)

    async def test_owner_group_cannot_manage_ranks_or_submit_private_prompt(self):
        await self.action("xp:add:10")
        self.query.message.chat.type = "supergroup"
        self.query.edit_message_text.reset_mock()
        for action in ("xp", "xp:users", "xp:user:10", "xp:choose:10:IX"):
            await self.action(action)
        self.query.edit_message_text.assert_not_awaited()
        await self.message("250", chat_type="supergroup")
        self.assertEqual(self.profile()["xp"], 5)
        self.assertNotIn("rank_admin_pending", self.context.user_data)

    async def test_user_pages_cover_each_member_once_and_escape_names(self):
        for user_id in range(11, 17):
            self.xp.profile(User(user_id, f"Member {user_id}", False))
        await self.action("xp:users:0")
        first = [item for item in self.callbacks() if item.startswith("admin:xp:user:")]
        self.assertEqual(len(first), 6)
        self.assertIn("admin:xp:users:1", self.callbacks())
        await self.action("xp:users:1")
        second = [item for item in self.callbacks() if item.startswith("admin:xp:user:")]
        self.assertEqual(len(second), 1)
        self.assertEqual(set(first + second), {f"admin:xp:user:{i}" for i in range(10, 17)})
        await self.action("xp:user:10")
        self.assertIn("&lt;&amp;&gt;", self.screen())
        self.assertNotIn("Alice <&>", self.screen())

    async def test_username_and_id_search_select_the_same_known_member(self):
        for target in ("@ALICE", "10"):
            await self.action("xp:find")
            update = await self.message(target)
            self.assertEqual(self.context.user_data.get("rank_admin_selected"), 10)
            self.assertNotIn("rank_admin", self.context.user_data)
            self.assertNotIn("admin_action", self.context.user_data)
            self.assertIn("10", update.message.reply_text.call_args.args[0])
        self.context.bot.get_chat.assert_not_awaited()

    async def test_state_only_known_user_can_be_selected_without_telegram_lookup(self):
        self.bot.STATE["users"]["700"] = {"first_name": "State member", "username": "newmember"}
        await self.action("xp:find")
        await self.message("@newmember")
        self.assertEqual(self.context.user_data.get("rank_admin_selected"), 700)
        self.assertIsNotNone(self.xp.db.execute("SELECT user_id FROM profiles WHERE user_id=700").fetchone())
        self.context.bot.get_chat.assert_not_awaited()

    async def test_ambiguous_username_requires_id_and_keeps_search_open(self):
        self.xp.profile(User(11, "Another Alice", False, username="alice"))
        await self.action("xp:find")
        update = await self.message("@alice")
        self.assertEqual(self.context.user_data.get("admin_action"), "rank_find")
        self.assertNotIn("rank_admin_selected", self.context.user_data)
        self.assertIn("ID", update.message.reply_text.call_args.args[0])
        await self.message("11")
        self.assertEqual(self.context.user_data.get("rank_admin_selected"), 11)

    async def test_invalid_search_and_oversized_id_are_retryable(self):
        await self.action("xp:find")
        for target in ("@unknown_person", "not a username", str(2 ** 100)):
            await self.message(target)
            self.assertEqual(self.context.user_data.get("admin_action"), "rank_find")
            self.assertNotIn("rank_admin_selected", self.context.user_data)
            self.assertNotIn("rank_admin_pending", self.context.user_data)
        await self.message("10")
        self.assertEqual(self.context.user_data.get("rank_admin_selected"), 10)
        oversized_id = str(2 ** 100)
        for action in (f"xp:user:{oversized_id}", f"xp:choose:{oversized_id}:IX",
                       f"xp:add:{oversized_id}", f"xp:history:{oversized_id}"):
            await self.action(action)
            self.assertNotIn("rank_admin_pending", self.context.user_data)
        self.assertEqual(self.profile()["xp"], 5)

    async def test_picker_contains_all_normal_ranks_but_never_founder(self):
        await self.action("xp:user:10")
        await self.action("xp:rank:10")
        choices = {value for value in self.callbacks() if value.startswith("admin:xp:choose:")}
        self.assertEqual(choices, {f"admin:xp:choose:10:{rank[1]}" for rank in self.bot.RANKS})
        self.assertNotIn("admin:xp:choose:10:X", choices)
        self.assertNotIn("rank_admin_pending", self.context.user_data)
        await self.action("xp:choose:10:X")
        self.assertNotIn("rank_admin_pending", self.context.user_data)
        self.assertEqual(self.profile()["xp"], 5)

    async def test_rank_preview_changes_nothing_until_confirmed(self):
        token = await self.preview_rank()
        self.assertEqual(self.profile()["xp"], 5)
        self.assertNotIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))
        self.assertIn("IX", self.screen())
        self.assertIn("admin:xp:cancel", self.callbacks())
        await self.action("xp:confirm:" + token)
        profile = self.profile()
        self.assertEqual((profile["xp"], profile["today"], profile["week"]), (5, 5, 5))
        text = self.bot.xp_profile_text(self.member, self.context)
        self.assertIn("IX · Верховный Архонт", text)
        self.assertIn("владельцем", text.lower())
        self.assertIn("IX · Верховный Архонт", self.bot.xp_top_text(self.context))
        self.assertNotIn("rank_admin_pending", self.context.user_data)

    async def test_restoring_auto_rank_requires_confirmation_and_preserves_xp(self):
        await self.confirm_rank()
        await self.action("xp:auto:10")
        token = self.pending_token()
        self.assertIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))
        await self.action("xp:confirm:" + token)
        self.assertEqual(self.profile()["xp"], 5)
        text = self.bot.xp_profile_text(self.member, self.context)
        self.assertIn("I · Искра", text)
        self.assertNotIn("IX · Верховный Архонт", text)
        self.assertNotIn("Назначено владельцем", text)

    async def test_amount_prompt_rejects_invalid_input_without_losing_target(self):
        await self.action("xp:add:10")
        for value in ("", "-5", "0", "1.5", "ten", str(2 ** 100)):
            await self.message(value)
            self.assertEqual(self.context.user_data.get("admin_action"), "rank_amount")
            self.assertIn("rank_admin", self.context.user_data)
            self.assertNotIn("rank_admin_pending", self.context.user_data)
            self.assertEqual(self.profile()["xp"], 5)
        await self.message("250")
        pending = self.context.user_data["rank_admin_pending"]
        self.assertEqual(self.profile()["xp"], 5)
        await self.action("xp:confirm:" + pending["token"])
        profile = self.profile()
        self.assertEqual((profile["xp"], profile["today"], profile["week"]), (255, 5, 5))

    async def test_subtract_clamps_at_zero_without_rewriting_earned_points(self):
        await self.action("xp:subtract:10")
        await self.message("500")
        token = self.context.user_data["rank_admin_pending"]["token"]
        self.assertEqual(self.profile()["xp"], 5)
        await self.action("xp:confirm:" + token)
        profile = self.profile()
        self.assertEqual((profile["xp"], profile["today"], profile["week"]), (0, 5, 5))

    async def test_confirm_is_idempotent_and_invalid_old_tokens_do_not_apply(self):
        old_token = await self.preview_rank("IX")
        new_token = await self.preview_rank("III")
        self.assertNotEqual(old_token, new_token)
        await self.action("xp:confirm:" + old_token)
        self.assertNotIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))
        self.assertEqual(self.context.user_data["rank_admin_pending"]["token"], new_token)
        await self.action("xp:confirm:" + new_token)
        self.assertIn("III · Клинок", self.bot.xp_profile_text(self.member, self.context))
        history_before = self.xp.db.total_changes
        await self.action("xp:confirm:" + new_token)
        self.assertEqual(self.xp.db.total_changes, history_before)

    async def test_expired_and_outdated_previews_do_not_overwrite_new_data(self):
        token = await self.preview_rank()
        self.context.user_data["rank_admin_pending"]["time"] = 0
        await self.action("xp:confirm:" + token)
        self.assertNotIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))
        token = await self.preview_rank()
        self.xp.award(self.member, -100555, 2, "comment", NOW + 60)
        await self.action("xp:confirm:" + token)
        self.assertEqual(self.profile()["xp"], 10)
        self.assertNotIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))

    async def test_changed_xp_that_overflows_preview_returns_to_amount_input(self):
        with self.xp.db:
            self.xp.db.execute("UPDATE profiles SET xp=? WHERE user_id=10", (MAX_XP - 7,))
        await self.action("xp:add:10")
        await self.message("5")
        token = self.context.user_data["rank_admin_pending"]["token"]
        self.xp.award(self.member, -100555, 2, "comment", NOW + 60)
        self.assertEqual(self.profile()["xp"], MAX_XP - 2)
        await self.action("xp:confirm:" + token)
        self.assertEqual(self.profile()["xp"], MAX_XP - 2)
        self.assertEqual(self.xp.admin_history(10), [])
        self.assertNotIn("rank_admin_pending", self.context.user_data)
        self.assertEqual(self.context.user_data.get("admin_action"), "rank_amount")
        self.assertEqual(self.context.user_data["rank_admin"]["user_id"], 10)
        self.assertFalse(any(value.startswith("admin:xp:confirm:") for value in self.callbacks()))
        self.assertRegex(self.screen().lower(), r"максим|превыш|меньше|лимит")
        await self.message("1")
        retry_token = self.context.user_data["rank_admin_pending"]["token"]
        await self.action("xp:confirm:" + retry_token)
        self.assertEqual(self.profile()["xp"], MAX_XP - 1)

    async def test_cancel_returns_selected_card_and_discards_preview(self):
        token = await self.preview_rank()
        await self.action("xp:cancel")
        self.assert_no_rank_composition()
        self.assertEqual(self.context.user_data.get("rank_admin_selected"), 10)
        self.assertIn("admin:xp:rank:10", self.callbacks())
        await self.action("xp:confirm:" + token)
        self.assertEqual(self.profile()["xp"], 5)
        self.assertNotIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))

    async def test_founder_card_is_read_only_and_cannot_be_edited_by_forged_callbacks(self):
        self.xp.profile(self.owner)
        await self.action(f"xp:user:{OWNER}")
        self.assertIn("Основатель", self.screen())
        callbacks = self.callbacks()
        for prefix in ("admin:xp:rank:", "admin:xp:auto:", "admin:xp:add:", "admin:xp:subtract:"):
            self.assertFalse(any(value.startswith(prefix) for value in callbacks))
        for action in (f"xp:choose:{OWNER}:IX", f"xp:auto:{OWNER}",
                       f"xp:add:{OWNER}", f"xp:subtract:{OWNER}"):
            await self.action(action)
            self.assertNotIn("rank_admin_pending", self.context.user_data)
            self.assertNotIn("rank_admin", self.context.user_data)
        self.assertEqual(self.xp.profile(self.owner)["xp"], 0)
        self.assertIn("X · Основатель SQUAD", self.bot.xp_profile_text(self.owner, self.context))

    async def test_commands_and_unrelated_navigation_discard_active_prompts(self):
        for handler in (self.bot.admin_command, self.bot.start, self.bot.cancel_command):
            await self.preview_rank()
            update = self.message_update("/cancel")
            await handler(update, self.context)
            self.assert_no_rank_composition()
        for data in ("home", "xp:profile", "admin:menu"):
            await self.action("xp:add:10")
            self.query.data = data
            update = NS(callback_query=self.query, effective_user=self.owner,
                        effective_chat=self.query.message.chat)
            await self.bot.button(update, self.context)
            self.assert_no_rank_composition()
        self.assertEqual(self.profile()["xp"], 5)

    async def test_database_failure_leaves_confirmation_retryable(self):
        token = await self.preview_rank()
        with self.assertLogs("admin_ranks", level="ERROR"), \
             patch.object(self.xp, "set_manual_rank", side_effect=sqlite3.OperationalError("database is locked")):
            await self.action("xp:confirm:" + token)
        self.assertEqual(self.context.user_data["rank_admin_pending"]["token"], token)
        self.assertNotIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))
        await self.action("xp:confirm:" + token)
        self.assertIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))
        self.context.bot.send_message.assert_not_awaited()

    async def test_profile_read_failure_keeps_confirm_and_cancel_available(self):
        token = await self.preview_rank()
        pending = copy.deepcopy(self.context.user_data["rank_admin_pending"])
        with self.assertLogs("admin_ranks", level="ERROR"), \
             patch.object(self.xp, "get_profile", side_effect=sqlite3.OperationalError("database is locked")):
            await self.action("xp:confirm:" + token)
        self.assertEqual(self.context.user_data["rank_admin_pending"], pending)
        self.assertIn("admin:xp:confirm:" + token, self.callbacks())
        self.assertIn("admin:xp:cancel", self.callbacks())
        self.assertNotIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))
        await self.action("xp:confirm:" + token)
        self.assertIn("IX · Верховный Архонт", self.bot.xp_profile_text(self.member, self.context))

    async def test_history_displays_rank_and_xp_changes_with_owner_identity(self):
        await self.confirm_rank()
        await self.action("xp:add:10")
        await self.message("250")
        token = self.context.user_data["rank_admin_pending"]["token"]
        await self.action("xp:confirm:" + token)
        await self.action("xp:history:10")
        text = self.screen()
        self.assertIn("IX", text)
        self.assertIn("5 → 255", text)
        self.assertIn(str(OWNER), text)
        self.assertIn("admin:xp:user:10", self.callbacks())


if __name__ == "__main__":
    unittest.main()
