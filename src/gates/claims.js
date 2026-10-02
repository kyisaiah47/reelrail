// The claims gate: a publication's own register of terms and passages it has retired after
// checking them against a primary source. `gates: ["claims:facts.json"]` points at the register.
//
//   {
//     "retiredTerms": [{ "term": "...", "why": "..." }],
//     "claims": [{ "id": "...", "sourceUrl": "...", "retiredProse": [{ "text": "...", "replacedWith": "..." }] }],
//     "bannedPhrases": ["studies show"]
//   }
//
// A retired term or passage may never come back, matched as a case-insensitive substring over
// every field the clip says or prints. A missing or unreadable register fails closed: a gate whose
// input has gone is a gate that quietly stopped running.
import fs from 'node:fs';
import path from 'node:path';

export function loadRegister(file, base) {
  const abs = path.resolve(base, file);
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`claims register ${abs} could not be read (${e.message}). The register is a gate input.`);
  }
  return reg;
}

export function draftProse(d) {
  const mc = d.midcard;
  return [
    d.hook, d.caption, d.title, d.description,
    ...(d.beats || []), ...(d.narration || []),
    typeof mc === 'string' ? mc : [mc?.title, ...(mc?.points || [])].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n');
}

export function claimIssues(draft, register) {
  const hay = draftProse(draft).toLowerCase();
  const issues = [];
  for (const r of register.retiredTerms || []) {
    if (hay.includes(String(r.term).toLowerCase())) issues.push({ gate: 'claims', slug: 'retired-term', detail: `uses the retired term "${r.term}": ${r.why}` });
  }
  for (const c of register.claims || []) {
    for (const p of c.retiredProse || []) {
      if (hay.includes(String(p.text).toLowerCase())) {
        issues.push({ gate: 'claims', slug: 'retired-passage', detail: `repeats a corrected passage ("${p.text}", claim ${c.id}). Write it as: "${p.replacedWith}"` });
      }
    }
  }
  for (const b of register.bannedPhrases || []) {
    if (hay.includes(String(b).toLowerCase())) issues.push({ gate: 'claims', slug: 'banned-phrase', detail: `uses the banned phrase "${b}"` });
  }
  return issues;
}
