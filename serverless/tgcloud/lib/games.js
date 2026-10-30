// XP for others and for luck: «передать 100» ответом and the casino (🎰 / 🎲).
// Both spend the balance (XP minus purchases minus earlier spending), like the
// shop does. Whatever is won or received goes to the balance only, as a negative
// xp_spend row (gift_in, casino_win): the rank and the tops count earned XP, so two
// members can't pump each other's rank by passing XP back and forth. The owner's
// gifts are rewards: they come as bonus XP (`xp.grant`) and count for the rank.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { dayStart, nowInt } from './util.js';
import * as xp from './xp.js';

export class GameError extends Error {}

export const GIFT_MIN = 1;
export const GIFT_MAX = 5000;
export const GIFTS_PER_DAY = 10;
// XP one member may receive by transfers in a Moscow day (the owner's don't count).
export const RECEIVE_PER_DAY = 3000;
export const STAKE_MIN = 10;
export const STAKE_MAX = 500;
export const GAMES_PER_DAY = 20;

// What the member can spend now.
export async function balanceOf(userId) {
  const row = await db.get(sql`SELECT
      COALESCE((SELECT xp FROM profiles WHERE user_id = ${userId}), 0)
      - COALESCE((SELECT SUM(price) FROM purchases WHERE user_id = ${userId}), 0)
      - COALESCE((SELECT SUM(amount) FROM xp_spend WHERE user_id = ${userId}), 0) AS b`);
  return Math.max(0, row.b);
}

// One statement: two quick commands can't spend the same XP twice. → the row id, or null.
async function spend(userId, kind, amount, otherId, ts) {
  const r = await db.run(sql`INSERT INTO xp_spend (user_id, kind, amount, other_id, at)
    SELECT ${userId}, ${kind}, ${amount}, ${otherId}, ${ts}
    WHERE COALESCE((SELECT xp FROM profiles WHERE user_id = ${userId}), 0)
      - COALESCE((SELECT SUM(price) FROM purchases WHERE user_id = ${userId}), 0)
      - COALESCE((SELECT SUM(amount) FROM xp_spend WHERE user_id = ${userId}), 0) >= ${amount}
    RETURNING id`);
  return r.rows && r.rows[0] ? r.rows[0].id : null;
}

// Puts XP on the balance without touching the rank.
async function credit(userId, kind, amount, otherId, ts) {
  await db.run(sql`INSERT OR IGNORE INTO profiles (user_id, name) VALUES (${userId}, ${String(userId)})`);
  await db.run(sql`INSERT INTO xp_spend (user_id, kind, amount, other_id, at)
    VALUES (${userId}, ${kind}, ${-amount}, ${otherId}, ${ts})`);
}

async function receivedToday(userId, ts) {
  const row = await db.get(sql`SELECT COALESCE(-SUM(amount), 0) AS s FROM xp_spend
    WHERE user_id = ${userId} AND kind = 'gift_in' AND at >= ${dayStart(ts)}`);
  return row.s;
}

async function countToday(userId, kind, ts) {
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM xp_spend
    WHERE user_id = ${userId} AND kind = ${kind} AND at >= ${dayStart(ts)}`);
  return row.c;
}

function amountOf(value, min, max, what) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) throw new GameError(`${what}: от ${min} XP.`);
  if (n > max) throw new GameError(`${what}: не больше ${max} XP за раз.`);
  return n;
}

// to: { id, isBot, user? }. The owner hands out XP from nothing: their balance stays.
export async function gift(from, to, value, ts = nowInt()) {
  const amount = amountOf(value, GIFT_MIN, GIFT_MAX, 'Перевод');
  if (to.isBot) throw new GameError('Ботам XP ни к чему.');
  if (to.id === from.id) throw new GameError('Себе переводить нельзя 🙂');
  const owner = from.id === OWNER_USER_ID;
  if (!owner && (await countToday(from.id, 'gift', ts)) >= GIFTS_PER_DAY) {
    throw new GameError(`Не больше ${GIFTS_PER_DAY} переводов в день.`);
  }
  if (!owner) {
    const left = RECEIVE_PER_DAY - (await receivedToday(to.id, ts));
    if (amount > left) {
      throw new GameError(left > 0
        ? `Сегодня этому участнику можно перевести ещё ${left} XP: не больше ${RECEIVE_PER_DAY} XP в день на одного.`
        : `Этот участник уже получил сегодня ${RECEIVE_PER_DAY} XP переводами. Завтра можно снова.`);
    }
  }
  const id = await spend(from.id, 'gift', owner ? 0 : amount, to.id, ts);
  if (id == null) throw new GameError(`Не хватает XP на балансе: есть ${await balanceOf(from.id)}.`);
  if (!owner) {
    await credit(to.id, 'gift_in', amount, from.id, ts);
    return { amount, toBalance: true, total: null, promoted: false, newRank: null };
  }
  const got = await xp.grant(to.user || to.id, 'gift', id, amount, ts);
  return { amount, toBalance: false, total: got ? got.total : null, promoted: got ? got.promoted : false, newRank: got ? got.newRank : null };
}

// 🎰: Telegram's value 1–64 is three reels in base 4, 0 = BAR, 1 = grapes,
// 2 = lemon, 3 = seven (64 is 777). 🎲: 1–6.
export function reelsOf(value) {
  const v = value - 1;
  return [v & 3, (v >> 2) & 3, (v >> 4) & 3];
}

// → { times, line }: how many stakes come back. Both games pay back about 92%.
export function payout(emoji, value) {
  if (emoji === '🎲') {
    if (value === 6) return { times: 2.5, line: 'Шестёрка!' };
    if (value >= 4) return { times: 1.5, line: `Выпало ${value}` };
    return { times: 0, line: `Выпало ${value}` };
  }
  const reels = reelsOf(value);
  const sevens = reels.filter((r) => r === 3).length;
  if (sevens === 3) return { times: 20, line: 'ДЖЕКПОТ 7️⃣7️⃣7️⃣' };
  if (reels[0] === reels[1] && reels[1] === reels[2]) return { times: 7, line: 'Три в ряд!' };
  if (sevens === 2) return { times: 2, line: 'Две семёрки' };
  return { times: 0, line: 'Мимо' };
}

// Takes the stake (null when the balance is short) before the dice is thrown.
export async function stake(user, value, ts = nowInt()) {
  const amount = amountOf(value, STAKE_MIN, STAKE_MAX, 'Ставка');
  if ((await countToday(user.id, 'casino', ts)) >= GAMES_PER_DAY) {
    throw new GameError(`На сегодня хватит: ${GAMES_PER_DAY} игр в день. Приходи завтра 🙂`);
  }
  const id = await spend(user.id, 'casino', amount, null, ts);
  if (id == null) throw new GameError(`Не хватает XP на балансе: есть ${await balanceOf(user.id)}.`);
  return { id, amount };
}

// After the dice: the win, if any. → { times, line, won, total }
export async function settle(user, bet, emoji, value, ts = nowInt()) {
  const p = payout(emoji, value);
  const won = Math.floor(bet.amount * p.times);
  if (won > 0) await credit(user.id, 'casino_win', won, bet.id, ts);
  return { ...p, won, balance: await balanceOf(user.id) };
}

// The stake comes back when Telegram did not throw the dice.
export async function refund(bet) {
  await db.run(sql`DELETE FROM xp_spend WHERE id = ${bet.id}`);
}
