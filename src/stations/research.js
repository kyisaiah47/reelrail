// RESEARCH. Fetch the primary sources the subject names and reduce them to text.
// Output: { sourceText, facts[], citations[] }.
//
// research.kind "wikipedia-raw": every sourceUrl is a Wikipedia article, fetched raw now, stripped
//   to prose, and recorded with its revision id. The writer may draw facts from this text only.
// research.kind "none": nothing is fetched and the footage query passes through unchanged.
import { ok, fail } from '../envelope.js';
import { obj, arr, str } from '../schema.js';
import { fetchArticle } from '../research/wikipedia.js';

export default {
  name: 'research',
  input: obj({ subjectId: str(), query: str(), sourceUrls: arr(str()) }),
  async execute(input, cfg, ctx = {}) {
    const kind = cfg.research.kind;
    if (kind === 'none') {
      return ok({ sourceText: '', facts: [], citations: [], query: input.query }, { kind });
    }
    if (!input.sourceUrls.length) return fail('research_failed', `subject ${input.subjectId} names no source article`);
    const texts = [];
    const facts = [];
    const citations = [];
    for (const url of input.sourceUrls) {
      try {
        const a = await fetchArticle(url, { fetch: ctx.fetch, userAgent: cfg.research.userAgent });
        texts.push(a.text);
        facts.push(...a.facts);
        citations.push({ url: a.url, title: a.title, permalink: a.permalink, revisionId: a.revisionId, retrievedAt: a.retrievedAt, license: a.license });
      } catch (e) {
        return fail('research_failed', `${url}: ${e.message}`);
      }
    }
    const max = cfg.research.maxChars || 60000;
    return ok({ sourceText: texts.join('\n\n').slice(0, max), facts, citations, query: input.query },
      { kind, chars: texts.reduce((a, t) => a + t.length, 0) });
  },
};
