// TEMPORARY diagnostic, run with `tgcloud run` only, never deployed: why no lyrics are found.
import { api, db, fetch } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from '../lib/config.js';
import { SOURCES, findLyrics } from '../lib/lyrics.js';

const short = (s, n = 160) => (s == null ? s : String(s).slice(0, n));

export default async function () {
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
  if (pick[0]) {
    const s = Date.now();
    try {
      const f = await findLyrics(pick[0]);
      out.find = { ms: Date.now() - s, source: f && f.source, head: short(f && (f.synced || f.plain), 80) };
    } catch (e) {
      out.find = { ms: Date.now() - s, err: short(e && (e.stack || e.message) || e, 300) };
    }
  }
  out.errors = await db.all(sql`SELECT at, source, text FROM error_log ORDER BY id DESC LIMIT 15`);
  out.cached = await db.all(sql`SELECT id, substr(body, 1, 140) AS body, fetched_at FROM music_lyrics ORDER BY fetched_at DESC LIMIT 8`);
  out.totalMs = Date.now() - t0;
  console.log('DIAG ' + JSON.stringify(out));
  return out;
}
