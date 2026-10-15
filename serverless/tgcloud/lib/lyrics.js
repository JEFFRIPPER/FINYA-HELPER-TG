// Song lyrics for the Mini App player. Sources are tried in order until one
// has time-synced (LRC) lyrics; plain lyrics are kept as a fallback.
// Only LRCLIB is a documented public API; the others are the unofficial
// endpoints music players use, so every source may fail on its own.
import { fetch } from 'sdk';
import { base64ToBytes, utf8Decode } from './util.js';

const UA = 'FINYA-HELPER (https://github.com/JEFFRIPPER/FINYA-HELPER-TG)';
const TIMEOUT_MS = 6000;
const MAX_CHARS = 20000;

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

async function getJson(url, headers = {}) {
  const res = await withTimeout(fetch(url, { headers: { 'User-Agent': UA, ...headers } }));
  if (!res.ok) return null;
  return res.json();
}

const q = (params) => Object.entries(params)
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// A candidate fits when the title matches and the length is within 5 seconds.
function fits(track, title, duration) {
  const a = norm(title);
  const b = norm(track.title);
  if (!a || !b || !(a.includes(b) || b.includes(a))) return false;
  return !duration || !track.duration || Math.abs(track.duration - duration) <= 5;
}

export function isSynced(text) {
  return typeof text === 'string' && /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(text);
}

async function lrclib({ title, artist, duration }) {
  const params = { track_name: title };
  if (artist) params.artist_name = artist;
  if (duration) params.duration = Math.round(duration);
  let hit = await getJson(`https://lrclib.net/api/get?${q(params)}`);
  if (!hit) {
    const found = await getJson(`https://lrclib.net/api/search?${q({ q: `${artist || ''} ${title}`.trim() })}`);
    hit = (found || []).find((t) => t.syncedLyrics && fits({ title: t.trackName, duration: t.duration }, title, duration))
      || (found || []).find((t) => fits({ title: t.trackName, duration: t.duration }, title, duration));
  }
  if (!hit) return null;
  return { synced: hit.syncedLyrics || null, plain: hit.plainLyrics || null };
}

async function netease({ title, artist, duration }) {
  const found = await getJson(`https://music.163.com/api/search/get?${q({ s: `${artist || ''} ${title}`.trim(), type: 1, limit: 10 })}`,
    { Referer: 'https://music.163.com/' });
  const songs = (found && found.result && found.result.songs) || [];
  const song = songs.find((s) => fits({ title: s.name, duration: s.duration / 1000 }, title, duration));
  if (!song) return null;
  const lrc = await getJson(`https://music.163.com/api/song/lyric?${q({ id: song.id, lv: 1 })}`, { Referer: 'https://music.163.com/' });
  const text = lrc && lrc.lrc && lrc.lrc.lyric;
  return text ? { synced: isSynced(text) ? text : null, plain: isSynced(text) ? null : text } : null;
}

async function kugou({ title, artist, duration }) {
  const params = { ver: 1, man: 'yes', client: 'pc', keyword: artist ? `${artist} - ${title}` : title };
  if (duration) params.duration = Math.round(duration * 1000);
  const found = await getJson(`https://lyrics.kugou.com/search?${q(params)}`);
  const c = found && found.candidates && found.candidates[0];
  if (!c) return null;
  const dl = await getJson(`https://lyrics.kugou.com/download?${q({ ver: 1, client: 'pc', id: c.id, accesskey: c.accesskey, fmt: 'lrc', charset: 'utf8' })}`);
  if (!dl || !dl.content) return null;
  const text = utf8Decode(base64ToBytes(dl.content));
  return isSynced(text) ? { synced: text, plain: null } : null;
}

async function qqMusic({ title, artist, duration }) {
  const headers = { Referer: 'https://y.qq.com/' };
  const found = await getJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${q({ w: `${artist || ''} ${title}`.trim(), format: 'json', p: 1, n: 10 })}`, headers);
  const list = (found && found.data && found.data.song && found.data.song.list) || [];
  const song = list.find((s) => fits({ title: s.songname, duration: s.interval }, title, duration));
  if (!song) return null;
  const lrc = await getJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${q({ songmid: song.songmid, format: 'json', nobase64: 1 })}`, headers);
  const text = lrc && lrc.lyric;
  return text ? { synced: isSynced(text) ? text : null, plain: isSynced(text) ? null : text } : null;
}

// Deezer serves lyrics (from LyricFind) through its web gateway with an
// anonymous session: getUserData hands out the token and the session cookie.
async function deezer({ title, artist, duration }) {
  const found = await getJson(`https://api.deezer.com/search?${q({ q: `${artist || ''} ${title}`.trim() })}`);
  const track = ((found && found.data) || []).find((t) => fits({ title: t.title, duration: t.duration }, title, duration));
  if (!track) return null;
  const gw = 'https://www.deezer.com/ajax/gw-light.php?api_version=1.0&input=3';
  const user = await withTimeout(fetch(`${gw}&api_token=null&method=deezer.getUserData`, { headers: { 'User-Agent': UA } }));
  const cookie = (user.headers.get('set-cookie') || '').split(/,(?=\s*\w+=)/).map((c) => c.split(';')[0].trim()).join('; ');
  const token = (await user.json()).results.checkForm;
  const res = await withTimeout(fetch(`${gw}&api_token=${encodeURIComponent(token)}&method=song.getLyrics`, {
    method: 'POST', headers: { 'User-Agent': UA, Cookie: cookie }, body: fetch.body.json({ sng_id: String(track.id) }),
  }));
  const r = (await res.json()).results || {};
  const lines = (r.LYRICS_SYNC_JSON || []).filter((l) => l.lrc_timestamp && l.line);
  if (lines.length) return { synced: lines.map((l) => `${l.lrc_timestamp} ${l.line}`).join('\n'), plain: null };
  return r.LYRICS_TEXT ? { synced: null, plain: r.LYRICS_TEXT } : null;
}

export const SOURCES = [['LRCLIB', lrclib], ['NetEase', netease], ['Kugou', kugou], ['QQ Music', qqMusic], ['Deezer', deezer]];

// → { synced, plain, source } or null. Errors of one source never stop the chain.
export async function findLyrics(track, sources = SOURCES) {
  let plain = null;
  for (const [name, find] of sources) {
    let hit = null;
    try {
      hit = await find(track);
    } catch (err) {
      console.warn(`[lyrics] ${name}: ${err && err.message}`);
    }
    if (hit && hit.synced) return { synced: hit.synced.slice(0, MAX_CHARS), plain: null, source: name };
    if (hit && hit.plain && !plain) plain = { synced: null, plain: hit.plain.slice(0, MAX_CHARS), source: name };
  }
  return plain;
}
