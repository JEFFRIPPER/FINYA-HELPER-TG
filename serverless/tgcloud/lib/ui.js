// Keyboards and texts (port of the view helpers in bot_core.py).
import { api } from 'sdk';
import {
  ADMIN_BUTTON_ICONS, BOT_VERSION, OWNER_USER_ID, PARTNERS, SQUAD_CHANNEL_URL,
  SQUAD_CHANNEL_USERNAME, SQUAD_ICON_ID, SQUAD_LINKS as L, WEBAPP_URL,
} from './config.js';
import { button, getMe, keyboard, menuButton } from './tg.js';
import { getSetting, isSubscribed } from './store.js';
import { escapeHtml, fmtThousands, fullName, truncate } from './util.js';
import * as xp from './xp.js';

export function partnerKeyboard(partner) {
  return keyboard([
    [menuButton('✨ TikTok', { url: partner.tiktok }), menuButton('💠 ТГК', { url: partner.telegram })],
    [menuButton('⬅️ Партнёры', { callback_data: 'info' })],
  ]);
}

// Telegram allows web_app buttons only in private chats.
export function profileAppButton(text = '👤 Профиль Фини') {
  return menuButton(text, { web_app: { url: WEBAPP_URL } });
}

const isPrivate = (chat) => !chat || chat.type === 'private';

// Private chats open the Mini App directly; groups link to the bot's private chat.
export async function profileRow(chat, text = '👤 Открыть профиль') {
  if (isPrivate(chat)) return [profileAppButton(text)];
  const me = await getMe();
  return [menuButton(text, { url: `https://t.me/${me.username}?start=profile` })];
}

// Three buttons: everything personal lives in the Mini App, the rest under «Ещё».
export async function homeKeyboard(chat = null) {
  return keyboard([
    await profileRow(chat, '👤 Профиль Фини'),
    [button('Сквад', { callback_data: 'squad', icon_custom_emoji_id: SQUAD_ICON_ID }),
      menuButton('ℹ️ Ещё', { callback_data: 'more' })],
  ]);
}

export function moreKeyboard() {
  return keyboard([
    [menuButton('📢 Новости', { callback_data: 'news' }), menuButton('🟢 Рассылка', { callback_data: 'status' })],
    [menuButton('💬 Обратная связь', { callback_data: 'feedback' }), menuButton('🤝 Партнёры', { callback_data: 'info' })],
    [menuButton('👤 ЛС владельца', { url: L.owner })],
    [menuButton('⬅️ Главное меню', { callback_data: 'home' })],
  ]);
}

export function profileAppKeyboard() {
  return keyboard([[profileAppButton()], [menuButton('⬅️ Главное меню', { callback_data: 'home' })]]);
}

export function backMoreKeyboard() {
  return keyboard([[menuButton('⬅️ Назад', { callback_data: 'more' })]]);
}

export function backHomeKeyboard() {
  return keyboard([[menuButton('⬅️ Главное меню', { callback_data: 'home' })]]);
}

export async function statusText(userId = null) {
  let personal = '';
  if (userId != null) {
    personal = `🔔 Рассылка ТГК: ${(await isSubscribed(userId)) ? 'ВКЛ' : 'ВЫКЛ'}\n`;
  }
  return '<b>🟢 Статус FINYA HELPER</b>\n\n' +
    '✅ Бот: работает\n' +
    personal +
    '☁️ Хостинг: Telegram Serverless\n' +
    `📦 Версия бота: <code>${BOT_VERSION}</code>`;
}

export async function statusKeyboard(userId) {
  const subscribed = await isSubscribed(userId);
  const toggle = button(subscribed ? 'Выключить рассылку' : 'Включить рассылку', {
    callback_data: subscribed ? 'status:unsubscribe' : 'status:subscribe',
    icon_custom_emoji_id: subscribed ? '5409003906170651374' : '5408901642999335517',
  });
  const rows = [[toggle]];
  if (subscribed && (await getSetting('last_channel_post_id'))) {
    rows.push([button('Последний пост', { callback_data: 'channel:last', icon_custom_emoji_id: '5411614357228390551' })]);
  }
  rows.push([menuButton('⬅️ Назад', { callback_data: 'more' })]);
  return keyboard(rows);
}

export async function channelNewsView() {
  try {
    const chat = await api.getChat({ chat_id: `@${SQUAD_CHANNEL_USERNAME}` });
    const pinned = chat.pinned_message;
    if (pinned) {
      let body = String(pinned.text || pinned.caption || 'Закреплённый медиа-пост без текста.').trim();
      if (body.length > 2800) body = truncate(body, 2797) + '...';
      return [
        `<b>📌 Закреплённый пост @THKC_SQUAD</b>\n\n${escapeHtml(body)}`,
        keyboard([
          [button('Открыть закреп', { url: `${SQUAD_CHANNEL_URL}/${pinned.message_id}`, icon_custom_emoji_id: '5411614357228390551' })],
          [menuButton('⬅️ Назад', { callback_data: 'more' })],
        ]),
      ];
    }
  } catch (err) {
    console.warn('Could not load pinned channel post', err);
  }
  const news = escapeHtml(String((await getSetting('news')) || 'Пока новостей нет.'));
  return [
    `<b>📢 Новости / объявления</b>\n\n${news}`,
    keyboard([
      [button('Открыть канал', { url: SQUAD_CHANNEL_URL, icon_custom_emoji_id: '5411527152212411235' })],
      [menuButton('⬅️ Назад', { callback_data: 'more' })],
    ]),
  ];
}

export async function channelSubscriptionText(userId) {
  if (await isSubscribed(userId)) {
    return '🔔 <b>Рассылка T.N.K.C SQUAD включена</b>\n\n' +
      'Новые посты из @THKC_SQUAD будут автоматически приходить тебе сюда в личку.';
  }
  return '🔕 <b>Рассылка T.N.K.C SQUAD выключена</b>\n\n' +
    'Подпишись, и новые посты из @THKC_SQUAD будут автоматически приходить тебе сюда в личку.';
}

export async function channelSubscriptionKeyboard(userId) {
  const toggle = (await isSubscribed(userId))
    ? button('Отписаться', { callback_data: 'channel:unsubscribe', icon_custom_emoji_id: '5409003906170651374' })
    : button('Подписаться', { callback_data: 'channel:subscribe', icon_custom_emoji_id: '5408901642999335517' });
  return keyboard([
    [toggle],
    [button('Открыть T.N.K.C SQUAD', { url: SQUAD_CHANNEL_URL, icon_custom_emoji_id: '5411527152212411235' })],
    [menuButton('⬅️ Назад', { callback_data: 'more' })],
  ]);
}

export function infoKeyboard() {
  return keyboard([
    ...['asahi', 'wryushin'].map((key) => [menuButton(`🤝 ${PARTNERS[key].name}`, { callback_data: `partner:${key}` })]),
    [menuButton('⬅️ Назад', { callback_data: 'more' })],
  ]);
}

// All links of the Squad sit in the Mini App's «Сквад» tab; the bot keeps the two
// asked for most. Groups can't open a Mini App, so the button leads to the bot.
export async function squadKeyboard(chat = null) {
  let all;
  if (isPrivate(chat)) {
    all = button('Все ссылки Сквада', { web_app: { url: `${WEBAPP_URL}?tab=squad&part=links` }, icon_custom_emoji_id: SQUAD_ICON_ID });
  } else {
    const me = await getMe();
    all = button('Все ссылки Сквада', { url: `https://t.me/${me.username}?start=squad`, icon_custom_emoji_id: SQUAD_ICON_ID });
  }
  return keyboard([
    [all],
    [menuButton('🎁 Магазин', { url: L.shop }), menuButton('📜 Правила', { url: L.rules })],
    [menuButton('⬅️ Главное меню', { callback_data: 'home' })],
  ]);
}

export function adminButton(text, action) {
  return button(text, { callback_data: `admin:${action}`, icon_custom_emoji_id: ADMIN_BUTTON_ICONS[action] });
}

// The owner's panel in four folders instead of eleven buttons.
export const ADMIN_SECTIONS = {
  posts: { title: '📣 Рассылки', icon: 'broadcast', text: 'Новость в меню, рассылка всем, авто-посты ТГК в личку и посты в чаты.' },
  people: { title: '👥 Участники', icon: 'stats', text: 'Статистика, звания и XP, обратная связь и чёрный список канала.' },
  service: { title: '⚙️ Сервис', icon: 'status', text: 'Статус бота, режим техработ и последние ошибки.' },
};
const SECTION_OF = {
  news: 'posts', broadcast: 'posts', broadcast_cancel: 'posts', broadcast_send: 'posts', broadcast_continue: 'posts',
  channel: 'posts', posts: 'posts',
  stats: 'people', feedback: 'people', blacklist: 'people', xp: 'people',
  status: 'service', maintenance: 'service', logs: 'service',
};
export const adminSectionOf = (action) => SECTION_OF[action] || 'menu';

function sectionButton(key) {
  const sec = ADMIN_SECTIONS[key];
  const [, label] = sec.title.split(' ');
  return button(label, { callback_data: `admin:sec:${key}`, icon_custom_emoji_id: ADMIN_BUTTON_ICONS[sec.icon] });
}

const pairs = (items) => items.reduce((rows, b, i) => (i % 2 ? rows[rows.length - 1].push(b) : rows.push([b]), rows), []);

export async function adminKeyboard(section = 'menu') {
  if (section === 'posts') {
    const channelMode = (await getSetting('channel_broadcast_enabled')) ? 'Авто ТГК: ВКЛ' : 'Авто ТГК: ВЫКЛ';
    return keyboard([
      ...pairs([adminButton('Новость', 'news'), adminButton('Рассылка', 'broadcast'),
        adminButton(channelMode, 'channel'), adminButton('Посты в чаты', 'posts')]),
      [menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })],
    ]);
  }
  if (section === 'people') {
    return keyboard([
      ...pairs([adminButton('Статистика', 'stats'), adminButton('Звания / XP', 'xp'),
        adminButton('Фидбек', 'feedback'), adminButton('Чёрный список', 'blacklist')]),
      [menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })],
    ]);
  }
  if (section === 'service') {
    const maintenance = (await getSetting('maintenance')) ? 'Техработы: ВКЛ' : 'Техработы: ВЫКЛ';
    return keyboard([
      [adminButton('Статус', 'status'), adminButton('Логи', 'logs')],
      [adminButton(maintenance, 'maintenance')],
      [menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })],
    ]);
  }
  return keyboard([
    [sectionButton('posts'), sectionButton('people')],
    [adminButton('Товары SQUAD SHOP', 'shop'), sectionButton('service')],
    [button('Панель в Mini App', { web_app: { url: `${WEBAPP_URL}?tab=admin` }, icon_custom_emoji_id: ADMIN_BUTTON_ICONS.xp })],
  ]);
}

// ---- XP views ------------------------------------------------------------

// In groups only the profile button stays: the reply cleans itself up anyway.
export function xpKeyboard(profile = null, { group = false } = {}) {
  if (group) return keyboard(profile ? [profile] : []);
  return keyboard([
    ...(profile ? [profile] : []),
    [menuButton('🏆 Топ за всё время', { callback_data: 'xp:top' }), menuButton('🏆 За неделю', { callback_data: 'xp:week' })],
    [menuButton('⬅️ Главное меню', { callback_data: 'home' })],
  ]);
}

export async function xpProfileText(user) {
  const p = await xp.profile(user);
  const founder = user.id === OWNER_USER_ID;
  const [current, following] = xp.rankFor(p.xp, { founder, manualRank: p.manual_rank });
  let progress;
  if (p.manual_rank && !founder) {
    progress = 'Назначено владельцем. XP продолжает накапливаться.';
  } else {
    progress = following ? `До ${following[2]}: ${following[0] - p.xp} XP` : 'Высшее звание достигнуто.';
  }
  return `Мой ранг · T.N.K.C SQUAD\n\n${escapeHtml(truncate(fullName(user), 100))}\n` +
    `${current[1]} · ${current[2]}\n\n` +
    `Всего: ${p.xp} XP\nЗа неделю: ${p.week} XP\n` +
    `Сегодня: ${p.today} / ${xp.DAILY_XP_LIMIT} XP\n\n${progress}\n\n` +
    'Комментарий: +5 XP · Реакция: +1 XP\n' +
    'Учитываются обсуждения постов Сквада.';
}

const TOP_MEDALS = ['🥇', '🥈', '🥉'];

export async function xpTopText(weekly = false) {
  const rows = await xp.leaderboard({ weekly });
  let text = '🏆 Топ Сквада · ' + (weekly ? 'текущая неделя (МСК), комментарии и реакции' : 'за всё время');
  if (!rows.length) return text + '\n\nПока никто не заработал XP. Начни с комментария под постом.';
  text += '\n';
  rows.forEach((row, i) => {
    const [current] = xp.rankFor(row.xp, { founder: row.user_id === OWNER_USER_ID, manualRank: row.manual_rank });
    text += `\n${TOP_MEDALS[i] || `${i + 1}.`} ${escapeHtml(truncate(row.name, 35))} — ${fmtThousands(row.score)} XP · ${current[1]} ${current[2]}`;
  });
  return text;
}

export function xpRulesText() {
  const ranks = xp.RANKS.map(([points, roman, name]) => `${roman} · ${name} — от ${points} XP`).join('\n');
  return 'Звания Сквада\n\n' + ranks + '\nX · Основатель SQUAD — только владелец\n\n' +
    '+5 XP за комментарий под постом: минимум 5 букв/цифр, не чаще раза в минуту.\n' +
    '+1 XP за личную реакцию в обсуждениях: один раз на сообщение, до 20 в день.\n' +
    'Смена эмодзи, снятие и повторная установка не дают новых XP. Снятие реакции не вычитает XP.\n' +
    'Реакции на свои комментарии, пересланные сообщения, команды, стикеры и сообщения от имени канала не учитываются.\n' +
    'Общий лимит: 100 XP в день за комментарии и реакции, по Москве. Неделя начинается в понедельник.\n' +
    'Сверху лимита в профиле: награда дня, квесты недели, ачивки, голос в опросе, друг по ссылке и подарок на день рождения. ' +
    'Топ-3 недели по комментариям и реакциям получают бонус, итоги выходят в канале по понедельникам.\n' +
    'Анонимные реакции самого канала не учитываются. Учёт начинается после подключения Фини; прошлый актив не восстанавливается.\n' +
    'Владелец может закрепить звание отдельно от XP; после снятия оно снова определяется по XP.\n' +
    'Звание видно в Фине и не выдаёт права администратора.';
}
