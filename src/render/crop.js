// THE CROP HOOK. Each publication cuts its pictures its own way, so the engine calls a
// per-publication hook rather than one shared cropper. `illustrate.crop` is one of:
//
//   "aspect:2:3"            one still, centre-cropped to that aspect
//   "four-crops"            four stills from one frame: 1:1, 4:5, 2:3 and 16:9
//   "none"                  no pictures
//   { "module": "crop.mjs" } your own function, default export:
//       async ({ video, still, at, outDir, cfg, ffmpeg }) => [{ file, aspect }]
//
// The still is taken from the rendered clip, inside the mid-roll card window when there is one,
// because that frame carries the clip's whole point.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, bins } from './ffmpeg.js';

async function grab(video, at, out) {
  await run(bins.ffmpeg, ['-v', 'error', '-ss', at.toFixed(2), '-i', video, '-frames:v', '1', '-q:v', '2', '-y', out]);
  return out;
}

async function aspectCrop(src, ratio, out) {
  const [a, b] = ratio.split(':').map(Number);
  const vf = `crop='if(gt(iw/ih,${a}/${b}),ih*${a}/${b},iw)':'if(gt(iw/ih,${a}/${b}),ih,iw*${b}/${a})'`;
  await run(bins.ffmpeg, ['-v', 'error', '-i', src, '-vf', vf, '-q:v', '2', '-y', out]);
  return { file: out, aspect: `${a}:${b}` };
}

export async function cropStills({ video, at, outDir, cfg, rule }) {
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, path.basename(video).replace(/\.mp4$/i, ''));
  if (!rule || rule === 'none') return [];
  const still = await grab(video, at, `${base}.still.jpg`);
  if (typeof rule === 'object' && rule.module) {
    const mod = await import(pathToFileURL(path.resolve(cfg.dir, rule.module)).href);
    const fn = mod.default || mod.crop;
    if (typeof fn !== 'function') throw new Error(`${rule.module} has no default export function`);
    const out = await fn({ video, still, at, outDir, cfg, ffmpeg: (args) => run(bins.ffmpeg, args) });
    if (!Array.isArray(out)) throw new Error(`${rule.module} must return [{ file, aspect }]`);
    return out;
  }
  if (typeof rule === 'string' && rule.startsWith('aspect:')) {
    const r = rule.slice('aspect:'.length);
    if (!/^\d+:\d+$/.test(r)) throw new Error(`crop rule "${rule}" must look like aspect:2:3`);
    const one = await aspectCrop(still, r, `${base}.${r.replace(':', 'x')}.jpg`);
    fs.rmSync(still, { force: true });
    return [one];
  }
  if (rule === 'four-crops') {
    const outs = [];
    for (const r of ['1:1', '4:5', '2:3', '16:9']) outs.push(await aspectCrop(still, r, `${base}.${r.replace(':', 'x')}.jpg`));
    fs.rmSync(still, { force: true });
    return outs;
  }
  throw new Error(`unknown crop rule ${JSON.stringify(rule)}`);
}
