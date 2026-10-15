// TEMPORARY diagnostic, run with `tgcloud run` only, never deployed: why no lyrics are found.
import { api, db, fetch } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from '../lib/config.js';
import { SOURCES, findLyrics } from '../lib/lyrics.js';

const short = (s, n = 160) => (s == null ? s : String(s).slice(0, n));

export default async function (input = {}) {
  if (input.mode === 'env') return env();
  if (input.mode === 'hang') return hang(input.url);
  if (input.mode === 'src') return src(input);
  if (input.mode === 'raw') {
    const s0 = Date.now();
    try {
      const r = await fetch(input.url, { method: input.method || 'GET', headers: { 'User-Agent': 'FINYA-HELPER (https://github.com/JEFFRIPPER/FINYA-HELPER-TG)', ...(input.headers || {}) } });
      const body = await r.text();
      console.log('RAW ' + r.status + ' ' + (Date.now() - s0) + 'ms ' + input.url.slice(0, 90));
      for (let i = 0; i < Math.min(body.length, 1600); i += 400) console.log('BODY ' + body.slice(i, i + 400).replace(/\s+/g, ' '));
      return { status: r.status };
    } catch (e) {
      console.log('RAW ERR ' + (e && e.message) + ' ' + input.url.slice(0, 90));
      return { err: true };
    }
  }
  if (input.mode === 'list') {
    const res = await api.getUserProfileAudios({ user_id: OWNER_USER_ID, limit: 100 });
    const list = ((res && res.audios) || []).map((a) => `${a.performer || ''} — ${a.title || a.file_name} (${a.duration})`);
    for (let i = 0; i < list.length; i += 10) console.log('LIST ' + list.slice(i, i + 10).join(' | '));
    return { n: list.length };
  }
  const out = {
    env: {
      setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout,
      AbortController: typeof AbortController, TextDecoder: typeof TextDecoder,
      atob: typeof atob, queueMicrotask: typeof queueMicrotask,
    },
  };
  const t0 = Date.now();
  try {
    const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent('KiloEmali Перспективы'));
    out.rawLrclib = { status: r.status, ms: Date.now() - t0, body: short(await r.text(), 300) };
  } catch (e) {
    out.rawLrclib = { err: String(e && (e.stack || e.message) || e), ms: Date.now() - t0 };
  }
  const res = await api.getUserProfileAudios({ user_id: OWNER_USER_ID, limit: 100 });
  const all = ((res && res.audios) || []).map((a) => ({ title: a.title || a.file_name, artist: a.performer || '', duration: a.duration || 0 }));
  out.count = all.length;
  const pick = all.filter((t) => /Перспективы|Run Run|Что ты знаешь/i.test(t.title)).slice(0, 3);
  out.tracks = [];
  for (const track of pick) {
    const per = await Promise.all(SOURCES.map(async ([name, find]) => {
      const s = Date.now();
      try {
        const h = await find(track);
        return { name, ms: Date.now() - s, kind: h ? (h.synced ? 'synced' : h.plain ? 'plain' : 'empty') : null, head: short(h && (h.synced || h.plain), 80) };
      } catch (e) {
        return { name, ms: Date.now() - s, err: short(e && (e.stack || e.message) || e, 300) };
      }
    }));
    out.tracks.push({ track, per });
  }
  out.find = [];
  for (const t of all.slice(0, 8)) {
    const s = Date.now();
    try {
      const f = await findLyrics(t);
      out.find.push({ t: t.artist + ' - ' + t.title, ms: Date.now() - s, source: f && f.source, kind: f ? (f.synced ? (/<\d/.test(f.synced) ? 'word' : 'line') : 'plain') : null });
    } catch (e) {
      out.find.push({ t: t.title, ms: Date.now() - s, err: short(e && (e.stack || e.message) || e, 300) });
    }
  }
  out.errors = await db.all(sql`SELECT at, source, text FROM error_log ORDER BY id DESC LIMIT 15`);
  out.cached = await db.all(sql`SELECT id, substr(body, 1, 140) AS body, fetched_at FROM music_lyrics ORDER BY fetched_at DESC LIMIT 8`);
  out.totalMs = Date.now() - t0;
  console.log('DIAG ' + JSON.stringify(out));
  return { ok: true };
}

async function env() {
  const g = Object.getOwnPropertyNames(globalThis).sort();
  const out = { globals: g.join(','), ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    waitAsync: typeof Atomics !== 'undefined' && typeof Atomics.waitAsync, sab: typeof SharedArrayBuffer,
    scheduler: typeof scheduler !== 'undefined' ? Object.keys(scheduler).join(',') : null };
  console.log('ENV ' + JSON.stringify(out));
  if (out.waitAsync === 'function' && out.sab === 'function') {
    const ia = new Int32Array(new SharedArrayBuffer(4));
    const s = Date.now();
    const r = Atomics.waitAsync(ia, 0, 0, 300);
    out.wait = { async: r.async, value: r.async ? await r.value : r.value, ms: Date.now() - s };
    console.log('WAIT ' + JSON.stringify(out.wait));
  }
  return out;
}

async function hang(url) {
  const s = Date.now();
  console.log('HANG start ' + url);
  try {
    const r = await fetch(url);
    return { url, status: r.status, ms: Date.now() - s };
  } catch (e) {
    return { url, err: short(e && e.message, 200), ms: Date.now() - s };
  }
}

async function src({ name, match }) {
  const res = await api.getUserProfileAudios({ user_id: OWNER_USER_ID, limit: 100 });
  const a = ((res && res.audios) || []).find((x) => new RegExp(match, 'i').test(x.title || x.file_name || ''));
  if (!a) return { name, match, err: 'no track' };
  const track = { title: a.title || a.file_name, artist: a.performer || '', duration: a.duration || 0 };
  const [, find] = SOURCES.find(([n]) => n === name);
  const s = Date.now();
  try {
    const h = await find(track);
    const kind = h ? (h.synced ? (/<\d/.test(h.synced) ? 'word' : 'line') : h.plain ? 'plain' : 'empty') : null;
    return { name, t: track.title, ms: Date.now() - s, kind };
  } catch (e) {
    return { name, t: track.title, ms: Date.now() - s, err: short(e && e.message, 160) };
  }
}
