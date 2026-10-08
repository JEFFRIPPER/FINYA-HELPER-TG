// Durable channel-to-group outbox (port of channel_relay.py).
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { now, truncate } from './util.js';
import { errorText, isApiError, isBadRequest, isForbidden, isRetryAfter, retryAfter } from './tg.js';
import { logError } from './store.js';

// A 'sending' row older than this was interrupted; its result is unknown.
const STALE_SENDING_SECONDS = 300;

export async function enabled(chatId) {
  const row = await db.get(sql`SELECT enabled FROM relay_targets WHERE chat_id = ${chatId}`);
  return Boolean(row && row.enabled);
}

export async function hasTarget(chatId) {
  return Boolean(await db.get(sql`SELECT 1 AS x FROM relay_targets WHERE chat_id = ${chatId}`));
}

// → true when the chat was not enabled before.
export async function enable(chatId, title) {
  if (chatId >= 0) throw new Error('Relay target must be a group');
  const already = await enabled(chatId);
  await db.run(sql`INSERT INTO relay_targets (chat_id, title, enabled, enabled_at)
    VALUES (${chatId}, ${truncate(title || String(chatId), 100)}, 1, ${now()})
    ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title, enabled = 1,
      enabled_at = CASE WHEN relay_targets.enabled = 1 THEN relay_targets.enabled_at ELSE excluded.enabled_at END`);
  return !already;
}

export async function disable(chatId) {
  await db.run(sql`UPDATE relay_targets SET enabled = 0 WHERE chat_id = ${chatId}`);
  await db.run(sql`UPDATE relay_outbox SET status = 'cancelled', error = 'Рассылка отключена владельцем.'
    WHERE target_chat_id = ${chatId} AND status IN ('pending', 'uncertain')`);
}

// Queue a new source message once per explicitly enabled destination.
export async function enqueue(message, postUrl) {
  const targets = await db.all(sql`SELECT * FROM relay_targets WHERE enabled = 1`);
  let queued = 0;
  for (const target of targets) {
    // No surprise replay of posts created before /posts_on.
    if (message.date < Math.floor(target.enabled_at)) continue;
    const r = await db.run(sql`INSERT OR IGNORE INTO relay_outbox
        (source_chat_id, source_message_id, target_chat_id, post_url, retry_at)
      VALUES (${message.chat.id}, ${message.message_id}, ${target.chat_id}, ${postUrl}, ${now()})`);
    queued += r.rowsAffected;
  }
  return queued;
}

export async function status() {
  const rows = await db.all(sql`SELECT * FROM relay_targets ORDER BY title, chat_id`);
  const results = [];
  for (const row of rows) {
    const counts = await db.get(sql`SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'uncertain' THEN 1 ELSE 0 END) AS uncertain
      FROM relay_outbox WHERE target_chat_id = ${row.chat_id}`);
    const ids = await db.all(sql`SELECT source_message_id FROM relay_outbox WHERE target_chat_id = ${row.chat_id}
      AND status = 'uncertain' ORDER BY source_message_id LIMIT 5`);
    const error = await db.get(sql`SELECT error FROM relay_outbox WHERE target_chat_id = ${row.chat_id} AND error != ''
      AND status IN ('pending', 'uncertain', 'failed') ORDER BY source_message_id DESC LIMIT 1`);
    results.push({
      ...row,
      pending: counts?.pending || 0,
      uncertain: counts?.uncertain || 0,
      uncertain_ids: ids.map((r) => r.source_message_id),
      error: error ? error.error : '',
    });
  }
  return results;
}

export async function retryUncertain(chatId, sourceMessageId = null) {
  const r = await db.run(sql`UPDATE relay_outbox SET status = 'pending', retry_at = ${now()}, error = ''
    WHERE target_chat_id = ${chatId} AND status = 'uncertain'
      AND (${sourceMessageId} IS NULL OR source_message_id = ${sourceMessageId})`);
  return r.rowsAffected;
}

async function finish(row, status, { error = '', retryDelay = 0, deliveredId = null } = {}) {
  await db.run(sql`UPDATE relay_outbox SET status = ${status}, error = ${error}, retry_at = ${now() + retryDelay},
      delivered_id = ${deliveredId}, claimed_at = NULL
    WHERE source_chat_id = ${row.source_chat_id} AND source_message_id = ${row.source_message_id}
      AND target_chat_id = ${row.target_chat_id}`);
  if (deliveredId != null) {
    // Delivered posts become XP roots for reactions and replies.
    await db.run(sql`INSERT OR IGNORE INTO messages (chat_id, message_id, root_id, author_id)
      VALUES (${row.target_chat_id}, ${deliveredId}, ${deliveredId}, NULL)`);
  }
}

// An invocation that died mid-send cannot prove whether Telegram accepted it.
export async function sweepStale() {
  await db.run(sql`UPDATE relay_outbox SET status = 'uncertain', claimed_at = NULL,
      error = 'Отправка прервана; результат неизвестен.'
    WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < ${now() - STALE_SENDING_SECONDS})`);
}

// One request at a time. Safe failures retry; ambiguous results stay visible.
export async function deliverNext() {
  const ts = now();
  const row = await db.get(sql`SELECT o.* FROM relay_outbox o JOIN relay_targets t ON t.chat_id = o.target_chat_id
    WHERE t.enabled = 1 AND o.status = 'pending' AND o.retry_at <= ${ts}
    ORDER BY o.source_message_id, o.target_chat_id LIMIT 1`);
  if (!row) return false;
  const claimed = await db.run(sql`UPDATE relay_outbox SET status = 'sending', attempts = attempts + 1, claimed_at = ${ts}
    WHERE source_chat_id = ${row.source_chat_id} AND source_message_id = ${row.source_message_id}
      AND target_chat_id = ${row.target_chat_id} AND status = 'pending' AND retry_at <= ${ts}`);
  if (claimed.rowsAffected !== 1) return false;
  row.attempts += 1;
  const markup = { inline_keyboard: [[{ text: 'Открыть в канале', url: row.post_url }]] };
  let requestStarted = false;
  try {
    const source = await api.getChat({ chat_id: row.source_chat_id });
    if (source.linked_chat_id === row.target_chat_id) {
      // Telegram already posts here natively. Never add a second copy.
      await finish(row, 'native');
      return true;
    }
    requestStarted = true;
    const result = await api.copyMessage({
      chat_id: row.target_chat_id, from_chat_id: row.source_chat_id,
      message_id: row.source_message_id, reply_markup: markup,
    });
    await finish(row, 'sent', { deliveredId: result.message_id });
  } catch (err) {
    if (isRetryAfter(err)) {
      await finish(row, 'pending', { error: 'Лимит Telegram; запланирован повтор.', retryDelay: (retryAfter(err) ?? 1) + 1 });
    } else if (isForbidden(err)) {
      await finish(row, 'pending', { error: 'Нет доступа к отправке; проверь права Фини в чате и канале.', retryDelay: 60 });
    } else if (isBadRequest(err)) {
      const t = errorText(err);
      if (['not enough rights', 'have no rights', 'chat not found', 'bot is not a member'].some((v) => t.includes(v))) {
        await finish(row, 'pending', { error: 'Недостаточно прав или чат недоступен; запланирован повтор.', retryDelay: 60 });
      } else {
        await finish(row, 'failed', { error: 'Telegram отклонил копирование поста. Проверь доступность сообщения и права бота.' });
      }
    } else if (!isApiError(err) && !requestStarted) {
      await finish(row, 'pending', {
        error: 'Не удалось соединиться с Telegram; запланирован повтор.',
        retryDelay: Math.min(300, 15 * 2 ** Math.min(row.attempts, 5)),
      });
    } else if (!isApiError(err)) {
      await finish(row, 'uncertain', { error: 'Обрыв связи: результат неизвестен. Проверь чат перед ручным повтором.' });
      await logError('relay.deliver', err);
    } else {
      await finish(row, 'uncertain', { error: 'Неизвестный результат Telegram. Проверь чат перед ручным повтором.' });
    }
  }
  return true;
}

// Deliver everything due, within a time budget.
export async function deliverDue(budgetMs = 10000, maxItems = 20) {
  const deadline = Date.now() + budgetMs;
  let n = 0;
  while (n < maxItems && Date.now() < deadline) {
    if (!(await deliverNext())) break;
    n++;
  }
  return n;
}
