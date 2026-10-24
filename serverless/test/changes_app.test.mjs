// «Все обновления» в Mini App: вся история Фини, новые сверху.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import changesEndpoint from '../tgcloud/endpoints/changes.js';
import { CHANGES, HISTORY } from '../tgcloud/lib/changelog.js';

test('changes endpoint: every update from the very first, newest first, ids unique', async () => {
  const { entries } = await changesEndpoint({}, { initData: { user: { id: 2 } } });
  assert.equal(entries.length, CHANGES.length + HISTORY.length);
  assert.equal(entries[0].id, CHANGES[0].id);
  assert.equal(entries.at(-1).id, 'v2');
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
  for (const e of entries) {
    assert.ok(e.date && e.title && e.items.length, e.id);
    for (const item of e.items) assert.equal(typeof item, 'string');
  }
});

test('the Mini App shows «Все обновления» to everyone in the squad tab', () => {
  const app = readFileSync(new URL('../webapp/app.js', import.meta.url), 'utf8');
  assert.match(app, /return \[quickRow\(sq\), newsCard\(sq\), changesCard\(\)/);
  assert.match(app, /api\('changes', \{\}\)/);
});
