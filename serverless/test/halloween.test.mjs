// Хэллоуин: «Сладость или гадость» once a day, 24–31 October, and the limited badge.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { handle } from '../tgcloud/lib/club_app.js';
import { clubData } from '../tgcloud/lib/club.js';
import * as seasons from '../tgcloud/lib/seasons.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { checkErrors, DISCUSSION, groupMessage, isAnnouncement, replies, setup, user } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

const DAY = 86400;
// 28 October 2026, 15:00 МСК.
const T = Date.UTC(2026, 9, 28, 12, 0, 0) / 1000;
const at = (ts) => { Date.now = () => ts * 1000; };
const say = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));

test('the event runs from 24 October to the end of the 31st, Moscow time', async () => {
  await setup();
  const msk = (d, m, h = 0) => Date.UTC(2026, m - 1, d, h) / 1000 - 3 * 3600;
  assert.equal(seasons.halloween(msk(23, 10, 23)), null);
  assert.equal(seasons.halloween(msk(24, 10)).year, 2026);
  assert.ok(seasons.halloween(msk(31, 10, 23)));
  assert.equal(seasons.halloween(msk(1, 11)), null);
  assert.equal(seasons.nextHalloween(msk(1, 11)), msk(24, 10) + 365 * DAY);
  assert.equal(seasons.halloween(msk(31, 10)).ends, msk(1, 11));
});

test('rolls: a golden pumpkin, a treat with XP or a trick without it', async () => {
  await setup();
  assert.deepEqual(seasons.roll(() => 0.01).kind, 'golden');
  const treat = seasons.roll(() => 0.5);
  assert.equal(treat.kind, 'treat');
  assert.ok(treat.points >= 13 && treat.points <= 66);
  const trick = seasons.roll(() => 0.9);
  assert.equal(trick.kind, 'trick');
  assert.equal(trick.points, 0);
  assert.match(seasons.pumpkinText(0, 20389, 2), /Гадость!/u);
  assert.match(seasons.pumpkinText(40, 20389, 2), /Сладость!/u);
  assert.match(seasons.pumpkinText(131, 20389, 2), /Золотая тыква/u);
  assert.equal(seasons.pumpkinText(40, 20389, 2), seasons.pumpkinText(40, 20389, 2));
});

test('«Сладость или гадость» in the chat: once a day, 3 days open «Хэллоуин 2026»', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  at(T);
  await say(a, 'Сладость или гадость!');
  let text = replies(api).at(-1).params.text;
  assert.match(text, /(Сладость|Гадость|Золотая тыква)/);
  assert.match(text, /Тыквенная охота: 1 из 3\. Ещё 2 дня, и ачивка «Хэллоуин 2026» твоя/);
  const first = await db.get("SELECT points FROM events WHERE user_id = 2 AND kind = 'season'");
  assert.ok(first);

  // Again the same day: the same result, no second roll.
  await say(a, 'кошелёк или жизнь');
  text = replies(api).at(-1).params.text;
  assert.match(text, /Тыква на сегодня уже открыта/);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM events WHERE user_id = 2 AND kind = 'season'")).c, 1);

  at(T + DAY);
  await say(a, 'Хэллоуин');
  at(T + 2 * DAY);
  await say(a, 'сладость или гадость');
  text = replies(api).filter((c) => /Тыквенная охота/.test(c.params.text)).at(-1).params.text;
  assert.match(text, /Тыквенная охота: 3 из 3 · ачивка «Хэллоуин 2026» открыта/);
  const post = api.called('sendMessage').filter(isAnnouncement).at(-1);
  assert.match(post.params.text, /«Хэллоуин 2026»/);
  assert.equal(await seasons.playedDays(2, 2026), 3);
});

test('after 31 October: no roll, the next date instead; the badge stays limited', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  at(Date.UTC(2026, 10, 2, 12) / 1000);
  await say(user(2), 'сладость или гадость');
  assert.match(replies(api).at(-1).params.text, /идёт с 24 по 31 октября\. Следующий через 356 дней/);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM events WHERE kind = 'season'")).c, 0);
  const data = await clubData(user(2), { xpTotal: 0, streakDays: 0, founder: false });
  const badge = data.achievements.find((x) => x.code === 'halloween_2026');
  assert.equal(badge.until, Date.UTC(2026, 10, 1) / 1000 - 3 * 3600);
  assert.equal(badge.at, null);
});

test('the Mini App button rolls the same daily pumpkin and shows the event', async () => {
  await setup();
  at(T);
  const data = await handle(user(5, { first_name: 'Вика' }), { action: 'trick' });
  assert.ok(data.result.text);
  assert.equal(data.result.again, false);
  assert.equal(data.season.halloween.days, 1);
  assert.equal(data.season.halloween.goal, 3);
  assert.equal(data.season.halloween.today.text, data.result.text);
  const again = await handle(user(5, { first_name: 'Вика' }), { action: 'trick' });
  assert.equal(again.result.again, true);
  assert.equal(again.result.text, data.result.text);

  at(Date.UTC(2026, 10, 5) / 1000);
  await assert.rejects(handle(user(5), { action: 'trick' }), /с 24 по 31 октября/);
  const later = await handle(user(5), { action: 'ref' }).catch(() => null);
  if (later) assert.equal(later.season.halloween, null);
});
