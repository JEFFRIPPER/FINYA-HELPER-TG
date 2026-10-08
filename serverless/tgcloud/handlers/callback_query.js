// Runs on each `callback_query` update; the payload is update.callback_query.
import { onCallbackQuery } from '../lib/bot.js';
import { logError } from '../lib/store.js';

export default async function (query, ctx) {
  try {
    await onCallbackQuery(query);
  } catch (err) {
    // Logged instead of rethrown so a failing update is not redelivered forever.
    await logError('callback_query', err);
  }
}
