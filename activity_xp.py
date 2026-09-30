"""Persistent activity ledger. No Telegram calls or message text are stored."""

import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

MOSCOW = timezone(timedelta(hours=3))
COMMENT_XP = 5
REACTION_XP = 1
DAILY_XP_LIMIT = 100
DAILY_REACTION_LIMIT = 20
COMMENT_COOLDOWN = 60
# X is the founder's title, never an automatic promotion for other members.
RANKS = (
    (0, "I", "Искра"),
    (100, "II", "Звено"),
    (300, "III", "Клинок"),
    (500, "IV", "Страж Круга"),
    (1000, "V", "Вестник Свободы"),
    (3000, "VI", "Командор Алой Звезды"),
    (4000, "VII", "Маршал Свободы"),
    (5000, "VIII", "Архонт Круга"),
    (10000, "IX", "Верховный Архонт"),
)


def rank_for(xp, *, founder=False):
    if founder:
        return (None, "X", "Основатель SQUAD"), None
    index = max(i for i, rank in enumerate(RANKS) if xp >= rank[0])
    return RANKS[index], RANKS[index + 1] if index + 1 < len(RANKS) else None


def day_start(timestamp):
    local = datetime.fromtimestamp(timestamp, MOSCOW)
    return int(local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def week_start(timestamp):
    local = datetime.fromtimestamp(day_start(timestamp), MOSCOW)
    return int((local - timedelta(days=local.weekday())).timestamp())


@dataclass(frozen=True)
class Award:
    points: int
    total: int
    old_rank: tuple
    new_rank: tuple

    @property
    def promoted(self):
        return self.old_rank != self.new_rank


class ActivityXP:
    def __init__(self, path, *, clock=time.time):
        self.clock = clock
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS profiles (
                user_id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                username TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS events (
                user_id INTEGER NOT NULL, chat_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL, kind TEXT NOT NULL,
                points INTEGER NOT NULL, earned_at INTEGER NOT NULL,
                PRIMARY KEY(user_id, chat_id, message_id, kind)
            );
            CREATE INDEX IF NOT EXISTS events_by_time ON events(earned_at, user_id);
            CREATE INDEX IF NOT EXISTS events_by_user ON events(user_id, kind, earned_at);
            CREATE TABLE IF NOT EXISTS messages (
                chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
                root_id INTEGER NOT NULL, author_id INTEGER,
                PRIMARY KEY(chat_id, message_id)
            );
        """)

    def close(self):
        self.db.close()

    def _profile(self, user):
        self.db.execute("""
            INSERT INTO profiles(user_id, name, username) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,
                username=excluded.username
        """, (user.id, str(user.full_name)[:100], str(user.username or "")[:40]))

    def profile(self, user):
        with self.db:
            self._profile(user)
        row = dict(self.db.execute("SELECT * FROM profiles WHERE user_id=?", (user.id,)).fetchone())
        now = int(self.clock())
        row["today"] = self._points(user.id, day_start(now), now + 1)
        row["week"] = self._points(user.id, week_start(now), now + 1)
        return row

    def _points(self, user_id, start, end):
        return self.db.execute(
            "SELECT COALESCE(SUM(points),0) FROM events WHERE user_id=? AND earned_at>=? AND earned_at<?",
            (user_id, start, end),
        ).fetchone()[0]

    def leaderboard(self, *, weekly=False, limit=10):
        if weekly:
            now = int(self.clock())
            rows = self.db.execute("""
                SELECT p.*, SUM(e.points) AS score FROM profiles p JOIN events e USING(user_id)
                WHERE e.earned_at>=? AND e.earned_at<=?
                GROUP BY p.user_id HAVING score>0 ORDER BY score DESC, p.user_id LIMIT ?
            """, (week_start(now), now, limit))
        else:
            rows = self.db.execute("""
                SELECT *, xp AS score FROM profiles WHERE xp>0
                ORDER BY score DESC, user_id LIMIT ?
            """, (limit,))
        return [dict(row) for row in rows]

    def message_record(self, chat_id, message_id):
        return self.db.execute(
            "SELECT * FROM messages WHERE chat_id=? AND message_id=?", (chat_id, message_id)
        ).fetchone()

    @staticmethod
    def is_channel_root(message, channel_id):
        origin = getattr(message, "forward_origin", None)
        return bool(
            getattr(message, "is_automatic_forward", False)
            and getattr(origin, "type", None) == "channel"
            and getattr(getattr(origin, "chat", None), "id", None) == channel_id
        )

    def remember_message(self, message, channel_id):
        """Only map comments belonging to an actual SQUAD discussion thread."""
        chat_id, message_id = message.chat.id, message.message_id
        if self.is_channel_root(message, channel_id):
            root_id = message_id
        else:
            root_id = None
            known = self.message_record(chat_id, message_id)
            if known:
                root_id = known["root_id"]
            reply = getattr(message, "reply_to_message", None)
            if reply:
                if self.is_channel_root(reply, channel_id):
                    self.remember_message(reply, channel_id)
                    root_id = reply.message_id
                else:
                    parent = self.message_record(chat_id, reply.message_id)
                    if parent:
                        root_id = parent["root_id"]
            if not root_id:
                thread_id = getattr(message, "message_thread_id", None)
                thread = self.message_record(chat_id, thread_id) if thread_id else None
                if thread:
                    root_id = thread["root_id"]
            if not root_id:
                return None
        user = getattr(message, "from_user", None)
        author_id = (user.id if user and not getattr(message, "sender_chat", None)
                     and not self.is_channel_root(message, channel_id) else None)
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO messages VALUES (?, ?, ?, ?)",
                (chat_id, message_id, root_id, author_id),
            )
        return root_id

    def award(self, user, chat_id, message_id, kind, timestamp):
        """One decision per action, including denied attempts, in one transaction."""
        if kind not in {"comment", "reaction"} or user is None or user.is_bot:
            return None
        now = int(self.clock())
        timestamp = int(timestamp)
        # Telegram keeps queued updates for up to 24 hours; reject invalid dates.
        if timestamp > now + 60 or timestamp < now - 86400:
            return None
        with self.db:
            self._profile(user)
            # SQLite also serializes concurrent writers across separate processes.
            row = self.db.execute("SELECT xp FROM profiles WHERE user_id=?", (user.id,)).fetchone()
            total = row[0]
            if self.db.execute("""
                SELECT 1 FROM events WHERE user_id=? AND chat_id=? AND message_id=? AND kind=?
            """, (user.id, chat_id, message_id, kind)).fetchone():
                return None
            start = day_start(timestamp)
            end = start + 86400
            points = COMMENT_XP if kind == "comment" else REACTION_XP
            today = self._points(user.id, start, end)
            if today + points > DAILY_XP_LIMIT:
                points = 0
            if kind == "reaction":
                count = self.db.execute("""
                    SELECT COUNT(*) FROM events WHERE user_id=? AND kind='reaction'
                    AND points>0 AND earned_at>=? AND earned_at<?
                """, (user.id, start, end)).fetchone()[0]
                if count >= DAILY_REACTION_LIMIT:
                    points = 0
            else:
                latest = self.db.execute("""
                    SELECT MAX(earned_at) FROM events WHERE user_id=? AND kind='comment' AND points>0
                """, (user.id,)).fetchone()[0]
                if latest is not None and timestamp - latest < COMMENT_COOLDOWN:
                    points = 0
            self.db.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)",
                            (user.id, chat_id, message_id, kind, points, timestamp))
            if not points:
                return None
            self.db.execute("UPDATE profiles SET xp=xp+? WHERE user_id=?", (points, user.id))
        return Award(points, total + points, rank_for(total)[0], rank_for(total + points)[0])

    def comment(self, message, channel_id):
        root_id = self.remember_message(message, channel_id)
        if not root_id or self.is_channel_root(message, channel_id):
            return None
        if getattr(message, "sender_chat", None) or getattr(message, "forward_origin", None):
            return None
        # At least five letters/digits: commands, stickers and emoji spam earn nothing.
        text = (getattr(message, "text", None) or getattr(message, "caption", None) or "").strip()
        if text.startswith("/") or sum(char.isalnum() for char in text) < 5:
            return None
        return self.award(message.from_user, message.chat.id, message.message_id,
                          "comment", message.date.timestamp())

    def reaction(self, event):
        user = event.user
        if user is None or getattr(event, "actor_chat", None) or not event.new_reaction:
            return None
        # Changing an existing emoji doesn't constitute a new reaction.
        if event.old_reaction:
            return None
        message = self.message_record(event.chat.id, event.message_id)
        if not message or message["author_id"] == user.id:
            return None
        return self.award(user, event.chat.id, event.message_id, "reaction", event.date.timestamp())
