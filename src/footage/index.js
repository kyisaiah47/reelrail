// FOOTAGE. Free stock video from the user's own Pexels and Pixabay keys, or a local folder.
// Every clip is downloaded once and recorded in the publication's ledger, so the same clip never
// backs two videos. Credits travel with the clip into the stored entry.
//
//   illustrate.footage.providers: ["pexels", "pixabay"]   tried in order
//   illustrate.footage.localDir:  "media/clips"            used when no provider returns a clip,
//                                                          for example when no key is set
//   keys: PEXELS_API_KEY, PIXABAY_API_KEY in the environment
import fs from 'node:fs';
import path from 'node:path';

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function getJSON(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const pickFile = (files, portrait, targetH) => files
  .filter((f) => f.link && f.width && f.height && (portrait ? f.height >= f.width : f.width >= f.height))
  .sort((a, b) => Math.abs(a.height - targetH) - Math.abs(b.height - targetH))[0] || null;

export const ADAPTERS = {
  async pexels({ query, portrait, frame, page, key, fetch: f }) {
    const data = await getJSON(f, `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${portrait ? 'portrait' : 'landscape'}&size=medium&per_page=15&page=${page}`, { authorization: key });
    return (data.videos || []).map((v) => {
      const file = pickFile((v.video_files || []).filter((x) => (x.file_type || '').includes('mp4')), portrait, frame.h);
      return file && {
        provider: 'pexels', id: String(v.id), link: file.link, duration: v.duration, width: file.width, height: file.height,
        credit: v.user?.name || null, url: v.url || null, license: 'Pexels License',
      };
    }).filter(Boolean);
  },
  async pixabay({ query, portrait, frame, page, key, fetch: f }) {
    const data = await getJSON(f, `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&per_page=20&page=${page}&safesearch=true`);
    return (data.hits || []).map((h) => {
      const files = Object.values(h.videos || {}).map((x) => ({ link: x.url, width: x.width, height: x.height }));
      const file = pickFile(files, portrait, frame.h);
      return file && {
        provider: 'pixabay', id: String(h.id), link: file.link, duration: h.duration, width: file.width, height: file.height,
        credit: h.user || null, url: h.pageURL || null, license: 'Pixabay Content License',
      };
    }).filter(Boolean);
  },
};

const KEY_ENV = { pexels: 'PEXELS_API_KEY', pixabay: 'PIXABAY_API_KEY' };

/** Up to `count` unused clips for `query`. Returns [{ file, provider, id, credit, url, license }]. */
export async function fetchFootage({ query, count = 1, frame, cfgFootage = {}, used = {}, outDir, fetch: fetchImpl = globalThis.fetch, env = process.env, baseDir = '.' }) {
  fs.mkdirSync(outDir, { recursive: true });
  const portrait = frame.h >= frame.w;
  const picked = [];
  const errors = [];
  for (const provider of cfgFootage.providers || ['pexels', 'pixabay']) {
    const key = env[cfgFootage.keyEnv?.[provider] || KEY_ENV[provider]];
    if (!ADAPTERS[provider]) { errors.push(`${provider}: unknown footage provider`); continue; }
    if (!key) { errors.push(`${provider}: no ${KEY_ENV[provider]} in the environment`); continue; }
    try {
      for (let page = 1; page <= (cfgFootage.pages || 5) && picked.length < count; page++) {
        const cands = await ADAPTERS[provider]({ query, portrait, frame, page, key, fetch: fetchImpl });
        if (!cands.length) break;
        for (const c of cands) {
          if (picked.length >= count) break;
          const k = `${c.provider}-${c.id}`;
          if (used[k] || picked.some((p) => p.provider === c.provider && p.id === c.id)) continue;
          const res = await fetchImpl(c.link);
          if (!res.ok) continue;
          const file = path.join(outDir, `${slugify(query)}-${c.provider}-${c.id}.mp4`);
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          picked.push({ file, provider: c.provider, id: c.id, credit: c.credit, url: c.url, license: c.license });
        }
      }
    } catch (e) {
      errors.push(`${provider}: ${e.message}`);
    }
    if (picked.length >= count) break;
  }
  if (!picked.length && cfgFootage.localDir) {
    const dir = path.resolve(baseDir, cfgFootage.localDir);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f)).sort() : [];
    const fresh = files.filter((f) => !used[`local-${f}`]);
    for (const f of (fresh.length ? fresh : files).slice(0, count)) {
      picked.push({ file: path.join(dir, f), provider: 'local', id: f, credit: null, url: null, license: 'supplied by the operator' });
    }
    if (!files.length) errors.push(`local: no clips in ${dir}`);
  }
  if (!picked.length) {
    const err = new Error(`no footage for "${query}": ${errors.join('; ') || 'every result was already used'}`);
    err.errors = errors;
    throw err;
  }
  return picked;
}
