// The slot contract: only platform_signal ends a slot; every other failure composes a fresh draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSlot } from '../src/loop.js';
import { ok, fail, signal } from '../src/envelope.js';
import { any, obj } from '../src/schema.js';
import { loadState } from '../src/state.js';
import { makeConfig } from './helpers.js';

/** Stations that do no real work, so the loop's own behaviour is what is under test. */
function fakeStations(overrides = {}) {
  const open = obj({}, { optional: [] });
  const base = {
    source: { input: open, execute: async (input) => ok({ subjectId: ['a', 'b', 'c'].find((s) => !(input.exclude || []).includes(s)) || 'z', query: 'q', sourceUrls: [], subject: { id: 'a' } }) },
    research: { input: open, execute: async () => ok({ sourceText: '', facts: [], citations: [] }) },
    write: { input: open, execute: async () => ok({ draft: { hook: 'a hook', narration: ['a hook'], beats: [], caption: 'c' } }) },
    illustrate: { input: open, execute: async () => ok({ video: '/tmp/x.mp4', stills: [], duration: 10, footage: [{ provider: 'local', id: 'x' }] }) },
    store: { input: open, execute: async () => ok({ entryId: 'e1', row: { slug: 'e1' } }) },
    publish: { input: open, execute: async () => ok({ postId: 'p1', url: 'https://example.org/p1', transport: 'dry' }) },
    distribute: { input: any(), execute: async () => ok({ legs: [] }) },
  };
  return { ...base, ...overrides };
}

test('a clean slot posts on the first attempt and updates the ledger', async () => {
  const { cfg } = makeConfig();
  const res = await runSlot(cfg, { stations: fakeStations(), dry: true });
  assert.equal(res.ok, true);
  assert.equal(res.data.attempts, 1);
  const st = loadState(cfg);
  assert.equal(st.dryPosted, 1);
  assert.deepEqual(st.recentHooks, ['a hook']);
  assert.ok(st.usedFootage['local-x']);
  for (const n of ['source', 'research', 'write', 'illustrate', 'store', 'publish', 'distribute']) assert.equal(st.lastEnvelopes[n].ok, true);
});

test('a refused draft composes again, and the next prompt carries the refusal', async () => {
  const { cfg } = makeConfig();
  const notes = [];
  let n = 0;
  const stations = fakeStations({
    write: { input: any(), execute: async (input) => {
      notes.push(input.retryNote || '');
      n++;
      return n < 3 ? fail('gate_refused', 'noise/seamlessly', { issues: [{ gate: 'noise', slug: 'seamlessly', detail: 'uses seamlessly' }] })
        : ok({ draft: { hook: 'third hook', narration: ['third hook'], beats: [], caption: 'c' } });
    } },
  });
  const res = await runSlot(cfg, { stations, dry: true });
  assert.equal(res.ok, true);
  assert.equal(res.data.attempts, 3);
  assert.equal(res.refusals.length, 2);
  assert.equal(notes[0], '');
  assert.match(notes[1], /REFUSED[\s\S]*seamlessly/);
});

test('a platform signal ends the slot at once and records a halt', async () => {
  const { cfg } = makeConfig();
  let publishes = 0;
  const stations = fakeStations({
    publish: { input: any(), execute: async () => { publishes++; return signal('spam_risk_too_many_posts', 'TikTok said too many posts', 'Check the account.'); } },
  });
  const res = await runSlot(cfg, { stations, dry: true });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'platform_signal');
  assert.equal(publishes, 1, 'no second attempt after a platform signal');
  const st = loadState(cfg);
  assert.equal(st.halt.signal, 'spam_risk_too_many_posts');
  assert.equal(st.halt.step, 'Check the account.');
});

test('a research failure excludes that subject and picks another', async () => {
  const { cfg } = makeConfig();
  const seen = [];
  const stations = fakeStations({
    research: { input: any(), execute: async (input) => { seen.push(input.subjectId); return input.subjectId === 'a' ? fail('research_failed', 'article too short') : ok({ sourceText: '', facts: [], citations: [] }); } },
  });
  const res = await runSlot(cfg, { stations, dry: true });
  assert.equal(res.ok, true);
  assert.deepEqual(seen, ['a', 'b']);
});

test('a distribute failure after the post never posts a second time', async () => {
  const { cfg } = makeConfig();
  let publishes = 0;
  const stations = fakeStations({
    publish: { input: any(), execute: async () => { publishes++; return ok({ postId: 'p1', url: null, transport: 'dry' }); } },
    distribute: { input: any(), execute: async () => fail('upstream_error', 'webhook down') },
  });
  const res = await runSlot(cfg, { stations, dry: true });
  assert.equal(res.ok, true);
  assert.equal(publishes, 1);
  assert.equal(res.data.distribute.code, 'upstream_error');
});

test('when every draft is refused the slot is still owed, not skipped', async () => {
  const { cfg } = makeConfig();
  const stations = fakeStations({ write: { input: any(), execute: async () => fail('gate_refused', 'lint/no-hook', { issues: [] }) } });
  const res = await runSlot(cfg, { stations, dry: true, maxAttempts: 3 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'slot_owed');
  assert.equal(res.refusals.length, 3);
  assert.equal(loadState(cfg).slots.at(-1).owed, true);
});

test('a station that throws is turned into an envelope, never an escape', async () => {
  const { cfg } = makeConfig();
  let n = 0;
  const stations = fakeStations({ illustrate: { input: any(), execute: async () => { if (n++ === 0) throw new Error('boom'); return ok({ video: '/tmp/x.mp4', stills: [], duration: 1, footage: [] }); } } });
  const res = await runSlot(cfg, { stations, dry: true });
  assert.equal(res.ok, true);
  assert.match(res.refusals[0], /server_error: boom/);
});
