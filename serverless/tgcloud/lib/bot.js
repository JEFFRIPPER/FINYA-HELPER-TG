// Update routing and user-facing handlers (port of bot_core.py + bot.py wrappers).
import { api, db, InputFile } from 'sdk';
import { sql } from 'sdk/db';
import {
  HOME_TEXT, INFO_TEXT, MORE_TEXT, OWNER_USER_ID, PARTNERS, SQUAD_CHANNEL_USERNAME, SQUAD_TEXT, WEBAPP_URL,
} from './config.js';
import {
  answer, button, editOrSend, getMe, isAdminStatus, isBadRequest, isRetryAfter, keyboard, reply, replyBold,
} from './tg.js';
import {
  addFeedback, deleteLater, getSetting, getUser, GROUP_REPLY_TTL, isAdminUser, isMaintenance, logError, setSetting,
  setSubscribed, trackUser, userCount, withSession,
} from './store.js';
import {
  adminKeyboard, backHomeKeyboard, backMoreKeyboard, channelNewsView, channelSubscriptionKeyboard, channelSubscriptionText,
  homeKeyboard, infoKeyboard, moreKeyboard, partnerKeyboard, profileAppKeyboard, profileRow, squadKeyboard, statusKeyboard,
  statusText, xpKeyboard, xpProfileText, xpRulesText, xpTopText,
} from './ui.js';
import { base64ToBytes, boldHtml, escapeHtml, now, truncate } from './util.js';
import { INFO_JPG_BASE64 } from './photo_data.js';
import { explicitXpChatId, resolveXpChat, xpSourceChannelId } from './xpchat.js';
import { handleAdminCallback } from './admin.js';
import * as blacklist from './blacklist.js';
import * as chat from './chat.js';
import * as changelog from './changelog.js';
import * as club from './club.js';
import * as emoji from './emoji.js';
import * as importer from './importer.js';
import * as jobs from './jobs.js';
import * as rankAdmin from './rank_admin.js';
import * as shopAdmin from './shop_admin.js';
import * as relay from './relay.js';
import * as xp from './xp.js';

const PUMP_INTERVAL_SECONDS = 30;
// The platform cuts a call off after ~30 s; everything one update does must fit in this.
const CALL_BUDGET_MS = 24000;

const leftMs = (deadline) => deadline - Date.now();

// Channel service messages (pin, new title or photo, video chat…) are not posts to copy.
const POST_CONTENT = [
  'text', 'photo', 'video', 'animation', 'audio', 'document', 'voice', 'video_note', 'sticker', 'poll',
  'location', 'venue', 'contact', 'dice', 'paid_media', 'story', 'giveaway', 'giveaway_winners', 'checklist',
];
const isContentPost = (message) => POST_CONTENT.some((key) => message[key] != null);

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

// ---- one live menu in private, self-cleaning replies in groups -----------------

// A private chat keeps one menu: the user's command and the previous menu go away.
async function tidyPrivate(message, s, sent) {
  if (!message || message.chat.type !== 'private') return;
  // The prompt «напиши текст» is deleted with the old menu, so its mode must end too.
  delete s.awaiting_feedback;
  delete s.admin_action;
  rankAdmin.clear(s, { allActions: true });
  shopAdmin.clear(s);
  const old = s.menu_id;
  if (sent && sent.message_id) s.menu_id = sent.message_id;
  for (const id of [message.message_id, old]) {
    if (!id || id === s.menu_id) continue;
    try {
      await api.deleteMessage({ chat_id: message.chat.id, message_id: id });
    } catch {
      // Older than 48 hours or already gone.
    }
  }
}

export { GROUP_REPLY_TTL };

// /rank and /top in a group: the command and the answer disappear after a while.
async function cleanUpLater(message, sent) {
  if (!['group', 'supergroup'].includes(message.chat.type)) return;
  try {
    await deleteLater(message.chat.id, [message.message_id, sent && sent.message_id]);
  } catch (err) {
    // The reply is already out; a failed clean-up must not make Telegram resend the update.
    await logError('autodelete', err);
  }
}

async function deleteDue(deadline, limit = 20) {
  const rows = await db.all(sql`SELECT chat_id, message_id FROM autodelete WHERE delete_at <= ${now()}
    ORDER BY delete_at LIMIT ${limit}`);
  for (const r of rows) {
    if (leftMs(deadline) < 3000) break;
    try {
      await api.deleteMessage({ chat_id: r.chat_id, message_id: r.message_id });
    } catch (err) {
      // Flood limit: try again on a later pump. Anything else (no rights, older than
      // 48 hours, already deleted) will not get better, so the row goes.
      if (isRetryAfter(err)) break;
    }
    await db.run(sql`DELETE FROM autodelete WHERE chat_id = ${r.chat_id} AND message_id = ${r.message_id}`);
  }
}

// The «/» menu: three commands for everyone, the owner also sees his own.
const COMMANDS_VERSION = '3';
async function ensureCommands() {
  if ((await getSetting('commands_version')) === COMMANDS_VERSION) return;
  const common = [
    { command: 'start', description: 'Главное меню' },
    { command: 'rank', description: 'Мой ранг и XP' },
    { command: 'top', description: 'Топ Сквада' },
  ];
  await api.setMyCommands({ commands: common });
  // Saved right away: a failing owner list must not repeat (and log) on every pump.
  await setSetting('commands_version', COMMANDS_VERSION);
  try {
    await api.setMyCommands({
      commands: [
        ...common, { command: 'admin', description: 'Админ-панель' }, { command: 'cancel', description: 'Отменить действие' },
        { command: 'log', description: 'Новость об обновлении: /log post — в CHANGELOG' },
      ],
      scope: { type: 'chat', chat_id: OWNER_USER_ID },
    });
  } catch (err) {
    await logError('commands.owner', err);
  }
}

// ---- commands --------------------------------------------------------------

async function start(message, s, args = []) {
  rankAdmin.clear(s, { allActions: true });
  shopAdmin.clear(s);
  const returning = Boolean(await getUser(message.from.id));
  await trackUser(message.from);
  if ((await isMaintenance()) && !isAdminUser(message.from)) {
    await tidyPrivate(message, s, await replyBold(message, '🛠 Бот временно на техработах.\nПопробуй чуть позже.'));
    return;
  }
  // "Открыть профиль" in a group leads here: t.me/<bot>?start=profile.
  if (args[0] === 'profile' && message.chat.type === 'private') {
    await tidyPrivate(message, s, await replyBold(message,
      '👤 Профиль Фини\n\nРанг, прогресс до следующего звания, топ Сквада и история XP.', profileAppKeyboard()));
    return;
  }
  // "Все ссылки Сквада" in a group leads here: t.me/<bot>?start=squad.
  if (args[0] === 'squad' && message.chat.type === 'private') {
    await tidyPrivate(message, s, await replyBold(message, SQUAD_TEXT, await squadKeyboard(message.chat)));
    return;
  }
  const caption = returning ? '<b>С возвращением. FINYA HELPER на месте.</b>' : HOME_TEXT;
  await tidyPrivate(message, s, await sendStartPhoto(message.chat.id, caption, await homeKeyboard(message.chat)));
}

async function adminCommand(message, s) {
  if (!rankAdmin.allowed(message.from, message.chat)) return;
  rankAdmin.clear(s, { allActions: true });
  shopAdmin.clear(s);
  await trackUser(message.from);
  await setSetting('admin_chat_id', OWNER_USER_ID);
  await tidyPrivate(message, s, await replyBold(message, '🛠 Админ-панель FINYA HELPER\n\nУправление ботом:', await adminKeyboard()));
}

async function cancelCommand(message, s) {
  if (s.awaiting_feedback && message.chat.type === 'private') {
    delete s.awaiting_feedback;
    await tidyPrivate(message, s, await replyBold(message, 'Отменено. Обратная связь не отправлена.', backHomeKeyboard()));
    return;
  }
  if (!rankAdmin.allowed(message.from, message.chat)) return;
  rankAdmin.clear(s, { allActions: true });
  shopAdmin.clear(s);
  await replyBold(message, 'Действие отменено.', rankAdmin.rankKeyboard());
}

// /shopkey <GitHub key> lets Финя edit the SQUAD SHOP products (/admin → Товары).
async function shopKeyCommand(message, s, args) {
  if (!isAdminUser(message.from)) return;
  const key = args[0] || '';
  if (key) {
    try {
      await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id });
    } catch {
      // Too old or already gone: the key still works, the owner can delete it by hand.
    }
  }
  if (!rankAdmin.allowed(message.from, message.chat)) {
    if (key) {
      await reply(message, 'Ключ GitHub присылай только мне в личку. Этот ключ был виден в чате: лучше перевыпусти его.');
    }
    return;
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

const isGroup = (chat) => Boolean(chat) && ['group', 'supergroup'].includes(chat.type);
const xpMenu = async (chat) => xpKeyboard(await profileRow(chat), { group: isGroup(chat) });

async function rankCommand(message, s) {
  if (message.chat.type === 'private') await trackUser(message.from);
  const sent = await replyBold(message, await xpProfileText(message.from), await xpMenu(message.chat));
  await tidyPrivate(message, s, sent);
  await cleanUpLater(message, sent);
}

async function topCommand(message, s, args) {
  if (message.chat.type === 'private') await trackUser(message.from);
  const weekly = Boolean(args.length && ['week', 'неделя'].includes(args[0].toLowerCase()));
  const sent = await replyBold(message, await xpTopText(weekly), await xpMenu(message.chat));
  await tidyPrivate(message, s, sent);
  await cleanUpLater(message, sent);
}

async function xpChatCommand(message, args) {
  if (!isAdminUser(message.from)) return;
  if (args.length === 1 && args[0] === 'auto') {
    await setSetting('xp_discussion_chat_id', null);
    await setSetting('xp_chat_cache', null);
    await reply(message, 'Включено автоматическое определение обсуждений канала. Проверка: /admin → Участники → Звания / XP.');
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
    await reply(message, 'Проверь, что пост не появился в чате, затем отправь /posts_retry ID_поста. ID виден в /admin → Рассылки → Посты в чаты.');
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
      await replyBold(message, '✅ Новость обновлена.', await adminKeyboard('posts'));
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
      const preview = escapeHtml(truncate(text, 600)) + (Array.from(text).length > 600 ? '…' : '');
      await replyBold(message, `📣 Подтверди рассылку\n\nПолучателей: ${await userCount()}\n\n${preview}`, keyboard([[
        button('Отправить всем', { callback_data: 'admin:broadcast_send' }),
        button('Отмена', { callback_data: 'admin:broadcast_cancel' }),
      ]]));
      return;
    }
  }

  // The owner sends premium emoji: Финя takes their packs for her chat replies.
  if (isAdminUser(message.from) && (await emoji.handlePrivate(message))) return;

  if (!s.awaiting_feedback) {
    // «фарм», «кто я», «браки»… work in the private chat too, except during maintenance.
    if (!(await isMaintenance()) || isAdminUser(message.from)) await chat.handleText(message);
    return;
  }
  delete s.awaiting_feedback;
  const user = message.from;
  await addFeedback(user, text);
  await replyBold(message, '✅ Отправлено владельцу. Спасибо ❤️');
  const who = user.username ? `@${user.username}` : `${user.first_name} (${user.id})`;
  try {
    await api.sendMessage({
      chat_id: OWNER_USER_ID,
      text: boldHtml(`📬 Новый фидбек от ${escapeHtml(String(who))}:\n\n${escapeHtml(truncate(text, 3500))}`),
      parse_mode: 'HTML',
    });
  } catch {
    // The owner may have blocked the bot; feedback is stored anyway.
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
      reply_markup: keyboard([await profileRow(null)]),
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

// A message in a Squad chat: commands in words, members and protection (lib/chat.js), then XP.
async function squadMessage(message, command) {
  let squad = false;
  let result = { handled: false, checking: [] };
  try {
    squad = await xpChatMatches(message.chat.id);
    if (squad) result = await chat.onSquadMessage(message, { command });
  } catch (err) {
    // A failure here must not stop /rank and other commands below.
    await logError('chat', err);
  }
  if (!squad || result.handled) return;
  try {
    if (message.new_chat_members) {
      // Newcomers with the «Я не бот» check are greeted once they pass it.
      const people = message.new_chat_members.filter((u) => !result.checking.includes(u.id));
      if (people.length) await club.welcome({ ...message, new_chat_members: people });
      return;
    }
    const award = await xp.comment(message, xpSourceChannelId());
    if (award) await notifyPromotion(message.from, award);
  } catch (err) {
    await logError('xp.comment', err);
  }
}

export async function onMessageReaction(event) {
  const deadline = Date.now() + CALL_BUDGET_MS;
  try {
    if (!event || !['group', 'supergroup'].includes(event.chat.type)) return;
    if (!(await xpChatMatches(event.chat.id))) return;
    const award = await xp.reaction(event);
    if (award) await notifyPromotion(event.user, award);
  } finally {
    await pump({ deadline });
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
  rank: (m, s) => rankCommand(m, s),
  top: (m, s, a) => topCommand(m, s, a),
  xpchat: (m, s, a) => xpChatCommand(m, a),
  posts_on: (m, s, a) => postsOnCommand(m, a),
  posts_off: (m, s, a) => postsOffCommand(m, a),
  posts_retry: (m, s, a) => postsRetryCommand(m, a),
  log: (m, s, a) => changelog.command(m, a, isAdminUser(m.from)),
};

export async function onMessage(message) {
  const deadline = Date.now() + CALL_BUDGET_MS;
  try {
    const cmd = parseCommand(message);
    if (['group', 'supergroup'].includes(message.chat.type)) await squadMessage(message, Boolean(cmd));
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
    await pump({ deadline });
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
  // Any other button leaves the "type your text" modes: a stray message later must not
  // become feedback to the owner or replace the channel news.
  if (data !== 'feedback') delete s.awaiting_feedback;
  if (!data.startsWith('admin:')) delete s.admin_action;

  let text;
  let kb;
  if (data === 'info') {
    [text, kb] = [INFO_TEXT, infoKeyboard()];
  } else if (data === 'more') {
    [text, kb] = [MORE_TEXT, moreKeyboard()];
  } else if (data === 'squad') {
    [text, kb] = [SQUAD_TEXT, await squadKeyboard(chat)];
  } else if (data === 'home') {
    [text, kb] = [HOME_TEXT, await homeKeyboard(chat)];
  } else if (data === 'news') {
    [text, kb] = await channelNewsView();
  } else if (data === 'status') {
    [text, kb] = [await statusText(user.id), await statusKeyboard(user.id)];
  } else if (data === 'xp:profile') {
    [text, kb] = [await xpProfileText(user), await xpMenu(chat)];
  } else if (data === 'xp:top' || data === 'xp:week') {
    [text, kb] = [await xpTopText(data === 'xp:week'), await xpMenu(chat)];
  } else if (data === 'xp:rules') {
    [text, kb] = [xpRulesText(), await xpMenu(chat)];
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
    kb = backMoreKeyboard();
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
  const sent = await editOrSend(query, text, kb);
  if (chat.type !== 'private') return;
  // The menu in use is the live one; an older menu left from before goes away.
  const live = (sent && sent.message_id) || query.message.message_id;
  const old = s.menu_id;
  s.menu_id = live;
  if (old && old !== live && old !== query.message.message_id) {
    try {
      await api.deleteMessage({ chat_id: chat.id, message_id: old });
    } catch {
      // Older than 48 hours or already gone.
    }
  }
}

export async function onCallbackQuery(query) {
  const deadline = Date.now() + CALL_BUDGET_MS;
  let runJobId = null;
  let runPending = false;
  try {
    // Marriage, divorce, «Я не бот» and «Снять мут» buttons in the chats.
    if (await chat.handleCallback(query)) return;
    await withSession(query.from.id, async (s) => {
      await button_(query, s);
      runJobId = s.run_job || null;
      runPending = Boolean(s.run_pending_jobs);
      delete s.run_job;
      delete s.run_pending_jobs;
    });
    if (runJobId || runPending) await continueBroadcast(query.from.id, runJobId, leftMs(deadline) - 4000);
  } finally {
    await pump({ deadline });
  }
}

// Sends a slice of the owner's broadcast; if it did not finish, says so.
async function continueBroadcast(ownerChatId, jobId, budgetMs) {
  if (jobId) {
    if (await jobs.runJob(jobId, budgetMs)) return;
  } else {
    await jobs.runPendingJobs(budgetMs);
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
  const deadline = Date.now() + CALL_BUDGET_MS;
  try {
    if (!message || !isSquadChannel(message.chat) || !isContentPost(message)) return;
    // Group delivery is independent of personal subscribers and their toggle.
    const username = String(message.chat.username || SQUAD_CHANNEL_USERNAME).replace(/^@/, '');
    const postUrl = `https://t.me/${username}/${message.message_id}`;
    await relay.enqueue(message, postUrl);
    if ((await getSetting('last_channel_post_id')) !== message.message_id) {
      await setSetting('last_channel_post_id', message.message_id);
    }
    if (!(await isMaintenance())) await relay.deliverDue(Math.min(8000, leftMs(deadline) - 12000));
    if (!(await getSetting('channel_broadcast_enabled'))) return;
    const sub = await db.get(sql`SELECT 1 AS x FROM users WHERE subscribed = 1 LIMIT 1`);
    if (!sub) return;
    await jobs.createPostJob(message, postUrl);
    await jobs.runPendingJobs(Math.min(15000, leftMs(deadline) - 4000));
  } finally {
    await pump({ deadline });
  }
}

export async function onChatMember(event) {
  const deadline = Date.now() + CALL_BUDGET_MS;
  try {
    await blacklist.handleChatMember(event);
    await club.handleJoin(event);
    if (event.chat && ['group', 'supergroup'].includes(event.chat.type) && (await xpChatMatches(event.chat.id))) {
      try {
        await chat.onSquadChatMember(event);
      } catch (err) {
        await logError('chat.member', err);
      }
    }
  } finally {
    await pump({ deadline });
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
// Each step is separate: one failing step must not stop the others for good.
export async function pump({ force = false, deadline = Date.now() + CALL_BUDGET_MS } = {}) {
  // Too little time left in this call: the next update picks the work up.
  if (leftMs(deadline) < 6000) return;
  try {
    if (!force && !(await acquirePump())) return;
  } catch (err) {
    await logError('pump', err);
    return;
  }
  const steps = [
    ['pump.menu', () => ensureMenuButton()],
    ['pump.commands', () => ensureCommands()],
    ['pump.autodelete', () => deleteDue(deadline)],
    ['pump.relay', async () => {
      await relay.sweepStale();
      if (!(await isMaintenance())) await relay.deliverDue(Math.min(5000, leftMs(deadline) - 12000), 10);
    }],
    ['pump.blacklist', () => blacklist.retryPending(5)],
    ['club.tick', () => club.tick()],
    ['chat.tick', () => chat.tick(() => leftMs(deadline))],
    ['changelog.tick', () => changelog.tick()],
    ['pump.jobs', () => jobs.runPendingJobs(Math.min(10000, leftMs(deadline) - 2000))],
  ];
  for (const [where, step] of steps) {
    if (leftMs(deadline) < 2000) break;
    try {
      await step();
    } catch (err) {
      await logError(where, err);
    }
  }
}
