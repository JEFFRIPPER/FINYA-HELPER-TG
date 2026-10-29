// The design pass of the Mini App: refs instead of IDs, the member card, the rarity of
// achievements and the «Ты» row under the top.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, EndpointError } from 'sdk';
import memberEndpoint from '../tgcloud/endpoints/member.js';
import { REF_RE, refsOf, userOfRef } from '../tgcloud/lib/members.js';
import { profileData } from '../tgcloud/lib/webapp.js';
import { checkErrors, DISCUSSION, setup, user } from './helpers.mjs';
import { nowInt } from '../tgcloud/lib/util.js';

afterEach(checkErrors);

const DAY = 86400;
const card = (viewer, ref) => memberEndpoint({ ref }, { initData: { user: user(viewer) } });
const code = (name) => (err) => err instanceof EndpointError && err.parameters.code === name;

async function member(id, name, xp, extra = {}) {
  const ts = nowInt();
  await db.run('INSERT INTO profiles (user_id, name, username, xp) VALUES (?, ?, ?, ?)', [id, name, extra.username || '', xp]);
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, ?, ?, ?, 'member', ?, ?, 0)`, [DISCUSSION.id, id, name, extra.username || '', ts - 100 * DAY, ts]);
  if (extra.city) await db.run('INSERT INTO profile_info (user_id, city, updated_at) VALUES (?, ?, ?)', [id, extra.city, ts]);
}

test('refs: one per member, stable, unique, and they lead back to the member', async () => {
  await setup();
  const first = await refsOf([2, 3, 3, -5, 0]);
  assert.deepEqual([...first.keys()].sort(), [2, 3]);
  for (const ref of first.values()) assert.match(ref, REF_RE);
  assert.notEqual(first.get(2), first.get(3));
  const again = await refsOf([3, 2]);
  assert.equal(again.get(2), first.get(2));
  assert.equal(again.get(3), first.get(3));
  assert.equal(await userOfRef(first.get(3)), 3);
  assert.equal(await userOfRef('0'.repeat(12)), null);
  assert.equal(await userOfRef('2'), null);
  assert.equal(await userOfRef({ ref: first.get(2) }), null);
  assert.equal((await refsOf([])).size, 0);
});

test('a tap on a person in the top opens their card: rank, pair, badges, city, no IDs', async () => {
  await setup();
  await member(2, 'Аня', 300, { username: 'anya', city: 'Москва' });
  await member(3, 'Боря', 120);
  const ts = nowInt();
  await db.run('INSERT INTO marriages (user_id, partner_id, since) VALUES (2, 3, ?), (3, 2, ?)', [ts - 40 * DAY, ts - 40 * DAY]);
  await db.run("INSERT INTO achievements (user_id, code, unlocked_at) VALUES (2, 'first_comment', 1), (2, 'nick', 2)");

  const data = await profileData(user(3));
  const anya = data.top.all.find((r) => r.name === 'Аня');
  assert.match(anya.ref, REF_RE);
  assert.ok(!('user_id' in anya) && !('id' in anya));

  const c = await card(3, anya.ref);
  assert.equal(c.name, 'Аня');
  assert.equal(c.username, 'anya');
  assert.equal(c.me, false);
  assert.equal(c.xp, 300);
  assert.equal(c.place, 1);
  assert.equal(c.city, 'Москва');
  assert.equal(c.achievements.got, 2);
  assert.ok(c.achievements.total >= 80);
  assert.ok(c.since > 0);
  assert.equal(c.pair.name, 'Боря');
  assert.equal(c.pair.dating, false);
  // The partner's chip opens their card by their own ref.
  const borya = await card(3, c.pair.ref);
  assert.equal(borya.name, 'Боря');
  assert.equal(borya.me, true);
  assert.equal(borya.pair.ref, anya.ref);
  // Nothing in the card is a Telegram ID.
  assert.doesNotMatch(JSON.stringify(c), /"(user_id|id|partner_id)":/);
  // Several spouses: the chip names them all and opens nobody's card.
  await member(4, 'Вика', 50);
  await db.run('INSERT INTO marriages (user_id, partner_id, since) VALUES (2, 4, ?), (4, 2, ?)', [ts - DAY, ts - DAY]);
  const two = await card(3, anya.ref);
  assert.equal(two.pair.name, 'Боря, Вика');
  assert.equal(two.pair.ref, null);
});

test('the member card refuses a made-up ref and a call from outside Telegram', async () => {
  await setup();
  await assert.rejects(card(2, '0'.repeat(12)), code('NO_MEMBER'));
  await assert.rejects(card(2, '3'), code('NO_MEMBER'));
  await assert.rejects(card(2, null), code('NO_MEMBER'));
  await assert.rejects(memberEndpoint({ ref: 'abc' }, {}), code('NO_USER'));
});

test('rarity: how many hold each achievement and their share of the Squad', async () => {
  await setup();
  for (let id = 2; id <= 21; id++) await member(id, `M${id}`, 10);
  await db.run("INSERT INTO achievements (user_id, code, unlocked_at) VALUES (2, 'first_comment', 1), (3, 'first_comment', 1), (2, 'nick', 1)");
  const data = await profileData(user(2));
  const by = (c) => data.club.achievements.find((a) => a.code === c);
  // 20 members with XP: 2 of them is 10 %, 1 of them is 5 %, nobody is 0.
  assert.equal(by('first_comment').held, 2);
  assert.equal(by('first_comment').share, 10);
  assert.equal(by('nick').held, 1);
  assert.equal(by('nick').share, 5);
  assert.equal(by('comments_100').held, 0);
  assert.equal(by('comments_100').share, 0);
});

test('the «Ты» row: the member\'s own place in the week and overall, also below the ten', async () => {
  await setup();
  const ts = nowInt();
  for (let id = 2; id <= 13; id++) {
    await member(id, `M${id}`, 20000 - id * 1000);
    await db.run("INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES (?, -100, ?, 'comment', ?, ?)",
      [id, id, 100 - id, ts - 60]);
  }
  const last = await profileData(user(13));
  assert.equal(last.top.week.length, 10);
  assert.deepEqual(last.top.mine.week, { place: 12, score: 87 });
  // Opening the profile may add achievement XP: the score is the member's XP right now.
  assert.deepEqual(last.top.mine.all, { place: 12, score: last.me.xp });
  // The week's own place agrees with the top itself.
  const fifth = await profileData(user(6));
  assert.equal(fifth.top.mine.week.place, fifth.top.week.findIndex((r) => r.me) + 1);
  // Nothing this week: no weekly place.
  await member(40, 'Тихий', 5);
  assert.equal((await profileData(user(40))).top.mine.week, null);
});
