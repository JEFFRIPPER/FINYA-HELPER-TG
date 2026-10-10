import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, EndpointError, fetchMock } from 'sdk';
import shopEndpoint from '../tgcloud/endpoints/shop.js';
import { onMessage, pump } from '../tgcloud/lib/bot.js';
import { describeItems, isToken, parseLabel } from '../tgcloud/lib/shop.js';
import { getSetting, setSetting } from '../tgcloud/lib/store.js';
import { checkErrors, OWNER, privateMessage, setup, user } from './helpers.mjs';

afterEach(() => { fetchMock.reset(); return checkErrors(); });

const CLIENT = 'A'.repeat(64);
const TOKEN = '410011234567890.' + 'B'.repeat(120);
const SHOP = { products: [{ id: 's250', stars: 250, name: '' }, { id: 'prem6', stars: 0, name: 'Telegram Premium · 6 месяцев' }] };

function op(id, label, extra = {}) {
  return { operation_id: id, status: 'success', datetime: '2026-10-10T03:00:00+03:00', direction: 'in', amount: 406.43, label, type: 'deposition', ...extra };
}

// A fake YooMoney + GitHub Pages; `ops` is the wallet history.
function yoomoney(state) {
  fetchMock.handler = async (url, opts) => {
    if (url.startsWith('https://jeffripper.github.io/SQUAD-SHOP/shop.json')) return { json: SHOP };
    if (url === 'https://yoomoney.ru/oauth/token') {
      return opts.body.form.code === 'GOODCODE' ? { json: { access_token: TOKEN } } : { status: 400, json: { error: 'invalid_grant' } };
    }
    if (url === 'https://yoomoney.ru/api/operation-history') {
      if (opts.headers.Authorization !== `Bearer ${TOKEN}`) return { status: 401 };
      assert.equal(opts.body.form.type, 'deposition');
      return { json: { operations: state.ops } };
    }
    throw new Error('unexpected fetch ' + url);
  };
}

const ownerCall = (input) => shopEndpoint(input, { initData: { user: OWNER } });

test('labels from the site turn into readable orders', async () => {
  await setup();
  assert.deepEqual(parseLabel('SQ-AB12CD @durov 250*,prem6x2'), { orderId: 'SQ-AB12CD', username: 'durov', items: '250*,prem6x2' });
  assert.deepEqual(parseLabel('SQ-AB12CD @durov'), { orderId: 'SQ-AB12CD', username: 'durov', items: '' });
  assert.equal(parseLabel('пополнение'), null);
  assert.equal(parseLabel(undefined), null);
  assert.equal(describeItems('1000*,prem6x2,x9', { prem6: 'Premium 6' }), '1\u00a0000 звёзд, Premium 6 ×2, x9');
  assert.equal(describeItems('21*'), '21 звезда');
  assert.equal(isToken(TOKEN), true);
  assert.equal(isToken(CLIENT), false);
});

test('/ym: client_id → consent link, /ymcode → token, then orders arrive in the owner chat', async () => {
  const mock = await setup();
  const state = { ops: [op('1', 'SQ-AB12CD @durov 250*,prem6x2'), op('2', 'не магазин'), op('3', 'SQ-ZZ99ZZ @x 250*', { direction: 'out' })] };
  yoomoney(state);

  await onMessage(privateMessage(user(5), `/ym ${CLIENT}`));
  assert.equal(mock.called('sendMessage').length, 0, 'only the owner may connect');

  await onMessage(privateMessage(OWNER, '/ym'));
  assert.match(mock.called('sendMessage').at(-1).params.text, /yoomoney\.ru\/myservices\/new/);
  assert.match(mock.called('sendMessage').at(-1).params.text, /jeffripper\.github\.io\/SQUAD-SHOP\/ym\.html/);

  await onMessage(privateMessage(OWNER, `/ym ${CLIENT}`));
  const link = mock.called('sendMessage').at(-1).params.reply_markup.inline_keyboard[0][0].url;
  assert.equal(link, `https://jeffripper.github.io/SQUAD-SHOP/ym.html?cid=${CLIENT}&bot=finya_bot`);

  await onMessage(privateMessage(OWNER, '/ymcode OLDCODE'));
  assert.match(mock.called('sendMessage').at(-1).params.text, /истёк/);
  assert.equal(await getSetting('ym_token'), null);

  const sent = mock.called('sendMessage').length;
  const msg = privateMessage(OWNER, '/ymcode GOODCODE');
  await onMessage(msg);
  const tokenCall = fetchMock.calls.find((c) => c.url.endsWith('/oauth/token') && c.opts.body.form.code === 'GOODCODE');
  assert.equal(tokenCall.opts.body.form.redirect_uri, link, 'same redirect_uri as in the consent request');
  assert.ok(mock.called('deleteMessage').some((c) => c.params.message_id === msg.message_id), 'the code is removed from the chat');
  assert.equal(await getSetting('ym_token'), TOKEN);
  const texts = mock.called('sendMessage').slice(sent).map((c) => c.params.text);
  assert.match(texts[0], /ЮMoney подключён/);
  assert.equal(texts.length, 2);
  assert.match(texts[1], /Новый заказ SQ-AB12CD/);
  assert.match(texts[1], /@durov/);
  assert.match(texts[1], /250 звёзд, Telegram Premium · 6 месяцев ×2/);
  assert.match(texts[1], /406,43 ₽/);

  // The same payment never notifies twice; a new one does, on the next update after a minute.
  state.ops.unshift(op('4', 'SQ-NEW001 @friend 50*'));
  await setSetting('ym_sync_at', 0);
  const before = mock.called('sendMessage').length;
  await pump({ force: true });
  const after = mock.called('sendMessage').slice(before).map((c) => c.params.text);
  assert.equal(after.length, 1);
  assert.match(after[0], /SQ-NEW001/);
  await pump({ force: true });
  assert.equal(mock.called('sendMessage').length, before + 1, 'synced less than a minute ago');
});

test('Mini App: the owner lists orders and marks them issued; nobody else can', async () => {
  await setup();
  const state = { ops: [op('1', 'SQ-AB12CD @durov 250*'), op('2', 'SQ-CD34EF @kate prem6', { datetime: '2026-10-10T04:00:00+03:00' })] };
  yoomoney(state);

  let data = await ownerCall({ action: 'list' });
  assert.equal(data.connected, false);
  assert.deepEqual(data.items, []);

  await setSetting('ym_token', TOKEN);
  data = await ownerCall({ action: 'list' });
  assert.equal(data.connected, true);
  assert.equal(data.error, null);
  assert.equal(data.waiting, 2);
  assert.deepEqual(data.items.map((o) => [o.order, o.username, o.what, o.issued]), [
    ['SQ-CD34EF', 'kate', 'Telegram Premium · 6 месяцев', false],
    ['SQ-AB12CD', 'durov', '250 звёзд', false],
  ]);

  data = await ownerCall({ action: 'issue', id: '1', issued: true });
  assert.equal(data.waiting, 1);
  assert.equal(data.items.find((o) => o.id === '1').issued, true);
  data = await ownerCall({ action: 'issue', id: '1', issued: false });
  assert.equal(data.waiting, 2);
  await assert.rejects(ownerCall({ action: 'issue', id: 'nope', issued: true }), EndpointError);
  await assert.rejects(shopEndpoint({ action: 'list' }, { initData: { user: user(5) } }), (err) => err instanceof EndpointError && err.parameters.code === 'FORBIDDEN');

  // A revoked token shows up as a hint, saved orders stay visible.
  await setSetting('ym_token', TOKEN + 'X');
  await setSetting('ym_sync_at', 0);
  data = await ownerCall({ action: 'list' });
  assert.match(data.error, /подключи кошелёк заново/);
  assert.equal(data.items.length, 2);
  const rows = await db.all('SELECT COUNT(*) AS c FROM shop_orders');
  assert.equal(rows[0].c, 2);
});

test('/ymcode always answers, even when YooMoney cannot be reached', async () => {
  const mock = await setup();
  await setSetting('ym_client_id', CLIENT);
  fetchMock.handler = async () => { throw new Error('connect ETIMEDOUT'); };
  await onMessage(privateMessage(OWNER, '/ymcode SOMECODE'));
  assert.match(mock.called('sendMessage').at(-1).params.text, /не достучалась до ЮMoney: connect ETIMEDOUT/);
  assert.equal(await getSetting('ym_token'), null);
});

test('/ymping lists which hosts answer', async () => {
  const mock = await setup();
  fetchMock.handler = async (url) => {
    if (url.startsWith('https://yoomoney.ru')) throw new Error('request failed');
    return { status: 200, json: {} };
  };
  await onMessage(privateMessage(OWNER, '/ymping'));
  const text = mock.called('sendMessage').at(-1).params.text;
  assert.match(text, /ЮMoney API: нет связи, request failed/);
  assert.match(text, /GitHub API: ответ 200/);
  await onMessage(privateMessage(user(5), '/ymping'));
  assert.equal(mock.called('sendMessage').length, 1);
});

