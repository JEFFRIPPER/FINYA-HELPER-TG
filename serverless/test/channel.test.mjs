import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onCallbackQuery, onChannelPost, onChatMember, onMessage, pump } from '../tgcloud/lib/bot.js';
import {
  apiError, callback, checkErrors, CHANNEL, FAMILY, groupMessage, lastText, OWNER, privateMessage, setup, user,
} from './helpers.mjs';

afterEach(checkErrors);

function post(id = 500) {
  return { message_id: id, date: Math.floor(Date.now() / 1000), chat: CHANNEL, text: 'Новый пост' };
}

test('/posts_on in Family, then a channel post is copied there once', async () => {
  const mock = await setup();
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_on'));
  assert.match(mock.called('sendMessage').at(-1).params.text, /Готово/);
  await onChannelPost(post(501));
  const copies = mock.called('copyMessage').filter((c) => c.params.chat_id === FAMILY.id);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].params.reply_markup.inline_keyboard[0][0].url, 'https://t.me/THKC_SQUAD/501');
  // A redelivered update creates no second copy.
  await onChannelPost(post(501));
  assert.equal(mock.called('copyMessage').filter((c) => c.params.chat_id === FAMILY.id).length, 1);
  const row = await db.get('SELECT status, delivered_id FROM relay_outbox');
  assert.equal(row.status, 'sent');
  // The delivered copy becomes an XP root.
  assert.ok(await db.get('SELECT 1 FROM messages WHERE chat_id = ? AND message_id = ?', [FAMILY.id, row.delivered_id]));
});

test('network failure during copy → uncertain, /posts_retry resends', async () => {
  let fail = true;
  const mock = await setup({
    copyMessage: async (p) => {
      if (fail) throw new Error('socket hang up');
      return { message_id: 42 };
    },
  });
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_on'));
  await onChannelPost(post(502));
  assert.equal((await db.get('SELECT status FROM relay_outbox')).status, 'uncertain');
  await db.run('DELETE FROM error_log');
  fail = false;
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_retry 502'));
  assert.match(mock.called('sendMessage').at(-1).params.text, /Поставлено на повтор: 1/);
  assert.equal((await db.get('SELECT status FROM relay_outbox')).status, 'sent');
});

test('flood limit → pending with retry_at; /posts_off cancels', async () => {
  await setup({ copyMessage: async () => { throw apiError('copyMessage', 429, 'Too Many Requests', { retry_after: 30 }); } });
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_on'));
  await onChannelPost(post(503));
  const row = await db.get('SELECT status, retry_at FROM relay_outbox');
  assert.equal(row.status, 'pending');
  assert.ok(row.retry_at > Date.now() / 1000 + 20);
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_off'));
  assert.equal((await db.get('SELECT status FROM relay_outbox')).status, 'cancelled');
});

test('channel post goes to private subscribers; unreachable ones are dropped', async () => {
  const mock = await setup({
    copyMessage: async (p) => {
      if (p.chat_id === 82) throw apiError('copyMessage', 403, 'Forbidden: bot was blocked by the user');
      return { message_id: 1 };
    },
  });
  for (const id of [81, 82, 83]) {
    await onMessage(privateMessage(user(id), '/start'));
    await onCallbackQuery(callback(user(id), 'channel:subscribe'));
  }
  await onCallbackQuery(callback(user(83), 'channel:unsubscribe'));
  mock.calls = [];
  await onChannelPost(post(504));
  const targets = mock.called('copyMessage').map((c) => c.params.chat_id).sort();
  assert.deepEqual(targets, [81, 82]);
  const blocked = await db.get('SELECT blocked, subscribed FROM users WHERE user_id = 82');
  assert.deepEqual({ ...blocked }, { blocked: 1, subscribed: 0 });
  assert.equal((await db.get('SELECT status FROM jobs')).status, 'done');
  assert.equal((await db.get("SELECT value FROM settings WHERE key = 'last_channel_post_id'")).value, '504');
});

test('leaving the channel bans the user; missing rights → failed with backoff, retried later', async () => {
  let ban = async () => { throw apiError('banChatMember', 400, 'Bad Request: not enough rights'); };
  const mock = await setup({
    getChatMember: async (p) => ({ status: 'left', user: { id: p.user_id, is_bot: false } }),
    banChatMember: (p) => ban(p),
  });
  const leaver = user(90);
  const event = {
    chat: CHANNEL, from: leaver, date: Math.floor(Date.now() / 1000),
    old_chat_member: { status: 'member', user: leaver }, new_chat_member: { status: 'left', user: leaver },
  };
  await onChatMember(event);
  let row = await db.get('SELECT status, retry_at, attempts FROM blacklist');
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 1);
  ban = async () => true;
  await db.run('UPDATE blacklist SET retry_at = 0');
  await db.run("UPDATE settings SET value = '0' WHERE key = 'pump_at'");
  await pump();
  row = await db.get('SELECT status FROM blacklist');
  assert.equal(row.status, 'banned');
  await onCallbackQuery(callback(OWNER, 'admin:blacklist'));
  assert.match(lastText(mock), /Бан подтверждён: 1/);
});

test('owner and admins are never banned', async () => {
  const mock = await setup();
  const event = {
    chat: CHANNEL, from: OWNER, date: Math.floor(Date.now() / 1000),
    old_chat_member: { status: 'member', user: OWNER }, new_chat_member: { status: 'left', user: OWNER },
  };
  await onChatMember(event);
  assert.equal(mock.called('banChatMember').length, 0);
  const admin = user(91);
  await onChatMember({ ...event, from: admin, old_chat_member: { status: 'member', user: admin }, new_chat_member: { status: 'left', user: admin } });
  assert.equal(mock.called('banChatMember').length, 0);
  assert.equal((await db.get('SELECT status FROM blacklist')).status, 'failed');
});
