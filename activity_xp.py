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
MAX_XP = 1_000_000_000
_SQLITE_INT_MAX = 9_223_372_036_854_775_807
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


def rank_for(xp, *, founder=False, manual_rank=None):
    if founder:
        return (None, "X", "Основатель SQUAD"), None
    if manual_rank is not None:
        for rank in RANKS:
            if rank[1] == manual_rank:
                return rank, None
        raise ValueError("Manual rank must be I–IX")
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
        # Existing ledgers keep their XP, event deduplication and message links.
        # A manual title is separate from earned XP and can be removed safely.
        with self.db:
            columns = {row["name"] for row in self.db.execute("PRAGMA table_info(profiles)")}
            if "manual_rank" not in columns:
                self.db.execute("""
                    ALTER TABLE profiles ADD COLUMN manual_rank TEXT
                    CHECK(manual_rank IS NULL OR manual_rank IN
                          ('I','II','III','IV','V','VI','VII','VIII','IX'))
                """)
            self.db.execute("""
                CREATE TABLE IF NOT EXISTS admin_changes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    actor_id INTEGER NOT NULL,
                    operation_id TEXT NOT NULL UNIQUE,
                    action TEXT NOT NULL,
                    request_value TEXT NOT NULL,
                    before_xp INTEGER NOT NULL,
                    after_xp INTEGER NOT NULL,
                    before_rank TEXT,
                    after_rank TEXT,
                    created_at INTEGER NOT NULL
                )
            """)
            self.db.execute("""
                CREATE INDEX IF NOT EXISTS admin_changes_by_user
                ON admin_changes(user_id, id DESC)
            """)

    def close(self):
        self.db.close()

    def _profile(self, user):
        self._validate_int(user.id, "user_id", minimum=1)
        self.db.execute("""
            INSERT INTO profiles(user_id, name, username) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,
                username=excluded.username
        """, (user.id, str(user.full_name)[:100], str(user.username or "")[:40]))

    def profile(self, user):
        with self.db:
            self._profile(user)
        return self.get_profile(user.id)

    @staticmethod
    def _validate_int(value, label, *, minimum=0, maximum=_SQLITE_INT_MAX):
        if type(value) is not int or not minimum <= value <= maximum:
            raise ValueError(f"{label} must be an integer between {minimum} and {maximum}")
        return value

    def _profile_dict(self, row):
        if row is None:
            return None
        row = dict(row)
        now = int(self.clock())
        row["today"] = self._points(row["user_id"], day_start(now), now + 1)
        row["week"] = self._points(row["user_id"], week_start(now), now + 1)
        return row

    def get_profile(self, user_id):
        self._validate_int(user_id, "user_id", minimum=1)
        return self._profile_dict(self.db.execute(
            "SELECT * FROM profiles WHERE user_id=?", (user_id,)
        ).fetchone())

    def ensure_profile(self, user_id, name, username):
        self._validate_int(user_id, "user_id", minimum=1)
        if not isinstance(name, str) or not isinstance(username, str):
            raise ValueError("Name and username must be text")
        name = name.strip()[:100] or str(user_id)
        username = username.strip().lstrip("@")[:40]
        with self.db:
            self.db.execute("""
                INSERT INTO profiles(user_id, name, username) VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,
                    username=excluded.username
            """, (user_id, name, username))
        return self.get_profile(user_id)

    def list_profiles(self, limit=6, offset=0):
        self._validate_int(limit, "limit", minimum=1, maximum=100)
        self._validate_int(offset, "offset")
        rows = self.db.execute("""
            SELECT * FROM profiles ORDER BY name COLLATE NOCASE, user_id
            LIMIT ? OFFSET ?
        """, (limit, offset)).fetchall()
        return [self._profile_dict(row) for row in rows]

    def profile_count(self):
        return self.db.execute("SELECT COUNT(*) FROM profiles").fetchone()[0]

    def find_profiles(self, username):
        if not isinstance(username, str):
            raise ValueError("Username must be text")
        username = username.strip().lstrip("@").casefold()
        if not username or len(username) > 40:
            raise ValueError("Username must contain 1–40 characters")
        rows = self.db.execute("""
            SELECT * FROM profiles WHERE lower(username)=? ORDER BY user_id
        """, (username,)).fetchall()
        return [self._profile_dict(row) for row in rows]

    @staticmethod
    def _audit_dict(row):
        result = dict(row)
        result.pop("request_value", None)
        return result

    def admin_history(self, user_id, limit=5):
        self._validate_int(user_id, "user_id", minimum=1)
        self._validate_int(limit, "limit", minimum=1, maximum=100)
        return [self._audit_dict(row) for row in self.db.execute("""
            SELECT * FROM admin_changes WHERE user_id=? ORDER BY id DESC LIMIT ?
        """, (user_id, limit))]

    def _admin_change(self, user_id, value, *, actor_id, owner_id, operation_id, action):
        for label, identity in (("user_id", user_id), ("actor_id", actor_id),
                                ("owner_id", owner_id)):
            self._validate_int(identity, label, minimum=1)
        if actor_id != owner_id:
            raise PermissionError("Only the owner may manage ranks and XP")
        if user_id == owner_id:
            raise PermissionError("The founder's profile is protected")
        if (not isinstance(operation_id, str) or not operation_id.strip()
                or len(operation_id) > 100):
            raise ValueError("Operation ID must contain 1–100 characters")
        request_value = str(value) if action == "adjust_xp" else (value or "auto")
        with self.db:
            # Lock before reading so concurrent writers cannot overwrite an award
            # or apply the same administrative operation a second time.
            self.db.execute("BEGIN IMMEDIATE")
            previous = self.db.execute(
                "SELECT * FROM admin_changes WHERE operation_id=?", (operation_id,)
            ).fetchone()
            if previous:
                if (previous["user_id"] != user_id or previous["actor_id"] != actor_id
                        or previous["action"] != action
                        or previous["request_value"] != request_value):
                    raise ValueError("Operation ID was already used for a different change")
                return {"profile": self.get_profile(user_id),
                        "change": self._audit_dict(previous), "applied": False}
            profile = self.get_profile(user_id)
            if profile is None:
                raise LookupError("Participant not found")
            before_xp, before_rank = profile["xp"], profile["manual_rank"]
            after_xp, after_rank = before_xp, before_rank
            if action == "adjust_xp":
                after_xp = max(0, before_xp + value)
                self._validate_int(after_xp, "XP", maximum=MAX_XP)
            else:
                after_rank = value
            self.db.execute("""
                UPDATE profiles SET xp=?, manual_rank=? WHERE user_id=?
            """, (after_xp, after_rank, user_id))
            cursor = self.db.execute("""
                INSERT INTO admin_changes
                    (user_id, actor_id, operation_id, action, request_value,
                     before_xp, after_xp, before_rank, after_rank, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user_id, actor_id, operation_id, action, request_value,
                  before_xp, after_xp, before_rank, after_rank, int(self.clock())))
            change = self.db.execute(
                "SELECT * FROM admin_changes WHERE id=?", (cursor.lastrowid,)
            ).fetchone()
            return {"profile": self.get_profile(user_id),
                    "change": self._audit_dict(change), "applied": True}

    def adjust_xp(self, user_id, delta, *, actor_id, owner_id, operation_id):
        self._validate_int(delta, "XP adjustment", minimum=-MAX_XP, maximum=MAX_XP)
        return self._admin_change(user_id, delta, actor_id=actor_id, owner_id=owner_id,
                                  operation_id=operation_id, action="adjust_xp")

    def set_manual_rank(self, user_id, roman_or_None, *, actor_id, owner_id, operation_id):
        if (roman_or_None is not None
                and (not isinstance(roman_or_None, str)
                     or roman_or_None not in {rank[1] for rank in RANKS})):
            raise ValueError("Manual rank must be I–IX or None")
        return self._admin_change(user_id, roman_or_None, actor_id=actor_id,
                                  owner_id=owner_id, operation_id=operation_id,
                                  action="set_manual_rank")

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
            row = self.db.execute("SELECT xp, manual_rank FROM profiles WHERE user_id=?", (user.id,)).fetchone()
            total, manual_rank = row["xp"], row["manual_rank"]
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
            if total + points > MAX_XP:
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
        return Award(points, total + points,
                     rank_for(total, manual_rank=manual_rank)[0],
                     rank_for(total + points, manual_rank=manual_rank)[0])

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
