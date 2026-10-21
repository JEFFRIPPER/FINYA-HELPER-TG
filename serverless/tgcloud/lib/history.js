// The chat's past from a Telegram Desktop export (result.json). Bots can't read a
// chat's history, admin or not, so the owner exports it and the Mini App reads the
// file on the device: only "who wrote how much on which day" reaches Финя.
// Importing again is safe: a day keeps the larger of the two counts, so days Финя
// already counted herself are not doubled.
import { api, BotApiError, db } from 'sdk';
import { sql } from 'sdk/db';
import { mskDay, nameOfUser, TELEGRAM_SERVICE_ID } from './members.js';
import { nowInt, truncate } from './util.js';

export const MAX_USERS = 50;
export const MAX_DAYS = 4000;
const MAX_PER_DAY = 100000;
// Telegram launched in August 2013: nothing in a chat is older.
const EPOCH = Date.UTC(2013, 7, 1) / 1000;
const INSERT_ROWS = 200;

export class HistoryError extends Error {
  constructor(message, code = 'HISTORY') {
    super(message);
    this.code = code;
  }
}

// The export names a chat without the Bot API's minus (and -100 for supergroups).
export function chatIdOf(exportId, type) {
  const id = Number(exportId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HistoryError('В файле нет ID чата. Нужен экспорт одного чата в формате JSON.');
  if (type === 'private_group') return -id;
  if (type === 'private_supergroup' || type === 'public_supergroup') return -(1e12 + id);
  throw new HistoryError('Это не экспорт группы. Выгрузи историю самого чата Сквада.');
}

// → { id, title } of a chat Финя is in.
export async function chatInfo(exportId, type) {
  const chatId = chatIdOf(exportId, type);
  try {
    const chat = await api.getChat({ chat_id: chatId });
    return { id: chatId, title: truncate(chat.title || 'Чат', 100) };
  } catch (err) {
    if (err instanceof BotApiError && err.code !== 429) {
      throw new HistoryError('Финя не состоит в этом чате. Добавь её туда и повтори.');
    }
    throw busy(err);
  }
}

function busy(err) {
  if (err instanceof BotApiError && err.code === 429) return new HistoryError('Telegram просит паузу. Продолжу через минуту.', 'RETRY');
  return err;
}

// Someone Финя hasn't seen in the chat: a bot is skipped, whoever left stays out of the lists.
async function lookup(chatId, userId) {
  try {
    const m = await api.getChatMember({ chat_id: chatId, user_id: userId });
    const inside = ['member', 'administrator', 'creator'].includes(m.status) || (m.status === 'restricted' && m.is_member);
    return { bot: Boolean(m.user && m.user.is_bot), status: inside ? 'member' : 'left', user: m.user || null };
  } catch (err) {
    // Deleted accounts and people Telegram no longer knows in this chat.
    if (err instanceof BotApiError && err.code === 400) return { bot: false, status: 'left', user: null };
    throw busy(err);
  }
}

const int = (v) => (Number.isSafeInteger(v) ? v : null);

function check(chatId, users, ts) {
  if (!Number.isSafeInteger(chatId) || chatId >= 0) throw new HistoryError('Неизвестный чат.');
  if (!Array.isArray(users) || !users.length || users.length > MAX_USERS) throw new HistoryError('Неверная пачка данных.');
  const today = mskDay(ts);
  let rows = 0;
  return users.map((u) => {
    const id = int(u && u.id);
    const first = int(u && u.first);
    const last = int(u && u.last);
    if (!id || id < 1 || first == null || last == null || first < EPOCH || last < first || last > ts + 86400 || !Array.isArray(u.days)) {
      throw new HistoryError('Неверная пачка данных.');
    }
    const days = new Map();
    for (const pair of u.days) {
      const day = int(Array.isArray(pair) ? pair[0] : null);
      const n = int(Array.isArray(pair) ? pair[1] : null);
      if (day == null || n == null || n < 1 || n > MAX_PER_DAY || day < mskDay(EPOCH) || day > today) {
        throw new HistoryError('Неверная пачка данных.');
      }
      days.set(day, n);
    }
    rows += days.size;
    if (rows > MAX_DAYS) throw new HistoryError('Слишком большая пачка данных.');
    return { id, first, last: Math.min(last, ts), name: truncate(String(u.name || ''), 100), days };
  });
}

async function upsertDays(chatId, userId, rows) {
  for (let i = 0; i < rows.length; i += INSERT_ROWS) {
    let values = null;
    for (const [day, n] of rows.slice(i, i + INSERT_ROWS)) {
      const tuple = sql`(${chatId}, ${userId}, ${day}, ${n})`;
      values = values ? sql`${values}, ${tuple}` : tuple;
    }
    await db.run(sql`INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES ${values}
      ON CONFLICT(chat_id, day, user_id) DO UPDATE SET msgs = MAX(msgs, excluded.msgs)`);
  }
}

// One batch of members from the export: messages per day, first and last seen.
// → { added, members, skipped }: messages added, new members, bots left out.
export async function importUsers(chatId, users, ts = nowInt()) {
  const list = check(chatId, users, ts);
  let added = 0;
  let members = 0;
  let skipped = 0;
  for (const u of list) {
    if (u.id === TELEGRAM_SERVICE_ID) {
      skipped++;
      continue;
    }
    const known = await db.get(sql`SELECT 1 AS x FROM chat_members WHERE chat_id = ${chatId} AND user_id = ${u.id}`);
    if (!known) {
      const m = await lookup(chatId, u.id);
      if (m.bot) {
        skipped++;
        continue;
      }
      const name = m.user ? nameOfUser(m.user) : u.name || String(u.id);
      const username = m.user ? truncate(m.user.username || '', 40) : '';
      await db.run(sql`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
        VALUES (${chatId}, ${u.id}, ${name}, ${username}, ${m.status}, ${u.first}, ${u.last}, 0)
        ON CONFLICT(chat_id, user_id) DO NOTHING`);
      members++;
    }
    const have = new Map((await db.all(sql`SELECT day, msgs FROM chat_activity
      WHERE chat_id = ${chatId} AND user_id = ${u.id}`)).map((r) => [r.day, r.msgs]));
    const rows = [...u.days].filter(([day, n]) => n > (have.get(day) || 0));
    const delta = rows.reduce((s, [day, n]) => s + n - (have.get(day) || 0), 0);
    await upsertDays(chatId, u.id, rows);
    await db.run(sql`UPDATE chat_members SET msgs = msgs + ${delta},
      first_seen = MIN(first_seen, ${u.first}), last_active = MAX(last_active, ${u.last})
      WHERE chat_id = ${chatId} AND user_id = ${u.id}`);
    added += delta;
  }
  return { added, members, skipped };
}
