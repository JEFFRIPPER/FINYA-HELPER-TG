// The Squad's own pages on the «Сквад» tab of the Mini App:
// «Зал славы» (records), «Календарь Сквада» (birthdays, anniversaries and holidays
// for 30 days) and «Летопись» (weddings, citizens, positions, rare badges, new records).
// Records scan whole tables, so all three are built at most once in CACHE_TTL.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { getSetting, setSetting } from './store.js';
import { MSK_OFFSET, nowInt, truncate } from './util.js';
import { ACHIEVEMENTS } from './club.js';
import { chatTitle } from './anketa.js';
import { isAnniversary } from './chat.js';
import { namesOf, TELEGRAM_SERVICE_ID } from './members.js';
import * as citymap from './citymap.js';
import * as social from './social.js';
import * as staff from './staff.js';

const DAY = 86400;
const CACHE_KEY = 'squad_pages';
export const CACHE_TTL = 5 * 60;
export const CALENDAR_DAYS = 30;
const CHRONICLE_LIMIT = 40;
const RECORD_NEWS_KEY = 'chronicle_records';
const RECORD_NEWS_LIMIT = 30;
// Badges worth a line in «Летопись»: the secret ones and the big ones.
const NOTABLE_XP = 150;

const pad = (n) => String(n).padStart(2, '0');
function dateText(ts) {
  const d = new Date((Math.floor(ts) + MSK_OFFSET) * 1000);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
const mskMidnight = (ts) => Math.floor((Math.floor(ts) + MSK_OFFSET) / DAY) * DAY - MSK_OFFSET;
const dayOf = (msk) => msk * DAY - MSK_OFFSET;

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const count = (n, one, few, many) => `${n.toLocaleString('en-US')} ${plural(n, one, few, many)}`;

// ---- «Зал славы» -------------------------------------------------------------------

// → [{ key, icon, title, who: [ids], value, at? }]; a record nobody holds yet has no `who`.
async function rawRecords() {
  const out = [];
  const marriage = (await social.couples(1))[0];
  out.push({ key: 'marriage', icon: 'favorite_fill', title: 'Самый долгий брак',
    who: marriage ? [marriage.a, marriage.b] : null, value: marriage ? count(social.marriedDays(marriage.since), 'день', 'дня', 'дней') : null });
  const dating = (await social.datingCouples(1))[0];
  out.push({ key: 'dating', icon: 'favorite_fill', title: 'Дольше всех встречаются',
    who: dating ? [dating.a, dating.b] : null, value: dating ? count(social.marriedDays(dating.since), 'день', 'дня', 'дней') : null });
  const best = await db.get(sql`SELECT user_id, day, SUM(msgs) AS s FROM chat_activity
    WHERE user_id != ${TELEGRAM_SERVICE_ID} GROUP BY user_id, day ORDER BY s DESC, day LIMIT 1`);
  out.push({ key: 'best_day', icon: 'bolt_fill', title: 'Лучший день в чате',
    who: best && best.s ? [best.user_id] : null, value: best && best.s ? `${count(best.s, 'сообщение', 'сообщения', 'сообщений')} · ${dateText(dayOf(best.day) + 12 * 3600)}` : null });
  const days = await db.get(sql`SELECT user_id, COUNT(DISTINCT day) AS c FROM chat_activity
    WHERE user_id != ${TELEGRAM_SERVICE_ID} GROUP BY user_id ORDER BY c DESC, user_id LIMIT 1`);
  out.push({ key: 'days', icon: 'calendar_month_fill', title: 'Больше всех дней в чате',
    who: days && days.c ? [days.user_id] : null, value: days && days.c ? count(days.c, 'день', 'дня', 'дней') : null });
  const msgs = await db.get(sql`SELECT user_id, SUM(msgs) AS s FROM chat_members
    WHERE user_id != ${TELEGRAM_SERVICE_ID} GROUP BY user_id ORDER BY s DESC, user_id LIMIT 1`);
  out.push({ key: 'msgs', icon: 'chat_bubble_fill', title: 'Больше всех сообщений',
    who: msgs && msgs.s ? [msgs.user_id] : null, value: msgs && msgs.s ? count(msgs.s, 'сообщение', 'сообщения', 'сообщений') : null });
  const rep = await db.get(sql`SELECT user_id, points FROM reputation WHERE points > 0 ORDER BY points DESC, user_id LIMIT 1`);
  out.push({ key: 'rep', icon: 'verified_fill', title: 'Больше всех репутации',
    who: rep ? [rep.user_id] : null, value: rep ? `❤️ ${rep.points.toLocaleString('en-US')}` : null });
  const ach = await db.get(sql`SELECT user_id, COUNT(*) AS c FROM achievements GROUP BY user_id ORDER BY c DESC, MIN(unlocked_at) LIMIT 1`);
  out.push({ key: 'ach', icon: 'emoji_events_fill', title: 'Больше всех ачивок',
    who: ach ? [ach.user_id] : null, value: ach ? `${ach.c} из ${ACHIEVEMENTS.length}` : null });
  const dark = await db.get(sql`SELECT user_id, unlocked_at FROM achievements WHERE code = 'dark_secret'
    ORDER BY unlocked_at, user_id LIMIT 1`);
  out.push({ key: 'dark', icon: 'visibility_fill', title: 'Первым разгадал «СЕКРЕТ ТЬМЫ»', secret: true,
    who: dark ? [dark.user_id] : null, value: dark ? dateText(dark.unlocked_at) : null });
  return out;
}

// ---- «Календарь Сквада» ----------------------------------------------------------------

export const HOLIDAYS = [
  [1, 1, '🎄', 'Новый год'],
  [14, 2, '💘', 'День всех влюблённых'],
  [23, 2, '🎖', '23 Февраля'],
  [8, 3, '🌷', '8 Марта'],
  [1, 4, '🤡', 'День смеха'],
  [9, 5, '🎗', 'День Победы'],
  [24, 10, '🎃', 'Начало Хэллоуина в Скваде'],
  [31, 10, '🎃', 'Хэллоуин'],
  [1, 12, '🎄', 'Ёлка Сквада открывается'],
  [31, 12, '🎆', 'Новогодняя ночь и итоги года'],
];

// Days from today (Moscow) to the next day/month, 0 for today; 29 February falls on
// 1 March in other years.
function daysTo(day, month, ts) {
  const now = new Date((ts + MSK_OFFSET) * 1000);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    let date = Date.UTC(year, month - 1, day);
    if (new Date(date).getUTCMonth() !== month - 1) date = Date.UTC(year, month, 1);
    if (date >= today) return Math.round((date - today) / (DAY * 1000));
  }
  return null;
}

function pairWord(days, married) {
  if (days % 365 === 0) {
    const y = days / 365;
    const w = married ? social.weddingOn(days) : null;
    return `${y} ${plural(y, 'год', 'года', 'лет')} ${married ? 'в браке' : 'вместе'}${w ? ` · ${w.name.toLowerCase()} свадьба ${w.icon}` : ''}`;
  }
  return `${count(days, 'день', 'дня', 'дней')} ${married ? 'в браке' : 'вместе'}`;
}

// → [{ in: days from today, at: Moscow midnight, kind, icon, title, sub, who: [ids] }].
async function rawCalendar(ts) {
  const out = [];
  const today = mskMidnight(ts);
  const births = await db.all(sql`SELECT user_id, day, month FROM birthdays
    WHERE announce = 1 AND user_id IN (SELECT user_id FROM chat_members WHERE status = 'member')`);
  for (const b of births) {
    const left = daysTo(b.day, b.month, ts);
    if (left != null && left < CALENDAR_DAYS) out.push({ in: left, kind: 'birthday', icon: '🎂', sub: 'День рождения', who: [b.user_id] });
  }
  for (const [married, list] of [[true, await social.couples(1000)], [false, await social.datingCouples(1000)]]) {
    for (const c of list) {
      for (let k = 0; k < CALENDAR_DAYS; k++) {
        const days = social.marriedDays(c.since, ts + k * DAY);
        if (!isAnniversary(days)) continue;
        out.push({ in: k, kind: married ? 'wedding' : 'dating', icon: married ? '💍' : '💞', sub: pairWord(days, married), who: [c.a, c.b] });
      }
    }
  }
  for (const [day, month, icon, title] of HOLIDAYS) {
    const left = daysTo(day, month, ts);
    if (left != null && left < CALENDAR_DAYS) out.push({ in: left, kind: 'holiday', icon, title, who: [] });
  }
  const order = { holiday: 0, birthday: 1, wedding: 2, dating: 3 };
  out.sort((a, b) => a.in - b.in || order[a.kind] - order[b.kind]);
  for (const e of out) e.at = today + e.in * DAY;
  return out;
}

// ---- «Летопись» -----------------------------------------------------------------------

// New record holders noticed while the pages are rebuilt; kept in settings.
async function noteRecords(records, ts) {
  const prev = await getSetting('hall_holders');
  const now = Object.fromEntries(records.filter((r) => r.who).map((r) => [r.key, r.who.join(',')]));
  await setSetting('hall_holders', now);
  // The first build only remembers: no news about records that were always there.
  if (!prev) return;
  const fresh = records.filter((r) => r.who && prev[r.key] !== now[r.key] && r.key !== 'dark');
  if (!fresh.length) return;
  const news = (await getSetting(RECORD_NEWS_KEY)) || [];
  for (const r of fresh) news.unshift({ at: ts, key: r.key, who: r.who, title: r.title, value: r.value });
  await setSetting(RECORD_NEWS_KEY, news.slice(0, RECORD_NEWS_LIMIT));
}

// → [{ at, icon, kind, who: [ids], text(name) }] newest first.
async function rawChronicle() {
  const items = [];
  for (const c of await social.couples(CHRONICLE_LIMIT)) items.push({ at: c.since, icon: '💍', kind: 'marriage', who: [c.a, c.b] });
  for (const c of await social.datingCouples(CHRONICLE_LIMIT)) items.push({ at: c.since, icon: '💞', kind: 'dating', who: [c.a, c.b] });
  // set_at: when «+Гражданство» was written (since is when they first showed up in that chat).
  for (const r of await db.all(sql`SELECT user_id, chat_id, set_at FROM citizens ORDER BY set_at DESC LIMIT ${CHRONICLE_LIMIT}`)) {
    items.push({ at: r.set_at, icon: '🏡', kind: 'citizen', who: [r.user_id], chat: r.chat_id });
  }
  for (const r of await db.all(sql`SELECT user_id, code, given_at FROM positions ORDER BY given_at DESC LIMIT ${CHRONICLE_LIMIT}`)) {
    const p = staff.byCode(r.code);
    if (p) items.push({ at: r.given_at, icon: p.emoji, kind: 'position', who: [r.user_id], what: p.title });
  }
  const notable = ACHIEVEMENTS.filter((a) => a.secret || a.xp >= NOTABLE_XP);
  const titles = new Map(notable.map((a) => [a.code, a.title]));
  for (const r of await db.all(sql`SELECT user_id, code, unlocked_at FROM achievements
    WHERE code IN (SELECT value FROM json_each(${JSON.stringify(notable.map((a) => a.code))}))
    ORDER BY unlocked_at DESC LIMIT ${CHRONICLE_LIMIT}`)) {
    items.push({ at: r.unlocked_at, icon: r.code === 'dark_secret' ? '🌑' : '🏆', kind: 'badge', who: [r.user_id], what: titles.get(r.code) });
  }
  for (const r of await db.all(sql`SELECT a.user_id, a.text, a.given_at FROM awards a
    JOIN award_degrees d ON d.award_id = a.id WHERE d.degree = 8 ORDER BY a.given_at DESC LIMIT ${CHRONICLE_LIMIT}`)) {
    items.push({ at: r.given_at, icon: '🏵', kind: 'award', who: [r.user_id], what: r.text });
  }
  for (const r of (await getSetting(RECORD_NEWS_KEY)) || []) {
    items.push({ at: r.at, icon: '🏛', kind: 'record', who: r.who, what: r.title, value: r.value });
  }
  items.sort((a, b) => b.at - a.at);
  return items.slice(0, CHRONICLE_LIMIT);
}

async function chronicleText(e, name) {
  const who = e.who.map(name);
  switch (e.kind) {
    case 'marriage': return `${who[0]} и ${who[1]} поженились`;
    case 'dating': return `${who[0]} и ${who[1]} начали встречаться`;
    case 'citizen': return `${who[0]}: гражданство чата «${truncate(await chatTitle(e.chat), 40)}»`;
    case 'position': return `${who[0]}: должность «${e.what}»`;
    case 'badge': return `${who[0]} открывает ачивку «${e.what}»`;
    case 'award': return `${who[0]}: награда высшей степени «${truncate(e.what, 60)}»`;
    case 'record': return `Новый рекорд «${e.what}»: ${who.join(' + ')}${e.value ? `, ${e.value}` : ''}`;
    default: return who.join(', ');
  }
}

// ---- «Карта Сквада» -------------------------------------------------------------------

const MAP_PEOPLE = 60;

// Members still in a Squad chat with «+Город»: → [{ city: {name, lat, lon} | null, text, id }].
async function rawMap() {
  const rows = await db.all(sql`SELECT user_id, city FROM profile_info
    WHERE city != '' AND user_id IN (SELECT user_id FROM chat_members WHERE status = 'member')
    ORDER BY updated_at DESC`);
  return rows.map((r) => ({ id: r.user_id, text: r.city, city: citymap.findCity(r.city) }));
}

// Cities with the most people first; the unknown ones by the text as written.
// Not cached: a member who just wrote «+Город» looks for themselves right away.
export async function cityMap() {
  const rows = await rawMap();
  const name = await namesOf(rows.map((r) => r.id));
  const person = (id) => ({ name: name(id), username: name.username(id) });
  const known = new Map();
  const other = new Map();
  for (const r of rows) {
    if (r.city) {
      if (!known.has(r.city.name)) known.set(r.city.name, { ...r.city, people: [] });
      known.get(r.city.name).people.push(person(r.id));
    } else {
      const key = citymap.normalize(r.text);
      if (!other.has(key)) other.set(key, { name: truncate(r.text, 40), people: [] });
      other.get(key).people.push(person(r.id));
    }
  }
  const byCount = (a, b) => b.people.length - a.people.length || a.name.localeCompare(b.name, 'ru');
  const cut = (list) => list.sort(byCount).map((c) => ({ ...c, count: c.people.length, people: c.people.slice(0, MAP_PEOPLE) }));
  return { people: rows.length, cities: cut([...known.values()]), other: cut([...other.values()]) };
}

// ---- together ---------------------------------------------------------------------------

async function build(ts) {
  const records = await rawRecords();
  await noteRecords(records, ts);
  const calendar = await rawCalendar(ts);
  const chronicle = await rawChronicle();
  const name = await namesOf([
    ...records.flatMap((r) => r.who || []),
    ...calendar.flatMap((e) => e.who),
    ...chronicle.flatMap((e) => e.who),
  ]);
  return {
    at: ts,
    hall: records.map((r) => ({ key: r.key, icon: r.icon, title: r.title, secret: Boolean(r.secret),
      who: r.who ? r.who.map(name).join(' + ') : null, value: r.value })),
    calendar: calendar.map((e) => ({ at: e.at, in: e.in, kind: e.kind, icon: e.icon,
      title: e.title || e.who.map(name).join(' + '), sub: e.sub || null })),
    chronicle: await Promise.all(chronicle.map(async (e) => ({ at: e.at, icon: e.icon, kind: e.kind, text: await chronicleText(e, name) }))),
  };
}

// For profileData(): cached, rebuilt when older than CACHE_TTL or from another Moscow day.
export async function squadPages(ts = nowInt()) {
  let pages = await getSetting(CACHE_KEY);
  if (!(pages && pages.at <= ts && ts - pages.at < CACHE_TTL && mskMidnight(pages.at) === mskMidnight(ts))) {
    pages = await build(ts);
    await setSetting(CACHE_KEY, pages);
  }
  return { ...pages, map: await cityMap() };
}

// Tests and the owner's changes: rebuild on the next open.
export async function dropCache() {
  await setSetting(CACHE_KEY, null);
}
