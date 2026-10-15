// Regressions found in the October 2026 bug hunt.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { apiMock, db } from 'sdk';
import clubEndpoint from '../tgcloud/endpoints/club.js';
import profileEndpoint from '../tgcloud/endpoints/profile.js';
import { onCallbackQuery, onChannelPost, onMessage, pump } from '../tgcloud/lib/bot.js';
import * as club from '../tgcloud/lib/club.js';
import * as jobs from '../tgcloud/lib/jobs.js';
import { getSetting } from '../tgcloud/lib/store.js';
import { nowInt, weekStart } from '../tgcloud/lib/util.js';
import * as xp from '../tgcloud/lib/xp.js';
import {
  apiError, callback, CHANNEL, checkErrors, DISCUSSION, FAMILY, groupMessage, OWNER, privateMessage, setup, user,
} from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

const at = (ts) => { Date.now = () => ts * 1000; };
const toOwner = (api) => api.called('sendMessage').filter((c) => c.params.chat_id === OWNER.id);

test('feedback mode ends when the user leaves it with a button or /cancel', async () => {
  const api = await setup();
  const u = user(5);
  await onCallbackQuery(callback(u, 'feedback'));
  await onCallbackQuery(callback(u, 'home'));
  await onMessage(privateMessage(u, 'просто привет боту'));
  assert.equal(toOwner(api).length, 0);

  await onCallbackQuery(callback(u, 'feedback'));
  await onMessage(privateMessage(u, '/cancel'));
  await onMessage(privateMessage(u, 'ещё привет'));
  assert.equal(toOwner(api).length, 0);

  await onCallbackQuery(callback(u, 'feedback'));
  await onMessage(privateMessage(u, 'Идея: добавить квесты'));
  assert.equal(toOwner(api).length, 1);
});

test('news mode ends when the owner presses a non-admin button', async () => {
  await setup();
  const before = await getSetting('news');
  await onCallbackQuery(callback(OWNER, 'admin:news'));
  await onCallbackQuery(callback(OWNER, 'status'));
  await onMessage(privateMessage(OWNER, 'случайный текст'));
  assert.equal(await getSetting('news'), before);
});

test('channel service messages are not copied or remembered as posts', async () => {
  const api = await setup();
  await db.run('INSERT INTO users (user_id, first_seen, last_seen, subscribed) VALUES (11, 1, 1, 1)');
  await onChannelPost({ message_id: 77, date: nowInt(), chat: CHANNEL, pinned_message: { message_id: 50, chat: CHANNEL, date: 1, text: 'x' } });
  assert.equal(await getSetting('last_channel_post_id'), null);
  assert.equal(api.called('copyMessage').length, 0);
  assert.equal((await db.all('SELECT * FROM jobs')).length, 0);
});

test('a post that cannot be copied stops its job after the first try', async () => {
  await setup({ copyMessage: () => { throw apiError('copyMessage', 400, "Bad Request: message can't be copied"); } });
  for (const id of [11, 12, 13]) {
    await db.run('INSERT INTO users (user_id, first_seen, last_seen, subscribed) VALUES (?, 1, 1, 1)', [id]);
  }
  await onChannelPost({ message_id: 78, date: nowInt(), chat: CHANNEL, text: 'Пост' });
  assert.equal(apiMock.called('copyMessage').length, 1);
  assert.equal((await db.get('SELECT status FROM jobs')).status, 'done');
  const errors = await db.all('SELECT source FROM error_log');
  assert.deepEqual(errors.map((r) => r.source), ['post 78']);
  await db.run('DELETE FROM error_log');
});

test('a redelivered channel post and a second broadcast make no extra jobs', async () => {
  await setup();
  const message = { message_id: 80, chat: CHANNEL };
  assert.ok(await jobs.createPostJob(message, 'u'));
  assert.equal(await jobs.createPostJob(message, 'u'), null);
  assert.ok(await jobs.createBroadcast('a', OWNER.id));
  assert.equal(await jobs.createBroadcast('b', OWNER.id), null);
});

test('/shopkey sent in a group is deleted and the owner is warned', async () => {
  const api = await setup();
  await onMessage(groupMessage(FAMILY, OWNER, '/shopkey ghp_' + 'a'.repeat(36)));
  assert.equal(api.called('deleteMessage').length, 1);
  assert.match(api.called('sendMessage')[0].params.text, /только мне в личку/);
});

test('parallel comments cannot pass the cooldown or the daily limit', async () => {
  await setup();
  const ts = nowInt();
  await db.run("INSERT INTO profiles (user_id, name, xp) VALUES (1, 'U', 95)");
  for (let i = 0; i < 19; i++) {
    await db.run("INSERT INTO events VALUES (1, -100, ?, 'comment', 5, ?)", [i + 1, ts - 5000 + i * 100]);
  }
  const results = await Promise.all([1, 2, 3].map((k) => xp.award(user(1), -100, 1000 + k, 'comment', ts)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await db.get('SELECT SUM(points) AS s FROM events WHERE user_id = 1')).s, 100);
});

test('weekly top counts comments and reactions, not bonuses', async () => {
  await setup();
  const monday = weekStart(nowInt()) + 13 * 3600;
  const lastWeek = weekStart(nowInt()) - 7 * 86400;
  at(lastWeek + 3600);
  await pump({ force: true });
  await db.run("INSERT INTO profiles (user_id, name, xp) VALUES (1, 'A', 0), (2, 'B', 0)");
  await db.run("INSERT INTO events VALUES (1, -100, 1, 'comment', 5, ?)", [lastWeek + 100]);
  // A only collects a daily reward last week: not an activity, not on the podium.
  await db.run("INSERT INTO events VALUES (2, 0, 1, 'daily', 35, ?)", [lastWeek + 200]);
  at(monday);
  await pump({ force: true });
  const post = apiMock.called('sendMessage').find((c) => c.params.chat_id === CHANNEL.id);
  assert.match(post.params.text, /A<\/b> — 5 XP/);
  assert.doesNotMatch(post.params.text, /B<\/b>/);
  assert.deepEqual(await xp.leaderboard({ weekly: true }), []);
});

test('weekly summary is retried when the channel post fails', async () => {
  let fail = true;
  await setup({
    sendMessage: (p) => {
      if (p.chat_id === CHANNEL.id && fail) throw new Error('network');
      return { message_id: 1 };
    },
  });
  const monday = weekStart(nowInt()) + 13 * 3600;
  const lastWeek = weekStart(nowInt()) - 7 * 86400;
  at(lastWeek + 3600);
  await pump({ force: true });
  await db.run("INSERT INTO profiles (user_id, name, xp) VALUES (1, 'A', 0)");
  await db.run("INSERT INTO events VALUES (1, -100, 1, 'comment', 5, ?)", [lastWeek + 100]);
  at(monday);
  await pump({ force: true });
  await db.run('DELETE FROM error_log');
  fail = false;
  at(monday + 60);
  await pump({ force: true });
  at(monday + 120);
  await pump({ force: true });
  const posts = apiMock.called('sendMessage').filter((c) => c.params.chat_id === CHANNEL.id);
  assert.equal(posts.length, 2);
  assert.equal((await db.get('SELECT xp FROM profiles WHERE user_id = 1')).xp, 50);
});

test('welcome works per chat and removes only that chat\'s old greeting', async () => {
  const api = await setup();
  const OTHER = { id: -1009, type: 'supergroup', title: 'Relay' };
  await db.run("INSERT INTO relay_targets VALUES (?, 'R', 1, 0)", [OTHER.id]);
  const join = (chat, u) => groupMessage(chat, u, undefined, { new_chat_members: [u] });
  await onMessage(join(DISCUSSION, user(7)));
  await onMessage(join(OTHER, user(8)));
  assert.equal(api.called('sendMessage').length, 2);
  await db.run("UPDATE settings SET value = '0' WHERE key LIKE 'welcome_at:%'");
  await onMessage(join(DISCUSSION, user(9)));
  const deleted = api.called('deleteMessage');
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].params.chat_id, DISCUSSION.id);
});

test('referrals: the weekly cap holds for joins at once; achievements count every friend', async () => {
  await setup({ createChatInviteLink: (p) => ({ invite_link: 'https://t.me/+r1', name: p.name }) });
  await club.referralLink(user(1));
  const join = (u) => ({
    chat: CHANNEL, from: u, date: nowInt(), old_chat_member: { status: 'left', user: u },
    new_chat_member: { status: 'member', user: u }, invite_link: { invite_link: 'https://t.me/+r1', name: 'ref:1' },
  });
  const ts = nowInt();
  for (let i = 0; i < 9; i++) await db.run('INSERT INTO referrals VALUES (?, 1, ?, 25)', [500 + i, ts]);
  await Promise.all([20, 21, 22, 23].map((id) => club.handleJoin(join(user(id)))));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM referrals WHERE points > 0')).c, 10);
  const data = await profileEndpoint({}, { initData: { user: user(1) } });
  await db.run('DELETE FROM achievements');
  await db.run('UPDATE referrals SET points = 0');
  const fresh = await profileEndpoint({}, { initData: { user: user(1) } });
  assert.ok(fresh.club.achievements.find((a) => a.code === 'legion').at);
});

test('a vote does not land in a poll closed meanwhile', async () => {
  await setup();
  await club.createPoll('Что дальше?', ['Да', 'Нет']);
  const poll = await db.get('SELECT id FROM polls');
  await assert.rejects(Promise.all([club.vote(user(1), poll.id, 0), club.closePoll(poll.id)]), /закрыт/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM poll_votes')).c, 0);
});

test('club endpoint works for a brand-new user', async () => {
  await setup();
  const data = await clubEndpoint({ action: 'daily' }, { initData: { user: user(42) } });
  assert.equal(data.result.points, club.DAILY_REWARDS[0]);
});
