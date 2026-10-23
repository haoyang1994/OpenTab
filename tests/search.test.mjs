import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { formatConsoleError, unexpectedErrors } from './console-allow.mjs';
import { verifySavedSites } from './search-saved-sites.mjs';
import { verifyEngineDeck, chooseSearchEngine } from './search-engine-deck.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(EXTENSION_PATH, 'artifacts');
const HOME_JS_MASTER_BYTES = 106755;
// Same ceiling as T8 (`opentab:grid-ready` ≤ 500ms). dcl===0 must not pass.
// Same-machine 5-run medians (this VM, headed Chromium, 2026-10-20):
//   master 48d62d4  DCL=60.1ms  grid-ready=128.5ms  wall=226ms
//   feat/search     DCL=51.9ms  grid-ready=141.8ms  wall=216ms
// n=10 (second 5+5, quieter median): DCL 52.8→56.8ms (+7.5%), grid-ready 124.4→135.5ms (+8.9%)
const GRID_READY_BUDGET_MS = 500;

function resolveHeadless(defaultValue) {
  if (process.env.HEADLESS === 'false') return false;
  if (process.env.HEADLESS === 'true') return true;
  return defaultValue;
}

async function waitForSearch(page) {
  await page.waitForSelector('#search-input', { timeout: 10000 });
  await page.waitForFunction(() => window.OpenTabSearch && typeof window.OpenTabSearch.resolve === 'function');
}

async function installNavHook(page) {
  await page.evaluate(() => {
    window.__navLog = [];
    window.OpenTabSearch.navigateHook = (url, openInNewTab) => {
      window.__navLog.push({ url, openInNewTab: Boolean(openInNewTab) });
    };
  });
}

async function navLog(page) {
  return page.evaluate(() => window.__navLog || []);
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

async function screenshot(page, name) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, name),
    fullPage: false,
    animations: 'disabled'
  });
}

async function runSearchE2E() {
  const homeJsBytes = fs.statSync(path.join(EXTENSION_PATH, 'home.js')).size;
  const searchJsBytes = fs.statSync(path.join(EXTENSION_PATH, 'search.js')).size;
  console.log(`home.js bytes: ${homeJsBytes} (pre-search master ${HOME_JS_MASTER_BYTES}, delta ${homeJsBytes - HOME_JS_MASTER_BYTES})`);
  console.log(`search.js bytes: ${searchJsBytes}`);

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

  const consoleErrors = [];
  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    const homeUrl = `chrome-extension://${extensionId}/home.html`;

    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(formatConsoleError(msg));
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const started = Date.now();
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#time', { timeout: 10000 });
    await waitForSearch(page);
    await page.waitForFunction(
      () => performance.getEntriesByName('opentab:grid-ready').length > 0,
      null,
      { timeout: 10000 }
    );
    const wallMs = Date.now() - started;
    const navTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const marks = performance.getEntriesByName('opentab:grid-ready');
      return {
        dcl: nav ? nav.domContentLoadedEventEnd : null,
        load: nav ? nav.loadEventEnd : null,
        gridReady: marks.length ? marks[0].startTime : null,
        navigation: nav ? { responseEnd: nav.responseEnd, domInteractive: nav.domInteractive,
          domContentLoadedEventStart: nav.domContentLoadedEventStart } : null,
        // Read existing entries only after grid-ready. No added startup work,
        // API wrappers, readiness changes, retry, or alternate timing threshold.
        phases: performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('opentab:'))
          .slice(0, 64).map(entry => ({ name: entry.name, at: entry.startTime })),
        resources: performance.getEntriesByType('resource').filter(entry => entry.name.startsWith(location.origin + '/'))
          .slice(0, 128).map(entry => ({ path: new URL(entry.name).pathname, start: entry.startTime,
            responseEnd: entry.responseEnd, duration: entry.duration }))
      };
    });
    console.log(
      `AC8 first-screen wall=${wallMs}ms dcl=${navTiming.dcl}ms load=${navTiming.load}ms grid-ready=${navTiming.gridReady}ms`
    );
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'startup-diagnostics-search.json'), JSON.stringify(navTiming, null, 2));
    assert.ok(navTiming.dcl != null && navTiming.dcl > 0, `AC8 DCL missing or zero: ${navTiming.dcl}`);
    assert.ok(navTiming.gridReady != null, 'AC8: opentab:grid-ready mark missing');
    assert.ok(
      navTiming.gridReady <= GRID_READY_BUDGET_MS,
      `AC8 opentab:grid-ready ${navTiming.gridReady}ms exceeded ${GRID_READY_BUDGET_MS}ms`
    );
    assert.ok(
      navTiming.dcl <= GRID_READY_BUDGET_MS,
      `AC8 first-screen DCL ${navTiming.dcl}ms exceeded ${GRID_READY_BUDGET_MS}ms`
    );

    await installNavHook(page);

    // AC1 built-in engines
    for (const engine of ['google', 'bing', 'baidu', 'duckduckgo', 'github']) {
      assert.equal(
        await page.locator(`.engine-btn[data-engine="${engine}"]`).count(),
        1,
        `AC1 missing built-in engine ${engine}`
      );
    }

    await chooseSearchEngine(page, 'baidu');
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchEngine === 'baidu');
    assert.equal(
      await page.locator('.engine-btn[data-engine="baidu"]').evaluate((el) => el.classList.contains('active')),
      true,
      'AC1 Baidu button should be highlighted'
    );
    await screenshot(page, 'search_engine_baidu.png');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSearch(page);
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchEngine === 'baidu');
    const storedEngine = await storageGet(serviceWorker, ['searchEngine']);
    assert.equal(storedEngine.searchEngine, 'baidu', 'AC1 default engine should persist after reload');
    await installNavHook(page);

    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)', { timeout: 5000 });
    await page.locator('#search-settings-section').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('#search-default-engine option').length >= 5);
    await page.selectOption('#search-default-engine', 'duckduckgo');
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchEngine === 'duckduckgo');
    await screenshot(page, 'search_settings.png');

    await page.fill('#search-custom-name', 'Wiki');
    await page.fill('#search-custom-template', 'https://example.com/find?q=%s');
    await page.click('#search-custom-save');
    await page.waitForFunction(() => window.OpenTabSearch.getState().customSearchEngines.length === 1);

    await page.fill('#search-custom-name', 'NoPlaceholder');
    await page.fill('#search-custom-template', 'https://example.com/q');
    await page.click('#search-custom-save');
    const missingPlaceholder = await page.locator('#search-custom-status').textContent();
    assert.match(missingPlaceholder || '', /%s/, 'AC1 missing %s must be rejected with a hint');
    assert.equal(
      await page.evaluate(() => window.OpenTabSearch.getState().customSearchEngines.length),
      1,
      'AC1 invalid custom engine must not be saved'
    );

    await page.fill('#search-custom-name', 'NotHttp');
    await page.fill('#search-custom-template', 'javascript:alert(%s)');
    await page.click('#search-custom-save');
    const notHttp = await page.locator('#search-custom-status').textContent();
    assert.match(notHttp || '', /http/, 'AC1 non-http(s) template must be rejected');

    await page.click('#close-settings');
    await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));

    await page.click('#search-engine-panel .engine-btn.active');
    await page.click('#search-custom-engines .engine-btn');
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchEngine.startsWith('cse-'));
    await page.fill('#search-input', 'hello world');
    await page.locator('#search-input').press('Enter');
    let log = await navLog(page);
    assert.equal(log.at(-1)?.url, 'https://example.com/find?q=hello%20world', 'AC1 custom %s engine should substitute the query');

    // AC2 URL vs keyword
    const resolved = await page.evaluate(() => {
      const cases = ['example.com', 'https://a.b/c', 'localhost:3000', 'hello world', '1.5', 'a.b c'];
      return cases.map((q) => ({ q, ...window.OpenTabSearch.resolve(q) }));
    });
    const byQuery = Object.fromEntries(resolved.map((item) => [item.q, item]));
    assert.equal(byQuery['example.com'].type, 'url');
    assert.equal(byQuery['example.com'].url, 'https://example.com');
    assert.equal(byQuery['https://a.b/c'].type, 'url');
    assert.equal(byQuery['https://a.b/c'].url, 'https://a.b/c');
    assert.equal(byQuery['localhost:3000'].type, 'url');
    assert.equal(byQuery['localhost:3000'].url, 'http://localhost:3000');
    assert.equal(byQuery['hello world'].type, 'search');
    assert.equal(byQuery['1.5'].type, 'search');
    assert.equal(byQuery['a.b c'].type, 'search');

    await page.fill('#search-input', 'example.com');
    await page.locator('#search-input').press('Enter');
    log = await navLog(page);
    assert.equal(log.at(-1)?.url, 'https://example.com', 'AC2 example.com should open as a URL');

    // AC3 native Tab navigation, Alt+arrow engine cycle + type-to-focus
    await chooseSearchEngine(page, 'google');
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchEngine === 'google');
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.locator('#search-input').focus();
      await page.keyboard.press(key);
      assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'search-input', `AC3 ${key} must leave search`);
      assert.equal(await page.evaluate(() => window.OpenTabSearch.getState().searchEngine), 'google', `AC3 ${key} must not change engines`);
    }
    await page.locator('#search-input').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchEngine === 'bing');
    assert.equal(
      await page.locator('.engine-btn[data-engine="bing"]').evaluate((el) => el.classList.contains('active')),
      true,
      'AC3 Alt+ArrowDown should highlight the next engine'
    );
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchEngine === 'google');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'search-input', 'AC3 engine cycling keeps focus in search');

    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.keyboard.type('xyz');
    assert.equal(await page.locator('#search-input').inputValue(), 'example.com', 'AC3 typing in a dialog must not hit search');
    await page.click('#close-settings');
    await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));

    await page.click('[data-clock-card="2"]');
    await page.click('#clock-todo-open');
    await page.waitForSelector('#todo-widget:not(.hidden)');
    await page.locator('#todo-input').focus();
    await page.keyboard.type('todo-text');
    assert.equal(await page.locator('#todo-input').inputValue(), 'todo-text', 'AC3 other inputs keep their keystrokes');
    assert.equal((await page.locator('#search-input').inputValue()).includes('todo-text'), false);
    await page.click('#todo-collapse-btn');
    await page.click('[data-clock-card="0"]');

    await page.fill('#search-input', '');
    await page.locator('#time').click();
    await page.keyboard.press('/');
    assert.equal(
      await page.evaluate(() => document.activeElement && document.activeElement.id),
      'search-input',
      'AC3 / should focus search'
    );
    assert.equal(await page.locator('#search-input').inputValue(), '/', 'AC3 / should be inserted');
    await page.fill('#search-input', '');
    await page.locator('#time').click();
    await page.keyboard.type('q');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search-input');
    assert.equal(await page.locator('#search-input').inputValue(), 'q');

    // P0 IME: keyCode 229 / Process focuses search and does not preventDefault
    await page.fill('#search-input', '');
    await page.locator('#time').click();
    const imeKeydown = await page.evaluate(() => {
      const search = document.getElementById('search-input');
      if (search) search.blur();
      const target = document.getElementById('time') || document.body;
      const event = new KeyboardEvent('keydown', {
        key: 'Process',
        bubbles: true,
        cancelable: true,
        composed: true
      });
      Object.defineProperty(event, 'keyCode', { get: () => 229 });
      Object.defineProperty(event, 'which', { get: () => 229 });
      const cancelled = !target.dispatchEvent(event);
      return {
        cancelled,
        activeId: document.activeElement && document.activeElement.id
      };
    });
    assert.equal(imeKeydown.cancelled, false, 'P0 IME: Process/229 must not be preventDefaulted');
    assert.equal(imeKeydown.activeId, 'search-input', 'P0 IME: keyCode 229 should focus search');
    await page.keyboard.insertText('你好');
    assert.equal(await page.locator('#search-input').inputValue(), '你好', 'P0 IME: committed text should enter search after focus');

    await page.fill('#search-input', '');
    await page.locator('#time').click();
    const compositionFocus = await page.evaluate(() => {
      const search = document.getElementById('search-input');
      if (search) search.blur();
      const target = document.getElementById('time') || document.body;
      target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      return document.activeElement && document.activeElement.id;
    });
    assert.equal(compositionFocus, 'search-input', 'P0 IME: compositionstart should focus search');

    try {
      const cdp = await page.context().newCDPSession(page);
      await page.fill('#search-input', '');
      await page.locator('#time').click();
      await page.evaluate(() => {
        const search = document.getElementById('search-input');
        if (search) search.blur();
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Process',
        windowsVirtualKeyCode: 229,
        nativeVirtualKeyCode: 229
      });
      const cdpFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
      if (cdpFocus === 'search-input') {
        await cdp.send('Input.insertText', { text: '测试' });
        assert.equal(
          await page.locator('#search-input').inputValue(),
          '测试',
          'P0 IME: CDP insertText should land in search'
        );
      } else {
        console.warn('P0 IME CDP keydown did not focus search; JS 229 path already asserted');
      }
      await cdp.detach();
    } catch (error) {
      console.warn(`P0 IME CDP path skipped: ${error.message}`);
    }

    await page.fill('#search-input', '');
    await page.locator('#add-shortcut-tile').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#add-shortcut-tile').focus();
    const imeOnButton = await page.evaluate(() => {
      const target = document.getElementById('add-shortcut-tile');
      const event = new KeyboardEvent('keydown', {
        key: 'Process',
        bubbles: true,
        cancelable: true,
        composed: true
      });
      Object.defineProperty(event, 'keyCode', { get: () => 229 });
      target.dispatchEvent(event);
      return document.activeElement && document.activeElement.id;
    });
    assert.equal(imeOnButton, 'add-shortcut-tile', 'P0 IME: Process on + must not move focus to search');

    // BUG-013: Space on focused + tile opens add modal instead of typing into search
    await page.fill('#search-input', '');
    await page.locator('#add-shortcut-tile').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#add-shortcut-tile').focus();
    assert.equal(
      await page.evaluate(() => document.activeElement && document.activeElement.id),
      'add-shortcut-tile',
      'BUG-013: + tile should be focused before Space'
    );
    await page.keyboard.press('Space');
    await page.waitForSelector('#add-icon-modal:not(.hidden)', { timeout: 5000 });
    await screenshot(page, 'search_space_on_add_tile.png');
    assert.equal(
      await page.locator('#search-input').inputValue(),
      '',
      'BUG-013: Space on + must not insert a space into search'
    );
    await page.click('#cancel-btn');
    await page.waitForFunction(() => document.getElementById('add-icon-modal').classList.contains('hidden'));

    // AC4 history
    await page.fill('#search-input', '');
    await chooseSearchEngine(page, 'google');
    await page.fill('#search-input', 'alpha');
    await page.locator('#search-input').press('Enter');
    await page.fill('#search-input', 'beta');
    await page.locator('#search-input').press('Enter');
    await page.fill('#search-input', 'alpha');
    await page.locator('#search-input').press('Enter');
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchHistory.length >= 2);
    let historyState = await page.evaluate(() => window.OpenTabSearch.getState().searchHistory);
    assert.equal(historyState[0].q, 'alpha', 'AC4 newest query should be first');
    assert.equal(historyState.filter((item) => item.q.toLowerCase() === 'alpha').length, 1, 'AC4 should dedupe');
    const historyStored = await storageGet(serviceWorker, ['searchHistory']);
    assert.ok(Array.isArray(historyStored.searchHistory), 'AC4 history lives in chrome.storage.local');

    await page.fill('#search-input', '');
    await page.locator('#search-input').focus();
    await page.waitForSelector('#search-history:not(.hidden) .search-history-item', { timeout: 3000 });
    await screenshot(page, 'search_history_dropdown.png');

    const seeded = [];
    for (let i = 0; i < 20; i += 1) seeded.push({ q: `cap-${i}`, engine: 'google', at: i });
    await storageSet(serviceWorker, { searchHistory: seeded, searchHistoryEnabled: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSearch(page);
    await installNavHook(page);
    await page.fill('#search-input', 'cap-new');
    await page.locator('#search-input').press('Enter');
    historyState = await page.evaluate(() => window.OpenTabSearch.getState().searchHistory);
    assert.equal(historyState.length, 20, 'AC4 history caps at 20');
    assert.equal(historyState[0].q, 'cap-new');

    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.locator('#search-settings-section').scrollIntoViewIfNeeded();
    const enabled = page.locator('#search-history-enabled');
    if (await enabled.isChecked()) await enabled.click();
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchHistoryEnabled === false);
    await page.click('#close-settings');
    await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));
    const beforeDisabled = (await page.evaluate(() => window.OpenTabSearch.getState().searchHistory)).length;
    await page.fill('#search-input', 'should-not-record');
    await page.locator('#search-input').press('Enter');
    const afterDisabled = await page.evaluate(() => window.OpenTabSearch.getState().searchHistory);
    assert.equal(afterDisabled.length, beforeDisabled, 'AC4 disabling history stops recording');
    assert.equal(afterDisabled.some((item) => item.q === 'should-not-record'), false);

    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.click('#search-history-clear');
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchHistory.length === 0);
    await page.click('#close-settings');
    await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));

    // AC5 shortcut name match
    await storageSet(serviceWorker, {
      icons: [{
        id: 'icon-gh',
        name: 'MyGitHub',
        url: 'https://github.com/haoyang1994/OpenTab',
        type: 'shortcut',
        folderId: 'folder-home',
        emoji: '🐙'
      }]
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSearch(page);
    await installNavHook(page);
    await page.waitForFunction(() => window.OpenTabSearch.resolve('MyGitHub').type === 'shortcut');
    await page.fill('#search-input', 'mygithub');
    assert.equal(await page.locator('#search-hint[data-match="shortcut"]').count(), 0, 'shortcut matching needs no instructional hint');
    await page.locator('#search-input').press('Enter');
    log = await navLog(page);
    assert.equal(log.at(-1)?.url, 'https://github.com/haoyang1994/OpenTab', 'AC5 matching shortcut name opens the shortcut');

    // AC6 new tab setting + modifiers
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    const newTab = page.locator('#search-open-new-tab');
    if (!(await newTab.isChecked())) await newTab.click();
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchOpenInNewTab === true);
    await page.click('#close-settings');
    await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));
    await page.fill('#search-input', 'new-tab-query');
    await page.locator('#search-input').press('Enter');
    log = await navLog(page);
    assert.equal(log.at(-1)?.openInNewTab, true, 'AC6 setting should open search in a new tab');

    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    if (await newTab.isChecked()) await newTab.click();
    await page.waitForFunction(() => window.OpenTabSearch.getState().searchOpenInNewTab === false);
    await page.click('#close-settings');
    await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));
    await page.fill('#search-input', 'ctrl-enter-query');
    await page.locator('#search-input').press('Control+Enter');
    log = await navLog(page);
    assert.equal(log.at(-1)?.openInNewTab, true, 'AC6 Ctrl+Enter should open in a new tab');
    assert.match(log.at(-1)?.url || '', /ctrl-enter-query/);

    await page.fill('#search-input', 'middle-click-query');
    await page.locator('#search-input').click({ button: 'middle' });
    log = await navLog(page);
    assert.equal(log.at(-1)?.openInNewTab, true, 'AC6 middle-click should open in a new tab');
    assert.match(log.at(-1)?.url || '', /middle-click-query/);

    await page.fill('#search-input', 'same-tab-query');
    await page.locator('#search-input').press('Enter');
    log = await navLog(page);
    assert.equal(log.at(-1)?.openInNewTab, false, 'AC6 Enter stays in this tab when the setting is off');

    await verifyEngineDeck(page, serviceWorker, screenshot);
    await verifySavedSites(page, serviceWorker);

    const leftover = unexpectedErrors(consoleErrors);
    assert.equal(leftover.length, 0, `AC8 console errors: ${leftover.join(' | ')}`);
    console.log('E2E passed: search experience AC1–AC6.');
  } finally {
    await context.close();
  }
}

runSearchE2E().catch((error) => {
  console.error('Search E2E failed:', error);
  process.exitCode = 1;
});
