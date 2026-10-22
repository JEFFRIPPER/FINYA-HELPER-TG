// Which group counts for XP: the one bound with /xpchat, else the channel's
// linked discussion group (re-checked at most every 5 minutes).
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { SQUAD_CHANNEL_ID } from './config.js';
import { getSetting, setSetting } from './store.js';
import { isAdminStatus } from './tg.js';
import { nowInt, truncate } from './util.js';

const DISCOVERY_SECONDS = 300;

export function xpSourceChannelId() {
  return SQUAD_CHANNEL_ID;
}

export async function explicitXpChatId() {
  const value = await getSetting('xp_discussion_chat_id');
  return Number.isInteger(value) && value < 0 ? value : null;
}

export async function resolveXpChat({ force = false } = {}) {
  const explicit = await explicitXpChatId();
  if (explicit) return explicit;
  const cached = await getSetting('xp_chat_cache');
  if (!force && cached && nowInt() - cached.at < DISCOVERY_SECONDS) return cached.id;
  try {
    const chat = await api.getChat({ chat_id: xpSourceChannelId() });
    const linked = chat.linked_chat_id ?? null;
    await setSetting('xp_chat_cache', { id: linked, at: nowInt() });
    return linked;
  } catch (err) {
    if (force) throw err;
    console.warn('Could not discover XP discussion group', err);
    return cached ? cached.id : null;
  }
}

export async function xpSetupText() {
  let status;
  try {
    const chatId = await resolveXpChat({ force: true });
    if (!chatId) {
      status = 'Группа обсуждений не найдена. Привяжи её к каналу или отправь /xpchat в нужной группе.';
    } else {
      const me = await api.getMe();
      const member = await api.getChatMember({ chat_id: chatId, user_id: me.id });
      status = isAdminStatus(member)
        ? `Группа: ${chatId}\nУчёт подключён.`
        : `Группа: ${chatId}\nДля учёта назначь Финю администратором этой группы.`;
    }
  } catch {
    status = 'Не удалось проверить группу. Добавь Финю администратором обсуждений и отправь там /xpchat от своего аккаунта.';
  }
  return 'Активность / XP\n\n' + status + '\n\n' +
    'Комментарий: +5 XP, пауза 60 секунд, минимум 5 букв/цифр.\n' +
    'Реакция: +1 XP, максимум 20 в день, один раз на сообщение.\n' +
    'Общий лимит: 100 XP в день.\n\n' +
    'Настройка: /xpchat в группе — подключить; /xpchat auto — вернуться к группе канала.\n' +
    'XP хранится в базе Telegram Serverless.';
}

// ---- chats bound with /chat_on ---------------------------------------------------

export async function isAddedChat(chatId) {
  return Boolean(await db.get(sql`SELECT 1 AS x FROM squad_chats WHERE chat_id = ${chatId}`));
}

// → true when the chat was not added before.
export async function addChat(chatId, title, byId) {
  const r = await db.run(sql`INSERT INTO squad_chats (chat_id, title, added_by, added_at)
    VALUES (${chatId}, ${truncate(title || String(chatId), 100)}, ${byId}, ${nowInt()})
    ON CONFLICT(chat_id) DO NOTHING`);
  return r.rowsAffected === 1;
}

export async function removeChat(chatId) {
  await db.run(sql`DELETE FROM squad_chats WHERE chat_id = ${chatId}`);
}

// Every Squad chat: the XP discussion group and the chats bound with /posts_on or /chat_on.
export async function squadChatIds() {
  const rows = await db.all('SELECT chat_id FROM relay_targets UNION SELECT chat_id FROM squad_chats');
  const ids = new Set(rows.map((r) => r.chat_id));
  const xpChat = await resolveXpChat();
  if (xpChat) ids.add(xpChat);
  return [...ids];
}
