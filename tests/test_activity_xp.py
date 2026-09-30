"""Ledger, anti-farming, discussion scope and Moscow calendar checks."""

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace as NS

from activity_xp import ActivityXP, RANKS, day_start, rank_for, week_start

CHANNEL = -1001192817776
GROUP = -100555
NOW = int(datetime(2026, 9, 30, 12, tzinfo=timezone.utc).timestamp())


def user(uid=10, **kw):
    return NS(id=uid, full_name=kw.get("name", "Alice <&>"),
              username=kw.get("username", "alice"), is_bot=kw.get("bot", False))


def message(mid, *, actor=None, root=False, reply=None, thread=None, text="Полезный комментарий", channel=CHANNEL):
    return NS(chat=NS(id=GROUP), message_id=mid, from_user=actor or user(),
              sender_chat=None, text=text, caption=None, date=datetime.fromtimestamp(NOW, timezone.utc),
              is_automatic_forward=root, reply_to_message=reply, message_thread_id=thread,
              forward_origin=NS(type="channel", chat=NS(id=channel)) if root else None)


def reaction(mid, *, actor=None, old=(), new=("👍",)):
    return NS(chat=NS(id=GROUP), message_id=mid, user=actor or user(), actor_chat=None,
              date=datetime.fromtimestamp(NOW, timezone.utc), old_reaction=old, new_reaction=new)


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "xp.sqlite3"
        self.now = NOW
        self.xp = ActivityXP(self.path, clock=lambda: self.now)

    def tearDown(self):
        self.xp.close()
        self.temp.cleanup()

    def award(self, mid, kind="comment", at=None, actor=None):
        return self.xp.award(actor or user(), GROUP, mid, kind, self.now if at is None else at)

    def test_comment_is_five_and_replayed_update_is_ignored(self):
        root = message(1, root=True)
        self.assertIsNone(self.xp.comment(root, CHANNEL))
        comment = message(2, reply=root)
        self.assertEqual(self.xp.comment(comment, CHANNEL).points, 5)
        self.assertIsNone(self.xp.comment(comment, CHANNEL))
        self.assertEqual(self.xp.profile(user())["xp"], 5)

    def test_root_recovered_from_reply_after_bot_was_added(self):
        self.assertEqual(self.xp.comment(message(2, reply=message(1, root=True)), CHANNEL).points, 5)
        self.assertIsNotNone(self.xp.message_record(GROUP, 1))

    def test_nested_reply_and_thread_comments_count(self):
        root = message(1, root=True)
        parent = message(2, reply=root)
        self.xp.comment(parent, CHANNEL)
        self.now += 60
        nested = message(3, reply=parent)
        nested.date = datetime.fromtimestamp(self.now, timezone.utc)
        self.assertEqual(self.xp.comment(nested, CHANNEL).points, 5)
        self.now += 60
        thread = message(4, thread=1)
        thread.date = datetime.fromtimestamp(self.now, timezone.utc)
        self.assertEqual(self.xp.comment(thread, CHANNEL).points, 5)

    def test_unrelated_chat_text_and_other_channel_roots_do_not_count(self):
        self.assertIsNone(self.xp.comment(message(2), CHANNEL))
        self.assertIsNone(self.xp.comment(message(3, reply=message(1, root=True, channel=-100999)), CHANNEL))
        self.assertEqual(self.xp.profile(user())["xp"], 0)

    def test_emoji_commands_short_forwarded_and_anonymous_comments_ignored(self):
        root = message(1, root=True)
        for mid, text in enumerate(("👍👍👍👍👍", "прив", "/start hello world"), 2):
            self.assertIsNone(self.xp.comment(message(mid, reply=root, text=text), CHANNEL))
        forwarded = message(5, reply=root)
        forwarded.forward_origin = NS(type="user")
        self.assertIsNone(self.xp.comment(forwarded, CHANNEL))
        anonymous = message(6, reply=root)
        anonymous.sender_chat = NS(id=GROUP)
        self.assertIsNone(self.xp.comment(anonymous, CHANNEL))

    def test_reaction_is_one_and_switch_remove_readd_never_farms_xp(self):
        self.xp.remember_message(message(1, root=True), CHANNEL)
        self.assertEqual(self.xp.reaction(reaction(1)).points, 1)
        self.assertIsNone(self.xp.reaction(reaction(1, old=("👍",), new=("❤",))))
        self.assertIsNone(self.xp.reaction(reaction(1, old=("❤",), new=())))
        self.assertIsNone(self.xp.reaction(reaction(1)))
        self.assertEqual(self.xp.profile(user())["xp"], 1)

    def test_self_unknown_anonymous_and_bot_reactions_do_not_count(self):
        self.xp.remember_message(message(1, root=True), CHANNEL)
        self.xp.remember_message(message(2, reply=message(1, root=True)), CHANNEL)
        self.assertIsNone(self.xp.reaction(reaction(2)))
        self.assertIsNone(self.xp.reaction(reaction(999)))
        event = reaction(1)
        event.user = None
        event.actor_chat = NS(id=GROUP)
        self.assertIsNone(self.xp.reaction(event))
        self.assertIsNone(self.xp.reaction(reaction(1, actor=user(bot=True))))

    def test_comment_cooldown_and_denied_replay_are_permanent(self):
        self.assertEqual(self.award(1).points, 5)
        self.assertIsNone(self.award(2))
        self.now += 60
        self.assertIsNone(self.award(2))
        self.assertEqual(self.award(3).points, 5)

    def test_twenty_reactions_per_moscow_day(self):
        for mid in range(20):
            self.assertEqual(self.award(mid, "reaction").points, 1)
        self.assertIsNone(self.award(20, "reaction"))
        self.now = day_start(NOW) + 86400
        self.assertEqual(self.award(21, "reaction").points, 1)

    def test_total_daily_cap_and_restart_preserve_dedup(self):
        for mid in range(20):
            self.assertEqual(self.award(mid).points, 5)
            self.now += 60
        self.assertIsNone(self.award(21))
        self.assertIsNone(self.award(22, "reaction"))
        self.xp.close()
        self.xp = ActivityXP(self.path, clock=lambda: self.now)
        self.assertEqual(self.xp.profile(user())["xp"], 100)
        self.assertIsNone(self.award(1))
        self.now = day_start(NOW) + 86400
        self.assertEqual(self.award(23).total, 105)

    def test_user_identity_uses_id_and_name_can_change(self):
        self.award(1)
        renamed = user(name="New Name", username="changed")
        self.assertEqual(self.xp.profile(renamed)["xp"], 5)
        other = user(20, username="changed")
        self.assertEqual(self.xp.profile(other)["xp"], 0)

    def test_bad_dates_and_bot_comments_do_not_count(self):
        self.assertIsNone(self.award(1, at=self.now - 86401))
        self.assertIsNone(self.award(2, at=self.now + 61))
        self.assertIsNone(self.award(3, actor=user(bot=True)))

    def test_all_rank_boundaries_and_founder_reserved(self):
        self.assertEqual([rank[0] for rank in RANKS], sorted(rank[0] for rank in RANKS))
        for i, rank in enumerate(RANKS):
            self.assertEqual(rank_for(rank[0])[0], rank)
            if i:
                self.assertEqual(rank_for(rank[0] - 1)[0], RANKS[i - 1])
        self.assertEqual(rank_for(100000)[0][1], "IX")
        self.assertEqual(rank_for(0, founder=True)[0][1], "X")
        self.assertIsNone(rank_for(0, founder=True)[1])

    def test_promotion_and_weekly_top_reset_but_lifetime_remains(self):
        for mid in range(20):
            result = self.award(mid)
            self.now += 60
        self.assertTrue(result.promoted)
        self.assertEqual(result.new_rank[1], "II")
        self.assertEqual(self.xp.leaderboard(weekly=True)[0]["score"], 100)
        self.now = week_start(NOW) + 7 * 86400
        self.assertEqual(self.xp.leaderboard(weekly=True), [])
        self.assertEqual(self.xp.leaderboard()[0]["score"], 100)

    def test_moscow_day_and_monday_week_boundaries(self):
        before = datetime(2026, 9, 27, 20, 59, tzinfo=timezone.utc).timestamp()
        after = before + 60
        self.assertEqual(day_start(after) - day_start(before), 86400)
        self.assertEqual(week_start(after) - week_start(before), 7 * 86400)


if __name__ == "__main__":
    unittest.main()
