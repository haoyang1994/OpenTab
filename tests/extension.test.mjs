import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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

function unexpectedErrors(errors) {
  return errors.filter((error) => (
    !error.includes('Failed to fetch Bing image')
    && !error.includes('example.com')
  ));
}

function collectPageErrors(page, errors) {
  const onConsole = (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  };
  const onPageError = (error) => {
    errors.push(String(error?.message || error));
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  };
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
  return text.includes('Failed to fetch Bing image');
}

function shortcut(id, name, url, folderId = HOME) {
  return {
    id,
    name,
    url,
    folderId,
    type: 'shortcut',
    customIconUrl: '',
    emoji: '',
    uploadedIconDataUrl: PIXEL,
    resolvedIconUrl: PIXEL,
    iconCandidates: [PIXEL]
  };
}

function folders(...extra) {
  return [{ id: HOME, name: '主页' }, ...extra];
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

function attachErrorCollectors(target, buckets) {
  target.on('pageerror', error => {
    buckets.page.push(String(error));
  });
  target.on('console', msg => {
    if (msg.type() === 'error') buckets.console.push(msg.text());
  });
}

async function waitForGrid(page) {
  await page.waitForSelector('#add-shortcut-tile', { timeout: 10000 });
  await page.waitForFunction(
    () => performance.getEntriesByName('opentab:grid-ready').length > 0,
    null,
    { timeout: 10000 }
  );
}

async function resetHome(page, payload) {
  await page.evaluate(async (data) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(data);
  }, payload);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#time', { timeout: 10000 });
  await waitForGrid(page);
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

async function html5Drag(page, fromId, toSelector, where = 'left') {
  await page.evaluate(({ fromId, toSelector, where }) => {
    const src = document.querySelector(`#icons-container .icon-widget[data-id="${fromId}"]`);
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
  }, { fromId, toSelector, where });
}

async function runExtensionE2E() {
  assertVendoredRuntimeAssets();
  assertReplacementAssets();
  assertManifestIconsAreValidPng();

  const headless = resolveHeadless(false);
  const context = await chromium.launchPersistentContext('', {
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
        || url.includes('wttr.in')
      ) {
        return route.continue();
      }
      if (/\.(ico|png|jpe?g|svg|webp|gif)(\?|$)/i.test(url) || url.includes('favicon') || url.includes('apple-touch')) {
        return route.fulfill({
          status: 200,
          contentType: 'image/gif',
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
        if (msg.type() === 'error') errorBuckets.sw.push(msg.text());
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
    assert.equal(await imagePresets.count(), 3, 'should ship three bundled image presets');
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
    console.log('T7 passed');

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
        observer.observe({ type: 'longtask', buffered: true });
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
    const masterManifest = readMasterManifest();
    if (masterManifest) {
      const expectedPerms = masterManifest.permissions.filter(item => item !== 'contextMenus');
      assert.deepEqual(localManifest.permissions, expectedPerms, 'T10: permissions otherwise match master');
      assert.deepEqual(localManifest.host_permissions, masterManifest.host_permissions, 'T10: host_permissions unchanged');
    } else {
      assert.deepEqual(localManifest.permissions, ['storage', 'activeTab', 'tabs', 'geolocation']);
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
    await page.waitForFunction(async () => {
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

    const leftoverPageErrors = errorBuckets.page.filter(error => !isExemptConsoleError(error));
    const leftoverConsole = errorBuckets.console.filter(error => !isExemptConsoleError(error));
    assert.equal(leftoverPageErrors.length, 0, `T9: pageerror: ${leftoverPageErrors.join(' | ')}`);
    assert.equal(leftoverConsole.length, 0, `T9: console error: ${leftoverConsole.join(' | ')}`);
    assert.equal(errorBuckets.sw.length, 0, `T9: service worker errors: ${errorBuckets.sw.join(' | ')}`);
    console.log('T9 passed');


    console.log('E2E passed: extension newtab UI loaded and core interactions work.');
  } finally {
    await context.close();
  }
}

runExtensionE2E().catch(error => {
  console.error('E2E failed:', error);
  process.exitCode = 1;
});
