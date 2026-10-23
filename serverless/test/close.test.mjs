// «✖️ Закрыть» under Финя's group answers; the rest goes away after a day.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { GROUP_REPLY_TTL, onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import { BOT, callback, checkErrors, DISCUSSION, groupMessage, OWNER, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const closeOf = (params) => params.reply_markup.inline_keyboard.flat().find((b) => b.text === '✖️ Закрыть');
const press = (from, sent, command) => onCallbackQuery(callback(from, closeOf(sent.params).callback_data, {
  chat: DISCUSSION, message_id: 9000, reply_markup: sent.params.reply_markup, reply_to_message: command,
}));

test('answers in a group live a day', async () => {
  await setup();
  assert.equal(GROUP_REPLY_TTL, 24 * 3600);
});

const membersOnly = {
  getChatMember: (p) => ({ status: 'member', user: { id: p.user_id, is_bot: p.user_id === BOT.id } }),
};

test('only the caller or an admin closes an answer; the command goes too', async () => {
  const api = await setup(membersOnly);
  const command = groupMessage(DISCUSSION, user(4), 'финя, команды');
  await onMessage(command);
  const sent = api.called('sendMessage').at(-1);
  assert.equal(closeOf(sent.params).callback_data, 'close:4');

  await press(user(5), sent, command);
  assert.equal(api.called('deleteMessage').length, 0);
  assert.match(api.called('answerCallbackQuery').at(-1).params.text, /Закрыть может/);

  await press(user(4), sent, command);
  assert.deepEqual(api.called('deleteMessage').map((c) => c.params.message_id).sort(), [command.message_id, 9000].sort());
  const left = await db.all(`SELECT message_id FROM autodelete WHERE message_id IN (${command.message_id}, 9000)`);
  assert.equal(left.length, 0);
});

test('the owner closes someone else\'s answer together with the command', async () => {
  const api = await setup(membersOnly);
  const command = groupMessage(DISCUSSION, user(6), 'финя, команды');
  await onMessage(command);
  await press(OWNER, api.called('sendMessage').at(-1), command);
  assert.deepEqual(api.called('deleteMessage').map((c) => c.params.message_id), [9000, command.message_id]);
});

test('switching a panel keeps «✖️ Закрыть»', async () => {
  const api = await setup();
  await onMessage(groupMessage(DISCUSSION, user(7), 'финя, команды'));
  const sent = api.called('sendMessage').at(-1);
  await onCallbackQuery(callback(user(7), 'help:profile:0', { chat: DISCUSSION, message_id: 9001, reply_markup: sent.params.reply_markup }));
  const shown = api.called('editMessageText').at(-1).params;
  assert.equal(closeOf(shown).callback_data, 'close:7');

  await onMessage(groupMessage(DISCUSSION, user(7), '/rank'));
  const rank = api.called('sendMessage').at(-1);
  await onCallbackQuery(callback(user(7), 'xp:top', { chat: DISCUSSION, message_id: 9002, reply_markup: rank.params.reply_markup }));
  const top = api.called('editMessageText').at(-1).params;
  assert.equal(closeOf(top).callback_data, 'close:7');
});
