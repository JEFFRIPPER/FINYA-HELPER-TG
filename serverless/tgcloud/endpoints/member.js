// POST /api/member — a member's card for a tap on a person in the Mini App, by the
// random ref from the lists (never a Telegram ID). ctx.initData is verified by the platform.
import { EndpointError } from 'sdk';
import { memberView } from '../lib/webapp.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  if (!user || !Number.isInteger(user.id) || user.id < 1) {
    throw new EndpointError('Открой профиль из Telegram.', { code: 'NO_USER' });
  }
  let card;
  try {
    card = await memberView(user.id, input && input.ref);
  } catch (err) {
    await logError('webapp.member', err);
    throw err;
  }
  if (!card) throw new EndpointError('Не нашла этого участника.', { code: 'NO_MEMBER' });
  return card;
}
