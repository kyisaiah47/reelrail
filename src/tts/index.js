// Narration. One fixed voice per publication (`format.ttsVoice`), one mp3 per narration line, with
// per-word timings beside it for the captions.
//
// tts.kind "edge-tts": the free Microsoft Edge neural voices through the edge-tts Python package.
//   Needs `pip install edge-tts` and network access. No key.
// tts.kind "tone": a sine tone timed at about 2.2 words a second with evenly spaced word timings.
//   It exists so the render path can be tested offline and in CI. It is never a narration.
import fs from 'node:fs';
import path from 'node:path';
import { run, bins, duration } from '../render/ffmpeg.js';

const SCRIPT = path.join(import.meta.dirname, 'edge_tts_render.py');

export async function synthesize(text, out, { kind = 'edge-tts', voice, rate = '-8%', pronounce = {} } = {}) {
  if (kind === 'edge-tts') {
    await run(bins.python, [SCRIPT, '--text', text, '--voice', voice, `--rate=${rate}`, '--out', out, '--pronounce', JSON.stringify(pronounce)], { timeoutMs: 120000 });
  } else if (kind === 'tone') {
    const ws = text.split(/\s+/).filter(Boolean);
    const secs = Math.max(0.8, ws.length / 2.2);
    await run(bins.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=24000:duration=${secs.toFixed(3)}`,
      '-af', 'volume=0.3', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', out]);
    const step = secs / ws.length;
    const words = ws.map((w, i) => ({ text: w.replace(/[.,;:!?]+$/, ''), start: +(i * step).toFixed(4), end: +((i + 1) * step).toFixed(4) }));
    fs.writeFileSync(out.replace(/\.mp3$/i, '.words.json'), JSON.stringify(words));
  } else {
    throw new Error(`unknown tts.kind "${kind}"`);
  }
  let words = [];
  try { words = JSON.parse(fs.readFileSync(out.replace(/\.mp3$/i, '.words.json'), 'utf8')); } catch { /* captions fall back to the whole line */ }
  return { mp3: out, seconds: await duration(out), words };
}
