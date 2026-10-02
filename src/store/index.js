// THE STORE. One row per clip, written in the slot that made it, never in a later batch. The row
// shape matches a `publication_posts` table: publication, slug, n, hook, narration, beats, caption,
// published, date, ts, taxon, still, wide, gallery, clip_id, permalink, platform, updated_at, plus
// `sources` (the citations the script was checked against) and `meta`.
//
//   outputs.store.kind "json"      a local JSON file (outputs.store.path, default out/store.json)
//   outputs.store.kind "sqlite"    a local SQLite file through node:sqlite (outputs.store.path)
//   outputs.store.kind "supabase"  the PostgREST and Storage APIs. Needs SUPABASE_URL and a key
//                                  named by outputs.store.keyEnv (default SUPABASE_SERVICE_ROLE_KEY)
//
// Every adapter has the same calls: put(row), patch(slug, fields), list(limit), count(), picture()
// and localPath(). A JSON or SQLite store writes every path relative to its own file, so the file
// can move and never carries a machine path. Supabase stores picture URLs and bare file names.
import fs from 'node:fs';
import path from 'node:path';

const JSON_COLS = ['narration', 'beats', 'gallery', 'sources', 'meta'];

export function jsonStore(file) {
  const file_ = file;
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { entries: [] }; } };
  const write = (db) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
    fs.renameSync(tmp, file);
  };
  return {
    kind: 'json',
    where: file,
    async put(row) {
      const db = read();
      db.entries = db.entries.filter((e) => !(e.publication === row.publication && e.slug === row.slug));
      db.entries.push(row);
      write(db);
      return row;
    },
    async patch(publication, slug, fields) {
      const db = read();
      const e = db.entries.find((x) => x.publication === publication && x.slug === slug);
      if (!e) throw new Error(`no stored entry ${publication}/${slug}`);
      Object.assign(e, fields);
      write(db);
      return e;
    },
    async list(publication, limit = 50) {
      return read().entries.filter((e) => e.publication === publication).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);
    },
    async count(publication) {
      return read().entries.filter((e) => e.publication === publication).length;
    },
    async picture(_publication, _slug, file) { return path.relative(path.dirname(file_), file); },
    localPath(p) { return p ? path.relative(path.dirname(file_), p) : p; },
  };
}

export async function sqliteStore(file) {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS publication_posts (
    publication TEXT NOT NULL, slug TEXT NOT NULL, n INTEGER, hook TEXT, narration TEXT, beats TEXT,
    caption TEXT, published INTEGER, date TEXT, ts INTEGER, taxon TEXT, still TEXT, wide TEXT,
    gallery TEXT, clip_id TEXT, permalink TEXT, platform TEXT, updated_at TEXT, sources TEXT, meta TEXT,
    PRIMARY KEY (publication, slug))`);
  const COLS = ['publication', 'slug', 'n', 'hook', 'narration', 'beats', 'caption', 'published', 'date', 'ts', 'taxon',
    'still', 'wide', 'gallery', 'clip_id', 'permalink', 'platform', 'updated_at', 'sources', 'meta'];
  const enc = (k, v) => (JSON_COLS.includes(k) ? JSON.stringify(v ?? null) : k === 'published' ? (v ? 1 : 0) : v ?? null);
  const dec = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, JSON_COLS.includes(k) ? JSON.parse(v) : k === 'published' ? Boolean(v) : v]));
  return {
    kind: 'sqlite',
    where: file,
    async put(row) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO publication_posts (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
      stmt.run(...COLS.map((c) => enc(c, row[c])));
      return row;
    },
    async patch(publication, slug, fields) {
      const keys = Object.keys(fields).filter((k) => COLS.includes(k));
      db.prepare(`UPDATE publication_posts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE publication = ? AND slug = ?`)
        .run(...keys.map((k) => enc(k, fields[k])), publication, slug);
      return dec(db.prepare('SELECT * FROM publication_posts WHERE publication = ? AND slug = ?').get(publication, slug));
    },
    async list(publication, limit = 50) {
      return db.prepare('SELECT * FROM publication_posts WHERE publication = ? ORDER BY ts DESC LIMIT ?').all(publication, limit).map(dec);
    },
    async count(publication) {
      return db.prepare('SELECT COUNT(*) AS n FROM publication_posts WHERE publication = ?').get(publication).n;
    },
    async picture(_publication, _slug, pic) { return path.relative(path.dirname(file), pic); },
    localPath(p) { return p ? path.relative(path.dirname(file), p) : p; },
  };
}

export function supabaseStore({ url, key, table = 'publication_posts', bucket = 'publication', fetch: f = globalThis.fetch }) {
  if (!url || !key) throw new Error('the supabase store needs SUPABASE_URL and a key in the environment');
  const rest = `${url.replace(/\/$/, '')}/rest/v1/${table}`;
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const call = async (u, init) => {
    const res = await f(u, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} from the store: ${text.slice(0, 300)}`);
    return { res, body: text ? JSON.parse(text) : null };
  };
  return {
    kind: 'supabase',
    where: `${table} at ${new URL(url).host}`,
    async put(row) {
      const { body } = await call(`${rest}?on_conflict=publication,slug`, {
        method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row),
      });
      return Array.isArray(body) ? body[0] : row;
    },
    async patch(publication, slug, fields) {
      const { body } = await call(`${rest}?publication=eq.${encodeURIComponent(publication)}&slug=eq.${encodeURIComponent(slug)}`, {
        method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(fields),
      });
      return Array.isArray(body) ? body[0] : null;
    },
    async list(publication, limit = 50) {
      const { body } = await call(`${rest}?publication=eq.${encodeURIComponent(publication)}&order=ts.desc&limit=${limit}`, { method: 'GET' });
      return body || [];
    },
    async count(publication) {
      const { res } = await call(`${rest}?publication=eq.${encodeURIComponent(publication)}&select=slug`, {
        method: 'HEAD', headers: { prefer: 'count=exact', range: '0-0' },
      });
      return Number(String(res.headers.get('content-range') || '').split('/')[1] || 0);
    },
    async picture(publication, slug, file) {
      const dest = `${publication}/${slug}/${path.basename(file)}`;
      const res = await f(`${url.replace(/\/$/, '')}/storage/v1/object/${bucket}/${dest}`, {
        method: 'POST',
        headers: { apikey: key, authorization: `Bearer ${key}`, 'x-upsert': 'true', 'content-type': file.endsWith('.png') ? 'image/png' : 'image/jpeg' },
        body: fs.readFileSync(file),
      });
      if (!res.ok) throw new Error(`${res.status} uploading ${dest}: ${(await res.text()).slice(0, 200)}`);
      return `${url.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${dest}`;
    },
    localPath(p) { return p ? path.basename(p) : p; },
  };
}

export async function openStore(cfg, { dry = false, fetch: f, env = process.env } = {}) {
  const s = cfg.outputs.store;
  if (dry) return jsonStore(path.join(cfg.stateDir, 'dry', `${cfg.slug}.store.json`));
  if (s.kind === 'json') return jsonStore(path.resolve(cfg.dir, s.path || 'out/store.json'));
  if (s.kind === 'sqlite') return sqliteStore(path.resolve(cfg.dir, s.path || 'out/store.sqlite'));
  if (s.kind === 'supabase') {
    return supabaseStore({ url: env[s.urlEnv || 'SUPABASE_URL'], key: env[s.keyEnv || 'SUPABASE_SERVICE_ROLE_KEY'], table: s.table, bucket: s.bucket, fetch: f });
  }
  throw new Error(`unknown store kind ${s.kind}`);
}
