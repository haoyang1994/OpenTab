// Real Chromium MV3 smoke of the extracted ZIP, never the repository root.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { formatConsoleError } from './console-allow.mjs';
import { assertPackagedNavigation } from './package-navigation.mjs';
import { PIXEL, graphKeys } from './scenes-fixtures.mjs';
const Schema = createRequire(import.meta.url)('../scene-schema.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opentab-package-smoke-'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
const zip = path.join(root, 'dist', `opentab-${version}.zip`);
const extension = path.join(temporary, 'extension');
let context;
const fixtureServer = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Packaged launch fixture</title><p id="launch-proof">Local packaged launch fixture</p>');
});
try {
  // Extension-created initial navigations can race Playwright route attachment.
  // A real loopback response proves successful navigation without public DNS.
  await new Promise((resolve, reject) => { fixtureServer.once('error', reject); fixtureServer.listen(0, '127.0.0.1', resolve); });
  const fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
  execFileSync('python3', ['scripts/package-release.py', '--output', zip], { cwd: root, stdio: 'inherit' });
  execFileSync('python3', ['-m', 'zipfile', '-e', zip, extension], { stdio: 'inherit' });
  assert.ok(!fs.existsSync(path.join(extension, 'package.json')));
  for (const removed of ['fixparser.html', 'fixparser.js']) assert.ok(!fs.existsSync(path.join(extension, removed)), 'removed FIX assets are not packaged');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    headless: false, locale: 'en-US', colorScheme: 'light',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  // No dependence on external weather/background service availability.
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === fixtureOrigin ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
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
      // Grid nodes are mounted before the async scene loader releases its
      // interaction gate. Visibility alone does not make them focusable.
      const waitForHomeInteraction = async () => {
        const ready = () => page.waitForFunction(() =>
          performance.getEntriesByName('opentab:grid-ready').length > 0
          && performance.getEntriesByName('opentab:initial-loader-end').length > 0
          && document.querySelector('#icons-container[data-grid-bound="1"]')
          && document.getElementById('homepage')?.inert === false, undefined, { timeout: 10000 });
        await ready();
        // Startup's TODO preference save is already queued before ready. Its
        // acknowledgement can rebuild normalized legacy tiles; join the same
        // workspace lock read-only before resolving and focusing current nodes.
        await page.evaluate(() => OpenTabWorkspace.read(['icons']));
        await ready();
      };
      await waitForHomeInteraction();
      await page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0 && document.querySelector('#weather-pill')?.hasAttribute('data-stale'), undefined, { timeout: 10000 });
      await page.locator('#time').waitFor({ state: 'visible' });
      assert.match(await page.locator('#time').textContent(), /:/);
      assert.equal(await page.evaluate(() => typeof window.flatpickr), 'undefined', 'closed packaged calendar does not load assets');
      await page.locator('#date').click();
      await page.locator('#calendar-popover:not(.hidden) .flatpickr-calendar').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => typeof window.flatpickr), 'function');
      await page.keyboard.press('Escape');
      await page.locator('#calendar-popover').waitFor({ state: 'hidden' });
      assert.ok(await page.evaluate(() => !!window.OpenTabI18n));

      // Exercise native fullscreen and keyboard input from the shipped ZIP,
      // without replacing browser APIs or widening the three-minute smoke.
      await page.waitForFunction(() => globalThis.OpenTabZenMode && globalThis.OpenTabClockDeck?.getFocus() && !document.getElementById('homepage').inert);
      const zenEntry = page.locator('#zen-toggle-btn');
      assert.equal((await zenEntry.textContent()).trim(), '', 'packaged Zen entry is icon-only');
      assert.equal(await zenEntry.locator('svg').count(), 1);
      assert.ok(await zenEntry.getAttribute('aria-label'), 'icon-only entry has an accessible name');
      const nativeFullscreen = await page.evaluate(() => document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function');
      await zenEntry.click();
      await page.locator('#zen-mode').waitFor({ state: 'visible' });
      if (nativeFullscreen) {
        await page.waitForFunction(() => document.fullscreenElement === document.documentElement, undefined, { timeout: 10000 });
      } else {
        assert.equal(await page.evaluate(() => document.fullscreenElement), null, 'unsupported fullscreen leaves usable windowed Zen');
      }
      assert.equal(await page.locator('#zen-time').textContent(), '25:00');
      assert.equal(await page.locator('#zen-mode').getAttribute('data-phase'), 'idle');
      assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().phase), 'idle');
      assert.equal(await page.evaluate(() => sessionStorage.getItem(OpenTabClockDeck.FOCUS_KEY)), null, 'entry never starts or persists the shared focus timer');
      assert.deepEqual((await page.locator('#zen-presets button').allTextContents()).map(text => text.trim()), ['15 min', '25 min', '50 min']);
      assert.equal(await page.locator('#zen-focus-toggle').innerText(), 'Start focus', 'the packaged timer identifies its action without instructions');
      assert.equal(await page.locator('#zen-focus-reset').isVisible(), false, 'reset is secondary and only appears after starting');
      assert.equal(await page.locator('.zen-ring circle').count(), 2);
      assert.equal(await page.locator('#homepage').isVisible(), false);
      assert.equal(await page.locator('#homepage').evaluate(home => home.inert), true);
      fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'artifacts/package-zen.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.fullscreenElement === null, undefined, { timeout: 10000 });
      assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), true, 'native Escape leaves Zen open');
      assert.equal(await page.locator('#zen-mode').isVisible(), true);
      assert.equal(await page.locator('#zen-time').textContent(), '25:00');
      await page.click('#zen-presets [data-duration="900000"]');
      assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().phase), 'idle', 'choosing a duration never starts the shared timer');
      assert.equal(await page.locator('#zen-time').textContent(), '15:00');
      assert.equal(await page.locator('#clock-focus-progress').evaluate(el => el.max), 900000);
      await page.click('#zen-focus-toggle');
      assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().phase), 'running', 'shipped Zen controls the existing clock-deck timer');
      assert.equal(await page.locator('#clock-focus-toggle').textContent(), 'Pause');
      await page.click('#zen-focus-reset');
      assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().phase), 'idle');
      assert.equal(await page.locator('#clock-focus-time').textContent(), '15:00');
      assert.equal(await page.locator('#zen-time').textContent(), '15:00');
      await page.click('#zen-exit');
      await page.locator('#zen-mode').waitFor({ state: 'hidden' });
      await page.locator('#homepage').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), false);
      assert.equal(await page.locator('#homepage').evaluate(home => home.inert), false);
      assert.equal(await zenEntry.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'zen-toggle-btn', 'quiet exit restores the actual entry control');
      assert.equal(await page.evaluate(() => document.fullscreenElement), null);

      assert.equal(await page.locator('#tool-subtype option[value="fix-parser"]').count(), 0);
      const legacy = { id: 'removed-tool-fixture', name: 'Saved FIX shortcut', type: 'tool', toolSubtype: 'fix-parser', folderId: 'folder-home' };
      await page.evaluate(async icon => { await chrome.storage.local.set({ icons: [icon] }); }, legacy);
      await page.reload({ waitUntil: 'load' });
      await waitForHomeInteraction();
      const tile = page.locator('.icon-widget[data-id="removed-tool-fixture"]');
      await tile.waitFor({ state: 'visible' });
      await tile.focus();
      assert.equal(await tile.evaluate(node => document.activeElement === node), true, 'removed shortcut owns actual focus before native Enter');
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
        await waitForHomeInteraction();
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
      const launchUrl = `${fixtureOrigin}/guide?mode=one#details`;
      await page.evaluate(async ({ url, pixel }) => {
        await OpenTabWorkspace.transaction(({ write }) => write({ icons: [
          { id: 'packaged-launch-site', name: 'Packaged reference', url, type: 'shortcut', folderId: 'folder-home', parentId: '', uploadedIconDataUrl: `data:image/png;base64,${pixel}`, iconSource: 'upload' }
        ] }));
      }, { url: launchUrl, pixel: PIXEL });
      await page.reload({ waitUntil: 'load' });
      await waitForHomeInteraction();
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
      await launched.locator('#launch-proof').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !OpenTabGroupLaunch.isPending() && document.querySelector('#group-launch-list input').disabled);
      assert.equal(page.url(), target, 'packaged group launch leaves its home page intact');
      assert.equal(await page.locator('#group-launch-status').textContent(), 'Opened 1 websites in background tabs.');
      assert.deepEqual(await page.evaluate(() => chrome.storage.local.get(['icons', 'folders'])), launchBefore, 'packaged launch never rewrites the workspace');
      await page.click('#group-launch-cancel');
      await launched.close();

      // Exercise the shipped cross-scene chooser from the extracted ZIP. This
      // proof stays small enough for the package smoke's three-minute budget.
      let moveFixture = Schema.create(Schema.migrateLegacy({
        folders: [{ id: 'folder-home', name: 'Home' }],
        icons: [{ id: 'packaged-move-site', name: 'Packaged move reference', url: launchUrl, type: 'shortcut', folderId: 'folder-home', parentId: '',
          uploadedIconDataUrl: `data:image/png;base64,${PIXEL}`, iconSource: 'upload', opaque: { retained: true } }],
        todos: [{ id: 'packaged-task', text: 'Retain packaged task', done: false }], currentFolderId: 'folder-home',
        background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f, #537895)', source: 'gradient' },
        languagePreference: 'en', weatherEnabled: false, particlesEnabled: false, gradientFlow: false, browserSyncEnabled: false,
        searchHistoryEnabled: false, searchSuggestionsEnabled: false, todoPanelOpen: false
      }), { id: 'packaged-work', name: 'Work', iconKey: 'briefcase', homeGroupId: 'packaged-work-home', homeName: 'Home',
        profile: { background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f, #537895)', source: 'gradient' } } });
      moveFixture.lastOpenedSceneId = 'packaged-work';
      const moveKeys = [...graphKeys, 'currentFolderId', 'lastOpenedSceneId'];
      await page.evaluate(async fixture => {
        sessionStorage.setItem('opentab.scene.view', JSON.stringify({ sceneId: 'scene-default', lastGroupIds: { 'scene-default': 'folder-home' } }));
        await OpenTabWorkspace.transaction(({ write }) => write(fixture));
      }, moveFixture);
      await page.reload({ waitUntil: 'load' });
      await waitForHomeInteraction();
      await page.waitForFunction(() => OpenTabSceneNavigation?.getView()?.sceneId === 'scene-default' && document.querySelector('.icon-widget[data-id="packaged-move-site"]'));
      await page.waitForLoadState('networkidle');
      const moveBefore = await page.evaluate(keys => chrome.storage.local.get(keys), moveKeys);
      const sourceSession = await page.evaluate(() => sessionStorage.getItem('opentab.scene.view'));
      const pagesBefore = context.pages().length;
      await page.click('#select-sites');
      await page.locator('.icon-widget[data-id="packaged-move-site"] .site-selection-checkbox').check();
      await page.click('#site-selection-move');
      const destinationOption = page.locator('#site-selection-destination option[data-kind="group"][data-destination-id="packaged-work-home"]');
      assert.equal(await destinationOption.count(), 1);
      assert.match(await destinationOption.textContent(), /Work.*Home/);
      await page.locator('#site-selection-destination').selectOption(await destinationOption.getAttribute('value'));
      assert.match(await page.locator('#site-selection-preview').textContent(), /1.*Work.*Home/s);
      await page.screenshot({ path: path.join(root, 'artifacts/package-cross-scene-move.png'), animations: 'disabled' });
      await page.click('#site-selection-confirm');
      await page.waitForFunction(() => !OpenTabSiteSelection.isPending() && !OpenTabSiteSelection.isActive());
      const moved = structuredClone(moveBefore);
      moved.icons.find(icon => icon.id === 'packaged-move-site').folderId = 'packaged-work-home';
      assert.deepEqual(await page.evaluate(keys => chrome.storage.local.get(keys), moveKeys), moved, 'shipped chooser moves only membership, preserving complete records and profiles');
      assert.equal(await page.evaluate(() => OpenTabSceneNavigation.getView().sceneId), 'scene-default');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('opentab.scene.view')), sourceSession);
      assert.equal(context.pages().length, pagesBefore, 'packaged move does not launch tabs');
      assert.equal(page.url(), target);
      await page.reload({ waitUntil: 'load' });
      await waitForHomeInteraction();
      await page.waitForFunction(() => OpenTabSceneNavigation?.getView()?.sceneId === 'scene-default' && globalThis.OpenTabSiteSelection);
      assert.equal(await page.locator('.icon-widget[data-id="packaged-move-site"]').count(), 0, 'packaged source remains empty after reload');
      await page.evaluate(() => sessionStorage.setItem('opentab.scene.view', JSON.stringify({ sceneId: 'packaged-work', lastGroupIds: { 'packaged-work': 'packaged-work-home' } })));
      await page.reload({ waitUntil: 'load' });
      await waitForHomeInteraction();
      await page.locator('.icon-widget[data-id="packaged-move-site"]').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => OpenTabSceneNavigation.getView().sceneId), 'packaged-work');
      assert.deepEqual(await page.evaluate(keys => chrome.storage.local.get(keys), moveKeys), moved, 'packaged destination reload retains the same original record');
      // Keep the existing popup smoke's explicit Default/Home fixture intact.
      await page.evaluate(() => OpenTabWorkspace.transaction(({ write }) => write({ lastOpenedSceneId: 'scene-default' })));
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
      const identity = node => node ? { tag: node.tagName, id: node.id, className: node.className, dataId: node.dataset.id } : null;
      return { viewport: [innerWidth, innerHeight], tile: rect?.toJSON(),
        centerHit: rect ? identity(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) : null,
        focused: identity(document.activeElement), tileFocused: !!tile && tile === document.activeElement,
        tileInertAncestor: identity(tile?.closest('[inert]')), homepageInert: document.getElementById('homepage')?.inert,
        gridBound: document.getElementById('icons-container')?.dataset.gridBound,
        gridReady: performance.getEntriesByName('opentab:grid-ready').length,
        loaderEnded: performance.getEntriesByName('opentab:initial-loader-end').length,
        zenActive: globalThis.OpenTabZenMode?.isActive(), fullscreenElement: identity(document.fullscreenElement),
        toast: document.getElementById('toast')?.textContent,
        menuClass: document.querySelector('#icon-context-menu')?.className };
    }).catch(() => null));
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await failedPage.screenshot({ path: path.join(root, 'artifacts/package-home-failure.png'), animations: 'disabled' }).catch(() => {});
  }
  throw error;
} finally {
  try { await context?.close(); }
  finally {
    fixtureServer.closeAllConnections();
    try { if (fixtureServer.listening) await new Promise(resolve => fixtureServer.close(resolve)); }
    finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
}
