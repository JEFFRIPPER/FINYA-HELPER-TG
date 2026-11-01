// Newcomer guide, shop gifts, quest of choice, birthday crowns and eve reminders,
// the «Штаб» report and the owner's position/award buttons.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage, pump } from '../tgcloud/lib/bot.js';
import * as club from '../tgcloud/lib/club.js';
import { handle } from '../tgcloud/lib/club_app.js';
import { handle as ranks } from '../tgcloud/lib/rank_app.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { xpTopText } from '../tgcloud/lib/ui.js';
import { nowInt, weekStart } from '../tgcloud/lib/util.js';
import { checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, replies, setup, user } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});
const at = (ts) => { Date.now = () => ts * 1000; };
const DAY = 86400;
const texts = (api) => replies(api).map((c) => c.params.text);
const sentTo = (api, id) => replies(api).filter((c) => c.params.chat_id === id).map((c) => c.params.text);
const known = (id) => db.run('INSERT OR IGNORE INTO users (user_id, first_seen, last_seen, subscribed) VALUES (?, 1, 1, 1)', [id]);
const giveXp = (id, points, username = `user${id}`) => db.run(`INSERT INTO profiles (user_id, name, username, xp) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp, username = excluded.username`, [id, `U${id}`, username, points]);
const mskNow = () => { const d = new Date(Date.now() + 3 * 3600 * 1000); return { day: d.getUTCDate(), month: d.getUTCMonth() + 1 }; };

test('guide: a newcomer who started the bot gets it in private once; others get a button', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await known(7);
  const join = (...people) => groupMessage(DISCUSSION, people[0], undefined, { new_chat_members: people });
  await onMessage(join(user(7), user(8)));
  const guide = sentTo(api, 7);
  assert.equal(guide.length, 1);
  assert.match(guide[0], /Гид новичка/);
  assert.match(guide[0], /«Кто Я»/);
  const greet = replies(api).find((c) => c.params.chat_id === DISCUSSION.id);
  const buttons = JSON.stringify(greet.params.reply_markup);
  assert.match(buttons, /start=guide/);
  // Joining again: no second guide; a wave of only known people gets no guide button.
  await db.run("UPDATE settings SET value = '0' WHERE key LIKE 'welcome_at:%'");
  await onMessage(join(user(7)));
  assert.equal(sentTo(api, 7).length, 1);
  const last = replies(api).filter((c) => c.params.chat_id === DISCUSSION.id).at(-1);
  assert.doesNotMatch(JSON.stringify(last.params.reply_markup), /start=guide/);
  // The button opens the guide in private.
  await onMessage(privateMessage(user(8), '/start guide'));
  assert.match(texts(api).at(-1), /Гид новичка/);
});

test('shop gift: paid from the giver\'s balance, the thing is the other one\'s, told in private', async () => {
  const api = await setup();
  await giveXp(2, 400);
  await giveXp(3, 10, 'Friend_3');
  await known(3);
  const data = await handle(user(2), { action: 'gift', item: 'frame_ember', to: '@friend_3' });
  assert.equal(data.result.gift.item, 'Тлеющие угли');
  assert.equal(data.club.shop.balance, 250);
  assert.ok(await club.ownsItem(3, 'frame_ember'));
  assert.match(sentTo(api, 3).at(-1), /дарит тебе «Тлеющие угли» \(рамка\)/);
  // The receiver's balance stays; they can wear it.
  const worn = await handle(user(3, { username: 'Friend_3' }), { action: 'wear', slot: 'frame', item: 'frame_ember' });
  assert.ok(worn.club.shop.items.find((i) => i.id === 'frame_ember').equipped);
  assert.equal((await db.get("SELECT price FROM purchases WHERE user_id = 3 AND item = 'frame_ember'")).price, 0);
  await assert.rejects(handle(user(2), { action: 'gift', item: 'frame_ember', to: 'friend_3' }), /уже есть «Тлеющие угли»/);
  await assert.rejects(handle(user(2), { action: 'gift', item: 'frame_void', to: 'friend_3' }), /Не хватает XP/);
  await assert.rejects(handle(user(2), { action: 'gift', item: 'color_crimson', to: '@user2' }), /Себе подарить нельзя/);
  await assert.rejects(handle(user(2), { action: 'gift', item: 'color_crimson', to: '@nobody_here' }), /Не нашла такого участника/);
  // A failed gift costs nothing.
  const after = await db.get("SELECT COALESCE(SUM(amount), 0) AS s FROM xp_spend WHERE user_id = 2 AND kind = 'shop_gift'");
  assert.equal(after.s, 150);
});

test('quest of choice: three for the member, one picked, its own progress and reward', async () => {
  await setup();
  const ts = nowInt();
  // Never played the casino, never commented: those are not offered.
  const offered = await club.choiceOptions(2, club.weekNo(ts));
  assert.equal(offered.length, 3);
  assert.ok(offered.every((q) => !['casino', 'comments', 'reactions', 'msgs'].includes(q.id)));
  assert.deepEqual((await club.choiceOptions(2, club.weekNo(ts))).map((q) => q.id), offered.map((q) => q.id));
  let data;
  await assert.rejects(handle(user(2), { action: 'pick_quest', id: 'casino' }), /нет среди предложенных/);
  data = await handle(user(2), { action: 'pick_quest', id: 'farm' });
  assert.equal(data.club.choice.picked.id, 'farm');
  assert.equal(data.club.choice.options.length, 0);
  await assert.rejects(handle(user(2), { action: 'pick_quest', id: 'quiz' }), /уже выбран/);
  await assert.rejects(handle(user(2), { action: 'choice_quest' }), /ещё не выполнен/);
  for (let i = 0; i < 15; i++) {
    await db.run("INSERT INTO events (user_id, chat_id, message_id, kind, points, earned_at) VALUES (2, 0, ?, 'farm', 5, ?)", [i + 1, weekStart(ts) + 60 + i]);
  }
  data = await handle(user(2), { action: 'choice_quest' });
  assert.equal(data.result.points, 40);
  assert.equal(data.club.choice.picked.claimed, true);
  await assert.rejects(handle(user(2), { action: 'choice_quest' }), /уже получена/);
});

test('quest of choice: a casino player can be offered the casino quest', async () => {
  await setup();
  await db.run("INSERT INTO xp_spend (user_id, kind, amount, at) VALUES (5, 'casino', 10, 1)");
  let seen = false;
  for (let week = 1; week < 40 && !seen; week++) seen = (await club.choiceOptions(5, week)).some((q) => q.id === 'casino');
  assert.ok(seen);
});

test('birthday: 👑 in the top and the profile, and a reminder to the pair and family the day before', async () => {
  const api = await setup();
  const { day, month } = mskNow();
  // Tomorrow is 4's birthday: the spouse and the child hear about it.
  const tomorrow = new Date(Date.now() + 3 * 3600 * 1000 + DAY * 1000);
  await db.run('INSERT INTO birthdays (user_id, day, month, announce, updated_at) VALUES (4, ?, ?, 1, 1)', [tomorrow.getUTCDate(), tomorrow.getUTCMonth() + 1]);
  await db.run("INSERT INTO profiles (user_id, name) VALUES (4, 'Именинник')");
  await db.run('INSERT INTO marriages (user_id, partner_id, since) VALUES (4, 5, 1), (5, 4, 1)');
  await db.run('INSERT INTO children (parent_id, child_id, since) VALUES (4, 6, 1)');
  for (const id of [5, 6]) await known(id);
  // 11:00 Moscow time.
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  at(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8) / 1000));
  await pump({ force: true });
  assert.match(sentTo(api, 5).at(-1), /Завтра день рождения у Именинник/);
  assert.match(sentTo(api, 6).at(-1), /Завтра день рождения у Именинник/);
  const count = sentTo(api, 5).length;
  await pump({ force: true });
  assert.equal(sentTo(api, 5).length, count);
  Date.now = realNow;
  await giveXp(2, 500);
  await giveXp(3, 300);
  await db.run('INSERT INTO birthdays (user_id, day, month, announce, updated_at) VALUES (2, ?, ?, 1, 1)', [day, month]);
  const top = await xpTopText(false);
  assert.match(top, /👑 U2/);
  assert.doesNotMatch(top, /👑 U3/);
  assert.match(top, /👑 — сегодня день рождения/);
  await onMessage(groupMessage(DISCUSSION, user(2), 'кто я'));
  assert.ok(texts(api).some((t) => /Сегодня день рождения/.test(t)) || api.called('sendPhoto').some((c) => /Сегодня день рождения/.test(c.params.caption)));
  const mine = await handle(user(2), { action: 'wear', slot: 'frame', item: null });
  assert.equal(mine.club.birthday.today, true);
  assert.equal(mine.top.all.find((r) => r.me).bday, true);

});

test('«Штаб» report: activity of the team to the owner on Monday, and on request', async () => {
  const api = await setup();
  await known(OWNER.id);
  await giveXp(2, 10);
  await giveXp(3, 10);
  await db.run("INSERT INTO positions (user_id, code, given_by, given_at) VALUES (2, 'content', 1, 1), (3, 'creative', 1, 1)");
  const monday = weekStart(nowInt()) + 13 * 3600;
  const lastWeek = weekStart(nowInt()) - 7 * DAY;
  const day = Math.floor((lastWeek + 3 * 3600) / DAY) + 1;
  await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, 2, ?, 40), (?, 2, ?, 5)', [DISCUSSION.id, day, DISCUSSION.id, day + 1]);
  at(monday);
  await pump({ force: true });
  const report = sentTo(api, OWNER.id).find((t) => /Штаб за неделю/.test(t));
  assert.ok(report);
  assert.match(report, /1\. 📝 U2 — 45 сообщений, 0 комментариев, 2 дня из 7/);
  assert.match(report, /💤 🎨 U3 — не было активности/);
  await pump({ force: true });
  assert.equal(sentTo(api, OWNER.id).filter((t) => /Штаб за неделю/.test(t)).length, 1);
  await onMessage(privateMessage(OWNER, 'Финя, Отчёт Штаба'));
  assert.match(texts(api).at(-1), /Штаб за неделю/);
});

test('owner panel: a position and an award from the member card', async () => {
  const api = await setup();
  await giveXp(2, 10);
  await known(2);
  let c = await ranks(OWNER, { action: 'user', id: 2 });
  assert.equal(c.positions.length, 8);
  assert.ok(c.positions.every((p) => !p.on));
  c = await ranks(OWNER, { action: 'position', id: 2, code: 'content', on: true });
  assert.ok(c.positions.find((p) => p.code === 'content').on);
  assert.match(sentTo(api, 2).at(-1), /Тебе выдана должность «Контент-менеджер»/);
  c = await ranks(OWNER, { action: 'position', id: 2, code: 'content', on: false });
  assert.ok(!c.positions.find((p) => p.code === 'content').on);
  c = await ranks(OWNER, { action: 'award', id: 2, text: 'Лучший мемодел', degree: 4 });
  assert.equal(c.awards[0].text, 'Лучший мемодел');
  assert.equal(c.awards[0].icon, '🥇');
  assert.match(sentTo(api, 2).at(-1), /награду 4 степени/);
  await assert.rejects(ranks(OWNER, { action: 'award', id: 2, text: '   ', degree: 1 }), /название награды/);
  await assert.rejects(ranks(user(2), { action: 'award', id: 2, text: 'x', degree: 1 }), /только владельцу/);
});
