import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import * as jobs from '../tgcloud/lib/jobs.js';
import { apiError, callback, checkErrors, lastText, OWNER, privateMessage, setup, user } from './helpers.mjs';

afterEach(checkErrors);

test('broadcast needs confirmation, then reaches everyone and reports', async () => {
  const mock = await setup({
    sendMessage: async (p) => {
      if (p.chat_id === 102) throw apiError('sendMessage', 400, 'Bad Request: chat not found');
      return { message_id: 1 };
    },
  });
  for (const id of [101, 102, 103]) await onMessage(privateMessage(user(id), '/start'));
  await onCallbackQuery(callback(OWNER, 'admin:broadcast'));
  await onMessage(privateMessage(OWNER, 'Всем привет <3'));
  assert.match(lastText(mock), /Подтверди рассылку[\s\S]*Получателей: 4/);
  assert.equal(mock.called('sendMessage').filter((c) => c.params.chat_id === 101).length, 0);
  mock.calls = [];
  await onCallbackQuery(callback(OWNER, 'admin:broadcast_send'));
  const recipients = mock.called('sendMessage').filter((c) => /привет/.test(c.params.text)).map((c) => c.params.chat_id);
  assert.deepEqual(recipients.sort(), [101, 102, 103, OWNER.id].sort());
  assert.match(mock.called('sendMessage').at(-1).params.text, /Рассылка завершена.\nДоставлено: 3\nОшибок: 1/);
  assert.equal((await db.get('SELECT blocked FROM users WHERE user_id = 102')).blocked, 1);
  // The text is escaped.
  assert.ok(recipients.length && mock.calls.some((c) => c.params.text === '<b>Всем привет &lt;3</b>'));
});

test('a slice that runs out of time resumes where it stopped', async () => {
  const mock = await setup();
  for (let id = 201; id <= 205; id++) await onMessage(privateMessage(user(id), '/start'));
  const jobId = await jobs.createBroadcast('Привет', OWNER.id);
  // Zero budget: claim and stop before sending anything.
  assert.equal(await jobs.runJob(jobId, 0), false);
  assert.equal((await db.get('SELECT cursor, lease_until FROM jobs')).lease_until, 0);
  assert.equal(await jobs.runJob(jobId), true);
  const sent = mock.called('sendMessage').filter((c) => c.params.text === '<b>Привет</b>').map((c) => c.params.chat_id);
  assert.deepEqual(sent, [201, 202, 203, 204, 205]);
});

test('stale confirmation is refused', async () => {
  const mock = await setup();
  await onCallbackQuery(callback(OWNER, 'admin:broadcast_send'));
  assert.match(lastText(mock), /Подтверждение устарело/);
});
