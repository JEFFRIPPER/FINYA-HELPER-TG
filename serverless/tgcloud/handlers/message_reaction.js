// Runs on each `message_reaction` update; the payload is update.message_reaction.
import { onMessageReaction } from '../lib/bot.js';
import { logError } from '../lib/store.js';

export default async function (event, ctx) {
  try {
    await onMessageReaction(event);
  } catch (err) {
    // Logged instead of rethrown so a failing update is not redelivered forever.
    await logError('message_reaction', err);
  }
}
