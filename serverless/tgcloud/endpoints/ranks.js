// POST /api/ranks — the owner's rank panel in the Mini App. ctx.initData is verified by the platform.
import { EndpointError } from 'sdk';
import { handle, RankAppError } from '../lib/rank_app.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  try {
    return await handle(user, input);
  } catch (err) {
    if (err instanceof RankAppError) throw new EndpointError(err.message, { code: err.code });
    await logError('webapp.ranks', err);
    throw err;
  }
}
