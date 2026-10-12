// Update routing and user-facing handlers (port of bot_core.py + bot.py wrappers).
import { api, db, InputFile } from 'sdk';
import { sql } from 'sdk/db';
import {
  HOME_TEXT, INFO_TEXT, OWNER_USER_ID, PARTNERS, SQUAD_CHANNEL_USERNAME, SQUAD_TEXT, WEBAPP_URL,
} from './config.js';
import {
  answer, button, editOrSend, getMe, isAdminStatus, isBadRequest, keyboard, reply, replyBold,
} from './tg.js';
import {
  addFeedback, getSetting, getUser, isAdminUser, isMaintenance, logError, setSetting, setSubscribed,
  trackUser, userCount, withSession,
} from './store.js';
import {
  adminKeyboard, backHomeKeyboard, channelNewsView, channelSubscriptionKeyboard, channelSubscriptionText,
  homeKeyboard, infoKeyboard, partnerKeyboard, profileAppKeyboard, profileRow, squadKeyboard, statusKeyboard,
  statusText, xpKeyboard, xpProfileText, xpRulesText, xpTopText,
} from './ui.js';
import { base64ToBytes, boldHtml, escapeHtml, now, truncate } from './util.js';
import { INFO_JPG_BASE64 } from './photo_data.js';
import { explicitXpChatId, resolveXpChat, xpSourceChannelId } from './xpchat.js';
import { handleAdminCallback } from './admin.js';
import * as blacklist from './blacklist.js';
import * as importer from './importer.js';
import * as jobs from './jobs.js';
import * as rankAdmin from './rank_admin.js';
import * as shopAdmin from './shop_admin.js';
import * as relay from './relay.js';
import * as xp from './xp.js';

const PUMP_INTERVAL_SECONDS = 30;

// ---- start photo -----------------------------------------------------------

async function sendStartPhoto(chatId, caption, replyMarkup) {
  const params = { chat_id: chatId, caption, parse_mode: 'HTML', reply_markup: replyMarkup };
  const cached = await getSetting('start_photo_file_id');
  if (cached) {
    try {
      return await api.sendPhoto({ ...params, photo: cached });
    } catch (err) {
      if (!isBadRequest(err)) throw err; // stale file_id → upload again
    }
  }
  const result = await api.sendPhoto({
    ...params, photo: new InputFile(base64ToBytes(INFO_JPG_BASE64), 'info.jpg', { type: 'image/jpeg' }),
  });
  const sizes = result && result.photo;
  if (sizes && sizes.length) await setSetting('start_photo_file_id', sizes[sizes.length - 1].file_id);
  return result;
}

// ---- commands --------------------------------------------------------------

async function start(message, s, args = []) {
  rankAdmin.clear(s, { allActions: true });
  shopAdmin.clear(s);
  const returning = Boolean(await getUser(message.from.id));
  await trackUser(message.from);
  if ((await isMaintenance()) && !isAdminUser(message.from)) {
    await replyBold(message, '🛠 Бот временно на техработах.\nПопробуй чуть позже.');
    return;
  }
  // "Открыть профиль" in a group leads here: t.me/<bot>?start=profile.
  if (args[0] === 'profile' && message.chat.type === 'private') {
    await replyBold(message, '👤 Профиль Фини\n\nРанг, прогресс до следующего звания, топ Сквада и история XP.',
      profileAppKeyboard());
    return;
  }
  const caption = returning ? '<b>С возвращением. FINYA HELPER на месте. Выбирай раздел:</b>' : HOME_TEXT;
  await sendStartPhoto(message.chat.id, caption, homeKeyboard(message.chat.type));
}

async function adminCommand(message, s) {
  if (!rankAdmin.allowed(message.from, message.chat)) return;
  rankAdmin.clear(s, { allActions: true });
  shopAdmin.clear(s);
  await trackUser(message.from);
  await setSetting('admin_chat_id', OWNER_USER_ID);
  await replyBold(message, '🛠 Админ-панель FINYA HELPER\n\nУправление ботом:', await adminKeyboard());
}

async function cancelCommand(message, s) {
  if (!rankAdmin.allowed(message.from, message.chat)) return;
  rankAdmin.clear(s, { allActions: true });
  shopAdmin.clear(s);
  await replyBold(message, 'Действие отменено.', rankAdmin.rankKeyboard());
}

// /shopkey <GitHub key> lets Финя edit the SQUAD SHOP products (/admin → Товары).
async function shopKeyCommand(message, s, args) {
  if (!rankAdmin.allowed(message.from, message.chat)) return;
  const key = args[0] || '';
  if (key) {
    try {
      await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id });
    } catch {
      // Too old or already gone: the key still works, the owner can delete it by hand.
    }
  }
  if (!shopAdmin.isKey(key)) {
    await replyBold(message, (key ? 'Это не похоже на ключ GitHub.\n\n' : '') + escapeHtml(shopAdmin.KEY_HELP));
    return;
  }
  try {
    await shopAdmin.saveKey(key);
    await replyBold(message, '✅ Ключ GitHub подключён. Товары: /admin → «Товары SQUAD SHOP».', keyboard([[button('Товары SQUAD SHOP', { callback_data: 'admin:shop' })]]));
  } catch (err) {
    if (!(err instanceof shopAdmin.ShopError)) await logError('shopkey', err);
    await replyBold(message, '❌ ' + escapeHtml(err instanceof shopAdmin.ShopError ? err.message : 'Не получилось проверить ключ. Повтори чуть позже.'));
  }
}

async function rankCommand(message) {
  if (message.chat.type === 'private') await trackUser(message.from);
  await replyBold(message, await xpProfileText(message.from), xpKeyboard(await profileRow(message.chat)));
}

async function topCommand(message, args) {
  if (message.chat.type === 'private') await trackUser(message.from);
  const weekly = Boolean(args.length && ['week', 'неделя'].includes(args[0].toLowerCase()));
  await replyBold(message, await xpTopText(weekly), xpKeyboard(await profileRow(message.chat)));
}

async function xpChatCommand(message, args) {
  if (!isAdminUser(message.from)) return;
  if (args.length === 1 && args[0] === 'auto') {
    await setSetting('xp_discussion_chat_id', null);
    await setSetting('xp_chat_cache', null);
    await reply(message, 'Включено автоматическое определение обсуждений канала. Проверка: /admin → Активность / XP.');
    return;
  }
  if (args.length || !['group', 'supergroup'].includes(message.chat.type)) {
    await reply(message, 'Отправь /xpchat в группе обсуждений, где Финя назначена администратором.');
    return;
  }
  let member;
  try {
    const me = await getMe();
    member = await api.getChatMember({ chat_id: message.chat.id, user_id: me.id });
  } catch {
    await reply(message, 'Не удалось проверить права Фини в этой группе. Повтори /xpchat чуть позже.');
    return;
  }
  if (!isAdminStatus(member)) {
    await reply(message, 'Сначала назначь Финю администратором этой группы, затем повтори /xpchat.');
    return;
  }
  await setSetting('xp_discussion_chat_id', message.chat.id);
  await reply(message, 'Учёт XP подключён. +5 за комментарий, +1 за реакцию в обсуждениях постов @THKC_SQUAD. Профиль: /rank, рейтинг: /top.');
}

function relayCommandAllowed(message, args) {
  return isAdminUser(message.from) && ['group', 'supergroup'].includes(message.chat.type) && !args.length;
}

async function postsOnCommand(message, args) {
  if (!isAdminUser(message.from)) return;
  if (!relayCommandAllowed(message, args)) {
    await reply(message, 'Отправь /posts_on в том чате, куда нужно присылать посты @THKC_SQUAD.');
    return;
  }
  const chat = message.chat;
  try {
    const me = await getMe();
    let member = await api.getChatMember({ chat_id: chat.id, user_id: me.id });
    if (!isAdminStatus(member)) {
      await reply(message, 'Назначь Финю администратором этого чата: это нужно для постов и учёта реакций. Затем повтори /posts_on.');
      return;
    }
    const source = await api.getChat({ chat_id: xpSourceChannelId() });
    member = await api.getChatMember({ chat_id: source.id, user_id: me.id });
    if (!isAdminStatus(member)) {
      await reply(message, 'Для получения новых постов Финя должна быть администратором канала @THKC_SQUAD.');
      return;
    }
    if (source.linked_chat_id === chat.id) {
      await reply(message, 'Этот чат уже привязан к каналу как обсуждения. Telegram присылает посты сам; вторую копию Финя добавлять не будет.');
      return;
    }
  } catch {
    await reply(message, 'Не удалось проверить права. Проверь доступ Фини к каналу и этому чату, затем повтори /posts_on.');
    return;
  }
  const isNew = await relay.enable(chat.id, chat.title);
  await reply(message, isNew
    ? 'Готово: новые посты @THKC_SQUAD будут приходить сюда. Реакции: +1 XP, ответы на посты: +5 XP. Отключить: /posts_off.'
    : 'Посты @THKC_SQUAD уже включены для этого чата. Повтор команды не создаёт дублей.');
}

async function postsOffCommand(message, args) {
  if (!isAdminUser(message.from)) return;
  if (!relayCommandAllowed(message, args)) {
    await reply(message, 'Отправь /posts_off в чате, где нужно отключить посты.');
    return;
  }
  await relay.disable(message.chat.id);
  await reply(message, 'Отправка постов в этот чат отключена, ожидающие отправки отменены. Накопленный XP сохраняется.');
}

async function postsRetryCommand(message, args) {
  if (!isAdminUser(message.from)) return;
  if (!['group', 'supergroup'].includes(message.chat.type) || args.length !== 1 ||
      !/^[0-9]+$/.test(args[0]) || Number(args[0]) <= 0) {
    await reply(message, 'Проверь, что пост не появился в чате, затем отправь /posts_retry ID_поста. ID виден в /admin → Посты в чаты.');
    return;
  }
  if (!(await relay.enabled(message.chat.id))) {
    await reply(message, 'Сначала включи отправку в этот чат командой /posts_on.');
    return;
  }
  const count = await relay.retryUncertain(message.chat.id, Number(args[0]));
  await reply(message, `Поставлено на повтор: ${count}. Подтверждённо доставленные посты повторно не отправляются.`);
  if (count) await relay.deliverDue(5000, 3);
}

// ---- private text ----------------------------------------------------------

async function textMessage(message, s) {
  if (await rankAdmin.handleText(message, s)) return;
  if (await shopAdmin.handleText(message, s)) return;
  if (rankAdmin.allowed(message.from, message.chat) && s.rank_admin_pending) {
    await replyBold(message, 'Подтверди действие кнопкой или нажми «Отмена». /cancel — отменить.');
    return;
  }
  await trackUser(message.from);
  const text = String(message.text || '').trim();
  if (!text) return;

  if (isAdminUser(message.from) && s.admin_action) {
    const action = s.admin_action;
    delete s.admin_action;
    if (action === 'set_news') {
      await setSetting('news', truncate(text, 3500));
      await replyBold(message, '✅ Новость обновлена.', await adminKeyboard());
      return;
    }
    if (action === 'broadcast') {
      if (boldHtml(escapeHtml(text)).length > 4096) {
        s.admin_action = 'broadcast';
        await replyBold(message, 'Текст слишком длинный для одного сообщения Telegram. Сократи его и отправь снова.');
        return;
      }
      // Nothing goes out until the owner confirms: one stray message must not reach every user.
      s.broadcast_pending = { text, time: now() };
      const preview = escapeHtml(text.slice(0, 600)) + (text.length > 600 ? '…' : '');
      await replyBold(message, `📣 Подтверди рассылку\n\nПолучателей: ${await userCount()}\n\n${preview}`, keyboard([[
        button('Отправить всем', { callback_data: 'admin:broadcast_send' }),
        button('Отмена', { callback_data: 'admin:broadcast_cancel' }),
      ]]));
      return;
    }
  }

  if (s.awaiting_feedback) {
    delete s.awaiting_feedback;
    const user = message.from;
    await addFeedback(user, text);
    await replyBold(message, '✅ Отправлено владельцу. Спасибо ❤️');
    const who = user.username ? `@${user.username}` : `${user.first_name} (${user.id})`;
    try {
      await api.sendMessage({
        chat_id: OWNER_USER_ID,
        text: boldHtml(`📬 Новый фидбек от ${escapeHtml(String(who))}:\n\n${escapeHtml(text.slice(0, 3500))}`),
        parse_mode: 'HTML',
      });
    } catch {
      // The owner may have blocked the bot; feedback is stored anyway.
    }
  }
}

// ---- XP in groups ----------------------------------------------------------

async function notifyPromotion(user, award) {
  if (!award || !award.promoted || user.id === OWNER_USER_ID) return;
  // Do not try to initiate private chats with discussion-only participants.
  const known = await getUser(user.id);
  if (!known || known.blocked) return;
  try {
    await api.sendMessage({
      chat_id: user.id,
      text: boldHtml(`Новое звание Сквада!\n\n${award.newRank[1]} · ${award.newRank[2]}\nВсего: ${award.total} XP`),
      parse_mode: 'HTML',
      reply_markup: xpKeyboard(await profileRow(null)),
    });
  } catch {
    console.info(`Could not deliver rank promotion to ${user.id}`);
  }
}

async function xpChatMatches(chatId) {
  if (await isMaintenance()) return false;
  if (await relay.hasTarget(chatId)) return true;
  const explicit = await explicitXpChatId();
  const target = explicit || await resolveXpChat();
  return chatId === target;
}

async function activityMessage(message) {
  if (!['group', 'supergroup'].includes(message.chat.type)) return;
  if (!(await xpChatMatches(message.chat.id))) return;
  const award = await xp.comment(message, xpSourceChannelId());
  if (award) await notifyPromotion(message.from, award);
}

export async function onMessageReaction(event) {
  try {
    if (!event || !['group', 'supergroup'].includes(event.chat.type)) return;
    if (!(await xpChatMatches(event.chat.id))) return;
    const award = await xp.reaction(event);
    if (award) await notifyPromotion(event.user, award);
  } finally {
    await pump();
  }
}

// ---- routing ---------------------------------------------------------------

function parseCommand(message) {
  const text = message.text;
  const first = (message.entities || [])[0];
  if (!text || !first || first.type !== 'bot_command' || first.offset !== 0) return null;
  const [name, botName] = text.slice(1, first.length).split('@');
  return {
    command: name.toLowerCase(),
    botName: botName || null,
    args: text.slice(first.length).trim().split(/\s+/).filter(Boolean),
  };
}

const COMMANDS = {
  start: (m, s, a) => start(m, s, a),
  admin: (m, s) => adminCommand(m, s),
  cancel: (m, s) => cancelCommand(m, s),
  shopkey: (m, s, a) => shopKeyCommand(m, s, a),
  rank: (m) => rankCommand(m),
  top: (m, s, a) => topCommand(m, a),
  xpchat: (m, s, a) => xpChatCommand(m, a),
  posts_on: (m, s, a) => postsOnCommand(m, a),
  posts_off: (m, s, a) => postsOffCommand(m, a),
  posts_retry: (m, s, a) => postsRetryCommand(m, a),
};

export async function onMessage(message) {
  try {
    if (['group', 'supergroup'].includes(message.chat.type)) {
      try {
        await activityMessage(message);
      } catch (err) {
        await logError('xp.comment', err);
      }
    }
    const cmd = parseCommand(message);
    if (cmd) {
      const handler = COMMANDS[cmd.command];
      if (!handler) return;
      if (cmd.botName) {
        const me = await getMe();
        if (cmd.botName.toLowerCase() !== String(me.username).toLowerCase()) return;
      }
      await withSession(message.from && message.from.id, (s) => handler(message, s, cmd.args));
      return;
    }
    if (message.chat.type !== 'private' || !message.from) return;
    if (message.document && isAdminUser(message.from) && importer.looksLikeExport(message.document)) {
      await importer.importFromMessage(message);
      return;
    }
    if ((message.photo || message.document) && isAdminUser(message.from)) {
      let handled = false;
      await withSession(message.from.id, async (s) => { handled = await shopAdmin.handleMedia(message, s); });
      if (handled) return;
    }
    if (typeof message.text === 'string') {
      await withSession(message.from.id, (s) => textMessage(message, s));
    }
  } finally {
    await pump();
  }
}

async function button_(query, s) {
  const data = query.data || '';
  const user = query.from;
  const chat = query.message && query.message.chat;
  if (!data.startsWith('admin:xp')) rankAdmin.clear(s);
  if (!data.startsWith('admin:')) shopAdmin.clear(s);
  if (!query.message) {
    await answer(query);
    return;
  }
  // Telegram accepts only the first answer, so the alert button answers itself.
  const answersItself = data === 'channel:last';
  if (!answersItself) await answer(query);
  if (chat.type === 'private') await trackUser(user);

  if ((await isMaintenance()) && !isAdminUser(user) && data !== 'home') {
    if (answersItself) await answer(query);
    await editOrSend(query, '🛠 <b>Бот временно на техработах.</b>', backHomeKeyboard());
    return;
  }
  if (data.startsWith('xp:')) {
    delete s.awaiting_feedback;
    delete s.admin_action;
  }

  let text;
  let kb;
  if (data === 'info') {
    [text, kb] = [INFO_TEXT, infoKeyboard()];
  } else if (data === 'squad') {
    [text, kb] = [SQUAD_TEXT, squadKeyboard()];
  } else if (data === 'home') {
    [text, kb] = [HOME_TEXT, homeKeyboard(chat.type)];
  } else if (data === 'news') {
    [text, kb] = await channelNewsView();
  } else if (data === 'status') {
    [text, kb] = [await statusText(user.id), await statusKeyboard(user.id)];
  } else if (data === 'xp:profile') {
    [text, kb] = [await xpProfileText(user), xpKeyboard(await profileRow(chat))];
  } else if (data === 'xp:top' || data === 'xp:week') {
    [text, kb] = [await xpTopText(data === 'xp:week'), xpKeyboard(await profileRow(chat))];
  } else if (data === 'xp:rules') {
    [text, kb] = [xpRulesText(), xpKeyboard(await profileRow(chat))];
  } else if (data === 'status:subscribe' || data === 'status:unsubscribe') {
    await setSubscribed(user, data === 'status:subscribe');
    [text, kb] = [await statusText(user.id), await statusKeyboard(user.id)];
  } else if (data === 'channel_notify') {
    [text, kb] = [await channelSubscriptionText(user.id), await channelSubscriptionKeyboard(user.id)];
  } else if (data === 'channel:subscribe') {
    await setSubscribed(user, true);
    text = '✅ <b>Готово. Рассылка T.N.K.C SQUAD включена.</b>\n\nНовые посты будут приходить сюда автоматически.';
    kb = await channelSubscriptionKeyboard(user.id);
  } else if (data === 'channel:unsubscribe') {
    await setSubscribed(user, false);
    text = '🔕 <b>Рассылка T.N.K.C SQUAD выключена.</b>';
    kb = await channelSubscriptionKeyboard(user.id);
  } else if (data === 'channel:last') {
    const lastPostId = await getSetting('last_channel_post_id');
    if (!lastPostId) {
      await answer(query, 'Последний пост пока не сохранён.', true);
      return;
    }
    try {
      await api.copyMessage({ chat_id: user.id, from_chat_id: `@${SQUAD_CHANNEL_USERNAME}`, message_id: Number(lastPostId) });
    } catch (err) {
      console.warn('Could not send last channel post', err);
      await answer(query, 'Не получилось получить последний пост.', true);
      return;
    }
    await answer(query);
    return;
  } else if (data === 'feedback') {
    s.awaiting_feedback = true;
    text = '<b>💬 Обратная связь</b>\n\nНапиши следующим сообщением проблему, идею или предложение.\nЯ передам это владельцу.';
    kb = backHomeKeyboard();
  } else if (data.startsWith('partner:')) {
    const partner = PARTNERS[data.split(':')[1]];
    if (!partner) {
      [text, kb] = [INFO_TEXT, infoKeyboard()];
    } else {
      text = `<b>🤝 ${partner.name}\n\nПартнёр Сквада\nВыбери соцсеть:</b>`;
      kb = partnerKeyboard(partner);
    }
  } else if (data.startsWith('admin:')) {
    if (!isAdminUser(user)) return;
    await handleAdminCallback(query, s, data.slice('admin:'.length));
    return;
  } else {
    return;
  }
  await editOrSend(query, text, kb);
}

export async function onCallbackQuery(query) {
  let runJobId = null;
  let runPending = false;
  try {
    await withSession(query.from.id, async (s) => {
      await button_(query, s);
      runJobId = s.run_job || null;
      runPending = Boolean(s.run_pending_jobs);
      delete s.run_job;
      delete s.run_pending_jobs;
    });
    if (runJobId || runPending) await continueBroadcast(query.from.id, runJobId);
  } finally {
    await pump();
  }
}

// Sends a slice of the owner's broadcast; if it did not finish, says so.
async function continueBroadcast(ownerChatId, jobId) {
  if (jobId) {
    if (await jobs.runJob(jobId)) return;
  } else {
    await jobs.runPendingJobs();
  }
  const running = await jobs.runningBroadcast();
  if (!running) return;
  const job = await jobs.jobProgress(running.id);
  await api.sendMessage({
    chat_id: ownerChatId,
    text: boldHtml(`📣 Рассылка идёт: доставлено ${job.ok}, ошибок ${job.failed}.\n` +
      'Остальным отправлю автоматически, пока в боте есть активность. Можно ускорить кнопкой.'),
    parse_mode: 'HTML',
    reply_markup: keyboard([[button('Продолжить рассылку', { callback_data: 'admin:broadcast_continue' })]]),
  });
}

// ---- channel posts ---------------------------------------------------------

function isSquadChannel(chat) {
  if (!chat) return false;
  if (chat.id === xpSourceChannelId()) return true;
  return String(chat.username || '').replace(/^@/, '').toLowerCase() === SQUAD_CHANNEL_USERNAME.toLowerCase();
}

export async function onChannelPost(message) {
  try {
    if (!message || !isSquadChannel(message.chat)) return;
    // Group delivery is independent of personal subscribers and their toggle.
    const username = String(message.chat.username || SQUAD_CHANNEL_USERNAME).replace(/^@/, '');
    const postUrl = `https://t.me/${username}/${message.message_id}`;
    await relay.enqueue(message, postUrl);
    if ((await getSetting('last_channel_post_id')) !== message.message_id) {
      await setSetting('last_channel_post_id', message.message_id);
    }
    if (!(await isMaintenance())) await relay.deliverDue(8000);
    if (!(await getSetting('channel_broadcast_enabled'))) return;
    const sub = await db.get(sql`SELECT 1 AS x FROM users WHERE subscribed = 1 LIMIT 1`);
    if (!sub) return;
    await jobs.createPostJob(message, postUrl);
    await jobs.runPendingJobs();
  } finally {
    await pump();
  }
}

export async function onChatMember(event) {
  try {
    await blacklist.handleChatMember(event);
  } finally {
    await pump();
  }
}

// ---- background work, piggybacking on incoming updates -----------------------

async function acquirePump() {
  const ts = now();
  await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES ('pump_at', '0')`);
  const r = await db.run(sql`UPDATE settings SET value = ${String(ts)}
    WHERE key = 'pump_at' AND CAST(value AS REAL) < ${ts - PUMP_INTERVAL_SECONDS}`);
  return r.rowsAffected === 1;
}

// The menu button next to the message field opens the Mini App in every private chat.
async function ensureMenuButton() {
  if ((await getSetting('menu_button_url')) === WEBAPP_URL) return;
  await api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Профиль', web_app: { url: WEBAPP_URL } } });
  await setSetting('menu_button_url', WEBAPP_URL);
}

// Retries and unfinished sends: what asyncio loops did on the old server.
export async function pump({ force = false } = {}) {
  try {
    if (!force && !(await acquirePump())) return;
    await ensureMenuButton();
    await relay.sweepStale();
    if (!(await isMaintenance())) await relay.deliverDue(5000, 10);
    await blacklist.retryPending(5);
    await jobs.runPendingJobs(10000);
  } catch (err) {
    await logError('pump', err);
  }
}
