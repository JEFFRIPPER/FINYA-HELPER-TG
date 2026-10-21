// Финя в чате: commands in plain words, like Iris («кто я», «топ дня», «фарм»,
// «брак», «обнять», «+», «мут 1ч»…). Works in the Squad chats; a few personal
// ones also work in the private chat.
import { api, BotApiError, db, InputFile } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID, WEBAPP_URL } from './config.js';
import { deleteLater, getSetting, setSetting } from './store.js';
import { answer, button, getMe, keyboard } from './tg.js';
import { profileRow, xpTopText } from './ui.js';
import { boldHtml, escapeHtml, fmtMsk, fmtThousands, fullName, nowInt, truncate } from './util.js';
import * as bio from './bio.js';
import { activityChart } from './chart.js';
import * as club from './club.js';
import { withPremium } from './emoji.js';
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
// Commands are shown Title Case («Кто Я», «Дать Пять»); typing them works in any case.
const titleCase = (s) => String(s).replace(/(^|[\s«/-])(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());

// ---- sending -------------------------------------------------------------------

// Without a reply to the message: still in its topic or under the same post.
function sameThread(message) {
  if (!message.message_thread_id) return {};
  if (message.is_topic_message) return { message_thread_id: message.message_thread_id };
  return { reply_parameters: { message_id: message.message_thread_id, allow_sending_without_reply: true } };
}

// A reply to the message (or to `replyTo`; null — no reply). `temp`: in a group, the
// command and the answer go away later.
async function say(message, text, { markup, temp = false, replyTo = message.message_id } = {}) {
  const params = {
    chat_id: message.chat.id, text: boldHtml(text), parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : sameThread(message)),
  };
  if (markup) params.reply_markup = markup;
  const sent = await withPremium(params, (p) => api.sendMessage(p));
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

// «2 года 2 мес», «11 мес 21 дн», «5 дней», «3 ч 10 мин».
function ageText(seconds) {
  const sec = Math.max(0, Math.floor(seconds));
  const days = Math.floor(sec / 86400);
  if (days >= 365) {
    const y = Math.floor(days / 365.25);
    const mo = Math.floor((days - y * 365.25) / 30.44);
    return `${y} ${plural(y, 'год', 'года', 'лет')}${mo ? ` ${mo} мес` : ''}`;
  }
  if (days >= 30) {
    const mo = Math.floor(days / 30.44);
    const d = Math.floor(days - mo * 30.44);
    return `${mo} мес${d ? ` ${d} дн` : ''}`;
  }
  if (days) return daysWord(days);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return `${h} ч${m ? ` ${m} мин` : ''}`;
  return `${Math.max(1, m)} мин`;
}

const agoText = (seconds) => (seconds < 60 ? 'только что' : `${ageText(seconds)} назад`);

// 742 · 7,1k · 69,2k · 1,2m — as Iris writes them.
function compact(n) {
  if (n < 1000) return String(n);
  const [v, unit] = n < 1e6 ? [n / 1000, 'k'] : [n / 1e6, 'm'];
  return `${v < 100 ? String(Math.floor(v * 10) / 10).replace('.', ',') : Math.floor(v)}${unit}`;
}

// «Создатель этого чата» or «Админ этого чата», with the admin's tag.
async function chatRole(chatId, userId) {
  const m = await moder.memberOf(chatId, userId);
  if (!m || typeof m !== 'object') return null;
  const tag = m.custom_title ? ` · «${escapeHtml(truncate(m.custom_title, 30))}»` : '';
  if (m.status === 'creator') return `👑 Создатель этого чата${tag}`;
  if (m.status === 'administrator') return `⭐ Админ этого чата${tag}`;
  return null;
}

const ABOUT_PREVIEW = 160;

// The profile, like Iris has it: who, rank and XP, activity in this chat, «о себе»
// and awards. → { text, card } (card: activity in this chat, for the chart).
async function profileCard(chat, who, self) {
  const ts = nowInt();
  const p = self ? await xp.profile(who.user) : await db.get(sql`SELECT * FROM profiles WHERE user_id = ${who.id}`);
  const points = p ? p.xp : 0;
  const founder = who.id === OWNER_USER_ID;
  const [rank] = xp.rankFor(points, { founder, manualRank: p ? p.manual_rank : null });
  const top = await place(who.id, points);
  const rep = await social.repOf(who.id);
  const spouse = await social.spouseOf(who.id);
  const ach = await db.get(sql`SELECT COUNT(*) AS c FROM achievements WHERE user_id = ${who.id}`);
  const style = await club.myStyle(who.id);
  const group = isGroupChat(chat);

  const head = [`👤 Это пользователь ${escapeHtml(truncate(who.name, 60))}${style && style.title ? ` · «${escapeHtml(style.title)}»` : ''}`];
  const role = group ? await chatRole(chat.id, who.id) : null;
  if (role) head.push(role);
  if (spouse) {
    const partner = await members.nameOf(spouse.partner_id);
    head.push(`💍 В браке с ${escapeHtml(truncate(partner, 40))} · ${daysWord(social.marriedDays(spouse.since))}`);
  }

  const stats = [
    `🎖 [${rank[1]}] Звание: ${escapeHtml(rank[2])}`,
    `⚡ ${fmtThousands(points)} XP${top ? ` · #${top} в топе` : ''}`,
    `🏆 Ачивок: ${ach.c}`,
    `❤️ Репутация: ${rep.points}${rep.given ? ` · ➕ отдано ${rep.given}` : ''}`,
  ];
  const card = group ? await members.memberCard(chat.id, who.id, ts) : null;
  if (card) {
    stats.push(
      `🏠 Первое появление: ${fmtMsk(card.since).slice(0, 10)} (${ts - card.since < 86400 ? 'сегодня' : ageText(ts - card.since)})`,
      `🕒 Последний актив: ${card.lastActive ? agoText(ts - card.lastActive) : 'сообщений не было'}`,
      `💬 Актив (д|н|м|весь): ${[card.day, card.week, card.month, card.total].map(compact).join(' | ')}`,
    );
  }
  const blocks = [head.join('\n'), stats.join('\n')];

  const about = await bio.aboutOf(who.id);
  if (about) {
    const long = Array.from(about).length > ABOUT_PREVIEW;
    // A long one is cut on a word, the rest is a command away.
    const shown = long ? `${Array.from(about).slice(0, ABOUT_PREVIEW).join('').replace(/\s+\S*$/u, '')}…` : about;
    blocks.push(`📝 О себе:\n<blockquote>${escapeHtml(shown)}</blockquote>` +
      (long ? `\nЦеликом: «Описание»${self ? '' : ' ответом'}` : ''));
  } else if (self) {
    blocks.push('📝 О себе: пусто. Напиши «+Описание» и пару строк о себе');
  }
  const awards = await bio.awardsOf(who.id);
  if (awards.length) {
    const shown = awards.slice(0, 5).map((a) => `🎖 ${escapeHtml(a.text)}, ${ageText(ts - a.given_at)}`);
    if (awards.length > 5) shown.push(`…и ещё ${awards.length - 5}: «Награды»${self ? '' : ' ответом'}`);
    blocks.push(`🏅 Награды:\n${shown.join('\n')}`);
  }
  return { text: blocks.join('\n\n'), card };
}

// A photo caption holds 1024 characters of text, tags aside.
const CAPTION_MAX = 1024;
const visibleLength = (html) => Array.from(String(html).replace(/<[^>]*>/g, '').replace(/&(?:lt|gt|amp|quot|#39);/g, '_')).length;

async function sayPhoto(message, png, caption, { markup, temp = false } = {}) {
  const params = {
    chat_id: message.chat.id, photo: new InputFile(png, 'activity.png', { type: 'image/png' }),
    caption: boldHtml(caption), parse_mode: 'HTML',
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
  };
  if (markup) params.reply_markup = markup;
  const sent = await withPremium(params, (p) => api.sendPhoto(p));
  if (temp && isGroupChat(message.chat)) await deleteLater(message.chat.id, [message.message_id, sent && sent.message_id]);
  return sent;
}

// The member's messages per day in this chat: the last year, or a month for a newcomer.
function chartOf(card, ts) {
  const today = members.mskDay(ts);
  const first = card.days.size ? Math.min(...card.days.keys()) : today;
  const from = Math.min(today - 29, Math.max(first, today - members.CHART_DAYS + 1));
  return activityChart(card.days, from, today, members.periodStart('week', ts));
}

async function showProfile(message, who, self) {
  if (who.isBot) {
    const me = await getMe();
    const text = who.id === me.id
      ? '🤖 Я Финя, помощница Сквада 🔥\nВсе мои команды: «Финя, Команды».'
      : '🤖 Это бот, у ботов нет профиля в Скваде.';
    await say(message, text, { temp: true });
    return;
  }
  const markup = self ? keyboard([await profileRow(message.chat, '👤 Профиль Фини')]) : undefined;
  const { text, card } = await profileCard(message.chat, who, self);
  // With the chart on top, as Iris does; no right to send photos — just the text.
  if (card && visibleLength(text) <= CAPTION_MAX) {
    try {
      await sayPhoto(message, chartOf(card, nowInt()), text, { markup, temp: true });
      return;
    } catch (err) {
      if (!(err instanceof BotApiError)) throw err;
    }
  }
  await say(message, text, { markup, temp: true });
}

// «Описание»: the whole «о себе» of a member.
async function aboutText(who, self) {
  const about = await bio.aboutOf(who.id);
  const name = escapeHtml(truncate(who.name, 60));
  if (!about) return self ? '📝 О себе пока пусто. Напиши «+Описание» и пару строк о себе.' : `📝 О себе · ${name}\nПока пусто.`;
  return `📝 О себе · ${name}\n<blockquote>${escapeHtml(about)}</blockquote>`;
}

// «Награды»: all awards, numbered for «Снять Награду N».
async function awardsText(who) {
  const list = await bio.awardsOf(who.id);
  const name = escapeHtml(truncate(who.name, 60));
  if (!list.length) return `🏅 Награды · ${name}\nПока пусто. Наградить могут админы чата: «Наградить Текст» ответом.`;
  const ts = nowInt();
  return `🏅 Награды · ${name}\n\n` + list.map((a, i) => `${i + 1}. ${escapeHtml(a.text)}, ${ageText(ts - a.given_at)}`).join('\n');
}

// Awards are handed out by the chat's creator and admins (and the owner).
async function canAward(chatId, userId) {
  if (userId === OWNER_USER_ID) return true;
  const m = await moder.memberOf(chatId, userId);
  return Boolean(m) && (m.status === 'creator' || m.status === 'administrator');
}

async function awardCommand(message, self, target, value) {
  if (!(await canAward(message.chat.id, self.id))) {
    await say(message, '🏅 Награждать могут только админы чата.', { temp: true });
    return;
  }
  if (target.isBot) {
    await say(message, '🤖 Ботам награды ни к чему.', { temp: true });
    return;
  }
  try {
    // «наградить @ник Текст»: the mention is not part of the award.
    const award = await bio.giveAward(message.chat.id, self.id, target.id, String(value || '').replace(/^@\w+\s*/u, ''));
    await say(message, `🏅 ${mention(target.id, target.name)} получает награду «${escapeHtml(award)}»!`);
  } catch (err) {
    if (!(err instanceof bio.BioError)) throw err;
    await say(message, `❌ ${err.message}`, { temp: true });
  }
}

// ---- tops and stats --------------------------------------------------------------

// One panel for the chat's activity, switched by buttons under it.
const STAT_PERIODS = {
  day: ['День', 'сегодня'],
  week: ['Неделя', 'эта неделя'],
  month: ['Месяц', 'этот месяц'],
  all: ['Всё время', 'всё время'],
};
// Words that open the panel, and on which period.
const STAT_WORDS = {
  'стата': 'day', 'статистика': 'day', 'стата чата': 'day', 'актив': 'all', 'топ актива': 'all',
  'топ дня': 'day', 'топ недели': 'week', 'топ месяца': 'month',
};
const STAT_LIST = 20;
const MEDALS = ['🥇', '🥈', '🥉'];
const placeMark = (i) => MEDALS[i] || `${i + 1}.`;

const statsKeyboard = (period) => keyboard([Object.entries(STAT_PERIODS).map(([key, [label]]) =>
  button(key === period ? `• ${label}` : label, { callback_data: `stat:${key}` }))]);

async function statsPanel(chatId, period) {
  const s = await members.periodStats(chatId, period, STAT_LIST);
  let text = `📊 Стата чата · ${STAT_PERIODS[period][1]}\n\n👥 Участников: ${s.members} · писали: ${s.writers}\n`;
  if (!s.top.length) text += '\nПока никто не писал: напиши что-нибудь, и ты первый в списке 😉\n';
  s.top.forEach((r, i) => { text += `\n${placeMark(i)} ${escapeHtml(truncate(r.name, 35))} — ${msgsWord(r.n)}`; });
  if (s.writers > s.top.length) text += `\n…и ещё ${s.writers - s.top.length}`;
  text += `\n\n💬 Всего сообщений: ${fmtThousands(s.messages)}`;
  return { text, markup: statsKeyboard(period) };
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
  // «Спасибо» is common: the confirmation goes away, the reputation stays.
  await say(message, `❤️ ${mention(from.id, fullName(from))} ➜ ${mention(target.id, target.name)}\nРепутация +1, теперь ${n}`, { temp: true });
}

// ---- marriages -------------------------------------------------------------------

async function marriageStatus(message) {
  const s = await social.spouseOf(message.from.id);
  if (!s) {
    await say(message, '💔 Ты не в браке.\nЧтобы сделать предложение, ответь «Брак» на сообщение избранника.', { temp: true });
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
  if (!rows.length) return '💒 Пар в Скваде пока нет.\nОтветь «Брак» на сообщение избранника, чтобы стать первыми.';
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
  // In a group the command itself goes away: Финя's line answers the target's message.
  if (!isGroupChat(message.chat)) {
    await say(message, text);
    return;
  }
  const r = message.reply_to_message;
  await say(message, text, { replyTo: r && r.from && r.from.id === target.id ? r.message_id : null });
  try {
    await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id });
  } catch {
    // No rights to delete: the command stays.
  }
}

async function rpListText() {
  const custom = await social.customActions();
  let text = '🤗 РП-действия\nОтветь словом на сообщение участника (или добавь @ник):\n\n' +
    Object.keys(social.RP_ACTIONS).map(titleCase).join(', ');
  if (custom.length) text += '\n\n✨ Свои: ' + custom.map((r) => escapeHtml(titleCase(r.cmd))).join(', ');
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

// Each command with its description quoted under it.
function helpText(owner, moderation) {
  const rows = [
    ['👤 Кто Я · Кто Ты (ответом)', 'Профиль с графиком актива: звание, XP, репутация, актив за день, неделю, месяц и всё время, о себе и награды'],
    ['📝 +Описание Текст · -Описание · Описание (ответом)', 'Пара строк о себе в профиле. «Описание» покажет целиком'],
    ['🏅 Награды (ответом) · Наградить Текст (ответом)', 'Награды участника. Награждают и снимают («Снять Награду N») админы чата'],
    ['🏆 Финя, Топ', 'Топ Сквада по XP'],
    ['📊 Стата · Топ Дня / Недели / Месяца', 'Актив чата и список участников, период переключается кнопками'],
    ['🌾 Фарм', `Случайный XP раз в ${fmtWait(xp.FARM_COOLDOWN)}, иногда редкий — до ${xp.FARM_RARE_MAX}`],
    ['❤️ + или «Спасибо» (ответом)', 'Репутация участнику, без лимита'],
    ['💍 Брак (ответом) · Развод · Браки', 'Предложение руки и сердца, развод и все пары Сквада'],
    ['🤗 Обнять, Поцеловать, Ударить… (ответом)', 'РП-действия. Весь список: «РП»'],
    ['🔮 Финя, Кто… · Финя, Инфа…', 'Финя выберет участника или назовёт шанс в процентах'],
    ['🤔 Финя, Выбери А или Б · Финя, Вопрос?', 'Выбор из вариантов и ответ «да» или «нет»'],
  ];
  if (moderation) {
    rows.push(['🛡 Мут 1ч · Размут · Бан · Разбан · Кик · Варн · Снять Варн · Варны',
      'Для админов, ответом на сообщение. Причину пиши с новой строки']);
  }
  if (owner) {
    rows.push(
      ['👑 +РП Команда = Действие · -РП Команда', 'Владельцу: свои РП-действия'],
      ['👑 Антифлуд / Капча / Модерация Вкл/Выкл', 'Владельцу: защита чата'],
      ['✨ Эмодзи (в личке)', 'Владельцу: премиум-эмодзи Фини'],
      ['📥 Обновить Инфо', 'Владельцу: подтянуть старую историю чата из экспорта Telegram Desktop'],
    );
  }
  return '🤖 Финя в чате\n\n' + rows.map(([cmd, about]) => `${cmd}\n<blockquote>${about}</blockquote>`).join('\n');
}

// ---- owner settings ----------------------------------------------------------------

const SWITCHES = {
  'антифлуд': ['chat_antiflood', 'Антифлуд', 'включён', 'выключен'],
  'капча': ['chat_captcha', 'Капча для новичков', 'включена', 'выключена'],
  'модерация': ['chat_moderation', 'Модерация командами', 'включена', 'выключена'],
};

export const HISTORY_TEXT = '📥 Обновить инфо: старая история чата\n\n'
  + 'Боты не видят сообщения, которые были до них, даже с правами админа. Поэтому историю берём из экспорта:\n'
  + '1. Telegram Desktop → чат → ⋮ → «Экспорт истории чата».\n'
  + '2. Сними галочки с медиа, формат — «Машиночитаемый JSON».\n'
  + '3. «Панель» в Mini App → «История чата» → выбери файл result.json.\n\n'
  + 'Файл читается на устройстве, Фине уходит только, кто и сколько писал по дням. Повторная загрузка ничего не задвоит.';

export async function historyKeyboard(chat) {
  if (!chat || chat.type === 'private') {
    return keyboard([[button('📥 Открыть загрузку', { web_app: { url: `${WEBAPP_URL}?tab=admin&open=history` } })]]);
  }
  const me = await getMe();
  return keyboard([[button('📥 Открыть загрузку', { url: `https://t.me/${me.username}?start=history` })]]);
}

async function ownerCommand(message, rest) {
  if (/^обновить\s+инфо$/u.test(norm(rest))) {
    await say(message, HISTORY_TEXT, { markup: await historyKeyboard(message.chat), temp: true });
    return true;
  }
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
  m = /^(антифлуд|капча|модерация)\s+(вкл|выкл|on|off)$/iu.exec(norm(rest));
  if (m) {
    const on = ['вкл', 'on'].includes(m[2]);
    const [key, name, onWord, offWord] = SWITCHES[m[1]];
    await setSetting(key, on);
    await say(message, `${on ? '✅' : '⏸'} ${name} ${on ? onWord : offWord}.`);
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

const MOD_VERBS = /^(мут|размут|бан|разбан|кик|варн|снять\s+варн)(?:[ \t]+([\s\S]*)|\n([\s\S]*))?$/iu;

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
    await say(message, '👋 На месте! Все команды: «Финя, Команды».', { temp: true });
    return true;
  }
  if (cmd === 'команды' || (addressed && ['помощь', 'help'].includes(cmd))) {
    await say(message, helpText(owner, await getSetting('chat_moderation')), { temp: true });
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
  // «О себе» and awards, as Iris has them.
  const aboutSet = /^\+\s?описание(?:\s+([\s\S]*))?$/iu.exec(rest.trim());
  if (aboutSet) {
    try {
      await bio.setAbout(self.id, aboutSet[1]);
      await say(message, '📝 Описание обновлено. Посмотреть: «Кто Я».', { temp: true });
    } catch (err) {
      if (!(err instanceof bio.BioError)) throw err;
      await say(message, `❌ ${err.message}`, { temp: true });
    }
    return true;
  }
  if (cmd === '-описание' || cmd === '- описание') {
    const removed = await bio.clearAbout(self.id);
    await say(message, removed ? '🗑 Описание удалено.' : 'Описания и так нет.', { temp: true });
    return true;
  }
  const view = /^(описание|награды)(?:\s+@\w+)?$/u.exec(cmd);
  if (view) {
    const asked = group ? await targetOf(message) : null;
    const who = asked || self;
    const text = view[1] === 'описание' ? await aboutText(who, who.id === self.id) : await awardsText(who);
    await say(message, text, { temp: true });
    return true;
  }

  if (!group) {
    if (cmd === 'брак') {
      await marriageStatus(message);
      return true;
    }
    if (STAT_WORDS[cmd]) {
      await say(message, 'Это работает в чате Сквада: напиши там.');
      return true;
    }
    return addressed ? fun(message, rest) : false;
  }

  // ---- group only ----
  if (STAT_WORDS[cmd]) {
    const { text: stats, markup } = await statsPanel(message.chat.id, STAT_WORDS[cmd]);
    await say(message, stats, { markup, temp: true });
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
  const give = /^наградить(?:\s+([\s\S]*))?$/iu.exec(rest.trim());
  if (give && target) {
    await awardCommand(message, self, target, give[1]);
    return true;
  }
  const take = /^(?:-\s?награда|снять\s+награду)\s+(\d{1,3})$/u.exec(cmd);
  if (take && target) {
    if (!(await canAward(message.chat.id, self.id))) {
      await say(message, '🏅 Снимать награды могут только админы чата.', { temp: true });
      return true;
    }
    const removed = await bio.removeAward(target.id, Number(take[1]));
    await say(message, removed ? `🗑 Награда «${escapeHtml(removed)}» снята.` : 'Такой награды нет. Номера — в «Награды» ответом.', { temp: true });
    return true;
  }
  const mod = target && MOD_VERBS.exec(rest.trim());
  const moderation = mod || cmd === 'варны' ? await getSetting('chat_moderation') : false;
  const parsed = mod && moderation
    ? moder.parseCommandArgs(norm(mod[1]), mod[2] || (mod[3] ? '\n' + mod[3] : '')) : null;
  if (parsed) {
    const verb = norm(mod[1]);
    try {
      const out = await moder.act(message.chat.id, self, target, verb, parsed);
      await say(message, out.text, { markup: out.markup });
    } catch (err) {
      if (!(err instanceof moder.ModError)) throw err;
      await say(message, `⛔ ${err.message}`, { temp: true });
    }
    return true;
  }
  if (cmd === 'варны' && target && moderation) {
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
    if (members.isPerson(u) && (await moder.onJoin(message.chat, u, message.message_id))) checking.push(u.id);
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
  if (['left', 'kicked'].includes(m.status)) await moder.onLeave(event.chat.id, m.user.id, { banned: m.status === 'kicked' });
}

// ---- buttons -------------------------------------------------------------------------

async function edit(query, text, markup) {
  const params = {
    chat_id: query.message.chat.id, message_id: query.message.message_id, text: boldHtml(text), parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };
  if (markup) params.reply_markup = markup;
  try {
    await withPremium(params, (p) => api.editMessageText(p));
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

// Anyone in the chat switches the period; the panel is edited in place.
async function statsButton(query, period) {
  await answer(query);
  const { text, markup } = await statsPanel(query.message.chat.id, period);
  await edit(query, text, markup);
}

// → true when the button belongs to the chat features.
export async function handleCallback(query) {
  const data = String(query.data || '');
  const m = /^(marry|div|cap|mod|stat):/.exec(data);
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
  else if ((p = /^stat:(day|week|month|all)$/.exec(data))) await statsButton(query, p[1]);
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
