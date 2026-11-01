// What Финя does by herself: holidays from the calendar, answers to frequent questions,
// a watch over the «Штаб» and a word to members who went quiet. Everything runs from
// pump() (tick) or from a message in a Squad chat (onMessage, faqAnswer).
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { CHANGES } from './changelog.js';
import { tellUser } from './club.js';
import * as feats from './feats.js';
import { HOLIDAYS } from './hall.js';
import { nameOf } from './members.js';
import * as staff from './staff.js';
import { getSetting, logError, setSetting } from './store.js';
import { button, keyboard } from './tg.js';
import { boldHtml, escapeHtml, MSK_OFFSET, nowInt, truncate } from './util.js';
import * as xp from './xp.js';
import { squadChatIds } from './xpchat.js';

const DAY = 86400;
const mskDay = (ts) => Math.floor((Math.floor(ts) + MSK_OFFSET) / DAY);
const hourOf = (ts) => new Date((Math.floor(ts) + MSK_OFFSET) * 1000).getUTCHours();

// Once per `value` (a day number) for `key`, whoever wakes first.
async function claim(key, value) {
  await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, ${String(value - 1)})`);
  const won = await db.run(sql`UPDATE settings SET value = ${String(value)}
    WHERE key = ${key} AND CAST(value AS INTEGER) < ${value}`);
  return won.rowsAffected === 1;
}

// ---- holidays ------------------------------------------------------------------------

export const HOLIDAY_XP = 20;

// A wish for each holiday of the calendar; the Squad's own events (the start of
// Halloween, the tree) have their own posts and get none.
const WISHES = {
  '1.1': 'Пусть этот год будет самым мощным для Сквада и для каждого из вас!',
  '7.1': 'Тепла, уюта и чудес в этот светлый день.',
  '14.2': 'Любви, взаимности и чтобы огонёк в паре не гас.',
  '23.2': 'Силы, стойкости и чтобы рядом всегда был свой Сквад.',
  '8.3': 'Милые девушки Сквада, вы лучшие! Весны, улыбок и счастья.',
  '1.4': 'Шутите смело, но помните: Финя всё видит 😏',
  '12.4': 'Тянемся к звёздам, Сквад! Покорять высоты вместе.',
  '1.5': 'Мира, весны и хорошего отдыха.',
  '9.5': 'Помним и гордимся. Мирного неба над головой.',
  '1.6': 'Пусть внутренний ребёнок радуется каждый день.',
  '1.9': 'Удачи в учёбе и работе, пусть всё получается.',
  '31.10': 'Сладостей побольше, гадостей поменьше. Жуткого вам вечера!',
  '4.11': 'Сквад сильнее, когда мы вместе.',
  '31.12': 'Провожаем год вместе со Сквадом. Спасибо, что вы с нами!',
};

// The holiday of this Moscow day, or null: { icon, title, wish }.
export function holidayOn(ts = nowInt()) {
  const d = new Date((Math.floor(ts) + MSK_OFFSET) * 1000);
  const key = `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
  const wish = WISHES[key];
  if (!wish) return null;
  const h = HOLIDAYS.find(([day, month]) => `${day}.${month}` === key);
  return h ? { icon: h[2], title: h[3], wish } : null;
}

export function holidayText(h) {
  return `${h.icon} ${escapeHtml(h.title)}! Сквад, с праздником 🎉\n\n${escapeHtml(h.wish)}\n\n` +
    `🎁 Праздничный бонус: напиши сегодня в чате и получи +${HOLIDAY_XP} XP.`;
}

async function holidayTick(ts) {
  if (!(await getSetting('chat_holidays'))) return;
  const h = holidayOn(ts);
  if (!h || hourOf(ts) < 10) return;
  for (const chatId of await squadChatIds()) {
    if (!(await claim(`holiday_day:${chatId}`, mskDay(ts)))) continue;
    try {
      await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: boldHtml(holidayText(h)) });
    } catch (err) {
      await logError('auto.holiday', err);
    }
  }
}

// A message in a Squad chat on a holiday: the bonus once a day, a 🎉 under the message.
async function holidayBonus(message, ts) {
  if (!(await getSetting('chat_holidays')) || !holidayOn(ts)) return;
  const got = await xp.grant(message.from, 'holiday', mskDay(ts), HOLIDAY_XP, ts);
  if (!got) return;
  await feats.bump(message.from.id, 'holiday');
  try {
    await api.setMessageReaction({ chat_id: message.chat.id, message_id: message.message_id, reaction: [{ type: 'emoji', emoji: '🎉' }] });
  } catch {
    // Reactions may be off in this chat: the bonus is there anyway.
  }
}

// ---- answers to frequent questions ------------------------------------------------------

// keys: words that must all be in the question (any form: a word may be its start).
export const DEFAULT_FAQ = [
  { keys: ['как', 'xp'], answer: 'XP дают за комментарии и реакции под постами, «Фарм» раз в час, награду дня и квесты в профиле Фини, загадки и опросы в чате. Все способы: «Финя, Команды».' },
  { keys: ['как', 'опыт'], answer: 'Опыт (XP) дают за комментарии и реакции под постами, «Фарм» раз в час, награду дня и квесты в профиле Фини, загадки и опросы в чате.' },
  { keys: ['где', 'правил'], answer: 'Правила Сквада: «Финя, Навигатор» или вкладка «Сквад» в профиле Фини.' },
  { keys: ['как', 'звани'], answer: 'Звание растёт само вместе с XP. Сколько осталось до следующего, видно в «Кто Я» и в профиле Фини.' },
  { keys: ['как', 'команд'], answer: 'Все команды Фини: «Финя, Команды». Про любую можно спросить так: «Фарм помощь».' },
  { keys: ['что', 'лавк'], answer: 'Лавка в профиле Фини: рамки, цвета ника, титулы и темы графика за XP с баланса. Звание при покупке не падает.' },
];
const FAQ_GAP = 10 * 60;
const QUESTION = /\?|^(как|где|что|когда|зачем|почему|сколько|можно)\b/iu;
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

export async function faqList() {
  const saved = await getSetting('faq_list');
  return Array.isArray(saved) ? saved : DEFAULT_FAQ;
}

// The owner's list from the Mini App: [{ keys: 'как, xp', answer }].
export async function saveFaq(list) {
  if (!Array.isArray(list) || list.length > 30) throw new Error('До 30 автоответов.');
  const clean = list.map((f) => ({
    keys: (Array.isArray(f.keys) ? f.keys : String(f.keys || '').split(','))
      .map((k) => norm(k).trim()).filter(Boolean).slice(0, 5),
    answer: String(f.answer || '').trim().slice(0, 500),
  })).filter((f) => f.keys.length && f.answer);
  await setSetting('faq_list', clean);
  return clean;
}

function matches(text, keys) {
  const words = norm(text).split(/[^a-zа-я0-9]+/u).filter(Boolean);
  return keys.every((k) => words.some((w) => w.startsWith(norm(k))));
}

// A question in a Squad chat that the list answers: the answer in reply, at most once
// in 10 minutes for each answer in each chat. → true when answered.
export async function faqAnswer(message, text) {
  if (!(await getSetting('chat_faq')) || !QUESTION.test(text.trim())) return false;
  const list = await faqList();
  const i = list.findIndex((f) => matches(text, f.keys));
  if (i < 0) return false;
  const ts = nowInt();
  const key = `faq_at:${message.chat.id}:${list[i].keys.join(',')}`;
  await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, '0')`);
  const won = await db.run(sql`UPDATE settings SET value = ${String(ts)}
    WHERE key = ${key} AND CAST(value AS INTEGER) <= ${ts - FAQ_GAP}`);
  if (won.rowsAffected !== 1) return false;
  try {
    await api.sendMessage({
      chat_id: message.chat.id, parse_mode: 'HTML', text: boldHtml(`💡 ${escapeHtml(list[i].answer)}`),
      reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
      ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
    });
  } catch {
    return false;
  }
  return true;
}

// ---- «Штаб» without looking after it ------------------------------------------------------

export const STAFF_QUIET_DAYS = 14;
export const STAFF_ALERT_DAYS = 21;

// The last time a member wrote in a Squad chat or commented under a post.
async function lastSeen(userId) {
  const row = await db.get(sql`SELECT MAX(t) AS t FROM (
      SELECT MAX(last_active) AS t FROM chat_members WHERE user_id = ${userId}
      UNION ALL SELECT MAX(earned_at) AS t FROM events WHERE user_id = ${userId} AND kind = 'comment')`);
  return (row && row.t) || 0;
}

export function staffDropKeyboard(userId, jobs) {
  return keyboard(jobs.map((j) => [button(`Снять «${j.title}»`, { callback_data: `staffdrop:${userId}:${j.code}` })]));
}

// From 12:00 MSK, once a day: a word to whom is quiet for 14 days, the owner hears at 21.
async function staffTick(ts) {
  if (!(await getSetting('auto_staff')) || hourOf(ts) < 12) return;
  if (!(await claim('staff_watch_day', mskDay(ts)))) return;
  const people = await db.all(sql`SELECT DISTINCT user_id, MIN(given_at) AS since FROM positions GROUP BY user_id`);
  for (const p of people) {
    if (p.user_id === OWNER_USER_ID) continue;
    // Silence counts from the appointment at the earliest.
    const seen = Math.max(await lastSeen(p.user_id), p.since);
    const quiet = Math.floor((ts - seen) / DAY);
    const nudged = await getSetting(`staff_nudge:${p.user_id}`);
    if (nudged && nudged.at < seen) {
      await db.run(sql`DELETE FROM settings WHERE key = ${`staff_nudge:${p.user_id}`}`);
      continue;
    }
    if (quiet < STAFF_QUIET_DAYS) continue;
    const jobs = await staff.positionsOf(p.user_id);
    if (!jobs.length) continue;
    if (!nudged) {
      await setSetting(`staff_nudge:${p.user_id}`, { at: ts, told: false });
      await tellUser(p.user_id, `👋 Тебя не было в Скваде уже ${quiet} дней.\n\n` +
        `У тебя должность: ${jobs.map((j) => `${j.emoji} ${escapeHtml(j.title)}`).join(', ')}. Загляни в чат, команда ждёт!`);
    } else if (!nudged.told && quiet >= STAFF_ALERT_DAYS) {
      await setSetting(`staff_nudge:${p.user_id}`, { at: nudged.at, told: true });
      await tellUser(OWNER_USER_ID, `💤 ${escapeHtml(truncate(await nameOf(p.user_id), 40))} молчит уже ${quiet} дней, ` +
        `хотя Финя напоминала.\n\nДолжность: ${jobs.map((j) => `${j.emoji} ${escapeHtml(j.title)}`).join(', ')}.`,
      staffDropKeyboard(p.user_id, jobs));
    }
  }
}

// ---- members who went quiet -------------------------------------------------------------

export const COMEBACK_XP = 30;
const COMEBACK_AFTER = 7 * DAY;
const COMEBACK_WINDOW = 3 * DAY;
const COMEBACK_EVERY = 30 * DAY;
const COMEBACK_PER_RUN = 15;

// From 14:00 MSK, a few at a time: whom Финя knows from the chats, who started the
// bot and is quiet for 7–60 days gets one message a month with a bonus for coming back.
async function comebackTick(ts) {
  if (!(await getSetting('auto_comeback')) || hourOf(ts) < 14 || hourOf(ts) >= 22) return;
  const rows = await db.all(sql`SELECT m.user_id, MAX(m.last_active) AS seen FROM chat_members m
    JOIN users u ON u.user_id = m.user_id AND (u.blocked IS NULL OR u.blocked = 0)
    WHERE m.status = 'member' AND m.user_id != ${OWNER_USER_ID}
    GROUP BY m.user_id HAVING seen < ${ts - COMEBACK_AFTER} AND seen > ${ts - 60 * DAY}
    ORDER BY seen DESC LIMIT 200`);
  let sent = 0;
  const news = CHANGES[0] ? `\n\n🆕 Что нового: ${escapeHtml(CHANGES[0].title)}.` : '';
  for (const r of rows) {
    if (sent >= COMEBACK_PER_RUN) break;
    const key = `comeback:${r.user_id}`;
    const last = await getSetting(key);
    if (last && last.at > ts - COMEBACK_EVERY) continue;
    await setSetting(key, { at: ts, claimed: false });
    const days = Math.floor((ts - r.seen) / DAY);
    await tellUser(r.user_id, `👋 Давно тебя не видно в Скваде: уже ${days} дней.${news}\n\n` +
      `🎁 Напиши в чате Сквада в ближайшие 3 дня и получи +${COMEBACK_XP} XP.`);
    sent++;
  }
}

async function comebackBonus(message, ts) {
  const key = `comeback:${message.from.id}`;
  const c = await getSetting(key);
  if (!c || c.claimed || c.at < ts - COMEBACK_WINDOW) return;
  await setSetting(key, { at: c.at, claimed: true });
  const got = await xp.grant(message.from, 'comeback', c.at % 1000000000, COMEBACK_XP, ts);
  if (!got) return;
  try {
    await api.sendMessage({
      chat_id: message.chat.id, parse_mode: 'HTML',
      text: boldHtml(`🎉 С возвращением, ${escapeHtml(truncate(await nameOf(message.from.id), 40))}! +${COMEBACK_XP} XP`),
      ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
    });
  } catch {
    // No right to write: the bonus is there anyway.
  }
}

// ---- entry points ------------------------------------------------------------------------

// Every message of a person in a Squad chat.
export async function onMessage(message, ts = nowInt()) {
  if (!message.from || message.from.is_bot || message.sender_chat) return;
  for (const [name, fn] of [['auto.holiday', holidayBonus], ['auto.comeback', comebackBonus]]) {
    try {
      await fn(message, ts);
    } catch (err) {
      await logError(name, err);
    }
  }
}

export async function tick(ts = nowInt()) {
  for (const [name, fn] of [['auto.holiday', holidayTick], ['auto.staff', staffTick], ['auto.comeback', comebackTick]]) {
    try {
      await fn(ts);
    } catch (err) {
      await logError(name, err);
    }
  }
}
