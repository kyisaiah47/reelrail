#!/usr/bin/env node
// THE SCRUB GATE. It fails closed when any file this repo would publish carries:
//
//   - a personal email address of the maintainers
//   - a home-directory path (/Users/<name>, /home/<name>)
//   - a hosted database project id, a Stripe account id, an internal secret-tool name
//   - one of the maintainers' account handles, or a DID
//   - a key-shaped string (OpenAI, Anthropic, Google, GitHub, Slack, AWS, Stripe, npm, Supabase,
//     Pixabay, Pexels, private key blocks, JWTs, and long secrets assigned to key-like names)
//   - bot-detection bypass code: stealth plugins, paid captcha services, and overrides of the
//     browser's automation flag
//
// The named strings are stored as salted SHA-256 hashes, so this file does not publish the list
// it protects. Every file is tokenized (email local parts, @handles, host names, bare words) and
// each token's hash is compared with the list. The generic shapes are regular expressions written
// so that they do not match their own source text.
//
//   node scripts/scrub-gate.mjs [dir]     exit 0 clean, exit 1 with every finding listed
//
// It has no flag that skips a finding, no allowlist and no known-issues file. If it cannot list
// or read a file, it fails.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SALT = 'reelrail-scrub:';
export const hash = (t) => crypto.createHash('sha256').update(SALT + String(t).toLowerCase()).digest('hex').slice(0, 32);

const HASHES = {
  email: new Set([
    '9e778c4fd01a6bbbfbd2d728e378d957', '7cbbc6414b021e2ec828d766d0da56ab', 'b35ae8a0f26cbfab59d1174d0d08f994',
    '613d1f642c0329956a1ba5513fb9bb8a', 'f3c7e269e1bd6772c44267bc6e2d9daa', '0c0ee0aefd0d69bd379acc78657d685a',
  ]),
  handle: new Set([
    '479747db777248903c9e8352e56927cc', '82431f28c730ef7118570cf50a0afdb4', '8d008353d9f0e3a9b0c7c1c5a082ac93',
    'c83a4ee283bbbc3611308ed6cccdc245', 'f89271fd6534cde425f2cfe73d13efab', '9e778c4fd01a6bbbfbd2d728e378d957',
    '08415d104a6272b979e444acec9f0443', 'fc5a94008c3a8107c7078822f652eb10', 'de40ee22695c11dc8d70cba19f4a1c1d',
    '21bd844c29323b7428104bfcea812054', 'b0e2a8c58b814d4b1937bbaf587a20de', 'b4f4613c06787e4e8907bab2670e24ae',
    '6f5ccfcf49bcbc3fcdb39e78a15e838d', '043b4ee69fca2d84d1842b69a6f16565', '78b8723c44cff21132de85dfd5c4b44d',
  ]),
  host: new Set(['78b8723c44cff21132de85dfd5c4b44d']),
  word: new Set(['c474007ea076c5576bbdc568a63c347e', '65318a14cae1d14cca501986d44820bf', '67561b293170b3ddb9763276c7c944aa']),
};

// [kind, regex]. Each source is written so it cannot match itself: a bracketed single character
// (ste[a]lth) or a character class right after a literal prefix (AIza[...]) breaks the literal.
export const SHAPES = [
  ['home path', /\/Users\/[A-Za-z0-9._-]+|\/home\/[a-z][a-z0-9_-]+\//],
  ['DID', /\bdid:plc:[a-z2-7]{24}\b/],
  ['Stripe account id', /\bacct_[A-Za-z0-9]{8,}\b/],
  ['hosted database URL', /\bhttps:\/\/[a-z]{20}\.supabase\.co\b/],
  ['OpenAI or Anthropic key', /\bsk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{24,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['Slack token', /\bxox[abpors]-[A-Za-z0-9-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/],
  ['Stripe key', /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/],
  ['webhook secret', /\bwhsec_[A-Za-z0-9]{16,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Supabase token', /\bsbp_[a-f0-9]{40}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Pixabay key', /\b\d{7,9}-[a-f0-9]{25}\b/],
  ['Pexels key', /\b(?=[A-Za-z0-9]{56}\b)(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{56}\b/],
  ['secret assigned to a key name', /\b(?:api[_-]?key|secret|token|passw(?:or)?d|access[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9_\-/+=]{28,})["']/i],
  ['stealth plugin', /puppeteer[-]extra|playwright[-]extra|St[e]althPlugin|ste[a]lth\.min\.js|undetected[-]chromedriver|selenium[-]stealth/i],
  ['captcha service', /2c[a]ptcha|anti[-]?c[a]ptcha|caps[o]lver|capm[o]nster|c[a]ptcha.?solv|solv(?:e|ing).?c[a]ptcha|nope[c]ha|death.?by.?c[a]ptcha/i],
  ['automation flag override', /navigator\s*\.\s*webdr[i]ver\s*=|defineProperty\(\s*navigator\s*,\s*['"]webdr[i]ver|delete\s+navigator\.webdr[i]ver|disable-blink-features=Autom[a]tionControlled|excludeSwitch[e]s|enable-autom[a]tion/i],
];

const TOKENS = [
  ['email', /([A-Za-z0-9._%+-]+)@/g],
  ['handle', /(?<![\w.@/])@([A-Za-z0-9_.]{2,})/g],
  ['host', /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi],
  ['word', /\b([a-z]+-[a-z]+|[a-z]{20})\b/g],
];

/** Every finding in one text. [{ kind, line, detail }]. Matched secrets are never printed whole. */
export function scanText(text, { extra = {} } = {}) {
  const findings = [];
  const lines = String(text).split('\n');
  lines.forEach((ln, i) => {
    for (const [kind, re] of SHAPES) {
      const m = re.exec(ln);
      if (m) findings.push({ kind, line: i + 1, detail: `${m[0].slice(0, 6)}...` });
    }
    for (const [group, re] of TOKENS) {
      const set = new Set([...HASHES[group], ...(extra[group] || [])]);
      for (const m of ln.matchAll(re)) {
        const tok = m[1].replace(/\.+$/, '');
        if (set.has(hash(tok))) findings.push({ kind: `listed ${group}`, line: i + 1, detail: `${tok.slice(0, 2)}...` });
      }
    }
  });
  return findings;
}

function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).map((f) => path.join(root, f));
  } catch {
    const acc = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else acc.push(p);
      }
    };
    walk(root);
    return acc;
  }
}

export function scanDir(root, opts = {}) {
  const findings = [];
  for (const file of listFiles(root)) {
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) continue;
    for (const f of scanText(buf.toString('utf8'), opts)) findings.push({ file: path.relative(root, file), ...f });
  }
  return findings;
}

if (import.meta.filename === process.argv[1]) {
  const root = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..'));
  let findings;
  try {
    findings = scanDir(root);
  } catch (e) {
    console.error(`scrub gate could not scan ${root}: ${e.message}`);
    process.exit(1);
  }
  if (findings.length) {
    console.error(`scrub gate: ${findings.length} finding(s)`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.kind}  ${f.detail}`);
    process.exit(1);
  }
  console.log(`scrub gate: clean (${listFiles(root).length} files scanned)`);
}
