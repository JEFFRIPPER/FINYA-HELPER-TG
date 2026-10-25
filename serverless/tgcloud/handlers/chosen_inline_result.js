// Runs on each `chosen_inline_result` update (inline feedback is on in @BotFather);
// the payload is update.chosen_inline_result.
import { onChosenResult } from '../lib/inline.js';
import { logError } from '../lib/store.js';

export default async function (chosen, ctx) {
  try {
    await onChosenResult(chosen);
  } catch (err) {
    // Logged instead of rethrown so a failing update is not redelivered forever.
    await logError('chosen_inline_result', err);
  }
}
