// Families of the Squad chats: «Усыновить» in reply makes the other member a son or a
// daughter (by «+Пол» in the anketa, else just a child). A child has up to two
// parents, a parent up to MAX_CHILDREN children; the child agrees with a button.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { nowInt } from './util.js';
import * as social from './social.js';

export const MAX_CHILDREN = 10;
export const MAX_PARENTS = 2;
export const OFFER_TTL = 3600;

export class FamilyError extends Error {}

// [{ child_id, since }], the eldest in the family first.
export async function childrenOf(userId) {
  return db.all(sql`SELECT child_id, since FROM children WHERE parent_id = ${userId} ORDER BY since, child_id`);
}

// [{ parent_id, since }].
export async function parentsOf(userId) {
  return db.all(sql`SELECT parent_id, since FROM children WHERE child_id = ${userId} ORDER BY since, parent_id`);
}

// Other children of the member's parents: [child_id].
export async function siblingsOf(userId) {
  const rows = await db.all(sql`SELECT DISTINCT c.child_id FROM children c
    JOIN children me ON me.parent_id = c.parent_id
    WHERE me.child_id = ${userId} AND c.child_id != ${userId} ORDER BY c.child_id`);
  return rows.map((r) => r.child_id);
}

export async function isParent(parentId, childId) {
  return Boolean(await db.get(sql`SELECT 1 AS n FROM children WHERE parent_id = ${parentId} AND child_id = ${childId}`));
}

// «сын», «дочь» or «ребёнок» by the gender in the anketa.
export async function roleOf(childId) {
  const row = await db.get(sql`SELECT gender FROM profile_info WHERE user_id = ${childId}`);
  const g = row && row.gender;
  return g === 'm' ? 'сын' : g === 'f' ? 'дочь' : 'ребёнок';
}

// Who to become: «сыном», «дочкой» or «ребёнком».
export async function roleInstr(childId) {
  return { сын: 'сыном', дочь: 'дочкой', ребёнок: 'ребёнком' }[await roleOf(childId)];
}

// An offer waits for the child's button for an hour.
export async function offer(chatId, parentId, childId) {
  if (parentId === childId) throw new FamilyError('Усыновить себя нельзя 🙂');
  if (await isParent(parentId, childId)) throw new FamilyError('Это и так твой ребёнок.');
  if (await isParent(childId, parentId)) throw new FamilyError('Это твой родитель: наоборот не выйдет.');
  // No loops through the grandparents either.
  for (const p of await parentsOf(parentId)) {
    if (await isParent(childId, p.parent_id)) throw new FamilyError('Это твой дедушка или бабушка: так не выйдет.');
  }
  if (await social.marriageOf(parentId, childId)) throw new FamilyError('Вы в браке: супруга усыновить нельзя.');
  const d = await social.partnerOf(parentId);
  if (d && d.partner_id === childId) throw new FamilyError('Вы встречаетесь: свою пару усыновить нельзя.');
  if ((await parentsOf(childId)).length >= MAX_PARENTS) throw new FamilyError('У этого участника уже двое родителей.');
  if ((await childrenOf(parentId)).length >= MAX_CHILDREN) throw new FamilyError(`У тебя уже ${MAX_CHILDREN} детей, это максимум.`);
  await db.run(sql`INSERT INTO adopt_offers (from_id, to_id, chat_id, message_id, created_at)
    VALUES (${parentId}, ${childId}, ${chatId}, NULL, ${nowInt()})
    ON CONFLICT(from_id, to_id) DO UPDATE SET chat_id = excluded.chat_id, message_id = NULL,
      created_at = excluded.created_at`);
}

export async function setOfferMessage(parentId, childId, messageId) {
  await db.run(sql`UPDATE adopt_offers SET message_id = ${messageId} WHERE from_id = ${parentId} AND to_id = ${childId}`);
}

// The offer is claimed by deleting it, so two taps cannot adopt twice.
async function takeOffer(parentId, childId) {
  const r = await db.run(sql`DELETE FROM adopt_offers WHERE from_id = ${parentId} AND to_id = ${childId}
    AND created_at >= ${nowInt() - OFFER_TTL} RETURNING from_id`);
  return r.rowsAffected === 1;
}

export async function accept(parentId, childId) {
  if (!(await takeOffer(parentId, childId))) throw new FamilyError('Предложение уже не действует.');
  const ts = nowInt();
  // Only while the child still has room for a parent and the parent for a child.
  const r = await db.run(sql`INSERT INTO children (child_id, parent_id, since)
    SELECT ${childId}, ${parentId}, ${ts}
    WHERE NOT EXISTS (SELECT 1 FROM children WHERE child_id = ${childId} AND parent_id = ${parentId})
      AND (SELECT COUNT(*) FROM children WHERE child_id = ${childId}) < ${MAX_PARENTS}
      AND (SELECT COUNT(*) FROM children WHERE parent_id = ${parentId}) < ${MAX_CHILDREN}`);
  if (r.rowsAffected !== 1) throw new FamilyError('Уже не выйдет: мест в семье не осталось.');
  return ts;
}

export async function decline(parentId, childId) {
  return takeOffer(parentId, childId);
}

// «Отказаться от ребёнка». → true when there was such a child.
export async function disown(parentId, childId) {
  const r = await db.run(sql`DELETE FROM children WHERE parent_id = ${parentId} AND child_id = ${childId}`);
  return r.rowsAffected > 0;
}

// «Уйти из семьи»: the child leaves all their parents. → how many there were.
export async function leave(childId) {
  const r = await db.run(sql`DELETE FROM children WHERE child_id = ${childId}`);
  return r.rowsAffected;
}
