// Inline mode: RP in any chat, even a private one where Финя is not a member.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../tgcloud/handlers/inline_query.js';
import { onMessage } from '../tgcloud/lib/bot.js';
import { db } from 'sdk';
import { apiError, checkErrors, OWNER, privateMessage, setup, user } from './helpers.mjs';

afterEach(checkErrors);

let nextId = 1;
const inline = (from, query, chatType = 'private') => ({ id: String(nextId++), from, query, offset: '', chat_type: chatType });
const answered = (api) => api.called('answerInlineQuery').at(-1).params;
const texts = (params) => params.results.map((r) => r.input_message_content.message_text.replace(/^<b>([\s\S]*)<\/b>$/, '$1'));

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
  // «даёт пять всем», not «всех».
  await handler(inline(anya, 'дать пять', 'supergroup'));
  assert.match(texts(answered(api))[0], /даёт пять всем$/);
  await handler(inline(anya, 'пожать руку'));
  assert.match(texts(answered(api))[0], /жмёт руку тебе$/);
  await handler(inline(anya, 'подарить цветы', 'sender'));
  assert.match(texts(answered(api))[0], /дарит цветы Фине$/);
  await handler(inline(anya, 'кусь'));
  assert.match(texts(answered(api))[0], /делает кусь тебе$/);
  await handler(inline(anya, 'угостить чаем'));
  assert.match(texts(answered(api))[0], /угощает чаем тебя$/);
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

test('premium emoji from the owner\'s packs; plain ones if Telegram refuses', async () => {
  let refuse = false;
  const api = await setup({
    answerInlineQuery: (p) => {
      if (refuse && /tg-emoji/.test(p.results[0].input_message_content.message_text)) throw apiError('answerInlineQuery', 400, 'Bad Request: DOCUMENT_INVALID');
      return true;
    },
  });
  await db.run("INSERT INTO premium_emoji (base, custom_id, set_name, picked, added_at) VALUES ('🤗', '5368324170671202286', 'pack', 1, 0), ('💬', '5368324170671202287', 'pack', 1, 0)");
  await handler(inline(user(2, { first_name: 'Аня' }), 'обнять @vasya скучала'));
  assert.deepEqual(texts(answered(api)), [
    '<tg-emoji emoji-id="5368324170671202286">🤗</tg-emoji> <a href="tg://user?id=2">Аня</a> обнимает @vasya\n' +
      '<tg-emoji emoji-id="5368324170671202287">💬</tg-emoji> «скучала»',
  ]);
  refuse = true;
  await handler(inline(user(2, { first_name: 'Аня' }), 'обнять'));
  assert.equal(api.called('answerInlineQuery').length, 3);
  assert.deepEqual(texts(answered(api)), ['🤗 <a href="tg://user?id=2">Аня</a> обнимает тебя']);
});
