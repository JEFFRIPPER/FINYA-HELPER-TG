"""Persist and enforce bans for subscribers who leave the protected channel."""

import asyncio
import time
from datetime import timedelta

from telegram import Chat
from telegram.error import BadRequest, Forbidden, NetworkError, RetryAfter, TelegramError


class ChannelBlacklist:
    """Handle voluntary exits without sending messages to subscribers or channels."""

    def __init__(self, state, save_state, is_target_channel, owner_user_id):
        self.state = state
        self.save_state = save_state
        self.is_target_channel = is_target_channel
        self.owner_user_id = owner_user_id
        self.state.setdefault("channel_blacklist", {})
        self._locks = {}
        self._loop = None

    def _lock(self, key):
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            # The Windows runner can restart the application with a fresh loop
            # while retaining the imported module and this engine instance.
            self._locks = {}
            self._loop = loop
        return self._locks.setdefault(key, asyncio.Lock())

    async def handle_update(self, update, context):
        event = update.chat_member
        if event is None or event.chat.type != "channel":
            return
        if not self.is_target_channel(event.chat):
            return

        old_member, new_member = event.old_chat_member, event.new_chat_member
        user = new_member.user
        if (
            old_member.status != "member"
            or new_member.status != "left"
            or old_member.user.id != user.id
            or event.from_user.id != user.id
            or user.id == self.owner_user_id
            or user.is_bot
        ):
            return

        key = f"{event.chat.id}:{user.id}"
        left_at = event.date.timestamp()
        async with self._lock(key):
            records = self.state["channel_blacklist"]
            previous = records.get(key)
            if previous and previous.get("left_at", 0) >= left_at:
                return
            records[key] = {
                "chat_id": event.chat.id,
                "channel_title": event.chat.title or event.chat.username or str(event.chat.id),
                "user_id": user.id,
                "username": user.username or "",
                "full_name": user.full_name,
                "left_at": left_at,
                "status": "pending",
                "last_error": "",
                "retry_at": 0,
                "attempts": 0,
            }
            await self._attempt(records[key], context.bot)

    async def retry_pending(self, bot):
        """Resume unfinished requests, including records loaded after a restart."""
        for key in list(self.state["channel_blacklist"]):
            async with self._lock(key):
                record = self.state["channel_blacklist"].get(key)
                if (
                    not record
                    or record.get("status") not in {"pending", "failed"}
                    or record.get("retry_at", 0) > time.time()
                ):
                    continue
                if not self.is_target_channel(Chat(id=record["chat_id"], type="channel")):
                    continue
                await self._attempt(record, bot)

    async def _attempt(self, record, bot):
        # Persist the intent before either Telegram request. If saving fails,
        # propagate the error and do not change channel membership.
        record["status"] = "pending"
        record["attempts"] = record.get("attempts", 0) + 1
        await self.save_state()

        try:
            if record["user_id"] == self.owner_user_id:
                self._fail(record, "Владелец бота исключён из автоматической блокировки.")
            else:
                member = await bot.get_chat_member(
                    chat_id=record["chat_id"], user_id=record["user_id"]
                )
                if member.status in {"administrator", "creator"} or member.user.is_bot:
                    self._fail(record, "Администраторы канала и боты исключены из блокировки.")
                elif (member.status == "kicked" and
                      getattr(member, "until_date", None) is not None and
                      member.until_date.timestamp() == 0):
                    self._success(record)
                else:
                    result = await bot.ban_chat_member(
                        chat_id=record["chat_id"], user_id=record["user_id"]
                    )
                    if result:
                        self._success(record)
                    else:
                        self._fail(record, "Telegram не подтвердил блокировку.")
        except RetryAfter as exc:
            seconds = exc.retry_after
            if isinstance(seconds, timedelta):
                seconds = seconds.total_seconds()
            self._fail(record, "Лимит запросов Telegram; повтор после указанной паузы.",
                       status="pending", delay=max(1, seconds) + 1)
        except Forbidden:
            self._fail(record, "Telegram отказал в доступе. Проверьте права бота в канале.")
        except BadRequest:
            self._fail(record, "Telegram отклонил запрос. Проверьте канал, пользователя и права бота.")
        except NetworkError:
            delay = min(300, 15 * 2 ** min(record["attempts"] - 1, 5))
            self._fail(record, "Ошибка соединения с Telegram; будет выполнен повтор.",
                       status="pending", delay=delay)
        except TelegramError:
            self._fail(record, "Ошибка Telegram; будет выполнен повтор.")

        await self.save_state()

    @staticmethod
    def _success(record):
        record["status"] = "banned"
        record["last_error"] = ""
        record["retry_at"] = 0

    @staticmethod
    def _fail(record, error, *, status="failed", delay=None):
        if delay is None:
            # Back off from 5 minutes to about 5 hours so a lasting failure (for
            # example missing admin rights) does not hit Telegram and rewrite
            # the state file every five minutes forever.
            attempts = max(1, record.get("attempts", 1))
            delay = 300 * 2 ** min(attempts - 1, 6)
        record["status"] = status
        record["last_error"] = error[:500]
        record["retry_at"] = time.time() + delay
