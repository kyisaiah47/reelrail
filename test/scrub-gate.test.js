// The scrub gate itself. Its real lists are hashed, so these tests use shapes and a test-only
// hashed token; they never write a real address or handle into the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanText, scanDir, hash } from '../scripts/scrub-gate.mjs';
import { tmpdir } from './helpers.js';

const kinds = (t) => scanText(t).map((f) => f.kind);
const join = (...p) => p.join('');

test('key shapes, home paths, DIDs and account ids are caught', () => {
  assert.ok(kinds(join('/Us', 'ers/someone/project')).includes('home path'));
  assert.ok(kinds(join('did:p', 'lc:', 'a'.repeat(24))).includes('DID'));
  assert.ok(kinds(join('ac', 'ct_', 'Ab3'.repeat(5))).includes('Stripe account id'));
  assert.ok(kinds(join('AI', 'za', 'B'.repeat(35))).includes('Google API key'));
  assert.ok(kinds(join('gh', 'p_', 'x1'.repeat(18))).includes('GitHub token'));
  assert.ok(kinds(join('-----BEGIN', ' PRIVATE', ' KEY-----')).includes('private key block'));
  assert.ok(kinds(join('api_key = "', 'Zx9'.repeat(10), '"')).includes('secret assigned to a key name'));
});

test('bypass code is caught', () => {
  assert.ok(kinds(join("require('puppeteer", "-extra')")).includes('stealth plugin'));
  assert.ok(kinds(join('const solver = "2cap', 'tcha"')).includes('captcha service'));
  assert.ok(kinds(join('Object.define', "Property(navigator, 'webdri", "ver', {})")).includes('automation flag override'));
});

test('listed tokens are matched by hash in every form', () => {
  const extra = { email: [hash('example.person')], handle: [hash('example_account')], word: [hash('alpha-beta')] };
  assert.deepEqual(scanText(join('mail example.person', '@example.org'), { extra }).map((f) => f.kind), ['listed email']);
  assert.deepEqual(scanText(join('follow ', '@example_account'), { extra }).map((f) => f.kind), ['listed handle']);
  assert.deepEqual(scanText('run alpha-beta now', { extra }).map((f) => f.kind), ['listed word']);
  assert.deepEqual(scanText('ordinary text with no secrets #hashtag', { extra }), []);
});

test('a directory with a planted key fails and a clean one passes', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'ok.md'), 'Plain words.\n');
  assert.deepEqual(scanDir(dir), []);
  fs.writeFileSync(path.join(dir, 'bad.js'), `const k = '${join('sk-', 'proj-', 'Q'.repeat(30))}';\n`);
  assert.equal(scanDir(dir)[0].file, 'bad.js');
});

test('this repository is clean', () => {
  const findings = scanDir(path.join(import.meta.dirname, '..'));
  assert.deepEqual(findings, []);
});
