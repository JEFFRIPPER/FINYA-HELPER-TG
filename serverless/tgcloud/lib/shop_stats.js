// SQUAD SHOP view statistics. The site counts visits with Yandex Metrika and
// marks product views, cart adds and payments as extra page hits (?p=<id>,
// ?cart=<id>, ?pay=1, ?paid=1). Финя reads the numbers through the Metrika API:
// the site itself can't call Финя, the platform only takes calls from Telegram.
import { fetch } from 'sdk';
import { button, editOrSend, keyboard, menuButton } from './tg.js';
import { getSetting, isAdminUser, logError, setSetting } from './store.js';
import { ShopError, setShopSetting, shopData, title } from './shop_admin.js';
import { escapeHtml, truncate } from './util.js';

const API = 'https://api-metrika.yandex.net';
const COUNTER_SETTING = 'metrika_counter';
const TOKEN_SETTING = 'metrika_token';
export const PERIODS = {
  today: { from: 'today', label: 'Сегодня', short: 'сегодня' },
  week: { from: '6daysAgo', label: '7 дней', short: 'за 7 дней' },
  month: { from: '29daysAgo', label: '30 дней', short: 'за 30 дней' },
};

export const METRIKA_HELP =
  'Статистику сайта считает Яндекс Метрика, а Финя показывает цифры здесь. Подключается один раз:\n\n' +
  '1. Счётчик. Открой metrika.yandex.ru → «Добавить счётчик». Имя: SQUAD SHOP, адрес сайта: jeffripper.github.io. ' +
  'Создай счётчик и запомни его номер (8–9 цифр). Код на сайт вставлять не нужно, Финя сделает это сама.\n' +
  '2. Ключ. Открой oauth.yandex.ru/client/new → название «Финя» → «Веб-сервисы», Redirect URI: ' +
  'https://oauth.yandex.ru/verification_code → в доступах найди Яндекс Метрику и отметь «Получение статистики» → «Создать приложение». ' +
  'Скопируй ClientID и открой ссылку oauth.yandex.ru/authorize?response_type=token&client_id=ClientID, подставив свой ClientID, и подтверди вход. Появится ключ.\n' +
  '3. Пришли сюда: /metrika номер ключ\nСообщение с ключом Финя сразу удалит.';

function query(params) {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

async function metrika(path, token, params) {
  let res;
  try {
    res = await fetch(API + path + (params ? `?${query(params)}` : ''), {
      method: 'GET',
      headers: { Authorization: `OAuth ${token}`, 'User-Agent': 'finya-helper' },
    });
  } catch (err) {
    throw new ShopError(`Яндекс Метрика не отвечает: ${truncate((err && err.message) || String(err), 150)}. Повтори чуть позже.`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Some errors come without a JSON body.
  }
  if (res.status === 401) throw new ShopError('Метрика не принимает ключ: он отозван или истёк. Сделай новый и пришли /metrika номер ключ.');
  if (res.status === 403) throw new ShopError('У ключа нет доступа к этому счётчику. Проверь номер счётчика и что у приложения есть доступ «получение статистики».');
  if (res.status === 404) throw new ShopError('Счётчика с таким номером нет. Проверь номер на metrika.yandex.ru.');
  if (!res.ok) {
    const why = body && body.message ? `: ${truncate(String(body.message), 200)}` : '';
    throw new ShopError(`Метрика ответила ошибкой ${res.status}${why}. Повтори чуть позже.`);
  }
  return body || {};
}

async function connection() {
  const [counter, token] = await Promise.all([getSetting(COUNTER_SETTING), getSetting(TOKEN_SETTING)]);
  return counter && token ? { counter: String(counter), token } : null;
}

// /metrika <номер> <ключ>: checks the pair, saves it and turns the counter on
// on the site through shop.json → settings.metrika.
export async function connect(counter, token) {
  counter = String(counter || '').replace(/\D/g, '');
  if (!/^\d{4,12}$/.test(counter) || !/^[A-Za-z0-9_.-]{20,}$/.test(String(token || ''))) {
    throw new ShopError('Нужны номер счётчика и ключ через пробел: /metrika 12345678 ключ\n\n' + METRIKA_HELP);
  }
  const info = await metrika(`/management/v1/counter/${counter}`, token);
  await setSetting(COUNTER_SETTING, counter);
  await setSetting(TOKEN_SETTING, token);
  let siteError = '';
  try {
    await setShopSetting('metrika', counter);
  } catch (err) {
    if (!(err instanceof ShopError)) await logError('shop_stats.site', err);
    siteError = err instanceof ShopError ? err.message : 'внутренняя ошибка';
  }
  return { name: (info.counter && info.counter.name) || '', siteError };
}

async function visitors(c, period) {
  const r = await metrika('/stat/v1/data', c.token, {
    ids: c.counter, metrics: 'ym:s:users,ym:s:visits', date1: PERIODS[period].from, date2: 'today', accuracy: 'full',
  });
  const t = Array.isArray(r.totals) ? r.totals : [];
  return { users: Math.round(Number(t[0]) || 0), visits: Math.round(Number(t[1]) || 0) };
}

const MARK_RE = /[?&](p|cart|pay|paid)=([^&#]*)/;

function decode(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

// Page hits by address → views and cart adds per product, payments.
export function countHits(rows) {
  const out = { views: {}, cart: {}, pay: 0, paid: 0 };
  for (const row of rows || []) {
    const url = String((row.dimensions && row.dimensions[0] && row.dimensions[0].name) || '');
    const n = Math.round(Number(row.metrics && row.metrics[0]) || 0);
    const m = MARK_RE.exec(url);
    if (!m || !n) continue;
    if (m[1] === 'p' || m[1] === 'cart') {
      const bag = m[1] === 'p' ? out.views : out.cart;
      const id = decode(m[2]);
      bag[id] = (bag[id] || 0) + n;
    } else {
      out[m[1]] += n;
    }
  }
  return out;
}

async function hits(c, period) {
  const r = await metrika('/stat/v1/data', c.token, {
    ids: c.counter, dimensions: 'ym:pv:URL', metrics: 'ym:pv:pageviews',
    date1: PERIODS[period].from, date2: 'today', limit: 10000, accuracy: 'full',
  });
  return countHits(r.data);
}

// → { connected, help } or the numbers for `period`; `all` adds visitors for
// every period (the bot shows them in one message).
export async function report(period = 'week', { all = false } = {}) {
  if (!PERIODS[period]) period = 'week';
  const c = await connection();
  if (!c) return { connected: false, help: METRIKA_HELP };
  const periods = all ? Object.keys(PERIODS) : [period];
  const [counts, h, data] = await Promise.all([
    Promise.all(periods.map((p) => visitors(c, p))),
    hits(c, period),
    shopData().catch(() => null),
  ]);
  const totals = Object.fromEntries(periods.map((p, i) => [p, counts[i]]));
  const products = ((data && data.products) || []).map((p) => ({
    id: p.id, title: title(p), cat: p.cat || '', hidden: Boolean(p.hidden),
    views: h.views[p.id] || 0, cart: h.cart[p.id] || 0,
  })).sort((a, b) => b.views - a.views || b.cart - a.cart);
  return {
    connected: true, counter: c.counter, period, totals, ...totals[period],
    pay: h.pay, paid: h.paid, products, link: `https://metrika.yandex.ru/dashboard?id=${c.counter}`,
  };
}

// ---- bot: /admin → «Товары SQUAD SHOP» → «Статистика магазина» -------------

const back = () => [button('Товары', { callback_data: 'admin:shop:list' })];

export function reportText(r) {
  const n = (v) => Number(v || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
  let text = '📊 Статистика SQUAD SHOP\n\nПосетители · визиты\n';
  for (const [key, p] of Object.entries(PERIODS)) {
    if (r.totals[key]) text += `${p.label}: ${n(r.totals[key].users)} · ${n(r.totals[key].visits)}\n`;
  }
  text += `\n${PERIODS[r.period].label}\nНажали «Оплатить»: ${n(r.pay)}\nВернулись после оплаты: ${n(r.paid)}\n`;
  if (r.products.length) {
    text += '\nТовары: просмотры · в корзину\n';
    text += r.products.map((p) => `${p.hidden ? '🙈 ' : ''}${escapeHtml(truncate(p.title, 40))} — ${n(p.views)} · ${n(p.cart)}`).join('\n');
    text += '\n';
  }
  return text + '\nЦифры из Яндекс Метрики, новые визиты появляются в них через несколько минут.';
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
      view = [reportText(r), keyboard([tabs, [button('Открыть Метрику', { url: r.link })], back(),
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
