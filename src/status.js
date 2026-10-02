// `reelrail --status`: every publication's last envelope per station, the posted count, the store
// count and any halt, on one screen. A stalled store or a station that has failed every run for a
// week shows here as a number that disagrees with another number.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { loadState } from './state.js';
import { openStore } from './store/index.js';
import { ORDER } from './stations/index.js';

export function discover(cwd = process.cwd()) {
  const found = [];
  const pubDir = path.join(cwd, 'publications');
  if (fs.existsSync(pubDir)) for (const f of fs.readdirSync(pubDir)) if (f.endsWith('.json')) found.push(path.join(pubDir, f));
  for (const parent of [cwd, path.join(cwd, 'examples')]) {
    if (!fs.existsSync(parent)) continue;
    for (const d of fs.readdirSync(parent)) {
      const f = path.join(parent, d, 'publication.json');
      if (fs.existsSync(f)) found.push(f);
    }
  }
  return [...new Set(found)];
}

export async function statusOf(cfg, { env = process.env, fetch } = {}) {
  const state = loadState(cfg);
  let stored = null;
  let storeError = null;
  try { stored = await (await openStore(cfg, { env, fetch })).count(cfg.publication); } catch (e) { storeError = e.message; }
  let dryStored = null;
  try { dryStored = await (await openStore(cfg, { dry: true })).count(cfg.publication); } catch { /* no dry runs yet */ }
  return {
    slug: cfg.slug,
    platform: cfg.outputs.primary.platform,
    handle: cfg.outputs.primary.handle,
    posted: state.posted || 0,
    dryPosted: state.dryPosted || 0,
    stored,
    dryStored,
    storeError,
    halt: state.halt || null,
    lastSlot: (state.slots || []).slice(-1)[0] || null,
    stations: Object.fromEntries(ORDER.map((n) => [n, state.lastEnvelopes?.[n] || null])),
  };
}

export function formatStatus(s) {
  const lines = [];
  lines.push(`${s.slug}  ${s.platform} ${s.handle}`);
  lines.push(`  posted ${s.posted} (dry ${s.dryPosted})   stored ${s.stored ?? `? (${s.storeError})`} (dry ${s.dryStored ?? 0})`);
  if (s.halt) lines.push(`  HALTED by a platform signal at ${s.halt.at}: ${s.halt.message}${s.halt.step ? `. Next step: ${s.halt.step}` : ''}. Clear with: reelrail clear-halt ${s.slug}`);
  if (s.lastSlot) lines.push(`  last slot ${s.lastSlot.slotId} at ${s.lastSlot.at}: ${s.lastSlot.ok ? 'posted' : s.lastSlot.signal ? `signal ${s.lastSlot.signal}` : 'still owed'}${s.lastSlot.dry ? ' (dry)' : ''}`);
  for (const [name, env] of Object.entries(s.stations)) {
    lines.push(`  ${name.padEnd(11)} ${env ? (env.ok ? `ok    ${env.at}` : `${env.code}  ${env.at}  ${String(env.message).slice(0, 120)}`) : '-'}`);
  }
  return lines.join('\n');
}

export async function statusAll(slugs, { cwd = process.cwd(), env, fetch } = {}) {
  const files = slugs.length ? slugs : discover(cwd);
  const out = [];
  for (const f of files) {
    try { out.push(await statusOf(loadConfig(f, { cwd }), { env, fetch })); } catch (e) { out.push({ slug: f, error: e.message }); }
  }
  return out;
}
