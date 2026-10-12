// POST /api/shop — SQUAD SHOP products in the owner's «Панель». ctx.initData is verified by the platform.
import { EndpointError } from 'sdk';
import { appHandle, ShopError } from '../lib/shop_admin.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  try {
    return await appHandle(user, input || {});
  } catch (err) {
    if (err instanceof ShopError) throw new EndpointError(err.message, { code: 'SHOP' });
    await logError('webapp.shop', err);
    throw err;
  }
}
