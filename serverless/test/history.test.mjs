// «Обновить Инфо»: the chat's old history from a Telegram Desktop export.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, EndpointError } from 'sdk';
import historyEndpoint from '../tgcloud/endpoints/history.js';
import { onMessage } from '../tgcloud/lib/bot.js';
import { chatIdOf } from '../tgcloud/lib/history.js';
import { memberCard, mskDay } from '../tgcloud/lib/members.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import {
  apiError, checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, setup, user,
} from './helpers.mjs';

afterEach(checkErrors);

const DAY = 86400;
const call = (input, from = OWNER) => historyEndpoint(input, { initData: { user: from } });
const member = (p) => ({ status: 'member', user: { id: p.user_id, is_bot: false, first_name: `Новый ${p.user_id}`, username: `new${p.user_id}` } });

test('the export names chats without the Bot API minus', async () => {
  await setup();
  assert.equal(chatIdOf(2229986493, 'private_supergroup'), -1002229986493);
  assert.equal(chatIdOf('2229986493', 'public_supergroup'), -1002229986493);
  assert.equal(chatIdOf(4567, 'private_group'), -4567);
  assert.throws(() => chatIdOf(1, 'personal_chat'), /не экспорт группы/);
  assert.throws(() => chatIdOf(0, 'private_supergroup'), /нет ID чата/);
});

test('only the owner loads history; the chat must be one Финя is in', async () => {
  await setup({
    getChat: (p) => {
      if (p.chat_id === DISCUSSION.id) return { ...DISCUSSION };
      throw apiError('getChat', 400, 'Bad Request: chat not found');
    },
  });
  await assert.rejects(call({ action: 'chat', id: 2000000001, type: 'private_supergroup' }, user(2)),
    (err) => err instanceof EndpointError && /только владелец/.test(err.message));
  assert.deepEqual(await call({ action: 'chat', id: 2000000001, type: 'private_supergroup' }),
    { chat: { id: DISCUSSION.id, title: 'Обсуждения' } });
  await assert.rejects(call({ action: 'chat', id: 42, type: 'private_supergroup' }),
    (err) => err instanceof EndpointError && /не состоит в этом чате/.test(err.message));
});

test('import: old days are added, days Финя counted keep the larger count, again adds nothing', async () => {
  const api = await setup({
    getChatMember: (p) => {
      if (p.user_id === 50) return { status: 'administrator', user: { id: 50, is_bot: true, first_name: 'Ирис' } };
      if (p.user_id === 60) throw apiError('getChatMember', 400, 'Bad Request: user not found');
      if (p.user_id === 70) return { status: 'left', user: { id: 70, is_bot: false, first_name: 'Ушёл' } };
      return member(p);
    },
  });
  await setSetting('chat_captcha', false);
  const ts = nowInt();
  const today = mskDay(ts);
  // Финя saw Аня write 3 times today.
  for (let i = 0; i < 3; i++) await onMessage(groupMessage(DISCUSSION, user(2, { first_name: 'Аня' }), `привет ${i}`));
  const aniaFirst = ts - 400 * DAY;
  const users = [
    { id: 2, name: 'Аня', first: aniaFirst, last: ts - 60, days: [[today - 400, 7], [today - 30, 10], [today, 2]] },
    { id: 40, name: 'Боря', first: ts - 10 * DAY, last: ts - 9 * DAY, days: [[today - 10, 4], [today - 9, 1]] },
    { id: 50, name: 'Ирис', first: ts - 5 * DAY, last: ts - 5 * DAY, days: [[today - 5, 100]] },
    { id: 60, name: 'Удалённый', first: ts - 50 * DAY, last: ts - 50 * DAY, days: [[today - 50, 2]] },
    { id: 70, name: 'Ушёл', first: ts - 20 * DAY, last: ts - 20 * DAY, days: [[today - 20, 3]] },
    { id: 777000, name: 'Telegram', first: ts - DAY, last: ts - DAY, days: [[today - 1, 9]] },
  ];
  const r = await call({ action: 'import', chat: DISCUSSION.id, users });
  assert.deepEqual(r, { added: 17 + 5 + 2 + 3, members: 3, skipped: 2 });

  const card = await memberCard(DISCUSSION.id, 2, ts);
  assert.equal(card.total, 20);
  assert.equal(card.day, 3);
  assert.equal(card.since, aniaFirst);
  assert.equal(card.days.get(today - 30), 10);
  const rows = await db.all('SELECT user_id, name, username, status, msgs FROM chat_members WHERE chat_id = ? ORDER BY user_id', [DISCUSSION.id]);
  assert.deepEqual(rows.map((m) => [m.user_id, m.name, m.status, m.msgs]), [
    [2, 'Аня', 'member', 20], [40, 'Новый 40', 'member', 5], [60, 'Удалённый', 'left', 2], [70, 'Ушёл', 'left', 3]]);
  assert.equal(rows[1].username, 'new40');

  // The same file again, or one batch twice: nothing changes.
  assert.deepEqual(await call({ action: 'import', chat: DISCUSSION.id, users }), { added: 0, members: 0, skipped: 2 });
  assert.equal((await memberCard(DISCUSSION.id, 2, ts)).total, 20);

  // The «Кто Я» chart and «весь» use the imported days.
  await onMessage(groupMessage(DISCUSSION, user(2, { first_name: 'Аня' }), 'кто я'));
  // 20 + today's «кто я» itself.
  assert.match(api.called('sendPhoto').at(-1).params.caption, /Актив \(д\|н\|м\|весь\): 4 \| \d+ \| \d+ \| 21/);
});

test('import: broken batches are refused, a Telegram pause asks to retry', async () => {
  await setup({ getChatMember: () => { throw apiError('getChatMember', 429, 'Too Many Requests: retry after 5', { retry_after: 5 }); } });
  const ts = nowInt();
  const bad = [
    { chat: DISCUSSION.id, users: [] },
    { chat: 5, users: [{ id: 1, first: ts, last: ts, days: [] }] },
    { chat: DISCUSSION.id, users: [{ id: 1, first: ts, last: ts - 10, days: [] }] },
    { chat: DISCUSSION.id, users: [{ id: 1, first: ts, last: ts, days: [[mskDay(ts) + 5, 1]] }] },
    { chat: DISCUSSION.id, users: [{ id: 1, first: ts, last: ts, days: [[mskDay(ts), 0]] }] },
    { chat: DISCUSSION.id, users: Array.from({ length: 51 }, (_, i) => ({ id: i + 1, first: ts, last: ts, days: [] })) },
  ];
  for (const input of bad) {
    await assert.rejects(call({ action: 'import', ...input }), (err) => err instanceof EndpointError && err.parameters.code === 'HISTORY');
  }
  await assert.rejects(call({ action: 'import', chat: DISCUSSION.id, users: [{ id: 9, first: ts, last: ts, days: [[mskDay(ts), 1]] }] }),
    (err) => err instanceof EndpointError && err.parameters.code === 'RETRY');
});

test('«обновить инфо»: the owner gets the steps and a button to the upload', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  await onMessage(privateMessage(OWNER, 'Обновить инфо'));
  let sent = api.called('sendMessage').at(-1).params;
  assert.match(sent.text, /Экспорт истории чата/);
  assert.equal(sent.reply_markup.inline_keyboard[0][0].web_app.url, 'https://app8906365781.tgcloud.ai/?tab=admin&open=history');

  await onMessage(groupMessage(DISCUSSION, OWNER, 'Финя, обновить инфо'));
  sent = api.called('sendMessage').at(-1).params;
  assert.equal(sent.reply_markup.inline_keyboard[0][0].url, 'https://t.me/finya_bot?start=history');
  await onMessage(privateMessage(OWNER, '/start history'));
  sent = api.called('sendMessage').at(-1).params;
  assert.match(sent.text, /Обновить инфо/);

  // Anyone else: not a command.
  const before = api.called('sendMessage').length;
  await onMessage(groupMessage(DISCUSSION, user(2), 'обновить инфо'));
  assert.equal(api.called('sendMessage').length, before);
});
