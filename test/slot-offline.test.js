// One whole slot, offline: fixture Wikipedia, the stub writer, local footage, tone narration, the
// real render and read-back, a JSON store and the dry transport. Skipped when ffmpeg or Pillow is
// missing. The examples' own proof (README) runs the same slot with real footage and edge-tts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runSlot, runStation } from '../src/loop.js';
import { resolveConfig } from '../src/config.js';
import { loadState } from '../src/state.js';
import { statusOf } from '../src/status.js';
import { canRender, makeClip, makeConfig, fakeFetch, wikiRoutes } from './helpers.js';

test('a full dry slot runs every station and stores the entry at post time', { skip: !canRender() && 'ffmpeg or Pillow missing' }, async () => {
  const { dir, raw, file } = makeConfig();
  fs.mkdirSync(path.join(dir, 'clips'));
  makeClip(path.join(dir, 'clips', 'one.mp4'), { seconds: 30 });
  const cfg = resolveConfig({ ...raw, illustrate: { footage: { providers: [], localDir: 'clips' }, tts: { kind: 'tone' }, preset: 'ultrafast', captions: { size: 28 } } }, { file });
  const res = await runSlot(cfg, { dry: true, fetch: fakeFetch(wikiRoutes()) });
  assert.equal(res.ok, true, JSON.stringify(res.refusals));
  for (const [name, env] of Object.entries(res.envelopes)) assert.equal(env.ok, true, `${name} failed`);
  assert.ok(fs.existsSync(res.data.video));
  const store = JSON.parse(fs.readFileSync(path.join(cfg.stateDir, 'dry', 'testpub.store.json'), 'utf8'));
  const row = store.entries[0];
  assert.equal(row.published, true);
  assert.equal(row.platform, 'tiktok:dry');
  assert.equal(row.sources[0].revisionId, 12345);
  assert.ok(row.meta.evidence.length >= 1);
  assert.ok(row.meta.verify.duration > 5);
  const receipt = JSON.parse(fs.readFileSync(res.data.receipt, 'utf8'));
  assert.ok(!/https?:\/\//.test(receipt.caption), 'the engine added no link');
  assert.equal(loadState(cfg).dryPosted, 1);
  const s = await statusOf(cfg);
  assert.equal(s.dryStored, 1);
  assert.equal(s.stations.publish.ok, true);

  const one = await runStation(cfg, 'write', {});
  assert.equal(one.ok, true, 'a single station runs from the last slot\'s data');
  assert.equal(loadState(cfg).dryPosted, 1, 'a single station leaves the ledger alone');
});
