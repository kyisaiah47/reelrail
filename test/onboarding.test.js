// The first-run path: doctor, init, and the up-front footage check. No network, no model key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runChecks, formatChecks } from '../src/doctor.js';
import { initExample } from '../src/init.js';
import { tmpdir } from './helpers.js';

const CLI = path.join(import.meta.dirname, '..', 'src', 'cli.js');
const cli = (args, { cwd, env = {} } = {}) => spawnSync(process.execPath, [CLI, ...args], {
  cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
});

test('doctor names every missing binary and prints a fix for each platform', () => {
  const r = cli(['doctor'], { env: { REELRAIL_FFMPEG: '/nonexistent/ffmpeg', REELRAIL_FFPROBE: '/nonexistent/ffprobe', REELRAIL_PYTHON: '/nonexistent/python3' } });
  assert.equal(r.status, 1);
  for (const name of ['ffmpeg', 'ffprobe', 'Python 3.9 or later', 'Pillow (Python)', 'edge-tts (Python)']) assert.match(r.stdout, new RegExp(`MISSING ${name.replace(/[()]/g, '\\$&')}:`));
  assert.match(r.stdout, /5 required check\(s\) failed/);
  const checks = [{ name: 'ffmpeg', ok: false, required: true, detail: 'x', fix: { macos: 'brew install ffmpeg', linux: 'sudo apt install ffmpeg', windows: 'winget install Gyan.FFmpeg' } }];
  assert.match(formatChecks(checks, 'darwin').text, /fix: brew install ffmpeg/);
  assert.match(formatChecks(checks, 'linux').text, /fix: sudo apt install ffmpeg/);
  assert.match(formatChecks(checks, 'win32').text, /fix: winget install Gyan\.FFmpeg/);
});

test('optional keys never fail doctor', () => {
  const checks = runChecks({}).filter((c) => !c.required);
  assert.equal(checks.length, 2);
  assert.ok(checks.every((c) => c.ok === false));
  assert.equal(formatChecks(checks).missing, 0);
});

test('init copies the worked example into a new folder and refuses a non-empty one', () => {
  const dir = path.join(tmpdir(), 'reel');
  const res = initExample(dir, { media: false });
  for (const f of ['publication.json', 'subjects.json', 'facts.json', 'voice.md']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(res.media, null);
  assert.throws(() => initExample(dir, { media: false }), /already exists and is not empty/);
});

test('a slot with no footage key and no local clips stops before the first draft', () => {
  const dir = path.join(tmpdir(), 'reel');
  initExample(dir, { media: false });
  const r = cli(['run', dir, '--slot', '--dry'], { cwd: path.dirname(dir) });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /has no footage source/);
  assert.match(r.stderr, /reelrail init my-first-reel/);
  assert.doesNotMatch(r.stderr, /\[1\] source/);
});
