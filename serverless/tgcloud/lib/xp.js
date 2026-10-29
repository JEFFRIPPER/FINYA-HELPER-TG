// Persistent activity ledger (port of activity_xp.py). No message text is stored.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { countAlnum, dayStart, fullName, nowInt, truncate, weekStart } from './util.js';

export const COMMENT_XP = 5;
export const REACTION_XP = 1;
export const DAILY_XP_LIMIT = 100;
export const DAILY_REACTION_LIMIT = 20;
export const COMMENT_COOLDOWN = 60;
export const MAX_XP = 1_000_000_000;
// X is the founder's title, never an automatic promotion for other members.
// 2026-10-29 the owner raised every threshold ×3: ranks came too fast.
export const RANKS = [
  [0, 'I', 'Искра'],
  [300, 'II', 'Звено'],
  [900, 'III', 'Клинок'],
  [1500, 'IV', 'Страж Круга'],
  [3000, 'V', 'Вестник Свободы'],
  [9000, 'VI', 'Командор Алой Звезды'],
  [12000, 'VII', 'Маршал Свободы'],
  [15000, 'VIII', 'Архонт Круга'],
  [30000, 'IX', 'Верховный Архонт'],
];
export const ROMANS = new Set(RANKS.map((r) => r[1]));

export class XpError extends Error {
  constructor(message, kind = 'value') {
    super(message);
    this.kind = kind; // 'value' | 'lookup' | 'permission'
  }
}

// → [current, next]; ranks are [points, roman, name].
export function rankFor(xp, { founder = false, manualRank = null } = {}) {
  if (founder) return [[null, 'X', 'Основатель SQUAD'], null];
  if (manualRank != null) {
    const rank = RANKS.find((r) => r[1] === manualRank);
    if (!rank) throw new XpError('Manual rank must be I–IX');
    return [rank, null];
  }
  let index = 0;
  RANKS.forEach((r, i) => { if (xp >= r[0]) index = i; });
  return [RANKS[index], index + 1 < RANKS.length ? RANKS[index + 1] : null];
}

function validInt(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new XpError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

// Bonus XP (daily reward, quests, achievements, ...) from lib/club.js.
// Stored in `events` with chat_id = 0 and message_id = the reward's key.
export const BONUS_KINDS = new Set(['daily', 'quest', 'achievement', 'referral', 'invited', 'birthday', 'poll', 'weekly', 'farm', 'gift', 'casino', 'season']);

async function points(userId, start, end) {
  const row = await db.get(sql`SELECT COALESCE(SUM(points), 0) AS s FROM events
    WHERE user_id = ${userId} AND earned_at >= ${start} AND earned_at < ${end}`);
  return row ? row.s : 0;
}

// Comments and reactions only: the daily limit does not include bonuses.
async function activityPoints(userId, start, end) {
  const row = await db.get(sql`SELECT COALESCE(SUM(points), 0) AS s FROM events
    WHERE user_id = ${userId} AND kind IN ('comment', 'reaction') AND earned_at >= ${start} AND earned_at < ${end}`);
  return row ? row.s : 0;
}

async function withActivity(row) {
  if (!row) return null;
  const ts = nowInt();
  return {
    ...row,
    today: await activityPoints(row.user_id, dayStart(ts), ts + 1),
    week: await points(row.user_id, weekStart(ts), ts + 1),
  };
}

async function upsertProfile(user) {
  validInt(user.id, 'user_id', 1);
  await db.run(sql`INSERT INTO profiles (user_id, name, username) VALUES
    (${user.id}, ${truncate(fullName(user), 100)}, ${truncate(user.username || '', 40)})
    ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, username = excluded.username`);
}

export async function getProfile(userId) {
  validInt(userId, 'user_id', 1);
  return withActivity(await db.get(sql`SELECT * FROM profiles WHERE user_id = ${userId}`));
}

export async function profile(user) {
  await upsertProfile(user);
  return getProfile(user.id);
}

export async function listProfiles(limit = 6, offset = 0) {
  const rows = await db.all(sql`SELECT * FROM profiles ORDER BY name COLLATE NOCASE, user_id
    LIMIT ${limit} OFFSET ${offset}`);
  const result = [];
  for (const row of rows) result.push(await withActivity(row));
  return result;
}

// Every participant without activity totals, for the owner's Mini App panel.
export async function allProfiles() {
  return db.all(sql`SELECT user_id, name, username, xp, manual_rank FROM profiles`);
}

export async function profileCount() {
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM profiles`);
  return row ? row.c : 0;
}

// Profiles whose current or bot-known username matches (case-insensitive).
export async function findProfiles(username) {
  username = String(username).trim().replace(/^@+/, '').toLowerCase();
  if (!username || username.length > 40) throw new XpError('Username must contain 1–40 characters');
  const rows = await db.all(sql`SELECT * FROM profiles WHERE lower(username) = ${username}
    OR user_id IN (SELECT user_id FROM users WHERE lower(username) = ${username})
    ORDER BY user_id`);
  const result = [];
  for (const row of rows) result.push(await withActivity(row));
  return result;
}

// Users who opened the bot become participants without overwriting newer names.
export async function syncKnownUsers() {
  await db.run(sql`INSERT OR IGNORE INTO profiles (user_id, name, username)
    SELECT user_id,
      substr(COALESCE(NULLIF(trim(first_name), ''), NULLIF(username, ''), CAST(user_id AS TEXT)), 1, 100),
      substr(COALESCE(username, ''), 1, 40)
    FROM users WHERE user_id > 0`);
}

export async function adminHistory(userId, limit = 5) {
  return db.all(sql`SELECT id, user_id, actor_id, operation_id, action, before_xp, after_xp,
      before_rank, after_rank, created_at
    FROM admin_changes WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${limit}`);
}

async function adminChange(userId, value, { actorId, ownerId, operationId, action }) {
  for (const [label, id] of [['user_id', userId], ['actor_id', actorId], ['owner_id', ownerId]]) {
    validInt(id, label, 1);
  }
  if (actorId !== ownerId) throw new XpError('Only the owner may manage ranks and XP', 'permission');
  if (userId === ownerId) throw new XpError("The founder's profile is protected", 'permission');
  if (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 100) {
    throw new XpError('Operation ID must contain 1–100 characters');
  }
  const requestValue = action === 'adjust_xp' ? String(value) : (value || 'auto');

  const previous = await db.get(sql`SELECT * FROM admin_changes WHERE operation_id = ${operationId}`);
  if (previous) {
    if (previous.user_id !== userId || previous.actor_id !== actorId || previous.action !== action ||
        previous.request_value !== requestValue) {
      throw new XpError('Operation ID was already used for a different change');
    }
    return { profile: await getProfile(userId), change: previous, applied: false };
  }
  const current = await db.get(sql`SELECT * FROM profiles WHERE user_id = ${userId}`);
  if (!current) throw new XpError('Participant not found', 'lookup');
  const beforeXp = current.xp;
  const beforeRank = current.manual_rank ?? null;
  let afterXp = beforeXp;
  let afterRank = beforeRank;
  if (action === 'adjust_xp') {
    afterXp = Math.max(0, beforeXp + value);
    validInt(afterXp, 'XP', 0, MAX_XP);
  } else {
    afterRank = value ?? null;
  }
  // Compare-and-set instead of a transaction: a concurrent award or change
  // makes the update miss, and nothing is written.
  const updated = await db.run(sql`UPDATE profiles SET xp = ${afterXp}, manual_rank = ${afterRank}
    WHERE user_id = ${userId} AND xp = ${beforeXp} AND manual_rank IS ${beforeRank}`);
  if (updated.rowsAffected !== 1) {
    throw new XpError('Данные участника изменились. Повтори действие.', 'conflict');
  }
  const inserted = await db.run(sql`INSERT INTO admin_changes
      (user_id, actor_id, operation_id, action, request_value, before_xp, after_xp, before_rank, after_rank, created_at)
    VALUES (${userId}, ${actorId}, ${operationId}, ${action}, ${requestValue}, ${beforeXp}, ${afterXp},
      ${beforeRank}, ${afterRank}, ${nowInt()})
    ON CONFLICT(operation_id) DO NOTHING RETURNING *`);
  const change = inserted.rows && inserted.rows[0];
  return { profile: await getProfile(userId), change, applied: true };
}

export async function adjustXp(userId, delta, opts) {
  validInt(delta, 'XP adjustment', -MAX_XP, MAX_XP);
  return adminChange(userId, delta, { ...opts, action: 'adjust_xp' });
}

export async function setManualRank(userId, roman, opts) {
  if (roman != null && (typeof roman !== 'string' || !ROMANS.has(roman))) {
    throw new XpError('Manual rank must be I–IX or None');
  }
  return adminChange(userId, roman, { ...opts, action: 'set_manual_rank' });
}

// Tops show the nick («+ник») instead of the Telegram name.
const TOP_COLUMNS = sql.raw('p.user_id, p.username, p.xp, p.manual_rank, COALESCE((SELECT nick FROM nicks n WHERE n.user_id = p.user_id), p.name) AS name');

export async function leaderboard({ weekly = false, limit = 10 } = {}) {
  if (weekly) {
    const ts = nowInt();
    return db.all(sql`SELECT ${TOP_COLUMNS}, SUM(e.points) AS score FROM profiles p JOIN events e ON e.user_id = p.user_id
      WHERE e.earned_at >= ${weekStart(ts)} AND e.earned_at <= ${ts} AND e.kind IN ('comment', 'reaction')
      GROUP BY p.user_id HAVING score > 0 ORDER BY score DESC, p.user_id LIMIT ${limit}`);
  }
  return db.all(sql`SELECT ${TOP_COLUMNS}, p.xp AS score FROM profiles p WHERE p.xp > 0
    ORDER BY score DESC, p.user_id LIMIT ${limit}`);
}

export async function messageRecord(chatId, messageId) {
  return db.get(sql`SELECT * FROM messages WHERE chat_id = ${chatId} AND message_id = ${messageId}`);
}

export function isChannelRoot(message, channelId) {
  const origin = message && message.forward_origin;
  return Boolean(message && message.is_automatic_forward && origin && origin.type === 'channel' &&
    origin.chat && origin.chat.id === channelId);
}

// Only map comments belonging to an actual SQUAD discussion thread.
export async function rememberMessage(message, channelId) {
  const chatId = message.chat.id;
  const messageId = message.message_id;
  let rootId = null;
  if (isChannelRoot(message, channelId)) {
    rootId = messageId;
  } else {
    const known = await messageRecord(chatId, messageId);
    if (known) rootId = known.root_id;
    const reply = message.reply_to_message;
    if (reply) {
      if (isChannelRoot(reply, channelId)) {
        await rememberMessage(reply, channelId);
        rootId = reply.message_id;
      } else {
        const parent = await messageRecord(chatId, reply.message_id);
        if (parent) rootId = parent.root_id;
      }
    }
    if (!rootId && message.message_thread_id) {
      const thread = await messageRecord(chatId, message.message_thread_id);
      if (thread) rootId = thread.root_id;
    }
    if (!rootId) return null;
  }
  const user = message.from;
  const authorId = user && !message.sender_chat && !isChannelRoot(message, channelId) ? user.id : null;
  await db.run(sql`INSERT OR IGNORE INTO messages (chat_id, message_id, root_id, author_id)
    VALUES (${chatId}, ${messageId}, ${rootId}, ${authorId})`);
  return rootId;
}

// One decision per action, including denied attempts.
export async function award(user, chatId, messageId, kind, timestamp) {
  if ((kind !== 'comment' && kind !== 'reaction') || !user || user.is_bot) return null;
  const ts = nowInt();
  timestamp = Math.floor(timestamp);
  // Telegram keeps queued updates for up to 24 hours; reject invalid dates.
  if (timestamp > ts + 60 || timestamp < ts - 86400) return null;
  await upsertProfile(user);
  const row = await db.get(sql`SELECT xp, manual_rank FROM profiles WHERE user_id = ${user.id}`);
  const total = row.xp;
  const manualRank = row.manual_rank ?? null;
  const seen = await db.get(sql`SELECT 1 AS x FROM events WHERE user_id = ${user.id} AND chat_id = ${chatId}
    AND message_id = ${messageId} AND kind = ${kind}`);
  if (seen) return null;
  const start = dayStart(timestamp);
  const end = start + 86400;
  const pts = kind === 'comment' ? COMMENT_XP : REACTION_XP;
  // The primary key makes a redelivered update a no-op even under concurrency.
  const inserted = await db.run(sql`INSERT OR IGNORE INTO events (user_id, chat_id, message_id, kind, points, earned_at)
    VALUES (${user.id}, ${chatId}, ${messageId}, ${kind}, 0, ${timestamp})`);
  if (inserted.rowsAffected !== 1) return null;
  // Limits are checked inside one UPDATE, so parallel updates cannot all pass them.
  const limit = kind === 'reaction'
    ? sql`(SELECT COUNT(*) FROM events WHERE user_id = ${user.id} AND kind = 'reaction' AND points > 0
        AND earned_at >= ${start} AND earned_at < ${end}) < ${DAILY_REACTION_LIMIT}`
    : sql`NOT EXISTS (SELECT 1 FROM events WHERE user_id = ${user.id} AND kind = 'comment' AND points > 0
        AND earned_at > ${timestamp - COMMENT_COOLDOWN})`;
  const granted = await db.run(sql`UPDATE events SET points = ${pts}
    WHERE user_id = ${user.id} AND chat_id = ${chatId} AND message_id = ${messageId} AND kind = ${kind}
      AND (SELECT COALESCE(SUM(points), 0) FROM events WHERE user_id = ${user.id}
        AND kind IN ('comment', 'reaction') AND earned_at >= ${start} AND earned_at < ${end}) + ${pts} <= ${DAILY_XP_LIMIT}
      AND (SELECT xp FROM profiles WHERE user_id = ${user.id}) + ${pts} <= ${MAX_XP}
      AND ${limit}`);
  if (granted.rowsAffected !== 1) return null;
  await db.run(sql`UPDATE profiles SET xp = xp + ${pts} WHERE user_id = ${user.id}`);
  const oldRank = rankFor(total, { manualRank })[0];
  const newRank = rankFor(total + pts, { manualRank })[0];
  return { points: pts, total: total + pts, oldRank, newRank, promoted: oldRank !== newRank };
}

// Bonus XP, once per (kind, key). `user` is a Telegram user or a user ID of an
// existing participant. Returns null when this reward was already given.
export async function grant(user, kind, key, pts, timestamp = nowInt()) {
  if (!BONUS_KINDS.has(kind)) throw new XpError(`Unknown bonus kind ${kind}`);
  validInt(key, 'reward key', 0);
  validInt(pts, 'points', 0, 10000);
  const userId = typeof user === 'object' ? user.id : user;
  validInt(userId, 'user_id', 1);
  if (typeof user === 'object') {
    if (user.is_bot) return null;
    await upsertProfile(user);
  } else {
    await db.run(sql`INSERT OR IGNORE INTO profiles (user_id, name) VALUES (${userId}, ${String(userId)})`);
  }
  const row = await db.get(sql`SELECT xp, manual_rank FROM profiles WHERE user_id = ${userId}`);
  const total = row.xp;
  pts = Math.max(0, Math.min(pts, MAX_XP - total));
  const inserted = await db.run(sql`INSERT OR IGNORE INTO events (user_id, chat_id, message_id, kind, points, earned_at)
    VALUES (${userId}, 0, ${key}, ${kind}, ${pts}, ${Math.floor(timestamp)})`);
  if (inserted.rowsAffected !== 1) return null;
  if (pts) await db.run(sql`UPDATE profiles SET xp = xp + ${pts} WHERE user_id = ${userId}`);
  const manualRank = row.manual_rank ?? null;
  const oldRank = rankFor(total, { manualRank })[0];
  const newRank = rankFor(total + pts, { manualRank })[0];
  return { points: pts, total: total + pts, oldRank, newRank, promoted: oldRank !== newRank };
}

// «фарм» in the chat: random XP once per FARM_COOLDOWN, outside the daily limit.
export const FARM_COOLDOWN = 3600;
export const FARM_MAX = 100;
export const FARM_RARE_MAX = 200;
export const FARM_RARE_CHANCE = 0.1;

export function farmRoll(random = Math.random) {
  if (random() < FARM_RARE_CHANCE) return FARM_MAX + 1 + Math.floor(random() * (FARM_RARE_MAX - FARM_MAX));
  return 1 + Math.floor(random() * FARM_MAX);
}

// → the award, or { wait } seconds until the next farm. The cooldown is checked
// inside the insert, so parallel messages cannot farm twice.
export async function farm(user, pts, ts = nowInt()) {
  if (!user || user.is_bot) return null;
  validInt(pts, 'points', 1, FARM_RARE_MAX);
  await upsertProfile(user);
  const row = await db.get(sql`SELECT xp, manual_rank FROM profiles WHERE user_id = ${user.id}`);
  const total = row.xp;
  pts = Math.min(pts, MAX_XP - total);
  const inserted = await db.run(sql`INSERT OR IGNORE INTO events (user_id, chat_id, message_id, kind, points, earned_at)
    SELECT ${user.id}, 0, ${ts}, 'farm', ${pts}, ${ts}
    WHERE NOT EXISTS (SELECT 1 FROM events WHERE user_id = ${user.id} AND kind = 'farm' AND earned_at > ${ts - FARM_COOLDOWN})`);
  if (inserted.rowsAffected !== 1) {
    const last = await db.get(sql`SELECT MAX(earned_at) AS at FROM events WHERE user_id = ${user.id} AND kind = 'farm'`);
    return { wait: Math.max(1, (last && last.at ? last.at : ts) + FARM_COOLDOWN - ts) };
  }
  if (pts) await db.run(sql`UPDATE profiles SET xp = xp + ${pts} WHERE user_id = ${user.id}`);
  const manualRank = row.manual_rank ?? null;
  const oldRank = rankFor(total, { manualRank })[0];
  const newRank = rankFor(total + pts, { manualRank })[0];
  return { points: pts, total: total + pts, oldRank, newRank, promoted: oldRank !== newRank };
}

export async function comment(message, channelId) {
  const rootId = await rememberMessage(message, channelId);
  if (!rootId || isChannelRoot(message, channelId)) return null;
  if (message.sender_chat || message.forward_origin) return null;
  // At least five letters/digits: commands, stickers and emoji spam earn nothing.
  const text = String(message.text || message.caption || '').trim();
  if (text.startsWith('/') || countAlnum(text) < 5) return null;
  return award(message.from, message.chat.id, message.message_id, 'comment', message.date);
}

export async function reaction(event) {
  const user = event.user;
  if (!user || event.actor_chat || !(event.new_reaction && event.new_reaction.length)) return null;
  // Changing an existing emoji doesn't constitute a new reaction.
  if (event.old_reaction && event.old_reaction.length) return null;
  const message = await messageRecord(event.chat.id, event.message_id);
  if (!message || message.author_id === user.id) return null;
  return award(user, event.chat.id, event.message_id, 'reaction', event.date);
}
