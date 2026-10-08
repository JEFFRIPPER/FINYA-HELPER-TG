import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import { callback, checkErrors, lastText, privateMessage, setup, user, OWNER } from './helpers.mjs';

afterEach(checkErrors);

async function addMember(id, xp = 0) {
  await db.run(`INSERT INTO profiles (user_id, name, username, xp) VALUES (?, ?, ?, ?)`, [id, `Member${id}`, `member${id}`, xp]);
}

function confirmToken(mock) {
  const markup = mock.calls.filter((c) => c.params.reply_markup).at(-1).params.reply_markup;
  const data = markup.inline_keyboard.flat().map((b) => b.callback_data).find((d) => d && d.startsWith('admin:xp:confirm:'));
  return data;
}

test('/admin is owner-only and private-only', async () => {
  const mock = await setup();
  await onMessage(privateMessage(user(5), '/admin'));
  assert.equal(mock.called('sendMessage').length, 0);
  await onMessage(privateMessage(OWNER, '/admin'));
  assert.match(lastText(mock), /Админ-панель/);
});

test('add XP: amount → preview → confirm → saved with history', async () => {
  const mock = await setup();
  await addMember(50, 90);
  await onCallbackQuery(callback(OWNER, 'admin:xp:add:50'));
  assert.match(lastText(mock), /Сколько XP добавить/);
  await onMessage(privateMessage(OWNER, '25'));
  assert.match(lastText(mock), /XP: 90 → 115/);
  assert.match(lastText(mock), /I · Искра → II · Звено/);
  const token = confirmToken(mock);
  assert.ok(token);
  await onCallbackQuery(callback(OWNER, token));
  assert.match(lastText(mock), /Изменение сохранено/);
  assert.equal((await db.get('SELECT xp FROM profiles WHERE user_id = 50')).xp, 115);
  // Pressing confirm again does not apply twice.
  await onCallbackQuery(callback(OWNER, token));
  assert.equal((await db.get('SELECT xp FROM profiles WHERE user_id = 50')).xp, 115);
  await onCallbackQuery(callback(OWNER, 'admin:xp:history:50'));
  assert.match(lastText(mock), /XP: 90 → 115/);
});

test('manual rank, then back to automatic', async () => {
  const mock = await setup();
  await addMember(51, 10);
  await onCallbackQuery(callback(OWNER, 'admin:xp:choose:51:VII'));
  await onCallbackQuery(callback(OWNER, confirmToken(mock)));
  assert.equal((await db.get('SELECT manual_rank FROM profiles WHERE user_id = 51')).manual_rank, 'VII');
  await onCallbackQuery(callback(OWNER, 'admin:xp:auto:51'));
  await onCallbackQuery(callback(OWNER, confirmToken(mock)));
  assert.equal((await db.get('SELECT manual_rank FROM profiles WHERE user_id = 51')).manual_rank, null);
});

test('data changed before confirm → fresh preview, nothing applied', async () => {
  const mock = await setup();
  await addMember(52, 10);
  await onCallbackQuery(callback(OWNER, 'admin:xp:subtract:52'));
  await onMessage(privateMessage(OWNER, '5'));
  const token = confirmToken(mock);
  await db.run('UPDATE profiles SET xp = 20 WHERE user_id = 52');
  await onCallbackQuery(callback(OWNER, token));
  assert.match(lastText(mock), /Данные участника изменились/);
  assert.equal((await db.get('SELECT xp FROM profiles WHERE user_id = 52')).xp, 20);
});

test('founder profile is protected; find by username', async () => {
  const mock = await setup();
  await onMessage(privateMessage(OWNER, '/start'));
  await onCallbackQuery(callback(OWNER, `admin:xp:add:${OWNER.id}`));
  assert.match(lastText(mock), /закреплён за владельцем/);
  await addMember(53, 0);
  await onCallbackQuery(callback(OWNER, 'admin:xp:find'));
  await onMessage(privateMessage(OWNER, '@MEMBER53'));
  assert.match(lastText(mock), /Участник Сквада[\s\S]*Telegram ID: 53/);
});

test('participants list includes users who only opened the bot', async () => {
  const mock = await setup();
  await onMessage(privateMessage(user(60), '/start'));
  await onCallbackQuery(callback(OWNER, 'admin:xp:users'));
  assert.match(JSON.stringify(mock.calls.at(-1).params.reply_markup), /U60 · 60/);
});

test('news, maintenance and feedback', async () => {
  const mock = await setup();
  await onCallbackQuery(callback(OWNER, 'admin:news'));
  await onMessage(privateMessage(OWNER, 'Новость дня'));
  assert.match(lastText(mock), /Новость обновлена/);
  await onCallbackQuery(callback(OWNER, 'admin:maintenance'));
  const visitor = user(70);
  await onMessage(privateMessage(visitor, '/start'));
  assert.match(lastText(mock), /техработах/);
  await onCallbackQuery(callback(OWNER, 'admin:maintenance'));
  await onCallbackQuery(callback(visitor, 'feedback'));
  await onMessage(privateMessage(visitor, 'Идея: сделать конкурс'));
  const toOwner = mock.called('sendMessage').filter((c) => c.params.chat_id === OWNER.id).at(-1);
  assert.match(toOwner.params.text, /Идея: сделать конкурс/);
  await onCallbackQuery(callback(OWNER, 'admin:feedback'));
  assert.match(lastText(mock), /Идея: сделать конкурс/);
  await onCallbackQuery(callback(OWNER, 'admin:stats'));
  assert.match(lastText(mock), /Пользователей: 2\n/);
});
