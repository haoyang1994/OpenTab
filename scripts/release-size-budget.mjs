import assert from 'node:assert/strict';
import path from 'node:path';

export const ADDED_RUNTIME_BUDGET_BYTES = 300 * 1024;
// Keep this inventory in parity with package-release.py (checked by the regression suite).
export const RUNTIME_DIRS = new Set(['assets', 'icons', 'lib', 'locales', '_locales', 'vendor']);

export function runtimePath(name) {
  const parts = name.split('/');
  return (parts.length === 1 && (['.js', '.css', '.html'].includes(path.posix.extname(name)) ||
    ['manifest.json', 'LICENSE', 'NOTICE'].includes(name))) || RUNTIME_DIRS.has(parts[0]);
}

// Pure accounting: callers supply filesystem sizes so fixtures need no release or network.
// This corrects the added-file gate's scope to the reviewed shipped inventory, not dev
// tests/docs. The 300 KiB ceiling is unchanged; an omitted runtime file is an error.
export function checkAddedRuntimeBudget({ addedNames, releaseFiles, fileSizes }) {
  assert.ok(Array.isArray(releaseFiles) && releaseFiles.every((name) => typeof name === 'string'),
    'Release allowlist must be an array of paths');
  assert.deepEqual(releaseFiles, [...new Set(releaseFiles)].sort(), 'Release allowlist must be sorted and unique');
  const allowed = new Set(releaseFiles);
  for (const name of allowed) {
    assert.ok(name && !name.includes('\\') && !path.posix.isAbsolute(name) &&
      name.split('/').every((part) => part && !part.startsWith('.')) && runtimePath(name),
    `Invalid release runtime path: ${name}`);
    assert.ok(Number.isSafeInteger(fileSizes.get(name)) && fileSizes.get(name) >= 0,
      `Missing regular release file: ${name}`);
  }
  let bytes = 0;
  for (const name of new Set(addedNames)) {
    if (!runtimePath(name)) continue;
    assert.ok(allowed.has(name), `Added runtime file is not in reviewed release allowlist: ${name}`);
    bytes += fileSizes.get(name);
  }
  assert.ok(bytes <= ADDED_RUNTIME_BUDGET_BYTES,
    `AC6: added shipped runtime files ${bytes} bytes exceed 300KB`);
  return bytes;
}
