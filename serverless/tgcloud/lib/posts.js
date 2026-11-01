// Posts of the channel in the discussion group: «🥇 Первый!» for the first comment,
// and a day later Finya answers the comment with the most reactions, with a bonus.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { logError } from './store.js';
import { boldHtml, countAlnum, escapeHtml, nowInt, plural, truncate } from './util.js';
import { nameOf } from './members.js';
import * as xp from './xp.js';

export const FIRST_XP = 15;
export const BEST_XP = 20;
const DAY = 86400;
const BEST_MIN_REACTIONS = 2;

async function reply(chatId, messageId, text) {
  try {
    await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: boldHtml(text),
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    });
  } catch {
    // No right to write: the bonus is there anyway.
  }
}

// After xp.comment() saw the message: a new post, or maybe its first comment.
export async function onMessage(message, channelId) {
  const record = await xp.messageRecord(message.chat.id, message.message_id);
  if (!record) return;
  const chatId = message.chat.id;
  if (xp.isChannelRoot(message, channelId)) {
    await db.run(sql`INSERT OR IGNORE INTO channel_posts (chat_id, root_id, posted_at)
      VALUES (${chatId}, ${record.root_id}, ${message.date || nowInt()})`);
    return;
  }
  const user = message.from;
  if (!user || user.is_bot || message.sender_chat || message.forward_origin || !record.author_id) return;
  const text = String(message.text || message.caption || '').trim();
  if (text.startsWith('/') || countAlnum(text) < 5) return;
  const ts = message.date || nowInt();
  const won = await db.run(sql`UPDATE channel_posts SET first_by = ${user.id}
    WHERE chat_id = ${chatId} AND root_id = ${record.root_id} AND first_by IS NULL AND posted_at > ${ts - DAY}`);
  if (won.rowsAffected !== 1) return;
  const got = await xp.grant(user, 'first_comment', record.root_id, FIRST_XP, ts);
  if (got) await reply(chatId, message.message_id, `🥇 Первый! +${FIRST_XP} XP`);
}

// Reactions under comments of a post: added or taken back.
export async function onReaction(event) {
  if (!event || !event.user || event.actor_chat) return;
  const record = await xp.messageRecord(event.chat.id, event.message_id);
  if (!record || !record.author_id || record.author_id === event.user.id) return;
  if (event.new_reaction && event.new_reaction.length) {
    await db.run(sql`INSERT OR IGNORE INTO comment_reactions (chat_id, message_id, user_id)
      VALUES (${event.chat.id}, ${event.message_id}, ${event.user.id})`);
  } else {
    await db.run(sql`DELETE FROM comment_reactions WHERE chat_id = ${event.chat.id}
      AND message_id = ${event.message_id} AND user_id = ${event.user.id}`);
  }
}

// A day after a post: Finya replies to its comment with the most reactions (2 at least).
export async function tick(ts = nowInt()) {
  const due = await db.all(sql`SELECT chat_id, root_id FROM channel_posts
    WHERE best_done = 0 AND posted_at <= ${ts - DAY} ORDER BY posted_at LIMIT 5`);
  for (const p of due) {
    const claimed = await db.run(sql`UPDATE channel_posts SET best_done = 1
      WHERE chat_id = ${p.chat_id} AND root_id = ${p.root_id} AND best_done = 0`);
    if (claimed.rowsAffected !== 1) continue;
    try {
      const best = await db.get(sql`SELECT m.message_id, m.author_id, COUNT(r.user_id) AS n FROM messages m
        JOIN comment_reactions r ON r.chat_id = m.chat_id AND r.message_id = m.message_id
        WHERE m.chat_id = ${p.chat_id} AND m.root_id = ${p.root_id} AND m.author_id IS NOT NULL
        GROUP BY m.message_id ORDER BY n DESC, m.message_id LIMIT 1`);
      if (!best || best.n < BEST_MIN_REACTIONS) continue;
      const got = await xp.grant(best.author_id, 'best_comment', p.root_id, BEST_XP, ts);
      if (!got) continue;
      const name = escapeHtml(truncate(await nameOf(best.author_id), 40));
      await reply(p.chat_id, best.message_id, `⭐ Лучший комментарий поста: ${name}, ${best.n} ${plural(best.n, 'реакция', 'реакции', 'реакций')}. +${BEST_XP} XP`);
    } catch (err) {
      await logError('posts.best', err);
    }
  }
}
