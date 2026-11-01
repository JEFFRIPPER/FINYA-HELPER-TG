// Holidays, answers to frequent questions, the «Штаб» watch, members who went quiet
// and the chest on the 7th day of the daily reward.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onCallbackQuery, onMessage, pump } from '../tgcloud/lib/bot.js';
import * as auto from '../tgcloud/lib/auto.js';
import * as club from '../tgcloud/lib/club.js';
import { handle } from '../tgcloud/lib/club_app.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { callback, checkErrors, DISCUSSION, groupMessage, OWNER, replies, setup, user } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});
const at = (ts) => { Date.now = () => ts * 1000; };
const DAY = 86400;
// Moscow time as unix seconds.
const msk = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h - 3, min) / 1000;
const texts = (api) => replies(api).map((c) => c.params.text);
const sentTo = (api, id) => replies(api).filter((c) => c.params.chat_id === id).map((c) => c.params.text);
const known = (id) => db.run('INSERT OR IGNORE INTO users (user_id, first_seen, last_seen, subscribed) VALUES (?, 1, 1, 1)', [id]);
const bonus = async (userId, kind) => (await db.get('SELECT COALESCE(SUM(points), 0) AS s FROM events WHERE user_id = ? AND kind = ?', [userId, kind])).s;
const inChat = () => db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0)', [DISCUSSION.id, DISCUSSION.title, OWNER.id]);
const say = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));

test('holiday: the greeting once at 10:00, +20 XP once per member, a 🎉 and the badge count', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await setSetting('chat_holidays', true);
  await inChat();
  assert.equal(auto.holidayOn(msk(2026, 11, 3, 12)), null);
  assert.equal(auto.holidayOn(msk(2026, 11, 4, 12)).title, 'День народного единства');
  at(msk(2026, 11, 4, 9));
  await pump({ force: true });
  assert.ok(!texts(api).some((t) => /С праздником/.test(t)));
  at(msk(2026, 11, 4, 10, 5));
  await pump({ force: true });
  await pump({ force: true });
  const greetings = sentTo(api, DISCUSSION.id).filter((t) => /День народного единства! Сквад, с праздником/.test(t));
  assert.equal(greetings.length, 1);
  assert.match(greetings[0], /\+20 XP/);
  await say(user(2), 'всех с праздником');
  await say(user(2), 'ещё раз');
  assert.equal(await bonus(2, 'holiday'), 20);
  assert.equal(api.called('setMessageReaction').length, 1);
  assert.equal((await db.get("SELECT n FROM counters WHERE user_id = 2 AND key = 'holiday'")).n, 1);
  // Switched off: nothing.
  await setSetting('chat_holidays', false);
  await say(user(3), 'привет');
  assert.equal(await bonus(3, 'holiday'), 0);
});

test('FAQ: a question gets the answer from the list, once in 10 minutes; the owner edits the list', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await say(user(2), 'Ребят, как получить XP?');
  assert.match(texts(api).at(-1), /💡 XP дают за комментарии/);
  const n = replies(api).length;
  await say(user(3), 'а как получить xp');
  assert.equal(replies(api).length, n);
  // Not a question, or no match: silence.
  await say(user(4), 'я где-то видел правила');
  await say(user(4), 'когда стрим?');
  assert.equal(replies(api).length, n);
  // A plain question still earns XP like any message.
  await handle(OWNER, { action: 'faq_save', list: [{ keys: 'когда, стрим', answer: 'Стримы по пятницам в 20:00.' }, { keys: '', answer: 'пусто' }] });
  assert.deepEqual(await auto.faqList(), [{ keys: ['когда', 'стрим'], answer: 'Стримы по пятницам в 20:00.' }]);
  await say(user(4), 'Когда будет стрим?');
  assert.match(texts(api).at(-1), /Стримы по пятницам/);
  await assert.rejects(handle(user(2), { action: 'faq_save', list: [] }), /Неизвестное действие/);
  await setSetting('chat_faq', false);
  await db.run("DELETE FROM settings WHERE key LIKE 'faq_at:%'");
  const m = replies(api).length;
  await say(user(5), 'Когда стрим?');
  assert.equal(replies(api).length, m);
});

test('«Штаб» watch: a word after 14 quiet days, the owner and a button at 21, reset when back', async () => {
  const api = await setup();
  await setSetting('auto_staff', true);
  for (const id of [2, OWNER.id]) await known(id);
  const t0 = msk(2026, 11, 1, 13);
  await db.run("INSERT INTO profiles (user_id, name) VALUES (2, 'Аня')");
  await db.run("INSERT INTO positions (user_id, code, given_by, given_at) VALUES (2, 'content', 1, ?)", [t0 - 30 * DAY]);
  await db.run("INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs) VALUES (?, 2, 'Аня', '', 'member', 0, ?, 5)", [DISCUSSION.id, t0 - 10 * DAY]);
  at(t0);
  await pump({ force: true });
  assert.equal(sentTo(api, 2).length, 0);
  at(t0 + 5 * DAY);
  await pump({ force: true });
  assert.match(sentTo(api, 2).at(-1), /Тебя не было в Скваде уже 15 дней/);
  const alerts = () => sentTo(api, OWNER.id).filter((t) => /молчит/.test(t));
  assert.equal(alerts().length, 0);
  at(t0 + 6 * DAY);
  await pump({ force: true });
  assert.equal(sentTo(api, 2).length, 1);
  at(t0 + 12 * DAY);
  await pump({ force: true });
  const alert = replies(api).filter((c) => c.params.chat_id === OWNER.id && /молчит/.test(c.params.text)).at(-1);
  assert.match(alert.params.text, /Аня молчит уже 22 дней/);
  assert.match(JSON.stringify(alert.params.reply_markup), /staffdrop:2:content/);
  at(t0 + 13 * DAY);
  await pump({ force: true });
  assert.equal(alerts().length, 1);
  await onCallbackQuery(callback(OWNER, 'staffdrop:2:content', { chat: { id: OWNER.id, type: 'private' }, message_id: 50, text: 'x' }));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM positions WHERE user_id = 2')).c, 0);
  assert.match(api.called('editMessageText').at(-1).params.text, /снята с Аня/);
});

test('«Штаб» watch: someone else can\'t press «Снять»; activity resets the reminder', async () => {
  const api = await setup();
  await setSetting('auto_staff', true);
  await known(3);
  const t0 = msk(2026, 11, 1, 13);
  await db.run("INSERT INTO positions (user_id, code, given_by, given_at) VALUES (3, 'creative', 1, ?)", [t0 - 30 * DAY]);
  at(t0);
  await pump({ force: true });
  assert.equal(sentTo(api, 3).length, 1);
  await db.run("INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs) VALUES (?, 3, 'Б', '', 'member', 0, ?, 5)", [DISCUSSION.id, t0 + DAY]);
  at(t0 + 2 * DAY);
  await pump({ force: true });
  assert.equal(await db.get("SELECT 1 AS x FROM settings WHERE key = 'staff_nudge:3'"), null);
  await onCallbackQuery(callback(user(3), 'staffdrop:3:creative', { chat: { id: 3, type: 'private' }, message_id: 51, text: 'x' }));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM positions WHERE user_id = 3')).c, 1);
});

test('comeback: off by default; on, one message a month and +30 XP for writing in 3 days', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const t0 = msk(2026, 11, 1, 15);
  for (const id of [2, 3, 4]) await known(id);
  const member = (id, seen) => db.run("INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs) VALUES (?, ?, ?, '', 'member', 0, ?, 5)", [DISCUSSION.id, id, `U${id}`, seen]);
  await member(2, t0 - 10 * DAY);
  await member(3, t0 - 2 * DAY);
  await member(4, t0 - 90 * DAY);
  at(t0);
  await pump({ force: true });
  assert.equal(sentTo(api, 2).length, 0);
  await setSetting('auto_comeback', true);
  await pump({ force: true });
  assert.match(sentTo(api, 2).at(-1), /Давно тебя не видно в Скваде: уже 10 дней/);
  assert.equal(sentTo(api, 3).length, 0);
  assert.equal(sentTo(api, 4).length, 0);
  at(t0 + DAY);
  await pump({ force: true });
  assert.equal(sentTo(api, 2).length, 1);
  await say(user(2), 'я вернулся');
  assert.equal(await bonus(2, 'comeback'), 30);
  assert.match(texts(api).at(-1), /С возвращением/);
  await say(user(2), 'ещё');
  assert.equal(await bonus(2, 'comeback'), 30);
});

test('chest: the 7th day in a row opens it; XP, an item from the shop or the golden one', async () => {
  await setup();
  const ts = Math.floor(Date.now() / 1000);
  const today = Math.floor((ts + 3 * 3600) / DAY);
  for (let d = 1; d <= 6; d++) {
    await db.run("INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES (2, 0, ?, 'daily', 5, ?)", [today - d, ts - d * DAY]);
  }
  const data = await handle(user(2), { action: 'daily' });
  assert.ok(data.result.chest);
  assert.ok(data.result.points >= 35);
  const item = await club.openChest(user(5), today, ts, () => 0.2);
  assert.match(item.text, /из Лавки/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM purchases WHERE user_id = 5 AND price = 0')).c, 1);
  const gold = await club.openChest(user(6), today, ts, () => 0.01);
  assert.equal(gold.points, 500);
  assert.match(gold.text, /Золотой сундук/);
  const small = await club.openChest(user(7), today, ts, () => 0.9);
  assert.ok(small.points >= 20 && small.points <= 80);
  // Twice the same day: nothing more.
  assert.equal((await club.openChest(user(7), today, ts, () => 0.9)).points, 0);
});
