// VERIFY. Open the finished file and prove it is the clip that was planned. A flag is a request and
// a file is a result: a render can exit 0 with the wrong size, no audio, a silent mix or a black
// picture, and nothing upstream of the mp4 can see any of those. So the last step reads it back.
//
// Each check measures the file itself:
//   decodes      ffmpeg decodes every frame with no error
//   video        h264, yuv420p, the planned frame size, about the planned frame rate
//   audio        an audio stream is present
//   duration     within 0.35 s of the planned runtime
//   loudness     the mix is not silent (mean volume above -45 dB)
//   picture      the picture is not black (some sampled frame has mean luma above 16)
//   midcard      when a card was planned, the frame in its window differs from the frame before it
import { run, bins, probe } from './ffmpeg.js';

const num = (re, s) => { const m = re.exec(s); return m ? parseFloat(m[1]) : null; };

async function frameLuma(file, t) {
  const { stderr } = await run(bins.ffmpeg, ['-v', 'info', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1',
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-']);
  return num(/YAVG=([\d.]+)/, stderr);
}

async function frameDiff(file, a, b) {
  const grab = async (t) => {
    const { stdout } = await run(bins.ffmpeg, ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1',
      '-vf', 'scale=64:64,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20, encoding: 'buffer' });
    return stdout;
  };
  const [x, y] = [await grab(a), await grab(b)];
  let sum = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) sum += Math.abs(x[i] - y[i]);
  return sum / Math.max(1, Math.min(x.length, y.length));
}

export async function verifyClip(file, plan = {}) {
  const checks = [];
  const pass = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  let info;
  try {
    info = await probe(file);
  } catch (e) {
    return { ok: false, checks: [{ name: 'readable', ok: false, detail: e.message }], measured: {} };
  }
  const v = (info.streams || []).find((s) => s.codec_type === 'video');
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  const dur = parseFloat(info.format?.duration || '0');
  const [fn, fd] = String(v?.avg_frame_rate || '0/1').split('/').map(Number);
  const fps = fd ? fn / fd : 0;

  try {
    const { stderr } = await run(bins.ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-']);
    pass('decodes', !stderr.trim(), stderr.trim() ? stderr.trim().split('\n')[0] : 'every frame decoded');
  } catch (e) {
    pass('decodes', false, e.message);
  }
  const want = plan.frame;
  pass('video', v && v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && (!want || (v.width === want.w && v.height === want.h)) && Math.abs(fps - (plan.fps || 30)) < 0.6,
    v ? `${v.codec_name} ${v.pix_fmt} ${v.width}x${v.height} at ${fps.toFixed(2)} fps${want ? `, planned ${want.w}x${want.h}` : ''}` : 'no video stream');
  pass('audio', Boolean(a), a ? `${a.codec_name} ${a.sample_rate} Hz, ${a.channels} ch` : 'no audio stream');
  if (plan.total) pass('duration', Math.abs(dur - plan.total) <= 0.35, `${dur.toFixed(2)} s, planned ${plan.total.toFixed(2)} s`);

  let meanVolume = null;
  if (a) {
    const { stderr } = await run(bins.ffmpeg, ['-v', 'info', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
    meanVolume = num(/mean_volume:\s*(-?[\d.]+) dB/, stderr);
    pass('loudness', meanVolume != null && meanVolume > -45, `mean volume ${meanVolume} dB`);
  }
  const samples = [0.15, 0.5, 0.85].map((x) => Math.max(0, dur * x));
  const lumas = [];
  for (const t of samples) lumas.push(await frameLuma(file, t).catch(() => null));
  pass('picture', lumas.some((y) => y != null && y > 16), `mean luma at ${samples.map((t) => t.toFixed(1)).join(', ')} s: ${lumas.map((y) => (y == null ? '?' : y.toFixed(1))).join(', ')}`);

  if (plan.midcard) {
    const mid = (plan.midcard.start + plan.midcard.end) / 2;
    const before = Math.max(0, plan.midcard.start - 0.6);
    const d = await frameDiff(file, before, mid).catch(() => 0);
    pass('midcard', d > 6, `frame difference ${d.toFixed(1)} between ${before.toFixed(1)} s and ${mid.toFixed(1)} s`);
  }
  return {
    ok: checks.every((c) => c.ok),
    checks,
    measured: { duration: +dur.toFixed(3), width: v?.width ?? null, height: v?.height ?? null, fps: +fps.toFixed(3), video: v?.codec_name ?? null, audio: a?.codec_name ?? null, meanVolume, bytes: Number(info.format?.size || 0) },
  };
}
