import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, EndpointError } from 'sdk';
import clubEndpoint from '../tgcloud/endpoints/club.js';
import profileEndpoint from '../tgcloud/endpoints/profile.js';
import { onChatMember, onMessage, pump } from '../tgcloud/lib/bot.js';
import * as club from '../tgcloud/lib/club.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { dayStart, nowInt, weekStart } from '../tgcloud/lib/util.js';
import * as xp from '../tgcloud/lib/xp.js';
import { CHANNEL, checkErrors, DISCUSSION, groupMessage, OWNER, setup, user } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

// Freezes the clock at unix seconds `ts`.
function at(ts) {
  Date.now = () => ts * 1000;
}

const call = (u, input) => clubEndpoint(input, { initData: { user: u } });
const profile = (u) => profileEndpoint({}, { initData: { user: u } });
const clubError = (err) => err instanceof EndpointError && err.parameters.code === 'CLUB';

async function addEvents(rows) {
  for (const [userId, kind, points, ts, key] of rows) {
    await db.run('INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, -100, key ?? Math.floor(Math.random() * 1e9), kind, points, ts]);
  }
}

async function xpOf(id) {
  return (await db.get('SELECT xp FROM profiles WHERE user_id = ?', [id])).xp;
}

test('daily reward: once a day, a 7-day cycle that restarts after a missed day', async () => {
  await setup();
  const alice = user(1, { first_name: 'Alice' });
  let data = await call(alice, { action: 'daily' });
  assert.deepEqual(data.result, { points: 5, promoted: false });
  assert.equal(data.club.daily.claimed, true);
  assert.equal(data.me.xp, 5);
  await assert.rejects(call(alice, { action: 'daily' }), clubError);

  // Six days in a row before today: today is the 7th and biggest reward.
  await setup();
  const today = club.mskDay(nowInt());
  await db.run("INSERT INTO profiles (user_id, name) VALUES (1, 'Alice')");
  for (let i = 1; i <= 6; i++) {
    await db.run("INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES (1, 0, ?, 'daily', 5, ?)",
      [today - i, nowInt() - i * 86400]);
  }
  assert.equal((await profile(alice)).club.daily.step, 6);
  data = await call(alice, { action: 'daily' });
  assert.equal(data.result.points, club.DAILY_REWARDS[6]);

  // A gap breaks the chain.
  await setup();
  await db.run("INSERT INTO profiles (user_id, name) VALUES (1, 'Alice')");
  await db.run("INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES (1, 0, ?, 'daily', 5, ?)",
    [today - 2, nowInt() - 2 * 86400]);
  assert.equal((await profile(alice)).club.daily.step, 0);
});

test('bonus XP does not use up the daily limit for comments and reactions', async () => {
  await setup();
  const alice = user(1, { first_name: 'Alice' });
  await xp.grant(alice, 'daily', club.mskDay(nowInt()), 35);
  await xp.grant(alice, 'quest', 1, 70);
  const award = await xp.award(alice, -100, 1, 'comment', nowInt());
  assert.equal(award.points, xp.COMMENT_XP);
  const data = await profile(alice);
  assert.equal(data.me.today, xp.COMMENT_XP);
  // Bonuses don't keep the activity streak alive by themselves.
  assert.equal(data.me.streak.days, 1);
});

test('weekly quests: progress from this week, claim once when done', async () => {
  await setup();
  const ts = nowInt();
  const week = club.weekNo(ts);
  const quests = club.weekQuests(week);
  assert.equal(new Set(quests.map((q) => q.id)).size, 3);
  const alice = user(1, { first_name: 'Alice' });
  const target = quests.find((q) => q.kind === 'comments' || q.kind === 'reactions' || q.kind === 'days') || quests[0];
  let data = await profile(alice);
  assert.deepEqual(data.club.quests.map((q) => q.id), quests.map((q) => q.id));
  await assert.rejects(call(alice, { action: 'quest', id: target.id }), clubError);
  await assert.rejects(call(alice, { action: 'quest', id: 999 }), clubError);

  // Complete every quest of the week with events from this week.
  const start = Math.max(weekStart(ts), ts - 3 * 86400);
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push([1, 'comment', 5, start + (i % 4) * 86400 / 2 + i]);
  for (let i = 0; i < 25; i++) rows.push([1, 'reaction', 1, start + i]);
  await addEvents(rows.filter((r) => r[3] <= ts));
  for (let i = 0; i < 5; i++) {
    await db.run("INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES (1, 0, ?, 'daily', 5, ?)",
      [100 + i, Math.min(ts, start + i)]);
  }
  data = await profile(alice);
  for (const q of data.club.quests) {
    if (q.progress < q.goal) continue;
    const before = await xpOf(1);
    const after = await call(alice, { action: 'quest', id: q.id });
    assert.equal(after.result.points, q.xp);
    assert.equal(await xpOf(1), before + q.xp);
    assert.equal(after.club.quests.find((x) => x.id === q.id).claimed, true);
    await assert.rejects(call(alice, { action: 'quest', id: q.id }), clubError);
  }
});

test('achievements unlock once and give their XP', async () => {
  await setup();
  const alice = user(1, { first_name: 'Alice' });
  await xp.award(alice, -100, 1, 'comment', nowInt());
  let data = await profile(alice);
  const first = data.club.achievements.find((a) => a.code === 'first_comment');
  assert.ok(first.at);
  assert.deepEqual(data.club.fresh, ['first_comment']);
  assert.equal(data.me.xp, xp.COMMENT_XP + first.xp);
  assert.equal(data.history[0].kind, 'achievement');
  data = await profile(alice);
  assert.deepEqual(data.club.fresh, []);
  assert.equal(data.me.xp, xp.COMMENT_XP + first.xp);
  assert.equal(data.club.achievements.find((a) => a.code === 'comments_100').progress, 1);
});

test('XP shop: spends the balance, never XP or rank; equip and show in the top', async () => {
  await setup();
  await db.run("INSERT INTO profiles (user_id, name, xp) VALUES (1, 'Alice', 320), (2, 'Bob', 50)");
  await db.run("INSERT INTO achievements (user_id, code, unlocked_at) VALUES (1, 'shopper', 0)");
  const alice = user(1, { first_name: 'Alice' });
  let data = await call(alice, { action: 'buy', item: 'frame_ember' });
  assert.equal(data.me.xp, 320);
  assert.equal(data.me.rank.roman, 'III');
  assert.equal(data.club.shop.balance, 170);
  assert.equal(data.club.shop.items.find((i) => i.id === 'frame_ember').equipped, true);
  await assert.rejects(call(alice, { action: 'buy', item: 'frame_ice' }), clubError);
  await assert.rejects(call(alice, { action: 'buy', item: 'nope' }), clubError);
  data = await call(alice, { action: 'buy', item: 'color_crimson' });
  assert.equal(data.club.shop.balance, 70);
  // Buying the same thing again costs nothing.
  data = await call(alice, { action: 'buy', item: 'color_crimson' });
  assert.equal(data.club.shop.balance, 70);
  await assert.rejects(call(alice, { action: 'wear', slot: 'title', item: 'title_night' }), clubError);
  assert.deepEqual(data.me.style, { frame: 'frame_ember', color: 'color_crimson', title: null });
  const bob = await profile(user(2, { first_name: 'Bob' }));
  assert.deepEqual(bob.top.all.find((r) => r.name === 'Alice').style, { frame: 'frame_ember', color: 'color_crimson', title: null });
  data = await call(alice, { action: 'wear', slot: 'frame', item: null });
  assert.deepEqual(data.me.style, { frame: null, color: 'color_crimson', title: null });
  // The founder wears anything without buying.
  data = await call(OWNER, { action: 'wear', slot: 'title', item: 'title_legend' });
  assert.equal(data.me.style.title, 'Легенда');
});

test('polls: the owner creates and closes, members vote once for XP', async () => {
  await setup();
  const alice = user(1, { first_name: 'Alice' });
  await assert.rejects(call(alice, { action: 'poll_create', question: 'Что?', options: ['a', 'b'] }), clubError);
  await assert.rejects(call(OWNER, { action: 'poll_create', question: 'Стрим?', options: ['Да'] }), clubError);
  await assert.rejects(call(OWNER, { action: 'poll_create', question: 'Стрим?', options: ['Да', 'да'] }), clubError);
  let data = await call(OWNER, { action: 'poll_create', question: 'Стрим в субботу?', options: ['Да', 'Нет', 'Позже'] });
  const poll = data.club.polls[0];
  assert.equal(poll.open, true);
  data = await profile(alice);
  // Results are hidden until you vote.
  assert.deepEqual(data.club.polls[0].options.map((o) => o.votes), [null, null, null]);
  await assert.rejects(call(alice, { action: 'vote', poll: poll.id, option: 7 }), clubError);
  data = await call(alice, { action: 'vote', poll: poll.id, option: 1 });
  assert.equal(data.result.points, club.POLL_XP);
  assert.equal(data.club.polls[0].my, 1);
  assert.deepEqual(data.club.polls[0].options.map((o) => o.votes), [0, 1, 0]);
  await assert.rejects(call(alice, { action: 'vote', poll: poll.id, option: 0 }), clubError);
  await call(OWNER, { action: 'poll_close', poll: poll.id });
  await assert.rejects(call(user(2), { action: 'vote', poll: poll.id, option: 0 }), clubError);
  data = await profile(user(2));
  assert.equal(data.club.polls[0].open, false);
  assert.equal(data.club.polls[0].total, 1);
});

test('birthday: set once a month, a gift and one greeting in the discussion group', async () => {
  const api = await setup();
  const ts = nowInt();
  const today = new Date((ts + 3 * 3600) * 1000);
  const alice = user(1, { first_name: 'Alice' });
  let data = await call(alice, { action: 'birthday', day: today.getUTCDate(), month: today.getUTCMonth() + 1 });
  assert.equal(data.club.birthday.today, true);
  const gifted = data.me.xp;
  assert.ok(gifted >= club.BIRTHDAY_XP);
  await assert.rejects(call(alice, { action: 'birthday', day: 31, month: 2 }), clubError);
  await assert.rejects(call(alice, { action: 'birthday', day: 1, month: today.getUTCMonth() === 0 ? 2 : 1 }), clubError);
  // Only the announce flag can change without waiting.
  data = await call(alice, { action: 'birthday', day: today.getUTCDate(), month: today.getUTCMonth() + 1, announce: true });
  assert.equal(data.club.birthday.announce, true);

  // The greeting goes out once a day, from 10:00 Moscow time.
  at(dayStart(ts) + 11 * 3600);
  await pump({ force: true });
  await pump({ force: true });
  const greetings = api.called('sendMessage').filter((c) => c.params.chat_id === DISCUSSION.id);
  assert.equal(greetings.length, 1);
  assert.match(greetings[0].params.text, /день рождения у <b>Alice<\/b>/);
  // The gift was already given when the app was opened.
  assert.equal(await xpOf(1), gifted);
});

test('referrals: a personal link, XP for both once, no self or returning members', async () => {
  const api = await setup({
    createChatInviteLink: (p) => ({ invite_link: `https://t.me/+ref${p.name.slice(4)}`, name: p.name }),
  });
  const alice = user(1, { first_name: 'Alice' });
  let data = await call(alice, { action: 'ref' });
  assert.equal(data.club.referral.link, 'https://t.me/+ref1');
  await call(alice, { action: 'ref' });
  assert.equal(api.called('createChatInviteLink').length, 1);
  assert.equal(api.called('createChatInviteLink')[0].params.chat_id, CHANNEL.id);

  const join = (u, link = 'https://t.me/+ref1', old = 'left') => ({
    chat: CHANNEL, from: u, date: nowInt(),
    old_chat_member: { status: old, user: u }, new_chat_member: { status: 'member', user: u },
    invite_link: { invite_link: link, name: 'ref:1', creator: { id: 999 } },
  });
  await onChatMember(join(user(5, { first_name: 'Eve' })));
  await onChatMember(join(user(5, { first_name: 'Eve' })));
  await onChatMember(join(alice));
  await db.run("INSERT INTO blacklist (chat_id, user_id, left_at, status) VALUES (?, 6, 0, 'banned')", [CHANNEL.id]);
  await onChatMember(join(user(6)));
  assert.equal(await xpOf(1), club.REFERRAL_XP);
  assert.equal(await xpOf(5), club.INVITED_XP);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM referrals')).c, 1);
  const dm = api.called('sendMessage').filter((c) => c.params.chat_id === 1);
  assert.equal(dm.length, 1);
  assert.match(dm[0].params.text, /Eve/);
  data = await profile(alice);
  assert.equal(data.club.referral.count, 1);
  assert.ok(data.club.achievements.find((a) => a.code === 'recruiter').at);
});

test('welcome: one greeting for newcomers in the discussion group, the old one is removed', async () => {
  const api = await setup();
  const joined = (...people) => groupMessage(DISCUSSION, people[0], undefined, { new_chat_members: people });
  await onMessage(joined(user(7, { first_name: 'Ник' })));
  let sent = api.called('sendMessage');
  assert.equal(sent.length, 1);
  assert.match(sent[0].params.text, /Добро пожаловать в Сквад, <b>Ник<\/b>/);
  // Within 15 seconds the next wave is not greeted again.
  await onMessage(joined(user(8)));
  assert.equal(api.called('sendMessage').length, 1);
  await db.run("UPDATE settings SET value = '0' WHERE key = 'welcome_at'");
  await onMessage(joined(user(9)));
  assert.equal(api.called('sendMessage').length, 2);
  assert.equal(api.called('deleteMessage').length, 1);
  // Bots and other groups are ignored; the owner can switch it off.
  await db.run("UPDATE settings SET value = '0' WHERE key = 'welcome_at'");
  await onMessage(joined({ id: 55, is_bot: true, first_name: 'bot' }));
  await onMessage(groupMessage({ id: -5, type: 'supergroup' }, user(10), undefined, { new_chat_members: [user(10)] }));
  await setSetting('club_welcome', false);
  await onMessage(joined(user(11)));
  assert.equal(api.called('sendMessage').length, 2);
});

test('weekly summary: top-3 of last week to the channel once, with bonuses', async () => {
  const api = await setup();
  // A Monday, 13:00 Moscow time.
  const monday = weekStart(nowInt()) + 13 * 3600;
  const lastWeek = weekStart(nowInt()) - 7 * 86400;
  at(lastWeek + 3600);
  // First run only remembers the week.
  await pump({ force: true });
  for (const [id, name] of [[1, 'Alice'], [2, 'Bob'], [3, 'Carol'], [4, 'Dan']]) {
    await db.run('INSERT INTO profiles (user_id, name, xp) VALUES (?, ?, 0)', [id, name]);
  }
  await addEvents([[1, 'comment', 50, lastWeek + 100], [2, 'comment', 40, lastWeek + 200],
    [3, 'reaction', 30, lastWeek + 300], [4, 'reaction', 5, lastWeek + 400], [4, 'comment', 0, lastWeek + 500]]);
  at(monday - 2 * 3600); // 11:00: too early
  await pump({ force: true });
  assert.equal(api.called('sendMessage').filter((c) => c.params.chat_id === CHANNEL.id).length, 0);
  at(monday);
  await pump({ force: true });
  await pump({ force: true });
  const posts = api.called('sendMessage').filter((c) => c.params.chat_id === CHANNEL.id);
  assert.equal(posts.length, 1);
  assert.match(posts[0].params.text, /🥇 <b>Alice<\/b> — 50 XP[\s\S]*🥈 <b>Bob<\/b>[\s\S]*🥉 <b>Carol<\/b>/);
  assert.match(posts[0].params.text, /Комментариев: <b>2<\/b>/);
  assert.doesNotMatch(posts[0].params.text, /Dan/);
  assert.equal(await xpOf(1), club.WEEKLY_BONUS[0]);
  assert.equal(await xpOf(3), club.WEEKLY_BONUS[2]);
  assert.equal(await xpOf(4), 0);
});

test('owner club switches and preview; members cannot use them', async () => {
  const api = await setup();
  await assert.rejects(call(user(1), { action: 'setting', key: 'weekly', value: false }), clubError);
  let data = await call(OWNER, { action: 'setting', key: 'weekly', value: false });
  assert.equal(data.club.admin.weekly, false);
  assert.equal(data.club.admin.welcome, true);
  await assert.rejects(call(OWNER, { action: 'setting', key: 'nope', value: true }), clubError);
  await call(OWNER, { action: 'weekly_preview' });
  assert.equal(api.called('sendMessage').at(-1).params.chat_id, OWNER.id);
  data = await profile(user(1));
  assert.equal(data.club.admin, undefined);
});
