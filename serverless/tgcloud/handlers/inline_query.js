// Runs on each `inline_query` update; the payload is update.inline_query.
import { onInlineQuery } from '../lib/inline.js';
import { logError } from '../lib/store.js';

export default async function (query, ctx) {
  try {
    await onInlineQuery(query);
  } catch (err) {
    // Logged instead of rethrown so a failing update is not redelivered forever.
    await logError('inline_query', err);
  }
}
