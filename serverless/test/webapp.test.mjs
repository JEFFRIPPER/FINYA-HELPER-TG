import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, EndpointError } from 'sdk';
import profileEndpoint from '../tgcloud/endpoints/profile.js';
import { onMessage, pump } from '../tgcloud/lib/bot.js';
import { DEFAULT_NEWS, SQUAD_LINKS, WEBAPP_URL } from '../tgcloud/lib/config.js';
import { setSetting } from '../tgcloud/lib/store.js';
import * as xp from '../tgcloud/lib/xp.js';
import { dayStart, nowInt } from '../tgcloud/lib/util.js';
import { checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, setup, user } from './helpers.mjs';

afterEach(checkErrors);

async function seed() {
  const ts = nowInt();
  for (const [id, name, points] of [[1, 'Alice', 120], [2, 'Bob', 40], [3, 'Carol', 600]]) {
    await db.run('INSERT INTO profiles (user_id, name, username, xp) VALUES (?, ?, ?, ?)', [id, name, `user${id}`, points]);
  }
  await db.run(`INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES
    (1, -100, 1, 'comment', 5, ?), (1, -100, 2, 'reaction', 1, ?), (1, -100, 3, 'comment', 0, ?),
    (1, -100, 4, 'comment', 5, ?), (2, -100, 5, 'comment', 5, ?)`,
  [ts - 60, ts - 30, ts - 20, dayStart(ts) - 86400 + 3600, ts - 10]);
  return ts;
}

const call = (u) => profileEndpoint({}, { initData: { user: u } });

test('profile endpoint: rank, progress, place, chart and history of the caller', async () => {
  await setup();
  const ts = await seed();
  const data = await call(user(1, { first_name: 'Alice' }));
  assert.equal(data.me.xp, 120);
  assert.deepEqual(data.me.rank, { roman: 'II', name: 'Звено', from: 100 });
  assert.deepEqual(data.me.progress, { next: { roman: 'III', name: 'Клинок', from: 300 }, left: 180, percent: 10 });
  assert.equal(data.me.place, 2);
  assert.equal(data.me.participants, 3);
  assert.equal(data.me.today, 6);
  assert.equal(data.chart.length, 7);
  assert.equal(data.chart[6].day, dayStart(ts));
  assert.equal(data.chart[6].xp, 6);
  assert.equal(data.chart[5].xp, 5);
  // Denied attempts (0 points) are not history.
  assert.deepEqual(data.history.map((h) => [h.kind, h.points]), [['reaction', 1], ['comment', 5], ['comment', 5]]);
  assert.deepEqual(data.ranks.filter((r) => r.reached).map((r) => r.roman), ['I', 'II']);
});

test('profile endpoint: the top shows names and XP only', async () => {
  await setup();
  await seed();
  const data = await call(user(2, { first_name: 'Bob' }));
  assert.deepEqual(data.top.all.map((t) => [t.place, t.name, t.score, t.me]),
    [[1, 'Carol', 600, false], [2, 'Alice', 120, false], [3, 'Bob', 40, true]]);
  assert.deepEqual(data.top.week.map((t) => t.name).sort(), ['Alice', 'Bob']);
  const json = JSON.stringify(data.top);
  assert.doesNotMatch(json, /user_id|username|user1|"id"/);
});

test('profile endpoint: founder, owner changes and a new member', async () => {
  await setup();
  await seed();
  const founder = await call(OWNER);
  assert.equal(founder.me.rank.roman, 'X');
  assert.equal(founder.me.progress, null);
  assert.equal(founder.me.place, null);

  await xp.adjustXp(1, 30, { actorId: OWNER.id, ownerId: OWNER.id, operationId: 'op-1' });
  await xp.setManualRank(1, 'V', { actorId: OWNER.id, ownerId: OWNER.id, operationId: 'op-2' });
  const alice = await call(user(1, { first_name: 'Alice' }));
  assert.equal(alice.me.manualRank, true);
  assert.equal(alice.me.rank.roman, 'V');
  assert.equal(alice.me.progress, null);
  assert.deepEqual(alice.history.slice(0, 2).map((h) => h.kind).sort(), ['owner_rank', 'owner_xp']);
  assert.equal(alice.history.find((h) => h.kind === 'owner_xp').points, 30);

  const fresh = await call(user(50, { first_name: 'New' }));
  assert.equal(fresh.me.xp, 0);
  assert.equal(fresh.me.place, null);
  assert.equal(fresh.me.progress.percent, 0);
  assert.deepEqual(fresh.history, []);
  // Opening the Mini App counts as using the bot.
  assert.ok(await db.get('SELECT 1 FROM users WHERE user_id = 50'));
});

test('profile endpoint refuses a call without a user', async () => {
  await setup();
  await assert.rejects(profileEndpoint({}, { initData: {} }), (err) => err instanceof EndpointError &&
    err.parameters.code === 'NO_USER');
});

function buttons(call) {
  return call.params.reply_markup.inline_keyboard.flat();
}

test('private chats get a web_app button, groups a link to the private chat', async () => {
  const mock = await setup();
  await onMessage(privateMessage(user(7), '/start'));
  const home = buttons(mock.called('sendPhoto')[0]);
  assert.ok(home.some((b) => b.web_app && b.web_app.url === WEBAPP_URL));

  await onMessage(privateMessage(user(7), '/start profile'));
  const profile = buttons(mock.called('sendMessage').at(-1));
  assert.ok(profile.some((b) => b.web_app && b.web_app.url === WEBAPP_URL));

  await onMessage(groupMessage(DISCUSSION, user(8), '/rank'));
  const group = buttons(mock.called('sendMessage').at(-1));
  assert.ok(!group.some((b) => b.web_app));
  assert.ok(group.some((b) => b.url === 'https://t.me/finya_bot?start=profile'));
});

test('the menu button is set to the Mini App once', async () => {
  const mock = await setup();
  await pump({ force: true });
  await pump({ force: true });
  const calls = mock.called('setChatMenuButton');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params.menu_button, { type: 'web_app', text: 'Профиль', web_app: { url: WEBAPP_URL } });
});

test('profile endpoint: the squad tab gets the news, the last post and the menu links', async () => {
  await setup();
  await seed();
  let data = await call(user(1, { first_name: 'Alice' }));
  assert.equal(data.squad.news, DEFAULT_NEWS);
  assert.equal(data.squad.lastPost, null);
  assert.equal(data.squad.channel, 'https://t.me/THKC_SQUAD');
  assert.deepEqual(data.squad.links, SQUAD_LINKS);
  await setSetting('news', 'Стрим в субботу');
  await setSetting('last_channel_post_id', 1500);
  data = await call(user(1, { first_name: 'Alice' }));
  assert.equal(data.squad.news, 'Стрим в субботу');
  assert.equal(data.squad.lastPost, 'https://t.me/THKC_SQUAD/1500');
});
