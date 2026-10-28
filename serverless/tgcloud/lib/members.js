// Members of the Squad chats and how much they write: the live list behind
// «топ дня», «стата» and «кто сегодня…». Names refresh on every message, and
// whoever leaves drops out of the lists until they come back.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { bumpHour } from './feats.js';
import { fullName, MSK_OFFSET, nowInt, truncate, weekStart } from './util.js';

const DAY = 86400;
const RECENT_DAYS = 14;
// Telegram's service account that posts channel messages into the discussion group.
export const TELEGRAM_SERVICE_ID = 777000;

// Days since 1970 in Moscow time.
export const mskDay = (ts) => Math.floor((Math.floor(ts) + MSK_OFFSET) / DAY);

export const isPerson = (u) => Boolean(u) && !u.is_bot && u.id > 0 && u.id !== TELEGRAM_SERVICE_ID;

// What a member wrote, as opposed to joins, pins, title changes and other service messages.
const CONTENT = [
  'text', 'photo', 'video', 'animation', 'audio', 'document', 'voice', 'video_note', 'sticker', 'poll',
  'location', 'venue', 'contact', 'dice', 'paid_media', 'story', 'checklist',
];
export const isContent = (message) => CONTENT.some((key) => message[key] != null);

export const nameOfUser = (u) => truncate(fullName(u), 100) || String(u.id);

// → the member's messages in this chat now.
async function upsert(chatId, u, ts, { counted }) {
  const one = counted ? 1 : 0;
  const r = await db.run(sql`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (${chatId}, ${u.id}, ${nameOfUser(u)}, ${truncate(u.username || '', 40)}, 'member', ${ts},
      ${counted ? ts : 0}, ${one})
    ON CONFLICT(chat_id, user_id) DO UPDATE SET name = excluded.name, username = excluded.username,
      status = 'member', msgs = msgs + ${one},
      last_active = CASE WHEN ${one} = 1 THEN MAX(last_active, excluded.last_active) ELSE last_active END
    RETURNING msgs`);
  return r.rows && r.rows[0] ? r.rows[0].msgs : 0;
}

// Every message of a member: fresh name, back in the list, +1 for today.
// → { msgs } in this chat after it, or null when it wasn't a member's message.
export async function track(message) {
  const chatId = message.chat.id;
  // Service messages come from whoever added or removed the member, maybe a bot.
  if (message.left_chat_member) {
    if (isPerson(message.left_chat_member)) await left(chatId, message.left_chat_member.id);
    return null;
  }
  if (message.new_chat_members) {
    for (const m of message.new_chat_members) if (isPerson(m)) await joined(chatId, m);
    return null;
  }
  const u = message.from;
  if (!isPerson(u) || message.sender_chat || !isContent(message)) return null;
  const ts = Math.min(nowInt(), Math.floor(message.date || nowInt()));
  const msgs = await upsert(chatId, u, ts, { counted: true });
  await db.run(sql`INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (${chatId}, ${u.id}, ${mskDay(ts)}, 1)
    ON CONFLICT(chat_id, day, user_id) DO UPDATE SET msgs = msgs + 1`);
  await bumpHour(u.id, ts);
  return { msgs };
}

export async function joined(chatId, u) {
  await upsert(chatId, u, nowInt(), { counted: false });
}

export async function left(chatId, userId) {
  await db.run(sql`UPDATE chat_members SET status = 'left' WHERE chat_id = ${chatId} AND user_id = ${userId}`);
}

// chat_member update in a Squad chat.
export async function handleChatMember(event) {
  const member = event.new_chat_member;
  const u = member && member.user;
  if (!isPerson(u)) return;
  const status = member.status;
  const inside = ['member', 'administrator', 'creator'].includes(status) || (status === 'restricted' && member.is_member);
  if (inside) await joined(event.chat.id, u);
  else await left(event.chat.id, u.id);
}

// ---- lookups -------------------------------------------------------------

// The freshest known name of a member, from any Squad chat or the XP profiles.
export async function nameOf(userId) {
  const nick = await db.get(sql`SELECT nick FROM nicks WHERE user_id = ${userId}`);
  if (nick) return nick.nick;
  const row = await db.get(sql`SELECT name FROM chat_members WHERE user_id = ${userId}
    ORDER BY last_active DESC LIMIT 1`);
  if (row) return row.name;
  const p = await db.get(sql`SELECT name FROM profiles WHERE user_id = ${userId}`);
  return p ? p.name : 'Участник';
}

// Names as nameOf() gives them (nick, then the freshest chat name, then the profile)
// and @usernames as usernameOf(), for many members in three queries:
// → name(id), with name.username(id).
export async function namesOf(ids) {
  const list = JSON.stringify([...new Set(ids)].filter((id) => Number.isInteger(id)));
  const names = new Map();
  const usernames = new Map();
  for (const r of await db.all(sql`SELECT user_id, name, username FROM profiles WHERE user_id IN (SELECT value FROM json_each(${list}))`)) {
    names.set(r.user_id, r.name);
    if (r.username) usernames.set(r.user_id, r.username);
  }
  for (const r of await db.all(sql`SELECT user_id, name, username FROM chat_members
    WHERE user_id IN (SELECT value FROM json_each(${list})) ORDER BY last_active`)) {
    names.set(r.user_id, r.name);
    if (r.username) usernames.set(r.user_id, r.username);
  }
  for (const r of await db.all(sql`SELECT user_id, nick FROM nicks WHERE user_id IN (SELECT value FROM json_each(${list}))`)) {
    names.set(r.user_id, r.nick);
  }
  const name = (id) => truncate(names.get(id) || 'Участник', 40);
  name.username = (id) => usernames.get(id) || '';
  return name;
}

// The freshest known @username of a member without the @, or '' when they have none.
export async function usernameOf(userId) {
  const row = await db.get(sql`SELECT username FROM chat_members WHERE user_id = ${userId} AND username != ''
    ORDER BY last_active DESC LIMIT 1`);
  if (row) return row.username;
  const p = await db.get(sql`SELECT username FROM profiles WHERE user_id = ${userId}`);
  return p && p.username ? p.username : '';
}

export async function byUsername(chatId, username) {
  username = String(username || '').replace(/^@+/, '').toLowerCase();
  if (!username) return null;
  const row = await db.get(sql`SELECT user_id AS id, name FROM chat_members
    WHERE lower(username) = ${username} ORDER BY chat_id = ${chatId} DESC, last_active DESC LIMIT 1`);
  if (row) return row;
  return db.get(sql`SELECT user_id AS id, name FROM profiles WHERE lower(username) = ${username} LIMIT 1`);
}

// Somebody from the chat who wrote lately (anybody still inside if nobody did).
export async function randomMember(chatId) {
  const recent = await db.get(sql`SELECT user_id AS id, name FROM chat_members
    WHERE chat_id = ${chatId} AND status = 'member' AND last_active >= ${nowInt() - RECENT_DAYS * DAY}
    ORDER BY random() LIMIT 1`);
  if (recent) return recent;
  return db.get(sql`SELECT user_id AS id, name FROM chat_members
    WHERE chat_id = ${chatId} AND status = 'member' ORDER BY random() LIMIT 1`);
}

// ---- tops and stats --------------------------------------------------------

function monthStartDay(ts) {
  const d = new Date((Math.floor(ts) + MSK_OFFSET) * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 / DAY);
}

// First Moscow day of a period: 'day' today, 'week' since Monday, 'month' since the 1st.
export function periodStart(period, ts = nowInt()) {
  if (period === 'day') return mskDay(ts);
  if (period === 'week') return mskDay(weekStart(ts));
  if (period === 'month') return monthStartDay(ts);
  return null;
}

// A member's nick when set («+ник»), else the name from the chat (alias m).
const NAME = sql.raw('COALESCE((SELECT nick FROM nicks WHERE nicks.user_id = m.user_id), m.name)');

// Members still in the chat with the most messages in the period (null = all time).
export async function activityTop(chatId, period, limit = 10) {
  const from = periodStart(period);
  if (from == null) {
    return db.all(sql`SELECT user_id, ${NAME} AS name, msgs AS n FROM chat_members m
      WHERE chat_id = ${chatId} AND status = 'member' AND msgs > 0 ORDER BY msgs DESC, user_id LIMIT ${limit}`);
  }
  return db.all(sql`SELECT m.user_id, ${NAME} AS name, SUM(a.msgs) AS n FROM chat_activity a
    JOIN chat_members m ON m.chat_id = a.chat_id AND m.user_id = a.user_id
    WHERE a.chat_id = ${chatId} AND a.day >= ${from} AND m.status = 'member'
    GROUP BY a.user_id ORDER BY n DESC, a.user_id LIMIT ${limit}`);
}

async function messagesSince(chatId, from, userId = null) {
  const row = userId == null
    ? await db.get(sql`SELECT COALESCE(SUM(msgs), 0) AS n FROM chat_activity WHERE chat_id = ${chatId} AND day >= ${from}`)
    : await db.get(sql`SELECT COALESCE(SUM(msgs), 0) AS n FROM chat_activity
      WHERE chat_id = ${chatId} AND day >= ${from} AND user_id = ${userId}`);
  return row.n;
}

// The chat over a period (null = all time): messages, members, how many of them wrote,
// and the members by messages.
export async function periodStats(chatId, period, limit = 20) {
  const from = periodStart(period);
  const people = await db.get(sql`SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ${chatId} AND status = 'member'`);
  let messages;
  let writers;
  if (from == null) {
    messages = (await db.get(sql`SELECT COALESCE(SUM(msgs), 0) AS n FROM chat_members WHERE chat_id = ${chatId}`)).n;
    writers = (await db.get(sql`SELECT COUNT(*) AS n FROM chat_members
      WHERE chat_id = ${chatId} AND status = 'member' AND msgs > 0`)).n;
  } else {
    messages = await messagesSince(chatId, from);
    writers = (await db.get(sql`SELECT COUNT(DISTINCT a.user_id) AS n FROM chat_activity a
      JOIN chat_members m ON m.chat_id = a.chat_id AND m.user_id = a.user_id
      WHERE a.chat_id = ${chatId} AND a.day >= ${from} AND m.status = 'member'`)).n;
  }
  return { messages, members: people.n, writers, top: await activityTop(chatId, period, limit) };
}

// A member's place among those still in the chat, by messages in the period.
// → { place, n }, or null when they wrote nothing then.
export async function placeOf(chatId, period, userId) {
  const from = periodStart(period);
  let n;
  if (from == null) {
    const row = await db.get(sql`SELECT msgs FROM chat_members WHERE chat_id = ${chatId} AND user_id = ${userId}`);
    n = row ? row.msgs : 0;
    if (!n) return null;
    const above = await db.get(sql`SELECT COUNT(*) AS c FROM chat_members WHERE chat_id = ${chatId} AND status = 'member'
      AND (msgs > ${n} OR (msgs = ${n} AND user_id < ${userId}))`);
    return { place: above.c + 1, n };
  }
  n = await messagesSince(chatId, from, userId);
  if (!n) return null;
  const above = await db.get(sql`SELECT COUNT(*) AS c FROM (SELECT a.user_id, SUM(a.msgs) AS s FROM chat_activity a
    JOIN chat_members m ON m.chat_id = a.chat_id AND m.user_id = a.user_id
    WHERE a.chat_id = ${chatId} AND a.day >= ${from} AND m.status = 'member' GROUP BY a.user_id)
    WHERE s > ${n} OR (s = ${n} AND user_id < ${userId})`);
  return { place: above.c + 1, n };
}

// One Moscow day of the chat, for «🌙 Итоги дня»: messages, how many wrote, the top.
export async function dayStats(chatId, day, limit = 3) {
  const t = await db.get(sql`SELECT COALESCE(SUM(msgs), 0) AS n, COUNT(*) AS w FROM chat_activity
    WHERE chat_id = ${chatId} AND day = ${day}`);
  const top = await db.all(sql`SELECT m.user_id, ${NAME} AS name, a.msgs AS n FROM chat_activity a
    JOIN chat_members m ON m.chat_id = a.chat_id AND m.user_id = a.user_id
    WHERE a.chat_id = ${chatId} AND a.day = ${day} AND m.status = 'member'
    ORDER BY a.msgs DESC, a.user_id LIMIT ${limit}`);
  return { messages: t.n, writers: t.w, top };
}

export const CHART_DAYS = 365;

// One member in one chat, for the profile: since when, the last message, messages
// today / this week / this month / all time, and per day over the last year (the chart).
export async function memberCard(chatId, userId, ts = nowInt()) {
  const row = await db.get(sql`SELECT first_seen, last_active, msgs FROM chat_members
    WHERE chat_id = ${chatId} AND user_id = ${userId}`);
  if (!row) return null;
  const rows = await db.all(sql`SELECT day, msgs FROM chat_activity
    WHERE chat_id = ${chatId} AND user_id = ${userId} AND day > ${mskDay(ts) - CHART_DAYS}`);
  const sum = (from) => rows.reduce((n, r) => (r.day >= from ? n + r.msgs : n), 0);
  return {
    since: row.first_seen,
    lastActive: row.last_active,
    total: row.msgs,
    day: sum(periodStart('day', ts)),
    week: sum(periodStart('week', ts)),
    month: sum(periodStart('month', ts)),
    days: new Map(rows.map((r) => [r.day, r.msgs])),
  };
}

// The whole chat, for «Чат инфо»: members, who wrote today, messages per period,
// the record day, since when Финя knows it, and messages per day (the chart).
export async function chatCard(chatId, ts = nowInt()) {
  const people = await db.get(sql`SELECT COUNT(*) AS n, MIN(CASE WHEN first_seen > 0 THEN first_seen END) AS since,
    COALESCE(SUM(CASE WHEN first_seen >= ${weekStart(ts)} THEN 1 ELSE 0 END), 0) AS fresh
    FROM chat_members WHERE chat_id = ${chatId} AND status = 'member'`);
  const total = await db.get(sql`SELECT COALESCE(SUM(msgs), 0) AS n FROM chat_members WHERE chat_id = ${chatId}`);
  const rows = await db.all(sql`SELECT day, SUM(msgs) AS n, COUNT(*) AS w FROM chat_activity
    WHERE chat_id = ${chatId} GROUP BY day`);
  const today = mskDay(ts);
  const days = new Map();
  let record = null;
  let first = null;
  let writers = 0;
  for (const r of rows) {
    if (r.day > today - CHART_DAYS) days.set(r.day, r.n);
    if (!record || r.n > record.n) record = { day: r.day, n: r.n };
    if (first == null || r.day < first) first = r.day;
    if (r.day === today) writers = r.w;
  }
  const sum = (from) => rows.reduce((n, r) => (r.day >= from ? n + r.n : n), 0);
  return {
    members: people.n,
    fresh: people.fresh,
    writers,
    // The oldest of the first message and the first member seen.
    since: Math.min(people.since || Infinity, first != null ? first * DAY - MSK_OFFSET : Infinity),
    day: sum(periodStart('day', ts)),
    week: sum(periodStart('week', ts)),
    month: sum(periodStart('month', ts)),
    total: total.n,
    record,
    days,
  };
}
