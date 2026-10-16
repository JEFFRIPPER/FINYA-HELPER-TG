// Reputation, marriages and RP actions of the Squad chats.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { nowInt, truncate } from './util.js';

const DAY = 86400;

// ---- reputation ----------------------------------------------------------------

// «+» kept long enough to catch a redelivered update; older rows are dropped.
const REP_VOTE_KEEP = 3 * DAY;

// No daily limit: every «+» counts. Returns the new total, or null for a repeat of the same message.
export async function plus(chatId, messageId, fromId, toId) {
  const ts = nowInt();
  const vote = await db.run(sql`INSERT OR IGNORE INTO rep_votes (chat_id, message_id, from_id, to_id, at)
    VALUES (${chatId}, ${messageId}, ${fromId}, ${toId}, ${ts})`);
  if (vote.rowsAffected !== 1) return null;
  const r = await db.run(sql`INSERT INTO reputation (user_id, points, given) VALUES (${toId}, 1, 0)
    ON CONFLICT(user_id) DO UPDATE SET points = points + 1 RETURNING points`);
  await db.run(sql`INSERT INTO reputation (user_id, points, given) VALUES (${fromId}, 0, 1)
    ON CONFLICT(user_id) DO UPDATE SET given = given + 1`);
  await db.run(sql`DELETE FROM rep_votes WHERE at < ${ts - REP_VOTE_KEEP}`);
  return r.rows[0].points;
}

export async function repOf(userId) {
  const row = await db.get(sql`SELECT points, given FROM reputation WHERE user_id = ${userId}`);
  return row || { points: 0, given: 0 };
}

// ---- marriages -----------------------------------------------------------------

export const PROPOSAL_TTL = 3600;

export class SocialError extends Error {}

export async function spouseOf(userId) {
  return db.get(sql`SELECT partner_id, since FROM spouses WHERE user_id = ${userId}`);
}

export const marriedDays = (since, ts = nowInt()) => Math.max(0, Math.floor((ts - since) / DAY));

// A proposal waits for the other one's button for an hour.
export async function propose(chatId, fromId, toId) {
  if (fromId === toId) throw new SocialError('Жениться на себе нельзя, даже в Скваде 😏');
  if (await spouseOf(fromId)) throw new SocialError('Ты уже в браке. Сначала «Развод».');
  if (await spouseOf(toId)) throw new SocialError('Этот участник уже в браке.');
  await db.run(sql`INSERT INTO proposals (from_id, to_id, chat_id, message_id, created_at)
    VALUES (${fromId}, ${toId}, ${chatId}, NULL, ${nowInt()})
    ON CONFLICT(from_id, to_id) DO UPDATE SET chat_id = excluded.chat_id, message_id = NULL,
      created_at = excluded.created_at`);
}

export async function setProposalMessage(fromId, toId, messageId) {
  await db.run(sql`UPDATE proposals SET message_id = ${messageId} WHERE from_id = ${fromId} AND to_id = ${toId}`);
}

// The proposal is claimed by deleting it, so two taps cannot marry twice.
async function takeProposal(fromId, toId) {
  const r = await db.run(sql`DELETE FROM proposals WHERE from_id = ${fromId} AND to_id = ${toId}
    AND created_at >= ${nowInt() - PROPOSAL_TTL} RETURNING from_id`);
  return r.rowsAffected === 1;
}

export async function accept(fromId, toId) {
  if (!(await takeProposal(fromId, toId))) throw new SocialError('Предложение уже не действует.');
  const ts = nowInt();
  // Both rows in one statement, and only if neither of them married meanwhile.
  const r = await db.run(sql`INSERT INTO spouses (user_id, partner_id, since)
    SELECT u, p, s FROM (SELECT ${fromId} AS u, ${toId} AS p, ${ts} AS s UNION ALL SELECT ${toId}, ${fromId}, ${ts})
    WHERE NOT EXISTS (SELECT 1 FROM spouses WHERE user_id IN (${fromId}, ${toId}))`);
  if (r.rowsAffected !== 2) throw new SocialError('Кто-то из вас уже успел вступить в брак.');
  await db.run(sql`DELETE FROM proposals WHERE from_id IN (${fromId}, ${toId}) OR to_id IN (${fromId}, ${toId})`);
  return ts;
}

export async function decline(fromId, toId) {
  return takeProposal(fromId, toId);
}

// → true when this marriage existed and is over now.
export async function divorce(userId, partnerId) {
  const r = await db.run(sql`DELETE FROM spouses
    WHERE (user_id = ${userId} AND partner_id = ${partnerId}) OR (user_id = ${partnerId} AND partner_id = ${userId})`);
  return r.rowsAffected > 0;
}

// Couples, the longest together first.
export async function couples(limit = 15) {
  return db.all(sql`SELECT user_id AS a, partner_id AS b, since FROM spouses
    WHERE user_id < partner_id ORDER BY since, user_id LIMIT ${limit}`);
}

export async function coupleCount() {
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM spouses WHERE user_id < partner_id`);
  return row.c;
}

// ---- RP actions ----------------------------------------------------------------

// command → what the actor does to the target (present tense: no he/she guessing).
export const RP_ACTIONS = {
  'обнять': '🤗 обнимает',
  'прижать': '🫂 прижимает к себе',
  'поцеловать': '😘 целует',
  'чмок': '😚 чмокает',
  'погладить': '✋ гладит',
  'пожалеть': '🥺 жалеет',
  'похвалить': '👏 хвалит',
  'поздравить': '🎉 поздравляет',
  'пожать руку': '🤝 жмёт руку',
  'дать пять': '🙌 даёт пять',
  'подарить цветы': '💐 дарит цветы',
  'угостить чаем': '☕ угощает чаем',
  'покормить': '🍕 кормит',
  'тыкнуть': '👉 тыкает',
  'понюхать': '👃 нюхает',
  'укусить': '😬 кусает',
  'кусь': '😼 делает кусь',
  'лизнуть': '👅 лижет',
  'шлепнуть': '🍑 шлёпает',
  'ударить': '👊 бьёт',
  'пнуть': '🦶 пинает',
  'убить': '🔪 убивает',
  'уничтожить': '💥 уничтожает',
};

export const RP_LIMIT = 100;

export async function customActions() {
  return db.all(sql`SELECT cmd, action FROM rp_actions ORDER BY cmd`);
}

// Owner's own actions win over built-in ones with the same command.
export async function allActions() {
  const map = new Map(Object.entries(RP_ACTIONS));
  for (const r of await customActions()) map.set(r.cmd, r.action);
  return map;
}

export const normalizeCmd = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export async function addAction(cmd, action) {
  cmd = normalizeCmd(cmd);
  action = String(action || '').replace(/\s+/g, ' ').trim();
  if (!/^[\p{L}][\p{L} -]{0,29}$/u.test(cmd)) throw new SocialError('Команда: 1–30 букв, например «Пощекотать».');
  if (!action || Array.from(action).length > 60) throw new SocialError('Действие: 1–60 символов, например «щекочет 🤭».');
  const count = await db.get(sql`SELECT COUNT(*) AS c FROM rp_actions`);
  const exists = await db.get(sql`SELECT 1 AS x FROM rp_actions WHERE cmd = ${cmd}`);
  if (!exists && count.c >= RP_LIMIT) throw new SocialError(`Своих действий уже ${RP_LIMIT}. Удали лишние: «-РП Команда».`);
  await db.run(sql`INSERT INTO rp_actions (cmd, action, created_at) VALUES (${cmd}, ${truncate(action, 60)}, ${nowInt()})
    ON CONFLICT(cmd) DO UPDATE SET action = excluded.action`);
  return cmd;
}

export async function removeAction(cmd) {
  const r = await db.run(sql`DELETE FROM rp_actions WHERE cmd = ${normalizeCmd(cmd)}`);
  return r.rowsAffected === 1;
}

// The longest command the text starts with → { cmd, action, rest }.
export async function matchAction(text) {
  const t = normalizeCmd(text);
  const map = await allActions();
  const cmds = [...map.keys()].sort((a, b) => b.length - a.length);
  for (const cmd of cmds) {
    if (t === cmd || t.startsWith(cmd + ' ')) {
      const rest = String(text).trim().split(/\s+/).slice(cmd.split(' ').length).join(' ');
      return { cmd, action: map.get(cmd), rest };
    }
  }
  return null;
}
