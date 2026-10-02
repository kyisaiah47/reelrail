import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stripWikitext, fetchArticle, parseArticleUrl } from '../src/research/wikipedia.js';
import research from '../src/stations/research.js';
import source from '../src/stations/source.js';
import { makeConfig, fakeFetch, wikiRoutes, FIXTURES } from './helpers.js';

test('wikitext is reduced to prose: templates, refs, tables and media go, link text stays', () => {
  const t = stripWikitext(fs.readFileSync(path.join(FIXTURES, 'spotlight.wikitext'), 'utf8'));
  assert.ok(t.startsWith('The spotlight effect is the psychological phenomenon'));
  for (const gone of ['{{', '}}', '<ref', 'wikitable', 'File:', 'Infobox', 'Illusion of transparency']) assert.ok(!t.includes(gone), `still has ${gone}`);
  assert.ok(t.includes('egocentric bias'));
});

test('fetchArticle reads raw wikitext, follows one redirect and records the revision', async () => {
  const f = fakeFetch([
    [(u) => u.includes('title=Old_name') && u.includes('action=raw'), () => ({ body: '#REDIRECT [[Spotlight effect]]' })],
    ...wikiRoutes(),
  ]);
  const a = await fetchArticle('https://en.wikipedia.org/wiki/Old_name', { fetch: f });
  assert.equal(a.title, 'Spotlight effect');
  assert.equal(a.revisionId, 12345);
  assert.match(a.permalink, /oldid=12345/);
  assert.ok(a.facts.length >= 3);
  assert.match(f.calls[0].init.headers['user-agent'], /reelrail/);
});

test('a page too short to be an article is refused', async () => {
  const f = fakeFetch([[() => true, () => ({ body: 'stub' })]]);
  await assert.rejects(fetchArticle('https://en.wikipedia.org/wiki/X', { fetch: f }), /not an article/);
});

test('only Wikipedia article URLs are accepted', () => {
  assert.equal(parseArticleUrl('https://example.org/wiki/X'), null);
  assert.deepEqual(parseArticleUrl('https://en.wikipedia.org/wiki/L%27esprit_de_l%27escalier'), { lang: 'en', title: "L'esprit de l'escalier" });
});

test('research station: wikipedia-raw returns text, facts and citations', async () => {
  const { cfg } = makeConfig();
  const env = await research.execute({ subjectId: 'spotlight', query: 'q', sourceUrls: ['https://en.wikipedia.org/wiki/Spotlight_effect'] }, cfg, { fetch: fakeFetch(wikiRoutes()) });
  assert.equal(env.ok, true);
  assert.ok(env.data.sourceText.includes('spotlight effect'));
  assert.equal(env.data.citations[0].revisionId, 12345);
  assert.equal(env.data.citations[0].license, 'CC BY-SA 4.0');
});

test('research station: kind none passes the footage query through', async () => {
  const { cfg } = makeConfig({ research: { kind: 'none' } });
  const env = await research.execute({ subjectId: 's', query: 'rain on window', sourceUrls: [] }, cfg, {});
  assert.deepEqual(env.data, { sourceText: '', facts: [], citations: [], query: 'rain on window' });
});

test('source station: skips recent subjects and excluded ones, and says when none are left', async () => {
  const { cfg } = makeConfig();
  const a = await source.execute({ recentSubjects: ['spotlight'] }, cfg, { random: () => 0 });
  assert.equal(a.data.subjectId, 'earworm');
  const b = await source.execute({ exclude: ['earworm'] }, cfg, { random: () => 0 });
  assert.equal(b.data.subjectId, 'spotlight');
  const c = await source.execute({ exclude: ['earworm', 'spotlight'] }, cfg, {});
  assert.equal(c.code, 'source_unavailable');
});
