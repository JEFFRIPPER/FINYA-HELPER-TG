// Positions of the Squad team: the owner appoints («+должность Креативщик» in reply),
// «штаб» lists the team, «должность» shows someone's duties. Apart from the XP ranks:
// a rank is experience, a position is a job in the Squad. No Telegram rights come with it.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { nowInt, truncate } from './util.js';

export const PER_USER = 3;

// `code` is stored in the table: never rename. Words are matched without case, «ё» and dashes.
export const POSITIONS = [
  {
    code: 'content', emoji: '📝', title: 'Контент-менеджер', words: ['контент-менеджер', 'контент менеджер', 'контентщик', 'контент'],
    duties: ['Оформление постов', 'Публикация контента', 'Расписание постинга', 'Проверка качества материала'],
    motto: 'Делает так, чтобы канал выглядел охуенно.',
  },
  {
    code: 'creative', emoji: '🎨', title: 'Креативщик / Дизайнер', words: ['креативщик', 'дизайнер', 'креатив'],
    duties: ['Аватарки', 'Баннеры', 'Стикеры', 'Визуал постов', 'Фирменный стиль'],
    motto: 'Визуальный движ.',
  },
  {
    code: 'events', emoji: '🎉', title: 'Ивент-менеджер', words: ['ивент-менеджер', 'ивент менеджер', 'ивентщик', 'ивенты'],
    duties: ['Конкурсы', 'Интерактивы', 'Опросы', 'Игровые ивентовые активности'],
    motto: 'Чтоб чат не сдох от скуки.',
  },
  {
    code: 'tech', emoji: '🛠', title: 'Тех. администратор', words: ['тех. администратор', 'тех администратор', 'техадмин', 'тех админ', 'техник'],
    duties: ['Настройка ботов', 'Антиспам', 'Авто-модерация', 'Права доступа', 'Фиксы технических проблем'],
    motto: 'Тот, кто чинит всю хуйню.',
  },
  {
    code: 'community', emoji: '🤝', title: 'Комьюнити-менеджер', words: ['комьюнити-менеджер', 'комьюнити менеджер', 'комьюнити'],
    duties: ['Общение с участниками', 'Сбор идей и жалоб', 'Адаптация новичков', 'Поддержание вайба'],
    motto: 'Лицо проекта.',
  },
  {
    code: 'activity', emoji: '📊', title: 'Модератор активности', words: ['модератор активности'],
    duties: ['Раз в месяц проверка активности участников', 'Анализ комментариев и постов ТГК',
      'Решения о том, кто остаётся в чате, а кого удалить'],
    motto: 'Следит, чтобы в Скваде были живые люди.',
  },
  {
    code: 'moderator', emoji: '🛡', title: 'Модератор чата', words: ['модератор чата', 'модератор', 'модер'],
    duties: ['Следить за соблюдением правил и порядком', 'Мут за нарушения правил',
      'Беседы с нарушителями: объяснить нарушение и потребовать его прекратить',
      'Сообщать администрации о серьёзных нарушениях и конфликтах', 'Не допускать разжигания конфликтов и провокаций'],
    motto: 'Порядок в чате.',
  },
  {
    code: 'admin', emoji: '⚔️', title: 'Администратор чата', words: ['администратор чата', 'администратор', 'админ чата'],
    duties: ['Контроль работы модераторов и соблюдения правил', 'Варны за нарушения', 'Удаление сообщений, нарушающих правила',
      'Баны по тяжести нарушения', 'Спорные ситуации, повторные нарушения и жалобы', 'Окончательные решения по модерации'],
    motto: 'Последнее слово в вопросах порядка.',
  },
];

export class StaffError extends Error {}

const BY_CODE = new Map(POSITIONS.map((p) => [p.code, p]));
const clean = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s\-–—.\/]+/g, ' ').trim();
const BY_WORD = new Map(POSITIONS.flatMap((p) => [p.title, ...p.words].map((w) => [clean(w), p])));

export const byCode = (code) => BY_CODE.get(code) || null;
export const find = (words) => BY_WORD.get(clean(words)) || null;

// A member's positions, in the catalog's order.
export async function positionsOf(userId) {
  const rows = await db.all(sql`SELECT code FROM positions WHERE user_id = ${userId}`);
  const have = new Set(rows.map((r) => r.code));
  return POSITIONS.filter((p) => have.has(p.code));
}

// → true when it is new for them. `name` keeps «штаб» readable for someone Финя
// hasn't seen write yet.
export async function appoint(userId, position, byId, name = '', ts = nowInt()) {
  const have = await positionsOf(userId);
  if (have.some((p) => p.code === position.code)) return false;
  if (have.length >= PER_USER) throw new StaffError(`Больше ${PER_USER} должностей одному человеку не дать. Сначала сними лишнюю: «-Должность …».`);
  if (name) await db.run(sql`INSERT OR IGNORE INTO profiles (user_id, name) VALUES (${userId}, ${truncate(name, 100)})`);
  await db.run(sql`INSERT OR IGNORE INTO positions (user_id, code, given_by, given_at)
    VALUES (${userId}, ${position.code}, ${byId}, ${ts})`);
  return true;
}

export async function dismiss(userId, position) {
  const r = await db.run(sql`DELETE FROM positions WHERE user_id = ${userId} AND code = ${position.code}`);
  return r.rowsAffected > 0;
}

// The whole team: [{ position, people: [{ user_id, since }] }], every position listed.
export async function team() {
  const rows = await db.all(sql`SELECT user_id, code, given_at FROM positions ORDER BY given_at, user_id`);
  return POSITIONS.map((p) => ({ position: p, people: rows.filter((r) => r.code === p.code) }));
}
