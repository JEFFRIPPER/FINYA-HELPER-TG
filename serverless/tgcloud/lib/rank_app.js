// Rank management in the Mini App, for the owner only (the Mini App twin of
// rank_admin.js). Every change goes through xp.adjustXp / xp.setManualRank, so
// it is checked, compare-and-set and written to admin_changes like in the bot.
import { OWNER_USER_ID } from './config.js';
import { truncate } from './util.js';
import * as xp from './xp.js';

const PAGE_SIZE = 30;
const HISTORY_LIMIT = 10;

export class RankAppError extends Error {
  constructor(message, code = 'BAD_REQUEST') {
    super(message);
    this.code = code;
  }
}

function rankView(rank) {
  return { roman: rank[1], name: rank[2] };
}

function row(p) {
  const founder = p.user_id === OWNER_USER_ID;
  const [current] = xp.rankFor(p.xp, { founder, manualRank: p.manual_rank });
  return {
    id: p.user_id,
    name: truncate(p.name || String(p.user_id), 100),
    username: p.username || '',
    xp: p.xp,
    rank: rankView(current),
    manual: Boolean(p.manual_rank) && !founder,
    founder,
  };
}

function matches(p, q) {
  if (/^[0-9]+$/.test(q)) return String(p.user_id).startsWith(q);
  const name = String(p.name || '').toLowerCase();
  const username = String(p.username || '').toLowerCase();
  const bare = q.replace(/^@+/, '');
  return name.includes(q) || (bare !== '' && username.includes(bare));
}

async function list(input) {
  await xp.syncKnownUsers();
  const all = await xp.allProfiles();
  const q = truncate(String(input.query || '').trim().toLowerCase(), 60);
  const found = q ? all.filter((p) => matches(p, q)) : all;
  found.sort((a, b) => b.xp - a.xp || a.user_id - b.user_id);
  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(Number.isInteger(input.page) ? input.page : 0, pages - 1));
  const counts = {};
  for (const p of all) {
    const roman = xp.rankFor(p.xp, { founder: p.user_id === OWNER_USER_ID, manualRank: p.manual_rank })[0][1];
    counts[roman] = (counts[roman] || 0) + 1;
  }
  return {
    total: found.length,
    members: all.length,
    page,
    pages,
    items: found.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row),
    ranks: xp.RANKS.map((r) => ({ roman: r[1], name: r[2], from: r[0], count: counts[r[1]] || 0 })),
  };
}

async function card(userId) {
  const p = await xp.getProfile(userId);
  if (!p) throw new RankAppError('Участник не найден.', 'NOT_FOUND');
  const founder = p.user_id === OWNER_USER_ID;
  const history = await xp.adminHistory(userId, HISTORY_LIMIT);
  return {
    ...row(p),
    today: p.today || 0,
    week: p.week || 0,
    auto: rankView(xp.rankFor(p.xp, { founder })[0]),
    history: history.map((e) => ({
      action: e.action,
      beforeXp: e.before_xp,
      afterXp: e.after_xp,
      beforeRank: e.before_rank,
      afterRank: e.after_rank,
      at: e.created_at,
    })),
  };
}

function userId(input) {
  const id = input.id;
  if (!Number.isSafeInteger(id) || id < 1) throw new RankAppError('Неверный Telegram ID.');
  return id;
}

function operationId(input) {
  const op = String(input.op || '');
  if (!/^[a-z0-9]{8,40}$/.test(op)) throw new RankAppError('Неверный ключ операции.');
  return `miniapp:${op}`;
}

function translate(err) {
  if (!(err instanceof xp.XpError)) return err;
  if (err.kind === 'lookup') return new RankAppError('Участник не найден.', 'NOT_FOUND');
  if (err.kind === 'permission') return new RankAppError('Профиль основателя защищён: X · Основатель SQUAD не меняется.', 'FORBIDDEN');
  if (err.kind === 'conflict') return new RankAppError('Данные участника только что изменились. Проверь карточку и повтори.', 'CONFLICT');
  return new RankAppError(`Так нельзя: XP должен остаться в пределах 0…${xp.MAX_XP}.`);
}

// → response for one panel request from `user` (already verified by the platform).
export async function handle(user, input) {
  if (!user || user.id !== OWNER_USER_ID) throw new RankAppError('Панель званий доступна только владельцу.', 'FORBIDDEN');
  input = input && typeof input === 'object' ? input : {};
  const opts = () => ({ actorId: user.id, ownerId: OWNER_USER_ID, operationId: operationId(input) });
  try {
    switch (input.action) {
      case 'list':
        return await list(input);
      case 'user':
        return await card(userId(input));
      case 'xp': {
        const id = userId(input);
        const delta = input.delta;
        if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > xp.MAX_XP) {
          throw new RankAppError('Нужно целое число XP, не ноль.');
        }
        await xp.adjustXp(id, delta, opts());
        return await card(id);
      }
      case 'rank': {
        const id = userId(input);
        const roman = input.roman == null ? null : String(input.roman);
        if (roman != null && !xp.ROMANS.has(roman)) throw new RankAppError('Можно назначить только звания I–IX.');
        await xp.setManualRank(id, roman, opts());
        return await card(id);
      }
      default:
        throw new RankAppError('Неизвестное действие.');
    }
  } catch (err) {
    throw translate(err);
  }
}
