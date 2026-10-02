"""Persistent owner rank controls; all databases are disposable and offline."""

import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS

from activity_xp import ActivityXP, MAX_XP, RANKS, rank_for

OWNER = 7221285861
MEMBER = 101
NOW = int(datetime(2026, 10, 3, 12, tzinfo=timezone.utc).timestamp())


class RankAdminStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "xp.sqlite3"
        self.now = NOW
        self.store = ActivityXP(self.path, clock=lambda: self.now)
        self.actor = NS(id=MEMBER, full_name="Alice", username="alice", is_bot=False)
        self.store.ensure_profile(MEMBER, "Alice", "alice")
        self.options = {"actor_id": OWNER, "owner_id": OWNER}

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def adjust(self, delta, operation="adjust", user_id=MEMBER, **options):
        return self.store.adjust_xp(user_id, delta, operation_id=operation,
                                    **{**self.options, **options})

    def rank(self, value, operation="rank", user_id=MEMBER, **options):
        return self.store.set_manual_rank(user_id, value, operation_id=operation,
                                          **{**self.options, **options})

    def reopen(self):
        self.store.close()
        self.store = ActivityXP(self.path, clock=lambda: self.now)

    def test_migration_preserves_legacy_xp_events_and_message_dedup(self):
        self.store.close()
        legacy = sqlite3.connect(self.path)
        legacy.executescript("""
            DROP TABLE admin_changes;
            ALTER TABLE profiles DROP COLUMN manual_rank;
            UPDATE profiles SET xp=350 WHERE user_id=101;
            INSERT INTO events VALUES(101,-100555,2,'comment',5,1791028800);
            INSERT INTO messages VALUES(-100555,2,1,101);
        """)
        legacy.close()
        self.store = ActivityXP(self.path, clock=lambda: self.now)
        profile = self.store.get_profile(MEMBER)
        self.assertEqual(profile["xp"], 350)
        self.assertIsNone(profile["manual_rank"])
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)
        self.assertEqual(self.store.message_record(-100555, 2)["root_id"], 1)
        self.assertIsNone(self.store.award(self.actor, -100555, 2, "comment", self.now))
        self.assertEqual(self.store.get_profile(MEMBER)["xp"], 350)

    def test_rank_assignment_and_removal_preserve_earned_xp_across_restart(self):
        self.adjust(14000)
        assigned = self.rank("III")
        self.assertEqual(assigned["profile"]["xp"], 14000)
        self.assertEqual(rank_for(14000, manual_rank="III")[0], RANKS[2])
        self.assertIsNone(rank_for(14000, manual_rank="III")[1])
        self.reopen()
        self.assertEqual(self.store.get_profile(MEMBER)["manual_rank"], "III")
        removed = self.rank(None, "restore")
        self.assertEqual(removed["profile"]["xp"], 14000)
        self.assertEqual(rank_for(14000, manual_rank=removed["profile"]["manual_rank"])[0][1], "IX")

    def test_owner_authorization_and_founder_protection(self):
        self.store.ensure_profile(OWNER, "Founder", "creator")
        for mutate, value in ((self.adjust, 10), (self.rank, "IX")):
            with self.assertRaises(PermissionError):
                mutate(value, actor_id=999)
            with self.assertRaises(PermissionError):
                mutate(value, user_id=OWNER)
        self.assertEqual(self.store.get_profile(OWNER)["xp"], 0)
        self.assertEqual(self.store.admin_history(OWNER), [])
        self.assertEqual(rank_for(0, founder=True, manual_rank="IX")[0][1], "X")

    def test_rank_x_and_invalid_types_rejected_without_changes(self):
        for rank in ("X", "10", "unknown", 9, True, [], ""):
            with self.subTest(rank=rank), self.assertRaises(ValueError):
                self.rank(rank)
        self.assertEqual(self.store.admin_history(MEMBER), [])
        self.assertIsNone(self.store.get_profile(MEMBER)["manual_rank"])

    def test_invalid_ids_amounts_and_pagination_rejected_before_sql(self):
        for value in (True, 1.0, "101", 0, -1, 2 ** 63):
            with self.subTest(user_id=value), self.assertRaises(ValueError):
                self.store.get_profile(value)
        for value in (True, "5", 0.5, MAX_XP + 1, -MAX_XP - 1, 2 ** 64):
            with self.subTest(delta=value), self.assertRaises(ValueError):
                self.adjust(value)
        for limit, offset in ((True, 0), (0, 0), (101, 0), (6, -1), (6, 2 ** 63)):
            with self.subTest(limit=limit, offset=offset), self.assertRaises(ValueError):
                self.store.list_profiles(limit, offset)
        self.assertEqual(self.store.get_profile(MEMBER)["xp"], 0)

    def test_adjustment_clamps_at_zero_and_audits_actual_before_after(self):
        self.adjust(20)
        result = self.adjust(-100, "subtract")
        self.assertEqual(result["profile"]["xp"], 0)
        self.assertEqual(result["change"]["before_xp"], 20)
        self.assertEqual(result["change"]["after_xp"], 0)
        self.assertEqual(result["change"]["actor_id"], OWNER)
        self.assertEqual(result["change"]["action"], "adjust_xp")
        self.assertEqual(result["change"]["created_at"], NOW)
        self.assertIs(type(result["change"]["id"]), int)
        self.assertNotIn("request_value", result["change"])

    def test_manual_xp_does_not_change_activity_totals_or_daily_limits(self):
        self.store.award(self.actor, -100555, 1, "comment", self.now)
        self.adjust(15000)
        profile = self.store.get_profile(MEMBER)
        self.assertEqual((profile["xp"], profile["today"], profile["week"]), (15005, 5, 5))
        self.assertEqual(self.store.leaderboard(weekly=True)[0]["score"], 5)
        self.now += 60
        award = self.store.award(self.actor, -100555, 2, "comment", self.now)
        self.assertEqual(award.points, 5)
        self.assertEqual(award.total, 15010)

    def test_manual_rank_suppresses_bogus_automatic_promotion(self):
        self.adjust(95)
        self.rank("V")
        award = self.store.award(self.actor, -100555, 1, "comment", self.now)
        self.assertEqual(award.total, 100)
        self.assertFalse(award.promoted)
        self.assertEqual(award.old_rank[1], "V")
        self.assertEqual(award.new_rank[1], "V")
        self.rank(None, "automatic")
        self.assertEqual(rank_for(self.store.get_profile(MEMBER)["xp"])[0][1], "II")

    def test_event_cooldown_dedup_and_daily_limits_survive_admin_changes(self):
        for message_id in range(20):
            self.assertEqual(self.store.award(self.actor, -100555, message_id, "comment", self.now).points, 5)
            self.now += 60
        self.adjust(-100)
        self.rank("VIII")
        self.reopen()
        self.assertIsNone(self.store.award(self.actor, -100555, 21, "comment", self.now))
        self.assertIsNone(self.store.award(self.actor, -100555, 1, "comment", self.now))
        self.assertEqual(self.store.get_profile(MEMBER)["today"], 100)
        self.assertEqual(self.store.get_profile(MEMBER)["xp"], 0)
        self.now += 86400
        self.assertEqual(self.store.award(self.actor, -100555, 22, "comment", self.now).points, 5)

    def test_cap_rejects_manual_overflow_and_organic_awards_stay_integer(self):
        self.adjust(MAX_XP - 5)
        award = self.store.award(self.actor, -100555, 1, "comment", self.now)
        self.assertEqual(award.total, MAX_XP)
        self.now += 60
        self.assertIsNone(self.store.award(self.actor, -100555, 2, "comment", self.now))
        with self.assertRaises(ValueError):
            self.adjust(1, "overflow")
        self.assertEqual(self.store.get_profile(MEMBER)["xp"], MAX_XP)
        self.assertEqual(self.store.db.execute("SELECT typeof(xp) FROM profiles WHERE user_id=?", (MEMBER,)).fetchone()[0], "integer")

    def test_idempotent_replays_after_restart_and_after_later_changes(self):
        first = self.adjust(100)
        self.assertTrue(first["applied"])
        self.reopen()
        replay = self.adjust(100)
        self.assertFalse(replay["applied"])
        self.assertEqual(replay["change"], first["change"])
        self.rank("IX")
        replay = self.adjust(100)
        self.assertEqual(replay["profile"]["xp"], 100)
        self.assertEqual(replay["profile"]["manual_rank"], "IX")
        self.assertEqual(len(self.store.admin_history(MEMBER)), 2)
        self.assertFalse(self.rank("IX")["applied"])

    def test_operation_reuse_with_different_target_value_or_action_rejected(self):
        self.store.ensure_profile(102, "Bob", "bob")
        self.adjust(100)
        with self.assertRaises(ValueError):
            self.adjust(200)
        with self.assertRaises(ValueError):
            self.adjust(100, user_id=102)
        with self.assertRaises(ValueError):
            self.rank("II", "adjust")
        self.assertEqual(self.store.get_profile(MEMBER)["xp"], 100)
        self.assertEqual(self.store.get_profile(102)["xp"], 0)
        self.assertEqual(len(self.store.admin_history(MEMBER)), 1)

    def test_concurrent_database_connections_apply_same_operation_once(self):
        ready = threading.Barrier(2)

        def apply_from_separate_connection():
            store = ActivityXP(self.path, clock=lambda: NOW)
            try:
                ready.wait(timeout=5)
                return store.adjust_xp(MEMBER, 100, operation_id="concurrent",
                                       actor_id=OWNER, owner_id=OWNER)
            finally:
                store.close()

        with ThreadPoolExecutor(max_workers=2) as workers:
            futures = [workers.submit(apply_from_separate_connection) for _ in range(2)]
            results = [future.result(timeout=10) for future in futures]
        self.assertEqual(sorted(result["applied"] for result in results), [False, True])
        self.assertEqual(self.store.get_profile(MEMBER)["xp"], 100)
        self.assertEqual(len(self.store.admin_history(MEMBER)), 1)

    def test_invalid_operation_ids_and_missing_profile_leave_no_audit(self):
        for value in (None, "", "   ", "x" * 101):
            with self.subTest(operation=value), self.assertRaises(ValueError):
                self.adjust(100, value)
        with self.assertRaises(LookupError):
            self.adjust(100, user_id=999)
        self.assertEqual(self.store.admin_history(MEMBER), [])
        self.assertEqual(self.store.admin_history(999), [])

    def test_failed_audit_insert_rolls_back_xp_and_rank_changes(self):
        self.store.db.execute("""
            CREATE TRIGGER reject_admin_audit BEFORE INSERT ON admin_changes
            BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END
        """)
        for mutate, value in ((self.adjust, 500), (self.rank, "IX")):
            with self.assertRaises(sqlite3.IntegrityError):
                mutate(value)
        self.reopen()
        profile = self.store.get_profile(MEMBER)
        self.assertEqual(profile["xp"], 0)
        self.assertIsNone(profile["manual_rank"])
        self.assertEqual(self.store.admin_history(MEMBER), [])

    def test_profile_refresh_preserves_xp_rank_and_history(self):
        self.adjust(500)
        self.rank("VIII")
        profile = self.store.ensure_profile(MEMBER, "Renamed", "renamed")
        self.assertEqual((profile["name"], profile["username"], profile["xp"], profile["manual_rank"]),
                         ("Renamed", "renamed", 500, "VIII"))
        self.assertEqual(len(self.store.admin_history(MEMBER)), 2)
        self.assertEqual(self.store.find_profiles("alice"), [])
        self.assertEqual(self.store.find_profiles("@RENAMED")[0]["user_id"], MEMBER)

    def test_username_ambiguity_is_returned_and_profiles_paginate_deterministically(self):
        self.store.ensure_profile(102, "alice", "ALICE")
        self.store.ensure_profile(103, "Bob", "bob")
        self.assertEqual([row["user_id"] for row in self.store.find_profiles("@Alice")], [101, 102])
        self.assertEqual(self.store.profile_count(), 3)
        self.assertEqual([row["user_id"] for row in self.store.list_profiles(2, 0)], [101, 102])
        self.assertEqual([row["user_id"] for row in self.store.list_profiles(2, 2)], [103])
        self.assertEqual(self.store.list_profiles(2, 3), [])

    def test_history_newest_first_limits_and_persistent_rank_before_after(self):
        self.adjust(300)
        first = self.rank("VII")
        self.now += 1
        second = self.rank("III", "demote")
        self.now += 1
        removed = self.rank(None, "remove")
        self.reopen()
        history = self.store.admin_history(MEMBER, 2)
        self.assertEqual([row["id"] for row in history], [removed["change"]["id"], second["change"]["id"]])
        self.assertEqual((history[0]["before_rank"], history[0]["after_rank"]), ("III", None))
        self.assertEqual((first["change"]["before_rank"], first["change"]["after_rank"]), (None, "VII"))
        self.assertTrue(all(row["before_xp"] == row["after_xp"] == 300 for row in history))


if __name__ == "__main__":
    unittest.main()
