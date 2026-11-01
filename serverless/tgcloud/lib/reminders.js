// «Финя, напомни через 2ч позвонить», «… в 18:30 …», «… завтра в 7 вечера …», «… в пятницу …».
// Sent from pump(): there is no timer in the runtime, so a reminder goes out with
// the first update after its time (in a lively chat that is seconds).
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { withPremium } from './emoji.js';
import { mention } from './moder.js';
import { boldHtml, escapeHtml, fmtMsk, MSK_OFFSET, nowInt, truncate } from './util.js';

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
export const MAX_AHEAD = 30 * DAY;
export const PER_USER = 10;
export const TEXT_MAX = 200;

export class ReminderError extends Error {}

const UNITS = [
  [/^(?:м|мин|минут[аыу]?)$/u, MIN],
  [/^(?:ч|час|часа|часов)$/u, HOUR],
  [/^(?:д|дн|день|дня|дней|сут|сутки|суток)$/u, DAY],
  [/^(?:нед|неделю|недели|недель)$/u, 7 * DAY],
];

const RELATIVE = { сегодня: 0, завтра: 1, послезавтра: 2 };
// ISO weekdays, Monday 1.
const WEEKDAYS = { понедельник: 1, вторник: 2, среду: 3, четверг: 4, пятницу: 5, субботу: 6, воскресенье: 7 };
// [день] [время] [утра/вечера] [текст]: «завтра в 18 позвонить», «в пятницу в 7 вечера …»,
// «послезавтра …» (в 10:00), «18:30 …», «в 9:15 …». Without a time a day means 10:00.
const WHEN = new RegExp('^(?:(сегодня|завтра|послезавтра)|(?:во?\\s+)?(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))?' +
  '\\s*(?:(?:в\\s+)?(\\d{1,2})[:.](\\d{2})|в\\s+(\\d{1,2})(?:\\s*(?:ч|час|часа|часов))?(?![\\d:.]))?' +
  '(?:\\s+(утра|дня|вечера|ночи))?(?:\\s+([\\s\\S]*))?$', 'iu');

// Moscow midnight of the day `ts` falls on, as a unix time.
const mskMidnight = (ts) => Math.floor((ts + MSK_OFFSET) / DAY) * DAY - MSK_OFFSET;

// The words after «напомни» → { due, text }, or null when it isn't a reminder.
export function parse(words, ts = nowInt()) {
  const t = String(words || '').trim();
  let m = /^через\s+(полчаса|час|(\d{1,3})\s*([а-яё]+))(?:\s+([\s\S]*))?$/iu.exec(t);
  if (m) {
    let seconds;
    if (/^полчаса$/iu.test(m[1])) seconds = 30 * MIN;
    else if (/^час$/iu.test(m[1])) seconds = HOUR;
    else {
      const unit = UNITS.find(([re]) => re.test(m[3].toLowerCase().replace(/ё/g, 'е')));
      if (!unit || !Number(m[2])) return null;
      seconds = Number(m[2]) * unit[1];
    }
    return { due: ts + seconds, text: m[4] || '' };
  }
  m = WHEN.exec(t);
  if (m && (m[1] || m[2] || m[3] || m[5])) {
    const [, rel, weekday, hh, mm, bareHour, part, rest] = m;
    const timed = hh != null || bareHour != null;
    let h = Number(hh ?? bareHour ?? 10);
    const min = Number(mm ?? 0);
    if (part && /^(?:дня|вечера)$/iu.test(part) && h < 12) h += 12;
    if (part && /^(?:утра|ночи)$/iu.test(part) && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    const today = mskMidnight(ts);
    const at = (days) => today + days * DAY + h * HOUR + min * MIN;
    let due;
    if (rel) {
      const days = RELATIVE[rel.toLowerCase()];
      // «сегодня» needs a time: «напомни сегодня» says nothing about when.
      if (days === 0 && !timed) return null;
      due = at(days);
    } else if (weekday) {
      const now = new Date((ts + MSK_OFFSET) * 1000).getUTCDay() || 7;
      let days = (WEEKDAYS[weekday.toLowerCase().replace(/ё/g, 'е')] - now + 7) % 7;
      if (days === 0 && (!timed || at(0) <= ts)) days = 7;
      due = at(days);
    } else {
      due = at(0);
      if (due <= ts) due += DAY;
    }
    return { due, text: rest || '' };
  }
  return null;
}

export async function add(message, user, name, parsed, ts = nowInt()) {
  const text = truncate(String(parsed.text || '').replace(/\s+/g, ' ').trim(), TEXT_MAX);
  if (parsed.due - ts < MIN) throw new ReminderError('Минимум через минуту.');
  if (parsed.due - ts > MAX_AHEAD) throw new ReminderError('Напоминаю не дальше чем на 30 дней вперёд.');
  const have = await db.get(sql`SELECT COUNT(*) AS c FROM reminders WHERE user_id = ${user.id}`);
  if (have.c >= PER_USER) throw new ReminderError(`У тебя уже ${PER_USER} напоминаний. Удали лишнее: «-Напоминание N».`);
  const topic = message.is_topic_message ? message.message_thread_id : null;
  await db.run(sql`INSERT INTO reminders (user_id, name, chat_id, thread_id, message_id, text, due_at, created_at)
    VALUES (${user.id}, ${truncate(name, 60)}, ${message.chat.id}, ${topic}, ${message.message_id}, ${text}, ${parsed.due}, ${ts})`);
  return { due: parsed.due, text };
}

// Soonest first; that order also numbers them for «-напоминание N».
export async function listOf(userId) {
  return db.all(sql`SELECT id, chat_id, text, due_at FROM reminders WHERE user_id = ${userId} ORDER BY due_at, id`);
}

export async function remove(userId, n) {
  const r = (await listOf(userId))[n - 1];
  if (!r) return null;
  await db.run(sql`DELETE FROM reminders WHERE id = ${r.id}`);
  return r;
}

export const whenText = (due) => fmtMsk(due).replace(/^(\d\d\.\d\d)\.\d{4}/, '$1');

// From pump(): due reminders, claimed by deleting them, so none goes out twice.
export async function tick(leftMs, ts = nowInt()) {
  const due = await db.all(sql`SELECT * FROM reminders WHERE due_at <= ${ts} ORDER BY due_at LIMIT 10`);
  for (const r of due) {
    if (leftMs() < 3000) return;
    const claimed = await db.run(sql`DELETE FROM reminders WHERE id = ${r.id}`);
    if (claimed.rowsAffected !== 1) continue;
    const body = r.text ? `\n<blockquote>${escapeHtml(r.text)}</blockquote>` : '';
    const params = {
      chat_id: r.chat_id, text: boldHtml(`⏰ ${mention(r.user_id, r.name)}, напоминаю!${body}`), parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };
    if (r.thread_id) params.message_thread_id = r.thread_id;
    if (r.message_id) params.reply_parameters = { message_id: r.message_id, allow_sending_without_reply: true };
    try {
      await withPremium(params, (p) => api.sendMessage(p));
    } catch {
      // The chat is gone or Финя was removed: nowhere to remind.
    }
  }
}
