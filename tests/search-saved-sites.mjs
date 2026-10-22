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
  // Calendar construction is deferred until a real opening. Initialize through
  // the public control before the later geometry fixture directly reveals it.
  await page.locator('#date').click();
  await page.locator('#calendar-popover:not(.hidden) .flatpickr-calendar').waitFor({ state: 'visible' });
  await page.locator('#date').click();
  await page.locator('#calendar-popover').waitFor({ state: 'hidden' });
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

  // Result choices use active-descendant navigation. The new delete actions
  // are native Tab stops: visit each exact action, then leave the widget.
  // A focused delete must not disappear when the input's blur timer runs.
  for (const key of ['Tab', 'Shift+Tab']) {
    await type('doc'); await page.locator('#search-input').press('ArrowDown');
    const beforeTabNavigation = (await log()).length;
    if (key === 'Tab') {
      const actions = page.locator('#search-history .search-history-delete');
      const actionCount = await actions.count();
      assert.ok(actionCount > 0, 'fixture includes deletable history');
      for (let index = 0; index < actionCount; index++) {
        await page.keyboard.press('Tab');
        assert.equal(await actions.nth(index).evaluate(node => document.activeElement === node), true,
          `Tab visits delete action ${index} without opening a result`);
        assert.equal(await page.locator('#search-history').isVisible(), true);
      }
    }
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#search-history')), false);
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'search-input');
    await page.waitForFunction(() => document.getElementById('search-history').classList.contains('hidden'));
    assert.equal(await active(), null);
    assert.equal((await log()).length, beforeTabNavigation, 'Tab traversal never activates a result');
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
          rows: [...list.querySelectorAll('button.search-result-item[role="gridcell"]')].map(row => ({ width: row.getBoundingClientRect().width, tabIndex: row.tabIndex })) };
      });
      assert.ok(bounds.left >= 0 && bounds.right <= width, 'saved-site dropdown stays inside the viewport');
      assert.ok(bounds.contentWidth <= bounds.clientWidth + 1, 'long metadata is ellipsized, not horizontally scrollable');
      assert.ok(bounds.rows.every(row => row.width <= bounds.width && row.tabIndex === -1));
      assert.ok(bounds.inputWidth >= 64, 'platform key hint leaves usable input width on narrow screens');
      await assertVisibleResultHits(page);
      await captureSearchThemes(page, `search-saved-sites-${preference}-${width}`);
    }
  }
  // Native keyboard activation must never bubble into search/site navigation.
  await store({ ...fixture, languagePreference: 'en', searchHistory: [
    { q: 'docs query', engine: 'bing', at: 3 },
    { q: 'docs keyboard', engine: 'google', at: 2 },
    { q: 'docs space', engine: 'google', at: 1 }
  ] });
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  await type('docs');
  assert.equal(await page.getAttribute('#search-input', 'aria-haspopup'), 'grid');
  assert.equal(await page.getAttribute('#search-history', 'role'), 'grid');
  const deletes = page.locator('#search-history .search-history-delete');
  assert.equal(await deletes.count(), 3);
  await deletes.first().click();
  await page.waitForFunction(() => document.querySelectorAll('#search-history .search-history-delete').length === 2);
  assert.equal(await page.inputValue('#search-input'), 'docs');
  assert.equal((await log()).length, 0, 'pointer deletion does not execute search or open a site');
  assert.equal(await page.locator(siteSelector).count(), 5);
  await page.locator('#search-input').focus();
  await page.locator('#search-input').press('Tab');
  await deletes.first().waitFor({ state: 'visible' });
  assert.equal(await deletes.first().evaluate(node => document.activeElement === node), true, 'native Tab reaches the first delete button');
  await deletes.first().press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#search-history .search-history-delete').length === 1);
  assert.equal(await deletes.first().evaluate(node => document.activeElement === node), true, 'Enter deletion keeps next action focused');
  await deletes.first().press('Space');
  await page.waitForFunction(() => document.querySelectorAll('#search-history .search-history-delete').length === 0);
  assert.equal(await page.locator('#search-input').evaluate(node => document.activeElement === node), true);
  assert.equal((await log()).length, 0, 'Enter and Space delete without activation');
  assert.equal(await page.locator(siteSelector).count(), 5, 'history deletion preserves saved sites');
  assert.equal(await active(), null, 'deletion clears stale active descendant');
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('searchHistory')).searchHistory), []);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.OpenTabSearch && performance.getEntriesByName('opentab:grid-ready').length > 0);
  await type(''); await page.locator('#search-input').focus();
  assert.equal(await page.locator(historySelector).count(), 0, 'deleted records stay gone after reload');
  assert.equal(await page.getAttribute('#search-input', 'aria-expanded'), 'false', 'empty history has no empty open popup');
  await type('docs');
  assert.equal(await page.locator(siteSelector).count(), 5);
  await page.locator('#search-input').press('Tab');
  assert.equal(await page.locator('#search-input').evaluate(node => document.activeElement === node), false, 'native Tab still exits search when no delete actions remain');
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log('Saved-site E2E: local-only lookup, safe explicit navigation, live stale rejection, history/ARIA/IME/Tab and bilingual responsive screenshots passed.');
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
  const selector = '#search-history button.search-result-item[role="gridcell"]';
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
