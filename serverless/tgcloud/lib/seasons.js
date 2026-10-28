// Seasonal events of the Squad. Хэллоуин: 24–31 October (Moscow time), once a day
// «Сладость или гадость» in a chat or the Mini App; 3 days of it open the
// limited badge of that year. On 1 November it all switches off by itself.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { MSK_OFFSET, nowInt } from './util.js';
import * as feats from './feats.js';
import * as xp from './xp.js';

const DAY = 86400;

export const HALLOWEEN_GOAL = 3;
const FIRST_DAY = 24;

const mskDay = (ts) => Math.floor((Math.floor(ts) + MSK_OFFSET) / DAY);
const mskMidnight = (y, m, d) => Date.UTC(y, m - 1, d) / 1000 - MSK_OFFSET;

// → { year, starts, ends } while the event runs, else null.
export function halloween(ts = nowInt()) {
  const year = new Date((Math.floor(ts) + MSK_OFFSET) * 1000).getUTCFullYear();
  const starts = mskMidnight(year, 10, FIRST_DAY);
  const ends = mskMidnight(year, 11, 1);
  return ts >= starts && ts < ends ? { year, starts, ends } : null;
}

// Moscow midnight when the next event starts (this year's or next year's).
export function nextHalloween(ts = nowInt()) {
  const year = new Date((Math.floor(ts) + MSK_OFFSET) * 1000).getUTCFullYear();
  const starts = mskMidnight(year, 10, FIRST_DAY);
  return starts > ts ? starts : mskMidnight(year + 1, 10, FIRST_DAY);
}

const TREATS = [
  '🍬 Сладость! Финя насыпала тебе полную тыкву конфет',
  '🍫 Сладость! Шоколадка из тайника Фини',
  '🍭 Сладость! Леденец со вкусом крови… шучу, вишнёвый',
  '🧁 Сладость! Кекс с паутинкой из крема',
  '🍪 Сладость! Печенье в форме летучей мыши',
];
const TRICKS = [
  '🕷 Гадость! Финя подложила паука тебе в профиль',
  '👻 Гадость! Призрак стащил все твои конфеты',
  '🦇 Гадость! Летучая мышь унесла награду в ночь',
  '🧟 Гадость! Зомби съел твою конфету. Завтра повезёт',
  '🕸 Гадость! Награда застряла в паутине, не достать',
];
const GOLDEN = '🎃 Золотая тыква! Редкая удача';
const GOLDEN_XP = 131;

// → { kind: 'golden' | 'treat' | 'trick', points }.
export function roll(random = Math.random) {
  const r = random();
  if (r < 0.05) return { kind: 'golden', points: GOLDEN_XP };
  if (r < 0.7) return { kind: 'treat', points: 13 + Math.floor(random() * 54) };
  return { kind: 'trick', points: 0 };
}

// What was in the pumpkin. Not stored: picked by the day and the member, so
// asking again shows the same line.
export function pumpkinText(points, day, userId = 0) {
  if (points >= GOLDEN_XP) return GOLDEN;
  const list = points > 0 ? TREATS : TRICKS;
  return list[(day + userId) % list.length];
}

const counterKey = (year) => `hw${year}`;

// Days of «Сладость или гадость» this year.
export async function playedDays(userId, year) {
  const row = await db.get(sql`SELECT n FROM counters WHERE user_id = ${userId} AND key = ${counterKey(year)}`);
  return row ? row.n : 0;
}

async function today(userId, ts) {
  const row = await db.get(sql`SELECT points FROM events
    WHERE user_id = ${userId} AND kind = 'season' AND chat_id = 0 AND message_id = ${mskDay(ts)}`);
  return row ? { points: row.points, text: pumpkinText(row.points, mskDay(ts), userId) } : null;
}

export class SeasonError extends Error {}

// Once a Moscow day while the event runs. → { points, text, days, again: true if
// already played today, result: the xp.grant() answer or null }.
export async function trickOrTreat(user, ts = nowInt(), random = Math.random) {
  const ev = halloween(ts);
  if (!ev) throw new SeasonError('Хэллоуин в Скваде идёт с 24 по 31 октября.');
  const day = mskDay(ts);
  const r = roll(random);
  // The event row is the «played today» mark, so a trick (0 XP) is kept too.
  const result = await xp.grant(user, 'season', day, r.points, ts);
  if (!result) {
    const t = await today(user.id, ts);
    const points = t ? t.points : 0;
    return { again: true, points, text: pumpkinText(points, day, user.id), days: await playedDays(user.id, ev.year), result: null };
  }
  await feats.bump(user.id, counterKey(ev.year));
  // XP may be cut at the cap: the line follows what was actually given.
  return { again: false, points: result.points, text: pumpkinText(r.points && !result.points ? 0 : r.points, day, user.id),
    days: await playedDays(user.id, ev.year), result };
}

// For the Mini App while the event runs, else null.
export async function halloweenView(userId, ts = nowInt()) {
  const ev = halloween(ts);
  if (!ev) return null;
  return { ends: ev.ends, year: ev.year, goal: HALLOWEEN_GOAL, days: await playedDays(userId, ev.year), today: await today(userId, ts) };
}
