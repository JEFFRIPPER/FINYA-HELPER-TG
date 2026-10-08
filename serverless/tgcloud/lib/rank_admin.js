// Owner-private rank management with confirmed, audited changes (port of admin_ranks.py).
import { ADMIN_BUTTON_ICONS, OWNER_USER_ID } from './config.js';
import { button, editOrSend, keyboard, menuButton, replyBold } from './tg.js';
import { isAdminUser, logError } from './store.js';
import { escapeHtml, fmtMsk, fmtSigned, fmtThousands, now, randomHex, truncate } from './util.js';
import { xpSetupText } from './xpchat.js';
import * as xp from './xp.js';

const PAGE_SIZE = 6;
const PENDING_SECONDS = 600;
const RANK_ACTIONS = new Set(['xp_add', 'xp_rank', 'rank_find', 'rank_amount']);

class UserError extends Error {}

export function parseUserId(value) {
  const text = String(value).trim();
  if (!/^\+?[0-9]{1,19}$/.test(text)) throw new UserError('Нужен положительный Telegram ID.');
  const result = Number(text);
  if (!(result > 0 && Number.isSafeInteger(result))) throw new UserError('Неверный Telegram ID.');
  return result;
}

export function allowed(user, chat) {
  return isAdminUser(user) && chat != null && chat.type === 'private';
}

export function clear(s, { allActions = false } = {}) {
  delete s.rank_admin;
  delete s.rank_admin_pending;
  if (allActions || RANK_ACTIONS.has(s.admin_action)) delete s.admin_action;
  if (allActions) delete s.awaiting_feedback;
}

function btn(label, action) {
  return button(label, { callback_data: `admin:xp:${action}`, icon_custom_emoji_id: ADMIN_BUTTON_ICONS.xp });
}

export function rankKeyboard() {
  return keyboard([
    [btn('Участники', 'users'), btn('Найти участника', 'find')],
    [btn('Звания и пороги', 'ranks')],
    [btn('Настройка учёта XP', 'setup')],
    [menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })],
  ]);
}

function backKeyboard(userId = null) {
  const rows = userId ? [[btn('Карточка участника', `user:${userId}`)]] : [];
  rows.push([button('Звания / XP', { callback_data: 'admin:xp' })]);
  return keyboard(rows);
}

function homeText() {
  return 'Звания / XP · управление\n\n' +
    'Выбери участника из списка или найди по @username / Telegram ID.\n' +
    'Звание назначается отдельно от XP: накопленный опыт сохраняется.\n' +
    'Снятие ручного звания возвращает автоматическое звание по XP.\n\n' +
    'Изменения применяются только после подтверждения.\n' +
    'X · Основатель SQUAD закреплён только за владельцем.';
}

function label(profile) {
  const name = escapeHtml(truncate(profile.name || profile.user_id, 100));
  const username = truncate(profile.username || '', 40);
  return name + (username ? ` · @${escapeHtml(username)}` : '');
}

function card(profile, s) {
  const userId = profile.user_id;
  const founder = userId === OWNER_USER_ID;
  const [current] = xp.rankFor(profile.xp, { founder, manualRank: profile.manual_rank });
  const [automatic] = xp.rankFor(profile.xp, { founder });
  const source = founder ? 'Закреплено за владельцем' : (profile.manual_rank ? 'Ручное звание' : 'Автоматическое звание');
  const text = `Участник Сквада\n\n${label(profile)}\nTelegram ID: ${userId}\n\n` +
    `Звание: ${current[1]} · ${current[2]}\n${source}\n` +
    `По XP: ${automatic[1]} · ${automatic[2]}\n\nВсего: ${profile.xp} XP\n` +
    `Активность за неделю: ${profile.week || 0} XP\n` +
    `Активность сегодня: ${profile.today || 0} XP\n\n` +
    'Ручные изменения XP не добавляют баллы в дневную и недельную активность.';
  const rows = [];
  if (!founder) {
    rows.push([btn('Выдать звание', `rank:${userId}`)]);
    if (profile.manual_rank) rows.push([btn('Снять ручное звание', `auto:${userId}`)]);
    rows.push([btn('Добавить XP', `add:${userId}`), btn('Снять XP', `subtract:${userId}`)]);
  }
  rows.push([btn('История изменений', `history:${userId}`)]);
  rows.push([btn('Список участников', `users:${s.rank_admin_page || 0}`), btn('Поиск', 'find')]);
  rows.push([button('Звания / XP', { callback_data: 'admin:xp' })]);
  return [text, keyboard(rows)];
}

async function participants(s, page = 0) {
  await xp.syncKnownUsers();
  const count = await xp.profileCount();
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  s.rank_admin_page = page;
  const profiles = await xp.listProfiles(PAGE_SIZE, page * PAGE_SIZE);
  let text = `Участники Сквада\n\nВсего: ${count}\nСтраница ${page + 1} из ${pages}\n\n`;
  text += profiles.length
    ? 'Выбери участника. В карточке будут звание, XP и постоянный ID.'
    : 'Пока список пуст. Здесь появятся участники, открывшие бота или получившие XP.';
  const rows = profiles.map((p) => [btn(`${truncate(p.name || p.username || p.user_id, 25)} · ${p.user_id}`, `user:${p.user_id}`)]);
  const nav = [];
  if (page > 0) nav.push(btn('Назад', `users:${page - 1}`));
  if (page + 1 < pages) nav.push(btn('Далее', `users:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([btn('Найти участника', 'find'), btn('Обновить', `users:${page}`)]);
  rows.push([button('Звания / XP', { callback_data: 'admin:xp' })]);
  return [text, keyboard(rows)];
}

async function candidates(text) {
  await xp.syncKnownUsers();
  if (/^\+?[0-9]+$/.test(text)) {
    const p = await xp.getProfile(parseUserId(text));
    return p ? [p] : [];
  }
  const username = text.replace(/^@/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(username)) {
    throw new UserError('Отправь один @username или положительный Telegram ID.');
  }
  // Never silently choose between a reused username and an old profile.
  return xp.findProfiles(username);
}

function preview(s, profile, action, value) {
  if (profile.user_id === OWNER_USER_ID) {
    throw new UserError('X · Основатель SQUAD закреплён за владельцем и не изменяется.');
  }
  const pending = {
    token: randomHex(6), user_id: profile.user_id, action, value, time: now(),
    before_xp: profile.xp, before_rank: profile.manual_rank ?? null,
  };
  s.rank_admin_pending = pending;
  return previewView(pending, profile);
}

function previewView(pending, profile) {
  const [old] = xp.rankFor(profile.xp, { manualRank: profile.manual_rank });
  let change;
  if (pending.action === 'adjust_xp') {
    const newXp = Math.max(0, profile.xp + pending.value);
    if (newXp > xp.MAX_XP) throw new UserError('Сумма превышает предел XP. Введи новую сумму.');
    const [next] = xp.rankFor(newXp, { manualRank: profile.manual_rank });
    change = `XP: ${profile.xp} → ${newXp}\nФактическое изменение: ${fmtSigned(newXp - profile.xp)} XP\n` +
      `Звание: ${old[1]} · ${old[2]} → ${next[1]} · ${next[2]}`;
  } else {
    const [next] = xp.rankFor(profile.xp, { manualRank: pending.value });
    change = `Звание: ${old[1]} · ${old[2]} → ${next[1]} · ${next[2]}\nXP остаётся: ${profile.xp}\n` +
      (pending.value ? 'Звание будет закреплено вручную.' : 'Дальше звание будет определяться автоматически по XP.');
  }
  return [
    `Подтверди изменение\n\n${label(profile)}\nTelegram ID: ${profile.user_id}\n\n${change}\n\nДо подтверждения ничего не изменено.`,
    keyboard([[btn('Подтвердить', `confirm:${pending.token}`), btn('Отмена', 'cancel')]]),
  ];
}

async function history(profile) {
  let text = `История изменений\n\n${label(profile)}\nTelegram ID: ${profile.user_id}`;
  const records = await xp.adminHistory(profile.user_id, 5);
  if (!records.length) text += '\n\nРучных изменений пока нет.';
  for (const e of records) {
    const change = e.action === 'adjust_xp'
      ? `XP: ${e.before_xp} → ${e.after_xp}`
      : `Ручное звание: ${e.before_rank || 'автоматически'} → ${e.after_rank || 'автоматически'}`;
    text += `\n\n${fmtMsk(e.created_at)} МСК\n${change}\nВладелец: ${e.actor_id}`;
  }
  return [text, backKeyboard(profile.user_id)];
}

function isUserFacing(err) {
  return err instanceof UserError || err instanceof xp.XpError;
}

export async function handle(query, s, action) {
  if (!allowed(query.from, query.message && query.message.chat)) return;
  try {
    if (action.startsWith('xp:confirm:')) {
      await confirm(query, s, action.split(':').slice(2).join(':'));
      return;
    }
    clear(s, { allActions: true });
    if (action === 'xp') {
      await editOrSend(query, homeText(), rankKeyboard());
      return;
    }
    const parts = action.split(':');
    const command = parts[1];
    let text;
    let kb;
    if (command === 'users') {
      const page = parts.length === 3 && /^[0-9]{1,6}$/.test(parts[2]) ? Number(parts[2]) : 0;
      [text, kb] = await participants(s, page);
    } else if (['find', 'add', 'rank'].includes(command) && parts.length === 2) {
      s.rank_admin = { mode: 'find' };
      s.admin_action = 'rank_find';
      text = 'Найти участника\n\nОтправь @username или Telegram ID.\nПосле поиска выбери действие в карточке.\n/cancel — отменить.';
      kb = backKeyboard();
    } else if (command === 'ranks') {
      text = 'Звания Сквада\n\n' + xp.RANKS.map(([p, r, n]) => `${r} · ${n} — от ${p} XP`).join('\n');
      text += '\n\nX · Основатель SQUAD — только владелец.\nРучное звание не изменяет накопленный XP.';
      kb = rankKeyboard();
    } else if (command === 'setup') {
      text = await xpSetupText();
      kb = backKeyboard();
    } else if (command === 'cancel') {
      const uid = s.rank_admin_selected;
      const profile = uid ? await xp.getProfile(uid) : null;
      [text, kb] = profile ? card(profile, s) : [homeText(), rankKeyboard()];
      text = 'Действие отменено.\n\n' + text;
    } else if (['user', 'rank', 'auto', 'add', 'subtract', 'history', 'choose'].includes(command)) {
      if (parts.length !== (command === 'choose' ? 4 : 3)) {
        throw new UserError('Кнопка устарела. Выбери участника заново.');
      }
      const uid = parseUserId(parts[2]);
      await xp.syncKnownUsers();
      const profile = await xp.getProfile(uid);
      if (!profile) throw new UserError('Участник не найден. Открой список или используй поиск.');
      s.rank_admin_selected = uid;
      if (['rank', 'auto', 'add', 'subtract', 'choose'].includes(command) && uid === OWNER_USER_ID) {
        throw new UserError('X · Основатель SQUAD закреплён за владельцем и не изменяется.');
      }
      if (command === 'user') {
        [text, kb] = card(profile, s);
      } else if (command === 'history') {
        [text, kb] = await history(profile);
      } else if (command === 'rank') {
        text = `Выдать звание\n\n${label(profile)}\nTelegram ID: ${uid}\n\nВыбери звание. Накопленные ${profile.xp} XP сохранятся.`;
        const rows = xp.RANKS.map(([, roman, name]) => [btn(`${roman} · ${name}`, `choose:${uid}:${roman}`)]);
        rows.push([btn('Карточка участника', `user:${uid}`)]);
        kb = keyboard(rows);
      } else if (command === 'choose' || command === 'auto') {
        const value = command === 'choose' ? parts[3] : null;
        if (value != null && !xp.ROMANS.has(value)) throw new UserError('Можно назначить только звания I–IX.');
        [text, kb] = preview(s, profile, 'set_manual_rank', value);
      } else {
        s.rank_admin = { mode: 'amount', user_id: uid, action: command };
        s.admin_action = 'rank_amount';
        const verb = command === 'add' ? 'добавить' : 'снять';
        text = `Изменить XP\n\n${label(profile)}\nTelegram ID: ${uid}\nСейчас: ${profile.xp} XP\n\n` +
          `Сколько XP ${verb}?\nОтправь целое число от 1 до ${fmtThousands(xp.MAX_XP)}.\n/cancel — отменить.`;
        kb = backKeyboard(uid);
      }
    } else {
      throw new UserError('Кнопка устарела. Открой управление званиями заново.');
    }
    await editOrSend(query, text, kb);
  } catch (err) {
    if (isUserFacing(err)) {
      await editOrSend(query, escapeHtml(err.message), rankKeyboard());
      return;
    }
    await logError('rank_admin.handle', err);
    await editOrSend(query, 'Хранилище XP временно недоступно. Повтори действие чуть позже.', rankKeyboard());
  }
}

async function confirm(query, s, token) {
  const pending = s.rank_admin_pending;
  if (!pending || pending.token !== token || now() - (pending.time || 0) > PENDING_SECONDS) {
    if (pending && pending.token === token) clear(s);
    await editOrSend(query, 'Подтверждение устарело. Выбери действие заново.', rankKeyboard());
    return;
  }
  let profile = null;
  let result;
  try {
    profile = await xp.getProfile(pending.user_id);
    if (!profile) {
      clear(s);
      await editOrSend(query, 'Участник не найден.', rankKeyboard());
      return;
    }
    if (profile.xp !== pending.before_xp || (profile.manual_rank ?? null) !== pending.before_rank) {
      if (pending.action === 'adjust_xp' && profile.xp + pending.value > xp.MAX_XP) {
        clear(s);
        s.rank_admin = { mode: 'amount', user_id: profile.user_id, action: 'add' };
        s.admin_action = 'rank_amount';
        const text = `XP участника изменился: сейчас ${profile.xp} XP.\n` +
          `Максимальная добавка сейчас: ${xp.MAX_XP - profile.xp} XP.\n\n` +
          'Ничего не изменено. Отправь новую сумму или нажми «Карточка участника».';
        await editOrSend(query, text, backKeyboard(profile.user_id));
        return;
      }
      const [text, kb] = preview(s, profile, pending.action, pending.value);
      await editOrSend(query, 'Данные участника изменились. Проверь обновлённое действие.\n\n' + text, kb);
      return;
    }
    const opts = { actorId: query.from.id, ownerId: OWNER_USER_ID, operationId: `rankadmin:${query.from.id}:${token}` };
    result = pending.action === 'adjust_xp'
      ? await xp.adjustXp(pending.user_id, pending.value, opts)
      : await xp.setManualRank(pending.user_id, pending.value, opts);
  } catch (err) {
    if (err instanceof xp.XpError && err.kind === 'conflict' && profile) {
      const fresh = await xp.getProfile(pending.user_id);
      const [text, kb] = preview(s, fresh, pending.action, pending.value);
      await editOrSend(query, 'Данные участника изменились. Проверь обновлённое действие.\n\n' + text, kb);
      return;
    }
    if (isUserFacing(err)) {
      clear(s);
      await editOrSend(query, escapeHtml(err.message), rankKeyboard());
      return;
    }
    await logError('rank_admin.confirm', err);
    const snapshot = profile || { user_id: pending.user_id, xp: pending.before_xp, manual_rank: pending.before_rank };
    const [text, kb] = previewView(pending, snapshot);
    await editOrSend(query, 'Изменение не подтверждено хранилищем. Можно повторить подтверждение.\n\n' + text, kb);
    return;
  }
  clear(s);
  const [text, kb] = card(result.profile, s);
  await editOrSend(query, 'Изменение сохранено.\n\n' + text, kb);
}

// → true when the text belonged to a rank-admin dialog.
export async function handleText(message, s) {
  const state = s.rank_admin;
  const legacy = s.admin_action === 'xp_add' || s.admin_action === 'xp_rank';
  if (!state && !legacy) return false;
  if (!allowed(message.from, message.chat)) return true;
  if (legacy) {
    clear(s, { allActions: true });
    await replyBold(message, homeText(), rankKeyboard());
    return true;
  }
  const text = String(message.text || '').trim();
  if (['отмена', '/cancel'].includes(text.toLowerCase())) {
    clear(s, { allActions: true });
    await replyBold(message, 'Действие отменено.', rankKeyboard());
    return true;
  }
  try {
    let replyText;
    let kb;
    if (state.mode === 'find') {
      const profiles = await candidates(text);
      if (!profiles.length) {
        throw new UserError('Участник не найден. Он должен был открыть бота или появиться в учёте XP. Попробуй Telegram ID.');
      }
      if (profiles.length > 1) {
        throw new UserError('Этот username связан с несколькими известными ID. Чтобы не изменить чужое звание, отправь постоянный Telegram ID участника.');
      }
      const profile = profiles[0];
      clear(s);
      s.rank_admin_selected = profile.user_id;
      [replyText, kb] = card(profile, s);
    } else {
      const number = text.replace(/[ _]/g, '');
      if (!/^[0-9]{1,10}$/.test(number) || !(Number(number) > 0 && Number(number) <= xp.MAX_XP)) {
        throw new UserError(`Нужно целое положительное число от 1 до ${fmtThousands(xp.MAX_XP)}. Попробуй ещё раз.`);
      }
      const profile = await xp.getProfile(state.user_id);
      if (!profile) throw new UserError('Участник не найден.');
      const delta = Number(number) * (state.action === 'subtract' ? -1 : 1);
      if (profile.xp + delta > xp.MAX_XP) {
        throw new UserError(`Общий XP не может превышать ${fmtThousands(xp.MAX_XP)}. Отправь меньшее число.`);
      }
      clear(s);
      [replyText, kb] = preview(s, profile, 'adjust_xp', delta);
    }
    await replyBold(message, replyText, kb);
  } catch (err) {
    if (isUserFacing(err)) {
      await replyBold(message, escapeHtml(err.message), backKeyboard(state.user_id));
    } else {
      await logError('rank_admin.text', err);
      await replyBold(message, 'Хранилище временно недоступно. Повтори ввод чуть позже.', backKeyboard(state.user_id));
    }
  }
  return true;
}
