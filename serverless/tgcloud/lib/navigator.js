// «Навигатор Сквада»: one pinned message per chat with buttons to the channel, the
// Squad chats, the shop and the projects. The owner places it once with «Финя,
// Навигатор»; after that Финя edits the same message in place: on a new channel post,
// once a day and after a release that changed the links. A deleted navigator is sent
// and pinned again; one that was unpinned is pinned again when nothing else is.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { SQUAD_CHANNEL_URL, SQUAD_GITHUB, SQUAD_LINKS as L, SQUAD_PROJECTS } from './config.js';
import { getSetting, logError, setSetting } from './store.js';
import { button, errorText, isApiError, isNotModified, keyboard, menuButton } from './tg.js';
import { profileRow } from './ui.js';
import { boldHtml, nowInt, truncate } from './util.js';
import { mskDay } from './members.js';
import { squadChatIds } from './xpchat.js';

const KEY = 'navigator:';
const MAX_CHATS = 6;

// Changes when a release changes what the navigator shows.
const VERSION = JSON.stringify([SQUAD_CHANNEL_URL, L, SQUAD_PROJECTS, SQUAD_GITHUB, 2]);

const placedRows = () => db.all(sql`SELECT key FROM settings WHERE key LIKE ${`${KEY}%`}`);

export async function placed() {
  const out = [];
  for (const r of await placedRows()) {
    const state = await getSetting(r.key);
    if (state && state.message_id) out.push({ chatId: Number(r.key.slice(KEY.length)), ...state });
  }
  return out;
}

// [{ title, url }] of the public Squad chats. Invite links never go out: entry to the
// closed chats (SQUAD FAMILY) is only after the form, the owner gives the link himself.
async function chatLinks() {
  const out = [];
  for (const id of (await squadChatIds()).slice(0, MAX_CHATS)) {
    try {
      const c = await api.getChat({ chat_id: id });
      if (c.username) out.push({ title: c.title || 'Чат Сквада', url: `https://t.me/${c.username}` });
    } catch {
      // Финя is not in that chat any more.
    }
  }
  return out;
}

export async function view(chat, links) {
  const post = await getSetting('last_channel_post_id');
  const projects = SQUAD_PROJECTS.map((p) => `<a href="${SQUAD_GITHUB}${p}">${p}</a>`).join(' · ');
  const text = '<b>𒈒 Навигатор Сквада 𒈒</b>\n\n' +
    'Канал, чаты, магазин и проекты Сквада в одном месте 👇\n\n' +
    (post ? `📢 Последний пост: <a href="${SQUAD_CHANNEL_URL}/${post}">открыть и обсудить</a>\n` : '') +
    `🧩 Проекты: ${projects}\n\n` +
    '🔒 Закрытые чаты Сквада: только после анкеты, ссылку выдаёт владелец.';
  const rows = [[menuButton('📢 Канал', { url: SQUAD_CHANNEL_URL }), menuButton('📁 Папка Сквада', { url: L.folder })]];
  const chats = links.map((c) => menuButton(`💬 ${truncate(c.title, 28)}`, { url: c.url }));
  for (let i = 0; i < chats.length; i += 2) rows.push(chats.slice(i, i + 2));
  rows.push([menuButton('🎁 Магазин', { url: L.shop }), menuButton('📜 Правила', { url: L.rules })]);
  rows.push(await profileRow(chat, '👤 Профиль Фини'));
  rows.push([button('TikTok', { url: L.tiktok }), button('Discord', { url: L.discord }), button('Twitch', { url: L.twitch })]);
  return { text, reply_markup: keyboard(rows) };
}

const params = (v) => ({ text: boldHtml(v.text), parse_mode: 'HTML', reply_markup: v.reply_markup, link_preview_options: { is_disabled: true } });
const hashOf = (v) => JSON.stringify(v);
const isGone = (err) => isApiError(err) && /message to edit not found|message can't be edited|message_id_invalid/.test(errorText(err));

async function sendAndPin(chatId, v) {
  const sent = await api.sendMessage({ chat_id: chatId, ...params(v), disable_notification: true });
  let pinned = true;
  try {
    await api.pinChatMessage({ chat_id: chatId, message_id: sent.message_id, disable_notification: true });
  } catch {
    pinned = false;
  }
  await setSetting(`${KEY}${chatId}`, { message_id: sent.message_id, hash: hashOf(v) });
  return { messageId: sent.message_id, pinned };
}

// «Финя, Навигатор» in a chat: a fresh navigator, the old one goes away.
export async function place(chat) {
  const old = await getSetting(`${KEY}${chat.id}`);
  if (old && old.message_id) {
    try {
      await api.deleteMessage({ chat_id: chat.id, message_id: old.message_id });
    } catch {
      // Already gone.
    }
  }
  return sendAndPin(chat.id, await view(chat, await chatLinks()));
}

export async function remove(chatId) {
  const old = await getSetting(`${KEY}${chatId}`);
  await db.run(sql`DELETE FROM settings WHERE key = ${`${KEY}${chatId}`}`);
  if (!old || !old.message_id) return false;
  try {
    await api.unpinChatMessage({ chat_id: chatId, message_id: old.message_id });
  } catch {
    // Not pinned or no rights.
  }
  try {
    await api.deleteMessage({ chat_id: chatId, message_id: old.message_id });
  } catch {
    // Already gone.
  }
  return true;
}

// Edits every navigator whose content changed; `checkPin` re-pins where nothing is pinned.
export async function refreshAll({ checkPin = false } = {}) {
  const all = await placed();
  if (!all.length) return 0;
  const links = await chatLinks();
  let edited = 0;
  for (const n of all) {
    const v = await view({ id: n.chatId, type: 'supergroup' }, links);
    try {
      if (hashOf(v) !== n.hash) {
        try {
          await api.editMessageText({ chat_id: n.chatId, message_id: n.message_id, ...params(v) });
        } catch (err) {
          if (!isNotModified(err)) throw err;
        }
        await setSetting(`${KEY}${n.chatId}`, { message_id: n.message_id, hash: hashOf(v) });
        edited++;
      }
      if (checkPin) {
        const c = await api.getChat({ chat_id: n.chatId });
        if (!c.pinned_message) await api.pinChatMessage({ chat_id: n.chatId, message_id: n.message_id, disable_notification: true });
      }
    } catch (err) {
      if (isGone(err)) {
        await sendAndPin(n.chatId, v);
        edited++;
      } else {
        await logError('navigator.refresh', err);
      }
    }
  }
  return edited;
}

// From pump(): cheap unless the day, the latest channel post or the release changed.
export async function tick(ts = nowInt()) {
  if (!(await placedRows()).length) return;
  const stamp = { day: mskDay(ts), post: await getSetting('last_channel_post_id'), version: VERSION };
  const prev = await getSetting('navigator_stamp');
  if (prev && prev.day === stamp.day && prev.post === stamp.post && prev.version === stamp.version) return;
  await setSetting('navigator_stamp', stamp);
  await refreshAll({ checkPin: !prev || prev.day !== stamp.day });
}
