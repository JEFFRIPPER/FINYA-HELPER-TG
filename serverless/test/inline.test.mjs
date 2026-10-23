// Inline mode: RP in any chat, even a private one where Финя is not a member.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../tgcloud/handlers/inline_query.js';
import { onMessage } from '../tgcloud/lib/bot.js';
import { checkErrors, OWNER, privateMessage, setup, user } from './helpers.mjs';

afterEach(checkErrors);

let nextId = 1;
const inline = (from, query, chatType = 'private') => ({ id: String(nextId++), from, query, offset: '', chat_type: chatType });
const answered = (api) => api.called('answerInlineQuery').at(-1).params;
const texts = (params) => params.results.map((r) => r.input_message_content.message_text);

test('an empty query lists every RP action', async () => {
  const api = await setup();
  await handler(inline(user(2, { first_name: 'Аня' }), ''));
  const a = answered(api);
  assert.equal(a.is_personal, true);
  assert.ok(a.results.length >= 20 && a.results.length <= 50);
  assert.equal(a.results[0].type, 'article');
  assert.ok(a.results.some((r) => r.title === '🤗 Обнять'));
});

test('a command with @ник and a comment; without @ник it goes to the other person', async () => {
  const api = await setup();
  const anya = user(2, { first_name: 'Аня' });
  await handler(inline(anya, 'обнять @vasya скучала'));
  assert.deepEqual(texts(answered(api)), [
    '🤗 <a href="tg://user?id=2">Аня</a> обнимает @vasya\n💬 «скучала»',
  ]);
  await handler(inline(anya, 'Поцеловать'));
  assert.deepEqual(texts(answered(api)), ['😘 <a href="tg://user?id=2">Аня</a> целует тебя']);
  await handler(inline(anya, 'обнять', 'supergroup'));
  assert.match(texts(answered(api))[0], /обнимает всех$/);
  await handler(inline(anya, 'обнять', 'sender'));
  assert.match(texts(answered(api))[0], /обнимает Финю$/);
});

test('a prefix narrows the list; the owner\'s own actions and the nick are there too', async () => {
  const api = await setup();
  await onMessage(privateMessage(OWNER, '+рп пощекотать = щекочет 🤭'));
  await onMessage(privateMessage(user(3), '+ник Котик'));
  await handler(inline(user(3), 'по'));
  const titles = answered(api).results.map((r) => r.title);
  assert.ok(titles.includes('🤗 Поцеловать'.replace('🤗', '😘')));
  assert.ok(titles.every((t) => / По/.test(t)));
  await handler(inline(user(3), 'пощекотать'));
  assert.deepEqual(texts(answered(api)), ['✨ <a href="tg://user?id=3">Котик</a> щекочет 🤭 тебя']);
  await handler(inline(user(3), 'абракадабра'));
  assert.equal(answered(api).results.length, 0);
});
