// What `npm publish` would ship. Local run state, renders and downloaded footage must never be in
// the tarball: they hold machine paths, and stock footage may not be redistributed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('the npm tarball holds only source, templates, the example config and docs', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const [pkg] = JSON.parse(out);
  const allowed = /^(src\/|templates\/|examples\/[^/]+\/(publication|subjects|facts)\.json$|examples\/[^/]+\/voice\.md$|scripts\/make-sample-media\.mjs$|README\.md$|LICENSE$|package\.json$)/;
  const stray = pkg.files.map((f) => f.path).filter((p) => !allowed.test(p));
  assert.deepEqual(stray, []);
  assert.ok(pkg.size < 1_000_000, `tarball is ${pkg.size} bytes`);
});
