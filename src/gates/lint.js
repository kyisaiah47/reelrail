// The clip lint. Mechanical, high-precision rules a draft must pass before it is rendered.
// A hook, a caption, a narration line or a mid-roll card is a promise to the viewer, so a promise
// the clip cannot deliver is refused here.

const LIST_PROMISE = [
  /\b\d+\s+(things|ways|reasons|habits|lessons|signs|steps|rules|mistakes|questions|prompts|tips)\b/i,
  /\b(here('?s| is| are)|these are|a list of)\b.*\b(things|ways|reasons|habits|lessons|signs|steps|rules|list)\b/i,
  /\b(my|the) (list|top \d+)\b/i,
];
const CONTINUATION = [/\b(swipe|keep watching|wait for it|watch till the end|part \d+|read on|save this for)\b/i];

const text = (v) => String(v ?? '').trim();

export function lintDraft(d, { maxCards = 8, narrated = true } = {}) {
  const issues = [];
  const add = (slug, detail) => issues.push({ gate: 'lint', slug, detail });
  const hook = text(d.hook);
  const caption = text(d.caption);
  const beats = (Array.isArray(d.beats) ? d.beats : []).map(text).filter(Boolean);
  const narration = (Array.isArray(d.narration) ? d.narration : []).map(text).filter(Boolean);

  if (!hook) add('no-hook', 'the draft has no hook');
  if (!caption) add('no-caption', 'the draft has no caption');
  if (narrated && !narration.length) add('no-narration', 'a narrated format needs narration lines');
  if (narrated && narration.length && narration.length !== 1 + beats.length) {
    add('narration-mismatch', `${1 + beats.length} cards but ${narration.length} narration lines; narration maps 1:1 onto hook plus beats`);
  }
  if (1 + beats.length > maxCards) add('too-many-cards', `${1 + beats.length} cards; the maximum is ${maxCards}`);

  const listIn = [hook, caption].find((s) => LIST_PROMISE.some((re) => re.test(s)));
  if (listIn && beats.length < 2) add('list-promise', `promises a list the clip does not enumerate: "${listIn.slice(0, 80)}"`);
  const narrList = narration.find((s) => LIST_PROMISE.some((re) => re.test(s)));
  if (narrList && beats.length < 2) add('list-promise-narration', `a narration line promises a list: "${narrList.slice(0, 80)}"`);

  const bait = narration.find((s) => CONTINUATION.some((re) => {
    const m = s.match(re);
    return m && !new RegExp(`\\b(you|i|we|they|he|she|it)\\s+\\w*\\s*${m[0]}`, 'i').test(s);
  }));
  if (bait) add('continuation-bait', `a narration line baits an off-clip payoff: "${bait.slice(0, 80)}"`);
  if ([hook, caption].some((s) => CONTINUATION.some((re) => re.test(s))) && !beats.length) {
    add('continuation-bait', `baits a payoff with no second card: "${hook.slice(0, 60)}"`);
  }

  const mc = d.midcard;
  const midcard = (typeof mc === 'string' ? mc : [mc?.title, ...(mc?.points || [])].filter(Boolean).join(' ')).trim();
  if (midcard) {
    if (LIST_PROMISE.some((re) => re.test(midcard)) && beats.length < 2) add('list-promise-midcard', `the mid-roll card promises a list: "${midcard.slice(0, 80)}"`);
    if (CONTINUATION.some((re) => re.test(midcard))) add('continuation-bait-midcard', `the mid-roll card baits a payoff: "${midcard.slice(0, 80)}"`);
    if (/[#@]/.test(midcard)) add('midcard-has-tags', `the mid-roll card carries a #tag or @handle: "${midcard.slice(0, 80)}"`);
    if (typeof mc === 'object') {
      if (text(mc.title).length > 40) add('midcard-title-long', `the mid-roll card title is ${text(mc.title).length} characters; the maximum is 40`);
      for (const p of mc.points || []) if (text(p).length > 42) add('midcard-point-long', `a mid-roll point is ${text(p).length} characters; the maximum is 42: "${text(p)}"`);
    }
  }
  return issues;
}
