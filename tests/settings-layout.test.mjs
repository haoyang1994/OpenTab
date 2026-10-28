import { verifyHomeControlsViewport } from './home-controls-viewport.mjs';
import { runUiRefinement } from './ui-refinement.mjs';
import { verifyInterfaceGlass } from './interface-glass.mjs';
import { verifySettingsDismissal } from './settings-dismiss.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { installStartupDiagnostics } from './startup-diagnostics.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { formatConsoleError, unexpectedErrors } from './console-allow.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '..');
// Keep screenshots in the same directory uploaded by the CI workflow.
const ARTIFACTS = path.join(EXTENSION_PATH, 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });
const GRID_READY_BUDGET_MS = 500;
const HOME = 'folder-home';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function resolveHeadless(defaultValue) {
  if (process.env.HEADLESS === 'false') return false;
  if (process.env.HEADLESS === 'true') return true;
  return defaultValue;
}

function shortcut(id, name, url) {
  return {
    id,
    name,
    url,
    folderId: HOME,
    type: 'shortcut',
    resolvedIconUrl: PIXEL,
    uploadedIconDataUrl: PIXEL
  };
}

async function storageGet(serviceWorker, keys) {
  return serviceWorker.evaluate((storageKeys) => new Promise((resolve) => {
    chrome.storage.local.get(storageKeys, (result) => resolve(result));
  }), keys);
}

async function storageSet(serviceWorker, payload) {
  await serviceWorker.evaluate((data) => new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  }), payload);
}

async function waitForGrid(page) {
  await page.waitForSelector('#add-shortcut-tile', { timeout: 10000 });
  await page.waitForFunction(
    () => performance.getEntriesByName('opentab:grid-ready').length > 0,
    null,
    { timeout: 10000 }
  );
}

async function layoutAtGridReady(page) {
  await waitForGrid(page);
  return page.evaluate(() => window.__layoutAtGridReady || null);
}

async function waitForSettingsSettled(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('settings-panel');
    if (!el || el.classList.contains('hidden')) return false;
    const transform = getComputedStyle(el).transform;
    return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
  });
}

async function openSettings(page) {
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-panel:not(.hidden)');
  await waitForSettingsSettled(page);
  assert.equal(await page.locator('#settings-panel').evaluate(el => getComputedStyle(el).contentVisibility), 'visible',
    'opening settings must restore its skipped subtree before navigation');
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(ARTIFACTS, name), fullPage: false });
}

async function labeledControls(page, rootSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const controls = [...root.querySelectorAll('input, select, textarea, button')];
    return controls.filter((el) => {
      if (el.hidden || el.type === 'hidden' || el.closest('.hidden')) return false;
      if (el.getAttribute('aria-label')) return false;
      if (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
      if (el.closest('label')) return false;
      if ((el.textContent || '').trim()) return false;
      return true;
    }).map((el) => el.id || el.className || el.tagName);
  }, rootSelector);
}

async function runSettingsLayoutE2E() {
  const homeJsBytes = fs.statSync(path.join(EXTENSION_PATH, 'home.js')).size;
  const layoutJsBytes = fs.statSync(path.join(EXTENSION_PATH, 'layout.js')).size;
  const navJsBytes = fs.statSync(path.join(EXTENSION_PATH, 'settings-nav.js')).size;
  console.log(`home.js bytes: ${homeJsBytes}; layout.js ${layoutJsBytes}; settings-nav.js ${navJsBytes}`);

  const headless = resolveHeadless(false);
  const context = await chromium.launchPersistentContext('', {
    locale: 'zh-CN',
    headless,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });
  const consoleErrors = [];
  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    const homeUrl = `chrome-extension://${extensionId}/home.html`;

    const page = await context.newPage();
    await page.addInitScript(installStartupDiagnostics);
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(formatConsoleError(msg));
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const started = Date.now();
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#time', { timeout: 10000 });
    await waitForGrid(page);
    const wallMs = Date.now() - started;
    const navTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const marks = performance.getEntriesByName('opentab:grid-ready');
      const phases = Object.fromEntries(['read-start', 'read-end', 'validated', 'loader-start', 'loader-end'].map(phase =>
        [phase, performance.getEntriesByName('opentab:initial-' + phase)[0]?.startTime ?? null]));
      return {
        dcl: nav ? nav.domContentLoadedEventEnd : null,
        navigation: nav ? {
          responseEnd: nav.responseEnd, domInteractive: nav.domInteractive,
          domContentLoadedEventStart: nav.domContentLoadedEventStart,
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd
        } : null,
        startupDiagnostics: window.__startupDiagnostics || null,
        gridReady: marks.length ? marks[0].startTime : null,
        phases,
        calendarBuilds: performance.getEntriesByName('opentab:calendar-build-start').length,
        resources: performance.getEntriesByType('resource').filter(entry => {
          const url = new URL(entry.name);
          return url.protocol === location.protocol && url.host === location.host && /\.(?:js|css)$/.test(url.pathname);
        }).map(entry => ({ path: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd, duration: entry.duration }))
      };
    });
    console.log(`AC7 first-screen wall=${wallMs}ms dcl=${navTiming.dcl}ms grid-ready=${navTiming.gridReady}ms`);
    const elapsed = (end, start) => end === null || start === null ? null : end - start;
    navTiming.durations = {
      readWait: elapsed(navTiming.phases['read-end'], navTiming.phases['read-start']),
      validation: elapsed(navTiming.phases.validated, navTiming.phases['read-end']),
      loaderToGrid: elapsed(navTiming.gridReady, navTiming.phases['loader-start'])
    };
    console.log('AC7 startup phases/resources: ' + JSON.stringify(navTiming));
    console.log('AC7 diagnostic API intervals include browser scheduling/IPC and cannot isolate disk I/O; style snapshot overhead is included, never subtracted.');
    fs.writeFileSync(path.join(ARTIFACTS, 'startup-diagnostics.json'), JSON.stringify({
      navigation: navTiming.navigation, phases: navTiming.phases,
      gridReady: navTiming.gridReady, dcl: navTiming.dcl,
      diagnostics: navTiming.startupDiagnostics
    }, null, 2));
    assert.equal(navTiming.calendarBuilds, 0, 'hidden calendar construction is not part of first-grid startup');
    assert.ok(navTiming.dcl > 0, 'AC7 DCL must be > 0');
    assert.ok(navTiming.gridReady != null, 'AC7 grid-ready missing');
    assert.ok(navTiming.gridReady <= GRID_READY_BUDGET_MS, `AC7 grid-ready ${navTiming.gridReady}ms`);
    assert.ok(navTiming.dcl <= GRID_READY_BUDGET_MS, `AC7 DCL ${navTiming.dcl}ms`);
    assert.equal(await page.locator('#settings-panel').evaluate(el => getComputedStyle(el).contentVisibility), 'hidden',
      'closed settings must not lay out its invisible controls at startup');

    await verifyHomeControlsViewport({ extensionPath: EXTENSION_PATH, artifacts: ARTIFACTS, headless });

    await storageSet(serviceWorker, {
      folders: [{ id: HOME, name: '主页' }],
      currentFolderId: HOME,
      icons: [
        shortcut('keep-a', 'KeepA', 'https://example.com/a'),
        shortcut('keep-b', 'KeepB', 'https://example.com/b')
      ]
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGrid(page);

    await openSettings(page);
    const navLabels = await page.$$eval('.settings-nav-btn', (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(navLabels, [
      '外观', '壁纸', '快捷方式与布局', '搜索', '天气', '导入与同步', '高级/开发者工具', '关于'
    ], 'AC1 nav labels');
    assert.equal(await page.locator('#settings-section-weather').count(), 1, 'AC1 weather placeholder');
    const wideDir = await page.locator('#settings-nav').evaluate((el) => getComputedStyle(el).flexDirection);
    assert.equal(wideDir, 'column', 'AC1 wide nav is a left column');
    await screenshot(page, 'settings-panel-wide.png');

    await page.click('#settings-nav-search');
    await page.waitForFunction(() => {
      const section = document.getElementById('search-settings-section');
      const root = document.getElementById('settings-content');
      if (!section || !root) return false;
      const top = root.getBoundingClientRect().top;
      return Math.abs(section.getBoundingClientRect().top - top) < 120;
    });
    assert.equal(
      await page.locator('#settings-nav-search').evaluate((el) => el.classList.contains('active')),
      true,
      'AC1 click nav highlights search'
    );

    await page.click('#settings-nav-appearance');
    await page.waitForFunction(() => document.getElementById('settings-nav-appearance').classList.contains('active'));
    await page.locator('#settings-content').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(() => document.getElementById('settings-nav-about').classList.contains('active'));
    console.log('AC1 nav + scroll spy passed');

    // Exercise rendering skipped by the closed panel, including interrupted
    // transitions and a viewport change before the subtree is restored.
    await page.evaluate(() => OpenTabSettingsNav.openSection('search'));
    await page.waitForFunction(() => OpenTabSettingsNav.getActiveId() === 'search'
      && Math.abs(document.getElementById('search-settings-section').getBoundingClientRect().top
        - document.getElementById('settings-content').getBoundingClientRect().top) < 2);
    const savedSettingsScroll = await page.locator('#settings-content').evaluate(el => el.scrollTop);
    assert.ok(savedSettingsScroll > 0, 'preservation fixture starts at a nonterminal section');
    await page.evaluate(() => OpenTabSettingsNav.close());
    await page.waitForFunction(() => {
      const el = document.getElementById('settings-panel');
      const x = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
      return x > 1 && x < el.getBoundingClientRect().width + 24;
    }, null, { timeout: 2000 });
    assert.equal(await page.evaluate(() => OpenTabSettingsNav.getActiveId()), 'search',
      'skipping hidden content must not spuriously select the last navigation section');
    await page.evaluate(() => OpenTabSettingsNav.open());
    await waitForSettingsSettled(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#settings-panel').evaluate(el => getComputedStyle(el).contentVisibility), 'visible');
    assert.equal(await page.evaluate(() => OpenTabSettingsNav.getActiveId()), 'search',
      'same-viewport reopening preserves active settings navigation');
    assert.ok(Math.abs(await page.locator('#settings-content').evaluate(el => el.scrollTop) - savedSettingsScroll) <= 1,
      'same-viewport reopening preserves settings scroll position');
    await page.evaluate(() => OpenTabSettingsNav.close());
    await page.setViewportSize({ width: 700, height: 800 });
    await openSettings(page);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'settings-search',
      'reopening a skipped subtree restores immediate search focus');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.getElementById('settings-panel').contains(document.activeElement)), true,
      'restored settings controls participate in the native tab order');
    await page.evaluate(() => OpenTabSettingsNav.openSection('search'));
    await page.waitForFunction(() => {
      const section = document.getElementById('search-settings-section');
      const root = document.getElementById('settings-content');
      return Math.abs(section.getBoundingClientRect().top - root.getBoundingClientRect().top) < 120;
    });

    await page.setViewportSize({ width: 700, height: 800 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('settings-nav')).flexDirection === 'row');
    await screenshot(page, 'settings-panel-narrow.png');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('settings-nav')).flexDirection === 'column');

    await page.fill('#settings-search', 'layout');
    await page.waitForSelector('#settings-section-shortcuts:not(.filtered-out)');
    assert.equal(await page.locator('#settings-section-appearance').evaluate((el) => el.classList.contains('filtered-out')), true);
    await page.fill('#settings-search', '更换图标');
    await page.waitForSelector('#settings-section-shortcuts:not(.filtered-out)');
    assert.equal(await page.locator('#settings-section-appearance').evaluate((el) => el.classList.contains('filtered-out')), true);
    await page.fill('#settings-search', 'seconds');
    await page.waitForSelector('#settings-section-appearance:not(.filtered-out)');
    assert.equal(await page.locator('#settings-section-shortcuts').evaluate((el) => el.classList.contains('filtered-out')), true);
    await page.fill('#settings-search', '天气');
    await page.waitForSelector('#settings-section-weather:not(.filtered-out)');
    await page.fill('#settings-search', 'zzzz-no-such-setting');
    await page.waitForSelector('#settings-empty:not(.hidden)');
    assert.match((await page.locator('#settings-empty').textContent()) || '', /没有找到/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('settings-search').value === '');
    assert.equal(await page.locator('#settings-panel').evaluate((el) => el.classList.contains('hidden')), false, 'AC2 first Esc clears search');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#settings-panel.hidden', { state: 'attached' });
    console.log('AC2 settings search + Esc passed');

    await openSettings(page);
    await page.click('#settings-nav-shortcuts');
    await page.$eval('#layout-icon-size', (el) => {
      el.value = '72';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-icon-size').trim() === '72px');
    await page.click('.layout-size-preset[data-size="80"]');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-icon-size').trim() === '80px');
    await page.locator('#icons-container .icon-widget[data-id="keep-a"]').click({ button: 'right' });
    await page.waitForSelector('#icon-context-menu:not(.hidden)');
    await page.click('#change-icon-btn');
    await page.waitForSelector('#change-icon-modal:not(.hidden)', { timeout: 5000 });
    assert.equal(
      await page.locator('.change-icon-preview').evaluate((el) => getComputedStyle(el).width),
      '80px',
      '更换图标 preview follows layout icon size'
    );
    await page.keyboard.press('Escape');
    await page.waitForSelector('#change-icon-modal.hidden', { state: 'attached' });
    assert.equal(
      await page.locator('#settings-panel').evaluate((el) => el.classList.contains('hidden')),
      false,
      'Esc on 更换图标 must not close the settings panel'
    );
    await page.selectOption('#layout-columns', '6');
    await page.waitForSelector('body.layout-fixed-cols');
    await page.uncheck('#layout-show-names');
    await page.waitForSelector('body.layout-hide-names');
    await page.$eval('#layout-max-width', (el) => {
      el.value = '1100';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-max-width').trim() === '1100px');
    const storedLayout = await storageGet(serviceWorker, [
      'layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth'
    ]);
    assert.equal(storedLayout.layoutIconSize, 80);
    assert.equal(storedLayout.layoutColumns, 6);
    assert.equal(storedLayout.layoutShowNames, false);
    assert.equal(storedLayout.layoutMaxWidth, 1100);
    const bootMirror = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('opentab.boot.v1') || 'null');
      } catch {
        return null;
      }
    });
    assert.equal(bootMirror?.layoutIconSize, 80, 'BUG-030 boot mirror stores layoutIconSize');
    assert.equal(bootMirror?.layoutColumns, 6, 'BUG-030 boot mirror stores layoutColumns');
    assert.equal(bootMirror?.layoutShowNames, false, 'BUG-030 boot mirror stores layoutShowNames');
    assert.equal(bootMirror?.layoutMaxWidth, 1100, 'BUG-030 boot mirror stores layoutMaxWidth');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const atReady = await layoutAtGridReady(page);
    assert.ok(atReady, 'BUG-030 layout snapshot missing at grid-ready');
    assert.equal(atReady.iconSize, '80px', 'BUG-030 icon size at grid-ready');
    assert.equal(atReady.columns, '6', 'BUG-030 columns at grid-ready');
    assert.equal(atReady.maxWidth, '1100px', 'BUG-030 max width at grid-ready');
    assert.equal(atReady.hideNames, true, 'BUG-030 hide-names at grid-ready');
    assert.equal(atReady.fixedCols, true, 'BUG-030 fixed columns at grid-ready');

    const cold = await context.newPage();
    cold.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(formatConsoleError(msg));
    });
    cold.on('pageerror', (error) => consoleErrors.push(error.message));
    await cold.addInitScript(installStartupDiagnostics, { stripLayoutMirror: true });
    await cold.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const coldReady = await layoutAtGridReady(cold);
    assert.ok(coldReady, 'BUG-030 loadState snapshot missing at grid-ready');
    assert.equal(coldReady.iconSize, '80px', 'BUG-030 loadState applies icon size before grid-ready');
    assert.equal(coldReady.columns, '6', 'BUG-030 loadState applies columns before grid-ready');
    assert.equal(coldReady.hideNames, true, 'BUG-030 loadState applies hide-names before grid-ready');
    assert.equal(coldReady.fixedCols, true, 'BUG-030 loadState applies fixed columns before grid-ready');
    await cold.close();
    console.log('AC3 layout persist passed');

    await openSettings(page);
    await page.click('#settings-nav-shortcuts');
    const iconsBefore = await page.$$eval('#icons-container .icon-widget[data-id]', (els) => els.map((el) => el.dataset.id));
    await page.locator('.settings-reset-section[data-section="shortcuts"]').click();
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    await page.locator('#inline-dialog-actions button', { hasText: '恢复默认' }).click();
    await page.waitForFunction(() => document.getElementById('inline-dialog').classList.contains('hidden'));
    await page.waitForSelector('#toast:not(.hidden)');
    assert.match((await page.locator('#toast').textContent()) || '', /撤销/);
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-icon-size').trim() === '56px');
    assert.deepEqual(
      await page.$$eval('#icons-container .icon-widget[data-id]', (els) => els.map((el) => el.dataset.id)),
      iconsBefore,
      'AC4 restore does not touch shortcuts'
    );
    await page.click('#close-settings');
    await page.locator('#toast button').click();
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-icon-size').trim() === '80px');
    console.log('AC4 section restore + undo passed');
    await openSettings(page);

    await page.$eval('#layout-icon-size', (el) => {
      el.value = '64';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#settings-reset-all');
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    const restoreBtn = page.locator('#inline-dialog-actions button', { hasText: '恢复默认' });
    await restoreBtn.focus();
    await page.keyboard.press('Tab');
    const dialogTrap = await page.evaluate(() => {
      const dialog = document.getElementById('inline-dialog');
      const first = dialog.querySelector('#inline-dialog-actions button');
      return document.activeElement === first;
    });
    assert.equal(dialogTrap, true, 'AC6 inline dialog traps Tab from last to first');
    await page.locator('#inline-dialog-actions button', { hasText: '取消' }).click();
    await page.waitForFunction(() => document.getElementById('inline-dialog').classList.contains('hidden'));
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-icon-size').trim()),
      '64px',
      'AC4 cancel restore leaves layout'
    );

    await storageSet(serviceWorker, { browserSyncEnabled: true });
    await page.evaluate(() => {
      const box = document.getElementById('browser-sync-enabled');
      if (box) box.checked = true;
    });
    await page.click('#settings-reset-all');
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    assert.equal(
      ((await page.locator('#inline-dialog').textContent()) || '').includes('会关闭浏览器同步'),
      false,
      'BUG-032 global restore copy does not say it will close sync'
    );
    await page.locator('#inline-dialog-actions button', { hasText: '恢复默认' }).click();
    await page.waitForFunction(() => document.getElementById('inline-dialog').classList.contains('hidden'));
    assert.equal(
      (await storageGet(serviceWorker, ['browserSyncEnabled'])).browserSyncEnabled,
      true,
      'BUG-032 global restore leaves browserSyncEnabled'
    );
    assert.equal(await page.locator('#browser-sync-enabled').isChecked(), true, 'BUG-032 global restore leaves sync checkbox');

    await page.click('#settings-nav-sync');
    await page.locator('.settings-reset-section[data-section="sync"]').click();
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    assert.match((await page.locator('#inline-dialog').textContent()) || '', /会关闭浏览器同步/);
    await page.locator('#inline-dialog-actions button', { hasText: '恢复默认' }).click();
    await page.waitForFunction(() => document.getElementById('inline-dialog').classList.contains('hidden'));
    await waitForAsync(page, async () => {
      const result = await chrome.storage.local.get(['browserSyncEnabled']);
      return result.browserSyncEnabled === false;
    });
    assert.equal(await page.locator('#browser-sync-enabled').isChecked(), false, 'BUG-032 sync-section restore turns sync off');

    await page.click('#close-settings');
    await page.waitForSelector('#settings-panel.hidden', { state: 'attached' });
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    const sshHidden = await page.locator('#icon-type option[value="ssh"]').evaluate((el) => el.hidden || el.disabled);
    assert.equal(sshHidden, true, 'AC5 ssh option hidden by default');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#add-icon-modal.hidden', { state: 'attached' });

    await openSettings(page);
    await page.click('#settings-nav-advanced');
    await page.check('#developer-tools-enabled');
    await page.click('#close-settings');
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    assert.equal(
      await page.locator('#icon-type option[value="ssh"]').evaluate((el) => el.hidden || el.disabled),
      false,
      'AC5 enabling developer tools shows SSH'
    );
    await page.keyboard.press('Escape');

    await serviceWorker.evaluate(() => new Promise((resolve) => {
      chrome.storage.local.remove('developerToolsEnabled', resolve);
    }));
    await storageSet(serviceWorker, {
      folders: [{ id: HOME, name: '主页' }],
      currentFolderId: HOME,
      icons: [{
        id: 'ssh-old',
        name: 'Box',
        type: 'ssh',
        folderId: HOME,
        sshGatewayUrl: 'ws://127.0.0.1:8787/ssh',
        sshGatewayToken: 't',
        sshHost: '127.0.0.1',
        sshUsername: 'root'
      }]
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGrid(page);
    await openSettings(page);
    await page.waitForFunction(() => document.getElementById('developer-tools-enabled')?.checked === true);
    await page.click('#close-settings');
    await page.click('#add-shortcut-tile');
    await page.waitForSelector('#add-icon-modal:not(.hidden)');
    assert.equal(
      await page.locator('#icon-type option[value="ssh"]').evaluate((el) => !(el.hidden || el.disabled)),
      true,
      'AC5 existing SSH users keep developer tools on'
    );

    await page.locator('#save-btn').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'modal-paste-sites',
      'AC6 add-icon modal traps Tab from Save to its new first batch-add entry');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'icon-type',
      'AC6 the batch-add entry participates in the native form tab order');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'modal-paste-sites');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'save-btn',
      'AC6 add-icon modal traps Shift+Tab from its first entry back to Save');
    await page.keyboard.press('Escape');

    await openSettings(page);
    const unlabeled = await labeledControls(page, '#settings-panel');
    assert.deepEqual(unlabeled, [], 'AC6 settings controls have labels/aria: ' + unlabeled.join(','));
    const unlabeledModal = await labeledControls(page, '#add-icon-modal');
    assert.deepEqual(unlabeledModal, [], 'AC6 add-icon controls have labels/aria: ' + unlabeledModal.join(','));

    await verifySettingsDismissal(page);
    await runUiRefinement(page, serviceWorker, ARTIFACTS);
    await verifyInterfaceGlass(page, serviceWorker, ARTIFACTS);

    const leftover = unexpectedErrors(consoleErrors);
    assert.equal(leftover.length, 0, `AC7 console errors: ${leftover.join(' | ')}`);
    console.log('E2E passed: settings layout AC1–AC6.');
  } finally {
    await context.close();
  }
}

runSettingsLayoutE2E().catch((error) => {
  console.error('Settings layout E2E failed:', error);
  process.exitCode = 1;
});
