// Owner admin panel callbacks (port of handle_admin_callback and friends).
import { api } from 'sdk';
import { BLACKLIST_CHANNEL_ID } from './config.js';
import { button, editOrSend, editText, keyboard, menuButton } from './tg.js';
import {
  feedbackCount, getSetting, isAdminUser, recentErrors, recentFeedback, setSetting, userStats,
} from './store.js';
import { adminKeyboard, statusText } from './ui.js';
import { boldHtml, escapeHtml, fmtMsk, now, truncate } from './util.js';
import { BROADCAST_CONFIRM_SECONDS } from './config.js';
import * as blacklist from './blacklist.js';
import * as jobs from './jobs.js';
import * as relay from './relay.js';
import * as rankAdmin from './rank_admin.js';
import * as shopAdmin from './shop_admin.js';

export async function relayStatusText() {
  const targets = await relay.status();
  let text = 'Посты T.N.K.C SQUAD в чаты\n\n' +
    'Включить: /posts_on в нужном чате от владельца.\n' +
    'Отключить: /posts_off в том же чате.\n' +
    'Личная рассылка и отправка в чаты управляются отдельно.\n';
  if (!targets.length) {
    return text + '\nЧаты пока не подключены. Назначь Финю администратором Family и отправь там /posts_on.';
  }
  for (const t of targets.slice(0, 3)) {
    text += `\n${escapeHtml(truncate(t.title, 30))} · ${t.enabled ? 'ВКЛ' : 'ВЫКЛ'}\nID: ${t.chat_id}\n` +
      `Ожидают: ${t.pending} · Неизвестный результат: ${t.uncertain}\n`;
    if (t.uncertain_ids.length) text += 'ID постов с неизвестным результатом: ' + t.uncertain_ids.join(', ') + '\n';
    if (t.error) text += `Последняя ошибка: ${escapeHtml(truncate(t.error, 120))}\n`;
  }
  if (targets.length > 3) text += `\nПоказаны 3 из ${targets.length} подключённых чатов.\n`;
  return text +
    '\nПосле неоднозначного обрыва проверь, не появился ли пост в чате. ' +
    'Если его нет — /posts_retry ID_поста повторит выбранную отправку.\n' +
    'Реакции и ответы на доставленные посты учитываются в XP.';
}

async function showBlacklist(query, s, page = 0) {
  // The list contains personal information and belongs in the owner's private chat.
  if (!isAdminUser(query.from) || query.message.chat.type !== 'private') return;
  delete s.admin_action;
  const records = await blacklist.listRecords();
  const pageSize = 5;
  const pages = Math.max(1, Math.ceil(records.length / pageSize));
  page = Math.max(0, Math.min(page, pages - 1));
  const banned = records.filter((r) => r.status === 'banned').length;
  const channelLabel = BLACKLIST_CHANNEL_ID === -1001192817776 ? '@THKC_SQUAD' : String(BLACKLIST_CHANNEL_ID);
  let text = `Чёрный список канала ${channelLabel}\n\n` +
    `Записей: ${records.length} · Бан подтверждён: ${banned}\n` +
    `Ожидают / ошибка: ${records.length - banned}\n`;
  try {
    const me = await api.getMe();
    const member = await api.getChatMember({ chat_id: BLACKLIST_CHANNEL_ID, user_id: me.id });
    const ready = member.status === 'administrator' && member.can_restrict_members;
    text += ready ? 'Автобан: включён\n' : 'Автобан: нужны права администратора на блокировку участников\n';
  } catch {
    text += 'Автобан: не удалось проверить права в Telegram\n';
  }
  text += '\nПричина: самостоятельный выход из канала.\n';
  if (!records.length) text += '\nПока список пуст. Здесь появятся новые выходы после включения функции.';
  const statuses = { banned: 'Заблокирован', pending: 'Ожидает блокировки', failed: 'Бан не выполнен' };
  records.slice(page * pageSize, (page + 1) * pageSize).forEach((r, i) => {
    const name = escapeHtml(truncate(r.full_name || r.user_id, 100));
    const label = r.username ? ` @${escapeHtml(truncate(r.username, 40))}` : '';
    text += `\n${page * pageSize + i + 1}. ${name}${label}\nID: ${r.user_id}\n` +
      `Выход: ${fmtMsk(r.left_at)} МСК\n` +
      `Статус: ${statuses[r.status] || 'Неизвестен'}\n`;
    if (r.last_error) text += `Причина ошибки: ${escapeHtml(truncate(r.last_error, 100))}\n`;
  });
  text += `\nСтраница ${page + 1} из ${pages}`;
  const nav = [];
  if (page > 0) nav.push(button('Назад', { callback_data: `admin:blacklist:${page - 1}` }));
  if (page + 1 < pages) nav.push(button('Далее', { callback_data: `admin:blacklist:${page + 1}` }));
  const rows = nav.length ? [nav] : [];
  rows.push([button('Обновить', { callback_data: `admin:blacklist:${page}` })]);
  rows.push([menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })]);
  await editText(query, boldHtml(text), keyboard(rows));
}

async function errorsHtml() {
  const rows = await recentErrors(12);
  if (!rows.length) return '<b>Ошибки</b>\nнет данных';
  const body = rows.reverse()
    .map((r) => `${fmtMsk(r.at)} [${r.source}] ${r.text}`)
    .join('\n');
  let escaped = escapeHtml(body, false);
  while (escaped.length > 3400) escaped = escaped.slice(escaped.indexOf('\n') + 1 || escaped.length);
  return `<b>Ошибки</b>\n<pre>${escaped}</pre>`;
}

// Entry point for "admin:*" callbacks; the owner/private check is done here.
export async function handleAdminCallback(query, s, action) {
  if (!rankAdmin.allowed(query.from, query.message && query.message.chat)) return;
  if (action === 'xp' || action.startsWith('xp:')) {
    await rankAdmin.handle(query, s, action);
    return;
  }
  rankAdmin.clear(s, { allActions: true });
  shopAdmin.clear(s);

  if (action === 'shop' || action.startsWith('shop:')) {
    await shopAdmin.handle(query, s, action);
    return;
  }
  if (action === 'posts') {
    delete s.admin_action;
    await editOrSend(query, await relayStatusText(), keyboard([
      [button('Обновить', { callback_data: 'admin:posts' })],
      [menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })],
    ]));
    return;
  }
  if (action === 'blacklist' || action.startsWith('blacklist:')) {
    const raw = action.includes(':') ? action.split(':')[1] : '0';
    if (!/^-?[0-9]+$/.test(raw)) return;
    await showBlacklist(query, s, Number(raw));
    return;
  }

  let text;
  if (action === 'menu') {
    text = 'Админ-панель FINYA HELPER\n\nУправление ботом:';
  } else if (action === 'stats') {
    const st = await userStats();
    text = '<b>📊 Статистика</b>\n\n' +
      `👥 Пользователей: <b>${st.total}</b>\n` +
      `🆕 Новые за 24ч: <b>${st.new}</b>\n` +
      `⚡ Активные за 7д: <b>${st.active}</b>\n` +
      `💤 Неактивные: <b>${st.inactive}</b>\n` +
      `🚫 Недоступны / заблокировали: <b>${st.blocked}</b>\n` +
      `🔔 Подписчиков ТГК: <b>${st.subscribers}</b>\n` +
      `📬 Обращений: <b>${await feedbackCount()}</b>`;
  } else if (action === 'status') {
    text = await statusText(query.from.id);
  } else if (action === 'feedback') {
    const items = await recentFeedback(5);
    if (!items.length) {
      text = '<b>📬 Обратная связь</b>\n\nПока пусто.';
    } else {
      const chunks = items.map((item) => {
        const who = item.username || item.first_name || item.user_id;
        return `<b>${escapeHtml(String(who))}</b>\n${escapeHtml(truncate(item.text, 700))}`;
      });
      text = '<b>📬 Последние обращения</b>\n\n' + chunks.join('\n\n────────\n\n');
    }
  } else if (action === 'news') {
    s.admin_action = 'set_news';
    text = '<b>📢 Новость</b>\n\nОтправь следующим сообщением новый текст объявления.';
  } else if (action === 'broadcast') {
    s.admin_action = 'broadcast';
    text = '<b>📣 Рассылка</b>\n\nОтправь следующим сообщением текст для всех пользователей бота.';
  } else if (action === 'broadcast_cancel') {
    delete s.broadcast_pending;
    text = '<b>Рассылка отменена. Ничего не отправлено.</b>';
  } else if (action === 'broadcast_send') {
    const pending = s.broadcast_pending;
    delete s.broadcast_pending;
    if (!pending || now() - pending.time > BROADCAST_CONFIRM_SECONDS) {
      text = '<b>Подтверждение устарело. Нажми «Рассылка» и отправь текст заново.</b>';
    } else if (await jobs.runningBroadcast()) {
      s.broadcast_pending = pending;
      text = '<b>Предыдущая рассылка ещё идёт. Дождись сообщения об итогах и повтори.</b>';
    } else {
      const st = await userStats();
      const jobId = await jobs.createBroadcast(pending.text, query.from.id);
      s.run_job = jobId; // started by the callback handler after this edit
      text = `<b>📣 Рассылка запущена. Получателей: ${st.total}.\nИтог пришлю отдельным сообщением.</b>`;
    }
  } else if (action === 'broadcast_continue') {
    text = '<b>📣 Продолжаю рассылку. Итог пришлю отдельным сообщением.</b>';
    s.run_pending_jobs = true;
  } else if (action === 'channel') {
    const value = !(await getSetting('channel_broadcast_enabled'));
    await setSetting('channel_broadcast_enabled', value);
    text = `<b>🔔 Авторассылка постов ТГК ${value ? 'включена' : 'выключена'}.</b>`;
  } else if (action === 'maintenance') {
    await setSetting('maintenance', !(await getSetting('maintenance')));
    text = '<b>🛠 Режим техработ изменён.</b>';
  } else if (action === 'logs') {
    text = await errorsHtml();
  } else {
    return;
  }
  await editText(query, boldHtml(text), await adminKeyboard());
}

