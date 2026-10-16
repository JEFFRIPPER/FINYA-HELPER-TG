// Update news for the CHANGELOG topic of SQUAD FAMILY CHAT. Every release of the
// bot or the Mini App adds an entry on top of CHANGES; after the deploy pump() posts
// it there by itself. /log shows the next news to the owner, /log post posts it now.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { getSetting, logError, setSetting } from './store.js';
import { withPremium } from './emoji.js';
import { boldHtml, escapeHtml, nowInt } from './util.js';

// https://t.me/c/2229986493/271940
export const CHANGELOG_CHAT_ID = -1002229986493;
export const CHANGELOG_THREAD_ID = 271940;

// Newest first. `id` never changes once posted.
export const CHANGES = [
  {
    id: '2026-10-16-chat',
    date: '16 октября 2026',
    title: 'Финя теперь живёт в чате',
    items: [
      '💬 Команды словами, как у Ириса. Все команды: «Финя, команды».',
      '👤 «кто я» — профиль: звание, XP, репутация, брак и ачивки.',
      '🌾 «фарм» — случайный XP раз в час, иногда редкий, до 200.',
      '❤️ «+» или «спасибо» ответом — репутация, без лимита.',
      '💍 «брак» ответом — предложение. Пара видна в профиле Mini App.',
      '🤗 РП ответом: обнять, поцеловать, ударить… Весь список: «рп».',
      '📊 «стата» — актив чата с кнопками День / Неделя / Месяц / Всё время.',
      '🔮 «Финя, инфа…», «Финя, кто…», «Финя, выбери А или Б».',
      '🛡 Новичков встречает кнопка «Я не бот», за флуд — мут.',
      '✨ В ответах Фини теперь премиум-эмодзи.',
    ],
  },
];

export function newsText(entry) {
  return boldHtml(`🆕 Обновление Фини · ${escapeHtml(entry.date)}\n\n${escapeHtml(entry.title)}\n\n` +
    entry.items.map((s) => escapeHtml(s)).join('\n') +
    '\n\nБаг или идея? Бот → «Ещё» → «Обратная связь».');
}

// After a failed post (no rights, Финя not in the chat) the next try waits a while.
const FAIL_GAP = 30 * 60;

// Entries not in the topic yet, oldest first. When nothing was ever posted, only the
// newest one goes: the history stays out of the topic.
async function pending() {
  const posted = await getSetting('changelog_posted');
  const i = CHANGES.findIndex((e) => e.id === posted);
  return { posted, list: (i === -1 ? CHANGES.slice(0, 1) : CHANGES.slice(0, i)).reverse() };
}

// One statement: two pumps at once post an entry once.
async function setPosted(from, to) {
  await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES ('changelog_posted', 'null')`);
  const r = await db.run(sql`UPDATE settings SET value = ${JSON.stringify(to ?? null)}
    WHERE key = 'changelog_posted' AND value = ${JSON.stringify(from ?? null)}`);
  return r.rowsAffected === 1;
}

async function warnOwner(entry, err) {
  if ((await getSetting('changelog_warned')) === entry.id) return;
  await setSetting('changelog_warned', entry.id);
  const why = escapeHtml(String((err && err.description) || (err && err.message) || err));
  try {
    await api.sendMessage({
      chat_id: OWNER_USER_ID, parse_mode: 'HTML',
      text: boldHtml(`📰 Не смогла опубликовать новость в CHANGELOG: ${why}\n\n` +
        'Проверь, что Финя есть в SQUAD FAMILY CHAT и может писать в топик. Попробую ещё раз сама, или напиши /log post.'),
    });
  } catch {
    // The owner's chat is closed: the error log has it.
  }
}

// Posts the oldest entry not in the topic yet. → 'posted' | 'none' | 'wait' | 'failed'
export async function postNext({ manual = false } = {}) {
  const { posted, list } = await pending();
  if (!list.length) return 'none';
  if (!manual) {
    const failedAt = await getSetting('changelog_failed_at');
    if (failedAt && nowInt() - failedAt < FAIL_GAP) return 'wait';
  }
  const entry = list[0];
  if (!(await setPosted(posted, entry.id))) return 'wait';
  try {
    await withPremium({
      chat_id: CHANGELOG_CHAT_ID, message_thread_id: CHANGELOG_THREAD_ID, text: newsText(entry), parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }, (p) => api.sendMessage(p));
  } catch (err) {
    await setPosted(entry.id, posted);
    await setSetting('changelog_failed_at', nowInt());
    await logError('changelog.post', err);
    await warnOwner(entry, err);
    return 'failed';
  }
  await setSetting('changelog_failed_at', null);
  return 'posted';
}

// From pump(): a fresh deploy's news goes out by itself.
export async function tick() {
  await postNext();
}

const reply = (message, text) => withPremium({
  chat_id: message.chat.id, text: boldHtml(text), parse_mode: 'HTML',
  reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
}, (p) => api.sendMessage(p));

// In the private chat by the owner; in the CHANGELOG chat also by its anonymous admins.
export function allowed(message, owner) {
  if (owner) return true;
  return Boolean(message.sender_chat) && message.sender_chat.id === CHANGELOG_CHAT_ID &&
    message.chat.id === CHANGELOG_CHAT_ID;
}

// /log — the next news; /log post — post it now instead of waiting for pump().
export async function command(message, args, owner) {
  if (!allowed(message, owner)) return;
  const group = message.chat.type !== 'private';
  if (group) {
    try {
      await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id });
    } catch {
      // No rights to delete: the command stays.
    }
  }
  if ((args[0] || '').toLowerCase() !== 'post') {
    if (group) return;
    const { list } = await pending();
    const entry = list[0] || CHANGES[0];
    const state = list.length ? 'Ещё не в топике: выйдет сама после выката, или сразу — /log post.' : 'Уже в топике.';
    await reply(message, `📰 Новость для CHANGELOG\n${state}`);
    await withPremium({ chat_id: message.chat.id, text: newsText(entry), parse_mode: 'HTML' }, (p) => api.sendMessage(p));
    return;
  }
  const result = await postNext({ manual: true });
  if (group) return;
  if (result === 'posted') await reply(message, '✅ Новость опубликована в CHANGELOG.');
  else if (result === 'none') await reply(message, 'Это обновление уже в топике. Новая запись появится со следующим обновлением.');
  else if (result === 'failed') await reply(message, '❌ Не вышло опубликовать: проверь, что Финя в чате и может писать в топик CHANGELOG.');
}
