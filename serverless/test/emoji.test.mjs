// Premium emoji: the owner sends emoji in the private chat, Финя takes their packs.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onCallbackQuery, onMessage } from '../tgcloud/lib/bot.js';
import { CHAT_EMOJI, wrap } from '../tgcloud/lib/emoji.js';
import { setSetting } from '../tgcloud/lib/store.js';
import {
  apiError, callback, checkErrors, DISCUSSION, groupMessage, OWNER, privateMessage, setup, user,
} from './helpers.mjs';

const realRandom = Math.random;
afterEach(async () => {
  Math.random = realRandom;
  await checkErrors();
});
// An ordinary farm (🌾), not the rare one (💎).
const plainFarm = () => { Math.random = () => 0.5; };

const PACKS = {
  icons: {
    title: 'Squad Icons',
    stickers: [
      { custom_emoji_id: '101', emoji: '🌾' },
      { custom_emoji_id: '102', emoji: '❤️' },
      { custom_emoji_id: '103', emoji: '🌾' }, // a second 🌾: the first one wins
      { custom_emoji_id: '104', emoji: '💍' },
      { custom_emoji_id: '105', emoji: '💒' },
    ],
  },
  hearts: {
    title: 'Hearts',
    stickers: [
      { custom_emoji_id: '201', emoji: '❤' },
      { custom_emoji_id: '202', emoji: '💔' },
    ],
  },
};
const ALL = Object.fromEntries(Object.entries(PACKS).flatMap(([name, p]) =>
  p.stickers.map((s) => [s.custom_emoji_id, { ...s, set_name: name }])));

const emojiApi = () => setup({
  getCustomEmojiStickers: (p) => p.custom_emoji_ids.map((id) => ALL[id]).filter(Boolean),
  getStickerSet: (p) => {
    if (!PACKS[p.name]) throw apiError('getStickerSet', 400, 'Bad Request: STICKERSET_INVALID');
    return { name: p.name, sticker_type: 'custom_emoji', ...PACKS[p.name] };
  },
});

// A private message of custom emoji, as Telegram delivers it.
function emojiMessage(from, ids) {
  const text = ids.map(() => '⭐').join('');
  const entities = ids.map((id, i) => ({ type: 'custom_emoji', offset: i, length: 1, custom_emoji_id: id }));
  return privateMessage(from, text, { entities });
}

const lastSent = (api) => {
  const s = api.called('sendMessage');
  return s.length ? s[s.length - 1].params : null;
};

test('one emoji per pack: Финя takes the whole packs, the sent one wins', async () => {
  const api = await emojiApi();
  // 💔 from «hearts» is sent: the pack comes in, and it is picked for 💔.
  await onMessage(emojiMessage(OWNER, ['202', '101']));
  const reply = lastSent(api).text;
  assert.match(reply, /Забрала паки/);
  assert.match(reply, /Hearts — 2 шт/);
  assert.match(reply, /Squad Icons — 5 шт/);
  const rows = Object.fromEntries((await db.all('SELECT base, custom_id, picked FROM premium_emoji')).map((r) => [r.base, r]));
  assert.equal(rows['🌾'].custom_id, '101');
  assert.equal(rows['💔'].custom_id, '202');
  assert.equal(rows['💔'].picked, 1);
  // Packs in the order sent: «hearts» came first, so its ❤ stays.
  assert.equal(rows['❤'].custom_id, '201');
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM emoji_packs')).c, 2);

  // Sending a specific one later replaces what the packs gave.
  await onMessage(emojiMessage(OWNER, ['102']));
  const heart = await db.get("SELECT custom_id, picked FROM premium_emoji WHERE base = '❤'");
  assert.deepEqual({ ...heart }, { custom_id: '102', picked: 1 });
});

test('chat replies show the premium emoji, names and buttons included', async () => {
  const api = await emojiApi();
  await setSetting('chat_captcha', false);
  await onMessage(emojiMessage(OWNER, ['101', '202']));
  api.calls = [];
  plainFarm();

  await onMessage(groupMessage(DISCUSSION, user(1, { first_name: 'Вася 🌾' }), 'фарм'));
  const text = lastSent(api).text;
  assert.match(text, /^<b><tg-emoji emoji-id="101">🌾<\/tg-emoji> /);
  // The plain-text name gets the premium one too; the rest stays plain.
  assert.match(text, /Вася <tg-emoji emoji-id="101">🌾<\/tg-emoji>/);

  // Proposal: the buttons get the premium emoji as icons.
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря 💍' });
  await onMessage(groupMessage(DISCUSSION, b, 'привет'));
  await onMessage(groupMessage(DISCUSSION, a, 'брак', { reply_to_message: groupMessage(DISCUSSION, b, 'сообщение') }));
  const p = lastSent(api);
  assert.match(p.text, /<tg-emoji emoji-id="104">💍<\/tg-emoji> <a href="tg:\/\/user\?id=2">Аня<\/a>/);
  // A name inside a mention stays as it is.
  assert.match(p.text, /<a href="tg:\/\/user\?id=3">Боря 💍<\/a>/);
  const [yes, no] = p.reply_markup.inline_keyboard[0];
  assert.deepEqual([yes.text, yes.icon_custom_emoji_id], ['Да', '104']);
  assert.deepEqual([no.text, no.icon_custom_emoji_id], ['Нет', '202']);

  // The edit after the answer goes out with premium emoji as well.
  await onCallbackQuery(callback(b, 'marry:y:2:3', { chat: DISCUSSION, message_id: p.message_id || 5000 }));
  const edits = api.called('editMessageText');
  assert.match(edits[edits.length - 1].params.text, /^<b><tg-emoji emoji-id="105">💒<\/tg-emoji> /);
});

test('if Telegram refuses the premium emoji, the plain reply still goes out', async () => {
  const api = await emojiApi();
  await setSetting('chat_captcha', false);
  await onMessage(emojiMessage(OWNER, ['101']));
  const base = api.handler;
  api.handler = async (method, params) => {
    if (method === 'sendMessage' && String(params.text).includes('tg-emoji')) {
      throw apiError('sendMessage', 400, 'Bad Request: custom emoji entities can\'t be used');
    }
    return base(method, params);
  };
  api.calls = [];
  plainFarm();
  await onMessage(groupMessage(DISCUSSION, user(1, { first_name: 'Вася' }), 'фарм'));
  const sends = api.called('sendMessage');
  assert.equal(sends.length, 2);
  assert.match(sends[1].params.text, /^<b>🌾 /);
});

test('only the owner feeds emoji; «эмодзи» and «эмодзи сброс»', async () => {
  const api = await emojiApi();
  await onMessage(emojiMessage(user(5), ['101']));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM premium_emoji')).c, 0);
  // Words with a premium emoji are a command, not emoji to take.
  await onMessage(privateMessage(OWNER, 'спасибо ⭐ за всё', { entities: [{ type: 'custom_emoji', offset: 8, length: 1, custom_emoji_id: '101' }] }));
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM premium_emoji')).c, 0);

  await onMessage(privateMessage(OWNER, 'эмодзи'));
  assert.match(lastSent(api).text, /Премиум-эмодзи пока нет/);

  await onMessage(emojiMessage(OWNER, ['101']));
  await onMessage(privateMessage(OWNER, 'эмодзи'));
  const status = lastSent(api).text;
  assert.match(status, new RegExp(`премиум: 4 из ${CHAT_EMOJI.length}`));
  assert.match(status, /Squad Icons/);
  assert.match(status, /Уже премиум: <tg-emoji emoji-id="102">❤️<\/tg-emoji> <tg-emoji emoji-id="104">💍/);

  await onMessage(privateMessage(OWNER, 'эмодзи сброс'));
  assert.match(lastSent(api).text, /снова обычные/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM premium_emoji')).c, 0);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM emoji_packs')).c, 0);
});

test('wrap leaves tags, links, code and premium emoji alone', () => {
  const map = new Map([['🔥', '1'], ['❤', '2']]);
  assert.equal(wrap('<b>🔥 <a href="x">🔥</a> <code>🔥</code> ❤️</b>', map),
    '<b><tg-emoji emoji-id="1">🔥</tg-emoji> <a href="x">🔥</a> <code>🔥</code> <tg-emoji emoji-id="2">❤️</tg-emoji></b>');
  assert.equal(wrap('<tg-emoji emoji-id="9">🔥</tg-emoji>', map), '<tg-emoji emoji-id="9">🔥</tg-emoji>');
  assert.equal(wrap('🙂 ok', map), '🙂 ok');
});
