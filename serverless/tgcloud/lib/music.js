// The owner's Telegram profile music («Музыка в профиле») for the Mini App
// player. Endpoints return JSON only, so a track travels as base64 chunks;
// the whole file is fetched from Telegram once and kept in music_chunks.
// Only tracks currently in the owner's profile can be fetched.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { OWNER_USER_ID } from './config.js';
import { findLyrics } from './lyrics.js';
import { getSetting, setSetting } from './store.js';
import { bytesToBase64, nowInt } from './util.js';

export const CHUNK_BYTES = 512 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // Bot API getFile cap
const CACHE_LIMIT_BYTES = 120 * 1024 * 1024;
const LIST_TTL = 60;
const LYRICS_RETRY = 86400;
const LIST_KEY = 'music_list';

export class MusicError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function track(a) {
  const name = (a.file_name || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  return {
    id: a.file_unique_id,
    fileId: a.file_id,
    title: a.title || name || 'Без названия',
    performer: a.performer || '',
    duration: a.duration || 0,
    size: a.file_size || 0,
    mime: a.mime_type || 'audio/mpeg',
    coverId: a.thumbnail ? a.thumbnail.file_id : null,
  };
}

// The owner's profile audios, cached for a minute. Internal: keeps file_ids.
async function tracks(ts) {
  const cached = await getSetting(LIST_KEY);
  if (cached && ts - cached.at < LIST_TTL) return cached.tracks;
  const res = await api.getUserProfileAudios({ user_id: OWNER_USER_ID, limit: 100 });
  const list = ((res && res.audios) || []).map(track);
  await setSetting(LIST_KEY, { at: ts, tracks: list });
  return list;
}

async function find(id, ts) {
  const t = (await tracks(ts)).find((x) => x.id === id);
  if (!t) throw new MusicError('Этого трека больше нет в профиле.', 'NOT_FOUND');
  return t;
}

async function evict(keep) {
  const rows = await db.all(sql`SELECT id, size FROM music_cache ORDER BY used_at DESC`);
  let total = 0;
  for (const r of rows) {
    total += r.size;
    if (total > CACHE_LIMIT_BYTES && r.id !== keep) {
      await db.run(sql`DELETE FROM music_chunks WHERE id = ${r.id}`);
      await db.run(sql`DELETE FROM music_cache WHERE id = ${r.id}`);
    }
  }
}

async function cached(t, ts) {
  const row = await db.get(sql`SELECT size, mime, chunks FROM music_cache WHERE id = ${t.id}`);
  if (row) {
    await db.run(sql`UPDATE music_cache SET used_at = ${ts} WHERE id = ${t.id}`);
    return row;
  }
  if (t.size > MAX_FILE_BYTES) throw new MusicError('Трек больше 20 МБ, Telegram не отдаёт такие боту.', 'TOO_BIG');
  const bytes = await api.getFileContent(t.fileId);
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  await db.run(sql`DELETE FROM music_chunks WHERE id = ${t.id}`);
  for (let i = 0; i < count; i++) {
    const data = bytesToBase64(bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
    await db.run(sql`INSERT INTO music_chunks (id, idx, data) VALUES (${t.id}, ${i}, ${data})`);
  }
  // Written last, so a half-written track is never served.
  await db.run(sql`INSERT INTO music_cache (id, size, mime, chunks, used_at)
    VALUES (${t.id}, ${bytes.length}, ${t.mime}, ${count}, ${ts})
    ON CONFLICT(id) DO UPDATE SET size = excluded.size, mime = excluded.mime, chunks = excluded.chunks, used_at = excluded.used_at`);
  await evict(t.id);
  return { size: bytes.length, mime: t.mime, chunks: count };
}

async function lyrics(t, ts) {
  const row = await db.get(sql`SELECT body, fetched_at FROM music_lyrics WHERE id = ${t.id}`);
  if (row && (row.body || ts - row.fetched_at < LYRICS_RETRY)) return row.body ? JSON.parse(row.body) : null;
  const found = await findLyrics({ title: t.title, artist: t.performer, duration: t.duration });
  const body = found ? JSON.stringify(found) : null;
  await db.run(sql`INSERT INTO music_lyrics (id, body, fetched_at) VALUES (${t.id}, ${body}, ${ts})
    ON CONFLICT(id) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`);
  return found;
}

const idOf = (input) => {
  const id = input && typeof input.id === 'string' ? input.id : '';
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new MusicError('Не тот трек.', 'BAD_REQUEST');
  return id;
};

// POST /api/music — open to every member: the player is part of the owner's profile.
export async function handle(user, input = {}, ts = nowInt()) {
  if (!user || !user.id) throw new MusicError('Открой профиль в Telegram.', 'FORBIDDEN');
  const action = input.action;
  if (action === 'list') {
    const list = await tracks(ts);
    return {
      tracks: list.map((t) => ({ id: t.id, title: t.title, performer: t.performer, duration: t.duration, cover: !!t.coverId })),
    };
  }
  if (action === 'chunk') {
    const t = await find(idOf(input), ts);
    const index = Number.isInteger(input.index) ? input.index : -1;
    const meta = await cached(t, ts);
    if (index < 0 || index >= meta.chunks) throw new MusicError('Нет такого куска трека.', 'BAD_REQUEST');
    const row = await db.get(sql`SELECT data FROM music_chunks WHERE id = ${t.id} AND idx = ${index}`);
    if (!row) {
      await db.run(sql`DELETE FROM music_cache WHERE id = ${t.id}`);
      throw new MusicError('Трек не докачался, попробуй ещё раз.', 'CONFLICT');
    }
    return { index, count: meta.chunks, size: meta.size, mime: meta.mime, data: row.data };
  }
  if (action === 'cover') {
    const t = await find(idOf(input), ts);
    if (!t.coverId) return { data: null };
    const key = `cover:${t.id}`;
    const row = await db.get(sql`SELECT data FROM music_chunks WHERE id = ${key} AND idx = 0`);
    if (row) return { mime: 'image/jpeg', data: row.data };
    const data = bytesToBase64(await api.getFileContent(t.coverId));
    await db.run(sql`INSERT INTO music_chunks (id, idx, data) VALUES (${key}, 0, ${data}) ON CONFLICT(id, idx) DO NOTHING`);
    return { mime: 'image/jpeg', data };
  }
  if (action === 'lyrics') {
    const t = await find(idOf(input), ts);
    return { lyrics: await lyrics(t, ts) };
  }
  throw new MusicError('Неизвестное действие.', 'BAD_REQUEST');
}
