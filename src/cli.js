#!/usr/bin/env node
// reelrail: the command line.
//
//   reelrail doctor                                    check ffmpeg, ffprobe, Python, Pillow and edge-tts
//   reelrail init [dir]                                copy the worked example into dir, with sample media
//   reelrail run <slug> --slot [--dry]                 run one slot through all seven stations
//   reelrail run <slug> --station <name> --dry         run one station, print its envelope
//                       [--input file.json]
//   reelrail --status [slug...]                        last envelope per station, posted and stored counts
//   reelrail validate <slug>                           check a config and print what it resolves to
//   reelrail clear-halt <slug>                         clear a platform-signal halt after fixing the account
//   reelrail new-app --app console|simple|both [--dir site] [--publication <slug>] [--store path]
//
// <slug> is a config path, or a name found in ./publications/<slug>.json, ./<slug>/publication.json
// or ./examples/<slug>/publication.json.
//
// Exit codes: 0 posted or not due; 2 usage; 3 a platform signal halted the publication;
// 4 every draft was refused and the slot is still owed; 1 a fault in the engine.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { runChecks, formatChecks } from './doctor.js';
import { initExample } from './init.js';
import { runSlot, runStation, isDue } from './loop.js';
import { loadState, saveState } from './state.js';
import { statusAll, formatStatus } from './status.js';
import { scaffoldApp } from './app/scaffold.js';
import { VERSION } from './version.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && ['station', 'input', 'app', 'dir', 'publication', 'config', 'max-attempts', 'store'].includes(argv[i - 1].slice(2))));
const log = (m) => console.error(m);

function usage(code = 2) {
  const head = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  console.error(head.slice(1, head.findIndex((l) => l.startsWith('import '))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(code);
}

// A dry slot with no footage key and no local clips fails the same way on every draft, so it is
// reported once, before the first draft, with the fix.
function footageProblem(cfg, env = process.env) {
  const f = cfg.illustrate.footage || {};
  const keyed = (f.providers || ['pexels', 'pixabay']).some((p) => env[f.keyEnv?.[p] || { pexels: 'PEXELS_API_KEY', pixabay: 'PIXABAY_API_KEY' }[p]]);
  if (keyed) return null;
  const dir = f.localDir ? path.resolve(cfg.dir, f.localDir) : null;
  const clips = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /\.(mp4|mov|m4v|webm)$/i.test(x)) : [];
  if (clips.length) return null;
  return `${cfg.slug} has no footage source: no PEXELS_API_KEY or PIXABAY_API_KEY is set${dir ? `, and ${dir} holds no clips` : ', and illustrate.footage.localDir is not set'}.\n`
    + '  Fix one of these:\n'
    + '    - set a free key: export PEXELS_API_KEY=...   (https://www.pexels.com/api/)\n'
    + `    - put .mp4 clips in ${dir || 'a folder and set illustrate.footage.localDir to it'}\n`
    + '    - start from the worked example, which makes its own sample clip: reelrail init my-first-reel';
}

const insidePackage = (file) => file.startsWith(path.resolve(import.meta.dirname, '..') + path.sep) && file.split(path.sep).includes('node_modules');

async function main() {
  if (flag('version')) { console.log(VERSION); return 0; }
  if (flag('status') || positional[0] === 'status') {
    const slugs = positional.filter((p) => p !== 'status');
    const all = await statusAll(slugs);
    if (!all.length) { console.log('no publications found. Pass a slug or a config path.'); return 0; }
    for (const s of all) console.log(s.error ? `${s.slug}: ${s.error}` : formatStatus(s));
    return 0;
  }
  const cmd = positional[0];
  if (cmd === 'doctor') {
    const { text, missing } = formatChecks(runChecks());
    console.log(text);
    return missing ? 1 : 0;
  }
  if (cmd === 'init') {
    const res = initExample(positional[1] || 'my-first-reel');
    const rel = path.relative(process.cwd(), res.dir) || '.';
    console.log(`wrote the worked example and its sample media to ${res.dir}\n  next: reelrail run ${rel} --slot --dry`);
    return 0;
  }
  if (cmd === 'new-app') {
    const app = opt('app');
    if (!['console', 'simple', 'both'].includes(app)) usage();
    const res = scaffoldApp({ app, dir: opt('dir') || 'site', publication: opt('publication'), store: opt('store') });
    console.log(`wrote ${res.files.length} files to ${res.dir}\n  cd ${res.dir} && npm install && npm run dev`);
    return 0;
  }
  const slug = positional[1];
  if (!cmd || !slug) usage();
  const cfg = loadConfig(opt('config') || slug);
  if (cmd === 'validate') {
    console.log(JSON.stringify({ slug: cfg.slug, file: cfg.file, frame: cfg.frame, writer: cfg.writer.provider, store: cfg.outputs.store.kind, platform: cfg.outputs.primary.platform, gates: cfg.gates }, null, 2));
    return 0;
  }
  if (cmd === 'clear-halt') {
    const st = loadState(cfg);
    delete st.halt;
    saveState(cfg, st);
    console.log(`${cfg.slug}: halt cleared`);
    return 0;
  }
  if (cmd !== 'run') usage();
  if (insidePackage(cfg.file)) {
    console.error(`${cfg.file} is the copy shipped inside the installed package, and a run would write into it.\n  Make your own copy first: reelrail init my-first-reel && reelrail run my-first-reel --slot --dry`);
    return 2;
  }
  const station = opt('station');
  const problem = (!station || station === 'illustrate') ? footageProblem(cfg) : null;
  if (problem) { console.error(problem); return 2; }
  if (station) {
    if (!flag('dry')) { console.error('--station runs only with --dry. A real post goes through --slot.'); return 2; }
    const input = opt('input') ? JSON.parse(fs.readFileSync(opt('input'), 'utf8')) : null;
    const env = await runStation(cfg, station, { input, log });
    console.log(JSON.stringify(env, null, 2));
    return env.ok ? 0 : env.code === 'platform_signal' ? 3 : 4;
  }
  if (!flag('slot')) usage();
  const dry = flag('dry');
  const state = loadState(cfg);
  if (!dry && state.halt) {
    console.error(`${cfg.slug} is halted by a platform signal (${state.halt.signal}) since ${state.halt.at}: ${state.halt.message}`);
    if (state.halt.step) console.error(`  Next step: ${state.halt.step}`);
    console.error(`  After fixing it: reelrail clear-halt ${cfg.slug}`);
    return 3;
  }
  if (!dry) {
    const due = isDue(cfg, state);
    if (!due.due) { console.log(`${cfg.slug}: not due, ${due.why}`); return 0; }
  }
  log(`${cfg.slug}: running one slot${dry ? ' (dry: dry transport, local JSON store)' : ''}`);
  const res = await runSlot(cfg, { dry, log, maxAttempts: Number(opt('max-attempts') || 12) });
  console.log(JSON.stringify(res.ok ? { ok: true, ...res.data, refusals: res.refusals } : { ok: false, code: res.code, message: res.message, station: res.station, refusals: res.refusals }, null, 2));
  if (res.ok) return 0;
  return res.code === 'platform_signal' ? 3 : res.code === 'slot_owed' ? 4 : 1;
}

main().then((code) => process.exit(code ?? 0), (e) => { console.error(e.stack || e.message); process.exit(1); });
