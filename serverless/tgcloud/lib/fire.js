// «Огонёк пары»: a married or dating couple keeps a flame like a streak. It burns for
// the day once both of them have replied to each other's message in the Squad chats
// (an RP command in reply counts too). A day without it and the flame goes out.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { MSK_OFFSET, nowInt, plural } from './util.js';
import * as social from './social.js';

const DAY = 86400;
const mskDay = (ts) => Math.floor((Math.floor(ts) + MSK_OFFSET) / DAY);

// Days of the flame Финя says out loud in the chat; the rest it counts quietly.
export const MILESTONES = new Set([1, 3, 7, 14, 30, 50, 100, 150, 200, 300, 365, 500, 1000]);

// The first spouse, or else the one they date.
export async function partnerOf(userId) {
  const s = await social.spouseOf(userId);
  if (s) return s.partner_id;
  const d = await social.partnerOf(userId);
  return d ? d.partner_id : null;
}

// Married or dating: every spouse keeps a flame of its own.
async function isPair(x, y) {
  if (await social.marriageOf(x, y)) return true;
  const d = await social.partnerOf(x);
  return Boolean(d) && d.partner_id === y;
}

const pair = (x, y) => (x < y ? [x, y] : [y, x]);

// fromId replied to toId. → { days } when this lit the flame for today, else null.
export async function touch(fromId, toId, ts = nowInt()) {
  if (fromId === toId || !(await isPair(fromId, toId))) return null;
  const day = mskDay(ts);
  const [a, b] = pair(fromId, toId);
  await db.run(sql`INSERT OR IGNORE INTO pair_fire (a, b) VALUES (${a}, ${b})`);
  if (fromId === a) await db.run(sql`UPDATE pair_fire SET a_day = ${day} WHERE a = ${a} AND b = ${b}`);
  else await db.run(sql`UPDATE pair_fire SET b_day = ${day} WHERE a = ${a} AND b = ${b}`);
  // Both today and not counted yet: the run goes on from yesterday or starts again.
  const r = await db.run(sql`UPDATE pair_fire SET
      days = CASE WHEN lit_day = ${day - 1} THEN days + 1 ELSE 1 END,
      best = MAX(best, CASE WHEN lit_day = ${day - 1} THEN days + 1 ELSE 1 END),
      lit_day = ${day}
    WHERE a = ${a} AND b = ${b} AND a_day = ${day} AND b_day = ${day} AND lit_day < ${day}
    RETURNING days`);
  return r.rowsAffected === 1 && r.rows && r.rows[0] ? { days: r.rows[0].days } : null;
}

// The flame of the member's pair (with `partnerId`: of that spouse): → { days, best,
// today, mine, theirs }, or null without a pair. days is 0 once it went out; today:
// already burns today; mine / theirs: who has replied today.
export async function fireOf(userId, ts = nowInt(), partnerId = null) {
  const partner = partnerId || await partnerOf(userId);
  if (!partner) return null;
  const [a, b] = pair(userId, partner);
  const row = await db.get(sql`SELECT a_day, b_day, lit_day, days, best FROM pair_fire WHERE a = ${a} AND b = ${b}`);
  const day = mskDay(ts);
  if (!row) return { days: 0, best: 0, today: false, mine: false, theirs: false };
  const [mine, theirs] = userId === a ? [row.a_day, row.b_day] : [row.b_day, row.a_day];
  return {
    days: row.lit_day >= day - 1 ? row.days : 0,
    best: row.best,
    today: row.lit_day === day,
    mine: mine === day,
    theirs: theirs === day,
  };
}

// Best run of any pair the member has been in: for the badges.
export async function bestOf(userId) {
  const row = await db.get(sql`SELECT MAX(best) AS n FROM pair_fire WHERE a = ${userId} OR b = ${userId}`);
  return (row && row.n) || 0;
}

const daysWord = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

// One line for «Мой Брак», «Мои Отношения» and «Огонёк». About someone else: only a
// burning flame, without who still has to reply.
export function fireLine(f, self = true) {
  if (!f) return null;
  if (f.days && (f.today || !self)) return `🔥 Огонёк пары: ${daysWord(f.days)} подряд`;
  if (!self) return null;
  const left = f.mine ? 'ждёт ответа второй половинки' : f.theirs ? 'ждёт твоего ответа' : 'ответьте друг другу';
  if (f.days) return `🔥 Огонёк пары: ${daysWord(f.days)} подряд · сегодня ещё не горит, ${left} до полуночи`;
  return `🔥 Огонёк пары не горит: ${left} сегодня, ответом на сообщение`;
}

// « · 🔥 5» after the pair in «Кто Я», or nothing while it is out.
export const fireMark = (f) => (f && f.days ? ` · 🔥 ${f.days}` : '');

// What Финя says in the chat when the flame burns for the day.
export function litText(days, a, b) {
  if (days === 1) return `🔥 ${a} и ${b} зажигают огонёк пары! Отвечайте друг другу каждый день, и он будет расти.`;
  return `🔥 Огонёк пары ${a} и ${b} горит уже ${daysWord(days)} подряд!`;
}
