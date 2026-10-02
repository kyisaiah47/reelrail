// BRING YOUR OWN MODEL. One interface over every provider:
//
//   const p = createProvider({ provider: 'gemini', model: 'gemini-2.5-flash' });
//   const { text } = await p.complete({ system, prompt, json: true, context });
//
// provider: 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'command' | 'stub'
//
// 'openai-compatible' takes any base URL that speaks the chat completions shape, including a local
// model server. 'command' pipes the prompt to a CLI on stdin and reads stdout. 'stub' writes a
// deterministic draft from the research, with no network and no key, for tests and dry runs.
//
// Keys are read from the environment variable the config names (`apiKeyEnv`), at call time, and
// only by the provider that was asked for.
import { postJSON, keyFrom } from './http.js';
import { spawn } from 'node:child_process';
import { stubWriter } from './stub.js';

const DEFAULTS = {
  openai: { baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
  anthropic: { baseURL: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta', apiKeyEnv: 'GEMINI_API_KEY', model: 'gemini-2.5-flash' },
  'openai-compatible': { apiKeyEnv: null },
};

export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'openai-compatible', 'command', 'stub'];

export function createProvider(writer = {}, { fetch: fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const kind = writer.provider || 'stub';
  if (!PROVIDERS.includes(kind)) throw new Error(`unknown provider "${kind}". Use one of ${PROVIDERS.join(', ')}`);
  const o = { ...(DEFAULTS[kind] || {}), ...writer };
  const temperature = o.temperature ?? 0.7;

  if (kind === 'stub') {
    return { kind, model: 'stub', complete: async (req) => ({ text: await (o.respond || stubWriter)(req) }) };
  }

  if (kind === 'command') {
    if (!o.command) throw new Error('provider "command" needs writer.command');
    return {
      kind,
      model: o.model || o.command,
      complete: ({ system, prompt }) => runCommand(o.command, o.args || [], `${system}\n\n${prompt}`, o.timeoutMs),
    };
  }

  if (kind === 'openai' || kind === 'openai-compatible') {
    if (!o.baseURL) throw new Error('provider "openai-compatible" needs writer.baseURL');
    if (!o.model) throw new Error(`provider "${kind}" needs writer.model`);
    return {
      kind,
      model: o.model,
      async complete({ system, prompt, json = true }) {
        const key = keyFrom(env, o.apiKeyEnv, kind === 'openai');
        const body = {
          model: o.model,
          temperature,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        };
        if (json && o.jsonMode !== false) body.response_format = { type: 'json_object' };
        const res = await postJSON(fetchImpl, `${o.baseURL.replace(/\/$/, '')}/chat/completions`, {
          headers: key ? { authorization: `Bearer ${key}` } : {},
          body,
          timeoutMs: o.timeoutMs,
        });
        return { text: res?.choices?.[0]?.message?.content ?? '' };
      },
    };
  }

  if (kind === 'anthropic') {
    if (!o.model) throw new Error('provider "anthropic" needs writer.model');
    return {
      kind,
      model: o.model,
      async complete({ system, prompt }) {
        const key = keyFrom(env, o.apiKeyEnv, true);
        const res = await postJSON(fetchImpl, `${o.baseURL.replace(/\/$/, '')}/v1/messages`, {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: {
            model: o.model,
            max_tokens: o.maxTokens || 4096,
            temperature,
            system,
            messages: [{ role: 'user', content: prompt }],
          },
          timeoutMs: o.timeoutMs,
        });
        const text = (res?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        return { text };
      },
    };
  }

  if (kind === 'gemini') {
    return {
      kind,
      model: o.model,
      async complete({ system, prompt, json = true }) {
        const key = keyFrom(env, o.apiKeyEnv, true);
        const generationConfig = { temperature };
        if (json) generationConfig.responseMimeType = 'application/json';
        const res = await postJSON(fetchImpl, `${o.baseURL.replace(/\/$/, '')}/models/${o.model}:generateContent`, {
          headers: { 'x-goog-api-key': key },
          body: {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig,
          },
          timeoutMs: o.timeoutMs,
        });
        const parts = res?.candidates?.[0]?.content?.parts || [];
        return { text: parts.map((p) => p.text || '').join('') };
      },
    };
  }
  throw new Error(`unhandled provider ${kind}`);
}

function runCommand(command, args, input, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} exited ${code}: ${err.slice(0, 300)}`));
      else resolve({ text: out });
    });
    child.stdin.end(input);
  });
}
