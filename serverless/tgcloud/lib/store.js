// Settings, users, sessions and the error log (the former state.json).
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { DEFAULT_NEWS, OWNER_USER_ID } from './config.js';
import { nowInt, truncate } from './util.js';

const DEFAULTS = {
  news: DEFAULT_NEWS,
  maintenance: false,
  admin_chat_id: null,
  channel_broadcast_enabled: true,
  last_channel_post_id: null,
  xp_discussion_chat_id: null,
};

export async function getSetting(key) {
  const row = await db.get(sql`SELECT value FROM settings WHERE key = ${key}`);
  if (!row || row.value == null) return key in DEFAULTS ? DEFAULTS[key] : null;
  try {
    return JSON.parse(row.value);
  } catch {
    return key in DEFAULTS ? DEFAULTS[key] : null;
  }
}

export async function setSetting(key, value) {
  const encoded = JSON.stringify(value ?? null);
  await db.run(sql`INSERT INTO settings (key, value) VALUES (${key}, ${encoded})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
}

export function isAdminUser(user) {
  return user != null && user.id === OWNER_USER_ID;
}

export async function isMaintenance() {
  return Boolean(await getSetting('maintenance'));
}

// ---- users -------------------------------------------------------------

export async function getUser(userId) {
  return db.get(sql`SELECT * FROM users WHERE user_id = ${userId}`);
}

export async function trackUser(user) {
  if (!user) return;
  const ts = nowInt();
  await db.run(sql`INSERT INTO users (user_id, username, first_name, first_seen, last_seen, blocked, blocked_at)
    VALUES (${user.id}, ${user.username ?? null}, ${user.first_name ?? null}, ${ts}, ${ts}, 0, NULL)
    ON CONFLICT(user_id) DO UPDATE SET username = excluded.username,
      first_name = excluded.first_name, last_seen = excluded.last_seen,
      blocked = 0, blocked_at = NULL`);
}

export async function markUserUnreachable(userId) {
  const ts = nowInt();
  await db.run(sql`INSERT INTO users (user_id, first_seen, last_seen, blocked, blocked_at, subscribed)
    VALUES (${userId}, ${ts}, 0, 1, ${ts}, 0)
    ON CONFLICT(user_id) DO UPDATE SET blocked = 1, blocked_at = ${ts}, subscribed = 0`);
}

export async function isSubscribed(userId) {
  const row = await db.get(sql`SELECT subscribed FROM users WHERE user_id = ${userId}`);
  return Boolean(row && row.subscribed);
}

export async function setSubscribed(user, value) {
  await trackUser(user);
  await db.run(sql`UPDATE users SET subscribed = ${value ? 1 : 0} WHERE user_id = ${user.id}`);
}

export async function userCount() {
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM users`);
  return row ? row.c : 0;
}

export async function userStats() {
  const ts = nowInt();
  const row = await db.get(sql`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN blocked = 0 AND ${ts} - COALESCE(NULLIF(first_seen, 0), NULLIF(last_seen, 0), ${ts}) <= 86400 THEN 1 ELSE 0 END) AS new,
      SUM(CASE WHEN blocked = 0 AND last_seen > 0 AND ${ts} - last_seen <= 604800 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN blocked = 0 AND NOT (last_seen > 0 AND ${ts} - last_seen <= 604800) THEN 1 ELSE 0 END) AS inactive,
      SUM(CASE WHEN subscribed = 1 THEN 1 ELSE 0 END) AS subscribers
    FROM users`);
  return {
    total: row?.total || 0,
    blocked: row?.blocked || 0,
    new: row?.new || 0,
    active: row?.active || 0,
    inactive: row?.inactive || 0,
    subscribers: row?.subscribers || 0,
  };
}

// ---- sessions (former context.user_data) -------------------------------

export async function loadSession(userId) {
  if (!userId) return {};
  const row = await db.get(sql`SELECT data FROM sessions WHERE user_id = ${userId}`);
  if (!row) return {};
  try {
    const data = JSON.parse(row.data);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function saveSession(userId, data) {
  if (!userId) return;
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) {
    await db.run(sql`DELETE FROM sessions WHERE user_id = ${userId}`);
    return;
  }
  const encoded = JSON.stringify(data);
  await db.run(sql`INSERT INTO sessions (user_id, data, updated_at) VALUES (${userId}, ${encoded}, ${nowInt()})
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);
}

// Loads the session, runs fn(session), saves it back if it changed.
export async function withSession(userId, fn) {
  const session = await loadSession(userId);
  const before = JSON.stringify(session);
  try {
    return await fn(session);
  } finally {
    if (JSON.stringify(session) !== before) await saveSession(userId, session);
  }
}

// ---- feedback ----------------------------------------------------------

export async function addFeedback(user, text) {
  await db.run(sql`INSERT INTO feedback (user_id, username, first_name, text, time)
    VALUES (${user.id}, ${user.username ?? null}, ${user.first_name ?? null}, ${truncate(text, 3000)}, ${nowInt()})`);
  // Keep the last 200 like state.json did.
  await db.run(sql`DELETE FROM feedback WHERE id NOT IN (SELECT id FROM feedback ORDER BY id DESC LIMIT 200)`);
}

export async function recentFeedback(limit = 5) {
  return db.all(sql`SELECT * FROM feedback ORDER BY id DESC LIMIT ${limit}`);
}

export async function feedbackCount() {
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM feedback`);
  return row ? row.c : 0;
}

// ---- error log (replaces logs/*.log) ------------------------------------

export async function logError(source, err) {
  const description = err && err.description ? err.description : (err && err.message) || String(err);
  console.error(`[${source}]`, err);
  try {
    await db.run(sql`INSERT INTO error_log (at, source, text) VALUES (${nowInt()}, ${source}, ${truncate(description, 500)})`);
    await db.run(sql`DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT 200)`);
  } catch (e) {
    console.error('error_log write failed', e);
  }
}

export async function recentErrors(limit = 12) {
  return db.all(sql`SELECT * FROM error_log ORDER BY id DESC LIMIT ${limit}`);
}
