// «Витрина»: three favourite achievements in the Mini App header and in «Кто Я».
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { handle } from '../tgcloud/lib/club_app.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { checkErrors, DISCUSSION, groupMessage, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const open = (id, code) => db.run('INSERT INTO achievements (user_id, code, unlocked_at) VALUES (?, ?, ?)', [id, code, 1]);
const lastCaption = (api) => {
  const sent = [...api.called('sendPhoto'), ...api.called('sendMessage')];
  const c = sent.at(-1).params;
  return c.caption || c.text;
};

test('the showcase takes up to three opened achievements, in the chosen order', async () => {
  await setup();
  const a = user(2, { first_name: 'Аня' });
  for (const code of ['first_comment', 'msgs_10', 'dark_secret', 'days_3']) await open(2, code);

  let data = await handle(a, { action: 'showcase', codes: ['dark_secret', 'msgs_10'] });
  assert.deepEqual(data.club.showcase.map((x) => x.code), ['dark_secret', 'msgs_10']);
  assert.deepEqual(data.me.showcase.map((x) => x.title), ['СЕКРЕТ ТЬМЫ', 'Первые шаги']);
  assert.equal(data.me.showcase[0].secret, true);

  await assert.rejects(handle(a, { action: 'showcase', codes: ['first_comment', 'msgs_10', 'dark_secret', 'days_3'] }), /до 3 ачивок/);
  await assert.rejects(handle(a, { action: 'showcase', codes: ['msgs_100'] }), /только открытые/);
  await assert.rejects(handle(a, { action: 'showcase', codes: ['msgs_10', 'msgs_10'] }), /не должны повторяться/);
  await assert.rejects(handle(a, { action: 'showcase', codes: ['nope'] }), /Такой ачивки нет/);
  await assert.rejects(handle(a, { action: 'showcase', codes: 'msgs_10' }), /Выбери ачивки/);

  data = await handle(a, { action: 'showcase', codes: [] });
  assert.deepEqual(data.me.showcase, []);
  assert.ok(!(await db.get('SELECT 1 FROM showcase WHERE user_id = 2')));
});

test('«Кто Я» shows the showcase; a badge taken away drops out of it', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await open(2, 'first_comment');
  await open(2, 'msgs_10');
  await handle(a, { action: 'showcase', codes: ['msgs_10', 'first_comment'] });

  await onMessage(groupMessage(DISCUSSION, a, 'кто я'));
  assert.match(lastCaption(api), /🎖 Витрина: «Первые шаги» · «Первое слово»/);

  await db.run("DELETE FROM achievements WHERE user_id = 2 AND code = 'msgs_10'");
  await onMessage(groupMessage(DISCUSSION, a, 'кто я'));
  assert.match(lastCaption(api), /🎖 Витрина: «Первое слово»\n/);

  // Nothing picked: no line at all.
  await onMessage(groupMessage(DISCUSSION, user(3, { first_name: 'Боря' }), 'кто я'));
  assert.doesNotMatch(lastCaption(api), /Витрина/);
});
