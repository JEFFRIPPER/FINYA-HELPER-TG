import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { InputFile } from 'sdk';
import { onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import { callback, checkErrors, DISCUSSION, groupMessage, lastText, privateMessage, setup, user } from './helpers.mjs';

afterEach(checkErrors);

test('/start uploads the photo once, then reuses its file_id', async () => {
  const mock = await setup();
  await onMessage(privateMessage(user(1), '/start'));
  const first = mock.called('sendPhoto')[0].params;
  assert.ok(first.photo instanceof InputFile);
  assert.equal(first.photo.bytes.length, 72432);
  assert.equal(first.photo.bytes[0], 0xff); // JPEG magic
  assert.match(first.caption, /Выбери раздел/);
  await onMessage(privateMessage(user(1), '/start'));
  const second = mock.called('sendPhoto')[1].params;
  assert.equal(second.photo, 'PHOTO_FILE_ID');
  assert.match(second.caption, /С возвращением/);
});

test('menu buttons edit the photo caption; long text is sent separately', async () => {
  const mock = await setup();
  await onCallbackQuery(callback(user(2), 'info', { photo: [{ file_id: 'x' }] }));
  assert.equal(mock.called('editMessageCaption').length, 1);
  assert.equal(mock.called('answerCallbackQuery').length, 1);
  await onCallbackQuery(callback(user(2), 'xp:rules', { photo: [{ file_id: 'x' }] }));
  assert.equal(mock.called('sendMessage').length, 1);
  await onCallbackQuery(callback(user(2), 'partner:asahi'));
  assert.match(lastText(mock, 'editMessageText'), /Сай/);
});

test('custom emoji icons stay on menu buttons', async () => {
  const mock = await setup();
  await onCallbackQuery(callback(user(3), 'home'));
  const rows = mock.called('editMessageText')[0].params.reply_markup.inline_keyboard;
  assert.deepEqual(rows[0][0], { text: 'Инфо', callback_data: 'info', icon_custom_emoji_id: '6021620268697393273' });
  assert.deepEqual(rows[0][1], { text: '📢 Новости', callback_data: 'news' });
});

test('commands addressed to another bot are ignored', async () => {
  const mock = await setup();
  await onMessage(groupMessage(DISCUSSION, user(4), '/rank@other_bot'));
  assert.equal(mock.called('sendMessage').length, 0);
  await onMessage(groupMessage(DISCUSSION, user(4), '/rank@Finya_Bot'));
  assert.equal(mock.called('sendMessage').length, 1);
});

test('"last post" answers the callback exactly once', async () => {
  const mock = await setup();
  await onCallbackQuery(callback(user(5), 'channel:last'));
  assert.equal(mock.called('answerCallbackQuery').length, 1);
  assert.equal(mock.called('answerCallbackQuery')[0].params.show_alert, true);
});

test('status shows the subscription toggle', async () => {
  const mock = await setup();
  await onCallbackQuery(callback(user(6), 'status:subscribe'));
  assert.match(lastText(mock), /Рассылка ТГК: ВКЛ/);
  assert.match(JSON.stringify(mock.called('editMessageText').at(-1).params.reply_markup), /Выключить рассылку/);
});
