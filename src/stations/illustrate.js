// ILLUSTRATE. Footage, narration in the publication's fixed voice, the music bed, the render, the
// crop hook and the read-back. Output: { video, stills[], duration, verify, footage[], plan }.
//
// The number of backgrounds comes from the script: the read is estimated at 1.98 words a second
// plus the per-line breath, and one background covers about `secondsPerClip` of it, up to
// `maxClips`. The renderer then measures the real narration and plans the windows exactly.
import path from 'node:path';
import { ok, fail } from '../envelope.js';
import { obj, any, str } from '../schema.js';
import { fetchFootage } from '../footage/index.js';
import { renderClip } from '../render/render.js';
import { verifyClip } from '../render/verify.js';
import { cropStills } from '../render/crop.js';

const WORDS_PER_SEC = 1.98;

export function backgroundCount(narration, { maxClips = 4, secondsPerClip = 6 } = {}) {
  const words = narration.join(' ').split(/\s+/).filter(Boolean).length;
  if (!words) return 1;
  const est = words / WORDS_PER_SEC + narration.length * 0.45 + 0.6;
  return Math.max(1, Math.min(maxClips, Math.ceil(est / secondsPerClip)));
}

export default {
  name: 'illustrate',
  input: obj({ draft: any(), query: str(), slotId: str() }, { optional: ['slotId'] }),
  async execute(input, cfg, ctx = {}) {
    const d = input.draft;
    const il = cfg.illustrate;
    const slotId = input.slotId || `${cfg.slug}-${Date.now()}`;
    const outDir = path.join(cfg.workDir, slotId);
    const want = backgroundCount(d.narration, il.footage);
    let footage;
    try {
      footage = await fetchFootage({
        query: input.query, count: want, frame: cfg.frame, cfgFootage: il.footage,
        used: ctx.state?.usedFootage || {}, outDir: path.join(outDir, 'footage'),
        fetch: ctx.fetch, env: ctx.env || process.env, baseDir: cfg.dir,
      });
    } catch (e) {
      return fail('footage_unavailable', e.message);
    }
    let plan;
    try {
      plan = await renderClip({
        cards: [d.hook, ...(d.beats || [])],
        narration: d.narration,
        voice: cfg.format.ttsVoice,
        tts: { kind: il.tts.kind, rate: il.tts.rate, pronounce: il.tts.pronounce || {} },
        backgrounds: footage.map((f) => f.file),
        frame: cfg.frame,
        music: il.music.file ? { file: path.resolve(cfg.dir, il.music.file), duck: il.music.duck } : null,
        midcard: il.midcard?.show === false ? null : d.midcard,
        midcardAt: il.midcard?.atFrac,
        captions: il.captions,
        overlay: il.overlay ? path.resolve(cfg.dir, il.overlay) : null,
        holdCap: il.holdCap,
        grade: il.grade,
        out: path.join(outDir, `${slotId}.mp4`),
        seed: slotId,
        preset: il.preset,
      });
    } catch (e) {
      return fail(e.code === 'footage_short' ? 'footage_unavailable' : 'render_failed', e.message);
    }
    const verify = await verifyClip(plan.video, plan);
    if (!verify.ok) {
      return fail('verify_failed', verify.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; '), { verify, video: plan.video });
    }
    let stills = [];
    try {
      const at = plan.midcard ? (plan.midcard.start + plan.midcard.end) / 2 : plan.total * 0.35;
      stills = await cropStills({ video: plan.video, at, outDir, cfg, rule: il.crop });
    } catch (e) {
      return fail('render_failed', `crop hook: ${e.message}`);
    }
    return ok({
      video: plan.video,
      stills,
      duration: plan.total,
      verify,
      footage: footage.map((f) => ({ provider: f.provider, id: f.id, credit: f.credit, url: f.url, license: f.license, file: f.file })),
      plan,
    }, { backgrounds: plan.backgrounds, cues: plan.cues, music: plan.music?.file || null });
  },
};
