// THE WRITER IS GIVEN THE SOURCE. IT DOES NOT RECALL IT.
//
// The subject's Wikipedia article is fetched raw at write time and reduced to prose, and that
// text is the only thing the writer may draw facts from. The revision id is recorded so every
// published clip can point at the exact version it was written against.
//
// Wikimedia asks every client to identify itself, so requests carry a User-Agent naming this
// package. Pass `userAgent` in the research config to add your own contact.

const UA = 'reelrail (https://github.com/kyisaiah47/reelrail)';

export function parseArticleUrl(url) {
  const m = /^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^?#]+)/.exec(String(url));
  if (!m) return null;
  return { lang: m[1], title: decodeURIComponent(m[2]).replace(/_/g, ' ') };
}

/** Remove balanced `open ... close` spans, nesting aware. Used for templates and tables. */
function dropBalanced(s, open, close) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length;) {
    if (s.startsWith(open, i)) { depth++; i += open.length; continue; }
    if (depth && s.startsWith(close, i)) { depth--; i += close.length; continue; }
    if (!depth) out += s[i];
    i++;
  }
  return out;
}

/** Drop [[File:...]], [[Image:...]] and [[Category:...]] links, whose captions nest more links. */
function dropMediaLinks(s) {
  const re = /\[\[(?:File|Image|Category|Media):/i;
  let m;
  while ((m = re.exec(s))) {
    let depth = 0;
    let j = m.index;
    for (; j < s.length; j++) {
      if (s.startsWith('[[', j)) { depth++; j++; continue; }
      if (s.startsWith(']]', j)) { depth--; j++; if (!depth) { j++; break; } }
    }
    s = s.slice(0, m.index) + s.slice(j);
  }
  return s;
}

/** Wikitext to prose. Templates, tables, references and media go; link text and numbers stay. */
export function stripWikitext(raw) {
  let t = String(raw).replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '');
  t = dropBalanced(t, '{{', '}}');
  t = dropBalanced(t, '{|', '|}');
  t = dropMediaLinks(t);
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1');
  t = t.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, '');
  t = t.replace(/'''?/g, '');
  t = t.replace(/<(math|gallery|timeline|score)[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&ndash;|&mdash;/g, '-').replace(/&amp;/g, '&');
  t = t.replace(/^[*#:;]+\s*/gm, '');
  t = t.replace(/[ \t]+/g, ' ').replace(/\([\s,;:]*\)/g, '').replace(/ ([,.;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  const cut = t.search(/\n==+ ?(References|Notes|See also|External links|Further reading|Bibliography|Sources|Citations) ?==+/i);
  return (cut > 0 ? t.slice(0, cut) : t).trim();
}

/** Sentences worth handing over as facts: the lead first, then the body, in order. */
export function factsFrom(text, max = 12) {
  const body = String(text).replace(/^==+[^=\n]+==+\s*$/gm, '\n');
  const sentences = body
    .split(/\n+/)
    .flatMap((para) => para.split(/(?<=[.!?])\s+(?=[A-Z"(])/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 320 && /[a-z]/.test(s) && !/^[|!{]/.test(s));
  return sentences.slice(0, max);
}

async function getText(fetchImpl, url, userAgent) {
  const res = await fetchImpl(url, { headers: { 'user-agent': userAgent, 'api-user-agent': userAgent } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.text();
}

/** Fetch an article now. Returns { url, title, text, facts, revisionId, permalink, retrievedAt }. */
export async function fetchArticle(url, { fetch: fetchImpl = globalThis.fetch, userAgent = UA, minChars = 800 } = {}) {
  const parsed = parseArticleUrl(url);
  if (!parsed) throw new Error(`not a Wikipedia article URL: ${url}`);
  let { title } = parsed;
  const base = `https://${parsed.lang}.wikipedia.org`;
  let raw = await getText(fetchImpl, `${base}/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=raw`, userAgent);
  const redirect = /^#REDIRECT\s*\[\[([^\]|#]+)/i.exec(raw);
  if (redirect) {
    title = redirect[1].trim();
    raw = await getText(fetchImpl, `${base}/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=raw`, userAgent);
  }
  const text = stripWikitext(raw);
  if (text.length < minChars) throw new Error(`${url} reduced to ${text.length} characters of prose; that is not an article`);
  let revisionId = null;
  try {
    const api = JSON.parse(await getText(fetchImpl,
      `${base}/w/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp&format=json&formatversion=2&titles=${encodeURIComponent(title)}`, userAgent));
    revisionId = api?.query?.pages?.[0]?.revisions?.[0]?.revid ?? null;
  } catch { /* the article text is the source; a missing revision id only weakens the citation */ }
  const canonical = `${base}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  return {
    url: canonical,
    title,
    text,
    facts: factsFrom(text),
    revisionId,
    permalink: revisionId ? `${base}/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&oldid=${revisionId}` : canonical,
    retrievedAt: new Date().toISOString(),
    license: 'CC BY-SA 4.0',
  };
}
