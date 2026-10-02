import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runGates, retryNote } from '../src/gates/index.js';
import { noiseIssues } from '../src/gates/copy.js';
import { linkIssues } from '../src/gates/firewall.js';
import { lintDraft } from '../src/gates/lint.js';
import { sourceIssues } from '../src/research/source-check.js';
import { stripWikitext, factsFrom } from '../src/research/wikipedia.js';
import { stubWriter } from '../src/providers/stub.js';
import { makeConfig, FIXTURES } from './helpers.js';

const sourceText = stripWikitext(fs.readFileSync(path.join(FIXTURES, 'spotlight.wikitext'), 'utf8'));
const research = { sourceText, facts: factsFrom(sourceText), citations: [{ url: 'https://en.wikipedia.org/wiki/Spotlight_effect' }] };

const good = () => ({
  format: 'naming',
  term: 'spotlight effect',
  hook: 'Everyone noticed. Or did they?',
  beats: ['It has a name', 'Spotlight effect', 'You can notice it'],
  narration: [
    'You walk into a room and feel every eye on you.',
    'There is a name for this. It is called the spotlight effect.',
    'People tend to believe they are being noticed more than they really are.',
    'Next time, look around. Most people are thinking about themselves.',
  ],
  midcard: { title: 'Spotlight effect', points: ['You feel watched', 'Others notice less', 'It fades with attention'] },
  caption: 'There is a name for this. #psychology #brain',
  evidence: [{ claim: 'People tend to believe they are being noticed more than they really are.', quote: 'people tend to believe they are being noticed more than they really are' }],
});

test('a clean, sourced draft passes every gate', () => {
  const { cfg } = makeConfig();
  assert.deepEqual(runGates(good(), { cfg, research }), []);
});

test('the stub writer produces a draft that passes every gate', () => {
  const { cfg } = makeConfig();
  const draft = JSON.parse(stubWriter({ context: { subject: { term: 'spotlight effect', angle: 'You walk into a room sure that everyone noticed.' }, research } }));
  assert.deepEqual(runGates(draft, { cfg, research }), []);
  assert.equal(draft.narration.length, draft.beats.length + 1);
});

test('noise: filler words in copy are refused', () => {
  const hits = noiseIssues('This seamlessly helps you unlock your potential.', { scope: 'copy' });
  assert.ok(hits.length >= 1);
  const { cfg } = makeConfig();
  const d = { ...good(), caption: 'Seamlessly understand your brain. #psychology' };
  assert.ok(runGates(d, { cfg, research }).some((i) => i.gate === 'noise'));
});

test('the persona firewall refuses links, domains and handles in any field', () => {
  assert.equal(linkIssues({ caption: 'more at https://example.org/x' })[0].slug, 'url');
  assert.equal(linkIssues({ caption: 'visit example.com today' })[0].slug, 'domain');
  assert.equal(linkIssues({ narration: ['follow @someone for more'] })[0].slug, 'mention');
  assert.equal(linkIssues({ midcard: { title: 'see www.example.org', points: [] } })[0].slug, 'www');
  assert.deepEqual(linkIssues({ caption: 'no links here #psychology' }), []);
  assert.deepEqual(linkIssues({ caption: 'read example.com/a' }, { allow: ['example.com/a'] }), []);
});

test('lint: narration must map 1:1 onto cards, and a list promise needs beats', () => {
  const d = good();
  d.narration = d.narration.slice(0, 2);
  assert.ok(lintDraft(d).some((i) => i.slug === 'narration-mismatch'));
  const e = { ...good(), hook: '5 things your brain does', beats: ['one'], narration: ['a', 'b'] };
  assert.ok(lintDraft(e).some((i) => i.slug === 'list-promise'));
  const f = { ...good(), midcard: { title: 'follow #brain', points: ['a', 'b', 'c'] } };
  assert.ok(lintDraft(f).some((i) => i.slug === 'midcard-has-tags'));
});

test('claims: a retired term or banned phrase is refused', () => {
  const { cfg } = makeConfig();
  const d = good();
  d.narration[2] = 'Studies show it is called anticipatory rehearsal.';
  const issues = runGates(d, { cfg, research });
  assert.ok(issues.some((i) => i.slug === 'retired-term'));
  assert.ok(issues.some((i) => i.slug === 'banned-phrase'));
});

test('source check: a quote, year, percentage or term not in the source is refused', () => {
  const d = good();
  d.evidence = [{ claim: 'x', quote: 'people are noticed by exactly nobody at all ever' }];
  d.midcard = { title: 'Found in 1987', points: ['about 80% of people', 'b', 'c'] };
  d.term = 'limelight bias';
  const slugs = sourceIssues(d, research).map((i) => i.slug);
  assert.ok(slugs.includes('quote-not-in-source'));
  assert.ok(slugs.includes('year-not-in-source'));
  assert.ok(slugs.includes('percent-not-in-source'));
  assert.ok(slugs.includes('term-not-in-source'));
});

test('source check: years and percentages that are in the source pass', () => {
  const d = good();
  d.midcard = { title: 'First studied in 2000', points: ['Close to 25% noticed', 'b', 'c'] };
  assert.deepEqual(sourceIssues(d, research), []);
});

test('source check: supplying a name requires a term', () => {
  const d = good();
  d.term = null;
  assert.ok(sourceIssues(d, research).some((i) => i.slug === 'name-without-term'));
});

test('the repeat gate refuses a recent hook', () => {
  const { cfg } = makeConfig();
  const issues = runGates(good(), { cfg, research, recentHooks: ['Everyone noticed. Or did they?'] });
  assert.ok(issues.some((i) => i.gate === 'repeat'));
});

test('the retry note names each refusal', () => {
  const note = retryNote([{ gate: 'links', slug: 'url', detail: 'caption carries a link' }]);
  assert.match(note, /REFUSED[\s\S]*links\/url[\s\S]*caption carries a link/);
});
