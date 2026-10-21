// «Кто Я» like Iris: the activity chart, activity per period, «о себе» and awards.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { mskDay } from '../tgcloud/lib/members.js';
import { setSetting } from '../tgcloud/lib/store.js';
import {
  apiError, BOT, checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, setup, user, replies } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

// Wednesday 21.10.2026, 12:00 in Moscow: the week started on Monday 19.10.
const NOW = Date.UTC(2026, 9, 21, 9, 0, 0);
const ts = NOW / 1000;
const DAY = 86400;

const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const photos = (api) => api.called('sendPhoto');
const lastText = (api) => replies(api).at(-1).params.text;
// Only user 1 is the creator, user 4 an admin; everyone else is a member.
const roles = {
  getChatMember: (p) => {
    if (p.user_id === 1) return { status: 'creator', user: { id: 1 } };
    if (p.user_id === 4) return { status: 'administrator', custom_title: 'Модер', user: { id: 4 } };
    return { status: 'member', user: { id: p.user_id, is_bot: p.user_id === BOT.id } };
  },
};

async function history(userId, rows, member) {
  for (const [daysAgo, msgs] of rows) {
    await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, ?, ?, ?)',
      [DISCUSSION.id, userId, mskDay(ts) - daysAgo, msgs]);
  }
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, ?, ?, '', 'member', ?, ?, ?)`, [DISCUSSION.id, userId, member.name, member.since, member.last, member.msgs]);
}

// The PNG's size and its pixels, unpacked.
function readPng(bytes) {
  assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  let at = 8;
  let raw = null;
  while (at < bytes.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    if (type === 'IDAT') raw = inflateSync(bytes.slice(at + 8, at + 8 + len));
    at += 12 + len;
  }
  return { width, height, raw };
}

test('«кто я»: the activity chart with the profile like Iris has it', async () => {
  const api = await setup(roles);
  Date.now = () => NOW;
  await setSetting('chat_captcha', false);
  const u = user(1, { first_name: 'Святой Отец' });
  // Today 2, Tuesday 3, last Friday 100, September 7000: plus the «кто я» itself.
  await history(1, [[0, 2], [1, 3], [5, 100], [40, 7000]], { name: 'Святой Отец', since: ts - 40 * DAY, last: ts - 3600, msgs: 7105 });
  await db.run('INSERT INTO reputation (user_id, points, given) VALUES (1, 667, 12)');
  await say(u, 'кто я');

  const sent = photos(api).at(-1).params;
  const text = sent.caption;
  assert.match(text, /^<b>👤 Это пользователь Святой Отец\n👑 Создатель этого чата\n\n/);
  assert.match(text, /🎖 \[I\] Звание: Искра/);
  assert.match(text, /❤️ Репутация: 667 · ➕ отдано 12/);
  assert.match(text, /🏠 Первое появление: 11\.09\.2026 \(1 мес 9 дн\)/);
  assert.match(text, /🕒 Последний актив: только что/);
  assert.match(text, /💬 Актив \(д\|н\|м\|весь\): 3 \| 6 \| 106 \| 7,1k/);
  assert.match(text, /📝 О себе: пусто/);
  assert.equal(sent.reply_markup.inline_keyboard[0][0].text.includes('Профиль Фини'), true);

  // The chart: a real PNG, 900×300, palette pixels row by row.
  assert.equal(sent.photo.type, 'image/png');
  const png = readPng(sent.photo.bytes);
  assert.deepEqual([png.width, png.height], [900, 300]);
  assert.equal(png.raw.length, 300 * 901);
  // The bars use the red colors: September's tall day is in there.
  assert.ok(png.raw.some((b, i) => i % 901 !== 0 && (b === 2 || b === 3)));

  // Someone else's profile: an admin's tag, the last message hours ago.
  await history(4, [[0, 1]], { name: 'Модератор', since: ts - 3 * DAY, last: ts - 2 * 3600, msgs: 1 });
  await say(user(2), 'кто ты', replyTo(user(4, { first_name: 'Модератор' })));
  const other = photos(api).at(-1).params;
  assert.match(other.caption, /⭐ Админ этого чата · «Модер»/);
  assert.match(other.caption, /🕒 Последний актив: 2 ч назад/);
  assert.equal(other.reply_markup, undefined);
});

test('no right to send photos: the profile comes as text', async () => {
  const api = await setup({
    ...roles,
    sendPhoto: () => { throw apiError('sendPhoto', 400, 'Bad Request: not enough rights to send photos to the chat'); },
  });
  await setSetting('chat_captcha', false);
  await say(user(2, { first_name: 'Боря' }), 'кто я');
  assert.match(lastText(api), /👤 Это пользователь Боря/);
  assert.match(lastText(api), /Актив \(д\|н\|м\|весь\): 1 \| 1 \| 1 \| 1/);
});

test('in the private chat the profile has no chart and no chat lines', async () => {
  const api = await setup();
  await onMessage(privateMessage(user(2, { first_name: 'Боря' }), 'кто я'));
  assert.equal(photos(api).length, 0);
  assert.match(lastText(api), /👤 Это пользователь Боря/);
  assert.doesNotMatch(lastText(api), /Актив|Первое появление/);
});

test('«+описание»: a few lines about yourself, in the profile and in full', async () => {
  const api = await setup(roles);
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await say(a, `+описание ${'а'.repeat(301)}`);
  assert.match(lastText(api), /до 300 символов/);
  await say(a, '+Описание Люблю мемы\n\nи котов');
  assert.match(lastText(api), /Описание обновлено/);
  await say(a, 'кто я');
  assert.match(photos(api).at(-1).params.caption, /📝 О себе:\n<blockquote>Люблю мемы\nи котов<\/blockquote>/);

  // A long one: the profile shows the start, «описание» the whole.
  const long = 'Слово '.repeat(40).trim();
  await say(a, `+описание ${long}`);
  await say(b, 'кто ты', replyTo(a));
  assert.match(photos(api).at(-1).params.caption, /…<\/blockquote>\nЦеликом: «Описание» ответом/);
  await say(b, 'описание', replyTo(a));
  assert.match(lastText(api), new RegExp(`📝 О себе · Аня\\n<blockquote>${long}</blockquote>`));
  // Works in the private chat too.
  await onMessage(privateMessage(a, 'описание'));
  assert.match(lastText(api), /О себе · Аня/);

  await say(a, '-описание');
  assert.match(lastText(api), /Описание удалено/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM profile_about')).c, 0);
});

test('awards: admins hand them out, the profile shows them, «награды» lists them', async () => {
  const api = await setup(roles);
  await setSetting('chat_captcha', false);
  const admin = user(4, { first_name: 'Модератор' });
  const member = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await say(b, 'привет');

  await say(member, 'наградить Лучший мем', replyTo(b));
  assert.match(lastText(api), /Награждать могут только админы/);
  await say(admin, 'наградить Лучший мем недели', replyTo(b));
  assert.match(lastText(api), /🏅 <a href="tg:\/\/user\?id=3">Боря<\/a> получает награду «Лучший мем недели»!/);
  await say(OWNER, 'Наградить Отец года', replyTo(b));
  await say(admin, 'наградить', replyTo(b));
  assert.match(lastText(api), /Напиши название награды/);
  await say(admin, 'наградить Мне', replyTo(BOT));
  assert.match(lastText(api), /Ботам награды ни к чему/);

  await say(b, 'кто я');
  assert.match(photos(api).at(-1).params.caption, /🏅 Награды:\n🎖 Отец года, 1 мин\n🎖 Лучший мем недели, 1 мин/);
  await say(member, 'награды', replyTo(b));
  assert.match(lastText(api), /🏅 Награды · Боря\n\n1\. Отец года, 1 мин\n2\. Лучший мем недели, 1 мин/);

  await say(member, 'снять награду 1', replyTo(b));
  assert.match(lastText(api), /Снимать награды могут только админы/);
  await say(admin, 'снять награду 1', replyTo(b));
  assert.match(lastText(api), /Награда «Отец года» снята/);
  await say(admin, 'снять награду 5', replyTo(b));
  assert.match(lastText(api), /Такой награды нет/);
  assert.deepEqual((await db.all('SELECT text FROM awards')).map((r) => r.text), ['Лучший мем недели']);
});
