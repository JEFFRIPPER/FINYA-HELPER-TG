// «Навигатор Сквада»: закреп с кнопками, который Финя сама держит свежим.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import * as navigator from '../tgcloud/lib/navigator.js';
import { getSetting, setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { apiError, checkErrors, DISCUSSION, FAMILY, groupMessage, OWNER, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const say = (from, text) => onMessage(groupMessage(DISCUSSION, from, text));
const navSends = (api) => api.called('sendMessage').filter((c) => /Навигатор Сквада/.test(String(c.params.text)));

async function start(overrides = {}) {
  let pinned = { message_id: 1 };
  const api = await setup({
    getChat: (p) => (p.chat_id === DISCUSSION.id
      ? { id: p.chat_id, type: 'supergroup', title: 'Обсуждения', username: 'squad_talk', invite_link: 'https://t.me/+talk', pinned_message: pinned }
      : { id: p.chat_id, type: 'supergroup', title: 'SQUAD FAMILY', invite_link: 'https://t.me/+family', pinned_message: pinned }),
    ...overrides,
  });
  await setSetting('chat_captcha', false);
  await db.run('INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, ?, ?, 0), (?, ?, ?, 0)',
    [DISCUSSION.id, DISCUSSION.title, OWNER.id, FAMILY.id, FAMILY.title, OWNER.id]);
  return { api, unpin: () => { pinned = null; } };
}

test('the owner places the navigator: buttons to the channel, chats, shop and projects, pinned quietly', async () => {
  const { api } = await start();
  await say(user(2, { first_name: 'Аня' }), 'Финя, Навигатор');
  assert.equal(navSends(api).length, 0);
  await say(OWNER, 'Финя, Навигатор');
  const [sent] = navSends(api);
  assert.ok(sent);
  assert.equal(sent.params.disable_notification, true);
  assert.match(sent.params.text, /🧩 Проекты: .*COUNTER/);
  const urls = sent.params.reply_markup.inline_keyboard.flat().map((b) => b.url);
  assert.ok(urls.includes('https://t.me/THKC_SQUAD'));
  assert.ok(urls.includes('https://t.me/squad_talk'));
  // SQUAD FAMILY is entered only after the form: no invite link anywhere.
  assert.ok(!urls.some((u) => /\+/.test(u)));
  assert.doesNotMatch(sent.params.text, /t\.me\/\+/);
  assert.match(sent.params.text, /только после анкеты/);
  assert.ok(urls.includes('https://jeffripper.github.io/SQUAD-SHOP/'));
  const pin = api.called('pinChatMessage');
  assert.equal(pin.length, 1);
  assert.equal(pin[0].params.disable_notification, true);
  assert.equal((await getSetting(`navigator:${DISCUSSION.id}`)).message_id, pin[0].params.message_id);
});

test('Финя edits the same message on a new post, re-sends a deleted one and re-pins when nothing is pinned', async () => {
  let gone = false;
  const { api, unpin } = await start({
    editMessageText: () => { if (gone) throw apiError('editMessageText', 400, 'Bad Request: message to edit not found'); return true; },
  });
  await say(OWNER, 'Финя, Навигатор');
  const first = (await getSetting(`navigator:${DISCUSSION.id}`)).message_id;
  const ts = nowInt();
  await navigator.tick(ts);
  assert.equal(api.called('editMessageText').length, 0);
  await navigator.tick(ts);

  await setSetting('last_channel_post_id', 55);
  await navigator.tick(ts);
  const edits = api.called('editMessageText');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].params.message_id, first);
  assert.match(edits[0].params.text, /Последний пост: <a href="https:\/\/t\.me\/THKC_SQUAD\/55">/);

  gone = true;
  await setSetting('last_channel_post_id', 56);
  await navigator.tick(ts);
  assert.equal(navSends(api).length, 2);
  assert.notEqual((await getSetting(`navigator:${DISCUSSION.id}`)).message_id, first);
  assert.equal(api.called('pinChatMessage').length, 2);

  gone = false;
  unpin();
  await navigator.tick(ts + 86400);
  assert.equal(api.called('pinChatMessage').length, 3);
});

test('«Навигатор Выкл» unpins and deletes it; Финя stops updating that chat', async () => {
  const { api } = await start();
  await say(OWNER, 'Финя, Навигатор');
  await say(OWNER, 'Финя, Навигатор Выкл');
  assert.equal(api.called('unpinChatMessage').length, 1);
  assert.ok(api.called('deleteMessage').length >= 1);
  assert.equal(await getSetting(`navigator:${DISCUSSION.id}`), null);
  await setSetting('last_channel_post_id', 77);
  await navigator.tick(nowInt());
  assert.equal(api.called('editMessageText').length, 0);
});
