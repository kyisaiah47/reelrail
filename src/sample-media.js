// Writes a music bed and a sample clip with ffmpeg alone, so the worked example runs with no keys
// and no downloads:
//
//   <dir>/bed.mp3          a 90 second synthesized pad
//   <dir>/clips/sample.mp4 a 20 second moving gradient at the given frame
//
// In a real publication the bed is the operator's own file. The sample clip is used when
// illustrate.footage.localDir points at media/clips and no footage key is set.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bins } from './render/ffmpeg.js';

export function makeSampleMedia(dir, { frame = '1080x1920' } = {}) {
  fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
  const ff = (args) => execFileSync(bins.ffmpeg, ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  const bed = path.join(dir, 'bed.mp3');
  ff(['-f', 'lavfi', '-i', 'sine=f=220:d=90', '-f', 'lavfi', '-i', 'sine=f=277.18:d=90', '-f', 'lavfi', '-i', 'sine=f=329.63:d=90',
    '-f', 'lavfi', '-i', 'anoisesrc=d=90:c=pink:a=0.02',
    '-filter_complex', '[0][1][2][3]amix=inputs=4:normalize=0,volume=0.22,tremolo=f=0.15:d=0.4,lowpass=f=1200,afade=t=in:d=3,afade=t=out:st=86:d=4',
    '-ac', '2', '-b:a', '128k', bed]);
  const clip = path.join(dir, 'clips', 'sample.mp4');
  ff(['-f', 'lavfi', '-i', `gradients=s=${frame}:c0=0x1f2a36:c1=0x5b7a8c:c2=0x9fb3a8:nb_colors=3:speed=0.015:d=20:r=30`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', clip]);
  return { bed, clip };
}
