// «Моя Статья», «Ближайшие ДР», «Возраст Аккаунта», «-» в репутацию, прощание, «Финя, когда».
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onChatMember, onMessage } from '../tgcloud/lib/bot.js';
import { accountSince, articleText, daysUntil } from '../tgcloud/lib/extras.js';
import { mskDay } from '../tgcloud/lib/members.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { checkErrors, DISCUSSION, groupMessage, privateMessage, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const last = (api) => replies(api).at(-1).params.text;

test('the article of the day follows what the member does and stays the same all day', async () => {
  await setup();
  const ts = nowInt();
  const who = { id: 2, name: 'Аня' };
  await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, 2, ?, 400)', [DISCUSSION.id, mskDay(ts)]);
  const first = await articleText(who, ts);
  assert.equal(await articleText(who, ts), first);
  assert.match(first, /⚖️ Статья дня/);
  assert.match(first, /УК Сквада/);
  assert.match(first, /Приговор: /);
  // 85% of days it is the flood one; over a few days it has to show up.
  const days = await Promise.all([0, 1, 2, 3, 4, 5].map((d) => articleText(who, ts + d * 86400)));
  assert.ok(days.some((t) => /400 сообщений за/.test(t)));
});

test('upcoming birthdays: next 30 days, today first, and 29.02 in other years', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const ts = nowInt();
  const now = new Date((ts + 3 * 3600) * 1000);
  const soon = new Date((ts + 3 * 3600 + 5 * 86400) * 1000);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await say(a, 'привет');
  await say(b, 'привет');
  await db.run('INSERT INTO birthdays (user_id, day, month, announce, updated_at) VALUES (2, ?, ?, 1, 0), (3, ?, ?, 1, 0)',
    [soon.getUTCDate(), soon.getUTCMonth() + 1, now.getUTCDate(), now.getUTCMonth() + 1]);
  await say(a, 'Ближайшие ДР');
  assert.match(last(api), /🎂 Ближайшие дни рождения в этом чате/);
  assert.match(last(api), /Боря · 🎉 сегодня\n.*Аня · через 5 дней/);
  assert.equal(daysUntil(now.getUTCDate(), now.getUTCMonth() + 1, ts), 0);
  assert.ok(daysUntil(29, 2, ts) <= 366);
});

test('account age: grows with the ID, never in the future, shown in «Кто Я» and by command', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const ts = nowInt();
  assert.ok(accountSince(100e6, ts) < accountSince(800e6, ts));
  assert.ok(accountSince(7e9, ts) < accountSince(8e9, ts));
  assert.ok(accountSince(99e9, ts) <= ts);
  const a = user(400000000, { first_name: 'Аня' });
  await onMessage(privateMessage(a, 'Возраст аккаунта'));
  assert.match(last(api), /В Telegram примерно с [а-я]+ 2017/);
  await onMessage(privateMessage(a, 'Кто я'));
  assert.match(last(api), /📅 В Telegram: примерно с [а-я]+ 2017/);
});

test('«-» in reply takes one reputation point; the giver gives no plus for it', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await say(a, '-', replyTo(b));
  assert.match(last(api), /💔 .*Аня.* ➜ .*Боря.*\nРепутация −1, теперь -1/);
  await say(a, '+', replyTo(b));
  assert.match(last(api), /Репутация \+1, теперь 0/);
  assert.equal((await db.get('SELECT given FROM reputation WHERE user_id = 2')).given, 1);
  await say(a, '-', replyTo(a));
  assert.match(last(api), /теперь 0/);
});

test('farewell for those who leave on their own, not for bans or skipped captchas; can be switched off', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await say(a, 'привет');
  const leave = (old, status) => onChatMember({
    chat: DISCUSSION, from: a, date: nowInt(),
    old_chat_member: { status: old, user: a }, new_chat_member: { status, user: a },
  });
  const before = replies(api).length;
  await leave('member', 'kicked');
  await leave('restricted', 'left');
  assert.equal(replies(api).length, before);
  await leave('member', 'left');
  assert.match(last(api), /👋 .*Аня.* покидает чат/);
  await setSetting('chat_farewell', false);
  await leave('member', 'left');
  assert.equal(replies(api).length, before + 1);
});

test('«Финя, когда…» answers with a date or a phrase', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await say(user(2), 'Финя, когда будет стрим?');
  assert.match(last(api), /^(?:<b>)?🔮 Когда будет стрим\? /);
});
