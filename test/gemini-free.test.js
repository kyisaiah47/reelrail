// The one live model test, on the free Gemini tier only. It runs when GEMINI_API_KEY is set and
// is skipped otherwise, so CI and a fresh clone run every other test with no key at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import write from '../src/stations/write.js';
import { stripWikitext, factsFrom } from '../src/research/wikipedia.js';
import { makeConfig, FIXTURES } from './helpers.js';

const hasKey = Boolean(process.env.GEMINI_API_KEY);

test('gemini writes a draft through the write station and the gates judge it', { skip: !hasKey && 'GEMINI_API_KEY not set' }, async () => {
  const { cfg } = makeConfig({ writer: { provider: 'gemini', model: process.env.REELRAIL_GEMINI_MODEL || 'gemini-2.5-flash', temperature: 0.4 } });
  const sourceText = stripWikitext(fs.readFileSync(path.join(FIXTURES, 'spotlight.wikitext'), 'utf8'));
  const env = await write.execute({
    subject: { id: 'spotlight', term: 'spotlight effect', angle: 'You walk into a room sure that everyone noticed.', query: 'soft light curtains' },
    query: 'soft light curtains', sourceText, facts: factsFrom(sourceText), citations: [{ url: 'https://en.wikipedia.org/wiki/Spotlight_effect' }],
  }, cfg, { env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY } });
  if (env.ok) {
    assert.ok(env.data.draft.narration.length >= 3);
    assert.equal(env.meta.provider, 'gemini');
  } else {
    // A gate refusal is the engine working: the loop would compose again with this note.
    assert.equal(env.code, 'gate_refused', `${env.code}: ${env.message}`);
    assert.ok(env.meta.issues.length >= 1);
  }
});
