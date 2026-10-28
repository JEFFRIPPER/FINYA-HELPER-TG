// Seasonal events of the Squad. Хэллоуин: 24–31 October (Moscow time), once a day
// «Сладость или гадость» in a chat or the Mini App; 3 days of it open the
// limited badge of that year. On 1 November it all switches off by itself.
// «Ёлка Сквада»: 1 December – 13 January, members hang toys on one shared tree
// for XP; on 31 December Финя sums it up in the chats.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { escapeHtml, MSK_OFFSET, nowInt, plural } from './util.js';
import * as feats from './feats.js';
import { namesOf } from './members.js';
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

// ---- «Ёлка Сквада» ---------------------------------------------------------------

export const TOYS = [
  { kind: 'ball', name: 'Алый шар', price: 50 },
  { kind: 'snow', name: 'Снежинка', price: 75 },
  { kind: 'bell', name: 'Колокольчик', price: 100 },
  { kind: 'candy', name: 'Леденец', price: 100 },
  { kind: 'gift', name: 'Подарок', price: 150 },
  // One a season: whoever hangs it first.
  { kind: 'star', name: 'Звезда на макушку', price: 500, one: true },
];
const TOY = new Map(TOYS.map((t) => [t.kind, t]));
export const TOYS_PER_MEMBER = 3;
const TREE_LAST_DAY = 13;

// → { season, starts, ends } from 1 December to the end of 13 January, else null.
// season is the year of that December.
export function treeSeason(ts = nowInt()) {
  const d = new Date((Math.floor(ts) + MSK_OFFSET) * 1000);
  const season = d.getUTCMonth() === 11 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const starts = mskMidnight(season, 12, 1);
  const ends = mskMidnight(season + 1, 1, TREE_LAST_DAY + 1);
  return ts >= starts && ts < ends ? { season, starts, ends } : null;
}

// Moscow midnight of the next 1 December.
export function nextTree(ts = nowInt()) {
  const year = new Date((Math.floor(ts) + MSK_OFFSET) * 1000).getUTCFullYear();
  const starts = mskMidnight(year, 12, 1);
  return starts > ts ? starts : mskMidnight(year + 1, 12, 1);
}

const treeKey = (season) => `tree${season}`;

// Hangs a toy for XP. The owner hangs for free, as the shop gives the owner everything.
export async function hangToy(user, kind, ts = nowInt()) {
  const toy = TOY.get(kind);
  if (!toy) throw new SeasonError('Такой игрушки нет.');
  const ev = treeSeason(ts);
  if (!ev) throw new SeasonError('Ёлка Сквада стоит с 1 декабря по 13 января.');
  const price = user.id === OWNER_USER_ID ? 0 : toy.price;
  // One statement each: two quick taps can't spend the same XP twice or hang a fourth toy.
  const paid = await db.run(sql`INSERT INTO xp_spend (user_id, kind, amount, other_id, at)
    SELECT ${user.id}, 'tree', ${price}, NULL, ${ts}
    WHERE COALESCE((SELECT xp FROM profiles WHERE user_id = ${user.id}), 0)
      - COALESCE((SELECT SUM(price) FROM purchases WHERE user_id = ${user.id}), 0)
      - COALESCE((SELECT SUM(amount) FROM xp_spend WHERE user_id = ${user.id}), 0) >= ${price}
    RETURNING id`);
  const spendId = paid.rows && paid.rows[0] ? paid.rows[0].id : null;
  if (!spendId) throw new SeasonError(`Не хватает XP на балансе: ${toy.name.toLowerCase()} стоит ${toy.price} XP.`);
  const hung = await db.run(sql`INSERT INTO tree_toys (season, user_id, kind, spend_id, at)
    SELECT ${ev.season}, ${user.id}, ${kind}, ${spendId}, ${ts}
    WHERE (SELECT COUNT(*) FROM tree_toys WHERE season = ${ev.season} AND user_id = ${user.id}) < ${TOYS_PER_MEMBER}
      AND (${toy.one ? 1 : 0} = 0 OR NOT EXISTS (SELECT 1 FROM tree_toys WHERE season = ${ev.season} AND kind = ${kind}))
    RETURNING id`);
  if (!(hung.rows && hung.rows[0])) {
    // Nothing hung: the XP goes back.
    await db.run(sql`DELETE FROM xp_spend WHERE id = ${spendId}`);
    const mine = await db.get(sql`SELECT COUNT(*) AS c FROM tree_toys WHERE season = ${ev.season} AND user_id = ${user.id}`);
    if (mine.c >= TOYS_PER_MEMBER) throw new SeasonError(`На ёлке уже ${TOYS_PER_MEMBER} твоих игрушки: больше нельзя.`);
    throw new SeasonError('Звезду на макушку уже повесили.');
  }
  await feats.bump(user.id, treeKey(ev.season));
  return { toy, season: ev.season };
}

// The tree of a season: → { toys: [{ kind, by, mine }] in the order hung, star: name | null,
// count, people, top: [{ name, n }] }.
async function treeOf(season, userId) {
  const rows = await db.all(sql`SELECT user_id, kind FROM tree_toys WHERE season = ${season} ORDER BY id`);
  const name = await namesOf(rows.map((r) => r.user_id));
  const star = rows.find((r) => r.kind === 'star');
  const per = new Map();
  for (const r of rows) per.set(r.user_id, (per.get(r.user_id) || 0) + 1);
  const top = [...per].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ name: name(id), n }));
  return {
    toys: rows.filter((r) => r.kind !== 'star').map((r) => ({ kind: r.kind, by: name(r.user_id), mine: r.user_id === userId })),
    star: star ? { by: name(star.user_id), mine: star.user_id === userId } : null,
    count: rows.length,
    people: per.size,
    mine: per.get(userId) || 0,
    top,
  };
}

// For the Mini App while the tree stands; the owner sees it ahead of time (open: false).
export async function treeView(userId, ts = nowInt()) {
  const ev = treeSeason(ts);
  if (!ev && userId !== OWNER_USER_ID) return null;
  const season = ev ? ev.season : new Date((nextTree(ts) + MSK_OFFSET) * 1000).getUTCFullYear();
  return {
    open: Boolean(ev),
    season,
    opens: ev ? ev.starts : nextTree(ts),
    ends: ev ? ev.ends : mskMidnight(season + 1, 1, TREE_LAST_DAY + 1),
    limit: TOYS_PER_MEMBER,
    shop: TOYS.map((t) => ({ kind: t.kind, name: t.name, price: userId === OWNER_USER_ID ? 0 : t.price, one: Boolean(t.one) })),
    ...(await treeOf(season, userId)),
  };
}

// «Ёлка» in a chat.
export async function treeText(ts = nowInt()) {
  const ev = treeSeason(ts);
  if (!ev) {
    const left = Math.ceil((nextTree(ts) - ts) / DAY);
    return `🎄 Ёлка Сквада откроется 1 декабря, через ${left} ${plural(left, 'день', 'дня', 'дней')}. ` +
      'Тогда в профиле Фини, на вкладке «Сквад», можно будет повесить на неё свою игрушку.';
  }
  const t = await treeOf(ev.season, 0);
  if (!t.count) return '🎄 Ёлка Сквада стоит, но пока без игрушек. Повесь первую: профиль Фини → вкладка «Сквад».';
  return `🎄 На Ёлке Сквада ${t.count} ${plural(t.count, 'игрушка', 'игрушки', 'игрушек')} от ` +
    `${t.people} ${plural(t.people, 'участника', 'участников', 'участников')}.` +
    (t.star ? `\n⭐ Звезда на макушке: ${escapeHtml(t.star.by)}` : '\n⭐ Звезда на макушке пока свободна') +
    `\nПовесить свою (до ${TOYS_PER_MEMBER}): профиль Фини → вкладка «Сквад».`;
}

// 31 December from 18:00 till noon of 1 January (Moscow): → the season's summary
// text for the chats, or null.
export async function treeSummary(ts = nowInt()) {
  const d = new Date((Math.floor(ts) + MSK_OFFSET) * 1000);
  const eve = d.getUTCMonth() === 11 && d.getUTCDate() === 31 && d.getUTCHours() >= 18;
  const morning = d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() < 12;
  if (!eve && !morning) return null;
  const season = eve ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const t = await treeOf(season, 0);
  if (!t.count) return null;
  const top = t.top.map((p) => `${escapeHtml(p.name)} (${p.n})`).join(', ');
  return {
    season,
    text: `🎄 Ёлка Сквада ${season} · итоги\n\n` +
      `На ёлке ${t.count} ${plural(t.count, 'игрушка', 'игрушки', 'игрушек')} от ${t.people} ${plural(t.people, 'участника', 'участников', 'участников')}.\n` +
      (t.star ? `⭐ Звезда на макушке: ${escapeHtml(t.star.by)}\n` : '') +
      `🏅 Больше всех украсили: ${top}\n\n` +
      'С наступающим Новым годом, Сквад! 🎆',
  };
}
