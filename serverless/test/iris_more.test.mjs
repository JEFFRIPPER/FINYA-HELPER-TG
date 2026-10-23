// More from Iris: nicks, XP gifts and the casino, reminders, ID, admins, the
// reputation top, summoning, the viewer's place in «стата» and anniversaries.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onCallbackQuery, onMessage, pump } from '../tgcloud/lib/bot.js';
import * as games from '../tgcloud/lib/games.js';
import { parse } from '../tgcloud/lib/reminders.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import {
  BOT, callback, checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, setup, user, replies } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

const DAY = 86400;
const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const sent = replies;
const lastSent = (api) => sent(api).at(-1).params.text;
const groupButton = (from, data) => callback(from, data, { chat: DISCUSSION, message_id: 5000 });
const members = (ids) => ({
  getChatMember: (p) => ids.includes(p.user_id)
    ? { status: 'administrator', user: { id: p.user_id } }
    : { status: 'member', user: { id: p.user_id, is_bot: p.user_id === BOT.id } },
});
const giveXp = (id, points) => db.run('INSERT INTO profiles (user_id, name, xp) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp', [id, `U${id}`, points]);
const xpOf = async (id) => (await db.get('SELECT xp FROM profiles WHERE user_id = ?', [id])).xp;

test('«+ник»: the nick shows in the profile, tops and RP', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Анна' });
  await say(a, '+ник Королева');
  assert.match(lastSent(api), /Теперь ты «Королева»/);
  await say(a, `+ник ${'я'.repeat(30)}`);
  assert.match(lastSent(api), /до 24 символов/);
  await say(a, '+ник @spam');
  assert.match(lastSent(api), /ссылок и @/);
  await say(a, 'кто я');
  assert.match(api.called('sendPhoto').at(-1).params.caption, /Это пользователь Королева/);
  await say(a, 'стата');
  assert.match(lastSent(api), /🥇 Королева — /);
  await say(user(3), 'обнять', replyTo(a));
  assert.match(lastSent(api), /обнимает <a href="tg:\/\/user\?id=2">Королева<\/a>/);
  await say(user(3), 'ник', replyTo(a));
  assert.match(lastSent(api), /Ник: «Королева»/);
  await say(a, '-ник');
  assert.match(lastSent(api), /Ник убран/);
  await say(a, 'кто я');
  assert.match(api.called('sendPhoto').at(-1).params.caption, /Это пользователь Анна/);
});

test('«передать 100»: XP from the balance, the rank stays; the owner gives for free', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await giveXp(2, 200);
  await db.run("INSERT INTO purchases (user_id, item, price, bought_at) VALUES (2, 'frame_ember', 150, 0)");
  await say(a, 'передать 80', replyTo(b));
  assert.match(lastSent(api), /Не хватает XP на балансе: есть 50/);
  await say(a, 'передать 30', replyTo(b));
  assert.match(lastSent(api), /🎁 <a href="tg:\/\/user\?id=2">Аня<\/a> ➜ <a href="tg:\/\/user\?id=3">Боря<\/a>: \+30 XP/);
  assert.match(lastSent(api), /У тебя на балансе: 20 XP/);
  // +10 for the «Широкий жест» achievement: XP, not spent.
  assert.equal(await xpOf(2), 210);
  assert.equal(await xpOf(3), 30);
  assert.equal(await games.balanceOf(2), 30);
  await say(a, 'передать 5', replyTo(a));
  assert.match(lastSent(api), /Себе переводить нельзя/);
  await say(a, 'передать 5', replyTo(BOT));
  assert.match(lastSent(api), /Ботам XP ни к чему/);
  // The owner's XP doesn't go anywhere.
  await say(OWNER, 'передать 1000', replyTo(b));
  assert.equal(await xpOf(3), 1030);
  assert.doesNotMatch(lastSent(api), /балансе/);
  await say(b, 'баланс');
  assert.match(lastSent(api), /на балансе 1,030 XP из 1,030/);
  // The shop sees the same balance.
  await assert.rejects(games.stake(a, 35), /Не хватает XP на балансе: есть 30/);
});

test('casino: the stake goes, a win comes back as XP; limits and refunds', async () => {
  let value = 64;
  let fail = false;
  const api = await setup({
    sendDice: (p) => {
      if (fail) throw new Error('network');
      return { message_id: 7000, dice: { emoji: p.emoji, value } };
    },
  });
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await giveXp(2, 300);
  await say(a, 'казино 50');
  assert.equal(api.called('sendDice').at(-1).params.emoji, '🎰');
  assert.match(lastSent(api), /ДЖЕКПОТ 7️⃣7️⃣7️⃣ · \+1,000 XP \(×20\)/);
  assert.equal(sent(api).at(-1).params.reply_parameters.message_id, 7000);
  // +100 for the «Три семёрки» achievement.
  assert.equal(await xpOf(2), 1400);
  assert.equal(await games.balanceOf(2), 1350);
  value = 2;
  await say(a, 'кости 100');
  assert.equal(api.called('sendDice').at(-1).params.emoji, '🎲');
  assert.match(lastSent(api), /Выпало 2 · −100 XP/);
  assert.equal(await games.balanceOf(2), 1250);
  value = 6;
  await say(a, 'кости 100');
  assert.match(lastSent(api), /Шестёрка! · \+250 XP \(×2,5\)/);
  await say(a, 'казино 5');
  assert.match(lastSent(api), /от 10 XP/);
  await say(a, 'казино 501');
  assert.match(lastSent(api), /не больше 500 XP/);
  // Telegram didn't throw the dice: the stake is back.
  fail = true;
  const before = await games.balanceOf(2);
  await say(a, 'казино 100');
  assert.equal(await games.balanceOf(2), before);
  await db.run('DELETE FROM error_log');
  await say(a, 'казино');
  assert.match(lastSent(api), /777 ×20, три в ряд ×7/);
});

test('slot values: three reels in base 4, about 92% back', () => {
  assert.deepEqual(games.reelsOf(64), [3, 3, 3]);
  assert.deepEqual(games.reelsOf(22), [1, 1, 1]);
  assert.deepEqual(games.reelsOf(43), [2, 2, 2]);
  let slots = 0;
  for (let v = 1; v <= 64; v++) slots += games.payout('🎰', v).times;
  assert.ok(Math.abs(slots / 64 - 0.92) < 0.01);
  let dice = 0;
  for (let v = 1; v <= 6; v++) dice += games.payout('🎲', v).times;
  assert.ok(Math.abs(dice / 6 - 0.917) < 0.01);
});

test('reminders: «через», «в 18:30», «завтра»', () => {
  // Wed 21.10.2026 12:00 МСК.
  const ts = Date.UTC(2026, 9, 21, 9, 0, 0) / 1000;
  assert.deepEqual(parse('через 2ч позвонить маме', ts), { due: ts + 7200, text: 'позвонить маме' });
  assert.deepEqual(parse('через 15 минут', ts), { due: ts + 900, text: '' });
  assert.deepEqual(parse('через полчаса чай', ts), { due: ts + 1800, text: 'чай' });
  assert.deepEqual(parse('через 3 дня', ts), { due: ts + 3 * DAY, text: '' });
  assert.equal(parse('в 18:30 стрим', ts).due, ts + 6.5 * 3600);
  assert.equal(parse('в 9:00 стрим', ts).due, ts + 21 * 3600);
  assert.equal(parse('завтра в 10:00 зал', ts).due, ts + 22 * 3600);
  assert.equal(parse('завтра', ts).due, ts + 22 * 3600);
  assert.equal(parse('потом как-нибудь', ts), null);
  assert.equal(parse('в 25:00', ts), null);
});

test('«Финя, напомни»: saved, listed and sent with a later update', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await say(a, 'Финя, напомни через 2ч позвонить');
  assert.match(lastSent(api), /⏰ Напомню \d\d\.\d\d \d\d:\d\d \(МСК\):\n<blockquote>позвонить<\/blockquote>/);
  await say(a, 'Финя, напомни когда-нибудь');
  assert.match(lastSent(api), /Не поняла, когда/);
  // Not addressed and not a time: just talk.
  const before = sent(api).length;
  await say(a, 'напомни ему про стрим');
  assert.equal(sent(api).length, before);
  await say(a, 'напоминания');
  assert.match(lastSent(api), /1\. \d\d\.\d\d \d\d:\d\d — позвонить/);

  const now = Date.now();
  Date.now = () => now + 7201 * 1000;
  await pump({ force: true });
  const reminder = sent(api).at(-1).params;
  assert.match(reminder.text, /⏰ <a href="tg:\/\/user\?id=2">Аня<\/a>, напоминаю!\n<blockquote>позвонить<\/blockquote>/);
  assert.equal(reminder.chat_id, DISCUSSION.id);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM reminders')).c, 0);
  // In private too, and removable.
  await onMessage(privateMessage(a, 'напомни в 23:59 спать'));
  await onMessage(privateMessage(a, '-напоминание 1'));
  assert.match(lastSent(api), /Напоминание удалено/);
});

test('«ид», «админы», «топ репы»', async () => {
  const api = await setup({
    ...members([10]),
    getChatAdministrators: () => [
      { status: 'administrator', custom_title: 'Модер', user: { id: 10, first_name: 'Админ' } },
      { status: 'creator', user: { id: 1, first_name: 'Босс' } },
      { status: 'administrator', user: { ...BOT } },
    ],
  });
  await setSetting('chat_captcha', false);
  await say(user(2), 'ид');
  assert.match(lastSent(api), /Твой ID: <code>2<\/code>\n💬 ID чата: <code>-1002000000001<\/code>/);
  await say(user(2), 'ид', replyTo(user(3)));
  assert.match(lastSent(api), /только админы/);
  await say(user(10), 'ид', replyTo(user(3, { first_name: 'Боря' })));
  assert.match(lastSent(api), /Боря: <code>3<\/code>/);
  await say(user(2), 'админы');
  assert.match(lastSent(api), /⭐ Админы чата · 2\n\n👑 Босс\n⭐ Админ · «Модер»/);
  await giveXp(5, 0);
  await giveXp(6, 0);
  await db.run('INSERT INTO reputation (user_id, points, given) VALUES (5, 40, 0), (6, 90, 0)');
  await say(user(2), 'топ репы');
  assert.match(lastSent(api), /🥇 U6 — 90\n🥈 U5 — 40/);
});

test('«Финя, созови»: admins tag the latest members five to a message, then a pause', async () => {
  const api = await setup(members([10]));
  await setSetting('chat_captcha', false);
  for (let id = 20; id < 32; id++) await say(user(id), 'привет');
  await say(user(25), 'Финя, созови');
  assert.match(lastSent(api), /Созывать могут только админы/);
  const before = sent(api).length;
  await say(user(10, { first_name: 'Админ' }), 'Финя, созови стрим через 5 минут');
  const calls = sent(api).slice(before);
  assert.equal(calls.length, 3);
  assert.match(calls[0].params.text, /📣 <a href="tg:\/\/user\?id=10">Админ<\/a> созывает всех!\n<blockquote>стрим через 5 минут<\/blockquote>/);
  assert.equal((calls[0].params.text.match(/tg:\/\/user/g) || []).length, 6);
  assert.equal((calls[2].params.text.match(/tg:\/\/user/g) || []).length, 2);
  await say(user(10), 'созыв');
  assert.match(lastSent(api), /Созыв был недавно/);
});

test('«стата» shows the viewer\'s place; a button tells the presser theirs', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  for (let i = 0; i < 3; i++) await say(user(2), `раз ${i}`);
  await say(user(3, { first_name: 'Боря' }), 'стата');
  assert.match(lastSent(api), /📍 Боря: №2 · 1 сообщение/);
  await onCallbackQuery(groupButton(user(2), 'stat:week'));
  assert.equal(api.called('answerCallbackQuery').at(-1).params.text, 'Ты №1 · 3 сообщения');
  assert.match(api.called('editMessageText').at(-1).params.text, /📍 U2: №1 · 3 сообщения/);
});

test('anniversaries: round numbers of days, once a day from 12:00', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  // 21.10.2026 13:00 МСК.
  const now = Date.UTC(2026, 9, 21, 10, 0, 0);
  Date.now = () => now;
  const ts = nowInt();
  await db.run('INSERT INTO spouses (user_id, partner_id, since) VALUES (2, 3, ?), (3, 2, ?), (4, 5, ?), (5, 4, ?)',
    [ts - 100 * DAY - 60, ts - 100 * DAY - 60, ts - 99 * DAY, ts - 99 * DAY]);
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, 2, 'Аня', '', 'member', ?, ?, 1), (?, 4, 'Вова', '', 'member', ?, ?, 1)`, [DISCUSSION.id, ts, ts, DISCUSSION.id, ts, ts]);
  await pump({ force: true });
  const posts = sent(api).filter((c) => /Годовщина/.test(c.params.text));
  assert.equal(posts.length, 1);
  assert.match(posts[0].params.text, /💍 <a href="tg:\/\/user\?id=2">Аня<\/a> \+ <a href="tg:\/\/user\?id=3">Участник<\/a> — 100 дней вместе!/);
  assert.doesNotMatch(posts[0].params.text, /id=4/);
  await pump({ force: true });
  assert.equal(sent(api).filter((c) => /Годовщина/.test(c.params.text)).length, 1);
});

test('wedding names like in Russia: «мой брак», «браки» and the yearly greeting', async () => {
  const social = await import('../tgcloud/lib/social.js');
  assert.deepEqual(social.weddingOf(0), { years: 0, name: 'Зелёная', icon: '🌿' });
  assert.equal(social.weddingOf(365 * 17).name, 'Хрустальная');
  assert.equal(social.weddingOf(365 * 50).name, 'Золотая');
  assert.deepEqual(social.nextWedding(300), { years: 1, name: 'Ситцевая', icon: '🧵', inDays: 65 });
  assert.equal(social.nextWedding(365 * 75), null);
  assert.equal(social.weddingOn(365 * 25).name, 'Серебряная');
  assert.equal(social.weddingOn(365 * 16), null);

  const api = await setup();
  await setSetting('chat_captcha', false);
  const now = Date.UTC(2026, 9, 21, 10, 0, 0);
  Date.now = () => now;
  const ts = nowInt();
  await db.run('INSERT INTO spouses (user_id, partner_id, since) VALUES (2, 3, ?), (3, 2, ?)',
    [ts - 365 * 5 * DAY - 60, ts - 365 * 5 * DAY - 60]);
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, 2, 'Аня', '', 'member', ?, ?, 1)`, [DISCUSSION.id, ts, ts]);
  const texts = () => sent(api).map((c) => c.params.text).join('\n---\n');
  await say(user(2, { first_name: 'Аня' }), 'мой брак');
  assert.match(texts(), /🪵 Сейчас: деревянная свадьба \(5 лет\)\n⏳ Дальше: чугунная свадьба \(6 лет\) через 365 дней/);
  await say(user(2, { first_name: 'Аня' }), 'браки');
  assert.match(texts(), /1825 дней · 🪵 деревянная/);
  await pump({ force: true });
  const post = sent(api).find((c) => /Годовщина/.test(c.params.text));
  assert.match(post.params.text, /5 лет вместе, деревянная свадьба 🪵!/);
});
