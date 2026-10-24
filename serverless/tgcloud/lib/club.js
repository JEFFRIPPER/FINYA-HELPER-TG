// Squad club: daily reward, weekly quests, achievements, the XP shop, polls,
// birthdays, referral links, the weekly summary and the newcomer welcome.
// Bonus XP goes through xp.grant(), once per reward key.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID, SQUAD_CHANNEL_ID, SQUAD_LINKS } from './config.js';
import { withPremium } from './emoji.js';
import { CHAT_ACHIEVEMENTS, chatStats, unlock } from './feats.js';
import { nameOf } from './members.js';
import { getSetting, getUser, logError, setSetting } from './store.js';
import { button, getMe, keyboard } from './tg.js';
import { boldHtml, escapeHtml, fullName, MSK_OFFSET, nowInt, truncate, weekStart } from './util.js';
import { resolveXpChat } from './xpchat.js';
import * as xp from './xp.js';

const DAY = 86400;

export class ClubError extends Error {}

// Moscow day number and week number (weeks start on Monday).
export const mskDay = (ts) => Math.floor((Math.floor(ts) + MSK_OFFSET) / DAY);
export const weekNo = (ts) => (mskDay(weekStart(ts)) - 4) / 7; // 1970-01-05 was a Monday

function mskDate(ts) {
  const d = new Date((Math.floor(ts) + MSK_OFFSET) * 1000);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), hour: d.getUTCHours() };
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ---- daily reward ------------------------------------------------------------

// A 7-day cycle; missing a day starts it over.
export const DAILY_REWARDS = [5, 5, 10, 10, 15, 20, 35];

async function dailyState(userId, ts) {
  const today = mskDay(ts);
  const rows = await db.all(sql`SELECT message_id AS d FROM events
    WHERE user_id = ${userId} AND kind = 'daily' ORDER BY message_id DESC LIMIT 400`);
  const days = rows.map((r) => r.d);
  let run = 0;
  if (days.length && days[0] >= today - 1) {
    run = 1;
    while (run < days.length && days[run] === days[0] - run) run++;
  }
  const claimed = days[0] === today;
  // Index in DAILY_REWARDS of today's reward (claimed or not).
  const step = claimed ? (run - 1) % DAILY_REWARDS.length : run % DAILY_REWARDS.length;
  return { today, run, claimed, step };
}

export async function claimDaily(user) {
  const ts = nowInt();
  const st = await dailyState(user.id, ts);
  if (st.claimed) throw new ClubError('Награда за сегодня уже у тебя. Возвращайся завтра.');
  const result = await xp.grant(user, 'daily', st.today, DAILY_REWARDS[st.step], ts);
  if (!result) throw new ClubError('Награда за сегодня уже у тебя. Возвращайся завтра.');
  return result;
}

// ---- weekly quests -----------------------------------------------------------

export const QUESTS = [
  { id: 1, kind: 'comments', goal: 15, xp: 30, icon: 'chat_bubble_fill', title: 'Голос Сквада', text: 'Оставь 15 комментариев под постами' },
  { id: 2, kind: 'reactions', goal: 25, xp: 20, icon: 'favorite_fill', title: 'Щедрое сердце', text: 'Поставь 25 реакций в обсуждениях' },
  { id: 3, kind: 'days', goal: 4, xp: 30, icon: 'local_fire_department_fill', title: 'В строю', text: 'Будь активен 4 разных дня' },
  { id: 4, kind: 'daily', goal: 5, xp: 25, icon: 'redeem_fill', title: 'Верность', text: 'Забери ежедневную награду 5 раз' },
  { id: 5, kind: 'peak', goal: 50, xp: 30, icon: 'bolt_fill', title: 'Ударный день', text: 'Набери 50 XP активности за один день' },
];

// Three quests a week, rotating through the pool.
export function weekQuests(week) {
  return [week, week + 1, week + 3].map((i) => QUESTS[((i % QUESTS.length) + QUESTS.length) % QUESTS.length]);
}

async function questProgress(userId, ts) {
  const start = weekStart(ts);
  const rows = await db.all(sql`SELECT kind, points, earned_at FROM events
    WHERE user_id = ${userId} AND earned_at >= ${start} AND earned_at <= ${ts}
      AND kind IN ('comment', 'reaction', 'daily')`);
  const p = { comments: 0, reactions: 0, days: 0, daily: 0, peak: 0 };
  const perDay = new Map();
  for (const r of rows) {
    if (r.kind === 'daily') { p.daily++; continue; }
    if (!r.points) continue;
    if (r.kind === 'comment') p.comments++;
    else p.reactions++;
    const d = mskDay(r.earned_at);
    perDay.set(d, (perDay.get(d) || 0) + r.points);
  }
  p.days = perDay.size;
  for (const v of perDay.values()) p.peak = Math.max(p.peak, v);
  return p;
}

const questKey = (week, quest) => week * 10 + quest.id;

async function questsView(userId, ts) {
  const week = weekNo(ts);
  const progress = await questProgress(userId, ts);
  const claimed = new Set((await db.all(sql`SELECT message_id FROM events
    WHERE user_id = ${userId} AND kind = 'quest' AND message_id >= ${week * 10} AND message_id < ${week * 10 + 10}`))
    .map((r) => r.message_id));
  return weekQuests(week).map((q) => ({
    id: q.id, icon: q.icon, title: q.title, text: q.text, goal: q.goal, xp: q.xp,
    progress: Math.min(q.goal, progress[q.kind]),
    claimed: claimed.has(questKey(week, q)),
  }));
}

export async function claimQuest(user, id) {
  const ts = nowInt();
  const week = weekNo(ts);
  const quest = weekQuests(week).find((q) => q.id === id);
  if (!quest) throw new ClubError('Этого квеста на этой неделе нет.');
  const progress = await questProgress(user.id, ts);
  if (progress[quest.kind] < quest.goal) throw new ClubError('Квест ещё не выполнен.');
  const result = await xp.grant(user, 'quest', questKey(week, quest), quest.xp, ts);
  if (!result) throw new ClubError('Награда за этот квест уже получена.');
  return result;
}

// ---- achievements ------------------------------------------------------------

// `n` is the reward key in events: never reuse or renumber. The chat ones (17+) are in feats.js.
const CLUB_ACHIEVEMENTS = [
  { n: 1, code: 'first_comment', stat: 'comments', goal: 1, xp: 10, icon: 'chat_bubble_fill', title: 'Первое слово', text: 'Первый комментарий под постом' },
  { n: 2, code: 'comments_100', stat: 'comments', goal: 100, xp: 50, icon: 'chat_bubble_fill', title: 'Голос Сквада', text: '100 комментариев' },
  { n: 3, code: 'comments_500', stat: 'comments', goal: 500, xp: 150, icon: 'workspace_premium_fill', title: 'Легенда чата', text: '500 комментариев' },
  { n: 4, code: 'reactions_100', stat: 'reactions', goal: 100, xp: 30, icon: 'favorite_fill', title: 'Сердце Сквада', text: '100 реакций в обсуждениях' },
  { n: 5, code: 'streak_7', stat: 'streak', goal: 7, xp: 40, icon: 'local_fire_department_fill', title: 'Неделя в строю', text: 'Серия 7 активных дней' },
  { n: 6, code: 'streak_30', stat: 'streak', goal: 30, xp: 150, icon: 'local_fire_department_fill', title: 'Месяц огня', text: 'Серия 30 активных дней' },
  { n: 7, code: 'daily_7', stat: 'dailyRun', goal: 7, xp: 30, icon: 'redeem_fill', title: 'Верность', text: 'Награда 7 дней подряд' },
  { n: 8, code: 'xp_1000', stat: 'xp', goal: 1000, xp: 50, icon: 'military_tech_fill', title: 'Вестник', text: 'Набери 1000 XP' },
  { n: 9, code: 'xp_5000', stat: 'xp', goal: 5000, xp: 150, icon: 'diamond_fill', title: 'Архонт', text: 'Набери 5000 XP' },
  { n: 10, code: 'podium', stat: 'podium', goal: 1, xp: 50, icon: 'emoji_events_fill', title: 'Пьедестал', text: 'Попади в топ-3 недели' },
  { n: 11, code: 'recruiter', stat: 'referrals', goal: 1, xp: 20, icon: 'person_add_fill', title: 'Вербовщик', text: 'Приведи друга в канал' },
  { n: 12, code: 'legion', stat: 'referrals', goal: 5, xp: 75, icon: 'groups_fill', title: 'Легион', text: 'Приведи 5 друзей' },
  { n: 13, code: 'citizen', stat: 'polls', goal: 3, xp: 20, icon: 'how_to_vote_fill', title: 'Гражданин', text: 'Проголосуй в 3 опросах' },
  { n: 14, code: 'hunter', stat: 'quests', goal: 5, xp: 40, icon: 'flag_fill', title: 'Охотник', text: 'Выполни 5 квестов недели' },
  { n: 15, code: 'shopper', stat: 'purchases', goal: 1, xp: 10, icon: 'checkroom_fill', title: 'Модник', text: 'Купи вещь в лавке' },
  { n: 16, code: 'birthday', stat: 'birthday', goal: 1, xp: 20, icon: 'cake_fill', title: 'Именинник', text: 'Отметь день рождения в Скваде' },
];
export const ACHIEVEMENTS = [...CLUB_ACHIEVEMENTS, ...CHAT_ACHIEVEMENTS];

async function achievementStats(userId, base) {
  const counts = {};
  for (const r of await db.all(sql`SELECT kind, COUNT(*) AS c FROM events
    WHERE user_id = ${userId} AND (points > 0 OR chat_id = 0) GROUP BY kind`)) {
    counts[r.kind] = r.c;
  }
  const bought = await db.get(sql`SELECT COUNT(*) AS c FROM purchases WHERE user_id = ${userId}`);
  // Every friend counts, also those past the weekly XP limit.
  const invited = await db.get(sql`SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = ${userId}`);
  return {
    ...(await chatStats(userId)),
    ...base,
    comments: counts.comment || 0,
    reactions: counts.reaction || 0,
    podium: counts.weekly || 0,
    referrals: invited.c,
    polls: counts.poll || 0,
    quests: counts.quest || 0,
    birthday: counts.birthday || 0,
    purchases: bought.c,
  };
}

// Unlocks what the stats reached and gives its XP. Returns the list for the app.
async function achievementsView(userId, base) {
  const stats = await achievementStats(userId, base);
  const unlocked = new Map((await db.all(sql`SELECT code, unlocked_at FROM achievements WHERE user_id = ${userId}`))
    .map((r) => [r.code, r.unlocked_at]));
  const ts = nowInt();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.code) || stats[a.stat] < a.goal) continue;
    if (!(await unlock(userId, a, ts))) continue;
    unlocked.set(a.code, ts);
    fresh.push(a.code);
  }
  return {
    fresh,
    items: ACHIEVEMENTS.map((a) => ({
      code: a.code, icon: a.icon, title: a.title, text: a.text, xp: a.xp, goal: a.goal,
      progress: Math.min(a.goal, stats[a.stat] || 0),
      at: unlocked.get(a.code) || null,
    })),
  };
}

// ---- XP shop -----------------------------------------------------------------

export const SHOP = [
  { id: 'frame_ember', slot: 'frame', name: 'Тлеющие угли', price: 150 },
  { id: 'frame_ice', slot: 'frame', name: 'Лёд', price: 300 },
  { id: 'frame_gold', slot: 'frame', name: 'Золото', price: 500 },
  { id: 'frame_void', slot: 'frame', name: 'Бездна', price: 800 },
  { id: 'color_crimson', slot: 'color', name: 'Алый', price: 100 },
  { id: 'color_ice', slot: 'color', name: 'Ледяной', price: 250 },
  { id: 'color_toxic', slot: 'color', name: 'Токсичный', price: 250 },
  { id: 'color_gold', slot: 'color', name: 'Золотой', price: 400 },
  { id: 'title_night', slot: 'title', name: 'Ночной дозор', price: 200 },
  { id: 'title_voice', slot: 'title', name: 'Голос Сквада', price: 350 },
  { id: 'title_blood', slot: 'title', name: 'Кровь Сквада', price: 600 },
  { id: 'title_legend', slot: 'title', name: 'Легенда', price: 1000 },
  { id: 'chart_ice', slot: 'chart', name: 'Ледяной график', price: 250 },
  { id: 'chart_toxic', slot: 'chart', name: 'Токсичный график', price: 250 },
  { id: 'chart_neon', slot: 'chart', name: 'Неоновый график', price: 350 },
  { id: 'chart_gold', slot: 'chart', name: 'Золотой график', price: 500 },
];
const SHOP_BY_ID = new Map(SHOP.map((i) => [i.id, i]));
const SLOTS = ['frame', 'color', 'title', 'chart'];
export const findItem = (id) => SHOP_BY_ID.get(id) || null;

// Equipped cosmetics as shown to others: item ids, title as text.
export function styleView(row) {
  if (!row) return null;
  const title = row.title && SHOP_BY_ID.get(row.title);
  const style = { frame: row.frame || null, color: row.color || null, title: title ? title.name : null };
  return style.frame || style.color || style.title ? style : null;
}

async function wardrobe(userId) {
  return db.get(sql`SELECT frame, color, title FROM wardrobe WHERE user_id = ${userId}`);
}

async function spent(userId) {
  const row = await db.get(sql`SELECT COALESCE((SELECT SUM(price) FROM purchases WHERE user_id = ${userId}), 0)
    + COALESCE((SELECT SUM(amount) FROM xp_spend WHERE user_id = ${userId}), 0) AS s`);
  return row.s;
}

// The chart theme a member put on («Кто Я», «Моя анкета»), or null for the scarlet one.
export async function chartTheme(userId) {
  const row = await db.get(sql`SELECT theme FROM chart_themes WHERE user_id = ${userId}`);
  return row ? row.theme : null;
}

export async function ownsItem(userId, itemId) {
  if (userId === OWNER_USER_ID) return true;
  return Boolean(await db.get(sql`SELECT 1 AS x FROM purchases WHERE user_id = ${userId} AND item = ${itemId}`));
}

async function shopView(userId, totalXp, founder) {
  const owned = new Set((await db.all(sql`SELECT item FROM purchases WHERE user_id = ${userId}`)).map((r) => r.item));
  const worn = { ...((await wardrobe(userId)) || {}), chart: await chartTheme(userId) };
  return {
    balance: Math.max(0, totalXp - (await spent(userId))),
    founder,
    items: SHOP.map((i) => ({ ...i, owned: founder || owned.has(i.id), equipped: worn[i.slot] === i.id })),
  };
}

async function equip(userId, slot, item) {
  const ts = nowInt();
  // Charts keep their own table: the wardrobe has no column for them.
  if (slot === 'chart') {
    if (item) {
      await db.run(sql`INSERT INTO chart_themes (user_id, theme, updated_at) VALUES (${userId}, ${item}, ${ts})
        ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at`);
    } else {
      await db.run(sql`DELETE FROM chart_themes WHERE user_id = ${userId}`);
    }
    return;
  }
  await db.run(sql`INSERT INTO wardrobe (user_id, updated_at) VALUES (${userId}, ${ts})
    ON CONFLICT(user_id) DO NOTHING`);
  if (slot === 'frame') await db.run(sql`UPDATE wardrobe SET frame = ${item}, updated_at = ${ts} WHERE user_id = ${userId}`);
  else if (slot === 'color') await db.run(sql`UPDATE wardrobe SET color = ${item}, updated_at = ${ts} WHERE user_id = ${userId}`);
  else await db.run(sql`UPDATE wardrobe SET title = ${item}, updated_at = ${ts} WHERE user_id = ${userId}`);
}

// Buying spends the balance (XP minus purchases, gifts and stakes); XP and rank stay.
export async function buy(user, itemId) {
  const item = SHOP_BY_ID.get(itemId);
  if (!item) throw new ClubError('Такой вещи нет в лавке.');
  const founder = user.id === OWNER_USER_ID;
  if (!founder) {
    const ts = nowInt();
    // One statement: two quick taps can't spend the same XP twice.
    const r = await db.run(sql`INSERT OR IGNORE INTO purchases (user_id, item, price, bought_at)
      SELECT ${user.id}, ${item.id}, ${item.price}, ${ts}
      WHERE (SELECT xp FROM profiles WHERE user_id = ${user.id})
        - (SELECT COALESCE(SUM(price), 0) FROM purchases WHERE user_id = ${user.id})
        - (SELECT COALESCE(SUM(amount), 0) FROM xp_spend WHERE user_id = ${user.id}) >= ${item.price}`);
    if (r.rowsAffected !== 1) {
      const have = await db.get(sql`SELECT 1 AS x FROM purchases WHERE user_id = ${user.id} AND item = ${item.id}`);
      if (!have) throw new ClubError('Не хватает XP на балансе.');
    }
  }
  await equip(user.id, item.slot, item.id);
}

export async function wear(user, slot, itemId) {
  if (!SLOTS.includes(slot)) throw new ClubError('Неизвестный слот.');
  if (itemId == null) {
    await equip(user.id, slot, null);
    return;
  }
  const item = SHOP_BY_ID.get(itemId);
  if (!item || item.slot !== slot) throw new ClubError('Такой вещи нет в лавке.');
  if (user.id !== OWNER_USER_ID) {
    const have = await db.get(sql`SELECT 1 AS x FROM purchases WHERE user_id = ${user.id} AND item = ${item.id}`);
    if (!have) throw new ClubError('Сначала купи эту вещь.');
  }
  await equip(user.id, slot, item.id);
}

// ---- polls -------------------------------------------------------------------

export const POLL_XP = 3;
const MAX_OPEN_POLLS = 3;

function parseOptions(json) {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function pollView(poll, userId, owner) {
  const options = parseOptions(poll.options);
  const counts = new Array(options.length).fill(0);
  for (const r of await db.all(sql`SELECT option, COUNT(*) AS c FROM poll_votes WHERE poll_id = ${poll.id} GROUP BY option`)) {
    if (r.option >= 0 && r.option < counts.length) counts[r.option] = r.c;
  }
  const mine = await db.get(sql`SELECT option FROM poll_votes WHERE poll_id = ${poll.id} AND user_id = ${userId}`);
  const open = poll.status === 'open';
  // Results stay hidden until you vote, so the first votes don't steer the rest.
  const reveal = !open || Boolean(mine) || owner;
  const view = {
    id: poll.id,
    question: poll.question,
    open,
    my: mine ? mine.option : null,
    total: reveal ? counts.reduce((a, b) => a + b, 0) : null,
    options: options.map((text, i) => ({ text, votes: reveal ? counts[i] : null })),
    at: poll.created_at,
  };
  if (owner) await addVoters(view);
  return view;
}

// Only the owner sees who chose what, in the order they voted.
async function addVoters(view) {
  for (const o of view.options) o.voters = [];
  const rows = await db.all(sql`SELECT v.user_id, v.option, v.voted_at, p.username FROM poll_votes v
    LEFT JOIN profiles p ON p.user_id = v.user_id
    WHERE v.poll_id = ${view.id} ORDER BY v.voted_at, v.user_id`);
  for (const r of rows) {
    const o = view.options[r.option];
    if (o) o.voters.push({ id: r.user_id, name: await nameOf(r.user_id), username: r.username || '', at: r.voted_at });
  }
}

async function pollsView(userId, owner) {
  const rows = await db.all(sql`SELECT * FROM polls WHERE status = 'open'
    OR id IN (SELECT id FROM polls WHERE status = 'closed' ORDER BY id DESC LIMIT 2)
    ORDER BY status = 'open' DESC, id DESC`);
  const out = [];
  for (const p of rows) out.push(await pollView(p, userId, owner));
  return out;
}

export async function vote(user, pollId, option) {
  if (!Number.isInteger(pollId) || !Number.isInteger(option)) throw new ClubError('Неверный голос.');
  const poll = await db.get(sql`SELECT * FROM polls WHERE id = ${pollId}`);
  if (!poll) throw new ClubError('Опрос не найден.');
  if (poll.status !== 'open') throw new ClubError('Опрос уже закрыт.');
  if (option < 0 || option >= parseOptions(poll.options).length) throw new ClubError('Неверный вариант.');
  // The poll may close between the check above and this insert.
  const r = await db.run(sql`INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option, voted_at)
    SELECT ${pollId}, ${user.id}, ${option}, ${nowInt()}
    WHERE EXISTS (SELECT 1 FROM polls WHERE id = ${pollId} AND status = 'open')`);
  if (r.rowsAffected !== 1) {
    const voted = await db.get(sql`SELECT 1 AS x FROM poll_votes WHERE poll_id = ${pollId} AND user_id = ${user.id}`);
    throw new ClubError(voted ? 'Твой голос в этом опросе уже учтён.' : 'Опрос уже закрыт.');
  }
  return xp.grant(user, 'poll', pollId, POLL_XP);
}

export async function createPoll(question, options) {
  question = String(question || '').trim();
  options = (Array.isArray(options) ? options : []).map((o) => String(o || '').trim()).filter(Boolean);
  if (Array.from(question).length < 3 || Array.from(question).length > 200) throw new ClubError('Вопрос: от 3 до 200 символов.');
  if (options.length < 2 || options.length > 6) throw new ClubError('Нужно от 2 до 6 вариантов.');
  if (options.some((o) => Array.from(o).length > 80)) throw new ClubError('Вариант: не длиннее 80 символов.');
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new ClubError('Варианты не должны повторяться.');
  const open = await db.get(sql`SELECT COUNT(*) AS c FROM polls WHERE status = 'open'`);
  if (open.c >= MAX_OPEN_POLLS) throw new ClubError(`Открыто уже ${MAX_OPEN_POLLS} опроса. Закрой один из них.`);
  await db.run(sql`INSERT INTO polls (question, options, status, created_at)
    VALUES (${question}, ${JSON.stringify(options)}, 'open', ${nowInt()})`);
}

export async function closePoll(pollId) {
  const r = await db.run(sql`UPDATE polls SET status = 'closed', closed_at = ${nowInt()}
    WHERE id = ${pollId} AND status = 'open'`);
  if (r.rowsAffected !== 1) throw new ClubError('Опрос уже закрыт.');
}

// ---- birthdays ---------------------------------------------------------------

export const BIRTHDAY_XP = 50;
const BIRTHDAY_EDIT_DAYS = 30;

function isBirthday(b, date) {
  if (b.month === date.month && b.day === date.day) return true;
  // 29 February is celebrated on the 28th in other years.
  return b.month === 2 && b.day === 29 && !isLeap(date.year) && date.month === 2 && date.day === 28;
}

async function birthdayView(user, ts) {
  const b = await db.get(sql`SELECT * FROM birthdays WHERE user_id = ${user.id}`);
  if (!b) return { day: null, month: null, announce: true, editableAt: null, today: false };
  const date = mskDate(ts);
  const today = isBirthday(b, date);
  // Opening the app on the birthday gives the gift even before the morning greeting.
  if (today) await xp.grant(user, 'birthday', date.year, BIRTHDAY_XP, ts);
  const editableAt = b.updated_at + BIRTHDAY_EDIT_DAYS * DAY;
  return { day: b.day, month: b.month, announce: Boolean(b.announce), editableAt: editableAt > ts ? editableAt : null, today };
}

export async function setBirthday(user, day, month, announce) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) {
    throw new ClubError('Выбери день и месяц.');
  }
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > max) throw new ClubError('В этом месяце нет такого дня.');
  const ts = nowInt();
  const old = await db.get(sql`SELECT * FROM birthdays WHERE user_id = ${user.id}`);
  const announceValue = announce === false ? 0 : 1;
  if (old && (old.day !== day || old.month !== month)) {
    if (old.updated_at + BIRTHDAY_EDIT_DAYS * DAY > ts) throw new ClubError('Дату можно менять раз в 30 дней.');
  }
  if (old && old.day === day && old.month === month) {
    await db.run(sql`UPDATE birthdays SET announce = ${announceValue} WHERE user_id = ${user.id}`);
    return;
  }
  await db.run(sql`INSERT INTO birthdays (user_id, day, month, announce, updated_at)
    VALUES (${user.id}, ${day}, ${month}, ${announceValue}, ${ts})
    ON CONFLICT(user_id) DO UPDATE SET day = excluded.day, month = excluded.month,
      announce = excluded.announce, updated_at = excluded.updated_at`);
}

// ---- referrals ---------------------------------------------------------------

export const REFERRAL_XP = 25;
export const INVITED_XP = 10;
const REFERRALS_PER_WEEK = 10;

async function referralView(userId) {
  const link = await db.get(sql`SELECT link FROM ref_links WHERE user_id = ${userId}`);
  const row = await db.get(sql`SELECT COUNT(*) AS c, COALESCE(SUM(points), 0) AS s FROM referrals WHERE referrer_id = ${userId}`);
  return { link: link ? link.link : null, count: row.c, xp: row.s, reward: REFERRAL_XP, bonus: INVITED_XP };
}

export async function referralLink(user) {
  const known = await db.get(sql`SELECT link FROM ref_links WHERE user_id = ${user.id}`);
  if (known) return known.link;
  let created;
  try {
    created = await api.createChatInviteLink({ chat_id: SQUAD_CHANNEL_ID, name: `ref:${user.id}` });
  } catch (err) {
    await logError('club.ref', err);
    throw new ClubError('Не получилось создать ссылку. Попробуй чуть позже.');
  }
  if (!created || !created.invite_link) throw new ClubError('Не получилось создать ссылку. Попробуй чуть позже.');
  await db.run(sql`INSERT OR IGNORE INTO ref_links (user_id, link, created_at)
    VALUES (${user.id}, ${created.invite_link}, ${nowInt()})`);
  const row = await db.get(sql`SELECT link FROM ref_links WHERE user_id = ${user.id}`);
  return row.link;
}

async function referrerFor(inviteLink) {
  if (!inviteLink) return null;
  const row = await db.get(sql`SELECT user_id FROM ref_links WHERE link = ${String(inviteLink.invite_link || '')}`);
  if (row) return row.user_id;
  const m = /^ref:(\d{1,15})$/.exec(String(inviteLink.name || ''));
  if (!m) return null;
  const id = Number(m[1]);
  const known = await db.get(sql`SELECT user_id FROM ref_links WHERE user_id = ${id}`);
  return known ? id : null;
}

async function tellUser(userId, text, replyMarkup) {
  const known = await getUser(userId);
  if (!known || known.blocked) return;
  try {
    await api.sendMessage({ chat_id: userId, text: boldHtml(text), parse_mode: 'HTML', reply_markup: replyMarkup });
  } catch {
    console.info(`Could not notify ${userId}`);
  }
}

// chat_member in the channel: someone joined through a member's link.
export async function handleJoin(event) {
  if (!event || !event.chat || event.chat.id !== SQUAD_CHANNEL_ID) return;
  const oldStatus = event.old_chat_member && event.old_chat_member.status;
  const newMember = event.new_chat_member;
  if (!newMember || newMember.status !== 'member' || !['left', 'kicked'].includes(oldStatus)) return;
  const user = newMember.user;
  if (!user || user.is_bot) return;
  const referrerId = await referrerFor(event.invite_link);
  if (!referrerId || referrerId === user.id) return;
  // Someone who already left the channel once isn't a new member.
  const left = await db.get(sql`SELECT 1 AS x FROM blacklist WHERE chat_id = ${SQUAD_CHANNEL_ID} AND user_id = ${user.id}`);
  if (left) return;
  const ts = nowInt();
  // The weekly cap is counted inside the insert, so joins arriving together cannot pass it.
  const r = await db.run(sql`INSERT OR IGNORE INTO referrals (referred_id, referrer_id, joined_at, points)
    SELECT ${user.id}, ${referrerId}, ${ts},
      CASE WHEN (SELECT COUNT(*) FROM referrals WHERE referrer_id = ${referrerId} AND points > 0
        AND joined_at >= ${weekStart(ts)}) < ${REFERRALS_PER_WEEK} THEN ${REFERRAL_XP} ELSE 0 END
    RETURNING points`);
  if (r.rowsAffected !== 1) return;
  const pts = r.rows[0].points;
  await xp.grant(user, 'invited', 0, INVITED_XP, ts);
  if (!pts) return;
  await xp.grant(referrerId, 'referral', user.id, pts, ts);
  await tellUser(referrerId,
    `<b>🤝 По твоей ссылке в Сквад пришёл ${escapeHtml(truncate(fullName(user), 40))}!</b>\n\n+${pts} XP на твой счёт.`,
    await profileButton());
}

// ---- newcomer welcome --------------------------------------------------------

const WELCOME_GAP = 15;

async function profileButton(text = '👤 Мой профиль') {
  try {
    const me = await getMe();
    return keyboard([[button(text, { url: `https://t.me/${me.username}?start=profile` })]]);
  } catch {
    return undefined;
  }
}

// Claims a time slot in settings; false if someone used it less than `gap` seconds ago.
async function claimSlot(key, gap) {
  const ts = nowInt();
  await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, '0')`);
  const r = await db.run(sql`UPDATE settings SET value = ${String(ts)}
    WHERE key = ${key} AND CAST(value AS INTEGER) <= ${ts - gap}`);
  return r.rowsAffected === 1;
}

// A service message with new_chat_members in the discussion group.
export async function welcome(message) {
  const people = (message.new_chat_members || []).filter((u) => u && !u.is_bot);
  if (!people.length || !(await getSetting('club_welcome'))) return;
  const chatId = message.chat.id;
  // Per chat: a greeting in one group must not silence or delete one in another.
  if (!(await claimSlot(`welcome_at:${chatId}`, WELCOME_GAP))) return;
  const names = people.slice(0, 5).map((u) => `<b>${escapeHtml(truncate(fullName(u), 40))}</b>`).join(', ');
  const text = `👋 Добро пожаловать в Сквад, ${names}!\n\n` +
    'Здесь обсуждают посты @THKC_SQUAD. Пиши комментарии и ставь реакции: за них Финя даёт XP, ' +
    'звания, ачивки и награды.\n\n' +
    `📜 Сначала загляни в <a href="${SQUAD_LINKS.rules}">правила</a>.`;
  const sent = await withPremium({
    chat_id: message.chat.id, text: boldHtml(text), parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: await profileButton('👤 Профиль и награды'),
  }, (p) => api.sendMessage(p));
  // Only the newest greeting stays, so a wave of joins doesn't flood the chat.
  const previous = await getSetting(`welcome_last:${chatId}`);
  await setSetting(`welcome_last:${chatId}`, sent && sent.message_id ? sent.message_id : null);
  if (previous) {
    try {
      await api.deleteMessage({ chat_id: chatId, message_id: previous });
    } catch {
      // Too old or already deleted.
    }
  }
}

// ---- weekly summary ----------------------------------------------------------

export const WEEKLY_BONUS = [50, 30, 20];
const MEDALS = ['🥇', '🥈', '🥉'];
const pad = (n) => String(n).padStart(2, '0');

function shortDate(ts) {
  const d = mskDate(ts);
  return `${pad(d.day)}.${pad(d.month)}`;
}

async function weekSummary(start) {
  const end = start + 7 * DAY;
  const top = await db.all(sql`SELECT p.user_id, p.name, SUM(e.points) AS score FROM events e
    JOIN profiles p ON p.user_id = e.user_id
    WHERE e.earned_at >= ${start} AND e.earned_at < ${end} AND e.points > 0 AND e.kind IN ('comment', 'reaction')
    GROUP BY p.user_id ORDER BY score DESC, p.user_id LIMIT 3`);
  const stats = await db.get(sql`SELECT
      SUM(CASE WHEN kind = 'comment' AND points > 0 THEN 1 ELSE 0 END) AS comments,
      SUM(CASE WHEN kind = 'reaction' AND points > 0 THEN 1 ELSE 0 END) AS reactions,
      COUNT(DISTINCT CASE WHEN points > 0 AND kind IN ('comment', 'reaction') THEN user_id END) AS active
    FROM events WHERE earned_at >= ${start} AND earned_at < ${end}`);
  return { start, end, top, comments: stats.comments || 0, reactions: stats.reactions || 0, active: stats.active || 0 };
}

export function summaryText(s) {
  const lines = s.top.map((r, i) =>
    `${MEDALS[i]} <b>${escapeHtml(truncate(r.name, 35))}</b> — ${r.score} XP · бонус +${WEEKLY_BONUS[i]} XP`);
  return `<b>🏆 Итоги недели Сквада · ${shortDate(s.start)}–${shortDate(s.end - 1)}</b>\n\n` +
    lines.join('\n') + '\n\n' +
    `💬 Комментариев: <b>${s.comments}</b>\n❤️ Реакций: <b>${s.reactions}</b>\n` +
    `👥 Активных участников: <b>${s.active}</b>\n\n` +
    'Новая неделя уже началась. Звание, квесты и награды — в профиле у Фини 🔥';
}

export async function weeklyPreview(chatId) {
  const s = await weekSummary(weekStart(nowInt()) - 7 * DAY);
  const text = s.top.length ? summaryText(s) : 'На прошлой неделе никто не заработал XP: итоги не публикуются.';
  await api.sendMessage({ chat_id: chatId, text: boldHtml('Предпросмотр, в канал не ушло\n\n' + text), parse_mode: 'HTML' });
}

// From Monday 12:00 MSK, once a week: last week's top-3 to the channel.
async function weeklyTick(ts) {
  const week = weekNo(ts);
  const first = await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES ('weekly_summary_week', ${String(week)})`);
  if (first.rowsAffected === 1) return; // first run: start with the next week
  if (ts - weekStart(ts) < 12 * 3600) return;
  const won = await db.run(sql`UPDATE settings SET value = ${String(week)}
    WHERE key = 'weekly_summary_week' AND CAST(value AS INTEGER) < ${week}`);
  if (won.rowsAffected !== 1 || !(await getSetting('club_weekly'))) return;
  const s = await weekSummary(weekStart(ts) - 7 * DAY);
  if (!s.top.length) return;
  try {
    // Bonuses are once per week key, so a retry after a failed post doesn't pay twice.
    for (let i = 0; i < s.top.length; i++) {
      await xp.grant(s.top[i].user_id, 'weekly', week - 1, WEEKLY_BONUS[i], ts);
    }
    await api.sendMessage({
      chat_id: SQUAD_CHANNEL_ID, text: boldHtml(summaryText(s)), parse_mode: 'HTML',
      reply_markup: await profileButton('👤 Мой профиль у Фини'),
    });
  } catch (err) {
    // Not posted: give the week back so the next pump tries again.
    await db.run(sql`UPDATE settings SET value = ${String(week - 1)}
      WHERE key = 'weekly_summary_week' AND value = ${String(week)}`);
    throw err;
  }
}

// ---- birthday greetings --------------------------------------------------------

// From 10:00 MSK, once a day: gifts and one greeting in the discussion group.
async function birthdayTick(ts) {
  const date = mskDate(ts);
  if (date.hour < 10) return;
  const day = mskDay(ts);
  await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES ('birthday_day', ${String(day - 1)})`);
  const won = await db.run(sql`UPDATE settings SET value = ${String(day)}
    WHERE key = 'birthday_day' AND CAST(value AS INTEGER) < ${day}`);
  if (won.rowsAffected !== 1) return;
  // 29 February only joins on the 28th of a common year (filtered before LIMIT).
  const leapDay = date.month === 2 && date.day === 28 && !isLeap(date.year) ? 1 : 0;
  const rows = await db.all(sql`SELECT b.user_id, b.day, b.month, b.announce, p.name FROM birthdays b
    JOIN profiles p ON p.user_id = b.user_id
    WHERE (b.month = ${date.month} AND b.day = ${date.day}) OR (${leapDay} = 1 AND b.month = 2 AND b.day = 29)
    ORDER BY b.user_id LIMIT 50`);
  const today = rows.filter((r) => isBirthday(r, date));
  if (!today.length) return;
  // The group greeting goes first: personal messages below may run out of call time.
  const named = today.filter((r) => r.announce).slice(0, 10);
  const chatId = named.length && (await getSetting('club_birthdays')) ? await resolveXpChat() : null;
  if (chatId) {
    const names = named.map((r) => `<b>${escapeHtml(truncate(r.name, 35))}</b>`).join(', ');
    try {
      await api.sendMessage({
        chat_id: chatId, parse_mode: 'HTML',
        text: boldHtml(`🎂 Сегодня день рождения у ${names}!\n\nСквад поздравляет 🎉 Финя дарит +${BIRTHDAY_XP} XP. ` +
          'Отметь свой день рождения в профиле.'),
        reply_markup: await profileButton('🎁 Мой профиль'),
      });
    } catch (err) {
      await logError('club.birthdays', err);
    }
  }
  for (const r of today) {
    const gift = await xp.grant(r.user_id, 'birthday', date.year, BIRTHDAY_XP, ts);
    if (gift) {
      await tellUser(r.user_id, `<b>🎂 С днём рождения!</b>\n\nСквад тебя поздравляет, а Финя дарит +${BIRTHDAY_XP} XP 🎁`,
        await profileButton());
    }
  }
}

// Runs from pump(); each part guards itself, so it posts at most once.
export async function tick() {
  const ts = nowInt();
  for (const [name, fn] of [['club.weekly', weeklyTick], ['club.birthdays', birthdayTick]]) {
    try {
      await fn(ts);
    } catch (err) {
      await logError(name, err);
    }
  }
}

// ---- everything for the Mini App ---------------------------------------------

export async function clubData(user, { xpTotal, streakDays, founder }) {
  const ts = nowInt();
  const daily = await dailyState(user.id, ts);
  const birthday = await birthdayView(user, ts);
  const achievements = await achievementsView(user.id, { streak: streakDays, dailyRun: daily.run, xp: xpTotal });
  // Gifts above may have changed the total.
  const p = await db.get(sql`SELECT xp FROM profiles WHERE user_id = ${user.id}`);
  const data = {
    daily: { rewards: DAILY_REWARDS, step: daily.step, claimed: daily.claimed, run: daily.run },
    quests: await questsView(user.id, ts),
    weekEnds: weekStart(ts) + 7 * DAY,
    achievements: achievements.items,
    fresh: achievements.fresh,
    shop: await shopView(user.id, p ? p.xp : xpTotal, founder),
    polls: await pollsView(user.id, founder),
    birthday,
    referral: await referralView(user.id),
    xp: p ? p.xp : xpTotal,
  };
  if (founder) {
    data.admin = {
      weekly: Boolean(await getSetting('club_weekly')),
      welcome: Boolean(await getSetting('club_welcome')),
      birthdays: Boolean(await getSetting('club_birthdays')),
      antiflood: Boolean(await getSetting('chat_antiflood')),
      captcha: Boolean(await getSetting('chat_captcha')),
      daily: Boolean(await getSetting('chat_daily')),
    };
  }
  return data;
}

export async function myStyle(userId) {
  return styleView(await wardrobe(userId));
}
