// Финя в чате: commands in plain words, like Iris («кто я», «топ дня», «фарм»,
// «брак», «обнять», «+», «мут 1ч»…). Works in the Squad chats; a few personal
// ones also work in the private chat.
import { api, BotApiError, db, InputFile } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID, WEBAPP_URL } from './config.js';
import { squadChatIds } from './xpchat.js';
import { deleteLater, getSetting, GROUP_REPLY_TTL, logError, setSetting } from './store.js';
import { answer, button, CLOSE_PREFIX, closeRowOf, getMe, keyboard, sendWithFloodWait, withClose } from './tg.js';
import { profileRow, xpTopText } from './ui.js';
import { boldHtml, escapeHtml, fmtMsk, fmtThousands, fullName, MSK_OFFSET, nowInt, truncate } from './util.js';
import * as anketa from './anketa.js';
import * as bio from './bio.js';
import { activityChart } from './chart.js';
import * as club from './club.js';
import * as extras from './extras.js';
import * as questions from './questions.js';
import * as navigator from './navigator.js';
import { withPremium } from './emoji.js';
import { DATIVE } from './inline.js';
import * as feats from './feats.js';
import * as games from './games.js';
import * as members from './members.js';
import * as moder from './moder.js';
import * as reminders from './reminders.js';
import * as social from './social.js';
import * as staff from './staff.js';
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
  const closable = temp && isGroupChat(message.chat) && message.from;
  if (markup || closable) params.reply_markup = closable ? withClose(markup, message.from.id) : markup;
  const sent = await withPremium(params, (p) => api.sendMessage(p));
  if (temp && isGroupChat(message.chat)) await deleteLater(message.chat.id, [message.message_id, sent && sent.message_id]);
  return sent;
}

// ---- who the command is about ----------------------------------------------------

const person = (u) => ({ id: u.id, name: fullName(u) || u.username || 'Участник', isBot: Boolean(u.is_bot), user: u });

// The nick («+ник») instead of the Telegram name, when set.
async function withNick(p) {
  const nick = p && !p.isBot ? await bio.nickOf(p.id) : null;
  return nick ? { ...p, name: nick } : p;
}

async function nameFor(u) {
  return (await bio.nickOf(u.id)) || fullName(u) || u.username || 'Участник';
}

// The member replied to, or the first @mention. In a discussion group every comment
// «replies» to the channel post, and in a forum to the topic: those are no target.
function repliedTo(message) {
  const r = message.reply_to_message;
  const topicRoot = r && message.is_topic_message && r.message_id === message.message_thread_id;
  if (r && r.from && !r.sender_chat && !r.is_automatic_forward && !r.forum_topic_created && !topicRoot &&
      r.from.id !== members.TELEGRAM_SERVICE_ID) {
    return r.from;
  }
  return null;
}

export async function targetOf(message) {
  const replied = repliedTo(message);
  if (replied) return withNick(person(replied));
  const me = await getMe();
  const text = String(message.text || '');
  for (const e of message.entities || []) {
    if (e.type === 'text_mention' && e.user) return withNick(person(e.user));
    if (e.type === 'mention') {
      const username = text.slice(e.offset + 1, e.offset + e.length);
      if (username.toLowerCase() === String(me.username || '').toLowerCase()) continue;
      const found = await members.byUsername(message.chat.id, username);
      if (found) return withNick({ id: found.id, name: found.name, isBot: false });
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
  if (days >= 366) {
    const y = Math.floor(days / 365.25);
    const mo = Math.floor((days - y * 365.25) / 30.44);
    return `${y} ${plural(y, 'год', 'года', 'лет')}${mo ? ` ${mo} мес` : ''}`;
  }
  if (days >= 31) {
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
  const group = isGroupChat(chat);
  // Independent reads, all at once: the card is the slowest reply in the chat.
  const [top, rep, spouse, dating, ach, style, role, home, jobs, sign, card, about, awards] = await Promise.all([
    place(who.id, points),
    social.repOf(who.id),
    social.spouseOf(who.id),
    social.partnerOf(who.id),
    db.get(sql`SELECT COUNT(*) AS c FROM achievements WHERE user_id = ${who.id}`),
    club.myStyle(who.id),
    group ? chatRole(chat.id, who.id) : null,
    anketa.citizenshipOf(who.id),
    staff.positionsOf(who.id),
    extras.zodiacOf(who.id),
    group ? members.memberCard(chat.id, who.id, ts) : null,
    bio.aboutOf(who.id),
    bio.awardsOf(who.id),
  ]);

  const head = [`👤 Это пользователь ${escapeHtml(truncate(who.name, 60))}${style && style.title ? ` · «${escapeHtml(style.title)}»` : ''}`];
  if (role) head.push(role);
  if (home) {
    head.push(group && home.chat_id === chat.id
      ? `🏡 Гражданство: этот чат · ${ts - home.since < 86400 ? 'с сегодня' : ageText(ts - home.since)}`
      : `🏡 Гражданство: чат «${escapeHtml(truncate(await anketa.chatTitle(home.chat_id), 40))}»`);
  }
  if (jobs.length) head.push(`💼 Должность: ${jobs.map((j) => `${j.emoji} ${escapeHtml(j.title)}`).join(', ')}`);
  if (spouse) {
    const partner = await members.nameOf(spouse.partner_id);
    head.push(`💍 Брак: ${escapeHtml(truncate(partner, 40))} · ${daysWord(social.marriedDays(spouse.since))}`);
  } else if (dating) {
    const partner = await members.nameOf(dating.partner_id);
    head.push(`💞 Отношения: ${escapeHtml(truncate(partner, 40))} · ${daysWord(social.marriedDays(dating.since))}`);
  }

  const stats = [
    `🎖 [${rank[1]}] Звание: ${escapeHtml(rank[2])}`,
    `⚡ ${fmtThousands(points)} XP${top ? ` · #${top} в топе` : ''}`,
    `🏆 Ачивок: ${ach.c}`,
    `❤️ Репутация: ${rep.points}${rep.given ? ` · ➕ отдано ${rep.given}` : ''}`,
  ];
  if (!who.isBot) stats.push(`📅 В Telegram: примерно с ${extras.accountSinceText(who.id, ts)}`);
  if (sign) stats.push(`${sign.emoji} Знак зодиака: ${sign.name}`);
  if (card) {
    stats.push(
      `🏠 Первое появление: ${fmtMsk(card.since).slice(0, 10)} (${ts - card.since < 86400 ? 'сегодня' : ageText(ts - card.since)})`,
      `🕒 Последний актив: ${card.lastActive ? agoText(ts - card.lastActive) : 'сообщений не было'}`,
      `💬 Актив (д|н|м|весь): ${[card.day, card.week, card.month, card.total].map(compact).join(' | ')}`,
    );
  }
  const blocks = [head.join('\n'), stats.join('\n')];

  if (about) {
    const long = Array.from(about).length > ABOUT_PREVIEW;
    // A long one is cut on a word, the rest is a command away.
    const shown = long ? `${Array.from(about).slice(0, ABOUT_PREVIEW).join('').replace(/\s+\S*$/u, '')}…` : about;
    blocks.push(`📝 О себе:\n<blockquote>${escapeHtml(shown)}</blockquote>` +
      (long ? `\nЦеликом: «Описание»${self ? '' : ' ответом'}` : ''));
  } else if (self) {
    blocks.push('📝 О себе: пусто. Напиши «+Описание» и пару строк о себе');
  }
  if (awards.length) {
    const shown = awards.slice(0, 5).map((a) => `${bio.degreeIcon(a.degree)} ${escapeHtml(a.text)}`);
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
  const closable = temp && isGroupChat(message.chat) && message.from;
  if (markup || closable) params.reply_markup = closable ? withClose(markup, message.from.id) : markup;
  const sent = await withPremium(params, (p) => api.sendPhoto(p));
  if (temp && isGroupChat(message.chat)) await deleteLater(message.chat.id, [message.message_id, sent && sent.message_id]);
  return sent;
}

// The member's messages per day in this chat: the last year, or a month for a newcomer.
function chartOf(card, ts, theme = null) {
  const today = members.mskDay(ts);
  const first = card.days.size ? Math.min(...card.days.keys()) : today;
  const from = Math.min(today - 29, Math.max(first, today - members.CHART_DAYS + 1));
  return activityChart(card.days, from, today, members.periodStart('week', ts), theme);
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
      await sayPhoto(message, chartOf(card, nowInt(), await club.chartTheme(who.id)), text, { markup, temp: true });
      return;
    } catch (err) {
      if (!(err instanceof BotApiError)) throw err;
    }
  }
  await say(message, text, { markup, temp: true });
}

// ---- «Моя анкета»: the member across every Squad chat ------------------------------

const pad2 = (n) => String(n).padStart(2, '0');
// A Moscow day number as «14.10.2026».
const dateOfDay = (day) => fmtMsk(day * 86400 - MSK_OFFSET + 12 * 3600).slice(0, 10);
const HOUR_MOODS = [[5, '🦉 ночная сова'], [11, '🐦 жаворонок'], [18, '☀️ днём'], [24, '🌆 вечером']];
const HOMES_SHOWN = 5;

function birthText(birth, ts) {
  const age = anketa.ageOf(birth, ts);
  return `${pad2(birth.day)}.${pad2(birth.month)}${birth.year ? `.${birth.year}` : ''}` +
    `${age != null ? ` (${age} ${plural(age, 'год', 'года', 'лет')})` : ''} · ${anketa.zodiac(birth.day, birth.month)}`;
}

// → { text, days } (days: messages per day over all Squad chats, for the chart).
async function anketaCard(who, self) {
  const ts = nowInt();
  const info = await anketa.infoOf(who.id);
  const d = await anketa.anketaData(who.id, ts);
  const p = await db.get(sql`SELECT xp, manual_rank FROM profiles WHERE user_id = ${who.id}`);
  const points = p ? p.xp : 0;
  const [rank] = xp.rankFor(points, { founder: who.id === OWNER_USER_ID, manualRank: p ? p.manual_rank : null });

  const head = [`📋 Анкета · ${escapeHtml(truncate(who.name, 60))}`];
  if (self) head.push(`🆔 <code>${who.id}</code>`);

  const about = [];
  if (d.since) about.push(`⏱ В Скваде: с ${fmtMsk(d.since).slice(0, 10)} (${ts - d.since < 86400 ? 'сегодня' : ageText(ts - d.since)})`);
  about.push(`📅 В Telegram: примерно с ${extras.accountSinceText(who.id, ts)}`);
  if (info.gender) about.push(info.gender === 'f' ? '👩 Пол: женский' : '👨 Пол: мужской');
  if (info.birth) about.push(`🎂 Дата рождения: ${birthText(info.birth, ts)}`);
  if (info.city) about.push(`🏙 Город: ${escapeHtml(info.city)}`);
  about.push(`💬 Актив (д|н|м|всего): ${[d.day, d.week, d.month, d.total].map(compact).join(' | ')}`);
  if (d.streak.best) {
    about.push(d.streak.current
      ? `🔥 Серия: ${daysWord(d.streak.current)} подряд · рекорд ${d.streak.best}`
      : `🔥 Рекорд серии: ${daysWord(d.streak.best)} подряд`);
  }
  if (d.record) about.push(`🏆 Рекордный день: ${msgsWord(d.record.n)}, ${dateOfDay(d.record.day)}`);
  if (d.peak != null) {
    const mood = HOUR_MOODS.find(([until]) => d.peak < until)[1];
    about.push(`🕐 Час пик: ${pad2(d.peak)}:00–${pad2((d.peak + 1) % 24)}:00 · ${mood}`);
  }
  if (d.citizen) {
    const c = d.citizen;
    about.push(`🏡 Гражданство: чат «${escapeHtml(truncate(c.title, 40))}» · ` +
      (ts - c.since < 86400 ? 'с сегодня' : `${ageText(ts - c.since)} (с ${fmtMsk(c.since).slice(0, 10)})`));
  }
  if (d.favourite) about.push(`❤️ Любимый чат: «${escapeHtml(truncate(d.favourite.title, 40))}»`);
  const spouse = await social.spouseOf(who.id);
  const dating = spouse || await social.partnerOf(who.id);
  if (dating) {
    const partner = escapeHtml(truncate(await members.nameOf(dating.partner_id), 40));
    about.push(`${spouse ? '💍 Брак:' : '💞 Отношения:'} ${partner} · ${daysWord(social.marriedDays(dating.since))}`);
  }
  const blocks = [head.join('\n'), about.join('\n')];

  if (d.homes.length) {
    const lines = d.homes.slice(0, HOMES_SHOWN).map((h) => `• «${escapeHtml(truncate(h.title, 40))}» ` +
      (h.since > 0 ? `${ts - h.since < 86400 ? 'с сегодня' : `${ageText(ts - h.since)} (с ${fmtMsk(h.since).slice(0, 10)})`}` : ''));
    if (d.homes.length > HOMES_SHOWN) lines.push(`…и ещё ${d.homes.length - HOMES_SHOWN}`);
    blocks.push(`🏠 Житель чатов:\n${lines.join('\n')}`);
  }

  const balance = await games.balanceOf(who.id);
  const ach = await db.get(sql`SELECT COUNT(*) AS c FROM achievements WHERE user_id = ${who.id}`);
  const rep = await social.repOf(who.id);
  blocks.push('💰 В мешке:\n' + [
    `⚡ ${fmtThousands(points)} XP · на балансе ${fmtThousands(balance)}`,
    `🎖 [${rank[1]}] ${escapeHtml(rank[2])}`,
    `🏆 Ачивок: ${ach.c} · ❤️ Репутация: ${rep.points}`,
  ].join('\n'));

  if (self) {
    const missing = [
      !info.gender && '«+Пол М»', !info.birth && '«+ДР 16.12.1999»', !info.city && '«+Город Москва»',
    ].filter(Boolean);
    if (missing.length) blocks.push(`✍️ Дополни анкету: ${missing.join(', ')}`);
  }
  return { text: blocks.join('\n\n'), days: d.days };
}

async function showAnketa(message, who, self) {
  if (who.isBot) {
    await say(message, '🤖 Это бот, у ботов нет анкеты в Скваде.', { temp: true });
    return;
  }
  const { text, days } = await anketaCard(who, self);
  // The chart over all chats on top, as Iris does; in the private chat too.
  if (days.size && visibleLength(text) <= CAPTION_MAX) {
    try {
      await sayPhoto(message, chartOf({ days }, nowInt(), await club.chartTheme(who.id)), text, { temp: true });
      return;
    } catch (err) {
      if (!(err instanceof BotApiError)) throw err;
    }
  }
  await say(message, text, { temp: true });
}

const INFO_FIELDS = { 'пол': 'gender', 'город': 'city', 'др': 'birth', 'дата рождения': 'birth', 'день рождения': 'birth' };

// «+Пол М», «+Город Москва», «+ДР 16.12.1999» and «-Пол» and so on. → true when handled.
async function anketaInfoCommand(message, self, rest) {
  const set = /^\+\s?(пол|город|др|дата рождения|день рождения)(?:\s+([\s\S]*))?$/iu.exec(rest.trim());
  if (set) {
    const field = INFO_FIELDS[set[1].toLowerCase()];
    try {
      let done;
      if (field === 'gender') {
        done = (await anketa.setGender(self.id, set[2])) === 'f' ? '👩 Пол: женский.' : '👨 Пол: мужской.';
      } else if (field === 'city') {
        done = `🏙 Город: ${escapeHtml(await anketa.setCity(self.id, set[2]))}.`;
      } else {
        done = `🎂 Дата рождения: ${birthText(await anketa.setBirth(message.from, set[2]), nowInt())}. В этот день Финя поздравит.`;
      }
      await say(message, `${done} Посмотреть: «Моя Анкета».`, { temp: true });
    } catch (err) {
      if (!(err instanceof anketa.AnketaError)) throw err;
      await say(message, `❌ ${err.message}`, { temp: true });
    }
    return true;
  }
  const unset = /^-\s?(пол|город|др|дата рождения|день рождения)$/u.exec(bare(rest));
  if (unset) {
    const removed = await anketa.clear(self.id, INFO_FIELDS[unset[1]]);
    await say(message, removed ? '🗑 Убрала из анкеты.' : 'В анкете этого и так нет.', { temp: true });
    return true;
  }
  return false;
}

// «Описание»: the whole «о себе» of a member.
async function aboutText(who, self) {
  const about = await bio.aboutOf(who.id);
  const name = escapeHtml(truncate(who.name, 60));
  if (!about) return self ? '📝 О себе пока пусто. Напиши «+Описание» и пару строк о себе.' : `📝 О себе · ${name}\nПока пусто.`;
  return `📝 О себе · ${name}\n<blockquote>${escapeHtml(about)}</blockquote>`;
}

// «Награды»: all awards, numbered for «Снять Награду N», as Iris shows them.
async function awardsText(who) {
  const list = await bio.awardsOf(who.id);
  const name = mention(who.id, truncate(who.name, 60));
  if (!list.length) return `🏆 Награды · ${name}\nПока пусто. Наградить могут админы чата: «Наградить 1–8» ответом, текст с новой строки.`;
  return `🏆 Награды · ${name}\n` + list.map((a, i) => `${i + 1}. ${bio.degreeIcon(a.degree)} ${escapeHtml(a.text)}`).join('\n');
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
    const { degree, text } = bio.parseAward(value);
    const award = await bio.giveAward(message.chat.id, self.id, target.id, text, degree);
    await say(message, `${bio.degreeIcon(degree)} ${mention(target.id, target.name)} получает награду ${degree} степени:\n${escapeHtml(award)}`);
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

async function statsPanel(chatId, period, viewer = null) {
  const s = await members.periodStats(chatId, period, STAT_LIST);
  let text = `📊 Стата чата · ${STAT_PERIODS[period][1]}\n\n👥 Участников: ${s.members} · писали: ${s.writers}\n`;
  if (!s.top.length) text += '\nПока никто не писал: напиши что-нибудь, и ты первый в списке 😉\n';
  const home = await anketa.citizenIds(chatId);
  s.top.forEach((r, i) => {
    text += `\n${placeMark(i)} ${home.has(r.user_id) ? '🏡 ' : ''}${escapeHtml(truncate(r.name, 35))} — ${msgsWord(r.n)}`;
  });
  if (s.writers > s.top.length) text += `\n…и ещё ${s.writers - s.top.length}`;
  if (viewer) {
    const mine = await members.placeOf(chatId, period, viewer.id);
    text += `\n\n📍 ${escapeHtml(truncate(viewer.name, 35))}: ${mine ? `№${mine.place} · ${msgsWord(mine.n)}` : 'сообщений за период нет'}`;
  }
  text += `\n\n💬 Всего сообщений: ${fmtThousands(s.messages)}`;
  return { text, markup: statsKeyboard(period) };
}

// ---- farm ------------------------------------------------------------------------

async function farm(message) {
  const u = message.from;
  const name = escapeHtml(truncate(await nameFor(u), 40));
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
  await say(message, `❤️ ${mention(from.id, await nameFor(from))} ➜ ${mention(target.id, target.name)}\nРепутация +1, теперь ${n}`, { temp: true });
}

// ---- marriages -------------------------------------------------------------------

// «Финя, до дня рождения»: the next birthday of the asker.
async function birthdayTarget(userId) {
  const b = await db.get(sql`SELECT day, month FROM birthdays WHERE user_id = ${userId}`);
  if (!b) return null;
  const left = extras.daysUntil(b.day, b.month);
  if (left == null) return null;
  const midnight = Math.floor((nowInt() + MSK_OFFSET) / 86400) * 86400 - MSK_OFFSET;
  return { title: 'твоего дня рождения', at: left === 0 ? nowInt() : midnight + left * 86400 };
}

// «Сравнить» in reply: two members side by side, a 🏆 for who leads each row.
async function compareText(chatId, a, b) {
  const ts = nowInt();
  async function stats(who) {
    const p = await db.get(sql`SELECT xp FROM profiles WHERE user_id = ${who.id}`);
    const card = await members.memberCard(chatId, who.id, ts);
    const ach = await db.get(sql`SELECT COUNT(*) AS c FROM achievements WHERE user_id = ${who.id}`);
    return {
      xp: p ? p.xp : 0,
      rep: (await social.repOf(who.id)).points,
      ach: ach.c,
      awards: (await bio.awardsOf(who.id)).length,
      week: card ? card.week : 0,
      total: card ? card.total : 0,
      since: card && card.since ? card.since : null,
    };
  }
  const [x, y] = [await stats(a), await stats(b)];
  const rows = [
    ['⚡ XP', x.xp, y.xp], ['❤️ Репутация', x.rep, y.rep], ['🏆 Ачивки', x.ach, y.ach], ['🏅 Награды', x.awards, y.awards],
    ['💬 Актив за неделю', x.week, y.week], ['📈 Сообщений всего', x.total, y.total],
  ];
  let wa = 0;
  let wb = 0;
  const lines = rows.map(([label, va, vb]) => {
    if (va > vb) wa++;
    if (vb > va) wb++;
    return `${label}: ${fmtThousands(va)}${va > vb ? ' 🏆' : ''} — ${fmtThousands(vb)}${vb > va ? ' 🏆' : ''}`;
  });
  if (x.since && y.since) {
    if (x.since < y.since) wa++;
    if (y.since < x.since) wb++;
    lines.push(`🏠 В чате с: ${fmtMsk(x.since).slice(0, 10)}${x.since < y.since ? ' 🏆' : ''} — ${fmtMsk(y.since).slice(0, 10)}${y.since < x.since ? ' 🏆' : ''}`);
  }
  const verdict = wa === wb ? '🤝 Ничья!' : `👑 Побеждает ${wa > wb ? mention(a.id, a.name) : mention(b.id, b.name)}: ${Math.max(wa, wb)}:${Math.min(wa, wb)}`;
  return `⚔️ Сравнение: ${mention(a.id, a.name)} и ${mention(b.id, b.name)}\n\n${lines.join('\n')}\n\n${verdict}`;
}

const MINUS = new Set(['-', '--', '-1', 'минус', 'дизлайк']);

async function minusRep(message, target) {
  const from = message.from;
  if (!target || target.isBot || target.id === from.id) return;
  const n = await social.minus(message.chat.id, message.message_id, from.id, target.id);
  if (n == null) return;
  await say(message, `💔 ${mention(from.id, await nameFor(from))} ➜ ${mention(target.id, target.name)}\nРепутация −1, теперь ${n}`, { temp: true });
}

async function marriageStatus(message) {
  const s = await social.spouseOf(message.from.id);
  if (!s) {
    await say(message, '💔 Ты не в браке.\nЧтобы сделать предложение, ответь «Брак» на сообщение избранника.', { temp: true });
    return;
  }
  const partner = await members.nameOf(s.partner_id);
  const days = social.marriedDays(s.since);
  const now = social.weddingOf(days);
  const next = social.nextWedding(days);
  const yearsText = now.years ? `${now.years} ${plural(now.years, 'год', 'года', 'лет')}` : 'первый год';
  await say(message, `💍 Твоя пара: ${escapeHtml(truncate(partner, 40))} · в браке уже ${daysWord(days)}.\n` +
    `${now.icon} Сейчас: ${now.name.toLowerCase()} свадьба (${yearsText})` +
    (next ? `\n⏳ Дальше: ${next.name.toLowerCase()} свадьба (${next.years} ${plural(next.years, 'год', 'года', 'лет')}) через ${daysWord(next.inDays)}` : ''),
  { temp: true });
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
  const a = mention(from.id, await nameFor(from));
  const b = mention(target.id, target.name);
  const sent = await say(message, `💍 ${a} → ${b}: предложение руки и сердца!\n\n${b}, твой ответ?`, {
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
    const days = social.marriedDays(r.since);
    const w = social.weddingOf(days);
    text += `\n${placeMark(i)} ${a} + ${b} — ${daysWord(days)} · ${w.icon} ${w.name.toLowerCase()}`;
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

// ---- dating: «Встречаться» before «Брак»; it ends only with «Расстаться» ----------

async function datingStatus(message, who, self) {
  const spouse = await social.spouseOf(who.id);
  const d = spouse ? null : await social.partnerOf(who.id);
  const name = escapeHtml(truncate(who.name, 40));
  if (spouse) {
    const partner = escapeHtml(truncate(await members.nameOf(spouse.partner_id), 40));
    await say(message, `💍 ${self ? 'Ты в браке' : `${name} в браке`} с ${partner}: это уже больше, чем отношения.`, { temp: true });
    return;
  }
  if (!d) {
    await say(message, self
      ? '💔 Ты ни с кем не встречаешься.\nЧтобы предложить, ответь «Встречаться» на сообщение человека.'
      : `💔 ${name} ни с кем не встречается.`, { temp: true });
    return;
  }
  const partner = escapeHtml(truncate(await members.nameOf(d.partner_id), 40));
  await say(message, `💞 ${self ? 'Ты встречаешься' : `${name} встречается`} с ${partner} уже ${daysWord(social.marriedDays(d.since))}.` +
    (self ? '\nСледующий шаг: «Брак» ответом.' : ''), { temp: true });
}

async function offerDate(message, target) {
  const from = message.from;
  if (target.isBot) {
    await say(message, '🤖 С ботами не встречаемся 😅', { temp: true });
    return;
  }
  try {
    await social.offerDate(message.chat.id, from.id, target.id, target.name);
  } catch (err) {
    if (!(err instanceof social.SocialError)) throw err;
    await say(message, `💞 ${err.message}`, { temp: true });
    return;
  }
  const a = mention(from.id, await nameFor(from));
  const b = mention(target.id, target.name);
  const sent = await say(message, `💞 ${a} → ${b}: предложение встречаться!\n\n${b}, что скажешь?`, {
    markup: keyboard([[
      button('💞 Да', { callback_data: `date:y:${from.id}:${target.id}` }),
      button('💔 Нет', { callback_data: `date:n:${from.id}:${target.id}` }),
    ]]),
  });
  if (sent && sent.message_id) await social.setDateOfferMessage(from.id, target.id, sent.message_id);
}

async function breakUpPrompt(message) {
  const d = await social.partnerOf(message.from.id);
  if (!d) {
    await say(message, '💔 Ты и так ни с кем не встречаешься.', { temp: true });
    return;
  }
  const partner = await members.nameOf(d.partner_id);
  const uid = message.from.id;
  await say(message, `💔 Точно расстаться с ${escapeHtml(truncate(partner, 40))}?`, {
    markup: keyboard([[
      button('Да, расстаться', { callback_data: `part:y:${uid}:${d.partner_id}` }),
      button('Нет', { callback_data: `part:n:${uid}:${d.partner_id}` }),
    ]]),
  });
}

async function datingListText() {
  const rows = await social.datingCouples(15);
  if (!rows.length) return '💞 В Скваде пока никто не встречается.\nОтветь «Встречаться» на сообщение человека, чтобы стать первыми.';
  let text = `💞 Кто встречается: ${await social.datingCount()}\n`;
  for (const [i, r] of rows.entries()) {
    const a = escapeHtml(truncate(await members.nameOf(r.a), 30));
    const b = escapeHtml(truncate(await members.nameOf(r.b), 30));
    text += `\n${placeMark(i)} ${a} + ${b} — ${daysWord(social.marriedDays(r.since))}`;
  }
  return text;
}

// ---- «Чат инфо»: the whole chat with its chart -------------------------------------

async function chatInfo(message) {
  const ts = nowInt();
  const c = await members.chatCard(message.chat.id, ts);
  const title = escapeHtml(truncate(message.chat.title || 'Чат', 60));
  const lines = [`🏙 Чат «${title}»`, ''];
  lines.push(`👥 Население: ${fmtThousands(c.members)}${c.fresh ? ` · новичков за неделю: ${c.fresh}` : ''}`);
  lines.push(`✍️ Пишут сегодня: ${c.writers}`);
  const citizens = await anketa.citizenCount(message.chat.id);
  if (citizens) lines.push(`🏡 Граждан: ${citizens}`);
  if (Number.isFinite(c.since)) {
    lines.push(`📅 Финя знает чат с ${fmtMsk(c.since).slice(0, 10)} (${ts - c.since < 86400 ? 'сегодня' : ageText(ts - c.since)})`);
  }
  lines.push(`💬 Сообщения (д|н|м|всего): ${[c.day, c.week, c.month, c.total].map(compact).join(' | ')}`);
  if (c.record) lines.push(`🏆 Рекордный день: ${msgsWord(c.record.n)}, ${dateOfDay(c.record.day)}`);
  const top = await members.activityTop(message.chat.id, null, 3);
  if (top.length) {
    lines.push('', '👑 Самые активные за всё время:');
    for (const [i, r] of top.entries()) lines.push(`${placeMark(i)} ${escapeHtml(truncate(r.name, 30))} — ${msgsWord(r.n)}`);
  }
  const text = lines.join('\n');
  if (c.days.size && visibleLength(text) <= CAPTION_MAX) {
    try {
      await sayPhoto(message, chartOf({ days: c.days }, ts), text, { temp: true });
      return;
    } catch (err) {
      if (!(err instanceof BotApiError)) throw err;
    }
  }
  await say(message, text, { temp: true });
}

// ---- citizenship: «+Гражданство» makes the chat home --------------------------------

async function citizenCommand(message, self) {
  try {
    const r = await anketa.becomeCitizen(message.chat.id, self.id);
    const ts = nowInt();
    const title = escapeHtml(truncate(message.chat.title || 'Чат', 40));
    let text = `🏡 ${mention(self.id, self.name)} — гражданство чата «${title}» оформлено` +
      (ts - r.since >= 86400 ? `, здесь с ${fmtMsk(r.since).slice(0, 10)} (${ageText(ts - r.since)})` : '') + '.';
    if (r.moved) text += `\nПрежнее гражданство «${escapeHtml(truncate(await anketa.chatTitle(r.moved), 40))}» снято: дом у каждого один.`;
    await say(message, text, { temp: true });
  } catch (err) {
    if (!(err instanceof anketa.AnketaError)) throw err;
    await say(message, err.message, { temp: true });
  }
}

async function citizensText(chatId, title) {
  const list = await anketa.citizensOf(chatId, 30);
  const head = `🏡 Граждане чата «${escapeHtml(truncate(title || 'Чат', 40))}»`;
  if (!list.length) return `${head}\n\nПока никого. Стань первым: «+Гражданство».`;
  const ts = nowInt();
  const total = await anketa.citizenCount(chatId);
  const lines = list.map((r, i) => `${i + 1}. ${escapeHtml(truncate(r.name, 30))} — ${ts - r.since < 86400 ? 'с сегодня' : ageText(ts - r.since)}`);
  if (total > list.length) lines.push(`…и ещё ${total - list.length}`);
  return `${head}: ${total}\n\n${lines.join('\n')}`;
}

// ---- chart themes from the shop ----------------------------------------------------

const THEME_NAMES = {
  'алая': null, 'алый': null, 'обычная': null, 'красная': null,
  'ледяная': 'chart_ice', 'ледяной': 'chart_ice', 'лед': 'chart_ice',
  'токсичная': 'chart_toxic', 'токсичный': 'chart_toxic', 'токсик': 'chart_toxic',
  'неон': 'chart_neon', 'неоновая': 'chart_neon', 'неоновый': 'chart_neon',
  'золотая': 'chart_gold', 'золотой': 'chart_gold', 'золото': 'chart_gold',
};

async function themeText(self) {
  const current = await club.chartTheme(self.id);
  const items = club.SHOP.filter((i) => i.slot === 'chart');
  const lines = ['🎨 Темы графиков «Кто Я» и «Моя Анкета»', ''];
  lines.push(`${current ? '▫️' : '✅'} Алая — бесплатно`);
  for (const i of items) {
    const owned = await club.ownsItem(self.id, i.id);
    lines.push(`${current === i.id ? '✅' : owned ? '▫️' : '🔒'} ${i.name.replace(' график', '')} — ${owned ? 'куплена' : `${i.price} XP`}`);
  }
  lines.push('', 'Купить: Лавка в Mini App. Надеть: «Тема Графика Неон», вернуть обычную: «Тема Графика Алая».');
  return lines.join('\n');
}

async function themeCommand(message, self, name) {
  if (!name) {
    await say(message, await themeText(self), { markup: keyboard([await profileRow(message.chat, '🛍 Лавка в Mini App')]), temp: true });
    return;
  }
  const key = norm(name);
  if (!(key in THEME_NAMES)) {
    await say(message, '🎨 Такой темы нет. Есть: Алая, Ледяная, Токсичная, Неон, Золотая.', { temp: true });
    return;
  }
  const id = THEME_NAMES[key];
  if (id && !(await club.ownsItem(self.id, id))) {
    const item = club.findItem(id);
    await say(message, `🔒 «${item.name}» стоит ${item.price} XP. Купи в Лавке, потом надень этой же командой.`,
      { markup: keyboard([await profileRow(message.chat, '🛍 Лавка в Mini App')]), temp: true });
    return;
  }
  await club.wear(message.from, 'chart', id);
  await say(message, id ? `🎨 Надела: ${club.findItem(id).name}. Смотри «Кто Я».` : '🎨 Вернула алый график.', { temp: true });
}

// ---- RP --------------------------------------------------------------------------

async function rp(message, found, target) {
  const actor = message.from;
  const m = /^([^\p{L}\p{N}]+?)\s+(.+)$/u.exec(found.action);
  const [emoji, verb] = m ? [escapeHtml(m[1]), m[2]] : ['✨', found.action];
  const who = target.id === actor.id ? (DATIVE.test(verb) ? 'себе' : 'себя') : mention(target.id, target.name);
  let text = `${emoji} ${mention(actor.id, await nameFor(actor))} ${escapeHtml(verb)} ${who}`;
  if (found.rest) text += `\n💬 «${escapeHtml(truncate(found.rest, 200))}»`;
  // In a group the command itself goes away: Финя's line answers the target's message.
  if (!isGroupChat(message.chat)) {
    await say(message, text);
    await feats.bump(actor.id, 'rp');
    return;
  }
  const r = message.reply_to_message;
  await say(message, text, { replyTo: r && r.from && r.from.id === target.id ? r.message_id : null });
  await feats.bump(actor.id, 'rp');
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

const WHEN_WORDS = ['Никогда 🙃', 'Сегодня вечером', 'Завтра', 'На следующей неделе', 'Когда рак на горе свистнет',
  'После дождичка в четверг', 'Скорее, чем ты думаешь', 'Через пять минут, если повезёт'];

// «Финя, когда…»: a phrase now and then, a date otherwise (tomorrow to two years ahead).
function whenAnswer(ts = nowInt()) {
  if (Math.random() < 0.3) return pick(WHEN_WORDS);
  const day = new Date((ts + MSK_OFFSET + (1 + Math.floor(Math.random() * 730)) * 86400) * 1000);
  return `Думаю, ${String(day.getUTCDate()).padStart(2, '0')}.${String(day.getUTCMonth() + 1).padStart(2, '0')}.${day.getUTCFullYear()}`;
}

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
  m = /^когда\s+(.+)$/iu.exec(rest);
  if (m) {
    await say(message, `🔮 Когда ${q(m[1])}? ${whenAnswer()}`);
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

// ---- nick, balance, ID, admins ------------------------------------------------------

async function nickText(who, self) {
  const nick = await bio.nickOf(who.id);
  if (self) return nick ? `🏷 Твой ник: «${escapeHtml(nick)}». Сменить: «+Ник Новый», убрать: «-Ник».` : '🏷 Ника нет. Поставить: «+Ник Вася».';
  return nick ? `🏷 Ник: «${escapeHtml(nick)}»` : '🏷 У участника нет ника.';
}

async function balanceText(self) {
  const p = await db.get(sql`SELECT xp FROM profiles WHERE user_id = ${self.id}`);
  const b = await games.balanceOf(self.id);
  return `💰 ${escapeHtml(truncate(self.name, 40))}, на балансе ${fmtThousands(b)} XP из ${fmtThousands(p ? p.xp : 0)}.\n` +
    'Баланс тратится в лавке, на переводы и в казино. Звание считает весь заработанный XP.';
}

async function idText(message, self, target) {
  if (target && target.id !== self.id) {
    if (!(await canAward(message.chat.id, self.id))) return '🆔 Чужой ID видят только админы чата.';
    return `🆔 ${escapeHtml(truncate(target.name, 40))}: <code>${target.id}</code>`;
  }
  let text = `🆔 Твой ID: <code>${self.id}</code>`;
  if (isGroupChat(message.chat)) text += `\n💬 ID чата: <code>${message.chat.id}</code>`;
  return text;
}

async function adminsText(chatId) {
  let list;
  try {
    list = await api.getChatAdministrators({ chat_id: chatId });
  } catch {
    return '⭐ Не получилось получить список админов.';
  }
  const people = (list || []).filter((m) => m.user && !m.user.is_bot);
  people.sort((a, b) => (a.status === 'creator' ? -1 : 0) - (b.status === 'creator' ? -1 : 0));
  if (!people.length) return '⭐ Админов-людей в чате нет.';
  const rows = [];
  for (const m of people) {
    const tag = m.custom_title ? ` · «${escapeHtml(truncate(m.custom_title, 30))}»` : '';
    rows.push(`${m.status === 'creator' ? '👑' : '⭐'} ${escapeHtml(truncate(await nameFor(m.user), 40))}${tag}`);
  }
  return `⭐ Админы чата · ${people.length}\n\n${rows.join('\n')}`;
}

async function repTopText() {
  const rows = await db.all(sql`SELECT user_id, points FROM reputation WHERE points > 0 ORDER BY points DESC, user_id LIMIT 15`);
  if (!rows.length) return '❤️ Топ репутации пока пуст.\nОтветь «+» или «Спасибо» на сообщение, чтобы поднять кому-то репутацию.';
  const lines = [];
  for (const [i, r] of rows.entries()) {
    lines.push(`${placeMark(i)} ${escapeHtml(truncate(await members.nameOf(r.user_id), 35))} — ${fmtThousands(r.points)}`);
  }
  return `❤️ Топ репутации Сквада\n\n${lines.join('\n')}`;
}

// ---- summon ------------------------------------------------------------------------

export const SUMMON_COOLDOWN = 30 * 60;
const SUMMON_LIMIT = 50;
const SUMMON_PER_MESSAGE = 5;

// «Финя, созови»: the latest active members, tagged five to a message (Iris does the same).
async function summon(message, self, text) {
  const chatId = message.chat.id;
  if (!(await canAward(chatId, self.id))) {
    await say(message, '📣 Созывать могут только админы чата.', { temp: true });
    return;
  }
  const key = `summon_at:${chatId}`;
  const last = Number(await getSetting(key)) || 0;
  const ts = nowInt();
  if (ts - last < SUMMON_COOLDOWN) {
    await say(message, `📣 Созыв был недавно. Следующий через ${fmtWait(last + SUMMON_COOLDOWN - ts)}.`, { temp: true });
    return;
  }
  const rows = await db.all(sql`SELECT m.user_id AS id, COALESCE((SELECT nick FROM nicks WHERE nicks.user_id = m.user_id), m.name) AS name
    FROM chat_members m WHERE m.chat_id = ${chatId} AND m.status = 'member' AND m.user_id != ${self.id}
    ORDER BY m.last_active DESC LIMIT ${SUMMON_LIMIT}`);
  if (!rows.length) {
    await say(message, '📣 Созывать пока некого: Финя ещё никого здесь не видела.', { temp: true });
    return;
  }
  await setSetting(key, ts);
  const note = String(text || '').trim();
  const head = `📣 ${mention(self.id, self.name)} созывает всех!` + (note ? `\n<blockquote>${escapeHtml(truncate(note, 300))}</blockquote>` : '');
  for (let i = 0; i < rows.length; i += SUMMON_PER_MESSAGE) {
    const tags = rows.slice(i, i + SUMMON_PER_MESSAGE).map((r) => mention(r.id, r.name)).join(', ');
    const body = i === 0 ? `${head}\n\n${tags}` : tags;
    await sendWithFloodWait(() => say(message, body, { replyTo: i === 0 ? message.message_id : null }));
  }
}

// ---- XP: gifts and the casino -------------------------------------------------------

async function giftCommand(message, self, target, amount) {
  try {
    const r = await games.gift(message.from, target, amount);
    let text = `🎁 ${mention(self.id, self.name)} ➜ ${mention(target.id, target.name)}: +${fmtThousands(r.amount)} XP`;
    if (r.promoted && r.newRank) text += `\n🎖 Новое звание: ${r.newRank[1]} · ${escapeHtml(r.newRank[2])}!`;
    if (message.from.id !== OWNER_USER_ID) text += `\n💰 У тебя на балансе: ${fmtThousands(await games.balanceOf(self.id))} XP`;
    await say(message, text);
  } catch (err) {
    if (!(err instanceof games.GameError)) throw err;
    await say(message, `🎁 ${err.message}`, { temp: true });
  }
}

const CASINO_RULES = '🎰 Казино на XP с баланса\n\n' +
  `«Казино 50» — слоты: 777 ×20, три в ряд ×7, две семёрки ×2.\n«Кости 50» — кубик: 6 ×2,5, 4–5 ×1,5.\n\n` +
  `Ставка от ${games.STAKE_MIN} до ${games.STAKE_MAX} XP, до ${games.GAMES_PER_DAY} игр в день. Баланс: «Баланс».`;

async function casino(message, self, emoji, amount) {
  let bet;
  try {
    bet = await games.stake(message.from, amount);
  } catch (err) {
    if (!(err instanceof games.GameError)) throw err;
    await say(message, `${emoji} ${err.message}`, { temp: true });
    return;
  }
  let dice;
  try {
    dice = await api.sendDice({
      chat_id: message.chat.id, emoji,
      reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    });
  } catch (err) {
    await games.refund(bet);
    throw err;
  }
  if (!dice || !dice.dice) {
    await games.refund(bet);
    return;
  }
  const r = await games.settle(message.from, bet, emoji, dice.dice.value);
  if (emoji === '🎰' && dice.dice.value === 64) await feats.bump(message.from.id, 'jackpot');
  const name = escapeHtml(truncate(self.name, 40));
  const result = r.won
    ? `+${fmtThousands(r.won)} XP (×${String(r.times).replace('.', ',')})`
    : `−${fmtThousands(bet.amount)} XP`;
  await say(message, `${emoji} ${name}: ${r.line} · ${result}\n💰 Баланс: ${fmtThousands(r.balance)} XP`,
    { replyTo: dice.message_id, temp: true });
  if (isGroupChat(message.chat)) await deleteLater(message.chat.id, [dice.message_id]);
}

// ---- reminders ---------------------------------------------------------------------

async function remindCommand(message, self, words, addressed) {
  const parsed = reminders.parse(words);
  if (!parsed) {
    if (!addressed) return false;
    await say(message, '⏰ Не поняла, когда. Так: «Финя, напомни через 2ч позвонить», «…в 18:30 …», «…завтра в 10:00 …».', { temp: true });
    return true;
  }
  try {
    const r = await reminders.add(message, message.from, self.name, parsed);
    await feats.bump(message.from.id, 'reminders');
    await say(message, `⏰ Напомню ${reminders.whenText(r.due)} (МСК)${r.text ? `:\n<blockquote>${escapeHtml(r.text)}</blockquote>` : '.'}`, { temp: true });
  } catch (err) {
    if (!(err instanceof reminders.ReminderError)) throw err;
    await say(message, `⏰ ${err.message}`, { temp: true });
  }
  return true;
}

async function remindersText(self) {
  const list = await reminders.listOf(self.id);
  if (!list.length) return '⏰ Напоминаний нет. Поставить: «Финя, напомни через 2ч позвонить».';
  return '⏰ Твои напоминания (МСК)\n\n' +
    list.map((r, i) => `${i + 1}. ${reminders.whenText(r.due_at)}${r.text ? ` — ${escapeHtml(truncate(r.text, 60))}` : ''}`).join('\n') +
    '\n\nУдалить: «-Напоминание N».';
}

// ---- anniversaries -----------------------------------------------------------------

const ANNIVERSARY_DAYS = new Set([7, 30, 50, 100, 200, 300, 500, 1000]);
export const isAnniversary = (days) => ANNIVERSARY_DAYS.has(days) || (days > 0 && days % 365 === 0);

function anniversaryWord(days) {
  if (days % 365 === 0) {
    const y = days / 365;
    const w = social.weddingOn(days);
    return `${y} ${plural(y, 'год', 'года', 'лет')} вместе` + (w ? `, ${w.name.toLowerCase()} свадьба ${w.icon}` : '');
  }
  return `${daysWord(days)} вместе`;
}

// Once a day from 12:00 МСК: couples with a round number of days, in each Squad chat
// where one of them is a member.
async function anniversaries(ts = nowInt()) {
  if (Math.floor((ts + 3 * 3600) % 86400 / 3600) < 12) return;
  const day = members.mskDay(ts);
  if ((await getSetting('anniversary_day')) === day) return;
  await setSetting('anniversary_day', day);
  const pairs = (await social.couples(1000)).filter((c) => isAnniversary(social.marriedDays(c.since, ts)));
  if (!pairs.length) return;
  for (const chatId of await squadChatIds()) {
    const lines = [];
    for (const c of pairs) {
      const here = await db.get(sql`SELECT 1 AS x FROM chat_members WHERE chat_id = ${chatId} AND status = 'member'
        AND user_id IN (${c.a}, ${c.b}) LIMIT 1`);
      if (!here) continue;
      lines.push(`💍 ${mention(c.a, await members.nameOf(c.a))} + ${mention(c.b, await members.nameOf(c.b))} — ${anniversaryWord(social.marriedDays(c.since, ts))}!`);
    }
    if (!lines.length) continue;
    try {
      await withPremium({
        chat_id: chatId, text: boldHtml(`💒 Годовщина в Скваде!\n\n${lines.join('\n')}\n\nСовет да любовь 🥂`), parse_mode: 'HTML',
      }, (p) => api.sendMessage(p));
    } catch {
      // No rights in that chat any more.
    }
  }
}

// ---- positions ---------------------------------------------------------------------

const dutiesQuote = (p) => `<blockquote>${p.duties.map((d) => `• ${escapeHtml(d)}`).join('\n')}\n${escapeHtml(p.motto)}</blockquote>`;
const positionList = () => staff.POSITIONS.map((p) => `${p.emoji} ${escapeHtml(p.title)}`).join(', ');

async function teamText() {
  const lines = [];
  for (const { position, people } of await staff.team()) {
    const names = [];
    for (const r of people) names.push(escapeHtml(truncate(await members.nameOf(r.user_id), 30)));
    lines.push(`${position.emoji} ${escapeHtml(position.title)} — ${names.length ? names.join(', ') : 'вакансия'}`);
  }
  return `⛓️ Штаб Сквада\n\n${lines.join('\n')}\n\nОбязанности: «Должность Креативщик». Чья должность: «Должность» ответом.`;
}

async function positionText(position) {
  const { people } = (await staff.team()).find((t) => t.position.code === position.code);
  const names = [];
  for (const r of people) names.push(escapeHtml(truncate(await members.nameOf(r.user_id), 30)));
  return `${position.emoji} ${escapeHtml(position.title)}\n${dutiesQuote(position)}\n` +
    `👥 ${names.length ? `Сейчас: ${names.join(', ')}` : 'Вакансия: пока никого'}`;
}

async function memberPositionsText(who, self) {
  const jobs = await staff.positionsOf(who.id);
  const name = escapeHtml(truncate(who.name, 40));
  if (!jobs.length) return `💼 ${self ? 'У тебя пока нет должности' : `${name}: пока без должности`} в Скваде. Весь штаб: «Штаб».`;
  return `💼 ${self ? 'Твоя должность' : `Должность · ${name}`}\n\n` +
    jobs.map((j) => `${j.emoji} ${escapeHtml(j.title)}\n${dutiesQuote(j)}`).join('\n');
}

// «+должность Креативщик» / «-должность …» in reply, by the owner only.
async function positionCommand(message, self, target, add, words) {
  if (self.id !== OWNER_USER_ID) {
    await say(message, '💼 Назначать должности может только владелец Сквада.', { temp: true });
    return;
  }
  if (!target || target.isBot) {
    await say(message, '💼 Ответь этой командой на сообщение человека.', { temp: true });
    return;
  }
  const who = mention(target.id, target.name);
  if (!add && !String(words || '').trim()) {
    const jobs = await staff.positionsOf(target.id);
    for (const j of jobs) await staff.dismiss(target.id, j);
    await say(message, jobs.length ? `💼 ${who} больше без должности.` : `💼 ${who} и так без должности.`);
    return;
  }
  const position = staff.find(String(words || '').replace(/^@\w+\s*/u, ''));
  if (!position) {
    await say(message, `💼 Такой должности нет. Есть: ${positionList()}.`, { temp: true });
    return;
  }
  if (!add) {
    const removed = await staff.dismiss(target.id, position);
    await say(message, removed
      ? `💼 ${who} снимается с должности «${escapeHtml(position.title)}».`
      : `💼 ${who} не на должности «${escapeHtml(position.title)}».`, { temp: !removed });
    return;
  }
  try {
    const fresh = await staff.appoint(target.id, position, self.id, target.user ? fullName(target.user) : target.name);
    if (!fresh) {
      await say(message, `💼 ${who} уже ${escapeHtml(position.title)}.`, { temp: true });
      return;
    }
  } catch (err) {
    if (!(err instanceof staff.StaffError)) throw err;
    await say(message, `💼 ${err.message}`, { temp: true });
    return;
  }
  // The appointment stays in the chat: it is news for the whole Squad.
  await say(message, `⛓️ ${who} назначается на должность\n${position.emoji} ${escapeHtml(position.title)}\n${dutiesQuote(position)}`);
}

// ---- achievements ------------------------------------------------------------------

const ACH_SHOWN = 5;

// «🏆 … открывает ачивку»: under the message, not as a reply, and gone after a while.
async function announceAchievements(message, who, fresh) {
  if (!fresh.length) return;
  const name = mention(who.id, await nameFor(who));
  const reward = fresh.reduce((n, a) => n + a.xp, 0);
  const shown = fresh.slice(0, ACH_SHOWN);
  let text = fresh.length === 1
    ? `🏆 ${name} открывает ачивку «${escapeHtml(fresh[0].title)}» · +${fmtThousands(fresh[0].xp)} XP\n<blockquote>${escapeHtml(fresh[0].text)}</blockquote>`
    : `🏆 ${name} открывает ачивки · +${fmtThousands(reward)} XP\n<blockquote>` +
      shown.map((a) => `«${escapeHtml(a.title)}» — ${escapeHtml(a.text)}`).join('\n') +
      (fresh.length > shown.length ? `\n…и ещё ${fresh.length - shown.length}` : '') + '</blockquote>';
  text += '\nВсе ачивки — в профиле Фини.';
  const group = isGroupChat(message.chat);
  const sent = await withPremium({
    chat_id: message.chat.id, text: boldHtml(text), parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    ...sameThread(message), ...(group ? { reply_markup: withClose(null, who.id) } : {}),
  }, (p) => api.sendMessage(p));
  if (group && sent) await deleteLater(message.chat.id, [sent.message_id], GROUP_REPLY_TTL);
}

// After a command or every 10th message: the author's chat achievements, and those of
// whoever the command was about (a «+», a wedding, an award…).
async function checkAchievements(message, handled, tracked) {
  const people = [];
  if (handled || (tracked && tracked.msgs % 10 === 0)) people.push(message.from);
  const r = message.reply_to_message;
  if (handled && r && members.isPerson(r.from) && !r.sender_chat && r.from.id !== message.from.id) people.push(r.from);
  for (const u of people) {
    try {
      await announceAchievements(message, u, await feats.check(u));
    } catch (err) {
      // No right to write here is fine: the badges are open anyway, the Mini App shows them.
      if (!(err instanceof BotApiError)) await logError('chat.achievements', err);
    }
  }
}

async function achievementsText(who, self) {
  const rows = await db.all(sql`SELECT code, unlocked_at FROM achievements WHERE user_id = ${who.id}
    ORDER BY unlocked_at DESC, rowid DESC`);
  const byCode = new Map(club.ACHIEVEMENTS.map((a) => [a.code, a]));
  const got = rows.filter((r) => byCode.has(r.code));
  const name = escapeHtml(truncate(who.name, 40));
  if (!got.length) {
    return `🏆 ${self ? 'У тебя пока нет ачивок' : `${name}: пока ни одной ачивки`}. Их ${club.ACHIEVEMENTS.length}: за сообщения, дни в чате, репутацию, фарм, казино и не только.`;
  }
  const last = got.slice(0, ACH_SHOWN).map((r) => {
    const a = byCode.get(r.code);
    return `«${escapeHtml(a.title)}» — ${escapeHtml(a.text)}`;
  });
  return `🏆 ${self ? 'Твои ачивки' : `Ачивки · ${name}`}: ${got.length} из ${club.ACHIEVEMENTS.length}\n\nПоследние:\n<blockquote>${last.join('\n')}</blockquote>`;
}

// ---- daily summary -----------------------------------------------------------------

const SUMMARY_AT = 23 * 3600 + 55 * 60;
const SUMMARY_LATE_UNTIL = 12 * 3600;

function dayLabel(day) {
  const d = new Date(day * 86400 * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function dailySummaryText(chatId, day) {
  const s = await members.dayStats(chatId, day);
  if (!s.top.length) return null;
  const lines = s.top.map((r, i) => `${MEDALS[i]} ${escapeHtml(truncate(r.name, 35))} — ${msgsWord(r.n)}`);
  return {
    top: s.top,
    text: `🌙 Итоги дня · ${dayLabel(day)}\n\n${lines.join('\n')}\n\n` +
      `💬 Всего: ${msgsWord(s.messages)} · 👥 писали: ${s.writers}\n` +
      `⭐ Звезда дня — ${escapeHtml(truncate(s.top[0].name, 35))}! Новый день — новый топ 🔥`,
  };
}

// The day's top-3 in each Squad chat at 23:55 МСК. pump() runs only on updates, so a
// quiet night moves it to the morning (until 12:00) for the day before.
async function dailySummary(ts = nowInt()) {
  const sec = (ts + MSK_OFFSET) % 86400;
  const today = members.mskDay(ts);
  let day;
  if (sec >= SUMMARY_AT) day = today;
  else if (sec < SUMMARY_LATE_UNTIL) day = today - 1;
  else return;
  if (!(await getSetting('chat_daily'))) return;
  for (const chatId of await squadChatIds()) {
    const key = `daily_summary:${chatId}`;
    await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, ${String(day - 1)})`);
    const won = await db.run(sql`UPDATE settings SET value = ${String(day)}
      WHERE key = ${key} AND CAST(value AS INTEGER) < ${day}`);
    if (won.rowsAffected !== 1) continue;
    const summary = await dailySummaryText(chatId, day);
    if (!summary) continue;
    await feats.bump(summary.top[0].user_id, 'day_top');
    try {
      await withPremium({ chat_id: chatId, text: boldHtml(summary.text), parse_mode: 'HTML' }, (p) => api.sendMessage(p));
    } catch {
      // No rights in that chat any more.
    }
  }
}

// ---- help --------------------------------------------------------------------------

// The help: a menu of sections, each a list of commands with the description
// quoted under it. Switched by buttons (help:<section>) in place.
const HELP = {
  profile: ['👤 Профиль', () => [
    ['👤 Кто Я · Кто Ты (ответом)', 'Профиль с графиком актива: звание, XP, репутация, актив за день, неделю, месяц и всё время, о себе и награды'],
    ['📋 Моя Анкета · Анкета (ответом)', 'Анкета по всем чатам Сквада сразу: график, стаж, актив, серия дней, рекордный день, час пик, чаты и мешок'],
    ['🎨 Тема Графика · Тема Графика Неон', 'Цвет графиков в «Кто Я» и анкете. Темы покупаются в Лавке за XP'],
    ['🏡 +Гражданство · -Гражданство · Кто Граждане', 'Сделай этот чат своим домом: «Гражданство» в анкете и «Кто Я», 🏡 рядом с именем в стате. Гражданство одно, новое заменяет старое'],
    ['📅 Возраст Аккаунта · Возраст Аккаунта (ответом)', 'Примерно с какого времени человек в Telegram. Строка есть и в «Кто Я», и в анкете'],
    ['🏙 Чат Инфо', 'Карточка чата: график, население, сообщения за день, неделю, месяц и всё время, рекордный день и самые активные'],
    ['🎂 +ДР 16.12.1999 · +Пол М · +Город Москва', 'Данные для анкеты. Убрать: «-ДР», «-Пол», «-Город»'],
    ['🏷 +Ник Вася · -Ник · Ник (ответом)', 'Как Финя зовёт тебя в топах, профиле и РП'],
    ['📝 +Описание Текст · -Описание · Описание (ответом)', 'Пара строк о себе в профиле. «Описание» покажет целиком'],
    ['🏅 Награды (ответом) · Снять Награды От (ответом)', 'Награды участника от админов чата, степени от 🎗 1 до 🏵 8. «Снять Награды От» убирает с тебя всё, что дал этот человек'],
    ['🏆 Ачивки (ответом)', `Сколько открыто из ${club.ACHIEVEMENTS.length} и последние. Новые Финя объявляет в чате сама`],
  ]],
  people: ['💞 Люди', () => [
    ['❤️ + или «Спасибо» (ответом) · - (ответом) · Топ Репы', 'Репутация участнику плюсом или минусом, без лимита, и топ репутации Сквада'],
    ['💞 Встречаться (ответом) · Мои Отношения · Расстаться · Кто Встречается', 'Отношения до брака. Сами не заканчиваются, только по «Расстаться» или когда пара женится'],
    ['📅 Начало Отношений 01.05.2024 · Начало Брака 01.05.2024', 'Если пара была вместе ещё до Фини: дни и годовщины посчитаются с этой даты. Бесплатно, раз в месяц'],
    ['💍 Брак (ответом) · Мой Брак · Развод · Браки', 'Предложение руки и сердца, стаж брака и все пары Сквада. «Мой Брак» покажет, какая сейчас свадьба (ситцевая, деревянная… золотая) и сколько до следующей. С годовщинами Финя поздравляет сама'],
    ['🤗 Обнять, Поцеловать, Ударить… (ответом)', 'РП-действия. Весь список: «РП». В любом другом чате, даже в личке, напиши @ник Фини, пробел и действие: «@finya_helper_Squad_bot обнять @ник»'],
    ['⛓️ Штаб · Должность (ответом) · Должность Креативщик', 'Команда Сквада по должностям, чья-то должность и обязанности'],
  ]],
  games: ['🎲 XP и игры', () => [
    ['🏆 Финя, Топ', 'Топ Сквада по XP'],
    ['🌾 Фарм', `Случайный XP раз в ${fmtWait(xp.FARM_COOLDOWN)}, иногда редкий — до ${xp.FARM_RARE_MAX}`],
    ['💰 Баланс', 'Сколько XP можно потратить: в лавке, на переводы и в казино'],
    ['🎁 Передать 100 (ответом)', `Перевод XP со своего баланса, до ${games.GIFT_MAX} за раз и ${games.GIFTS_PER_DAY} раз в день`],
    ['🎰 Казино 50 · 🎲 Кости 50', `Ставка XP от ${games.STAKE_MIN} до ${games.STAKE_MAX}, до ${games.GAMES_PER_DAY} игр в день. Правила: «Казино»`],
  ]],
  useful: ['🛠 Полезное', () => [
    ['📊 Стата · Топ Дня / Недели / Месяца', 'Актив чата и твоё место, период переключается кнопками. В 23:55 МСК Финя сама подводит итоги дня'],
    ['⏰ Финя, Напомни Через 2ч Текст', 'Ещё «… В 18:30 …», «… Завтра В 10:00 …». Список: «Напоминания», удалить: «-Напоминание N»'],
    ['🆔 Ид', 'Твой ID и ID чата. Чужой ID ответом — для админов'],
    ['🎂 Ближайшие ДР', 'Дни рождения участников на месяц вперёд, из анкет'],
    ['🔮 Гороскоп · Гороскоп Овен · Мой Знак', 'Гороскоп на сегодня с ignio.com по знаку из твоего «+ДР» или по названию знака'],
    ['⏳ Финя, До Нового Года', 'Сколько осталось до праздника или даты: «до 8 марта», «до 31.12», «до дня рождения»'],
    ['⚔️ Сравнить (ответом)', 'Ты и участник рядом: XP, репа, ачивки, награды, актив и стаж в чате'],
    ['⚖️ Моя Статья · Статья (ответом)', 'Статья дня из «УК Сквада» по тому, как ты ведёшь себя в чате: флуд, ночные посиделки, казино. Новая каждый день'],
    ['⭐ Админы', 'Админы этого чата'],
    ['🔮 Финя, Кто… · Финя, Инфа… · Финя, Когда…', 'Финя выберет участника, назовёт шанс в процентах или дату'],
    ['🤔 Финя, Выбери А или Б · Финя, Вопрос?', 'Выбор из вариантов и ответ «да» или «нет»'],
  ]],
  admin: ['🛡 Админам', (moderation) => [
    ['🏅 Наградить 4 (ответом или с @ником) · Снять Награду N · Снять Все Награды', 'Степень 1–8: 🎗 🥉 🥈 🥇 🎖 🏅 🏆 🏵. Текст награды с новой строки, например:\nНаградить 4 @ник\n«Агент ириса» с. Иван'],
    ['📣 Финя, Созови Текст', `Тегает активных участников по ${SUMMON_PER_MESSAGE} в сообщении, не чаще раза в ${fmtWait(SUMMON_COOLDOWN)}`],
    ...(moderation ? [['🛡 Мут 1ч · Размут · Бан · Разбан · Кик · Варн · Снять Варн · Варны',
      'Ответом на сообщение. Причину пиши с новой строки']] : []),
  ]],
  owner: ['👑 Владельцу', () => [
    ['👑 +РП Команда = Действие · -РП Команда', 'Свои РП-действия'],
    ['👑 +Должность Креативщик · -Должность … (ответом)', `Назначить или снять должность, до ${staff.PER_USER} на человека. «-Должность» без названия снимает все`],
    ['👑 Антифлуд / Капча / Модерация Вкл/Выкл', 'Защита чата'],
    ['👑 Итоги Дня Вкл/Выкл', 'Топ-3 дня в каждом чате Сквада в 23:55 МСК'],
    ['👑 Прощание Вкл/Выкл', 'Финя прощается с теми, кто сам вышел из чата'],
    ['👑 Навигатор · Навигатор Выкл', 'Закреп с кнопками: канал, чаты, магазин, проекты. Финя сама держит его свежим'],
    ['👑 Вопрос Дня · Вопрос Дня Вкл/Выкл', 'Опрос для обсуждения в 12:00 МСК в каждом чате Сквада. «Вопрос Дня» в чате — отправить сейчас'],
    ['✨ Эмодзи (в личке)', 'Премиум-эмодзи Фини'],
    ['📥 Обновить Инфо', 'Подтянуть старую историю чата из экспорта Telegram Desktop: через Mini App или файлом в личку (до 20 МБ)'],
  ]],
};

// «<команда> помощь»: how to write one command, with examples. `keys` are the command's
// words as norm() leaves them; the longest key that starts the question wins.
const USAGE = [
  {
    keys: ['команды', 'помощь', 'help'], title: '📖 Команды',
    about: 'Все команды Фини по разделам, раздел выбирается кнопками',
    how: [['Финя, Команды', 'Меню справки'], ['Награды Помощь', 'Допиши «помощь» к любой команде, и Финя покажет, как ей пользоваться']],
  },
  {
    keys: ['кто я', 'кто ты', 'профиль', 'мой профиль'], title: '👤 Кто Я',
    about: 'Профиль с графиком актива: звание, XP, репутация, актив за день, неделю, месяц и всё время, о себе, награды и должность',
    how: [['Кто Я', 'Твой профиль'], ['Кто Ты (ответом на сообщение)', 'Профиль этого участника'], ['Финя, Кто Ты', 'Профиль самой Фини']],
  },
  {
    keys: ['моя анкета', 'анкета'], title: '📋 Моя Анкета',
    about: 'Анкета по всем чатам Сквада сразу: график, стаж, актив, серия дней, рекордный день, час пик, чаты и мешок',
    how: [['Моя Анкета', 'Твоя анкета'], ['Анкета (ответом) · Анкета @ник', 'Анкета участника'], ['+ДР · +Пол · +Город', 'Заполнить данные анкеты, подробнее: «+ДР Помощь»']],
  },
  {
    keys: ['+др', '-др', 'др', '+пол', '-пол', 'пол', '+город', '-город', 'город', '+дата рождения', '+день рождения'], title: '🎂 +ДР · +Пол · +Город',
    about: 'Данные для «Моей Анкеты». В день рождения Финя поздравит',
    how: [['+ДР 16.12.1999', 'Дата рождения, год можно не писать: «+ДР 16.12»'], ['+Пол М · +Пол Ж', 'Пол'], ['+Город Москва', 'Город'], ['-ДР · -Пол · -Город', 'Убрать из анкеты']],
  },
  {
    keys: ['тема графика'], title: '🎨 Тема Графика',
    about: 'Цвет графиков в «Кто Я» и анкете. Темы покупаются в Лавке Mini App за XP',
    how: [['Тема Графика', 'Какие темы есть и какая надета'], ['Тема Графика Неон', 'Надеть купленную тему'], ['Тема Графика Алая', 'Вернуть обычную']],
  },
  {
    keys: ['+гражданство', '-гражданство', 'гражданство', 'кто граждане', 'граждане', 'все граждане'], title: '🏡 Гражданство',
    about: 'Сделай чат своим домом: «Гражданство» в анкете и «Кто Я», 🏡 рядом с именем в стате. Гражданство одно, новое заменяет старое',
    how: [['+Гражданство', 'Стать гражданином этого чата (пишется в самом чате)'], ['-Гражданство', 'Отказаться'], ['Кто Граждане', 'Все граждане этого чата']],
  },
  {
    keys: ['чат инфо', 'инфо чата', 'инфо чат', 'о чате', 'чат стата'], title: '🏙 Чат Инфо',
    about: 'Карточка чата: график, население, сообщения за день, неделю, месяц и всё время, рекордный день и самые активные',
    how: [['Чат Инфо', 'Работает только в чате Сквада']],
  },
  {
    keys: ['+ник', '-ник', 'ник'], title: '🏷 Ник',
    about: () => `Как Финя зовёт тебя в топах, профиле и РП, до ${bio.NICK_MAX} символов`,
    how: [['+Ник Вася', 'Поставить ник'], ['-Ник', 'Убрать, Финя снова зовёт по имени из Telegram'], ['Ник (ответом)', 'Ник участника']],
  },
  {
    keys: ['+описание', '-описание', 'описание'], title: '📝 Описание',
    about: () => `Пара строк о себе в профиле, до ${bio.ABOUT_MAX} символов`,
    how: [['+Описание Люблю стримы и котиков', 'Записать'], ['-Описание', 'Удалить'], ['Описание (ответом)', 'Описание участника целиком']],
  },
  {
    keys: ['награды', 'снять награды от'], title: '🏅 Награды',
    about: 'Награды участника от админов чата, степени от 🎗 1 до 🏵 8',
    how: [['Награды', 'Твои награды'], ['Награды (ответом) · Награды @ник', 'Награды участника, с номерами'], ['Снять Награды От (ответом)', 'Убрать с себя все награды, которые дал этот человек'], ['Наградить', 'Выдать награду могут админы: «Наградить Помощь»']],
  },
  {
    keys: ['наградить', 'снять награду', '-награда', 'снять все награды'], title: '🏅 Наградить',
    about: 'Только для админов чата. Степень от 1 до 8: 🎗 🥉 🥈 🥇 🎖 🏅 🏆 🏵. Без степени будет 🎗 1',
    how: [['Наградить 4 (ответом)\n«Агент ириса» с. Иван', 'Число в первой строке — степень, текст награды с новой строки'], ['Наградить 4 @ник\nТекст', 'То же без ответа, через @ник'], ['Снять Награду 2 (ответом)', 'Снять награду по номеру из «Награды»'], ['Снять Все Награды (ответом)', 'Снять с участника всё']],
  },
  {
    keys: ['ачивки', 'мои ачивки'], title: '🏆 Ачивки',
    about: () => `Сколько открыто из ${club.ACHIEVEMENTS.length} и последние. Новые Финя объявляет в чате сама`,
    how: [['Ачивки', 'Твои ачивки'], ['Ачивки (ответом) · Ачивки @ник', 'Ачивки участника']],
  },
  {
    keys: ['+', '-', 'спасибо', 'спс', 'минус', 'дизлайк', 'репа', 'репутация', 'топ репы', 'топ репутации'], title: '❤️ Репутация',
    about: 'Репутация участнику плюсом или минусом, без лимита',
    how: [['+ или Спасибо (ответом)', 'Дать +1 репутации автору сообщения'], ['- или Минус (ответом)', 'Снять 1 репутации, как дизлайк'], ['Топ Репы', 'Топ репутации Сквада']],
  },
  {
    keys: ['встречаться', 'мои отношения', 'отношения', 'отны', 'расстаться', 'кто встречается'], title: '💞 Отношения',
    about: 'Отношения до брака. Сами не заканчиваются, только по «Расстаться» или когда пара женится',
    how: [['Встречаться (ответом)', 'Предложить встречаться, человек отвечает кнопкой'], ['Мои Отношения · Отношения (ответом)', 'С кем и сколько дней'], ['Расстаться', 'Закончить, с подтверждением'], ['Кто Встречается', 'Все пары Сквада'], ['Начало Отношений 01.05.2024', 'Если были вместе ещё до Фини']],
  },
  {
    keys: ['начало брака', 'начало отношений', 'дата брака', 'дата отношений'], title: '📅 Начало Брака · Начало Отношений',
    about: 'Если пара была вместе ещё до Фини: дни и годовщины посчитаются с этой даты. Бесплатно, раз в месяц',
    how: [['Начало Брака 01.05.2024', 'Дата начала брака'], ['Начало Отношений 01.05.2024', 'Дата начала отношений']],
  },
  {
    keys: ['брак', 'мой брак', 'развод', 'браки', 'пары'], title: '💍 Брак',
    about: 'Свадьба в чате. С годовщинами Финя поздравляет сама, по русским традициям: ситцевая, деревянная… золотая',
    how: [['Брак (ответом)', 'Предложение руки и сердца, человек отвечает кнопкой'], ['Мой Брак', 'С кем, сколько дней, какая сейчас свадьба и сколько до следующей'], ['Развод', 'Развестись, с подтверждением'], ['Браки', 'Все пары Сквада'], ['Начало Брака 01.05.2024', 'Если поженились ещё до Фини']],
  },
  {
    keys: ['рп', 'рп список', 'список рп', 'рп команды'], title: '🤗 РП-действия',
    about: 'Обнять, поцеловать, ударить и ещё десятки действий',
    how: [['Обнять (ответом)', 'Действие с автором сообщения'], ['Обнять ты лучший (ответом)', 'Со своим текстом после команды'], ['РП', 'Весь список действий'], ['@finya_helper_Squad_bot обнять @ник', 'В любом другом чате, даже в личке']],
  },
  {
    keys: ['штаб', 'состав', 'должности', 'штаб сквада', 'команда сквада', 'должность'], title: '⛓️ Штаб · Должность',
    about: 'Команда Сквада по должностям',
    how: [['Штаб', 'Вся команда'], ['Должность', 'Твоя должность'], ['Должность (ответом)', 'Должность участника'], ['Должность Креативщик', 'Обязанности и кто её занимает']],
  },
  {
    keys: ['+должность', '-должность'], title: '👑 +Должность',
    about: () => `Только владелец. До ${staff.PER_USER} должностей на человека. Права в Telegram выдаются отдельно, вручную`,
    how: [['+Должность Креативщик (ответом)', 'Назначить'], ['-Должность Креативщик (ответом)', 'Снять одну'], ['-Должность (ответом)', 'Снять все'], ['Штаб', `Названия: ${staff.POSITIONS.map((p) => p.title).join(', ')}`]],
  },
  {
    keys: ['топ', 'топ xp', 'топ хп', 'топ сквада'], title: '🏆 Финя, Топ',
    about: 'Топ Сквада по XP. Просто «топ» Финя не слышит: это частая похвала',
    how: [['Финя, Топ', 'Топ по XP'], ['Стата', 'Топ по сообщениям: «Стата Помощь»']],
  },
  {
    keys: ['фарм', 'ферма'], title: '🌾 Фарм',
    about: () => `Случайный XP раз в ${fmtWait(xp.FARM_COOLDOWN)}: до ${xp.FARM_MAX}, иногда редкий — до ${xp.FARM_RARE_MAX}`,
    how: [['Фарм', 'Работает и в личке с Финей']],
  },
  {
    keys: ['баланс', 'мой баланс'], title: '💰 Баланс',
    about: 'Сколько XP можно потратить: в Лавке, на переводы и в казино. Звание считается по всему XP, траты его не снижают',
    how: [['Баланс', 'Твой баланс']],
  },
  {
    keys: ['передать', 'перевести', 'подарить'], title: '🎁 Передать',
    about: () => `Перевод XP со своего баланса: от ${games.GIFT_MIN} до ${games.GIFT_MAX} за раз, ${games.GIFTS_PER_DAY} раз в день`,
    how: [['Передать 100 (ответом)', 'Перевести 100 XP автору сообщения']],
  },
  {
    keys: ['казино', 'слоты', 'слот', 'кости', 'кубик', 'кубики'], title: '🎰 Казино · 🎲 Кости',
    about: () => `Ставка XP с баланса от ${games.STAKE_MIN} до ${games.STAKE_MAX}, до ${games.GAMES_PER_DAY} игр в день`,
    how: [['Казино 50', 'Слоты: 777 ×20, три в ряд ×7, две семёрки ×2'], ['Кости 50', 'Кубик: 6 ×2,5, 4–5 ×1,5'], ['Казино', 'Правила']],
  },
  {
    keys: Object.keys(STAT_WORDS), title: '📊 Стата',
    about: 'Актив чата и твоё место. Период переключается кнопками: день, неделя, месяц, всё время. В 23:55 МСК Финя сама подводит итоги дня',
    how: [['Стата', 'За сегодня'], ['Топ Недели · Топ Месяца', 'Сразу за неделю или месяц'], ['Актив', 'За всё время']],
  },
  {
    keys: ['напомни', 'напоминания', 'мои напоминания', '-напоминание', 'удалить напоминание'], title: '⏰ Напоминания',
    about: () => `Финя напомнит в чате, до ${reminders.PER_USER} напоминаний, не дальше чем на 30 дней`,
    how: [['Финя, Напомни Через 2ч Позвонить', 'Через минуты, часы или дни: «через 30 мин», «через 3 дня»'], ['Финя, Напомни В 18:30 Стрим', 'В это время по Москве'], ['Финя, Напомни Завтра В 10:00 Текст', 'Завтра'], ['Напоминания', 'Список с номерами'], ['-Напоминание 2', 'Удалить по номеру']],
  },
  {
    keys: ['ид', 'айди', 'id', 'мой ид', 'мой id'], title: '🆔 Ид',
    about: 'Твой ID в Telegram и ID чата',
    how: [['Ид', 'Твой ID'], ['Ид (ответом)', 'ID участника, только для админов']],
  },
  {
    keys: ['админы', 'кто админ', 'список админов', 'админы чата'], title: '⭐ Админы',
    about: 'Админы этого чата', how: [['Админы', 'Работает в чате Сквада']],
  },
  {
    keys: ['кто', 'инфа', 'вероятность', 'шанс', 'выбери', 'вопрос', 'когда'], title: '🔮 Финя, Кто · Инфа · Когда · Выбери',
    about: 'Развлекалки. Начинаются с «Финя,»',
    how: [['Финя, Кто самый красивый', 'Выберет случайного участника чата'], ['Финя, Инфа что завтра будет стрим', 'Шанс в процентах'], ['Финя, Когда будет стрим', 'Назовёт дату или ответит фразой'], ['Финя, Выбери пицца или суши', 'Выберет вариант, через «или» или запятую'], ['Финя, Будет стрим?', 'Ответ «да» или «нет» на вопрос со знаком «?»']],
  },
  {
    keys: ['созови', 'созови всех', 'созыв', 'созвать всех', 'позови всех', 'тегни всех'], title: '📣 Финя, Созови',
    about: () => `Тегает активных участников по ${SUMMON_PER_MESSAGE} в сообщении, не чаще раза в ${fmtWait(SUMMON_COOLDOWN)}`,
    how: [['Финя, Созови Идём на стрим', 'Созыв с текстом'], ['Созыв', 'Без текста']],
  },
  {
    keys: ['мут', 'размут', 'бан', 'разбан', 'кик', 'варн', 'снять варн', 'варны'], title: '🛡 Модерация',
    about: 'Для админов, работает, только когда владелец включил «Финя, Модерация Вкл»',
    how: [['Мут 1ч (ответом)\nПричина', 'Срок в первой строке, причина с новой строки'], ['Бан · Кик · Варн (ответом)', 'Так же, ответом на сообщение'], ['Размут · Разбан · Снять Варн', 'Отменить'], ['Варны (ответом)', 'Предупреждения участника']],
  },
  {
    keys: ['моя статья', 'статья', 'статья дня'], title: '⚖️ Моя Статья',
    about: 'Статья дня из «УК Сквада» по тому, как ты ведёшь себя в чатах: флуд, молчание, ночные посиделки, казино, РП. Одна на весь день',
    how: [['Моя Статья', 'Твоя статья на сегодня'], ['Статья (ответом) · Статья @ник', 'Статья участника']],
  },
  {
    keys: ['ближайшие др', 'дни рождения', 'ближайшие дни рождения', 'др скоро', 'чьи др', 'кто именинник', 'именинники'], title: '🎂 Ближайшие ДР',
    about: 'Дни рождения на месяц вперёд: в чате — его участников, в личке — всего Сквада',
    how: [['Ближайшие ДР', 'Список'], ['+ДР 16.12', 'Добавить свой, и Финя поздравит']],
  },
  {
    keys: ['возраст аккаунта', 'возраст', 'регистрация', 'дата регистрации'], title: '📅 Возраст Аккаунта',
    about: 'Примерно с какого времени человек в Telegram. Telegram дату не сообщает, Финя оценивает её по ID, с точностью до сезона',
    how: [['Возраст Аккаунта', 'Твой аккаунт'], ['Возраст Аккаунта (ответом)', 'Аккаунт участника']],
  },
  {
    keys: ['гороскоп', 'мой знак', 'знак', 'знак зодиака', 'мой знак зодиака'], title: '🔮 Гороскоп',
    about: 'Гороскоп на сегодня с ignio.com. Знак Финя берёт из твоего дня рождения в анкете, он виден и в «Кто Я»',
    how: [['Гороскоп', 'По твоему знаку, нужен «+ДР 16.12»'], ['Гороскоп Скорпион', 'По любому знаку'], ['Мой Знак · Знак (ответом)', 'Чей какой знак']],
  },
  {
    keys: ['до', 'сколько до'], title: '⏳ Финя, До…',
    about: 'Обратный отсчёт до праздника или даты',
    how: [['Финя, До Нового Года', 'Ещё: 8 марта, 23 февраля, 14 февраля, 9 мая, Хэллоуин, лето, осень, зима, весна'], ['Финя, До 31.12', 'До любой даты'], ['Финя, До Дня Рождения', 'До твоего ДР из анкеты']],
  },
  {
    keys: ['сравнить', 'сравни', 'сравнение'], title: '⚔️ Сравнить',
    about: 'Ты и участник рядом: XP, репутация, ачивки, награды, актив и стаж в чате. 🏆 у того, кто впереди',
    how: [['Сравнить (ответом)', 'Сравнить себя с автором сообщения'], ['Сравнить @ник', 'То же через @ник']],
  },
  {
    keys: ['навигатор'], title: '👑 Навигатор Сквада',
    about: 'Только владелец, в чате. Закреп с кнопками: канал, папка, чаты Сквада, магазин, правила, профиль и проекты. Финя сама правит его при новом посте, раз в сутки и после обновлений; удалят — отправит и закрепит заново',
    how: [['Финя, Навигатор', 'Поставить и закрепить в этом чате'], ['Финя, Навигатор Выкл', 'Убрать из этого чата']],
  },
  {
    keys: ['+рп', '-рп'], title: '👑 +РП',
    about: 'Только владелец: свои РП-действия',
    how: [['+РП Погладить = 🤚 гладит', 'Команда, знак «=», эмодзи и глагол'], ['-РП Погладить', 'Удалить своё действие']],
  },
  {
    keys: ['антифлуд', 'капча', 'модерация', 'итоги дня', 'прощание', 'вопрос дня'], title: '👑 Защита и итоги',
    about: 'Только владелец. То же переключается в «Панели» Mini App',
    how: [['Финя, Антифлуд Вкл · Выкл', 'Мут за флуд'], ['Финя, Капча Вкл · Выкл', 'Кнопка «Я не бот» для новичков'], ['Финя, Модерация Вкл · Выкл', 'Мут, бан и варны словами'], ['Финя, Итоги Дня Вкл · Выкл', 'Топ-3 дня в 23:55 МСК'], ['Финя, Прощание Вкл · Выкл', 'Пара слов тем, кто сам вышел из чата'], ['Финя, Вопрос Дня Вкл · Выкл', 'Опрос в 12:00 МСК'], ['Финя, Вопрос Дня', 'Отправить опрос в этот чат сейчас']],
  },
  {
    keys: ['эмодзи', 'эмоджи', 'премиум эмодзи'], title: '✨ Эмодзи',
    about: 'Только владелец, в личке с Финей: премиум-эмодзи в её ответах',
    how: [['Эмодзи', 'Какие эмодзи уже премиум'], ['Кинуть любой премиум-эмодзи', 'Финя заберёт весь его пак']],
  },
  {
    keys: ['обновить инфо'], title: '📥 Обновить Инфо',
    about: 'Только владелец: старая история чата из экспорта Telegram Desktop',
    how: [['Обновить Инфо', 'Инструкция и кнопка загрузки'], ['result.json в личку', 'Файл до 20 МБ можно просто прислать Фине']],
  },
];

const HELP_WORDS = /^(.+?)[\s,]+(?:помощь|помоги|хелп|help)$/u;

// Without «Финя,» only the exact command counts, so «кто бы мог помощь» stays a message.
function usageEntry(query, addressed) {
  const q = query.replace(/^([+-])\s+/u, '$1');
  let best = null;
  let length = -1;
  for (const entry of USAGE) {
    for (const key of entry.keys) {
      if ((q === key || (addressed && q.startsWith(key + ' '))) && key.length > length) {
        best = entry;
        length = key.length;
      }
    }
  }
  return best;
}

function usageText(entry) {
  const about = typeof entry.about === 'function' ? entry.about() : entry.about;
  return `❓ ${entry.title}\n<blockquote>${escapeHtml(about)}</blockquote>\n\nКак писать:\n` +
    entry.how.map(([cmd, what]) => `${escapeHtml(cmd)}\n<blockquote>${escapeHtml(what)}</blockquote>`).join('\n');
}

// «Награды помощь», «Финя, брак помощь». → true when answered.
async function commandHelp(message, rest, addressed) {
  const m = HELP_WORDS.exec(bare(rest));
  if (!m) return false;
  const entry = usageEntry(m[1], addressed);
  if (entry) {
    await say(message, usageText(entry), { temp: true });
    await feats.mark(message.from.id, `help:${entry.keys[0]}`);
    return true;
  }
  const found = await social.matchAction(m[1]);
  if (found && (addressed || !found.rest)) {
    await feats.mark(message.from.id, `help:rp:${found.cmd}`);
    await say(message, usageText({
      title: `🤗 ${found.cmd.charAt(0).toUpperCase()}${found.cmd.slice(1)}`, about: `РП-действие: «${found.action}»`,
      how: [[`${found.cmd} (ответом)`, 'С автором сообщения'], [`${found.cmd} текст (ответом)`, 'Со своим текстом после команды'],
        [`@finya_helper_Squad_bot ${found.cmd} @ник`, 'В любом другом чате, даже в личке']],
    }), { temp: true });
    return true;
  }
  if (!addressed) return false;
  await say(message, `🤔 Не знаю команду «${escapeHtml(truncate(m[1], 40))}». Все команды: «Финя, Команды».`, { temp: true });
  return true;
}

function helpKeyboard(owner, current = null) {
  const keys = Object.keys(HELP).filter((k) => owner || k !== 'owner');
  const rows = [];
  for (let i = 0; i < keys.length; i += 2) {
    rows.push(keys.slice(i, i + 2).map((k) => button(k === current ? `• ${HELP[k][0]}` : HELP[k][0], { callback_data: `help:${k}:${owner ? 1 : 0}` })));
  }
  return keyboard(rows);
}

function helpText(section, moderation) {
  if (!HELP[section]) {
    return '🤖 Финя в чате\n\nКоманды пишутся словами, как у Ириса. Выбери раздел кнопкой ниже 👇\n\n' +
      'Как пользоваться любой командой: допиши «помощь», например «Награды Помощь».';
  }
  const [title, rows] = HELP[section];
  return `${title}\n\n` + rows(moderation).map(([cmd, about]) => `${cmd}\n<blockquote>${about}</blockquote>`).join('\n');
}

// ---- owner settings ----------------------------------------------------------------

const SWITCHES = {
  'антифлуд': ['chat_antiflood', 'Антифлуд', 'включён', 'выключен'],
  'капча': ['chat_captcha', 'Капча для новичков', 'включена', 'выключена'],
  'модерация': ['chat_moderation', 'Модерация командами', 'включена', 'выключена'],
  'итоги дня': ['chat_daily', 'Итоги дня в чатах', 'включены', 'выключены'],
  'прощание': ['chat_farewell', 'Прощание с ушедшими', 'включено', 'выключено'],
  'вопрос дня': ['chat_question', 'Вопрос дня в чатах', 'включён', 'выключен'],
};

export const HISTORY_TEXT = '📥 Обновить инфо: старая история чата\n\n'
  + 'Боты не видят сообщения, которые были до них, даже с правами админа. Поэтому историю берём из экспорта:\n'
  + '1. Telegram Desktop → чат → ⋮ → «Экспорт истории чата».\n'
  + '2. Сними галочки с медиа, формат — «Машиночитаемый JSON».\n'
  + '3. «Панель» в Mini App → «История чата» → выбери файл result.json.\n'
  + 'Или просто пришли result.json Фине в личку, если он до 20 МБ (больше Telegram ботам не отдаёт).\n\n'
  + 'Фине нужно только, кто и сколько писал по дням. Повторная загрузка ничего не задвоит.';

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
  m = /^навигатор(?:\s+(выкл|off))?$/u.exec(bare(rest));
  if (m) {
    if (!isGroupChat(message.chat)) {
      await say(message, '🧭 Навигатор ставится в чате: напиши там «Финя, Навигатор».');
    } else if (m[1]) {
      await say(message, (await navigator.remove(message.chat.id)) ? '🧭 Навигатор убран из этого чата.' : '🧭 В этом чате навигатора нет.', { temp: true });
    } else {
      try {
        const { pinned } = await navigator.place(message.chat);
        if (!pinned) await say(message, '🧭 Навигатор отправлен, но закрепить не вышло: дай Фине право закреплять сообщения.', { temp: true });
      } catch (err) {
        if (!(err instanceof BotApiError)) throw err;
        await say(message, '❌ Не получилось отправить навигатор в этот чат.', { temp: true });
      }
    }
    return true;
  }
  if (/^вопрос дня$/u.test(bare(rest)) && isGroupChat(message.chat)) {
    try {
      await questions.postQuestion(message.chat.id);
    } catch (err) {
      if (!(err instanceof BotApiError)) throw err;
      await say(message, '❌ Не получилось отправить опрос: у Фини нет права на опросы в этом чате.', { temp: true });
    }
    return true;
  }
  m = /^-рп\s+(.+)$/iu.exec(rest);
  if (m) {
    const ok = await social.removeAction(m[1]);
    await say(message, ok ? '🗑 Действие удалено.' : 'Такого своего действия нет. Встроенные удалить нельзя.');
    return true;
  }
  m = /^(антифлуд|капча|модерация|итоги дня|прощание|вопрос дня)\s+(вкл|выкл|on|off)$/iu.exec(norm(rest));
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
  const self = await withNick(person(message.from));

  // «СЕКРЕТ ТЬМЫ»: the phrase in a chat, in reply to someone else. The badge itself
  // comes from checkAchievements right after.
  const replied = group ? repliedTo(message) : null;
  if (replied && replied.id !== self.id && feats.isDarkPhrase(text)) {
    await feats.mark(self.id, 'dark');
    await say(message, 'СЛАВА СКВАДУ!', { temp: true });
    return true;
  }
  if (await commandHelp(message, rest, addressed)) return true;
  if (owner && (await ownerCommand(message, rest))) return true;

  if (addressed && !cmd) {
    await say(message, '👋 На месте! Все команды: «Финя, Команды».', { temp: true });
    return true;
  }
  if (cmd === 'команды' || (addressed && ['помощь', 'help'].includes(cmd))) {
    await say(message, helpText(null), { markup: helpKeyboard(owner), temp: true });
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
  if (['моя анкета', 'анкета'].includes(cmd) || /^анкета\s+@\w+$/u.test(cmd)) {
    const asked = cmd !== 'моя анкета' && group ? await targetOf(message) : null;
    const who = asked || self;
    await showAnketa(message, who, who.id === self.id);
    return true;
  }
  if (await anketaInfoCommand(message, self, rest)) return true;
  // A bare «топ» is too often praise («топ!»), so it needs «Финя, топ».
  if ((addressed && cmd === 'топ') || ['топ xp', 'топ хп', 'топ сквада'].includes(cmd)) {
    await say(message, await xpTopText(false), { temp: true });
    return true;
  }
  if (cmd === 'фарм' || cmd === 'ферма') {
    await farm(message);
    return true;
  }
  if (['браки', 'пары', 'список браков', 'топ пар'].includes(cmd)) {
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
  if (['мои отношения', 'мои отны', 'отношения', 'отны'].includes(cmd)) {
    const asked = ['отношения', 'отны'].includes(cmd) && group ? await targetOf(message) : null;
    const who = asked && !asked.isBot ? asked : self;
    await datingStatus(message, who, who.id === self.id);
    return true;
  }
  const start = /^(?:начало|дата|старт)\s+(брака|отношений|отнош|отнов)(?:\s+(\S+))?$/u.exec(cmd);
  if (start) {
    const kind = start[1] === 'брака' ? 'marriage' : 'dating';
    try {
      const partnerId = await social.setPairSince(kind, self.id, start[2]);
      const pair = kind === 'marriage' ? await social.spouseOf(self.id) : await social.partnerOf(self.id);
      const partner = escapeHtml(truncate(await members.nameOf(partnerId), 40));
      await say(message, `${kind === 'marriage' ? '💍 Брак' : '💞 Отношения'} с ${partner} теперь ${kind === 'marriage' ? 'считается' : 'считаются'} с ` +
        `${fmtMsk(pair.since).slice(0, 10)}: ${daysWord(social.marriedDays(pair.since))} вместе. Поменять снова можно через месяц.`, { temp: true });
    } catch (err) {
      if (!(err instanceof social.SocialError)) throw err;
      await say(message, `❌ ${err.message}`, { temp: true });
    }
    return true;
  }
  if (['расстаться', 'расстаемся'].includes(cmd)) {
    await breakUpPrompt(message);
    return true;
  }
  if (['кто встречается', 'список отношений', 'список отнош', 'отношения список'].includes(cmd)) {
    await say(message, await datingListText(), { temp: true });
    return true;
  }
  const theme = /^тема графика(?:\s+(.+))?$/u.exec(cmd);
  if (theme) {
    await themeCommand(message, self, theme[1]);
    return true;
  }
  if (cmd === '+гражданство' || cmd === '+ гражданство') {
    if (group) await citizenCommand(message, self);
    else await say(message, '🏡 Гражданство берут в чате: напиши там «+Гражданство».', { temp: true });
    return true;
  }
  if (cmd === '-гражданство' || cmd === '- гражданство') {
    const removed = await anketa.dropCitizenship(self.id);
    await say(message, removed ? '🏡 Гражданство снято.' : 'Гражданства и так нет. Взять: «+Гражданство» в своём чате.', { temp: true });
    return true;
  }
  if (group && ['кто граждане', 'все граждане', 'кто гражданин', 'граждане', 'гражданство'].includes(cmd)) {
    await say(message, await citizensText(message.chat.id, message.chat.title), { temp: true });
    return true;
  }
  if (group && ['чат инфо', 'инфо чата', 'инфо чат', 'о чате', 'чат стата'].includes(cmd)) {
    await chatInfo(message);
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
  if (['штаб', 'состав', 'должности', 'штаб сквада', 'команда сквада'].includes(cmd)) {
    await say(message, await teamText(), { temp: true });
    return true;
  }
  const job = /^должность(?:\s+([\s\S]+))?$/u.exec(cmd);
  if (job && !(job[1] && /^@\w+$/u.test(job[1]))) {
    const position = job[1] ? staff.find(job[1]) : null;
    if (job[1] && !position) {
      await say(message, `💼 Такой должности нет. Есть: ${positionList()}.`, { temp: true });
      return true;
    }
    if (position) {
      await say(message, await positionText(position), { temp: true });
      return true;
    }
  }
  if (job) {
    const asked = group ? await targetOf(message) : null;
    const who = asked && !asked.isBot ? asked : self;
    await say(message, await memberPositionsText(who, who.id === self.id), { temp: true });
    return true;
  }
  if (/^(?:мои )?ачивки(?:\s+@\w+)?$/u.test(cmd)) {
    const asked = group ? await targetOf(message) : null;
    const who = asked && !asked.isBot ? asked : self;
    await say(message, await achievementsText(who, who.id === self.id), {
      markup: keyboard([await profileRow(message.chat, '🏆 Все ачивки')]), temp: true,
    });
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

  // Nick, balance, ID, reputation top, casino and reminders work in the private chat too.
  const nickSet = /^\+\s?ник(?:\s+([\s\S]*))?$/iu.exec(rest.trim());
  if (nickSet) {
    try {
      const nick = await bio.setNick(self.id, nickSet[1]);
      await say(message, `🏷 Теперь ты «${escapeHtml(nick)}». Так Финя зовёт тебя в топах, профиле и РП.`, { temp: true });
    } catch (err) {
      if (!(err instanceof bio.BioError)) throw err;
      await say(message, `❌ ${err.message}`, { temp: true });
    }
    return true;
  }
  if (cmd === '-ник' || cmd === '- ник') {
    const removed = await bio.clearNick(self.id);
    await say(message, removed ? '🗑 Ник убран: снова зову по имени из Telegram.' : 'Ника и так нет.', { temp: true });
    return true;
  }
  if (/^ник(?:\s+@\w+)?$/u.test(cmd)) {
    const asked = group ? await targetOf(message) : null;
    await say(message, await nickText(asked || self, !asked || asked.id === self.id), { temp: true });
    return true;
  }
  if (['баланс', 'мой баланс'].includes(cmd)) {
    await say(message, await balanceText(self), { temp: true });
    return true;
  }
  if (['ид', 'айди', 'id', 'мой ид', 'мой id'].includes(cmd)) {
    const asked = group ? await targetOf(message) : null;
    await say(message, await idText(message, self, asked), { temp: true });
    return true;
  }
  if (['топ репы', 'топ репутации', 'топ репа', 'топ рептуации'].includes(cmd)) {
    await say(message, await repTopText(), { temp: true });
    return true;
  }
  if (['казино', 'слоты', 'кости'].includes(cmd)) {
    await say(message, CASINO_RULES, { temp: true });
    return true;
  }
  const bet = /^(казино|слоты|слот|кости|кубик|кубики)\s+(\d{1,7})(?:\s*(?:xp|хп))?$/u.exec(cmd);
  if (bet) {
    await casino(message, self, ['кости', 'кубик', 'кубики'].includes(bet[1]) ? '🎲' : '🎰', Number(bet[2]));
    return true;
  }
  const remind = /^напомни(?:\s+мне)?\s+([\s\S]+)$/iu.exec(rest.trim());
  if (remind && (await remindCommand(message, self, remind[1], addressed))) return true;
  if (['напоминания', 'мои напоминания'].includes(cmd)) {
    await say(message, await remindersText(self), { temp: true });
    return true;
  }
  const unremind = /^(?:-\s?напоминание|удалить напоминание)\s+(\d{1,2})$/u.exec(cmd);
  if (unremind) {
    const removed = await reminders.remove(self.id, Number(unremind[1]));
    await say(message, removed ? '🗑 Напоминание удалено.' : 'Такого напоминания нет. Список: «Напоминания».', { temp: true });
    return true;
  }

  if (/^(?:моя статья|статья|статья дня)(?:\s+@\w+)?$/u.test(cmd)) {
    const asked = cmd !== 'моя статья' && group ? await targetOf(message) : null;
    const who = asked && !asked.isBot ? asked : self;
    await say(message, await extras.articleText(who), { temp: true });
    return true;
  }
  if (['ближайшие др', 'дни рождения', 'др скоро', 'чьи др', 'кто именинник', 'именинники', 'ближайшие дни рождения'].includes(cmd)) {
    await say(message, await extras.birthdaysText(group ? message.chat.id : null), { temp: true });
    return true;
  }
  const horo = /^гороскоп(?:\s+(.+))?$/u.exec(cmd);
  if (horo) {
    const sign = horo[1] ? extras.signByName(horo[1]) : await extras.zodiacOf(self.id);
    if (!sign) {
      await say(message, horo[1]
        ? '🔮 Такого знака нет. Например: «Гороскоп Рыбы».'
        : '🔮 Сначала добавь день рождения: «+ДР 16.12». Или спроси про знак: «Гороскоп Овен».', { temp: true });
    } else {
      await say(message, await extras.horoscopeText(sign), { temp: true });
      await feats.streakDaily(self.id, 'horo');
    }
    return true;
  }
  if (/^(?:мой знак|знак|знак зодиака|мой знак зодиака)(?:\s+@\w+)?$/u.test(cmd)) {
    const asked = cmd.startsWith('мой') || !group ? null : await targetOf(message);
    const who = asked && !asked.isBot ? asked : self;
    const sign = await extras.zodiacOf(who.id);
    const whose = who.id === self.id ? 'Твой знак' : `Знак ${escapeHtml(truncate(who.name, 40))}`;
    await say(message, sign
      ? `${sign.emoji} ${whose}: ${sign.name}. Гороскоп на сегодня: «Гороскоп».`
      : (who.id === self.id ? '🔮 Знак видно по дню рождения: «+ДР 16.12».' : '🔮 Участник не указал день рождения.'), { temp: true });
    return true;
  }
  const till = /^(?:сколько\s+)?до\s+(.+)$/u.exec(cmd);
  if (till) {
    const target = ['дня рождения', 'моего дня рождения', 'др', 'моего др'].includes(till[1])
      ? await birthdayTarget(self.id) : extras.countdownTarget(till[1]);
    if (target) {
      await say(message, extras.countdownText(target), { temp: true });
      return true;
    }
    if (addressed) {
      await say(message, '⏳ Не знаю такую дату. Например: «Финя, до Нового года», «Финя, до 8 марта», «Финя, до 31.12».', { temp: true });
      return true;
    }
  }
  if (/^(?:возраст аккаунта|возраст|регистрация|дата регистрации)(?:\s+@\w+)?$/u.test(cmd)) {
    const asked = group ? await targetOf(message) : null;
    await say(message, extras.accountAgeText(asked || self), { temp: true });
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
    const { text: stats, markup } = await statsPanel(message.chat.id, STAT_WORDS[cmd], self);
    await say(message, stats, { markup, temp: true });
    return true;
  }
  if (['админы', 'кто админ', 'список админов', 'админы чата'].includes(cmd)) {
    await say(message, await adminsText(message.chat.id), { temp: true });
    return true;
  }
  const call = /^(?:созови(?:\s+всех)?|созыв|созвать всех|позови всех|тегни всех)(?:[\s,:]+([\s\S]*))?$/iu.exec(rest.trim());
  if (call && (addressed || /^(?:созыв|созвать всех)$/u.test(cmd))) {
    await summon(message, self, call[1]);
    return true;
  }
  const hint = message.reply_to_message || (message.entities || []).some((e) => ['mention', 'text_mention'].includes(e.type));
  const target = hint ? await targetOf(message) : null;
  if (cmd === 'брак') {
    if (target && target.id !== self.id) await propose(message, target);
    else await marriageStatus(message);
    return true;
  }
  if (cmd === 'встречаться') {
    if (target && target.id !== self.id) await offerDate(message, target);
    else await datingStatus(message, self, true);
    return true;
  }
  const appoint = /^([+-])\s?должность(?:\s+([\s\S]*))?$/iu.exec(rest.trim());
  if (appoint) {
    await positionCommand(message, self, target, appoint[1] === '+', appoint[2]);
    return true;
  }
  const gift = /^(?:передать|перевести|подарить)\s+(\d{1,7})(?:\s*(?:xp|хп|опыта?))?$/u.exec(cmd);
  if (gift && target) {
    await giftCommand(message, self, target, Number(gift[1]));
    return true;
  }
  if (THANKS.has(cmd) && target) {
    await plusRep(message, target);
    return true;
  }
  if (/^(?:сравнить|сравни|сравнение)(?:\s+@\w+)?$/u.test(cmd) && target && !target.isBot && target.id !== self.id) {
    await say(message, await compareText(message.chat.id, self, target), { temp: true });
    await feats.mark(self.id, `cmp:${target.id}`);
    return true;
  }
  if (MINUS.has(cmd) && target) {
    await minusRep(message, target);
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
    await say(message, removed ? `🗑 Награда ${bio.degreeIcon(removed.degree)} ${escapeHtml(removed.text)} снята.` : 'Такой награды нет. Номера — в «Награды» ответом.', { temp: true });
    return true;
  }
  if (/^снять\s+все\s+награды(?:\s+@\w+)?$/u.test(cmd) && target) {
    if (!(await canAward(message.chat.id, self.id))) {
      await say(message, '🏅 Снимать награды могут только админы чата.', { temp: true });
      return true;
    }
    const n = await bio.removeAllAwards(target.id);
    await say(message, n ? `🗑 ${mention(target.id, target.name)}: сняты все награды (${n}).` : 'Наград у участника нет.', { temp: true });
    return true;
  }
  if (/^снять\s+награды\s+от(?:\s+@\w+)?$/u.test(cmd) && target) {
    const n = await bio.removeAwardsFrom(self.id, target.id);
    await say(message, n ? `🗑 Сняты твои награды от этого участника: ${n}.` : 'От этого участника у тебя наград нет.', { temp: true });
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
  const tracked = await members.track(message);
  const checking = [];
  for (const u of message.new_chat_members || []) {
    if (members.isPerson(u) && (await moder.onJoin(message.chat, u, message.message_id))) checking.push(u.id);
  }
  if (message.left_chat_member) await moder.onLeave(message.chat.id, message.left_chat_member.id);
  if (await moder.checkFlood(message)) return { handled: false, checking };
  const handled = command ? false : await handleText(message);
  if (members.isPerson(message.from) && !message.sender_chat) await checkAchievements(message, handled, tracked);
  return { handled, checking };
}

// chat_member in a Squad chat: the member list and the newcomer check.
export async function onSquadChatMember(event) {
  await members.handleChatMember(event);
  const m = event.new_chat_member;
  const old = event.old_chat_member && event.old_chat_member.status;
  if (!m || !members.isPerson(m.user)) return;
  if (m.status === 'member' && ['left', 'kicked'].includes(old)) await moder.onJoin(event.chat, m.user);
  if (['left', 'kicked'].includes(m.status)) await moder.onLeave(event.chat.id, m.user.id, { banned: m.status === 'kicked' });
  // Left on their own after being a full member: not a ban, not a newcomer who skipped the captcha.
  if (m.status === 'left' && ['member', 'administrator'].includes(old)) await farewell(event.chat, m.user);
}

async function farewell(chat, user) {
  if (!(await getSetting('chat_farewell'))) return;
  const name = mention(user.id, await members.nameOf(user.id));
  try {
    const sent = await withPremium({ chat_id: chat.id, text: boldHtml(`👋 ${name} покидает чат. Возвращайся, будем ждать!`), parse_mode: 'HTML' },
      (p) => api.sendMessage(p));
    if (sent && sent.message_id) await deleteLater(chat.id, [sent.message_id]);
  } catch {
    // No rights to write here any more.
  }
}

// ---- buttons -------------------------------------------------------------------------

async function edit(query, text, markup) {
  const params = {
    chat_id: query.message.chat.id, message_id: query.message.message_id, text: boldHtml(text), parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };
  // A new keyboard keeps «✖️ Закрыть».
  const close = closeRowOf(query.message);
  if (close && !closeRowOf({ reply_markup: markup })) markup = { inline_keyboard: [...((markup && markup.inline_keyboard) || []), close] };
  if (markup) params.reply_markup = markup;
  try {
    await withPremium(params, (p) => api.editMessageText(p));
  } catch {
    // Too old or unchanged.
  }
}

// «✖️ Закрыть»: the one who asked, a chat admin or the owner removes the answer and
// the command it answered.
async function closeButton(query, userId) {
  const chatId = query.message.chat.id;
  if (query.from.id !== userId && !(await canAward(chatId, query.from.id))) {
    await answer(query, 'Закрыть может тот, кто вызвал, или админ 🙂', true);
    return;
  }
  await answer(query);
  const ids = [query.message.message_id];
  const asked = query.message.reply_to_message;
  if (asked && asked.from && asked.from.id === userId) ids.push(asked.message_id);
  for (const id of ids) {
    try {
      await api.deleteMessage({ chat_id: chatId, message_id: id });
    } catch {
      // Already gone or older than 48 hours.
    }
    await db.run(sql`DELETE FROM autodelete WHERE chat_id = ${chatId} AND message_id = ${id}`);
  }
}

async function marryButton(query, yes, fromId, toId) {
  const presser = query.from.id;
  if (presser !== toId && !(presser === fromId && !yes)) {
    await answer(query, presser === fromId ? 'Ждём ответа второй половинки 💍' : 'Это предложение не тебе 🙂', true);
    return;
  }
  const a = mention(fromId, await members.nameOf(fromId));
  const b = mention(toId, presser === toId ? await nameFor(query.from) : await members.nameOf(toId));
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

async function dateButton(query, yes, fromId, toId) {
  const presser = query.from.id;
  if (presser !== toId && !(presser === fromId && !yes)) {
    await answer(query, presser === fromId ? 'Ждём ответа 💞' : 'Это предложение не тебе 🙂', true);
    return;
  }
  const a = mention(fromId, await members.nameOf(fromId));
  const b = mention(toId, presser === toId ? await nameFor(query.from) : await members.nameOf(toId));
  if (!yes) {
    const had = await social.declineDate(fromId, toId);
    await answer(query);
    if (had) await edit(query, presser === fromId ? `💞 ${a} передумывает.` : `💔 ${b} отвечает ${a} отказом.`);
    else await edit(query, '💞 Предложение уже не действует.');
    return;
  }
  try {
    await social.acceptDate(fromId, toId);
  } catch (err) {
    if (!(err instanceof social.SocialError)) throw err;
    await answer(query, err.message, true);
    await edit(query, `💞 ${err.message}`);
    return;
  }
  await answer(query, 'Любви вам! 💞');
  await edit(query, `💞 ${a} и ${b} теперь встречаются!\nКогда будете готовы: «Брак» ответом 💍`);
}

async function breakUpButton(query, yes, userId, partnerId) {
  if (query.from.id !== userId) {
    await answer(query, 'Это решение не за тобой 🙂', true);
    return;
  }
  await answer(query);
  if (!yes) {
    await edit(query, '💞 Отношения сохранены.');
    return;
  }
  // The button names the partner: an old prompt cannot end newer relations.
  if (!(await social.breakUp(userId, partnerId))) {
    await edit(query, '💔 Этих отношений уже нет.');
    return;
  }
  await edit(query, `💔 ${mention(userId, await nameFor(query.from))} и ${mention(partnerId, await members.nameOf(partnerId))} больше не встречаются.`);
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
  await edit(query, `💔 ${mention(userId, await nameFor(query.from))} и ${mention(partnerId, await members.nameOf(partnerId))} больше не в браке.`);
}

// Anyone in the chat switches the period; the panel is edited in place.
async function statsButton(query, period) {
  const viewer = await withNick(person(query.from));
  const mine = await members.placeOf(query.message.chat.id, period, viewer.id);
  await answer(query, mine ? `Ты №${mine.place} · ${msgsWord(mine.n)}` : 'За этот период у тебя сообщений нет');
  const { text, markup } = await statsPanel(query.message.chat.id, period, viewer);
  await edit(query, text, markup);
}

// Anyone switches the help section; the owner's one opens only for the owner.
async function helpButton(query, section, ownerMenu) {
  if (section === 'owner' && query.from.id !== OWNER_USER_ID) {
    await answer(query, 'Этот раздел только для владельца 🙂', true);
    return;
  }
  await answer(query);
  await edit(query, helpText(section, await getSetting('chat_moderation')), helpKeyboard(ownerMenu, section));
}

// → true when the button belongs to the chat features.
export async function handleCallback(query) {
  const data = String(query.data || '');
  const m = /^(marry|div|date|part|cap|mod|stat|help|close):/.exec(data);
  if (!m) return false;
  if (!query.message) {
    await answer(query);
    return true;
  }
  let p;
  if ((p = /^marry:([yn]):(\d+):(\d+)$/.exec(data))) await marryButton(query, p[1] === 'y', Number(p[2]), Number(p[3]));
  else if ((p = /^div:([yn]):(\d+):(\d+)$/.exec(data))) await divorceButton(query, p[1] === 'y', Number(p[2]), Number(p[3]));
  else if ((p = new RegExp(`^${CLOSE_PREFIX}(\\d+)$`).exec(data))) await closeButton(query, Number(p[1]));
  else if ((p = /^date:([yn]):(\d+):(\d+)$/.exec(data))) await dateButton(query, p[1] === 'y', Number(p[2]), Number(p[3]));
  else if ((p = /^part:([yn]):(\d+):(\d+)$/.exec(data))) await breakUpButton(query, p[1] === 'y', Number(p[2]), Number(p[3]));
  else if ((p = /^cap:(\d+)$/.exec(data))) await moder.captchaButton(query, Number(p[1]));
  else if ((p = /^mod:unmute:(\d+)$/.exec(data))) await moder.unmuteButton(query, Number(p[1]));
  else if ((p = /^stat:(day|week|month|all)$/.exec(data))) await statsButton(query, p[1]);
  else if ((p = /^help:(\w+):([01])$/.exec(data))) await helpButton(query, p[1], p[2] === '1');
  else await answer(query);
  return true;
}

// From pump().
export async function tick(leftMs) {
  await moder.tick(leftMs);
  await reminders.tick(leftMs);
  await anniversaries();
  await dailySummary();
  await questions.tick();
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
  const jobs = await staff.positionsOf(userId);
  return { rep: rep.points, marriage, positions: jobs.map((j) => ({ emoji: j.emoji, title: j.title })) };
}
