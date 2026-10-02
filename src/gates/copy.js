// The copy gates: the noise list and the prose list, applied to everything a draft will say or
// print. Both are optional per publication (`gates: ["noise", "prose"]`). Each hit names the
// pattern, the fragment and the fix, and that note goes into the next draft's prompt.
import fs from 'node:fs';
import path from 'node:path';

const load = (name) => {
  const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'patterns', `${name}.json`), 'utf8'));
  spec.compiled = spec.patterns.map((p) => ({
    ...p,
    re: new RegExp(p.pattern, name === 'prose' ? 'im' : 'i'),
    requiresRe: p.requires ? new RegExp(p.requires) : null,
    unlessRe: p.unless ? new RegExp(p.unless) : null,
  }));
  return spec;
};

export const NOISE = load('noise');
export const PROSE = load('prose');

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
const SENT = /(?<=[.!?])\s+|\n+/;
const WORD = /[A-Za-z][A-Za-z']*/g;

function sentenceAround(text, index) {
  let pos = 0;
  for (const s of String(text).split(SENT)) {
    const end = pos + s.length;
    if (index >= pos && index < end) return s.replace(/\s+/g, ' ').trim();
    pos = end + 1;
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  }
  return String(text).slice(Math.max(0, index - 80), index + 120).replace(/\s+/g, ' ').trim();
}

const inScope = (p, scope) => scope === 'all' || p[scope];

/** Noise hits in `text`, one per pattern: [{ slug, family, fix, fragment, sentence }]. */
export function noiseIssues(text, { scope = 'copy' } = {}) {
  const t = String(text || '');
  const out = [];
  for (const p of NOISE.compiled) {
    if (!inScope(p, scope)) continue;
    const m = p.re.exec(t);
    if (m) out.push({ gate: 'noise', slug: p.slug, family: p.family, fix: p.fix, fragment: m[0].trim(), sentence: sentenceAround(t, m.index) });
  }
  return out;
}

/** Prose hits in `text`. URLs become <url> first so a caption in front of a link keeps its shape. */
export function proseIssues(text, { scope = 'copy' } = {}) {
  const t = String(text || '').replace(URL_RE, '<url>');
  const out = [];
  for (const p of PROSE.compiled) {
    if (!inScope(p, scope)) continue;
    const re = new RegExp(p.re.source, 'gim');
    let m;
    while ((m = re.exec(t)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      const off = m[0].length - m[0].replace(/^[.!? \t\n]+/, '').length;
      const sentence = sentenceAround(t, m.index + off);
      if (p.min_words && (sentence.match(WORD) || []).length < p.min_words) continue;
      if (p.requiresRe && !p.requiresRe.test(sentence)) continue;
      if (p.unlessRe && p.unlessRe.test(sentence)) continue;
      out.push({ gate: 'prose', slug: p.slug, family: p.family, fix: p.fix, fragment: m[0].replace(/^[.!? \t\n]+|[.!? \t\n]+$/g, '').slice(0, 200), sentence });
      break;
    }
  }
  return out;
}

/** The rule text a prompt carries when a publication turns these gates on. */
export function copyRule(which = ['noise', 'prose']) {
  const lines = [];
  for (const [name, spec] of [['noise', NOISE], ['prose', PROSE]]) {
    if (!which.includes(name)) continue;
    lines.push(spec.rule);
    for (const f of Object.values(spec.families)) lines.push(`  - Never: ${f.what}.`);
  }
  return lines.join('\n');
}
