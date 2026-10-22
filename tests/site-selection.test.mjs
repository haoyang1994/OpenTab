import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const site = (id, folderId = 'folder-home', parentId = '') => ({ id, name: `Site ${id}`, url: `https://${id}.example.test/`, type: 'shortcut', folderId, parentId });
const fixture = {
  folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Duplicate' }, { id: 'other', name: 'Duplicate' }], currentFolderId: 'folder-home',
  icons: [site('a'), site('b'), site('c'),
    { id: 'source', name: 'Source', type: 'folder', folderId: 'folder-home', parentId: '' }, site('s1', 'folder-home', 'source'), site('s2', 'folder-home', 'source'), site('s3', 'folder-home', 'source'),
    { id: 'target', name: 'Duplicate', type: 'folder', folderId: 'work', parentId: '' }, site('t1', 'work', 'target'), site('t2', 'work', 'target'),
    { id: 'ssh', name: 'SSH', type: 'ssh', url: '', folderId: 'folder-home', parentId: '' },
    { id: 'tool', name: 'Tool', type: 'tool', toolId: 'json', folderId: 'folder-home', parentId: '' }],
  weatherEnabled: false, particlesEnabled: false, minimalMode: false, themeMode: 'light', languagePreference: 'en',
  background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f, #537895)', source: 'gradient' },
  searchHistory: [], searchHistoryEnabled: false, searchEngine: 'google', searchOpenInNewTab: false
};
const context = await chromium.launchPersistentContext('', {
  headless: process.env.HEADLESS === 'true', locale: 'en-US', viewport: { width: 1280, height: 900 },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
const errors = [], navigations = [];
context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', route => /^https?:/.test(route.request().url()) ? route.abort() : route.continue());
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const url = `chrome-extension://${worker.url().split('/')[2]}/home.html`;
const page = await context.newPage();
context.on('page', p => { if (p !== page) navigations.push(p.url()); });
page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url() !== url && frame.url() !== 'about:blank') navigations.push(frame.url()); });
const tile = id => `.icon-widget[data-id="${id}"]`;
const check = id => `${tile(id)} .site-selection-checkbox`;
const read = () => worker.evaluate(() => chrome.storage.local.get(['icons', 'folders', 'currentFolderId']));
async function store(data) {
  return worker.evaluate(value => OpenTabWorkspace.transaction(async ({ write, read }) => { await write(value); return read(Object.keys(value)); }), data);
}
async function reset(extra = {}) {
  const data = { ...fixture, ...extra }; assert.deepEqual(await store(data), data);
  await page.goto(url); await page.reload();
  await page.waitForFunction(({ languagePreference, themeMode }) =>
    OpenTabSiteSelection && OpenTabFolders.bulkMoveContext().sites.some(site => site.id === 'a')
    && OpenTabI18n.locale === languagePreference && document.documentElement.lang === languagePreference
    && document.body.classList.contains('theme-light') === (themeMode === 'light'),
  { languagePreference: data.languagePreference, themeMode: data.themeMode });
}
async function start(folder = false) { await page.click(folder ? '#folder-select-sites' : '#select-sites'); await page.waitForSelector('#site-selection-toolbar:not([hidden])'); }
async function choose(kind, id) {
  await page.click('#site-selection-move');
  const index = await page.locator('#site-selection-destination option').evaluateAll((options, identity) => options.findIndex(option => option.textContent.endsWith(`(${identity})`)), id);
  assert.ok(index >= 0, `${kind} destination ${id} exists`);
  await page.locator('#site-selection-destination').focus();
  await page.keyboard.press('Home');
  for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#site-selection-destination').inputValue(), String(index));
}
async function assertClosed() { await page.waitForFunction(() => !OpenTabSiteSelection.isActive()); }
try {
  await reset(); const before = await read();
  await start();
  assert.equal(await page.locator('.site-selection-checkbox').count(), 3, 'only HTTP(S) root websites are selectable');
  assert.equal(await page.locator('#site-selection-move').isDisabled(), true);
  await page.click(tile('a'), { modifiers: ['Control'] });
  assert.equal(await page.locator(check('a')).isChecked(), true);
  await page.click(tile('b'), { button: 'middle' });
  assert.equal(await page.locator(check('b')).isChecked(), false);
  await page.locator(check('b')).focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator(check('b')).isChecked(), true);
  await page.click(check('c'));
  assert.equal(await page.locator(check('c')).isChecked(), true, 'native checkbox click is not reverted by canceled default activation');
  assert.match(await page.textContent('#site-selection-count'), /3/);
  await page.keyboard.press('Alt+ArrowLeft');
  assert.deepEqual(await read(), before, 'selection/reorder keys do not write');
  await choose('group', 'work');
  const chooserScope = await page.evaluate(() => OpenTabFolders.bulkMoveContext().scope);
  await page.click('#site-selection-title', { button: 'right' });
  assert.equal(await page.locator('#add-icon-modal').evaluate(el => el.classList.contains('hidden')), true);
  assert.equal(await page.locator('#site-selection-dialog').isVisible(), true);
  await page.locator('#site-selection-destination').focus();
  await page.keyboard.press('Alt+2');
  assert.equal(await page.locator('#site-selection-dialog').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => OpenTabFolders.bulkMoveContext().scope), chooserScope, 'chooser blocks background group shortcuts');
  assert.deepEqual(await read(), before, 'Alt+2 in chooser cannot persist a background group change');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#site-selection-dialog').isVisible(), false);
  assert.equal(await page.evaluate(() => OpenTabSiteSelection.isActive()), true, 'dialog Escape leaves selection');
  await page.keyboard.press('Escape'); await assertClosed();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'select-sites');
  assert.deepEqual(await read(), before, 'cancel has zero workspace writes');
  assert.deepEqual(navigations, [], 'modifier and middle clicks did not navigate');
  // No dormant toolbar or dialog controls can enter the normal tab sequence.
  for (let i = 0; i < 24; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#site-selection-toolbar, #site-selection-dialog'))), false); }

  await start(); await page.click('#site-selection-all'); await page.click('#site-selection-clear');
  assert.match(await page.textContent('#site-selection-count'), /0/);
  await page.click(check('a')); await page.click(check('b')); await choose('group', 'work');
  await page.click('#site-selection-confirm'); await assertClosed();
  assert.equal((await read()).icons.find(icon => icon.id === 'a').folderId, 'work');
  await page.click('#toast button');
  await page.waitForFunction(() => OpenTabFolders.bulkMoveContext().sites.some(site => site.id === 'a'));
  await waitForAsync(worker, async () => (await chrome.storage.local.get('icons')).icons.some(icon => icon.id === 'a' && icon.folderId === 'folder-home'));
  assert.equal((await read()).icons.find(icon => icon.id === 'a').folderId, 'folder-home', 'Undo is durable');
  await page.reload(); await start(); await page.click(check('a')); await choose('folder', 'target'); await page.click('#site-selection-confirm'); await assertClosed();
  assert.equal((await read()).icons.find(icon => icon.id === 'a').parentId, 'target');
  await page.reload(); assert.equal((await read()).icons.find(icon => icon.id === 'a').folderId, 'work', 'move survives reload');

  await reset(); await page.click(tile('source')); await start(true);
  assert.equal(await page.locator('.site-selection-checkbox').count(), 3);
  await page.click(check('s1')); await page.click(check('s2')); await choose('group', 'work'); await page.click('#site-selection-confirm'); await assertClosed();
  const afterFolder = (await read()).icons;
  assert.equal(afterFolder.some(icon => icon.id === 'source'), false, 'one-child source dissolution is preserved');
  assert.equal(afterFolder.find(icon => icon.id === 's3').parentId, '', 'remaining source child returns to its group root');

  // Failed durable save keeps the dialog and original selected IDs available.
  await reset(); await start(); await page.click(check('a')); await choose('group', 'work');
  await page.evaluate(() => { window.__realMoveSites = OpenTabFolders.moveSites; OpenTabFolders.moveSites = async () => ({ ok: false, reason: 'save-failed' }); });
  await page.click('#site-selection-confirm');
  await page.waitForFunction(() => !OpenTabSiteSelection.isPending() && document.querySelector('#site-selection-error').textContent.length > 0);
  assert.equal(await page.locator('#site-selection-dialog').isVisible(), true);
  assert.equal(await page.locator(check('a')).isChecked(), true);
  assert.equal((await read()).icons.find(icon => icon.id === 'a').folderId, 'folder-home');
  await page.evaluate(() => { OpenTabFolders.moveSites = window.__realMoveSites; });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

  // Changes arriving while the chooser is open cannot silently rebase the
  // original selection/destination into a different operation.
  for (const change of ['selected', 'destination']) {
    await reset(); await start(); await page.click(check('a')); await page.click(check('b')); await choose('folder', 'target');
    await worker.evaluate(change => OpenTabWorkspace.transaction(async ({ read, write }) => {
      const { icons } = await read(['icons']);
      await write({ icons: icons.filter(icon => change === 'selected' ? icon.id !== 'a' : icon.id !== 'target' && icon.parentId !== 'target') });
    }), change);
    const expected = await read();
    // Storage writes from another context are adopted on save/rebase, not by
    // a general live subscription. Confirm exercises the real locked guard.
    await page.click('#site-selection-confirm');
    await page.waitForFunction(() => !OpenTabSiteSelection.isPending()
      && document.querySelector('#site-selection-error').textContent === OpenTabI18n.t('网站或目标已变化。请取消并重新选择。'));
    assert.deepEqual(await read(), expected, 'locked rejection preserves every durable workspace record');
    assert.equal(await page.locator('#site-selection-dialog').isVisible(), true);
    assert.equal((await read()).icons.find(icon => icon.id === 'b').folderId, 'folder-home', 'no partial move after stale selection/destination');
    assert.equal(await page.locator('#site-selection-confirm').isDisabled(), true);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  }
  await reset(); await page.click(tile('source')); await start(true); await page.click(check('s1')); await choose('group', 'work');
  await worker.evaluate(() => OpenTabWorkspace.transaction(async ({ read, write }) => {
    const { icons } = await read(['icons']); await write({ icons: icons.map(icon => icon.id === 's3' ? { ...icon, name: 'Changed remaining child' } : icon) });
  }));
  const expectedSource = await read();
  await page.click('#site-selection-confirm');
  await page.waitForFunction(() => !OpenTabSiteSelection.isPending()
    && document.querySelector('#site-selection-confirm').disabled
    && document.querySelector('#site-selection-error').textContent === OpenTabI18n.t('网站或目标已变化。请取消并重新选择。'));
  assert.deepEqual(await read(), expectedSource, 'source-child guard rejection preserves all durable records');
  assert.equal((await read()).icons.find(icon => icon.id === 's1').parentId, 'source', 'changed source child blocks stale dissolution plan');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

  // A held real workspace lock is pending, not early success; repeated physical
  // Enter/Escape and pointer input cannot submit a second move or close it.
  await reset(); await start(); await page.click(check('a')); await choose('group', 'work');
  await worker.evaluate(() => { globalThis.__selectionLockHeld = false; globalThis.__selectionLock = OpenTabWorkspace.transaction(async () => { globalThis.__selectionLockHeld = true; await new Promise(resolve => { globalThis.__releaseSelectionLock = resolve; }); }); });
  await waitForAsync(worker, () => globalThis.__selectionLockHeld === true);
  await page.click('#site-selection-confirm');
  await page.waitForFunction(() => OpenTabSiteSelection.isPending());
  assert.equal(await page.locator('#site-selection-confirm').isDisabled(), true);
  await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#site-selection-dialog').isVisible(), true);
  assert.equal((await read()).icons.find(icon => icon.id === 'a').folderId, 'folder-home');
  await worker.evaluate(() => globalThis.__releaseSelectionLock());
  await assertClosed(); assert.equal((await read()).icons.find(icon => icon.id === 'a').folderId, 'work');

  // Native palette/search interaction remains normal outside selection and
  // exits selection before showing the palette from its non-text controls.
  await reset(); await start(); await page.locator(check('a')).focus(); await page.keyboard.press('Control+k');
  await page.waitForSelector('#command-palette:not(.hidden)'); await assertClosed(); await page.keyboard.press('Escape');
  await start(); await page.click('[data-group-id="work"]'); await assertClosed();
  await page.click('[data-group-id="folder-home"]');
  await page.locator('#search-input').fill('normal web search');
  assert.equal(await page.locator('#search-input').inputValue(), 'normal web search');

  for (const languagePreference of ['en', 'zh-CN']) for (const themeMode of ['light', 'dark']) {
    await reset({ languagePreference, themeMode }); await page.setViewportSize({ width: 390, height: 844 });
    await start(); await page.click(check('a')); await choose('folder', 'target');
    const bounds = await page.locator('#site-selection-dialog').evaluate(el => { const rect = el.getBoundingClientRect(), css = getComputedStyle(el); return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, bg: css.backgroundColor, opacity: css.opacity }; });
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height);
    assert.equal(bounds.opacity, '1'); assert.match(bounds.bg, /^rgb\(/);
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.querySelector('#site-selection-dialog').contains(document.activeElement)), true); }
    await page.screenshot({ path: path.join(artifacts, `site-selection-${languagePreference}-${themeMode}-narrow.png`) });
  }
  assert.deepEqual(errors, []);
  console.log('Site selection native pointer, keyboard, durable moves, Undo, pending and failure flow passed');
} finally { await context.close(); }
