// Гороскоп с horo.mail.ru, знак зодиака в «Кто Я», вопрос дня опросом, «Сравнить», «Финя, До …».
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

// Shaped like a horo.mail.ru page: navigation, the heading, the forecast, links below.
const page = (key) => `<!doctype html><html><head><meta name="description" content="Гороскоп на сегодня: короткое описание для ${key}.">
<script>window.__x = "<p>не тот текст из скрипта, длинный и с точкой в конце.</p>";</script></head><body>
<nav><a href="/">Гороскопы</a></nav><div>Прогноз на 25 октября</div>
<h1>Гороскоп на сегодня: ${key}</h1>
<ul><li><a href="/prediction/aries/today/">Овен</a> 21 марта — 20 апреля</li></ul>
<div class="article"><p>${key === 'pisces' ? 'Рыбам &laquo;везёт&raquo; сегодня: день&nbsp;хороший, всё получится.' : `Прогноз ${key}: день подходит для новых дел и встреч.`}</p>
<p>Вечером лучше отдохнуть и не принимать <b>поспешных</b> решений.</p></div>
<p>Финансы</p><p>Подпишитесь на рассылку, чтобы получать гороскоп каждый день.</p></body></html>`;

test('horoscope: parsed from horo.mail.ru, cached for the day, honest when the site is down', async () => {
  const api = await setup();
  assert.equal(parseHoroscope(page('pisces')), 'Рыбам «везёт» сегодня: день хороший, всё получится.\n\nВечером лучше отдохнуть и не принимать поспешных решений.');
  // No paragraphs: the structured data, then the description.
  assert.equal(parseHoroscope('<script type="application/ld+json">{"articleBody":"Звёзды советуют \\"не спешить\\" сегодня и беречь силы."}</script>'), 'Звёзды советуют "не спешить" сегодня и беречь силы.');
  assert.equal(parseHoroscope('<meta name="description" content="Овнам сегодня повезёт в делах и в любви.">'), 'Овнам сегодня повезёт в делах и в любви.');
  assert.equal(parseHoroscope('<html>moved</html>'), null);
  assert.equal(signByName('рыбы').key, 'pisces');
  assert.equal(signByName('льва').key, 'leo');
  assert.equal(signByName('козерога').key, 'capricorn');
  assert.equal(zodiac(16, 12).key, 'sagittarius');

  const a = user(2, { first_name: 'Аня' });
  fetchMock.handler = async () => ({ status: 403 });
  await onMessage(privateMessage(a, 'Гороскоп Рыбы'));
  assert.match(last(api), /не загрузился с horo\.mail\.ru/);
  // The owner sees why in the logs; no new tries for a while.
  const logged = await db.get("SELECT text FROM error_log WHERE source = 'horoscope'");
  assert.match(logged.text, /horo\.mail\.ru\/prediction\/pisces\/today\/: HTTP 403/);
  await onMessage(privateMessage(a, 'Гороскоп Рыбы'));
  assert.equal(fetchMock.calls.length, 1);
  await db.run('DELETE FROM error_log');
  await setSetting('horoscope_failed_at', null);

  fetchMock.calls = [];
  fetchMock.handler = async (url) => ({ text: page(/prediction\/(\w+)\//.exec(url)[1]) });
  await onMessage(privateMessage(a, 'Гороскоп Рыбы'));
  assert.match(last(api), /♓ Рыбы · гороскоп на/);
  assert.match(last(api), /<blockquote expandable>Рыбам «везёт» сегодня/);
  assert.match(last(api), /Источник: horo\.mail\.ru/);
  await onMessage(privateMessage(a, 'гороскоп льва'));
  assert.match(last(api), /Прогноз leo/);
  await onMessage(privateMessage(a, 'Гороскоп Рыбы'));
  // One page per sign, each once a day.
  assert.deepEqual(fetchMock.calls.map((c) => c.url), ['https://horo.mail.ru/prediction/pisces/today/', 'https://horo.mail.ru/prediction/leo/today/']);
});

test('the zodiac sign follows the birthday: «Кто Я», «Мой Знак» and the own horoscope', async () => {
  const api = await setup();
  fetchMock.handler = async (url) => ({ text: page(/prediction\/(\w+)\//.exec(url)[1]) });
  const a = user(2, { first_name: 'Аня' });
  await onMessage(privateMessage(a, 'Гороскоп'));
  assert.match(last(api), /\+ДР/);
  await db.run('INSERT INTO birthdays (user_id, day, month, announce, updated_at) VALUES (2, 1, 3, 1, 0)');
  await onMessage(privateMessage(a, 'Кто я'));
  assert.match(last(api), /♓ Знак зодиака: Рыбы/);
  await onMessage(privateMessage(a, 'Мой знак'));
  assert.match(last(api), /Твой знак: Рыбы/);
  await onMessage(privateMessage(a, 'Гороскоп'));
  assert.match(last(api), /Рыбам «везёт»/);
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

test('question polls: every 3 hours from 9:00, none at night, once per slot, switchable; owner sends one now', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0)', [DISCUSSION.id, DISCUSSION.title, OWNER.id]);
  const base = nowInt();
  const midnight = base - ((base + 3 * 3600) % 86400);
  const at = (h, m = 30) => midnight + h * 3600 + m * 60;
  await questions.tick(at(3));
  await questions.tick(at(6));
  await questions.tick(at(8, 59));
  assert.equal(api.called('sendPoll').length, 0);
  await questions.tick(at(9, 5));
  await questions.tick(at(11, 50));
  const polls = api.called('sendPoll');
  assert.equal(polls.length, 1);
  assert.equal(polls[0].params.chat_id, DISCUSSION.id);
  assert.equal(polls[0].params.is_anonymous, false);
  assert.match(polls[0].params.question, /^❓ /);
  assert.ok(polls[0].params.options.length >= 2);
  await questions.tick(at(12, 1));
  await questions.tick(at(21));
  await questions.tick(at(24));
  assert.equal(api.called('sendPoll').length, 4);
  await questions.tick(at(27));
  assert.equal(api.called('sendPoll').length, 4);

  await say(OWNER, 'Финя, Вопрос Дня');
  assert.equal(api.called('sendPoll').length, 5);
  assert.notEqual(api.called('sendPoll')[4].params.question, polls[0].params.question);

  await say(OWNER, 'Финя, Вопрос Дня Выкл');
  await questions.tick(at(36));
  assert.equal(api.called('sendPoll').length, 5);
});

test('question polls: Telegram limits, no repeats', () => {
  assert.ok(questions.QUESTIONS.length >= 90);
  assert.equal(new Set(questions.QUESTIONS.map(([q]) => q)).size, questions.QUESTIONS.length);
  for (const [q, options] of questions.QUESTIONS) {
    assert.ok(q.length + 2 <= 300, q);
    assert.ok(options.length >= 2 && options.length <= 10, q);
    for (const o of options) assert.ok(o.length >= 1 && o.length <= 100, o);
  }
});
