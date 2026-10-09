// One JSON config per publication. The keys are the engine spec's section 5.2 keys:
// slug, publication, laneId, registryId, host, voiceFile, format, source, research, gates,
// cadence and outputs. `writer` and `illustrate` are optional and carry the bring-your-own-model
// and footage choices. Paths inside the file resolve against the file's own directory.
import fs from 'node:fs';
import path from 'node:path';
import { check, obj, str, num, arr, oneOf, any } from './schema.js';

const FORMAT = obj({
  kind: oneOf(['vertical-narrated', 'landscape-documentary']),
  frame: str({ pattern: '^\\d{3,4}x\\d{3,4}$' }),
  schema: str(),
  ttsVoice: str({ min: 3 }),
});

export const CONFIG_SCHEMA = obj({
  slug: str({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
  publication: str({ min: 1 }),
  laneId: str({ min: 1 }),
  registryId: str({ min: 1 }),
  host: str({ min: 3 }),
  voiceFile: str({ min: 1 }),
  format: FORMAT,
  source: obj({ kind: oneOf(['subject-pool', 'footage-query']), pool: any() }),
  research: obj({ kind: oneOf(['none', 'wikipedia-raw']) }),
  gates: arr(str({ min: 1 })),
  cadence: obj({ perDay: num({ min: 0 }), activeHours: arr(num({ min: 0, max: 24 }), { min: 2, max: 2 }) }),
  outputs: obj({
    primary: obj({ platform: oneOf(['tiktok', 'youtube', 'none']), handle: str({ min: 1 }) }),
    store: obj({ kind: oneOf(['json', 'sqlite', 'supabase']) }),
    secondary: arr(any()),
  }),
  writer: any(),
  illustrate: any(),
  links: any(),
}, { optional: ['writer', 'illustrate', 'links'] });

const DEFAULT_ILLUSTRATE = {
  footage: { providers: ['pexels', 'pixabay'], localDir: null, maxClips: 4, secondsPerClip: 6 },
  tts: { kind: 'edge-tts', rate: '-8%' },
  music: { file: null, duck: 0.22, open: 0.85 },
  captions: { font: null, size: 64, color: '#FBF6EC', position: 'center', maxWords: 7 },
  midcard: { show: true, atFrac: 0.55 },
  maxCards: 8,
  holdCap: 0,
  crop: 'aspect:2:3',
  overlay: null,
};

/** Read `file#key` or a bare file, relative to `base`. Inline arrays and objects pass through. */
export function readPointer(value, base) {
  if (value == null || typeof value !== 'string') return value;
  const [file, key] = value.split('#');
  const abs = path.resolve(base, file);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return key ? data[key] : data;
}

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k])
      ? merge(a[k], v) : v;
  }
  return out;
}

/** Find a config by slug. Order: an explicit path, ./publications/<slug>.json, ./<slug>/publication.json,
 *  ./examples/<slug>/publication.json, then the examples shipped inside this package. */
export function findConfig(slugOrPath, cwd = process.cwd()) {
  if (slugOrPath.endsWith('.json')) return path.resolve(cwd, slugOrPath);
  const here = import.meta.dirname;
  const candidates = [
    path.join(cwd, 'publications', `${slugOrPath}.json`),
    path.resolve(cwd, slugOrPath, 'publication.json'),
    path.join(cwd, 'examples', slugOrPath, 'publication.json'),
    path.join(here, '..', 'examples', slugOrPath, 'publication.json'),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`no config for "${slugOrPath}". Looked in:\n  ${candidates.join('\n  ')}`);
  return found;
}

/** Validate a parsed config. Returns the list of problems; empty means usable. */
export function validateConfig(raw) {
  const errs = check(CONFIG_SCHEMA, raw);
  if (raw?.cadence?.activeHours && raw.cadence.activeHours[0] >= raw.cadence.activeHours[1]) {
    errs.push('cadence.activeHours: start must be before end');
  }
  return errs;
}

/** Load, validate and resolve a publication config. Throws with every problem listed. */
export function loadConfig(slugOrPath, { cwd = process.cwd(), overrides = {} } = {}) {
  const file = findConfig(slugOrPath, cwd);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return resolveConfig(raw, { file, overrides });
}

export function resolveConfig(raw, { file = null, overrides = {} } = {}) {
  const errs = validateConfig(raw);
  if (errs.length) throw new Error(`config ${file || raw?.slug || ''} is invalid:\n  - ${errs.join('\n  - ')}`);
  const dir = file ? path.dirname(file) : process.cwd();
  const cfg = merge(structuredClone(raw), overrides);
  cfg.file = file;
  cfg.dir = dir;
  cfg.workDir = path.resolve(dir, cfg.workDir || 'out');
  cfg.stateDir = path.resolve(dir, cfg.stateDir || '.reelrail');
  cfg.illustrate = merge(DEFAULT_ILLUSTRATE, cfg.illustrate || {});
  // The spec's store key names the picture cut; an explicit illustrate.crop wins over it.
  if (raw.illustrate?.crop === undefined && cfg.outputs.store.pictureCrop) cfg.illustrate.crop = `aspect:${cfg.outputs.store.pictureCrop}`;
  cfg.writer = merge({ provider: 'stub' }, cfg.writer || {});
  cfg.links = merge({ allow: [] }, cfg.links || {});
  cfg.voicePath = path.resolve(dir, cfg.voiceFile);
  const [w, h] = cfg.format.frame.split('x').map(Number);
  cfg.frame = { w, h };
  return cfg;
}

/** The voice file, sliced for a prompt. */
export function readVoice(cfg, max = 4000) {
  try { return fs.readFileSync(cfg.voicePath, 'utf8').slice(0, max); } catch { return ''; }
}

/** `claims:facts.json` and similar gate entries, split into name and argument. */
export function parseGates(cfg) {
  return (cfg.gates || []).map((g) => {
    const i = g.indexOf(':');
    return i < 0 ? { name: g, arg: null } : { name: g.slice(0, i), arg: g.slice(i + 1) };
  });
}
