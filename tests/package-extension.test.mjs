// Real Chromium MV3 smoke of the extracted ZIP, never the repository root.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { formatConsoleError } from './console-allow.mjs';
import { assertPackagedNavigation } from './package-navigation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opentab-package-smoke-'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
const zip = path.join(root, 'dist', `opentab-${version}.zip`);
const extension = path.join(temporary, 'extension');
let context;
try {
  execFileSync('python3', ['scripts/package-release.py', '--output', zip], { cwd: root, stdio: 'inherit' });
  execFileSync('python3', ['-m', 'zipfile', '-e', zip, extension], { stdio: 'inherit' });
  assert.ok(!fs.existsSync(path.join(extension, 'package.json')));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    headless: false, locale: 'en-US', colorScheme: 'light',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  // No dependence on external weather/background service availability.
  await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  assert.match(worker.url(), /\/background\.js$/);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'))).version);
  const errors = [];
  for (const file of ['home.html', 'popup.html', 'tool.html', 'fixparser.html', 'ssh_terminal.html']) {
    console.log(`Package smoke: opening ${file}`);
    const page = await context.newPage();
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`${file}: ${formatConsoleError(message)}`);
    });
    page.on('pageerror', error => errors.push(`${file}: ${error.message}`));
    page.on('requestfailed', request => {
      if (request.url().startsWith(`chrome-extension://${id}/`)) errors.push(`${file}: ${request.url()} ${request.failure()?.errorText}`);
    });
    const target = `chrome-extension://${id}/${file}`;
    const response = await page.goto(target, { waitUntil: 'load' });
    assertPackagedNavigation(response, await page.evaluate(() => ({
      url: location.href, runtimeId: globalThis.chrome?.runtime?.id, readyState: document.readyState
    })), target, id);
    if (file === 'home.html') {
      await page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0 && document.querySelector('#weather-pill')?.hasAttribute('data-stale'), undefined, { timeout: 10000 });
      await page.locator('#time').waitFor({ state: 'visible' });
      assert.match(await page.locator('#time').textContent(), /:/);
      assert.equal(await page.evaluate(() => typeof window.flatpickr), 'function');
      assert.ok(await page.evaluate(() => !!window.OpenTabI18n));
    }
    if (file === 'popup.html') {
      // Both asynchronous startup branches must finish, even when activeTab is
      // unavailable in a directly opened popup (an expected unsupported page).
      await page.waitForFunction(() => document.querySelector('#folder-select option[value="folder-home"]') && document.querySelector('#current-url')?.textContent.trim(), undefined, { timeout: 10000 });
      await page.locator('#folder-select').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.querySelector('#status').textContent === OpenTabI18n.t('读取当前页面失败，请重试。')), false, 'packaged popup initialization succeeds');
    }
    if (file === 'tool.html') {
      await page.locator('#input-area').fill('{"packaged":true}');
      await page.locator('#format-btn').click();
      assert.deepEqual(JSON.parse(await page.locator('#output-area').inputValue()), { packaged: true });
    }
    if (file === 'fixparser.html') {
      await page.locator('#input-area').fill('8=FIX.4.4|35=0|10=000|');
      await page.locator('#parse-btn').click();
      await page.locator('#timeline-container .timeline-item').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#timeline-container .timeline-item').count(), 1);
      assert.equal(await page.locator('.timeline-msgtype').textContent(), 'Heartbeat');
      assert.match(await page.locator('#detail-container').textContent(), /FIX\.4\.4/);
    }
    if (file === 'ssh_terminal.html') {
      assert.equal(await page.evaluate(() => typeof window.Terminal), 'function');
      assert.equal(await page.evaluate(() => typeof window.FitAddon.FitAddon), 'function');
      await page.locator('#terminal .xterm').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#status').textContent(), '参数错误');
    }
    console.log(`Package smoke: verified ${file}`);
    await page.close();
  }
  assert.deepEqual(errors, [], 'Packaged extension pages must load without runtime/missing-asset errors');
  console.log('Packaged MV3 smoke passed: extracted ZIP, worker and five extension pages.');
} finally {
  await context?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
