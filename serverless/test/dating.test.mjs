// «Встречаться» before marriage, «Чат инфо» and the chart themes from the shop.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import { THEMES } from '../tgcloud/lib/chart.js';
import * as club from '../tgcloud/lib/club.js';
import { mskDay } from '../tgcloud/lib/members.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { callback, checkErrors, DISCUSSION, groupMessage, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const groupButton = (from, data) => callback(from, data, { chat: DISCUSSION, message_id: 5000 });
const last = (api) => replies(api).at(-1).params.text;
const edited = (api) => api.called('editMessageText').at(-1).params.text;
const pairs = async (table) => (await db.get(`SELECT COUNT(*) AS c FROM ${table}`)).c;

test('dating: offer, only the other one accepts, it lasts until «Расстаться»', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(1, { first_name: 'Аня' });
  const b = user(2, { first_name: 'Боря' });
  const c = user(3, { first_name: 'Вика' });
  await say(a, 'встречаться', replyTo(b));
  const offer = replies(api).at(-1).params;
  assert.match(offer.text, /→ .*Боря.*: предложение встречаться/);
  const yes = offer.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(yes, 'date:y:1:2');
  await onCallbackQuery(groupButton(a, yes));
  await onCallbackQuery(groupButton(c, yes));
  assert.equal(await pairs('dating'), 0);
  await onCallbackQuery(groupButton(b, yes));
  assert.match(edited(api), /теперь встречаются/);
  assert.equal(await pairs('dating'), 2);

  // Rivals are turned away; a month later it is still on.
  await say(c, 'встречаться', replyTo(a));
  assert.match(last(api), /уже встречается с другим/);
  await say(c, 'брак', replyTo(b));
  assert.match(last(api), /встречается с другим/);
  await db.run('UPDATE dating SET since = since - 40 * 86400');
  await say(a, 'мои отношения');
  assert.match(last(api), /Ты встречаешься с Боря уже 40 дней/);
  await say(c, 'отношения', replyTo(b));
  assert.match(last(api), /Боря встречается с Аня/);
  await say(c, 'кто встречается');
  assert.match(last(api), /Аня \+ Боря — 40 дней/);
  await say(a, 'кто я');
  assert.match(api.called('sendPhoto').at(-1).params.caption, /💞 Отношения: Боря · 40 дней/);

  // Only the one who asked confirms the break-up; then both are free.
  await say(b, 'расстаться');
  const part = replies(api).at(-1).params.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(part, 'part:y:2:1');
  await onCallbackQuery(groupButton(a, part));
  assert.equal(await pairs('dating'), 2);
  await onCallbackQuery(groupButton(b, part));
  assert.match(edited(api), /больше не встречаются/);
  assert.equal(await pairs('dating'), 0);
});

test('dating grows into marriage', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(1, { first_name: 'Аня' });
  const b = user(2, { first_name: 'Боря' });
  await say(a, 'встречаться', replyTo(b));
  await onCallbackQuery(groupButton(b, 'date:y:1:2'));
  await say(b, 'брак', replyTo(a));
  assert.match(last(api), /предложение руки и сердца/);
  await onCallbackQuery(groupButton(a, 'marry:y:2:1'));
  assert.equal(await pairs('spouses'), 2);
  assert.equal(await pairs('dating'), 0);
  await say(a, 'встречаться', replyTo(b));
  assert.match(last(api), /Ты уже в браке/);
});

test('«чат инфо»: the chat card with its chart', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const today = mskDay(nowInt());
  for (const [id, msgs] of [[1, 500], [2, 300], [3, 10]]) {
    await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
      VALUES (?, ?, ?, '', 'member', ?, ?, ?)`, [DISCUSSION.id, id, `U${id}`, nowInt() - 400 * 86400, nowInt(), msgs]);
  }
  await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, 1, ?, 250), (?, 2, ?, 70)',
    [DISCUSSION.id, today - 10, DISCUSSION.id, today - 10]);
  await say(user(1), 'Чат инфо');
  const caption = api.called('sendPhoto').at(-1).params.caption;
  assert.match(caption, /🏙 Чат «Обсуждения»/);
  assert.match(caption, /👥 Население: 3/);
  assert.match(caption, /🏆 Рекордный день: 320 сообщений/);
  assert.match(caption, /👑 Самые активные за всё время:\n🥇 U1 — 501 сообщение/);
  assert.match(caption, /💬 Сообщения \(д\|н\|м\|всего\): 1 \| \d+ \| \d+ \| 811/);
});

test('chart themes: bought in the shop, worn with «тема графика»', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(5, { first_name: 'Ира' });
  await say(a, 'тема графика неон');
  assert.match(last(api), /🔒 «Неоновый график» стоит 350 XP/);
  await db.run("INSERT INTO profiles (user_id, name, username, xp) VALUES (5, 'Ира', '', 1000) ON CONFLICT(user_id) DO UPDATE SET xp = 1000");
  await club.buy(a, 'chart_neon');
  assert.equal(await club.chartTheme(5), 'chart_neon');
  await say(a, 'тема графика алая');
  assert.equal(await club.chartTheme(5), null);
  await say(a, 'тема графика неон');
  assert.match(last(api), /Надела: Неоновый график/);
  await say(a, 'тема графика');
  assert.match(last(api), /✅ Неоновый — куплена/);
  // The chart is drawn in the theme's colours.
  await say(a, 'кто я');
  const hex = Buffer.from(api.called('sendPhoto').at(-1).params.photo.bytes).toString('hex');
  const neon = THEMES.chart_neon[3].map((v) => v.toString(16).padStart(2, '0')).join('');
  assert.ok(hex.includes(neon));
});
