// POST /api/club — rewards, quests, the XP shop, polls, birthday and referral
// link from the Mini App. ctx.initData is verified by the platform.
// Answers with the whole profile, so the app redraws from fresh data.
import { EndpointError } from 'sdk';
import { handle } from '../lib/club_app.js';
import { ClubError } from '../lib/club.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  if (!user || !Number.isInteger(user.id) || user.id < 1) {
    throw new EndpointError('Открой профиль из Telegram.', { code: 'NO_USER' });
  }
  try {
    return await handle(user, input || {});
  } catch (err) {
    if (err instanceof ClubError) throw new EndpointError(err.message, { code: 'CLUB' });
    await logError('webapp.club', err);
    throw err;
  }
}
