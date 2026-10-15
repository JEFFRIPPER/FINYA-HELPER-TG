import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, EndpointError, fetchMock } from 'sdk';
import musicEndpoint from '../tgcloud/endpoints/music.js';
import { OWNER_USER_ID } from '../tgcloud/lib/config.js';
import { sql } from 'sdk/db';
import { CHUNK_BYTES, handle } from '../tgcloud/lib/music.js';
import { findLyrics, ttmlToLrc } from '../tgcloud/lib/lyrics.js';
import { base64ToBytes, utf8Encode, bytesToBase64, nowInt } from '../tgcloud/lib/util.js';
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

test('lyrics: a synced source wins, failures of others do not matter, result is cached', async () => {
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

const TRACK = { title: 'апатия', artist: 'fallen777angel', duration: 138 };
const notFound = () => ({ status: 404, json: {} });

test('lyrics: word timings from Apple Music beat line timings', async () => {
  fetchMock.handler = (url) => {
    if (url.startsWith('https://itunes.apple.com/search')) {
      return { json: { results: [{ trackId: 77, trackName: 'Апатия', trackTimeMillis: 138500 }] } };
    }
    if (url.startsWith('https://lyrics.paxsenix.org/apple-music/lyrics?id=77')) {
      return { json: { type: 'Syllable', content: [
        { timestamp: 61000, endtime: 63000, text: [
          { text: 'Я', part: false, timestamp: 61000, endtime: 61300 },
          { text: 'зна', part: true, timestamp: 61300, endtime: 61600 },
          { text: 'ю', part: false, timestamp: 61600, endtime: 62000 },
        ] },
        { timestamp: 67000, endtime: 69000, text: [{ text: 'тишина', part: false, timestamp: 67000, endtime: 69000 }] },
      ] } };
    }
    if (url.startsWith('https://lrclib.net/api/get')) return { json: { syncedLyrics: '[01:01.00] Я знаю', plainLyrics: 'Я знаю' } };
    return notFound();
  };
  const found = await findLyrics(TRACK);
  assert.equal(found.source, 'Apple Music');
  assert.equal(found.synced, '[01:01.00]<01:01.00>Я <01:01.30>зна<01:01.60>ю<01:03.00>\n[01:03.00]\n[01:07.00]тишина');
});

test('lyrics: Lyrics+ mirrors, milliseconds and syllables without spaces', async () => {
  fetchMock.handler = (url) => {
    if (url.startsWith('https://lyricsplus.binimum.org')) throw new Error('down');
    if (url.startsWith('https://lyricsplus.atomix.one/v2/lyrics/get')) {
      assert.match(url, /title=%D0%B0%D0%BF%D0%B0%D1%82%D0%B8%D1%8F&artist=fallen777angel/);
      return { json: { type: 'Word', lyrics: [{ time: 15000, duration: 1500, text: 'Hello world', syllabus: [
        { time: 15000, duration: 500, text: 'Hello' },
        { time: 15500, duration: 1000, text: 'world' },
        { time: 15600, duration: 300, text: '(ooh)', isBackground: true },
      ] }] } };
    }
    return notFound();
  };
  const found = await findLyrics(TRACK);
  assert.deepEqual(found, { synced: '[00:15.00]<00:15.00>Hello <00:15.50>world<00:16.50>', plain: null, source: 'Lyrics+' });
});

test('lyrics: Musixmatch word sync from richsync', async () => {
  fetchMock.handler = (url) => {
    const ok = (body) => ({ json: { message: { header: { status_code: 200 }, body } } });
    if (url.includes('musixmatch.com/ws/1.1/token.get')) return ok({ user_token: 'tok' });
    if (url.includes('musixmatch.com/ws/1.1/track.search')) {
      assert.match(url, /usertoken=tok/);
      return ok({ track_list: [{ track: { track_id: 5, track_name: 'Апатия', track_length: 137, has_richsync: 1 } }] });
    }
    if (url.includes('musixmatch.com/ws/1.1/track.richsync.get')) {
      return ok({ richsync: { richsync_body: JSON.stringify([{ ts: 10, te: 12, x: 'Я знаю', l: [{ c: 'Я', o: 0 }, { c: ' ', o: 0.3 }, { c: 'знаю', o: 0.4 }] }]) } });
    }
    return notFound();
  };
  const found = await findLyrics(TRACK);
  assert.deepEqual(found, { synced: '[00:10.00]<00:10.00>Я <00:10.40>знаю<00:12.00>', plain: null, source: 'Musixmatch' });
});

test('lyrics: TTML with background vocals becomes enhanced LRC', () => {
  const ttml = '<tt><body><div><p begin="00:12.000" end="00:14.500"><span begin="00:12.000" end="00:12.600">Hey</span> '
    + '<span begin="00:12.600" end="00:14.500">you</span><span ttm:role="x-bg"><span begin="00:13.000" end="00:13.500">(bg)</span></span></p>'
    + '<p begin="1:05.5" end="1:07"><span>whole line &amp; more</span></p></div></body></tt>';
  assert.equal(ttmlToLrc(ttml), '[00:12.00]<00:12.00>Hey <00:12.60>you<00:14.50>\n[00:14.50]\n[01:05.50]whole line & more');
});

test('lyrics: Genius gives plain text when nobody has timings', async () => {
  fetchMock.handler = (url) => {
    if (url.startsWith('https://genius.com/api/search/multi')) {
      return { json: { response: { sections: [{ type: 'top_hit', hits: [] }, { type: 'song', hits: [
        { result: { title: 'Другая песня', url: 'https://genius.com/other-lyrics' } },
        { result: { title: 'Апатия', url: 'https://genius.com/apatiya-lyrics' } },
      ] }] } } };
    }
    if (url === 'https://genius.com/apatiya-lyrics') {
      return { text: '<html><div data-lyrics-container="true" class="x"><div data-exclude-from-selection="true">5 Contributors</div>'
        + '[Куплет 1]<br/>Я знаю, ты <a href="#"><span>прослушаешь</span></a><br>это &amp; то</div>'
        + '<div data-lyrics-container="true">конец</div></html>' };
    }
    return notFound();
  };
  assert.deepEqual(await findLyrics(TRACK), { synced: null, plain: '[Куплет 1]\nЯ знаю, ты прослушаешь\nэто & то\nконец', source: 'Genius' });
});

test('lyrics: sources run in parallel, a hung one never blocks the answer', async () => {
  const never = () => new Promise(() => {});
  const line = async () => ({ synced: '[00:01.00]a b' });
  const word = () => new Promise((r) => setTimeout(() => r({ synced: '[00:01.00]<00:01.00>a <00:01.50>b<00:02.00>' }), 30));
  const t0 = Date.now();
  let found = await findLyrics(TRACK, [['Never', never], ['Line', line]], { grace: 20, deadline: 5000 });
  assert.equal(found.source, 'Line');
  assert.ok(Date.now() - t0 < 1000, 'no waiting for the hung source');
  found = await findLyrics(TRACK, [['Never', never], ['Line', line], ['Word', word]], { grace: 500, deadline: 5000 });
  assert.equal(found.source, 'Word', 'a word-synced answer within the grace time wins');
  assert.equal(await findLyrics(TRACK, [['Never', never]], { grace: 20, deadline: 50 }), null);
});

test('lyrics: the isolate has no timers, the search still answers', async () => {
  fetchMock.handler = (url) => {
    if (url.startsWith('https://lrclib.net/api/get')) return { json: { syncedLyrics: '[00:01.00] Я знаю', plainLyrics: 'Я знаю' } };
    if (url.startsWith('https://api.lyrics.ovh/')) return new Promise(() => {}); // plain only: not worth waiting for
    return notFound();
  };
  const saved = [globalThis.setTimeout, globalThis.clearTimeout];
  globalThis.setTimeout = undefined;
  globalThis.clearTimeout = undefined;
  let found;
  try {
    found = await findLyrics(TRACK);
  } finally {
    [globalThis.setTimeout, globalThis.clearTimeout] = saved;
  }
  assert.deepEqual(found, { synced: '[00:01.00] Я знаю', plain: null, source: 'LRCLIB' });
});

test('lyrics without timers: waits only for sources that could do better', async () => {
  const never = () => new Promise(() => {});
  const line = async () => ({ synced: '[00:01.00]a b' });
  const word = () => new Promise((r) => setTimeout(() => r({ synced: '[00:01.00]<00:01.00>a <00:01.50>b<00:02.00>' }), 30));
  let found = await findLyrics(TRACK, [['Line', line, 1], ['Plain', never, 0], ['Same', never, 1]], { timers: false });
  assert.equal(found.source, 'Line', 'nothing pending can beat a line-synced answer');
  found = await findLyrics(TRACK, [['Line', line, 1], ['Word', word, 2], ['Plain', never, 0]], { timers: false });
  assert.equal(found.source, 'Word', 'a source that can sync words is waited for');
  assert.equal(await findLyrics(TRACK, [['Empty', async () => null, 2]], { timers: false }), null);
});

test('lyrics cache: empty answers of the old search are asked again, plain text waits a day', async () => {
  await musicApi();
  const ts = nowInt();
  await db.run(sql`INSERT INTO music_lyrics (id, body, fetched_at) VALUES ('uniqA', NULL, ${ts})`);
  fetchMock.handler = (url) => {
    if (url.startsWith('https://lrclib.net/api/get')) return { json: { syncedLyrics: null, plainLyrics: 'просто текст' } };
    return notFound();
  };
  const u = user(5);
  assert.deepEqual((await handle(u, { action: 'lyrics', id: 'uniqA' }, ts)).lyrics, { synced: null, plain: 'просто текст', source: 'LRCLIB' });
  const calls = fetchMock.calls.length;
  assert.equal((await handle(u, { action: 'lyrics', id: 'uniqA' }, ts + 3600)).lyrics.plain, 'просто текст');
  assert.equal(fetchMock.calls.length, calls, 'plain text is kept for a day');
  fetchMock.handler = (url) => (url.startsWith('https://lrclib.net/api/get') ? { json: { syncedLyrics: '[00:01.00] наконец', plainLyrics: null } } : notFound());
  assert.equal((await handle(u, { action: 'lyrics', id: 'uniqA' }, ts + 86400)).lyrics.synced, '[00:01.00] наконец');
});
