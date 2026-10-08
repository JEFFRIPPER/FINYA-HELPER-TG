// Runs on each `channel_post` update; the payload is update.channel_post.
import { onChannelPost } from '../lib/bot.js';
import { logError } from '../lib/store.js';

export default async function (message, ctx) {
  try {
    await onChannelPost(message);
  } catch (err) {
    // Logged instead of rethrown so a failing update is not redelivered forever.
    await logError('channel_post', err);
  }
}
