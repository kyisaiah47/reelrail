// WRITE. One model call per clip, with the publication's voice file and format schema. JSON only,
// with one retry on a parse failure. Then the gates: lint, the link firewall, the copy lists, the
// claims register, the mechanical source check and the do-not-repeat list. A refused draft returns
// `gate_refused` with every issue, and the next draft's prompt carries them.
import { ok, fail } from '../envelope.js';
import { obj, str, arr, any } from '../schema.js';
import { readVoice, parseGates } from '../config.js';
import { createProvider } from '../providers/index.js';
import { runStructured } from '../providers/structured.js';
import { runGates } from '../gates/index.js';
import { copyRule } from '../gates/copy.js';

export const SYSTEM = 'You write scripts for short narrated videos. You return one JSON object and nothing else. '
  + 'Every fact you state comes from the source text you are given. You never add a link, a handle or a call to action.';

const SHAPE = {
  'vertical-narrated': { beats: [2, 5], words: [6, 24], seconds: [20, 45] },
  'landscape-documentary': { beats: [8, 24], words: [25, 55], seconds: [180, 600] },
};

export function buildPrompt({ cfg, subject, research, recentHooks = [], retry = '' }) {
  const shape = SHAPE[cfg.format.kind];
  const gates = parseGates(cfg).map((g) => g.name);
  const sourced = Boolean(research?.sourceText);
  const lines = [
    `Write ONE ${cfg.format.kind} video for the publication "${cfg.publication}".`,
    '',
    '=== VOICE (follow it above everything else) ===',
    readVoice(cfg),
    '=== END VOICE ===',
    '',
    `THE FOOTAGE: the narration plays over stock footage found with the search "${research?.query || subject.query}". Never name an object the footage would not show.`,
    subject.term ? `THE SUBJECT: ${subject.term}.${subject.angle ? ` The felt experience: ${subject.angle}` : ''}` : '',
    '',
    'THE SHAPE:',
    `- hook: the on-screen opener, 3 to 9 words.`,
    `- beats: ${shape.beats[0]} to ${shape.beats[1]} short on-screen lines.`,
    `- narration: exactly one spoken line for the hook and one for each beat, in order, each ${shape.words[0]} to ${shape.words[1]} words. The whole read lands between ${shape.seconds[0]} and ${shape.seconds[1]} seconds at about two words a second.`,
    '- midcard: { title, points } summarises what the narration already said. title is at most 40 characters. points are exactly 3 lines of at most 42 characters. No hashtags, no handles, no numbering.',
    '- caption: one line plus 3 or 4 lowercase hashtags.',
    '- format: the register from the voice file that this clip uses.',
    '- term: the name the clip supplies for the experience, copied exactly as the source writes it, or null.',
    sourced
      ? '- evidence: a list of { claim, quote }. claim is a narration line that states a fact. quote is the sentence from the SOURCE TEXT it rests on, copied character for character, at least five words.'
      : '- evidence: an empty list.',
    '',
    'RULES:',
    '- Never write a URL, a domain, an @handle or a call to follow, like or subscribe.',
    '- Never invent a study, a statistic or a quote. "Studies show" is banned.',
    '- Never promise a list the beats do not deliver, and never tell the viewer to keep watching.',
    gates.includes('noise') || gates.includes('prose') ? copyRule(gates.filter((g) => g === 'noise' || g === 'prose')) : '',
    recentHooks.length ? `Do not repeat or paraphrase any of these recent hooks:\n- ${recentHooks.slice(-24).join('\n- ')}` : '',
  ];
  if (sourced) {
    lines.push('', `SOURCE TEXT, fetched from ${research.citations.map((c) => c.url).join(', ')} just now. It is the ONLY place facts may come from:`,
      '<<<SOURCE', research.sourceText.slice(0, cfg.research.promptChars || 24000), 'SOURCE');
  }
  lines.push('', 'Return exactly this JSON shape and nothing else:',
    '{"format":"...","term":null,"hook":"...","beats":["..."],"narration":["..."],"midcard":{"title":"...","points":["...","...","..."]},"caption":"...","evidence":[{"claim":"...","quote":"..."}]}');
  return lines.filter((l) => l !== '').join('\n') + (retry || '');
}

export default {
  name: 'write',
  input: obj({
    subject: any(),
    query: str(),
    sourceText: str({ min: 0 }),
    facts: arr(str()),
    citations: arr(any()),
    retryNote: str({ min: 0 }),
    recentHooks: arr(str()),
  }, { optional: ['retryNote', 'recentHooks', 'facts', 'citations'] }),
  async execute(input, cfg, ctx = {}) {
    let provider;
    try {
      provider = ctx.provider || createProvider(cfg.writer, { fetch: ctx.fetch, env: ctx.env || process.env });
    } catch (e) {
      return fail('config_invalid', e.message);
    }
    const research = { sourceText: input.sourceText, facts: input.facts || [], citations: input.citations || [], query: input.query };
    const recentHooks = input.recentHooks || ctx.state?.recentHooks || [];
    const prompt = buildPrompt({ cfg, subject: input.subject, research, recentHooks, retry: input.retryNote || '' });
    const res = await runStructured(provider, { system: SYSTEM, prompt, context: { subject: input.subject, research, format: cfg.format } });
    if (!res.ok) return res;
    const draft = res.data;
    const issues = runGates(draft, { cfg, research, recentHooks });
    if (issues.length) {
      return fail('gate_refused', issues.map((i) => `${i.gate}/${i.slug}`).join(', '), { issues, draft });
    }
    return ok({ draft, citations: research.citations, subjectId: input.subject?.id || null, query: input.query },
      { ...res.meta, gates: parseGates(cfg).map((g) => g.name).concat(['lint', 'links', 'repeat', ...(research.sourceText ? ['source-check'] : [])]) });
  },
};
