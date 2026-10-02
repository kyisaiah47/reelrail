// STORE. Write the entry for this clip now, in the slot that made it, with its pictures and the
// sources its script was checked against. The row starts unpublished; the publish station sets
// `published`, `permalink` and `platform` on the same row once the platform has the post.
import { ok, fail } from '../envelope.js';
import { obj, any, str, num, arr } from '../schema.js';
import { openStore } from '../store/index.js';

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-+$/, '');

export function buildRow(input, cfg, n) {
  const d = input.draft;
  const now = new Date();
  const stills = input.stills || [];
  return {
    publication: cfg.publication,
    slug: `${slugify(d.hook)}-${String(input.slotId || now.getTime()).slice(-6)}`,
    n,
    hook: d.hook,
    narration: d.narration,
    beats: d.beats || [],
    caption: d.caption,
    published: false,
    date: now.toISOString().slice(0, 10),
    ts: now.getTime(),
    taxon: d.format || null,
    still: stills[0]?.file || null,
    wide: stills.find((s) => s.aspect === '16:9')?.file || null,
    gallery: stills.slice(1).map((s) => s.file),
    clip_id: input.slotId || null,
    permalink: null,
    platform: null,
    updated_at: now.toISOString(),
    sources: input.citations || [],
    meta: {
      term: d.term || null,
      midcard: d.midcard || null,
      evidence: d.evidence || [],
      video: input.video,
      duration: input.duration,
      verify: input.verify?.measured || null,
      footage: (input.footage || []).map(({ file, ...rest }) => rest),
      subjectId: input.subjectId || null,
    },
  };
}

export default {
  name: 'store',
  input: obj({ draft: any(), video: str(), stills: arr(any()), duration: num(), slotId: str() }, { optional: ['slotId'] }),
  async execute(input, cfg, ctx = {}) {
    let store;
    try {
      store = await openStore(cfg, { dry: ctx.dry && !ctx.stationOnly, fetch: ctx.fetch, env: ctx.env || process.env });
    } catch (e) {
      return fail('config_invalid', e.message);
    }
    try {
      const n = (await store.count(cfg.publication)) + 1;
      const row = buildRow(input, cfg, n);
      if (ctx.stationOnly && ctx.dry) return ok({ entryId: row.slug, row, store: store.kind, written: false }, { where: store.where });
      for (const key of ['still', 'wide']) if (row[key]) row[key] = await store.picture(cfg.publication, row.slug, row[key]);
      row.meta.video = store.localPath(row.meta.video);
      row.gallery = await Promise.all(row.gallery.map((g) => store.picture(cfg.publication, row.slug, g)));
      await store.put(row);
      return ok({ entryId: row.slug, row, store: store.kind, written: true }, { where: store.where, n });
    } catch (e) {
      return fail('store_failed', e.message);
    }
  },
};
