// The station envelope. Every station returns one of two shapes:
//
//   { ok: true,  data, meta }
//   { ok: false, code, message, meta? }
//
// `code` comes from CODES below. `platform_signal` is the only code that ends a slot. Every
// other failure is a statement about one draft, and the loop composes a fresh one.

export const CODES = {
  invalid_request: 'The station input failed its schema. The message names the field.',
  config_invalid: 'The publication config is missing a key or holds a value the station cannot use.',
  source_unavailable: 'The subject pool is empty or every subject was excluded on this slot.',
  research_failed: 'The primary source could not be fetched or was too short to be an article.',
  inference_unavailable: 'The model provider did not answer or answered with an HTTP error.',
  unparseable: 'The model returned text that was not one JSON object, twice.',
  gate_refused: 'A copy, claims, source or link gate refused the draft. The message names the gate.',
  footage_unavailable: 'No footage adapter returned a usable clip for the query.',
  render_failed: 'ffmpeg, the caption renderer or the narration step exited with an error.',
  verify_failed: 'The rendered file was read back and did not match the plan.',
  store_failed: 'The store did not accept the entry.',
  upstream_error: 'A platform or service answered with a retryable error.',
  publish_failed: 'The upload finished but the platform reported the post as failed.',
  platform_signal: 'The platform said something about the account: a ban, a captcha, revoked auth, an identity mismatch or a quota. The slot ends.',
  slot_owed: 'Every draft in this run was refused. The slot is still owed and the next run composes again.',
  server_error: 'A fault in the engine itself.',
};

export function ok(data, meta = {}) {
  return { ok: true, data, meta };
}

export function fail(code, message, meta = undefined) {
  if (!CODES[code]) throw new Error(`unknown envelope code ${code}`);
  const env = { ok: false, code, message: String(message) };
  if (meta !== undefined) env.meta = meta;
  return env;
}

/** A platform signal, as an envelope. `signal` is a short machine word, `step` the one human step. */
export function signal(signal, message, step = '') {
  return fail('platform_signal', message, { signal, step });
}

export const isSignal = (env) => Boolean(env && env.ok === false && env.code === 'platform_signal');

/** Run `fn` and turn a thrown error into an envelope, so no station can escape the contract. */
export async function guard(fn, code = 'server_error') {
  try {
    const out = await fn();
    if (out && typeof out === 'object' && 'ok' in out) return out;
    return ok(out);
  } catch (e) {
    if (e && e.envelope) return e.envelope;
    return fail(code, e && e.message ? e.message : String(e));
  }
}

/** Throw an envelope from deep inside a station; guard() returns it unchanged. */
export class EnvelopeError extends Error {
  constructor(envelope) {
    super(envelope.message);
    this.envelope = envelope;
  }
}

export const raise = (code, message, meta) => { throw new EnvelopeError(fail(code, message, meta)); };
export const raiseSignal = (sig, message, step) => { throw new EnvelopeError(signal(sig, message, step)); };
