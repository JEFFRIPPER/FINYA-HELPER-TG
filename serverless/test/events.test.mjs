// Финя as the event manager: poll results with XP, quizzes, «Персонажи дня», topics for
// a quiet chat and «Завтра в Скваде».
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import * as events from '../tgcloud/lib/events.js';
import * as questions from '../tgcloud/lib/questions.js';
import { getSetting, setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { checkErrors, DISCUSSION, groupMessage, OWNER, replies, setup, user } from './helpers.mjs';

afterEach(() => checkErrors());

const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const texts = (api) => replies(api).map((c) => c.params.text);
const bonus = async (userId, kind) => (await db.get('SELECT COALESCE(SUM(points), 0) AS s FROM events WHERE user_id = ? AND kind = ?', [userId, kind])).s;

// Moscow midnight of today, and a time of that day.
const midnight = () => { const t = nowInt(); return t - ((t + 3 * 3600) % 86400); };
const at = (h, m = 0) => midnight() + h * 3600 + m * 60;

async function squad() {
  await setSetting('chat_captcha', false);
  await db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0)', [DISCUSSION.id, DISCUSSION.title, OWNER.id]);
}

async function member(id, name, lastActive, msgsToday = 1) {
  await db.run(`INSERT OR REPLACE INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, ?, ?, '', 'member', 0, ?, ?)`, [DISCUSSION.id, id, name, lastActive, msgsToday]);
  await db.run('INSERT OR REPLACE INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, ?, ?, ?)',
    [DISCUSSION.id, id, Math.floor((lastActive + 3 * 3600) / 86400), msgsToday]);
}

test('poll result: after 3 hours the poll closes, the result goes out, each voter gets XP once', async () => {
  let n = 0;
  const api = await setup({ sendPoll: () => ({ message_id: 500 + n, poll: { id: `poll${n++}` } }) });
  const t0 = at(12);
  await questions.postQuestion(DISCUSSION.id, t0);
  const vote = (id, options) => questions.onPollAnswer({ poll_id: 'poll0', user: user(id), option_ids: options });
  await vote(2, [0]);
  await vote(3, [0]);
  await vote(4, [1]);
  await vote(5, [2]);
  await vote(5, []);
  await questions.closePolls(t0 + 3600);
  assert.equal(replies(api).length, 0);
  await questions.closePolls(t0 + 3 * 3600);
  await questions.closePolls(t0 + 3 * 3600 + 60);
  assert.equal(api.called('stopPoll').length, 1);
  assert.equal(api.called('stopPoll')[0].params.message_id, 500);
  const out = texts(api);
  assert.equal(out.length, 1);
  assert.match(out[0], /📊 Итог опроса/);
  assert.match(out[0], /🥇 .* — 67% \(2\)/);
  assert.match(out[0], /🥈 .* — 33% \(1\)/);
  assert.match(out[0], /3 голоса · каждому \+5 XP/);
  assert.equal(replies(api)[0].params.reply_parameters.message_id, 500);
  assert.equal(await bonus(2, 'qpoll'), 5);
  assert.equal(await bonus(4, 'qpoll'), 5);
  assert.equal(await bonus(5, 'qpoll'), 0);
  // A late vote changes nothing.
  await vote(6, [0]);
  assert.equal(await bonus(6, 'qpoll'), 0);

  // Nobody voted; the night poll waits for the morning.
  await questions.postQuestion(DISCUSSION.id, at(24));
  await questions.closePolls(at(27, 30));
  assert.equal(texts(api).length, 1);
  await questions.closePolls(at(33));
  assert.match(texts(api).at(-1), /Никто не ответил/);
});

test('verdict: by the winner’s share, a tie first', () => {
  assert.match(questions.verdict([50, 50]), /Ничья/);
  assert.match(questions.verdict([90]), /единодушен/);
  assert.match(questions.verdict([25, 25, 25, 25]), /Ничья/);
  assert.match(questions.verdict([30, 25, 25, 20]), /разбежался/);
});

test('quiz: the first right answer takes the XP, wrong and late ones nothing', async () => {
  const api = await setup();
  await squad();
  await say(user(2), 'привет');
  const quiz = await events.postQuiz(DISCUSSION.id);
  assert.match(texts(api).at(-1), /Кто первым ответит в чат, получит \+15 XP/);
  await say(user(2), 'не знаю вообще ничего');
  assert.equal(await bonus(2, 'quiz'), 0);
  const answer = quiz.answers[0].toUpperCase();
  await say(user(3), `это ${answer}!`);
  assert.match(texts(api).at(-1), /отвечает первым! Ответ: «/);
  assert.equal(await bonus(3, 'quiz'), 15);
  await say(user(2), answer);
  assert.equal(await bonus(2, 'quiz'), 0);
});

test('quiz: a long message is not an answer; after an hour the answer is shown', async () => {
  const api = await setup();
  await squad();
  const quiz = await events.postQuiz(DISCUSSION.id);
  await say(user(2), `может быть один два три четыре пять ${quiz.answers[0]}`);
  assert.equal(await bonus(2, 'quiz'), 0);
  await events.tick(nowInt() + events.QUIZ_TTL + 1);
  assert.match(texts(api).at(-1), /Время вышло, никто не угадал. Ответ: «/);
  await say(user(2), quiz.answers[0]);
  assert.equal(await bonus(2, 'quiz'), 0);
});

test('quiz: riddles, anagrams and sums, never the same twice', async () => {
  await setup();
  const seen = new Set();
  const kinds = new Set();
  for (let i = 0; i < 90; i++) {
    const q = await events.nextQuiz(DISCUSSION.id, nowInt());
    assert.ok(!seen.has(q.question), q.question);
    seen.add(q.question);
    kinds.add(q.question.slice(0, 2));
    assert.ok(q.answers.length >= 1);
    for (const a of q.answers) assert.ok(events.norm(a).length >= 2 || /^\d$/.test(a), a);
  }
  assert.equal(kinds.size, 3);
});

test('quiz schedule: 10:30, 13:30 … 22:30 in an active chat, once per slot, owner asks one now', async () => {
  const api = await setup();
  await squad();
  await setSetting('chat_events', true);
  await setSetting('chat_question', false);
  await member(2, 'Аня', at(9, 50));
  await events.tick(at(10, 10));
  assert.equal(texts(api).length, 0);
  await events.tick(at(10, 40));
  await events.tick(at(11, 50));
  const quizzes = () => texts(api).filter((t) => /получит \+15 XP/.test(t));
  assert.equal(quizzes().length, 1);
  // The open one runs out, the next slot brings a new one.
  await events.tick(at(13, 40));
  assert.equal(quizzes().length, 2);
  await say(OWNER, 'Финя, Загадка');
  assert.ok(texts(api).some((t) => /Загадка уже идёт/.test(t)));
});

test('«Персонажи дня»: three titles for three active members, once a day from 10:00', async () => {
  const api = await setup();
  await squad();
  await setSetting('chat_events', true);
  await setSetting('chat_question', false);
  await member(2, 'Аня', at(9, 0));
  await member(3, 'Боря', at(9, 5));
  await events.tick(at(10, 5));
  assert.equal(texts(api).filter((t) => /Персонажи дня/.test(t)).length, 0);
  await member(4, 'Вика', at(9, 10));
  await db.run("DELETE FROM settings WHERE key LIKE 'persona_day:%'");
  await events.tick(at(10, 6));
  await events.tick(at(10, 7));
  const posts = texts(api).filter((t) => /Персонажи дня/.test(t));
  assert.equal(posts.length, 1);
  for (const name of ['Аня', 'Боря', 'Вика']) assert.match(posts[0], new RegExp(name));
  assert.equal(posts[0].split('\n').filter((l) => / — /.test(l)).length, 3);
});

test('a quiet chat in the daytime gets a topic, not right away again, not at night', async () => {
  const api = await setup();
  await squad();
  await setSetting('chat_events', true);
  await setSetting('chat_question', false);
  await member(2, 'Аня', at(11, 0));
  await db.run("INSERT INTO settings (key, value) VALUES ('persona_day:' || ?, '999999')", [DISCUSSION.id]);
  await events.tick(at(12, 0));
  const topics = () => texts(api).filter((t) => /Чат, вы где\?/.test(t));
  assert.equal(topics().length, 0);
  // 13:20 is before the quiz half of the slot, 2 h 20 min after the last message.
  await events.tick(at(13, 20));
  assert.equal(topics().length, 1);
  assert.match(topics()[0], /2 ч тишины/);
  assert.match(topics()[0], /💬 Тема: /);
  await events.tick(at(13, 25));
  assert.equal(topics().length, 1);
});

test('«Завтра в Скваде»: birthdays and holidays of tomorrow from 18:00, once a day', async () => {
  const api = await setup();
  await squad();
  await setSetting('chat_events', true);
  await setSetting('chat_question', false);
  await db.run("INSERT INTO settings (key, value) VALUES ('persona_day:' || ?, '999999')", [DISCUSSION.id]);
  const tomorrow = new Date((at(12) + 86400 + 3 * 3600) * 1000);
  await member(2, 'Аня', at(17, 50));
  await db.run('INSERT INTO birthdays (user_id, day, month, announce, updated_at) VALUES (2, ?, ?, 1, 0)',
    [tomorrow.getUTCDate(), tomorrow.getUTCMonth() + 1]);
  await events.tick(at(17, 55));
  const posts = () => texts(api).filter((t) => /Завтра в Скваде/.test(t));
  assert.equal(posts().length, 0);
  await events.tick(at(18, 5));
  await events.tick(at(19, 5));
  assert.equal(posts().length, 1);
  assert.match(posts()[0], /🎂 День рождения: Аня/);
});

test('«Ивенты Вкл/Выкл» by the owner switches them all', async () => {
  const api = await setup();
  await squad();
  await say(OWNER, 'Финя, Ивенты Вкл');
  assert.equal(await getSetting('chat_events'), true);
  await say(OWNER, 'Финя, Ивенты Выкл');
  assert.equal(await getSetting('chat_events'), false);
  assert.match(texts(api).at(-1), /Ивенты Фини .* выключены/);
  await member(2, 'Аня', at(9, 50));
  await events.tick(at(10, 40));
  assert.equal(texts(api).filter((t) => /\+15 XP/.test(t)).length, 0);
});
