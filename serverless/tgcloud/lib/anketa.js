// «Моя анкета», like Iris has it: the member across every Squad chat at once, apart
// from «Кто Я» (this chat). Gender, birthday and city the member fills in himself
// («+Пол», «+ДР», «+Город»); everything else Финя counts from the chats.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import * as club from './club.js';
import { periodStart, mskDay } from './members.js';
import { getSetting, setSetting } from './store.js';
import { MSK_OFFSET, nowInt, truncate } from './util.js';
import { squadChatIds } from './xpchat.js';

const DAY = 86400;
export const CITY_MAX = 40;
// The chat names in the list are refreshed once a day.
const TITLE_TTL = DAY;
// The peak hour shows once this many messages have their hour counted.
const PEAK_MIN = 30;

export class AnketaError extends Error {}

// ---- what the member fills in ----------------------------------------------------

export async function infoOf(userId) {
  const row = await db.get(sql`SELECT gender, city, birth_year FROM profile_info WHERE user_id = ${userId}`);
  const b = await db.get(sql`SELECT day, month FROM birthdays WHERE user_id = ${userId}`);
  return {
    gender: row && row.gender ? row.gender : null,
    city: row && row.city ? row.city : null,
    birth: b ? { day: b.day, month: b.month, year: row ? row.birth_year : null } : null,
  };
}

async function saveInfo(userId, field, value) {
  const ts = nowInt();
  if (field === 'gender') {
    await db.run(sql`INSERT INTO profile_info (user_id, gender, updated_at) VALUES (${userId}, ${value}, ${ts})
      ON CONFLICT(user_id) DO UPDATE SET gender = excluded.gender, updated_at = excluded.updated_at`);
  } else if (field === 'city') {
    await db.run(sql`INSERT INTO profile_info (user_id, city, updated_at) VALUES (${userId}, ${value}, ${ts})
      ON CONFLICT(user_id) DO UPDATE SET city = excluded.city, updated_at = excluded.updated_at`);
  } else {
    await db.run(sql`INSERT INTO profile_info (user_id, birth_year, updated_at) VALUES (${userId}, ${value}, ${ts})
      ON CONFLICT(user_id) DO UPDATE SET birth_year = excluded.birth_year, updated_at = excluded.updated_at`);
  }
}

const GENDERS = {
  m: ['м', 'муж', 'мужской', 'мужчина', 'парень', 'мальчик', '♂'],
  f: ['ж', 'жен', 'женский', 'женщина', 'девушка', 'девочка', '♀'],
};

// → 'm' or 'f'.
export async function setGender(userId, value) {
  const v = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  const gender = Object.keys(GENDERS).find((g) => GENDERS[g].includes(v));
  if (!gender) throw new AnketaError('Напиши «+Пол М» или «+Пол Ж».');
  await saveInfo(userId, 'gender', gender);
  return gender;
}

export async function setCity(userId, value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new AnketaError('Напиши город после «+Город»: «+Город Москва».');
  if (Array.from(clean).length > CITY_MAX) throw new AnketaError(`Город — до ${CITY_MAX} символов.`);
  if (/@|https?:|t\.me\//iu.test(clean)) throw new AnketaError('В городе не должно быть ссылок и @.');
  await saveInfo(userId, 'city', clean);
  return clean;
}

// «16.12.1999» or «16.12»: the day and month go to the club birthdays (greetings,
// the gift), the year only to the anketa. → { day, month, year }
export async function setBirth(user, value, ts = nowInt()) {
  const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/u.exec(String(value || '').trim());
  if (!m) throw new AnketaError('Напиши дату так: «+ДР 16.12.1999» или «+ДР 16.12».');
  const [day, month] = [Number(m[1]), Number(m[2])];
  const year = m[3] ? Number(m[3]) : null;
  const thisYear = new Date((ts + MSK_OFFSET) * 1000).getUTCFullYear();
  if (year != null && (year < 1900 || year > thisYear - 5)) throw new AnketaError('Проверь год рождения.');
  if (year != null && month === 2 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) {
    throw new AnketaError('В этом году не было 29 февраля.');
  }
  const old = await db.get(sql`SELECT announce FROM birthdays WHERE user_id = ${user.id}`);
  try {
    await club.setBirthday(user, day, month, old ? Boolean(old.announce) : true);
  } catch (err) {
    if (err instanceof club.ClubError) throw new AnketaError(err.message);
    throw err;
  }
  await saveInfo(user.id, 'birth', year);
  return { day, month, year };
}

// → true when there was something to remove.
export async function clear(userId, field) {
  if (field === 'birth') {
    const r = await db.run(sql`DELETE FROM birthdays WHERE user_id = ${userId}`);
    await db.run(sql`UPDATE profile_info SET birth_year = NULL WHERE user_id = ${userId}`);
    return r.rowsAffected > 0;
  }
  const r = field === 'gender'
    ? await db.run(sql`UPDATE profile_info SET gender = '' WHERE user_id = ${userId} AND gender != ''`)
    : await db.run(sql`UPDATE profile_info SET city = '' WHERE user_id = ${userId} AND city != ''`);
  return r.rowsAffected > 0;
}

// ---- citizenship: the one Squad chat a member calls home -------------------------

export async function citizenshipOf(userId) {
  return db.get(sql`SELECT chat_id, since FROM citizens WHERE user_id = ${userId}`);
}

// «+Гражданство» in a chat: this chat becomes home, instead of the old one.
// → { since, moved } (moved: the chat id left behind, if any).
export async function becomeCitizen(chatId, userId, ts = nowInt()) {
  const old = await citizenshipOf(userId);
  if (old && old.chat_id === chatId) throw new AnketaError('У тебя и так гражданство этого чата 🏡');
  const m = await db.get(sql`SELECT first_seen FROM chat_members WHERE chat_id = ${chatId} AND user_id = ${userId}`);
  const since = m && m.first_seen > 0 ? m.first_seen : ts;
  await db.run(sql`INSERT INTO citizens (user_id, chat_id, since, set_at) VALUES (${userId}, ${chatId}, ${since}, ${ts})
    ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, since = excluded.since, set_at = excluded.set_at`);
  return { since, moved: old ? old.chat_id : null };
}

export async function dropCitizenship(userId) {
  const r = await db.run(sql`DELETE FROM citizens WHERE user_id = ${userId}`);
  return r.rowsAffected > 0;
}

// Citizens of a chat still in it, the oldest first.
export async function citizensOf(chatId, limit = 30) {
  return db.all(sql`SELECT c.user_id, c.since, COALESCE((SELECT nick FROM nicks WHERE nicks.user_id = c.user_id), m.name) AS name
    FROM citizens c JOIN chat_members m ON m.chat_id = c.chat_id AND m.user_id = c.user_id
    WHERE c.chat_id = ${chatId} AND m.status = 'member' ORDER BY c.since, c.user_id LIMIT ${limit}`);
}

export async function citizenCount(chatId) {
  const row = await db.get(sql`SELECT COUNT(*) AS n FROM citizens c JOIN chat_members m
    ON m.chat_id = c.chat_id AND m.user_id = c.user_id WHERE c.chat_id = ${chatId} AND m.status = 'member'`);
  return row.n;
}

// The chat's citizens as a set of user ids (the 🏡 in the stats).
export async function citizenIds(chatId) {
  return new Set((await db.all(sql`SELECT user_id FROM citizens WHERE chat_id = ${chatId}`)).map((r) => r.user_id));
}

// ---- birthday helpers ------------------------------------------------------------

const ZODIAC = [
  // [the last day of the sign in its month, month, sign]
  [19, 1, '♑ Козерог'], [18, 2, '♒ Водолей'], [20, 3, '♓ Рыбы'], [19, 4, '♈ Овен'],
  [20, 5, '♉ Телец'], [20, 6, '♊ Близнецы'], [22, 7, '♋ Рак'], [22, 8, '♌ Лев'],
  [22, 9, '♍ Дева'], [22, 10, '♎ Весы'], [21, 11, '♏ Скорпион'], [21, 12, '♐ Стрелец'],
];

export function zodiac(day, month) {
  const [last, , sign] = ZODIAC[month - 1];
  return day <= last ? sign : ZODIAC[month % 12][2];
}

export function ageOf(birth, ts = nowInt()) {
  if (!birth || !birth.year) return null;
  const d = new Date((ts + MSK_OFFSET) * 1000);
  const [y, mo, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  return y - birth.year - (mo < birth.month || (mo === birth.month && day < birth.day) ? 1 : 0);
}

// ---- counted from the chats ------------------------------------------------------

// A chat's name for the list: from /posts_on or /chat_on, else asked from Telegram
// once a day.
export async function chatTitle(chatId) {
  const bound = await db.get(sql`SELECT title FROM squad_chats WHERE chat_id = ${chatId}
    UNION ALL SELECT title FROM relay_targets WHERE chat_id = ${chatId} LIMIT 1`);
  if (bound) return bound.title;
  const key = `chat_title:${chatId}`;
  const cached = await getSetting(key);
  if (cached && nowInt() - cached.at < TITLE_TTL) return cached.title;
  try {
    const chat = await api.getChat({ chat_id: chatId });
    const title = truncate(chat.title || 'Чат', 100);
    await setSetting(key, { title, at: nowInt() });
    return title;
  } catch {
    return cached ? cached.title : 'Чат';
  }
}

// Days in a row with at least one message: the current run (today or up to
// yesterday) and the longest one. `days` sorted ascending.
export function streaks(days, today) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = prev != null && d === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  const current = prev != null && prev >= today - 1 ? run : 0;
  return { current, best };
}

// The hour (МСК) the member writes most in, from the hourly counters.
export async function peakHour(userId) {
  const rows = await db.all(sql`SELECT key, n FROM counters WHERE user_id = ${userId} AND key LIKE 'h%'`);
  let total = 0;
  let peak = null;
  for (const r of rows) {
    const hour = /^h(\d{1,2})$/.exec(r.key);
    if (!hour) continue;
    total += r.n;
    if (!peak || r.n > peak.n) peak = { hour: Number(hour[1]), n: r.n };
  }
  return total >= PEAK_MIN ? peak.hour : null;
}

// Everything the anketa shows that is counted, over the Squad chats.
export async function anketaData(userId, ts = nowInt()) {
  const squad = new Set(await squadChatIds());
  const rows = (await db.all(sql`SELECT chat_id, first_seen, last_active, msgs, status FROM chat_members
    WHERE user_id = ${userId}`)).filter((r) => squad.has(r.chat_id));
  const activity = (await db.all(sql`SELECT chat_id, day, msgs FROM chat_activity WHERE user_id = ${userId}`))
    .filter((r) => squad.has(r.chat_id));

  const days = new Map();
  for (const a of activity) days.set(a.day, (days.get(a.day) || 0) + a.msgs);
  const sum = (from) => [...days].reduce((n, [day, v]) => (day >= from ? n + v : n), 0);
  let record = null;
  for (const [day, n] of days) if (!record || n > record.n) record = { day, n };

  const firsts = rows.map((r) => r.first_seen).filter((t) => t > 0);
  const favourite = rows.filter((r) => r.msgs > 0).sort((a, b) => b.msgs - a.msgs)[0];
  const homes = rows.filter((r) => r.status === 'member').sort((a, b) => a.first_seen - b.first_seen);
  const titled = async (r) => ({ chatId: r.chat_id, title: await chatTitle(r.chat_id), since: r.first_seen, msgs: r.msgs });

  return {
    since: firsts.length ? Math.min(...firsts) : null,
    lastActive: Math.max(0, ...rows.map((r) => r.last_active)),
    total: rows.reduce((n, r) => n + r.msgs, 0),
    day: sum(periodStart('day', ts)),
    week: sum(periodStart('week', ts)),
    month: sum(periodStart('month', ts)),
    days,
    record: record && record.n > 0 ? record : null,
    streak: streaks([...days.keys()].sort((a, b) => a - b), mskDay(ts)),
    peak: await peakHour(userId),
    favourite: favourite && rows.length > 1 ? await titled(favourite) : null,
    citizen: await citizenshipOf(userId).then(async (c) => (c ? { ...c, title: await chatTitle(c.chat_id) } : null)),
    homes: await Promise.all(homes.map(titled)),
  };
}
