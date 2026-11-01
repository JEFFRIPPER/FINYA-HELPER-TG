import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage, onMessageReaction } from '../tgcloud/lib/bot.js';
import * as posts from '../tgcloud/lib/posts.js';
import { setup, channelRoot, checkErrors, groupMessage, user, DISCUSSION } from './helpers.mjs';

afterEach(checkErrors);

const DAY = 86400;
const bonus = async (id, kind) => (await db.get('SELECT COALESCE(SUM(points), 0) AS s FROM events WHERE user_id = ? AND kind = ?', [id, kind])).s;
const comment = (root, id, text) => groupMessage(DISCUSSION, user(id), text, { reply_to_message: root });
const react = (msg, id, emoji = '👍') => onMessageReaction({
  chat: DISCUSSION, message_id: msg.message_id, date: msg.date, user: user(id),
  old_reaction: emoji ? [] : [{ type: 'emoji', emoji: '👍' }], new_reaction: emoji ? [{ type: 'emoji', emoji }] : [],
});

test('first comment under a post: +15 XP once and «🥇 Первый!»', async () => {
  const mock = await setup();
  const root = channelRoot();
  await onMessage(root);
  await onMessage(comment(root, 1, 'ок'));
  await onMessage(comment(root, 2, 'Первый нормальный коммент'));
  await onMessage(comment(root, 3, 'А я второй, без бонуса'));
  assert.equal(await bonus(1, 'first_comment'), 0);
  assert.equal(await bonus(2, 'first_comment'), posts.FIRST_XP);
  assert.equal(await bonus(3, 'first_comment'), 0);
  const firsts = mock.called('sendMessage').filter((c) => /Первый!/.test(c.params.text));
  assert.equal(firsts.length, 1);
});

test('a post older than a day gives no first-comment bonus', async () => {
  await setup();
  const root = channelRoot();
  root.date -= DAY + 60;
  await onMessage(root);
  await onMessage(comment(root, 4, 'Поздний комментарий'));
  assert.equal(await bonus(4, 'first_comment'), 0);
});

test('a day later the most liked comment gets a reply with +20 XP', async () => {
  const mock = await setup();
  const root = channelRoot();
  await onMessage(root);
  const a = comment(root, 10, 'Комментарий раз');
  const b = comment(root, 11, 'Комментарий два');
  await onMessage(a);
  await onMessage(b);
  await react(a, 12);
  await react(b, 12);
  await react(b, 13);
  await react(b, 14);
  await react(b, 14, null); // taken back
  await react(b, 11); // own reaction does not count
  await posts.tick(root.date + DAY - 10);
  const best = () => mock.called('sendMessage').filter((c) => /Лучший комментарий/.test(c.params.text));
  assert.equal(best().length, 0);
  await posts.tick(root.date + DAY + 10);
  assert.equal(best().length, 1);
  assert.equal(best()[0].params.reply_parameters.message_id, b.message_id);
  assert.equal(await bonus(11, 'best_comment'), posts.BEST_XP);
  assert.equal(await bonus(10, 'best_comment'), 0);
  assert.match(best()[0].params.text, /2 реакции/);
  assert.equal(mock.called('pinChatMessage').length, 0);
  // Only once.
  await posts.tick(root.date + DAY + 100);
  assert.equal(best().length, 1);
});

test('no best comment with fewer than 2 reactions', async () => {
  const mock = await setup();
  const root = channelRoot();
  await onMessage(root);
  const a = comment(root, 20, 'Одинокий комментарий');
  await onMessage(a);
  await react(a, 21);
  await posts.tick(root.date + DAY + 10);
  assert.ok(!mock.called('sendMessage').some((c) => /Лучший комментарий/.test(c.params.text)));
  assert.equal(await bonus(20, 'best_comment'), 0);
});
