// The compact menu: one live message in private chats, self-cleaning replies in groups.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { GROUP_REPLY_TTL, onCallbackQuery, onMessage, pump } from '../tgcloud/lib/bot.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { callback, checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, setup, user } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

const buttons = (params) => params.reply_markup.inline_keyboard.flat();

test('/start in private replaces the previous menu and removes the command', async () => {
  const api = await setup();
  const first = privateMessage(user(1), '/start');
  await onMessage(first);
  const menu = api.called('sendPhoto')[0];
  assert.deepEqual(api.called('deleteMessage').map((c) => c.params.message_id), [first.message_id]);
  const second = privateMessage(user(1), '/start');
  await onMessage(second);
  const deleted = api.called('deleteMessage').map((c) => c.params.message_id);
  assert.equal(deleted.length, 3);
  assert.ok(deleted.includes(second.message_id));
  assert.equal(menu.params.chat_id, 1);
});

test('feedback text is not deleted, only commands are', async () => {
  const api = await setup();
  await onCallbackQuery(callback(user(2), 'feedback'));
  await onMessage(privateMessage(user(2), 'Идея для Сквада'));
  assert.equal(api.called('deleteMessage').length, 0);
});

test('squad screen: all links in the Mini App, shop and rules stay', async () => {
  const api = await setup();
  await onCallbackQuery(callback(user(3), 'squad'));
  const list = buttons(api.called('editMessageText')[0].params);
  assert.equal(list.length, 4);
  assert.equal(list[0].web_app.url, 'https://app8906365781.tgcloud.ai/?tab=squad');
  // A group can't open a Mini App: the button leads to the bot instead.
  await onCallbackQuery(callback(user(3), 'squad', { chat: DISCUSSION }));
  const inGroup = buttons(api.called('editMessageText')[1].params);
  assert.match(inGroup[0].url, /\?start=squad$/);
  await onMessage(privateMessage(user(3), '/start squad'));
  assert.match(api.called('sendMessage').at(-1).params.text, /ВОЗВРАТА НЕТ/);
});

test('/rank in a group: one profile button, both messages deleted later', async () => {
  const api = await setup();
  const command = groupMessage(DISCUSSION, user(4), '/rank');
  await onMessage(command);
  const sent = api.called('sendMessage')[0];
  assert.deepEqual(buttons(sent.params).map((b) => b.text).slice(1), ['✖️ Закрыть']);
  const queued = (await db.all('SELECT message_id FROM autodelete ORDER BY message_id')).map((r) => r.message_id);
  assert.equal(queued.length, 2);
  assert.ok(queued.includes(command.message_id));
  await pump({ force: true });
  assert.equal(api.called('deleteMessage').length, 0);
  const later = nowInt() + GROUP_REPLY_TTL + 1;
  Date.now = () => later * 1000;
  await pump({ force: true });
  assert.deepEqual(api.called('deleteMessage').map((c) => c.params.message_id).sort((a, b) => a - b), queued);
  assert.equal((await db.all('SELECT * FROM autodelete')).length, 0);
});

test('owner panel: four folders, each opens its own buttons', async () => {
  const api = await setup();
  await onMessage(privateMessage(OWNER, '/admin'));
  const top = buttons(api.called('sendMessage')[0].params);
  assert.deepEqual(top.map((b) => b.text), ['Рассылки', 'Участники', 'Товары SQUAD SHOP', 'Сервис', 'Панель в Mini App']);
  await onCallbackQuery(callback(OWNER, 'admin:sec:people'));
  const people = buttons(api.called('editMessageText').at(-1).params).map((b) => b.callback_data);
  assert.deepEqual(people, ['admin:stats', 'admin:xp', 'admin:feedback', 'admin:blacklist', 'admin:menu']);
  await onCallbackQuery(callback(OWNER, 'admin:stats'));
  // The answer keeps the folder's buttons, so the owner stays in «Участники».
  assert.ok(buttons(api.called('editMessageText').at(-1).params).some((b) => b.callback_data === 'admin:blacklist'));
});

test('the «/» menu is set once: three commands, the owner gets two more', async () => {
  const api = await setup();
  await pump({ force: true });
  await pump({ force: true });
  const calls = api.called('setMyCommands');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params.commands.map((c) => c.command), ['start', 'rank', 'top']);
  assert.equal(calls[1].params.scope.chat_id, OWNER.id);
});

test('/rank in private ends the feedback and news modes along with their prompt', async () => {
  const api = await setup();
  await onCallbackQuery(callback(user(5), 'feedback'));
  await onMessage(privateMessage(user(5), '/rank'));
  await onMessage(privateMessage(user(5), 'привет'));
  assert.equal(api.called('sendMessage').filter((c) => c.params.chat_id === OWNER.id).length, 0);
  const { getSetting } = await import('../tgcloud/lib/store.js');
  const news = await getSetting('news');
  await onCallbackQuery(callback(OWNER, 'admin:news'));
  await onMessage(privateMessage(OWNER, '/top'));
  await onMessage(privateMessage(OWNER, 'случайный текст'));
  assert.equal(await getSetting('news'), news);
});

test('a button on an older menu makes it the live one and removes the newer copy', async () => {
  const api = await setup();
  await onMessage(privateMessage(user(6), '/rank'));
  const before = api.called('deleteMessage').length;
  await onCallbackQuery(callback(user(6), 'xp:top', { message_id: 5 }));
  const deleted = api.called('deleteMessage').slice(before).map((c) => c.params.message_id);
  assert.equal(deleted.length, 1);
  assert.notEqual(deleted[0], 5);
  await onCallbackQuery(callback(user(6), 'xp:week', { message_id: 5 }));
  assert.equal(api.called('deleteMessage').length, before + 1);
});

test('the owner list failing does not repeat setMyCommands on every pump', async () => {
  const { apiError } = await import('./helpers.mjs');
  const api = await setup({
    setMyCommands: (p) => { if (p.scope) throw apiError('setMyCommands', 400, 'Bad Request: chat not found'); return true; },
  });
  await pump({ force: true });
  await pump({ force: true });
  assert.equal(api.called('setMyCommands').length, 2);
  assert.deepEqual((await db.all('SELECT source FROM error_log')).map((r) => r.source), ['commands.owner']);
  await db.run('DELETE FROM error_log');
});

test('flood limit keeps the message queued for deletion', async () => {
  const { apiError } = await import('./helpers.mjs');
  let flood = true;
  const api = await setup({
    deleteMessage: () => { if (flood) throw apiError('deleteMessage', 429, 'Too Many Requests', { retry_after: 3 }); return true; },
  });
  await onMessage(groupMessage(DISCUSSION, user(7), '/top'));
  const later = nowInt() + GROUP_REPLY_TTL + 1;
  Date.now = () => later * 1000;
  await pump({ force: true });
  assert.equal((await db.all('SELECT * FROM autodelete')).length, 2);
  flood = false;
  await pump({ force: true });
  assert.equal((await db.all('SELECT * FROM autodelete')).length, 0);
  assert.ok(api.called('deleteMessage').length >= 3);
});
