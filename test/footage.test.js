import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fetchFootage } from '../src/footage/index.js';
import { fakeFetch, tmpdir } from './helpers.js';

const frame = { w: 1080, h: 1920 };
const pexelsPage = { videos: [
  { id: 1, duration: 12, url: 'https://www.pexels.com/video/1/', user: { name: 'A' }, video_files: [
    { file_type: 'video/mp4', width: 1920, height: 1080, link: 'http://cdn.local/1-landscape.mp4' },
    { file_type: 'video/mp4', width: 1080, height: 1920, link: 'http://cdn.local/1-portrait.mp4' },
  ] },
  { id: 2, duration: 9, url: 'https://www.pexels.com/video/2/', user: { name: 'B' }, video_files: [
    { file_type: 'video/mp4', width: 720, height: 1280, link: 'http://cdn.local/2.mp4' },
  ] },
] };

test('pexels: portrait files only, downloaded once, used clips skipped, credits kept', async () => {
  const f = fakeFetch([
    [(u) => u.startsWith('https://api.pexels.com/videos/search') && u.includes('page=1'), () => ({ json: pexelsPage })],
    [(u) => u.startsWith('https://api.pexels.com/videos/search'), () => ({ json: { videos: [] } })],
    [(u) => u.startsWith('http://cdn.local/'), (u) => ({ body: `bytes of ${u}` })],
  ]);
  const out = tmpdir();
  const clips = await fetchFootage({ query: 'rain on window', count: 2, frame, cfgFootage: { providers: ['pexels'] }, used: { 'pexels-1': {} }, outDir: out, fetch: f, env: { PEXELS_API_KEY: 'placeholder' } });
  assert.equal(clips.length, 1, 'clip 1 was already used');
  assert.equal(clips[0].id, '2');
  assert.equal(clips[0].credit, 'B');
  assert.equal(fs.readFileSync(clips[0].file, 'utf8'), 'bytes of http://cdn.local/2.mp4');
  assert.equal(f.calls[0].init.headers.authorization, 'placeholder');
});

test('with no key, the local folder is the fallback', async () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'clips'));
  fs.writeFileSync(path.join(dir, 'clips', 'sample.mp4'), 'x');
  const clips = await fetchFootage({ query: 'q', count: 2, frame, cfgFootage: { providers: ['pexels'], localDir: 'clips' }, outDir: tmpdir(), fetch: fakeFetch([]), env: {}, baseDir: dir });
  assert.equal(clips[0].provider, 'local');
});

test('no key and no folder is a clear refusal', async () => {
  await assert.rejects(fetchFootage({ query: 'q', frame, cfgFootage: { providers: ['pexels'] }, outDir: tmpdir(), fetch: fakeFetch([]), env: {} }), /no PEXELS_API_KEY/);
});
