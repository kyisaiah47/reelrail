// The render and the read-back, with offline narration (a timed tone) and generated footage.
// Skipped when ffmpeg or Pillow is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderClip, chunkWords, planBackgrounds } from '../src/render/render.js';
import { verifyClip } from '../src/render/verify.js';
import { cropStills } from '../src/render/crop.js';
import { canRender, makeClip, tmpdir, makeConfig } from './helpers.js';

test('caption cues follow the voice, keep punctuation and leave no word alone', () => {
  const words = 'The room is loud and you still hear your own name'.split(' ').map((t, i) => ({ text: t, start: i * 0.3 }));
  const cues = chunkWords(words, 10, 'The room is loud, and you still hear your own name.');
  assert.deepEqual(cues.map((c) => c.text), ['The room is loud,', 'and you still hear your own name.']);
  assert.equal(cues[0].start, 10);
});

test('background planning covers the read without looping, or refuses', () => {
  const p = planBackgrounds([8, 8, 8, 8], 20, 6.5);
  assert.ok(p.hold <= 6.5 && p.coverage >= 20);
  assert.ok(planBackgrounds([3, 3], 30, 6.5).short > 0);
});

test('render then read back: size, audio, duration, loudness, picture and the mid-roll card', { skip: !canRender() && 'ffmpeg or Pillow missing' }, async () => {
  const dir = tmpdir();
  const bg = [makeClip(path.join(dir, 'a.mp4')), makeClip(path.join(dir, 'b.mp4'))];
  const plan = await renderClip({
    cards: ['A hook', 'A beat', 'A last beat'],
    narration: ['You hear your name across a loud room.', 'There is a name for this.', 'Now you can notice it.'],
    voice: 'test', tts: { kind: 'tone' }, backgrounds: bg, frame: { w: 360, h: 640 },
    midcard: { title: 'A card', points: ['one', 'two', 'three'] }, captions: { size: 28 },
    out: path.join(dir, 'out', 'clip.mp4'), seed: 'x', preset: 'ultrafast',
  });
  assert.equal(plan.backgrounds, 2);
  assert.ok(plan.midcard, 'the card got a window');
  const v = await verifyClip(plan.video, plan);
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.ok)));
  assert.equal(v.measured.width, 360);
  const stills = await cropStills({ video: plan.video, at: 1, outDir: dir, cfg: makeConfig().cfg, rule: 'aspect:2:3' });
  const dims = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', stills[0].file], { encoding: 'utf8' }).trim().split(',').map(Number);
  assert.ok(Math.abs(dims[0] / dims[1] - 2 / 3) < 0.01, `still is ${dims.join('x')}`);
});

test('verify fails a silent file and a wrong frame size (negative controls)', { skip: !canRender() && 'ffmpeg missing' }, async () => {
  const dir = tmpdir();
  const silent = path.join(dir, 'silent.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=3:r=30', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', silent]);
  const a = await verifyClip(silent, { frame: { w: 360, h: 640 }, total: 3, fps: 30 });
  assert.equal(a.ok, false);
  assert.equal(a.checks.find((c) => c.name === 'loudness').ok, false);
  const b = await verifyClip(silent, { frame: { w: 1080, h: 1920 }, total: 3, fps: 30 });
  assert.equal(b.checks.find((c) => c.name === 'video').ok, false);
  const c = await verifyClip(silent, { frame: { w: 360, h: 640 }, total: 9, fps: 30 });
  assert.equal(c.checks.find((x) => x.name === 'duration').ok, false);
});
