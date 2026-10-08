"""The /export payload carries state.json and every xp.sqlite3 table."""
import importlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

from activity_xp import ActivityXP
from channel_relay import ChannelRelay

OWNER = 7221285861


class ExportTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123456789:offline-test-token"}):
            cls.bot = importlib.import_module("bot")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.activity = ActivityXP(Path(self.tmp.name) / "xp.sqlite3")
        ChannelRelay(self.activity)
        self.activity.ensure_profile(42, "Участник", "member")
        self.activity.db.execute("UPDATE profiles SET xp=150 WHERE user_id=42")
        self.activity.db.commit()

    def tearDown(self):
        self.activity.close()
        self.tmp.cleanup()

    def test_payload_has_state_and_tables(self):
        payload = self.bot.export_payload(self.activity.db)
        self.assertEqual(payload["format"], "finya-export")
        self.assertIs(payload["state"], self.bot.STATE)
        self.assertEqual(set(payload["tables"]), set(self.bot.EXPORT_TABLES))
        self.assertEqual(payload["tables"]["profiles"][0]["xp"], 150)
        json.dumps(payload, ensure_ascii=False)

    async def test_command_is_owner_private_only(self):
        message = NS(reply_document=AsyncMock(), reply_text=AsyncMock())
        context = NS(bot_data={"activity_xp": self.activity})
        stranger = NS(effective_user=NS(id=1), effective_chat=NS(type="private"), message=message)
        await self.bot.export_command(stranger, context)
        message.reply_document.assert_not_called()
        group = NS(effective_user=NS(id=OWNER), effective_chat=NS(type="supergroup"), message=message)
        await self.bot.export_command(group, context)
        message.reply_document.assert_not_called()
        owner = NS(effective_user=NS(id=OWNER), effective_chat=NS(type="private"), message=message)
        await self.bot.export_command(owner, context)
        document = message.reply_document.call_args.kwargs["document"]
        self.assertTrue(document.filename.startswith("finya-export-"))
        self.assertEqual(json.loads(document.input_file_content)["tables"]["profiles"][0]["user_id"], 42)


if __name__ == "__main__":
    unittest.main()
