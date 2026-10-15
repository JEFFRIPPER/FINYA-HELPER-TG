// Song lyrics for the Mini App player. Every source is asked at once and the
// best answer wins: word-synced, then line-synced (LRC), then plain text.
// Word timings travel as enhanced LRC: [line start]<word start>word <end>.
// Only LRCLIB and the iTunes search are documented public APIs; the others are
// the unofficial endpoints music players use, so every source may fail alone.
import { fetch } from 'sdk';
import { base64ToBytes, utf8Decode } from './util.js';

const UA = 'FINYA-HELPER (https://github.com/JEFFRIPPER/FINYA-HELPER-TG)';
const TIMEOUT_MS = 6000; // one request
const GRACE_MS = 1500; // after a line-synced hit, how long to wait for a word-synced one
const DEADLINE_MS = 9000; // the whole search
const MAX_CHARS = 60000;

// The serverless isolate has no timers at all (setTimeout and clearTimeout are
// not defined), so there a request ends when the platform ends it and the
// search ends on what the sources answer, not on a clock.
const hasTimers = () => typeof setTimeout === 'function' && typeof clearTimeout === 'function';

function withTimeout(promise) {
  if (!hasTimers()) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

const get = (url, headers = {}) => withTimeout(fetch(url, { headers: { 'User-Agent': UA, ...headers } }));

async function getJson(url, headers) {
  const res = await get(url, headers);
  if (!res.ok) return null;
  return res.json();
}

async function getText(url, headers) {
  const res = await get(url, headers);
  if (!res.ok) return null;
  return res.text();
}

const q = (params) => Object.entries(params)
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const query = (artist, title) => `${artist || ''} ${title}`.trim();

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

export function isWordSynced(text) {
  return isSynced(text) && /<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/.test(text);
}

const synced = (text) => (isSynced(text) ? { synced: text } : text ? { plain: text } : null);

// ---- formats ----------------------------------------------------------------

function stamp(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(cs / 6000))}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

// Word texts cut from the line text, so the spaces come out right whatever
// the source does with them. Falls back to the parts as they are.
function alignWords(text, parts) {
  parts = parts.filter((p) => p.text.trim());
  if (!text) return parts;
  const at = [];
  let pos = 0;
  for (const p of parts) {
    const word = p.text.trim();
    const i = word ? text.indexOf(word, pos) : -1;
    if (i < 0) return parts;
    at.push(i);
    pos = i + word.length;
  }
  return parts.map((p, k) => ({ ...p, text: text.slice(at[k], k + 1 < at.length ? at[k + 1] : text.length) }));
}

// [{ start, end, text, words?: [{ start, end, text }] }] in seconds → LRC.
// A line gets word stamps when it has two words or more; a long pause
// between lines becomes an empty line, so the old line does not hang there.
export function toLrc(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const words = (l.words || []).filter((w) => w.text && w.text.trim());
    if (words.length > 1) {
      let s = `[${stamp(l.start)}]`;
      for (const w of words) s += `<${stamp(w.start)}>${w.text}`;
      const end = l.end || words[words.length - 1].end;
      out.push(end ? `${s.trimEnd()}<${stamp(end)}>` : s.trimEnd());
    } else {
      out.push(`[${stamp(l.start)}]${(l.text || words.map((w) => w.text).join('')).trim()}`);
    }
    const next = lines[i + 1];
    if (l.end && next && next.start - l.end > 3) out.push(`[${stamp(l.end)}]`);
  });
  return out.join('\n');
}

// Milliseconds or seconds: no song line starts after two hours.
function scaleOf(lines) {
  const max = Math.max(0, ...lines.map((l) => Number(l.end || l.start) || 0));
  return max > 7200 ? 0.001 : 1;
}

function scaled(lines) {
  const k = scaleOf(lines);
  const s = (v) => (v == null ? null : Number(v) * k);
  return lines.map((l) => ({
    start: s(l.start), end: s(l.end), text: l.text,
    words: l.words && l.words.map((w) => ({ start: s(w.start), end: s(w.end), text: w.text })),
  }));
}

function parseClock(v) {
  const s = String(v || '').trim();
  if (/^[\d.]+s$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// The element starting at `from` (an opening tag) up to its matching close tag.
function elementAt(html, from, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { start: from, end: re.lastIndex, inner: html.slice(html.indexOf('>', from) + 1, m.index) };
  }
  return null;
}

// Drops every element whose opening tag matches `attr` (with what is inside).
function dropElements(html, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*${attr}[^>]*>`, 'i');
  let m;
  while ((m = re.exec(html))) {
    const el = elementAt(html, m.index, tag);
    if (!el) break;
    html = html.slice(0, el.start) + html.slice(el.end);
  }
  return html;
}

const textOf = (html) => decodeHtml(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));

// Apple Music style TTML → LRC, word stamps when the spans carry them.
export function ttmlToLrc(ttml) {
  const body = dropElements(String(ttml), 'span', 'x-bg');
  const lines = [];
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let p;
  while ((p = pRe.exec(body))) {
    const start = parseClock((p[1].match(/\bbegin="([^"]+)"/) || [])[1]);
    if (start == null) continue;
    const end = parseClock((p[1].match(/\bend="([^"]+)"/) || [])[1]);
    const words = [];
    const sRe = /<span\b([^>]*\bbegin="([^"]+)"[^>]*)>([^<]*)<\/span>(\s*)/gi;
    let s;
    while ((s = sRe.exec(p[2]))) {
      words.push({ start: parseClock(s[2]), end: parseClock((s[1].match(/\bend="([^"]+)"/) || [])[1]), text: decodeHtml(s[3]) + s[4] });
    }
    lines.push({ start, end, text: textOf(p[2]).replace(/\s+/g, ' ').trim(), words });
  }
  return lines.length ? toLrc(lines) : null;
}

// ---- sources ----------------------------------------------------------------

async function lrclib({ title, artist, duration }) {
  const params = { track_name: title };
  if (artist) params.artist_name = artist;
  if (duration) params.duration = Math.round(duration);
  let hit = await getJson(`https://lrclib.net/api/get?${q(params)}`);
  if (!hit) {
    const found = await getJson(`https://lrclib.net/api/search?${q({ q: query(artist, title) })}`);
    hit = (found || []).find((t) => t.syncedLyrics && fits({ title: t.trackName, duration: t.duration }, title, duration))
      || (found || []).find((t) => fits({ title: t.trackName, duration: t.duration }, title, duration));
  }
  if (!hit) return null;
  return { synced: hit.syncedLyrics || null, plain: hit.plainLyrics || null };
}

// Apple Music lyrics through Paxsenix (Lyrically); the track id comes from the iTunes search.
async function paxsenix({ title, artist, duration }) {
  const found = await getJson(`https://itunes.apple.com/search?${q({ term: query(artist, title), entity: 'song', limit: 8, country: 'ru' })}`);
  const song = ((found && found.results) || [])
    .find((s) => fits({ title: s.trackName, duration: s.trackTimeMillis / 1000 }, title, duration));
  if (!song) return null;
  const data = await getJson(`https://lyrics.paxsenix.org/apple-music/lyrics?${q({ id: song.trackId, v: 2 })}`);
  const content = (data && Array.isArray(data.content) && data.content) || [];
  if (!content.length) return null;
  const lines = scaled(content.map((l) => {
    const parts = Array.isArray(l.text) ? l.text : [{ text: String(l.text || ''), timestamp: l.timestamp, endtime: l.endtime }];
    return {
      start: l.timestamp, end: l.endtime,
      text: parts.map((w) => w.text + (w.part ? '' : ' ')).join('').trim(),
      words: parts.map((w) => ({ start: w.timestamp, end: w.endtime, text: w.text + (w.part ? '' : ' ') })),
    };
  }));
  return { synced: toLrc(lines) };
}

// Lyrics+ (KPoe), the YouLy+ backend: Apple Music, Musixmatch, Spotify. Same API on every mirror.
const LYRICS_PLUS = [
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus-seven.vercel.app',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyrics-plus-backend.vercel.app',
];

async function lyricsPlus({ title, artist, duration }) {
  const params = { title, artist: artist || '', source: 'apple,lyricsplus,musixmatch,spotify,musixmatch-word' };
  if (duration) params.duration = Math.round(duration);
  for (const base of LYRICS_PLUS) {
    let res;
    try {
      res = await get(`${base}/v2/lyrics/get?${q(params)}`);
    } catch (err) {
      continue; // mirror is down
    }
    if (res.status === 404) return null;
    if (!res.ok) continue;
    const data = await res.json();
    const list = (data && Array.isArray(data.lyrics) && data.lyrics) || [];
    if (!list.length) return null;
    const byWord = /word|syllable/i.test(String(data.type || ''));
    const lines = scaled(list.map((l) => {
      const parts = (byWord && Array.isArray(l.syllabus) ? l.syllabus : [])
        .filter((s) => !s.isBackground)
        .map((s) => ({ start: s.time, end: Number(s.time) + Number(s.duration || 0), text: String(s.text || '') }));
      return { start: l.time, end: Number(l.time) + Number(l.duration || 0), text: l.text, words: alignWords(l.text, parts) };
    }));
    return { synced: toLrc(lines) };
  }
  return null;
}

// Musixmatch desktop app API: an anonymous token, then search and subtitles.
let mxmToken = null;

async function mxm(action, params) {
  const all = { ...params, app_id: 'web-desktop-app-v1.0', t: Date.now() };
  if (action !== 'token.get' && mxmToken) all.usertoken = mxmToken.value;
  const data = await getJson(`https://apic-desktop.musixmatch.com/ws/1.1/${action}?${q(all)}`);
  const msg = data && data.message;
  return msg && msg.header && msg.header.status_code === 200 ? msg.body : null;
}

async function musixmatch({ title, artist, duration }) {
  if (!mxmToken || mxmToken.until < Date.now()) {
    const body = await mxm('token.get', { user_language: 'en' });
    const token = body && body.user_token;
    if (!token || /UpgradeOnly/.test(token)) return null; // captcha wall
    mxmToken = { value: token, until: Date.now() + 10 * 60 * 1000 };
  }
  const found = await mxm('track.search', { q_track: title, q_artist: artist || '', page_size: 5, page: 1, s_track_rating: 'desc' });
  const track = ((found && found.track_list) || []).map((x) => x.track)
    .find((t) => t && fits({ title: t.track_name, duration: t.track_length }, title, duration));
  if (!track) return null;
  if (track.has_richsync !== 0) {
    const rich = await mxm('track.richsync.get', { track_id: track.track_id });
    const body = rich && rich.richsync && rich.richsync.richsync_body;
    let rows = [];
    try {
      rows = body ? JSON.parse(body) : [];
    } catch (err) { /* fall back to line timings */ }
    if (rows.length) {
      const lines = rows.map((l) => {
        const words = [];
        for (const c of l.l || []) {
          if (!String(c.c).trim() && words.length) words[words.length - 1].text += c.c;
          else if (String(c.c).trim()) words.push({ start: Number(l.ts) + Number(c.o), text: String(c.c) });
        }
        return { start: Number(l.ts), end: Number(l.te), text: l.x, words: alignWords(l.x, words) };
      });
      return { synced: toLrc(lines) };
    }
  }
  const sub = await mxm('track.subtitle.get', { track_id: track.track_id, subtitle_format: 'lrc' });
  const text = sub && sub.subtitle && sub.subtitle.subtitle_body;
  if (isSynced(text)) return { synced: text };
  const ly = await mxm('track.lyrics.get', { track_id: track.track_id });
  return synced(ly && ly.lyrics && ly.lyrics.lyrics_body);
}

async function netease({ title, artist, duration }) {
  const headers = { Referer: 'https://music.163.com/' };
  const found = await getJson(`https://music.163.com/api/search/get?${q({ s: query(artist, title), type: 1, limit: 10 })}`, headers);
  const songs = (found && found.result && found.result.songs) || [];
  const song = songs.find((s) => fits({ title: s.name, duration: s.duration / 1000 }, title, duration));
  if (!song) return null;
  const lrc = await getJson(`https://music.163.com/api/song/lyric?${q({ id: song.id, lv: 1 })}`, headers);
  return synced(lrc && lrc.lrc && lrc.lrc.lyric);
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
  return isSynced(text) ? { synced: text } : null;
}

async function qqMusic({ title, artist, duration }) {
  const headers = { Referer: 'https://y.qq.com/' };
  const found = await getJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${q({ w: query(artist, title), format: 'json', p: 1, n: 10 })}`, headers);
  const list = (found && found.data && found.data.song && found.data.song.list) || [];
  const song = list.find((s) => fits({ title: s.songname, duration: s.interval }, title, duration));
  if (!song) return null;
  const lrc = await getJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${q({ songmid: song.songmid, format: 'json', nobase64: 1 })}`, headers);
  return synced(lrc && lrc.lyric);
}

// Deezer serves lyrics (from LyricFind) through its web gateway with an
// anonymous session: getUserData hands out the token and the session cookie.
async function deezer({ title, artist, duration }) {
  const found = await getJson(`https://api.deezer.com/search?${q({ q: query(artist, title) })}`);
  const track = ((found && found.data) || []).find((t) => fits({ title: t.title, duration: t.duration }, title, duration));
  if (!track) return null;
  const gw = 'https://www.deezer.com/ajax/gw-light.php?api_version=1.0&input=3';
  const user = await get(`${gw}&api_token=null&method=deezer.getUserData`);
  const cookie = (user.headers.get('set-cookie') || '').split(/,(?=\s*\w+=)/).map((c) => c.split(';')[0].trim()).join('; ');
  const token = (await user.json()).results.checkForm;
  const res = await withTimeout(fetch(`${gw}&api_token=${encodeURIComponent(token)}&method=song.getLyrics`, {
    method: 'POST', headers: { 'User-Agent': UA, Cookie: cookie }, body: fetch.body.json({ sng_id: String(track.id) }),
  }));
  const r = (await res.json()).results || {};
  const lines = (r.LYRICS_SYNC_JSON || []).filter((l) => l.lrc_timestamp && l.line);
  if (lines.length) return { synced: lines.map((l) => `${l.lrc_timestamp} ${l.line}`).join('\n') };
  return r.LYRICS_TEXT ? { plain: r.LYRICS_TEXT } : null;
}

// LiriQo: one endpoint over Apple Music, QQ, KuGou, NetEase, YouTube Music and others.
async function liriqo({ title, artist, duration }) {
  const params = { title, artist: artist || '' };
  if (duration) params.duration = Math.round(duration);
  const text = await getText(`https://api.liriqo-alfarrizi.workers.dev/v1/lrc?${q(params)}`);
  return isSynced(text) ? { synced: text } : null;
}

// Unison: the Better Lyrics community database (TTML, LRC or plain).
async function unison({ title, artist, duration }) {
  const params = { song: title, artist: artist || '' };
  if (duration) params.duration = Math.round(duration);
  const data = await getJson(`https://unison.boidu.dev/lyrics?${q(params)}`);
  const d = data && data.success && data.data;
  if (!d || !d.lyrics) return null;
  if (d.format === 'ttml') {
    const lrc = ttmlToLrc(d.lyrics);
    return lrc ? { synced: lrc } : null;
  }
  return synced(d.lyrics);
}

async function megalobiz({ title, artist }) {
  const html = await getText(`https://www.megalobiz.com/search/all?${q({ qry: query(artist, title), 'searchButton.x': 0, 'searchButton.y': 0 })}`);
  if (!html) return null;
  const re = /<a\b[^>]*href="(\/lrc\/maker\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let href = null;
  while ((m = re.exec(html))) {
    if (norm(textOf(m[2])).includes(norm(title))) { href = m[1]; break; }
  }
  if (!href) return null;
  const id = href.split('.').pop().replace(/\W/g, '');
  const page = await getText(`https://www.megalobiz.com${href}`);
  const start = page ? page.search(new RegExp(`<div\\b[^>]*id="lrc_${id}_details"`)) : -1;
  const el = start >= 0 ? elementAt(page, start, 'div') : null;
  const text = el && textOf(el.inner).trim();
  return isSynced(text) ? { synced: text } : null;
}

// Genius has no timings, but the widest coverage of Russian rap: a plain fallback.
async function genius({ title, artist }) {
  const found = await getJson(`https://genius.com/api/search/multi?${q({ q: query(artist, title), per_page: 5 })}`);
  const sections = (found && found.response && found.response.sections) || [];
  const hits = sections.filter((s) => s.type === 'song').flatMap((s) => s.hits || []);
  const hit = hits.map((h) => h.result).find((r) => r && r.url && fits({ title: r.title }, title));
  if (!hit) return null;
  const html = await getText(hit.url);
  if (!html) return null;
  const parts = [];
  const re = /<div\b[^>]*data-lyrics-container="true"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const el = elementAt(html, m.index, 'div');
    if (!el) break;
    parts.push(textOf(dropElements(el.inner, 'div', 'data-exclude-from-selection')).trim());
    re.lastIndex = el.end;
  }
  const text = parts.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text ? { plain: text } : null;
}

async function lyricsOvh({ title, artist }) {
  if (!artist) return null;
  const data = await getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
  const text = data && typeof data.lyrics === 'string' ? data.lyrics.replace(/\r\n/g, '\n').trim() : '';
  return text ? { plain: text } : null;
}

// Order breaks ties between answers of the same kind. The number is the best a
// source can give (2 word-synced, 1 line-synced, 0 plain): the search stops
// waiting for a source once something at least as good is found.
export const SOURCES = [
  ['Apple Music', paxsenix, 2],
  ['Lyrics+', lyricsPlus, 2],
  ['Musixmatch', musixmatch, 2],
  ['LRCLIB', lrclib, 1],
  ['NetEase', netease, 1],
  ['QQ Music', qqMusic, 1],
  ['Kugou', kugou, 1],
  ['Deezer', deezer, 1],
  ['LiriQo', liriqo, 2],
  ['Unison', unison, 2],
  ['Megalobiz', megalobiz, 1],
  ['Genius', genius, 0],
  ['lyrics.ovh', lyricsOvh, 0],
];

function rank(hit) {
  if (!hit) return -1;
  if (isSynced(hit.synced)) return isWordSynced(hit.synced) ? 2 : 1;
  return hit.plain && String(hit.plain).trim() ? 0 : -1;
}

// → { synced, plain, source } or null. All sources run in parallel; errors of
// one source never stop the others. The search ends once no source still
// running can beat the best answer so far. Where timers exist it also ends a
// moment after the first line-synced answer and at the deadline.
export function findLyrics(track, sources = SOURCES, { grace = GRACE_MS, deadline = DEADLINE_MS, timers = hasTimers() } = {}) {
  return new Promise((resolve) => {
    const hits = new Array(sources.length).fill(null);
    const settled = new Array(sources.length).fill(false);
    let done = false;
    let graceTimer = null;
    let deadlineTimer = null;
    const best = () => {
      let b = -1;
      hits.forEach((h, i) => { if (rank(h) > (b < 0 ? -1 : rank(hits[b]))) b = i; });
      return b;
    };
    const finish = () => {
      if (done) return;
      done = true;
      if (timers) {
        clearTimeout(graceTimer);
        clearTimeout(deadlineTimer);
      }
      const b = best();
      if (b < 0) return resolve(null);
      const h = hits[b];
      const name = sources[b][0];
      resolve(rank(h) > 0
        ? { synced: h.synced.slice(0, MAX_CHARS), plain: null, source: name }
        : { synced: null, plain: String(h.plain).slice(0, MAX_CHARS), source: name });
    };
    if (timers) deadlineTimer = setTimeout(finish, deadline);
    if (!sources.length) finish();
    sources.forEach(([name, find], i) => {
      Promise.resolve()
        .then(() => find(track))
        .catch((err) => { console.warn(`[lyrics] ${name}: ${err && err.message}`); return null; })
        .then((hit) => {
          hits[i] = hit || null;
          settled[i] = true;
          if (done) return;
          const b = best();
          const r = b < 0 ? -1 : rank(hits[b]);
          if (sources.every(([, , most = 2], j) => settled[j] || most <= r)) finish();
          else if (r === 1 && timers && !graceTimer) graceTimer = setTimeout(finish, grace);
        });
    });
  });
}
