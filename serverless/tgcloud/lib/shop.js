// Orders of the SQUAD SHOP site (jeffripper.github.io/SQUAD-SHOP). The site has
// no server: a buyer pays through YooMoney Quickpay and the payment carries the
// label "SQ-XXXXXX @username 250*,prem6x2". The owner connects his wallet once
// (/ym), and Финя reads incoming payments from the wallet's operation history,
// keeps them in shop_orders and tells the owner about each new one.
import { db, api, fetch } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { getSetting, setSetting } from './store.js';
import { escapeHtml, nowInt, truncate } from './util.js';

const YM = 'https://yoomoney.ru';
const SHOP_JSON_URL = 'https://jeffripper.github.io/SQUAD-SHOP/shop.json';
// On GitHub Pages next to the shop: tgcloud.ai does not open for the owner.
export const YM_REDIRECT = 'https://jeffripper.github.io/SQUAD-SHOP/ym.html';
export const YM_SCOPE = 'operation-history';
const LABEL_RE = /^(SQ-[A-Z0-9]{4,12})(?:\s+@?([A-Za-z0-9_]{1,32}))?(?:\s+(\S.*))?$/;
const TITLES_TTL = 600;
const LIST_LIMIT = 50;

export class ShopError extends Error {
  constructor(message, code = 'BAD_REQUEST') {
    super(message);
    this.code = code;
  }
}

// ---- YooMoney --------------------------------------------------------------

async function ymPost(path, params, token = null) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${YM}${path}`, { method: 'POST', headers, body: fetch.body.form(params) });
  let data = null;
  try { data = await res.json(); } catch { /* 401 comes without a body */ }
  return { status: res.status, ok: res.ok, data };
}

async function history(token) {
  const r = await ymPost('/api/operation-history', { type: 'deposition', records: '100' }, token);
  if (r.status === 401 || r.status === 403) throw new ShopError('ЮMoney не принимает ключ: подключи кошелёк заново командой /ym.', 'YM_AUTH');
  if (!r.ok || !r.data || r.data.error) {
    throw new ShopError(`ЮMoney ответил ошибкой${r.data && r.data.error ? ` (${r.data.error})` : ` (${r.status})`}.`, 'YM_ERROR');
  }
  return Array.isArray(r.data.operations) ? r.data.operations : [];
}

// A YooMoney access token is "<wallet number>.<long tail>".
export function isToken(arg) {
  return /^\d{8,20}\.\S{40,}$/.test(arg);
}

// ym.html sends the browser on to YooMoney and is also where it comes back;
// the extra parameters ride along (YooMoney compares only the registered part).
export function authLink(clientId, botName = '') {
  return `${YM_REDIRECT}?cid=${encodeURIComponent(clientId)}${botName ? `&bot=${encodeURIComponent(botName)}` : ''}`;
}

export async function exchangeCode(code, clientId, redirectUri) {
  const r = await ymPost('/oauth/token', {
    code, client_id: clientId, grant_type: 'authorization_code', redirect_uri: redirectUri || authLink(clientId),
  });
  if (!r.data || !r.data.access_token) {
    throw new ShopError(r.data && r.data.error === 'invalid_grant'
      ? 'Код уже истёк (он живёт меньше минуты) или был использован. Открой ссылку подключения ещё раз.'
      : `ЮMoney не выдал ключ${r.data && r.data.error ? ` (${r.data.error})` : ''}.`, 'YM_CODE');
  }
  return r.data.access_token;
}

export async function saveToken(token) {
  await history(token); // proves the token works before it replaces the old one
  await setSetting('ym_token', token);
  await setSetting('ym_error', null);
  await setSetting('ym_sync_at', 0);
}

// ---- labels and products -----------------------------------------------------

export function parseLabel(label) {
  const m = LABEL_RE.exec(String(label || '').trim());
  if (!m) return null;
  return { orderId: m[1], username: m[2] || '', items: m[3] || '' };
}

function starsWord(n) {
  const a = n % 100;
  const b = n % 10;
  if (a >= 11 && a <= 14) return 'звёзд';
  if (b === 1) return 'звезда';
  if (b >= 2 && b <= 4) return 'звезды';
  return 'звёзд';
}

async function productTitles() {
  const cached = await getSetting('shop_titles');
  if (cached && nowInt() - cached.at < TITLES_TTL) return cached.titles;
  try {
    const res = await fetch(`${SHOP_JSON_URL}?t=${nowInt()}`);
    const data = res.ok ? await res.json() : null;
    const titles = {};
    for (const p of (data && Array.isArray(data.products) ? data.products : [])) {
      if (p && p.id && !p.stars && p.name) titles[p.id] = String(p.name);
    }
    await setSetting('shop_titles', { at: nowInt(), titles });
    return titles;
  } catch {
    return cached ? cached.titles : {};
  }
}

// "250*,prem6x2" → "250 звёзд, Telegram Premium · 6 месяцев ×2". The site cuts the
// label at 64 characters, so the tail of a long cart may be missing.
export function describeItems(items, titles = {}) {
  if (!items) return '';
  return items.split(',').filter(Boolean).map((part) => {
    const stars = /^(\d+)\*$/.exec(part);
    if (stars) return `${Number(stars[1]).toLocaleString('ru-RU')} ${starsWord(Number(stars[1]))}`;
    const m = /^(.+?)(?:x(\d+))?$/.exec(part);
    const name = titles[m[1]] || m[1];
    return m[2] ? `${name} ×${m[2]}` : name;
  }).join(', ');
}

// ---- sync --------------------------------------------------------------------

function view(row, titles) {
  return {
    id: row.operation_id,
    order: row.order_id,
    username: row.username,
    what: describeItems(row.items, titles) || 'состав не указан',
    amount: row.amount,
    at: row.paid_at,
    status: row.status,
    issued: row.issued_at != null,
  };
}

// Pulls the latest incoming payments; returns the orders seen for the first time.
export async function sync({ minInterval = 0 } = {}) {
  const token = await getSetting('ym_token');
  if (!token) return [];
  const ts = nowInt();
  if (minInterval > 0) {
    await db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES ('ym_sync_at', '0')`);
    const r = await db.run(sql`UPDATE settings SET value = ${String(ts)}
      WHERE key = 'ym_sync_at' AND CAST(value AS REAL) < ${ts - minInterval}`);
    if (r.rowsAffected !== 1) return [];
  }
  let ops;
  try {
    ops = await history(token);
  } catch (err) {
    await setSetting('ym_error', err instanceof ShopError ? err.message : 'Нет связи с ЮMoney.');
    if (err instanceof ShopError) return [];
    throw err;
  }
  await setSetting('ym_error', null);
  const fresh = [];
  for (const op of ops) {
    if (op.direction && op.direction !== 'in') continue;
    const parsed = parseLabel(op.label);
    if (!parsed || !op.operation_id) continue;
    const row = {
      operation_id: String(op.operation_id),
      order_id: parsed.orderId,
      username: parsed.username,
      items: truncate(parsed.items, 200),
      amount: Number(op.amount) || 0,
      paid_at: String(op.datetime || ''),
      status: String(op.status || 'success'),
    };
    const r = await db.run(sql`INSERT INTO shop_orders
      (operation_id, order_id, username, items, amount, paid_at, status, created_at)
      VALUES (${row.operation_id}, ${row.order_id}, ${row.username}, ${row.items}, ${row.amount},
        ${row.paid_at}, ${row.status}, ${ts})
      ON CONFLICT(operation_id) DO NOTHING`);
    if (r.rowsAffected === 1) fresh.push(row);
    else await db.run(sql`UPDATE shop_orders SET status = ${row.status} WHERE operation_id = ${row.operation_id}`);
  }
  return fresh;
}

function money(n) {
  return `${Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

export async function notifyOwner(orders) {
  if (!orders.length) return;
  const titles = await productTitles();
  for (const o of orders) {
    const who = o.username ? `@${escapeHtml(o.username)}` : 'без @username';
    const text = `🛒 <b>Новый заказ ${escapeHtml(o.order_id)}</b>\n\n` +
      `Кому: <b>${who}</b>\n` +
      `Что: <b>${escapeHtml(describeItems(o.items, titles) || 'состав не указан')}</b>\n` +
      `Пришло: <b>${money(o.amount)}</b>` +
      (o.status === 'success' ? '' : `\nСтатус платежа: ${escapeHtml(o.status)}`) +
      '\n\nОтметить выдачу: «Профиль» → «Панель» → «Заказы SQUAD SHOP».';
    await api.sendMessage({ chat_id: OWNER_USER_ID, text, parse_mode: 'HTML' });
  }
}

// Called from pump(): at most once a minute, and only when an update arrives.
export async function tick() {
  if (!(await getSetting('ym_token'))) return;
  await notifyOwner(await sync({ minInterval: 60 }));
}

// ---- Mini App ----------------------------------------------------------------

async function list() {
  const connected = Boolean(await getSetting('ym_token'));
  if (connected) {
    try {
      await notifyOwner(await sync({ minInterval: 10 }));
    } catch {
      await setSetting('ym_error', 'Нет связи с ЮMoney, показываю сохранённые заказы.');
    }
  }
  const titles = connected ? await productTitles() : {};
  const rows = await db.all(sql`SELECT * FROM shop_orders ORDER BY paid_at DESC, created_at DESC LIMIT ${LIST_LIMIT}`);
  const waiting = await db.get(sql`SELECT COUNT(*) AS c FROM shop_orders WHERE issued_at IS NULL AND status = 'success'`);
  return {
    connected,
    error: connected ? await getSetting('ym_error') : null,
    waiting: waiting ? waiting.c : 0,
    items: rows.map((r) => view(r, titles)),
  };
}

async function setIssued(input) {
  const id = truncate(String(input.id || ''), 64);
  const r = await db.run(input.issued
    ? sql`UPDATE shop_orders SET issued_at = ${nowInt()} WHERE operation_id = ${id}`
    : sql`UPDATE shop_orders SET issued_at = NULL WHERE operation_id = ${id}`);
  if (r.rowsAffected !== 1) throw new ShopError('Заказ не найден.', 'NOT_FOUND');
  return list();
}

export async function handle(user, input) {
  if (!user || user.id !== OWNER_USER_ID) throw new ShopError('Заказы видит только владелец.', 'FORBIDDEN');
  const action = input && input.action;
  if (action === 'list') return list();
  if (action === 'issue') return setIssued(input);
  throw new ShopError('Неизвестное действие.');
}
