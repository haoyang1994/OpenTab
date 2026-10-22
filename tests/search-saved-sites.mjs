import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const site = (id, name, url, folderId = 'folder-home', parentId = '') => ({
  id, name, url, type: 'shortcut', folderId, parentId
});
const longTitle = 'Docs Reference <img src=x onerror=alert(1)> ' + 'Long saved title '.repeat(9);
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
  async function ready() {
    await page.waitForFunction(() => window.OpenTabSearch && window.OpenTabSearch.resolve('Docs').type === 'shortcut' && performance.getEntriesByName('opentab:grid-ready').length > 0);
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
  await page.locator(siteSelector).first().click();
  assert.equal((await log()).length, beforePlainClick + 1);
  assert.deepEqual((await log()).at(-1), { url: fixture.icons.find(icon => icon.id === 'site-long').url, openInNewTab: false }, 'plain left click opens the selected site once in the same tab');
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
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
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
          rows: [...list.querySelectorAll('[role="option"]')].map(row => ({ width: row.getBoundingClientRect().width, tabIndex: row.tabIndex })) };
      });
      assert.ok(bounds.left >= 0 && bounds.right <= width, 'saved-site dropdown stays inside the viewport');
      assert.ok(bounds.contentWidth <= bounds.clientWidth + 1, 'long metadata is ellipsized, not horizontally scrollable');
      assert.ok(bounds.rows.every(row => row.width <= bounds.width && row.tabIndex === -1));
      await page.screenshot({ path: path.join(artifacts, `search-saved-sites-${preference}-${width}.png`), animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log('Saved-site E2E: local-only lookup, safe explicit navigation, live stale rejection, history/ARIA/IME/Tab and bilingual responsive screenshots passed.');
}
