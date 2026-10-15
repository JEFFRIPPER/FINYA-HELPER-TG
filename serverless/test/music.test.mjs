import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, EndpointError, fetchMock } from 'sdk';
import musicEndpoint from '../tgcloud/endpoints/music.js';
import { OWNER_USER_ID } from '../tgcloud/lib/config.js';
import { CHUNK_BYTES } from '../tgcloud/lib/music.js';
import { findLyrics } from '../tgcloud/lib/lyrics.js';
import { base64ToBytes, utf8Encode, bytesToBase64 } from '../tgcloud/lib/util.js';
import { checkErrors, setup, user } from './helpers.mjs';

afterEach(async () => {
  fetchMock.reset();
  await checkErrors();
});

const call = (input, u = user(5)) => musicEndpoint(input, { initData: { user: u } });

const AUDIOS = [
  { file_id: 'FILE_A', file_unique_id: 'uniqA', title: 'апатия', performer: 'fallen777angel', duration: 138, file_size: CHUNK_BYTES + 10, mime_type: 'audio/mpeg', thumbnail: { file_id: 'THUMB_A' } },
  { file_id: 'FILE_B', file_unique_id: 'uniqB', file_name: 'demo.mp3', duration: 60, file_size: 100 },
];
const bytesA = new Uint8Array(CHUNK_BYTES + 10).map((_, i) => i % 251);

function musicApi(extra = {}) {
  return setup({
    getUserProfileAudios: (p) => {
      assert.equal(p.user_id, OWNER_USER_ID);
      return { total_count: AUDIOS.length, audios: AUDIOS };
    },
    getFileContent: (fileId) => {
      if (fileId === 'FILE_A') return bytesA;
      if (fileId === 'THUMB_A') return new Uint8Array([1, 2, 3]);
      throw new Error('unexpected file ' + fileId);
    },
    ...extra,
  });
}

test('music list: owner profile audios without file ids', async () => {
  const mock = await musicApi();
  const { tracks } = await call({ action: 'list' });
  assert.deepEqual(tracks, [
    { id: 'uniqA', title: 'апатия', performer: 'fallen777angel', duration: 138, cover: true },
    { id: 'uniqB', title: 'demo', performer: '', duration: 60, cover: false },
  ]);
  assert.ok(!JSON.stringify(tracks).includes('FILE_A'));
  await call({ action: 'list' });
  assert.equal(mock.called('getUserProfileAudios').length, 1, 'list is cached for a minute');
});

test('music chunks: the file is downloaded once and served in pieces', async () => {
  const mock = await musicApi();
  const first = await call({ action: 'chunk', id: 'uniqA', index: 0 });
  assert.equal(first.count, 2);
  assert.equal(first.size, bytesA.length);
  assert.equal(first.mime, 'audio/mpeg');
  const second = await call({ action: 'chunk', id: 'uniqA', index: 1 });
  const joined = new Uint8Array([...base64ToBytes(first.data), ...base64ToBytes(second.data)]);
  assert.deepEqual(joined, bytesA);
  assert.equal(mock.called('getFileContent').length, 1);

  await assert.rejects(call({ action: 'chunk', id: 'uniqA', index: 2 }), (e) => e instanceof EndpointError && e.parameters.code === 'BAD_REQUEST');
  await assert.rejects(call({ action: 'chunk', id: 'other1', index: 0 }), (e) => e instanceof EndpointError && e.parameters.code === 'NOT_FOUND');
  await assert.rejects(call({ action: 'chunk', id: '../x', index: 0 }), (e) => e.parameters.code === 'BAD_REQUEST');
});

test('music cover and caller check', async () => {
  await musicApi();
  const cover = await call({ action: 'cover', id: 'uniqA' });
  assert.equal(cover.data, bytesToBase64(new Uint8Array([1, 2, 3])));
  assert.deepEqual(await call({ action: 'cover', id: 'uniqB' }), { data: null });
  await assert.rejects(call({ action: 'list' }, null), (e) => e.parameters.code === 'FORBIDDEN');
});

test('music: a Bot API failure is logged and reported as unavailable', async () => {
  await musicApi({ getUserProfileAudios: () => { throw new Error('method not found'); } });
  await assert.rejects(call({ action: 'list' }), (e) => e.parameters.code === 'UNAVAILABLE');
  const rows = await db.all('SELECT source FROM error_log');
  assert.deepEqual(rows.map((r) => r.source), ['webapp.music']);
  await db.run('DELETE FROM error_log');
});

test('lyrics: first synced source wins, failures fall through, result is cached', async () => {
  await musicApi();
  const lrc = '[00:01.00] Я знаю, ты прослушаешь это сообщение\n[00:05.50] Особенно после всего того зла';
  fetchMock.handler = (url) => {
    if (url.startsWith('https://lrclib.net/api/get')) return { status: 404, json: {} };
    if (url.startsWith('https://lrclib.net/api/search')) return { json: [] };
    if (url.includes('music.163.com')) throw new Error('blocked');
    if (url.startsWith('https://lyrics.kugou.com/search')) return { json: { candidates: [{ id: '1', accesskey: 'k' }] } };
    if (url.startsWith('https://lyrics.kugou.com/download')) return { json: { content: bytesToBase64(utf8Encode(lrc)) } };
    throw new Error('unexpected ' + url);
  };
  const { lyrics } = await call({ action: 'lyrics', id: 'uniqA' });
  assert.deepEqual(lyrics, { synced: lrc, plain: null, source: 'Kugou' });
  const calls = fetchMock.calls.length;
  await call({ action: 'lyrics', id: 'uniqA' });
  assert.equal(fetchMock.calls.length, calls, 'served from cache');
});

test('lyrics: plain text is kept when nobody has timings', async () => {
  fetchMock.handler = (url) => {
    if (url.startsWith('https://lrclib.net/api/get')) return { json: { syncedLyrics: null, plainLyrics: 'просто текст' } };
    return { status: 404, json: {} };
  };
  const found = await findLyrics({ title: 'апатия', artist: 'fallen777angel', duration: 138 });
  assert.deepEqual(found, { synced: null, plain: 'просто текст', source: 'LRCLIB' });
  fetchMock.handler = () => ({ status: 404, json: {} });
  assert.equal(await findLyrics({ title: 'x', artist: '', duration: 1 }), null);
});
