// «Моя анкета» like Iris: the member across every Squad chat, with «+ДР», «+Пол», «+Город».
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { ageOf, streaks, zodiac } from '../tgcloud/lib/anketa.js';
import { mskDay } from '../tgcloud/lib/members.js';
import { setSetting } from '../tgcloud/lib/store.js';
import {
  checkErrors, DISCUSSION, FAMILY, groupMessage, OWNER, privateMessage, replies, setup, user,
} from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

// Wednesday 21.10.2026, 12:00 in Moscow.
const NOW = Date.UTC(2026, 9, 21, 9, 0, 0);
const ts = NOW / 1000;
const DAY = 86400;
const today = mskDay(ts);

const photos = (api) => api.called('sendPhoto');
const lastText = (api) => replies(api).at(-1).params.text;

async function member(chat, userId, { since, msgs, days = [] }) {
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, ?, ?, '', 'member', ?, ?, ?)`, [chat.id, userId, `U${userId}`, since, ts - 3600, msgs]);
  for (const [daysAgo, n] of days) {
    await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, ?, ?, ?)', [chat.id, userId, today - daysAgo, n]);
  }
}

test('helpers: zodiac, age, streaks', async () => {
  await setup();
  assert.equal(zodiac(16, 12), '♐ Стрелец');
  assert.equal(zodiac(25, 12), '♑ Козерог');
  assert.equal(zodiac(19, 1), '♑ Козерог');
  assert.equal(zodiac(20, 1), '♒ Водолей');
  assert.equal(ageOf({ day: 16, month: 12, year: 1999 }, ts), 26);
  assert.equal(ageOf({ day: 21, month: 10, year: 2000 }, ts), 26);
  assert.equal(ageOf({ day: 16, month: 12, year: null }, ts), null);
  assert.deepEqual(streaks([1, 2, 3, 7, 8], 9), { current: 2, best: 3 });
  assert.deepEqual(streaks([1, 2, 3, 7, 8], 10), { current: 0, best: 3 });
  assert.deepEqual(streaks([], 10), { current: 0, best: 0 });
});

test('«моя анкета» sums every Squad chat; «+ДР», «+Пол», «+Город» fill it in', async () => {
  const api = await setup();
  Date.now = () => NOW;
  await setSetting('chat_captcha', false);
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_on'));
  const a = user(2, { first_name: 'Сон' });
  await member(DISCUSSION, 2, { since: ts - 800 * DAY, msgs: 5000, days: [[1, 300], [2, 10], [40, 780]] });
  await member(FAMILY, 2, { since: ts - 30 * DAY, msgs: 200, days: [[1, 50], [2, 5], [3, 5]] });
  for (let h = 0; h < 24; h++) {
    await db.run("INSERT INTO counters (user_id, key, n) VALUES (2, ?, ?)", [`h${h}`, h === 23 ? 40 : 1]);
  }

  const say = (text, extra) => onMessage(groupMessage(DISCUSSION, a, text, extra));
  await say('+ДР 16.12.1999');
  assert.match(lastText(api), /Дата рождения: 16\.12\.1999 \(26 лет\) · ♐ Стрелец/);
  await say('+Пол М');
  assert.match(lastText(api), /Пол: мужской/);
  await say('+Город Узловая');
  assert.match(lastText(api), /Город: Узловая/);
  await say('+Пол Котик');
  assert.match(lastText(api), /❌ Напиши «\+Пол М» или «\+Пол Ж»/);

  await say('Моя анкета');
  const caption = photos(api).at(-1).params.caption;
  assert.match(caption, /📋 Анкета · Сон/);
  assert.match(caption, /🆔 <code>2<\/code>/);
  assert.match(caption, /⏱ В Скваде: с \d\d\.\d\d\.2024 \(2 года 2 мес\)/);
  assert.match(caption, /👨 Пол: мужской/);
  assert.match(caption, /🎂 Дата рождения: 16\.12\.1999 \(26 лет\) · ♐ Стрелец/);
  assert.match(caption, /🏙 Город: Узловая/);
  // Today counts the «моя анкета» itself: 1 | week | month | 5000 + 200 + the commands.
  assert.match(caption, /💬 Актив \(д\|н\|м\|всего\): \d+ \| \d+ \| \d+ \| 5,2k/);
  assert.match(caption, /🔥 Серия: 4 дня подряд · рекорд 4/);
  assert.match(caption, /🏆 Рекордный день: 780 сообщений, 11\.09\.2026/);
  assert.match(caption, /🕐 Час пик: 23:00–00:00 · 🌆 вечером/);
  assert.match(caption, /❤️ Любимый чат: «Чат»/);
  assert.match(caption, /🏠 Житель чатов:\n• «Чат» 2 года 2 мес \(с 12\.08\.2024\)\n• «Squad Family» 30 дней \(с 21\.09\.2026\)/);
  assert.match(caption, /💰 В мешке:\n⚡ \d+ XP · на балансе \d+/);
  assert.doesNotMatch(caption, /Дополни анкету/);
});

test('«анкета» in reply shows someone else without the ID; the private chat works too', async () => {
  const api = await setup();
  Date.now = () => NOW;
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await member(DISCUSSION, 3, { since: ts - 10 * DAY, msgs: 20, days: [[0, 5]] });
  await onMessage(groupMessage(DISCUSSION, a, 'анкета', { reply_to_message: groupMessage(DISCUSSION, b, 'привет') }));
  const caption = photos(api).at(-1).params.caption;
  assert.match(caption, /📋 Анкета · Боря/);
  assert.doesNotMatch(caption, /🆔/);
  assert.doesNotMatch(caption, /Дополни анкету/);

  await onMessage(privateMessage(b, 'моя анкета'));
  const own = photos(api).at(-1).params;
  assert.equal(own.chat_id, 3);
  assert.match(own.caption, /Дополни анкету: «\+Пол М», «\+ДР 16\.12\.1999», «\+Город Москва»/);
});

test('«-ДР», «-Город» and bad dates; the hour is counted for every message', async () => {
  const api = await setup();
  Date.now = () => NOW;
  await setSetting('chat_captcha', false);
  const a = user(2);
  const say = (text) => onMessage(groupMessage(DISCUSSION, a, text));
  await say('+ДР 31.02.2000');
  assert.match(lastText(api), /❌ В этом месяце нет такого дня/);
  await say('+ДР 16.12.2030');
  assert.match(lastText(api), /❌ Проверь год рождения/);
  await say('+ДР 16.12');
  assert.match(lastText(api), /Дата рождения: 16\.12 · ♐ Стрелец/);
  await say('-ДР');
  assert.match(lastText(api), /Убрала из анкеты/);
  assert.ok(!(await db.get('SELECT 1 FROM birthdays WHERE user_id = 2')));
  await say('-Город');
  assert.match(lastText(api), /и так нет/);
  // 12:00 МСК.
  const row = await db.get("SELECT n FROM counters WHERE user_id = 2 AND key = 'h12'");
  assert.ok(row && row.n >= 5);
});
