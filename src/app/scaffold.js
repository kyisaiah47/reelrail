// `reelrail new-app --app console|simple|both`: a Next.js site that reads the publication's store.
//
//   console   one dense view: every entry, the chosen clip with its script and sources, and the
//             read-back record beside it
//   simple    one roomy view: the newest clip as a readable result, its sources and checks behind
//             disclosures, then the archive
//   both      both views, a welcome dialog that explains the site and offers the choice, and view
//             controls in the footer. The choice is kept in the URL (?view=) and in localStorage.
//
// The templates live in templates/app/: `common` always, then the overlay for each view.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';

const TEMPLATES = path.join(import.meta.dirname, '..', '..', 'templates', 'app');
const RENAME = { gitignore: '.gitignore', 'env.example': '.env.example' };

function copyTree(from, to, vars, written) {
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, RENAME[name] || name);
    if (fs.statSync(src).isDirectory()) { copyTree(src, dest, vars, written); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let text = fs.readFileSync(src, 'utf8');
    for (const [k, v] of Object.entries(vars)) text = text.split(k).join(v);
    fs.writeFileSync(dest, text);
    written.add(dest);
  }
}

export function scaffoldApp({ app, dir = 'site', publication = null, store = null, cwd = process.cwd() }) {
  if (!['console', 'simple', 'both'].includes(app)) throw new Error('--app must be console, simple or both');
  const out = path.resolve(cwd, dir);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} is not empty`);
  let pub = publication || 'my-publication';
  let storePath = store || '../out/store.json';
  if (publication) {
    try {
      const cfg = loadConfig(publication, { cwd });
      pub = cfg.publication;
      if (!store) storePath = path.relative(out, path.resolve(cfg.dir, cfg.outputs.store.path || 'out/store.json'));
    } catch { /* a bare name is fine: the site reads REELRAIL_PUBLICATION */ }
  }
  const vars = { __SITE_NAME__: `${pub}-site`.replace(/[^a-z0-9-]/gi, '-').toLowerCase(), __PUBLICATION__: pub, __STORE_PATH__: storePath };
  const written = new Set();
  const layers = app === 'both' ? ['common', 'console', 'simple', 'both'] : ['common', app];
  for (const layer of layers) copyTree(path.join(TEMPLATES, layer), out, vars, written);
  const readme = [
    `# ${pub} site`,
    '',
    `A Next.js site that reads the ${pub} store written by ReelRail. Scaffolded with \`reelrail new-app --app ${app}\`.`,
    '',
    '```sh',
    'cp .env.example .env.local',
    'npm install',
    'npm run dev',
    '```',
    '',
    `The site reads the store named in \`.env.local\`. With a JSON store, \`REELRAIL_STORE_PATH\` points at the file (\`${storePath}\`). A dry run writes its rows to \`.reelrail/dry/<slug>.store.json\` beside the config instead.`,
    '',
    app === 'both'
      ? 'Visitors choose the Console view or the Simple view in the welcome dialog or the footer. The choice is kept in `?view=` and in localStorage.'
      : `This site has the ${app === 'console' ? 'Console' : 'Simple'} view only. Scaffold again with \`--app both\` for both views and the welcome dialog.`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(out, 'README.md'), readme);
  written.add(path.join(out, 'README.md'));
  return { dir: out, files: [...written].map((f) => path.relative(out, f)).sort() };
}
