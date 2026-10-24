// «Обновить инфо» without the Mini App: the owner sends result.json to Финя in the
// private chat. Bots may download files only up to 20 MB, so bigger exports still go
// through the Mini App. The file is counted at once; its batches are imported within
// this call's time and then from pump(), with the progress in one edited message.
import { api, BotApiError, db } from 'sdk';
import { sql } from 'sdk/db';
import { WEBAPP_URL } from './config.js';
import { chatInfo, HistoryError, importUsers, MAX_DAYS, MAX_USERS } from './history.js';
import { logError } from './store.js';
import { button, keyboard } from './tg.js';
import { boldHtml, escapeHtml, fmtThousands, MSK_OFFSET, nowInt, plural, truncate, utf8Decode } from './util.js';

export const FILE_MAX = 20 * 1024 * 1024;
const LEASE = 90;
// Joins count for «since when», as in the Mini App.
const JOINS = { join_group_by_link: true, join_group_by_request: true };

export function looksLikeChatExport(document) {
  const name = String(document.file_name || '').toLowerCase();
  return name.endsWith('.json') && !name.startsWith('finya-export');
}

// The export → who wrote how much on which Moscow day (the Mini App's scanExport).
export function scan(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) {
    throw new HistoryError('Это не экспорт чата. Нужен result.json из Telegram Desktop в формате «Машиночитаемый JSON».');
  }
  const users = new Map();
  let total = 0;
  let fromDay = Infinity;
  let toDay = -Infinity;
  for (const m of data.messages) {
    if (!m || (m.type !== 'message' && !(m.type === 'service' && JOINS[m.action]))) continue;
    const who = /^user(\d+)$/.exec(String((m.type === 'message' ? m.from_id : m.actor_id) || ''));
    if (!who) continue;
    const ts = Number(m.date_unixtime) || Math.floor(Date.parse(m.date) / 1000);
    if (!ts) continue;
    let u = users.get(who[1]);
    if (!u) {
      u = { id: Number(who[1]), name: '', first: ts, last: ts, msgs: 0, days: new Map() };
      users.set(who[1], u);
    }
    if (ts < u.first) u.first = ts;
    if (m.type !== 'message') continue;
    if (typeof m.from === 'string' && m.from) u.name = m.from;
    if (ts > u.last || !u.msgs) u.last = ts;
    const day = Math.floor((ts + MSK_OFFSET) / 86400);
    u.days.set(day, (u.days.get(day) || 0) + 1);
    u.msgs++;
    total++;
    if (day < fromDay) fromDay = day;
    if (day > toDay) toDay = day;
  }
  return {
    chat: { id: data.id, type: data.type },
    users: [...users.values()].filter((u) => u.msgs > 0),
    total, fromDay, toDay,
  };
}

// Batches importUsers accepts: up to 50 members and 4000 days each.
export function chunksOf(users) {
  const chunks = [];
  let cur = [];
  let rows = 0;
  for (const u of users) {
    const days = [...u.days];
    for (let i = 0; i < days.length; i += MAX_DAYS) {
      const part = days.slice(i, i + MAX_DAYS);
      if (cur.length >= MAX_USERS || rows + part.length > MAX_DAYS) {
        chunks.push(cur);
        cur = [];
        rows = 0;
      }
      cur.push({ id: u.id, name: truncate(u.name, 100), first: u.first, last: u.last, days: part });
      rows += part.length;
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1).replace('.', ',');

function dayText(day) {
  const d = new Date(day * 86400 * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

async function tell(chatId, text, extra = {}) {
  return api.sendMessage({ chat_id: chatId, text: boldHtml(text), parse_mode: 'HTML', ...extra });
}

async function tooBig(chatId, size) {
  await tell(chatId, `📥 Файл${size ? ` ${mb(size)} МБ` : ' слишком большой'}: Telegram отдаёт ботам файлы только до 20 МБ.\n` +
    'Загрузи его через Mini App, там размер не важен.', {
    reply_markup: keyboard([[button('📥 Открыть загрузку', { web_app: { url: `${WEBAPP_URL}?tab=admin&open=history` } })]]),
  });
}

const running = () => db.get(sql`SELECT * FROM history_imports WHERE finished_at IS NULL ORDER BY id LIMIT 1`);

// The owner sent a .json in the private chat.
export async function fromMessage(message, leftMs) {
  const doc = message.document;
  const chatId = message.chat.id;
  if (doc.file_size > FILE_MAX) {
    await tooBig(chatId, doc.file_size);
    return;
  }
  const busy = await running();
  if (busy) {
    await tell(chatId, `⏳ Ещё идёт загрузка «${escapeHtml(busy.title)}»: ${busy.done} из ${busy.chunks}. Пришли файл, когда она закончится.`);
    return;
  }
  await api.sendChatAction({ chat_id: chatId, action: 'typing' }).catch(() => {});
  let data;
  try {
    data = JSON.parse(utf8Decode(await api.getFileContent(doc.file_id)));
  } catch (err) {
    if (err instanceof SyntaxError) {
      await tell(chatId, '❌ Не получилось прочитать файл как JSON. Нужен result.json из Telegram Desktop, формат «Машиночитаемый JSON».');
      return;
    }
    if (err instanceof BotApiError && /too big/i.test(String(err.description || err.message))) {
      await tooBig(chatId, doc.file_size);
      return;
    }
    throw err;
  }
  try {
    const s = scan(data);
    data = null;
    if (!s.total) throw new HistoryError('В файле нет сообщений участников.');
    const chat = await chatInfo(s.chat.id, s.chat.type);
    const chunks = chunksOf(s.users);
    const progress = await tell(chatId,
      `📥 «${escapeHtml(chat.title)}»: ${fmtThousands(s.total)} ${plural(s.total, 'сообщение', 'сообщения', 'сообщений')} от ${fmtThousands(s.users.length)} ${plural(s.users.length, 'человека', 'человек', 'человек')}, ` +
      `${dayText(s.fromDay)}–${dayText(s.toDay)}.\n⏳ Загружаю: 0 из ${chunks.length}…`);
    const row = await db.run(sql`INSERT INTO history_imports (chat_id, title, report_chat_id, progress_message_id, chunks, created_at)
      VALUES (${chat.id}, ${chat.title}, ${chatId}, ${progress ? progress.message_id : null}, ${chunks.length}, ${nowInt()})
      RETURNING id`);
    const id = row.rows[0].id;
    for (const c of chunks) {
      await db.run(sql`INSERT INTO history_queue (import_id, users) VALUES (${id}, ${JSON.stringify(c)})`);
    }
  } catch (err) {
    if (!(err instanceof HistoryError)) throw err;
    await tell(chatId, `❌ ${escapeHtml(err.message)}`);
    return;
  }
  await work(leftMs);
}

async function finish(job, text) {
  const won = await db.run(sql`UPDATE history_imports SET finished_at = ${nowInt()} WHERE id = ${job.id} AND finished_at IS NULL`);
  if (won.rowsAffected !== 1) return;
  await db.run(sql`DELETE FROM history_queue WHERE import_id = ${job.id}`);
  try {
    await tell(job.report_chat_id, text);
  } catch (err) {
    await logError('history.file', err);
  }
}

// Batches of the running import while the call has time; from fromMessage and pump().
export async function work(leftMs) {
  const job = await running();
  if (!job) return;
  let did = 0;
  while (leftMs() > 8000) {
    const ts = nowInt();
    const next = await db.get(sql`SELECT id, users FROM history_queue
      WHERE import_id = ${job.id} AND lease_until < ${ts} ORDER BY id LIMIT 1`);
    if (!next) break;
    const claimed = await db.run(sql`UPDATE history_queue SET lease_until = ${ts + LEASE}
      WHERE id = ${next.id} AND lease_until < ${ts}`);
    if (claimed.rowsAffected !== 1) continue;
    let r;
    try {
      r = await importUsers(job.chat_id, JSON.parse(next.users));
    } catch (err) {
      // Telegram asks for a pause: the lease keeps the batch until then.
      if (err instanceof HistoryError && err.code === 'RETRY') break;
      if (err instanceof BotApiError) {
        await finish(job, `❌ Загрузка «${escapeHtml(job.title)}» остановлена: ${escapeHtml(err.description || err.message)}.\n` +
          `Готово ${job.done + did} из ${job.chunks}. Пришли файл ещё раз, когда поправишь: загруженное не задвоится.`);
        return;
      }
      throw err;
    }
    await db.run(sql`DELETE FROM history_queue WHERE id = ${next.id}`);
    await db.run(sql`UPDATE history_imports SET done = done + 1, added = added + ${r.added}, members = members + ${r.members}
      WHERE id = ${job.id}`);
    did++;
  }
  const now = await db.get(sql`SELECT * FROM history_imports WHERE id = ${job.id}`);
  const left = await db.get(sql`SELECT COUNT(*) AS c FROM history_queue WHERE import_id = ${job.id}`);
  if (!left.c) {
    await finish(now, `✅ История «${escapeHtml(now.title)}» загружена: +${fmtThousands(now.added)} ${plural(now.added, 'сообщение', 'сообщения', 'сообщений')}, ` +
      `новых участников: ${now.members}.\nПрофили, топы и ачивки уже считают старые сообщения.`);
    return;
  }
  if (did && now.progress_message_id) {
    try {
      await api.editMessageText({
        chat_id: now.report_chat_id, message_id: now.progress_message_id, parse_mode: 'HTML',
        text: boldHtml(`📥 «${escapeHtml(now.title)}»\n⏳ Загружаю: ${now.done} из ${now.chunks}…`),
      });
    } catch {
      // Deleted or unchanged: the final message still comes.
    }
  }
}
