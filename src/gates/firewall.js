// THE PERSONA FIREWALL. The engine never adds a link to anything it publishes, and it refuses a
// draft that carries one. A publication's account is its own identity: a link to a maker, a
// company or another account ties them together in public, and that is the operator's call to
// make by hand, never the engine's.
//
// Refused in every generated field: a URL, a bare domain, a www host and an @mention. The only
// exception is a string the operator listed in `links.allow` in the publication config, matched
// exactly. Hashtags pass.

const URL_RE = /\bhttps?:\/\/\S+/i;
const WWW_RE = /\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/i;
const DOMAIN_RE = /(?<![@\w.-])[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,63})*\.(?:com|net|org|io|co|app|dev|tech|ai|me|tv|xyz|link|site|online|store|blog|news|info|us|uk|ca|lol|gg|so|sh|to|ly|page|studio|digital)\b(?:\/\S*)?/i;
const MENTION_RE = /(?<![\w@])@[a-z0-9_.]{2,}/i;

function fieldsOf(d) {
  const mc = d.midcard;
  return {
    hook: d.hook,
    caption: d.caption,
    title: d.title,
    description: d.description,
    beats: (d.beats || []).join('\n'),
    narration: (d.narration || []).join('\n'),
    midcard: typeof mc === 'string' ? mc : [mc?.title, ...(mc?.points || [])].filter(Boolean).join('\n'),
  };
}

/** Links in a draft, by field. Empty array means the draft is clean. */
export function linkIssues(draft, { allow = [] } = {}) {
  const issues = [];
  for (const [field, value] of Object.entries(fieldsOf(draft))) {
    let t = String(value || '');
    for (const a of allow) t = t.split(a).join(' ');
    for (const [slug, re] of [['url', URL_RE], ['www', WWW_RE], ['domain', DOMAIN_RE], ['mention', MENTION_RE]]) {
      const m = re.exec(t);
      if (m) {
        issues.push({ gate: 'links', slug, detail: `${field} carries a ${slug === 'mention' ? 'handle' : 'link'} ("${m[0]}"). The engine never publishes links or handles it was not given.` });
        break;
      }
    }
  }
  return issues;
}

/** The final text that leaves for a platform, checked once more right before the upload. */
export function assertNoLinks(textValue, allow = []) {
  const issues = linkIssues({ caption: textValue }, { allow });
  if (issues.length) throw new Error(issues[0].detail);
  return textValue;
}
