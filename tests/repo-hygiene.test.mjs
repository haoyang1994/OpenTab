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

assert.ok(exists('search.js'), 'search.js must exist (iteration 4 search logic)');
const homeHtml = read('home.html');
assert.match(homeHtml, /<script src="search\.js"><\/script>/, 'home.html must load search.js');
assert.ok(
  homeHtml.indexOf('search.js') < homeHtml.indexOf('home.js'),
  'search.js must load before home.js'
);

assert.equal(manifest.permissions.includes('tabs'), false, 'BUG-005/AC7: tabs permission must be removed');
assert.ok(manifest.permissions.includes('activeTab'), 'popup uses activeTab');
assert.deepEqual(
  manifest.permissions.slice().sort(),
  ['activeTab', 'geolocation', 'storage'].sort(),
  'must not add new permissions'
);

function cspSources(csp, directive) {
  const chunk = String(csp || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === directive || part.startsWith(`${directive} `));
  if (!chunk) return [];
  return chunk.slice(directive.length).trim().split(/\s+/).filter(Boolean);
}

const csp = manifest.content_security_policy.extension_pages;
const connectSrc = cspSources(csp, 'connect-src');
const imgSrc = cspSources(csp, 'img-src');
assert.equal(connectSrc.includes('ws:'), false, 'AC7: connect-src must not allow blanket ws:');
assert.equal(connectSrc.includes('wss:'), false, 'AC7: connect-src must not allow blanket wss:');
assert.equal(connectSrc.includes('https:'), false, 'AC7: connect-src must not allow all https');
assert.ok(
  connectSrc.some((src) => src.startsWith('ws://127.0.0.1')),
  'SSH loopback ws://127.0.0.1 must remain in connect-src'
);
assert.ok(
  connectSrc.some((src) => src.startsWith('ws://localhost')),
  'SSH loopback ws://localhost must remain in connect-src'
);
assert.ok(connectSrc.includes('https://wttr.in'), 'weather fetch needs wttr.in in connect-src');
assert.ok(imgSrc.includes("'self'"), 'img-src must keep self');
assert.ok(imgSrc.includes('data:'), 'img-src must keep data: for uploads');
assert.ok(
  imgSrc.includes('https:'),
  'img-src keeps https: for user shortcut favicons and custom wallpaper URLs'
);
assert.equal(
  connectSrc.some((src) => src.includes('baidu') || src.includes('duckduckgo')),
  false,
  'Baidu/DuckDuckGo searches are navigations, not connect-src'
);

console.log('repo-hygiene passed');
