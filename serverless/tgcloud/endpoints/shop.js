// POST /api/shop — SQUAD SHOP products and statistics in the owner's «Панель». ctx.initData is verified by the platform.
import { EndpointError } from 'sdk';
import { appHandle, ShopError } from '../lib/shop_admin.js';
import { appStats } from '../lib/shop_stats.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  try {
    const body = input || {};
    return await (body.action === 'stats' ? appStats(user, body) : appHandle(user, body));
  } catch (err) {
    if (err instanceof ShopError) throw new EndpointError(err.message, { code: 'SHOP' });
    await logError('webapp.shop', err);
    throw err;
  }
}
