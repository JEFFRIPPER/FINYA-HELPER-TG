// Several marriages, children by «Усыновить» and «Созвать всех» with a reason below.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import profileEndpoint from '../tgcloud/endpoints/profile.js';
import { onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import { setSetting } from '../tgcloud/lib/store.js';
import * as social from '../tgcloud/lib/social.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { BOT, callback, checkErrors, DISCUSSION, groupMessage, OWNER, setup, user, replies } from './helpers.mjs';

afterEach(async () => {
  await checkErrors();
});

const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const lastSent = (api) => { const s = replies(api); return s.length ? s[s.length - 1].params.text : null; };
const lastMarkup = (api) => replies(api).at(-1).params.reply_markup.inline_keyboard;
const lastEdit = (api) => api.called('editMessageText').at(-1).params.text;
const lastProfile = (api) => api.called('sendPhoto').at(-1).params.caption;
const groupButton = (from, data) => callback(from, data, { chat: DISCUSSION, message_id: 5000 });
const count = async (table) => (await db.get(`SELECT COUNT(*) AS c FROM ${table}`)).c;
const admins = (ids) => ({
  getChatMember: (p) => ids.includes(p.user_id)
    ? { status: 'administrator', user: { id: p.user_id } }
    : { status: 'member', user: { id: p.user_id, is_bot: p.user_id === BOT.id } },
});

async function marry(api, a, b) {
  await say(a, 'брак', replyTo(b));
  await onCallbackQuery(groupButton(b, `marry:y:${a.id}:${b.id}`));
}

// First in the file: the module copies the old table once per process.
test('the old one-marriage table is copied into marriages once', async () => {
  await setup();
  const since = nowInt() - 40 * 86400;
  await db.run('INSERT INTO spouses (user_id, partner_id, since) VALUES (1, 2, ?), (2, 1, ?)', [since, since]);
  const all = await social.spousesOf(1);
  assert.deepEqual(all, [{ partner_id: 2, since }]);
  assert.equal(await count('marriages'), 2);
});

test('several marriages: everyone hears, «Мой Брак» lists all, «Развод» asks with whom', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(1, { first_name: 'Аня' });
  const b = user(2, { first_name: 'Боря' });
  const c = user(3, { first_name: 'Вика' });
  for (const u of [a, b, c]) await say(u, 'привет');
  await marry(api, a, b);
  await marry(api, a, c);
  assert.match(lastEdit(api), /Аня.*и.*Вика.* теперь в браке!/s);
  assert.match(lastEdit(api), /Новость для других супругов: <a href="tg:\/\/user\?id=2">Боря<\/a>/);
  assert.equal(await count('marriages'), 4);
  await say(a, 'мой брак');
  assert.match(lastSent(api), /Твои браки: 2 из 5/);
  assert.match(lastSent(api), /Пара: Боря/);
  assert.match(lastSent(api), /Пара: Вика/);
  await say(a, 'кто я');
  assert.match(lastProfile(api), /💍 Браки: Боря · 0 дней, Вика · 0 дней/);
  assert.equal((await profileEndpoint({}, { initData: { user: a } })).me.marriage.name, 'Боря, Вика');
  // Without a reply: a button for each spouse.
  await say(a, 'развод');
  assert.equal(lastSent(api), '<b>💔 С кем развод?</b>');
  const rows = lastMarkup(api);
  assert.deepEqual(rows.map((r) => r[0].callback_data), ['div:y:1:2', 'div:y:1:3', 'div:n:1:0']);
  await onCallbackQuery(groupButton(a, 'div:y:1:3'));
  assert.equal(await count('marriages'), 2);
  // In reply: with that one, and only a spouse.
  await say(a, 'развод', replyTo(c));
  assert.match(lastSent(api), /не в браке/);
  await say(a, 'развод', replyTo(b));
  assert.equal(lastMarkup(api)[0][0].callback_data, 'div:y:1:2');
});

test('up to five spouses each', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(1, { first_name: 'Аня' });
  for (let id = 2; id <= 6; id++) await marry(api, a, user(id));
  assert.equal((await social.spousesOf(1)).length, 5);
  await say(a, 'брак', replyTo(user(7)));
  assert.match(lastSent(api), /уже 5 браков, это максимум/);
  await say(user(7), 'брак', replyTo(a));
  assert.match(lastSent(api), /У этого участника уже 5 браков/);
});

test('«Начало Брака» with several spouses needs a reply', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(1, { first_name: 'Аня' });
  await say(user(3, { first_name: 'Вика' }), 'привет');
  await marry(api, a, user(2, { first_name: 'Боря' }));
  await marry(api, a, user(3, { first_name: 'Вика' }));
  await say(a, 'начало брака 01.05.2024');
  assert.match(lastSent(api), /несколько браков/);
  await say(a, 'начало брака 01.05.2024', replyTo(user(3, { first_name: 'Вика' })));
  assert.match(lastSent(api), /Брак с Вика теперь считается с 01\.05\.2024/);
  assert.equal((await social.marriageOf(3, 1)).since, (await social.marriageOf(1, 3)).since);
  assert.notEqual((await social.marriageOf(1, 2)).since, (await social.marriageOf(1, 3)).since);
});

test('«Усыновить»: only the child agrees; son or daughter by the anketa; «Моя Семья»', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const mom = user(1, { first_name: 'Аня' });
  const dad = user(2, { first_name: 'Боря' });
  const son = user(3, { first_name: 'Вова' });
  const girl = user(4, { first_name: 'Галя' });
  for (const u of [mom, dad, son, girl]) await say(u, 'привет');
  await say(son, '+пол м');
  await say(mom, 'усыновить', replyTo(son));
  assert.match(lastSent(api), /предложение стать сыном в семье/);
  const yes = lastMarkup(api)[0][0].callback_data;
  assert.equal(yes, 'kid:y:1:3');
  await onCallbackQuery(groupButton(mom, yes));
  await onCallbackQuery(groupButton(dad, yes));
  assert.equal(await count('children'), 0);
  await onCallbackQuery(groupButton(son, yes));
  assert.match(lastEdit(api), /В семье пополнение!\n.*Аня.* — родитель, .*Вова.* — сын\./);
  await say(dad, 'усыновить', replyTo(son));
  await onCallbackQuery(groupButton(son, 'kid:y:2:3'));
  await say(mom, 'усыновить', replyTo(girl));
  assert.match(lastSent(api), /стать ребёнком/);
  await onCallbackQuery(groupButton(girl, 'kid:y:1:4'));
  // A third parent, the parent back and the spouse are not allowed.
  await say(girl, 'усыновить', replyTo(son));
  assert.match(lastSent(api), /уже двое родителей/);
  await say(son, 'усыновить', replyTo(mom));
  assert.match(lastSent(api), /Это твой родитель/);
  await marry(api, mom, dad);
  await say(mom, 'усыновить', replyTo(dad));
  assert.match(lastSent(api), /супруга усыновить нельзя/);

  await say(mom, 'моя семья');
  const fam = lastSent(api);
  assert.match(fam, /👪 Семья · Аня/);
  assert.match(fam, /💍 Брак: Боря/);
  assert.match(fam, /👶 Дети: 2 из 10/);
  assert.match(fam, /• Сын: Вова/);
  assert.match(fam, /• Ребёнок: Галя/);
  await say(girl, 'семья');
  assert.match(lastSent(api), /👪 Родители: Аня/);
  assert.match(lastSent(api), /🧒 Братья и сёстры: Вова/);
  await say(girl, 'семья', replyTo(son));
  assert.match(lastSent(api), /👪 Семья · Вова\n\n👪 Родители: Аня, Боря/);
  await say(son, 'кто я');
  assert.match(lastProfile(api), /👪 Родители: Аня, Боря/);
  await say(mom, 'кто я');
  assert.match(lastProfile(api), /👶 Дети: 2/);
});

test('«Отказаться от ребёнка» and «Уйти из семьи» ask first', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const mom = user(1, { first_name: 'Аня' });
  const a = user(3, { first_name: 'Вова' });
  const b = user(4, { first_name: 'Галя' });
  for (const kid of [a, b]) {
    await say(mom, 'усыновить', replyTo(kid));
    await onCallbackQuery(groupButton(kid, `kid:y:1:${kid.id}`));
  }
  await say(mom, 'отказаться от ребёнка');
  assert.deepEqual(lastMarkup(api).map((r) => r[0].callback_data), ['unkid:y:1:3', 'unkid:y:1:4', 'unkid:n:1:0']);
  await onCallbackQuery(groupButton(a, 'unkid:y:1:3'));
  assert.equal(await count('children'), 2);
  await onCallbackQuery(groupButton(mom, 'unkid:y:1:3'));
  assert.equal(await count('children'), 1);
  await say(b, 'уйти из семьи');
  const leave = lastMarkup(api)[0][0].callback_data;
  assert.equal(leave, 'leave:y:4');
  await onCallbackQuery(groupButton(b, leave));
  assert.equal(await count('children'), 0);
  await say(b, 'моя семья');
  assert.match(lastSent(api), /Семьи пока нет/);
});

test('«Созвать всех» with the reason on the next lines, without «Финя,»', async () => {
  const api = await setup(admins([10]));
  await setSetting('chat_captcha', false);
  for (let id = 20; id < 23; id++) await say(user(id), 'привет');
  const before = replies(api).length;
  const reason = 'Сбор в войсе в 21:00\nБерите вкусняшки\n' + 'а'.repeat(700);
  await say(user(10, { first_name: 'Админ' }), `Созвать всех\n${reason}`);
  const calls = replies(api).slice(before);
  assert.equal(calls.length, 1);
  assert.match(calls[0].params.text, /созывает всех!\n<blockquote>Сбор в войсе в 21:00\nБерите вкусняшки\nааа/);
  assert.equal((calls[0].params.text.match(/а/g) || []).length >= 700, true);
  // Ordinary talk that merely starts like it stays talk.
  const n = replies(api).length;
  await say(user(21), 'созвать всех бы на шашлыки');
  assert.equal(replies(api).length, n);
});

test('the owner marries and divorces two members by @username', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const owner = OWNER;
  const a = user(1, { first_name: 'Аня', username: 'anya' });
  const b = user(2, { first_name: 'Боря', username: 'borya' });
  for (const u of [a, b]) await say(u, 'привет');
  const at = (text) => ({ entities: [...text.matchAll(/@\w+/g)].map((m) => ({ type: 'mention', offset: m.index, length: m[0].length })) });
  // Not the owner: an ordinary word.
  const n = replies(api).length;
  await say(a, 'поженить @anya @borya', at('поженить @anya @borya'));
  assert.equal(replies(api).length, n);
  await say(owner, 'Поженить @anya @borya', at('Поженить @anya @borya'));
  assert.match(lastSent(api), /По решению владельца .*Аня.* и .*Боря.* теперь в браке!/);
  assert.equal(await count('marriages'), 2);
  await say(owner, 'Поженить @anya @borya', at('Поженить @anya @borya'));
  assert.match(lastSent(api), /и так в браке/);
  await say(owner, 'Поженить @anya @nobody', at('Поженить @anya @nobody'));
  assert.match(lastSent(api), /Не знаю @nobody/);
  await say(owner, 'Поженить @anya', at('Поженить @anya'));
  assert.match(lastSent(api), /Нужны два участника/);
  await say(owner, 'Развести @anya @borya', at('Развести @anya @borya'));
  assert.match(lastSent(api), /больше не в браке/);
  assert.equal(await count('marriages'), 0);
});
