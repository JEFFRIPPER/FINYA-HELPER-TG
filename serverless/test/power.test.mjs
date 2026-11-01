// Jackpot bank, «Битва загадок», «угадай большинство», week nominations, repeating reminders.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import * as club from '../tgcloud/lib/club.js';
import * as events from '../tgcloud/lib/events.js';
import * as games from '../tgcloud/lib/games.js';
import * as questions from '../tgcloud/lib/questions.js';
import * as reminders from '../tgcloud/lib/reminders.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt, weekStart } from '../tgcloud/lib/util.js';
import { checkErrors, DISCUSSION, groupMessage, OWNER, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const say = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));
const texts = (api) => replies(api).map((c) => c.params.text);
const giveXp = (id, points) => db.run('INSERT INTO profiles (user_id, name, xp) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp', [id, `U${id}`, points]);
const bonus = async (userId, kind) => (await db.get('SELECT COALESCE(SUM(points), 0) AS s FROM events WHERE user_id = ? AND kind = ?', [userId, kind])).s;
const DAY = 86400;

test('jackpot bank: a tenth of each lost stake, 7️⃣7️⃣7️⃣ takes it all', async () => {
  let value = 2;
  const api = await setup({ sendDice: (p) => ({ message_id: 7000, dice: { emoji: p.emoji, value } }) });
  await setSetting('chat_captcha', false);
  await giveXp(2, 1000);
  await giveXp(3, 1000);
  await say(user(2), 'кости 100');
  await say(user(2), 'кости 50');
  assert.equal(await games.bankOf(), 15);
  assert.match(texts(api).at(-1), /🏦 Банк джекпота: 15 XP, его заберёт 7️⃣7️⃣7️⃣/);
  // A win adds nothing.
  value = 6;
  await say(user(2), 'кости 100');
  assert.equal(await games.bankOf(), 15);
  value = 64;
  const before = await games.balanceOf(3);
  await say(user(3), 'казино 10');
  assert.match(texts(api).at(-1), /🏦 БАНК ДЖЕКПОТА ТВОЙ: \+15 XP!/);
  // +100 is the «Три семёрки» badge.
  assert.equal(await games.balanceOf(3), before - 10 + 200 + 15 + 100);
  assert.equal(await games.bankOf(), 0);
  await say(user(3), 'казино');
  assert.match(texts(api).at(-1), /Сейчас в банке: 0 XP/);
});

test('«Битва загадок»: five rounds in a row, the score, the winner\'s XP and badge', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0)', [DISCUSSION.id, DISCUSSION.title, OWNER.id]);
  await say(OWNER, 'Финя, Битва загадок');
  assert.ok(texts(api).some((t) => /⚔️ Битва загадок!/.test(t)));
  assert.match(texts(api).at(-1), /⚔️ Раунд 1\/5/);
  assert.match(texts(api).at(-1), /На ответ 10 минут/);
  await say(OWNER, 'Финя, Битва');
  assert.match(texts(api).at(-1), /уже идёт/);
  const open = async () => db.get('SELECT * FROM quizzes WHERE done = 0 ORDER BY id DESC LIMIT 1');
  const answer = async (who) => say(who, JSON.parse((await open()).answers)[0]);
  await answer(user(2));
  assert.match(texts(api).at(-1), /Раунд 2\/5/);
  await answer(user(3));
  await answer(user(2));
  // Round 4 nobody gets: its time runs out, round 5 comes.
  const q4 = await open();
  await events.tick(q4.expires_at + 1);
  assert.match(texts(api).at(-1), /Раунд 5\/5/);
  await answer(user(2));
  const result = texts(api).at(-1);
  assert.match(result, /⚔️ Битва загадок окончена!/);
  assert.match(result, /🥇 .* — 3\n🥈 .* — 1/);
  assert.match(result, /Победитель: .* · \+100 XP/);
  assert.equal(await bonus(2, 'battle'), 100);
  assert.equal(await bonus(3, 'battle'), 0);
  assert.equal(await bonus(2, 'quiz'), 45);
  assert.equal((await db.get("SELECT n FROM counters WHERE user_id = 2 AND key = 'battle'")).n, 1);
  assert.equal(await events.battleOn(DISCUSSION.id), false);
});

test('battle on weekend evenings instead of the 19:30 quiz; nobody right, a short note', async () => {
  const api = await setup();
  await db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0)', [DISCUSSION.id, DISCUSSION.title, OWNER.id]);
  await setSetting('chat_events', true);
  await setSetting('chat_question', false);
  // Saturday 7.11.2026 19:40 МСК.
  const sat = Date.UTC(2026, 10, 7, 16, 40) / 1000;
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, 2, 'Аня', '', 'member', 0, ?, 1)`, [DISCUSSION.id, sat - 600]);
  await db.run("INSERT INTO settings (key, value) VALUES ('persona_day:' || ?, '999999')", [DISCUSSION.id]);
  await events.tick(sat);
  assert.ok(texts(api).some((t) => /⚔️ Битва загадок!/.test(t)));
  let t = sat;
  for (let i = 0; i < 5; i++) {
    t += events.BATTLE_TTL + 1;
    await events.tick(t);
  }
  assert.match(texts(api).at(-1), /никто не угадал ни одной/);
  // A weekday evening is a plain quiz.
  const api2 = await setup();
  await db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0)', [DISCUSSION.id, DISCUSSION.title, OWNER.id]);
  await setSetting('chat_events', true);
  await setSetting('chat_question', false);
  const fri = sat - DAY;
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, 2, 'Аня', '', 'member', 0, ?, 1)`, [DISCUSSION.id, fri - 600]);
  await db.run("INSERT INTO settings (key, value) VALUES ('persona_day:' || ?, '999999')", [DISCUSSION.id]);
  await events.tick(fri);
  assert.ok(!texts(api2).some((x) => /Битва/.test(x)));
  assert.ok(texts(api2).some((x) => /\+15 XP/.test(x)));
});

test('«угадай большинство»: the winning option\'s voters get more; a tie gives nothing extra', () => {
  const v = (option) => ({ user_id: 1, option });
  assert.equal(questions.majorityOf([v(0), v(0), v(1)]), 0);
  assert.equal(questions.majorityOf([v(0), v(1)]), null);
  assert.equal(questions.majorityOf([v(2)]), null);
  assert.equal(questions.majorityOf([v(0), v(0), v(1), v(1)]), null);
});

test('poll result pays the majority bonus', async () => {
  let n = 0;
  const api = await setup({ sendPoll: () => ({ message_id: 500 + n, poll: { id: `poll${n++}` } }) });
  const day = nowInt() - ((nowInt() + 3 * 3600) % DAY);
  const t0 = day + 12 * 3600;
  await questions.postQuestion(DISCUSSION.id, t0);
  const vote = (id, options) => questions.onPollAnswer({ poll_id: 'poll0', user: user(id), option_ids: options });
  await vote(2, [0]);
  await vote(3, [0]);
  await vote(4, [1]);
  await questions.closePolls(t0 + 3 * 3600);
  assert.match(texts(api).at(-1), /🎯 Угадали большинство: 2 · каждому ещё \+10 XP/);
  assert.equal(await bonus(2, 'qmajor'), 10);
  assert.equal(await bonus(4, 'qmajor'), 0);
  assert.equal(await bonus(4, 'qpoll'), 5);
});

test('week summary: nominations with their leaders', async () => {
  const api = await setup();
  const start = weekStart(nowInt()) - 7 * DAY;
  const at = start + DAY;
  for (const [id, name] of [[2, 'Аня'], [3, 'Боря'], [4, 'Вика']]) {
    await db.run('INSERT INTO profiles (user_id, name, username, xp) VALUES (?, ?, ?, 100)', [id, name, `u${id}`]);
    await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
      VALUES (?, ?, ?, '', 'member', 0, 0, 0)`, [DISCUSSION.id, id, name]);
  }
  await db.run(`INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES
    (2, -1, 1, 'comment', 5, ?), (2, 0, 1, 'quiz', 15, ?), (2, 0, 2, 'quiz', 15, ?), (3, 0, 3, 'quiz', 15, ?), (3, 0, 4, 'farm', 80, ?)`,
  [at, at, at, at, at]);
  await db.run("INSERT INTO xp_spend (user_id, kind, amount, other_id, at) VALUES (4, 'casino_win', -200, 1, ?), (4, 'casino_bank', -50, 1, ?)", [at, at]);
  const day = Math.floor((at + 3 * 3600) / DAY);
  await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, 3, ?, 40), (?, 2, ?, 10)', [DISCUSSION.id, day, DISCUSSION.id, day]);
  await club.weeklyPreview(DISCUSSION.id);
  const text = api.called('sendMessage').at(-1).params.text;
  assert.match(text, /🎖 Номинации недели/);
  assert.match(text, /🧠 Лучший отгадчик: Аня — 2 загадки/);
  assert.match(text, /🌾 Король фарма: Боря — 80 XP фармом/);
  assert.match(text, /🎰 Везунчик казино: Вика — 250 XP выигрыша/);
  assert.match(text, /💬 Душа чата: Боря — 40 сообщений/);
});

test('repeating reminders: every day or week, moved on after each one', async () => {
  // Wed 21.10.2026 12:00 МСК.
  const ts = Date.UTC(2026, 9, 21, 9, 0, 0) / 1000;
  assert.deepEqual(reminders.parse('каждый день в 9 зарядка', ts), { due: ts + 21 * 3600, text: 'зарядка', every: DAY });
  assert.deepEqual(reminders.parse('каждый день в 18:30', ts), { due: ts + 6.5 * 3600, text: '', every: DAY });
  assert.equal(reminders.parse('каждое утро пить воду', ts).due, ts + 21 * 3600);
  assert.equal(reminders.parse('каждый вечер', ts).due, ts + 8 * 3600);
  assert.deepEqual(reminders.parse('каждую пятницу в 20:00 турнир', ts), { due: ts + 2 * DAY + 8 * 3600, text: 'турнир', every: 7 * DAY });
  assert.equal(reminders.parse('каждый понедельник', ts).due, ts + 5 * DAY - 2 * 3600);
  assert.equal(reminders.parse('каждый раз', ts), null);

  const api = await setup();
  await setSetting('chat_captcha', false);
  await say(user(2, { first_name: 'Аня' }), 'Финя, напомни каждый день в 9 зарядка');
  assert.match(texts(api).at(-1), /Напомню .* \(МСК\), дальше каждый день/);
  await say(user(2, { first_name: 'Аня' }), 'Напоминания');
  assert.match(texts(api).at(-1), /🔁 каждый день — зарядка/);
  const r = await db.get('SELECT * FROM reminders WHERE user_id = 2');
  await reminders.tick(() => 20000, r.due_at + 5);
  assert.match(texts(api).at(-1), /напоминаю!/);
  assert.equal((await db.get('SELECT due_at FROM reminders WHERE id = ?', [r.id])).due_at, r.due_at + DAY);
  // A missed day or two: the next one is still ahead.
  await reminders.tick(() => 20000, r.due_at + 3 * DAY + 5);
  assert.equal((await db.get('SELECT due_at FROM reminders WHERE id = ?', [r.id])).due_at, r.due_at + 4 * DAY);
});
