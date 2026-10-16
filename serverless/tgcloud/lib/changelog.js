// Update news for the CHANGELOG topic of SQUAD FAMILY CHAT. Every release of the
// bot or the Mini App adds an entry on top of CHANGES; the owner checks it with /log
// and posts it with /log post.
import { api } from 'sdk';
import { getSetting, logError, setSetting } from './store.js';
import { withPremium } from './emoji.js';
import { boldHtml, escapeHtml } from './util.js';

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

// /log — what the next post will look like; /log post — post it.
export async function command(message, args, owner) {
  if (!allowed(message, owner)) return;
  const entry = CHANGES[0];
  const posted = await getSetting('changelog_posted');
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
    const state = posted === entry.id ? 'Уже в топике.' : 'Ещё не опубликовано: /log post.';
    await reply(message, `📰 Следующая новость для CHANGELOG\n${state}`);
    await withPremium({ chat_id: message.chat.id, text: newsText(entry), parse_mode: 'HTML' }, (p) => api.sendMessage(p));
    return;
  }
  if (posted === entry.id) {
    if (!group) await reply(message, 'Это обновление уже в топике. Новая запись появится со следующим обновлением.');
    return;
  }
  // Marked first: two quick /log post must not post twice.
  await setSetting('changelog_posted', entry.id);
  try {
    await withPremium({
      chat_id: CHANGELOG_CHAT_ID, message_thread_id: CHANGELOG_THREAD_ID, text: newsText(entry), parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }, (p) => api.sendMessage(p));
  } catch (err) {
    await setSetting('changelog_posted', posted ?? null);
    await logError('changelog.post', err);
    if (!group) await reply(message, '❌ Не вышло опубликовать: проверь, что Финя в чате и может писать в топик CHANGELOG.');
    return;
  }
  if (!group) await reply(message, '✅ Новость опубликована в CHANGELOG.');
}
