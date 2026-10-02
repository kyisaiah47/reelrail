#!/usr/bin/env node
// reelrail: one module, three entry points.
//
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
import { loadConfig } from './config.js';
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
  console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(code);
}

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
  const station = opt('station');
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
