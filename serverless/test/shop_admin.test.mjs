import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMock } from 'sdk';
import { onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import { callback, checkErrors, lastText, privateMessage, setup, user, OWNER } from './helpers.mjs';

afterEach(() => { fetchMock.reset(); });
afterEach(checkErrors);

const KEY = 'github_pat_' + 'A'.repeat(40);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64').toString('utf8');

// A tiny in-memory SQUAD-SHOP repository behind the GitHub contents API.
function fakeGitHub({ push = true, conflictOnce = false } = {}) {
  const files = {
    'shop.json': JSON.stringify({ settings: { receiver: '4100', support: 'x' }, products: [
      { id: 's50', name: '', stars: 50, price: 85, desc: '', tag: '', gold: true, image: '', hidden: false },
      { id: 'prem6', name: 'Telegram Premium · 6 месяцев', stars: 0, price: 1649, desc: 'Подарком', tag: '', gold: false, image: 'img/p-prem6-ab.jpg', hidden: false },
    ] }, null, 2),
    'img/p-prem6-ab.jpg': 'old',
  };
  const shas = {};
  let n = 0;
  let conflict = conflictOnce;
  const sha = (path) => (shas[path] ??= `sha${++n}`);
  const repo = { files, commits: [] };
  fetchMock.handler = async (url, opts) => {
    assert.equal(opts.headers.Authorization, `Bearer ${KEY}`);
    assert.ok(opts.headers['User-Agent']);
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace('/repos/JEFFRIPPER/SQUAD-SHOP', '').replace(/^\/contents\//, ''));
    if (path === '') return { json: { permissions: { push } } };
    const body = opts.body && opts.body.json;
    if (opts.method === 'GET') return path in files ? { json: { sha: sha(path), content: b64(files[path]).replace(/(.{60})/g, '$1\n') } } : { status: 404, json: {} };
    if (opts.method === 'PUT') {
      if (path in files && body.sha !== sha(path)) return { status: 409, json: {} };
      if (conflict && path === 'shop.json') { conflict = false; shas[path] = 'other'; return { status: 409, json: {} }; }
      files[path] = path.endsWith('.json') ? unb64(body.content) : body.content;
      shas[path] = `sha${++n}`;
      repo.commits.push(body.message);
      return { status: 200, json: {} };
    }
    if (opts.method === 'DELETE') {
      delete files[path];
      repo.commits.push(body.message);
      return { status: 200, json: {} };
    }
    return { status: 500, json: {} };
  };
  repo.shop = () => JSON.parse(files['shop.json']);
  return repo;
}

function buttons(mock) {
  const markup = mock.calls.filter((c) => c.params.reply_markup).at(-1).params.reply_markup;
  return markup.inline_keyboard.flat();
}

async function connect(mock) {
  await onMessage(privateMessage(OWNER, `/shopkey ${KEY}`));
  assert.equal(mock.called('deleteMessage').length, 1);
  assert.match(lastText(mock), /Ключ GitHub подключён/);
}

test('/admin shows the products button; without a key it explains how to connect', async () => {
  const mock = await setup();
  await onMessage(privateMessage(OWNER, '/admin'));
  assert.ok(buttons(mock).some((b) => b.callback_data === 'admin:shop'));
  await onCallbackQuery(callback(OWNER, 'admin:shop'));
  assert.match(lastText(mock), /\/shopkey ключ/);
});

test('/shopkey is owner-only and checks write access', async () => {
  const mock = await setup();
  fakeGitHub({ push: false });
  await onMessage(privateMessage(user(5), `/shopkey ${KEY}`));
  assert.equal(mock.called('sendMessage').length, 0);
  await onMessage(privateMessage(OWNER, `/shopkey ${KEY}`));
  assert.match(lastText(mock), /нет права записи/);
  await onMessage(privateMessage(OWNER, '/shopkey nope'));
  assert.match(lastText(mock), /не похоже на ключ/);
});

test('list, card and price edit commit shop.json', async () => {
  const mock = await setup();
  const repo = fakeGitHub();
  await connect(mock);
  await onCallbackQuery(callback(OWNER, 'admin:shop'));
  assert.match(lastText(mock), /Товары SQUAD SHOP · 2/);
  assert.ok(buttons(mock).some((b) => b.callback_data === 'admin:shop:p:prem6'));
  await onCallbackQuery(callback(OWNER, 'admin:shop:p:prem6'));
  assert.match(lastText(mock), /Цена: 1 649 ₽/);
  await onCallbackQuery(callback(OWNER, 'admin:shop:e:prem6:price'));
  assert.match(lastText(mock), /Отправь цену/);
  await onMessage(privateMessage(OWNER, 'abc'));
  assert.match(lastText(mock), /целое число/);
  await onMessage(privateMessage(OWNER, '1 599 ₽'));
  assert.match(lastText(mock), /Сохранено/);
  assert.equal(repo.shop().products[1].price, 1599);
  assert.equal(repo.shop().settings.receiver, '4100'); // the rest of shop.json is kept
  // The dialog is over: the next text is not a price.
  await onMessage(privateMessage(OWNER, '100'));
  assert.equal(repo.shop().products[1].price, 1599);
});

test('name and description, with «-» clearing the description', async () => {
  const mock = await setup();
  const repo = fakeGitHub();
  await connect(mock);
  await onCallbackQuery(callback(OWNER, 'admin:shop:e:prem6:name'));
  await onMessage(privateMessage(OWNER, 'Premium на полгода'));
  await onCallbackQuery(callback(OWNER, 'admin:shop:e:prem6:desc'));
  await onMessage(privateMessage(OWNER, '-'));
  const p = repo.shop().products[1];
  assert.equal(p.name, 'Premium на полгода');
  assert.equal(p.desc, '');
  assert.match(lastText(mock), /Premium на полгода/);
});

test('new product asks for a price next; a number makes a stars pack', async () => {
  const mock = await setup();
  const repo = fakeGitHub();
  await connect(mock);
  await onCallbackQuery(callback(OWNER, 'admin:shop:new'));
  await onMessage(privateMessage(OWNER, '750'));
  assert.match(lastText(mock), /750 звёзд/);
  assert.match(lastText(mock), /отправь цену/);
  await onMessage(privateMessage(OWNER, '1290'));
  const p = repo.shop().products.at(-1);
  assert.equal(p.stars, 750);
  assert.equal(p.price, 1290);
  assert.equal(p.name, '');
});

test('photo upload stores a file and drops the old one; «-» removes it', async () => {
  const mock = await setup({ getFileContent: () => new Uint8Array([1, 2, 3]) });
  const repo = fakeGitHub();
  await connect(mock);
  await onCallbackQuery(callback(OWNER, 'admin:shop:e:prem6:photo'));
  await onMessage(privateMessage(OWNER, undefined, { photo: [
    { file_id: 'tiny', width: 90, height: 90 }, { file_id: 'mid', width: 800, height: 800 }, { file_id: 'big', width: 1280, height: 1280 },
  ] }));
  assert.match(lastText(mock), /Фото обновлено/);
  assert.equal(mock.called('getFileContent')[0].params, 'mid');
  const img = repo.shop().products[1].image;
  assert.match(img, /^img\/p-prem6-[0-9a-f]{4}\.jpg$/);
  assert.equal(repo.files[img], Buffer.from([1, 2, 3]).toString('base64'));
  assert.equal('img/p-prem6-ab.jpg' in repo.files, false);
  await onCallbackQuery(callback(OWNER, 'admin:shop:e:prem6:photo'));
  await onMessage(privateMessage(OWNER, '-'));
  assert.equal(repo.shop().products[1].image, '');
  assert.equal(img in repo.files, false);
});

test('hide, gold and delete with confirmation', async () => {
  const mock = await setup();
  const repo = fakeGitHub();
  await connect(mock);
  await onCallbackQuery(callback(OWNER, 'admin:shop:h:s50'));
  await onCallbackQuery(callback(OWNER, 'admin:shop:g:s50'));
  assert.equal(repo.shop().products[0].hidden, true);
  assert.equal(repo.shop().products[0].gold, false);
  await onCallbackQuery(callback(OWNER, 'admin:shop:d:prem6'));
  assert.match(lastText(mock), /Удалить/);
  assert.equal(repo.shop().products.length, 2);
  await onCallbackQuery(callback(OWNER, 'admin:shop:dd:prem6'));
  assert.deepEqual(repo.shop().products.map((p) => p.id), ['s50']);
  assert.equal('img/p-prem6-ab.jpg' in repo.files, false);
  assert.match(lastText(mock), /удалён/);
});

test('a concurrent change is retried on fresh data', async () => {
  const mock = await setup();
  const repo = fakeGitHub({ conflictOnce: true });
  await connect(mock);
  await onCallbackQuery(callback(OWNER, 'admin:shop:h:s50'));
  assert.equal(repo.shop().products[0].hidden, true);
  assert.match(lastText(mock), /Сохранено/);
});

test('other users cannot reach the products', async () => {
  const mock = await setup();
  fakeGitHub();
  await onCallbackQuery(callback(user(5), 'admin:shop'));
  assert.equal(mock.called('editMessageText').length, 0);
  assert.equal(fetchMock.calls.length, 0);
});
