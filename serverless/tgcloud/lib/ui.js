// Keyboards and texts (port of the view helpers in bot_core.py).
import { api } from 'sdk';
import {
  ADMIN_BUTTON_ICONS, BOT_VERSION, OWNER_USER_ID, PARTNERS, SQUAD_CHANNEL_URL,
  SQUAD_CHANNEL_USERNAME, SQUAD_ICON_ID, WEBAPP_URL,
} from './config.js';
import { button, getMe, keyboard, menuButton } from './tg.js';
import { getSetting, isSubscribed } from './store.js';
import { escapeHtml, fullName, truncate } from './util.js';
import * as xp from './xp.js';

export function partnerKeyboard(partner) {
  return keyboard([
    [menuButton('✨ TikTok', { url: partner.tiktok }), menuButton('💠 ТГК', { url: partner.telegram })],
    [menuButton('⬅️ Назад в Инфо', { callback_data: 'info' })],
  ]);
}

// Telegram allows web_app buttons only in private chats.
export function profileAppButton(text = '👤 Профиль Фини') {
  return menuButton(text, { web_app: { url: WEBAPP_URL } });
}

// Private chats open the Mini App directly; groups link to the bot's private chat.
export async function profileRow(chat) {
  if (!chat || chat.type === 'private') return [profileAppButton('👤 Открыть профиль')];
  const me = await getMe();
  return [menuButton('👤 Открыть профиль', { url: `https://t.me/${me.username}?start=profile` })];
}

export function homeKeyboard(chatType = 'private') {
  const rows = [
    [menuButton('ℹ️ Инфо', { callback_data: 'info' }), button('📢 Новости', { callback_data: 'news' })],
    [button('🟢 Статус', { callback_data: 'status' }), button('💬 Обратная связь', { callback_data: 'feedback' })],
    [button('Мой ранг', { callback_data: 'xp:profile' }), button('Топ участников', { callback_data: 'xp:top' })],
  ];
  if (chatType === 'private') rows.push([profileAppButton()]);
  rows.push([menuButton('👤 ЛС Владельца', { url: 'https://t.me/THKC_SQUAD_CREATOR' })]);
  return keyboard(rows);
}

export function profileAppKeyboard() {
  return keyboard([[profileAppButton()], [menuButton('⬅️ Главное меню', { callback_data: 'home' })]]);
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
  rows.push([menuButton('⬅️ Главное меню', { callback_data: 'home' })]);
  return keyboard(rows);
}

export async function channelNewsView() {
  try {
    const chat = await api.getChat({ chat_id: `@${SQUAD_CHANNEL_USERNAME}` });
    const pinned = chat.pinned_message;
    if (pinned) {
      let body = String(pinned.text || pinned.caption || 'Закреплённый медиа-пост без текста.').trim();
      if (body.length > 2800) body = body.slice(0, 2797) + '...';
      return [
        `<b>📌 Закреплённый пост @THKC_SQUAD</b>\n\n${escapeHtml(body)}`,
        keyboard([
          [button('Открыть закреп', { url: `${SQUAD_CHANNEL_URL}/${pinned.message_id}`, icon_custom_emoji_id: '5411614357228390551' })],
          [menuButton('⬅️ Главное меню', { callback_data: 'home' })],
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
      [menuButton('⬅️ Главное меню', { callback_data: 'home' })],
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
    [menuButton('⬅️ Главное меню', { callback_data: 'home' })],
  ]);
}

export function infoKeyboard() {
  return keyboard([
    [button('Сквад', { callback_data: 'squad', icon_custom_emoji_id: SQUAD_ICON_ID })],
    ...['asahi', 'wryushin'].map((key) => [menuButton(`🤝 ${PARTNERS[key].name}`, { callback_data: `partner:${key}` })]),
    [menuButton('⬅️ Главное меню', { callback_data: 'home' })],
  ]);
}

export function squadKeyboard() {
  const link = (label, url) => {
    if (label.startsWith('💠 ')) {
      return button(label.slice(2), { url, icon_custom_emoji_id: SQUAD_ICON_ID });
    }
    return menuButton(label, { url });
  };
  return keyboard([
    [link('💠 Инфо о Скваде', 'https://t.me/THKC_SQUAD/1449')],
    [link('📜 Правила беседы', 'https://teletype.in/@creatorsworld/chat_rules')],
    [link('💠 Папка T.N.K.C SQUAD', 'https://t.me/addlist/Nw_CFrN-wzQ1MThi')],
    [link('🔥 Красный Сквад', 'https://t.me/addtheme/SQUADTHEME'), link('🟢 Зелёный Сквад', 'https://t.me/addtheme/SQUADGREEN')],
    [link('🙂 Стикеры ТГК V2', 'https://t.me/addstickers/SquadCorporation')],
    [link('🎁 Вишлист / желания', 'https://t.me/wishapp/wishlist?startapp=-w15874613')],
    [link('⌨️ Анонимные вопросы', 'http://t.me/anonaskbot?start=r5z6k1ge4zcjbdzb')],
    [link('👤 Владелец · TikTok', 'https://www.tiktok.com/@tnkc_squad_corporation?_t=ZS-8xtQVu6AMBl&_r=1'),
      link('👤 Владелец · Discord', 'https://discord.gg/dCgQvVeJzs')],
    [link('👤 Владелец · VK', 'https://vk.com/creator_this_world'),
      link('👤 Владелец · Twitch', 'https://www.twitch.tv/tnkc_squad_creator')],
    [link('🏦 Приглашение Т-Банк', 'https://tbank.ru/baf/AwvoxOcQ5Ee')],
    [link('💠 Буст канала', 'https://t.me/boost?c=1192817776')],
    [menuButton('⬅️ Назад в Инфо', { callback_data: 'info' })],
  ]);
}

export function adminButton(text, action) {
  return button(text, { callback_data: `admin:${action}`, icon_custom_emoji_id: ADMIN_BUTTON_ICONS[action] });
}

export async function adminKeyboard() {
  const maintenance = (await getSetting('maintenance')) ? 'Техработы: ВКЛ' : 'Техработы: ВЫКЛ';
  const channelMode = (await getSetting('channel_broadcast_enabled')) ? 'Авто ТГК: ВКЛ' : 'Авто ТГК: ВЫКЛ';
  return keyboard([
    [adminButton('Статистика', 'stats'), adminButton('Статус', 'status')],
    [adminButton('Фидбек', 'feedback'), adminButton('Новость', 'news')],
    [adminButton('Рассылка', 'broadcast')],
    [adminButton(channelMode, 'channel')],
    [adminButton('Чёрный список', 'blacklist')],
    [adminButton('Звания / XP', 'xp')],
    [adminButton('Посты в чаты', 'posts')],
    [adminButton(maintenance, 'maintenance')],
    [adminButton('Логи', 'logs')],
  ]);
}

// ---- XP views ------------------------------------------------------------

export function xpKeyboard(profile = null) {
  return keyboard([
    [button('Мой ранг', { callback_data: 'xp:profile' })],
    ...(profile ? [profile] : []),
    [button('За всё время', { callback_data: 'xp:top' }), button('За неделю', { callback_data: 'xp:week' })],
    [button('Звания и правила XP', { callback_data: 'xp:rules' })],
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

export async function xpTopText(weekly = false) {
  const rows = await xp.leaderboard({ weekly });
  let text = 'Топ Сквада · ' + (weekly ? 'текущая неделя (МСК)' : 'за всё время');
  if (!rows.length) return text + '\n\nПока никто не заработал XP. Начни с комментария под постом.';
  rows.forEach((row, i) => {
    const [current] = xp.rankFor(row.xp, { founder: row.user_id === OWNER_USER_ID, manualRank: row.manual_rank });
    text += `\n\n${i + 1}. ${escapeHtml(truncate(row.name, 35))} — ${row.score} XP\n${current[1]} · ${current[2]}`;
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
    'Общий лимит: 100 XP в день, по Москве. Неделя начинается в понедельник.\n' +
    'Анонимные реакции самого канала не учитываются. Учёт начинается после подключения Фини; прошлый актив не восстанавливается.\n' +
    'Владелец может закрепить звание отдельно от XP; после снятия оно снова определяется по XP.\n' +
    'Звание видно в Фине и не выдаёт права администратора.';
}
