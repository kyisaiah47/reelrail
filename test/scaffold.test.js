import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scaffoldApp } from '../src/app/scaffold.js';
import { tmpdir } from './helpers.js';

const EXAMPLES = path.join(import.meta.dirname, '..');

test('--app console writes the Console view only', () => {
  const res = scaffoldApp({ app: 'console', dir: path.join(tmpdir(), 'site') });
  assert.ok(res.files.includes('src/components/ConsoleView.tsx'));
  assert.ok(!res.files.includes('src/components/SimpleView.tsx'));
  assert.ok(!res.files.some((f) => f.includes('site-view')));
  assert.ok(res.files.includes('.gitignore') && res.files.includes('.env.example'));
});

test('--app simple writes the Simple view only', () => {
  const res = scaffoldApp({ app: 'simple', dir: path.join(tmpdir(), 'site') });
  assert.ok(res.files.includes('src/components/SimpleView.tsx'));
  assert.ok(!res.files.includes('src/components/ConsoleView.tsx'));
});

test('--app both writes both views, the welcome and the view controls, wired to the publication', () => {
  const res = scaffoldApp({ app: 'both', dir: path.join(tmpdir(), 'site'), publication: 'whyyourbraindoesthat', cwd: EXAMPLES });
  for (const f of ['src/components/ConsoleView.tsx', 'src/components/SimpleView.tsx', 'src/components/site-view/Welcome.tsx', 'src/components/site-view/ViewControls.tsx', 'src/components/site-view/SiteViewProvider.tsx']) {
    assert.ok(res.files.includes(f), f);
  }
  const env = fs.readFileSync(path.join(res.dir, '.env.example'), 'utf8');
  assert.match(env, /REELRAIL_PUBLICATION=whyyourbraindoesthat/);
  assert.match(env, /REELRAIL_STORE_PATH=.*out\/store\.json/);
  const all = res.files.map((f) => fs.readFileSync(path.join(res.dir, f), 'utf8')).join('\n');
  assert.ok(!all.includes('__PUBLICATION__') && !all.includes('__STORE_PATH__'), 'every placeholder is filled');
});

test('the scaffold refuses a directory that is not empty', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'x'), 'x');
  assert.throws(() => scaffoldApp({ app: 'console', dir }), /not empty/);
});
