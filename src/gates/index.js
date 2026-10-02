// Every gate a draft passes before it is rendered, in one place, in this order:
//
//   lint          the clip's own promises (always on)
//   links         the persona firewall (always on)
//   noise, prose  the copy lists (per publication)
//   claims:<file> the publication's retired terms and passages (per publication)
//   source-check  the mechanical check against the fetched source (always on when there is one)
//   repeat        the do-not-repeat list from the ledger (always on)
import { lintDraft } from './lint.js';
import { linkIssues } from './firewall.js';
import { noiseIssues, proseIssues } from './copy.js';
import { loadRegister, claimIssues } from './claims.js';
import { sourceIssues, normalise } from '../research/source-check.js';
import { parseGates } from '../config.js';

export function repeatIssues(draft, recentHooks = []) {
  const h = normalise(draft.hook);
  if (!h) return [];
  const hit = recentHooks.find((r) => normalise(r) === h || (h.length > 20 && normalise(r).includes(h)));
  return hit ? [{ gate: 'repeat', slug: 'repeated-hook', detail: `the hook repeats a recent one: "${hit}"` }] : [];
}

export function runGates(draft, { cfg, research = null, recentHooks = [] }) {
  const gates = parseGates(cfg);
  const names = new Set(gates.map((g) => g.name));
  const issues = [];
  issues.push(...lintDraft(draft, { maxCards: cfg.illustrate?.maxCards || 8, narrated: true }));
  issues.push(...linkIssues(draft, { allow: cfg.links?.allow || [] }));
  const copyAll = [draft.hook, draft.caption, ...(draft.beats || []), ...(draft.narration || [])].filter(Boolean).join('\n');
  const mc = draft.midcard;
  const mcText = typeof mc === 'string' ? mc : [mc?.title, ...(mc?.points || [])].filter(Boolean).join('\n');
  if (names.has('noise')) issues.push(...noiseIssues([copyAll, mcText].join('\n'), { scope: 'copy' }));
  if (names.has('prose')) issues.push(...proseIssues(copyAll, { scope: 'copy' }));
  for (const g of gates.filter((x) => x.name === 'claims')) {
    issues.push(...claimIssues(draft, loadRegister(g.arg || 'facts.json', cfg.dir)));
  }
  if (research?.sourceText) issues.push(...sourceIssues(draft, research));
  issues.push(...repeatIssues(draft, recentHooks));
  return issues;
}

/** The note the next draft's prompt carries, so a refusal is fixed instead of repeated. */
export function retryNote(issues) {
  if (!issues.length) return '';
  const lines = issues.slice(0, 6).map((i) => `- [${i.gate}/${i.slug}] ${i.detail || i.fragment || ''}${i.fix ? ` Fix: ${i.fix}` : ''}`);
  return `\n\nTHE PREVIOUS DRAFT WAS REFUSED for these reasons. Write a new draft that fixes each one:\n${lines.join('\n')}`;
}
