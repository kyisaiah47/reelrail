// Shared test fixtures. No test reaches the network or reads a paid model key: every HTTP call
// goes through a fake fetch built here, and the writer is the stub.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveConfig } from '../src/config.js';

export const FIXTURES = path.join(import.meta.dirname, 'fixtures');

export function tmpdir(prefix = 'reelrail-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A complete config in a temp directory, with a voice file and a two-subject pool. */
export function makeConfig(overrides = {}) {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'voice.md'), '# Voice\nSecond person, present tense. Short spoken sentences.\n');
  fs.writeFileSync(path.join(dir, 'subjects.json'), JSON.stringify({ subjects: [
    { id: 'spotlight', term: 'spotlight effect', article: 'https://en.wikipedia.org/wiki/Spotlight_effect', angle: 'You walk into a room sure that everyone noticed.', query: 'soft light curtains' },
    { id: 'earworm', term: 'earworm', article: 'https://en.wikipedia.org/wiki/Earworm', angle: 'A song has been playing in your head all morning.', query: 'rain on window' },
  ] }));
  fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify({ retiredTerms: [{ term: 'anticipatory rehearsal', why: 'not a term' }], claims: [], bannedPhrases: ['studies show'] }));
  const raw = {
    slug: 'testpub',
    publication: 'testpub',
    laneId: 'test-lane',
    registryId: 'test-registry',
    host: 'example.org',
    voiceFile: 'voice.md',
    format: { kind: 'vertical-narrated', frame: '360x640', schema: 'clip-v1', ttsVoice: 'en-US-AriaNeural' },
    source: { kind: 'subject-pool', pool: 'subjects.json#subjects' },
    research: { kind: 'wikipedia-raw' },
    gates: ['noise', 'prose', 'lint', 'claims:facts.json'],
    cadence: { perDay: 1, activeHours: [8, 22] },
    outputs: {
      primary: { platform: 'tiktok', handle: '@testpub' },
      store: { kind: 'json', path: 'out/store.json', pictureCrop: '2:3' },
      secondary: ['pinterest'],
    },
    writer: { provider: 'stub' },
    ...overrides,
  };
  const file = path.join(dir, 'publication.json');
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  return { dir, file, raw, cfg: resolveConfig(raw, { file }) };
}

/** A fake fetch. `routes` is [[test(url, init) => bool, (url, init) => response]]. Unmatched calls throw. */
export function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [test, respond] of routes) {
      if (test(String(url), init)) {
        const r = await respond(String(url), init);
        return response(r);
      }
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  f.calls = calls;
  return f;
}

export function response({ status = 200, body = '', json, headers = {} } = {}) {
  const text = json !== undefined ? JSON.stringify(json) : typeof body === 'string' ? body : '';
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(text);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => buf.toString('utf8'),
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

/** Wikipedia served from the fixtures: raw wikitext for any article, a revision id for the API. */
export const wikiRoutes = () => [
  [(u) => u.includes('wikipedia.org/w/index.php') && u.includes('action=raw'), (u) => ({
    body: fs.readFileSync(path.join(FIXTURES, u.includes('Earworm') ? 'earworm.wikitext' : 'spotlight.wikitext'), 'utf8'),
  })],
  [(u) => u.includes('wikipedia.org/w/api.php'), () => ({ json: { query: { pages: [{ revisions: [{ revid: 12345 }] }] } } })],
];

let mediaReady = null;
/** True when ffmpeg, ffprobe and Pillow are installed, so the render tests can run. */
export function canRender() {
  if (mediaReady !== null) return mediaReady;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
    mediaReady = true;
  } catch {
    mediaReady = false;
  }
  return mediaReady;
}

/** A short generated background clip at the given size. */
export function makeClip(file, { w = 360, h = 640, seconds = 12 } = {}) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:d=${seconds}:r=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', file]);
  return file;
}
