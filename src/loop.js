// THE LOOP. One slot runs the seven stations in order. Each station's input is checked against its
// schema, and its envelope is recorded in the ledger.
//
// What ends a slot:
//   - publish succeeds. The slot is posted. A distribute leg that fails after that is reported and
//     retried once, and never causes a second post.
//   - a platform_signal from any station. The ledger records a halt with the one human step, and
//     `run --slot` refuses to run again until `reelrail clear-halt <slug>`.
//
// Every other failure is a statement about one draft, so the slot composes again with a fresh one:
//   source, research or footage failed  -> that subject is excluded and another is picked
//   a gate refused the draft             -> the next prompt carries every refusal
//   anything else before publish         -> a fresh draft from the top
// After `maxAttempts` refusals the run returns `slot_owed` and the next run composes again.
import fs from 'node:fs';
import path from 'node:path';
import { STATIONS, ORDER } from './stations/index.js';
import { check } from './schema.js';
import { fail, guard, isSignal } from './envelope.js';
import { loadState, saveState, summarise, remember } from './state.js';
import { retryNote as noteFor } from './gates/index.js';
import { relativize, absolutize } from './paths.js';

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const INPUT_KEYS = {
  source: ['exclude', 'recentSubjects'],
  research: ['subjectId', 'query', 'sourceUrls'],
  write: ['subject', 'query', 'sourceText', 'facts', 'citations', 'retryNote', 'recentHooks'],
  illustrate: ['draft', 'query', 'slotId'],
  store: ['draft', 'video', 'stills', 'duration', 'verify', 'footage', 'citations', 'subjectId', 'slotId'],
  publish: ['entryId', 'video', 'draft'],
  distribute: ['entryId', 'row', 'permalink'],
};

export function inputFor(name, carry) {
  const input = pick(carry, INPUT_KEYS[name]);
  if (name === 'distribute' && carry.url !== undefined) input.permalink = carry.url;
  return input;
}

async function runOne(name, input, cfg, ctx) {
  const st = ctx.stations?.[name] || STATIONS[name];
  const errs = check(st.input, input);
  if (errs.length) return fail('invalid_request', `${name}: ${errs.join('; ')}`);
  return guard(() => st.execute(input, cfg, ctx));
}

const lastCarryPath = (cfg) => path.join(cfg.stateDir, `${cfg.slug}.last.json`);

export function isDue(cfg, state, now = new Date()) {
  const [start, end] = cfg.cadence.activeHours;
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour < start || hour >= end) return { due: false, why: `outside the active hours ${start}:00 to ${end}:00` };
  const today = now.toISOString().slice(0, 10);
  const postedToday = (state.slots || []).filter((s) => s.ok && !s.dry && String(s.at).slice(0, 10) === today).length;
  if (postedToday >= cfg.cadence.perDay) return { due: false, why: `${postedToday} of ${cfg.cadence.perDay} posted today` };
  return { due: true, why: `${postedToday} of ${cfg.cadence.perDay} posted today` };
}

export async function runSlot(cfg, opts = {}) {
  const { dry = false, maxAttempts = 12, log = () => {} } = opts;
  const state = loadState(cfg);
  const slotId = opts.slotId || `${cfg.slug}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const ctx = { state, dry, fetch: opts.fetch, env: opts.env, provider: opts.provider, random: opts.random, openBrowser: opts.openBrowser, sleep: opts.sleep, log, stations: opts.stations };
  const exclude = [];
  const refusals = [];
  let note = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let carry = { exclude: [...exclude], recentSubjects: state.recentSubjects, recentHooks: state.recentHooks, retryNote: note, slotId };
    const envelopes = {};
    let failed = null;
    let posted = null;
    for (const name of ORDER) {
      const env = await runOne(name, inputFor(name, carry), cfg, ctx);
      envelopes[name] = env;
      state.lastEnvelopes[name] = summarise(env);
      log(`  [${attempt}] ${name}: ${env.ok ? 'ok' : `${env.code}: ${String(env.message).slice(0, 200)}`}`);
      if (!env.ok) {
        if (name === 'publish' && env.meta?.posted) { posted = env.meta.posted; failed = null; carry = { ...carry, ...posted }; continue; }
        failed = { station: name, env };
        break;
      }
      carry = { ...carry, ...env.data };
      if (name === 'publish') posted = env.data;
    }

    if (posted && failed?.station === 'distribute') {
      const again = await runOne('distribute', inputFor('distribute', carry), cfg, ctx);
      envelopes.distribute = again;
      state.lastEnvelopes.distribute = summarise(again);
      log(`  [${attempt}] distribute retry: ${again.ok ? 'ok' : again.code}`);
      failed = again.ok ? null : failed;
    }

    if (posted) {
      state.recentSubjects = remember(state.recentSubjects, carry.subjectId);
      state.recentHooks = remember(state.recentHooks, carry.draft?.hook);
      if (carry.draft?.midcard?.title) state.recentHooks = remember(state.recentHooks, carry.draft.midcard.title);
      for (const f of carry.footage || []) state.usedFootage[`${f.provider}-${f.id}`] = { slotId, at: new Date().toISOString() };
      if (dry) state.dryPosted = (state.dryPosted || 0) + 1; else state.posted = (state.posted || 0) + 1;
      state.slots = [...(state.slots || []), { slotId, at: new Date().toISOString(), ok: true, dry, attempts: attempt, entryId: carry.entryId, url: carry.url || null }].slice(-200);
      saveState(cfg, state);
      fs.writeFileSync(lastCarryPath(cfg), JSON.stringify(relativize(carry, cfg.dir), null, 2) + '\n');
      return {
        ok: true,
        data: { slotId, attempts: attempt, entryId: carry.entryId, video: carry.video, url: carry.url || null, transport: carry.transport, receipt: carry.receipt || null, distribute: failed ? failed.env : envelopes.distribute?.data },
        envelopes,
        refusals,
      };
    }

    if (isSignal(failed.env)) {
      state.halt = { at: new Date().toISOString(), station: failed.station, signal: failed.env.meta?.signal, message: failed.env.message, step: failed.env.meta?.step || '' };
      state.slots = [...(state.slots || []), { slotId, at: new Date().toISOString(), ok: false, dry, signal: failed.env.meta?.signal }].slice(-200);
      saveState(cfg, state);
      return { ...failed.env, station: failed.station, envelopes, refusals };
    }

    refusals.push(`attempt ${attempt}, ${failed.station}: ${failed.env.code}: ${String(failed.env.message).slice(0, 160)}`);
    if (failed.station === 'source') break;
    if (['research', 'illustrate'].includes(failed.station) && carry.subjectId) exclude.push(carry.subjectId);
    note = failed.station === 'write' && failed.env.code === 'gate_refused' ? noteFor(failed.env.meta?.issues || []) : '';
    saveState(cfg, state);
  }
  state.slots = [...(state.slots || []), { slotId, at: new Date().toISOString(), ok: false, dry, owed: true }].slice(-200);
  saveState(cfg, state);
  return { ...fail('slot_owed', `${refusals.length} drafts were refused and the slot is still owed`), refusals };
}

/** One station on its own. Nothing is stored or posted and the ledger is untouched. The input comes
 *  from `input`, else from the last slot's carried data, else from running the stations before it. */
export async function runStation(cfg, name, opts = {}) {
  if (!STATIONS[name]) return fail('invalid_request', `unknown station "${name}". Stations: ${ORDER.join(', ')}`);
  const state = loadState(cfg);
  const ctx = { state, dry: true, stationOnly: true, fetch: opts.fetch, env: opts.env, provider: opts.provider, random: opts.random, sleep: opts.sleep, log: opts.log || (() => {}), stations: opts.stations };
  let carry = opts.input || null;
  if (!carry) {
    try { carry = absolutize(JSON.parse(fs.readFileSync(lastCarryPath(cfg), 'utf8')), cfg.dir); } catch { carry = null; }
  }
  if (!carry) {
    carry = { exclude: [], recentSubjects: state.recentSubjects, recentHooks: state.recentHooks, slotId: `${cfg.slug}-station` };
    for (const up of ORDER.slice(0, ORDER.indexOf(name))) {
      const env = await runOne(up, inputFor(up, carry), cfg, ctx);
      if (!env.ok) return { ...env, station: up, note: `the ${up} station failed while building the input for ${name}` };
      carry = { ...carry, ...env.data };
    }
  }
  return runOne(name, inputFor(name, { slotId: `${cfg.slug}-station`, ...carry }), cfg, ctx);
}
