// Small chat extras: «Моя Статья», upcoming birthdays, the age of a Telegram account,
// zodiac and horoscope, countdowns.
import { db, fetch } from 'sdk';
import { sql } from 'sdk/db';
import { getSetting, logError, setSetting } from './store.js';
import { escapeHtml, MSK_OFFSET, nowInt, truncate } from './util.js';
import * as anketa from './anketa.js';
import * as members from './members.js';
import { mention } from './moder.js';
import * as social from './social.js';

const DAY = 86400;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// ---- «Моя Статья» ---------------------------------------------------------------
// The article of the day from the Squad's own «code», picked by what the member does in
// the chats: a flooder gets flooding, a night owl gets the night shift. Same all day.

const ARTICLES = {
  flood: [
    ['101', 'Флуд в особо крупном размере'],
    ['102', 'Злостное многословие с отягчающими'],
    ['103', 'Захват ленты чата без разрешения'],
  ],
  silent: [
    ['13', 'Злостное молчание в общем чате'],
    ['14', 'Чтение без ответа, совершённое систематически'],
    ['15', 'Тунеядство в чате Сквада'],
  ],
  night: [
    ['0.01', 'Ночной дозор без лицензии'],
    ['0.02', 'Нарушение режима сна в особо крупном размере'],
  ],
  early: [
    ['6.30', 'Подозрительно бодрое утро'],
    ['6.31', 'Флуд до первого кофе'],
  ],
  rp: [
    ['69', 'Обнимашки без предварительного согласия'],
    ['70', 'Систематическое тисканье участников'],
  ],
  casino: [
    ['777', 'Незаконный игорный бизнес на XP'],
    ['778', 'Растрата XP в казино при отягчающих'],
  ],
  gifts: [
    ['500', 'Подкуп участников XP'],
    ['501', 'Щедрость, опасная для экономики Сквада'],
  ],
  rep: [
    ['1+', 'Раздача плюсов без лицензии'],
    ['2+', 'Накрутка репутации друзьям'],
  ],
  married: [
    ['14.02', 'Публичные нежности в общем чате'],
    ['14.03', 'Хвастовство браком при свидетелях'],
  ],
  general: [
    ['404', 'Подозрение в адекватности'],
    ['418', 'Хранение мемов в особо крупном размере'],
    ['451', 'Оскорбление чувств модераторов'],
    ['228.1', 'Незаконный оборот стикеров'],
    ['300', 'Нарушение тишины в чате'],
    ['112', 'Ложный вызов Фини'],
  ],
};

const SENTENCES = [
  '3 дня без стикеров',
  'условно, до первого флуда',
  'обязательные работы: 10 комментариев под постами канала',
  'штраф: по реакции под каждым постом недели',
  'пожизненное членство в Скваде',
  'исправительные работы: развлекать чат весь вечер',
  'выговор от Фини с занесением в профиль',
  'амнистия в честь хорошего настроения',
  'неделя без казино',
  'публичное признание любви к Скваду',
];

// A tiny seeded generator, so one member gets one article a day.
function seeded(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const pickWith = (rand, list) => list[Math.floor(rand() * list.length)];

async function articleStats(userId, ts) {
  const today = members.mskDay(ts);
  const msgs = await db.get(sql`SELECT
      COALESCE(SUM(CASE WHEN day = ${today} THEN msgs END), 0) AS day,
      COALESCE(SUM(msgs), 0) AS week
    FROM chat_activity WHERE user_id = ${userId} AND day > ${today - 7}`);
  const counters = new Map((await db.all(sql`SELECT key, n FROM counters
    WHERE user_id = ${userId} AND key IN ('night', 'early', 'rp')`)).map((r) => [r.key, r.n]));
  const spend = new Map((await db.all(sql`SELECT kind, COUNT(*) AS c FROM xp_spend
    WHERE user_id = ${userId} AND at >= ${ts - 7 * DAY} GROUP BY kind`)).map((r) => [r.kind, r.c]));
  const rep = await social.repOf(userId);
  const spouse = await social.spouseOf(userId);
  return {
    day: msgs.day, week: msgs.week,
    night: counters.get('night') || 0, early: counters.get('early') || 0, rp: counters.get('rp') || 0,
    casino: spend.get('casino') || 0, gifts: spend.get('gift') || 0,
    given: rep.given, spouse: spouse ? await members.nameOf(spouse.partner_id) : null,
  };
}

const count = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;
const msgs = (n) => count(n, 'сообщение', 'сообщения', 'сообщений');

// What the member did that brings this article: [kind, reason].
function grounds(s) {
  const out = [];
  if (s.day >= 50 || s.week >= 300) out.push(['flood', s.day >= 50 ? `${msgs(s.day)} за сегодня` : `${msgs(s.week)} за неделю`]);
  if (s.week === 0) out.push(['silent', 'ни одного сообщения за неделю']);
  if (s.night >= 20) out.push(['night', `${msgs(s.night)} глубокой ночью`]);
  if (s.early >= 20) out.push(['early', `${msgs(s.early)} до 8 утра`]);
  if (s.rp >= 20) out.push(['rp', count(s.rp, 'РП-действие', 'РП-действия', 'РП-действий')]);
  if (s.casino >= 3) out.push(['casino', `${count(s.casino, 'игра', 'игры', 'игр')} в казино за неделю`]);
  if (s.gifts >= 1) out.push(['gifts', `${count(s.gifts, 'перевод', 'перевода', 'переводов')} XP за неделю`]);
  if (s.given >= 20) out.push(['rep', `${count(s.given, 'плюс', 'плюса', 'плюсов')} в репутацию`]);
  if (s.spouse) out.push(['married', `в браке с ${escapeHtml(truncate(s.spouse, 40))}`]);
  return out;
}

// One article a day: it is chosen at the first ask and kept, even when the activity
// behind it grows later in the day.
export async function articleText(who, ts = nowInt()) {
  const day = members.mskDay(ts);
  const key = `article:${who.id}`;
  let a = await getSetting(key);
  if (!a || a.day !== day) {
    const rand = seeded(who.id * 31 + day);
    const found = grounds(await articleStats(who.id, ts));
    // Mostly for what they do; now and then just for being here.
    const [kind, reason] = found.length && rand() < 0.85 ? pickWith(rand, found) : ['general', 'подозрительно хорошее поведение'];
    const [number, title] = pickWith(rand, ARTICLES[kind]);
    a = { day, number, title, reason, sentence: pickWith(rand, SENTENCES) };
    await setSetting(key, a);
  }
  return `⚖️ Статья дня · ${mention(who.id, who.name)}\n\n` +
    `📕 Ст. ${a.number} УК Сквада\n«${a.title}»\n\n` +
    `🔎 Основание: ${a.reason}\n` +
    `🔨 Приговор: ${a.sentence}\n\n` +
    'Новая статья завтра.';
}

// ---- upcoming birthdays ----------------------------------------------------------

export const BIRTHDAYS_AHEAD = 30;

// Days from today (Moscow) to the next day/month, 0 for today. 29.02 falls on 01.03
// in other years.
export function daysUntil(day, month, ts = nowInt()) {
  const now = new Date((ts + MSK_OFFSET) * 1000);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    let date = Date.UTC(year, month - 1, day);
    if (new Date(date).getUTCMonth() !== month - 1) date = Date.UTC(year, month, 1);
    if (date >= today) return Math.round((date - today) / (DAY * 1000));
  }
  return null;
}

// Birthdays in the next 30 days: of this chat's members in a group, of the whole Squad
// in the private chat.
export async function birthdaysText(chatId, ts = nowInt()) {
  const rows = chatId
    ? await db.all(sql`SELECT b.user_id, b.day, b.month FROM birthdays b
        JOIN chat_members m ON m.user_id = b.user_id AND m.chat_id = ${chatId} AND m.status = 'member'`)
    : await db.all(sql`SELECT user_id, day, month FROM birthdays
        WHERE user_id IN (SELECT user_id FROM chat_members WHERE status = 'member')`);
  const soon = rows.map((r) => ({ ...r, left: daysUntil(r.day, r.month, ts) }))
    .filter((r) => r.left != null && r.left <= BIRTHDAYS_AHEAD)
    .sort((a, b) => a.left - b.left || a.user_id - b.user_id);
  const where = chatId ? 'в этом чате' : 'в Скваде';
  if (!soon.length) {
    return `🎂 В ближайший месяц дней рождения ${where} нет.\n\nСвой ДР: «+ДР 16.12», и Финя поздравит.`;
  }
  const lines = [];
  for (const r of soon.slice(0, 20)) {
    const name = escapeHtml(truncate(await members.nameOf(r.user_id), 40));
    const when = r.left === 0 ? '🎉 сегодня' : r.left === 1 ? 'завтра' : `через ${r.left} ${plural(r.left, 'день', 'дня', 'дней')}`;
    lines.push(`${r.day} ${MONTHS_GEN[r.month - 1]} — ${name} · ${when}`);
  }
  if (soon.length > 20) lines.push(`…и ещё ${soon.length - 20}`);
  return `🎂 Ближайшие дни рождения ${where}\n\n${lines.join('\n')}\n\nСвой ДР: «+ДР 16.12».`;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// ---- the age of a Telegram account -----------------------------------------------
// Telegram doesn't tell when an account was made. User IDs grow over time, so known
// (ID, month) pairs give an estimate: right to a season or so, not to the day.

const ID_DATES = [
  [0, '2013-08'], [10e6, '2014-03'], [50e6, '2015-01'], [100e6, '2015-06'], [150e6, '2016-03'],
  [200e6, '2016-07'], [300e6, '2017-01'], [400e6, '2017-07'], [500e6, '2018-01'], [600e6, '2018-05'],
  [700e6, '2018-09'], [800e6, '2019-01'], [1000e6, '2019-09'], [1200e6, '2020-03'], [1500e6, '2020-12'],
  [1800e6, '2021-04'], [2100e6, '2021-09'], [5000e6, '2021-12'], [5500e6, '2022-07'], [6000e6, '2023-01'],
  [6500e6, '2023-09'], [7000e6, '2024-03'], [7500e6, '2024-09'], [8000e6, '2025-03'], [8500e6, '2025-10'],
].map(([id, ym]) => [id, Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1, 1) / 1000]);

// → unix time of the estimated sign-up, never later than now.
export function accountSince(userId, ts = nowInt()) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  let i = ID_DATES.findIndex(([edge]) => edge > id);
  if (i === -1) i = ID_DATES.length - 1;
  if (i === 0) i = 1;
  const [id0, t0] = ID_DATES[i - 1];
  const [id1, t1] = ID_DATES[i];
  const t = t0 + ((id - id0) / (id1 - id0)) * (t1 - t0);
  return Math.min(Math.round(t), ts);
}

// «марта 2016»
export function accountSinceText(userId, ts = nowInt()) {
  const t = accountSince(userId, ts);
  if (t == null) return null;
  const d = new Date(t * 1000);
  return `${MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function accountAgeText(who, ts = nowInt()) {
  const t = accountSince(who.id, ts);
  if (t == null) return '📅 Не получилось оценить возраст аккаунта.';
  const years = Math.floor((ts - t) / (365.25 * DAY));
  const age = years >= 1 ? `≈ ${years} ${plural(years, 'год', 'года', 'лет')}` : 'меньше года';
  return `📅 Аккаунт ${mention(who.id, who.name)}\n\nВ Telegram примерно с ${accountSinceText(who.id, ts)} · ${age}\n\n` +
    'Telegram не сообщает дату регистрации, Финя оценивает её по ID: точность до сезона.';
}

// ---- zodiac and horoscope ---------------------------------------------------------

// [key in the feed, name, emoji]. The dates of the signs live in anketa.zodiac.
const SIGNS = [
  ['capricorn', 'Козерог', '♑'], ['aquarius', 'Водолей', '♒'], ['pisces', 'Рыбы', '♓'],
  ['aries', 'Овен', '♈'], ['taurus', 'Телец', '♉'], ['gemini', 'Близнецы', '♊'],
  ['cancer', 'Рак', '♋'], ['leo', 'Лев', '♌'], ['virgo', 'Дева', '♍'],
  ['libra', 'Весы', '♎'], ['scorpio', 'Скорпион', '♏'], ['sagittarius', 'Стрелец', '♐'],
];
const asSign = (found) => (found ? { key: found[0], name: found[1], emoji: found[2] } : null);

// → { key, name, emoji } for a day and month.
export function zodiac(day, month) {
  const label = anketa.zodiac(day, month);
  return asSign(SIGNS.find(([, name]) => label.endsWith(name)));
}

// «Гороскоп Рыбы», «гороскоп козерога» → the sign, by the start of its name.
export function signByName(words) {
  const w = String(words || '').toLowerCase().replace(/ё/g, 'е').trim();
  if (Array.from(w).length < 3) return null;
  // Genitives that drop a vowel: «овна», «льва».
  if (w.startsWith('овн')) return signByName('овен');
  if (w.startsWith('льв')) return signByName('лев');
  const found = SIGNS.find(([, name]) => {
    const n = name.toLowerCase();
    return n.startsWith(w) || w.startsWith(n.slice(0, Math.max(3, n.length - 2)));
  });
  return asSign(found);
}

export async function zodiacOf(userId) {
  const b = await db.get(sql`SELECT day, month FROM birthdays WHERE user_id = ${userId}`);
  return b ? zodiac(b.day, b.month) : null;
}

// The daily horoscope of ignio.com: one public XML for all twelve signs, kept for the
// Moscow day so the chats don't fetch it on every command. The export lives on the
// img. host; the others are spares in case it moves.
export const HOROSCOPE_URLS = [
  'https://img.ignio.com/r/export/utf/xml/daily/com.xml',
  'http://img.ignio.com/r/export/utf/xml/daily/com.xml',
  'https://ignio.com/r/export/utf/xml/daily/com.xml',
];
const HOROSCOPE_SOURCE = 'ignio.com';
// After a failed download the next try waits, so a dead site doesn't slow every command.
const HOROSCOPE_RETRY = 10 * 60;

const unxml = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

export function parseHoroscope(xml) {
  const out = {};
  for (const [key] of SIGNS) {
    const block = new RegExp(`<${key}>([\\s\\S]*?)</${key}>`).exec(xml);
    const today = block && /<today>([\s\S]*?)<\/today>/.exec(block[1]);
    if (today && unxml(today[1])) out[key] = unxml(today[1]);
  }
  return Object.keys(out).length === SIGNS.length ? out : null;
}

async function horoscopes(ts) {
  const day = members.mskDay(ts);
  const cached = await getSetting('horoscope_cache');
  if (cached && cached.day === day && cached.signs) return cached.signs;
  const failed = await getSetting('horoscope_failed_at');
  if (failed && ts - failed < HOROSCOPE_RETRY) return null;
  const why = [];
  for (const url of HOROSCOPE_URLS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; finya-helper)' } });
      if (!res.ok) {
        why.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      const signs = parseHoroscope(body);
      if (signs) {
        await setSetting('horoscope_cache', { day, signs });
        return signs;
      }
      why.push(`${url}: не тот формат: ${truncate(body.replace(/\s+/g, ' '), 120)}`);
    } catch (err) {
      why.push(`${url}: ${(err && err.message) || err}`);
    }
  }
  // The site is down: say so, no made-up forecast. The owner sees why in the logs.
  await setSetting('horoscope_failed_at', ts);
  await logError('horoscope', new Error(why.join(' | ')));
  return null;
}

export async function horoscopeText(sign, ts = nowInt()) {
  const signs = await horoscopes(ts);
  if (!signs) return `🔮 Гороскоп сейчас не загрузился с ${HOROSCOPE_SOURCE}. Попробуй чуть позже.`;
  const d = new Date((ts + MSK_OFFSET) * 1000);
  return `${sign.emoji} ${sign.name} · гороскоп на ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}\n\n` +
    `<blockquote>${escapeHtml(signs[sign.key])}</blockquote>\n\nИсточник: ${HOROSCOPE_SOURCE}`;
}


// ---- «Финя, до Нового года» ----------------------------------------------------------

const HOLIDAYS = [
  [/^(?:нового года|новый год|нг)$/u, 'Нового года', 1, 1],
  [/^(?:8 марта|восьмого марта)$/u, '8 Марта', 8, 3],
  [/^(?:23 февраля)$/u, '23 Февраля', 23, 2],
  [/^(?:14 февраля|дня (?:всех )?влюбленных|валентина|дня святого валентина)$/u, 'Дня всех влюблённых', 14, 2],
  [/^(?:9 мая|дня победы)$/u, 'Дня Победы', 9, 5],
  [/^(?:хэллоуина|хеллоуина|хэллоуин|хеллоуин)$/u, 'Хэллоуина', 31, 10],
  [/^(?:лета)$/u, 'лета', 1, 6],
  [/^(?:осени)$/u, 'осени', 1, 9],
  [/^(?:зимы)$/u, 'зимы', 1, 12],
  [/^(?:весны)$/u, 'весны', 1, 3],
];

// → { title, at } for «нового года», «8 марта», «31.12», «16.12.2027»; null otherwise.
export function countdownTarget(words, ts = nowInt()) {
  const w = String(words || '').toLowerCase().replace(/ё/g, 'е').replace(/[?!.]+$/u, '').trim();
  const now = new Date((ts + MSK_OFFSET) * 1000);
  const next = (day, month, year = null) => {
    for (const y of year ? [year] : [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
      const at = Date.UTC(y, month - 1, day) / 1000 - MSK_OFFSET;
      if (new Date((at + MSK_OFFSET) * 1000).getUTCDate() !== day) return null;
      if (at > ts) return at;
    }
    return null;
  };
  for (const [re, title, day, month] of HOLIDAYS) {
    if (re.test(w)) {
      const at = next(day, month);
      return at ? { title, at } : null;
    }
  }
  const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/u.exec(w);
  if (m) {
    const at = next(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
    return at ? { title: `${Number(m[1])} ${MONTHS_GEN[Number(m[2]) - 1]}${m[3] ? ` ${m[3]}` : ''}`, at } : null;
  }
  return null;
}

export function countdownText(target, ts = nowInt()) {
  const left = target.at - ts;
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / 3600);
  const parts = [];
  if (days) parts.push(`${days} ${plural(days, 'день', 'дня', 'дней')}`);
  parts.push(`${hours} ${plural(hours, 'час', 'часа', 'часов')}`);
  return `⏳ До ${target.title}: ${parts.join(' ')}`;
}
