// Data for the Mini App "Профиль Фини" (webapp/). No Telegram IDs leave the bot:
// a person in the lists carries a random ref (member_refs), and a tap on them asks
// /api/member for their card by that ref.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID, SQUAD_CHANNEL_URL, SQUAD_LINKS } from './config.js';
import { getSetting, trackUser } from './store.js';
import { dayStart, fullName, MSK_OFFSET, nowInt, truncate, weekStart } from './util.js';
import * as xp from './xp.js';
import * as chat from './chat.js';
import * as club from './club.js';
import { nameOf, refsOf, userOfRef, usernameOf } from './members.js';
import * as staff from './staff.js';
import * as seasons from './seasons.js';
import * as hall from './hall.js';
import * as fire from './fire.js';
import * as social from './social.js';

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

// Equipped cosmetics of the listed members, by user_id.
async function styles(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await db.all(sql`SELECT user_id, frame, color, title FROM wardrobe
    WHERE user_id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`);
  for (const r of rows) out.set(r.user_id, club.styleView(r));
  return out;
}

async function topView(weekly, userId) {
  const rows = await xp.leaderboard({ weekly, limit: 10 });
  const ids = rows.map((r) => r.user_id);
  const [looks, refs] = await Promise.all([styles(ids), refsOf(ids)]);
  return rows.map((row, i) => ({
    place: i + 1,
    name: truncate(row.name, 35),
    score: row.score,
    rank: rankView(rankOf(row)),
    me: row.user_id === userId,
    style: looks.get(row.user_id) || null,
    ref: refs.get(row.user_id) || null,
  }));
}

// The member's place in the weekly top, the same count as xp.leaderboard(); null
// without XP this week. For the «Ты» row under the top when they are below it.
async function weekPlace(userId) {
  const ts = nowInt();
  const from = weekStart(ts);
  const mine = await db.get(sql`SELECT COALESCE(SUM(points), 0) AS s FROM events
    WHERE user_id = ${userId} AND earned_at >= ${from} AND earned_at <= ${ts} AND kind IN ('comment', 'reaction')`);
  if (!(mine.s > 0)) return null;
  const above = await db.get(sql`SELECT COUNT(*) AS c FROM (SELECT p.user_id, SUM(e.points) AS score
    FROM profiles p JOIN events e ON e.user_id = p.user_id
    WHERE e.earned_at >= ${from} AND e.earned_at <= ${ts} AND e.kind IN ('comment', 'reaction')
    GROUP BY p.user_id HAVING score > ${mine.s} OR (score = ${mine.s} AND p.user_id < ${userId}))`);
  return { place: above.c + 1, score: mine.s };
}

async function place(p) {
  if (!p.xp) return null;
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM profiles
    WHERE xp > ${p.xp} OR (xp = ${p.xp} AND user_id < ${p.user_id})`);
  return row.c + 1;
}

// Days in a row (Moscow time) with comment or reaction XP; bonuses don't count.
// A streak stays alive until the end of the day after the last active one;
// `today` says whether today already counts.
async function streak(userId, ts) {
  const rows = await db.all(sql`SELECT DISTINCT CAST(earned_at + ${MSK_OFFSET} AS INTEGER) / 86400 AS d FROM events
    WHERE user_id = ${userId} AND kind IN ('comment', 'reaction') AND points > 0
      AND earned_at >= ${ts - STREAK_LOOKBACK_DAYS * 86400}
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

// The "Сквад" tab: the owner's latest announcement, the menu links and the Squad's
// pages (Зал славы, Календарь, Летопись, Карта).
async function squad(ts) {
  const [news, lastPost, team, pages] = await Promise.all([getSetting('news'), getSetting('last_channel_post_id'), teamView(),
    hall.squadPages(ts)]);
  return {
    news: truncate(String(news || ''), NEWS_LIMIT),
    channel: SQUAD_CHANNEL_URL,
    lastPost: lastPost ? `${SQUAD_CHANNEL_URL}/${lastPost}` : null,
    links: SQUAD_LINKS,
    team,
    hall: pages.hall,
    calendar: pages.calendar,
    chronicle: pages.chronicle,
    map: pages.map,
  };
}

// «Штаб Сквада»: every position with those who hold it; the @username opens their profile.
async function teamView() {
  const out = [];
  for (const { position, people } of await staff.team()) {
    const refs = await refsOf(people.map((r) => r.user_id));
    const holders = await Promise.all(people.map(async (r) => ({
      name: truncate(await nameOf(r.user_id), 40),
      username: await usernameOf(r.user_id),
      ref: refs.get(r.user_id) || null,
    })));
    out.push({
      emoji: position.emoji, title: position.title, duties: position.duties, motto: position.motto,
      people: holders.map((x) => x.name), holders,
    });
  }
  return out;
}

export async function profileData(user) {
  await trackUser(user);
  const founder = user.id === OWNER_USER_ID;
  const ts = nowInt();
  let p = await xp.profile(user);
  const streakNow = await streak(user.id, ts);
  // Club first: achievements and birthday gifts may add XP shown below.
  const clubView = await club.clubData(user, { xpTotal: p.xp, streakDays: streakNow.days, founder });
  if (clubView.xp !== p.xp) p = await xp.profile(user);
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
  // The rest only reads: all at once, so the Mini App opens faster.
  const [participants, social, placeNow, rivalNow, style, chartNow, historyNow, topAll, topWeek, weekNow, squadNow, halloween, tree] = await Promise.all([
    db.get(sql`SELECT COUNT(*) AS c FROM profiles WHERE xp > 0`),
    chat.profileExtras(user.id),
    place(p),
    rival(p),
    club.myStyle(user.id),
    chart(user.id, ts),
    history(user.id),
    topView(false, user.id),
    topView(true, user.id),
    weekPlace(user.id),
    squad(ts),
    seasons.halloweenView(user.id, ts),
    seasons.treeView(user.id, ts),
  ]);
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
      place: placeNow,
      participants: participants.c,
      streak: streakNow,
      rival: rivalNow,
      style,
      // Reputation and marriage from the chats («+», «брак»).
      rep: social.rep,
      marriage: social.marriage,
      positions: social.positions,
      // «Витрина»: up to three achievements the member picked.
      showcase: clubView.showcase,
    },
    admin: founder,
    chart: chartNow,
    history: historyNow,
    // `mine`: the member's own place and score, for the «Ты» row when they are below the ten.
    top: { all: topAll, week: topWeek, mine: { all: placeNow ? { place: placeNow, score: p.xp } : null, week: weekNow } },
    ranks: xp.RANKS.map((r) => ({ ...rankView(r), reached: automatic ? p.xp >= r[0] : r[1] === current[1] })),
    rules: {
      comment: xp.COMMENT_XP, reaction: xp.REACTION_XP, dailyReactions: xp.DAILY_REACTION_LIMIT,
      poll: club.POLL_XP, referral: club.REFERRAL_XP, birthday: club.BIRTHDAY_XP, weekly: club.WEEKLY_BONUS,
      farm: xp.FARM_MAX, farmRare: xp.FARM_RARE_MAX, farmHours: xp.FARM_COOLDOWN / 3600,
    },
    squad: squadNow,
    club: clubView,
    // Seasonal events: null outside their dates.
    season: { halloween, tree },
    now: ts,
  };
}

// A member's card for a tap on them in the Mini App (/api/member), by the ref from the
// lists: rank, XP and place, the shop look, «Витрина», the pair and its flame,
// reputation, positions, badges, the city from «+Город» and since when they are here.
// → null for an unknown ref.
export async function memberView(viewerId, ref) {
  const userId = await userOfRef(ref);
  if (!userId) return null;
  const [row, name, username, extras, looks, showcase, badges, info, first, partner, spouses] = await Promise.all([
    db.get(sql`SELECT user_id, xp, manual_rank FROM profiles WHERE user_id = ${userId}`),
    nameOf(userId),
    usernameOf(userId),
    chat.profileExtras(userId),
    styles([userId]),
    club.showcaseOf(userId),
    db.get(sql`SELECT COUNT(*) AS c FROM achievements WHERE user_id = ${userId}`),
    db.get(sql`SELECT city FROM profile_info WHERE user_id = ${userId}`),
    db.get(sql`SELECT MIN(first_seen) AS t FROM chat_members WHERE user_id = ${userId} AND first_seen > 0`),
    fire.partnerOf(userId),
    social.spousesOf(userId),
  ]);
  const p = row || { user_id: userId, xp: 0, manual_rank: null };
  // The pair chip opens the partner's card; with several spouses the chip names them all, so it opens none.
  const partnerRef = partner && spouses.length < 2 ? (await refsOf([partner])).get(partner) || null : null;
  return {
    ref,
    me: userId === viewerId,
    name: truncate(name, 60),
    username,
    rank: rankView(rankOf(p)),
    founder: userId === OWNER_USER_ID,
    xp: p.xp,
    place: await place(p),
    style: looks.get(userId) || null,
    showcase,
    rep: extras.rep,
    positions: extras.positions,
    pair: extras.marriage ? { ...extras.marriage, ref: partnerRef } : null,
    achievements: { got: badges.c, total: club.ACHIEVEMENTS.length },
    city: info && info.city ? truncate(info.city, 40) : null,
    since: first && first.t ? first.t : null,
  };
}
