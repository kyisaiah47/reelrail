// SOURCE. Pick the subject for this slot from the publication's pool and its recent history.
// Output: { subjectId, query, sourceUrls[], subject }.
//
// source.kind "subject-pool": each entry is { id, term?, article?, query, angle?, landing? }.
//   `article` is the primary source the research station fetches; `query` is the footage search.
// source.kind "footage-query": the pool is a list of footage queries and there is no research.
//
// A subject used in the last `source.recent` slots is skipped while any other is available, and a
// subject excluded on this slot (refused earlier in the same slot) is never picked again.
import { ok, fail } from '../envelope.js';
import { obj, arr, str } from '../schema.js';
import { readPointer } from '../config.js';

export function poolOf(cfg) {
  const pool = readPointer(cfg.source.pool, cfg.dir);
  if (!Array.isArray(pool)) throw new Error('source.pool must resolve to an array');
  return pool.map((p, i) => (typeof p === 'string'
    ? { id: p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), query: p }
    : { ...p, id: p.id || `subject-${i}` }));
}

export default {
  name: 'source',
  input: obj({ exclude: arr(str()), recentSubjects: arr(str()) }, { optional: ['exclude', 'recentSubjects'] }),
  async execute(input, cfg, ctx = {}) {
    let pool;
    try { pool = poolOf(cfg); } catch (e) { return fail('config_invalid', e.message); }
    const exclude = new Set(input.exclude || []);
    const recentList = input.recentSubjects || ctx.state?.recentSubjects || [];
    const window = cfg.source.recent ?? Math.min(12, Math.max(0, pool.length - 1));
    const recent = new Set(recentList.slice(-window));
    const open = pool.filter((p) => !exclude.has(p.id));
    if (!open.length) return fail('source_unavailable', `every subject in the pool (${pool.length}) was excluded on this slot`);
    const fresh = open.filter((p) => !recent.has(p.id));
    const choices = fresh.length ? fresh : [...open].sort((a, b) => recentList.indexOf(a.id) - recentList.indexOf(b.id)).slice(0, 1);
    const rand = ctx.random || Math.random;
    const subject = choices[Math.floor(rand() * choices.length)];
    const query = subject.query || (subject.queries || [])[0] || subject.term || subject.id;
    return ok({
      subjectId: subject.id,
      query,
      sourceUrls: [subject.article].filter(Boolean),
      subject,
    }, { pool: pool.length, fresh: fresh.length });
  },
};
