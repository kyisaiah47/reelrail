import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig, validateConfig, resolveConfig } from '../src/config.js';
import { makeConfig } from './helpers.js';

const EXAMPLE = path.join(import.meta.dirname, '..', 'examples', 'whyyourbraindoesthat', 'publication.json');

test('the worked example config validates and carries every section 5.2 key', () => {
  const cfg = loadConfig(EXAMPLE);
  for (const k of ['slug', 'publication', 'laneId', 'registryId', 'host', 'voiceFile', 'format', 'source', 'research', 'gates', 'cadence', 'outputs']) {
    assert.ok(cfg[k] !== undefined, `missing ${k}`);
  }
  assert.equal(cfg.format.ttsVoice, 'en-US-AriaNeural');
  assert.deepEqual(cfg.frame, { w: 1080, h: 1920 });
  assert.equal(cfg.illustrate.crop, 'aspect:2:3', 'outputs.store.pictureCrop sets the crop hook');
  assert.equal(cfg.writer.provider, 'stub');
});

test('an invalid config lists every problem', () => {
  const errs = validateConfig({ slug: 'Bad Slug', format: { kind: 'square' } });
  assert.ok(errs.some((e) => e.startsWith('slug')));
  assert.ok(errs.some((e) => e.startsWith('format.kind')));
  assert.ok(errs.some((e) => e === 'outputs: required'));
});

test('activeHours must run forwards', () => {
  const { raw } = makeConfig();
  assert.throws(() => resolveConfig({ ...raw, cadence: { perDay: 1, activeHours: [22, 8] } }), /start must be before end/);
});

test('an explicit illustrate.crop wins over pictureCrop', () => {
  const { raw, file } = makeConfig();
  const cfg = resolveConfig({ ...raw, illustrate: { crop: 'four-crops' } }, { file });
  assert.equal(cfg.illustrate.crop, 'four-crops');
});
