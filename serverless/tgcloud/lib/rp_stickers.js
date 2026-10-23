// After an RP line Финя sends a matching sticker of her own pack. The pack's file ids
// are fetched once a day; a command without a fitting sticker stays text only.
import { api, BotApiError } from 'sdk';
import { getSetting, setSetting } from './store.js';
import { nowInt } from './util.js';

export const PACK = 'SquadCorporation';
const CACHE_KEY = 'rp_sticker_ids';
const TTL = 24 * 3600;

// RP command → the sticker's position in the pack (from 0, in Telegram's order).
export const RP_STICKERS = {
  'обнять': 17, // обнимашки
  'прижать': 16, // обнимашки с сердечками
  'поцеловать': 18, // LOVE YOU
  'чмок': 18,
  'погладить': 22, // ушки и сердечки
  'кусь': 22,
  'пожалеть': 2, // «Скучаю…»
  'поздравить': 21, // с бутылкой
  'дать пять': 1, // «Привет!» с ладошкой
  'подарить цветы': 19, // с цветами
  'понюхать': 19,
  'угостить чаем': 0, // «Доброе утро» с кружкой
  'покормить': 4, // «Кушать будешь?»
  'тыкнуть': 24, // тычет пальцем
  'укусить': 9, // «Ням»
  'лизнуть': 9,
  'шлепнуть': 11, // «Разврат! но я одобряю»
  'ударить': 6, // «Тебе пиздец!»
  'пнуть': 6,
  'убить': 20, // «Грешник»
  'уничтожить': 15, // «Сделай выбор»
};

let memo = null;

async function fileIds() {
  if (memo && nowInt() - memo.at < TTL) return memo.ids;
  const saved = await getSetting(CACHE_KEY);
  if (saved && Array.isArray(saved.ids) && nowInt() - saved.at < TTL) {
    memo = saved;
    return saved.ids;
  }
  try {
    const set = await api.getStickerSet({ name: PACK });
    memo = { at: nowInt(), ids: (set.stickers || []).map((s) => s.file_id) };
    await setSetting(CACHE_KEY, memo);
    return memo.ids;
  } catch (err) {
    if (!(err instanceof BotApiError)) throw err;
    return saved && Array.isArray(saved.ids) ? saved.ids : [];
  }
}

// The sticker's file id for the command, or null.
export async function stickerFor(cmd) {
  const i = RP_STICKERS[cmd];
  if (i == null) return null;
  return (await fileIds())[i] || null;
}

// A sticker failed to send (the pack changed): fetch the pack again next time.
export async function forget() {
  memo = null;
  await setSetting(CACHE_KEY, null);
}
