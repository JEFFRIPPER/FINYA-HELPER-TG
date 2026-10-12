// SQUAD SHOP view statistics. The site counts visits with GoatCounter and sends
// product views, cart adds and payments as events (p-<id>, cart-<id>, pay,
// paid). Финя reads the numbers through the GoatCounter API: the site itself
// can't call Финя, the platform only takes calls from Telegram.
import { fetch } from 'sdk';
import { button, editOrSend, keyboard, menuButton } from './tg.js';
import { getSetting, isAdminUser, logError, setSetting } from './store.js';
import { ShopError, setShopSetting, shopData, title } from './shop_admin.js';
import { escapeHtml, truncate } from './util.js';

const CODE_SETTING = 'goat_code';
const TOKEN_SETTING = 'goat_token';
const DAY = 24 * 3600 * 1000;
const MSK = 3 * 3600 * 1000;
// Days back from today (Moscow), today included.
export const PERIODS = {
  today: { days: 1, label: 'Сегодня' },
  week: { days: 7, label: '7 дней' },
  month: { days: 30, label: '30 дней' },
};

export const STATS_HELP =
  'Статистику сайта считает GoatCounter (бесплатно), а Финя показывает цифры здесь. Подключается один раз:\n\n' +
  '1. Открой goatcounter.com → Sign up. В поле Code придумай код, например squadshop: адрес счётчика будет ' +
  'squadshop.goatcounter.com. Site domain: jeffripper.github.io, плюс почта и пароль.\n' +
  '2. Войди и открой меню со своим именем вверху → API → создай ключ с правом читать статистику и скопируй его.\n' +
  '3. Пришли сюда: /shopstats код ключ\nСообщение с ключом Финя сразу удалит и включит счётчик на сайте.';

// "squadshop", "squadshop.goatcounter.com" or the full address → "squadshop".
export function cleanCode(value) {
  const v = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.goatcounter\.com.*$/, '').replace(/\/.*$/, '');
  return /^[a-z0-9-]{2,50}$/.test(v) ? v : '';
}

function query(params) {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

async function goat(code, token, path, params) {
  let res;
  try {
    res = await fetch(`https://${code}.goatcounter.com/api/v0${path}${params ? `?${query(params)}` : ''}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'finya-helper' },
    });
  } catch (err) {
    throw new ShopError(`GoatCounter не отвечает: ${truncate((err && err.message) || String(err), 150)}. Повтори чуть позже.`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Some errors come without a JSON body.
  }
  if (res.status === 401) throw new ShopError('GoatCounter не принимает ключ: он удалён или в коде счётчика ошибка. Проверь и пришли /shopstats код ключ ещё раз.');
  if (res.status === 403) throw new ShopError('У ключа нет права читать статистику. Создай ключ с этим правом в меню API.');
  if (res.status === 404) throw new ShopError('Счётчика с таким кодом нет. Код — это первая часть адреса: код.goatcounter.com.');
  if (!res.ok) {
    const why = body && (body.error || body.errors) ? `: ${truncate(typeof body.error === 'string' ? body.error : JSON.stringify(body.errors || body.error), 200)}` : '';
    throw new ShopError(`GoatCounter ответил ошибкой ${res.status}${why}. Повтори чуть позже.`);
  }
  return body || {};
}

async function connection() {
  const [code, token] = await Promise.all([getSetting(CODE_SETTING), getSetting(TOKEN_SETTING)]);
  return code && token ? { code, token } : null;
}

// From Moscow midnight `days - 1` days ago to the end of the current hour, as
// GoatCounter wants: whole hours, UTC.
export function range(days, now = Date.now()) {
  const today = Math.floor((now + MSK) / DAY) * DAY - MSK;
  const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { start: iso(today - (days - 1) * DAY), end: iso(Math.ceil(now / 3600000) * 3600000) };
}

// /shopstats <код> <ключ>: checks the pair, saves it and turns the counter on
// on the site through shop.json → settings.goatcounter.
export async function connect(rawCode, token) {
  const code = cleanCode(rawCode);
  if (!code || !/^[A-Za-z0-9_-]{16,}$/.test(String(token || ''))) {
    throw new ShopError('Нужны код счётчика и ключ через пробел: /shopstats squadshop ключ\n\n' + STATS_HELP);
  }
  await goat(code, token, '/stats/hits', { ...range(1), limit: 1 });
  await setSetting(CODE_SETTING, code);
  await setSetting(TOKEN_SETTING, token);
  let siteError = '';
  try {
    await setShopSetting('goatcounter', code);
  } catch (err) {
    if (!(err instanceof ShopError)) await logError('shop_stats.site', err);
    siteError = err instanceof ShopError ? err.message : 'внутренняя ошибка';
  }
  return { code, siteError };
}

const EVENT_RE = /^(p|cart)-(.+)$/;

// GoatCounter rows → visits of the site's pages, events per product, payments.
export function countHits(rows) {
  const out = { visits: 0, views: {}, cart: {}, pay: 0, paid: 0 };
  for (const row of rows || []) {
    const n = Math.round(Number(row.count) || 0);
    const path = String(row.path || '');
    if (!row.event) {
      out.visits += n;
    } else if (path === 'pay' || path === 'paid') {
      out[path] += n;
    } else {
      const m = EVENT_RE.exec(path);
      if (m) {
        const bag = m[1] === 'p' ? out.views : out.cart;
        bag[m[2]] = (bag[m[2]] || 0) + n;
      }
    }
  }
  return out;
}

async function hits(c, period) {
  const r = await goat(c.code, c.token, '/stats/hits', { ...range(PERIODS[period].days), limit: 100 });
  return countHits(r.hits);
}

// → { connected, help } or the numbers for `period`; `all` adds visits for
// every period (the bot shows them in one message).
export async function report(period = 'week', { all = false } = {}) {
  if (!PERIODS[period]) period = 'week';
  const c = await connection();
  if (!c) return { connected: false, help: STATS_HELP };
  const others = all ? Object.keys(PERIODS).filter((p) => p !== period) : [];
  const [h, extra, data] = await Promise.all([
    hits(c, period),
    Promise.all(others.map((p) => hits(c, p))),
    shopData().catch(() => null),
  ]);
  const visits = { [period]: h.visits };
  others.forEach((p, i) => { visits[p] = extra[i].visits; });
  const products = ((data && data.products) || []).map((p) => ({
    id: p.id, title: title(p), cat: p.cat || '', hidden: Boolean(p.hidden),
    views: h.views[p.id] || 0, cart: h.cart[p.id] || 0,
  })).sort((a, b) => b.views - a.views || b.cart - a.cart);
  return {
    connected: true, period, visits, total: h.visits, pay: h.pay, paid: h.paid, products,
    link: `https://${c.code}.goatcounter.com`,
  };
}

// ---- bot: /admin → «Товары SQUAD SHOP» → «Статистика магазина» -------------

const back = () => [button('Товары', { callback_data: 'admin:shop:list' })];

export function reportText(r) {
  const n = (v) => Number(v || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
  let text = '📊 Статистика SQUAD SHOP\n\nПосещения сайта\n';
  for (const [key, p] of Object.entries(PERIODS)) {
    if (key in r.visits) text += `${p.label}: ${n(r.visits[key])}\n`;
  }
  text += `\n${PERIODS[r.period].label}\nНажали «Оплатить»: ${n(r.pay)}\nВернулись после оплаты: ${n(r.paid)}\n`;
  if (r.products.length) {
    text += '\nТовары: просмотры · в корзину\n';
    text += r.products.map((p) => `${p.hidden ? '🙈 ' : ''}${escapeHtml(truncate(p.title, 40))} — ${n(p.views)} · ${n(p.cart)}`).join('\n');
    text += '\n';
  }
  return text + '\nКаждый посетитель считается один раз за 8 часов. Цифры из GoatCounter.';
}

export async function handle(query, action) {
  if (!isAdminUser(query.from) || !query.message || query.message.chat.type !== 'private') return;
  const period = action.split(':')[2] || 'week';
  let view;
  try {
    const r = await report(period, { all: true });
    if (!r.connected) {
      view = [`📊 Статистика SQUAD SHOP\n\n${escapeHtml(r.help)}`, keyboard([back()])];
    } else {
      const tabs = Object.entries(PERIODS).map(([key, p]) =>
        button(`${key === r.period ? '✓ ' : ''}${p.label}`, { callback_data: `admin:shop:stats:${key}` }));
      view = [reportText(r), keyboard([tabs, [button('Открыть GoatCounter', { url: r.link })], back(),
        [menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })]])];
    }
  } catch (err) {
    if (!(err instanceof ShopError)) await logError('shop_stats', err);
    const text = err instanceof ShopError ? err.message : 'Не получилось: внутренняя ошибка. Подробности в /admin → Логи.';
    view = [`📊 Статистика SQUAD SHOP\n\n${escapeHtml(text)}`,
      keyboard([[button('Повторить', { callback_data: `admin:shop:stats:${period}` })], back()])];
  }
  await editOrSend(query, view[0], view[1]);
}

// ---- Mini App: POST /api/shop { action: 'stats', period } -----------------

export async function appStats(user, input = {}) {
  if (!isAdminUser(user)) throw new ShopError('Статистику видит только владелец магазина.');
  return report(String(input.period || 'week'));
}
