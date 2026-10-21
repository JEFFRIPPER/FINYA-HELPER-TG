// Moderation by text in the Squad chats (мут, бан, кик, варн), the flood guard
// and the «Я не бот» check for newcomers.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { getSetting, logError } from './store.js';
import { answer, button, getMe, isApiError, isRetryAfter, keyboard } from './tg.js';
import { boldHtml, escapeHtml, nowInt, truncate } from './util.js';
import * as club from './club.js';
import { withPremium } from './emoji.js';

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

export const DEFAULT_MUTE = HOUR;
export const MAX_MUTE = 365 * DAY;
export const WARN_LIMIT = 3;
export const WARN_MUTE = DAY;
export const WARN_KEEP = 30 * DAY;
export const FLOOD_WINDOW = 10;
export const FLOOD_LIMIT = 8;
export const FLOOD_MUTE = 10 * MIN;
export const CAPTCHA_TTL = 5 * MIN;

const MUTED = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false,
};
// «Pass True for all permissions to lift restrictions from a user» (Bot API).
const FREE = {
  ...Object.fromEntries(Object.keys(MUTED).map((k) => [k, true])),
  can_change_info: true, can_invite_users: true, can_pin_messages: true, can_manage_topics: true,
};

export class ModError extends Error {}

export const NO_RIGHTS = 'Мне не хватает прав. Назначь Финю админом с правом блокировать участников.';

export const mention = (id, name) => `<a href="tg://user?id=${id}">${escapeHtml(truncate(name, 40))}</a>`;

// ---- who may moderate ------------------------------------------------------------

export async function memberOf(chatId, userId) {
  try {
    return await api.getChatMember({ chat_id: chatId, user_id: userId });
  } catch {
    return null;
  }
}

// The owner, the chat's creator and admins who may restrict members.
export async function canModerate(chatId, userId) {
  if (userId === OWNER_USER_ID) return true;
  const m = await memberOf(chatId, userId);
  return Boolean(m) && (m.status === 'creator' || (m.status === 'administrator' && m.can_restrict_members !== false));
}

// Admins, the owner and Финя herself cannot be muted or banned from the chat.
async function shielded(chatId, userId) {
  if (userId === OWNER_USER_ID) return 'Основателя Сквада трогать нельзя 😏';
  const me = await getMe();
  if (userId === me.id) return 'Себя я наказывать не буду 😌';
  const m = await memberOf(chatId, userId);
  if (m && (m.status === 'creator' || m.status === 'administrator')) return 'Админов так не наказать.';
  return null;
}

// ---- durations ------------------------------------------------------------------

const UNITS = [
  [/^(с|сек|секунд[аыу]?)$/, 1],
  [/^(м|мин|минут[аыу]?)$/, MIN],
  [/^(ч|час|часа|часов)$/, HOUR],
  [/^(д|дн|день|дня|дней|сут|сутки|суток)$/, DAY],
  [/^(н|нед|неделя|неделю|недели|недель)$/, 7 * DAY],
  [/^(мес|месяц|месяца|месяцев)$/, 30 * DAY],
  [/^(г|год|года|лет)$/, 365 * DAY],
];

// «30м», «1 ч», «2 недели», «15» (minutes) → seconds; '' → null (the default);
// anything else → undefined: «мут тебе» is talk, not a command.
export function parseDuration(text) {
  const t = String(text || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!t) return null;
  const m = /^(\d{1,4})\s*([а-яa-z]*)\.?$/.exec(t);
  if (!m || !Number(m[1])) return undefined;
  let unit = MIN;
  if (m[2]) {
    const found = UNITS.find(([re]) => re.test(m[2]));
    if (!found) return undefined;
    unit = found[1];
  }
  return Math.min(MAX_MUTE, Math.max(MIN, Number(m[1]) * unit));
}

// The text after «мут/бан/…», Iris style: the first line holds only the time (for «мут»)
// and @mentions; the reason goes on the next line. → { seconds, reason }, or null when
// the first line has anything else («бан бы тебе за такое» is a joke, not a ban).
export function parseCommandArgs(verb, args) {
  const [first, ...lines] = String(args || '').split('\n');
  const head = first.replace(/@\w{3,32}/g, ' ').trim();
  const reason = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (verb === 'мут') {
    const seconds = parseDuration(head);
    return seconds === undefined ? null : { seconds, reason };
  }
  return head ? null : { seconds: null, reason };
}

export function fmtDuration(seconds) {
  if (seconds >= DAY && seconds % DAY === 0) return `${seconds / DAY} дн.`;
  if (seconds >= HOUR && seconds % HOUR === 0) return `${seconds / HOUR} ч`;
  if (seconds >= HOUR) return `${Math.floor(seconds / HOUR)} ч ${Math.round((seconds % HOUR) / MIN)} мин`;
  return `${Math.max(1, Math.round(seconds / MIN))} мин`;
}

// ---- actions ---------------------------------------------------------------------

async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    if (isApiError(err) && !isRetryAfter(err)) throw new ModError(NO_RIGHTS);
    throw err;
  }
}

// seconds = null: until lifted.
export async function mute(chatId, userId, seconds) {
  const params = { chat_id: chatId, user_id: userId, permissions: MUTED, use_independent_chat_permissions: true };
  if (seconds != null) params.until_date = nowInt() + seconds;
  await call(() => api.restrictChatMember(params));
}

export async function unmute(chatId, userId) {
  await call(() => api.restrictChatMember({ chat_id: chatId, user_id: userId, permissions: FREE }));
}

export async function ban(chatId, userId) {
  await call(() => api.banChatMember({ chat_id: chatId, user_id: userId }));
}

export async function unban(chatId, userId) {
  await call(() => api.unbanChatMember({ chat_id: chatId, user_id: userId, only_if_banned: true }));
}

// A kick is a ban lifted right away: the member may come back by link.
export async function kick(chatId, userId) {
  await ban(chatId, userId);
  await unban(chatId, userId);
}

const unmuteKeyboard = (userId) => keyboard([[button('🔊 Снять мут', { callback_data: `mod:unmute:${userId}` })]]);

// «мут 1ч», «бан», «варн»… as a reply, the reason on the next line. `parsed` comes from
// parseCommandArgs. → { text, markup } for the chat.
export async function act(chatId, actor, target, verb, parsed) {
  if (!(await canModerate(chatId, actor.id))) throw new ModError('Это могут только админы чата.');
  const guard = ['мут', 'бан', 'кик', 'варн'].includes(verb) ? await shielded(chatId, target.id) : null;
  if (guard) throw new ModError(guard);
  const who = mention(target.id, target.name);
  const by = mention(actor.id, actor.name);
  const reasonLine = (r) => (r ? `\nПричина: ${escapeHtml(truncate(r, 200))}` : '');
  const args = parsed.reason;
  if (verb === 'мут') {
    const time = parsed.seconds || DEFAULT_MUTE;
    await mute(chatId, target.id, time);
    return { text: `🔇 ${who} получает мут на ${fmtDuration(time)}.${reasonLine(args)}\nВыдал админ: ${by}`, markup: unmuteKeyboard(target.id) };
  }
  if (verb === 'размут') {
    await unmute(chatId, target.id);
    await dropCaptcha(chatId, target.id);
    return { text: `🔊 ${who} снова может писать.` };
  }
  if (verb === 'бан') {
    await ban(chatId, target.id);
    await dropCaptcha(chatId, target.id);
    return { text: `⛔ ${who} получает бан.${reasonLine(args)}\nВыдал админ: ${by}` };
  }
  if (verb === 'разбан') {
    await unban(chatId, target.id);
    return { text: `✅ Бан снят: ${who} может вернуться в чат.` };
  }
  if (verb === 'кик') {
    await kick(chatId, target.id);
    await dropCaptcha(chatId, target.id);
    return { text: `👢 ${who} вылетает из чата.${reasonLine(args)}` };
  }
  if (verb === 'варн') return warn(chatId, actor, target, args);
  if (verb === 'снять варн') {
    const r = await db.run(sql`DELETE FROM warns WHERE id = (SELECT id FROM warns
      WHERE chat_id = ${chatId} AND user_id = ${target.id} ORDER BY id DESC LIMIT 1)`);
    if (!r.rowsAffected) return { text: `У ${who} нет варнов.` };
    return { text: `✅ Снят один варн с ${who}. Осталось: ${await warnCount(chatId, target.id)}/${WARN_LIMIT}.` };
  }
  throw new ModError('Не знаю такой команды.');
}

export async function warnCount(chatId, userId) {
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM warns WHERE chat_id = ${chatId} AND user_id = ${userId}
    AND at >= ${nowInt() - WARN_KEEP}`);
  return row.c;
}

async function warn(chatId, actor, target, reason) {
  const ts = nowInt();
  await db.run(sql`INSERT INTO warns (chat_id, user_id, by_id, reason, at)
    VALUES (${chatId}, ${target.id}, ${actor.id}, ${truncate(reason || '', 200)}, ${ts})`);
  const n = await warnCount(chatId, target.id);
  const who = mention(target.id, target.name);
  const reasonLine = reason ? `\nПричина: ${escapeHtml(truncate(reason, 200))}` : '';
  if (n < WARN_LIMIT) return { text: `⚠️ ${who} получает варн (${n}/${WARN_LIMIT}).${reasonLine}` };
  await mute(chatId, target.id, WARN_MUTE);
  await db.run(sql`DELETE FROM warns WHERE chat_id = ${chatId} AND user_id = ${target.id}`);
  return {
    text: `🔇 ${who} собирает ${WARN_LIMIT} варна и получает мут на ${fmtDuration(WARN_MUTE)}.${reasonLine}`,
    markup: unmuteKeyboard(target.id),
  };
}

export async function warnsText(chatId, target) {
  const rows = await db.all(sql`SELECT reason, at FROM warns WHERE chat_id = ${chatId} AND user_id = ${target.id}
    AND at >= ${nowInt() - WARN_KEEP} ORDER BY id DESC LIMIT ${WARN_LIMIT}`);
  const who = mention(target.id, target.name);
  if (!rows.length) return `✅ У ${who} нет варнов.`;
  const list = rows.map((r, i) => `${i + 1}. ${r.reason ? escapeHtml(r.reason) : 'без причины'}`).join('\n');
  return `⚠️ Варны ${who}: ${rows.length}/${WARN_LIMIT}\n${list}\n\nВарн сгорает через 30 дней.`;
}

// ---- flood -----------------------------------------------------------------------

// FLOOD_LIMIT messages within FLOOD_WINDOW seconds → a short mute. Counted by the
// message date, so a backlog delivered at once after a pause is not a flood.
export async function checkFlood(message) {
  const u = message.from;
  if (!u || u.is_bot || message.sender_chat || u.id === OWNER_USER_ID) return null;
  // An album arrives as one message per photo: that is not a flood.
  // Forwarding several messages at once is one action too.
  if (message.media_group_id || message.forward_origin || message.new_chat_members || message.left_chat_member) return null;
  if (!(await getSetting('chat_antiflood'))) return null;
  const chatId = message.chat.id;
  const ts = Math.floor(message.date || nowInt());
  const r = await db.run(sql`INSERT INTO flood (chat_id, user_id, window_start, count) VALUES (${chatId}, ${u.id}, ${ts}, 1)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      count = CASE WHEN window_start <= ${ts - FLOOD_WINDOW} THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN window_start <= ${ts - FLOOD_WINDOW} THEN ${ts} ELSE window_start END
    RETURNING count`);
  if (r.rows[0].count !== FLOOD_LIMIT) return null;
  if (await shielded(chatId, u.id)) return null;
  try {
    await mute(chatId, u.id, FLOOD_MUTE);
  } catch (err) {
    if (!(err instanceof ModError)) throw err;
    return null; // No rights here: the guard stays quiet.
  }
  return withPremium({
    chat_id: chatId, parse_mode: 'HTML',
    text: boldHtml(`🔇 ${mention(u.id, [u.first_name, u.last_name].filter(Boolean).join(' '))} получает мут на ${fmtDuration(FLOOD_MUTE)} за флуд.`),
    reply_markup: unmuteKeyboard(u.id),
  }, (p) => api.sendMessage(p));
}

// ---- «Я не бот» --------------------------------------------------------------------

const userName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Новичок';

// A newcomer can't write until they press the button; nobody presses → kicked.
// → true while the newcomer has a check to pass (the welcome waits for it).
// `replyTo`: the join service message, so the button shows up where they joined.
export async function onJoin(chat, user, replyTo = null) {
  if (!user || user.is_bot || user.id === OWNER_USER_ID) return false;
  if (!(await getSetting('chat_captcha'))) return false;
  const existing = await db.get(sql`SELECT status FROM captcha WHERE chat_id = ${chat.id} AND user_id = ${user.id}`);
  // The join arrives twice (service message and chat_member): one check for both.
  if (existing) return existing.status === 'pending';
  // Someone muted before (a mute, warns, flood) who comes back stays muted: the
  // button would lift that mute.
  const m = await memberOf(chat.id, user.id);
  if (m && m.status === 'restricted' && m.can_send_messages === false) return false;
  const r = await db.run(sql`INSERT OR IGNORE INTO captcha (chat_id, user_id, message_id, status, created_at)
    VALUES (${chat.id}, ${user.id}, NULL, 'pending', ${nowInt()})`);
  if (r.rowsAffected !== 1) return true;
  try {
    await mute(chat.id, user.id, null);
  } catch (err) {
    await db.run(sql`DELETE FROM captcha WHERE chat_id = ${chat.id} AND user_id = ${user.id}`);
    if (!(err instanceof ModError)) throw err;
    return false; // No rights: no check rather than a newcomer stuck forever.
  }
  const params = {
    chat_id: chat.id, parse_mode: 'HTML',
    text: boldHtml(`🛡 ${mention(user.id, userName(user))}, привет! Нажми кнопку ниже за ${fmtDuration(CAPTCHA_TTL)}, ` +
      'чтобы писать в чат. Иначе Финя решит, что ты бот.'),
    reply_markup: keyboard([[button('✅ Я не бот', { callback_data: `cap:${user.id}` })]]),
  };
  if (replyTo) params.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
  const sent = await withPremium(params, (p) => api.sendMessage(p));
  await db.run(sql`UPDATE captcha SET message_id = ${sent && sent.message_id ? sent.message_id : null}
    WHERE chat_id = ${chat.id} AND user_id = ${user.id}`);
  return true;
}

// An admin let the newcomer in, banned or kicked them: the check is over.
async function dropCaptcha(chatId, userId) {
  const r = await db.run(sql`DELETE FROM captcha WHERE chat_id = ${chatId} AND user_id = ${userId}
    AND status = 'pending' RETURNING message_id`);
  if (r.rowsAffected) await dropMessage(chatId, r.rows[0].message_id);
}

// Leaving clears the check, so coming back asks again. Whoever leaves before pressing
// gets the check's mute lifted (a ban stays): otherwise they would come back muted for good.
export async function onLeave(chatId, userId, { banned = false } = {}) {
  const r = await db.run(sql`DELETE FROM captcha WHERE chat_id = ${chatId} AND user_id = ${userId} RETURNING status, message_id`);
  const row = r.rows && r.rows[0];
  if (!row || row.status !== 'pending') return;
  await dropMessage(chatId, row.message_id);
  if (banned) return;
  // The service message may come before the ban's chat_member update: ask Telegram.
  const m = await memberOf(chatId, userId);
  if (!m || m.status !== 'restricted') return;
  try {
    await unmute(chatId, userId);
  } catch {
    // No rights any more: nothing to undo then.
  }
}

async function dropMessage(chatId, messageId) {
  if (!messageId) return;
  try {
    await api.deleteMessage({ chat_id: chatId, message_id: messageId });
  } catch {
    // Already gone.
  }
}

export async function captchaButton(query, userId) {
  const chatId = query.message.chat.id;
  if (query.from.id !== userId) {
    await answer(query, 'Эта кнопка для новичка 🙂', true);
    return;
  }
  const row = await db.get(sql`SELECT message_id FROM captcha WHERE chat_id = ${chatId} AND user_id = ${userId} AND status = 'pending'`);
  if (!row) {
    await answer(query, 'Проверка уже не нужна.');
    return;
  }
  try {
    await unmute(chatId, userId);
  } catch (err) {
    if (!(err instanceof ModError)) throw err;
    await answer(query, 'Не получилось снять ограничение: напиши админу чата.', true);
    return;
  }
  await db.run(sql`UPDATE captcha SET status = 'passed', created_at = ${nowInt()}
    WHERE chat_id = ${chatId} AND user_id = ${userId}`);
  await answer(query, 'Добро пожаловать в Сквад! 🔥');
  await dropMessage(chatId, row.message_id || query.message.message_id);
  // The greeting waited for the check.
  await club.welcome({ chat: query.message.chat, new_chat_members: [query.from] });
}

// From pump(): kick whoever did not press in time; old passed rows go away.
export async function tick(deadlineLeftMs) {
  const ts = nowInt();
  await db.run(sql`DELETE FROM captcha WHERE status = 'passed' AND created_at < ${ts - DAY}`);
  const due = await db.all(sql`SELECT chat_id, user_id, message_id FROM captcha
    WHERE status = 'pending' AND created_at <= ${ts - CAPTCHA_TTL} ORDER BY created_at LIMIT 5`);
  for (const r of due) {
    if (deadlineLeftMs() < 3000) break;
    const claimed = await db.run(sql`DELETE FROM captcha WHERE chat_id = ${r.chat_id} AND user_id = ${r.user_id}
      AND status = 'pending' RETURNING user_id`);
    if (claimed.rowsAffected !== 1) continue;
    await dropMessage(r.chat_id, r.message_id);
    // Only someone still sitting muted by the check goes: a ban or an admin's unmute stays.
    const m = await memberOf(r.chat_id, r.user_id);
    if (!m || m.status !== 'restricted' || m.is_member === false) continue;
    try {
      await kick(r.chat_id, r.user_id);
    } catch (err) {
      await logError('captcha.kick', err);
    }
  }
}

// «🔊 Снять мут» under a mute message: admins only.
export async function unmuteButton(query, userId) {
  const chatId = query.message.chat.id;
  if (!(await canModerate(chatId, query.from.id))) {
    await answer(query, 'Снять мут могут только админы чата.', true);
    return;
  }
  try {
    await unmute(chatId, userId);
  } catch (err) {
    if (!(err instanceof ModError)) throw err;
    await answer(query, err.message, true);
    return;
  }
  await dropCaptcha(chatId, userId);
  await answer(query, 'Мут снят');
  try {
    await api.editMessageReplyMarkup({ chat_id: chatId, message_id: query.message.message_id, reply_markup: keyboard([]) });
  } catch {
    // Too old or unchanged.
  }
  await withPremium({
    chat_id: chatId, parse_mode: 'HTML',
    text: boldHtml(`🔊 Мут снят админом ${mention(query.from.id, userName(query.from))}.`),
    reply_parameters: { message_id: query.message.message_id, allow_sending_without_reply: true },
  }, (p) => api.sendMessage(p));
}
