// Data for the Mini App "Профиль Фини" (webapp/). Other members are shown by
// name and XP only: no IDs or usernames leave the bot.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID, SQUAD_CHANNEL_URL, SQUAD_LINKS } from './config.js';
import { getSetting, trackUser } from './store.js';
import { dayStart, fullName, MSK_OFFSET, nowInt, truncate } from './util.js';
import * as xp from './xp.js';

const HISTORY_LIMIT = 30;
const CHART_DAYS = 7;
const NEWS_LIMIT = 1000;
const STREAK_LOOKBACK_DAYS = 400;

function rankView(rank) {
  return { roman: rank[1], name: rank[2], from: rank[0] };
}

function rankOf(row) {
  return xp.rankFor(row.xp, { founder: row.user_id === OWNER_USER_ID, manualRank: row.manual_rank })[0];
}

async function topView(weekly, userId) {
  const rows = await xp.leaderboard({ weekly, limit: 10 });
  return rows.map((row, i) => ({
    place: i + 1,
    name: truncate(row.name, 35),
    score: row.score,
    rank: rankView(rankOf(row)),
    me: row.user_id === userId,
  }));
}

async function place(p) {
  if (!p.xp) return null;
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM profiles
    WHERE xp > ${p.xp} OR (xp = ${p.xp} AND user_id < ${p.user_id})`);
  return row.c + 1;
}

// Days in a row (Moscow time) with XP. A streak stays alive until the end of the
// day after the last active one; `today` says whether today already counts.
async function streak(userId, ts) {
  const rows = await db.all(sql`SELECT DISTINCT CAST(earned_at + ${MSK_OFFSET} AS INTEGER) / 86400 AS d FROM events
    WHERE user_id = ${userId} AND points > 0 AND earned_at >= ${ts - STREAK_LOOKBACK_DAYS * 86400}
      AND earned_at <= ${ts}
    ORDER BY d DESC`);
  const today = Math.floor((ts + MSK_OFFSET) / 86400);
  const days = rows.map((r) => r.d);
  if (!days.length || days[0] < today - 1) return { days: 0, today: false };
  let n = 1;
  while (n < days.length && days[n] === days[0] - n) n++;
  return { days: n, today: days[0] === today };
}

// The next member above in the all-time top, and how much XP it takes to pass them.
async function rival(p) {
  const row = await db.get(sql`SELECT user_id, name, xp FROM profiles
    WHERE xp > 0 AND (xp > ${p.xp} OR (xp = ${p.xp} AND user_id < ${p.user_id}))
    ORDER BY xp ASC, user_id DESC LIMIT 1`);
  if (!row) return null;
  return { name: truncate(row.name, 35), xp: row.xp, place: await place(row), left: row.xp - p.xp + 1 };
}

// XP per Moscow day, oldest first, today last.
async function chart(userId, ts) {
  const first = dayStart(ts) - (CHART_DAYS - 1) * 86400;
  const rows = await db.all(sql`SELECT earned_at, points FROM events
    WHERE user_id = ${userId} AND points > 0 AND earned_at >= ${first} AND earned_at <= ${ts}`);
  const days = Array.from({ length: CHART_DAYS }, (_, i) => ({ day: first + i * 86400, xp: 0 }));
  for (const r of rows) {
    const i = Math.floor((dayStart(r.earned_at) - first) / 86400);
    if (i >= 0 && i < CHART_DAYS) days[i].xp += r.points;
  }
  return days;
}

async function history(userId) {
  const events = await db.all(sql`SELECT kind, points, earned_at FROM events
    WHERE user_id = ${userId} AND points > 0 ORDER BY earned_at DESC LIMIT ${HISTORY_LIMIT}`);
  const changes = await db.all(sql`SELECT action, before_xp, after_xp, after_rank, created_at FROM admin_changes
    WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`);
  const items = events.map((e) => ({ kind: e.kind, points: e.points, at: e.earned_at }));
  for (const c of changes) {
    if (c.action === 'adjust_xp') {
      items.push({ kind: 'owner_xp', points: c.after_xp - c.before_xp, at: c.created_at });
    } else {
      items.push({ kind: 'owner_rank', points: 0, rank: c.after_rank, at: c.created_at });
    }
  }
  items.sort((a, b) => b.at - a.at);
  return items.slice(0, HISTORY_LIMIT);
}

// The "Сквад" tab: the owner's latest announcement and the menu links.
async function squad() {
  const news = await getSetting('news');
  const lastPost = await getSetting('last_channel_post_id');
  return {
    news: truncate(String(news || ''), NEWS_LIMIT),
    channel: SQUAD_CHANNEL_URL,
    lastPost: lastPost ? `${SQUAD_CHANNEL_URL}/${lastPost}` : null,
    links: SQUAD_LINKS,
  };
}

export async function profileData(user) {
  await trackUser(user);
  const p = await xp.profile(user);
  const founder = user.id === OWNER_USER_ID;
  const [current, following] = xp.rankFor(p.xp, { founder, manualRank: p.manual_rank });
  const automatic = !founder && !p.manual_rank;
  let progress = null;
  if (automatic && following) {
    progress = {
      next: rankView(following),
      left: following[0] - p.xp,
      percent: Math.floor(((p.xp - current[0]) / (following[0] - current[0])) * 100),
    };
  }
  const ts = nowInt();
  const participants = await db.get(sql`SELECT COUNT(*) AS c FROM profiles WHERE xp > 0`);
  return {
    me: {
      name: truncate(fullName(user), 100),
      xp: p.xp,
      today: p.today,
      week: p.week,
      dailyLimit: xp.DAILY_XP_LIMIT,
      rank: rankView(current),
      founder,
      manualRank: Boolean(p.manual_rank) && !founder,
      progress,
      place: await place(p),
      participants: participants.c,
      streak: await streak(user.id, ts),
      rival: await rival(p),
    },
    admin: founder,
    chart: await chart(user.id, ts),
    history: await history(user.id),
    top: { all: await topView(false, user.id), week: await topView(true, user.id) },
    ranks: xp.RANKS.map((r) => ({ ...rankView(r), reached: automatic ? p.xp >= r[0] : r[1] === current[1] })),
    rules: { comment: xp.COMMENT_XP, reaction: xp.REACTION_XP, dailyReactions: xp.DAILY_REACTION_LIMIT },
    squad: await squad(),
    now: ts,
  };
}
