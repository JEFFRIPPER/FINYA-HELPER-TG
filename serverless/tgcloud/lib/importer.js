// One-time import of the old bot's data. The old bot's /export command sends
// finya-export.json (state.json + every xp.sqlite3 table); the owner forwards
// that file to the bot in private, and it is loaded here. Re-sending the same
// file is safe: rows are upserted, and an interrupted import resumes.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { logError, setSetting, getSetting } from './store.js';
import { boldHtml, nowInt, utf8Decode } from './util.js';

const BATCH = 100;
const BUDGET_MS = 20000;

export function looksLikeExport(document) {
  const name = String(document.file_name || '').toLowerCase();
  return name.startsWith('finya-export') && name.endsWith('.json');
}

const int = (v) => (v == null || v === '' ? null : Math.trunc(Number(v)));
const num = (v) => (v == null || v === '' ? null : Number(v));
const str = (v) => (v == null ? null : String(v));

// table → [columns, row → values, conflict clause]
const TABLES = {
  profiles: [['user_id', 'name', 'username', 'xp', 'manual_rank'],
    (r) => [int(r.user_id), str(r.name) ?? String(r.user_id), str(r.username) ?? '', int(r.xp) ?? 0, str(r.manual_rank)],
    'ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, username = excluded.username, xp = excluded.xp, manual_rank = excluded.manual_rank'],
  events: [['user_id', 'chat_id', 'message_id', 'kind', 'points', 'earned_at'],
    (r) => [int(r.user_id), int(r.chat_id), int(r.message_id), str(r.kind), int(r.points), int(r.earned_at)],
    'ON CONFLICT DO NOTHING'],
  messages: [['chat_id', 'message_id', 'root_id', 'author_id'],
    (r) => [int(r.chat_id), int(r.message_id), int(r.root_id), int(r.author_id)],
    'ON CONFLICT DO NOTHING'],
  admin_changes: [['user_id', 'actor_id', 'operation_id', 'action', 'request_value', 'before_xp', 'after_xp', 'before_rank', 'after_rank', 'created_at'],
    (r) => [int(r.user_id), int(r.actor_id), str(r.operation_id), str(r.action), str(r.request_value) ?? '', int(r.before_xp), int(r.after_xp), str(r.before_rank), str(r.after_rank), int(r.created_at)],
    'ON CONFLICT DO NOTHING'],
  relay_targets: [['chat_id', 'title', 'enabled', 'enabled_at'],
    (r) => [int(r.chat_id), str(r.title) ?? '', int(r.enabled) ?? 0, num(r.enabled_at) ?? 0],
    'ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title, enabled = excluded.enabled, enabled_at = excluded.enabled_at'],
  relay_outbox: [['source_chat_id', 'source_message_id', 'target_chat_id', 'post_url', 'status', 'attempts', 'retry_at', 'error', 'delivered_id'],
    // 'sending' rows were interrupted by the move: their result is unknown.
    (r) => [int(r.source_chat_id), int(r.source_message_id), int(r.target_chat_id), str(r.post_url) ?? '',
      r.status === 'sending' ? 'uncertain' : str(r.status) ?? 'pending', int(r.attempts) ?? 0, num(r.retry_at) ?? 0, str(r.error) ?? '', int(r.delivered_id)],
    'ON CONFLICT DO NOTHING'],
  users: [['user_id', 'username', 'first_name', 'first_seen', 'last_seen', 'blocked', 'blocked_at', 'subscribed'],
    (r) => [int(r.user_id), str(r.username), str(r.first_name), int(r.first_seen) ?? 0, int(r.last_seen) ?? 0,
      r.blocked ? 1 : 0, int(r.blocked_at), r.subscribed ? 1 : 0],
    'ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, first_seen = excluded.first_seen, last_seen = MAX(users.last_seen, excluded.last_seen), blocked = excluded.blocked, blocked_at = excluded.blocked_at, subscribed = excluded.subscribed'],
  feedback: [['user_id', 'username', 'first_name', 'text', 'time'],
    (r) => [int(r.user_id) ?? 0, str(r.username), str(r.first_name), str(r.text) ?? '', int(r.time) ?? 0],
    ''],
  blacklist: [['chat_id', 'user_id', 'channel_title', 'username', 'full_name', 'left_at', 'status', 'last_error', 'retry_at', 'attempts'],
    (r) => [int(r.chat_id), int(r.user_id), str(r.channel_title) ?? '', str(r.username) ?? '', str(r.full_name) ?? '',
      num(r.left_at) ?? 0, str(r.status) ?? 'pending', str(r.last_error) ?? '', num(r.retry_at) ?? 0, int(r.attempts) ?? 0],
    'ON CONFLICT(chat_id, user_id) DO UPDATE SET status = excluded.status, last_error = excluded.last_error, retry_at = excluded.retry_at, attempts = excluded.attempts'],
};
const ORDER = ['users', 'profiles', 'events', 'messages', 'admin_changes', 'relay_targets', 'relay_outbox', 'feedback', 'blacklist'];

// state.json → rows for users / feedback / blacklist, plus settings.
export function stateRows(state) {
  const subscribers = state.channel_subscribers || {};
  const ts = nowInt();
  const users = Object.entries(state.users || {}).filter(([id]) => /^[0-9]+$/.test(id)).map(([id, u]) => {
    const lastSeen = int(u.last_seen) || 0;
    return {
      user_id: Number(id), username: u.username ?? null, first_name: u.first_name ?? null,
      first_seen: int(u.first_seen) || lastSeen || ts, last_seen: lastSeen,
      blocked: u.blocked ? 1 : 0, blocked_at: u.blocked_at ?? null, subscribed: subscribers[id] ? 1 : 0,
    };
  });
  // Subscribers missing from users still get posts.
  for (const [id, on] of Object.entries(subscribers)) {
    if (on && /^[0-9]+$/.test(id) && !(state.users || {})[id]) {
      users.push({ user_id: Number(id), first_seen: ts, last_seen: 0, blocked: 0, subscribed: 1 });
    }
  }
  const blacklist = Object.values(state.channel_blacklist || {}).filter((r) => r && r.chat_id && r.user_id);
  const settings = {};
  for (const key of ['news', 'maintenance', 'channel_broadcast_enabled', 'last_channel_post_id', 'xp_discussion_chat_id']) {
    if (key in state) settings[key] = state[key];
  }
  return { users, feedback: (state.feedback || []).slice(-200), blacklist, settings };
}

function placeholders(columns, values) {
  // Builds "(?, ?, …)" as nested sql fragments so every value is a parameter.
  let frag = sql`${values[0]}`;
  for (let i = 1; i < columns.length; i++) frag = sql`${frag}, ${values[i]}`;
  return sql`(${frag})`;
}

async function insertBatch(table, rows) {
  const [columns, map, conflict] = TABLES[table];
  let values = null;
  for (const row of rows) {
    const tuple = placeholders(columns, map(row));
    values = values ? sql`${values}, ${tuple}` : tuple;
  }
  if (!values) return;
  const head = sql.raw(`INSERT INTO ${table} (${columns.join(', ')}) VALUES `);
  const tail = sql.raw(conflict ? ` ${conflict}` : '');
  await db.run(sql`${head}${values}${tail}`);
}

// → { done, counts }
export async function importData(data, progressKey) {
  if (!data || data.format !== 'finya-export') throw new Error('Это не файл экспорта FINYA.');
  const fromState = stateRows(data.state || {});
  const tables = { ...(data.tables || {}), users: fromState.users, feedback: fromState.feedback, blacklist: fromState.blacklist };
  const progress = (await getSetting(progressKey)) || { table: 0, offset: 0, settings: false };
  const deadline = Date.now() + BUDGET_MS;
  if (!progress.settings) {
    for (const [key, value] of Object.entries(fromState.settings)) await setSetting(key, value);
    progress.settings = true;
  }
  const counts = {};
  for (; progress.table < ORDER.length; progress.table++, progress.offset = 0) {
    const name = ORDER[progress.table];
    const rows = tables[name] || [];
    counts[name] = rows.length;
    if (name === 'feedback' && progress.offset === 0) await db.run(sql`DELETE FROM feedback`);
    while (progress.offset < rows.length) {
      if (Date.now() > deadline) {
        await setSetting(progressKey, progress);
        return { done: false, counts };
      }
      await insertBatch(name, rows.slice(progress.offset, progress.offset + BATCH));
      progress.offset += BATCH;
    }
  }
  await setSetting(progressKey, { ...progress, finished_at: nowInt() });
  return { done: true, counts };
}

export async function importFromMessage(message) {
  const doc = message.document;
  const key = `import:${doc.file_unique_id}`;
  const previous = await getSetting(key);
  if (previous && previous.finished_at) {
    await api.sendMessage({ chat_id: message.chat.id, text: 'Этот файл уже импортирован.' });
    return;
  }
  await api.sendMessage({ chat_id: message.chat.id, text: 'Импортирую данные старого бота…' });
  try {
    const bytes = await api.getFileContent(doc.file_id);
    const data = JSON.parse(utf8Decode(bytes));
    const result = await importData(data, key);
    const lines = Object.entries(result.counts).map(([t, n]) => `${t}: ${n}`).join('\n');
    const totals = await db.get(sql`SELECT COUNT(*) AS profiles, COALESCE(SUM(xp), 0) AS xp FROM profiles`);
    const users = await db.get(sql`SELECT COUNT(*) AS c, SUM(subscribed) AS subs FROM users`);
    await api.sendMessage({
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text: boldHtml(result.done
        ? `✅ Импорт завершён.\n\n${lines}\n\nСейчас в базе: пользователей ${users.c}, подписчиков ${users.subs || 0}, ` +
          `участников XP ${totals.profiles}, сумма XP ${totals.xp}.`
        : `Импорт выполнен частично (${lines}).\nОтправь этот же файл ещё раз — продолжу с места остановки.`),
    });
  } catch (err) {
    await logError('import', err);
    await api.sendMessage({ chat_id: message.chat.id, text: `Импорт не удался: ${String(err.message || err).slice(0, 300)}` });
  }
}
