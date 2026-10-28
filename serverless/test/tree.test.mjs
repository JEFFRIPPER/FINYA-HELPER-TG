// «Ёлка Сквада»: 1 December – 13 January, toys for XP on one tree, the summary on 31.12.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage, pump } from '../tgcloud/lib/bot.js';
import { handle } from '../tgcloud/lib/club_app.js';
import * as seasons from '../tgcloud/lib/seasons.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { checkErrors, DISCUSSION, groupMessage, OWNER, replies, setup, user } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

const DAY = 86400;
const msk = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h) / 1000 - 3 * 3600;
// 20 December 2026, 15:00 МСК.
const T = msk(2026, 12, 20, 15);
const at = (ts) => { Date.now = () => ts * 1000; };
const say = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));
// XP paid for toys (badges and the club add XP of their own meanwhile).
const paid = async (id) => (await db.get("SELECT COALESCE(SUM(amount), 0) AS n FROM xp_spend WHERE user_id = ? AND kind = 'tree'", [id])).n;

async function member(id, name, xp) {
  await db.run('INSERT INTO profiles (user_id, name, username, xp) VALUES (?, ?, ?, ?)', [id, name, '', xp]);
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, ?, ?, '', 'member', ?, ?, 0)`, [DISCUSSION.id, id, name, T - 100 * DAY, T]);
  return user(id, { first_name: name });
}

test('the tree stands from 1 December to the end of 13 January, Moscow time', async () => {
  await setup();
  assert.equal(seasons.treeSeason(msk(2026, 11, 30, 23)), null);
  assert.deepEqual(seasons.treeSeason(msk(2026, 12, 1)), { season: 2026, starts: msk(2026, 12, 1), ends: msk(2027, 1, 14) });
  assert.equal(seasons.treeSeason(msk(2027, 1, 13, 23)).season, 2026);
  assert.equal(seasons.treeSeason(msk(2027, 1, 14)), null);
  assert.equal(seasons.nextTree(msk(2026, 10, 28)), msk(2026, 12, 1));
  assert.equal(seasons.nextTree(msk(2027, 1, 20)), msk(2027, 12, 1));
});

test('toys cost XP, three a member, one star a season; a failed one gives the XP back', async () => {
  await setup();
  at(T);
  const a = await member(2, 'Аня', 1000);
  const b = await member(3, 'Боря', 600);
  let data = await handle(a, { action: 'tree', kind: 'ball' });
  assert.equal(data.result.toy, 'Алый шар');
  assert.equal(await paid(2), 50);
  assert.equal(data.season.tree.count, 1);
  assert.deepEqual(data.season.tree.toys, [{ kind: 'ball', by: 'Аня', mine: true }]);
  assert.ok(await db.get("SELECT 1 FROM achievements WHERE user_id = 2 AND code = 'tree_2026'"), 'the limited badge');

  data = await handle(b, { action: 'tree', kind: 'star' });
  assert.deepEqual(data.season.tree.star, { by: 'Боря', mine: true });
  assert.equal(await paid(3), 500);
  await assert.rejects(handle(a, { action: 'tree', kind: 'star' }), /Звезду на макушку уже повесили/);
  assert.equal(await paid(2), 50, 'XP back');

  const poor = await member(4, 'Вика', 30);
  await assert.rejects(handle(poor, { action: 'tree', kind: 'ball' }), /Не хватает XP на балансе: алый шар стоит 50 XP/);
  assert.equal(await paid(4), 0);
  await assert.rejects(handle(a, { action: 'tree', kind: 'rocket' }), /Такой игрушки нет/);
  await handle(a, { action: 'tree', kind: 'snow' });
  data = await handle(a, { action: 'tree', kind: 'bell' });
  assert.equal(data.season.tree.mine, 3);
  await assert.rejects(handle(a, { action: 'tree', kind: 'candy' }), /уже 3 твоих игрушки/);
  assert.equal(await paid(2), 225);
  assert.deepEqual(data.season.tree.toys.map((t) => t.kind), ['ball', 'snow', 'bell']);
  assert.deepEqual(data.season.tree.top, [{ name: 'Аня', n: 3 }, { name: 'Боря', n: 1 }]);
});

test('outside the season: no toys, only the owner sees the tree ahead', async () => {
  await setup();
  at(msk(2026, 10, 28, 15));
  const a = await member(2, 'Аня', 1000);
  await assert.rejects(handle(a, { action: 'tree', kind: 'ball' }), /с 1 декабря по 13 января/);
  const data = await handle(a, { action: 'ref' }).catch(() => null);
  if (data) assert.equal(data.season.tree, null);
  const view = await seasons.treeView(OWNER.id);
  assert.equal(view.open, false);
  assert.equal(view.season, 2026);
  assert.equal(view.opens, msk(2026, 12, 1));
  assert.ok(view.shop.every((t) => t.price === 0), 'free for the owner, like the shop');
});

test('«Ёлка» in the chat, and the summary on New Year\'s Eve once per chat', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  at(msk(2026, 11, 20, 12));
  const a = await member(2, 'Аня', 1000);
  const b = await member(3, 'Боря', 1000);
  await say(a, 'ёлка');
  assert.match(replies(api).at(-1).params.text, /откроется 1 декабря, через 11 дней/);

  at(T);
  await say(a, 'Ёлка Сквада');
  assert.match(replies(api).at(-1).params.text, /пока без игрушек/);
  await handle(a, { action: 'tree', kind: 'ball' });
  await handle(a, { action: 'tree', kind: 'gift' });
  await handle(b, { action: 'tree', kind: 'star' });
  await say(b, 'ёлка');
  assert.match(replies(api).at(-1).params.text, /На Ёлке Сквада 3 игрушки от 2 участников\.\n⭐ Звезда на макушке: Боря/);

  const summaries = () => replies(api).filter((x) => /Ёлка Сквада 2026 · итоги/.test(x.params.text));
  at(msk(2026, 12, 31, 17));
  await pump({ force: true });
  assert.equal(summaries().length, 0, 'not before 18:00');
  at(msk(2026, 12, 31, 20));
  await pump({ force: true });
  await pump({ force: true });
  assert.equal(summaries().length, 1);
  const text = summaries()[0].params.text;
  assert.equal(summaries()[0].params.chat_id, DISCUSSION.id);
  assert.match(text, /На ёлке 3 игрушки от 2 участников\.\n⭐ Звезда на макушке: Боря\n🏅 Больше всех украсили: Аня \(2\), Боря \(1\)/);
  at(msk(2027, 1, 1, 9));
  await pump({ force: true });
  assert.equal(summaries().length, 1, 'once');
});
