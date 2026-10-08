// Ban subscribers who leave the protected channel (port of channel_blacklist.py).
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { BLACKLIST_CHANNEL_ID, OWNER_USER_ID } from './config.js';
import { fullName, now, truncate } from './util.js';
import { isApiError, isBadRequest, isForbidden, isRetryAfter, retryAfter } from './tg.js';
import { logError } from './store.js';

// A claim older than this is assumed to belong to an interrupted invocation.
const CLAIM_SECONDS = 120;

export function isBlacklistChannel(chat) {
  return chat != null && chat.type === 'channel' && chat.id === BLACKLIST_CHANNEL_ID;
}

export async function handleChatMember(event) {
  if (!event || !event.chat || event.chat.type !== 'channel') return;
  if (!isBlacklistChannel(event.chat)) return;
  const oldMember = event.old_chat_member;
  const newMember = event.new_chat_member;
  const user = newMember.user;
  if (oldMember.status !== 'member' || newMember.status !== 'left' || oldMember.user.id !== user.id ||
      event.from.id !== user.id || user.id === OWNER_USER_ID || user.is_bot) {
    return;
  }
  const leftAt = event.date;
  const chat = event.chat;
  // Newer exits replace older records; an older or repeated update is ignored.
  const result = await db.run(sql`INSERT INTO blacklist
      (chat_id, user_id, channel_title, username, full_name, left_at, status, last_error, retry_at, attempts, claimed_at)
    VALUES (${chat.id}, ${user.id}, ${truncate(chat.title || chat.username || String(chat.id), 200)},
      ${user.username || ''}, ${truncate(fullName(user), 200)}, ${leftAt}, 'pending', '', 0, 0, NULL)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET channel_title = excluded.channel_title,
      username = excluded.username, full_name = excluded.full_name, left_at = excluded.left_at,
      status = 'pending', last_error = '', retry_at = 0, attempts = 0, claimed_at = NULL
    WHERE blacklist.left_at < excluded.left_at`);
  if (result.rowsAffected !== 1) return;
  await attempt(chat.id, user.id);
}

// Resume unfinished requests whose backoff has expired.
export async function retryPending(limit = 5) {
  const rows = await db.all(sql`SELECT chat_id, user_id FROM blacklist
    WHERE status IN ('pending', 'failed') AND retry_at <= ${now()} AND chat_id = ${BLACKLIST_CHANNEL_ID}
    ORDER BY retry_at LIMIT ${limit}`);
  for (const row of rows) {
    try {
      await attempt(row.chat_id, row.user_id);
    } catch (err) {
      await logError('blacklist.retry', err);
    }
  }
  return rows.length;
}

async function attempt(chatId, userId) {
  const ts = now();
  // Claim the record so parallel invocations don't both call Telegram.
  const claimed = await db.run(sql`UPDATE blacklist SET status = 'pending', attempts = attempts + 1, claimed_at = ${ts}
    WHERE chat_id = ${chatId} AND user_id = ${userId} AND status IN ('pending', 'failed')
      AND retry_at <= ${ts} AND (claimed_at IS NULL OR claimed_at < ${ts - CLAIM_SECONDS})
    RETURNING attempts`);
  if (!claimed.rows || claimed.rows.length !== 1) return;
  const attempts = claimed.rows[0].attempts;
  let outcome;
  try {
    if (userId === OWNER_USER_ID) {
      outcome = fail(attempts, 'Владелец бота исключён из автоматической блокировки.');
    } else {
      const member = await api.getChatMember({ chat_id: chatId, user_id: userId });
      if (member.status === 'administrator' || member.status === 'creator' || member.user.is_bot) {
        outcome = fail(attempts, 'Администраторы канала и боты исключены из блокировки.');
      } else if (member.status === 'kicked' && member.until_date === 0) {
        outcome = success();
      } else {
        const result = await api.banChatMember({ chat_id: chatId, user_id: userId });
        outcome = result ? success() : fail(attempts, 'Telegram не подтвердил блокировку.');
      }
    }
  } catch (err) {
    if (isRetryAfter(err)) {
      outcome = fail(attempts, 'Лимит запросов Telegram; повтор после указанной паузы.', {
        status: 'pending', delay: Math.max(1, retryAfter(err) ?? 1) + 1,
      });
    } else if (isForbidden(err)) {
      outcome = fail(attempts, 'Telegram отказал в доступе. Проверьте права бота в канале.');
    } else if (isBadRequest(err)) {
      outcome = fail(attempts, 'Telegram отклонил запрос. Проверьте канал, пользователя и права бота.');
    } else if (!isApiError(err)) {
      const delay = Math.min(300, 15 * 2 ** Math.min(attempts - 1, 5));
      outcome = fail(attempts, 'Ошибка соединения с Telegram; будет выполнен повтор.', { status: 'pending', delay });
    } else {
      outcome = fail(attempts, 'Ошибка Telegram; будет выполнен повтор.');
    }
  }
  await db.run(sql`UPDATE blacklist SET status = ${outcome.status}, last_error = ${outcome.error},
      retry_at = ${outcome.retryAt}, claimed_at = NULL
    WHERE chat_id = ${chatId} AND user_id = ${userId}`);
}

function success() {
  return { status: 'banned', error: '', retryAt: 0 };
}

function fail(attempts, error, { status = 'failed', delay = null } = {}) {
  if (delay == null) {
    // Back off from 5 minutes to about 5 hours so a lasting failure (for
    // example missing admin rights) does not hit Telegram forever.
    delay = 300 * 2 ** Math.min(Math.max(1, attempts) - 1, 6);
  }
  return { status, error: truncate(error, 500), retryAt: now() + delay };
}

export async function listRecords() {
  return db.all(sql`SELECT * FROM blacklist WHERE chat_id = ${BLACKLIST_CHANNEL_ID}
    ORDER BY left_at DESC, user_id DESC`);
}
