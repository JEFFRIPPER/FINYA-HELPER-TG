// Chat achievements: 63 more badges for what members do in the Squad chats
// (messages, active days, reputation, marriage, farm, casino…) and one secret. Checked after
// commands and every 10th message, announced right in the chat; the Mini App
// shows them together with the club ones (club.js).
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { MSK_OFFSET, nowInt } from './util.js';
import * as xp from './xp.js';

const DAY = 86400;

// `n` is the reward key in events (club ones are 1–16): never reuse or renumber.
const A = (n, code, stat, goal, reward, icon, title, text) => ({ n, code, stat, goal, xp: reward, icon, title, text, chat: true });
export const CHAT_ACHIEVEMENTS = [
  A(17, 'msgs_10', 'msgs', 10, 5, 'chat_bubble_fill', 'Первые шаги', '10 сообщений в чатах Сквада'),
  A(18, 'msgs_100', 'msgs', 100, 15, 'chat_bubble_fill', 'Свой в чате', '100 сообщений в чатах'),
  A(19, 'msgs_500', 'msgs', 500, 30, 'chat_bubble_fill', 'Душа компании', '500 сообщений в чатах'),
  A(20, 'msgs_1000', 'msgs', 1000, 50, 'chat_bubble_fill', 'Тысяча слов', '1 000 сообщений в чатах'),
  A(21, 'msgs_2500', 'msgs', 2500, 75, 'campaign_fill', 'Без умолку', '2 500 сообщений в чатах'),
  A(22, 'msgs_5000', 'msgs', 5000, 100, 'campaign_fill', 'Голос эпохи', '5 000 сообщений в чатах'),
  A(23, 'msgs_10000', 'msgs', 10000, 150, 'workspace_premium_fill', 'Десять тысяч', '10 000 сообщений в чатах'),
  A(24, 'msgs_25000', 'msgs', 25000, 250, 'diamond_fill', 'Живая легенда', '25 000 сообщений в чатах'),
  A(25, 'msgs_50000', 'msgs', 50000, 400, 'diamond_fill', 'Сердце чата', '50 000 сообщений в чатах'),
  A(26, 'days_3', 'days', 3, 5, 'calendar_month_fill', 'Снова тут', 'Пиши в чат 3 разных дня'),
  A(27, 'days_7', 'days', 7, 15, 'calendar_month_fill', 'Неделя с нами', 'Пиши в чат 7 разных дней'),
  A(28, 'days_30', 'days', 30, 40, 'calendar_month_fill', 'Месяц в чате', 'Пиши в чат 30 разных дней'),
  A(29, 'days_100', 'days', 100, 100, 'calendar_month_fill', 'Сотня дней', 'Пиши в чат 100 разных дней'),
  A(30, 'days_200', 'days', 200, 150, 'military_tech_fill', 'Старая гвардия', 'Пиши в чат 200 разных дней'),
  A(31, 'days_365', 'days', 365, 300, 'military_tech_fill', 'Год в строю', 'Пиши в чат 365 разных дней'),
  A(32, 'age_7', 'age', 7, 5, 'schedule_fill', 'Первая неделя', 'Неделя в Скваде с первого сообщения'),
  A(33, 'age_30', 'age', 30, 15, 'schedule_fill', 'Месяц стажа', 'Месяц в Скваде'),
  A(34, 'age_90', 'age', 90, 30, 'schedule_fill', 'Квартал в Скваде', '3 месяца в Скваде'),
  A(35, 'age_180', 'age', 180, 60, 'schedule_fill', 'Полгода вместе', 'Полгода в Скваде'),
  A(36, 'age_365', 'age', 365, 150, 'shield_person_fill', 'Год в Скваде', 'Целый год в Скваде'),
  A(37, 'day_50', 'bestDay', 50, 15, 'bolt_fill', 'Разгон', '50 сообщений за один день'),
  A(38, 'day_100', 'bestDay', 100, 30, 'bolt_fill', 'Марафон', '100 сообщений за один день'),
  A(39, 'day_300', 'bestDay', 300, 75, 'bolt_fill', 'Ураган', '300 сообщений за один день'),
  A(40, 'rep_10', 'repGot', 10, 15, 'favorite_fill', 'Уважение', 'Получи 10 репутации'),
  A(41, 'rep_50', 'repGot', 50, 40, 'favorite_fill', 'Авторитет', 'Получи 50 репутации'),
  A(42, 'rep_100', 'repGot', 100, 80, 'verified_fill', 'Народная любовь', 'Получи 100 репутации'),
  A(43, 'given_10', 'repGiven', 10, 10, 'mood_fill', 'Добрая душа', 'Поставь «+» 10 раз'),
  A(44, 'given_50', 'repGiven', 50, 30, 'mood_fill', 'Щедрость', 'Поставь «+» 50 раз'),
  A(45, 'given_100', 'repGiven', 100, 60, 'mood_fill', 'Источник добра', 'Поставь «+» 100 раз'),
  A(46, 'married', 'married', 1, 20, 'favorite_fill', 'Узы брака', 'Вступи в брак в Скваде'),
  A(47, 'married_30', 'marriageDays', 30, 30, 'celebration_fill', 'Медовый месяц', '30 дней в браке'),
  A(48, 'married_100', 'marriageDays', 100, 60, 'celebration_fill', 'Сто дней вместе', '100 дней в браке'),
  A(49, 'married_365', 'marriageDays', 365, 150, 'diamond_fill', 'Год вместе', 'Год в браке'),
  A(50, 'rp_10', 'rp', 10, 10, 'mood_fill', 'Игра началась', '10 РП-действий'),
  A(51, 'rp_100', 'rp', 100, 40, 'swords_fill', 'Мастерство РП', '100 РП-действий'),
  A(52, 'farm_10', 'farm', 10, 10, 'redeem_fill', 'Первый урожай', 'Собери фарм 10 раз'),
  A(53, 'farm_50', 'farm', 50, 30, 'redeem_fill', 'Своё хозяйство', 'Собери фарм 50 раз'),
  A(54, 'farm_100', 'farm', 100, 60, 'redeem_fill', 'Золотая нива', 'Собери фарм 100 раз'),
  A(55, 'casino_10', 'casino', 10, 10, 'quiz_fill', 'Азарт', 'Сыграй в казино 10 раз'),
  A(56, 'jackpot', 'jackpot', 1, 100, 'trophy_fill', 'Три семёрки', 'Выбей джекпот 7️⃣7️⃣7️⃣ в слотах'),
  A(57, 'gift_1', 'gifts', 1, 10, 'send_fill', 'Широкий жест', 'Переведи XP другому участнику'),
  A(58, 'gift_10', 'gifts', 10, 40, 'send_fill', 'Щедрая рука', 'Сделай 10 переводов XP'),
  A(59, 'night_50', 'night', 50, 20, 'visibility_fill', 'Ночная смена', '50 сообщений с 0:00 до 5:00 МСК'),
  A(60, 'early_50', 'early', 50, 20, 'rocket_launch_fill', 'Ранний подъём', '50 сообщений с 5:00 до 8:00 МСК'),
  A(61, 'award_1', 'awards', 1, 15, 'workspace_premium_fill', 'Первая награда', 'Получи награду от админа чата'),
  A(62, 'award_5', 'awards', 5, 50, 'emoji_events_fill', 'Коллекция наград', 'Получи 5 наград'),
  A(63, 'nick', 'nick', 1, 5, 'palette_fill', 'Новое имя', 'Поставь ник: «+Ник …»'),
  A(64, 'about', 'about', 1, 5, 'menu_book_fill', 'Пара слов о себе', 'Заполни «+Описание …»'),
  A(65, 'day_top', 'dayTop', 1, 30, 'leaderboard_fill', 'Звезда дня', 'Стань №1 в итогах дня'),
  A(66, 'reminders_5', 'reminders', 5, 10, 'check_circle_fill', 'Всё под контролем', 'Поставь 5 напоминаний'),
  A(67, 'couple', 'couple', 1, 20, 'favorite_fill', 'Вместе', 'Начни отношения: «Встречаться» ответом'),
  A(68, 'couple_30', 'coupleDays', 30, 40, 'celebration_fill', 'Всё серьёзно', '30 дней в отношениях или в браке'),
  A(69, 'citizen_chat', 'citizen', 1, 15, 'account_balance_fill', 'Паспорт Сквада', 'Получи гражданство: «+Гражданство» в своём чате'),
  A(70, 'citizen_100', 'citizenDays', 100, 50, 'flag_fill', 'Коренной житель', '100 дней гражданства'),
  A(71, 'anketa_full', 'anketa', 1, 15, 'menu_book_fill', 'Открытая книга', 'Заполни анкету целиком: +ДР, +Пол и +Город'),
  A(72, 'staff', 'staff', 1, 30, 'shield_person_fill', 'На службе', 'Получи должность в Штабе Сквада'),
  A(73, 'award_top', 'topDegree', 8, 50, 'military_tech_fill', 'Высшая степень', 'Получи награду высшей, 8-й степени'),
  A(74, 'rp_inline_10', 'rpInline', 10, 15, 'share_fill', 'РП без границ', '10 РП через «@finya_helper_Squad_bot» в любом чате'),
  A(75, 'horo_7', 'horo', 7, 25, 'star_fill', 'Звездочёт', 'Смотри «Гороскоп» 7 дней подряд'),
  A(76, 'compare_5', 'compared', 5, 20, 'swords_fill', 'Дуэлянт', '«Сравнить» себя с 5 разными участниками'),
  A(77, 'help_10', 'helped', 10, 15, 'info_fill', 'Любопытный', '«… Помощь» к 10 разным командам'),
  A(78, 'qday_10', 'qday', 10, 30, 'how_to_vote_fill', 'Мнение дня', 'Ответь на «Вопрос дня» 10 дней'),
  // Secret: the hint only; the phrase is in no file, just its hash (DARK below).
  { ...A(79, 'dark_secret', 'dark', 1, 5000, 'visibility_fill', 'СЕКРЕТ ТЬМЫ', 'Знает её тот, кто прощался с Создателем в реальной жизни'), secret: true },
];

// ---- the secret of darkness ------------------------------------------------------

// cyrb53 of the phrase in plain(): two spellings, «с тобой» and «с тобою».
const DARK = [3199479368306453, 5637685204277642, 2976434838553535, 303954380210886];

const plain = (text) => String(text).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gu, ' ').trim();

// A small 53-bit string hash (cyrb53, public domain): enough to keep the phrase out of the code.
function cyrb53(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// The tests add the hash of their own phrase here.
export const DARK_EXTRA = [];
export const darkHash = (text) => cyrb53(plain(text));

export function isDarkPhrase(text) {
  const p = plain(text);
  if (!p || p.length > 60) return false;
  const h = cyrb53(p);
  return DARK.includes(h) || DARK_EXTRA.includes(h);
}

// ---- counters --------------------------------------------------------------------

export async function bump(userId, key, by = 1) {
  await db.run(sql`INSERT INTO counters (user_id, key, n) VALUES (${userId}, ${key}, ${by})
    ON CONFLICT(user_id, key) DO UPDATE SET n = n + ${by}`);
}

// Once: whom a member compared with, which commands' help they read.
export async function mark(userId, key) {
  await db.run(sql`INSERT OR IGNORE INTO counters (user_id, key, n) VALUES (${userId}, ${key}, 1)`);
}

const mskDay = (ts) => Math.floor((Math.floor(ts) + MSK_OFFSET) / DAY);

// At most +1 a day: «Вопрос дня» answered in two chats counts once.
export async function bumpDaily(userId, key, ts = nowInt()) {
  const day = mskDay(ts);
  const r = await db.run(sql`INSERT INTO counters (user_id, key, n) VALUES (${userId}, ${key + '_day'}, ${day})
    ON CONFLICT(user_id, key) DO UPDATE SET n = excluded.n WHERE n < excluded.n`);
  if (r.rowsAffected === 1) await bump(userId, key);
}

// Days in a row (`key_run`) and the best run (`key`): «Гороскоп» 7 days running.
export async function streakDaily(userId, key, ts = nowInt()) {
  const day = mskDay(ts);
  const last = await db.get(sql`SELECT n FROM counters WHERE user_id = ${userId} AND key = ${key + '_day'}`);
  if (last && last.n >= day) return;
  const prev = await db.get(sql`SELECT n FROM counters WHERE user_id = ${userId} AND key = ${key + '_run'}`);
  const run = last && last.n === day - 1 && prev ? prev.n + 1 : 1;
  for (const [k, n] of [[key + '_day', day], [key + '_run', run]]) {
    await db.run(sql`INSERT INTO counters (user_id, key, n) VALUES (${userId}, ${k}, ${n})
      ON CONFLICT(user_id, key) DO UPDATE SET n = excluded.n`);
  }
  await db.run(sql`INSERT INTO counters (user_id, key, n) VALUES (${userId}, ${key}, ${run})
    ON CONFLICT(user_id, key) DO UPDATE SET n = MAX(n, excluded.n)`);
}

// A message at night (0–5 МСК) or early in the morning (5–8 МСК) counts for those badges;
// every hour (h0–h23) counts for the peak hour of «Моя анкета».
export async function bumpHour(userId, ts) {
  const hour = Math.floor(((Math.floor(ts) + MSK_OFFSET) % DAY) / 3600);
  await bump(userId, `h${hour}`);
  if (hour < 5) await bump(userId, 'night');
  else if (hour < 8) await bump(userId, 'early');
}

// ---- stats -----------------------------------------------------------------------

const one = async (query) => (await db.get(query)).n || 0;

// Everything the chat achievements count, for one member.
export async function chatStats(userId, ts = nowInt()) {
  const counts = {};
  for (const r of await db.all(sql`SELECT key, n FROM counters WHERE user_id = ${userId}`)) counts[r.key] = r.n;
  const rep = await db.get(sql`SELECT points, given FROM reputation WHERE user_id = ${userId}`);
  const spouse = await db.get(sql`SELECT since FROM spouses WHERE user_id = ${userId}`);
  const first = await one(sql`SELECT MIN(first_seen) AS n FROM chat_members WHERE user_id = ${userId} AND first_seen > 0`);
  const spent = {};
  for (const r of await db.all(sql`SELECT kind, COUNT(*) AS c FROM xp_spend WHERE user_id = ${userId} GROUP BY kind`)) spent[r.kind] = r.c;
  const dating = await db.get(sql`SELECT since FROM dating WHERE user_id = ${userId}`);
  const citizen = await db.get(sql`SELECT since FROM citizens WHERE user_id = ${userId}`);
  const info = await db.get(sql`SELECT gender, city FROM profile_info WHERE user_id = ${userId}`);
  const born = await db.get(sql`SELECT 1 AS n FROM birthdays WHERE user_id = ${userId}`);
  const daysSince = (row) => (row ? Math.max(0, Math.floor((ts - row.since) / DAY)) : 0);
  const keys = (prefix) => Object.keys(counts).filter((k) => k.startsWith(prefix)).length;
  return {
    msgs: await one(sql`SELECT SUM(msgs) AS n FROM chat_members WHERE user_id = ${userId}`),
    days: await one(sql`SELECT COUNT(DISTINCT day) AS n FROM chat_activity WHERE user_id = ${userId}`),
    age: first ? Math.max(0, Math.floor((ts - first) / DAY)) : 0,
    bestDay: await one(sql`SELECT MAX(s) AS n FROM (SELECT SUM(msgs) AS s FROM chat_activity WHERE user_id = ${userId} GROUP BY day)`),
    repGot: rep ? rep.points : 0,
    repGiven: rep ? rep.given : 0,
    married: spouse ? 1 : 0,
    marriageDays: spouse ? Math.max(0, Math.floor((ts - spouse.since) / DAY)) : 0,
    farm: await one(sql`SELECT COUNT(*) AS n FROM events WHERE user_id = ${userId} AND kind = 'farm'`),
    casino: spent.casino || 0,
    gifts: spent.gift || 0,
    awards: await one(sql`SELECT COUNT(*) AS n FROM awards WHERE user_id = ${userId}`),
    nick: await one(sql`SELECT COUNT(*) AS n FROM nicks WHERE user_id = ${userId}`),
    about: await one(sql`SELECT COUNT(*) AS n FROM profile_about WHERE user_id = ${userId}`),
    rp: counts.rp || 0,
    jackpot: counts.jackpot || 0,
    night: counts.night || 0,
    early: counts.early || 0,
    dayTop: counts.day_top || 0,
    reminders: counts.reminders || 0,
    couple: dating || spouse ? 1 : 0,
    coupleDays: Math.max(daysSince(dating), daysSince(spouse)),
    citizen: citizen ? 1 : 0,
    citizenDays: daysSince(citizen),
    anketa: info && info.gender && info.city && born ? 1 : 0,
    staff: await one(sql`SELECT COUNT(*) AS n FROM positions WHERE user_id = ${userId}`),
    topDegree: await one(sql`SELECT MAX(COALESCE(d.degree, 1)) AS n FROM awards a
      LEFT JOIN award_degrees d ON d.award_id = a.id WHERE a.user_id = ${userId}`),
    rpInline: counts.rp_inline || 0,
    horo: counts.horo || 0,
    compared: keys('cmp:'),
    helped: keys('help:'),
    qday: counts.qday || 0,
    dark: counts.dark || 0,
  };
}

// ---- unlocking -------------------------------------------------------------------

// XP first (once per key): a call cut off in between must not leave the badge
// without its XP. → true when this call unlocked it.
export async function unlock(user, a, ts = nowInt()) {
  const userId = typeof user === 'object' ? user.id : user;
  await xp.grant(user, 'achievement', a.n, a.xp, ts);
  const inserted = await db.run(sql`INSERT OR IGNORE INTO achievements (user_id, code, unlocked_at)
    VALUES (${userId}, ${a.code}, ${ts})`);
  return inserted.rowsAffected === 1;
}

// The chat achievements a member has just reached. → the fresh ones.
export async function check(user, ts = nowInt()) {
  const userId = typeof user === 'object' ? user.id : user;
  if (typeof user === 'object' && user.is_bot) return [];
  const have = new Set((await db.all(sql`SELECT code FROM achievements WHERE user_id = ${userId}`)).map((r) => r.code));
  if (CHAT_ACHIEVEMENTS.every((a) => have.has(a.code))) return [];
  const stats = await chatStats(userId, ts);
  const fresh = [];
  for (const a of CHAT_ACHIEVEMENTS) {
    if (have.has(a.code) || stats[a.stat] < a.goal) continue;
    if (await unlock(user, a, ts)) fresh.push(a);
  }
  return fresh;
}
