// POST /api/music — the owner's profile music player in the Mini App. ctx.initData is verified by the platform.
import { EndpointError } from 'sdk';
import { handle, MusicError } from '../lib/music.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  try {
    return await handle(user, input);
  } catch (err) {
    if (err instanceof MusicError) throw new EndpointError(err.message, { code: err.code });
    await logError('webapp.music', err);
    throw new EndpointError('Музыка сейчас недоступна, попробуй позже.', { code: 'UNAVAILABLE' });
  }
}
