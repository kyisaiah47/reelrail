import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { jsonStore, sqliteStore, supabaseStore } from '../src/store/index.js';
import { buildRow } from '../src/stations/store.js';
import { makeConfig, tmpdir, fakeFetch } from './helpers.js';

const row = (slug, ts) => ({
  publication: 'p', slug, n: 1, hook: 'h', narration: ['a'], beats: [], caption: 'c', published: false,
  date: '2026-10-02', ts, taxon: 'naming', still: null, wide: null, gallery: [], clip_id: 'x', permalink: null,
  platform: null, updated_at: 'now', sources: [{ url: 'https://en.wikipedia.org/wiki/X' }], meta: { term: 't' },
});

for (const [name, open] of [['json', (d) => jsonStore(path.join(d, 's.json'))], ['sqlite', (d) => sqliteStore(path.join(d, 's.sqlite'))]]) {
  test(`${name} store: put, patch, list newest first, count`, async () => {
    const s = await open(tmpdir());
    await s.put(row('a', 1));
    await s.put(row('b', 2));
    await s.put({ ...row('a', 1), hook: 'h2' });
    assert.equal(await s.count('p'), 2);
    const e = await s.patch('p', 'a', { published: true, permalink: 'https://example.org/v/1', platform: 'tiktok' });
    assert.equal(e.published, true);
    const list = await s.list('p');
    assert.deepEqual(list.map((x) => x.slug), ['b', 'a']);
    assert.equal(list[1].hook, 'h2');
    assert.deepEqual(list[1].sources, [{ url: 'https://en.wikipedia.org/wiki/X' }]);
    assert.equal(await s.count('other'), 0);
  });
}

test('supabase store: upsert on publication and slug, with the key on every call', async () => {
  const f = fakeFetch([
    [(u, i) => i.method === 'POST' && u.includes('/rest/v1/publication_posts?on_conflict=publication,slug'), (u, i) => ({ json: [JSON.parse(i.body)] })],
    [(u, i) => i.method === 'HEAD', () => ({ headers: { 'content-range': '0-0/7' } })],
    [(u, i) => i.method === 'PATCH', () => ({ json: [{ slug: 'a', published: true }] })],
  ]);
  const s = supabaseStore({ url: 'http://db.local', key: 'placeholder', fetch: f });
  await s.put(row('a', 1));
  assert.equal(await s.count('p'), 7);
  await s.patch('p', 'a', { published: true });
  for (const c of f.calls) assert.equal(c.init.headers.apikey, 'placeholder');
  assert.match(f.calls[0].init.headers.prefer, /merge-duplicates/);
  assert.match(f.calls[2].url, /publication=eq\.p&slug=eq\.a/);
});

test('the stored row carries the script, its sources, the evidence and the read-back', () => {
  const { cfg } = makeConfig();
  const r = buildRow({
    draft: { hook: 'A hook here', narration: ['a', 'b'], beats: ['b'], caption: 'c', format: 'naming', term: 't', evidence: [{ claim: 'a', quote: 'q' }], midcard: { title: 'm', points: [] } },
    video: '/v.mp4', stills: [{ file: '/s.jpg', aspect: '2:3' }], duration: 20, slotId: 'testpub-123456',
    verify: { measured: { duration: 20 } }, footage: [{ provider: 'pexels', id: '1', file: '/f.mp4', credit: 'x' }], citations: [{ url: 'u' }],
  }, cfg, 3);
  assert.equal(r.publication, 'testpub');
  assert.equal(r.slug, 'a-hook-here-123456');
  assert.equal(r.n, 3);
  assert.equal(r.published, false);
  assert.equal(r.still, '/s.jpg');
  assert.deepEqual(r.sources, [{ url: 'u' }]);
  assert.equal(r.meta.footage[0].file, undefined, 'local footage paths stay out of the row');
});
