// «Может, ты имел в виду …?» for a mistyped command.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { onMessage } from '../tgcloud/lib/bot.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { closest, distance } from '../tgcloud/lib/typo.js';
import { checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const say = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));
const texts = (api) => replies(api).map((c) => c.params.text);
const hint = /Может, ты имел в виду/;

test('distance: swaps, missing and extra letters count as one', async () => {
  await setup();
  assert.equal(distance('профиль', 'профиль'), 0);
  assert.equal(distance('профль', 'профиль'), 1);
  assert.equal(distance('анктеа', 'анкета'), 1);
  assert.equal(distance('гароскоп', 'гороскоп'), 1);
  assert.equal(distance('кот', 'кит'), 1);
  // Strict: other endings, everyday words, a missing «+» and short words stay messages.
  const keys = ['профиль', 'семья', 'передать', 'помощь', '-награда', 'кто ты', 'кто я', 'гороскоп'];
  assert.equal(closest('профль', keys, { strict: true }), 'профиль');
  assert.equal(closest('гароскоп', keys, { strict: true }), 'гороскоп');
  for (const word of ['семью', 'передал', 'помочь', 'награда', 'кто мы', 'привет', 'профиль']) {
    assert.equal(closest(word, keys, { strict: true }), null, word);
  }
  assert.equal(closest('помочь', keys), 'помощь');
  assert.equal(closest('хто я', keys), 'кто я');
});

test('a typo in a chat: a hint with the right spelling; ordinary words get nothing', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await say(a, 'Профль');
  assert.match(texts(api).at(-1), /Может, ты имел в виду «Профиль»\? Как пользоваться: «Профиль Помощь»/);
  await say(a, 'Финя, моя анктеа');
  assert.match(texts(api).at(-1), /«Моя Анкета»/);
  await say(a, '+ грожданство');
  assert.match(texts(api).at(-1), /«\+Гражданство»/);
  await say(a, 'Финя, тема грфика');
  assert.match(texts(api).at(-1), /«Тема Графика»/);
  const before = texts(api).length;
  for (const t of ['семью', 'помочь', 'награда', 'привет всем', 'ахахах', 'передал']) await say(a, t);
  assert.equal(texts(api).slice(before).filter((t) => hint.test(t)).length, 0);
});

test('a typo in private; the owner\'s commands are hinted to the owner only', async () => {
  const api = await setup();
  const a = user(2, { first_name: 'Аня' });
  await onMessage(privateMessage(a, 'гароскоп'));
  assert.match(texts(api).at(-1), /«Гороскоп»/);
  const before = texts(api).length;
  await onMessage(privateMessage(a, 'обнавить инфо'));
  assert.equal(texts(api).slice(before).filter((t) => hint.test(t)).length, 0);
  await onMessage(privateMessage(OWNER, 'обнавить инфо'));
  assert.match(texts(api).at(-1), /«Обновить Инфо»/);
});
