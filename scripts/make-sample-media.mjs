#!/usr/bin/env node
// Writes the example's media with ffmpeg alone, so the example runs with no keys and no downloads:
//
//   examples/whyyourbraindoesthat/media/bed.mp3          a 90 second synthesized pad, the music bed
//   examples/whyyourbraindoesthat/media/clips/sample.mp4 a 20 second moving gradient, 1080x1920
//
// The bed is the operator's own file in a real publication. The sample clip is used when
// illustrate.footage.localDir points at media/clips, or when no footage key is set.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = path.resolve(import.meta.dirname, '..', 'examples', 'whyyourbraindoesthat', 'media');
fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
const ff = (args) => execFileSync(process.env.REELRAIL_FFMPEG || 'ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });

const bed = path.join(dir, 'bed.mp3');
ff(['-f', 'lavfi', '-i', 'sine=f=220:d=90', '-f', 'lavfi', '-i', 'sine=f=277.18:d=90', '-f', 'lavfi', '-i', 'sine=f=329.63:d=90',
  '-f', 'lavfi', '-i', 'anoisesrc=d=90:c=pink:a=0.02',
  '-filter_complex', '[0][1][2][3]amix=inputs=4:normalize=0,volume=0.22,tremolo=f=0.15:d=0.4,lowpass=f=1200,afade=t=in:d=3,afade=t=out:st=86:d=4',
  '-ac', '2', '-b:a', '128k', bed]);
console.log(bed);

const clip = path.join(dir, 'clips', 'sample.mp4');
ff(['-f', 'lavfi', '-i', 'gradients=s=1080x1920:c0=0x1f2a36:c1=0x5b7a8c:c2=0x9fb3a8:nb_colors=3:speed=0.015:d=20:r=30',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', clip]);
console.log(clip);
