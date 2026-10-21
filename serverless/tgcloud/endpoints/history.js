// POST /api/history — the owner loads the chat's old history from a Telegram Desktop
// export in the Mini App. ctx.initData is verified by the platform.
import { EndpointError } from 'sdk';
import { OWNER_USER_ID } from '../lib/config.js';
import { chatInfo, HistoryError, importUsers } from '../lib/history.js';
import { logError } from '../lib/store.js';

export default async function (input, ctx) {
  const user = ctx && ctx.initData && ctx.initData.user;
  if (!user || user.id !== OWNER_USER_ID) throw new EndpointError('Загружать историю может только владелец.', { code: 'FORBIDDEN' });
  input = input && typeof input === 'object' ? input : {};
  try {
    if (input.action === 'chat') return { chat: await chatInfo(input.id, input.type) };
    if (input.action === 'import') return await importUsers(input.chat, input.users);
    throw new HistoryError('Неизвестное действие.');
  } catch (err) {
    if (err instanceof HistoryError) throw new EndpointError(err.message, { code: err.code });
    await logError('webapp.history', err);
    throw err;
  }
}
