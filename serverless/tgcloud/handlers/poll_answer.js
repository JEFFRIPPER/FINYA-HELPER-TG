// Runs on each `poll_answer` update; the payload is update.poll_answer.
import { onPollAnswer } from '../lib/questions.js';
import { logError } from '../lib/store.js';

export default async function (answer, ctx) {
  try {
    await onPollAnswer(answer);
  } catch (err) {
    // Logged instead of rethrown so a failing update is not redelivered forever.
    await logError('poll_answer', err);
  }
}
