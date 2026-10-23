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
import { PIXEL } from './scenes-fixtures.mjs';

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
  for (const removed of ['fixparser.html', 'fixparser.js']) assert.ok(!fs.existsSync(path.join(extension, removed)), 'removed FIX assets are not packaged');
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
  for (const file of ['home.html', 'popup.html', 'tool.html', 'ssh_terminal.html']) {
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
      assert.equal(await page.locator('#tool-subtype option[value="fix-parser"]').count(), 0);
      const legacy = { id: 'removed-tool-fixture', name: 'Saved FIX shortcut', type: 'tool', toolSubtype: 'fix-parser', folderId: 'folder-home' };
      await page.evaluate(async icon => { await chrome.storage.local.set({ icons: [icon] }); }, legacy);
      await page.reload({ waitUntil: 'load' });
      const tile = page.locator('.icon-widget[data-id="removed-tool-fixture"]');
      await tile.waitFor({ state: 'visible' });
      await tile.focus();
      await page.keyboard.press('Enter');
      assert.equal(page.url(), target, 'removed shortcut does not navigate elsewhere');
      assert.equal(await page.locator('#toast').textContent(), 'This tool was removed. Your shortcut data is preserved.');
      const retained = await page.evaluate(async () => (await chrome.storage.local.get('icons')).icons);
      assert.equal(retained.length, 1);
      for (const [key, value] of Object.entries(legacy)) assert.equal(retained[0][key], value);
      const editLegacy = async () => {
        // This legacy tile is intentionally aria-disabled, so use a native
        // pointer action after proving its center is on-screen and reachable.
        // Visibility alone does not imply an absolute mouse coordinate is safe.
        await tile.scrollIntoViewIfNeeded();
        await tile.hover();
        const point = await tile.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
          return { x, y, inViewport: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
            hit: el.contains(document.elementFromPoint(x, y)) };
        });
        assert.equal(point.inViewport, true, 'legacy shortcut center is inside the viewport');
        assert.equal(point.hit, true, 'legacy shortcut wins the actual right-click hit test');
        await page.mouse.click(point.x, point.y, { button: 'right' });
        await page.locator('#edit-icon-btn').click();
        await page.locator('#add-icon-modal:not(.hidden)').waitFor({ state: 'visible' });
      };
      await editLegacy();
      await page.locator('#icon-name').fill('Renamed legacy shortcut');
      await page.locator('#save-btn').click();
      await page.locator('#add-icon-modal.hidden').waitFor({ state: 'attached' });
      let saved = await page.evaluate(async () => (await chrome.storage.local.get('icons')).icons[0]);
      assert.equal(saved.name, 'Renamed legacy shortcut');
      assert.equal(saved.toolSubtype, 'fix-parser', 'rename must not silently convert removed tool');
      await editLegacy();
      await page.locator('#tool-subtype').selectOption('json-format');
      await page.locator('#save-btn').click();
      await page.locator('#add-icon-modal.hidden').waitFor({ state: 'attached' });
      saved = await page.evaluate(async () => (await chrome.storage.local.get('icons')).icons[0]);
      assert.equal(saved.id, legacy.id);
      assert.equal(saved.toolSubtype, 'json-format', 'only explicit selection converts tool');
      assert.equal(await tile.getAttribute('href'), `chrome-extension://${id}/tool.html?tool=json-format`);

      // The release ZIP includes the new module, localized dialog and style,
      // not merely a working checkout-only feature.
      const launchUrl = 'https://packaged-launch.example.test/guide?mode=one#details';
      await page.evaluate(async ({ url, pixel }) => {
        await OpenTabWorkspace.transaction(({ write }) => write({ icons: [
          { id: 'packaged-launch-site', name: 'Packaged reference', url, type: 'shortcut', folderId: 'folder-home', parentId: '', uploadedIconDataUrl: `data:image/png;base64,${pixel}`, iconSource: 'upload' }
        ] }));
      }, { url: launchUrl, pixel: PIXEL });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => globalThis.OpenTabGroupLaunch && document.querySelector('.icon-widget[data-id="packaged-launch-site"]'));
      await page.waitForLoadState('networkidle');
      const launchBefore = await page.evaluate(() => chrome.storage.local.get(['icons', 'folders']));
      await page.click('#group-launch-entry');
      assert.equal(await page.locator('#group-launch-list input[type="checkbox"]').count(), 1);
      assert.equal(await page.locator('#group-launch-list input').inputValue(), launchUrl);
      assert.equal(await page.locator('#group-launch-confirm').textContent(), 'Open 1 selected websites');
      fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'artifacts/package-group-launch.png'), animations: 'disabled' });
      const opened = context.waitForEvent('page');
      await page.click('#group-launch-confirm');
      const launched = await opened;
      await launched.waitForURL(launchUrl);
      await page.waitForFunction(() => !OpenTabGroupLaunch.isPending() && document.querySelector('#group-launch-list input').disabled);
      assert.equal(page.url(), target, 'packaged group launch leaves its home page intact');
      assert.equal(await page.locator('#group-launch-status').textContent(), 'Opened 1 websites in background tabs.');
      assert.deepEqual(await page.evaluate(() => chrome.storage.local.get(['icons', 'folders'])), launchBefore, 'packaged launch never rewrites the workspace');
      await page.click('#group-launch-cancel');
      await launched.close();



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
      const before = await page.locator('#input-area').evaluate(input => ({ value: input.value, start: input.selectionStart, end: input.selectionEnd }));
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'copy-btn');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'input-area');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'clear-btn');
      assert.deepEqual(await page.locator('#input-area').evaluate(input => ({ value: input.value, start: input.selectionStart, end: input.selectionEnd })), before, 'focus navigation does not edit JSON');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'input-area');
      await page.keyboard.press('Control+]');
      assert.equal(await page.locator('#input-area').inputValue(), before.value + '  ');
      await page.locator('#format-btn').click();
      assert.deepEqual(JSON.parse(await page.locator('#output-area').inputValue()), { packaged: true });
      await page.setViewportSize({ width: 600, height: 800 });
      fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'artifacts/package-json-keyboard.png'), animations: 'disabled' });
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
  console.log('Packaged MV3 smoke passed: extracted ZIP, worker and four extension pages.');
} catch (error) {
  const failedPage = context?.pages().findLast(page => page.url().includes('/home.html'));
  if (failedPage) {
    console.error('Package smoke failure geometry', await failedPage.evaluate(() => {
      const tile = document.querySelector('[data-id="removed-tool-fixture"]');
      const rect = tile?.getBoundingClientRect();
      return { viewport: [innerWidth, innerHeight], tile: rect?.toJSON(),
        centerHit: rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id : null,
        menuClass: document.querySelector('#icon-context-menu')?.className };
    }).catch(() => null));
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await failedPage.screenshot({ path: path.join(root, 'artifacts/package-home-failure.png'), animations: 'disabled' }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
