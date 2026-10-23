// «<команда> помощь»: how to write a command, for every command of the chat.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { onMessage } from '../tgcloud/lib/bot.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { checkErrors, DISCUSSION, groupMessage, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const say = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));
const last = (api) => replies(api).at(-1).params.text;

test('«помощь» after a command shows how to write it', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  await say(a, 'Финя награды помощь');
  assert.match(last(api), /❓ 🏅 Награды/);
  assert.match(last(api), /Снять Награды От \(ответом\)/);
  await say(a, 'Наградить помощь');
  assert.match(last(api), /❓ 🏅 Наградить/);
  assert.match(last(api), /Число в первой строке — степень/);
  await say(a, 'кто я помощь');
  assert.match(last(api), /❓ 👤 Кто Я/);
  await say(a, '+ ник помощь');
  assert.match(last(api), /❓ 🏷 Ник/);
  await say(a, 'Топ недели помощь');
  assert.match(last(api), /❓ 📊 Стата/);
  await say(a, 'Финя, казино 50 помощь');
  assert.match(last(api), /Ставка XP с баланса от 10 до 500/);
  await say(a, 'обнять помощь');
  assert.match(last(api), /❓ 🤗 Обнять/);
  assert.match(last(api), /@finya_helper_Squad_bot обнять @ник/);
});

test('a plain sentence ending in «помощь» is not a command; an unknown one asks for «Команды»', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const before = replies(api).length;
  await say(a, 'нужна помощь');
  await say(a, 'кто бы мог помощь');
  assert.equal(replies(api).length, before);
  await say(a, 'Финя, полёт помощь');
  assert.match(last(api), /Не знаю команду «полет»/);
  await say(a, 'Финя, команды');
  assert.match(last(api), /допиши «помощь»/);
});
