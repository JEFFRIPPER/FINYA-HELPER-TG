// Финя в чате: commands in plain words, like Iris («кто я», «топ дня», «фарм»,
// «брак», «обнять», «+», «мут 1ч»…). Works in the Squad chats; a few personal
// ones also work in the private chat.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { deleteLater, setSetting } from './store.js';
import { answer, button, getMe, keyboard } from './tg.js';
import { profileRow, xpTopText } from './ui.js';
import { boldHtml, escapeHtml, fmtMsk, fmtThousands, fullName, nowInt, truncate } from './util.js';
import * as club from './club.js';
import * as members from './members.js';
import * as moder from './moder.js';
import * as social from './social.js';
import * as xp from './xp.js';

const { mention } = moder;
const MAX_TEXT = 500;

export const norm = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const bare = (t) => norm(t).replace(/[\s!.?,)]+$/u, '');
const isGroupChat = (chat) => Boolean(chat) && ['group', 'supergroup'].includes(chat.type);

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

const msgsWord = (n) => `${fmtThousands(n)} ${plural(n, 'сообщение', 'сообщения', 'сообщений')}`;
const daysWord = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

function fmtWait(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  if (!h) return `${Math.max(1, m)} мин`;
  return m ? `${h} ч ${m === 60 ? 59 : m} мин` : `${h} ч`;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---- sending -------------------------------------------------------------------

// A reply to the message. `temp`: in a group, the command and the answer go away later.
async function say(message, text, { markup, temp = false } = {}) {
  const params = {
    chat_id: message.chat.id, text: boldHtml(text), parse_mode: 'HTML',
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  };
  if (markup) params.reply_markup = markup;
  const sent = await api.sendMessage(params);
  if (temp && isGroupChat(message.chat)) await deleteLater(message.chat.id, [message.message_id, sent && sent.message_id]);
  return sent;
}

// ---- who the command is about ----------------------------------------------------

const person = (u) => ({ id: u.id, name: fullName(u) || u.username || 'Участник', isBot: Boolean(u.is_bot), user: u });

// The member replied to, or the first @mention. In a discussion group every comment
// «replies» to the channel post, and in a forum to the topic: those are no target.
export async function targetOf(message) {
  const r = message.reply_to_message;
  const topicRoot = r && message.is_topic_message && r.message_id === message.message_thread_id;
  if (r && r.from && !r.sender_chat && !r.is_automatic_forward && !r.forum_topic_created && !topicRoot &&
      r.from.id !== members.TELEGRAM_SERVICE_ID) {
    return person(r.from);
  }
  const me = await getMe();
  const text = String(message.text || '');
  for (const e of message.entities || []) {
    if (e.type === 'text_mention' && e.user) return person(e.user);
    if (e.type === 'mention') {
      const username = text.slice(e.offset + 1, e.offset + e.length);
      if (username.toLowerCase() === String(me.username || '').toLowerCase()) continue;
      const found = await members.byUsername(message.chat.id, username);
      if (found) return { id: found.id, name: found.name, isBot: false };
    }
  }
  return null;
}

// ---- profile ---------------------------------------------------------------------

async function place(userId, points) {
  if (!points) return null;
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM profiles WHERE xp > ${points} OR (xp = ${points} AND user_id < ${userId})`);
  return row.c + 1;
}

async function profileText(chat, who, self) {
  const p = self ? await xp.profile(who.user) : await db.get(sql`SELECT * FROM profiles WHERE user_id = ${who.id}`);
  const points = p ? p.xp : 0;
  const founder = who.id === OWNER_USER_ID;
  const [rank] = xp.rankFor(points, { founder, manualRank: p ? p.manual_rank : null });
  const top = await place(who.id, points);
  const rep = await social.repOf(who.id);
  const spouse = await social.spouseOf(who.id);
  const ach = await db.get(sql`SELECT COUNT(*) AS c FROM achievements WHERE user_id = ${who.id}`);
  const style = await club.myStyle(who.id);
  const lines = [`👤 ${escapeHtml(truncate(who.name, 60))}${style && style.title ? ` · «${escapeHtml(style.title)}»` : ''}`];
  lines.push(`🎖 ${rank[1]} · ${escapeHtml(rank[2])}`);
  lines.push(`⚡ ${fmtThousands(points)} XP${top ? ` · #${top} в топе` : ''}`);
  lines.push(`❤️ Репутация: ${rep.points}`);
  if (spouse) {
    const partner = await members.nameOf(spouse.partner_id);
    lines.push(`💍 В браке с ${escapeHtml(truncate(partner, 40))} · ${daysWord(social.marriedDays(spouse.since))}`);
  } else {
    lines.push('💔 Не в браке');
  }
  lines.push(`🏆 Ачивок: ${ach.c}`);
  if (isGroupChat(chat)) {
    const st = await members.memberStats(chat.id, who.id);
    if (st) {
      lines.push(`💬 ${msgsWord(st.total)} · сегодня ${st.today}`);
      lines.push(`📅 В чате с ${fmtMsk(st.since).slice(0, 10)}`);
    }
  }
  return lines.join('\n');
}

async function showProfile(message, who, self) {
  if (who.isBot) {
    const me = await getMe();
    const text = who.id === me.id
      ? '🤖 Я Финя, помощница Сквада 🔥\nВсе мои команды: «Финя, команды».'
      : '🤖 Это бот, у ботов нет профиля в Скваде.';
    await say(message, text, { temp: true });
    return;
  }
  const markup = self ? keyboard([await profileRow(message.chat, '👤 Профиль Фини')]) : undefined;
  await say(message, await profileText(message.chat, who, self), { markup, temp: true });
}

// ---- tops and stats --------------------------------------------------------------

const PERIODS = {
  'топ дня': ['day', 'сегодня'],
  'топ недели': ['week', 'эта неделя'],
  'топ месяца': ['month', 'этот месяц'],
  'топ актива': [null, 'всё время'],
  'актив': [null, 'всё время'],
};
const MEDALS = ['🥇', '🥈', '🥉'];
const placeMark = (i) => MEDALS[i] || `${i + 1}.`;

async function activityTopText(chat, period, label) {
  const rows = await members.activityTop(chat.id, period, 10);
  let text = `🏆 Топ актива · ${label}`;
  if (!rows.length) return `${text}\n\nПока пусто: напиши что-нибудь, и ты первый в списке 😉`;
  rows.forEach((r, i) => { text += `\n${placeMark(i)} ${escapeHtml(truncate(r.name, 35))} — ${msgsWord(r.n)}`; });
  return text;
}

async function statsText(chat) {
  const s = await members.chatStats(chat.id);
  let text = '📊 Стата чата\n\n' +
    `💬 Сегодня: ${fmtThousands(s.day)} · неделя: ${fmtThousands(s.week)}\n` +
    `💬 Месяц: ${fmtThousands(s.month)} · всего: ${fmtThousands(s.total)}\n` +
    `👥 Участников: ${s.members} · активных за неделю: ${s.active}`;
  if (s.top.length) {
    text += '\n\n🔥 Сегодня активнее всех:';
    s.top.forEach((r, i) => { text += `\n${placeMark(i)} ${escapeHtml(truncate(r.name, 35))} — ${r.n}`; });
  }
  return text;
}

// ---- farm ------------------------------------------------------------------------

async function farm(message) {
  const u = message.from;
  const name = escapeHtml(truncate(fullName(u), 40));
  const result = await xp.farm(u, xp.farmRoll());
  if (!result) return;
  if (result.wait) {
    await say(message, `⏳ ${name}, фарм ещё не созрел. Приходи через ${fmtWait(result.wait)}.`, { temp: true });
    return;
  }
  const head = result.points > xp.FARM_MAX
    ? `💎 ${name}, редкий фарм! +${result.points} XP`
    : `🌾 ${name}, фарм удался: +${result.points} XP`;
  let text = `${head}\nВсего: ${fmtThousands(result.total)} XP · следующий через ${fmtWait(xp.FARM_COOLDOWN)}`;
  if (result.promoted) text += `\n\n🎖 Новое звание: ${result.newRank[1]} · ${escapeHtml(result.newRank[2])}!`;
  await say(message, text, { temp: true });
}

// ---- reputation ------------------------------------------------------------------

const THANKS = new Set(['+', '++', '+++', '+1', 'спасибо', 'спс', 'благодарю', 'пасиб', 'пасибо', 'сяп', 'респект', 'спасибочки']);

async function plusRep(message, target) {
  const from = message.from;
  if (!target || target.isBot || target.id === from.id) return;
  const n = await social.plus(message.chat.id, message.message_id, from.id, target.id);
  if (n == null) return;
  await say(message, `❤️ ${mention(from.id, fullName(from))} ➜ ${mention(target.id, target.name)}\nРепутация +1, теперь ${n}`);
}

// ---- marriages -------------------------------------------------------------------

async function marriageStatus(message) {
  const s = await social.spouseOf(message.from.id);
  if (!s) {
    await say(message, '💔 Ты не в браке.\nЧтобы сделать предложение, ответь «брак» на сообщение избранника.', { temp: true });
    return;
  }
  const partner = await members.nameOf(s.partner_id);
  await say(message, `💍 Ты в браке с ${escapeHtml(truncate(partner, 40))} уже ${daysWord(social.marriedDays(s.since))}.`, { temp: true });
}

async function propose(message, target) {
  const from = message.from;
  if (target.isBot) {
    await say(message, '🤖 С ботами браки не регистрируем 😅', { temp: true });
    return;
  }
  try {
    await social.propose(message.chat.id, from.id, target.id);
  } catch (err) {
    if (!(err instanceof social.SocialError)) throw err;
    await say(message, `💍 ${err.message}`, { temp: true });
    return;
  }
  const a = mention(from.id, fullName(from));
  const b = mention(target.id, target.name);
  const sent = await say(message, `💍 ${a} делает предложение ${b}!\n\n${b}, твой ответ?`, {
    markup: keyboard([[
      button('💍 Да', { callback_data: `marry:y:${from.id}:${target.id}` }),
      button('💔 Нет', { callback_data: `marry:n:${from.id}:${target.id}` }),
    ]]),
  });
  if (sent && sent.message_id) await social.setProposalMessage(from.id, target.id, sent.message_id);
}

async function couplesText() {
  const rows = await social.couples(15);
  if (!rows.length) return '💒 Пар в Скваде пока нет.\nОтветь «брак» на сообщение избранника, чтобы стать первыми.';
  let text = `💒 Пары Сквада: ${await social.coupleCount()}\n`;
  for (const [i, r] of rows.entries()) {
    const a = escapeHtml(truncate(await members.nameOf(r.a), 30));
    const b = escapeHtml(truncate(await members.nameOf(r.b), 30));
    text += `\n${placeMark(i)} ${a} + ${b} — ${daysWord(social.marriedDays(r.since))}`;
  }
  return text;
}

async function divorcePrompt(message) {
  const s = await social.spouseOf(message.from.id);
  if (!s) {
    await say(message, '💔 Ты и так не в браке.', { temp: true });
    return;
  }
  const partner = await members.nameOf(s.partner_id);
  const uid = message.from.id;
  await say(message, `💔 Точно развод с ${escapeHtml(truncate(partner, 40))}?`, {
    markup: keyboard([[
      button('Да, развод', { callback_data: `div:y:${uid}:${s.partner_id}` }),
      button('Нет', { callback_data: `div:n:${uid}:${s.partner_id}` }),
    ]]),
  });
}

// ---- RP --------------------------------------------------------------------------

async function rp(message, found, target) {
  const actor = message.from;
  const m = /^([^\p{L}\p{N}]+?)\s+(.+)$/u.exec(found.action);
  const [emoji, verb] = m ? [escapeHtml(m[1]), m[2]] : ['✨', found.action];
  const who = target.id === actor.id ? 'себя' : mention(target.id, target.name);
  let text = `${emoji} ${mention(actor.id, fullName(actor))} ${escapeHtml(verb)} ${who}`;
  if (found.rest) text += `\n💬 «${escapeHtml(truncate(found.rest, 200))}»`;
  await say(message, text);
}

async function rpListText() {
  const custom = await social.customActions();
  let text = '🤗 РП-действия\nОтветь словом на сообщение участника (или добавь @ник):\n\n' +
    Object.keys(social.RP_ACTIONS).join(', ');
  if (custom.length) text += '\n\n✨ Свои: ' + custom.map((r) => escapeHtml(r.cmd)).join(', ');
  return text;
}

// ---- fun -------------------------------------------------------------------------

const BALL = [
  'Да', 'Нет', 'Скорее да', 'Скорее нет', 'Без сомнений', 'Даже не думай', 'Спроси позже',
  'Звёзды говорят да', 'Сомневаюсь', 'Определённо да', 'Шансы так себе', 'Сто процентов',
];

async function fun(message, rest) {
  const q = (s) => escapeHtml(truncate(String(s).replace(/[\s?!.]+$/u, ''), 100));
  let m = /^кто\s+(.+)$/iu.exec(rest);
  if (m && isGroupChat(message.chat)) {
    const r = await members.randomMember(message.chat.id);
    if (!r) return false;
    await say(message, `🔮 Кто ${q(m[1])}? Думаю, это ${mention(r.id, r.name)}`);
    return true;
  }
  m = /^(?:инфа|вероятность|шанс)[\s,]+(?:(?:того,?\s+)?что[\s,]+)?(.+)$/iu.exec(rest);
  if (m) {
    await say(message, `🔮 Инфа, что ${q(m[1])}, — ${Math.floor(Math.random() * 101)}%`);
    return true;
  }
  m = /^выбери\s+(.+)$/iu.exec(rest);
  if (m) {
    const options = m[1].split(/\s+или\s+|,|\//iu).map((s) => s.trim()).filter(Boolean);
    const text = options.length < 2 ? '🤔 Дай хотя бы два варианта через «или».' : `🤔 Я выбираю: ${q(pick(options))}`;
    await say(message, text);
    return true;
  }
  if (/\?\s*$/u.test(rest)) {
    await say(message, `🎱 ${pick(BALL)}`);
    return true;
  }
  return false;
}

// ---- help --------------------------------------------------------------------------

function helpText(owner) {
  let text = '🤖 Финя в чате\n\n' +
    '👤 кто я · кто ты (ответом) — профиль\n' +
    '🏆 Финя, топ — по XP · топ дня / недели / месяца — по сообщениям\n' +
    '📊 стата — стата чата\n' +
    `🌾 фарм — случайный XP раз в ${fmtWait(xp.FARM_COOLDOWN)}\n` +
    '❤️ + или «спасибо» ответом — репутация\n' +
    '💍 брак (ответом) · развод · браки\n' +
    '🤗 обнять, поцеловать, ударить… (ответом) · рп — все действия\n' +
    '🔮 Финя, кто… · Финя, инфа… · Финя, выбери А или Б · Финя, вопрос?\n\n' +
    '🛡 Админам (ответом): мут 1ч причина · размут · бан · разбан · кик · варн · снять варн · варны';
  if (owner) {
    text += '\n\n👑 Владельцу: +рп команда = действие · -рп команда · антифлуд вкл/выкл · капча вкл/выкл';
  }
  return text;
}

// ---- owner settings ----------------------------------------------------------------

async function ownerCommand(message, rest) {
  let m = /^\+рп\s+(.+?)\s*=\s*(.+)$/iu.exec(rest);
  if (m) {
    try {
      const cmd = await social.addAction(m[1], m[2]);
      await say(message, `✅ Новое РП-действие «${escapeHtml(cmd)}». Проверь: ответь им на чьё-нибудь сообщение.`);
    } catch (err) {
      if (!(err instanceof social.SocialError)) throw err;
      await say(message, `❌ ${err.message}`);
    }
    return true;
  }
  m = /^-рп\s+(.+)$/iu.exec(rest);
  if (m) {
    const ok = await social.removeAction(m[1]);
    await say(message, ok ? '🗑 Действие удалено.' : 'Такого своего действия нет. Встроенные удалить нельзя.');
    return true;
  }
  m = /^(антифлуд|капча)\s+(вкл|выкл|on|off)$/iu.exec(norm(rest));
  if (m) {
    const on = ['вкл', 'on'].includes(m[2]);
    const key = m[1] === 'антифлуд' ? 'chat_antiflood' : 'chat_captcha';
    await setSetting(key, on);
    await say(message, `${on ? '✅' : '⏸'} ${m[1] === 'антифлуд' ? 'Антифлуд' : 'Капча для новичков'} ${on ? 'включена' : 'выключена'}.`);
    return true;
  }
  return false;
}

// ---- routing -----------------------------------------------------------------------

const PREFIX = /^(?:финя|финька|финечка|финюша)(?=$|[\s,.:!?])[\s,.:!]*/u;

// Strips «Финя,» or «@бот» in front. → [addressed, rest]
async function address(text) {
  const t = text.trim();
  const m = PREFIX.exec(t.toLowerCase().replace(/ё/g, 'е'));
  if (m) return [true, t.slice(m[0].length).trim()];
  const me = await getMe();
  const at = '@' + String(me.username || '').toLowerCase();
  if (me.username && t.toLowerCase().startsWith(at)) return [true, t.slice(at.length).replace(/^[\s,.:!]+/u, '').trim()];
  return [false, t];
}

const MOD_VERBS = /^(мут|размут|бан|разбан|кик|варн|снять варн)(?:\s+([\s\S]*))?$/iu;

// → true when the message was a command for Финя.
export async function handleText(message) {
  const text = typeof message.text === 'string' ? message.text : '';
  if (!text || Array.from(text).length > MAX_TEXT || !message.from || message.from.is_bot || message.sender_chat) return false;
  const group = isGroupChat(message.chat);
  const owner = message.from.id === OWNER_USER_ID;
  const [addressed, rest] = await address(text);
  const cmd = bare(rest);
  const self = person(message.from);

  if (owner && (await ownerCommand(message, rest))) return true;

  if (addressed && !cmd) {
    await say(message, '👋 На месте! Все команды: «Финя, команды».', { temp: true });
    return true;
  }
  if (cmd === 'команды' || (addressed && ['помощь', 'help'].includes(cmd))) {
    await say(message, helpText(owner), { temp: true });
    return true;
  }
  if (['кто я', 'профиль', 'мой профиль', 'кто ты'].includes(cmd)) {
    const asked = ['профиль', 'кто ты'].includes(cmd) && group ? await targetOf(message) : null;
    if (!asked && cmd === 'кто ты') {
      await showProfile(message, person(await getMe()), false);
    } else if (!asked || asked.id === self.id) {
      await showProfile(message, self, true);
    } else {
      await showProfile(message, asked, false);
    }
    return true;
  }
  // A bare «топ» is too often praise («топ!»), so it needs «Финя, топ».
  if ((addressed && cmd === 'топ') || ['топ xp', 'топ хп', 'топ сквада'].includes(cmd)) {
    await say(message, await xpTopText(false), { temp: true });
    return true;
  }
  if (cmd === 'фарм' || cmd === 'ферма') {
    await farm(message);
    return true;
  }
  if (['браки', 'пары', 'список браков'].includes(cmd)) {
    await say(message, await couplesText(), { temp: true });
    return true;
  }
  if (cmd === 'мой брак') {
    await marriageStatus(message);
    return true;
  }
  if (cmd === 'развод') {
    await divorcePrompt(message);
    return true;
  }
  if (['рп', 'рп список', 'список рп', 'рп команды'].includes(cmd)) {
    await say(message, await rpListText(), { temp: true });
    return true;
  }

  if (!group) {
    if (cmd === 'брак') {
      await marriageStatus(message);
      return true;
    }
    if (PERIODS[cmd] || ['стата', 'статистика'].includes(cmd)) {
      await say(message, 'Это работает в чате Сквада: напиши там.');
      return true;
    }
    return addressed ? fun(message, rest) : false;
  }

  // ---- group only ----
  if (PERIODS[cmd]) {
    const [period, label] = PERIODS[cmd];
    await say(message, await activityTopText(message.chat, period, label), { temp: true });
    return true;
  }
  if (['стата', 'статистика', 'стата чата'].includes(cmd)) {
    await say(message, await statsText(message.chat), { temp: true });
    return true;
  }
  const hint = message.reply_to_message || (message.entities || []).some((e) => ['mention', 'text_mention'].includes(e.type));
  const target = hint ? await targetOf(message) : null;
  if (cmd === 'брак') {
    if (target && target.id !== self.id) await propose(message, target);
    else await marriageStatus(message);
    return true;
  }
  if (THANKS.has(cmd) && target) {
    await plusRep(message, target);
    return true;
  }
  const mod = MOD_VERBS.exec(rest.trim());
  if (mod && target) {
    const verb = norm(mod[1]);
    try {
      const out = await moder.act(message.chat.id, self, target, verb, (mod[2] || '').trim());
      await say(message, out.text, { markup: out.markup });
    } catch (err) {
      if (!(err instanceof moder.ModError)) throw err;
      await say(message, `⛔ ${err.message}`, { temp: true });
    }
    return true;
  }
  if (cmd === 'варны' && target) {
    await say(message, await moder.warnsText(message.chat.id, target), { temp: true });
    return true;
  }
  if (target) {
    const found = await social.matchAction(rest);
    if (found) {
      await rp(message, found, target);
      return true;
    }
  }
  if (addressed) return fun(message, rest);
  return false;
}

// Everything a message in a Squad chat goes through, besides XP.
// → { handled: a command for Финя (it earns no XP then), checking: newcomers who must
// press «Я не бот» first (they are greeted after it) }.
export async function onSquadMessage(message, { command = false } = {}) {
  await members.track(message);
  const checking = [];
  for (const u of message.new_chat_members || []) {
    if (members.isPerson(u) && (await moder.onJoin(message.chat, u))) checking.push(u.id);
  }
  if (message.left_chat_member) await moder.onLeave(message.chat.id, message.left_chat_member.id);
  if (await moder.checkFlood(message)) return { handled: false, checking };
  return { handled: command ? false : await handleText(message), checking };
}

// chat_member in a Squad chat: the member list and the newcomer check.
export async function onSquadChatMember(event) {
  await members.handleChatMember(event);
  const m = event.new_chat_member;
  const old = event.old_chat_member && event.old_chat_member.status;
  if (!m || !members.isPerson(m.user)) return;
  if (m.status === 'member' && ['left', 'kicked'].includes(old)) await moder.onJoin(event.chat, m.user);
  if (['left', 'kicked'].includes(m.status)) await moder.onLeave(event.chat.id, m.user.id);
}

// ---- buttons -------------------------------------------------------------------------

async function edit(query, text) {
  try {
    await api.editMessageText({
      chat_id: query.message.chat.id, message_id: query.message.message_id, text: boldHtml(text), parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch {
    // Too old or unchanged.
  }
}

async function marryButton(query, yes, fromId, toId) {
  const presser = query.from.id;
  if (presser !== toId && !(presser === fromId && !yes)) {
    await answer(query, presser === fromId ? 'Ждём ответа второй половинки 💍' : 'Это предложение не тебе 🙂', true);
    return;
  }
  const a = mention(fromId, await members.nameOf(fromId));
  const b = mention(toId, presser === toId ? fullName(query.from) : await members.nameOf(toId));
  if (!yes) {
    const had = await social.decline(fromId, toId);
    await answer(query);
    if (had) await edit(query, presser === fromId ? `💍 ${a} отзывает предложение.` : `💔 ${b} отвечает ${a} отказом.`);
    else await edit(query, '💍 Предложение уже не действует.');
    return;
  }
  try {
    await social.accept(fromId, toId);
  } catch (err) {
    if (!(err instanceof social.SocialError)) throw err;
    await answer(query, err.message, true);
    await edit(query, `💍 ${err.message}`);
    return;
  }
  await answer(query, 'Совет да любовь! 💍');
  await edit(query, `💒 ${a} и ${b} теперь в браке!\nСовет да любовь 🥂`);
}

async function divorceButton(query, yes, userId, partnerId) {
  if (query.from.id !== userId) {
    await answer(query, 'Это решение не за тобой 🙂', true);
    return;
  }
  await answer(query);
  if (!yes) {
    await edit(query, '💍 Брак сохранён.');
    return;
  }
  // The button names the partner: an old prompt cannot end a newer marriage.
  if (!(await social.divorce(userId, partnerId))) {
    await edit(query, '💔 Этого брака уже нет.');
    return;
  }
  await edit(query, `💔 ${mention(userId, fullName(query.from))} и ${mention(partnerId, await members.nameOf(partnerId))} больше не в браке.`);
}

// → true when the button belongs to the chat features.
export async function handleCallback(query) {
  const data = String(query.data || '');
  const m = /^(marry|div|cap|mod):/.exec(data);
  if (!m) return false;
  if (!query.message) {
    await answer(query);
    return true;
  }
  let p;
  if ((p = /^marry:([yn]):(\d+):(\d+)$/.exec(data))) await marryButton(query, p[1] === 'y', Number(p[2]), Number(p[3]));
  else if ((p = /^div:([yn]):(\d+):(\d+)$/.exec(data))) await divorceButton(query, p[1] === 'y', Number(p[2]), Number(p[3]));
  else if ((p = /^cap:(\d+)$/.exec(data))) await moder.captchaButton(query, Number(p[1]));
  else if ((p = /^mod:unmute:(\d+)$/.exec(data))) await moder.unmuteButton(query, Number(p[1]));
  else await answer(query);
  return true;
}

// From pump().
export async function tick(leftMs) {
  await moder.tick(leftMs);
}

// For the Mini App profile.
export async function profileExtras(userId) {
  const rep = await social.repOf(userId);
  const s = await social.spouseOf(userId);
  let marriage = null;
  if (s) {
    marriage = {
      name: truncate(await members.nameOf(s.partner_id), 40),
      since: s.since,
      days: social.marriedDays(s.since),
    };
  }
  return { rep: rep.points, marriage };
}
