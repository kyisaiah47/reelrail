// The stub writer. It writes a valid clip-v1 draft from the research it is handed, with no network
// and no key. Tests and `--dry` proofs use it. It never invents a fact: every line that states one
// is cut from a sentence of the fetched source, and that sentence is returned as the evidence quote.

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);

function clip(s, maxWords) {
  const w = words(s);
  if (w.length <= maxWords) return s.trim();
  return `${w.slice(0, maxWords).join(' ').replace(/[,;:]$/, '')}.`;
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'by', 'which', 'that', 'in', 'on', 'for', 'and', 'or', 'with', 'is', 'are', 'as', 'at', 'from', 'their', 'its', 'whom', 'who', 'how', 'when', 'where', 'what', 'why', 'one', 'it']);

/** A short card line: the predicate of a sentence, cut at a word boundary, never ending on a function word. */
function short(s, maxChars) {
  let t = String(s).trim().replace(/\.$/, '');
  const m = /\s(?:is|are|was|were)\s(.+)$/.exec(t);
  if (m && m[1].length >= 12) t = m[1];
  t = t.split(/[,;:]/)[0].trim();
  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars + 1);
    t = cut.slice(0, cut.lastIndexOf(' ')).trim();
  }
  const w = t.split(/\s+/);
  while (w.length > 1 && STOP.has(w[w.length - 1].toLowerCase())) w.pop();
  t = w.join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Speakable form of a source sentence: brackets and pronunciation guides removed. */
function speakable(s) {
  return String(s).replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

export function stubWriter({ context = {} } = {}) {
  const subject = context.subject || {};
  const facts = context.research?.facts || [];
  const term = subject.term || subject.query || 'this';
  const termRe = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const lead = facts.find((f) => termRe.test(f)) || facts[0] || '';
  const hook = subject.angle || `Here is what your brain is doing with ${term}.`;
  const lines = [hook];
  if (subject.term) lines.push(`There is a name for this. It is called ${subject.term}.`);
  if (lead) lines.push(clip(speakable(lead), 40));
  lines.push(subject.landing || 'Now it has a name, and you can notice it when it happens.');
  const others = facts.filter((f) => f !== lead).slice(0, 2);
  const points = [lead, ...others].filter(Boolean).map((f) => short(speakable(f), 40)).filter((p) => p.length > 8).slice(0, 3);
  while (points.length < 3) points.push(['You are not the only one', 'It has been studied', 'Now you can name it'][points.length]);
  const draft = {
    format: subject.term ? 'naming' : 'mechanism',
    term: subject.term || null,
    hook: clip(hook, 14),
    beats: (subject.term ? ['It has a name', short(subject.term, 40), 'Now you can name it'] : lines.slice(1).map((l) => clip(l, 8))).slice(0, lines.length - 1),
    narration: lines,
    midcard: { title: short(subject.term || hook, 40), points },
    caption: `${subject.term ? `There is a name for this: ${subject.term}.` : clip(hook, 12)} #psychology #brain #mind`,
    evidence: lead ? [{ claim: lines[subject.term ? 2 : 1], quote: lead }] : [],
  };
  return JSON.stringify(draft);
}
