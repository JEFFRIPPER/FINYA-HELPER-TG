// Update news for the CHANGELOG topic of SQUAD FAMILY CHAT. Every release of the
// bot or the Mini App adds an entry on top of CHANGES; after the deploy pump() posts
// it there by itself. /log_on in a topic makes it the place for the news, like
// /posts_on for the channel's posts. /log shows the next news, /log post posts it now.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { getSetting, logError, setSetting } from './store.js';
import { withPremium } from './emoji.js';
import { boldHtml, escapeHtml, nowInt, truncate } from './util.js';

// Until /log_on: https://t.me/c/2229986493/271940
export const CHANGELOG_CHAT_ID = -1002229986493;
export const CHANGELOG_THREAD_ID = 271940;

// The chat and topic the news go to.
export async function target() {
  const t = await getSetting('changelog_target');
  if (t && t.chat_id) return t;
  return { chat_id: CHANGELOG_CHAT_ID, thread_id: CHANGELOG_THREAD_ID, title: 'SQUAD FAMILY CHAT' };
}

const inTarget = (t, params) => ({ chat_id: t.chat_id, ...(t.thread_id ? { message_thread_id: t.thread_id } : {}), ...params });

// Newest first. `id` never changes once posted.
export const CHANGES = [
  {
    id: '2026-10-25-staff-usernames',
    date: '25 октября 2026',
    title: 'Штаб Сквада: кто на должности',
    items: [
      '👤 Нажми на должность в Штабе: откроется карточка с теми, кто её занимает, их @юзернеймами, обязанностями и девизом.',
      '🔗 Нажми на @юзернейм, и откроется профиль человека в Telegram.',
      '🌑 Фон Mini App стал чуть темнее, алый остался.',
    ],
  },
  {
    id: '2026-10-25-squad-tab',
    date: '25 октября 2026',
    title: 'Новая вкладка «Сквад» в Mini App',
    items: [
      '🔥 Шапка Сквада как профиль канала: лого на обложке, название под ней, кнопка «Канал».',
      '⚡ Сверху большие кнопки: Чаты, Инфо, Правила, Поддержка.',
      '🛡 Штаб Сквада плиткой с полоской занятых мест, вакансии видно сразу.',
      '🛍 Магазин Сквада отдельной алой карточкой, соцсети владельца плитками, проекты листаются вбок.',
      '📱 Шесть вкладок внизу больше не обрезаются, карточки не слипаются.',
    ],
  },
  {
    id: '2026-10-25-polish',
    date: '25 октября 2026',
    title: 'Шлифовка того, что уже есть',
    items: [
      '✍️ Имена в ответах больше не ломаются падежами: браки, отношения, награды, должности, ачивки и «Сравнить» написаны так, что любое имя читается правильно.',
      '🏆 Топ Сквада стал нагляднее: медали 🥇🥈🥉 у первой тройки, XP с разделителями тысяч.',
      '⚡ «Кто Я» и профиль в Mini App открываются быстрее: данные собираются разом, а не по очереди.',
      '🏡 Гражданство и анкета звучат одинаково для всех, без привязки к полу.',
    ],
  },
  {
    id: '2026-10-25-miniapp-changes',
    date: '25 октября 2026',
    title: 'Все обновления в Mini App',
    items: [
      '🚀 В Mini App во вкладке «Сквад» появилась кнопка «Все обновления». Там вся история Фини, с первой версии до сегодняшнего дня.',
    ],
  },
  {
    id: '2026-10-25-horo-mailru',
    date: '25 октября 2026',
    title: 'Гороскоп с Гороскопов Mail.ru',
    items: [
      '🔮 «Гороскоп» теперь берёт прогноз с horo.mail.ru, полный текст на сегодня. Длинный прогноз сворачивается, нажми, чтобы раскрыть.',
    ],
  },
  {
    id: '2026-10-25-bold-horoscope',
    date: '25 октября 2026',
    title: 'Жирный шрифт везде и рабочий гороскоп',
    items: [
      '🅱️ Все ответы Фини теперь жирным шрифтом: команды чата, приветствия, поздравления с ДР, итоги недели, навигатор, прощания и РП через @finya_helper_Squad_bot.',
      '🔮 Починили «Гороскоп»: Финя берёт прогноз с правильного адреса ignio.com.',
      '⚖️ «Моя Статья» больше не меняется в течение дня: одна статья на сутки.',
      '✍️ Поправили окончания: «52 сообщения», «от 61 человека» и так далее.',
    ],
  },
  {
    id: '2026-10-25-navigator',
    date: '25 октября 2026',
    title: 'Навигатор Сквада',
    items: [
      '🧭 В чатах Сквада теперь висит навигатор: закреплённое сообщение, где собраны канал, папка Сквада, открытые чаты, магазин, правила, профиль Фини и проекты на GitHub. В закрытые чаты попадают только после анкеты, ссылку выдаёт владелец.',
      '📢 В навигаторе всегда есть ссылка на последний пост канала, по ней можно сразу перейти к обсуждению.',
      '🔄 Финя сама обновляет навигатор, когда выходит новый пост, раз в сутки и после обновлений. Если навигатор удалят, она отправит и закрепит его заново.',
    ],
  },
  {
    id: '2026-10-25-horo-question',
    date: '25 октября 2026',
    title: 'Гороскоп, вопрос дня и «Сравнить»',
    items: [
      '🔮 «Гороскоп»: прогноз на сегодня для твоего знака, взятый с ignio.com. «Гороскоп Рыбы» покажет любой другой знак.',
      '♓ В «Кто Я» теперь виден знак зодиака: Финя считает его по дню рождения. Если ДР не указан, поставь его командой «+ДР 16.12». Отдельная команда: «Мой Знак».',
      '❓ Каждый день в 12:00 МСК в чатах Сквада появляется вопрос дня. Это опрос, и в нём видно, кто как ответил.',
      '⚔️ «Сравнить» ответом на сообщение или с @ником ставит двоих рядом: XP, репа, ачивки, награды и актив.',
      '⏳ «Финя, До Нового Года» считает, сколько осталось. Работает и с другими праздниками, со своей датой («Финя, До 31.12») и с днём рождения («Финя, До ДР»).',
    ],
  },
  {
    id: '2026-10-25-article-birthdays',
    date: '25 октября 2026',
    title: 'Статья дня, ближайшие ДР и минус в репу',
    items: [
      '⚖️ «Моя Статья»: статья дня из «УК Сквада» по тому, как ты ведёшь себя в чате. Флудишь — будет флуд, сидишь по ночам — ночной дозор, крутишь казино — игорный бизнес. Новая каждый день.',
      '🎂 «Ближайшие ДР»: дни рождения участников на месяц вперёд.',
      '💔 «-» ответом на сообщение снимает 1 репутации, как дизлайк.',
      '📅 В «Кто Я» и анкете видно, примерно с какого времени человек в Telegram. Отдельно: «Возраст Аккаунта».',
      '👋 Финя прощается с теми, кто сам вышел из чата.',
      '🔮 «Финя, когда будет стрим?» — Финя назовёт дату.',
    ],
  },
  {
    id: '2026-10-23-command-help',
    date: '23 октября 2026',
    title: 'Подсказка к любой команде',
    items: [
      '❓ Допиши «помощь» к команде, и Финя покажет, как ей пользоваться, с примерами: «Награды Помощь», «Брак Помощь», «Финя, Напомни Помощь». Работает со всеми командами и РП-действиями.',
    ],
  },
  {
    id: '2026-10-23-poll-voters',
    date: '23 октября 2026',
    title: 'Кто как ответил в опросе',
    items: [
      '🗳 В панели владельца нажми на опрос: откроются все варианты, сколько за каждый и кто именно его выбрал.',
    ],
  },
  {
    id: '2026-10-23-rp-no-stickers',
    date: '23 октября 2026',
    title: 'РП снова без стикеров',
    items: [
      '🤗 После РП-действия Финя больше не кидает стикер: остаётся только строка вроде «Kira обнимает Jeff».',
    ],
  },
  {
    id: '2026-10-23-rp-stickers',
    date: '23 октября 2026',
    title: 'РП со стикерами Фини',
    items: [
      '🤗 После РП-действия в чате Финя кидает свой стикер из пака SquadCorporation: обнимашки на «Обнять», «Тебе пиздец!» на «Ударить», «Кушать будешь?» на «Покормить» и ещё на 18 команд.',
    ],
  },
  {
    id: '2026-10-23-inline-case',
    date: '23 октября 2026',
    title: 'РП без ошибок в падежах',
    items: [
      '✍️ РП через «@finya_helper_Squad_bot» больше не пишет «даёт пять всех»: теперь «даёт пять всем», «жмёт руку тебе», «дарит цветы Фине».',
    ],
  },
  {
    id: '2026-10-23-inline-premium',
    date: '23 октября 2026',
    title: 'Премиум-эмодзи в РП из любого чата',
    items: [
      '✨ РП через «@finya_helper_Squad_bot» теперь приходят с премиум-эмодзи Сквада, как ответы Фини в чатах.',
    ],
  },
  {
    id: '2026-10-23-scarlet-profile',
    date: '23 октября 2026',
    title: 'Алый фон профиля',
    items: [
      '🩸 Фон «Профиля Фини» теперь кроваво-алый: от яркого красного сверху до тёмного бордо внизу, с алым светом в углу.',
    ],
  },
  {
    id: '2026-10-23-inline-rp',
    date: '23 октября 2026',
    title: 'РП в любом чате',
    items: [
      '🤗 РП-действия Фини теперь работают в любом чате, даже в личке с другом: напиши «@finya_helper_Squad_bot» и пробел, выбери действие из списка.',
      '✍️ Можно сразу «@finya_helper_Squad_bot обнять @ник скучала»: Финя обнимет кого надо и добавит комментарий. Без @ника в личке действие уходит собеседнику, а в группе — всем.',
    ],
  },
  {
    id: '2026-10-23-wedding-names',
    date: '23 октября 2026',
    title: 'Свадьбы по традиции',
    items: [
      '💍 «Мой Брак» теперь показывает, какая у пары свадьба: зелёная, ситцевая, бумажная… серебряная, золотая и до коронной (75 лет), и сколько дней до следующей.',
      '💒 В «Браках» рядом со стажем видно название свадьбы, а в поздравлении с годовщиной Финя называет её: «5 лет вместе, деревянная свадьба 🪵».',
    ],
  },
  {
    id: '2026-10-23-award-degrees',
    date: '23 октября 2026',
    title: 'Награды со степенями',
    items: [
      '🏆 У наград теперь 8 степеней: 🎗 🥉 🥈 🥇 🎖 🏅 🏆 🏵. Админ пишет «Наградить 4» ответом или «Наградить 4 @ник», а название награды с новой строки.',
      '📜 «Награды» показывают список от старшей степени к младшей, «Кто Я» тоже.',
      '🗑 «Снять Все Награды» ответом снимает всё сразу (для админов), а «Снять Награды От» ответом убирает с тебя награды, которые дал этот человек.',
    ],
  },
  {
    id: '2026-10-23-close-button',
    date: '23 октября 2026',
    title: 'Кнопка «Закрыть»',
    items: [
      '✖️ Под ответами Фини в чатах теперь есть кнопка «Закрыть»: убирает ответ вместе с командой. Нажать может тот, кто вызвал, или админ.',
      '⏳ Ответы Фини больше не исчезают через пару минут: висят сутки, если их не закрыть раньше.',
    ],
  },
  {
    id: '2026-10-23-citizens',
    date: '23 октября 2026',
    title: 'Гражданство и дата пары',
    items: [
      '🏡 «+Гражданство» в чате делает его твоим домом. Гражданство одно: новое заменяет старое, «-Гражданство» снимает.',
      '📋 В «Моей Анкете» и «Кто Я» появилась строка «Гражданин чата» со стажем, а в «Стате» рядом с именем гражданина стоит 🏡.',
      '👥 «Кто Граждане» — все граждане этого чата, от старожилов к новичкам. Сколько их, видно и в «Чат Инфо».',
      '📅 Пара вместе дольше, чем знает Финя? «Начало Брака 01.05.2024» или «Начало Отношений 01.05.2024» — и все дни засчитаются. Бесплатно, раз в месяц.',
    ],
  },
  {
    id: '2026-10-22-dating',
    date: '22 октября 2026',
    title: 'Отношения, Чат Инфо и темы графиков',
    items: [
      '💞 «Встречаться» ответом на сообщение: отношения до брака. Сами не заканчиваются, только по «Расстаться». «Мои Отношения» покажет стаж пары, «Кто Встречается» все пары, а «Брак» превратит отношения в брак.',
      '🏙 «Чат Инфо»: карточка чата с графиком, население, новички, сообщения за день, неделю, месяц и всё время, рекордный день и самые активные.',
      '🎨 В Лавке появились темы графиков: Ледяная, Токсичная, Неон и Золотая. Надеть: «Тема Графика Неон», и «Кто Я» с анкетой заиграют новыми цветами.',
    ],
  },
  {
    id: '2026-10-22-anketa',
    date: '22 октября 2026',
    title: 'Моя Анкета',
    items: [
      '📋 Новая команда «Моя Анкета»: ты целиком по всем чатам Сквада сразу. «Анкета» ответом покажет чужую.',
      '📊 Внутри: график сообщений по всем чатам, сколько ты в Скваде, актив за день, неделю, месяц и всё время, а ещё в каких чатах ты живёшь и с какого числа.',
      '🔥 Серия дней подряд и её рекорд, рекордный день и час пик: сова ты или жаворонок.',
      '💰 «В мешке»: XP, баланс, звание, ачивки и репутация.',
      '🎂 Заполни о себе: «+ДР 16.12.1999», «+Пол М», «+Город Москва». С днём рождения Финя поздравит сама.',
    ],
  },
  {
    id: '2026-10-22-chat-on',
    date: '22 октября 2026',
    title: 'Финя в любом чате Сквада',
    items: [
      '💬 Финя теперь может работать чат-менеджером в любом чате Сквада, а не только там, куда приходят посты канала.',
      '👑 Владелец включает её командой /chat_on прямо в чате (Финя должна быть админом): команды словами, «Кто Я», топы, ачивки, РП, фарм и итоги дня заработают сразу.',
      '📭 Посты канала в такой чат не приходят. Выключить: /chat_off.',
    ],
  },
  {
    id: '2026-10-22-staff',
    date: '22 октября 2026',
    title: 'Должности Сквада',
    items: [
      '⛓️ В Скваде появились должности: Контент-менеджер, Креативщик / Дизайнер, Ивент-менеджер, Тех. администратор, Комьюнити-менеджер, Модератор активности, Модератор и Администратор чата.',
      '👑 Назначает владелец: «+Должность Креативщик» ответом. Финя объявляет назначение с обязанностями.',
      '📋 «Штаб» — вся команда Сквада, «Должность» ответом — чья-то должность, «Должность Креативщик» — обязанности.',
      '💼 Должность видна в «Кто Я», в профиле Mini App и в карточке «Штаб Сквада» во вкладке «Сквад».',
    ],
  },
  {
    id: '2026-10-22-log-keep',
    date: '22 октября 2026',
    title: 'Новости больше не пропадают',
    items: [
      '📰 В топике новостей Финя ничего не удаляет: после /log_on туда сразу приходит свежая новость, а «готово» Финя пишет владельцу в личку.',
    ],
  },
  {
    id: '2026-10-22-daily-achievements',
    date: '22 октября 2026',
    title: 'Итоги дня и 50 новых ачивок',
    items: [
      '🌙 В 23:55 МСК Финя подводит итоги дня в чате: топ-3 по сообщениям, сколько всего написали и звезда дня.',
      '🏆 50 новых ачивок: за сообщения, дни в чате, стаж, репутацию, брак, фарм, казино, ночные посиделки и не только.',
      '🎉 Новую ачивку Финя объявляет прямо в чате и сразу начисляет XP. Свои ачивки: «Ачивки», все — в профиле Фини.',
      '📥 Владелец может прислать экспорт истории чата (result.json до 20 МБ) прямо Фине в личку, без Mini App.',
    ],
  },
  {
    id: '2026-10-21-iris-more',
    date: '21 октября 2026',
    title: 'Ник, казино, напоминалки и ещё',
    items: [
      '🏷 «+Ник Вася» — так Финя зовёт тебя в топах, профиле и РП.',
      '🎁 «Передать 100» ответом — перевод XP с баланса. «Баланс» покажет, сколько можно тратить.',
      '🎰 «Казино 50» и 🎲 «Кости 50» — ставки XP. Правила: «Казино».',
      '⏰ «Финя, напомни через 2ч позвонить» — Финя напомнит в этом же чате.',
      '📊 В «Стате» видно твоё место, кнопки периода подсказывают его каждому.',
      '❤️ «Топ Репы», ⭐ «Админы», 🆔 «Ид» и «Топ Пар».',
      '💒 Финя поздравляет пары с годовщинами: 7, 30, 100 дней и дальше.',
      '📣 Админы могут созвать всех: «Финя, созови».',
      '📖 «Финя, команды» теперь с разделами на кнопках.',
    ],
  },
  {
    id: '2026-10-21-history',
    date: '21 октября 2026',
    title: 'Вся история чата в профиле',
    items: [
      '📜 Финя научилась подтягивать старую историю чата из экспорта Telegram Desktop.',
      '📈 После загрузки графики «Кто Я», актив за всё время и «Стата» учтут сообщения, написанные ещё до Фини.',
      '🏠 «Первое появление» покажет настоящую дату, когда человек впервые написал в чат.',
    ],
  },
  {
    id: '2026-10-21-profile',
    date: '21 октября 2026',
    title: 'Профиль как у Ириса',
    items: [
      '📈 «Кто Я» теперь с графиком сообщений по дням за год.',
      '💬 Актив за день, неделю, месяц и всё время, первое появление и последний актив.',
      '👑 В профиле видно создателя и админов чата.',
      '📝 «+Описание Текст» — пара строк о себе в профиле. Целиком: «Описание».',
      '🏅 Награды: админы дают их ответом «Наградить Текст». Список — «Награды».',
    ],
  },
  {
    id: '2026-10-16-polish',
    date: '16 октября 2026',
    title: 'Меньше мусора в чате, красивее Mini App',
    items: [
      '🤗 После РП остаётся только ответ Фини: сама команда «Обнять» и т. п. удаляется.',
      '📜 «Финя, Команды»: команды с большой буквы, под каждой — описание цитатой.',
      '🏆 Ачивки в Mini App: по нажатию видно задание и прогресс, плашка в стиле Сквада.',
    ],
  },
  {
    id: '2026-10-16-chat',
    date: '16 октября 2026',
    title: 'Финя теперь живёт в чате',
    items: [
      '💬 Команды словами, как у Ириса. Все команды: «Финя, Команды».',
      '👤 «Кто Я» — профиль: звание, XP, репутация, брак и ачивки.',
      '🌾 «Фарм» — случайный XP раз в час, иногда редкий, до 200.',
      '❤️ «+» или «Спасибо» ответом — репутация, без лимита.',
      '💍 «Брак» ответом — предложение. Пара видна в профиле Mini App.',
      '🤗 РП ответом: Обнять, Поцеловать, Ударить… Весь список: «РП».',
      '📊 «Стата» — актив чата с кнопками День / Неделя / Месяц / Всё время.',
      '🔮 «Финя, Инфа…», «Финя, Кто…», «Финя, Выбери А или Б».',
      '🛡 Новичков встречает кнопка «Я не бот», за флуд — мут.',
      '✨ В ответах Фини теперь премиум-эмодзи.',
    ],
  },
];

// Before the CHANGELOG topic: never posted, shown in the Mini App's «Все обновления».
export const HISTORY = [
  {
    id: '2026-10-16-menu',
    date: '16 октября 2026',
    title: 'Компактное меню бота',
    items: [
      '📱 В личке у Фини одно живое сообщение и три кнопки: Профиль, Сквад и «Ещё».',
      '🔗 Ссылки, правила и магазин Сквада переехали в Mini App.',
    ],
  },
  {
    id: '2026-10-15-club',
    date: '15 октября 2026',
    title: 'Клуб Сквада',
    items: [
      '🎁 Награда дня и ежедневные квесты за XP.',
      '🏆 Ачивки в профиле Mini App.',
      '🛍 Лавка за XP: рамки аватара, цвет ника и титулы.',
      '🗳 Опросы Сквада прямо в Mini App.',
      '🤝 «Позови друга»: своя ссылка и XP за каждого, кто пришёл по ней.',
      '🎂 День рождения в профиле, в этот день Финя поздравляет и дарит XP.',
      '📅 По понедельникам итоги недели в канале, топ-3 получают бонус.',
      '👋 Финя встречает новичков в обсуждениях.',
    ],
  },
  {
    id: '2026-10-10-shop',
    date: '10 октября 2026',
    title: 'SQUAD SHOP',
    items: [
      '🛒 Товары магазина Сквада видно прямо в Mini App.',
      '🔗 Ссылка на магазин в меню бота и во вкладке «Сквад».',
    ],
  },
  {
    id: '2026-10-09-miniapp',
    date: '9 октября 2026',
    title: 'Mini App «Профиль Фини»',
    items: [
      '👤 Профиль: звание и погоны, XP, огонёк серии дней, соперник по топу.',
      '🏅 Топ Сквада и все звания с порогами.',
      '📢 Вкладка «Сквад»: объявление владельца, последний пост, ссылки и проекты Сквада.',
      '🩸 Тёмный кровавый стиль и анимации Material 3.',
    ],
  },
  {
    id: '2026-10-09-serverless',
    date: '9 октября 2026',
    title: 'Финя переехала',
    items: [
      '☁️ Финя теперь работает на Telegram Serverless: без своего сервера, быстрее и стабильнее. XP, звания и подписки переехали вместе с ней.',
    ],
  },
  {
    id: 'v2',
    date: 'до октября 2026',
    title: 'Финя 2.x: бот-помощник ТГК',
    items: [
      '📰 Новые посты @THKC_SQUAD в личку подписчикам и в чаты Сквада.',
      '⭐ XP за комментарии и реакции в обсуждениях, звания Сквада, /rank и /top.',
      '💬 Обратная связь владельцу прямо из бота.',
      '🤝 Партнёры Сквада и все ссылки: папка, темы, стикеры, соцсети.',
    ],
  },
];

// Everything, newest first: for the Mini App.
export const allChanges = () => CHANGES.concat(HISTORY).map(({ id, date, title, items }) => ({ id, date, title, items }));

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

// What Telegram answered.
const reason = (err) => String((err && err.description) || (err && err.message) || err);

async function warnOwner(entry, err) {
  if ((await getSetting('changelog_warned')) === entry.id) return;
  await setSetting('changelog_warned', entry.id);
  const why = escapeHtml(reason(err));
  try {
    await api.sendMessage({
      chat_id: OWNER_USER_ID, parse_mode: 'HTML',
      text: boldHtml(`📰 Не смогла опубликовать новость в CHANGELOG: ${why}\n\n` +
        'Отправь /log_on прямо в топике для новостей: Финя запомнит его и сразу опубликует новость. ' +
        'Если не выйдет, проверь, что она может там писать.'),
    });
  } catch {
    // The owner's chat is closed: the error log has it.
  }
}

// Posts the oldest entry not in the topic yet. → { status: 'posted' | 'none' | 'wait' | 'failed', why }
export async function postNext({ manual = false } = {}) {
  const { posted, list } = await pending();
  if (!list.length) return { status: 'none' };
  if (!manual) {
    const failedAt = await getSetting('changelog_failed_at');
    if (failedAt && nowInt() - failedAt < FAIL_GAP) return { status: 'wait' };
  }
  const entry = list[0];
  const t = await target();
  if (!(await setPosted(posted, entry.id))) return { status: 'wait' };
  try {
    await withPremium(inTarget(t, {
      text: newsText(entry), parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    }), (p) => api.sendMessage(p));
  } catch (err) {
    await setPosted(entry.id, posted);
    await setSetting('changelog_failed_at', nowInt());
    await logError('changelog.post', err);
    await warnOwner(entry, err);
    return { status: 'failed', why: reason(err) };
  }
  await setSetting('changelog_failed_at', null);
  return { status: 'posted' };
}

// From pump(): a fresh deploy's news goes out by itself.
export async function tick() {
  await postNext();
}

const reply = (message, text) => withPremium({
  chat_id: message.chat.id, text: boldHtml(text), parse_mode: 'HTML',
  reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
}, (p) => api.sendMessage(p));

// The owner; in a group also its anonymous admins (they write as the group), if it is
// a Squad chat or the one with the news.
export async function allowed(message, owner, squad = false) {
  if (owner) return true;
  const chatId = message.chat.id;
  if (!message.sender_chat || message.sender_chat.id !== chatId) return false;
  return squad || chatId === CHANGELOG_CHAT_ID || chatId === (await target()).chat_id;
}

async function dropCommand(message) {
  try {
    await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id });
  } catch {
    // No rights to delete: the command stays.
  }
}

// /log_on in a topic: the news go there from now on. The topic gets a real news post
// right away (the pending one, else the latest), which also checks that Финя may write
// there; nothing in the topic is ever deleted. The owner hears «готово» in the private chat.
export async function bindCommand(message, owner, squad) {
  const chat = message.chat;
  if (!['group', 'supergroup'].includes(chat.type)) {
    if (owner) await reply(message, 'Отправь /log_on прямо в топике, куда Фине писать новости об обновлениях.');
    return;
  }
  if (!(await allowed(message, owner, squad))) return;
  await dropCommand(message);
  const t = {
    chat_id: chat.id,
    thread_id: message.is_topic_message && message.message_thread_id ? message.message_thread_id : null,
    title: truncate(chat.title || '', 64),
  };
  const { posted, list } = await pending();
  const entry = list[0] || CHANGES[0];
  try {
    await withPremium(inTarget(t, {
      text: newsText(entry), parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    }), (p) => api.sendMessage(p));
  } catch (err) {
    await logError('changelog.bind', err);
    await tellOwner(`📰 Не могу писать в этот топик: ${escapeHtml(reason(err))}\n\nДай Фине право писать сообщения и повтори /log_on.`);
    return;
  }
  await setSetting('changelog_target', t);
  await setSetting('changelog_failed_at', null);
  await setSetting('changelog_warned', null);
  if (list.length) await setPosted(posted, entry.id);
  await tellOwner(`📰 Готово: новости об обновлениях Фини теперь приходят в «${escapeHtml(t.title || 'чат')}»` +
    `${t.thread_id ? ', в этот топик' : ''}. Свежая новость уже там.`);
}

async function tellOwner(text) {
  try {
    await api.sendMessage({ chat_id: OWNER_USER_ID, parse_mode: 'HTML', text: boldHtml(text) });
  } catch {
    // The owner's chat is closed: the error log has it.
  }
}

// /log — the next news; /log post — post it now instead of waiting for pump().
export async function command(message, args, owner, squad) {
  if (!(await allowed(message, owner, squad))) return;
  const group = message.chat.type !== 'private';
  if (group) await dropCommand(message);
  if ((args[0] || '').toLowerCase() !== 'post') {
    if (group) return;
    const { list } = await pending();
    const entry = list[0] || CHANGES[0];
    const t = await target();
    const state = list.length ? 'Ещё не в топике: выйдет сама после выката, или сразу — /log post.' : 'Уже в топике.';
    await reply(message, `📰 Новость для CHANGELOG\n${state}\n\nКуда: ${escapeHtml(t.title || 'чат')}${t.thread_id ? ' · топик' : ''}. ` +
      'Сменить: /log_on прямо в нужном топике.');
    await withPremium({ chat_id: message.chat.id, text: newsText(entry), parse_mode: 'HTML' }, (p) => api.sendMessage(p));
    return;
  }
  const { status, why } = await postNext({ manual: true });
  if (group) return;
  if (status === 'posted') await reply(message, '✅ Новость опубликована в CHANGELOG.');
  else if (status === 'none') await reply(message, 'Это обновление уже в топике. Новая запись появится со следующим обновлением.');
  else if (status === 'failed') {
    await reply(message, `❌ Не вышло опубликовать: ${escapeHtml(why)}\n\nОтправь /log_on прямо в топике для новостей, ` +
      'или проверь, что Финя может там писать.');
  }
}
