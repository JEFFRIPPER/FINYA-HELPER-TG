import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage, onMessageReaction } from '../tgcloud/lib/bot.js';
import * as xp from '../tgcloud/lib/xp.js';
import { dayStart, weekStart } from '../tgcloud/lib/util.js';
import { setup, channelRoot, checkErrors, groupMessage, privateMessage, user, DISCUSSION, OWNER } from './helpers.mjs';

afterEach(checkErrors);

async function xpOf(id) {
  const row = await db.get(`SELECT xp FROM profiles WHERE user_id = ?`, [id]);
  return row ? row.xp : null;
}

test('comment under a channel post earns 5 XP once, with cooldown', async () => {
  await setup();
  const root = channelRoot();
  await onMessage(root);
  const alice = user(1);
  await onMessage(groupMessage(DISCUSSION, alice, 'Классный пост!', { reply_to_message: root }));
  assert.equal(await xpOf(1), 5);
  // Cooldown: a second comment within 60 s gives nothing.
  await onMessage(groupMessage(DISCUSSION, alice, 'Ещё комментарий', { reply_to_message: root }));
  assert.equal(await xpOf(1), 5);
  const events = await db.all('SELECT points FROM events WHERE user_id = 1 ORDER BY earned_at');
  assert.deepEqual(events.map((e) => e.points), [5, 0]);
});

test('short texts, commands and unrelated threads earn nothing', async () => {
  await setup();
  const root = channelRoot();
  await onMessage(root);
  await onMessage(groupMessage(DISCUSSION, user(2), 'ok!!', { reply_to_message: root }));
  await onMessage(groupMessage(DISCUSSION, user(3), '/rank', { reply_to_message: root }));
  await onMessage(groupMessage(DISCUSSION, user(4), 'Просто сообщение без ветки'));
  assert.equal(await xpOf(2), null);
  assert.equal(await xpOf(4), null);
});

test('reaction: +1 to someone else\'s comment, not to own, not on emoji change', async () => {
  await setup();
  const root = channelRoot();
  await onMessage(root);
  const author = user(10);
  const comment = groupMessage(DISCUSSION, author, 'Хороший комментарий', { reply_to_message: root });
  await onMessage(comment);
  const reactor = user(11);
  const date = Math.floor(Date.now() / 1000);
  const base = { chat: DISCUSSION, message_id: comment.message_id, date };
  await onMessageReaction({ ...base, user: reactor, old_reaction: [], new_reaction: [{ type: 'emoji', emoji: '👍' }] });
  assert.equal(await xpOf(11), 1);
  await onMessageReaction({ ...base, user: reactor, old_reaction: [{ type: 'emoji', emoji: '👍' }], new_reaction: [{ type: 'emoji', emoji: '🔥' }] });
  assert.equal(await xpOf(11), 1);
  await onMessageReaction({ ...base, user: author, old_reaction: [], new_reaction: [{ type: 'emoji', emoji: '👍' }] });
  assert.equal(await xpOf(10), 5);
});

test('daily limit caps XP at 100', async () => {
  await setup();
  const u = user(20);
  const ts = Math.floor(Date.now() / 1000);
  await db.run(`INSERT INTO profiles (user_id, name, username, xp) VALUES (20, 'U', 'u', 98)`);
  await db.run(`INSERT INTO events VALUES (20, ${DISCUSSION.id}, 1, 'comment', 98, ${dayStart(ts) + 1})`);
  const award = await xp.award(u, DISCUSSION.id, 2, 'comment', ts);
  assert.equal(award, null);
  assert.equal(await xpOf(20), 98);
});

test('promotion message goes only to users known to the bot', async () => {
  const mock = await setup();
  await onMessage(privateMessage(user(30), '/start'));
  await db.run(`INSERT INTO profiles (user_id, name, username, xp) VALUES (30, 'U30', 'user30', 97)`);
  const root = channelRoot();
  await onMessage(root);
  mock.calls = [];
  await onMessage(groupMessage(DISCUSSION, user(30), 'Комментарий для звания', { reply_to_message: root }));
  const sent = mock.called('sendMessage').filter((c) => c.params.chat_id === 30);
  assert.equal(sent.length, 1);
  assert.match(sent[0].params.text, /II · Звено/);
});

test('rank math: thresholds, founder and manual ranks', () => {
  assert.equal(xp.rankFor(0)[0][1], 'I');
  assert.equal(xp.rankFor(99)[1][1], 'II');
  assert.equal(xp.rankFor(10000)[0][1], 'IX');
  assert.equal(xp.rankFor(10000)[1], null);
  assert.equal(xp.rankFor(5, { founder: true })[0][1], 'X');
  assert.equal(xp.rankFor(5, { manualRank: 'VII' })[0][2], 'Маршал Свободы');
});

test('Moscow day and Monday week boundaries', () => {
  // 2026-10-08 (Thursday) 22:30 UTC = 2026-10-09 01:30 MSK (Friday).
  const ts = Date.UTC(2026, 9, 8, 22, 30) / 1000;
  assert.equal(dayStart(ts), Date.UTC(2026, 9, 8, 21, 0) / 1000);
  assert.equal(weekStart(ts), Date.UTC(2026, 9, 4, 21, 0) / 1000);
});

test('/rank shows the profile; owner is the founder', async () => {
  const mock = await setup();
  await onMessage(privateMessage(OWNER, '/rank'));
  assert.match(mock.called('sendMessage').at(-1).params.text, /X · Основатель SQUAD/);
});
