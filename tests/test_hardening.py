"""Regression tests for launcher, state, broadcast and callback fixes."""
import asyncio
import html
import importlib
import os
import socket
import tempfile
import time
import unittest
from html.parser import HTMLParser
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

from telegram import Update, User
from telegram.error import BadRequest, Forbidden, NetworkError, RetryAfter

import setup_token
from channel_blacklist import ChannelBlacklist

OWNER = 7221285861
NOW = 1_791_024_000
SOURCE = -1001192817776


class TagBalance(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.errors = [], []

    def handle_starttag(self, tag, attrs):
        self.stack.append(tag)

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errors.append(tag)

    def balanced(self, text):
        self.feed(text)
        return not self.errors and not self.stack


class BotCase(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123456789:offline-test-token"}):
            cls.bot = importlib.import_module("bot")

    def setUp(self):
        self.old_state = self.bot.STATE
        self.bot.STATE = self.bot.default_state()
        self.save = patch.object(self.bot, "save_state", new_callable=AsyncMock)
        self.track = patch.object(self.bot, "track_user", new_callable=AsyncMock)
        self.save_mock = self.save.start()
        self.track.start()

    def tearDown(self):
        self.save.stop()
        self.track.stop()
        self.bot.STATE = self.old_state


class UserTrackingTests(BotCase):
    def setUp(self):
        super().setUp()
        self.user = User(5, "Ann", False, username="ann")

    async def call(self, moment):
        with patch.object(self.bot, "time", NS(time=lambda: moment)):
            await self.bot.track_user_throttled(self.user)

    async def test_first_seen_is_recorded_and_kept(self):
        await self.call(1000)
        record = self.bot.STATE["users"]["5"]
        self.assertEqual((record["first_seen"], record["last_seen"], record["blocked"]), (1000, 1000, False))
        await self.call(1100)
        record = self.bot.STATE["users"]["5"]
        self.assertEqual((record["first_seen"], record["last_seen"]), (1000, 1100))

    async def test_state_is_written_at_most_once_a_minute(self):
        await self.call(1000)
        await self.call(1030)
        self.assertEqual(self.save_mock.await_count, 1)
        await self.call(1100)  # 70 s after the previous visit
        self.assertEqual(self.save_mock.await_count, 2)

    async def test_returning_blocked_user_is_saved_at_once_and_unblocked(self):
        self.bot.STATE["users"]["5"] = {"first_seen": 10, "last_seen": 990, "blocked": True,
                                        "blocked_at": 995, "custom": "kept"}
        await self.call(1000)
        record = self.bot.STATE["users"]["5"]
        self.assertFalse(record["blocked"])
        self.assertNotIn("blocked_at", record)
        self.assertEqual((record["first_seen"], record["custom"]), (10, "kept"))
        self.assertEqual(self.save_mock.await_count, 1)

    async def test_old_user_is_not_counted_as_new_after_activity(self):
        now = int(time.time())
        self.bot.STATE["users"]["5"] = {"first_seen": now - 30 * 86400, "last_seen": now - 30 * 86400}
        await self.bot.track_user_throttled(self.user)
        stats = self.bot.user_stats_snapshot()
        self.assertEqual((stats["new"], stats["active"]), (0, 1))


class StateAndEnvTests(BotCase):
    def test_corrupt_state_is_moved_aside_not_overwritten(self):
        for content in ("{broken", "[1, 2]"):
            with self.subTest(content=content), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)
                (folder / "state.json").write_text(content, encoding="utf-8")
                with patch.object(self.bot, "STATE_PATH", folder / "state.json"), \
                     patch.object(self.bot, "RUNTIME_DIR", folder):
                    restored = self.bot.load_state()
                self.assertEqual(restored["users"], {})
                self.assertFalse((folder / "state.json").exists())
                backups = list(folder.glob("state.json.corrupt-*"))
                self.assertEqual(len(backups), 1)
                self.assertEqual(backups[0].read_text(encoding="utf-8"), content)

    def test_missing_state_creates_no_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            with patch.object(self.bot, "STATE_PATH", folder / "state.json"), \
                 patch.object(self.bot, "RUNTIME_DIR", folder):
                self.bot.load_state()
            self.assertEqual(list(folder.iterdir()), [])

    def test_env_file_with_bom_loads_first_key(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {}):
            path = Path(temp) / ".env"
            path.write_bytes(b"\xef\xbb\xbfHARDENING_FIRST=1\nHARDENING_SECOND='2'\n")
            self.bot.load_local_env(path)
            self.assertEqual(os.environ["HARDENING_FIRST"], "1")
            self.assertEqual(os.environ["HARDENING_SECOND"], "2")


class LogAndStatusTests(BotCase):
    def test_log_tail_is_valid_html_within_budget(self):
        line = '2026-10-03 12:00:00 ERROR x: Traceback "quoted" <obj> & more ' * 8
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / "error.log").write_text("\n".join([line] * 12), encoding="utf-8")
            with patch.object(self.bot, "LOGS_DIR", Path(temp)):
                text = self.bot.log_tail_html("error.log")
                missing = self.bot.log_tail_html("bot.log")
        self.assertLessEqual(len(text), 1900)
        self.assertTrue(text.startswith("<b>error.log</b>\n<pre>") and text.endswith("</pre>"))
        self.assertTrue(TagBalance().balanced(text))
        self.assertIn("нет данных", missing)

    async def test_admin_logs_message_fits_telegram_and_parses(self):
        line = "x <y> & z " * 40
        with tempfile.TemporaryDirectory() as temp:
            for name in ("error.log", "bot.log"):
                (Path(temp) / name).write_text("\n".join([line] * 12), encoding="utf-8")
            query = NS(from_user=User(OWNER, "Owner", False), edit_message_text=AsyncMock(),
                       message=NS(chat=NS(type="private")))
            with patch.object(self.bot, "LOGS_DIR", Path(temp)):
                await self.bot.handle_admin_callback(query, NS(user_data={}), "logs")
        sent = query.edit_message_text.await_args.kwargs["text"]
        self.assertLessEqual(len(sent), 4096)
        self.assertTrue(TagBalance().balanced(sent))

    def test_server_details_are_owner_only(self):
        host = html.escape(socket.gethostname())
        public = self.bot.status_text(1)
        owner = self.bot.status_text(1, admin=True)
        self.assertNotIn(host, public)
        self.assertNotIn("Python", public)
        self.assertIn(host, owner)
        self.assertIn("Python", owner)


class LastPostButtonTests(BotCase):
    def setUp(self):
        super().setUp()
        self.query = NS(data="channel:last", answer=AsyncMock(),
                        message=NS(photo=False, chat=NS(type="private")),
                        edit_message_text=AsyncMock(), edit_message_caption=AsyncMock())
        self.update = NS(callback_query=self.query, effective_chat=NS(type="private"),
                         effective_user=User(10, "Alice", False))
        self.context = NS(user_data={}, bot_data={}, bot=NS(copy_message=AsyncMock()))

    async def test_missing_post_shows_a_single_alert(self):
        await self.bot.button(self.update, self.context)
        self.query.answer.assert_awaited_once_with("Последний пост пока не сохранён.", show_alert=True)

    async def test_success_answers_once_without_alert(self):
        self.bot.STATE["last_channel_post_id"] = 7
        await self.bot.button(self.update, self.context)
        self.context.bot.copy_message.assert_awaited_once()
        self.query.answer.assert_awaited_once_with()

    async def test_failure_shows_a_single_alert(self):
        self.bot.STATE["last_channel_post_id"] = 7
        self.context.bot.copy_message.side_effect = BadRequest("gone")
        await self.bot.button(self.update, self.context)
        self.query.answer.assert_awaited_once_with("Не получилось получить последний пост.", show_alert=True)

    async def test_other_buttons_are_still_answered_once(self):
        self.query.data = "home"
        await self.bot.button(self.update, self.context)
        self.query.answer.assert_awaited_once_with()

    async def test_maintenance_still_answers_the_query(self):
        self.bot.STATE["maintenance"] = True
        await self.bot.button(self.update, self.context)
        self.query.answer.assert_awaited_once_with()


class BroadcastTests(BotCase):
    def setUp(self):
        super().setUp()
        self.owner = User(OWNER, "Owner", False)
        self.bot.STATE["users"] = {"1": {}, "2": {}, "3": {}}
        self.app_data = {}
        self.context = NS(user_data={}, bot_data=self.app_data, args=[],
                          application=NS(bot_data=self.app_data),
                          bot=NS(send_message=AsyncMock()))

    def text_update(self, text):
        return NS(effective_user=self.owner, effective_chat=NS(type="private"),
                  message=NS(text=text, reply_text=AsyncMock()))

    def callback(self):
        return NS(from_user=self.owner, message=NS(chat=NS(type="private")),
                  edit_message_text=AsyncMock())

    async def start_confirmed(self, text="Привет <все>"):
        self.context.user_data["broadcast_pending"] = {"text": text, "time": time.time()}
        query = self.callback()
        await self.bot.handle_admin_callback(query, self.context, "broadcast_send")
        return query

    async def finish(self):
        await self.app_data["broadcast_task"]

    async def test_text_only_asks_for_confirmation(self):
        self.context.user_data["admin_action"] = "broadcast"
        update = self.text_update("Привет <все>")
        await self.bot.text_message(update, self.context)
        self.context.bot.send_message.assert_not_awaited()
        self.assertEqual(self.context.user_data["broadcast_pending"]["text"], "Привет <все>")
        markup = update.message.reply_text.await_args.kwargs["reply_markup"]
        data = [button.callback_data for row in markup.inline_keyboard for button in row]
        self.assertEqual(data, ["admin:broadcast_send", "admin:broadcast_cancel"])
        self.assertIn("Получателей: 3", update.message.reply_text.await_args.args[0])

    async def test_too_long_text_is_rejected_and_owner_can_retry(self):
        self.context.user_data["admin_action"] = "broadcast"
        update = self.text_update("<" * 1500)  # escapes to 6000 characters
        await self.bot.text_message(update, self.context)
        self.assertNotIn("broadcast_pending", self.context.user_data)
        self.assertEqual(self.context.user_data["admin_action"], "broadcast")
        self.assertIn("слишком длинный", update.message.reply_text.await_args.args[0])

    async def test_confirmed_broadcast_runs_in_background_and_reports(self):
        query = await self.start_confirmed()
        self.assertIn("Получателей: 3", query.edit_message_text.await_args.kwargs["text"])
        await self.finish()
        calls = self.context.bot.send_message.await_args_list
        self.assertEqual([c.kwargs["chat_id"] for c in calls], [1, 2, 3, OWNER])
        self.assertEqual(calls[0].kwargs["text"], "<b>Привет &lt;все&gt;</b>")
        self.assertIn("Доставлено: 3", calls[-1].kwargs["text"])

    async def test_flood_limit_is_waited_out_not_dropped(self):
        attempts = {"n": 0}

        async def flaky(**kwargs):
            if kwargs["chat_id"] == 1 and attempts["n"] == 0:
                attempts["n"] += 1
                raise RetryAfter(0)

        self.context.bot.send_message.side_effect = flaky
        await self.start_confirmed()
        await self.finish()
        self.assertIn("Доставлено: 3", self.context.bot.send_message.await_args.kwargs["text"])
        self.assertEqual(self.context.bot.send_message.await_count, 5)

    async def test_blocked_users_are_marked_and_state_saved(self):
        async def send(**kwargs):
            if kwargs["chat_id"] == 2:
                raise Forbidden("blocked")

        self.context.bot.send_message.side_effect = send
        await self.start_confirmed()
        await self.finish()
        self.assertTrue(self.bot.STATE["users"]["2"]["blocked"])
        self.save_mock.assert_awaited()
        self.assertIn("Ошибок: 1", self.context.bot.send_message.await_args.kwargs["text"])

    async def test_cancel_and_expired_confirmation_send_nothing(self):
        self.context.user_data["broadcast_pending"] = {"text": "x", "time": time.time()}
        await self.bot.handle_admin_callback(self.callback(), self.context, "broadcast_cancel")
        self.assertNotIn("broadcast_pending", self.context.user_data)
        self.context.user_data["broadcast_pending"] = {"text": "x", "time": time.time() - 3600}
        query = self.callback()
        await self.bot.handle_admin_callback(query, self.context, "broadcast_send")
        self.assertIn("устарело", query.edit_message_text.await_args.kwargs["text"])
        self.assertNotIn("broadcast_task", self.app_data)
        self.context.bot.send_message.assert_not_awaited()

    async def test_second_broadcast_waits_for_the_running_one(self):
        running = asyncio.create_task(asyncio.sleep(30))
        self.app_data["broadcast_task"] = running
        try:
            query = await self.start_confirmed()
            self.assertIn("ещё идёт", query.edit_message_text.await_args.kwargs["text"])
            self.assertIn("broadcast_pending", self.context.user_data)
            self.assertIs(self.app_data["broadcast_task"], running)
        finally:
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)

    async def test_send_with_flood_wait_gives_up_after_last_attempt(self):
        send = AsyncMock(side_effect=RetryAfter(0))
        with self.assertRaises(RetryAfter):
            await self.bot.send_with_flood_wait(send, attempts=2)
        self.assertEqual(send.await_count, 2)


class ChannelPostBackgroundTests(BotCase):
    async def test_subscribers_are_served_in_the_background(self):
        self.bot.STATE["channel_subscribers"] = {"11": True, "12": True}
        update = Update.de_json({"update_id": 1, "channel_post": {
            "message_id": 42, "date": NOW, "chat": {"id": SOURCE, "type": "channel",
            "username": "THKC_SQUAD", "title": "SQUAD"}, "text": "Пост"}}, None)
        data = {}
        context = NS(bot_data=data, application=NS(bot_data=data),
                     bot=NS(copy_message=AsyncMock()))
        await self.bot.channel_post(update, context)
        context.bot.copy_message.assert_not_awaited()  # the handler itself returned already
        await asyncio.gather(*data["distribution_tasks"])
        self.assertEqual(sorted(c.kwargs["chat_id"] for c in context.bot.copy_message.await_args_list), [11, 12])


class BlacklistBackoffTests(unittest.TestCase):
    def test_failed_retries_back_off(self):
        delays = []
        with patch("channel_blacklist.time.time", return_value=1000):
            for attempts in range(1, 9):
                record = {"attempts": attempts}
                ChannelBlacklist._fail(record, "error")
                delays.append(record["retry_at"] - 1000)
        self.assertEqual(delays, [300, 600, 1200, 2400, 4800, 9600, 19200, 19200])

    def test_explicit_delay_is_kept(self):
        record = {"attempts": 5}
        with patch("channel_blacklist.time.time", return_value=1000):
            ChannelBlacklist._fail(record, "error", status="pending", delay=15)
        self.assertEqual((record["status"], record["retry_at"]), ("pending", 1015))


class SetupTokenTests(unittest.TestCase):
    TOKEN = "123456:" + "A" * 30

    def test_other_variables_and_comments_survive(self):
        old = "# keep\nBLACKLIST_CHANNEL_ID=-100\nTELEGRAM_BOT_TOKEN=old\nXP_DISCUSSION_CHAT_ID=-5\n"
        new = setup_token.merged_env(old, self.TOKEN)
        self.assertEqual(new, f"# keep\nBLACKLIST_CHANNEL_ID=-100\nTELEGRAM_BOT_TOKEN={self.TOKEN}\nXP_DISCUSSION_CHAT_ID=-5\n")

    def test_token_is_appended_or_deduplicated(self):
        self.assertEqual(setup_token.merged_env("", self.TOKEN), f"TELEGRAM_BOT_TOKEN={self.TOKEN}\n")
        self.assertEqual(setup_token.merged_env("A=1", self.TOKEN), f"A=1\nTELEGRAM_BOT_TOKEN={self.TOKEN}\n")
        twice = setup_token.merged_env("TELEGRAM_BOT_TOKEN=a\nTELEGRAM_BOT_TOKEN=b\n", self.TOKEN)
        self.assertEqual(twice, f"TELEGRAM_BOT_TOKEN={self.TOKEN}\n")

    def test_write_token_keeps_file_and_leaves_no_temp(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / ".env"
            path.write_text("KEEP=1\n", encoding="utf-8")
            setup_token.write_token(self.TOKEN, path)
            self.assertEqual(path.read_text(encoding="utf-8"), f"KEEP=1\nTELEGRAM_BOT_TOKEN={self.TOKEN}\n")
            self.assertEqual([p.name for p in Path(temp).iterdir()], [".env"])


class XpChatCommandTests(BotCase):
    async def test_telegram_error_gets_a_reply(self):
        update = NS(effective_user=User(OWNER, "Owner", False),
                    effective_chat=NS(type="supergroup", id=-100123),
                    message=NS(reply_text=AsyncMock()))
        context = NS(args=[], bot_data={}, bot=NS(id=1, get_chat_member=AsyncMock(side_effect=NetworkError("down"))))
        with patch.dict(os.environ, {"XP_DISCUSSION_CHAT_ID": ""}):
            await self.bot.xp_chat_command(update, context)
        self.assertIn("Не удалось проверить", update.message.reply_text.await_args.args[0])
        self.assertIsNone(self.bot.STATE.get("xp_discussion_chat_id"))


if __name__ == "__main__":
    unittest.main()
