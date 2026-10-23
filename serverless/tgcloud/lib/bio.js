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

// Degrees 1–8, as Iris has them.
export const AWARD_DEGREES = ['🎗', '🥉', '🥈', '🥇', '🎖', '🏅', '🏆', '🏵'];
export const degreeIcon = (degree) => AWARD_DEGREES[Math.min(Math.max(degree || 1, 1), AWARD_DEGREES.length) - 1];

// Highest degree first, then newest; that order also numbers them for «снять награду N».
export async function awardsOf(userId, limit = AWARDS_PER_USER) {
  return db.all(sql`SELECT a.id, a.text, a.given_at, a.given_by, COALESCE(d.degree, 1) AS degree
    FROM awards a LEFT JOIN award_degrees d ON d.award_id = a.id WHERE a.user_id = ${userId}
    ORDER BY COALESCE(d.degree, 1) DESC, a.given_at DESC, a.id DESC LIMIT ${limit}`);
}

// «Наградить 4\n«Агент» с. Иван» or «Наградить 4 @ник\nТекст»: a first line of only a degree
// (and maybe the mention) sets the degree. Anything else is the old «Наградить Текст»,
// degree 1: «Наградить 1 место в квизе» stays a title. → { degree, text }
export function parseAward(value) {
  const raw = String(value || '');
  const m = /^\s*(\d{1,2})(?:\s+@\w+)?\s*\n([\s\S]*)$/u.exec(raw);
  if (m) {
    const degree = Number(m[1]);
    if (degree < 1 || degree > AWARD_DEGREES.length) {
      throw new BioError(`Степень награды — от 1 до ${AWARD_DEGREES.length}: ${AWARD_DEGREES.join(' ')}.`);
    }
    return { degree, text: m[2] };
  }
  if (/^\s*\d{1,2}(?:\s+@\w+)?\s*$/u.test(raw)) throw new BioError('Текст награды пиши с новой строки: «Наградить 4» и ниже название.');
  // «наградить @ник Текст»: the mention is not part of the award.
  return { degree: 1, text: raw.replace(/^\s*@\w+\s*/u, '') };
}

export async function giveAward(chatId, fromId, toId, value, degree = 1) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new BioError('Напиши название награды с новой строки: «Наградить 4» и ниже текст.');
  if (Array.from(clean).length > AWARD_MAX) throw new BioError(`Название награды — до ${AWARD_MAX} символов.`);
  const count = await db.get(sql`SELECT COUNT(*) AS c FROM awards WHERE user_id = ${toId}`);
  if (count.c >= AWARDS_PER_USER) throw new BioError(`У участника уже ${AWARDS_PER_USER} наград. Сними старую: «Снять Награду N».`);
  const r = await db.run(sql`INSERT INTO awards (user_id, text, chat_id, given_by, given_at)
    VALUES (${toId}, ${clean}, ${chatId}, ${fromId}, ${nowInt()})`);
  if (degree > 1) {
    const row = await db.get(sql`SELECT id FROM awards WHERE user_id = ${toId} ORDER BY id DESC LIMIT 1`);
    await db.run(sql`INSERT OR REPLACE INTO award_degrees (award_id, degree) VALUES (${row.id}, ${degree})`);
  }
  return clean;
}

async function dropAwards(ids) {
  for (const id of ids) {
    await db.run(sql`DELETE FROM awards WHERE id = ${id}`);
    await db.run(sql`DELETE FROM award_degrees WHERE award_id = ${id}`);
  }
  return ids.length;
}

// n: the place in «награды», from 1. → the removed award ({ text, degree }), or null.
export async function removeAward(userId, n) {
  const list = await awardsOf(userId);
  const award = list[n - 1];
  if (!award) return null;
  await dropAwards([award.id]);
  return award;
}

// «Снять все награды» → how many were removed.
export async function removeAllAwards(userId) {
  return dropAwards((await awardsOf(userId)).map((a) => a.id));
}

// «Снять награды от»: the member drops what the other one gave them. → how many.
export async function removeAwardsFrom(userId, giverId) {
  return dropAwards((await awardsOf(userId)).filter((a) => a.given_by === giverId).map((a) => a.id));
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
