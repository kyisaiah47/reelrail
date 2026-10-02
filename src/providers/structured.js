// THE ONE MODEL CALL. JSON only, with one retry on a parse failure, the way ParseRail's
// runStructured() works: a caller sees one valid JSON object or a clean failure envelope.
import { ok, fail } from '../envelope.js';

/** Pull one JSON object out of a reply. Tolerates a code fence and text around the object. */
export function extractJSON(text) {
  const t = String(text || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const body = fenced ? fenced[1] : t;
  try { return JSON.parse(body); } catch { /* fall through to the brace scan */ }
  const i = body.indexOf('{');
  const j = body.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('no JSON object in the reply');
  return JSON.parse(body.slice(i, j + 1));
}

export async function runStructured(provider, { system, prompt, context }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p = attempt === 1 ? prompt
      : `${prompt}\n\nYour previous reply could not be parsed as JSON (${lastErr}). Reply with ONE JSON object and nothing else.`;
    let reply;
    try {
      reply = await provider.complete({ system, prompt: p, json: true, context });
    } catch (e) {
      return fail('inference_unavailable', e.message, { provider: provider.kind, model: provider.model, status: e.status ?? null });
    }
    try {
      const data = extractJSON(reply.text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('the reply was not a JSON object');
      return ok(data, { provider: provider.kind, model: provider.model, attempts: attempt });
    } catch (e) {
      lastErr = e.message;
    }
  }
  return fail('unparseable', `the model returned unparseable output twice: ${lastErr}`, { provider: provider.kind, model: provider.model });
}
