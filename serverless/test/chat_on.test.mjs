// /chat_on: Финя works as the chat manager in any chat the owner adds, without the
// channel's posts; /chat_off takes it back.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onChannelPost, onMessage } from '../tgcloud/lib/bot.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { squadChatIds } from '../tgcloud/lib/xpchat.js';
import { CHANNEL, checkErrors, DISCUSSION, FAMILY, groupMessage, OWNER, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const OTHER = { id: -1004000000003, type: 'supergroup', title: 'Другой чат' };
const say = (from, text) => onMessage(groupMessage(OTHER, from, text));
const last = (api) => replies(api).at(-1).params.text;
// Everything Финя sent, the «кто я» photo included.
const sent = (api) => api.calls.filter((c) => ['sendMessage', 'sendPhoto'].includes(c.method));

test('a foreign chat is ignored until the owner sends /chat_on there', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await say(a, 'кто я');
  assert.equal(sent(api).length, 0);
  await say(a, '/chat_on');
  assert.equal(sent(api).length, 0);
  await say(OWNER, '/chat_on');
  assert.match(last(api), /Готово: Финя работает в этом чате/);
  await say(a, 'кто я');
  assert.match(sent(api).at(-1).params.caption, /Это пользователь Аня/);
  assert.ok((await squadChatIds()).includes(OTHER.id));
  await say(OWNER, '/chat_on');
  assert.match(last(api), /уже работает/);
  // The channel's posts do not come here.
  await onChannelPost({ message_id: 700, date: Math.floor(Date.now() / 1000), chat: CHANNEL, text: 'Пост' });
  assert.equal(api.called('copyMessage').filter((c) => c.params.chat_id === OTHER.id).length, 0);

  await say(OWNER, '/chat_off');
  assert.match(last(api), /больше не работает/);
  const before = sent(api).length;
  await say(a, 'кто я');
  assert.equal(sent(api).length, before);
  assert.ok(!(await squadChatIds()).includes(OTHER.id));
});

test('/chat_on needs Финя as an admin', async () => {
  const api = await setup({
    getChatMember: async (p) => ({ status: 'member', user: { id: p.user_id, is_bot: true } }),
  });
  await say(OWNER, '/chat_on');
  assert.match(last(api), /Назначь Финю администратором/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM squad_chats')).c, 0);
});

test('/chat_off: posts first, the discussion group always stays', async () => {
  const api = await setup();
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_on'));
  await onMessage(groupMessage(FAMILY, OWNER, '/chat_off'));
  assert.match(last(api), /сначала \/posts_off/);
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_off'));
  await onMessage(groupMessage(FAMILY, OWNER, '/chat_off'));
  assert.match(last(api), /больше не работает/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM relay_targets')).c, 0);
  await onMessage(groupMessage(DISCUSSION, OWNER, '/chat_off'));
  assert.match(last(api), /обсуждения канала/);
});
