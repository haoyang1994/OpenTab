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

function resolveHeadless(defaultValue) {
  if (process.env.HEADLESS === 'false') return false;
  if (process.env.HEADLESS === 'true') return true;
  return defaultValue;
}

async function runExtensionE2E() {
  assertVendoredRuntimeAssets();

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

    const unexpectedConsoleErrors = consoleErrors.filter(error => !error.includes('Failed to fetch Bing image'));
    assert.equal(
      unexpectedConsoleErrors.length,
      0,
      `Console errors detected: ${unexpectedConsoleErrors.join(' | ')}`
    );

    console.log('E2E passed: extension newtab UI loaded and core interactions work.');
  } finally {
    await context.close();
  }
}

runExtensionE2E().catch(error => {
  console.error('E2E failed:', error);
  process.exitCode = 1;
});
