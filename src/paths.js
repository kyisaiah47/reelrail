// No machine path is ever written down. Everything the engine persists (the ledger, the last
// slot's data, a dry receipt, a JSON or SQLite store row) holds paths relative to a base folder,
// so a publication folder can move, and a store or ledger never carries the operator's home
// directory. In memory the stations keep absolute paths.
import path from 'node:path';

const PATH_KEYS = new Set(['video', 'file', 'receipt', 'png', 'still', 'wide', 'gallery', 'stills', 'footage', 'plan', 'midcard']);

/** Every string under `base` becomes a path relative to it, at any depth. */
export function relativize(value, base) {
  const root = path.resolve(base) + path.sep;
  const walk = (v) => {
    if (typeof v === 'string') return v.startsWith(root) ? path.relative(base, v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

/** The reverse, for data read back from disk: relative paths under the known path keys become
 *  absolute again. URLs and absolute paths are left alone. */
export function absolutize(value, base) {
  const fix = (s) => (typeof s === 'string' && s && !path.isAbsolute(s) && !/^[a-z]+:\/\//i.test(s) ? path.resolve(base, s) : s);
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return PATH_KEYS.has(key) ? fix(v) : v;
  };
  return walk(value, null);
}
