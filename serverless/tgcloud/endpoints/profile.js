// POST /api/profile — everything the Mini App shows. ctx.initData is verified by the platform.
import { EndpointError } from 'sdk';
import { profileData } from '../lib/webapp.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  if (!user || !Number.isInteger(user.id) || user.id < 1) {
    throw new EndpointError('Открой профиль из Telegram.', { code: 'NO_USER' });
  }
  try {
    return await profileData(user);
  } catch (err) {
    await logError('webapp', err);
    throw err;
  }
}
