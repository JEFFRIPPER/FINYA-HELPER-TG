// The «Ты» row under «Финя, Топ», a quiz hint half way, horoscope sign buttons.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, fetchMock } from 'sdk';
import { onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import * as events from '../tgcloud/lib/events.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { callback, checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, replies, setup, user } from './helpers.mjs';

afterEach(() => { fetchMock.reset(); return checkErrors(); });

const say = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));
const texts = (api) => replies(api).map((c) => c.params.text);

test('«Финя, Топ»: the asker\'s own place under the list, also below the ten', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  for (let id = 2; id <= 13; id++) {
    await db.run('INSERT INTO profiles (user_id, name, username, xp) VALUES (?, ?, ?, ?)', [id, `M${id}`, `u${id}`, 2000 - id * 100]);
  }
  await say(user(13), 'Финя, топ');
  assert.match(texts(api).at(-1), /👤 Ты: 12 место · 700 XP/);
  await say(user(40, { first_name: 'Новый' }), 'Топ XP');
  assert.match(texts(api).at(-1), /👤 Ты пока без XP/);
});

test('quiz: a hint after half an hour, once; none after a right answer', async () => {
  const api = await setup();
  await db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0)', [DISCUSSION.id, DISCUSSION.title, OWNER.id]);
  const t0 = nowInt();
  await events.postQuiz(DISCUSSION.id, t0);
  const hints = () => texts(api).filter((t) => /💡 Подсказка/.test(t));
  await events.tick(t0 + 10 * 60);
  assert.equal(hints().length, 0);
  await events.tick(t0 + events.QUIZ_HINT_AFTER + 1);
  await events.tick(t0 + events.QUIZ_HINT_AFTER + 60);
  assert.equal(hints().length, 1);
  await events.tick(t0 + events.QUIZ_TTL + 1);
  assert.ok(!(await db.get("SELECT 1 AS n FROM settings WHERE key LIKE 'quiz_hint:%'")));
  assert.equal(events.hintText('огурец'), '💡 Подсказка: начинается на «О», 6 букв.');
  assert.equal(events.hintText('ёлка'), '💡 Подсказка: начинается на «Ё», 4 буквы.');
  assert.equal(events.hintText('42'), '💡 Подсказка: ответ — число из 2 цифр, последняя — 2.');
});

test('horoscope: twelve sign buttons, a tap shows that sign in place', async () => {
  const api = await setup();
  fetchMock.handler = async (url) => ({ text: `<html><body><h1>Гороскоп на сегодня</h1><div class="article">
<p>Прогноз ${/prediction\/(\w+)\//.exec(url)[1]}: день подходит для новых дел и встреч.</p>
<p>Вечером лучше отдохнуть и не принимать поспешных решений.</p></div></body></html>` });
  const a = user(2, { first_name: 'Аня' });
  await onMessage(privateMessage(a, 'Гороскоп Рыбы'));
  const msg = replies(api).at(-1);
  const buttons = msg.params.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length, 12);
  assert.ok(buttons.some((b) => b.text === '• ♓ Рыбы' && b.callback_data === 'horo:pisces'));
  await onCallbackQuery(callback(a, 'horo:leo', { message_id: 900, text: 'old', reply_markup: msg.params.reply_markup }));
  const edited = api.called('editMessageText').at(-1).params;
  assert.equal(edited.message_id, 900);
  assert.match(edited.text, /♌ Лев · гороскоп на/);
  assert.ok(edited.reply_markup.inline_keyboard.flat().some((b) => b.text === '• ♌ Лев'));
  await onCallbackQuery(callback(a, 'horo:nope'));
});
