import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';
import { PIXEL, graphKeys } from './scenes-fixtures.mjs';
const Schema = createRequire(import.meta.url)('../scene-schema.js');
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
const errors = [], navigations = [], network = [];
let recordNavigation = true;
context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', route => {
  if (!/^https?:/.test(route.request().url())) return route.continue();
  network.push(route.request().url());
  return route.abort();
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const url = `chrome-extension://${worker.url().split('/')[2]}/home.html`;
const page = await context.newPage();
context.on('page', p => { if (recordNavigation && p !== page) navigations.push(p.url()); });
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
  // Closed native selects apply Home/ArrowDown immediately. Enter here can
  // open the native option popup rather than confirm an already applied value.
  assert.equal(await page.locator('#site-selection-destination').inputValue(), String(index));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'site-selection-destination');
}
async function assertClosed() { await page.waitForFunction(() => !OpenTabSiteSelection.isActive()); }
// Cross-scene coverage shares the native suite, not an extra E2E runner slot.
// These fixtures use uploaded icons so selecting/moving does not need a network
// request. Duplicate URLs and labels are intentionally distinct saved records.
const A = 'scene-default', B = 'scene-work', C = 'scene-work-copy', ARCHIVED = 'scene-archived';
const sceneKeys = [...graphKeys, 'currentFolderId', 'lastOpenedSceneId', 'opentab.workspaceEpoch',
  'background', 'themeMode', 'languagePreference', 'searchHistory', 'searchEngine', 'retainedUnknown'];
const readScenes = () => worker.evaluate(keys => chrome.storage.local.get(keys), sceneKeys);
function sceneFixture(extra = {}) {
  const base = structuredClone({ ...fixture, todos: [{ id: 'todo-a', text: 'Retain Default task', done: false, opaque: { keep: true } }],
    searchSuggestionsEnabled: false, browserSyncEnabled: false, gradientFlow: false, todoPanelOpen: false,
    retainedUnknown: { preserve: ['opaque', 'future', 'fields'] }, 'opentab.workspaceEpoch': 10, ...extra });
  base.folders.push({ id: 'source-group', name: 'Source group', parentId: 'folder-home', opaque: 'source group metadata' });
  base.icons.push(site('x1', 'source-group'), site('x2', 'source-group'));
  base.icons.find(icon => icon.id === 'b').url = base.icons.find(icon => icon.id === 'a').url;
  let data = Schema.migrateLegacy(base);
  for (const [id, name, homeGroupId] of [[B, 'Work', 'work-home'], [C, 'Work', 'copy-home'], [ARCHIVED, 'Archived', 'archived-home']]) {
    data = Schema.create(data, { id, name, iconKey: 'briefcase', homeGroupId, homeName: 'Home',
      profile: { background: { type: 'gradient', value: fixture.background.value, source: 'gradient' }, layoutIconSize: id === B ? 72 : 56 } });
  }
  data.folders.push({ id: 'work-parent', name: 'Projects', sceneId: B },
    { id: 'work-group', name: 'Duplicate', parentId: 'work-parent', sceneId: B },
    { id: 'copy-group', name: 'Duplicate', sceneId: C });
  data.icons.push(site('work-existing', 'work-home'),
    { id: 'work-target', name: 'Duplicate', type: 'folder', folderId: 'work-group', parentId: '', opaque: { keep: 'folder' } },
    site('work-child1', 'work-group', 'work-target'), site('work-child2', 'work-group', 'work-target'),
    site('copy-site', 'copy-group'), site('archived-site', 'archived-home'));
  data.icons.find(icon => icon.id === 'work-existing').url = data.icons.find(icon => icon.id === 'a').url;
  data.icons = data.icons.map(icon => icon.type === 'shortcut' ? { ...icon, uploadedIconDataUrl: `data:image/png;base64,${PIXEL}`,
    iconSource: 'upload', opaque: { id: icon.id, keep: ['asset', 'metadata'] } } : icon);
  data.todos.push({ id: 'todo-b', text: 'Retain Work task', done: true, sceneId: B, opaque: { keep: 'todo' } });
  data.lastOpenedSceneId = C; // Device preference must never become this tab's view.
  data = Schema.archive(data, { sceneId: ARCHIVED, archivedAt: 1 });
  Schema.validate(data); return data;
}
async function installSceneView(target, sceneId, groupId) {
  await target.addInitScript(({ sceneId, groupId }) => {
    if (location.protocol === 'chrome-extension:') {
      sessionStorage.setItem('opentab.scene.view', JSON.stringify({ sceneId,
        lastGroupIds: { [sceneId]: groupId, 'scene-work-copy': 'copy-group' } }));
    }
  }, { sceneId, groupId });
}
async function resetScene(extra = {}, sourceGroup = 'folder-home') {
  // Seed the existing extension origin's tab-local view before leaving it.
  // Do not use window.name (Chrome clears it across sites), or a source-page
  // init script that would hide unintended session changes on every reload.
  await page.evaluate(groupId => sessionStorage.setItem('opentab.scene.view', JSON.stringify({
    sceneId: 'scene-default', lastGroupIds: { 'scene-default': groupId, 'scene-work-copy': 'copy-group' }
  })), sourceGroup);
  await page.goto('about:blank');
  const data = sceneFixture(extra);
  assert.deepEqual(await store(data), data, 'full scene fixture is durably written under the real workspace lock');
  await page.goto(url);
  await page.waitForFunction(({ sourceGroup, language, light }) => {
    const view = globalThis.OpenTabSceneNavigation?.getView();
    return performance.getEntriesByName('opentab:grid-ready').length > 0 && globalThis.OpenTabSiteSelection
      && view?.sceneId === 'scene-default' && view.currentFolderId === sourceGroup
      && OpenTabI18n.locale === language && document.documentElement.lang === language
      && document.body.classList.contains('theme-light') === light;
  }, { sourceGroup, language: data.languagePreference, light: data.themeMode === 'light' });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.__crossMoveCalls = []; window.__crossBrowserCalls = [];
    const realMove = OpenTabFolders.moveSites;
    OpenTabFolders.moveSites = async (...args) => {
      const call = { settled: false }; window.__crossMoveCalls.push(call);
      try { call.result = await realMove(...args); return call.result; }
      finally { call.settled = true; }
    };
    // Observe browser access without replacing any behavior. Reading tab data,
    // launching a tab, or requesting a permission is not part of a site move.
    for (const [api, methods] of [[chrome.tabs, ['query', 'get', 'getCurrent', 'create', 'update']], [chrome.permissions, ['request']]]) {
      for (const method of methods) if (typeof api?.[method] === 'function') {
        const original = api[method].bind(api);
        api[method] = (...args) => { window.__crossBrowserCalls.push(method); return original(...args); };
      }
    }
  });
  return readScenes();
}
async function chooseScene(kind, id) {
  await page.click('#site-selection-move');
  const option = page.locator(`#site-selection-destination option[data-kind="${kind}"][data-destination-id="${id}"]`);
  assert.equal(await option.count(), 1, 'destination uses a stable kind and ID despite duplicate labels');
  const value = await option.getAttribute('value');
  await page.locator('#site-selection-destination').focus(); await page.keyboard.press('Home');
  for (let step = 0; step < Number(value); step++) await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#site-selection-destination').inputValue(), value);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'site-selection-destination');
  assert.equal(await option.getAttribute('data-scene-id'), B);
  assert.match(await option.textContent(), /Work/);
  assert.match(await page.textContent('#site-selection-preview'), /Work/);
}
async function waitMove() {
  await page.waitForFunction(() => window.__crossMoveCalls.length > 0 && window.__crossMoveCalls.at(-1).settled);
  return page.evaluate(() => window.__crossMoveCalls.at(-1).result);
}
const viewState = () => page.evaluate(() => ({ view: OpenTabSceneNavigation.getView(), session: sessionStorage.getItem('opentab.scene.view'), url: location.href }));
async function assertNoBrowserWork(startNetwork, startNavigation) {
  assert.deepEqual(await page.evaluate(() => window.__crossBrowserCalls), [], 'move never reads tabs, launches pages, or requests permissions');
  assert.deepEqual(network.slice(startNetwork), [], 'move never initiates a network request');
  assert.deepEqual(navigations.slice(startNavigation), [], 'move never implicitly navigates');
}
async function holdSceneWrite(patch = {}) {
  await worker.evaluate(patch => {
    globalThis.__crossLockHeld = false;
    globalThis.__crossLock = OpenTabWorkspace.transaction(async ({ read, write }) => {
      await read(null); globalThis.__crossLockHeld = true;
      await new Promise(resolve => { globalThis.__crossRelease = resolve; });
      if (Object.keys(patch).length) await write(patch);
    });
  }, patch);
  await waitForAsync(worker, () => globalThis.__crossLockHeld === true);
}
async function releaseSceneWrite() {
  await worker.evaluate(async () => { globalThis.__crossRelease(); await globalThis.__crossLock; });
}
async function settleSceneWrites() {
  await waitForAsync(worker, async () => {
    const locks = await navigator.locks.query();
    return ![...locks.held, ...locks.pending].some(lock => lock.name === OpenTabWorkspace.LOCK_NAME);
  });
}
function expectedMove(before, ids, groupId, parentId = '') {
  return { ...structuredClone(before), icons: before.icons.map(icon => ids.includes(icon.id) ? { ...icon, folderId: groupId, parentId } : structuredClone(icon)) };
}
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
    const bounds = await page.locator('#site-selection-dialog').evaluate(el => { const rect = el.getBoundingClientRect(), css = getComputedStyle(el); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, bg: css.backgroundColor, opacity: css.opacity }; });
    assert.ok(bounds.left >= 16 && bounds.right <= bounds.width - 16 && bounds.top >= 16 && bounds.bottom <= bounds.height - 16);
    assert.ok(Math.abs(bounds.left - (bounds.width - bounds.right)) <= 1, 'dialog is horizontally centered');
    assert.ok(Math.abs(bounds.top - (bounds.height - bounds.bottom)) <= 1, 'dialog is vertically centered');
    assert.equal(bounds.opacity, '1'); assert.match(bounds.bg, /^rgb\(/);
    for (const key of ['Tab', 'Shift+Tab']) {
      const ids = key === 'Tab'
        ? ['site-selection-dialog-cancel', 'site-selection-confirm', 'site-selection-destination']
        : ['site-selection-confirm', 'site-selection-dialog-cancel', 'site-selection-destination'];
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press(key);
        const focus = await page.evaluate(() => ({ id: document.activeElement.id, tag: document.activeElement.tagName, inside: document.querySelector('#site-selection-dialog').contains(document.activeElement) }));
        assert.equal(focus.inside, true, JSON.stringify({ key, i, focus }));
        assert.equal(focus.id, ids[i % ids.length], `${key} step ${i} follows the exact dialog control sequence: ${JSON.stringify(focus)}`);
      }
    }
    await page.screenshot({ path: path.join(artifacts, `site-selection-${languagePreference}-${themeMode}-narrow.png`) });
  }
  console.log('Site selection: cross-active-scene native moves and durable guards');
  for (const destination of [
    { kind: 'group', id: 'work-home', groupId: 'work-home', parentId: '' },
    { kind: 'group', id: 'work-group', groupId: 'work-group', parentId: '' },
    { kind: 'folder', id: 'work-target', groupId: 'work-group', parentId: 'work-target' }
  ]) {
    const before = await resetScene(), sourceView = await viewState();
    const startNetwork = network.length, startNavigation = navigations.length;
    await start(); await page.click(check('b')); await page.click(check('a'));
    await chooseScene(destination.kind, destination.id);
    assert.match(await page.textContent('#site-selection-preview'), /2/, 'preview announces the selected count');
    const options = await page.locator('#site-selection-destination option').evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent, id: node.dataset.destinationId, scene: node.dataset.sceneId
    })));
    assert.equal(options.some(option => option.scene === ARCHIVED || option.id === 'archived-home'), false, 'archived destinations are absent');
    for (const id of ['work-group', 'copy-group']) assert.equal(options.filter(option => option.id === id).length, 1);
    assert.notEqual(options.find(option => option.id === 'work-group').text, options.find(option => option.id === 'copy-group').text, 'duplicate scene/group names retain distinct IDs');
    assert.match(options.find(option => option.id === 'work-target').text, /Work.*Projects.*Duplicate.*Duplicate.*\(work-target\)$/);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'site-selection-move', 'chooser Cancel returns focus to Move to');
    assert.equal(await page.locator(check('a')).isChecked(), true);
    assert.deepEqual(await readScenes(), before, 'keyboard cancel does not write any scene data');
    assert.deepEqual(await viewState(), sourceView, 'keyboard cancel does not change tab-local navigation');
    await chooseScene(destination.kind, destination.id);
    await page.click('#site-selection-confirm'); assert.equal((await waitMove()).ok, true); await assertClosed();
    const expected = expectedMove(before, ['a', 'b'], destination.groupId, destination.parentId);
    assert.deepEqual(await readScenes(), expected, 'only the two memberships change: IDs, URLs, assets, metadata, order, todos and profiles survive');
    assert.deepEqual(await viewState(), sourceView, 'moving does not switch scenes, groups, or tab-local selection');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'select-sites');
    assert.equal(await page.locator(tile('a')).count(), 0);
    assert.equal(expected.icons.filter(icon => icon.url === before.icons.find(icon => icon.id === 'a').url).length, 3, 'duplicate URLs are moved as independent records, never deduplicated');
    await assertNoBrowserWork(startNetwork, startNavigation);
    await page.reload();
    await page.waitForFunction(() => OpenTabSceneNavigation?.getView()?.sceneId === 'scene-default' && globalThis.OpenTabSiteSelection);
    assert.equal(await page.locator(tile('a')).count(), 0, 'source projection remains correct after reload');
    assert.deepEqual(await readScenes(), expected);
    // Inspect a second independent tab, without changing the source tab's view.
    recordNavigation = false; const destinationPage = await context.newPage(); recordNavigation = true;
    try {
      await installSceneView(destinationPage, B, destination.groupId);
      await destinationPage.goto(url); await destinationPage.reload();
      await destinationPage.waitForFunction(groupId => OpenTabSceneNavigation?.getView()?.sceneId === 'scene-work'
        && OpenTabSceneNavigation.getView().currentFolderId === groupId && globalThis.OpenTabSiteSelection, destination.groupId);
      if (destination.parentId) await destinationPage.click(tile(destination.parentId));
      for (const id of ['a', 'b']) {
        await destinationPage.locator(tile(id)).waitFor({ state: 'visible' });
        assert.equal(await destinationPage.locator(tile(id)).count(), 1, 'destination contains one original record, not a copy');
      }
      const visibleIds = await destinationPage.locator(`${destination.parentId ? '#folder-icons-container' : '#icons-container'} .icon-widget`).evaluateAll(nodes => nodes.map(node => node.dataset.id));
      assert.deepEqual(visibleIds.filter(id => ['a', 'b'].includes(id)), ['a', 'b'], 'selection click order does not reorder saved records');
      assert.deepEqual(await readScenes(), expected, 'reloading either projection never rewrites the full graph');
      assert.equal((await viewState()).session, sourceView.session, 'the destination tab cannot rewrite source session storage');
    } finally { await destinationPage.close(); }
  }

  // Real source-folder dissolution and inverse merge survive unrelated durable
  // changes. The original folder, its position, and all child memberships return.
  {
    const before = await resetScene(); await page.click(tile('source')); await start(true);
    await page.click(check('s1')); await page.click(check('s2')); await chooseScene('folder', 'work-target');
    await page.click('#site-selection-confirm'); assert.equal((await waitMove()).ok, true); await assertClosed();
    const moved = await readScenes();
    assert.equal(moved.icons.some(icon => icon.id === 'source'), false);
    assert.equal(moved.icons.find(icon => icon.id === 's3').parentId, '');
    assert.equal(moved.icons.findIndex(icon => icon.id === 's3'), before.icons.findIndex(icon => icon.id === 'source'));
    const concurrent = structuredClone(moved);
    concurrent.icons.find(icon => icon.id === 'c').name = 'Unrelated change while Undo waits';
    concurrent.todos.find(todo => todo.id === 'todo-b').text = 'Concurrent Work task';
    await holdSceneWrite({ icons: concurrent.icons, todos: concurrent.todos });
    await page.click('#toast button'); await releaseSceneWrite(); await settleSceneWrites();
    await waitForAsync(worker, async () => (await chrome.storage.local.get('icons')).icons.some(icon => icon.id === 'source'));
    const expected = structuredClone(before);
    expected.icons.find(icon => icon.id === 'c').name = 'Unrelated change while Undo waits';
    expected.todos.find(todo => todo.id === 'todo-b').text = 'Concurrent Work task';
    assert.deepEqual(await readScenes(), expected, 'guarded Undo restores source dissolution without rolling back unrelated records');
    await page.reload(); await page.waitForSelector(tile('source'));
    assert.deepEqual(await readScenes(), expected, 'Undo is durable across reload');
  }

  // Locked conflicts must be rejected against durable state, rather than an
  // optimistic page snapshot. Inject only after the real move is pending.
  const conflictCases = [
    ['source scene rename', false, data => { data.scenes.find(scene => scene.id === A).name = 'Renamed source'; }],
    ['destination scene rename', false, data => { data.scenes.find(scene => scene.id === B).name = 'Renamed Work'; }],
    ['source scene archive', false, data => { data.scenes.find(scene => scene.id === A).archivedAt = 2; }],
    ['destination scene archive', false, data => { data.scenes.find(scene => scene.id === B).archivedAt = 2; }],
    ['destination scene deletion', false, data => { const ids = new Set(data.folders.filter(group => group.sceneId === B).map(group => group.id)); data.scenes = data.scenes.filter(scene => scene.id !== B); data.sceneProfiles = data.sceneProfiles.filter(profile => profile.id !== B); data.folders = data.folders.filter(group => !ids.has(group.id)); data.icons = data.icons.filter(icon => !ids.has(icon.folderId)); data.todos = data.todos.filter(todo => todo.sceneId !== B); }],
    ['destination group rename', false, data => { data.folders.find(group => group.id === 'work-group').name = 'Renamed group'; }],
    ['destination ancestor rename', false, data => { data.folders.find(group => group.id === 'work-parent').name = 'Renamed ancestor'; }],
    ['destination group move', false, data => { data.folders.find(group => group.id === 'work-group').sceneId = C; data.folders.find(group => group.id === 'work-group').parentId = ''; }],
    ['destination group reparent', false, data => { data.folders.find(group => group.id === 'work-group').parentId = 'work-home'; }],
    ['destination group deletion', false, data => { data.folders = data.folders.filter(group => group.id !== 'work-group'); data.icons = data.icons.filter(icon => icon.folderId !== 'work-group'); }],
    ['destination folder rename', false, data => { data.icons.find(icon => icon.id === 'work-target').name = 'Renamed folder'; }],
    ['destination folder move', false, data => { data.icons.filter(icon => icon.id === 'work-target' || icon.parentId === 'work-target').forEach(icon => { icon.folderId = 'work-home'; }); }],
    ['destination folder deletion', false, data => { data.icons = data.icons.filter(icon => icon.id !== 'work-target' && icon.parentId !== 'work-target'); }],
    ['selected website edit', false, data => { data.icons.find(icon => icon.id === 'a').name = 'Concurrent selected edit'; }],
    ['selected website deletion', false, data => { data.icons = data.icons.filter(icon => icon.id !== 'a'); }],
    ['source group move', true, data => { data.folders.find(group => group.id === 'source-group').sceneId = C; data.folders.find(group => group.id === 'source-group').parentId = ''; }],
    ['source group reparent', true, data => { data.folders.find(group => group.id === 'source-group').parentId = 'other'; }],
    ['source group deletion', true, data => { data.folders = data.folders.filter(group => group.id !== 'source-group'); data.icons = data.icons.filter(icon => icon.folderId !== 'source-group'); }],
    ['source folder rename', false, data => { data.icons.find(icon => icon.id === 'source').name = 'Renamed source folder'; }, true],
    ['source folder move', false, data => { data.icons.filter(icon => icon.id === 'source' || icon.parentId === 'source').forEach(icon => { icon.folderId = 'other'; }); }, true],
    ['source sibling edit', false, data => { data.icons.find(icon => icon.id === 's3').name = 'Changed source sibling'; }, true],
    ['restored workspace epoch', false, data => { data['opentab.workspaceEpoch'] += 1; }]
  ];
  for (const [label, sourceGroup, change, sourceFolder] of conflictCases) {
    const before = await resetScene({}, sourceGroup ? 'source-group' : 'folder-home');
    const selectedIds = sourceFolder ? ['s1', 's2'] : sourceGroup ? ['x1', 'x2'] : ['a', 'b'];
    if (sourceFolder) await page.click(tile('source'));
    await start(Boolean(sourceFolder)); for (const id of selectedIds) await page.click(check(id));
    await chooseScene('folder', 'work-target');
    const expected = structuredClone(before); change(expected); Schema.validate(expected);
    const patch = Object.fromEntries(Object.entries(expected).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])));
    await holdSceneWrite(patch);
    await page.click('#site-selection-confirm'); await page.waitForFunction(() => OpenTabSiteSelection.isPending());
    await releaseSceneWrite();
    assert.equal((await waitMove()).reason, 'stale', `${label} invalidates consent under the durable lock`);
    await settleSceneWrites();
    assert.deepEqual(await readScenes(), expected, `${label} preserves the complete newer workspace without a partial move`);
    assert.equal(await page.evaluate(() => window.__crossMoveCalls.length), 1);
  }

  // An unrelated edit and an independent source label are not a destination
  // conflict. Preserve them while merging just the selected memberships.
  {
    const before = await resetScene({}, 'source-group');
    await start(); await page.click(check('x1')); await chooseScene('folder', 'work-target');
    const concurrent = structuredClone(before);
    concurrent.folders.find(group => group.id === 'source-group').name = 'Updated source label';
    concurrent.icons.find(icon => icon.id === 'c').name = 'Independent website edit';
    concurrent.todos.find(todo => todo.id === 'todo-b').text = 'Independent task edit';
    concurrent.sceneProfiles.find(profile => profile.id === C).layoutIconSize = 80;
    await holdSceneWrite({ folders: concurrent.folders, icons: concurrent.icons, todos: concurrent.todos, sceneProfiles: concurrent.sceneProfiles });
    await page.click('#site-selection-confirm'); await page.waitForFunction(() => OpenTabSiteSelection.isPending());
    await releaseSceneWrite(); assert.equal((await waitMove()).ok, true); await assertClosed();
    assert.deepEqual(await readScenes(), expectedMove(concurrent, ['x1'], 'work-group', 'work-target'), 'concurrent unrelated edits survive the cross-scene merge');
  }

  // Undo cannot restore into a changed source/destination or across replacement.
  for (const [label, change] of [
    ['destination scene rename', data => { data.scenes.find(scene => scene.id === B).name = 'New destination identity'; }],
    ['source archive', data => { data.scenes.find(scene => scene.id === A).archivedAt = 3; }],
    ['destination folder move', data => { data.icons.filter(icon => icon.id === 'work-target' || icon.parentId === 'work-target').forEach(icon => { icon.folderId = 'work-home'; }); }],
    ['restored epoch', data => { data['opentab.workspaceEpoch'] += 1; }]
  ]) {
    await resetScene(); await start(); await page.click(check('a')); await chooseScene('folder', 'work-target');
    await page.click('#site-selection-confirm'); assert.equal((await waitMove()).ok, true); await assertClosed();
    const expected = await readScenes(); change(expected); Schema.validate(expected);
    await holdSceneWrite(expected); await page.click('#toast button'); await releaseSceneWrite(); await settleSceneWrites();
    assert.deepEqual(await readScenes(), expected, `${label} blocks stale Undo without losing the concurrent change`);
  }

  // Fail the actual durable write, not the move API, then retry with the same
  // selected IDs. A real held lock also proves the UI and primitive single flight.
  {
    const before = await resetScene(); await start(); await page.click(check('a')); await chooseScene('group', 'work-home');
    await page.evaluate(() => {
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      window.__failCrossSceneWrite = true;
      chrome.storage.local.set = (...args) => {
        if (window.__failCrossSceneWrite && args[0]?.icons?.some(icon => icon.id === 'a' && icon.folderId === 'work-home')) {
          window.__failCrossSceneWrite = false; throw new Error('Synthetic definite cross-scene storage failure');
        }
        return original(...args);
      };
    });
    await page.click('#site-selection-confirm'); assert.equal((await waitMove()).reason, 'save-failed');
    await page.waitForFunction(() => !OpenTabSiteSelection.isPending() && document.querySelector('#site-selection-error').textContent.length > 0);
    assert.equal(await page.locator('#site-selection-dialog').isVisible(), true);
    assert.equal(await page.locator(check('a')).isChecked(), true);
    assert.deepEqual(await readScenes(), before, 'failed storage write is atomic');
    await holdSceneWrite();
    await page.click('#site-selection-confirm'); await page.waitForFunction(() => OpenTabSiteSelection.isPending());
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    const confirmBounds = await page.locator('#site-selection-confirm').boundingBox();
    await page.mouse.click(confirmBounds.x + confirmBounds.width / 2, confirmBounds.y + confirmBounds.height / 2);
    assert.equal(await page.locator('#site-selection-dialog').isVisible(), true);
    assert.equal(await page.locator('#site-selection-confirm').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__crossMoveCalls.length), 2, 'only the failed call and one retry entered the real primitive');
    assert.deepEqual(await readScenes(), before, 'pending save is not early success');
    await releaseSceneWrite(); assert.equal((await waitMove()).ok, true); await assertClosed();
    assert.deepEqual(await readScenes(), expectedMove(before, ['a'], 'work-home'));
  }

  // Full cross-scene paths, preview, and keyboard focus at both supported sizes.
  for (const languagePreference of ['en', 'zh-CN']) for (const themeMode of ['light', 'dark']) for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: width === 360 ? 844 : 900 });
    const before = await resetScene({ languagePreference, themeMode });
    await start(); await page.click(check('a')); await page.click(check('b')); await chooseScene('folder', 'work-target');
    const bounds = await page.locator('#site-selection-dialog').evaluate(el => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el), preview = document.querySelector('#site-selection-preview').getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight,
        scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, opacity: style.opacity, bg: style.backgroundColor,
        previewLeft: preview.left, previewRight: preview.right };
    });
    assert.ok(bounds.left >= 16 && bounds.right <= bounds.viewportWidth - 16 && bounds.top >= 16 && bounds.bottom <= bounds.viewportHeight - 16);
    assert.ok(Math.abs(bounds.left - (bounds.viewportWidth - bounds.right)) <= 1);
    assert.ok(Math.abs(bounds.top - (bounds.viewportHeight - bounds.bottom)) <= 1);
    assert.ok(bounds.scrollWidth <= bounds.clientWidth, 'full path text does not create horizontal dialog overflow');
    assert.ok(bounds.previewLeft >= bounds.left && bounds.previewRight <= bounds.right);
    assert.equal(bounds.opacity, '1'); assert.match(bounds.bg, /^rgb\(/);
    for (const [key, ids] of [['Tab', ['site-selection-dialog-cancel', 'site-selection-confirm', 'site-selection-destination']],
      ['Shift+Tab', ['site-selection-confirm', 'site-selection-dialog-cancel', 'site-selection-destination']]]) {
      for (let i = 0; i < 6; i++) { await page.keyboard.press(key); assert.equal(await page.evaluate(() => document.activeElement.id), ids[i % ids.length]); }
    }
    await page.screenshot({ path: path.join(artifacts, `site-selection-cross-scene-${languagePreference}-${themeMode}-${width}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await assertClosed();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'select-sites');
    assert.deepEqual(await readScenes(), before, 'visual preview and Cancel never write the workspace');
  }
  assert.deepEqual(errors, []);
  console.log('Site selection native legacy/cross-scene pointer, keyboard, durable moves, guarded Undo, pending and failure flow passed');
} catch (error) {
  console.error('Site selection failure state:', await page.evaluate(() => ({ activeId: document.activeElement?.id, activeTag: document.activeElement?.tagName, dialogOpen: document.querySelector('#site-selection-dialog')?.open })).catch(() => null));
  await page.screenshot({ path: path.join(artifacts, 'site-selection-failure.png') }).catch(() => {});
  throw error;
} finally { await context.close(); }
