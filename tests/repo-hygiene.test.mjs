import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
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
assert.ok(exists('folders.js'), 'folders.js must exist so home.js can stay within the 12KB budget');
assert.ok(exists('import.js'), 'import.js must exist (iteration 6 import logic)');
assert.ok(exists('sync.js'), 'sync.js must exist (iteration 6 sync logic)');
assert.ok(exists('boot.js'), 'boot.js must exist for first-paint (R1)');
assert.ok(exists('bing-cache.js'), 'bing-cache.js must exist for Bing cache (R2)');
assert.ok(exists('lib/bing-daily.js'), 'lib/bing-daily.js must exist for Bing daily policy (R2)');
assert.ok(exists('assets/default_background/default.webp'), 'default.webp is the first-install wallpaper');
const homeHtml = read('home.html');
assert.match(homeHtml, /<script src="search\.js"><\/script>/, 'home.html must load search.js');
assert.match(homeHtml, /<script src="folders\.js"><\/script>/, 'home.html must load folders.js');
assert.match(homeHtml, /<script src="import\.js"><\/script>/, 'home.html must load import.js');
assert.match(homeHtml, /<script src="sync\.js"><\/script>/, 'home.html must load sync.js');
assert.match(homeHtml, /<script src="lib\/bing-daily\.js"><\/script>/, 'home.html must load lib/bing-daily.js');
assert.match(homeHtml, /<script src="bing-cache\.js"><\/script>/, 'home.html must load bing-cache.js');
assert.match(homeHtml, /<script src="boot\.js"><\/script>/, 'home.html must load boot.js');
assert.ok(
  homeHtml.indexOf('boot.js') < homeHtml.indexOf('id="content"'),
  'boot.js must load before #content'
);
assert.ok(
  homeHtml.indexOf('search.js') < homeHtml.indexOf('import.js'),
  'search.js must load before import.js'
);
assert.ok(
  homeHtml.indexOf('import.js') < homeHtml.indexOf('sync.js'),
  'import.js must load before sync.js'
);
assert.ok(
  homeHtml.indexOf('sync.js') < homeHtml.indexOf('lib/bing-daily.js'),
  'sync.js must load before lib/bing-daily.js'
);
assert.ok(
  homeHtml.indexOf('lib/bing-daily.js') < homeHtml.indexOf('bing-cache.js'),
  'lib/bing-daily.js must load before bing-cache.js'
);
assert.ok(
  homeHtml.indexOf('bing-cache.js') < homeHtml.indexOf('home.js'),
  'bing-cache.js must load before home.js'
);
assert.ok(
  homeHtml.indexOf('folders.js') < homeHtml.indexOf('home.js'),
  'folders.js must load before home.js'
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
  'AC7: img-src retains https: (product: narrow connect-src, keep img-src https:)'
);
assert.equal(
  connectSrc.some((src) => src.includes('baidu') || src.includes('duckduckgo')),
  false,
  'Baidu/DuckDuckGo searches are navigations, not connect-src'
);

const homeJs = read('home.js');
const nativeDialogs = [...homeJs.matchAll(/\b(prompt|confirm|alert)\s*\(/g)].map((match) => match[0]);
assert.ok(
  nativeDialogs.every((call) => call.startsWith('alert')),
  `home.js native dialogs must only be the SSH alert, got: ${nativeDialogs.join(', ') || '(none)'}`
);
assert.ok(nativeDialogs.length <= 1, `home.js should have at most one native dialog, got ${nativeDialogs.length}`);
if (nativeDialogs.length === 1) {
  assert.match(homeJs, /alert\('请输入有效的 SSH 配置/);
}

function gitShow(ref, file) {
  try {
    return execSync(`git show ${ref}:${file}`, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 10 * 1024 * 1024
    });
  } catch {
    return null;
  }
}

const homeJsRefs = [
  process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
  'origin/master',
  'master'
].filter(Boolean);
let masterHome = null;
for (const ref of homeJsRefs) {
  masterHome = gitShow(ref, 'home.js');
  if (masterHome) break;
}
if (masterHome) {
  const currentHome = fs.readFileSync(path.join(root, 'home.js'));
  assert.ok(
    currentHome.length <= masterHome.length,
    `home.js is ${currentHome.length} bytes; baseline is ${masterHome.length}. The 12KB budget is exhausted — move grid/folder code to folders.js instead of growing home.js.`
  );
}

console.log('repo-hygiene passed');
