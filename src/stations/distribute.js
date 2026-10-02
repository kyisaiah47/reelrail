// DISTRIBUTE. The secondary legs, driven from the stored row: a second platform, a pin, a weekly
// letter, a comment lane. Each leg is a separate consumer of the row, so the engine hands the row
// over and does not run those channels itself.
//
//   outputs.secondary: [
//     "pinterest",                                   an outbox file the "pinterest" consumer reads
//     { "leg": "letter", "kind": "outbox" },         same, written out
//     { "leg": "site", "kind": "webhook", "urlEnv": "SITE_HOOK_URL" }   POSTs the row to a URL you own
//   ]
//
// Outbox files land in <stateDir>/outbox/<leg>/<entryId>.json. A webhook URL is read from the
// environment variable named by urlEnv. The row is sent as stored: no link is added to it.
import fs from 'node:fs';
import path from 'node:path';
import { ok, fail } from '../envelope.js';
import { obj, any, str } from '../schema.js';

export default {
  name: 'distribute',
  input: obj({ entryId: str(), row: any(), permalink: any() }, { optional: ['permalink'] }),
  async execute(input, cfg, ctx = {}) {
    const legs = (cfg.outputs.secondary || []).map((l) => (typeof l === 'string' ? { leg: l, kind: 'outbox' } : l));
    const row = { ...input.row, published: true, permalink: input.permalink ?? input.row?.permalink ?? null };
    const done = [];
    for (const leg of legs) {
      if (ctx.dry) { done.push({ leg: leg.leg, kind: leg.kind, dry: true }); continue; }
      try {
        if (leg.kind === 'outbox') {
          const dir = path.join(cfg.stateDir, 'outbox', leg.leg);
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${input.entryId}.json`);
          fs.writeFileSync(file, JSON.stringify({ leg: leg.leg, publication: cfg.publication, row }, null, 2) + '\n');
          done.push({ leg: leg.leg, kind: 'outbox', file });
        } else if (leg.kind === 'webhook') {
          const url = (ctx.env || process.env)[leg.urlEnv];
          if (!url) return fail('config_invalid', `secondary leg ${leg.leg} needs ${leg.urlEnv} in the environment`);
          const res = await (ctx.fetch || globalThis.fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leg: leg.leg, publication: cfg.publication, row }) });
          if (!res.ok) return fail('upstream_error', `secondary leg ${leg.leg} answered ${res.status}`);
          done.push({ leg: leg.leg, kind: 'webhook', status: res.status });
        } else {
          return fail('config_invalid', `secondary leg ${leg.leg} has unknown kind ${leg.kind}`);
        }
      } catch (e) {
        return fail('upstream_error', `secondary leg ${leg.leg}: ${e.message}`);
      }
    }
    return ok({ legs: done });
  },
};
