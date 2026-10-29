// «Огонёк пары»: a couple that replies to each other every day keeps a flame.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { profileExtras } from '../tgcloud/lib/chat.js';
import * as fire from '../tgcloud/lib/fire.js';
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
const a = user(2, { first_name: 'Аня' });
const b = user(3, { first_name: 'Боря' });
const c = user(4, { first_name: 'Вика' });

const msg = (from, text, to) => groupMessage(DISCUSSION, from, text,
  to ? { reply_to_message: { message_id: 1, date: 0, chat: DISCUSSION, from: to, text: '…' } } : {});
const say = (from, text, to) => onMessage(msg(from, text, to));
const fires = (api) => api.called('sendMessage').filter((x) => /огон[её]к пары/iu.test(x.params.text));

async function married(x, y, since = T - 30 * DAY) {
  await db.run('INSERT INTO marriages (user_id, partner_id, since) VALUES (?, ?, ?), (?, ?, ?)', [x.id, y.id, since, y.id, x.id, since]);
}

// Both reply to each other on the day `ts` falls on.
async function both(ts) {
  at(ts);
  await say(a, 'привет', b);
  await say(b, 'привет!', a);
}

test('the flame burns once both have replied today; it grows day by day and goes out after a gap', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await married(a, b);
  at(T);
  await say(a, 'доброе утро', b);
  assert.equal(fires(api).length, 0, 'one side is not enough');
  let f = await fire.fireOf(a.id, T);
  assert.deepEqual([f.days, f.today, f.mine, f.theirs], [0, false, true, false]);
  assert.match(fire.fireLine(f), /не горит: ждёт ответа второй половинки/);
  assert.match(fire.fireLine(await fire.fireOf(b.id, T)), /не горит: ждёт твоего ответа/);

  await say(b, 'и тебе', a);
  assert.equal(fires(api).length, 1);
  assert.match(fires(api)[0].params.text, /Боря.*и.*Аня.*зажигают огонёк пары/);
  assert.ok(isAnnouncement(fires(api)[0]), 'skipped like the badge announcements');
  // A second exchange the same day changes nothing.
  await both(T + 3600);
  assert.equal((await fire.fireOf(a.id, T + 3600)).days, 1);
  assert.equal(fires(api).length, 1);

  await both(T + DAY);
  await both(T + 2 * DAY);
  f = await fire.fireOf(a.id, T + 2 * DAY);
  assert.deepEqual([f.days, f.best, f.today], [3, 3, true]);
  assert.match(fires(api).at(-1).params.text, /горит уже 3 дня подряд/);
  // Day 4 burns quietly.
  await both(T + 3 * DAY);
  assert.equal(fires(api).length, 2);

  // Yesterday counts until midnight; a whole day missed and it is out.
  assert.equal((await fire.fireOf(a.id, T + 4 * DAY)).days, 4);
  assert.match(fire.fireLine(await fire.fireOf(a.id, T + 4 * DAY)), /4 дня подряд · сегодня ещё не горит, ответьте друг другу до полуночи/);
  assert.equal((await fire.fireOf(a.id, T + 5 * DAY)).days, 0);
  await both(T + 5 * DAY);
  f = await fire.fireOf(a.id, T + 5 * DAY);
  assert.deepEqual([f.days, f.best], [1, 4]);
});

test('only the pair counts: a reply to someone else lights nothing', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await married(a, b);
  at(T);
  await say(a, 'привет', c);
  await say(c, 'привет', a);
  await say(a, 'сама себе', a);
  assert.equal(fires(api).length, 0);
  assert.equal(await fire.touch(c.id, a.id, T), null);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM pair_fire')).n, 0);
});

test('dating counts too; an RP command in reply lights it as well', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await db.run('INSERT INTO dating (user_id, partner_id, since) VALUES (2, 3, ?), (3, 2, ?)', [T - DAY, T - DAY]);
  at(T);
  await say(a, 'обнять', b);
  await say(b, 'поцеловать', a);
  assert.equal(fires(api).length, 1);
  assert.equal((await fire.fireOf(b.id, T)).days, 1);
});

test('7 days in a row open «Огонёк любви» for both of them', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await married(a, b);
  for (let d = 0; d < 7; d++) await both(T + d * DAY);
  for (const id of [a.id, b.id]) {
    assert.ok(await db.get("SELECT 1 FROM achievements WHERE user_id = ? AND code = 'fire_7'", [id]), `badge for ${id}`);
  }
  assert.ok(!(await db.get("SELECT 1 FROM achievements WHERE code = 'fire_30'")));
  assert.ok(api.called('sendMessage').some((x) => /открывает ачивк[\s\S]*«Огонёк любви»/.test(x.params.text)));
});

test('«Огонёк», «Мой Брак», «Кто Я» and the Mini App show the flame', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await married(a, b);
  await both(T);
  await both(T + DAY);
  at(T + DAY + 60);
  await say(a, 'огонёк');
  assert.match(replies(api).at(-1).params.text, /🔥 Огонёк пары: 2 дня подряд\nПара: Боря/);
  await say(a, 'мой брак');
  assert.match(replies(api).at(-1).params.text, /🔥 Огонёк пары: 2 дня подряд/);
  await say(a, 'кто я');
  const card = api.calls.filter((x) => ['sendPhoto', 'sendMessage'].includes(x.method)).at(-1).params;
  assert.match(card.caption || card.text, /💍 Брак: Боря · 31 день · 🔥 2/);
  const extras = await profileExtras(a.id);
  assert.deepEqual(extras.marriage.fire, { days: 2, today: true, best: 2 });
  assert.equal(extras.marriage.dating, false);

  // Without a pair: how it works.
  await say(c, 'огонёк');
  assert.match(replies(api).at(-1).params.text, /горит у тех, кто встречается или в браке/);
  assert.equal((await profileExtras(c.id)).marriage, null);
});
