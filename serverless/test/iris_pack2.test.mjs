// The daily summary in the chat, 64 chat achievements and the chat history sent
// to Финя as a file in the private chat.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage, pump } from '../tgcloud/lib/bot.js';
import { ACHIEVEMENTS, clubData } from '../tgcloud/lib/club.js';
import { CHAT_ACHIEVEMENTS } from '../tgcloud/lib/feats.js';
import { chunksOf, scan } from '../tgcloud/lib/history_file.js';
import { mskDay } from '../tgcloud/lib/members.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import {
  checkErrors, DISCUSSION, groupMessage, isAnnouncement, OWNER, privateMessage, replies, setup, user,
} from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

const DAY = 86400;
const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const announcements = (api) => api.called('sendMessage').filter(isAnnouncement);
const counter = async (id, key) => ((await db.get('SELECT n FROM counters WHERE user_id = ? AND key = ?', [id, key])) || { n: 0 }).n;

test('achievements: 64 chat ones with unique keys and codes after the club ones', async () => {
  await setup();
  assert.equal(CHAT_ACHIEVEMENTS.length, 64);
  assert.equal(ACHIEVEMENTS.length, 80);
  assert.deepEqual(ACHIEVEMENTS.map((a) => a.n), Array.from({ length: 80 }, (_, i) => i + 1));
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.code)).size, 80);
});

test('the 10th message opens «Первые шаги» once, announced in the chat with its XP', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  for (let i = 0; i < 9; i++) await say(a, `привет ${i}`);
  assert.equal(announcements(api).length, 0);
  await say(a, 'десятое');
  const posts = announcements(api);
  assert.equal(posts.length, 1);
  assert.match(posts[0].params.text, /<a href="tg:\/\/user\?id=2">Аня<\/a> открывает ачивку «Первые шаги» · \+5 XP/);
  assert.equal(posts[0].params.chat_id, DISCUSSION.id);
  assert.equal(posts[0].params.reply_parameters, undefined);
  // The announcement goes away after 10 minutes; the member's messages stay.
  const later = await db.all('SELECT delete_at FROM autodelete WHERE chat_id = ?', [DISCUSSION.id]);
  assert.equal(later.length, 1);
  assert.ok(later[0].delete_at - nowInt() > 500);
  const xp = await db.get("SELECT points FROM events WHERE user_id = 2 AND kind = 'achievement' AND message_id = 17");
  assert.equal(xp.points, 5);
  for (let i = 0; i < 10; i++) await say(a, `ещё ${i}`);
  assert.equal(announcements(api).length, 1);
  // The Mini App shows them too.
  const data = await clubData(a, { xpTotal: 0, streakDays: 0, founder: false });
  assert.equal(data.achievements.length, 80);
  assert.ok(data.achievements.find((x) => x.code === 'msgs_10').at);
  assert.equal(data.achievements.find((x) => x.code === 'msgs_100').progress, 20);
});

test('commands check achievements for the author and the one replied to', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await say(a, '+ник Королева');
  assert.match(announcements(api).at(-1).params.text, /Королева<\/a> открывает ачивку «Новое имя»/);
  await db.run('INSERT INTO reputation (user_id, points, given) VALUES (3, 9, 0)');
  await say(a, '+', { reply_to_message: groupMessage(DISCUSSION, b, 'сообщение') });
  assert.match(announcements(api).at(-1).params.text, /Боря<\/a> открывает ачивку «Уважение» · \+15 XP/);
});

test('counters: RP, jackpot, reminders and night messages', async () => {
  const api = await setup({ sendDice: () => ({ message_id: 7000, dice: { emoji: '🎰', value: 64 } }) });
  await setSetting('chat_captcha', false);
  // 21.10.2026 15:00 МСК: the commands themselves are daytime messages.
  Date.now = () => Date.UTC(2026, 9, 21, 12, 0, 0);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await say(a, 'обнять', { reply_to_message: groupMessage(DISCUSSION, b, 'сообщение') });
  assert.equal(await counter(2, 'rp'), 1);
  await db.run("INSERT INTO profiles (user_id, name, xp) VALUES (2, 'Аня', 100)");
  await say(a, 'казино 10');
  assert.equal(await counter(2, 'jackpot'), 1);
  assert.match(announcements(api).at(-1).params.text, /«Три семёрки»/);
  await say(a, 'Финя, напомни через 2ч позвонить');
  assert.equal(await counter(2, 'reminders'), 1);
  // 02:30 МСК is night, 06:00 early morning, 12:00 neither.
  const day = Math.floor(nowInt() / DAY) * DAY - DAY;
  await say(a, 'не сплю', { date: day - 3 * 3600 + 2 * 3600 + 1800 });
  await say(a, 'утро', { date: day - 3 * 3600 + 6 * 3600 });
  await say(a, 'день', { date: day - 3 * 3600 + 12 * 3600 });
  assert.equal(await counter(2, 'night'), 1);
  assert.equal(await counter(2, 'early'), 1);
});

test('«ачивки»: how many are open and the last ones', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await say(a, 'ачивки');
  assert.match(replies(api).at(-1).params.text, /У тебя пока нет ачивок. Их 80/);
  await db.run("INSERT INTO achievements (user_id, code, unlocked_at) VALUES (2, 'msgs_10', 1), (2, 'nick', 2)");
  await say(a, 'ачивки');
  const text = replies(api).at(-1).params.text;
  assert.match(text, /Твои ачивки: \d+ из 80/);
  assert.match(text, /«Новое имя» — Поставь ник/);
});

test('daily summary: the day’s top-3 at 23:55 МСК, once, and the №1 counts', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  // 21.10.2026 23:56 МСК.
  const now = Date.UTC(2026, 9, 21, 20, 56, 0);
  Date.now = () => now;
  const ts = nowInt();
  const today = mskDay(ts);
  for (const [id, name, n] of [[2, 'Аня', 40], [3, 'Боря', 25], [4, 'Вова', 10], [5, 'Галя', 3]]) {
    await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
      VALUES (?, ?, ?, '', 'member', ?, ?, ?)`, [DISCUSSION.id, id, name, ts, ts, n]);
    await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, ?, ?, ?)', [DISCUSSION.id, id, today, n]);
  }
  await pump({ force: true });
  const posts = replies(api).filter((c) => /Итоги дня/.test(c.params.text));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].params.chat_id, DISCUSSION.id);
  assert.match(posts[0].params.text, /🌙 Итоги дня · 21\.10/);
  assert.match(posts[0].params.text, /🥇 Аня — 40 сообщений\n🥈 Боря — 25 сообщений\n🥉 Вова — 10 сообщений/);
  assert.match(posts[0].params.text, /Всего: 78 сообщений · 👥 писали: 4/);
  assert.equal(await counter(2, 'day_top'), 1);
  await pump({ force: true });
  // After midnight the same day is not posted again.
  Date.now = () => now + 3600 * 1000;
  await pump({ force: true });
  assert.equal(replies(api).filter((c) => /Итоги дня/.test(c.params.text)).length, 1);
});

test('daily summary: missed at night, it comes in the morning; off means off', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  // 22.10.2026 09:00 МСК: yesterday's summary was not posted.
  const now = Date.UTC(2026, 9, 22, 6, 0, 0);
  Date.now = () => now;
  const ts = nowInt();
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, 2, 'Аня', '', 'member', ?, ?, 5)`, [DISCUSSION.id, ts, ts]);
  await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, 2, ?, 5)', [DISCUSSION.id, mskDay(ts) - 1]);
  await setSetting('chat_daily', false);
  await pump({ force: true });
  assert.equal(replies(api).filter((c) => /Итоги дня/.test(c.params.text)).length, 0);
  await setSetting('chat_daily', true);
  await pump({ force: true });
  const posts = replies(api).filter((c) => /Итоги дня/.test(c.params.text));
  assert.equal(posts.length, 1);
  assert.match(posts[0].params.text, /Итоги дня · 21\.10/);
  // In the afternoon nothing is due.
  Date.now = () => now + 5 * 3600 * 1000;
  await pump({ force: true });
  assert.equal(replies(api).filter((c) => /Итоги дня/.test(c.params.text)).length, 1);
});

// ---- the history file in the private chat ---------------------------------------

const EXPORT_ID = 2000000001; // DISCUSSION is -1002000000001

function exportOf(messages) {
  return { name: 'Обсуждения', type: 'private_supergroup', id: EXPORT_ID, messages };
}

function msg(id, from, name, ts, extra = {}) {
  return { id, type: 'message', date: '', date_unixtime: String(ts), from: name, from_id: `user${from}`, text: 'привет', ...extra };
}

test('scan: messages per member and day, joins only move «since», channels and bots by id skipped', () => {
  const ts = Date.UTC(2025, 0, 10, 12) / 1000;
  const s = scan(exportOf([
    msg(1, 2, 'Аня', ts),
    msg(2, 2, 'Аня', ts + 60),
    msg(3, 2, 'Аня', ts + DAY),
    msg(4, 3, 'Боря', ts),
    { id: 5, type: 'service', action: 'join_group_by_link', actor_id: 'user3', date_unixtime: String(ts - 10 * DAY) },
    { id: 6, type: 'message', from_id: 'channel1192817776', from: 'Канал', date_unixtime: String(ts) },
    { id: 7, type: 'service', action: 'pin_message', actor_id: 'user2', date_unixtime: String(ts) },
  ]));
  assert.equal(s.total, 4);
  assert.deepEqual(s.chat, { id: EXPORT_ID, type: 'private_supergroup' });
  const ania = s.users.find((u) => u.id === 2);
  assert.deepEqual([...ania.days.values()], [2, 1]);
  assert.equal(s.users.find((u) => u.id === 3).first, ts - 10 * DAY);
  assert.throws(() => scan({ foo: 1 }), /не экспорт чата/);
  // Batches: at most 50 members each.
  const many = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: '', first: ts, last: ts, msgs: 1, days: new Map([[1, 1]]) }));
  assert.deepEqual(chunksOf(many).map((c) => c.length), [50, 50, 20]);
});

test('history file in the private chat: imported with progress, again adds nothing', async () => {
  const ts = nowInt() - 30 * DAY;
  const messages = [];
  for (let i = 0; i < 60; i++) messages.push(msg(i + 1, 100 + i, `Участник ${i}`, ts + i));
  messages.push(msg(100, 2, 'Аня', ts), msg(101, 2, 'Аня', ts + DAY));
  const file = new TextEncoder().encode(JSON.stringify(exportOf(messages)));
  const api = await setup({
    getFileContent: () => file,
    getChat: (p) => ({ ...DISCUSSION, id: p.chat_id }),
    getChatMember: (p) => ({ status: 'member', user: { id: p.user_id, is_bot: false, first_name: `Новый ${p.user_id}` } }),
  });
  const send = () => onMessage(privateMessage(OWNER, undefined, {
    document: { file_id: 'F1', file_unique_id: 'U1', file_name: 'result.json', file_size: file.length },
  }));
  await send();
  const texts = replies(api).filter((c) => c.params.chat_id === OWNER.id).map((c) => c.params.text);
  assert.match(texts[0], /«Обсуждения»: 62 сообщения от 61 человека/);
  assert.match(texts.at(-1), /✅ История «Обсуждения» загружена: \+62 сообщения, новых участников: 61/);
  const ania = await db.get('SELECT msgs FROM chat_members WHERE chat_id = ? AND user_id = 2', [DISCUSSION.id]);
  assert.equal(ania.msgs, 2);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM history_queue')).c, 0);
  await send();
  assert.match(replies(api).at(-1).params.text, /загружена: \+0 сообщений, новых участников: 0/);
});

test('history file: too big for the Bot API goes to the Mini App; not JSON is explained', async () => {
  const api = await setup({ getFileContent: () => new TextEncoder().encode('не json') });
  await onMessage(privateMessage(OWNER, undefined, {
    document: { file_id: 'F2', file_unique_id: 'U2', file_name: 'result.json', file_size: 50 * 1024 * 1024 },
  }));
  assert.match(replies(api).at(-1).params.text, /50,0 МБ: Telegram отдаёт ботам файлы только до 20 МБ/);
  assert.equal(api.called('getFileContent').length, 0);
  assert.match(JSON.stringify(replies(api).at(-1).params.reply_markup), /open=history/);
  await onMessage(privateMessage(OWNER, undefined, {
    document: { file_id: 'F3', file_unique_id: 'U3', file_name: 'result.json', file_size: 100 },
  }));
  assert.match(replies(api).at(-1).params.text, /Не получилось прочитать файл как JSON/);
  // Somebody else's .json is not an import.
  const before = replies(api).length;
  await onMessage(privateMessage(user(5), undefined, {
    document: { file_id: 'F4', file_unique_id: 'U4', file_name: 'result.json', file_size: 100 },
  }));
  assert.ok(!replies(api).slice(before).some((c) => /JSON|История/.test(c.params.text)));
});
