// «Вопрос дня»: at noon (Moscow) Финя posts a poll in each Squad chat to talk about.
// The questions go round in order, so none repeats until all were asked.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import * as feats from './feats.js';
import { getSetting, setSetting } from './store.js';
import { MSK_OFFSET, nowInt } from './util.js';
import { squadChatIds } from './xpchat.js';
import * as members from './members.js';

export const QUESTION_AT = 12 * 3600;
const QUESTION_LATE_UNTIL = 20 * 3600;

export const QUESTIONS = [
  ['Пицца с ананасами — это…', ['Шедевр 🍍', 'Преступление 🚫', 'Не знаю, не пробую 🤔']],
  ['Что лучше утром?', ['Кофе ☕', 'Чай 🍵', 'Ещё поспать 😴']],
  ['Сова или жаворонок?', ['Сова 🦉', 'Жаворонок 🐦', 'Вечно не выспавшийся 🧟']],
  ['Кошки или собаки?', ['Кошки 🐱', 'Собаки 🐶', 'Оба 💕', 'Никто']],
  ['Лето или зима?', ['Лето ☀️', 'Зима ❄️', 'Осень 🍂', 'Весна 🌸']],
  ['Сколько вкладок открыто у тебя в браузере?', ['До 5', '5–20', '20–50', 'Больше 50 💀']],
  ['Идеальный вечер пятницы', ['Тусовка 🎉', 'Игры 🎮', 'Сериал и плед 🛋', 'Сон 😴']],
  ['Ты читаешь правила перед тем, как писать в чат?', ['Всегда 📜', 'Иногда', 'Какие правила?']],
  ['Пельмени или вареники?', ['Пельмени 🥟', 'Вареники 🥟', 'И то и другое']],
  ['Голосовые сообщения — это…', ['Удобно 🎤', 'Зло 😤', 'Только короткие']],
  ['Сколько часов спишь в среднем?', ['Меньше 5', '5–7', '7–9', 'Больше 9 😴']],
  ['Какой стрим посмотрим?', ['Игры 🎮', 'Общение 💬', 'Музыка 🎶', 'Творчество 🎨']],
  ['Шаурма или шаверма?', ['Шаурма 🌯', 'Шаверма 🌯', 'Донер 🥙']],
  ['Какую суперспособность берёшь?', ['Телепортация ✨', 'Невидимость 👻', 'Чтение мыслей 🧠', 'Полёт 🕊']],
  ['Ты больше…', ['Пишешь в чат ✍️', 'Читаешь молча 👀', 'Ставишь реакции ❤️']],
  ['Майонез — это…', ['Соус 🥫', 'Образ жизни 😎', 'Нет, спасибо']],
  ['Лучший мем-формат', ['Картинки 🖼', 'Видео 🎬', 'Стикеры 🧩', 'Голосовые 🎤']],
  ['Сладкое или солёное?', ['Сладкое 🍫', 'Солёное 🥨', 'Острое 🌶']],
  ['Будильник звонит. Ты…', ['Встаю сразу ⏰', 'Ещё 5 минут 😴', 'Переставляю 3 раза', 'Какой будильник? 😴']],
  ['Чем займёмся в Скваде на выходных?', ['Ивент 🎉', 'Совместная игра 🎮', 'Стрим 📺', 'Отдыхаем 🛋']],
  ['Телефон: сколько процентов зарядки — уже паника?', ['50% 😰', '20%', '5%', 'Живу на 1% 😎']],
  ['Какой Telegram-клиент?', ['Телефон 📱', 'ПК 💻', 'Веб 🌐', 'Всё сразу']],
  ['Фильм или сериал?', ['Фильм 🎬', 'Сериал 📺', 'Аниме 🍥', 'Ютуб ▶️']],
  ['Чай с сахаром?', ['Да 🍬', 'Нет', 'С мёдом 🍯']],
  ['Полёт на Марс: летим?', ['Хоть завтра 🚀', 'Только с Wi‑Fi 📶', 'Мне и тут норм 🌍']],
  ['Лучшее время для чата', ['Утро 🌅', 'День ☀️', 'Вечер 🌆', 'Ночь 🌙']],
  ['Какой ты в споре?', ['Спорю до конца 🔥', 'Соглашаюсь ради мира 🕊', 'Ухожу смотреть мемы 🐸']],
  ['Нужна ли Фине новая функция?', ['Да, больше игр 🎲', 'Больше РП 🤗', 'Больше наград 🏅', 'Всё и так топ 🔥']],
  ['Какая погода лучше?', ['Солнце ☀️', 'Дождь 🌧', 'Снег ❄️', 'Гроза ⛈']],
  ['Что берём на необитаемый остров?', ['Телефон 📱', 'Нож 🔪', 'Друга 🫂', 'Пиццу 🍕']],
];

// The next question for a chat, round-robin by a counter in settings.
async function nextQuestion(chatId) {
  const key = `question_next:${chatId}`;
  await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, '0')`);
  const r = await db.run(sql`UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    WHERE key = ${key} RETURNING value`);
  const n = Number(r.rows[0].value) - 1;
  return QUESTIONS[((n % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
}

export async function postQuestion(chatId) {
  const [question, options] = await nextQuestion(chatId);
  const sent = await api.sendPoll({
    chat_id: chatId,
    question: `❓ Вопрос дня: ${question}`,
    options: options.map((text) => ({ text })),
    is_anonymous: false,
  });
  // Only today's poll of each chat counts for «Мнение дня».
  if (sent && sent.poll) await setSetting(`question_poll:${chatId}`, String(sent.poll.id));
  return sent;
}

// poll_answer: a vote in today's «Вопрос дня» counts once a day; taking it back does not.
export async function onPollAnswer(answer) {
  const u = answer.user;
  if (!u || u.is_bot || !answer.option_ids || !answer.option_ids.length) return;
  const ours = await db.get(sql`SELECT 1 AS n FROM settings WHERE key LIKE 'question_poll:%'
    AND value = ${JSON.stringify(String(answer.poll_id))}`);
  if (ours) await feats.bumpDaily(u.id, 'qday');
}

// From tick(): once a day after noon in each Squad chat, until 20:00 if nothing woke the bot.
export async function tick(ts = nowInt()) {
  const sec = (ts + MSK_OFFSET) % 86400;
  if (sec < QUESTION_AT || sec >= QUESTION_LATE_UNTIL) return;
  if (!(await getSetting('chat_question'))) return;
  const day = members.mskDay(ts);
  for (const chatId of await squadChatIds()) {
    const key = `question_day:${chatId}`;
    await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, ${String(day - 1)})`);
    const won = await db.run(sql`UPDATE settings SET value = ${String(day)}
      WHERE key = ${key} AND CAST(value AS INTEGER) < ${day}`);
    if (won.rowsAffected !== 1) continue;
    try {
      await postQuestion(chatId);
    } catch {
      // No rights to post polls in that chat.
    }
  }
}
