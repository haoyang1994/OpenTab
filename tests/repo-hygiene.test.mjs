import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

const license = read('LICENSE');
assert.match(license, /Apache License/, 'LICENSE must contain "Apache License"');
assert.match(license, /Version 2\.0, January 2004/, 'LICENSE must contain "Version 2.0, January 2004"');

const pkg = readJson('package.json');
const manifest = readJson('manifest.json');
assert.equal(pkg.license, 'Apache-2.0', 'package.json license must be Apache-2.0');
assert.equal(pkg.version, manifest.version, 'package.json version must match manifest.json version');

const requiredFiles = [
  'NOTICE',
  'README.md',
  'README.zh-CN.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'CHANGELOG.md'
];
for (const file of requiredFiles) {
  assert.ok(exists(file), `missing required file: ${file}`);
}

const removedFiles = [
  'FIX50SP2.xml',
  'fix_values.js',
  'fix_tags_new.js',
  'test.mjs'
];
for (const file of removedFiles) {
  assert.ok(!exists(file), `removed file must not exist: ${file}`);
}

const vendorLicenses = [
  'vendor/flatpickr/LICENSE.md',
  'vendor/xterm/LICENSE',
  'vendor/xterm-addon-fit/LICENSE'
];
for (const file of vendorLicenses) {
  assert.ok(exists(file), `missing vendored LICENSE: ${file}`);
}

const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
const attrRe = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
const skipProtocol = /^(https?:|data:|mailto:|javascript:|chrome:|chrome-extension:|#)/i;

for (const file of htmlFiles) {
  const text = read(file);
  attrRe.lastIndex = 0;
  let match;
  while ((match = attrRe.exec(text))) {
    const ref = match[2].trim();
    if (!ref) continue;
    if (skipProtocol.test(ref)) continue;
    assert.ok(
      !ref.startsWith('node_modules/'),
      `${file} must not load local assets from node_modules/: ${ref}`
    );

    const clean = ref.split(/[?#]/)[0];
    const resolved = path.normalize(path.join(root, clean));
    assert.ok(
      resolved === root || resolved.startsWith(root + path.sep),
      `${file} has out-of-tree local reference: ${ref}`
    );
    assert.ok(
      fs.existsSync(resolved),
      `${file} references missing local file: ${ref}`
    );
  }
}

console.log('repo-hygiene passed');
