// The one HTTP call every provider makes. The caller passes `fetch`, so tests run with no network
// and no key. A non-2xx answer becomes an Error carrying the status and the start of the body.

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** POST JSON. A 429 or 5xx answer is retried twice, after 2 s and then 6 s, before it is an error. */
export async function postJSON(fetchImpl, url, opts = {}) {
  const waits = opts.retryWaits ?? [2000, 6000];
  for (let i = 0; ; i++) {
    try {
      return await postOnce(fetchImpl, url, opts);
    } catch (e) {
      if (!RETRYABLE.has(e.status) || i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

async function postOnce(fetchImpl, url, { headers = {}, body, timeoutMs = 180000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${res.status} from ${new URL(url).host}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      const err = new Error(`non-JSON answer from ${new URL(url).host}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

export function keyFrom(env, name, required = true) {
  if (!name) return null;
  const v = env[name];
  if (!v && required) throw new Error(`the writer needs ${name} in the environment`);
  return v || null;
}
