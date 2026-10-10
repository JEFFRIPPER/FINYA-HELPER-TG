// POST /api/shop — SQUAD SHOP orders for the owner. ctx.initData is verified by the platform.
import { EndpointError } from 'sdk';
import { handle, ShopError } from '../lib/shop.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  try {
    return await handle(user, input || {});
  } catch (err) {
    if (err instanceof ShopError) throw new EndpointError(err.message, { code: err.code });
    await logError('webapp.shop', err);
    throw err;
  }
}
