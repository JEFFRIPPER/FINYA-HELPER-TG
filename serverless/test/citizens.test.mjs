// Citizenship like Iris: «+Гражданство» makes the chat home, one at a time.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { checkErrors, DISCUSSION, FAMILY, groupMessage, OWNER, privateMessage, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const last = (api) => replies(api).at(-1).params.text;

test('«+гражданство»: one home, shown in the anketa, «кто я», the stats and «кто граждане»', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await onMessage(groupMessage(FAMILY, OWNER, '/posts_on'));
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  const ts = nowInt();
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, 2, 'Аня', '', 'member', ?, ?, 10)`, [DISCUSSION.id, ts - 800 * 86400, ts]);
  const inDiscussion = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));

  await inDiscussion(a, '+Гражданство');
  assert.match(last(api), /Аня.* теперь гражданин чата «Обсуждения», здесь с [\d.]+ \(2 года 2 мес\)/);
  await inDiscussion(a, '+гражданство');
  assert.match(last(api), /и так гражданин этого чата/);
  await inDiscussion(b, 'привет');
  await inDiscussion(b, '+гражданство');

  await inDiscussion(a, 'кто граждане');
  assert.match(last(api), /🏡 Граждане чата «Обсуждения»: 2\n\n1\. Аня — 2 года 2 мес\n2\. Боря — с сегодня/);
  await inDiscussion(a, 'стата');
  assert.match(last(api), /🏡 Аня — /);
  await inDiscussion(a, 'кто я');
  assert.match(api.called('sendPhoto').at(-1).params.caption, /🏡 Гражданин этого чата · 2 года 2 мес/);
  await inDiscussion(a, 'моя анкета');
  assert.match(api.called('sendPhoto').at(-1).params.caption, /🏡 Гражданин чата «Чат» 2 года 2 мес \(с [\d.]+\)/);

  // A new home replaces the old one.
  await onMessage(groupMessage(FAMILY, a, '+гражданство'));
  assert.match(last(api), /теперь гражданин чата «Squad Family»[\s\S]*Прежнее гражданство «Чат» снято/);
  await inDiscussion(b, 'кто граждане');
  assert.match(last(api), /: 1\n\n1\. Боря/);
  await onMessage(groupMessage(FAMILY, b, 'кто я', { reply_to_message: groupMessage(FAMILY, a, 'х') }));

  await onMessage(privateMessage(a, '+гражданство'));
  assert.match(last(api), /Гражданство берут в чате/);
  await onMessage(privateMessage(a, '-гражданство'));
  assert.match(last(api), /Гражданство снято/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM citizens WHERE user_id = 2')).c, 0);
});

test('the start date of a pair: free, once a month, the days count from it', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
  await say(b, 'привет');
  await say(a, 'начало отношений 01.05.2024');
  assert.match(last(api), /Ты ни с кем не встречаешься/);
  await say(a, 'встречаться', { reply_to_message: groupMessage(DISCUSSION, b, 'х') });
  await onMessage(groupMessage(DISCUSSION, b, 'ок'));
  const { onCallbackQuery } = await import('../tgcloud/lib/bot.js');
  const { callback } = await import('./helpers.mjs');
  await onCallbackQuery(callback(b, 'date:y:2:3', { chat: DISCUSSION, message_id: 5000 }));
  await say(a, 'начало отношений 31.02.2024');
  assert.match(last(api), /Напиши дату так/);
  await say(a, 'начало отношений 01.01.2999');
  assert.match(last(api), /ещё не наступила/);
  await say(a, 'Начало отношений 01.05.2024');
  assert.match(last(api), /Отношения с Боря теперь считаются с 01\.05\.2024: \d+ дн/);
  const row = await db.get('SELECT since FROM dating WHERE user_id = 3');
  assert.equal(row.since, Date.UTC(2024, 4, 1) / 1000 - 3 * 3600);
  // The partner is the same pair: the month counts for both.
  await say(b, 'начало отношений 02.05.2024');
  assert.match(last(api), /раз в месяц\. Следующий раз: /);

  // Marriage keeps its own date and its own month.
  await say(b, 'брак', { reply_to_message: groupMessage(DISCUSSION, a, 'х') });
  await onCallbackQuery(callback(a, 'marry:y:3:2', { chat: DISCUSSION, message_id: 5001 }));
  await say(b, 'начало брака 10.10.2025');
  assert.match(last(api), /Брак с Аня теперь считается с 10\.10\.2025/);
  await say(a, 'мой брак');
  assert.match(last(api), /в браке с Боря уже \d+ дн/);
});
