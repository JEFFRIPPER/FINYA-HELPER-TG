import { apiMock, BotApiError } from 'sdk';
import { resetDb } from 'sdk/db';
import * as schema from '../tgcloud/schema.js';

export const OWNER = { id: 7221285861, is_bot: false, first_name: 'Owner', username: 'THKC_SQUAD_CREATOR' };
export const BOT = { id: 999, is_bot: true, first_name: 'Финя', username: 'finya_bot' };
export const CHANNEL = { id: -1001192817776, type: 'channel', title: 'T.N.K.C SQUAD', username: 'THKC_SQUAD' };
export const DISCUSSION = { id: -1002000000001, type: 'supergroup', title: 'Обсуждения' };
export const FAMILY = { id: -1003000000002, type: 'supergroup', title: 'Squad Family' };

let nextMessageId = 1000;

export function user(id, extra = {}) {
  return { id, is_bot: false, first_name: `U${id}`, username: `user${id}`, ...extra };
}

export function apiError(method, code, description, parameters) {
  return new BotApiError(method, code, description, parameters);
}

// Default Bot API behaviour; `overrides[method]` replaces one method.
export async function setup(overrides = {}) {
  await resetDb(schema);
  apiMock.reset();
  apiMock.handler = async (method, params) => {
    if (overrides[method]) return overrides[method](params);
    switch (method) {
      case 'getMe': return BOT;
      case 'getChat':
        if (params.chat_id === CHANNEL.id || params.chat_id === '@THKC_SQUAD') {
          return { ...CHANNEL, linked_chat_id: DISCUSSION.id };
        }
        return { id: params.chat_id, type: 'supergroup' };
      case 'getChatMember': return { status: 'administrator', can_restrict_members: true, user: { id: params.user_id, is_bot: params.user_id === BOT.id } };
      case 'sendPhoto': return { message_id: nextMessageId++, photo: [{ file_id: 'small' }, { file_id: 'PHOTO_FILE_ID' }] };
      case 'sendMessage':
      case 'copyMessage': return { message_id: nextMessageId++ };
      default: return true;
    }
  };
  return apiMock;
}

export function privateMessage(from, text, extra = {}) {
  const message = { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat: { id: from.id, type: 'private' }, from, text, ...extra };
  if (text && text.startsWith('/')) {
    message.entities = [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0].length }];
  }
  return message;
}

export function groupMessage(chat, from, text, extra = {}) {
  const message = { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat, from, text, ...extra };
  if (text && text.startsWith('/')) {
    message.entities = [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0].length }];
  }
  return message;
}

// The automatic forward of a channel post into its discussion group.
export function channelRoot(chat = DISCUSSION) {
  return {
    message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat,
    from: { id: 777000, is_bot: false, first_name: 'Telegram' }, sender_chat: CHANNEL,
    is_automatic_forward: true, forward_origin: { type: 'channel', chat: CHANNEL, message_id: 1 }, text: 'Пост',
  };
}

export function callback(from, data, message = {}) {
  return {
    id: String(nextMessageId++), from, data, chat_instance: '1',
    message: { message_id: nextMessageId++, date: 0, chat: { id: from.id, type: 'private' }, text: 'menu', ...message },
  };
}

export function lastText(mock, method = null) {
  const calls = mock.calls.filter((c) => ['sendMessage', 'editMessageText', 'editMessageCaption'].includes(c.method) &&
    (!method || c.method === method));
  const c = calls[calls.length - 1];
  return c ? (c.params.text ?? c.params.caption) : null;
}

// Handlers log failures instead of throwing; a test fails if any were logged.
export async function checkErrors() {
  const { db } = await import('sdk');
  const rows = await db.all('SELECT source, text FROM error_log');
  if (rows.length) throw new Error('errors logged: ' + JSON.stringify(rows));
}
