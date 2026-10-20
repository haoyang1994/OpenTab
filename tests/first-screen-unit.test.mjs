import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadLib(relPath) {
  const code = fs.readFileSync(path.join(root, relPath), 'utf8');
  const context = { console, module: { exports: {} } };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

function ymd(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${m}${d}`;
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

{
  const { OpenTabBing } = loadLib('lib/bing-daily.js');
  const now = new Date();
  const today = ymd(now);
  const yesterday = ymd(addDays(now, -1));
  assert.equal(OpenTabBing.shouldCheck({ startdate: yesterday }, now), true, 'U1 yesterday');
  assert.equal(OpenTabBing.shouldCheck({ startdate: today }, now), false, 'U1 today');
  assert.equal(
    OpenTabBing.shouldCheck({ startdate: yesterday, checkedAt: now.getTime() - 61 * 60 * 1000 }, now),
    true,
    'U1 yesterday + checkedAt 1h ago'
  );
  assert.equal(OpenTabBing.shouldCheck({ pinnedDate: today, startdate: yesterday }, now), false, 'U1 pinned today');
  assert.equal(OpenTabBing.shouldCheck(undefined, now), true, 'U1 missing bing');
  assert.equal(OpenTabBing.shouldCheck(null, now), true, 'U1 null bing');

  const entries = [];
  for (let i = 0; i < 12; i += 1) {
    entries.push({ url: `https://www.bing.com/th?id=${i}.jpg`, startdate: ymd(addDays(now, -i)) });
  }
  const kept = OpenTabBing.keepSet(entries);
  assert.ok(kept.length <= 9, 'U1 keepSet max 9');
  assert.ok(kept.some((item) => item.startdate === today), 'U1 keepSet keeps today');
  console.log('U1 passed');
}

{
  const local = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  let master = null;
  try {
    master = JSON.parse(execSync('git show origin/master:manifest.json', {
      encoding: 'utf8',
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore']
    }));
  } catch {
    master = null;
  }
  if (master) {
    assert.deepEqual(local.permissions, master.permissions);
    assert.deepEqual(local.host_permissions, master.host_permissions);
    function cspSources(csp, directive) {
      const chunk = String(csp || '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part === directive || part.startsWith(`${directive} `));
      if (!chunk) return [];
      return chunk.slice(directive.length).trim().split(/\s+/).filter(Boolean);
    }
    function stripImg(csp) {
      return String(csp || '')
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith('img-src'))
        .join('; ');
    }
    const localCsp = local.content_security_policy.extension_pages;
    const masterCsp = master.content_security_policy.extension_pages;
    const localImg = cspSources(localCsp, 'img-src');
    const masterImg = cspSources(masterCsp, 'img-src');
    assert.ok(localImg.includes('blob:'), 'U4 img-src must include blob:');
    assert.deepEqual(
      localImg.filter((src) => src !== 'blob:').sort(),
      masterImg.filter((src) => src !== 'blob:').sort()
    );
    assert.equal(stripImg(localCsp), stripImg(masterCsp));
  }
  console.log('U4 passed');
}

{
  const html = fs.readFileSync(path.join(root, 'home.html'), 'utf8');
  for (const banned of ['北京 (UTC+8)', '10:30', '上午好，今天也很顺利。', '2026年3月21日', '定位中']) {
    assert.equal(html.includes(banned), false, banned);
  }
  const bootIdx = html.indexOf('<script src="boot.js"></script>');
  const contentIdx = html.indexOf('id="content"');
  assert.ok(bootIdx !== -1 && bootIdx < contentIdx, 'boot.js before #content');
  assert.ok(fs.statSync(path.join(root, 'boot.js')).size <= 4096, 'boot.js <= 4KB');
  assert.ok(fs.statSync(path.join(root, 'assets/default_background/default.webp')).size <= 450 * 1024, 'default.webp <= 450KB');
  const search = fs.readFileSync(path.join(root, 'search.js'), 'utf8');
  assert.match(search, /listEngines/);
  assert.match(search, /selectEngine/);
  const homeJs = fs.readFileSync(path.join(root, 'home.js'), 'utf8');
  assert.match(homeJs, /function applyBootMirror/);
  assert.match(homeJs, /showSeconds: state\.showSeconds/);
  console.log('U5 passed');
}

{
  const code = fs.readFileSync(path.join(root, 'boot.js'), 'utf8');
  const el = {
    style: { setProperty() {}, background: '', backgroundImage: '', backgroundSize: '', backgroundPosition: '' },
    classList: { add() {}, remove() {} }
  };
  const context = {
    document: {
      documentElement: el,
      body: el,
      getElementById: () => null
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: true }),
    performance: { mark() {}, measure() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => { fn(); return 1; },
    MutationObserver: class { observe() {} disconnect() {} },
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context);
  const loc = context.OpenTabBoot.isLocalAsset;
  assert.equal(loc('assets/default_background/default.webp'), true);
  assert.equal(loc('chrome-extension://abc/assets/x.webp'), true);
  assert.equal(loc('https://cdn.example/assets/x.webp'), false);
  assert.equal(loc('/assets/x.webp'), false);
  assert.equal(loc('https://www.bing.com/th?id=OHR.x.jpg'), false);
  console.log('isLocalAsset passed');
}

console.log('first-screen unit tests passed');
