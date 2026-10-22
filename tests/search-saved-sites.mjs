import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForAsync } from './wait-for-async.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const site = (id, name, url, folderId = 'folder-home', parentId = '') => ({
  id, name, url, type: 'shortcut', folderId, parentId
});
const longTitle = ('Docs Reference <img src=x onerror=alert(1)> ' + 'Long saved title '.repeat(9)).trimEnd();
const longGroup = 'Work 设置 ' + 'Long group '.repeat(8);
const folderName = 'Reference 保存 <svg onload=alert(1)>';
const fixture = {
  icons: [
    site('site-contains', 'Team Docs', 'https://contains.example.com/'),
    site('site-domain', 'Reference', 'https://docs.example.com/'),
    site('site-long', longTitle, 'https://long-subdomain-for-saved-site-search.example.com/<img src=x onerror=alert(1)>', 'work', 'docs-folder'),
    site('site-exact', 'Docs', 'https://work.example.com/docs', 'work', 'docs-folder'),
    site('site-duplicate', 'Docs', 'https://home.example.com/docs'),
    site('site-prefix', 'Docs Toolkit', 'https://toolkit.example.com/'),
    { id: 'docs-folder', type: 'folder', name: folderName, folderId: 'work', parentId: '' },
    { id: 'folder-match', type: 'folder', name: 'Docs folder', folderId: 'folder-home', parentId: '' },
    { id: 'tool-match', type: 'tool', name: 'Docs tool', url: 'https://tool.example.com/', folderId: 'folder-home', parentId: '' }
  ],
  folders: [{ id: 'folder-home', name: '主页' }, { id: 'work', name: longGroup }],
  currentFolderId: 'folder-home',
  searchEngine: 'google', customSearchEngines: [], searchOpenInNewTab: false,
  searchHistoryEnabled: true, searchHistory: [{ q: 'docs query', engine: 'bing', at: 1 }],
  background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f, #537895)', source: 'gradient' },
  weatherEnabled: false, particlesEnabled: false
};
const siteSelector = '#search-history .search-site-item';
const historySelector = '#search-history .search-history-item';

export async function verifySavedSites(page, worker) {
  async function store(payload) {
    await worker.evaluate(data => new Promise(resolve => chrome.storage.local.set(data, resolve)), payload);
  }
  async function ready(expected = { searchEngine: 'google', searchHistoryEnabled: true }) {
    await page.waitForFunction(expected => window.OpenTabSearch && window.OpenTabSearch.resolve('Docs').type === 'shortcut' && performance.getEntriesByName('opentab:grid-ready').length > 0 && OpenTabSearch.getState().searchEngine === expected.searchEngine && OpenTabSearch.getState().searchHistoryEnabled === expected.searchHistoryEnabled && OpenTabSearch.getState().searchHistory.some(item => item.q === 'docs query' && item.engine === 'bing'), expected);
    await page.evaluate(async () => { await OpenTabI18n.ready; });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      window.__navLog = [];
      OpenTabSearch.navigateHook = (url, openInNewTab) => window.__navLog.push({ url, openInNewTab: Boolean(openInNewTab) });
    });
  }
  async function type(query) { await page.fill('#search-input', query); }
  async function log() { return page.evaluate(() => window.__navLog); }
  async function ids() { return page.locator(siteSelector).evaluateAll(nodes => nodes.map(node => node.dataset.siteId)); }
  async function active() { return page.getAttribute('#search-input', 'aria-activedescendant'); }
  async function selectedId() { return page.locator('#search-history [aria-selected="true"]').getAttribute('id'); }

  await store({ ...fixture, languagePreference: 'zh-CN' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  const beforeWorkspace = await worker.evaluate(() => chrome.storage.local.get(['icons', 'folders']));
  const requests = [];
  const onRequest = request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); };
  page.context().on('request', onRequest);
  try {
    await type('docs');
    assert.deepEqual(await ids(), ['site-exact', 'site-duplicate', 'site-long', 'site-prefix', 'site-contains']);
    assert.equal(await page.locator(siteSelector).count(), 5, 'saved sites cap at five without hiding history');
    assert.equal(await page.locator(historySelector).count(), 1);
    assert.deepEqual(await page.locator('#search-history .search-result-group').evaluateAll(nodes => nodes.map(node => node.dataset.kind)), ['sites', 'history']);
    assert.equal(await active(), null, 'partial results are never selected implicitly');
    assert.equal(await page.getAttribute('#search-input', 'aria-expanded'), 'true');
    assert.match(await page.locator(`${siteSelector}[data-site-id="site-exact"] .search-site-meta`).textContent(), /work\.example\.com · Work 设置 .* \/ Reference 保存 <svg onload=alert\(1\)>/);
    assert.equal(await page.locator(`${siteSelector}[data-site-id="site-long"] .search-site-name`).textContent(), longTitle);
    assert.equal(await page.locator('#search-history img, #search-history svg, #search-history script').count(), 0, 'saved names and URL paths are text, never injected markup');
    await verifySearchLayers(page);
    await type('docs.example.com');
    assert.deepEqual(await ids(), ['site-domain'], 'domain matches work across groups');
    await type('unmatched lookup');
    assert.equal(await page.locator('#search-history').isVisible(), false);
    await type('');
    assert.equal(await page.locator(siteSelector).count(), 0);
    assert.equal(await page.locator(historySelector).count(), 1, 'empty query retains query history');
    await type('docs');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(requests, [], 'typing and local matching issue no network request');
    const afterWorkspace = await worker.evaluate(() => chrome.storage.local.get(['icons', 'folders']));
    assert.deepEqual(afterWorkspace, beforeWorkspace, 'lookup must not alter saved icons or folder records');
  } finally {
    page.context().off('request', onRequest);
  }

  await type('doc'); await page.locator('#search-input').press('Enter');
  assert.equal((await log()).at(-1).url, 'https://www.google.com/search?q=doc', 'unselected partial match keeps web search');
  await type('docs'); await page.locator('#search-input').press('Enter');
  assert.equal((await log()).at(-1).url, 'https://work.example.com/docs', 'exact-name opening keeps legacy priority');
  await type('missing.example.com'); await page.locator('#search-input').press('Enter');
  assert.equal((await log()).at(-1).url, 'https://missing.example.com', 'direct URL is unchanged');

  await type('doc'); await page.locator('#search-input').press('ArrowDown');
  assert.equal(await active(), await selectedId());
  assert.equal(await page.locator('#search-history [aria-selected="true"]').getAttribute('data-site-id'), 'site-long', 'partial title ties preserve workspace order');
  await page.locator('#search-input').press('Enter');
  assert.equal((await log()).at(-1).url, fixture.icons.find(icon => icon.id === 'site-long').url);
  assert.equal(await page.getAttribute('#search-input', 'aria-expanded'), 'false');
  assert.equal(await active(), null);
  await type('doc'); await page.locator('#search-input').press('ArrowUp');
  assert.equal(await page.locator('#search-history [aria-selected="true"]').getAttribute('data-q'), 'docs query', 'initial Up selects last, including history group');
  await page.locator('#search-input').press('Enter');
  assert.equal((await log()).at(-1).url, 'https://www.bing.com/search?q=docs%20query');

  // Explicit pointer/keyboard activation uses exactly one existing navigation.
  await type('doc');
  const beforePlainClick = (await log()).length;
  await assertResultHit(page);
  await page.locator(siteSelector).first().click();
  assert.equal((await log()).length, beforePlainClick + 1);
  assert.deepEqual((await log()).at(-1), { url: fixture.icons.find(icon => icon.id === 'site-long').url, openInNewTab: false }, 'plain left click opens the selected site once in the same tab');
  assert.equal(await page.locator('#search-widget-wrap').evaluate(wrap => getComputedStyle(wrap).zIndex), '6', 'closing results immediately restores the normal search layer');
  for (const modifier of ['Control', 'Meta']) {
    await type('doc'); await page.locator('#search-input').press('ArrowDown');
    let count = (await log()).length;
    await page.locator('#search-input').press(`${modifier}+Enter`);
    assert.equal((await log()).length, count + 1);
    assert.equal((await log()).at(-1).openInNewTab, true);
    await type('doc'); count = (await log()).length;
    await page.locator(siteSelector).first().click({ modifiers: [modifier] });
    assert.equal((await log()).length, count + 1);
    assert.equal((await log()).at(-1).openInNewTab, true);
  }
  await type('doc');
  let count = (await log()).length;
  await page.locator(siteSelector).first().click({ button: 'middle' });
  assert.equal((await log()).length, count + 1, 'middle click must not also submit the input');
  assert.equal((await log()).at(-1).openInNewTab, true);

  // Options participate in the input's active-descendant pattern, not the Tab
  // sequence. Tab must leave the widget, and delayed blur must not hide focus.
  for (const key of ['Tab', 'Shift+Tab']) {
    await type('doc'); await page.locator('#search-input').press('ArrowDown');
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#search-history')), false);
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'search-input');
    await page.waitForFunction(() => document.getElementById('search-history').classList.contains('hidden'));
    assert.equal(await active(), null);
  }
  await type('doc'); await page.locator('#search-input').press('ArrowDown');
  const beforeIme = await active();
  const canceledIme = await page.locator('#search-input').evaluate(input => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => 229 });
    return !input.dispatchEvent(event);
  });
  assert.equal(canceledIme, false);
  assert.equal(await active(), beforeIme);
  await page.locator('#search-input').press('Escape');
  assert.equal(await page.getAttribute('#search-input', 'aria-expanded'), 'false');
  assert.equal(await page.inputValue('#search-input'), 'doc');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'search-input');

  // Mutate the actual live record while its old rendered option remains open.
  await type('docs'); await page.locator('#search-input').press('ArrowDown');
  await page.evaluate(() => { OpenTabSearch.resolve('Docs').icon.name = 'Renamed saved site'; });
  count = (await log()).length;
  await page.locator('#search-input').press('Enter');
  assert.equal((await log()).length, count, 'a stale renamed result must not navigate to the captured payload');
  assert.equal(await active(), null);

  await store({ ...fixture, searchHistoryEnabled: false });
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready({ searchEngine: 'google', searchHistoryEnabled: false });
  await type('docs');
  assert.equal(await page.locator(siteSelector).count(), 5, 'saved-site lookup is independent of history opt-out');
  assert.equal(await page.locator(historySelector).count(), 0);
  await page.locator('#search-input').press('ArrowDown');
  await page.locator('#search-input').press('Enter');
  assert.equal((await log()).at(-1).url, 'https://work.example.com/docs');

  await verifySearchShortcut(page);

  // Actual installed-extension screenshots, after locale storage and readiness,
  // cover both long text and duplicate titles at desktop and narrow widths.
  fs.mkdirSync(artifacts, { recursive: true });
  for (const preference of ['zh-CN', 'en']) {
    await store({ ...fixture, languagePreference: preference });
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    assert.equal(await page.getAttribute('html', 'lang'), preference);
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await type('docs'); await page.locator('#search-input').press('ArrowDown');
      assert.equal(await active(), await selectedId());
      assert.deepEqual(await page.locator('#search-history .search-result-heading').allTextContents(), preference === 'en' ? ['Saved sites', 'Search history'] : ['已保存的网站', '搜索历史']);
      assert.match(await page.locator(`${siteSelector}[data-site-id="site-duplicate"] .search-site-meta`).textContent(), /主页/, 'stored group labels remain user content in English');
      const bounds = await page.locator('#search-history').evaluate(list => {
        const rect = list.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, contentWidth: list.scrollWidth, clientWidth: list.clientWidth,
          inputWidth: document.getElementById('search-input').getBoundingClientRect().width,
          rows: [...list.querySelectorAll('[role="option"]')].map(row => ({ width: row.getBoundingClientRect().width, tabIndex: row.tabIndex })) };
      });
      assert.ok(bounds.left >= 0 && bounds.right <= width, 'saved-site dropdown stays inside the viewport');
      assert.ok(bounds.contentWidth <= bounds.clientWidth + 1, 'long metadata is ellipsized, not horizontally scrollable');
      assert.ok(bounds.rows.every(row => row.width <= bounds.width && row.tabIndex === -1));
      assert.ok(bounds.inputWidth >= 64, 'platform key hint leaves usable input width on narrow screens');
      await assertVisibleResultHits(page);
      await captureSearchThemes(page, `search-saved-sites-${preference}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log('Saved-site E2E: local-only lookup, safe explicit navigation, live stale rejection, history/ARIA/IME/Tab and bilingual responsive screenshots passed.');
}

// Exercise real DOM/native keyboard events for each platform binding. Only OS
// detection is simulated; this is an in-page shortcut, not a browser command.
async function verifySearchShortcut(page) {
  fs.mkdirSync(artifacts, { recursive: true });
  const originalViewport = page.viewportSize();
  await page.evaluate(() => OpenTabSearch.replaceSettings({
    ...OpenTabSearch.getBackupSlice(),
    customSearchEngines: [{ id: 'cse-shortcut-test', name: 'Example', template: 'https://example.com/?q=%s' }]
  }));
  await waitForAsync(page, async () => (await chrome.storage.local.get('customSearchEngines')).customSearchEngines?.some(engine => engine.id === 'cse-shortcut-test'));
  await page.evaluate(() => {
    window.__shortcutNavigatorDescriptors = {
      platform: Object.getOwnPropertyDescriptor(navigator, 'platform'),
      userAgentData: Object.getOwnPropertyDescriptor(navigator, 'userAgentData')
    };
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => window.__shortcutTestPlatform });
  });
  const currentFocus = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  const selection = () => page.locator('#search-input').evaluate(input => [input.selectionStart, input.selectionEnd]);
  const navCount = () => page.evaluate(() => window.__navLog.length);
  try {
    for (const [platform, modifier, hint] of [['MacIntel', 'Meta', '⌘ K'], ['Win32', 'Control', 'Ctrl K'], ['Linux x86_64', 'Control', 'Ctrl K']]) {
      await page.evaluate(platform => { window.__shortcutTestPlatform = platform; OpenTabSearch.applyFromStorage(); }, platform);
      await page.waitForFunction(hint => document.getElementById('search-shortcut-hint').textContent === hint, hint);
      assert.match(await page.getAttribute('#search-input', 'aria-keyshortcuts'), new RegExp(`${modifier}\\+K`));
      const count = await navCount();
      await page.fill('#search-input', 'doc');
      await page.locator('#search-input').evaluate(input => input.blur());
      assert.equal(await currentFocus(), 'BODY');
      await page.keyboard.press(`${modifier}+k`);
      assert.equal(await currentFocus(), 'search-input');
      assert.equal(await page.inputValue('#search-input'), 'doc');
      assert.deepEqual(await selection(), [0, 3]);
      assert.equal(await page.getAttribute('#search-input', 'aria-activedescendant'), null);
      await page.locator('#search-input').evaluate(input => input.setSelectionRange(1, 2));
      await page.keyboard.press(`${modifier}+k`);
      await page.keyboard.press(`${modifier}+k`);
      assert.deepEqual(await selection(), [1, 2], 'repeated shortcut preserves the user selection');
      await page.keyboard.press('Escape');
      assert.equal(await currentFocus(), 'BODY');
      assert.equal(await page.getAttribute('#search-input', 'aria-expanded'), 'false');
      assert.equal(await page.inputValue('#search-input'), 'doc');

      await page.locator('#search-input').focus();
      await page.locator('#search-input').evaluate(input => input.setSelectionRange(2, 2));
      await page.keyboard.press(`${modifier}+k`);
      assert.deepEqual(await selection(), [2, 2], 'invocation from search never rewrites its caret');
      await page.keyboard.press('Escape');
      assert.equal(await currentFocus(), 'BODY');

      await page.locator('#settings-btn').focus();
      await page.keyboard.press(`${modifier}+k`);
      await page.keyboard.press(`${modifier}+k`);
      await page.keyboard.press('Escape');
      assert.equal(await currentFocus(), 'settings-btn', 'Escape restores the original connected control once');

      await page.keyboard.press(`${modifier}+k`);
      await page.keyboard.press('Tab');
      const nextOrigin = await page.evaluate(() => {
        window.__nextShortcutOrigin = document.activeElement;
        return { tag: document.activeElement.tagName, id: document.activeElement.id };
      });
      assert.notEqual(nextOrigin.id, 'search-input');
      assert.ok(!['INPUT', 'TEXTAREA', 'SELECT'].includes(nextOrigin.tag), 'native next focus is a nonediting control');
      // No blur-timer wait: immediate reactivation must remember the new origin.
      await page.keyboard.press(`${modifier}+k`);
      assert.equal(await currentFocus(), 'search-input');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement === window.__nextShortcutOrigin), true);

      await page.click('#todo-toggle-btn');
      await page.waitForSelector('#todo-widget:not(.hidden)');
      await page.fill('#todo-input', 'Unsaved todo draft');
      await page.keyboard.press(`${modifier}+k`);
      assert.equal(await currentFocus(), 'todo-input', 'unrelated textbox keeps focus and its draft');
      assert.equal(await page.inputValue('#todo-input'), 'Unsaved todo draft');
      await page.click('#todo-collapse-btn');

      await page.click('#settings-btn');
      await page.waitForSelector('#settings-panel:not(.hidden)');
      await page.fill('#settings-search', 'Unsaved settings filter');
      await page.keyboard.press(`${modifier}+k`);
      assert.equal(await currentFocus(), 'settings-search');
      assert.equal(await page.inputValue('#settings-search'), 'Unsaved settings filter');
      // An open modal still wins when its focus is on a nonediting control.
      await page.locator('#close-settings').focus();
      await page.keyboard.press(`${modifier}+k`);
      assert.equal(await currentFocus(), 'close-settings');
      await page.click('#close-settings');
      await page.waitForSelector('#settings-panel.hidden', { state: 'attached' });

      await page.click('#add-shortcut-tile');
      await page.waitForSelector('#add-icon-modal:not(.hidden)');
      await page.fill('#icon-name', 'Draft shortcut, do not save');
      await page.keyboard.press(`${modifier}+k`);
      assert.equal(await currentFocus(), 'icon-name');
      assert.equal(await page.inputValue('#icon-name'), 'Draft shortcut, do not save');
      await page.click('#cancel-btn');
      await page.waitForSelector('#add-icon-modal.hidden', { state: 'attached' });

      await page.evaluate(() => {
        const button = document.createElement('button'); button.id = 'temporary-shortcut-origin';
        button.textContent = 'Temporary focus'; document.body.appendChild(button); button.focus();
      });
      await page.keyboard.press(`${modifier}+k`);
      await page.evaluate(() => document.getElementById('temporary-shortcut-origin').remove());
      await page.keyboard.press('Escape');
      assert.equal(await currentFocus(), 'BODY', 'removed opener safely falls back to blur');

      await page.locator('#clock-widget').dblclick();
      await page.waitForFunction(() => document.body.classList.contains('minimal-mode'));
      await waitForAsync(page, async () => (await chrome.storage.local.get('minimalMode')).minimalMode === true);
      const minimalBefore = await page.evaluate(() => chrome.storage.local.get(['minimalMode', 'icons', 'folders']));
      assert.equal(await page.locator('#search-widget-wrap').isVisible(), false);
      await page.setViewportSize({ width: 360, height: 900 });
      await page.locator('#settings-btn').focus();
      await page.keyboard.press(`${modifier}+k`);
      assert.equal(await page.locator('#search-input').isVisible(), true, 'shortcut temporarily reveals search in clock-only mode');
      assert.equal(await currentFocus(), 'search-input');
      await page.fill('#search-input', 'doc');
      assert.ok(await page.locator(siteSelector).count() > 0);
      await page.locator('#search-engine-switch > .engine-btn[data-engine="bing"]').click();
      await page.waitForFunction(() => OpenTabSearch.getState().searchEngine === 'bing');
      assert.equal(await currentFocus(), 'search-input', 'minimal-mode engine click keeps the borrowed search surface active');
      assert.equal(await page.locator('#search-input').isVisible(), true);
      await page.locator('#search-custom-engines .engine-btn[data-engine="cse-shortcut-test"]').click();
      await page.waitForFunction(() => OpenTabSearch.getState().searchEngine === 'cse-shortcut-test');
      assert.equal(await currentFocus(), 'search-input', 'dynamically created custom engines use the same delegated focus protection');
      await page.keyboard.press('Alt+ArrowUp');
      assert.equal(await page.evaluate(() => OpenTabSearch.getState().searchEngine), 'github', 'Alt arrows still switch engines in minimal mode');
      await page.keyboard.press('ArrowDown');
      const minimalBounds = await page.locator('#search-history').evaluate(list => {
        const rect = list.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
      });
      assert.ok(minimalBounds.left >= 0 && minimalBounds.right <= minimalBounds.width);
      assert.ok(minimalBounds.top >= 0 && minimalBounds.bottom <= minimalBounds.height, 'minimal-mode results stay inside narrow viewport');
      await assertVisibleResultHits(page);
      assert.equal(await page.locator('#search-widget-wrap').evaluate(wrap => getComputedStyle(wrap).zIndex), '1300', 'minimal-mode temporary surface retains its independent layer');
      await captureSearchThemes(page, `search-shortcut-minimal-${platform.replace(/[^a-z0-9]/gi, '-')}-360`);
      await page.keyboard.press('Escape');
      assert.equal(await currentFocus(), 'settings-btn');
      assert.equal(await page.locator('#search-widget-wrap').isVisible(), false);
      assert.equal(await page.locator('body').evaluate(body => body.classList.contains('minimal-mode')), true);
      await page.keyboard.press(`${modifier}+k`);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#search-widget-wrap').isVisible(), false, 'Tab ends temporary minimal search immediately');
      assert.notEqual(await currentFocus(), 'search-input');
      await page.locator('#settings-btn').focus();
      await page.keyboard.press(`${modifier}+k`);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('#search-widget-wrap').isVisible(), false, 'Shift+Tab also ends temporary search without trapping focus');
      assert.equal(await page.evaluate(() => document.activeElement === document.body || document.activeElement.getClientRects().length > 0), true, 'Shift+Tab must not leave focus on a hidden engine button');
      assert.deepEqual(await page.evaluate(() => chrome.storage.local.get(['minimalMode', 'icons', 'folders'])), minimalBefore, 'temporary search never rewrites the minimal-mode preference or workspace');
      await page.locator('#clock-widget').dblclick();
      await page.waitForFunction(() => !document.body.classList.contains('minimal-mode'));
      await waitForAsync(page, async () => (await chrome.storage.local.get('minimalMode')).minimalMode === false);
      await page.setViewportSize(originalViewport);
      assert.equal(await navCount(), count, 'focus, repeat, dismissal and protected drafts never navigate');
    }
  } finally {
    await page.evaluate(() => {
      for (const key of ['platform', 'userAgentData']) {
        const descriptor = window.__shortcutNavigatorDescriptors[key];
        if (descriptor) Object.defineProperty(navigator, key, descriptor); else delete navigator[key];
      }
      delete window.__shortcutNavigatorDescriptors;
      delete window.__shortcutTestPlatform;
      delete window.__nextShortcutOrigin;
      OpenTabSearch.applyFromStorage();
    });
  }
}

async function assertOpaqueSearchSurface(page) {
  const surface = await page.locator('#search-history').evaluate(list => {
    const style = getComputedStyle(list);
    return { color: style.backgroundColor, opacity: style.opacity };
  });
  const channels = /^rgba?\(([^)]+)\)$/.exec(surface.color)?.[1].split(',').map(Number);
  assert.ok(channels?.length === 3 || channels?.length === 4, `expected an RGB search surface, received ${surface.color}`);
  assert.equal(channels[3] ?? 1, 1, 'computed search background alpha must be fully opaque');
  assert.equal(Number(surface.opacity), 1, 'search panel opacity must not reveal underlying text');
}

async function captureSearchThemes(page, basename) {
  const originalLight = await page.locator('body').evaluate(body => body.classList.contains('theme-light'));
  const persistedTheme = await page.evaluate(() => chrome.storage.local.get('themeMode'));
  try {
    await assertOpaqueSearchSurface(page);
    // Preserve the existing screenshot, then exercise both visual CSS themes.
    // This fixture does not call settings or change the user's stored theme.
    await page.screenshot({ path: path.join(artifacts, `${basename}.png`), animations: 'disabled' });
    for (const theme of ['dark', 'light']) {
      await page.locator('body').evaluate((body, theme) => body.classList.toggle('theme-light', theme === 'light'), theme);
      await assertOpaqueSearchSurface(page);
      await assertVisibleResultHits(page);
      await page.screenshot({ path: path.join(artifacts, `${basename}-${theme}.png`), animations: 'disabled' });
    }
  } finally {
    await page.locator('body').evaluate((body, light) => body.classList.toggle('theme-light', light), originalLight);
    assert.deepEqual(await page.evaluate(() => chrome.storage.local.get('themeMode')), persistedTheme, 'visual theme fixtures must not persist a preference');
  }
}

async function assertResultHit(page, index = 0, selector = siteSelector) {
  const row = page.locator(selector).nth(index);
  await row.scrollIntoViewIfNeeded();
  const hit = await row.evaluate(row => {
    const rect = row.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { own: !!target && row.contains(target), target: target?.id || target?.className };
  });
  assert.equal(hit.own, true, `native result center must hit the option, not ${hit.target}`);
}

async function assertVisibleResultHits(page) {
  const selector = '#search-history [role="option"]';
  const count = await page.locator(selector).count();
  assert.ok(count > 0);
  for (const index of new Set([0, Math.floor((count - 1) / 2), count - 1])) {
    await assertResultHit(page, index, selector);
  }
}

async function verifySearchLayers(page) {
  await assertVisibleResultHits(page);
  await assertResultHit(page);
  const layers = await page.locator(siteSelector).first().evaluate(row => {
    const rect = row.getBoundingClientRect();
    const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
    const atPoint = () => document.elementFromPoint(x, y);
    const coversPoint = node => { const bounds = node.getBoundingClientRect(); return x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom; };
    const wrap = document.getElementById('search-widget-wrap');
    const group = document.querySelector('.group-tab');
    const clock = document.getElementById('clock-widget');
    const calendar = document.getElementById('calendar-popover');
    const settings = document.getElementById('settings-panel');
    const folder = document.getElementById('folder-overlay');
    const originals = [group, clock, calendar, settings, folder].map(node => ({ node, style: node.getAttribute('style'), className: node.className }));
    const result = { search: Number(getComputedStyle(wrap).zIndex), group: Number(getComputedStyle(document.getElementById('group-tabs-bar')).zIndex) };
    try {
      // Move a real group button onto the real option without changing either
      // stacking context. The old search-wrap:6 lost this exact hit test.
      const groupRect = group.getBoundingClientRect();
      group.style.transition = 'none';
      group.style.transform = `translate(${x - groupRect.left - groupRect.width / 2}px, ${y - groupRect.top - groupRect.height / 2}px)`;
      const moved = group.getBoundingClientRect();
      result.groupOverlap = { width: Math.min(rect.right, moved.right) - Math.max(rect.left, moved.left), height: Math.min(rect.bottom, moved.bottom) - Math.max(rect.top, moved.top) };
      result.aboveGroup = row.contains(atPoint());
      calendar.classList.remove('hidden');
      const calendarRect = calendar.getBoundingClientRect();
      clock.style.transform = `translate(${x - calendarRect.left - calendarRect.width / 2}px, ${y - calendarRect.top - calendarRect.height / 2}px)`;
      result.calendarCovers = coversPoint(calendar);
      result.calendar = Number(getComputedStyle(clock).zIndex);
      result.belowCalendar = !!atPoint()?.closest('#calendar-popover');
      calendar.classList.add('hidden');
      const clockOriginal = originals.find(entry => entry.node === clock).style;
      if (clockOriginal === null) clock.removeAttribute('style'); else clock.setAttribute('style', clockOriginal);
      settings.style.transition = 'none';
      settings.classList.remove('hidden');
      const settingsRect = settings.getBoundingClientRect();
      settings.style.transform = `translate(${x - settingsRect.left - settingsRect.width / 2}px, ${y - settingsRect.top - settingsRect.height / 2}px)`;
      result.settingsCovers = coversPoint(settings);
      result.belowSettings = !!atPoint()?.closest('#settings-panel');
      settings.classList.add('hidden');
      folder.classList.remove('hidden');
      result.folderCovers = coversPoint(folder);
      result.belowFolder = !!atPoint()?.closest('#folder-overlay');
    } finally {
      for (const { node, style, className } of originals) {
        node.className = className;
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
      }
    }
    return result;
  });
  assert.ok(layers.search > layers.group && layers.search < layers.calendar);
  assert.ok(layers.groupOverlap.width > 0 && layers.groupOverlap.height > 0, 'the real group fixture must actually overlap the option');
  assert.equal(layers.aboveGroup, true, 'saved-site options win a real group-tab overlap');
  assert.ok(layers.calendarCovers && layers.settingsCovers && layers.folderCovers, 'real overlay rectangles must cover the hit-test point');
  assert.equal(layers.belowCalendar, true, 'calendar remains above an open search dropdown');
  assert.equal(layers.belowSettings, true, 'root settings overlay remains above search');
  assert.equal(layers.belowFolder, true, 'root folder overlay remains above search');
  await page.locator('#date').click();
  await page.locator('#calendar-popover').waitFor({ state: 'visible' });
  await page.locator('#date').click();
  await page.locator('#calendar-popover').waitFor({ state: 'hidden' });
  await page.locator('#search-input').focus();
  await assertResultHit(page);
}
