import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDED_RUNTIME_BUDGET_BYTES, RUNTIME_DIRS, runtimePath, checkAddedRuntimeBudget } from '../scripts/release-size-budget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(ADDED_RUNTIME_BUDGET_BYTES, 300 * 1024, 'the existing numeric ceiling must not increase');

// Actions defaults to a single detached PR merge commit. The budget intentionally
// fails closed without origin/master, so CI must fetch the actual baseline refs.
function assertCheckoutBaseline(workflow) {
  const checkout = workflow.match(/      - name: Checkout\n[\s\S]*?(?=\n      - name:|$)/)?.[0] || '';
  assert.match(checkout, /^\s+fetch-depth:\s*0\s*$/m, 'CI checkout must retain baseline history and refs');
}
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
assertCheckoutBaseline(workflow);
assert.throws(() => assertCheckoutBaseline(workflow.replace('fetch-depth: 0', 'fetch-depth: 1')), /baseline history/);
assert.throws(() => assertCheckoutBaseline(workflow.replace(/^.*fetch-depth: 0.*\n/m, '')), /baseline history/);

function fixture(files, releaseFiles, addedNames = Object.keys(files)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opentab-runtime-budget-'));
  try {
    for (const [name, data] of Object.entries(files)) {
      const absolute = path.join(directory, name);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, data);
    }
    const fileSizes = new Map(releaseFiles.map((name) => {
      const stat = fs.lstatSync(path.join(directory, name), { throwIfNoEntry: false });
      return [name, stat?.isFile() ? stat.size : undefined];
    }));
    return checkAddedRuntimeBudget({ addedNames, releaseFiles, fileSizes });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const oversized = Buffer.alloc(ADDED_RUNTIME_BUDGET_BYTES + 1);
assert.throws(() => fixture({ 'new-runtime.js': oversized }, ['new-runtime.js']), /AC6:.*exceed 300KB/,
  'one oversized shipped runtime file still rejects');
assert.equal(fixture({ 'new-runtime.js': oversized.subarray(1) }, ['new-runtime.js']), ADDED_RUNTIME_BUDGET_BYTES,
  'exactly 300 KiB of added runtime is allowed');
assert.equal(fixture({
  'new-runtime.js': 'ok',
  'tests/large.test.mjs': oversized,
  'tests/browser-fixture.js': oversized,
  'docs/large.md': oversized,
  'scripts/developer-helper.js': oversized,
  'README.md': oversized
}, ['new-runtime.js']), 2, 'equally large tests/docs/developer helpers do not ship and are excluded');
assert.throws(() => fixture({ 'new-runtime.js': 'ok' }, ['missing-runtime.js', 'new-runtime.js']),
  /Missing regular release file: missing-runtime.js/, 'all allowlisted files must exist, even when not added');
assert.throws(() => fixture({ 'assets/directory/image.svg': 'image' }, ['assets/directory']),
  /Missing regular release file: assets\/directory/, 'a directory cannot be counted as a regular release file');
assert.throws(() => fixture({ 'scene.js': 'new runtime' }, []),
  /Added runtime file is not in reviewed release allowlist: scene.js/, 'an omitted added runtime script must not pass as excluded');

// These paths may be selected dynamically, with no literal reference in HTML/JS.
// Directory inventory, not a reference grep or a file-extension filter, covers them.
const dynamicPaths = [
  '_locales/next/messages.json', 'assets/backgrounds/new.avif', 'icons/library/new.svg',
  'lib/nested/lazy.js', 'locales/next.js', 'vendor/new/LICENSE'
];
for (const name of dynamicPaths) {
  assert.equal(fixture({ [name]: 'payload' }, [name]), 7, `dynamic runtime asset counts: ${name}`);
  assert.throws(() => fixture({ [name]: 'payload' }, []),
    /Added runtime file is not in reviewed release allowlist/, `omitted dynamic runtime asset rejects: ${name}`);
}
assert.throws(() => fixture({
  'assets/backgrounds/new.avif': Buffer.alloc(150 * 1024),
  'locales/next.js': Buffer.alloc(150 * 1024 + 1)
}, ['assets/backgrounds/new.avif', 'locales/next.js']), /AC6:.*exceed 300KB/,
  'dynamic assets aggregate toward the same ceiling');
assert.equal(fixture({ 'runtime with spaces.js': 'abc' }, ['runtime with spaces.js'],
  ['runtime with spaces.js', 'runtime with spaces.js']), 3, 'duplicate Git results count once without splitting spaces');
assert.equal(fixture({ 'existing.js': oversized, 'new.js': 'ok' }, ['existing.js', 'new.js'], ['new.js']), 2,
  'existing runtime is validated but this gate still budgets only added files');

// Fail if the packaging inventory changes without updating this helper, including
// new runtime directories and arbitrary asset suffixes (not just today's assets).
const paths = [
  'entry.js', 'entry.css', 'entry.html', 'manifest.json', 'LICENSE', 'NOTICE',
  'README.md', 'package.json', 'ssh-gateway.mjs', 'unknown.json', 'entry.JS',
  'tests/fixture.js', 'docs/page.html', 'scripts/helper.js', 'other/entry.js',
  ...dynamicPaths,
  ...[...RUNTIME_DIRS].flatMap((directory) => [directory, `${directory}/arbitrary.bin`, `${directory}/nested/asset.mjs`])
];
const packaging = JSON.parse(execFileSync('python3', ['-B', '-c', `
import json, runpy, sys
module = runpy.run_path(sys.argv[1])
names = json.load(sys.stdin)
print(json.dumps({'directories': sorted(module['RUNTIME_DIRS']), 'paths': [module['runtime_path'](name) for name in names]}))
`, path.join(root, 'scripts/package-release.py')], { input: JSON.stringify(paths), encoding: 'utf8' }));
assert.deepEqual([...RUNTIME_DIRS].sort(), packaging.directories, 'runtime directories must match the release packager');
assert.deepEqual(paths.map(runtimePath), packaging.paths, 'runtime classification must match package-release.py runtime_path');

console.log('Shipped-runtime size budget regressions passed: unchanged 300 KiB ceiling, dev-file exclusion, missing/unreviewed runtime rejection, dynamic assets, and packager parity.');
