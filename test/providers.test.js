// One provider interface. Every request goes to a fake fetch at a stub base URL; the keys passed
// in are placeholder strings in a local env object, never read from the process environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../src/providers/index.js';
import { runStructured, extractJSON } from '../src/providers/structured.js';
import { fakeFetch } from './helpers.js';

const BASE = 'http://stub.local';
const env = { MY_KEY: 'placeholder' };

test('openai-compatible: chat completions shape, json mode, bearer key', async () => {
  const f = fakeFetch([[(u) => u === `${BASE}/v1/chat/completions`, () => ({ json: { choices: [{ message: { content: '{"a":1}' } }] } })]]);
  const p = createProvider({ provider: 'openai-compatible', baseURL: `${BASE}/v1`, model: 'local-model', apiKeyEnv: 'MY_KEY' }, { fetch: f, env });
  const res = await p.complete({ system: 'sys', prompt: 'hi' });
  assert.equal(res.text, '{"a":1}');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.model, 'local-model');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[0].role, 'system');
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer placeholder');
});

test('openai-compatible: a local server with no key sends no authorization header', async () => {
  const f = fakeFetch([[() => true, () => ({ json: { choices: [{ message: { content: '{}' } }] } })]]);
  const p = createProvider({ provider: 'openai-compatible', baseURL: `${BASE}/v1`, model: 'm' }, { fetch: f, env: {} });
  await p.complete({ system: 's', prompt: 'p' });
  assert.equal(f.calls[0].init.headers.authorization, undefined);
});

test('anthropic: messages shape with system and version header', async () => {
  const f = fakeFetch([[(u) => u === `${BASE}/v1/messages`, () => ({ json: { content: [{ type: 'text', text: '{"b":2}' }] } })]]);
  const p = createProvider({ provider: 'anthropic', baseURL: BASE, model: 'model-x', apiKeyEnv: 'MY_KEY' }, { fetch: f, env });
  const res = await p.complete({ system: 'sys', prompt: 'hi' });
  assert.equal(res.text, '{"b":2}');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.system, 'sys');
  assert.equal(body.messages[0].content, 'hi');
  assert.equal(f.calls[0].init.headers['x-api-key'], 'placeholder');
  assert.equal(f.calls[0].init.headers['anthropic-version'], '2023-06-01');
});

test('gemini: generateContent with a system instruction and a JSON mime type', async () => {
  const f = fakeFetch([[(u) => u === `${BASE}/models/gemini-x:generateContent`, () => ({ json: { candidates: [{ content: { parts: [{ text: '{"c":3}' }] } }] } })]]);
  const p = createProvider({ provider: 'gemini', baseURL: BASE, model: 'gemini-x', apiKeyEnv: 'MY_KEY' }, { fetch: f, env });
  const res = await p.complete({ system: 'sys', prompt: 'hi' });
  assert.equal(res.text, '{"c":3}');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(f.calls[0].init.headers['x-goog-api-key'], 'placeholder');
});

test('a provider without its key refuses before any request', async () => {
  const f = fakeFetch([]);
  const p = createProvider({ provider: 'gemini', baseURL: BASE, apiKeyEnv: 'ABSENT' }, { fetch: f, env: {} });
  await assert.rejects(p.complete({ system: 's', prompt: 'p' }), /ABSENT/);
  assert.equal(f.calls.length, 0);
});

test('command: the prompt goes to the CLI on stdin', async () => {
  const p = createProvider({ provider: 'command', command: process.execPath, args: ['-e', "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify({len:s.length})))"] });
  const res = await p.complete({ system: 'abc', prompt: 'def' });
  assert.equal(JSON.parse(res.text).len, 'abc\n\ndef'.length);
});

test('runStructured: one retry on unparseable output, then the object', async () => {
  let n = 0;
  const p = { kind: 'fake', model: 'f', complete: async ({ prompt }) => ({ text: n++ === 0 ? 'Sure! here it is' : (prompt.includes('could not be parsed') ? '```json\n{"ok":true}\n```' : '') }) };
  const res = await runStructured(p, { system: 's', prompt: 'p' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, { ok: true });
  assert.equal(res.meta.attempts, 2);
});

test('runStructured: two unparseable replies is a clean failure', async () => {
  const p = { kind: 'fake', model: 'f', complete: async () => ({ text: 'no json here' }) };
  const res = await runStructured(p, { system: 's', prompt: 'p' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'unparseable');
});

test('runStructured: an HTTP failure is inference_unavailable', async () => {
  const p = { kind: 'fake', model: 'f', complete: async () => { const e = new Error('503 from host'); e.status = 503; throw e; } };
  const res = await runStructured(p, { system: 's', prompt: 'p' });
  assert.equal(res.code, 'inference_unavailable');
  assert.equal(res.meta.status, 503);
});

test('extractJSON reads a fenced or surrounded object', () => {
  assert.deepEqual(extractJSON('text {"a": {"b": 1}} more'), { a: { b: 1 } });
  assert.deepEqual(extractJSON('```json\n{"x":2}\n```'), { x: 2 });
  assert.throws(() => extractJSON('nothing'));
});
