// The per-publication ledger: the last envelope of every station, the recent subjects and hooks
// for the do-not-repeat list, the used footage ids, and the posted count. One JSON file per
// publication in the config's stateDir. `--status` reads it.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({
  slug: null,
  lastEnvelopes: {},
  recentSubjects: [],
  recentHooks: [],
  usedFootage: {},
  posted: 0,
  slots: [],
});

export function statePath(cfg) {
  return path.join(cfg.stateDir, `${cfg.slug}.json`);
}

export function loadState(cfg) {
  try {
    return { ...EMPTY(), ...JSON.parse(fs.readFileSync(statePath(cfg), 'utf8')) };
  } catch {
    return { ...EMPTY(), slug: cfg.slug };
  }
}

export function saveState(cfg, state) {
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  const file = statePath(cfg);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** Keep the envelope small enough to print: data is summarised, never the whole render plan. */
export function summarise(env) {
  const out = { ok: env.ok, at: new Date().toISOString() };
  if (env.ok) {
    const d = env.data || {};
    out.data = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, brief(v)]));
    if (env.meta && Object.keys(env.meta).length) out.meta = env.meta;
  } else {
    out.code = env.code;
    out.message = String(env.message).slice(0, 400);
    if (env.meta) out.meta = env.meta;
  }
  return out;
}

function brief(v) {
  if (typeof v === 'string') return v.length > 160 ? `${v.slice(0, 157)}...` : v;
  if (Array.isArray(v)) return v.length > 6 ? `[${v.length} items]` : v.map(brief);
  if (v && typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 300 ? `{${Object.keys(v).join(', ')}}` : v;
  }
  return v;
}

export function remember(list, value, max = 24) {
  if (value == null || value === '') return list;
  return [...list.filter((x) => x !== value), value].slice(-max);
}
