// THE MECHANICAL SOURCE CHECK. It cannot tell whether a sentence is true. It checks the four
// things that can be checked against the fetched text without a model:
//
//   1. evidence: every { claim, quote } the writer returns quotes the source verbatim, and a
//      researched draft returns at least one.
//   2. years: every year printed anywhere in the clip appears in the source.
//   3. percentages: every percentage printed anywhere in the clip appears in the source.
//   4. names: a draft that supplies a name ("it's called ...", "there's a name for ...") states
//      that name in `term`, and the term appears in the source.
//
// A draft that fails any of them is refused and the slot composes again.
import { draftProse } from '../gates/claims.js';

export const normalise = (s) => String(s || '')
  .toLowerCase()
  .replace(/[‘’‛]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[^a-z0-9%]+/g, ' ')
  .trim();

const NAMING = [/there'?s a name for/i, /there is a name for/i, /it'?s called/i, /it is called/i, /this is called/i];

export function sourceIssues(draft, research) {
  const issues = [];
  const add = (slug, detail) => issues.push({ gate: 'source-check', slug, detail });
  const src = research?.sourceText || '';
  if (!src) return issues;
  const hay = normalise(src);
  const printed = draftProse(draft);

  const evidence = Array.isArray(draft.evidence) ? draft.evidence : [];
  if (!evidence.length) add('no-evidence', 'a researched draft must return evidence: [{ claim, quote }] with each quote copied from the source');
  for (const e of evidence) {
    const q = normalise(e?.quote);
    if (q.split(' ').length < 5) add('quote-too-short', `the quote "${String(e?.quote || '').slice(0, 60)}" is under five words`);
    else if (!hay.includes(q)) add('quote-not-in-source', `the quote "${String(e.quote).slice(0, 90)}" does not appear in ${research.citations?.[0]?.url || 'the source'}`);
  }

  const years = new Set(printed.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []);
  const missingYears = [...years].filter((y) => !src.includes(y));
  if (missingYears.length) add('year-not-in-source', `year(s) ${missingYears.join(', ')} are printed in the clip but not in the source`);

  const pcts = new Set((printed.match(/\b\d+(?:\.\d+)?\s?%/g) || []).map((p) => p.replace(/\s/g, '')));
  const missingPcts = [...pcts].filter((p) => !src.replace(/\s?%/g, '%').includes(p) && !src.includes(`${p.slice(0, -1)} percent`));
  if (missingPcts.length) add('percent-not-in-source', `percentage(s) ${missingPcts.join(', ')} are printed in the clip but not in the source`);

  const names = NAMING.some((re) => re.test(printed));
  if (names && !draft.term) add('name-without-term', 'the draft supplies a name but returns no `term` to check it against the source');
  if (draft.term && !hay.includes(normalise(draft.term))) add('term-not-in-source', `the term "${draft.term}" does not appear in the source`);
  return issues;
}
