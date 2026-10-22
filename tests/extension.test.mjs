import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { formatConsoleError, isAllowedConsoleError, unexpectedErrors } from './console-allow.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '..');
const HOME = 'folder-home';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const ARTIFACTS = fs.existsSync('/opt/cursor/artifacts')
  ? '/opt/cursor/artifacts'
  : path.join(EXTENSION_PATH, 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });

const VENDOR_FILES = [
  'vendor/flatpickr/flatpickr.min.css',
  'vendor/flatpickr/flatpickr.min.js',
  'vendor/flatpickr/l10n/zh.js',
  'vendor/xterm/xterm.css',
  'vendor/xterm/xterm.js',
  'vendor/xterm-addon-fit/xterm-addon-fit.js'
];

const PRESET_BACKGROUNDS = [
  'assets/default_background/default.webp',
  'assets/default_background/bg-mountain-dawn.jpg',
  'assets/default_background/bg-forest-golden.jpg',
  'assets/default_background/bg-ocean-night.jpg'
];

const LEGACY_PEXELS_TO_PRESET = [
  {
    legacy: 'assets/default_background/pexels-pixabay-40896.jpg',
    expected: 'assets/default_background/bg-forest-golden.jpg'
  },
  {
    legacy: 'assets/default_background/pexels-elina-sazonova-4275497.jpg',
    expected: 'assets/default_background/bg-mountain-dawn.jpg'
  },
  {
    legacy: 'assets/default_background/pexels-souvenirpixels-417074.jpg',
    expected: 'assets/default_background/bg-mountain-dawn.jpg'
  }
];

const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function attachErrorCollectors(target, buckets) {
  const onPageError = (error) => {
    buckets.page.push(String(error?.message || error));
  };
  const onConsole = (msg) => {
    if (msg.type() === 'error') buckets.console.push(formatConsoleError(msg));
  };
  target.on('pageerror', onPageError);
  target.on('console', onConsole);
  return () => {
    target.off('pageerror', onPageError);
    target.off('console', onConsole);
  };
}

function collectPageErrors(page, errors) {
  return attachErrorCollectors(page, { page: errors, console: errors });
}

function assertValidPngFile(absPath, label) {
  const buf = fs.readFileSync(absPath);
  assert.ok(
    buf.length >= 33 && buf.subarray(0, 8).equals(PNG_SIGNATURE),
    `${label} must start with a PNG signature`
  );
  const chunkLength = buf.readUInt32BE(8);
  const chunkType = buf.subarray(12, 16).toString('ascii');
  assert.equal(chunkType, 'IHDR', `${label} must have an IHDR chunk`);
  assert.equal(chunkLength, 13, `${label} IHDR length must be 13`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.ok(width > 0 && height > 0, `${label} PNG dimensions must be positive`);
}

function collectManifestIconPaths(value, iconPaths) {
  if (!value) return;
  if (typeof value === 'string') {
    iconPaths.add(value);
    return;
  }
  for (const rel of Object.values(value)) {
    if (typeof rel === 'string') iconPaths.add(rel);
  }
}

function assertManifestIconsAreValidPng() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
  const iconPaths = new Set();
  collectManifestIconPaths(manifest.icons, iconPaths);
  collectManifestIconPaths(manifest.action?.default_icon, iconPaths);
  assert.ok(iconPaths.size > 0, 'manifest.json must declare icons and/or action.default_icon');
  for (const rel of iconPaths) {
    const absPath = path.join(EXTENSION_PATH, rel);
    assert.ok(fs.existsSync(absPath), `missing manifest icon: ${rel}`);
    assertValidPngFile(absPath, rel);
  }
}

async function readStoredBackground(serviceWorker) {
  return serviceWorker.evaluate(() => new Promise((resolve) => {
    chrome.storage.local.get(['background'], (result) => resolve(result.background || null));
  }));
}

async function writeStoredBackground(serviceWorker, background) {
  await serviceWorker.evaluate((bg) => new Promise((resolve) => {
    chrome.storage.local.set({ background: bg }, resolve);
  }), background);
}

async function loadHomeWithBackground(page, serviceWorker, extensionId, background) {
  await writeStoredBackground(serviceWorker, background);
  const errors = [];
  const failed = [];
  const onFailed = (request) => failed.push(request.url());
  const stopCollecting = collectPageErrors(page, errors);
  page.on('requestfailed', onFailed);
  try {
    await page.goto(`chrome-extension://${extensionId}/home.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await page.waitForSelector('#time', { timeout: 10000 });
    await page.waitForTimeout(350);
    const stored = await readStoredBackground(serviceWorker);
    return { stored, errors, failed };
  } finally {
    stopCollecting();
    page.off('requestfailed', onFailed);
  }
}

function assertNoLegacyAssetFetch(failed, label) {
  const pexelsFailed = failed.filter((url) => url.includes('pexels'));
  assert.equal(
    pexelsFailed.length,
    0,
    `${label}: legacy Pexels asset requested: ${pexelsFailed.join(' | ')}`
  );
}

function assertVendoredRuntimeAssets() {
  const htmlFiles = fs.readdirSync(EXTENSION_PATH).filter(name => name.endsWith('.html'));
  assert.ok(htmlFiles.length > 0, 'expected HTML files in the extension root');
  for (const relativePath of htmlFiles) {
    const html = fs.readFileSync(path.join(EXTENSION_PATH, relativePath), 'utf8');
    assert.equal(
      html.includes('node_modules/'),
      false,
      `${relativePath} must not load runtime assets from node_modules/`
    );
  }

  for (const relativePath of VENDOR_FILES) {
    assert.ok(
      fs.existsSync(path.join(EXTENSION_PATH, relativePath)),
      `Missing vendored runtime file: ${relativePath}`
    );
  }
}

function assertReplacementAssets() {
  const homeHtml = fs.readFileSync(path.join(EXTENSION_PATH, 'home.html'), 'utf8');
  assert.equal(homeHtml.includes('pexels'), false, 'home.html should not reference Pexels files');
  for (const relativePath of PRESET_BACKGROUNDS) {
    assert.ok(homeHtml.includes(relativePath), `home.html should reference ${relativePath}`);
    assert.ok(
      fs.existsSync(path.join(EXTENSION_PATH, relativePath)),
      `missing bundled background: ${relativePath}`
    );
  }

  const backgroundDir = path.join(EXTENSION_PATH, 'assets/default_background');
  for (const name of fs.readdirSync(backgroundDir)) {
    assert.equal(name.toLowerCase().includes('pexels'), false, `legacy Pexels file still present: ${name}`);
  }

  for (const name of ['icon16.png', 'icon48.png', 'icon128.png', 'opentab-icon.svg']) {
    assert.ok(fs.existsSync(path.join(EXTENSION_PATH, 'icons', name)), `missing icon: ${name}`);
  }
}

function resolveHeadless(defaultValue) {
  if (process.env.HEADLESS === 'false') return false;
  if (process.env.HEADLESS === 'true') return true;
  return defaultValue;
}

function isExemptConsoleError(text) {
  return isAllowedConsoleError(text);
}

function isAllowedNetwork(url) {
  return url.startsWith('chrome-extension://')
    || url.startsWith('data:')
    || url.startsWith('blob:')
    || url.includes('bing.com')
    || url.includes('wttr.in');
}

function isThirdPartyIconRequest(url, resourceType) {
  if (isAllowedNetwork(url)) return false;
  if (!/^https?:/i.test(url)) return false;
  return resourceType === 'image'
    || resourceType === 'fetch'
    || resourceType === 'xhr'
    || /favicon|apple-touch|manifest\.webmanifest|site\.webmanifest|\/manifest\.json|\.ico(\?|$)/i.test(url);
}

function shortcut(id, name, url, folderId = HOME, extra = {}) {
  return {
    id,
    name,
    url,
    folderId,
    type: 'shortcut',
    parentId: '',
    customIconUrl: '',
    emoji: '',
    uploadedIconDataUrl: PIXEL,
    resolvedIconUrl: PIXEL,
    iconCandidates: [PIXEL],
    ...extra
  };
}

function folderIcon(id, name, folderId = HOME) {
  return {
    id,
    name,
    type: 'folder',
    folderId,
    parentId: '',
    url: '',
    emoji: '',
    customIconUrl: '',
    uploadedIconDataUrl: '',
    resolvedIconUrl: '',
    iconCandidates: []
  };
}

function folders(...extra) {
  return [{ id: HOME, name: '主页' }, ...extra];
}

function groupSelector(id) {
  return `#group-tabs [data-group-id="${cssEscape(id)}"]`;
}

function readMasterManifest() {
  const refs = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    'origin/master',
    'master'
  ].filter(Boolean);
  for (const ref of refs) {
    try {
      return JSON.parse(execSync(`git show ${ref}:manifest.json`, {
        encoding: 'utf8',
        cwd: EXTENSION_PATH,
        stdio: ['ignore', 'pipe', 'ignore']
      }));
    } catch {
      // try next ref
    }
  }
  return null;
}

async function waitForGrid(page) {
  await page.waitForSelector('#add-shortcut-tile', { timeout: 10000 });
  await page.waitForSelector('#group-tabs .group-tab', { timeout: 10000 });
  await page.waitForFunction(
    () => performance.getEntriesByName('opentab:grid-ready').length > 0,
    null,
    { timeout: 10000 }
  );
}

async function writeHomeStorage(page, payload, clear) {
  const worker = page.context().serviceWorkers()[0];
  const target = worker || page;
  await target.evaluate(async ({ data, shouldClear }) => {
    if (shouldClear) await chrome.storage.local.clear();
    await chrome.storage.local.set(data);
  }, { data: payload, shouldClear: clear });
}

async function resetHome(page, payload, options = {}) {
  const homeUrl = page.url();
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
  // Unrelated grid/import cases must not depend on live Bing responses.
  // Explicit background fixtures still override this local, offline default.
  await writeHomeStorage(page, {
    background: { type: 'image', value: 'assets/default_background/default.webp', source: 'preset' },
    ...payload
  }, options.clear !== false);
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#time', { timeout: 10000 });
  await waitForGrid(page);
  const currentId = payload.currentFolderId || HOME;
  const expectedIds = (payload.icons || []).filter((icon) => (
    (icon.folderId || HOME) === currentId && !(icon.parentId)
  )).map((icon) => icon.id);
  await page.waitForFunction(
    (ids) => {
      const nodes = [...document.querySelectorAll('#icons-container .icon-widget[data-id]')];
      if (nodes.length !== ids.length) return false;
      return ids.every((id) => nodes.some((node) => node.dataset.id === id));
    },
    expectedIds,
    { timeout: 10000 }
  );
}

async function desktopOrder(page) {
  return page.$$eval('#icons-container .icon-widget[data-id]', els => els.map(el => el.dataset.id));
}

async function storageIconIds(page) {
  return page.evaluate(async () => {
    const result = await chrome.storage.local.get(['icons']);
    return (result.icons || []).map(icon => icon.id);
  });
}

async function storedIconGraph(page) {
  return page.evaluate(async () => {
    const result = await chrome.storage.local.get(['icons']);
    return (result.icons || []).map((icon) => ({
      id: icon.id,
      type: icon.type,
      parentId: icon.parentId || ''
    }));
  });
}

async function overlayIconIds(page) {
  return page.$$eval('#folder-icons-container .icon-widget[data-id]', (els) => els.map((el) => el.dataset.id));
}

async function exportBackupJson(page) {
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-panel:not(.hidden)');
  const text = await page.evaluate(() => new Promise((resolve, reject) => {
    const orig = URL.createObjectURL.bind(URL);
    const timer = setTimeout(() => {
      URL.createObjectURL = orig;
      reject(new Error('backup export timed out'));
    }, 4000);
    URL.createObjectURL = (blob) => {
      clearTimeout(timer);
      URL.createObjectURL = orig;
      blob.text().then(resolve, reject);
      return orig(blob);
    };
    document.getElementById('backup-download-btn').click();
  }));
  await page.click('#close-settings');
  await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));
  return text;
}

async function importBackupJson(page, jsonText) {
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-panel:not(.hidden)');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    page.setInputFiles('#backup-import-file', {
      name: 'opentab-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(jsonText)
    })
  ]);
  await page.waitForSelector('#time', { timeout: 10000 });
  await waitForGrid(page);
}

async function restoreLatestSnapshot(page) {
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-panel:not(.hidden)');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    page.click('#backup-restore-snapshot-btn')
  ]);
  await page.waitForSelector('#time', { timeout: 10000 });
  await waitForGrid(page);
}

function nestedFolderFixture() {
  return {
    folders: folders(),
    currentFolderId: HOME,
    icons: [
      folderIcon('pack', '文件夹'),
      shortcut('p1', 'P1', 'https://example.com/p1', HOME, { parentId: 'pack' }),
      shortcut('p2', 'P2', 'https://example.com/p2', HOME, { parentId: 'pack' }),
      shortcut('solo', 'Solo', 'https://example.com/solo')
    ]
  };
}

async function assertNestedFolderKept(page, label) {
  await page.waitForSelector(widgetSelector('pack'), { timeout: 10000 });
  assert.deepEqual(await desktopOrder(page), ['pack', 'solo'], `${label}: folder stays on desktop`);
  await page.locator(widgetSelector('pack')).click();
  await page.waitForSelector('#folder-overlay:not(.hidden)');
  assert.deepEqual(await overlayIconIds(page), ['p1', 'p2'], `${label}: children stay in the folder`);
  const graph = await storedIconGraph(page);
  assert.equal(graph.find((icon) => icon.id === 'pack')?.type, 'folder', `${label}: folder type persisted`);
  assert.equal(graph.find((icon) => icon.id === 'p1')?.parentId, 'pack', `${label}: p1 parentId persisted`);
  assert.equal(graph.find((icon) => icon.id === 'p2')?.parentId, 'pack', `${label}: p2 parentId persisted`);
  await page.keyboard.press('Escape');
  await page.locator('#folder-overlay').waitFor({ state: 'hidden' });
}

function cssEscape(value) {
  const string = String(value);
  let result = '';
  for (let index = 0; index < string.length; index += 1) {
    const code = string.charCodeAt(index);
    const char = string[index];
    if (code === 0) {
      result += '\uFFFD';
    } else if (
      (code >= 1 && code <= 31) || code === 127
      || (index === 0 && code >= 48 && code <= 57)
      || (index === 1 && code >= 48 && code <= 57 && string.charCodeAt(0) === 45)
    ) {
      result += `\\${code.toString(16)} `;
    } else if (
      code >= 128
      || char === '-' || char === '_'
      || (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
    ) {
      result += char;
    } else {
      result += `\\${char}`;
    }
  }
  return result;
}

function widgetSelector(id, root = '#icons-container') {
  return `${root} .icon-widget[data-id="${cssEscape(id)}"]`;
}

async function html5Drag(page, fromId, toSelector, where = 'left', fromRoot = '#icons-container') {
  await page.evaluate(({ fromId, toSelector, where, fromRoot }) => {
    const src = document.querySelector(`${fromRoot} .icon-widget[data-id="${CSS.escape(fromId)}"]`);
    const dst = document.querySelector(toSelector);
    if (!src || !dst) throw new Error(`drag nodes missing ${fromId} -> ${toSelector}`);
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const rect = dst.getBoundingClientRect();
    const clientX = where === 'left' ? rect.left + 4 : where === 'right' ? rect.right - 4 : rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY };
    dst.dispatchEvent(new DragEvent('dragover', opts));
    dst.dispatchEvent(new DragEvent('drop', opts));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { fromId, toSelector, where, fromRoot });
}

async function html5DragHover(page, fromId, toId, hoverMs = 650) {
  await page.evaluate(async ({ fromId, toId, hoverMs }) => {
    const src = document.querySelector(`#icons-container .icon-widget[data-id="${CSS.escape(fromId)}"]`);
    const dst = document.querySelector(`#icons-container .icon-widget[data-id="${CSS.escape(toId)}"]`);
    if (!src || !dst) throw new Error(`hover nodes missing ${fromId} -> ${toId}`);
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const rect = dst.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    dst.dispatchEvent(new DragEvent('dragover', opts));
    await new Promise((resolve) => setTimeout(resolve, hoverMs));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { fromId, toId, hoverMs });
}

async function interceptTabCreates(page) {
  await page.evaluate(() => {
    window.__opentabCreatedTabs = [];
    if (chrome.tabs && typeof chrome.tabs.create === 'function') {
      chrome.tabs.create = (opts, cb) => {
        window.__opentabCreatedTabs.push(opts && opts.url);
        const tab = { id: window.__opentabCreatedTabs.length };
        if (typeof cb === 'function') cb(tab);
        return Promise.resolve(tab);
      };
    }
    window.open = (url) => {
      window.__opentabCreatedTabs.push(url);
      return null;
    };
  });
}

async function createdTabUrls(page) {
  return page.evaluate(() => window.__opentabCreatedTabs || []);
}

async function runExtensionE2E() {
  assertVendoredRuntimeAssets();
  assertReplacementAssets();
  assertManifestIconsAreValidPng();

  const headless = resolveHeadless(false);
  const context = await chromium.launchPersistentContext('', {
    locale: 'zh-CN',
    headless,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const errorBuckets = { page: [], console: [], sw: [] };

  try {
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (
        url.startsWith('chrome-extension://')
        || url.startsWith('data:')
        || url.includes('bing.com')
      ) {
        return route.continue();
      }
      if (url.includes('wttr.in')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            current_condition: [{ temp_C: '20', weatherCode: '113', weatherDesc: [{ value: 'Clear' }] }],
            nearest_area: [{ areaName: [{ value: 'Test' }], region: [{ value: '' }] }]
          })
        });
      }
      const noCors = /cors-blocked\.test/i.test(url);
      const corsHeaders = noCors ? {} : { 'Access-Control-Allow-Origin': '*' };
      if (/manifest\.webmanifest|site\.webmanifest|\/manifest\.json(\?|$)/i.test(url)) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: corsHeaders,
          body: '{}'
        });
      }
      if (/\.(ico|png|jpe?g|svg|webp|gif)(\?|$)/i.test(url) || url.includes('favicon') || url.includes('apple-touch')) {
        return route.fulfill({
          status: 200,
          contentType: 'image/gif',
          headers: corsHeaders,
          body: Buffer.from(PIXEL.split(',')[1], 'base64')
        });
      }
      return route.continue();
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    try {
      serviceWorker.on('console', msg => {
        if (msg.type() === 'error') errorBuckets.sw.push(formatConsoleError(msg));
      });
    } catch {
      // Playwright Worker may not expose console events.
    }

    const page = await context.newPage();
    attachErrorCollectors(page, errorBuckets);

    await page.goto(`chrome-extension://${extensionId}/home.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    await page.waitForSelector('#time', { timeout: 10000 });
    await page.waitForSelector('#settings-btn', { timeout: 10000 });
    await page.waitForSelector('#refresh-bg-btn', { timeout: 10000 });
    await page.waitForSelector('#timezone-btn', { timeout: 10000 });

    const timeText = (await page.locator('#time').textContent())?.trim() || '';
    assert.ok(timeText.length > 0, 'Clock text should not be empty');

    await page.click('#date');
    await page.waitForSelector('#calendar-popover:not(.hidden) .flatpickr-calendar', { timeout: 5000 });
    assert.equal(
      await page.evaluate(() => typeof window.flatpickr),
      'function',
      'flatpickr should load from vendor/ without node_modules'
    );

    const sshPage = await context.newPage();
    const sshConsoleErrors = [];
    sshPage.on('console', msg => {
      if (msg.type() === 'error') sshConsoleErrors.push(msg.text());
    });
    sshPage.on('pageerror', error => {
      sshConsoleErrors.push(error.message);
    });
    const sshFailedResources = [];
    sshPage.on('requestfailed', request => {
      sshFailedResources.push(request.url());
    });
    sshPage.on('response', response => {
      if (response.status() >= 400) sshFailedResources.push(response.url());
    });
    await sshPage.goto(`chrome-extension://${extensionId}/ssh_terminal.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await sshPage.waitForTimeout(500);
    const sshMissingVendor = sshFailedResources.filter(url => (
      url.includes('/node_modules/') || url.includes('/vendor/')
    ));
    assert.equal(
      sshMissingVendor.length,
      0,
      `SSH terminal runtime assets failed to load: ${sshMissingVendor.join(' | ')}`
    );
    assert.equal(
      await sshPage.evaluate(() => typeof window.Terminal),
      'function',
      'xterm should load from vendor/ without node_modules'
    );
    assert.notEqual(
      await sshPage.evaluate(() => typeof window.FitAddon),
      'undefined',
      'FitAddon should load from vendor/ without node_modules'
    );
    assert.equal(
      sshConsoleErrors.length,
      0,
      `SSH terminal console/page errors: ${sshConsoleErrors.join(' | ')}`
    );
    await sshPage.close();

    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)', { timeout: 5000 });

    await page.selectOption('#time-format', '24h');
    await page.waitForTimeout(300);

    const isAmPmVisible = await page.locator('#ampm').isVisible();
    assert.equal(isAmPmVisible, false, 'AM/PM should be hidden in 24h mode');

    await page.click('.tab-btn[data-type="image"]');
    await page.waitForSelector('#image-section.active', { timeout: 5000 });
    const imagePresets = page.locator('#image-presets .preset-item');
    assert.equal(await imagePresets.count(), 4, 'should ship default.webp plus three bundled stills');
    for (let i = 0; i < PRESET_BACKGROUNDS.length; i += 1) {
      await imagePresets.nth(i).click();
      await page.waitForTimeout(250);
      const bgImage = await page.locator('#background-layer').evaluate((el) => getComputedStyle(el).backgroundImage);
      assert.ok(
        bgImage.includes(path.basename(PRESET_BACKGROUNDS[i])),
        `preset ${i} should apply ${PRESET_BACKGROUNDS[i]}, got ${bgImage}`
      );
    }

    const unexpectedConsoleErrors = errorBuckets.console.filter(error => !isExemptConsoleError(error));
    assert.equal(
      unexpectedConsoleErrors.length,
      0,
      `Console errors detected: ${unexpectedConsoleErrors.join(' | ')}`
    );

    const migrationPage = await context.newPage();

    for (const { legacy, expected } of LEGACY_PEXELS_TO_PRESET) {
      const result = await loadHomeWithBackground(migrationPage, serviceWorker, extensionId, {
        type: 'image',
        value: legacy,
        source: 'preset-image'
      });
      assert.equal(result.stored?.type, 'image', `${legacy} should stay type image`);
      assert.equal(result.stored?.value, expected, `${legacy} should migrate to ${expected}`);
      assertNoLegacyAssetFetch(result.failed, legacy);
      assert.equal(
        unexpectedErrors(result.errors).length,
        0,
        `${legacy} console/page errors: ${unexpectedErrors(result.errors).join(' | ')}`
      );
    }

    const chromeExtensionLegacy = `chrome-extension://${extensionId}/assets/default_background/pexels-elina-sazonova-4275497.jpg`;
    const absoluteResult = await loadHomeWithBackground(migrationPage, serviceWorker, extensionId, {
      type: 'image',
      value: chromeExtensionLegacy,
      source: 'preset-image'
    });
    assert.equal(absoluteResult.stored?.type, 'image');
    assert.equal(
      absoluteResult.stored?.value,
      'assets/default_background/bg-mountain-dawn.jpg',
      `chrome-extension URL should migrate, got ${absoluteResult.stored?.value}`
    );
    assertNoLegacyAssetFetch(absoluteResult.failed, 'chrome-extension URL');
    assert.equal(
      unexpectedErrors(absoluteResult.errors).length,
      0,
      `chrome-extension URL console/page errors: ${unexpectedErrors(absoluteResult.errors).join(' | ')}`
    );

    const unknownResult = await loadHomeWithBackground(migrationPage, serviceWorker, extensionId, {
      type: 'image',
      value: 'assets/default_background/pexels-unknown-999.jpg',
      source: 'preset-image'
    });
    assert.equal(
      unknownResult.stored?.type,
      'bing',
      `unknown bundled path should fall back to bing, got ${JSON.stringify(unknownResult.stored)}`
    );
    assertNoLegacyAssetFetch(unknownResult.failed, 'unknown bundled path');
    assert.equal(
      unexpectedErrors(unknownResult.errors).length,
      0,
      `unknown path console/page errors: ${unexpectedErrors(unknownResult.errors).join(' | ')}`
    );

    const customUrl = 'https://example.com/custom-wallpaper.jpg';
    const customResult = await loadHomeWithBackground(migrationPage, serviceWorker, extensionId, {
      type: 'image',
      value: customUrl,
      source: 'custom'
    });
    assert.equal(customResult.stored?.type, 'image');
    assert.equal(customResult.stored?.value, customUrl, 'custom https URL must be left unchanged');
    assert.equal(customResult.stored?.source, 'custom');

    const dataUrlResult = await loadHomeWithBackground(migrationPage, serviceWorker, extensionId, {
      type: 'image',
      value: TINY_PNG_DATA_URL,
      source: 'local-upload'
    });
    assert.equal(dataUrlResult.stored?.type, 'image');
    assert.equal(dataUrlResult.stored?.value, TINY_PNG_DATA_URL, 'uploaded data URL must be left unchanged');
    assert.equal(dataUrlResult.stored?.source, 'local-upload');
    assert.equal(
      unexpectedErrors(dataUrlResult.errors).length,
      0,
      `data URL console/page errors: ${unexpectedErrors(dataUrlResult.errors).join(' | ')}`
    );

    await loadHomeWithBackground(migrationPage, serviceWorker, extensionId, {
      type: 'bing',
      value: '',
      source: ''
    });
    const backupErrors = [];
    const backupFailed = [];
    const onBackupFailed = (request) => backupFailed.push(request.url());
    const stopBackupCollecting = collectPageErrors(migrationPage, backupErrors);
    migrationPage.on('requestfailed', onBackupFailed);
    try {
      await Promise.all([
        migrationPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        migrationPage.setInputFiles('#backup-import-file', {
          name: 'opentab-backup.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({
            background: {
              type: 'image',
              value: 'assets/default_background/pexels-pixabay-40896.jpg',
              source: 'preset-image'
            }
          }))
        })
      ]);
      await migrationPage.waitForSelector('#time', { timeout: 10000 });
      await migrationPage.waitForTimeout(350);
    } finally {
      stopBackupCollecting();
      migrationPage.off('requestfailed', onBackupFailed);
    }
    const imported = await readStoredBackground(serviceWorker);
    assert.equal(imported?.type, 'image');
    assert.equal(
      imported?.value,
      'assets/default_background/bg-forest-golden.jpg',
      `imported backup should migrate pine Pexels path, got ${imported?.value}`
    );
    assertNoLegacyAssetFetch(backupFailed, 'backup import');
    assert.equal(
      unexpectedErrors(backupErrors).length,
      0,
      `backup import console/page errors: ${unexpectedErrors(backupErrors).join(' | ')}`
    );

    await migrationPage.close();
    await page.click('#close-settings');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // --- T1 + card and empty hint ---
    await resetHome(page, { icons: [], folders: folders(), currentFolderId: HOME });
    assert.equal(await page.locator('#add-shortcut-tile').isVisible(), true, 'T1: + tile visible when empty');
    assert.equal(await page.locator('#icons-empty-hint').isVisible(), true, 'T1: empty hint visible');
    await page.screenshot({ path: path.join(ARTIFACTS, 't1-empty-add-tile.png') });
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)', { timeout: 5000 });
    await page.fill('#icon-name', 'Example A');
    await page.fill('#icon-url', 'https://example.com/a');
    await page.click('#save-btn');
    await page.waitForSelector('#add-icon-modal.hidden', { timeout: 5000 });
    const t1Order = await desktopOrder(page);
    assert.equal(t1Order.length, 1, 'T1: one icon after save');
    const t1Names = await page.$$eval('#icons-container .icon-widget[data-id] .icon-name', els => els.map(el => el.textContent));
    assert.deepEqual(t1Names, ['Example A']);
    const tileIndex = await page.evaluate(() => {
      const nodes = [...document.querySelector('#icons-container').children];
      return {
        icon: nodes.findIndex(el => el.matches('.icon-widget[data-id]')),
        add: nodes.findIndex(el => el.id === 'add-shortcut-tile')
      };
    });
    assert.ok(tileIndex.icon >= 0 && tileIndex.icon < tileIndex.add, 'T1: new icon is before + tile');
    assert.equal(await page.locator('#icons-empty-hint').isVisible(), false, 'T1: empty hint hidden after add');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGrid(page);
    const t1AfterReload = await page.$$eval('#icons-container .icon-widget[data-id] .icon-name', els => els.map(el => el.textContent));
    assert.deepEqual(t1AfterReload, ['Example A'], 'T1: icon persists after reload');
    console.log('T1 passed');

    // --- T2 context menu rules ---
    await page.locator('#search-input').click({ button: 'right' });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#add-icon-modal').evaluate(el => el.classList.contains('hidden')), true, 'T2: search input keeps native menu');
    await page.locator('#welcome-text').click({ button: 'right' });
    await page.waitForSelector('#add-icon-modal:not(.hidden)', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#add-icon-modal.hidden', { timeout: 5000 });
    await page.keyboard.down('Alt');
    await page.locator('#welcome-text').click({ button: 'right' });
    await page.keyboard.up('Alt');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#add-icon-modal').evaluate(el => el.classList.contains('hidden')), true, 'T2: Alt+right click does not open modal');
    console.log('T2 passed');

    // --- T3 drag reorder ---
    const abcPayload = {
      folders: folders({ id: 'folder-x', name: 'X' }),
      currentFolderId: HOME,
      icons: [
        shortcut('a', 'A', 'https://example.com/a'),
        shortcut('x1', 'X1', 'https://example.com/x1', 'folder-x'),
        shortcut('b', 'B', 'https://example.com/b'),
        shortcut('c', 'C', 'https://example.com/c')
      ]
    };
    await resetHome(page, abcPayload);
    assert.deepEqual(await desktopOrder(page), ['a', 'b', 'c']);
    await html5Drag(page, 'c', '#icons-container .icon-widget[data-id="a"]', 'left');
    await page.waitForTimeout(100);
    assert.deepEqual(await desktopOrder(page), ['c', 'a', 'b'], 'T3: C moved left of A');
    const idsAfterDrag = await storageIconIds(page);
    assert.deepEqual(idsAfterDrag, ['c', 'x1', 'a', 'b'], 'T3: X1 keeps array slot');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGrid(page);
    assert.deepEqual(await desktopOrder(page), ['c', 'a', 'b'], 'T3: order persists');
    assert.deepEqual(await storageIconIds(page), ['c', 'x1', 'a', 'b']);
    await html5Drag(page, 'c', '#add-shortcut-tile', 'left');
    await page.waitForTimeout(100);
    assert.deepEqual(await desktopOrder(page), ['a', 'b', 'c'], 'T3: drop on + moves to end');
    await page.screenshot({ path: path.join(ARTIFACTS, 't3-drag-reorder.png') });
    console.log('T3 passed');

    // --- T4 keyboard reorder ---
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        shortcut('a', 'A', 'https://example.com/a'),
        shortcut('b', 'B', 'https://example.com/b'),
        shortcut('c', 'C', 'https://example.com/c')
      ]
    });
    await page.locator('#icons-container .icon-widget[data-id="a"]').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForTimeout(100);
    assert.deepEqual(await desktopOrder(page), ['b', 'a', 'c'], 'T4: Alt+Right swaps A with B');
    const focusedId = await page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
    assert.equal(focusedId, 'a', 'T4: focus stays on A');
    console.log('T4 passed');

    // --- T5 real links ---
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        shortcut('link-a', 'Example', 'https://example.com/a'),
        {
          id: 'tool-json',
          name: 'JSON',
          type: 'tool',
          toolSubtype: 'json-format',
          folderId: HOME,
          url: '',
          uploadedIconDataUrl: PIXEL,
          resolvedIconUrl: PIXEL
        }
      ]
    });
    const linkTag = await page.locator('#icons-container .icon-widget[data-id="link-a"]').evaluate(el => ({
      tag: el.tagName,
      href: el.getAttribute('href'),
      className: el.className
    }));
    assert.equal(linkTag.tag, 'A');
    assert.ok(linkTag.className.includes('icon-widget'));
    assert.equal(linkTag.href, 'https://example.com/a');
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.check('#open-in-new-tab');
    await page.waitForTimeout(200);
    const afterToggle = await page.locator('#icons-container .icon-widget[data-id="link-a"]').evaluate(el => ({
      target: el.getAttribute('target'),
      rel: el.getAttribute('rel') || ''
    }));
    assert.equal(afterToggle.target, '_blank');
    assert.ok(afterToggle.rel.includes('noopener'), 'T5: rel contains noopener');
    await page.click('#close-settings');
    const toolHref = await page.locator('#icons-container .icon-widget[data-id="tool-json"]').getAttribute('href');
    assert.ok(toolHref && new URL(toolHref).pathname.endsWith('/tool.html'), 'T5: tool href path ends with /tool.html');
    const [newPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 8000 }),
      page.locator('#icons-container .icon-widget[data-id="tool-json"]').click({ button: 'middle' })
    ]);
    await newPage.waitForLoadState('domcontentloaded');
    assert.ok(new URL(newPage.url()).pathname.endsWith('/tool.html'), 'T5: middle click opens tool.html');
    assert.ok(page.url().includes('home.html'), 'T5: original page stays on home');
    await newPage.close();
    console.log('T5 passed');

    // --- T6 delete undo ---
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        shortcut('a', 'A', 'https://example.com/a'),
        shortcut('b', 'B', 'https://example.com/b'),
        shortcut('c', 'C', 'https://example.com/c')
      ]
    });
    await page.locator('#icons-container .icon-widget[data-id="b"]').click({ button: 'right' });
    await page.waitForSelector('#icon-context-menu:not(.hidden)');
    await page.click('#delete-icon-btn');
    await page.waitForSelector('#toast:not(.hidden)');
    const toastText = (await page.locator('#toast').textContent()) || '';
    assert.ok(toastText.includes('撤销'), 'T6: toast offers undo');
    assert.ok(!(await desktopOrder(page)).includes('b'), 'T6: B removed from grid');
    await page.screenshot({ path: path.join(ARTIFACTS, 't6-delete-undo-toast.png') });
    await page.locator('#toast button').click();
    await page.waitForTimeout(200);
    assert.deepEqual(await desktopOrder(page), ['a', 'b', 'c'], 'T6: undo restores B');
    await page.locator('#icons-container .icon-widget[data-id="b"]').click({ button: 'right' });
    await page.waitForSelector('#icon-context-menu:not(.hidden)');
    await page.click('#delete-icon-btn');
    await page.waitForTimeout(6500);
    const idsAfterTimeout = await storageIconIds(page);
    assert.ok(!idsAfterTimeout.includes('b'), 'T6: B gone from storage after 6s');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGrid(page);
    assert.deepEqual(await desktopOrder(page), ['a', 'c'], 'T6: B still gone after reload');
    console.log('T6 passed');

    // --- T7 Esc layered close ---
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#add-icon-modal.hidden');
    assert.equal(await page.locator('#settings-panel').evaluate(el => el.classList.contains('hidden')), false, 'T7: settings still open');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#settings-panel.hidden');

    await resetHome(page, {
      folders: folders({ id: 'folder-x', name: 'X' }),
      currentFolderId: HOME,
      icons: [
        shortcut('a', 'A', 'https://example.com/a'),
        shortcut('b', 'B', 'https://example.com/b')
      ]
    });
    await page.evaluate(() => {
      const src = document.querySelector(`#icons-container .icon-widget[data-id="${CSS.escape('b')}"]`);
      const dst = document.querySelector(`#group-tabs [data-group-id="${CSS.escape('folder-x')}"]`);
      if (!src || !dst) throw new Error('icon or group tab missing');
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const rect = dst.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + 8,
        clientY: rect.top + 8
      };
      dst.dispatchEvent(new DragEvent('dragover', opts));
      dst.dispatchEvent(new DragEvent('drop', opts));
    });
    await page.waitForTimeout(150);
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#add-icon-modal.hidden', { timeout: 5000 });
    console.log('T7 passed');

    // --- invalid URL keyboard ---
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [shortcut('bad', 'Bad', 'not-a-url')]
    });
    const badLink = await page.locator('#icons-container .icon-widget[data-id="bad"]').evaluate(el => ({
      href: el.getAttribute('href'),
      role: el.getAttribute('role'),
      ariaDisabled: el.getAttribute('aria-disabled')
    }));
    assert.equal(badLink.href, null, 'invalid URL icon has no href');
    assert.equal(badLink.role, 'link');
    assert.equal(badLink.ariaDisabled, 'true');
    await page.locator('#icons-container .icon-widget[data-id="bad"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#toast:not(.hidden)');
    assert.ok(((await page.locator('#toast').textContent()) || '').includes('网址无效'), 'Enter shows invalid URL toast');
    await page.keyboard.press('Escape');
    await page.locator('#icons-container .icon-widget[data-id="bad"]').focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('#toast:not(.hidden)');
    assert.ok(((await page.locator('#toast').textContent()) || '').includes('网址无效'), 'Space shows invalid URL toast');

    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [{
        id: 'ssh-bad',
        name: 'SSH',
        type: 'ssh',
        folderId: HOME,
        sshGatewayUrl: '',
        sshGatewayToken: '',
        sshHost: '',
        sshUsername: '',
        uploadedIconDataUrl: PIXEL,
        resolvedIconUrl: PIXEL
      }]
    });
    const sshLink = await page.locator('#icons-container .icon-widget[data-id="ssh-bad"]').evaluate(el => ({
      href: el.getAttribute('href'),
      ariaDisabled: el.getAttribute('aria-disabled')
    }));
    assert.equal(sshLink.href, null, 'incomplete SSH icon has no href');
    assert.equal(sshLink.ariaDisabled, 'true');
    const extraPages = [];
    const onExtraPage = (opened) => extraPages.push(opened);
    context.on('page', onExtraPage);
    await page.locator('#icons-container .icon-widget[data-id="ssh-bad"]').click({ button: 'middle', force: true });
    await page.waitForTimeout(400);
    context.off('page', onExtraPage);
    assert.equal(extraPages.length, 0, 'incomplete SSH middle-click must not open a page');
    await page.locator('#icons-container .icon-widget[data-id="ssh-bad"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#toast:not(.hidden)');
    assert.ok(((await page.locator('#toast').textContent()) || '').includes('SSH 配置不完整'), 'Enter shows incomplete SSH toast');

    // --- T8 performance ---
    const perfIcons = Array.from({ length: 60 }, (_, i) => shortcut(`perf-${i}`, `Site ${i}`, `https://example.com/${i}`));
    await page.evaluate(async (data) => {
      await chrome.storage.local.set(data);
    }, { icons: perfIcons, folders: folders(), currentFolderId: HOME });
    const perfStarted = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitForGrid(page);
    const gridReadyMs = await page.evaluate(() => {
      const marks = performance.getEntriesByName('opentab:grid-ready');
      return marks.length ? marks[0].startTime : null;
    });
    const wallMs = Date.now() - perfStarted;
    console.log(`T8 opentab:grid-ready ms=${gridReadyMs} wall=${wallMs}`);
    fs.writeFileSync(
      path.join(ARTIFACTS, 't8-grid-ready.txt'),
      `opentab:grid-ready=${gridReadyMs}ms wall=${wallMs}ms\n`,
      'utf8'
    );
    assert.ok(gridReadyMs !== null, 'T8: grid-ready mark missing');
    assert.ok(gridReadyMs <= 500, `T8: grid-ready ${gridReadyMs}ms exceeded 500ms`);
    await page.screenshot({ path: path.join(ARTIFACTS, 't8-sixty-icons.png') });
    await page.evaluate(() => {
      window.__opentabLongTasks = [];
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) window.__opentabLongTasks.push(entry.duration);
          }
        });
        observer.observe({ type: 'longtask' });
        window.__opentabLongTaskObserver = observer;
      } catch (error) {
        window.__opentabLongTaskError = String(error);
      }
    });
    await html5Drag(page, 'perf-5', '#icons-container .icon-widget[data-id="perf-0"]', 'left');
    await page.waitForTimeout(120);
    const longTasks = await page.evaluate(() => window.__opentabLongTasks || []);
    assert.equal(longTasks.length, 0, `T8: longtasks over 50ms: ${longTasks.join(',')}`);
    console.log('T8 passed');

    // --- T10 manifest ---
    const localManifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    assert.ok(!localManifest.permissions.includes('contextMenus'), 'T10: contextMenus removed');
    assert.ok(!localManifest.permissions.includes('tabs'), 'T10: tabs removed; popup uses activeTab');
    assert.ok(!localManifest.permissions.includes('bookmarks'), 'T10: bookmarks not required');
    assert.ok(!localManifest.permissions.includes('topSites'), 'T10: topSites not required');
    const masterManifest = readMasterManifest();
    if (masterManifest) {
      const expectedPerms = masterManifest.permissions.filter((item) => item !== 'contextMenus' && item !== 'tabs' && item !== 'geolocation');
      assert.deepEqual(localManifest.permissions, expectedPerms, 'T10: permissions otherwise match master');
      assert.deepEqual(localManifest.host_permissions, masterManifest.host_permissions, 'T10: host_permissions unchanged');
    } else {
      assert.deepEqual(localManifest.permissions, ['storage', 'activeTab']);
      assert.deepEqual(localManifest.host_permissions, ['https://www.bing.com/*', 'https://wttr.in/*']);
    }
    console.log('T10 passed');

    // --- T11 popup regression ---
    const popup = await context.newPage();
    const popupErrors = [];
    popup.on('console', msg => {
      if (msg.type() === 'error') popupErrors.push(msg.text());
    });
    popup.on('pageerror', error => popupErrors.push(String(error)));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await popup.waitForSelector('#save-btn', { timeout: 5000 });
    await popup.screenshot({ path: path.join(ARTIFACTS, 't11-popup.png') });
    const currentUrl = ((await popup.locator('#current-url').textContent()) || '').trim();
    if (/^https?:/i.test(currentUrl) && !(await popup.locator('#save-btn').isDisabled())) {
      await popup.fill('#site-name', 'FromPopupUI');
      await popup.click('#save-btn');
    } else {
      await popup.evaluate(() => new Promise((resolve, reject) => {
        chrome.storage.local.get(['icons', 'folders'], (result) => {
          const icons = Array.isArray(result.icons) ? result.icons : [];
          icons.push({
            id: 'popup-e2e',
            name: 'FromPopup',
            url: 'https://example.com/from-popup',
            folderId: 'folder-home',
            type: 'shortcut',
            uploadedIconDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
            resolvedIconUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
          });
          chrome.storage.local.set({ icons, folders: result.folders || [] }, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          });
        });
      }));
    }
    assert.equal(popupErrors.length, 0, `T11: popup console errors: ${popupErrors.join(' | ')}`);
    await waitForAsync(page, async () => {
      const result = await chrome.storage.local.get(['icons']);
      return (result.icons || []).some(icon => icon.name === 'FromPopupUI' || icon.name === 'FromPopup');
    }, null, { timeout: 8000 });
    if (!popup.isClosed()) await popup.close().catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGrid(page);
    const popupNames = await page.$$eval('#icons-container .icon-widget[data-id] .icon-name', els => els.map(el => el.textContent));
    assert.ok(
      popupNames.includes('FromPopupUI') || popupNames.includes('FromPopup'),
      `T11: popup-created icon visible, got ${popupNames.join(',')}`
    );
    console.log('T11 passed');

    // --- CSS.escape: ids with CSS special characters ---
    const specialId = 'id.with:special';
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        shortcut(specialId, 'Special', 'https://example.com/special'),
        shortcut('b', 'B', 'https://example.com/b')
      ]
    });
    const producedSelector = await page.evaluate((id) => window.OpenTabFolders.iconSelector(id), specialId);
    assert.equal(
      producedSelector,
      `.icon-widget[data-id="${cssEscape(specialId)}"]`,
      'iconSelector must CSS.escape ids'
    );
    assert.equal(
      await page.locator(widgetSelector(specialId)).count(),
      1,
      'CSS.escape selector finds the special-id icon'
    );
    await html5Drag(page, specialId, widgetSelector('b'), 'left');
    await page.waitForTimeout(120);
    assert.deepEqual(await desktopOrder(page), [specialId, 'b'], 'special-id icon can be dragged via escaped selector');
    console.log('CSS.escape special-id passed');

    // --- Esc focus restore stack (nested layers) ---
    await resetHome(page, {
      folders: folders({ id: 'folder-x', name: 'X' }),
      currentFolderId: HOME,
      icons: [
        folderIcon('pack', '文件夹'),
        shortcut('p1', 'P1', 'https://example.com/p1', HOME, { parentId: 'pack' }),
        shortcut('p2', 'P2', 'https://example.com/p2', HOME, { parentId: 'pack' }),
        shortcut('solo', 'Solo', 'https://example.com/solo')
      ]
    });
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#add-icon-modal.hidden');
    assert.equal(await page.locator('#settings-panel').evaluate((el) => el.classList.contains('hidden')), false);
    assert.equal(
      await page.evaluate(() => document.activeElement && document.activeElement.id),
      'add-shortcut-tile',
      'focus stack: closing modal restores the add tile'
    );
    await page.keyboard.press('Escape');
    await page.waitForSelector('#settings-panel.hidden');
    assert.equal(
      await page.evaluate(() => document.activeElement && document.activeElement.id),
      'settings-btn',
      'focus stack: closing settings restores the settings button'
    );

    await page.locator(widgetSelector('pack')).click();
    await page.waitForSelector('#folder-overlay:not(.hidden)');
    await page.locator('#folder-icons-container .add-shortcut-tile').click();
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#add-icon-modal.hidden');
    assert.equal(
      await page.locator('#folder-overlay').evaluate((el) => el.classList.contains('hidden')),
      false,
      'focus stack: first Esc closes the modal only'
    );
    assert.equal(
      await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('add-shortcut-tile')),
      true,
      'focus stack: closing modal restores the overlay add tile'
    );
    await page.keyboard.press('Escape');
    await page.locator('#folder-overlay').waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(() => document.activeElement && document.activeElement.dataset.id),
      'pack',
      'focus stack: closing overlay restores the folder tile'
    );
    console.log('focus stack passed');

    // --- AC1 merge into folder ---
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        shortcut('a', 'A', 'https://example.com/a'),
        shortcut('b', 'B', 'https://example.com/b'),
        shortcut('c', 'C', 'https://example.com/c')
      ]
    });
    await html5DragHover(page, 'b', 'a');
    await page.waitForSelector('#icons-container .icon-widget.icon-folder', { timeout: 5000 });
    const ac1Desktop = await desktopOrder(page);
    assert.equal(ac1Desktop.length, 2, 'AC1: desktop has folder + leftover C');
    assert.ok(ac1Desktop.includes('c'), 'AC1: C stays on desktop');
    const folderId = ac1Desktop.find((id) => id !== 'c');
    const folderName = await page.locator(`${widgetSelector(folderId)} .icon-name`).textContent();
    assert.equal((folderName || '').trim(), '文件夹', 'AC1: default folder name');
    await page.waitForSelector('#toast:not(.hidden)');
    assert.ok(((await page.locator('#toast').textContent()) || '').includes('撤销'), 'AC1: undo toast');
    await page.screenshot({ path: path.join(ARTIFACTS, 'ac1-folder-merge.png') });
    await page.locator('#toast button').click();
    await page.waitForTimeout(200);
    assert.deepEqual(await desktopOrder(page), ['a', 'b', 'c'], 'AC1: undo restores A and B');
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        folderIcon('pack', '文件夹'),
        shortcut('a', 'A', 'https://example.com/a', HOME, { parentId: 'pack' }),
        shortcut('b', 'B', 'https://example.com/b', HOME, { parentId: 'pack' }),
        shortcut('c', 'C', 'https://example.com/c')
      ]
    });
    await html5DragHover(page, 'c', 'pack');
    await page.waitForTimeout(200);
    assert.deepEqual(await desktopOrder(page), ['pack'], 'AC1: drop onto folder hides C');
    const storedAfterJoin = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons']);
      return (result.icons || []).map((icon) => ({ id: icon.id, parentId: icon.parentId || '' }));
    });
    assert.equal(storedAfterJoin.find((icon) => icon.id === 'c')?.parentId, 'pack', 'AC1: C parentId is the folder');
    console.log('AC1 passed');

    // --- AC2 overlay, rename, drag-out, dissolve ---
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        folderIcon('pack', '文件夹'),
        shortcut('a', 'A', 'https://example.com/a', HOME, { parentId: 'pack' }),
        shortcut('b', 'B', 'https://example.com/b', HOME, { parentId: 'pack' }),
        shortcut('c', 'C', 'https://example.com/c', HOME, { parentId: 'pack' })
      ]
    });
    await page.locator(widgetSelector('pack')).click();
    await page.waitForSelector('#folder-overlay:not(.hidden)');
    const overlayOrder = await page.$$eval('#folder-icons-container .icon-widget[data-id]', (els) => els.map((el) => el.dataset.id));
    assert.deepEqual(overlayOrder, ['a', 'b', 'c'], 'AC2: overlay lists children');
    await html5Drag(page, 'c', widgetSelector('a', '#folder-icons-container'), 'left', '#folder-icons-container');
    await page.waitForTimeout(120);
    assert.deepEqual(
      await page.$$eval('#folder-icons-container .icon-widget[data-id]', (els) => els.map((el) => el.dataset.id)),
      ['c', 'a', 'b'],
      'AC2: reorder inside overlay'
    );
    await page.fill('#folder-title-input', '工作');
    await page.locator('#folder-title-input').press('Enter');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(ARTIFACTS, 'ac2-folder-overlay.png') });
    await html5Drag(page, 'c', '#folder-overlay-backdrop', 'center', '#folder-icons-container');
    await page.waitForTimeout(200);
    assert.ok((await desktopOrder(page)).includes('c'), 'AC2: dragged-out icon returns to desktop');
    assert.equal(await page.locator('#folder-overlay').evaluate((el) => el.classList.contains('hidden')), false, 'AC2: overlay stays open with 2 children');
    await page.keyboard.press('Escape');
    await page.locator('#folder-overlay').waitFor({ state: 'hidden' });
    await page.locator(widgetSelector('pack')).click();
    await page.waitForSelector('#folder-overlay:not(.hidden)');
    await page.locator('#folder-overlay-backdrop').click({ position: { x: 8, y: 8 } });
    await page.locator('#folder-overlay').waitFor({ state: 'hidden' });
    const renamed = await page.locator(`${widgetSelector('pack')} .icon-name`).textContent();
    assert.equal((renamed || '').trim(), '工作', 'AC2: inline rename persisted');

    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        folderIcon('pack', '文件夹'),
        shortcut('a', 'A', 'https://example.com/a', HOME, { parentId: 'pack' }),
        shortcut('b', 'B', 'https://example.com/b', HOME, { parentId: 'pack' })
      ]
    });
    await page.locator(widgetSelector('pack')).click();
    await page.waitForSelector('#folder-overlay:not(.hidden)');
    await html5Drag(page, 'a', '#folder-overlay-backdrop', 'center', '#folder-icons-container');
    await page.waitForTimeout(250);
    assert.equal(await page.locator(widgetSelector('pack')).count(), 0, 'AC2: folder dissolves at one leftover icon');
    assert.ok((await desktopOrder(page)).includes('b'), 'AC2: leftover icon lands on desktop');
    console.log('AC2 passed');

    // --- AC3 open all ---
    const manyChildren = Array.from({ length: 11 }, (_, i) => (
      shortcut(`n${i}`, `N${i}`, `https://example.com/n${i}`, HOME, { parentId: 'pack' })
    ));
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        folderIcon('pack', '工作'),
        shortcut('a', 'A', 'https://example.com/a', HOME, { parentId: 'pack' }),
        shortcut('b', 'B', 'https://example.com/b', HOME, { parentId: 'pack' })
      ]
    });
    await interceptTabCreates(page);
    await page.locator(widgetSelector('pack')).click({ button: 'right' });
    await page.waitForSelector('#icon-context-menu:not(.hidden)');
    assert.equal(await page.locator('#open-all-icon-btn').evaluate((el) => el.classList.contains('hidden')), false, 'AC3: 全部打开 visible');
    await page.click('#open-all-icon-btn');
    await page.waitForTimeout(200);
    assert.deepEqual(await createdTabUrls(page), ['https://example.com/a', 'https://example.com/b'], 'AC3: context open-all opens N tabs');
    await interceptTabCreates(page);
    await page.locator(widgetSelector('pack')).click({ button: 'middle' });
    await page.waitForTimeout(200);
    assert.equal((await createdTabUrls(page)).length, 2, 'AC3: middle-click opens N tabs');

    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [folderIcon('pack', '工作'), ...manyChildren]
    });
    await interceptTabCreates(page);
    await page.locator(widgetSelector('pack')).click({ button: 'right' });
    await page.waitForSelector('#icon-context-menu:not(.hidden)');
    await page.click('#open-all-icon-btn');
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    assert.ok(((await page.locator('#inline-dialog-message').textContent()) || '').includes('11'), 'AC3: confirm when >10');
    await page.locator('#inline-dialog-actions button', { hasText: '取消' }).click();
    await page.locator('#inline-dialog').waitFor({ state: 'hidden' });
    assert.equal((await createdTabUrls(page)).length, 0, 'AC3: cancel does not open tabs');
    await page.locator(widgetSelector('pack')).click({ button: 'right' });
    await page.waitForSelector('#icon-context-menu:not(.hidden)');
    await page.click('#open-all-icon-btn');
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    await page.locator('#inline-dialog-actions button', { hasText: '打开' }).click();
    await page.waitForTimeout(200);
    assert.equal((await createdTabUrls(page)).length, 11, 'AC3: confirm opens 11 tabs');
    console.log('AC3 passed');

    // --- AC4 group tabs replace drawers ---
    await resetHome(page, {
      folders: folders({ id: 'folder-x', name: 'X' }),
      currentFolderId: HOME,
      icons: [
        shortcut('a', 'A', 'https://example.com/a'),
        shortcut('x1', 'X1', 'https://example.com/x1', 'folder-x')
      ]
    });
    assert.equal(await page.locator('#workspace-drawer').count(), 0, 'AC4: drawer removed');
    assert.equal(await page.locator('#workspace-btn').count(), 0, 'AC4: drawer button removed');
    assert.ok(await page.locator(groupSelector(HOME)).isVisible(), 'AC4: home group tab visible');
    await page.locator(groupSelector('folder-x')).click();
    await page.waitForTimeout(400);
    assert.deepEqual(await desktopOrder(page), ['x1'], 'AC4: click group tab switches grid');
    await page.locator('#group-tabs-bar').hover();
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(400);
    assert.deepEqual(await desktopOrder(page), ['a'], 'AC4: wheel switches group');
    await page.keyboard.press('Alt+Digit2');
    await page.waitForTimeout(400);
    assert.deepEqual(await desktopOrder(page), ['x1'], 'AC4: Alt+2 jumps to second group');
    await page.screenshot({ path: path.join(ARTIFACTS, 'ac4-group-tabs.png') });

    await page.click('#add-group-btn');
    await page.waitForSelector('#new-group-input');
    await page.fill('#new-group-input', '新组');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.group-tab')].some((tab) => tab.textContent.includes('新组')));
    const newGroupId = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.group-tab')].find((node) => node.textContent.includes('新组'));
      return tab ? tab.dataset.groupId : '';
    });
    assert.ok(newGroupId, 'AC4: created group tab');
    await page.locator(groupSelector(newGroupId)).dblclick();
    await page.waitForSelector('.group-rename-input');
    await page.fill('.group-rename-input', '改名组');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.group-tab')].some((tab) => tab.textContent.includes('改名组')));
    const renamedGroupId = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.group-tab')].find((node) => node.textContent.includes('改名组'));
      return tab ? tab.dataset.groupId : '';
    });
    await page.locator(groupSelector(HOME)).click();
    await page.waitForTimeout(400);
    await html5Drag(page, 'a', groupSelector(renamedGroupId), 'center');
    await page.waitForTimeout(400);
    await page.locator(groupSelector(renamedGroupId)).click({ button: 'right' });
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    await page.locator('#inline-dialog-actions button', { hasText: '移到默认分组' }).click();
    await page.locator('#inline-dialog').waitFor({ state: 'hidden' });
    await page.locator(groupSelector(HOME)).click();
    await page.waitForTimeout(200);
    assert.ok((await desktopOrder(page)).includes('a'), 'AC4: move-to-default keeps icon');
    await page.waitForSelector('#toast:not(.hidden)');
    await page.locator('#toast button').click();
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(() => [...document.querySelectorAll('.group-tab')].some((tab) => tab.textContent.includes('改名组'))),
      'AC4: undo restores group'
    );

    const againId = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.group-tab')].find((node) => node.textContent.includes('改名组'));
      return tab ? tab.dataset.groupId : '';
    });
    await page.locator(groupSelector(againId)).click({ button: 'right' });
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    await page.locator('#inline-dialog-actions button', { hasText: '一起删除' }).click();
    await page.locator('#inline-dialog').waitFor({ state: 'hidden' });
    await page.locator(groupSelector(HOME)).click();
    await page.waitForTimeout(200);
    assert.ok(!(await desktopOrder(page)).includes('a'), 'AC4: delete-with-icons removes A');

    await page.mouse.move(2, 240);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#workspace-drawer').count(), 0, 'AC4: left-edge hover does not open a drawer');
    assert.ok(await page.locator('#group-tabs-bar').isVisible(), 'AC4: group tabs remain');
    console.log('AC4 passed');

    // --- AC6 lossless drawer migration ---
    await resetHome(page, {
      folders: [
        { id: HOME, name: '主页' },
        { id: 'folder-blog', name: '博客' },
        { id: 'folder-work', name: '工作' },
        { id: 'folder-tools', name: '工具' }
      ],
      currentFolderId: 'folder-work',
      icons: [
        { id: 'old-a', name: 'OldA', url: 'https://example.com/a', folderId: HOME, type: 'shortcut', uploadedIconDataUrl: PIXEL, resolvedIconUrl: PIXEL },
        { id: 'old-b', name: 'OldB', url: 'https://example.com/b', folderId: 'folder-work', type: 'shortcut', uploadedIconDataUrl: PIXEL, resolvedIconUrl: PIXEL },
        { id: 'old-c', name: 'OldC', url: 'https://example.com/c', folderId: 'folder-blog', type: 'shortcut', uploadedIconDataUrl: PIXEL, resolvedIconUrl: PIXEL }
      ]
    });
    const tabNames = await page.$$eval('#group-tabs .group-tab', (els) => els.map((el) => el.childNodes[0].textContent.trim()));
    assert.deepEqual(tabNames, ['主页', '工作'], 'AC6: legacy preset drawers dropped, custom kept');
    assert.deepEqual(await desktopOrder(page), ['old-b'], 'AC6: currentFolderId still selects 工作');
    await page.locator(groupSelector(HOME)).click();
    await page.waitForTimeout(250);
    assert.deepEqual(await desktopOrder(page), ['old-a', 'old-c'], 'AC6: blog icons move to home, order kept');
    const migrated = await page.evaluate(() => (
      window.OpenTabFolders.visibleIcons('folder-home').map((icon) => ({
        id: icon.id,
        folderId: icon.folderId,
        parentId: icon.parentId || ''
      }))
    ));
    assert.equal(migrated.find((icon) => icon.id === 'old-c')?.folderId, HOME, 'AC6: invalid drawer id remapped in memory');
    assert.ok(migrated.every((icon) => icon.parentId === ''), 'AC6: missing parentId becomes empty');
    console.log('AC6 passed');

    // --- BUG-021 import backup / restore snapshot keeps nested folders ---
    await resetHome(page, nestedFolderFixture());
    const exportedBackup = await exportBackupJson(page);
    const exportedPayload = JSON.parse(exportedBackup);
    const exportedIcons = Array.isArray(exportedPayload.icons) ? exportedPayload.icons : [];
    assert.equal(exportedIcons.find((icon) => icon.id === 'pack')?.type, 'folder', 'BUG-021: export includes the folder');
    assert.equal(exportedIcons.find((icon) => icon.id === 'p1')?.parentId, 'pack', 'BUG-021: export includes nested parentId');

    await resetHome(page, { icons: [], folders: folders(), currentFolderId: HOME });
    assert.deepEqual(await desktopOrder(page), [], 'BUG-021: desktop is empty before import');
    await importBackupJson(page, exportedBackup);
    await assertNestedFolderKept(page, 'BUG-021 import');
    console.log('BUG-021 import passed');

    // Deliberately deliver an old wallpaper request after an import commits.
    // Check real extension storage, not only the current page's rendered grid.
    for (const otherTab of [false, true]) {
      await resetHome(page, {
        icons: [], folders: folders(), currentFolderId: HOME,
        background: { type: 'gradient', value: 'linear-gradient(#123, #456)', source: 'gradient' }
      });
      const stalePage = otherTab ? await context.newPage() : page;
      if (otherTab) {
        await stalePage.goto(page.url(), { waitUntil: 'domcontentloaded' });
        await waitForGrid(stalePage);
      }
      await stalePage.evaluate(() => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        const test = window.__lateBingTest = { original, response: null, changed: false };
        test.listener = (changes, area) => {
          if (area === 'local' && changes.background) test.changed = true;
        };
        chrome.storage.onChanged.addListener(test.listener);
        chrome.runtime.sendMessage = (message, callback) => {
          if (message.action === 'fetchBingImage') test.response = callback;
          else return original(message, callback);
        };
        test.pending = OpenTabBingCache.fetchRandomBackground();
      });
      await stalePage.waitForFunction(() => typeof window.__lateBingTest.response === 'function');
      await page.evaluate(async (payload) => {
        OpenTabImport.setReloader(() => {});
        try { await OpenTabImport.applyOpenTabBackup(payload); }
        finally { OpenTabImport.setReloader(null); }
      }, exportedPayload);
      await stalePage.waitForFunction(() => window.__lateBingTest.changed);
      await stalePage.evaluate(async () => {
        const test = window.__lateBingTest;
        test.response({ success: true, url: 'assets/default_background/bg-mountain-dawn.jpg',
          startdate: '20260101', nextIndex: 1, title: 'Synthetic late wallpaper' });
        await test.pending;
        chrome.runtime.sendMessage = test.original;
        chrome.storage.onChanged.removeListener(test.listener);
        delete window.__lateBingTest;
      });
      assert.deepEqual(await storageIconIds(page), ['pack', 'p1', 'p2', 'solo'],
        `late Bing response (${otherTab ? 'other tab' : 'same tab'}): imported icons persisted`);
      const savedBackground = await page.evaluate(async () => (await chrome.storage.local.get('background')).background);
      assert.deepEqual(savedBackground, exportedPayload.background, 'late Bing response cannot overwrite imported wallpaper');
      if (otherTab) await stalePage.close();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForGrid(page);
      await assertNestedFolderKept(page, 'late Bing import reload');
    }
    console.log('Delayed Bing responses preserve imported folders and wallpaper in same/other tabs');

    await resetHome(page, nestedFolderFixture());
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.click('#backup-save-snapshot-btn');
    await page.waitForFunction(() => (document.getElementById('backup-status')?.textContent || '').includes('已保存快照'));
    await page.click('#close-settings');
    await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));
    await resetHome(page, { icons: [], folders: folders(), currentFolderId: HOME }, { clear: false });
    assert.deepEqual(await desktopOrder(page), [], 'BUG-021: desktop is empty before snapshot restore');
    await restoreLatestSnapshot(page);
    await assertNestedFolderKept(page, 'BUG-021 snapshot restore');
    console.log('BUG-021 snapshot restore passed');

    // Search Enter on a folder opens the overlay, not "网址无效"
    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        folderIcon('pack', '工作夹'),
        shortcut('p1', 'P1', 'https://example.com/p1', HOME, { parentId: 'pack' }),
        shortcut('p2', 'P2', 'https://example.com/p2', HOME, { parentId: 'pack' })
      ]
    });
    await page.fill('#search-input', '工作夹');
    await page.locator('#search-input').press('Enter');
    await page.waitForSelector('#folder-overlay:not(.hidden)');
    assert.deepEqual(await overlayIconIds(page), ['p1', 'p2'], 'search Enter on a folder opens overlay children');
    const searchToast = ((await page.locator('#toast').textContent()) || '');
    assert.equal(searchToast.includes('网址无效'), false, 'search Enter on a folder does not toast 网址无效');
    await page.keyboard.press('Escape');
    await page.locator('#folder-overlay').waitFor({ state: 'hidden' });
    console.log('search folder Enter passed');

    await resetHome(page, nestedFolderFixture());
    await page.locator(widgetSelector('pack')).click();
    await page.waitForSelector('#folder-overlay:not(.hidden)');
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('opentab-sync-applied'));
    });
    await page.locator('#folder-overlay').waitFor({ state: 'hidden' });
    console.log('sync-applied closes folder overlay');

    const bookmarkTree = [{
      id: '0',
      title: '',
      children: [{
        id: '1',
        title: '书签栏',
        children: [{
          id: '10',
          title: 'Work',
          children: [
            { id: '101', title: 'GitHub', url: 'https://github.com/' },
            { id: '102', title: 'Docs', url: 'https://docs.example.com/' }
          ]
        }]
      }]
    }];
    const topSites = Array.from({ length: 15 }, (_, i) => ({
      title: `Site ${i}`,
      url: `https://example.com/top/${i}`
    }));

    async function mockOptionalApis(granted = {}) {
      await page.evaluate(({ bookmarksGranted, topSitesGranted, tree, sites }) => {
        chrome.permissions = chrome.permissions || {};
        chrome.permissions.request = (spec, cb) => {
          const name = (spec && spec.permissions && spec.permissions[0]) || '';
          const ok = name === 'bookmarks' ? bookmarksGranted : name === 'topSites' ? topSitesGranted : false;
          if (typeof cb === 'function') cb(ok);
          return Promise.resolve(ok);
        };
        chrome.bookmarks = {
          getTree: (cb) => {
            if (typeof cb === 'function') cb(tree);
            return Promise.resolve(tree);
          }
        };
        chrome.topSites = {
          get: (cb) => {
            if (typeof cb === 'function') cb(sites);
            return Promise.resolve(sites);
          }
        };
      }, {
        bookmarksGranted: granted.bookmarks !== false,
        topSitesGranted: granted.topSites !== false,
        tree: granted.tree || bookmarkTree,
        sites: granted.sites || topSites
      });
    }

    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [shortcut('keep', 'Keep', 'https://keep.example.com/')],
      clockFormat: '24h'
    });
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.locator('#import-sync-section').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const text = document.getElementById('storage-usage')?.textContent || '';
      return text.includes('本地存储') && !text.includes('计算中');
    }, null, { timeout: 5000 });
    assert.equal(await page.locator('#import-bookmarks-btn').isVisible(), true, 'AC1: import bookmarks entry');
    assert.equal(await page.locator('#import-topsites-btn').isVisible(), true, 'AC2: import top sites entry');
    assert.equal(await page.locator('#import-file-btn').isVisible(), true, 'AC3: import file entry');
    assert.equal(await page.locator('#browser-sync-enabled').isVisible(), true, 'AC4: sync toggle');
    const usageText = ((await page.locator('#storage-usage').textContent()) || '').trim();
    assert.match(usageText, /本地存储/, 'AC5: local storage usage');
    await page.locator('#import-sync-section').screenshot({ path: path.join(ARTIFACTS, 'import_sync_entry.png') });

    await mockOptionalApis({ bookmarks: false });
    await page.click('#import-bookmarks-btn');
    await page.waitForFunction(() => {
      const text = document.getElementById('import-sync-status')?.textContent || '';
      return text.includes('书签权限');
    }, null, { timeout: 5000 });
    const deniedFolders = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['folders']);
      return (result.folders || []).map((folder) => folder.name);
    });
    assert.deepEqual(deniedFolders.filter((name) => name === 'Work'), [], 'AC1: deny does not import');
    console.log('AC1 deny passed');

    await mockOptionalApis({ bookmarks: true });
    await page.click('#import-bookmarks-btn');
    await page.waitForSelector('#bookmark-folder-row:not(.hidden)', { timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelectorAll('#bookmark-folder-select option').length > 0,
      null,
      { timeout: 5000 }
    );
    await page.selectOption('#bookmark-folder-select', '10');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#import-bookmarks-confirm-btn')
    ]);
    await waitForGrid(page);
    const afterBookmark = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons', 'folders']);
      return {
        names: (result.icons || []).map((icon) => icon.name),
        folders: (result.folders || []).map((folder) => folder.name)
      };
    });
    assert.ok(afterBookmark.names.includes('Keep'), 'AC1: existing shortcut remains');
    assert.ok(afterBookmark.names.includes('GitHub'), 'AC1: bookmark imported');
    assert.ok(afterBookmark.folders.includes('Work'), 'AC1: bookmark folder becomes a group');
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.locator('#import-sync-section').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !document.getElementById('import-undo-btn')?.disabled, null, { timeout: 5000 });
    const importStatus = ((await page.locator('#import-sync-status').textContent()) || '');
    assert.match(importStatus, /已导入/, 'AC3: import result copy');
    await page.locator('#import-sync-section').screenshot({ path: path.join(ARTIFACTS, 'import_result_and_undo.png') });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#import-undo-btn')
    ]);
    await waitForGrid(page);
    const afterUndo = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons', 'folders']);
      return {
        names: (result.icons || []).map((icon) => icon.name),
        folders: (result.folders || []).map((folder) => folder.name)
      };
    });
    assert.deepEqual(afterUndo.names, ['Keep'], 'AC3: undo restores icons');
    assert.ok(!afterUndo.folders.includes('Work'), 'AC3: undo removes imported group');
    console.log('AC1 bookmark import + undo passed');

    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [shortcut('keep', 'Keep', 'https://keep.example.com/')]
    });
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await mockOptionalApis({ topSites: true });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#import-topsites-btn')
    ]);
    await waitForGrid(page);
    const afterTop = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons', 'folders']);
      return {
        names: (result.icons || []).map((icon) => icon.name),
        folders: (result.folders || []).map((folder) => folder.name)
      };
    });
    assert.ok(afterTop.folders.includes('常用网站'), 'AC2: top sites become a group');
    assert.equal(afterTop.names.filter((name) => name.startsWith('Site ')).length, 12, 'AC2: first 12 top sites');
    console.log('AC2 top sites passed');

    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [shortcut('keep', 'Keep', 'https://keep.example.com/')]
    });
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    const beforeUnknown = await storageIconIds(page);
    await page.setInputFiles('#import-file-input', {
      name: 'mystery.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"foo":1}')
    });
    await page.waitForFunction(() => {
      const text = document.getElementById('import-sync-status')?.textContent || '';
      return text.includes('无法识别');
    }, null, { timeout: 5000 });
    assert.deepEqual(await storageIconIds(page), beforeUnknown, 'AC3: unrecognized file leaves data');
    console.log('AC3 unrecognized passed');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.setInputFiles('#import-file-input', {
        name: 'backup.infinity',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
          data: {
            site: {
              sites: [[{ type: 'web', name: 'InfinitySite', target: 'https://infinity.example/' }]]
            }
          }
        }))
      })
    ]);
    await waitForGrid(page);
    const afterInfinity = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons', 'folders']);
      return (result.icons || []).map((icon) => icon.name);
    });
    assert.ok(afterInfinity.includes('Keep'), 'AC3: Infinity import is additive');
    assert.ok(afterInfinity.includes('InfinitySite'), 'AC3: Infinity site imported');
    console.log('AC3 Infinity import passed');

    await resetHome(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [
        shortcut('sync-a', 'SyncA', 'https://example.com/sync-a'),
        {
          id: 'ssh-sync',
          name: 'SSH',
          type: 'ssh',
          folderId: HOME,
          sshHost: '10.0.0.8',
          sshUsername: 'root',
          sshPassword: 'plain-password',
          sshGatewayToken: 'plain-token',
          sshSocksPassword: 'plain-socks',
          uploadedIconDataUrl: PIXEL,
          resolvedIconUrl: PIXEL
        }
      ],
      background: { type: 'image', value: TINY_PNG_DATA_URL, source: 'local-upload' },
      clockFormat: '24h'
    });
    await waitForAsync(page, async () => {
      const result = await chrome.storage.local.get(['icons']);
      const ssh = (result.icons || []).find((icon) => icon.id === 'ssh-sync');
      return Boolean(ssh) && !ssh.sshPassword && !ssh.sshGatewayToken;
    }, null, { timeout: 8000 });
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.locator('#import-sync-section').scrollIntoViewIfNeeded();
    await page.check('#browser-sync-enabled');
    try {
      await waitForAsync(page, async () => {
        const all = await chrome.storage.sync.get(null);
        return Boolean(all && all['ot.s.meta']);
      }, null, { timeout: 8000 });
    } catch (error) {
      await page.waitForSelector('#time', { timeout: 10000 });
    }
    await page.waitForSelector('#time', { timeout: 10000 });
    await waitForGrid(page);
    await waitForAsync(page, async () => {
      const all = await chrome.storage.sync.get(null);
      return Boolean(all && all['ot.s.meta']);
    }, null, { timeout: 8000 });
    if (await page.locator('#settings-panel').evaluate((el) => el.classList.contains('hidden'))) {
      await page.click('#settings-btn');
      await page.waitForSelector('#settings-panel:not(.hidden)');
    }
    await page.locator('#import-sync-section').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const box = document.getElementById('browser-sync-enabled');
      return Boolean(box && box.checked);
    }, null, { timeout: 5000 });
    const syncAll = await page.evaluate(async () => chrome.storage.sync.get(null));
    const syncBlob = JSON.stringify(syncAll);
    assert.equal(syncBlob.includes('plain-password'), false, 'AC6: sync strips ssh password');
    assert.equal(syncBlob.includes('plain-token'), false, 'AC6: sync strips gateway token');
    assert.equal(syncBlob.includes(TINY_PNG_DATA_URL), false, 'AC4: sync skips wallpaper');
    const localIcons = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons']);
      return result.icons || [];
    });
    const sshStored = localIcons.find((icon) => icon.id === 'ssh-sync');
    assert.equal(sshStored?.sshPassword || '', '', 'AC6: local icons do not store plaintext password');
    const localCryptoKey = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['opentab.cryptoKey']);
      return result['opentab.cryptoKey'] || '';
    });
    assert.equal(localCryptoKey, '', 'BUG-019: raw wrapping key is not stored in chrome.storage.local');
    const keyNonExtractable = await page.evaluate(async () => {
      const key = await OpenTabSync.getCryptoKey();
      if (!key || key.extractable) return false;
      try {
        await crypto.subtle.exportKey('raw', key);
        return false;
      } catch (error) {
        return true;
      }
    });
    assert.equal(keyNonExtractable, true, 'BUG-019: CryptoKey is non-extractable');
    await page.waitForFunction(() => {
      const text = document.getElementById('storage-usage')?.textContent || '';
      return text.includes('本地存储') && text.includes('浏览器同步');
    }, null, { timeout: 8000 });
    const usageAfterSync = ((await page.locator('#storage-usage').textContent()) || '');
    assert.match(usageAfterSync, /本地存储/, 'AC5: usage after sync');
    assert.match(usageAfterSync, /浏览器同步/, 'AC4: sync usage shown');
    await page.locator('#import-sync-section').screenshot({ path: path.join(ARTIFACTS, 'sync_toggle_and_usage.png') });
    console.log('AC4/AC5/AC6 sync + secrets passed');

    const writesBeforeLoop = await page.evaluate(() => window.OpenTabSync.getWriteCount());
    const page2 = await context.newPage();
    attachErrorCollectors(page2, errorBuckets);
    await page2.goto(`chrome-extension://${extensionId}/home.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await page2.waitForSelector('#time', { timeout: 10000 });
    await page2.click('#settings-btn');
    await page2.waitForSelector('#settings-panel:not(.hidden)');
    if (!(await page2.locator('#browser-sync-enabled').isChecked())) {
      await page2.check('#browser-sync-enabled');
    }
    let extraDcl1 = 0;
    let extraDcl2 = 0;
    const onDcl1 = () => { extraDcl1 += 1; };
    const onDcl2 = () => { extraDcl2 += 1; };
    page.on('domcontentloaded', onDcl1);
    page2.on('domcontentloaded', onDcl2);
    await page.waitForTimeout(10000);
    page.off('domcontentloaded', onDcl1);
    page2.off('domcontentloaded', onDcl2);
    assert.equal(extraDcl1, 0, 'BUG-016: first synced tab does not reload while idle');
    assert.equal(extraDcl2, 0, 'BUG-016: second synced tab does not reload while idle');
    const writesAfterLoop = await page.evaluate(() => window.OpenTabSync.getWriteCount());
    assert.ok(
      writesAfterLoop - writesBeforeLoop <= 2,
      `BUG-016: sync writes should stay bounded, grew ${writesAfterLoop - writesBeforeLoop}`
    );
    assert.ok(writesAfterLoop <= 6, `BUG-016: total sync writes ${writesAfterLoop}`);
    await page2.close();
    console.log('BUG-016 two-tab sync idle passed');

    if (!(await page.locator('#settings-panel').evaluate((el) => el.classList.contains('hidden')))) {
      await page.click('#close-settings');
    }
    const sshIcon = page.locator('#icons-container .icon-widget[data-id="ssh-sync"]');
    await sshIcon.click({ button: 'right', force: true });
    await page.waitForSelector('#icon-context-menu:not(.hidden)');
    await page.click('#edit-icon-btn');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    assert.equal(
      await page.locator('#ssh-password').getAttribute('placeholder'),
      '已保存，留空则不修改'
    );
    await page.click('#cancel-btn');
    await page.waitForSelector('#add-icon-modal.hidden');

    const conflictResult = await page.evaluate(async () => {
      await OpenTabSync.setEnabled(false);
      await chrome.storage.local.set({
        icons: [{
          id: 'only-local',
          name: '本机独有',
          url: 'https://local.example/',
          folderId: 'folder-home',
          type: 'shortcut'
        }],
        folders: [{ id: 'folder-home', name: '主页' }]
      });
      const remote = OpenTabSync.buildSyncPayload({
        icons: [
          { id: 'cloud-1', name: '云端一', url: 'https://cloud.example/', folderId: 'folder-home', type: 'shortcut' },
          { id: 'cloud-2', name: '云端二', url: 'https://cloud2.example/', folderId: 'folder-home', type: 'shortcut' }
        ],
        folders: [{ id: 'folder-home', name: '主页' }]
      });
      remote.deviceId = 'dev-other-device';
      remote.hash = 'conflict-e2e';
      const plan = OpenTabSync.planSyncWrite(remote);
      const toSet = {};
      plan.items.forEach((item) => { toSet[item.key] = item.value; });
      await chrome.storage.sync.set(toSet);
      return OpenTabSync.setEnabled(true);
    });
    assert.equal(conflictResult.conflict, true, 'BUG-023: enabling sync with remote data offers a choice');
    const idsBeforeChoice = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons']);
      return (result.icons || []).map((icon) => icon.id);
    });
    assert.deepEqual(idsBeforeChoice, ['only-local']);
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.locator('#import-sync-section').scrollIntoViewIfNeeded();
    await page.waitForSelector('#sync-conflict-row:not(.hidden)');
    await page.locator('#import-sync-section').screenshot({ path: path.join(ARTIFACTS, 'sync_conflict_choice.png') });
    await page.click('#sync-use-remote-btn');
    await waitForAsync(page, async () => {
      const result = await chrome.storage.local.get(['icons', 'backupSnapshots']);
      const ids = (result.icons || []).map((icon) => icon.id);
      return ids.includes('cloud-1') && (result.backupSnapshots || []).length > 0;
    }, null, { timeout: 8000 });
    await page.waitForSelector('#toast:not(.hidden)');
    assert.match((await page.locator('#toast').textContent()) || '', /云端/);
    console.log('BUG-023 sync conflict choice passed');

    assert.ok(Array.isArray(localManifest.optional_permissions), 'AC7: optional_permissions present');
    assert.ok(localManifest.optional_permissions.includes('bookmarks'));
    assert.ok(localManifest.optional_permissions.includes('topSites'));
    assert.ok(!localManifest.permissions.includes('bookmarks'));
    assert.ok(!localManifest.permissions.includes('topSites'));
    console.log('AC7 optional permissions passed');

    const remoteSeed = {
      folders: folders(),
      currentFolderId: HOME,
      background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f 0%, #537895 100%)', source: 'gradient' },
      icons: [
        {
          id: 'gh-remote',
          name: 'GitHub',
          url: 'https://github.com',
          folderId: HOME,
          type: 'shortcut',
          parentId: '',
          customIconUrl: '',
          emoji: '',
          uploadedIconDataUrl: '',
          resolvedIconUrl: 'https://github.com/favicon.ico',
          iconCandidates: ['https://github.com/favicon.ico']
        },
        {
          id: 'ex-remote',
          name: 'Example',
          url: 'https://example.com',
          folderId: HOME,
          type: 'shortcut',
          parentId: '',
          customIconUrl: '',
          emoji: '',
          uploadedIconDataUrl: '',
          resolvedIconUrl: 'https://example.com/favicon.ico',
          iconCandidates: ['https://example.com/apple-touch-icon.png', 'https://example.com/favicon.ico']
        },
        {
          id: 'nocors-remote',
          name: 'NoCORS',
          url: 'https://cors-blocked.test',
          folderId: HOME,
          type: 'shortcut',
          parentId: '',
          customIconUrl: '',
          emoji: '',
          uploadedIconDataUrl: '',
          resolvedIconUrl: 'https://cors-blocked.test/favicon.ico',
          iconCandidates: ['https://cors-blocked.test/favicon.ico']
        }
      ]
    };
    const homeUrl = page.url();
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await writeHomeStorage(page, remoteSeed, true);
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#time', { timeout: 10000 });
    await waitForGrid(page);
    const firstScreenIconReqs = await page.evaluate(() => {
      const mark = performance.getEntriesByName('opentab:grid-ready')[0];
      const cutoff = mark ? mark.startTime : 0;
      return performance.getEntriesByType('resource')
        .filter((entry) => entry.startTime < cutoff)
        .map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType }));
    });
    const earlyThirdParty = firstScreenIconReqs
      .filter((entry) => isThirdPartyIconRequest(entry.name, entry.initiatorType || 'image'))
      .map((entry) => entry.name);
    assert.equal(
      earlyThirdParty.length,
      0,
      `AC5: first-screen third-party icon requests: ${earlyThirdParty.join(' | ')}`
    );
    const ghSrc = await page.locator('#icons-container .icon-widget[data-id="gh-remote"] img.icon-image').getAttribute('data-paint-src')
      || await page.locator('#icons-container .icon-widget[data-id="gh-remote"] img.icon-image').getAttribute('src');
    assert.ok(
      ghSrc && !/^https?:/i.test(ghSrc) && (ghSrc.includes('icons/library/github') || ghSrc.startsWith('data:')),
      `AC1/AC2: GitHub should paint a bundled tile, got ${ghSrc}`
    );
    const exSrc = await page.locator('#icons-container .icon-widget[data-id="ex-remote"] img.icon-image').getAttribute('data-paint-src');
    assert.ok(exSrc && !/^https?:/i.test(exSrc), `AC5: example.com first paint must not be http(s), got ${exSrc}`);
    const nocorsFirst = await page.locator('#icons-container .icon-widget[data-id="nocors-remote"] img.icon-image').getAttribute('data-paint-src');
    assert.ok(nocorsFirst && !/^https?:/i.test(nocorsFirst), `AC5: no-CORS host first paint must not be http(s), got ${nocorsFirst}`);
    await page.screenshot({ path: path.join(ARTIFACTS, 'grid-after-icons.png') });
    await page.waitForFunction(() => {
      const ex = document.querySelector('#icons-container .icon-widget[data-id="ex-remote"] img.icon-image');
      const blocked = document.querySelector('#icons-container .icon-widget[data-id="nocors-remote"] img.icon-image');
      return ex && /^https:\/\//i.test(ex.getAttribute('src') || '')
        && blocked && /^https:\/\//i.test(blocked.getAttribute('src') || '');
    }, null, { timeout: 8000 });
    const leftoverAfterDeferred = errorBuckets.page.filter((error) => !isExemptConsoleError(error));
    const leftoverConsoleAfterDeferred = errorBuckets.console.filter((error) => !isExemptConsoleError(error));
    assert.equal(leftoverAfterDeferred.length, 0, `BUG-025: pageerror after deferred img: ${leftoverAfterDeferred.join(' | ')}`);
    assert.equal(leftoverConsoleAfterDeferred.length, 0, `BUG-025: console after deferred img: ${leftoverConsoleAfterDeferred.join(' | ')}`);
    console.log('AC1/AC2/AC3/AC5 icon first-screen + deferred img passed');

    await page.locator('#icons-container .icon-widget[data-id="ex-remote"]').click({ button: 'right' });
    await page.waitForSelector('#icon-context-menu:not(.hidden)');
    await page.click('#change-icon-btn');
    await page.waitForSelector('#change-icon-modal:not(.hidden)', { timeout: 5000 });
    await page.fill('#change-icon-letter', 'Z');
    await page.locator('#change-icon-color').evaluate((el) => {
      el.value = '#2266aa';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#change-icon-placeholder');
    await page.waitForTimeout(200);
    const afterPlaceholder = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons']);
      return (result.icons || []).find((item) => item.id === 'ex-remote') || null;
    });
    assert.equal(afterPlaceholder.iconSource, 'placeholder');
    assert.equal((afterPlaceholder.placeholderLetter || '').toUpperCase(), 'Z');
    await page.click('#change-icon-close');
    await page.waitForSelector('#change-icon-modal.hidden');
    console.log('AC4 change-icon placeholder passed');

    await resetHome(page, { icons: [], folders: folders(), currentFolderId: HOME });
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.fill('#icon-name', 'GitHub HD');
    await page.fill('#icon-url', 'https://github.com');
    await page.click('#save-btn');
    await page.waitForSelector('#add-icon-modal.hidden');
    const addedSrc = await page.locator('#icons-container .icon-widget[data-id] img.icon-image').getAttribute('src');
    assert.ok(
      addedSrc && !/^https?:/i.test(addedSrc),
      `AC1: new GitHub shortcut must paint locally, got ${addedSrc}`
    );
    console.log('AC1 add-shortcut library hit passed');

    await resetHome(page, { icons: [], folders: folders(), currentFolderId: HOME });
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.fill('#icon-name', 'NoCORS Add');
    await page.fill('#icon-url', 'https://cors-blocked.test/added');
    await page.click('#save-btn');
    await page.waitForSelector('#add-icon-modal.hidden');
    await page.waitForFunction(() => {
      const img = document.querySelector('#icons-container .icon-widget[data-id] img.icon-image');
      return img && /^https:\/\//i.test(img.getAttribute('src') || '');
    }, null, { timeout: 8000 });
    console.log('BUG-025 add-shortcut deferred img without CORS fetch passed');

    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await writeHomeStorage(page, {
      folders: folders(),
      currentFolderId: HOME,
      icons: [{
        id: 'popup-added',
        name: 'Popup Site',
        url: 'https://popup-icon.example/',
        folderId: HOME,
        parentId: '',
        customIconUrl: '',
        emoji: '',
        uploadedIconDataUrl: '',
        resolvedIconUrl: '',
        iconCandidates: []
      }]
    }, true);
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#time', { timeout: 10000 });
    await waitForGrid(page);
    const popupFirst = await page.locator('#icons-container .icon-widget[data-id="popup-added"] img.icon-image').getAttribute('data-paint-src')
      || await page.locator('#icons-container .icon-widget[data-id="popup-added"] img.icon-image').getAttribute('src');
    assert.ok(popupFirst && !/^https?:/i.test(popupFirst), `BUG-026: popup record first paint local, got ${popupFirst}`);
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await mockOptionalApis({
      bookmarks: true,
      tree: [{
        id: '1',
        title: '书签栏',
        children: [{
          id: 'idle-bm',
          title: 'IdleImport',
          children: [{ id: 'idle-1', title: 'Imported Idle', url: 'https://import-idle.example/' }]
        }]
      }]
    });
    await page.locator('#import-sync-section').scrollIntoViewIfNeeded();
    await page.click('#import-bookmarks-btn');
    await page.waitForSelector('#bookmark-folder-row:not(.hidden)', { timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelectorAll('#bookmark-folder-select option').length > 0,
      null,
      { timeout: 5000 }
    );
    await page.selectOption('#bookmark-folder-select', 'idle-bm');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#import-bookmarks-confirm-btn')
    ]);
    await waitForGrid(page);
    await page.waitForFunction(() => {
      const img = document.querySelector('#icons-container .icon-widget[data-id="popup-added"] img.icon-image');
      return img && /^https:\/\//i.test(img.getAttribute('src') || '');
    }, null, { timeout: 8000 });
    const importedMeta = await page.evaluate(async () => {
      const result = await chrome.storage.local.get(['icons']);
      const icon = (result.icons || []).find((item) => /import-idle\.example/.test(item.url || ''));
      return icon ? { id: icon.id, folderId: icon.folderId } : null;
    });
    assert.ok(importedMeta && importedMeta.id, 'BUG-026: import created a shortcut');
    await page.click(groupSelector(importedMeta.folderId));
    await page.waitForFunction((id) => {
      const img = document.querySelector(`#icons-container .icon-widget[data-id="${id}"] img.icon-image`);
      return img && /^https:\/\//i.test(img.getAttribute('src') || '');
    }, importedMeta.id, { timeout: 8000 });
    console.log('BUG-026 popup + import deferred img passed');

    await resetHome(page, { icons: [], folders: folders(), currentFolderId: HOME });
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.fill('#icon-name', 'Custom GH');
    await page.fill('#icon-url', 'https://github.com');
    await page.fill('#icon-custom-url', 'https://cdn.custom-gh.test/logo.png');
    await page.click('#save-btn');
    await page.waitForSelector('#add-icon-modal.hidden');
    await page.waitForFunction(() => {
      const img = document.querySelector('#icons-container .icon-widget[data-id] img.icon-image');
      const src = img && img.getAttribute('src');
      return src && src.includes('cdn.custom-gh.test');
    }, null, { timeout: 8000 });
    const customGhSrc = await page.locator('#icons-container .icon-widget[data-id] img.icon-image').getAttribute('src');
    assert.equal(customGhSrc.includes('icons/library/github'), false, 'BUG-027: in-library custom URL beats library');
    console.log('BUG-027 in-library custom URL passed');

    await resetHome(page, { icons: [], folders: folders(), currentFolderId: HOME });
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.fill('#icon-name', 'Custom Ex');
    await page.fill('#icon-url', 'https://example.com/custom');
    await page.fill('#icon-custom-url', 'https://cdn.custom-ex.test/logo.png');
    await page.click('#save-btn');
    await page.waitForSelector('#add-icon-modal.hidden');
    await page.waitForFunction(() => {
      const img = document.querySelector('#icons-container .icon-widget[data-id] img.icon-image');
      const src = img && img.getAttribute('src');
      return src && src.includes('cdn.custom-ex.test');
    }, null, { timeout: 8000 });
    console.log('BUG-027 out-of-library custom URL passed');

    await resetHome(page, { icons: [], folders: folders(), currentFolderId: HOME });
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.fill('#icon-name', 'Upload Dot');
    await page.fill('#icon-url', 'https://example.com/upload');
    const pngBytes = Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64');
    await page.locator('#icon-file').setInputFiles({
      name: 'dot.png',
      mimeType: 'image/png',
      buffer: pngBytes
    });
    await page.waitForFunction(() => {
      const status = document.getElementById('icon-upload-status');
      return status && /已选择/.test(status.textContent || '');
    }, null, { timeout: 5000 });
    await page.click('#save-btn');
    await page.waitForSelector('#add-icon-modal.hidden');
    const uploadSrc = await page.locator('#icons-container .icon-widget[data-id] img.icon-image').getAttribute('src');
    assert.ok(uploadSrc && uploadSrc.startsWith('data:'), `AC4 upload must paint a data URL, got ${uploadSrc}`);
    console.log('AC4 upload local image passed');

    const leftoverPageErrors = errorBuckets.page.filter(error => !isExemptConsoleError(error));
    const leftoverConsole = errorBuckets.console.filter(error => !isExemptConsoleError(error));
    assert.equal(leftoverPageErrors.length, 0, `T9: pageerror: ${leftoverPageErrors.join(' | ')}`);
    assert.equal(leftoverConsole.length, 0, `T9: console error: ${leftoverConsole.join(' | ')}`);
    assert.equal(errorBuckets.sw.length, 0, `T9: service worker errors: ${errorBuckets.sw.join(' | ')}`);
    console.log('T9 passed');


    console.log('E2E passed: extension newtab UI loaded and core interactions work.');
  } catch (error) {
    // Preserve synthetic-fixture state before closing the browser on CI failure.
    for (const [index, target] of context.pages().entries()) {
      if (!target.url().includes('/home.html')) continue;
      try {
        console.error('E2E failure state', await target.evaluate(async () => {
          const stored = await chrome.storage.local.get(['icons', 'currentFolderId', 'background']);
          return {
            storedIcons: (stored.icons || []).map(({ id, type, parentId, folderId }) => ({ id, type, parentId, folderId })),
            currentFolderId: stored.currentFolderId,
            backgroundType: stored.background?.type,
            desktopIds: [...document.querySelectorAll('#icons-container [data-id]')].map((node) => node.dataset.id),
            backupStatus: document.getElementById('backup-status')?.textContent
          };
        }));
        await target.screenshot({ animations: 'disabled', path: path.join(ARTIFACTS, `failure-home-${index}.png`) });
      } catch (diagnosticError) {
        console.error('Unable to capture failure state:', diagnosticError.message);
      }
    }
    throw error;
  } finally {
    await context.close();
  }
}

runExtensionE2E().catch(error => {
  console.error('E2E failed:', error);
  process.exitCode = 1;
});
