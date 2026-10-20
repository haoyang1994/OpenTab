import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '..');

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

function unexpectedErrors(errors) {
  return errors.filter((error) => (
    !error.includes('Failed to fetch Bing image')
    && !error.includes('example.com')
  ));
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
  const onConsole = (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  };
  const onFailed = (request) => failed.push(request.url());
  page.on('console', onConsole);
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
    page.off('console', onConsole);
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

async function runExtensionE2E() {
  assertVendoredRuntimeAssets();
  assertReplacementAssets();

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

  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];

    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

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
      `SSH terminal console errors: ${sshConsoleErrors.join(' | ')}`
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

    const unexpectedConsoleErrors = consoleErrors.filter(error => !error.includes('Failed to fetch Bing image'));
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
        `${legacy} console errors: ${unexpectedErrors(result.errors).join(' | ')}`
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
      `chrome-extension URL console errors: ${unexpectedErrors(absoluteResult.errors).join(' | ')}`
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
      `unknown path console errors: ${unexpectedErrors(unknownResult.errors).join(' | ')}`
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
      `data URL console errors: ${unexpectedErrors(dataUrlResult.errors).join(' | ')}`
    );

    await loadHomeWithBackground(migrationPage, serviceWorker, extensionId, {
      type: 'bing',
      value: '',
      source: ''
    });
    const backupErrors = [];
    const backupFailed = [];
    const onBackupConsole = (msg) => {
      if (msg.type() === 'error') backupErrors.push(msg.text());
    };
    const onBackupFailed = (request) => backupFailed.push(request.url());
    migrationPage.on('console', onBackupConsole);
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
      migrationPage.off('console', onBackupConsole);
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
      `backup import console errors: ${unexpectedErrors(backupErrors).join(' | ')}`
    );

    await migrationPage.close();

    console.log('E2E passed: extension newtab UI loaded and core interactions work.');
  } finally {
    await context.close();
  }
}

runExtensionE2E().catch(error => {
  console.error('E2E failed:', error);
  process.exitCode = 1;
});
