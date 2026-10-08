// Which group counts for XP: the one bound with /xpchat, else the channel's
// linked discussion group (re-checked at most every 5 minutes).
import { api } from 'sdk';
import { SQUAD_CHANNEL_ID } from './config.js';
import { getSetting, setSetting } from './store.js';
import { isAdminStatus } from './tg.js';
import { nowInt } from './util.js';

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
