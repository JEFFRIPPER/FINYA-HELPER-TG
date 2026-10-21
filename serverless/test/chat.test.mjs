// Финя в чате: commands in words, members, reputation, marriages, RP, moderation.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { apiMock, db } from 'sdk';
import profileEndpoint from '../tgcloud/endpoints/profile.js';
import { onCallbackQuery, onChatMember, onMessage, pump } from '../tgcloud/lib/bot.js';
import * as moder from '../tgcloud/lib/moder.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import * as xp from '../tgcloud/lib/xp.js';
import {
  BOT, callback, channelRoot, checkErrors, DISCUSSION, FAMILY, groupMessage, OWNER, privateMessage, setup, user, replies } from './helpers.mjs';

const realNow = Date.now;
const realRandom = Math.random;
afterEach(async () => {
  Date.now = realNow;
  Math.random = realRandom;
  await checkErrors();
});

const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const sent = replies;
const lastSent = (api) => { const s = sent(api); return s.length ? s[s.length - 1].params.text : null; };
// The profile goes out as the activity chart with a caption.
const lastProfile = (api) => { const s = api.called('sendPhoto'); return s.length ? s[s.length - 1].params.caption : null; };
// Chat admins for getChatMember; everyone else is a plain member.
const withAdmins = (ids) => ({
  getChatMember: (p) => ids.includes(p.user_id)
    ? { status: 'administrator', can_restrict_members: true, user: { id: p.user_id } }
    : { status: 'member', user: { id: p.user_id, is_bot: p.user_id === BOT.id } },
});
// Group buttons arrive with the group's chat in the message.
const groupButton = (from, data, messageId = 5000) => callback(from, data, { chat: DISCUSSION, message_id: messageId });

test('«кто я» shows the profile, earns no XP and cleans itself up', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const u = user(1, { first_name: 'Вася' });
  const root = channelRoot();
  await onMessage(root);
  await say(u, 'кто я', { reply_to_message: root });
  const text = lastProfile(api);
  assert.match(text, /👤 Это пользователь Вася/);
  assert.match(text, /Репутация: 0/);
  assert.doesNotMatch(text, /В браке/);
  assert.match(text, /Первое появление: \d\d\.\d\d\.\d{4}/);
  assert.match(text, /Актив \(д\|н\|м\|весь\): 1 \| 1 \| 1 \| 1/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM events WHERE kind = ?', ['comment'])).c, 0);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM autodelete')).c, 2);
  // Ordinary talk is not a command.
  await say(u, 'я сегодня кто угодно, только не профиль');
  assert.equal(sent(api).length + api.called('sendPhoto').length, 1);
});

test('commands work only in the Squad chats', async () => {
  const api = await setup();
  await onMessage(groupMessage({ id: -77, type: 'supergroup', title: 'Чужая' }, user(1), 'кто я'));
  await onMessage(groupMessage(FAMILY, user(1), 'фарм'));
  assert.equal(sent(api).length, 0);
});

test('member list: activity tops count current members with fresh names', async () => {
  const api = await setup();
  for (let i = 0; i < 3; i++) await say(user(1, { first_name: 'Старое' }), 'привет всем');
  await say(user(1, { first_name: 'Новое' }), 'ещё');
  await say(user(2, { first_name: 'Петя' }), 'ага');
  await say(user(3, { first_name: 'Ушёл' }), 'пока');
  await say(user(3, { first_name: 'Ушёл' }), 'пока');
  await onChatMember({
    chat: DISCUSSION, from: user(3), date: nowInt(),
    old_chat_member: { status: 'member', user: user(3) }, new_chat_member: { status: 'left', user: user(3) },
  });
  await say(user(9), 'топ дня');
  const text = lastSent(api);
  assert.match(text, /🥇 Новое — 4 сообщения/);
  assert.match(text, /🥈 Петя — 1 сообщение/);
  assert.doesNotMatch(text, /Старое|Ушёл/);
  // Coming back returns them to the list.
  await say(user(3, { first_name: 'Ушёл' }), 'я вернулся');
  await say(user(9), 'топ недели');
  assert.match(lastSent(api), /Ушёл — 3 сообщения/);
  await say(user(9), 'стата');
  assert.match(lastSent(api), /Стата чата · сегодня/);
  assert.match(lastSent(api), /Участников: 4 · писали: 4/);
  assert.match(lastSent(api), /Всего сообщений: 11<\/b>$/);
});

test('stats panel: buttons switch the period, all time ends with the total', async () => {
  const api = await setup();
  const realNowFn = Date.now;
  // Ten days ago, then today.
  Date.now = () => realNowFn() - 10 * 86400 * 1000;
  await say(user(1, { first_name: 'Давний' }), 'привет');
  Date.now = realNowFn;
  for (let i = 0; i < 2; i++) await say(user(2, { first_name: 'Сегодняшний' }), 'ага');
  await say(user(9, { first_name: 'Спросил' }), 'стата');
  const panel = sent(api).at(-1).params;
  assert.match(panel.text, /🥇 Сегодняшний — 2 сообщения\n🥈 Спросил — 1 сообщение/);
  assert.doesNotMatch(panel.text, /Давний/);
  assert.deepEqual(panel.reply_markup.inline_keyboard[0].map((b) => [b.text, b.callback_data]), [
    ['• День', 'stat:day'], ['Неделя', 'stat:week'], ['Месяц', 'stat:month'], ['Всё время', 'stat:all'],
  ]);
  await onCallbackQuery(groupButton(user(5), 'stat:all', 7000));
  const edit = api.called('editMessageText').at(-1).params;
  assert.equal(edit.message_id, 7000);
  assert.match(edit.text, /Стата чата · всё время/);
  assert.match(edit.text, /Давний — 1 сообщение/);
  assert.match(edit.text, /Всего сообщений: 4<\/b>$/);
  assert.equal(edit.reply_markup.inline_keyboard[0][3].text, '• Всё время');
  assert.equal(api.called('answerCallbackQuery').length, 1);
});

test('фарм: random XP, then a cooldown; parallel messages farm once', async () => {
  const api = await setup();
  Math.random = () => 0.5;
  await say(user(1), 'фарм');
  assert.match(lastSent(api), /фарм удался: \+51 XP/);
  assert.equal((await db.get('SELECT xp FROM profiles WHERE user_id = 1')).xp, 51);
  await say(user(1), 'Фарм!');
  assert.match(lastSent(api), /Приходи через 1 ч/);
  // A rare roll goes over 100.
  Math.random = () => 0.05;
  await Promise.all([say(user(2), 'фарм'), say(user(2), 'фарм'), say(user(2), 'фарм')]);
  const farms = await db.all("SELECT points FROM events WHERE user_id = 2 AND kind = 'farm'");
  assert.equal(farms.length, 1);
  assert.ok(farms[0].points > 100 && farms[0].points <= 200);
  // Farm XP is outside the weekly top of activity.
  assert.deepEqual(await xp.leaderboard({ weekly: true }), []);
  // After the cooldown it works again.
  const later = nowInt() + xp.FARM_COOLDOWN + 1;
  Date.now = () => later * 1000;
  await say(user(1), 'фарм');
  assert.equal((await db.all("SELECT 1 FROM events WHERE user_id = 1 AND kind = 'farm'")).length, 2);
});

test('farm rolls stay within 1–100, rarely 101–200', () => {
  assert.equal(xp.farmRoll(() => 0.99), 100);
  assert.equal(xp.farmRoll(() => 0.1), 11);
  let calls = 0;
  assert.equal(xp.farmRoll(() => (calls++ ? 0.999 : 0.01)), 200);
  calls = 0;
  assert.equal(xp.farmRoll(() => (calls++ ? 0 : 0.01)), 101);
});

test('«+» gives reputation without a limit; not to yourself, bots or the channel post', async () => {
  const api = await setup();
  const a = user(1, { first_name: 'Аня' });
  const b = user(2, { first_name: 'Боря' });
  for (let i = 0; i < 25; i++) await say(a, i % 2 ? '+' : 'спасибо!', replyTo(b));
  assert.match(lastSent(api), /Репутация \+1, теперь 25/);
  const before = sent(api).length;
  await say(a, '+', replyTo(a));
  await say(a, '+', replyTo(BOT));
  await say(a, '+', { reply_to_message: channelRoot() });
  await say(a, '+');
  assert.equal(sent(api).length, before);
  // A redelivered «+» counts once.
  const m = groupMessage(DISCUSSION, b, '+', replyTo(a));
  await onMessage(m);
  await onMessage(m);
  assert.equal((await db.get('SELECT points FROM reputation WHERE user_id = 1')).points, 1);
  await say(b, 'кто ты', replyTo(a));
  assert.match(lastProfile(api), /Репутация: 1/);
});

test('marriage: proposal, only the other one accepts, Mini App shows the partner, divorce', async () => {
  const api = await setup();
  const a = user(1, { first_name: 'Аня' });
  const b = user(2, { first_name: 'Боря' });
  const c = user(3, { first_name: 'Вика' });
  await say(b, 'привет');
  await say(a, 'брак', replyTo(b));
  const proposal = sent(api).at(-1).params;
  assert.match(proposal.text, /делает предложение/);
  const yes = proposal.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(yes, 'marry:y:1:2');
  // The proposer and strangers cannot accept.
  await onCallbackQuery(groupButton(a, yes));
  await onCallbackQuery(groupButton(c, yes));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM spouses')).c, 0);
  assert.equal(api.called('answerCallbackQuery').filter((x) => x.params.show_alert).length, 2);
  await onCallbackQuery(groupButton(b, yes));
  assert.match(api.called('editMessageText').at(-1).params.text, /теперь в браке/);
  // A second tap or a rival proposal changes nothing.
  await onCallbackQuery(groupButton(b, yes));
  await say(c, 'брак', replyTo(a));
  assert.match(lastSent(api), /уже в браке/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM spouses')).c, 2);
  await say(c, 'браки');
  assert.match(lastSent(api), /Аня \+ Боря — 0 дней/);
  const data = await profileEndpoint({}, { initData: { user: a } });
  assert.equal(data.me.marriage.name, 'Боря');
  await say(a, 'кто я');
  assert.match(lastProfile(api), /В браке с Боря/);
  // Divorce asks first; only the one who asked can confirm.
  await say(a, 'развод');
  const div = sent(api).at(-1).params.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(div, 'div:y:1:2');
  await onCallbackQuery(groupButton(b, div));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM spouses')).c, 2);
  await onCallbackQuery(groupButton(a, div));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM spouses')).c, 0);
  assert.equal((await profileEndpoint({}, { initData: { user: a } })).me.marriage, null);
  // An old prompt cannot end a newer marriage.
  await say(a, 'брак', replyTo(c));
  await onCallbackQuery(groupButton(c, 'marry:y:1:3'));
  await onCallbackQuery(groupButton(a, div));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM spouses')).c, 2);
});

test('a bare «топ» is praise; «Финя, топ» is the XP top', async () => {
  const api = await setup();
  await say(user(1), 'топ!');
  assert.equal(sent(api).length, 0);
  await say(user(1), 'Финя, топ');
  assert.match(lastSent(api), /Топ Сквада/);
});

test('an album is not a flood', async () => {
  const api = await setup(withAdmins([]));
  for (let i = 0; i < 10; i++) await say(user(5), undefined, { photo: [{ file_id: 'p' }], media_group_id: 'g1' });
  assert.equal(api.called('restrictChatMember').length, 0);
});

test('a declined or expired proposal cannot be accepted', async () => {
  const api = await setup();
  const a = user(1);
  const b = user(2);
  await say(a, 'брак', replyTo(b));
  await onCallbackQuery(groupButton(b, 'marry:n:1:2'));
  assert.match(api.called('editMessageText').at(-1).params.text, /отказом/);
  await onCallbackQuery(groupButton(b, 'marry:y:1:2'));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM spouses')).c, 0);
  await say(a, 'брак', replyTo(b));
  await db.run('UPDATE proposals SET created_at = created_at - 7200');
  await onCallbackQuery(groupButton(b, 'marry:y:1:2'));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM spouses')).c, 0);
});

test('RP actions need a target; the owner adds his own', async () => {
  const api = await setup();
  const a = user(1, { first_name: 'Аня' });
  const b = user(2, { first_name: 'Боря', username: 'borya' });
  await say(b, 'я тут');
  const hug = groupMessage(DISCUSSION, a, 'Обнять крепко-крепко', replyTo(b));
  await onMessage(hug);
  assert.match(lastSent(api), /🤗 <a href="tg:\/\/user\?id=1">Аня<\/a> обнимает <a href="tg:\/\/user\?id=2">Боря<\/a>/);
  assert.match(lastSent(api), /💬 «крепко-крепко»/);
  // The command goes away; Финя answers Боря's message instead.
  assert.equal(sent(api).at(-1).params.reply_parameters.message_id, hug.reply_to_message.message_id);
  assert.ok(api.called('deleteMessage').some((c) => c.params.message_id === hug.message_id));
  // By @username, without a reply: under the same post, the command gone too.
  const text = 'пожать руку @borya';
  const shake = groupMessage(DISCUSSION, a, text, {
    message_thread_id: 900, entities: [{ type: 'mention', offset: text.indexOf('@'), length: 6 }],
  });
  await onMessage(shake);
  assert.match(lastSent(api), /жмёт руку/);
  assert.equal(sent(api).at(-1).params.reply_parameters.message_id, 900);
  assert.ok(api.called('deleteMessage').some((c) => c.params.message_id === shake.message_id));
  const before = sent(api).length;
  await say(a, 'обнять бы кого-нибудь');
  assert.equal(sent(api).length, before);
  // Members cannot add actions; the owner can.
  await say(a, '+рп пощекотать = щекочет 🤭');
  assert.equal(sent(api).length, before);
  await say(OWNER, '+рп пощекотать = щекочет 🤭');
  await say(a, 'пощекотать', replyTo(b));
  assert.match(lastSent(api), /^<b>✨ .*щекочет 🤭/);
  await say(a, 'рп');
  assert.match(lastSent(api), /Свои: Пощекотать/);
  await say(OWNER, '-рп пощекотать');
  await say(a, 'пощекотать', replyTo(b));
  assert.match(lastSent(api), /Свои|удалено/);
});

test('«Финя, …»: who, chance, choice and a yes/no answer', async () => {
  const api = await setup();
  await say(user(2, { first_name: 'Боря' }), 'привет');
  await say(user(1), 'Финя, кто сегодня красавчик?');
  assert.match(lastSent(api), /Кто сегодня красавчик\? Думаю, это <a href="tg:\/\/user\?id=[12]">/);
  await say(user(1), 'финя инфа что завтра будет пост');
  assert.match(lastSent(api), /Инфа, что завтра будет пост, — \d{1,3}%/);
  Math.random = () => 0.99;
  await say(user(1), 'Финя, выбери пиво или чай');
  assert.match(lastSent(api), /Я выбираю: чай/);
  await say(user(1), 'Финя, будет стрим?');
  assert.match(lastSent(api), /🎱/);
  await say(user(1), 'Финя');
  assert.match(lastSent(api), /На месте/);
  await say(user(1), 'финя, команды');
  assert.match(lastSent(api), /Выбери раздел/);
  const menu = sent(api).at(-1).params.reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.deepEqual(menu, ['👤 Профиль', '💞 Люди', '🎲 XP и игры', '🛠 Полезное', '🛡 Админам']);
  await onCallbackQuery(groupButton(user(1), 'help:profile:0'));
  const shown = api.called('editMessageText').at(-1).params;
  assert.match(shown.text, /👤 Кто Я · Кто Ты \(ответом\)\n<blockquote>Профиль с графиком актива/);
  assert.equal(shown.reply_markup.inline_keyboard[0][0].text, '• 👤 Профиль');
  await onCallbackQuery(groupButton(user(1), 'help:owner:0'));
  assert.equal(api.called('editMessageText').length, 1);
  // Talking about Финя is not a command.
  const before = sent(api).length;
  await say(user(1), 'финя сегодня быстрая');
  assert.equal(sent(api).length, before);
});

test('moderation by text is off until the owner turns it on', async () => {
  const api = await setup(withAdmins([10]));
  await say(user(10), 'мут 1ч', replyTo(user(5)));
  await say(user(10), 'варны', replyTo(user(5)));
  assert.equal(api.called('restrictChatMember').length, 0);
  assert.equal(sent(api).length, 0);
  const adminHelp = async () => {
    await onCallbackQuery(groupButton(OWNER, 'help:admin:1'));
    return api.called('editMessageText').at(-1).params.text;
  };
  assert.doesNotMatch(await adminHelp(), /Мут 1ч/);
  await say(OWNER, 'Финя, модерация вкл');
  assert.match(lastSent(api), /Модерация командами включена/);
  await say(OWNER, 'Финя, команды');
  assert.ok(sent(api).at(-1).params.reply_markup.inline_keyboard.flat().some((b) => b.text === '👑 Владельцу'));
  assert.match(await adminHelp(), /🛡 Мут 1ч · Размут[^\n]*\n<blockquote>Ответом на сообщение/);
  await say(user(10), 'мут 1ч', replyTo(user(5)));
  assert.equal(api.called('restrictChatMember').length, 1);
});

test('moderation: admins mute, warn and ban by reply; members and admins are protected', async () => {
  const api = await setup(withAdmins([10, 11]));
  await setSetting('chat_moderation', true);
  const admin = user(10, { first_name: 'Админ' });
  const bad = user(5, { first_name: 'Хулиган' });
  await say(bad, 'мут', replyTo(user(6)));
  assert.match(lastSent(api), /только админы/);
  assert.equal(api.called('restrictChatMember').length, 0);
  // Jokes are not commands: the first line holds only the time, the reason goes below.
  await say(admin, 'мут тебе', replyTo(bad));
  await say(admin, 'бан бы тебе за такое 😂', replyTo(bad));
  assert.equal(api.called('restrictChatMember').length + api.called('banChatMember').length, 0);
  await say(admin, 'мут 30м\nспам', replyTo(bad));
  const r = api.called('restrictChatMember')[0].params;
  assert.equal(r.user_id, 5);
  assert.equal(r.permissions.can_send_messages, false);
  assert.ok(Math.abs(r.until_date - (nowInt() + 1800)) <= 2);
  assert.match(lastSent(api), /получает мут на 30 мин\.\nПричина: спам/);
  await say(admin, 'бан', replyTo(user(11)));
  assert.match(lastSent(api), /Админов так не наказать/);
  await say(admin, 'мут', replyTo(OWNER));
  assert.equal(api.called('restrictChatMember').length, 1);
  // Three warns end in a day of mute.
  await say(admin, 'варн\nфлуд', replyTo(bad));
  await say(admin, 'варн', replyTo(bad));
  assert.match(lastSent(api), /варн \(2\/3\)/);
  await say(admin, 'варны', replyTo(bad));
  assert.match(lastSent(api), /2\/3/);
  await say(admin, 'варн', replyTo(bad));
  assert.match(lastSent(api), /собирает 3 варна/);
  assert.equal(api.called('restrictChatMember').length, 2);
  await say(admin, 'бан', replyTo(bad));
  assert.equal(api.called('banChatMember')[0].params.user_id, 5);
  await say(admin, 'разбан', replyTo(bad));
  assert.equal(api.called('unbanChatMember')[0].params.only_if_banned, true);
  // «Снять мут» under a mute: admins only.
  await onCallbackQuery(groupButton(bad, 'mod:unmute:5'));
  assert.equal(api.called('restrictChatMember').length, 2);
  await onCallbackQuery(groupButton(admin, 'mod:unmute:5'));
  assert.equal(api.called('restrictChatMember').at(-1).params.permissions.can_send_messages, true);
});

test('moderation without rights says what to fix', async () => {
  const api = await setup({
    ...withAdmins([10]),
    restrictChatMember: () => { throw new (class extends Error { constructor() { super('x'); this.code = 400; this.description = 'Bad Request: not enough rights'; } })(); },
  });
  await setSetting('chat_moderation', true);
  await say(user(10), 'мут 1ч', replyTo(user(5)));
  assert.match(lastSent(api), /не хватает прав/);
});

test('duration words', () => {
  const D = 86400;
  assert.equal(moder.parseDuration('30м'), 1800);
  assert.equal(moder.parseDuration('2 дня'), 2 * D);
  assert.equal(moder.parseDuration('15'), 900);
  assert.equal(moder.parseDuration('1 неделя'), 7 * D);
  assert.equal(moder.parseDuration('2 мес'), 60 * D);
  assert.equal(moder.parseDuration('1 год'), moder.MAX_MUTE);
  assert.equal(moder.parseDuration('9999д'), moder.MAX_MUTE);
  assert.equal(moder.parseDuration(''), null);
  assert.equal(moder.parseDuration('тебе'), undefined);
  assert.equal(moder.parseDuration('5 попугаев'), undefined);
  assert.deepEqual(moder.parseCommandArgs('мут', '@vasya 1д\nза мат'), { seconds: D, reason: 'за мат' });
  assert.deepEqual(moder.parseCommandArgs('бан', '\nспам'), { seconds: null, reason: 'спам' });
  assert.equal(moder.parseCommandArgs('бан', 'бы тебе'), null);
  assert.equal(moder.fmtDuration(90 * 60), '1 ч 30 мин');
});

test('forwarded messages in a burst are not a flood', async () => {
  const api = await setup(withAdmins([]));
  const ts = nowInt();
  for (let i = 0; i < 10; i++) {
    await say(user(5), 'пересланное ' + i, { date: ts, forward_origin: { type: 'hidden_user', sender_user_name: 'X', date: ts } });
  }
  assert.equal(api.called('restrictChatMember').length, 0);
});

test('antiflood mutes once for a burst, not for a slow chat', async () => {
  const api = await setup(withAdmins([]));
  const ts = nowInt();
  for (let i = 0; i < 12; i++) await say(user(5), 'а' + i, { date: ts });
  assert.equal(api.called('restrictChatMember').length, 1);
  assert.match(lastSent(api), /за флуд/);
  for (let i = 0; i < 12; i++) await say(user(6), 'б' + i, { date: ts + i * 2 });
  assert.equal(api.called('restrictChatMember').length, 1);
  await setSetting('chat_antiflood', false);
  for (let i = 0; i < 12; i++) await say(user(7), 'в' + i, { date: ts });
  assert.equal(api.called('restrictChatMember').length, 1);
});

test('captcha: a newcomer is muted until «Я не бот», then welcomed; silence means a kick', async () => {
  const api = await setup();
  const nick = user(7, { first_name: 'Ник' });
  const join = (u) => groupMessage(DISCUSSION, u, undefined, { new_chat_members: [u] });
  await onMessage(join(nick));
  // The same join as chat_member asks nothing new.
  await onChatMember({
    chat: DISCUSSION, from: nick, date: nowInt(),
    old_chat_member: { status: 'left', user: nick }, new_chat_member: { status: 'member', user: nick },
  });
  assert.equal(api.called('restrictChatMember').length, 1);
  const check = sent(api);
  assert.equal(check.length, 1);
  assert.match(check[0].params.text, /Нажми кнопку/);
  await onCallbackQuery(groupButton(user(8), 'cap:7'));
  assert.equal(api.called('restrictChatMember').length, 1);
  await onCallbackQuery(groupButton(nick, 'cap:7'));
  assert.equal(api.called('restrictChatMember').at(-1).params.permissions.can_send_messages, true);
  assert.match(lastSent(api), /Добро пожаловать в Сквад, <b>Ник<\/b>/);
});

// getChatMember answers from a status map; the bot itself is an admin.
function statusApi(statuses) {
  return {
    getChatMember: (p) => {
      const st = statuses[p.user_id] || 'member';
      if (st === 'muted') return { status: 'restricted', is_member: true, can_send_messages: false, user: { id: p.user_id } };
      return { status: st, user: { id: p.user_id }, can_restrict_members: st === 'administrator' };
    },
  };
}
const joinOf = (u) => groupMessage(DISCUSSION, u, undefined, { new_chat_members: [u] });
const afterCaptcha = async () => {
  const later = nowInt() + moder.CAPTCHA_TTL + 1;
  Date.now = () => later * 1000;
  await pump({ force: true });
};

test('captcha: silence means a kick by pump()', async () => {
  const statuses = { 9: 'member' };
  const api = await setup(statusApi(statuses));
  await onMessage(joinOf(user(9)));
  assert.equal(sent(api).at(-1).params.reply_parameters.message_id > 0, true);
  statuses[9] = 'muted';
  await afterCaptcha();
  assert.equal(api.called('banChatMember')[0].params.user_id, 9);
  assert.equal(api.called('unbanChatMember')[0].params.user_id, 9);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM captcha WHERE status = 'pending'")).c, 0);
});

test('captcha never lifts an admin\'s ban or mute', async () => {
  const statuses = { 10: 'administrator' };
  const api = await setup(statusApi(statuses));
  const admin = user(10);
  // A spammer banned before pressing stays banned.
  await onMessage(joinOf(user(9)));
  await say(admin, 'бан', replyTo(user(9)));
  statuses[9] = 'kicked';
  await onChatMember({
    chat: DISCUSSION, from: admin, date: nowInt(),
    old_chat_member: { status: 'restricted', is_member: true, user: user(9) }, new_chat_member: { status: 'kicked', user: user(9) },
  });
  await afterCaptcha();
  assert.equal(api.called('unbanChatMember').length, 0);
  // A muted member who leaves and rejoins gets no button that would unmute them.
  Date.now = realNow;
  statuses[8] = 'muted';
  const before = api.called('restrictChatMember').length;
  await onMessage(joinOf(user(8)));
  assert.equal(api.called('restrictChatMember').length, before);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM captcha WHERE user_id = 8')).c, 0);
  // Let in by an admin's «размут» before the button: no kick later.
  statuses[7] = 'member';
  await onMessage(joinOf(user(7)));
  await say(admin, 'размут', replyTo(user(7)));
  statuses[7] = 'member';
  await afterCaptcha();
  assert.equal(api.called('banChatMember').filter((c) => c.params.user_id === 7).length, 0);
});

test('captcha: leaving before pressing lifts the check\'s mute', async () => {
  const statuses = {};
  const api = await setup(statusApi(statuses));
  await onMessage(joinOf(user(9)));
  statuses[9] = 'muted';
  await onMessage(groupMessage(DISCUSSION, user(9), undefined, { left_chat_member: user(9) }));
  assert.equal(api.called('restrictChatMember').at(-1).params.permissions.can_send_messages, true);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM captcha')).c, 0);
});

test('private chat: фарм and кто я work, chat tops point to the chat', async () => {
  const api = await setup();
  Math.random = () => 0.2;
  await onMessage(privateMessage(user(1), 'фарм'));
  assert.match(lastSent(api), /\+21 XP/);
  await onMessage(privateMessage(user(1), 'кто я'));
  assert.match(lastSent(api), /21 XP/);
  await onMessage(privateMessage(user(1), 'топ дня'));
  assert.match(lastSent(api), /в чате Сквада/);
  // Feedback mode still takes the text as feedback.
  await onCallbackQuery(callback(user(1), 'feedback'));
  await onMessage(privateMessage(user(1), 'фарм'));
  assert.equal(api.called('sendMessage').filter((c) => c.params.chat_id === OWNER.id).length, 1);
});
