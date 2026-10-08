// Runs on each `chat_member` update; the payload is update.chat_member.
import { onChatMember } from '../lib/bot.js';
import { logError } from '../lib/store.js';

export default async function (event, ctx) {
  try {
    await onChatMember(event);
  } catch (err) {
    // Logged instead of rethrown so a failing update is not redelivered forever.
    await logError('chat_member', err);
  }
}
