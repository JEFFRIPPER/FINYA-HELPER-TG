// Гороскоп с ignio.com, знак зодиака в «Кто Я», вопрос дня опросом, «Сравнить», «Финя, До …».
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, fetchMock } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { countdownTarget, parseHoroscope, signByName, zodiac } from '../tgcloud/lib/extras.js';
import * as questions from '../tgcloud/lib/questions.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, replies, setup, user } from './helpers.mjs';

afterEach(() => { fetchMock.reset(); return checkErrors(); });

const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const last = (api) => replies(api).at(-1).params.text;

const KEYS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
const XML = `<?xml version="1.0" encoding="utf-8"?><horo><date today="24.10.2026"/>` +
  KEYS.map((k) => `<${k}><yesterday>вчера</yesterday><today>\n${k === 'pisces' ? 'Рыбам &quot;везёт&quot; сегодня' : `Прогноз ${k}`}\n</today><tomorrow>завтра</tomorrow></${k}>`).join('') +
  '</horo>';

test('horoscope: parsed from the ignio XML, cached for the day, honest when the site is down', async () => {
  const api = await setup();
  assert.equal(parseHoroscope(XML).pisces, 'Рыбам "везёт" сегодня');
  assert.equal(parseHoroscope('<horo><aries><today>x</today></aries></horo>'), null);
  assert.equal(signByName('рыбы').key, 'pisces');
  assert.equal(signByName('льва').key, 'leo');
  assert.equal(signByName('козерога').key, 'capricorn');
  assert.equal(zodiac(16, 12).key, 'sagittarius');

  const a = user(2, { first_name: 'Аня' });
  fetchMock.handler = async () => { throw new Error('down'); };
  await onMessage(privateMessage(a, 'Гороскоп Рыбы'));
  assert.match(last(api), /не загрузился с ignio\.com/);

  fetchMock.handler = async () => ({ text: XML });
  await onMessage(privateMessage(a, 'Гороскоп Рыбы'));
  assert.match(last(api), /♓ Рыбы · гороскоп на/);
  assert.match(last(api), /Рыбам &quot;везёт&quot; сегодня/);
  assert.match(last(api), /Источник: ignio\.com/);
  await onMessage(privateMessage(a, 'гороскоп льва'));
  assert.match(last(api), /Прогноз leo/);
  assert.equal(fetchMock.calls.length, 2);
});

test('the zodiac sign follows the birthday: «Кто Я», «Мой Знак» and the own horoscope', async () => {
  const api = await setup();
  fetchMock.handler = async () => ({ text: XML });
  const a = user(2, { first_name: 'Аня' });
  await onMessage(privateMessage(a, 'Гороскоп'));
  assert.match(last(api), /\+ДР/);
  await db.run('INSERT INTO birthdays (user_id, day, month, announce, updated_at) VALUES (2, 1, 3, 1, 0)');
  await onMessage(privateMessage(a, 'Кто я'));
  assert.match(last(api), /♓ Знак зодиака: Рыбы/);
  await onMessage(privateMessage(a, 'Мой знак'));
  assert.match(last(api), /Твой знак: Рыбы/);
  await onMessage(privateMessage(a, 'Гороскоп'));
  assert.match(last(api), /Рыбам &quot;везёт&quot;/);
});

test('«Финя, До Нового Года» counts down; dates and unknown targets', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const ts = nowInt();
  const ny = countdownTarget('нового года', ts);
  assert.ok(ny.at > ts && ny.at - ts <= 366 * 86400);
  assert.equal(countdownTarget('31.02', ts), null);
  assert.equal(countdownTarget('16.12', ts).title, '16 декабря');
  const a = user(2, { first_name: 'Аня' });
  await say(a, 'Финя, до нового года');
  assert.match(last(api), /⏳ До Нового года: \d+ (?:день|дня|дней) \d+ час/);
  await say(a, 'Финя, сколько до 8 марта?');
  assert.match(last(api), /⏳ До 8 Марта/);
});

test('«Сравнить» in reply puts two members side by side', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await say(a, 'привет');
  await say(b, 'привет');
  await say(b, 'ещё');
  await say(a, 'Сравнить', replyTo(b));
  const text = last(api);
  assert.match(text, /Аня/);
  assert.match(text, /Боря/);
  assert.match(text, /XP/);
  assert.match(text, /🏆/);
});

test('question of the day: a public poll at noon, once per chat, switchable; owner sends it now', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0)', [DISCUSSION.id, DISCUSSION.title, OWNER.id]);
  const base = nowInt();
  const noon = base - ((base + 3 * 3600) % 86400) + 12 * 3600 + 1800;
  await questions.tick(noon - 3600);
  assert.equal(api.called('sendPoll').length, 0);
  await questions.tick(noon);
  await questions.tick(noon + 60);
  const polls = api.called('sendPoll');
  assert.equal(polls.length, 1);
  assert.equal(polls[0].params.chat_id, DISCUSSION.id);
  assert.equal(polls[0].params.is_anonymous, false);
  assert.match(polls[0].params.question, /^❓ Вопрос дня: /);
  assert.ok(polls[0].params.options.length >= 2);

  await say(OWNER, 'Финя, Вопрос Дня');
  assert.equal(api.called('sendPoll').length, 2);
  assert.notEqual(api.called('sendPoll')[1].params.question, polls[0].params.question);

  await say(OWNER, 'Финя, Вопрос Дня Выкл');
  await questions.tick(noon + 86400);
  assert.equal(api.called('sendPoll').length, 2);
});
