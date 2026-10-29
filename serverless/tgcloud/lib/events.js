// Финя as the Squad's event manager, on her own in each Squad chat:
// - a quiz (riddle, anagram or sum) at 10:30, 13:30 … 22:30: the first right answer
//   in the chat takes QUIZ_XP; after QUIZ_TTL nobody did and the answer is shown;
// - «Персонажи дня» once a day from 10:00: three titles for three active members;
// - a topic to talk about when the chat is quiet for REVIVE_AFTER in the daytime;
// - «Завтра в Скваде» from 18:00: birthdays, anniversaries and holidays of tomorrow.
// pump() runs on updates only, so everything happens at the first wake-up in its window.
// asked_questions keeps every riddle, word, sum and topic ever posted: none repeats.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { getSetting, logError } from './store.js';
import { boldHtml, escapeHtml, MSK_OFFSET, nowInt, truncate } from './util.js';
import { squadChatIds } from './xpchat.js';
import * as hall from './hall.js';
import { mskDay, namesOf } from './members.js';
import * as xp from './xp.js';

const HOUR = 3600;
export const QUIZ_XP = 15;
export const QUIZ_TTL = HOUR;
export const REVIVE_AFTER = 2 * HOUR;
const REVIVE_GAP = 4 * HOUR;
const QUIZ_EVERY = 3 * HOUR;
const MAX_ANSWER_WORDS = 6;

// [question, [accepted answers]]; the first answer is the one shown.
export const RIDDLES = [
  ['Зимой и летом одним цветом. Что это?', ['ёлка', 'ель', 'елка', 'ёлочка']],
  ['Сидит дед, во сто шуб одет. Кто его раздевает, тот слёзы проливает.', ['лук']],
  ['Без окон, без дверей, полна горница людей.', ['огурец']],
  ['Что можно увидеть с закрытыми глазами?', ['сон', 'сны']],
  ['Что становится больше, если его поставить вверх ногами?', ['6', 'шесть', 'цифра 6']],
  ['У кого есть шляпа без головы и нога без ботинка?', ['гриб']],
  ['Что принадлежит тебе, но другие пользуются этим чаще?', ['имя']],
  ['Чем больше из неё берёшь, тем больше она становится.', ['яма']],
  ['Что можно сломать, даже не прикасаясь?', ['обещание', 'слово']],
  ['Висит груша, нельзя скушать.', ['лампочка', 'лампа']],
  ['Не лает, не кусает, а в дом не пускает.', ['замок']],
  ['Что идёт, не двигаясь с места?', ['время', 'часы']],
  ['Сто одёжек и все без застёжек.', ['капуста', 'кочан']],
  ['Что у человека всегда впереди, но его не видно?', ['будущее']],
  ['Какой рукой лучше размешивать чай?', ['ложкой', 'никакой']],
  ['Что можно приготовить, но нельзя съесть?', ['уроки', 'домашку', 'домашнее задание']],
  ['Летит, а не птица, жужжит, а не жук.', ['самолет', 'самолёт', 'вертолет', 'вертолёт', 'дрон']],
  ['На какой вопрос нельзя ответить «да»?', ['ты спишь', 'ты спишь?', 'спишь']],
  ['Кто ходит сидя?', ['шахматист']],
  ['Без рук, без ног, а ворота открывает.', ['ветер']],
  ['Что можно держать, не касаясь руками?', ['слово', 'обещание']],
  ['Чем больше сохнет, тем мокрее становится.', ['полотенце']],
  ['Кто говорит на всех языках?', ['эхо']],
  ['Сколько горошин входит в пустой стакан?', ['ни одной', 'нисколько', '0', 'ноль']],
  ['Что поднимается, но никогда не опускается?', ['возраст']],
  ['Чего нет у самого быстрого бегуна, но есть у самого медленного?', ['время', 'последнее место']],
  ['У отца есть сын, но сын отцу не сын. Кто это?', ['дочь', 'дочка']],
  ['Что исчезает, как только назовёшь его?', ['тишина']],
  ['Что можно бросить, но нельзя поймать?', ['взгляд']],
  ['Красная девица сидит в темнице, а коса на улице.', ['морковь', 'морковка']],
  ['Какое слово всегда звучит неправильно?', ['неправильно']],
  ['Что легче пуха, но удержать долго нельзя?', ['дыхание', 'вдох']],
  ['Чем больше берёшь, тем больше оставляешь. Что это?', ['шаги', 'следы', 'шаг']],
  ['Когда человек бывает в комнате без головы?', ['когда высовывает голову в окно', 'в окно']],
  ['Что можно разбить, но нельзя склеить?', ['сердце', 'яйцо']],
  ['Что не войдёт даже в самую большую кастрюлю?', ['ее крышка', 'крышка', 'её крышка']],
  ['Какая птица состоит из буквы и реки?', ['иволга']],
  ['Что можно передать, но нельзя потрогать?', ['привет']],
  ['Кто ночью шуршит в холодильнике, а утром делает вид, что спал?', ['кот']],
  ['Что всегда идёт, но никогда не приходит?', ['завтра']],
  ['Я круглое, вкусное, с дыркой. Полицейские меня любят.', ['пончик', 'донат']],
  ['Чем заканчиваются день и ночь?', ['мягким знаком', 'мягкий знак']],
  ['Сам пустой, а голос густой, дробь отбивает, ребят созывает.', ['барабан']],
  ['Что у Бати всегда при себе в споре?', ['тапок', 'тапки', 'аргумент', 'ремень']],
  ['Какой месяц самый короткий?', ['май', 'февраль']],
  ['Что нужно отдать, чтобы его сохранить?', ['слово', 'обещание']],
  ['Летом серый, зимой белый, прыгает по лесу смело.', ['заяц']],
];

const WORDS = [
  'пельмень', 'шаурма', 'батон', 'капибара', 'енот', 'голубь', 'тапок', 'сквад', 'ачивка', 'модератор',
  'холодильник', 'будильник', 'понедельник', 'кефир', 'борщ', 'майонез', 'пицца', 'бутерброд', 'чайник', 'пингвин',
  'черепаха', 'страус', 'бегемот', 'крокодил', 'жираф', 'хомяк', 'попугай', 'медведь', 'лисица', 'кролик',
  'телефон', 'зарядка', 'наушники', 'ноутбук', 'клавиатура', 'монитор', 'интернет', 'стример', 'подписка', 'смайлик',
  'стикер', 'реакция', 'профиль', 'звание', 'лавка', 'казино', 'награда', 'турнир', 'чемпион', 'легенда',
  'тыква', 'призрак', 'вампир', 'скелет', 'паутина', 'метла', 'ёлка', 'снеговик', 'гирлянда', 'мандарин',
  'шоколад', 'мороженое', 'печенье', 'пончик', 'вареник', 'сосиска', 'котлета', 'макароны', 'огурец', 'помидор',
  'картошка', 'морковь', 'капуста', 'арбуз', 'клубника', 'малина', 'вишня', 'лимонад', 'компот', 'какао',
  'диван', 'подушка', 'одеяло', 'кровать', 'шкаф', 'зеркало', 'лампочка', 'батарея', 'утюг', 'пылесос',
  'самокат', 'велосипед', 'автобус', 'трамвай', 'метро', 'самолёт', 'ракета', 'спутник', 'планета', 'комета',
  'дракон', 'единорог', 'русалка', 'волшебник', 'рыцарь', 'принцесса', 'пират', 'сокровище', 'остров', 'вулкан',
  'гроза', 'радуга', 'сугроб', 'ураган', 'туман', 'ветер', 'листопад', 'подснежник', 'ромашка', 'кактус',
  'школа', 'экзамен', 'учебник', 'дневник', 'каникулы', 'перемена', 'тетрадь', 'линейка', 'карандаш', 'рюкзак',
  'футбол', 'баскетбол', 'шахматы', 'гантели', 'скакалка', 'коньки', 'лыжи', 'бассейн', 'стадион', 'свисток',
  'гитара', 'барабан', 'пианино', 'микрофон', 'концерт', 'танцы', 'караоке', 'кинотеатр', 'попкорн', 'билет',
];

export const TOPICS = [
  'Самый кринжовый случай из школы. Начинайте, я жду 🍿',
  'Какую суперспособность вы бы выбрали и что бы с ней натворили?',
  'Какая еда переоценена? Только честно.',
  'Самая тупая вещь, на которую вы потратили деньги?',
  'Если бы чат Сквада был страной, какой у неё был бы гимн?',
  'Какой фильм или сериал вы пересматривали больше всего раз?',
  'Расскажите про самый странный сон за последнее время.',
  'Какую игру вы бы посоветовали всему Скваду прямо сейчас?',
  'Что вы делаете, когда никто не видит? Без подробностей, если что 👀',
  'Ваш самый неловкий момент на людях?',
  'Какое правило вы бы добавили в чат Сквада?',
  'Если бы можно было жить в любой игре, какую выберете?',
  'Самая странная еда, которую вы пробовали?',
  'Кем вы хотели стать в детстве и что пошло не так?',
  'Какой звук бесит вас сильнее всего?',
  'Что бы вы сделали с миллионом рублей за один день?',
  'Какой самый полезный лайфхак вы знаете?',
  'Расскажите историю, в которую никто не поверит, но она правда.',
  'Какую песню вы стесняетесь, но слушаете на повторе?',
  'Если бы у вас был питомец-дракон, как бы вы его назвали?',
  'Самый смешной мем недели. Кидайте сюда 🐸',
  'Где вы мечтаете побывать хотя бы раз?',
  'Чему бы вы научили Финю, если бы могли?',
  'Самая бесполезная вещь, которую вы умеете делать?',
  'Какую привычку вы бы хотели в себе убить?',
  'Что для вас идеальные выходные?',
  'Что вас больше всего удивило за эту неделю?',
  'Какой школьный предмет был худшим и почему?',
  'Вы проснулись в теле кота. Ваш план на день?',
  'Какой вопрос вы бы задали себе из будущего?',
  'Самое странное, что вы гуглили?',
  'Ваш топ-3 вкусняшек на ночь?',
  'Какой персонаж из мультика — это вы?',
  'Что вы сделаете первым делом в зомби-апокалипсис?',
  'Какой подарок вам запомнился больше всего?',
  'Если бы вы вели свой канал, о чём бы он был?',
  'Что из детства вы бы вернули прямо сейчас?',
  'Самое безумное, что вы делали ради друга?',
  'Какая самая залипательная игра на телефоне?',
  'Какой спор вы до сих пор не выиграли?',
  'Опишите свой день тремя эмодзи 👇',
  'Скиньте фото того, что сейчас перед вами (если не стыдно) 📸',
  'Какую вещь вы бы никогда не продали ни за какие деньги?',
  'Что вы думаете про ананасы на пицце? Только без драк.',
  'Если бы Сквад снимал кино, кто бы кого играл?',
  'Чего вы боялись в детстве, а сейчас смешно?',
  'Какой самый долгий срок вы были без телефона?',
  'Ваше самое странное хобби?',
  'Кого из чата вы бы взяли с собой на необитаемый остров?',
  'Какой звук у вашего будильника и почему он ужасен?',
  'Если бы у вас было 3 желания, что бы вы загадали?',
  'Какую страну вы бы удалили с карты мира? Шучу, какую кухню мира вы любите?',
  'Какой ваш самый провальный кулинарный эксперимент?',
  'Чем вы гордитесь больше всего за этот год?',
  'Что вы сейчас слушаете? Кидайте трек 🎧',
  'Если бы можно было отменить одну вещь в мире, что бы это было?',
  'Какой фильм вас напугал сильнее всего?',
  'Ваш любимый мем всех времён?',
  'Чем бы вы занялись, если бы не нужно было работать или учиться?',
  'Какая у вас самая странная фобия?',
];

export const TITLES = [
  '🤡 Клоун дня', '💘 Краш дня', '👑 Звезда дня', '🦄 Единорог дня', '🐸 Жаба дня', '🧠 Мозг Сквада',
  '😴 Соня дня', '🕵️ Тайный агент дня', '🍕 Главный по пицце', '🔥 Огонь дня', '🐢 Тормоз дня', '💅 Дива дня',
  '🗿 Каменное лицо дня', '🎭 Драма дня', '🥟 Пельмень дня', '🦆 Утка дня', '🪳 Таракан дня', '🧙 Маг дня',
  '🤠 Ковбой дня', '🐒 Обезьянка дня', '🍌 Банан дня', '🥶 Ледышка дня', '💩 Какашка дня', '🦖 Динозавр дня',
  '🐙 Осьминог дня', '🌚 Тёмная лошадка дня', '🎰 Лудоман дня', '📢 Громкоговоритель дня', '🧽 Губка Боб дня',
  '🧌 Тролль дня', '🍞 Батон дня', '🥔 Картошка дня', '🐊 Крокодил дня', '🤖 Почти Финя дня', '🧸 Плюшка дня',
  '🪿 Гусь дня', '🦝 Енот-барыга дня', '🐐 Легенда дня', '🫠 Растаявший пломбир дня', '🛋 Диванный эксперт дня',
];

// ---- helpers ---------------------------------------------------------------------

const secOfDay = (ts) => (ts + MSK_OFFSET) % 86400;
const hourOf = (ts) => Math.floor(secOfDay(ts) / HOUR);

export function norm(text) {
  return String(text).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// A Fisher–Yates shuffle with Math.random, used for picks and anagrams.
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Takes the journal entry; false when it was there already.
async function fresh(key, chatId, ts) {
  const r = await db.run(sql`INSERT OR IGNORE INTO asked_questions (question, chat_id, asked_at)
    VALUES (${key}, ${chatId}, ${ts})`);
  return r.rowsAffected === 1;
}

// Once per `value` (a day or a slot number) per chat, whoever wakes first.
async function claim(key, value) {
  await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, ${String(value - 1)})`);
  const won = await db.run(sql`UPDATE settings SET value = ${String(value)}
    WHERE key = ${key} AND CAST(value AS INTEGER) < ${value}`);
  return won.rowsAffected === 1;
}

// The time of the last message from a member in the chat, 0 if none.
async function lastMessageAt(chatId) {
  const r = await db.get(sql`SELECT MAX(last_active) AS t FROM chat_members WHERE chat_id = ${chatId}`);
  return (r && r.t) || 0;
}

async function send(chatId, text, extra = {}) {
  return api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: boldHtml(text), ...extra });
}

// ---- quizzes ---------------------------------------------------------------------

function anagramOf(word) {
  const letters = Array.from(word.toUpperCase());
  for (let i = 0; i < 20; i++) {
    const s = shuffle(letters);
    if (s.join('') !== letters.join('')) return s.join(' ');
  }
  return [...letters].reverse().join(' ');
}

function randomInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function mathQuiz() {
  const kind = randomInt(0, 2);
  if (kind === 0) {
    const a = randomInt(120, 989); const b = randomInt(120, 989);
    return [`${a} + ${b}`, a + b];
  }
  if (kind === 1) {
    const a = randomInt(500, 1999); const b = randomInt(101, a - 50);
    return [`${a} − ${b}`, a - b];
  }
  const a = randomInt(12, 99); const b = randomInt(3, 19);
  return [`${a} × ${b}`, a * b];
}

// The next quiz nobody saw yet: riddles, anagrams and sums take turns.
// → { question, answers, shown }
export async function nextQuiz(chatId, ts) {
  const r = await db.run(sql`INSERT INTO settings (key, value) VALUES ('quiz_seq', '1')
    ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING value`);
  const n = Number(r.rows[0].value) - 1;
  const order = [n % 3, (n + 1) % 3, (n + 2) % 3];
  for (const kind of order) {
    if (kind === 0) {
      for (const [q, answers] of RIDDLES) {
        if (await fresh(`riddle:${q}`, chatId, ts)) {
          return { question: `🧩 Загадка:\n\n${q}`, answers, shown: answers[0] };
        }
      }
    } else if (kind === 1) {
      for (const word of shuffle(WORDS)) {
        if (await fresh(`anagram:${word}`, chatId, ts)) {
          return { question: `🔤 Собери слово из букв:\n\n${anagramOf(word)}`, answers: [word], shown: word };
        }
      }
    } else {
      for (let i = 0; i < 20; i++) {
        const [expr, value] = mathQuiz();
        if (await fresh(`math:${expr}`, chatId, ts)) {
          return { question: `🧮 Сколько будет ${expr}?`, answers: [String(value)], shown: String(value) };
        }
      }
    }
  }
  return null;
}

export async function postQuiz(chatId, ts = nowInt(), lead = '') {
  const quiz = await nextQuiz(chatId, ts);
  if (!quiz) return null;
  await db.run(sql`INSERT INTO quizzes (chat_id, question, answers, shown, posted_at, expires_at)
    VALUES (${chatId}, ${quiz.question}, ${JSON.stringify(quiz.answers)}, ${quiz.shown}, ${ts}, ${ts + QUIZ_TTL})`);
  await send(chatId, `${lead}${escapeHtml(quiz.question)}\n\n🏆 Кто первым ответит в чат, получит +${QUIZ_XP} XP. На ответ ${QUIZ_TTL / 60} минут.`);
  return quiz;
}

// A group message: the first right answer to the open quiz of the chat. → true if it won.
export async function checkAnswer(message, ts = nowInt()) {
  const text = typeof message.text === 'string' ? message.text : '';
  if (!text || !message.from || message.from.is_bot) return false;
  const quiz = await db.get(sql`SELECT * FROM quizzes WHERE chat_id = ${message.chat.id} AND done = 0
    AND expires_at > ${ts} ORDER BY id DESC LIMIT 1`);
  if (!quiz) return false;
  const said = norm(text);
  const words = said.split(' ');
  if (words.length > MAX_ANSWER_WORDS) return false;
  const padded = ` ${said} `;
  const right = JSON.parse(quiz.answers).some((a) => padded.includes(` ${norm(a)} `));
  if (!right) return false;
  const won = await db.run(sql`UPDATE quizzes SET done = 1, winner_id = ${message.from.id}
    WHERE id = ${quiz.id} AND done = 0`);
  if (won.rowsAffected !== 1) return false;
  const gift = await xp.grant(message.from, 'quiz', quiz.id, QUIZ_XP, ts);
  const name = escapeHtml(truncate((await namesOf([message.from.id]))(message.from.id), 40));
  await send(message.chat.id, `🎉 ${name} отвечает первым! Ответ: «${escapeHtml(quiz.shown)}». ${gift ? `+${gift.points} XP` : ''}`.trim(), {
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
  });
  return true;
}

// Quizzes past their time: the answer is shown.
async function expireQuizzes(ts) {
  const due = await db.all(sql`SELECT * FROM quizzes WHERE done = 0 AND expires_at <= ${ts} LIMIT 5`);
  for (const q of due) {
    const won = await db.run(sql`UPDATE quizzes SET done = 1 WHERE id = ${q.id} AND done = 0`);
    if (won.rowsAffected !== 1) continue;
    try {
      await send(q.chat_id, `⌛ Время вышло, никто не угадал. Ответ: «${escapeHtml(q.shown)}».`);
    } catch {
      // No rights in that chat any more.
    }
  }
}

// One quiz per 3-hour slot from 9:00, in its second half: 10:30, 13:30 … 22:30.
async function quizTick(chatId, ts) {
  const slot = Math.floor((ts + MSK_OFFSET) / QUIZ_EVERY);
  const hour = (slot * 3) % 24;
  if (hour < 9 || hour > 21) return;
  if ((ts + MSK_OFFSET) % QUIZ_EVERY < QUIZ_EVERY / 2) return;
  if ((await lastMessageAt(chatId)) < ts - 86400) return;
  const open = await db.get(sql`SELECT 1 AS n FROM quizzes WHERE chat_id = ${chatId} AND done = 0`);
  if (open) return;
  if (!(await claim(`quiz_slot:${chatId}`, slot))) return;
  await postQuiz(chatId, ts);
}

// ---- «Персонажи дня» ---------------------------------------------------------------

export async function personaText(chatId, ts) {
  const since = mskDay(ts) - 2;
  const rows = await db.all(sql`SELECT a.user_id FROM chat_activity a
    JOIN chat_members m ON m.chat_id = a.chat_id AND m.user_id = a.user_id AND m.status = 'member'
    WHERE a.chat_id = ${chatId} AND a.day >= ${since} GROUP BY a.user_id`);
  if (rows.length < 3) return null;
  const who = shuffle(rows.map((r) => r.user_id)).slice(0, 3);
  const titles = shuffle(TITLES).slice(0, 3);
  const name = await namesOf(who);
  const lines = who.map((id, i) => `${titles[i]} — ${escapeHtml(name(id))}`);
  return `🎭 Персонажи дня по версии Фини:\n\n${lines.join('\n')}\n\nОбжалованию не подлежит 😈`;
}

async function personaTick(chatId, ts) {
  const hour = hourOf(ts);
  if (hour < 10 || hour >= 22) return;
  if (!(await claim(`persona_day:${chatId}`, mskDay(ts)))) return;
  const text = await personaText(chatId, ts);
  if (text) await send(chatId, text);
}

// ---- revive a quiet chat ------------------------------------------------------------

async function reviveTick(chatId, ts) {
  const hour = hourOf(ts);
  if (hour < 11 || hour >= 23) return;
  const last = await lastMessageAt(chatId);
  if (!last || last > ts - REVIVE_AFTER || last < ts - 3 * 86400) return;
  // Not right after Финя's own poll or quiz.
  const recent = await db.get(sql`SELECT
      (SELECT MAX(posted_at) FROM question_polls WHERE chat_id = ${chatId}) AS p,
      (SELECT MAX(posted_at) FROM quizzes WHERE chat_id = ${chatId}) AS q`);
  if (Math.max(recent.p || 0, recent.q || 0) > ts - 45 * 60) return;
  if (!(await claim(`revive:${chatId}`, Math.floor(ts / REVIVE_GAP)))) return;
  for (const topic of shuffle(TOPICS)) {
    if (await fresh(`topic:${topic}`, chatId, ts)) {
      await send(chatId, `😴 Чат, вы где? ${Math.floor((ts - last) / HOUR)} ч тишины.\n\n💬 Тема: ${escapeHtml(topic)}`);
      return;
    }
  }
}

// ---- «Завтра в Скваде» --------------------------------------------------------------

export async function tomorrowText(ts) {
  const events = await hall.calendarOn(1, ts);
  if (!events.length) return null;
  const name = await namesOf(events.flatMap((e) => e.who));
  const lines = events.slice(0, 12).map((e) => {
    if (e.kind === 'holiday') return `${e.icon} ${escapeHtml(e.title)}`;
    if (e.kind === 'birthday') return `🎂 День рождения: ${escapeHtml(name(e.who[0]))}`;
    return `${e.icon} ${e.who.map((id) => escapeHtml(name(id))).join(' и ')}: ${escapeHtml(e.sub)}`;
  });
  return `📅 Завтра в Скваде:\n\n${lines.join('\n')}\n\nНе забудьте поздравить 🎉`;
}

async function announceTick(chatId, ts, text) {
  if (hourOf(ts) < 18) return;
  if (!(await claim(`announce_day:${chatId}`, mskDay(ts)))) return;
  if (text) await send(chatId, text);
}

// ---- tick ----------------------------------------------------------------------------

// From chat.tick() on every pump. Each part guards itself and fails on its own.
export async function tick(ts = nowInt()) {
  try {
    await expireQuizzes(ts);
  } catch (err) {
    await logError('events.quiz', err);
  }
  if (!(await getSetting('chat_events'))) return;
  let tomorrow;
  for (const chatId of await squadChatIds()) {
    for (const [name, fn] of [['events.quiz', quizTick], ['events.persona', personaTick], ['events.revive', reviveTick]]) {
      try {
        await fn(chatId, ts);
      } catch (err) {
        await logError(name, err);
      }
    }
    try {
      if (hourOf(ts) >= 18 && tomorrow === undefined) tomorrow = await tomorrowText(ts);
      await announceTick(chatId, ts, tomorrow);
    } catch (err) {
      await logError('events.announce', err);
    }
  }
}
