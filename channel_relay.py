"""Durable channel-to-group outbox sharing the activity database."""

import asyncio
import logging
import time

import httpx
from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.error import BadRequest, Forbidden, NetworkError, RetryAfter, TelegramError

LOGGER = logging.getLogger(__name__)


class ChannelRelay:
    def __init__(self, activity, *, clock=time.time):
        self.activity = activity
        self.db = activity.db
        self.clock = clock
        self.lock = asyncio.Lock()
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS relay_targets (
                chat_id INTEGER PRIMARY KEY, title TEXT NOT NULL,
                enabled INTEGER NOT NULL, enabled_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS relay_outbox (
                source_chat_id INTEGER NOT NULL, source_message_id INTEGER NOT NULL,
                target_chat_id INTEGER NOT NULL, post_url TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                retry_at REAL NOT NULL, error TEXT NOT NULL DEFAULT '', delivered_id INTEGER,
                PRIMARY KEY(source_chat_id, source_message_id, target_chat_id)
            );
            CREATE INDEX IF NOT EXISTS relay_due ON relay_outbox(status, retry_at);
        """)
        # A crash during an API call cannot prove whether Telegram accepted it.
        # Do not silently resend potentially delivered messages after restarting.
        with self.db:
            self.db.execute("""
                UPDATE relay_outbox SET status='uncertain',
                error='Отправка прервана перезапуском; результат неизвестен.'
                WHERE status='sending'
            """)

    def enabled(self, chat_id):
        row = self.db.execute("SELECT enabled FROM relay_targets WHERE chat_id=?", (chat_id,)).fetchone()
        return bool(row and row[0])

    def has_target(self, chat_id):
        return self.db.execute("SELECT 1 FROM relay_targets WHERE chat_id=?", (chat_id,)).fetchone() is not None

    def enable(self, chat_id, title):
        if chat_id >= 0:
            raise ValueError("Relay target must be a group")
        already = self.enabled(chat_id)
        with self.db:
            self.db.execute("""
                INSERT INTO relay_targets VALUES (?, ?, 1, ?)
                ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title, enabled=1,
                enabled_at=CASE WHEN relay_targets.enabled=1
                    THEN relay_targets.enabled_at ELSE excluded.enabled_at END
            """, (chat_id, str(title or chat_id)[:100], self.clock()))
        return not already

    def disable(self, chat_id):
        with self.db:
            self.db.execute("UPDATE relay_targets SET enabled=0 WHERE chat_id=?", (chat_id,))
            self.db.execute("""
                UPDATE relay_outbox SET status='cancelled', error='Рассылка отключена владельцем.'
                WHERE target_chat_id=? AND status IN ('pending','uncertain')
            """, (chat_id,))

    def enqueue(self, message, post_url):
        """Queue a new source message once per explicitly enabled destination."""
        targets = self.db.execute("SELECT * FROM relay_targets WHERE enabled=1").fetchall()
        queued = 0
        with self.db:
            for target in targets:
                # No surprise replay of posts created before /posts_on.
                if message.date.timestamp() < int(target["enabled_at"]):
                    continue
                cursor = self.db.execute("""
                    INSERT OR IGNORE INTO relay_outbox(
                        source_chat_id, source_message_id, target_chat_id, post_url, retry_at
                    ) VALUES (?, ?, ?, ?, ?)
                """, (message.chat_id, message.message_id, target["chat_id"], post_url, self.clock()))
                queued += cursor.rowcount
        return queued

    def status(self):
        rows = self.db.execute("SELECT * FROM relay_targets ORDER BY title, chat_id").fetchall()
        results = []
        for row in rows:
            target = dict(row)
            target["pending"] = self.db.execute("""
                SELECT COUNT(*) FROM relay_outbox WHERE target_chat_id=? AND status='pending'
            """, (row["chat_id"],)).fetchone()[0]
            target["uncertain"] = self.db.execute("""
                SELECT COUNT(*) FROM relay_outbox WHERE target_chat_id=? AND status='uncertain'
            """, (row["chat_id"],)).fetchone()[0]
            target["uncertain_ids"] = [item[0] for item in self.db.execute("""
                SELECT source_message_id FROM relay_outbox WHERE target_chat_id=?
                AND status='uncertain' ORDER BY source_message_id LIMIT 5
            """, (row["chat_id"],)).fetchall()]
            error = self.db.execute("""
                SELECT error FROM relay_outbox WHERE target_chat_id=? AND error!=''
                AND status IN ('pending','uncertain','failed')
                ORDER BY source_message_id DESC LIMIT 1
            """, (row["chat_id"],)).fetchone()
            target["error"] = error[0] if error else ""
            results.append(target)
        return results

    def retry_uncertain(self, chat_id, source_message_id=None):
        with self.db:
            cursor = self.db.execute("""
                UPDATE relay_outbox SET status='pending', retry_at=?, error=''
                WHERE target_chat_id=? AND status='uncertain'
                AND (? IS NULL OR source_message_id=?)
            """, (self.clock(), chat_id, source_message_id, source_message_id))
        return cursor.rowcount

    def _finish(self, row, status, *, error="", retry_delay=0, delivered_id=None):
        with self.db:
            self.db.execute("""
                UPDATE relay_outbox SET status=?, error=?, retry_at=?, delivered_id=?
                WHERE source_chat_id=? AND source_message_id=? AND target_chat_id=?
            """, (status, error, self.clock() + retry_delay, delivered_id,
                  row["source_chat_id"], row["source_message_id"], row["target_chat_id"]))
            if delivered_id is not None:
                # Outbox completion and XP root registration commit atomically.
                self.db.execute("INSERT OR IGNORE INTO messages VALUES (?, ?, ?, NULL)",
                                (row["target_chat_id"], delivered_id, delivered_id))

    async def deliver_next(self, bot):
        """One request at a time. Safe failures retry; ambiguous results stay visible."""
        async with self.lock:
            row = self.db.execute("""
                SELECT o.* FROM relay_outbox o JOIN relay_targets t
                ON t.chat_id=o.target_chat_id
                WHERE t.enabled=1 AND o.status='pending' AND o.retry_at<=?
                ORDER BY o.source_message_id, o.target_chat_id LIMIT 1
            """, (self.clock(),)).fetchone()
            if row is None:
                return False
            with self.db:
                claimed = self.db.execute("""
                    UPDATE relay_outbox SET status='sending', attempts=attempts+1
                    WHERE source_chat_id=? AND source_message_id=? AND target_chat_id=?
                    AND status='pending' AND retry_at<=?
                """, (row["source_chat_id"], row["source_message_id"], row["target_chat_id"], self.clock()))
                if claimed.rowcount != 1:
                    return False
            keyboard = InlineKeyboardMarkup([[
                InlineKeyboardButton("Открыть в канале", url=row["post_url"])
            ]])
            request_started = False
            try:
                source = await bot.get_chat(row["source_chat_id"])
                if getattr(source, "linked_chat_id", None) == row["target_chat_id"]:
                    # Telegram already posts here natively. Never add a second copy.
                    self._finish(row, "native")
                    return True
                request_started = True
                result = await bot.copy_message(
                    chat_id=row["target_chat_id"], from_chat_id=row["source_chat_id"],
                    message_id=row["source_message_id"], reply_markup=keyboard,
                )
                self._finish(row, "sent", delivered_id=result.message_id)
            except RetryAfter as exc:
                wait = exc.retry_after
                seconds = wait.total_seconds() if hasattr(wait, "total_seconds") else float(wait)
                self._finish(row, "pending", error="Лимит Telegram; запланирован повтор.",
                             retry_delay=seconds + 1)
            except Forbidden:
                self._finish(row, "pending", error="Нет доступа к отправке; проверь права Фини в чате и канале.",
                             retry_delay=60)
            except BadRequest as exc:
                if any(value in str(exc).lower() for value in (
                    "not enough rights", "have no rights", "chat not found", "bot is not a member",
                )):
                    self._finish(row, "pending", error="Недостаточно прав или чат недоступен; запланирован повтор.",
                                 retry_delay=60)
                else:
                    self._finish(row, "failed", error="Telegram отклонил копирование поста. Проверь доступность сообщения и права бота.")
            except NetworkError as exc:
                safe = not request_started or isinstance(exc.__cause__, (
                    httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout,
                ))
                if safe:
                    self._finish(row, "pending", error="Не удалось соединиться с Telegram; запланирован повтор.",
                                 retry_delay=min(300, 15 * 2 ** min(row["attempts"], 5)))
                else:
                    self._finish(row, "uncertain", error="Обрыв связи: результат неизвестен. Проверь чат перед ручным повтором.")
            except TelegramError:
                self._finish(row, "uncertain", error="Неизвестный результат Telegram. Проверь чат перед ручным повтором.")
            except asyncio.CancelledError:
                self._finish(row, "uncertain", error="Отправка прервана; проверь чат перед ручным повтором.")
                raise
            except Exception:
                self._finish(row, "uncertain", error="Не удалось подтвердить результат отправки.")
                LOGGER.exception("Relay delivery could not be confirmed")
            return True
