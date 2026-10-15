// Premium (custom) emoji in Финя's chat replies. The owner sends Финя any emoji in
// the private chat; she takes each one's whole pack, and every plain emoji of her
// chat replies that the packs have shows as its premium twin. Telegram shows custom
// emoji of a bot only while its owner has Premium; the plain one stays as fallback.
import { api, BotApiError, db } from 'sdk';
import { sql } from 'sdk/db';
import { boldHtml, escapeHtml, nowInt, truncate } from './util.js';

const CACHE_TTL_MS = 60 * 1000;
// A long top or list keeps the rest of its emoji plain.
const MAX_PER_MESSAGE = 80;
const IMPORT_BUDGET_MS = 15000;
const PACKS_SHOWN = 20;

// The emoji of the chat replies, for «эмодзи»: which of them have a premium twin.
export const CHAT_EMOJI = [
  '👤', '🎖️', '⚡', '❤️', '💍', '💔', '💒', '🥂', '🏆', '🥇', '🥈', '🥉', '💬', '📅', '📊', '👥', '🔥',
  '🌾', '💎', '⏳', '🤖', '👋', '🔮', '🤔', '🎱', '✨', '🛡️', '👑', '✅', '❌', '🗑️', '⏸️', '⛔', '🔇', '🔊',
  '👢', '⚠️', '😉', '😅', '😏', '😌', '🙂', '🤗', '🫂', '😘', '😚', '✋', '🥺', '👏', '🎉', '🤝', '🙌',
  '💐', '☕', '🍕', '👉', '👃', '😬', '😼', '👅', '🍑', '👊', '🦶', '🔪', '💥',
];

// The variation selector differs between texts and packs (❤ / ❤️): keys go without it.
export const baseOf = (e) => String(e || '').replace(/️/g, '');

const EMOJI = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}️?)*/gu;
// Names in mentions, code and emoji that are premium already stay as they are.
const KEEP_OPEN = /^<(a|code|pre|tg-emoji)\b/i;
const KEEP_CLOSE = /^<\/(a|code|pre|tg-emoji)>/i;

let cache = null;
let cacheAt = 0;

export function clearCache() {
  cache = null;
}

// base → custom emoji id.
export async function premiumMap() {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  const rows = await db.all(sql`SELECT base, custom_id FROM premium_emoji`);
  cache = new Map(rows.map((r) => [r.base, r.custom_id]));
  cacheAt = Date.now();
  return cache;
}

// HTML text → the same with <tg-emoji> around the emoji the packs have.
export function wrap(html, map) {
  if (!html || !map.size) return html;
  let count = 0;
  let keep = 0;
  return String(html).split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith('<')) {
      if (KEEP_OPEN.test(part)) keep++;
      else if (KEEP_CLOSE.test(part)) keep = Math.max(0, keep - 1);
      return part;
    }
    if (keep) return part;
    return part.replace(EMOJI, (e) => {
      const id = map.get(baseOf(e));
      if (!id || count >= MAX_PER_MESSAGE) return e;
      count++;
      return `<tg-emoji emoji-id="${id}">${e}</tg-emoji>`;
    });
  }).join('');
}

const LEADING = new RegExp(`^(${EMOJI.source})\\s+(.+)$`, 'u');

// «💍 Да» → the premium 💍 as the button icon and «Да» as its text.
function iconButtons(markup, map) {
  if (!markup || !Array.isArray(markup.inline_keyboard) || !map.size) return markup;
  let changed = false;
  const rows = markup.inline_keyboard.map((row) => row.map((b) => {
    const m = !b.icon_custom_emoji_id && LEADING.exec(String(b.text || ''));
    const id = m && map.get(baseOf(m[1]));
    if (!id) return b;
    changed = true;
    return { ...b, text: m[2], icon_custom_emoji_id: id };
  }));
  return changed ? { ...markup, inline_keyboard: rows } : markup;
}

// Sends `params` (HTML text, inline keyboard) with premium emoji. If Telegram refuses
// them, the plain message still goes out.
export async function withPremium(params, send) {
  const map = await premiumMap();
  const text = wrap(params.text, map);
  const markup = iconButtons(params.reply_markup, map);
  if (text === params.text && markup === params.reply_markup) return send(params);
  const fancy = { ...params, text };
  if (markup) fancy.reply_markup = markup;
  try {
    return await send(fancy);
  } catch (err) {
    if (!(err instanceof BotApiError) || err.code !== 400) throw err;
    return send(params);
  }
}

// ---- the owner sends emoji ---------------------------------------------------------

// The custom emoji of a message made of emoji only: «кто я ✨» stays a command.
function customIds(message) {
  const text = String(message.text || '');
  const ids = [];
  let rest = '';
  let at = 0;
  for (const e of message.entities || []) {
    if (e.type !== 'custom_emoji' || !e.custom_emoji_id) continue;
    rest += text.slice(at, e.offset);
    at = e.offset + e.length;
    if (!ids.includes(e.custom_emoji_id)) ids.push(e.custom_emoji_id);
  }
  rest += text.slice(at);
  return /^[\s\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]*$/u.test(rest) ? ids : [];
}

function tuple(values) {
  let frag = sql`${values[0]}`;
  for (let i = 1; i < values.length; i++) frag = sql`${frag}, ${values[i]}`;
  return sql`(${frag})`;
}

// rows: [base, custom_id, set_name, picked, added_at] in one statement.
async function putEmoji(rows, conflict) {
  if (!rows.length) return 0;
  let values = null;
  for (const row of rows) values = values ? sql`${values}, ${tuple(row)}` : tuple(row);
  const head = sql.raw('INSERT INTO premium_emoji (base, custom_id, set_name, picked, added_at) VALUES ');
  const r = await db.run(sql`${head}${values}${sql.raw(` ${conflict}`)}`);
  return r.rowsAffected;
}

// The first one of each plain emoji.
function firstByBase(stickers) {
  const out = new Map();
  for (const s of stickers) {
    const base = baseOf(s.emoji);
    if (base && s.custom_emoji_id && !out.has(base)) out.set(base, s);
  }
  return out;
}

async function coverage() {
  const map = await premiumMap();
  const missing = CHAT_EMOJI.filter((e) => !map.has(baseOf(e)));
  return { have: CHAT_EMOJI.length - missing.length, missing };
}

async function reply(message, text) {
  return withPremium({
    chat_id: message.chat.id, text: boldHtml(text), parse_mode: 'HTML',
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
  }, (p) => api.sendMessage(p));
}

const HINT = '«эмодзи» — что стоит сейчас · «эмодзи сброс» — вернуть обычные.';

function coverageText({ have, missing }) {
  let text = `В ответах в чате премиум: ${have} из ${CHAT_EMOJI.length}.`;
  if (missing.length) text += `\nПока обычные: ${missing.join(' ')}\nКинь их премиум-версии, и они встанут на место.`;
  return text;
}

async function importFrom(message, ids) {
  const deadline = Date.now() + IMPORT_BUDGET_MS;
  const stickers = (await api.getCustomEmojiStickers({ custom_emoji_ids: ids.slice(0, 200) })) || [];
  stickers.sort((a, b) => ids.indexOf(a.custom_emoji_id) - ids.indexOf(b.custom_emoji_id));
  const ts = nowInt();
  // The emoji sent win over anything from the packs, then the packs in that order.
  const picked = [...firstByBase(stickers)].map(([base, s]) => [base, s.custom_emoji_id, s.set_name || null, 1, ts]);
  await putEmoji(picked, `ON CONFLICT(base) DO UPDATE SET custom_id = excluded.custom_id,
    set_name = excluded.set_name, picked = 1, added_at = excluded.added_at`);

  const names = [...new Set(stickers.map((s) => s.set_name).filter(Boolean))];
  const packs = [];
  const left = [];
  for (const name of names) {
    if (Date.now() > deadline) {
      left.push(name);
      continue;
    }
    let set;
    try {
      set = await api.getStickerSet({ name });
    } catch (err) {
      if (!(err instanceof BotApiError)) throw err;
      continue;
    }
    const items = (set.stickers || []).filter((s) => s.custom_emoji_id);
    const rows = [...firstByBase(items)].map(([base, s]) => [base, s.custom_emoji_id, name, 0, ts]);
    await putEmoji(rows, 'ON CONFLICT(base) DO NOTHING');
    const title = truncate(set.title || name, 64);
    await db.run(sql`INSERT INTO emoji_packs (name, title, count, added_at) VALUES (${name}, ${title}, ${items.length}, ${ts})
      ON CONFLICT(name) DO UPDATE SET title = excluded.title, count = excluded.count`);
    packs.push({ title, count: items.length });
  }
  clearCache();

  let text = packs.length ? '✅ Забрала паки:' : '✅ Эмодзи запомнила.';
  for (const p of packs.slice(0, PACKS_SHOWN)) text += `\n• ${escapeHtml(p.title)} — ${p.count} шт.`;
  if (packs.length > PACKS_SHOWN) text += `\n…и ещё ${packs.length - PACKS_SHOWN}`;
  if (left.length) text += `\n\nНе успела ещё ${left.length}: кинь эти эмодзи ещё раз.`;
  text += `\n\n${coverageText(await coverage())}\n\n${HINT}`;
  await reply(message, text);
}

async function showStatus(message) {
  const packs = await db.all(sql`SELECT title, count FROM emoji_packs ORDER BY added_at, name`);
  const map = await premiumMap();
  if (!map.size) {
    await reply(message, '✨ Премиум-эмодзи пока нет.\nКинь мне в личку по одному эмодзи из каждого своего пака ' +
      '(можно всё одним сообщением), и я заберу паки целиком.');
    return;
  }
  const present = CHAT_EMOJI.filter((e) => map.has(baseOf(e)));
  let text = `✨ Эмодзи в чате\nУже премиум: ${present.join(' ') || 'пока ни одного'}\n\n${coverageText(await coverage())}`;
  if (packs.length) text += `\n\nПаков: ${packs.length} · ${packs.slice(0, PACKS_SHOWN).map((p) => escapeHtml(p.title)).join(', ')}`;
  text += `\n\n${HINT}`;
  await reply(message, text);
}

const norm = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s!.?]+$/u, '').replace(/\s+/g, ' ').trim();

// The owner's private messages: emoji to take, «эмодзи», «эмодзи сброс». → handled
export async function handlePrivate(message) {
  const ids = customIds(message);
  if (ids.length) {
    await importFrom(message, ids);
    return true;
  }
  const cmd = norm(message.text);
  if (['эмодзи', 'эмоджи', 'премиум эмодзи'].includes(cmd)) {
    await showStatus(message);
    return true;
  }
  if (['эмодзи сброс', 'эмоджи сброс', 'сбросить эмодзи'].includes(cmd)) {
    await db.run(sql`DELETE FROM premium_emoji`);
    await db.run(sql`DELETE FROM emoji_packs`);
    clearCache();
    await reply(message, '🗑 Премиум-эмодзи убраны, в ответах снова обычные.');
    return true;
  }
  return false;
}
