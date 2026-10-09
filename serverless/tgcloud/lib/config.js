// Constants carried over from bot_core.py (2.6.2).

export const BOT_VERSION = '3.1.0-serverless';
export const SQUAD_CHANNEL_USERNAME = 'THKC_SQUAD';
export const SQUAD_CHANNEL_URL = `https://t.me/${SQUAD_CHANNEL_USERNAME}`;
// Verified @THKC_SQUAD ID; usernames can change or be reassigned.
export const SQUAD_CHANNEL_ID = -1001192817776;
export const BLACKLIST_CHANNEL_ID = -1001192817776;
// Verified Telegram account: @THKC_SQUAD_CREATOR. Usernames can change.
export const OWNER_USER_ID = 7221285861;

// Links of the "Сквад" menu, shared by the bot keyboard and the Mini App.
export const SQUAD_LINKS = {
  owner: 'https://t.me/THKC_SQUAD_CREATOR',
  info: 'https://t.me/THKC_SQUAD/1449',
  rules: 'https://teletype.in/@creatorsworld/chat_rules',
  folder: 'https://t.me/addlist/Nw_CFrN-wzQ1MThi',
  themeRed: 'https://t.me/addtheme/SQUADTHEME',
  themeGreen: 'https://t.me/addtheme/SQUADGREEN',
  stickers: 'https://t.me/addstickers/SquadCorporation',
  wishlist: 'https://t.me/wishapp/wishlist?startapp=-w15874613',
  anon: 'https://t.me/anonaskbot?start=r5z6k1ge4zcjbdzb',
  tiktok: 'https://www.tiktok.com/@tnkc_squad_corporation?_t=ZS-8xtQVu6AMBl&_r=1',
  discord: 'https://discord.gg/dCgQvVeJzs',
  vk: 'https://vk.com/creator_this_world',
  twitch: 'https://www.twitch.tv/tnkc_squad_creator',
  tbank: 'https://tbank.ru/baf/AwvoxOcQ5Ee',
  boost: 'https://t.me/boost?c=1192817776',
  shop: 'https://jeffripper.github.io/SQUAD-SHOP/',
};

export const BROADCAST_CONFIRM_SECONDS = 600;

// The Mini App (webapp/), hosted by the platform next to the bot.
export const WEBAPP_URL = 'https://app8906365781.tgcloud.ai/';

// Custom emoji from https://t.me/addemoji/sfsymbols.
export const BUTTON_ICONS = {
  'ℹ️': '6021620268697393273',
  '👤': '6021437281615748449',
  '💠': '6021620268697393273',
  '📜': '6023985764885338464',
  '🔥': '6021384767050618542',
  '🟢': '6021435456254646075',
  '🙂': '6019118553326689234',
  '🎁': '6023826881160157558',
  '⌨️': '6019107055699236857',
  '✨': '6019145074749740966',
  '🤝': '6021642336239360403',
  '🏦': '6030602393933060595',
  '⬅️': '5805509901048356965',
};

// Icons from HowDidYouDoThis, materialexpressive and UnigramIcons.
export const ADMIN_BUTTON_ICONS = {
  posts: '5411335287433364660',
  xp: '5870930636742595124',
  stats: '5870930636742595124',
  status: '5346022209389372742',
  feedback: '5870755659774955152',
  news: '5870687545888607770',
  broadcast: '5870886806601338791',
  channel: '5411335287433364660',
  maintenance: '5438513664388803768',
  logs: '5870450390679425417',
  restart: '5870892901159932239',
  blacklist: '5438513664388803768',
};

export const HOME_TEXT =
  '<b>𒈒𝙏.𝙉.𝙆.𝘾 𝙎𝙌𝙐𝘼𝘿𒈒 @THKC_SQUAD\n\n' +
  'Всё о Скваде: важные ссылки, правила и наши партнёры.\n\n' +
  'Выбери раздел:</b>';
export const INFO_TEXT = '<b>Сквад и партнёры\n\nВыбери раздел:</b>';
export const SQUAD_ICON_ID = '5366465407609756495';
export const SQUAD_EMOJI = `<tg-emoji emoji-id="${SQUAD_ICON_ID}">💠</tg-emoji>`;
export const SQUAD_TEXT =
  `<b>${SQUAD_EMOJI} T.N.K.C SQUAD — ИНФО ${SQUAD_EMOJI}\n\n` +
  'Информация о Скваде, правила и полезные ссылки — на кнопках ниже.\n\n' +
  '⚠️ НАРУШЕНИЕ ПРАВИЛ КАРАЕТСЯ БАНОМ\n' +
  'ПОСЛЕ ВЫХОДА ИЗ БЕСЕДЫ — ВОЗВРАТА НЕТ\n\n' +
  'Здесь собраны папка Сквада, темы, стикеры, вишлист, ' +
  'анонимные вопросы, соцсети владельца и поддержка проекта.\n\n' +
  `Спасибо за внимание 🧐${SQUAD_EMOJI}\n\n` +
  `✨ Не забываем распространять НАШ КАНАЛ ${SQUAD_EMOJI}\n` +
  'в TikTok и ВКонтакте\n' +
  '#ВернемСквадуЖизнь</b>';

export const PARTNERS = {
  asahi: {
    name: 'Сай',
    tiktok: 'https://www.tiktok.com/@iruminaluu?_t=8lG9t4sGwlN&_r=1',
    telegram: 'https://t.me/twixtogram',
  },
  wryushin: {
    name: 'Врюшин',
    tiktok: 'https://www.tiktok.com/@wryysn356?_t=8lG9pEcs8Jc&_r=1',
    telegram: 'https://t.me/wryysnscoffin',
  },
};

export const DEFAULT_NEWS = 'Пока свежих объявлений нет. Следи за @THKC_SQUAD 👀';
