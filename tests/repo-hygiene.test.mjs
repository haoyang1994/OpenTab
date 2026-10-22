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
assert.ok(exists('layout.js'), 'layout.js must exist (iteration 7 layout settings)');
assert.ok(exists('settings-nav.js'), 'settings-nav.js must exist (iteration 7 settings panel)');
assert.ok(exists('specs/iter-7.md'), 'specs/iter-7.md must record iteration 7 acceptance criteria');
assert.ok(exists('icons.js'), 'icons.js must exist (iteration 8 icon logic)');
const homeHtml = read('home.html');
assert.match(homeHtml, /<script src="search\.js"><\/script>/, 'home.html must load search.js');
assert.match(homeHtml, /<script src="folders\.js"><\/script>/, 'home.html must load folders.js');
assert.match(homeHtml, /<script src="import\.js"><\/script>/, 'home.html must load import.js');
assert.match(homeHtml, /<script src="sync\.js"><\/script>/, 'home.html must load sync.js');
assert.match(homeHtml, /<script src="layout\.js"><\/script>/, 'home.html must load layout.js');
assert.match(homeHtml, /<script src="settings-nav\.js"><\/script>/, 'home.html must load settings-nav.js');
assert.match(homeHtml, /<script src="lib\/bing-daily\.js"><\/script>/, 'home.html must load lib/bing-daily.js');
assert.match(homeHtml, /<script src="bing-cache\.js"><\/script>/, 'home.html must load bing-cache.js');
assert.match(homeHtml, /<script src="boot\.js"><\/script>/, 'home.html must load boot.js');
assert.match(homeHtml, /<script src="icons\.js"><\/script>/, 'home.html must load icons.js');
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
  homeHtml.indexOf('sync.js') < homeHtml.indexOf('layout.js'),
  'sync.js must load before layout.js'
);
assert.ok(
  homeHtml.indexOf('layout.js') < homeHtml.indexOf('settings-nav.js'),
  'layout.js must load before settings-nav.js'
);
assert.ok(
  homeHtml.indexOf('settings-nav.js') < homeHtml.indexOf('lib/bing-daily.js'),
  'settings-nav.js must load before lib/bing-daily.js'
);
assert.ok(
  homeHtml.indexOf('lib/bing-daily.js') < homeHtml.indexOf('bing-cache.js'),
  'lib/bing-daily.js must load before bing-cache.js'
);
assert.ok(
  homeHtml.indexOf('bing-cache.js') < homeHtml.indexOf('icons.js'),
  'bing-cache.js must load before icons.js'
);
assert.ok(
  homeHtml.indexOf('icons.js') < homeHtml.indexOf('home.js'),
  'icons.js must load before home.js'
);
assert.ok(
  homeHtml.indexOf('folders.js') < homeHtml.indexOf('home.js'),
  'folders.js must load before home.js'
);
assert.match(homeHtml, /data-settings-section="weather"/, 'weather settings section must exist');
for (const id of ['weather-enabled', 'weather-city', 'weather-save', 'weather-unit', 'weather-refresh', 'weather-status']) {
  assert.ok(homeHtml.includes(`id="${id}"`), `weather control ${id} must exist`);
}
assert.ok(homeHtml.indexOf('src="weather.js"') < homeHtml.indexOf('src="home.js"'), 'weather module loads before home initialization');
assert.match(homeHtml, /<script src="weather\.js"><\/script>/);
assert.doesNotMatch(homeHtml, /weather-settings-slot|此分区先占位/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'home.js'), 'utf8'), /navigator\.geolocation|function fetchWeather\(/);

assert.equal(manifest.permissions.includes('tabs'), false, 'BUG-005/AC7: tabs permission must be removed');
assert.ok(manifest.permissions.includes('activeTab'), 'popup uses activeTab');
assert.deepEqual(
  manifest.permissions.slice().sort(),
  ['activeTab', 'storage'].sort(),
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
assert.ok(
  connectSrc.includes('https:'),
  'iter-8: connect-src includes https: so 重新抓取 can fetch a site icon (no new host_permissions)'
);
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
assert.ok(imgSrc.includes('blob:'), 'img-src must allow blob: for Bing cache object URLs');
assert.ok(
  imgSrc.includes('https:'),
  'AC7: img-src retains https: (product: narrow connect-src, keep img-src https:)'
);
assert.equal(
  connectSrc.some((src) => src.includes('baidu') || src.includes('duckduckgo')),
  false,
  'Baidu/DuckDuckGo searches are navigations, not connect-src'
);

assert.ok(exists('tests/console-allow.mjs'), 'BUG-031 shared console allowlist must exist');
assert.equal(
  read('tests/settings-layout.test.mjs').includes("'Failed to load resource'"),
  false,
  'BUG-031 must not blanket-exempt Failed to load resource'
);
assert.match(
  read('tests/settings-layout.test.mjs'),
  /__layoutAtGridReady/,
  'BUG-030 E2E must snapshot layout at opentab:grid-ready'
);
assert.match(
  read('layout.js'),
  /applyFromMirror\(\);\s*readAndApply\(\);/,
  'layout.js must apply the boot mirror at parse, not wait for DOMContentLoaded'
);
assert.match(
  read('settings-nav.js'),
  /section\.id !== 'about' && section\.id !== 'sync'/,
  'BUG-032 global restore must skip the sync section'
);

const homeJs = read('home.js');
assert.match(homeJs, /function applyBootMirror/, 'home.js must apply the boot mirror before loadState');
assert.match(homeJs, /showSeconds: state\.showSeconds/, 'boot mirror must include showSeconds');
assert.match(homeJs, /OpenTabLayout\.bootMirrorSlice\(\)/, 'boot mirror must include layout keys');
assert.match(homeJs, /OpenTabLayout\.loadFromStorage\(result\)/, 'BUG-030 loadState must apply layout before the grid');
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
    `home.js is ${currentHome.length} bytes; baseline is ${masterHome.length}. The 12KB budget is exhausted — move settings/layout code to settings-nav.js and layout.js, and icon code to icons.js, instead of growing home.js.`
  );
}

const catalog = readJson('icons/library/catalog.json');
assert.ok(Array.isArray(catalog) && catalog.length >= 40, 'icon library must cover at least 40 sites');
const cn = catalog.filter((item) => item.region === 'cn').length;
const intl = catalog.filter((item) => item.region === 'intl').length;
assert.ok(cn >= 20 && intl >= 20, `icon library must be half Chinese / half international, got cn=${cn} intl=${intl}`);
for (const item of catalog) {
  assert.ok(exists(`icons/library/${item.slug}.svg`), `missing library tile: ${item.slug}.svg`);
}
assert.ok(exists('icons/library/SIMPLE-ICONS-LICENSE.md'), 'Simple Icons CC0 license must be vendored');
const notice = read('NOTICE');
assert.match(notice, /simple-icons/i, 'NOTICE must credit Simple Icons');
assert.match(notice, /CC0-1\.0/, 'NOTICE must record the CC0-1.0 license for Simple Icons');
assert.match(notice, /not in scope for Apache-2\.0/, 'NOTICE English intro must not mix in a Chinese status phrase');

function walkJs(dir, acc) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'tests' || entry.name === '.git' || entry.name === 'scripts') {
      return;
    }
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJs(abs, acc);
      return;
    }
    if (entry.name.endsWith('.js')) acc.push(path.relative(root, abs).split(path.sep).join('/'));
  });
}
const projectJs = [];
walkJs(root, projectJs);
const fetchAllow = {
  'icons.js': () => true,
  'weather.js': (src) => /fetch\(`https:\/\/wttr\.in\/\$\{encodeURIComponent\(city\)\}/.test(src),
  'background.js': (src) => /bing\.com/.test(src)
};
projectJs.forEach((rel) => {
  const src = read(rel);
  if (!/\bfetch\s*\(/.test(src)) return;
  const allow = fetchAllow[rel];
  assert.ok(allow, `${rel} must not call fetch; only icons.js may fetch arbitrary https sites`);
  assert.ok(allow(src), `${rel} fetch is not limited to the allowlisted hosts`);
});
assert.ok(projectJs.includes('icons.js'), 'icons.js should be scanned for fetch');

console.log('repo-hygiene passed');
