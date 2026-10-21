// «О себе» and awards of the profile, like Iris has them. A member writes a few lines
// about themselves («+описание …»); chat admins hand out awards («наградить …»).
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { nowInt } from './util.js';

export const ABOUT_MAX = 300;
export const AWARD_MAX = 60;
export const AWARDS_PER_USER = 30;

export class BioError extends Error {}

export async function aboutOf(userId) {
  const row = await db.get(sql`SELECT text FROM profile_about WHERE user_id = ${userId}`);
  return row ? row.text : null;
}

// Up to five lines and ABOUT_MAX characters, blank lines dropped.
export async function setAbout(userId, value) {
  const lines = String(value || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const clean = lines.slice(0, 5).join('\n');
  if (!clean) throw new BioError('Напиши текст после «+Описание».');
  if (Array.from(clean).length > ABOUT_MAX) throw new BioError(`Длинновато: до ${ABOUT_MAX} символов.`);
  await db.run(sql`INSERT INTO profile_about (user_id, text, updated_at) VALUES (${userId}, ${clean}, ${nowInt()})
    ON CONFLICT(user_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`);
  return clean;
}

export async function clearAbout(userId) {
  const r = await db.run(sql`DELETE FROM profile_about WHERE user_id = ${userId}`);
  return r.rowsAffected > 0;
}

// Newest first; that order also numbers them for «снять награду N».
export async function awardsOf(userId, limit = AWARDS_PER_USER) {
  return db.all(sql`SELECT id, text, given_at FROM awards WHERE user_id = ${userId}
    ORDER BY given_at DESC, id DESC LIMIT ${limit}`);
}

export async function giveAward(chatId, fromId, toId, value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new BioError('Напиши название награды: «Наградить Лучший мем недели».');
  if (Array.from(clean).length > AWARD_MAX) throw new BioError(`Название награды — до ${AWARD_MAX} символов.`);
  const count = await db.get(sql`SELECT COUNT(*) AS c FROM awards WHERE user_id = ${toId}`);
  if (count.c >= AWARDS_PER_USER) throw new BioError(`У участника уже ${AWARDS_PER_USER} наград. Сними старую: «Снять Награду N».`);
  await db.run(sql`INSERT INTO awards (user_id, text, chat_id, given_by, given_at)
    VALUES (${toId}, ${clean}, ${chatId}, ${fromId}, ${nowInt()})`);
  return clean;
}

// n: the place in «награды», from 1. → the removed award's text, or null.
export async function removeAward(userId, n) {
  const list = await awardsOf(userId);
  const award = list[n - 1];
  if (!award) return null;
  await db.run(sql`DELETE FROM awards WHERE id = ${award.id}`);
  return award.text;
}

// ---- nick ------------------------------------------------------------------------

export const NICK_MAX = 24;

export async function nickOf(userId) {
  const row = await db.get(sql`SELECT nick FROM nicks WHERE user_id = ${userId}`);
  return row ? row.nick : null;
}

// One line, up to NICK_MAX characters; no links or mentions.
export async function setNick(userId, value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new BioError('Напиши ник после «+Ник»: «+Ник Вася».');
  if (Array.from(clean).length > NICK_MAX) throw new BioError(`Ник — до ${NICK_MAX} символов.`);
  if (/@|https?:|t\.me\//iu.test(clean)) throw new BioError('В нике не должно быть ссылок и @.');
  await db.run(sql`INSERT INTO nicks (user_id, nick, updated_at) VALUES (${userId}, ${clean}, ${nowInt()})
    ON CONFLICT(user_id) DO UPDATE SET nick = excluded.nick, updated_at = excluded.updated_at`);
  return clean;
}

export async function clearNick(userId) {
  const r = await db.run(sql`DELETE FROM nicks WHERE user_id = ${userId}`);
  return r.rowsAffected > 0;
}
