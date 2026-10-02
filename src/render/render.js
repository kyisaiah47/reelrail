// THE RENDER. Narrated cards over stock footage, captioned with the words the voice actually says.
//
// How a clip is built, in order:
//   1. Each narration line is synthesised to its own mp3 and measured. A card's on-screen window IS
//      its line's length plus a breath, so picture and voice cannot drift.
//   2. The voice's own word timings are cut into short caption cues (at most `maxWords` words,
//      breaking on punctuation), and every cue is drawn to a transparent PNG.
//   3. The cues go into ffmpeg as ONE concat input, each held for its own window, and composite
//      through ONE overlay. The cost does not grow with the number of cues.
//   4. Several backgrounds dissolve into each other (1.1 s). With `holdCap` set, each background is
//      on screen for at most its own real length and at most the cap, nothing loops, and a pool
//      that cannot cover the read is refused rather than repeated.
//   5. The mid-roll card replaces the footage for a window inside the runtime, never added to it.
//   6. The music bed sits ducked under the voice and fades at both ends.
import fs from 'node:fs';
import path from 'node:path';
import { run, bins, duration } from './ffmpeg.js';
import { synthesize } from '../tts/index.js';

const CAPTION_PY = path.join(import.meta.dirname, 'caption.py');
const XFADE = 1.1;
const VO_PAD = 0.45;
const VO_MIN = 1.8;
const VO_TAIL = 0.6;
const FPS = 30;

/** Word timings to caption cues. Punctuation is restored from the written line when the counts match. */
export function chunkWords(words, segStart, sourceText, maxWords = 7) {
  const orig = String(sourceText || '').split(/\s+/).filter(Boolean);
  const zip = orig.length === words.length;
  const toks = words.map((w, i) => ({ text: zip ? orig[i] : String(w.text || '').trim(), start: w.start }));
  const cues = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ text: cur.map((c) => c.text).join(' ').trim(), start: segStart + cur[0].start });
    cur = [];
  };
  for (const t of toks) {
    cur.push(t);
    if (/[.!?;:,]$/.test(t.text) || cur.length >= maxWords) flush();
  }
  flush();
  // A one-word cue left over by the word cap joins the cue before it, so no word sits alone.
  for (let i = cues.length - 1; i > 0; i--) {
    if (cues[i].text.split(/\s+/).length === 1 && !/[.!?;:,]$/.test(cues[i - 1].text)) {
      cues[i - 1].text = `${cues[i - 1].text} ${cues[i].text}`;
      cues.splice(i, 1);
    }
  }
  return cues;
}

/** Background windows that cover `runtime` without looping, or { short } when the pool cannot. */
export function planBackgrounds(durations, runtime, cap, x = XFADE) {
  const dd = durations.filter((d) => d > x + 0.4);
  const coverAt = (h) => (dd.length ? dd.reduce((a, d) => a + Math.min(d, h), 0) - (dd.length - 1) * x : 0);
  const ceiling = coverAt(cap);
  if (!dd.length || ceiling < runtime - 0.05) return { short: runtime - ceiling, ceiling };
  let lo = x + 0.4;
  let hi = cap;
  for (let k = 0; k < 48; k++) { const m = (lo + hi) / 2; if (coverAt(m) >= runtime) hi = m; else lo = m; }
  return { hold: hi, wins: durations.map((d) => (d > x + 0.4 ? Math.min(d, hi) : 0)), coverage: coverAt(hi) };
}

const hashSeed = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Render one clip.
 * @param {object} p
 *   cards[], narration[] (1:1), voice, tts{kind,rate,pronounce}, backgrounds[] (files), frame{w,h},
 *   music{file,duck}, midcard{title,points}|null, midcardAt, captions{font,size,color,position,maxWords,avoid},
 *   overlay (png), holdCap, grade, out, seed
 */
export async function renderClip(p) {
  const { w: W, h: H } = p.frame;
  const out = path.resolve(p.out);
  const base = out.replace(/\.mp4$/i, '');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!p.narration?.length) throw new Error('nothing to narrate');
  if (p.cards.length !== p.narration.length) throw new Error(`${p.cards.length} cards but ${p.narration.length} narration lines`);

  // 1. narration, one segment per line
  const segs = [];
  for (const [i, line] of p.narration.entries()) {
    segs.push(await synthesize(line, `${base}.vo${i}.mp3`, { ...p.tts, voice: p.voice }));
  }
  const durs = segs.map((s) => Math.max(s.seconds + VO_PAD, VO_MIN));
  durs[durs.length - 1] += VO_TAIL;
  const total = durs.reduce((a, b) => a + b, 0);
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0));

  // 2. caption cues from the voice's own timings
  const maxWords = p.captions?.maxWords || 7;
  let cues = [];
  segs.forEach((s, i) => {
    cues.push(...(s.words.length ? chunkWords(s.words, starts[i], p.narration[i], maxWords) : [{ text: p.narration[i], start: starts[i] }]));
  });
  cues.sort((a, b) => a.start - b.start);
  cues = cues.map((c, i) => ({ ...c, end: i < cues.length - 1 ? cues[i + 1].start : total }));

  // 4. backgrounds: measured, then planned
  const bgFiles = (p.backgrounds || []).filter((f) => fs.existsSync(f));
  const bgDur = [];
  for (const f of bgFiles) bgDur.push(await duration(f).catch(() => 0));
  let plan = null;
  let segDur = total;
  if (bgFiles.length > 1) {
    if (p.holdCap > 0) {
      plan = planBackgrounds(bgDur, total, p.holdCap);
      if (plan.short != null) {
        const e = new Error(`not enough footage: ${bgFiles.length} clips cover ${plan.ceiling.toFixed(1)} s at a ${p.holdCap} s hold and the read is ${total.toFixed(1)} s`);
        e.code = 'footage_short';
        throw e;
      }
    } else {
      segDur = (total + (bgFiles.length - 1) * XFADE) / bgFiles.length;
    }
  }
  const bgUsed = plan ? bgFiles.filter((_, k) => plan.wins[k] > 0) : bgFiles;
  const wins = plan ? plan.wins.filter((x) => x > 0) : bgUsed.map(() => segDur);
  const bgStarts = wins.map((_, k) => wins.slice(0, k).reduce((a, b) => a + b, 0) - k * XFADE);

  // caption frames to avoid: a still of the footage under each cue
  const avoidFor = async (c, i) => {
    if (p.captions?.avoid === false || !bgUsed.length) return null;
    const mid = (c.start + c.end) / 2;
    let k = 0;
    for (let j = 0; j < bgStarts.length; j++) if (mid >= bgStarts[j]) k = j;
    const local = Math.max(0, mid - (bgUsed.length > 1 ? bgStarts[k] : 0));
    const at = bgDur[bgFiles.indexOf(bgUsed[k])] > 0 ? local % bgDur[bgFiles.indexOf(bgUsed[k])] : local;
    const frame = `${base}.avoid${i}.png`;
    try {
      await run(bins.ffmpeg, ['-v', 'error', '-ss', at.toFixed(2), '-i', bgUsed[k], '-frames:v', '1',
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-y', frame], { timeoutMs: 60000 });
      return fs.existsSync(frame) ? frame : null;
    } catch { return null; }
  };

  // caption PNGs and the mid-roll card, in one Python process
  const jobs = [];
  const capPngs = [];
  for (const [i, c] of cues.entries()) {
    const png = `${base}.cue${i}.png`;
    capPngs.push(png);
    jobs.push({ kind: 'caption', text: c.text, out: png, width: W, height: H, font: p.captions?.font || null,
      size: p.captions?.size || Math.round(W * 0.06), color: p.captions?.color || '#FBF6EC', pos: p.captions?.position || 'center',
      avoid: await avoidFor(c, i) });
  }
  // 5. the mid-roll card window, carved out of the runtime
  let midWin = null;
  if (p.midcard && (p.midcard.title || p.midcard.points?.length)) {
    const dur = Math.min(6, Math.max(3.2, total * 0.22));
    const start = Math.max(0.4, Math.min(total * (p.midcardAt ?? 0.55), total - dur - 0.5));
    if (start >= 0.4 && start + dur + 0.5 <= total) {
      midWin = { start, end: start + dur, png: `${base}.midcard.png` };
      jobs.push({ kind: 'card', title: p.midcard.title || '', points: p.midcard.points || [], out: midWin.png, width: W, height: H, font: p.captions?.font || null });
    }
  }
  await run(bins.python, [CAPTION_PY], { input: JSON.stringify({ jobs }), timeoutMs: 300000 });
  for (const j of jobs) if (j.avoid) fs.rmSync(j.avoid, { force: true });

  // 3. the caption track: one concat input, each cue held for its own window
  const blank = `${base}.blank.png`;
  await run(bins.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=black@0.0:s=${W}x${H}:d=1,format=rgba`, '-frames:v', '1', '-y', blank]);
  // The mid-roll card replaces the caption for its window, so cues are carved out of it.
  const shown = [];
  cues.forEach((c, i) => {
    if (midWin && c.end > midWin.start && c.start < midWin.end) {
      if (c.start < midWin.start) shown.push({ file: capPngs[i], start: c.start, end: midWin.start });
      if (c.end > midWin.end) shown.push({ file: capPngs[i], start: midWin.end, end: c.end });
    } else shown.push({ file: capPngs[i], start: c.start, end: c.end });
  });
  const rows = [];
  const push = (file, d) => { if (d > 0.001) rows.push(`file '${file.replace(/'/g, "'\\''")}'`, `duration ${d.toFixed(3)}`); };
  let at = 0;
  for (const seg of shown) {
    push(blank, seg.start - at);
    push(seg.file, seg.end - seg.start);
    at = seg.end;
  }
  push(blank, total - at);
  rows.push(rows[rows.length - 2]);
  const capList = `${base}.captions.txt`;
  fs.writeFileSync(capList, rows.join('\n') + '\n');

  // ffmpeg inputs
  const grade = p.grade || 'eq=brightness=0.02:saturation=0.92';
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${grade}`;
  const inputs = [];
  if (!bgUsed.length) inputs.push('-f', 'lavfi', '-i', `color=c=0x1E1A16:s=${W}x${H}:d=${total.toFixed(3)}:r=${FPS}`);
  else if (bgUsed.length === 1) inputs.push('-stream_loop', '-1', '-i', bgUsed[0]);
  else bgUsed.forEach((f, k) => inputs.push(...(plan ? ['-t', wins[k].toFixed(3), '-i', f] : ['-stream_loop', '-1', '-t', segDur.toFixed(3), '-i', f])));
  const nBg = Math.max(1, bgUsed.length);
  const CAP = nBg;
  inputs.push('-f', 'concat', '-safe', '0', '-i', capList);
  let idx = CAP + 1;
  const MID = midWin ? idx++ : -1;
  if (midWin) inputs.push('-loop', '1', '-t', total.toFixed(3), '-i', midWin.png);
  const OV = p.overlay && fs.existsSync(p.overlay) ? idx++ : -1;
  if (OV >= 0) inputs.push('-loop', '1', '-t', total.toFixed(3), '-i', p.overlay);
  const VO = idx;
  segs.forEach((s) => inputs.push('-i', s.mp3));
  idx += segs.length;
  let MUS = -1;
  let musicStart = 0;
  if (p.music?.file && fs.existsSync(p.music.file)) {
    const bedLen = await duration(p.music.file).catch(() => 0);
    musicStart = bedLen > total + 5 ? hashSeed(p.seed || out) % Math.max(1, Math.floor(Math.min(30, bedLen - total))) : 0;
    MUS = idx++;
    inputs.push('-ss', String(musicStart), '-stream_loop', '-1', '-i', p.music.file);
  }

  // filter graph
  const f = [];
  if (!bgUsed.length) f.push(`[0:v]format=rgba,setpts=PTS-STARTPTS[bg]`);
  else if (bgUsed.length === 1) f.push(`[0:v]${cover},fps=${FPS},format=rgba,setpts=PTS-STARTPTS[bg]`);
  else {
    bgUsed.forEach((_, k) => f.push(`[${k}:v]${cover},fps=${FPS},format=rgba,setpts=PTS-STARTPTS[b${k}]`));
    let acc = 'b0';
    let accT = 0;
    for (let k = 1; k < bgUsed.length; k++) {
      accT += wins[k - 1];
      const label = k === bgUsed.length - 1 ? 'bg' : `x${k}`;
      f.push(`[${acc}][b${k}]xfade=transition=fade:duration=${XFADE}:offset=${(accT - k * XFADE).toFixed(3)}[${label}]`);
      acc = label;
    }
  }
  f.push(`[${CAP}:v]fps=${FPS},format=rgba,setpts=PTS-STARTPTS[cap]`);
  f.push(`[bg][cap]overlay=0:0:format=auto:eof_action=pass[v1]`);
  let prev = 'v1';
  if (OV >= 0) {
    f.push(`[${OV}:v]format=rgba,fade=t=in:st=1.4:d=0.42:alpha=1[ov]`);
    f.push(`[${prev}][ov]overlay=0:0:format=auto[v2]`);
    prev = 'v2';
  }
  if (midWin) {
    f.push(`[${MID}:v]format=rgba,fade=t=in:st=${midWin.start.toFixed(3)}:d=0.3:alpha=1,fade=t=out:st=${(midWin.end - 0.3).toFixed(3)}:d=0.3:alpha=1[mc]`);
    f.push(`[${prev}][mc]overlay=0:0:format=auto:enable='between(t,${midWin.start.toFixed(3)},${midWin.end.toFixed(3)})'[v3]`);
    prev = 'v3';
  }
  f.push(`[${prev}]format=yuv420p[v]`);
  segs.forEach((_, i) => f.push(`[${VO + i}:a]aresample=48000,apad=whole_dur=${durs[i].toFixed(3)}[vs${i}]`));
  f.push(`${segs.map((_, i) => `[vs${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[vo]`);
  if (MUS >= 0) {
    const duck = p.music.duck ?? 0.22;
    f.push(`[${MUS}:a]aresample=48000,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, total - 1.2).toFixed(2)}:d=1.2,volume=${duck}[bgm]`);
    f.push(`[vo][bgm]amix=inputs=2:duration=first:normalize=0,apad=whole_dur=${total.toFixed(3)}[a]`);
  } else {
    f.push(`[vo]apad=whole_dur=${total.toFixed(3)}[a]`);
  }

  await run(bins.ffmpeg, ['-y', '-v', 'error', ...inputs, '-filter_complex', f.join(';'),
    '-map', '[v]', '-map', '[a]', '-t', total.toFixed(3), '-r', String(FPS),
    '-c:v', 'libx264', '-preset', p.preset || 'medium', '-crf', String(p.crf || 23), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out], { timeoutMs: 1800000 });

  // keep the narration and its timings; drop the per-cue pictures
  for (const png of [...capPngs, blank]) fs.rmSync(png, { force: true });
  fs.rmSync(capList, { force: true });

  return {
    video: out,
    total,
    cards: p.cards.length,
    cues: cues.length,
    windows: durs.map((d, i) => ({ start: +starts[i].toFixed(3), end: +(starts[i] + d).toFixed(3) })),
    backgrounds: bgUsed.length,
    hold: plan ? +plan.hold.toFixed(2) : null,
    midcard: midWin ? { start: +midWin.start.toFixed(3), end: +midWin.end.toFixed(3), png: midWin.png } : null,
    music: MUS >= 0 ? { file: path.basename(p.music.file), start: musicStart } : null,
    frame: { w: W, h: H },
    fps: FPS,
  };
}
