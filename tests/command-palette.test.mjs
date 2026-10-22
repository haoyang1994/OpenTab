import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const site = (id, name, url, folderId = 'folder-home', parentId = '') => ({ id, name, url, folderId, parentId, type: 'shortcut' });
const fixture = {
  icons: [site('docs', 'Docs', 'https://docs.example.com/start'), site('work-docs', 'Docs', 'https://work.example.com/docs', 'work', 'reference'),
    site('long', 'Reference <img src=x onerror=alert(1)> ' + 'Long title '.repeat(8), 'https://reference.example.com/', 'work'),
    { id: 'reference', name: 'Reference folder', type: 'folder', folderId: 'work', parentId: '' },
    { id: 'unsafe', name: 'Unsafe', url: 'javascript:alert(1)', type: 'shortcut', folderId: 'folder-home' }],
  folders: [{ id: 'folder-home', name: '主页' }, { id: 'work', name: 'Work 工作' }], currentFolderId: 'folder-home',
  searchEngine: 'google', searchHistory: [], searchHistoryEnabled: false, searchOpenInNewTab: false,
  background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f, #537895)', source: 'gradient' },
  weatherEnabled: false, particlesEnabled: false, developerToolsEnabled: false, minimalMode: false, themeMode: 'light', languagePreference: 'en'
};
const context = await chromium.launchPersistentContext('', {
  headless: process.env.HEADLESS === 'true', locale: 'en-US', viewport: { width: 1280, height: 800 },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
const errors = [], requests = [];
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
await context.route('**/*', route => {
  if (/^https?:/.test(route.request().url())) { requests.push(route.request().url()); return route.abort(); }
  return route.continue();
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const base = `chrome-extension://${worker.url().split('/')[2]}`;
const page = await context.newPage();
const input = '#command-palette-input';
const row = (type, id) => `.command-palette-row[data-entry-type="${type}"][data-entry-id="${id}"]`;
const focus = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const log = () => page.evaluate(() => window.__paletteNav);
const closed = () => page.waitForSelector('#command-palette.hidden', { state: 'attached' });
const opened = () => page.waitForSelector('#command-palette:not(.hidden)');
async function store(data) { await worker.evaluate(value => new Promise(resolve => chrome.storage.local.set(value, resolve)), data); }
async function ready() {
  await page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length && OpenTabCommandPalette?.init && OpenTabSearch?.commandPalette && OpenTabSearch.getState().searchEngine === 'google' && OpenTabSearch.getState().searchHistoryEnabled === false);
  await page.evaluate(() => { window.__paletteNav = []; OpenTabSearch.navigateHook = (url, openInNewTab) => window.__paletteNav.push({ url, openInNewTab }); });
}
async function platform(name) {
  await page.evaluate(name => {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: name });
  }, name);
}
async function open(key = 'Control+k') { await page.keyboard.press(key); await opened(); assert.equal(await focus(), 'command-palette-input'); }
async function type(value) { await page.fill(input, value); }
async function assertIsolated() {
  assert.equal(await page.evaluate(() => [...document.body.children].filter(el => el.id !== 'command-palette').every(el => el.inert)), true);
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('#command-palette').contains(document.activeElement)), true);
  }
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.querySelector('#command-palette').contains(document.activeElement)), true);
  }
}
async function assertPanelBounds() {
  const bounds = await page.locator('.command-palette-panel').evaluate(el => {
    const b = el.getBoundingClientRect(), css = getComputedStyle(el);
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: innerWidth, height: innerHeight, bg: css.backgroundColor, opacity: css.opacity };
  });
  assert.ok(bounds.left >= 15 && bounds.right <= bounds.width - 15 && bounds.top >= 0 && bounds.bottom <= bounds.height);
  assert.equal(bounds.opacity, '1'); assert.match(bounds.bg, /^rgb\(/, 'opaque panel, not RGBA translucent surface');
  const first = page.locator('.command-palette-row').first();
  assert.equal(await first.evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }), true);
}
try {
  await store(fixture); await page.goto(`${base}/home.html`); await ready(); await platform('Linux x86_64');
  const before = await worker.evaluate(() => chrome.storage.local.get(['icons', 'folders', 'searchHistory', 'minimalMode']));
  // Native key events on Linux Chromium; only platform detection is simulated.
  for (const [name, key] of [['MacIntel', 'Meta+k'], ['Win32', 'Control+k'], ['Linux x86_64', 'Control+k']]) {
    await platform(name);
    await page.locator('#settings-btn').focus(); await open(key);
    assert.ok(await page.locator('.command-palette-row').count() > 2, 'empty input offers real destinations');
    assert.equal(await page.locator(row('site', 'unsafe')).count(), 0);
    await type('docs');
    await page.locator(input).evaluate(el => el.setSelectionRange(1, 3));
    await page.keyboard.press(key);
    assert.equal(await page.inputValue(input), 'docs');
    assert.deepEqual(await page.locator(input).evaluate(el => [el.selectionStart, el.selectionEnd]), [1, 3]);
    await page.keyboard.press('Escape'); await closed(); assert.equal(await focus(), 'settings-btn');
  }
  console.log('Palette: native platform bindings, independent overlay, repeated activation and opener restoration passed.');
  await page.fill('#search-input', 'preserve inline query');
  await page.locator('#search-input').evaluate(el => el.setSelectionRange(2, 8));
  await open(); await type('docs'); await page.keyboard.press('Escape'); await closed();
  assert.equal(await page.inputValue('#search-input'), 'preserve inline query');
  assert.deepEqual(await page.locator('#search-input').evaluate(el => [el.selectionStart, el.selectionEnd]), [2, 8]);
  await open(); await assertIsolated(); await page.keyboard.press('Escape'); await closed();
  assert.equal(await page.locator('#content').evaluate(el => el.inert), false);
  await page.locator('#settings-btn').focus(); await open();
  await page.mouse.click(4, 4); await closed(); assert.equal(await focus(), 'settings-btn');
  // Preserve pre-existing inert state and safely restore a removed opener.
  await page.evaluate(() => { const el = document.createElement('button'); el.id = 'palette-test-opener'; el.textContent = 'Opener'; document.body.appendChild(el); const sibling = document.createElement('div'); sibling.id = 'palette-pre-inert'; sibling.inert = true; document.body.appendChild(sibling); });
  await page.locator('#palette-test-opener').focus(); await open();
  await page.evaluate(() => document.querySelector('#palette-test-opener').remove());
  await page.keyboard.press('Escape'); await closed(); assert.equal(await focus(), 'BODY');
  assert.equal(await page.locator('#palette-pre-inert').evaluate(el => el.inert), true);
  await page.evaluate(() => document.querySelector('#palette-pre-inert').remove());

  await open(); await type('docs');
  assert.equal(await page.locator('.command-palette-row[data-entry-type="site"]').count(), 2);
  assert.equal(await page.locator('[role="option"][aria-selected="true"]').getAttribute('data-entry-id'), 'docs');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('[role="option"][aria-selected="true"]').getAttribute('data-entry-id'), 'work-docs');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await closed();
  assert.deepEqual((await log()).at(-1), { url: 'https://docs.example.com/start', openInNewTab: false });
  await open(); await type('docs'); await page.locator(row('site', 'work-docs')).click({ modifiers: ['Control'] }); await closed();
  assert.deepEqual((await log()).at(-1), { url: 'https://work.example.com/docs', openInNewTab: true });
  await open(); await type('reference.example');
  assert.equal(await page.locator('#command-palette-results img, #command-palette-results svg').count(), 0, 'user strings are literal text with no injected nodes');
  assert.ok((await page.locator('.command-palette-row-title').textContent()).includes('<img'));
  const navBeforeEmpty = (await log()).length;
  await type('no-such-entry-123456'); await page.keyboard.press('Enter');
  assert.equal((await log()).length, navBeforeEmpty, 'no web-search fallback');
  assert.equal(await page.locator('#command-palette-empty').isVisible(), true);
  await type(''); await page.click('[data-palette-filter="groups"]');
  assert.equal(await page.locator('.command-palette-row').count(), 2);
  await page.evaluate(() => {
    window.__paletteLockHeld = false;
    navigator.locks.request('opentab-workspace-v1', () => new Promise(resolve => {
      window.__paletteReleaseLock = resolve; window.__paletteLockHeld = true;
    }));
  });
  await page.waitForFunction(() => window.__paletteLockHeld);
  await page.click(row('group', 'work'));
  assert.equal(await page.locator('#command-palette').isVisible(), true, 'group action waits for durable selection, not just optimistic UI');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('currentFolderId')).currentFolderId), 'folder-home');
  await page.evaluate(() => window.__paletteReleaseLock());
  await closed();
  await waitForAsync(page, async () => (await chrome.storage.local.get('currentFolderId')).currentFolderId === 'work');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await platform('Linux x86_64');
  assert.equal(await page.locator('[data-group-id="work"]').first().evaluate(el => el.classList.contains('active')), true, 'durable group survives immediate reload');
  await open(); await page.click('[data-palette-filter="groups"]');
  await page.evaluate(() => {
    window.__paletteOriginalLocks = navigator.locks.request;
    navigator.locks.request = () => Promise.reject(new Error('Synthetic palette save failure'));
  });
  await page.click(row('group', 'folder-home'));
  await page.waitForFunction(() => document.querySelector('#command-palette-status').textContent === 'Group selection was not saved. Please try again.');
  assert.equal(await page.locator('#command-palette').isVisible(), true);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('currentFolderId')).currentFolderId), 'work');
  await page.evaluate(() => { navigator.locks.request = window.__paletteOriginalLocks; delete window.__paletteOriginalLocks; });
  await page.keyboard.press('Escape'); await closed();
  await open(); await page.click('[data-palette-filter="actions"]');
  assert.equal(await page.locator(row('action', 'advanced')).count(), 0);
  await page.click(row('action', 'weather')); await closed();
  await page.waitForSelector('#settings-panel:not(.hidden)');
  assert.equal(await page.locator('[data-settings-section="weather"]').evaluate(el => el.classList.contains('hidden')), false);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#settings-panel.hidden', { state: 'attached' });
  await open(); await type('add website'); await page.keyboard.press('Enter'); await closed();
  await page.waitForSelector('#add-icon-modal:not(.hidden)');
  await page.fill('#icon-name', 'draft must survive'); await page.keyboard.press('Control+k'); await closed();
  assert.equal(await page.inputValue('#icon-name'), 'draft must survive');
  await page.keyboard.press('Escape'); await page.waitForSelector('#add-icon-modal.hidden', { state: 'attached' });
  console.log('Palette: sites/categories/actions, group durable switch, literal labels, zero-result and draft protection passed.');

  // Inputs and IME must remain owned by their current editor; no key swallowing.
  await page.click('#settings-btn'); await page.fill('#settings-search', 'theme');
  await page.keyboard.press('Control+k'); await closed(); assert.equal(await focus(), 'settings-search');
  await page.keyboard.press('Escape'); assert.equal(await page.inputValue('#settings-search'), '');
  assert.equal(await page.locator('#settings-panel').evaluate(el => el.classList.contains('hidden')), false);
  await page.keyboard.press('Escape'); await page.waitForSelector('#settings-panel.hidden', { state: 'attached' });
  await page.locator('#settings-btn').focus();
  for (const flags of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { shiftKey: true }, { metaKey: true }]) {
    assert.equal(await page.evaluate(flags => {
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true, ...flags });
      return !document.activeElement.dispatchEvent(event);
    }, flags), false);
    await closed();
  }
  // A stale site must not open the payload captured before a live rename.
  await open(); await type('docs');
  const staleCount = (await log()).length;
  await page.evaluate(() => { OpenTabSearch.resolve('Docs').icon.name = 'Renamed after opening'; });
  await page.keyboard.press('Enter');
  assert.equal((await log()).length, staleCount);
  assert.ok((await page.locator('#command-palette-status').textContent()).includes('changed'));
  await page.keyboard.press('Escape'); await closed();
  const after = await worker.evaluate(() => chrome.storage.local.get(['icons', 'folders', 'searchHistory', 'minimalMode']));
  assert.deepEqual(after, before, 'launching/filtering has no writes to saved items/history/preferences');

  // Screenshots are true installed-extension UI. Test both languages/themes,
  // with short/narrow viewport and the real persisted clock-only preference.
  for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) {
    await store({ ...fixture, languagePreference: language, themeMode: theme });
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await platform('Linux x86_64');
    await page.waitForFunction(({ language, light }) => document.documentElement.lang === language && document.body.classList.contains('theme-light') === light, { language, light: theme === 'light' });
    assert.equal(await page.getAttribute('html', 'lang'), language);
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: width === 360 ? 560 : 800 });
      await page.locator('#settings-btn').focus(); await open();
      await assertPanelBounds();
      await page.screenshot({ path: path.join(artifacts, `command-palette-${language}-${theme}-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape'); await closed();
    }
  }
  await store({ ...fixture, minimalMode: true }); await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await platform('Linux x86_64');
  await page.setViewportSize({ width: 360, height: 420 });
  await page.locator('#settings-btn').focus(); await open(); await type('docs');
  assert.equal(await page.locator('#search-widget-wrap').isVisible(), false, 'palette does not borrow or reveal hidden main search');
  await assertPanelBounds();
  await page.screenshot({ path: path.join(artifacts, 'command-palette-minimal-360.png'), animations: 'disabled' });
  await page.keyboard.press('Escape'); await closed(); assert.equal(await focus(), 'settings-btn');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('minimalMode')).minimalMode), true);
  assert.deepEqual(errors, []);
  // Favicon resolution during ordinary grid startup may fetch; palette actions
  // are separately observed below after all startup work has quiesced.
  await page.waitForLoadState('networkidle'); const count = requests.length;
  await open(); await type('private.example.com/path?token=synthetic'); await page.keyboard.press('Escape'); await closed();
  assert.equal(requests.length, count, 'palette lookup never sends the query or performs previews');
  console.log('Palette: all native interaction, bilingual opaque responsive UI, minimal mode and local-only lookup passed.');
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'command-palette-failure.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally { await context.close(); }
