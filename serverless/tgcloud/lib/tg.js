// Bot API helpers: error classification, buttons, edit-or-send.
import { api, BotApiError } from 'sdk';
import { BUTTON_ICONS } from './config.js';
import { boldHtml, sleep } from './util.js';

export function isApiError(err) {
  return err instanceof BotApiError || (err && typeof err.code === 'number' && 'description' in err);
}

export function errorText(err) {
  return String((err && (err.description || err.message)) || err || '').toLowerCase();
}

export function retryAfter(err) {
  const value = err && err.parameters && err.parameters.retry_after;
  return typeof value === 'number' ? value : null;
}

export const isRetryAfter = (err) => isApiError(err) && (err.code === 429 || retryAfter(err) != null);
export const isForbidden = (err) => isApiError(err) && err.code === 403;
export const isBadRequest = (err) => isApiError(err) && err.code === 400;

export function isNotModified(err) {
  return isBadRequest(err) && errorText(err).includes('message is not modified');
}

export function isUnreachableUser(err) {
  if (isForbidden(err)) return true;
  const t = errorText(err);
  return isBadRequest(err) && (t.includes('chat not found') || t.includes('user is deactivated'));
}

// Wait out short flood limits instead of dropping the message.
export async function sendWithFloodWait(send, { attempts = 3, maxWait = 10 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      const wait = isRetryAfter(err) ? retryAfter(err) ?? 1 : null;
      if (wait == null || attempt + 1 >= attempts || wait > maxWait) throw err;
      await sleep(wait * 1000 + 200);
    }
  }
}

export function button(text, extra = {}) {
  const b = { text, ...extra };
  if (!b.icon_custom_emoji_id) delete b.icon_custom_emoji_id;
  return b;
}

export function keyboard(rows) {
  return { inline_keyboard: rows };
}

export function menuButton(text, extra = {}) {
  const space = text.indexOf(' ');
  const prefix = space === -1 ? text : text.slice(0, space);
  const label = space === -1 ? '' : text.slice(space + 1);
  let iconId = BUTTON_ICONS[prefix];
  if (text.includes('Папка')) iconId = '6021375494216226506';
  else if (text.includes('Буст')) iconId = '6023609813513018256';
  else if (label === 'ТГК') iconId = '6023656439677982525';
  else if (text.includes('Главное меню')) iconId = '6023896773162967617';
  return button(iconId ? label : text, { ...extra, icon_custom_emoji_id: iconId });
}

export async function reply(message, text, extra = {}) {
  return api.sendMessage({ chat_id: message.chat.id, text, ...extra });
}

export async function replyBold(message, text, replyMarkup) {
  const params = { parse_mode: 'HTML' };
  if (replyMarkup) params.reply_markup = replyMarkup;
  return reply(message, boldHtml(text), params);
}

export async function answer(query, text, showAlert = false) {
  try {
    const params = { callback_query_id: query.id };
    if (text) params.text = text;
    if (showAlert) params.show_alert = true;
    await api.answerCallbackQuery(params);
  } catch (err) {
    // An expired query (bot was slow) is not worth failing the handler.
    if (!isBadRequest(err)) throw err;
  }
}

export async function editOrSend(query, text, replyMarkup) {
  text = boldHtml(text);
  const message = query.message;
  const params = { parse_mode: 'HTML' };
  if (replyMarkup) params.reply_markup = replyMarkup;
  try {
    if (message.photo && text.length <= 1024) {
      await api.editMessageCaption({ chat_id: message.chat.id, message_id: message.message_id, caption: text, ...params });
    } else if (message.photo) {
      await api.sendMessage({ chat_id: message.chat.id, text, ...params });
    } else {
      await api.editMessageText({ chat_id: message.chat.id, message_id: message.message_id, text, ...params });
    }
  } catch (err) {
    if (!isNotModified(err)) throw err;
  }
}

export async function editText(query, text, replyMarkup) {
  const params = { chat_id: query.message.chat.id, message_id: query.message.message_id, text, parse_mode: 'HTML' };
  if (replyMarkup) params.reply_markup = replyMarkup;
  try {
    await api.editMessageText(params);
  } catch (err) {
    if (!isNotModified(err)) throw err;
  }
}

export function isAdminStatus(member) {
  return member && (member.status === 'administrator' || member.status === 'creator');
}

let cachedMe = null;
export async function getMe() {
  if (!cachedMe) cachedMe = await api.getMe();
  return cachedMe;
}
