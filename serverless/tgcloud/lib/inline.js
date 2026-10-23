// Inline mode: «@бот обнять @ник текст» in any chat, even a private one between two
// people where Финя is not a member. Needs Inline Mode on in BotFather.
import { api, BotApiError } from 'sdk';
import { escapeHtml, fullName, truncate } from './util.js';
import * as bio from './bio.js';
import { premiumMap, wrap } from './emoji.js';
import { mention } from './moder.js';
import * as social from './social.js';

// Telegram shows up to 50 results.
const MAX_RESULTS = 50;
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Who the action goes to when no @ник is given: the other person in a private chat,
// Финя herself in the chat with her, everyone in a group.
function defaultTarget(chatType) {
  if (chatType === 'sender') return 'Финю';
  if (chatType === 'group' || chatType === 'supergroup' || chatType === 'channel') return 'всех';
  return 'тебя';
}

// '🤗 обнимает' → ['🤗', 'обнимает'].
function splitAction(action) {
  const m = /^([^\p{L}\p{N}]+?)\s+(.+)$/u.exec(action);
  return m ? [m[1], m[2]] : ['✨', action];
}

export function rpText(actorId, actorName, action, rest, chatType) {
  const [emoji, verb] = splitAction(action);
  const at = /^(@\w{3,32})(?:\s+([\s\S]*))?$/u.exec(rest || '');
  const target = at ? at[1] : defaultTarget(chatType);
  const comment = (at ? at[2] : rest || '').trim();
  let text = `${escapeHtml(emoji)} ${mention(actorId, actorName)} ${escapeHtml(verb)} ${escapeHtml(target)}`;
  if (comment) text += `\n💬 «${escapeHtml(truncate(comment, 200))}»`;
  return text;
}

// → the results: an exact command with its @ник and comment, or every command that
// starts with what was typed (all of them for an empty query).
export async function results(query) {
  const actorName = (await bio.nickOf(query.from.id)) || fullName(query.from) || query.from.username || 'Участник';
  const typed = String(query.query || '').trim();
  const article = (cmd, action, rest) => ({
    type: 'article',
    id: `rp:${cmd}`.slice(0, 64),
    title: `${splitAction(action)[0]} ${titleCase(cmd)}`,
    description: rest ? truncate(rest, 60) : 'Допиши @ник и текст, если нужно',
    input_message_content: {
      message_text: rpText(query.from.id, actorName, action, rest, query.chat_type), parse_mode: 'HTML',
    },
  });
  const found = typed ? await social.matchAction(typed) : null;
  if (found) return [article(found.cmd, found.action, found.rest)];
  const prefix = social.normalizeCmd(typed);
  const list = [];
  for (const [cmd, action] of await social.allActions()) {
    if (cmd.startsWith(prefix)) list.push(article(cmd, action, ''));
  }
  return list.slice(0, MAX_RESULTS);
}

export async function onInlineQuery(query) {
  const list = await results(query);
  const answer = (items) => api.answerInlineQuery({
    inline_query_id: query.id,
    results: items,
    // The actor's name is in the text: results are per person.
    is_personal: true,
    cache_time: 10,
  });
  // Premium emoji from the owner's packs, as in the chats; plain ones if Telegram refuses.
  const map = await premiumMap();
  const fancy = list.map((r) => ({
    ...r, input_message_content: { ...r.input_message_content, message_text: wrap(r.input_message_content.message_text, map) },
  }));
  if (fancy.every((r, i) => r.input_message_content.message_text === list[i].input_message_content.message_text)) {
    await answer(list);
    return;
  }
  try {
    await answer(fancy);
  } catch (err) {
    if (!(err instanceof BotApiError) || err.code !== 400) throw err;
    await answer(list);
  }
}
