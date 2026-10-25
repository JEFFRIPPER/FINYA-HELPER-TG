// 12 achievements for the features of late October and the secret «СЕКРЕТ ТЬМЫ».
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { clubData } from '../tgcloud/lib/club.js';
import * as feats from '../tgcloud/lib/feats.js';
import { onChosenResult } from '../tgcloud/lib/inline.js';
import * as questions from '../tgcloud/lib/questions.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { checkErrors, DISCUSSION, groupMessage, isAnnouncement, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const DAY = 86400;
const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const counter = async (id, key) => ((await db.get('SELECT n FROM counters WHERE user_id = ? AND key = ?', [id, key])) || { n: 0 }).n;
const has = async (id, code) => Boolean(await db.get('SELECT 1 FROM achievements WHERE user_id = ? AND code = ?', [id, code]));

test('«СЕКРЕТ ТЬМЫ»: the phrase in reply to someone else, then «СЛАВА СКВАДУ!» and the badge', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  feats.DARK_EXTRA.push(feats.darkHash('тень над сквадом'));
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  // Not in reply, or in reply to oneself: nothing.
  await say(a, 'Тень над Сквадом!');
  await say(a, 'Тень над Сквадом!', replyTo(a));
  assert.equal(await has(2, 'dark_secret'), false);
  assert.ok(!replies(api).some((c) => /СЛАВА СКВАДУ/.test(c.params.text)));

  await say(a, 'ТЕНЬ, над сквадом…', replyTo(b));
  assert.ok(replies(api).some((c) => /СЛАВА СКВАДУ!/.test(c.params.text)));
  const post = api.called('sendMessage').filter(isAnnouncement).at(-1);
  assert.match(post.params.text, /открывает ачивку «СЕКРЕТ ТЬМЫ» · \+5,000 XP/);
  assert.match(post.params.text, /прощался с Создателем/);
  assert.equal(await has(2, 'dark_secret'), true);
  assert.equal(await has(3, 'dark_secret'), false);

  // Again: Финя answers, the badge is not given twice.
  await say(a, 'тень над сквадом', replyTo(b));
  assert.equal(replies(api).filter((c) => /СЛАВА СКВАДУ!/.test(c.params.text)).length, 2);
  assert.equal(api.called('sendMessage').filter(isAnnouncement).filter((c) => /СЕКРЕТ ТЬМЫ/.test(c.params.text)).length, 1);

  const data = await clubData(a, { xpTotal: 0, streakDays: 0, founder: false });
  const secret = data.achievements.find((x) => x.code === 'dark_secret');
  assert.equal(secret.secret, true);
  assert.ok(secret.at);
  assert.equal(secret.xp, 5000);
  assert.equal((await db.get("SELECT points FROM events WHERE user_id = 2 AND kind = 'achievement' AND message_id = 79")).points, 5000);
  assert.equal(data.achievements.filter((x) => x.secret).length, 1);
  // Only the hash is in the code.
  assert.equal(feats.isDarkPhrase('сообщение'), false);
  feats.DARK_EXTRA.length = 0;
});

test('horoscope 7 days in a row; a gap starts over but keeps the best run', async () => {
  await setup();
  const t0 = Date.UTC(2026, 9, 1, 9, 0, 0) / 1000;
  for (let d = 0; d < 5; d++) {
    await feats.streakDaily(2, 'horo', t0 + d * DAY);
    await feats.streakDaily(2, 'horo', t0 + d * DAY + 3600);
  }
  assert.equal(await counter(2, 'horo'), 5);
  await feats.streakDaily(2, 'horo', t0 + 7 * DAY);
  assert.equal(await counter(2, 'horo_run'), 1);
  assert.equal(await counter(2, 'horo'), 5);
  for (let d = 8; d < 14; d++) await feats.streakDaily(2, 'horo', t0 + d * DAY);
  assert.equal(await counter(2, 'horo'), 7);
  assert.equal((await feats.chatStats(2)).horo, 7);
});

test('«Вопрос дня»: a vote counts once a day, only in today’s poll', async () => {
  await setup({ sendPoll: () => ({ message_id: 900, poll: { id: '5375043895626219524' } }) });
  await questions.postQuestion(DISCUSSION.id);
  const ts = nowInt();
  const vote = (id, poll = '5375043895626219524', options = [1]) =>
    questions.onPollAnswer({ poll_id: poll, user: user(id), option_ids: options });
  await vote(2);
  await vote(2, '5375043895626219524', []);
  await vote(2);
  await vote(2, 'other');
  await vote(3, '5375043895626219524', []);
  assert.equal(await counter(2, 'qday'), 1);
  assert.equal(await counter(3, 'qday'), 0);
  await feats.bumpDaily(2, 'qday', ts + DAY);
  await feats.bumpDaily(2, 'qday', ts + DAY + 60);
  assert.equal(await counter(2, 'qday'), 2);
});

test('inline RP, «Сравнить», «… помощь» and the profile ones count', async () => {
  await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await onChosenResult({ result_id: 'rp:обнять', from: a, query: 'обнять' });
  await onChosenResult({ result_id: 'other', from: a, query: '' });
  assert.equal(await counter(2, 'rp_inline'), 1);
  assert.equal(await counter(2, 'rp'), 1);

  for (const id of [3, 4, 4]) await say(a, 'сравнить', replyTo(user(id, { first_name: `U${id}` })));
  await say(a, 'награды помощь');
  await say(a, 'брак помощь');
  await say(a, 'брак помощь');
  const ts = nowInt();
  await db.run('INSERT INTO dating (user_id, partner_id, since) VALUES (2, 3, ?)', [ts - 31 * DAY]);
  await db.run('INSERT INTO citizens (user_id, chat_id, since, set_at) VALUES (2, ?, ?, ?)', [DISCUSSION.id, ts - 100 * DAY, ts]);
  await db.run("INSERT INTO profile_info (user_id, gender, city, updated_at) VALUES (2, 'ж', 'Токио', ?)", [ts]);
  await db.run("INSERT INTO positions (user_id, code, given_by, given_at) VALUES (2, 'creative', 1, ?)", [ts]);
  const award = await db.run("INSERT INTO awards (user_id, text, chat_id, given_by, given_at) VALUES (2, 'Герой', ?, 1, ?) RETURNING id", [DISCUSSION.id, ts]);
  await db.run('INSERT INTO award_degrees (award_id, degree) VALUES (?, 8)', [award.rows[0].id]);
  let s = await feats.chatStats(2);
  assert.deepEqual([s.compared, s.helped, s.couple, s.coupleDays, s.citizen, s.citizenDays, s.anketa, s.staff, s.topDegree],
    [2, 2, 1, 31, 1, 100, 0, 1, 8]);
  await db.run('INSERT INTO birthdays (user_id, day, month, updated_at) VALUES (2, 16, 12, ?)', [ts]);
  s = await feats.chatStats(2);
  assert.equal(s.anketa, 1);
  const fresh = (await feats.check(a)).map((x) => x.code);
  for (const code of ['couple', 'couple_30', 'citizen_chat', 'citizen_100', 'anketa_full', 'staff', 'award_top']) {
    assert.ok(fresh.includes(code), code);
  }
});
