// SQUAD SHOP products from /admin → «Товары». The shop is a static site on
// GitHub Pages: its products live in shop.json of JEFFRIPPER/SQUAD-SHOP, so each
// change here is a commit made with the owner's GitHub key (/shopkey).
import { api, fetch } from 'sdk';
import { SQUAD_LINKS } from './config.js';
import { button, editOrSend, keyboard, menuButton, replyBold } from './tg.js';
import { getSetting, isAdminUser, logError, setSetting } from './store.js';
import { base64ToBytes, bytesToBase64, escapeHtml, randomHex, truncate, utf8Decode, utf8Encode } from './util.js';

const REPO = 'JEFFRIPPER/SQUAD-SHOP';
const BRANCH = 'main';
const GH_API = `https://api.github.com/repos/${REPO}`;
const KEY_SETTING = 'shop_gh_token';
const MAX_PRICE = 1000000;
const MAX_PHOTO = 5 * 1024 * 1024;
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const FIELDS = {
  name: 'Название',
  stars: 'Количество звёзд',
  price: 'Цена',
  desc: 'Описание',
  tag: 'Метка',
  photo: 'Фото',
};

export class ShopError extends Error {}

export const KEY_HELP =
  'Финя меняет товары через GitHub, для этого нужен ключ с правом записи в репозиторий SQUAD-SHOP.\n\n' +
  'Подойдёт тот же ключ, которым ты входишь в админку сайта. Новый делается так:\n' +
  '1. Открой github.com/settings/personal-access-tokens/new\n' +
  '2. Repository access: Only select repositories → SQUAD-SHOP\n' +
  '3. Permissions → Contents: Read and write\n' +
  '4. Generate token и скопируй ключ.\n\n' +
  'Пришли сюда: /shopkey ключ\nСообщение с ключом Финя сразу удалит.';

export function clear(s) {
  delete s.shop_admin;
}

// ---- GitHub --------------------------------------------------------------

async function gh(method, path, token, body) {
  let res;
  try {
    res = await fetch(GH_API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'finya-helper',
      },
      body: body ? fetch.body.json(body) : undefined,
    });
  } catch (err) {
    throw new ShopError(`GitHub не отвечает: ${truncate((err && err.message) || String(err), 150)}. Повтори чуть позже.`);
  }
  if (res.status === 404 && method === 'GET') return null;
  if (res.status === 401) throw new ShopError('GitHub не принимает ключ: он удалён или истёк.\n\n' + KEY_HELP);
  if (res.status === 403 || res.status === 404) {
    throw new ShopError('У ключа нет права записи в SQUAD-SHOP. Поставь ему Contents: Read and write или сделай новый.\n\n' + KEY_HELP);
  }
  if (res.status === 409 || res.status === 422) {
    const err = new ShopError('Магазин только что изменили в другом месте. Повтори действие.');
    err.conflict = true;
    throw err;
  }
  if (!res.ok) throw new ShopError(`GitHub ответил ошибкой ${res.status}. Повтори чуть позже.`);
  return res.status === 204 ? {} : res.json();
}

const contentPath = (path) => '/contents/' + path.split('/').map(encodeURIComponent).join('/');

async function token() {
  const key = await getSetting(KEY_SETTING);
  if (!key) throw new ShopError('Ключ GitHub ещё не подключён.\n\n' + KEY_HELP);
  return key;
}

// A fine-grained key starts with github_pat_, a classic one with ghp_.
export function isKey(text) {
  return /^(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,})$/.test(text);
}

export async function saveKey(key) {
  const repo = await gh('GET', '', key);
  if (!repo) throw new ShopError('Ключ не видит репозиторий SQUAD-SHOP. Выбери его в Repository access.\n\n' + KEY_HELP);
  if (!repo.permissions || !repo.permissions.push) {
    throw new ShopError('У ключа нет права записи в SQUAD-SHOP. Поставь ему Contents: Read and write.\n\n' + KEY_HELP);
  }
  await setSetting(KEY_SETTING, key);
}

async function readShop(key) {
  const file = await gh('GET', `${contentPath('shop.json')}?ref=${BRANCH}`, key);
  if (!file) throw new ShopError('В репозитории нет shop.json.');
  let data;
  try {
    data = JSON.parse(utf8Decode(base64ToBytes(file.content)));
  } catch {
    throw new ShopError('shop.json повреждён: Финя не может его прочитать.');
  }
  if (!data || !Array.isArray(data.products)) throw new ShopError('В shop.json нет списка товаров.');
  return { data, sha: file.sha };
}

// Reads shop.json, lets `change` edit it and commits; a race with the site's
// own admin is retried on fresh data.
async function updateShop(message, change) {
  const key = await token();
  for (let attempt = 0; ; attempt++) {
    const { data, sha } = await readShop(key);
    const result = await change(data);
    try {
      await gh('PUT', contentPath('shop.json'), key, {
        message: `Финя: ${message}`,
        content: bytesToBase64(utf8Encode(JSON.stringify(data, null, 2) + '\n')),
        sha,
        branch: BRANCH,
      });
      return { data, result };
    } catch (err) {
      if (!err.conflict || attempt >= 2) throw err;
    }
  }
}

async function putFile(path, bytes, message) {
  await gh('PUT', contentPath(path), await token(), { message: `Финя: ${message}`, content: bytesToBase64(bytes), branch: BRANCH });
}

async function deleteFile(path) {
  // Only photos uploaded for products; the logo and cover stay.
  if (!/^img\/p-[A-Za-z0-9_.-]+$/.test(path || '')) return;
  try {
    const key = await token();
    const file = await gh('GET', `${contentPath(path)}?ref=${BRANCH}`, key);
    if (file) await gh('DELETE', contentPath(path), key, { message: `Финя: убрано фото ${path}`, sha: file.sha, branch: BRANCH });
  } catch (err) {
    await logError('shop_admin.photo', err); // a stray old photo is harmless
  }
}

// ---- views -----------------------------------------------------------------

function starsWord(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'звезда';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'звезды';
  return 'звёзд';
}

export function title(p) {
  return p.stars ? `${p.stars.toLocaleString('ru-RU').replace(/\s/g, ' ')} ${starsWord(p.stars)}` : (p.name || 'Без названия');
}

const money = (n) => `${Number(n || 0).toLocaleString('ru-RU').replace(/\s/g, ' ')} ₽`;

function btn(label, action) {
  return button(label, { callback_data: `admin:shop:${action}` });
}

const backToList = () => [btn('Товары', 'list')];

function listView(data, note = '') {
  const items = data.products;
  let text = (note ? `${note}\n\n` : '') + `Товары SQUAD SHOP · ${items.length}\n\n`;
  text += items.length ? 'Выбери товар, чтобы изменить фото, название, описание или цену.' : 'Товаров пока нет.';
  text += '\nСкрытые и товары без цены покупатели не видят.';
  const rows = items.map((p) => [btn(`${p.hidden || !p.price ? '🙈 ' : ''}${truncate(title(p), 28)} · ${money(p.price)}`, `p:${p.id}`)]);
  rows.push([btn('➕ Добавить товар', 'new')]);
  rows.push([button('Открыть магазин', { url: SQUAD_LINKS.shop })]);
  rows.push([menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })]);
  return [text, keyboard(rows)];
}

function cardView(p, note = '') {
  const show = (v) => (v ? escapeHtml(truncate(v, 300)) : '—');
  const photo = p.image ? `<a href="${SQUAD_LINKS.shop}${encodeURI(p.image)}">есть</a>` : 'нет';
  const state = p.hidden ? 'скрыт' : !p.price ? 'не виден, нет цены' : 'на витрине';
  const text = (note ? `${note}\n\n` : '') +
    `${escapeHtml(title(p))}\n\n` +
    (p.stars ? `Звёзд: ${p.stars}\n` : `Название: ${show(p.name)}\n`) +
    `Цена: ${money(p.price)}\n` +
    `Описание: ${show(p.desc)}\n` +
    `Метка: ${show(p.tag)}\n` +
    `Фото: ${photo}\n` +
    `Золотой бейдж: ${p.gold ? 'да' : 'нет'}\n` +
    `Статус: ${state}`;
  const id = p.id;
  return [text, keyboard([
    [btn(p.stars ? 'Звёзды' : 'Название', `e:${id}:${p.stars ? 'stars' : 'name'}`), btn('Цена', `e:${id}:price`)],
    [btn('Описание', `e:${id}:desc`), btn('Фото', `e:${id}:photo`)],
    [btn('Метка', `e:${id}:tag`), btn(p.gold ? 'Убрать бейдж' : 'Золотой бейдж', `g:${id}`)],
    [btn(p.hidden ? 'Показать' : 'Скрыть', `h:${id}`), btn('Удалить', `d:${id}`)],
    backToList(),
  ])];
}

function promptView(p, field) {
  const name = title(p);
  const prompts = {
    name: 'Отправь новое название товара.',
    stars: 'Отправь количество звёзд числом, например 750.',
    price: 'Отправь цену в рублях целым числом, например 399.',
    desc: 'Отправь описание. Минус «-» уберёт его.',
    tag: 'Отправь короткую метку, например «Хит» или «−10%». Минус «-» уберёт её.',
    photo: 'Пришли фото товара. Квадратное смотрится лучше всего. Минус «-» уберёт фото.',
  };
  return [`${FIELDS[field]} · ${escapeHtml(name)}\n\n${prompts[field]}\n/cancel — отменить.`,
    keyboard([[btn('Карточка товара', `p:${p.id}`)], backToList()])];
}

const SAVED = 'Сохранено. На сайте обновится примерно через минуту.';

function find(data, id) {
  const p = data.products.find((x) => x.id === id);
  if (!p) throw new ShopError('Товар не найден: его уже удалили. Открой список заново.');
  return p;
}

// ---- callbacks -------------------------------------------------------------

export async function handle(query, s, action) {
  if (!isAdminUser(query.from) || !query.message || query.message.chat.type !== 'private') return;
  clear(s);
  const parts = action.split(':'); // shop, cmd, id, field
  const cmd = parts[1] || 'list';
  const id = parts[2] || '';
  try {
    let view;
    if (cmd === 'key') {
      view = [KEY_HELP, keyboard([backToList()])];
    } else if (cmd === 'list') {
      const key = await getSetting(KEY_SETTING);
      if (!key) {
        view = ['Товары SQUAD SHOP\n\n' + KEY_HELP, keyboard([[menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })]])];
      } else {
        view = listView((await readShop(key)).data);
      }
    } else if (cmd === 'new') {
      s.shop_admin = { mode: 'new' };
      view = ['Новый товар\n\nОтправь название товара или количество звёзд числом, например 750.\n/cancel — отменить.',
        keyboard([backToList()])];
    } else if (cmd === 'p') {
      view = cardView(find((await readShop(await token())).data, id));
    } else if (cmd === 'e' && FIELDS[parts[3]]) {
      const p = find((await readShop(await token())).data, id);
      s.shop_admin = { mode: 'field', id, field: parts[3] };
      view = promptView(p, parts[3]);
    } else if (cmd === 'g' || cmd === 'h') {
      const { result } = await updateShop(`${cmd === 'g' ? 'бейдж' : 'видимость'} ${id}`, (data) => {
        const p = find(data, id);
        if (cmd === 'g') p.gold = !p.gold; else p.hidden = !p.hidden;
        return p;
      });
      view = cardView(result, SAVED);
    } else if (cmd === 'd') {
      const p = find((await readShop(await token())).data, id);
      view = [`Удалить «${escapeHtml(title(p))}»?\n\nТовар пропадёт с сайта вместе с фото.`,
        keyboard([[btn('Да, удалить', `dd:${id}`), btn('Отмена', `p:${id}`)]])];
    } else if (cmd === 'dd') {
      const { data, result } = await updateShop(`удалён товар ${id}`, (d) => {
        const p = find(d, id);
        d.products = d.products.filter((x) => x.id !== id);
        return p;
      });
      if (result.image) await deleteFile(result.image);
      view = listView(data, `«${escapeHtml(title(result))}» удалён. ${SAVED}`);
    } else {
      view = listView((await readShop(await token())).data, 'Кнопка устарела.');
    }
    await editOrSend(query, view[0], view[1]);
  } catch (err) {
    await editOrSend(query, await errorText(err), keyboard([backToList(), [menuButton('⬅️ Админ-панель', { callback_data: 'admin:menu' })]]));
  }
}

async function errorText(err) {
  if (err instanceof ShopError) return escapeHtml(err.message);
  await logError('shop_admin', err);
  return 'Не получилось: внутренняя ошибка. Подробности в /admin → Логи.';
}

// ---- input -----------------------------------------------------------------

function parseNumber(text, max, what) {
  const digits = text.replace(/[\s_₽]/g, '').replace(/(руб|р)\.?$/i, '');
  if (!/^[0-9]{1,7}$/.test(digits) || Number(digits) < 1 || Number(digits) > max) {
    throw new ShopError(`${what}: нужно целое число от 1 до ${max.toLocaleString('ru-RU')}. Отправь ещё раз.`);
  }
  return Number(digits);
}

function applyText(p, field, text) {
  const clearIt = text === '-' || text === '—' || text === '–';
  if (field === 'name') {
    if (clearIt || !text) throw new ShopError('Название не может быть пустым. Отправь ещё раз.');
    p.name = truncate(text, 80);
  } else if (field === 'stars') {
    p.stars = parseNumber(text, MAX_PRICE, 'Количество звёзд');
  } else if (field === 'price') {
    p.price = parseNumber(text, MAX_PRICE, 'Цена');
  } else if (field === 'desc') {
    p.desc = clearIt ? '' : truncate(text, 300);
  } else if (field === 'tag') {
    p.tag = clearIt ? '' : truncate(text, 20);
  }
}

// → true when the message belonged to a product dialog.
export async function handleText(message, s) {
  const state = s.shop_admin;
  if (!state) return false;
  if (!isAdminUser(message.from) || message.chat.type !== 'private') return true;
  const text = String(message.text || '').trim();
  if (['отмена', '/cancel'].includes(text.toLowerCase())) {
    clear(s);
    await replyBold(message, 'Действие отменено.', keyboard([backToList()]));
    return true;
  }
  try {
    let view;
    if (state.mode === 'new') {
      if (!text) throw new ShopError('Отправь название или количество звёзд.');
      const stars = /^[0-9\s]+$/.test(text) ? parseNumber(text, MAX_PRICE, 'Количество звёзд') : 0;
      const p = { id: randomHex(3), name: stars ? '' : truncate(text, 80), stars, price: 0, desc: '', tag: '', gold: false, image: '', hidden: false };
      await updateShop(`новый товар ${title(p)}`, (data) => { data.products.push(p); });
      // A product without a price stays off the shop, so the price comes next.
      s.shop_admin = { mode: 'field', id: p.id, field: 'price', fresh: true };
      view = [`Товар «${escapeHtml(title(p))}» добавлен.\n\nТеперь отправь цену в рублях, например 399. Без цены покупатели его не увидят.`,
        keyboard([[btn('Карточка товара', `p:${p.id}`)], backToList()])];
    } else if (state.field === 'photo') {
      if (!['-', '—', '–'].includes(text)) throw new ShopError('Жду фото. Пришли картинку или «-», чтобы убрать фото.');
      const { result, old } = await setImage(state.id, '');
      if (old) await deleteFile(old);
      clear(s);
      view = cardView(result, 'Фото убрано. ' + SAVED);
    } else {
      const { result } = await updateShop(`${FIELDS[state.field].toLowerCase()} ${state.id}`, (data) => {
        const p = find(data, state.id);
        applyText(p, state.field, text);
        return p;
      });
      clear(s);
      view = cardView(result, SAVED);
    }
    await replyBold(message, view[0], view[1]);
  } catch (err) {
    const rows = state.id ? [[btn('Карточка товара', `p:${state.id}`)], backToList()] : [backToList()];
    await replyBold(message, await errorText(err), keyboard(rows));
  }
  return true;
}

async function setImage(id, path) {
  let old = '';
  const { result } = await updateShop(`фото ${id}`, (data) => {
    const p = find(data, id);
    old = p.image;
    p.image = path;
    return p;
  });
  return { result, old: old !== path ? old : '' };
}

// Telegram keeps a photo in several sizes; ~800px is plenty for the shop.
function pickPhoto(message) {
  if (message.photo && message.photo.length) {
    const sizes = [...message.photo].sort((a, b) => a.width * a.height - b.width * b.height);
    return { fileId: (sizes.find((x) => Math.max(x.width, x.height) >= 640) || sizes[sizes.length - 1]).file_id, ext: 'jpg' };
  }
  const doc = message.document;
  if (doc && PHOTO_TYPES[doc.mime_type]) {
    if (doc.file_size > MAX_PHOTO) throw new ShopError('Файл больше 5 МБ. Пришли картинку поменьше или обычным фото.');
    return { fileId: doc.file_id, ext: PHOTO_TYPES[doc.mime_type] };
  }
  return null;
}

// → true when the photo belonged to a product dialog.
export async function handleMedia(message, s) {
  const state = s.shop_admin;
  if (!state || state.field !== 'photo' || !isAdminUser(message.from) || message.chat.type !== 'private') return false;
  try {
    const photo = pickPhoto(message);
    if (!photo) throw new ShopError('Это не картинка. Пришли фото (JPG, PNG или WebP).');
    const bytes = await api.getFileContent(photo.fileId);
    const path = `img/p-${state.id}-${randomHex(2)}.${photo.ext}`;
    await putFile(path, bytes, `фото ${state.id}`);
    const { result, old } = await setImage(state.id, path);
    if (old) await deleteFile(old);
    clear(s);
    const [text, kb] = cardView(result, 'Фото обновлено. ' + SAVED);
    await replyBold(message, text, kb);
  } catch (err) {
    await replyBold(message, await errorText(err), keyboard([[btn('Карточка товара', `p:${state.id}`)], backToList()]));
  }
  return true;
}

// ---- Mini App ------------------------------------------------------------
// POST /api/shop from «Панель»: the same products, edited in one form.

const MAX_PHOTO_B64 = Math.ceil(MAX_PHOTO / 3) * 4;

function cleanProduct(input) {
  const str = (v, n) => truncate(String(v ?? '').trim(), n);
  const int = (v, what) => {
    const n = Number(String(v ?? '0').replace(/\s/g, '') || 0);
    if (!Number.isInteger(n) || n < 0 || n > MAX_PRICE) throw new ShopError(`${what}: нужно целое число от 0 до ${MAX_PRICE.toLocaleString('ru-RU')}.`);
    return n;
  };
  const p = {
    name: str(input.name, 80),
    stars: int(input.stars, 'Звёзды'),
    price: int(input.price, 'Цена'),
    desc: str(input.desc, 300),
    tag: str(input.tag, 20),
    gold: Boolean(input.gold),
    hidden: Boolean(input.hidden),
  };
  if (!p.stars && !p.name) throw new ShopError('Укажи название товара или количество звёзд.');
  if (!p.price) throw new ShopError('Укажи цену больше нуля.');
  return p;
}

function photoUpload(photo) {
  if (!photo) return null;
  const ext = PHOTO_TYPES[photo.type];
  const data = String(photo.data || '');
  if (!ext || !data) throw new ShopError('Фото должно быть JPG, PNG или WebP.');
  if (data.length > MAX_PHOTO_B64) throw new ShopError('Фото больше 5 МБ. Выбери поменьше.');
  return { ext, bytes: base64ToBytes(data) };
}

function appList(data) {
  return { connected: true, base: SQUAD_LINKS.shop, items: data.products };
}

export async function appHandle(user, input = {}) {
  if (!isAdminUser(user)) throw new ShopError('Товары меняет только владелец магазина.');
  const action = input.action || 'list';
  if (action === 'list') {
    const key = await getSetting(KEY_SETTING);
    if (!key) return { connected: false, help: KEY_HELP, items: [] };
    return appList((await readShop(key)).data);
  }
  if (action === 'save') {
    const fields = cleanProduct(input.product || {});
    const id = input.id ? String(input.id) : '';
    const upload = photoUpload(input.photo);
    // New ids look like the site's own: short and safe for paths and buttons.
    const pid = id || randomHex(3);
    let path = null;
    if (upload) {
      path = `img/p-${pid}-${randomHex(2)}.${upload.ext}`;
      await putFile(path, upload.bytes, `фото ${pid}`);
    }
    let old = '';
    const { data, result } = await updateShop(`${id ? 'изменён' : 'новый'} товар ${title(fields)}`, (d) => {
      let p = id ? find(d, id) : null;
      if (!p) {
        p = { id: pid, name: '', stars: 0, price: 0, desc: '', tag: '', gold: false, image: '', hidden: false };
        d.products.push(p);
      }
      old = p.image;
      Object.assign(p, fields);
      if (path) p.image = path;
      else if (input.dropPhoto) p.image = '';
      return p;
    });
    if (old && old !== result.image) await deleteFile(old);
    return { ...appList(data), item: result };
  }
  if (action === 'delete') {
    const id = String(input.id || '');
    const { data, result } = await updateShop(`удалён товар ${id}`, (d) => {
      const p = find(d, id);
      d.products = d.products.filter((x) => x.id !== id);
      return p;
    });
    if (result.image) await deleteFile(result.image);
    return appList(data);
  }
  throw new ShopError('Неизвестное действие.');
}
