// Runs on each `message` update; the payload is update.message.
import { onMessage } from '../lib/bot.js';
import { logError } from '../lib/store.js';

export default async function (message, ctx) {
  try {
    await onMessage(message);
  } catch (err) {
    // Logged instead of rethrown so a failing update is not redelivered forever.
    await logError('message', err);
  }
}
