import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';
import { formatConsoleError } from './console-allow.mjs';
import { legacyFixture, expectedLegacyFirstLoad, SCHEMA_KEY, BACKUP_KEY, EPOCH_KEY, DEFAULT_SCENE, PIXEL, SECOND_GRADIENT, graphKeys } from './scenes-fixtures.mjs';

// Real unpacked MV3 pages, native inputs and the actual storage coordinator.
// The only browser API fixture is popup activeTab discovery, whose automation
// page cannot receive a toolbar click's activeTab grant. No UI, controller,
// rendering, save, lock or storage implementation is replaced.
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Imports = require('../import.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const launchOptions = {
  headless: process.env.HEADLESS === 'true', locale: 'en-US', reducedMotion: 'reduce', acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
};
const errors = [], network = [];
let phaseName = 'setup', delayedArchive = null, archiveGate = null;
const recordErrors = page => {
  page.on('pageerror', error => errors.push(`[${phaseName}] ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`[${phaseName}] ${formatConsoleError(message)}`); });
};
async function launchIsolated() {
  const context = await chromium.launchPersistentContext('', launchOptions);
  context.on('page', recordErrors);
  context.pages().forEach(recordErrors);
  context.on('console', message => {
    if (!message.page() && message.type() === 'error') errors.push(`[${phaseName}] worker: ${formatConsoleError(message)}`);
  });
  // Fulfill every HTTP request locally, including favicon providers. No synthetic
  // names, URLs or fixture data are transmitted to an external server.
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (!/^https?:/.test(url)) return route.continue();
    network.push(url);
    if (url.includes('/HPImageArchive.aspx')) {
      if (archiveGate) { delayedArchive = url; await archiveGate.promise; }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ images: [{ url: '/scene-delayed-wallpaper.png', startdate: '20990101', title: 'Offline scene wallpaper', copyright: 'Synthetic fixture' }] }) });
    }
    if (request.resourceType() === 'image' || url.endsWith('.png') || /favicon|touch-icon/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(PIXEL, 'base64') });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });
  return context;
}
const context = await launchIsolated();
let legacyContext;
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const base = `chrome-extension://${worker.url().split('/')[2]}`;
const home = `${base}/home.html`;
const page = await context.newPage();
let second, workScene, workHome, extraScene, exported;
const dialog = '.scene-dialog[open]';
const action = name => `${dialog} [data-scene-action="${name}"]`;
const rowAction = (id, name) => `${dialog} [data-scene-id="${id}"] [data-scene-action="${name}"]`;
const currentView = p => p.evaluate(() => OpenTabSceneNavigation.getView());
const stored = keys => worker.evaluate(keys => chrome.storage.local.get(keys), keys ?? null);
const graph = async () => Object.fromEntries(Object.entries(await stored(graphKeys)));
async function phase(name, run) {
  phaseName = name;
  console.log(`Scenes: START ${name}`);
  try { await run(); assert.deepEqual(errors, [], `${name}: no console/page errors`); console.log(`Scenes: PASS ${name}`); }
  catch (error) { console.error(`Scenes: FAIL ${name}: ${error.stack || error}`); throw error; }
}
async function seed(data, targetWorker = worker) {
  const readback = await targetWorker.evaluate(data => OpenTabWorkspace.transaction(async ({ write, read }) => {
    await write(data);
    return read(Object.keys(data));
  }), data);
  assert.deepEqual(readback, data, 'fixture committed under the installer lock with strict readback');
}
async function ready(p, { scenes = true, language = 'en' } = {}) {
  await p.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0 && globalThis.OpenTabSearch && globalThis.OpenTabI18n);
  await p.evaluate(() => OpenTabI18n.ready);
  await p.waitForFunction(language => document.documentElement.lang === language, language);
  await p.waitForSelector('#scene-switcher [data-scene-action="open"]');
  if (scenes) await p.waitForFunction(() => globalThis.OpenTabSceneNavigation?.getView()?.sceneId && document.querySelector('#scene-switcher .scene-trigger'));
  await p.evaluate(() => {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
  });
}
async function viewIs(p, sceneId, groupId) {
  await p.waitForFunction(({ sceneId, groupId }) => {
    const view = globalThis.OpenTabSceneNavigation?.getView();
    return view?.sceneId === sceneId && (!groupId || view.currentFolderId === groupId);
  }, { sceneId, groupId });
}
async function click(p, selector, options) {
  const target = p.locator(selector);
  await target.scrollIntoViewIfNeeded();
  assert.equal(await target.evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), true, `${selector}: native hit target is not occluded`);
  await target.click(options);
}
async function open(p = page) { await click(p, '#scene-switcher .scene-trigger'); await p.waitForSelector(dialog); }
async function close(p = page) { await p.keyboard.press('Escape'); await p.waitForSelector('.scene-dialog[open]', { state: 'detached' }); }
async function switchTo(id, p = page) {
  await open(p); await click(p, rowAction(id, 'switch'));
  await p.waitForSelector('.scene-dialog[open]', { state: 'detached' }); await viewIs(p, id);
}
async function selectGroup(id, p = page) {
  await click(p, `#group-tabs [data-group-id="${id}"]`);
  await p.waitForFunction(id => OpenTabSceneNavigation.getView().currentFolderId === id, id);
}
async function settings(section, p = page) {
  await click(p, '#settings-btn'); await p.waitForSelector('#settings-panel:not(.hidden)');
  await click(p, `#settings-nav-${section}`);
}
async function closeSettings(p = page) { await click(p, '#close-settings'); await p.waitForSelector('#settings-panel.hidden', { state: 'attached' }); }
async function rename(p, id, name) {
  await open(p); await click(p, rowAction(id, 'rename')); await p.locator('.scene-name-input').fill(name);
  await p.locator('.scene-name-input').press('Enter');
  await waitForAsync(worker, async ({ id, name }) => (await chrome.storage.local.get('scenes')).scenes.find(item => item.id === id)?.name === name, { id, name });
  await p.waitForSelector(`${dialog}:not([aria-busy]) .scene-list`); await close(p);
}
async function holdLock(p) {
  await p.evaluate(() => {
    window.__scenesLockHeld = false;
    window.__scenesLockPromise = navigator.locks.request('opentab-workspace-v1', () => new Promise(resolve => {
      window.__scenesReleaseLock = resolve; window.__scenesLockHeld = true;
    }));
  });
  await p.waitForFunction(() => window.__scenesLockHeld);
}
async function releaseLock(p) { await p.evaluate(async () => { window.__scenesReleaseLock(); await window.__scenesLockPromise; }); }
async function reloadAfter(p, task, options) {
  const navigation = p.waitForEvent('framenavigated', { predicate: frame => frame === p.mainFrame() });
  await task(); await navigation; await ready(p, options);
}
async function assertProfile(sceneId, expected) {
  await waitForAsync(worker, async ({ sceneId, expected }) => {
    const profile = (await chrome.storage.local.get('sceneProfiles')).sceneProfiles.find(item => item.id === sceneId);
    return Object.entries(expected).every(([key, value]) => JSON.stringify(profile?.[key]) === JSON.stringify(value));
  }, { sceneId, expected });
}
async function assertRenderedGradient(p, value) {
  await p.waitForFunction(value => {
    const probe = document.createElement('div'); probe.style.backgroundImage = value;
    return getComputedStyle(document.querySelector('#background-layer')).backgroundImage === probe.style.backgroundImage;
  }, value);
}

try {
  await phase('explicit migration preserves the complete legacy graph', async () => {
    const legacy = legacyFixture(); await seed(legacy); await page.goto(home); await ready(page, { scenes: false });
    // Wait for the existing legacy loader's durable Home repair, not merely
    // first paint. The exact allowlisted normalization is checked below.
    await waitForAsync(worker, async () => (await chrome.storage.local.get('icons')).icons[0].folderId === 'folder-home');
    const before = await stored();
    for (const key of [SCHEMA_KEY, 'scenes', 'sceneProfiles']) assert.equal(Object.hasOwn(before, key), false, `loading a legacy workspace does not create ${key}`);
    assert.ok(['icons', 'folders', 'todos'].every(key => before[key].every(item => !Object.hasOwn(item, 'sceneId'))), 'legacy entities have no scene ownership before opt-in');
    const expectedLegacy = expectedLegacyFirstLoad();
    for (const key of ['icons', 'folders', 'todos']) assert.deepEqual(before[key], expectedLegacy[key], `legacy ${key} allows only the exact existing Home normalization before opt-in`);
    await click(page, '#scene-switcher [data-scene-action="open"]');
    // Runtime's native first-use notice must precede, not follow, migration.
    await page.waitForSelector('.scene-introduction:not([hidden]) [data-scene-action="enable"]');
    assert.deepEqual(await stored(), before, 'opening the compatibility notice is read-only');
    await click(page, '.scene-introduction [data-scene-action="enable"]'); await page.waitForSelector(dialog); await viewIs(page, DEFAULT_SCENE, 'folder-home');
    const after = await stored(); Schema.validate(after);
    assert.deepEqual(after.icons.map(item => item.id), legacy.icons.map(item => item.id));
    assert.deepEqual(after.folders.map(item => item.id), ['folder-home', ...legacy.folders.map(item => item.id)]);
    assert.deepEqual(after.todos.map(item => item.id), legacy.todos.map(item => item.id));
    assert.ok(after.folders.every(item => item.sceneId === DEFAULT_SCENE));
    assert.ok(after.todos.every(item => item.sceneId === DEFAULT_SCENE));
    assert.equal(after.icons[0].folderId, 'folder-home');
    assert.deepEqual(after.icons[0].custom, legacy.icons[0].custom);
    assert.equal(after.icons[0].uploadedIconDataUrl, legacy.icons[0].uploadedIconDataUrl);
    assert.equal(after[BACKUP_KEY].reason, 'before-scene-migration');
    assert.deepEqual(after[BACKUP_KEY].data, Imports.stripSecretsFromState(before), 'one complete secret-stripped original recovery point, not a filtered scene snapshot');
    assert.equal(after[BACKUP_KEY].data.customLegacyRecord.sshPassword, '');
    assert.ok(!JSON.stringify(after[BACKUP_KEY]).includes('SYNTHETIC_ONLY_NEVER_TRANSMIT'));
    assert.equal(await page.locator(rowAction(DEFAULT_SCENE, 'archive')).isDisabled(), true);
    await close();
    assert.equal(await page.evaluate(() => document.activeElement.matches('#scene-switcher .scene-trigger')), true);
    second = await context.newPage(); await second.goto(home); await ready(second); await viewIs(second, DEFAULT_SCENE);
  });

  await phase('create rename move archive restore without copied sites', async () => {
    const before = await graph(); await open(); await click(page, action('create'));
    await page.locator('.scene-name-input').fill('Work'); await click(page, `${dialog} [data-icon-key="briefcase"]`);
    await page.locator('.scene-name-input').press('Enter');
    await waitForAsync(worker, async () => (await chrome.storage.local.get('scenes')).scenes.length === 2);
    ({ id: workScene, homeGroupId: workHome } = (await stored('scenes')).scenes.find(item => item.name === 'Work'));
    await viewIs(page, workScene, workHome); await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-list`); await close();
    await rename(page, workScene, 'Work space'); await viewIs(second, DEFAULT_SCENE, 'folder-home');
    await switchTo(DEFAULT_SCENE); await selectGroup('research'); await open(); await click(page, action('move'));
    await page.locator('.scene-target-select').selectOption(workScene); await click(page, action('submit'));
    await waitForAsync(worker, async id => (await chrome.storage.local.get('folders')).folders.find(item => item.id === 'research').sceneId === id, workScene);
    await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-list`); await close();
    const moved = await graph();
    assert.deepEqual(moved.icons, before.icons, 'moving a group changes ownership, never duplicate/copy website arrays');
    assert.deepEqual(moved.todos, before.todos, 'moving a group does not move scene to-dos');
    assert.deepEqual(moved.folders.filter(item => ['research', 'research-child'].includes(item.id)).map(item => item.sceneId), [workScene, workScene]);
    await viewIs(page, DEFAULT_SCENE, 'folder-home');
    assert.equal(await page.locator('#group-tabs [data-group-id="research"]').count(), 0);
    assert.deepEqual(await page.locator('#icons-container .icon-widget[data-id]').evaluateAll(nodes => nodes.map(node => node.dataset.id)), ['daily-docs']);
    await switchTo(workScene); await selectGroup('research');
    assert.equal(await page.locator('#icons-container .icon-widget[data-id="research-docs"]').count(), 1);
    assert.equal(await page.locator('#icons-container .icon-widget[data-id="daily-docs"]').count(), 0);
    await click(page, '#add-group-btn'); await page.locator('#new-group-input').fill('Work queue'); await page.locator('#new-group-input').press('Enter');
    await waitForAsync(worker, async id => (await chrome.storage.local.get('folders')).folders.some(item => item.name === 'Work queue' && item.sceneId === id), workScene);
    const complete = await graph();
    await open(); await click(page, rowAction(workScene, 'archive')); await click(page, action('submit'));
    await waitForAsync(worker, async id => (await chrome.storage.local.get('scenes')).scenes.find(item => item.id === id).archivedAt !== null, workScene);
    await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-list`);
    assert.equal(await page.locator(rowAction(workScene, 'switch')).count(), 0);
    for (const key of ['icons', 'folders', 'todos', 'sceneProfiles']) assert.deepEqual((await graph())[key], complete[key], `archive retains all ${key}`);
    await click(page, action('toggle-archived')); await click(page, rowAction(workScene, 'restore'));
    await waitForAsync(worker, async id => (await chrome.storage.local.get('scenes')).scenes.find(item => item.id === id).archivedAt === null, workScene);
    await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-list`); await close();
    await switchTo(workScene); await selectGroup('research');
  });

  await phase('tab-local scene and group selection with durable palette navigation', async () => {
    await viewIs(second, DEFAULT_SCENE, 'folder-home');
    await second.reload(); await ready(second); await viewIs(second, DEFAULT_SCENE, 'folder-home');
    const fresh = await context.newPage(); await fresh.goto(home); await ready(fresh); await viewIs(fresh, workScene, 'research'); await fresh.close();
    await page.reload(); await ready(page); await viewIs(page, workScene, 'research');
    await second.keyboard.press('Control+k'); await second.waitForSelector('#command-palette:not(.hidden)');
    await second.locator('#command-palette-input').fill('Research Docs');
    const siteRow = second.locator('.command-palette-row[data-entry-id="research-docs"]');
    assert.match(await siteRow.textContent(), /Work space/); assert.match(await siteRow.textContent(), /Research/);
    await second.locator('#command-palette-input').fill('Research'); await click(second, '[data-palette-filter="groups"]');
    const groupRow = '.command-palette-row[data-entry-type="group"][data-entry-id="research"]';
    assert.match(await second.locator(groupRow).textContent(), /Work space/);
    await holdLock(page); await click(second, groupRow);
    assert.equal(await second.locator('#command-palette').isVisible(), true, 'palette stays open before durable selection');
    assert.equal((await currentView(second)).sceneId, DEFAULT_SCENE);
    await releaseLock(page); await second.waitForSelector('#command-palette.hidden', { state: 'attached' });
    await viewIs(second, workScene, 'research'); await switchTo(DEFAULT_SCENE, second);
    await viewIs(page, workScene, 'research');
  });

  await phase('scene to-dos and pending saves never leak to another scene', async () => {
    await click(page, '#todo-toggle-btn'); await page.waitForSelector('#todo-widget:not(.hidden)');
    assert.equal(await page.locator('#todo-list .todo-item').count(), 0);
    await page.locator('#todo-input').fill('Work-only task'); await page.locator('#todo-input').press('Enter');
    await waitForAsync(worker, async id => (await chrome.storage.local.get('todos')).todos.some(item => item.text === 'Work-only task' && item.sceneId === id), workScene);
    await page.locator('#todo-list .todo-item').filter({ hasText: 'Work-only task' }).locator('input[type="checkbox"]').check();
    await waitForAsync(worker, async () => (await chrome.storage.local.get('todos')).todos.find(item => item.text === 'Work-only task').done === true);
    assert.equal((await stored('todos')).todos.find(item => item.id === 'daily-task').done, false);
    await click(page, '[data-clock-card="2"]');
    assert.doesNotMatch(await page.locator('#clock-todo-count').textContent(), /today|今日|今天/i, 'no fabricated daily completion statistics');
    await click(page, '[data-clock-card="1"]'); await click(page, '#clock-focus-toggle');
    const focus = await page.evaluate(() => JSON.parse(sessionStorage.getItem('opentab.focus.v1')));
    assert.equal(focus.phase, 'running');
    await holdLock(second);
    await page.locator('#todo-input').fill('Draft queued before switch'); await page.locator('#todo-input').press('Enter');
    await open(); await click(page, rowAction(DEFAULT_SCENE, 'switch'));
    assert.equal(await page.locator(dialog).getAttribute('aria-busy'), 'true');
    assert.equal((await currentView(page)).sceneId, workScene);
    await page.keyboard.press('Escape'); assert.equal(await page.locator(dialog).count(), 1);
    await releaseLock(second); await page.waitForSelector('.scene-dialog[open]', { state: 'detached' }); await viewIs(page, DEFAULT_SCENE);
    const tasks = (await stored('todos')).todos;
    assert.equal(tasks.find(item => item.text === 'Draft queued before switch').sceneId, workScene);
    assert.equal(await page.locator('#todo-list').getByText('Draft queued before switch', { exact: true }).count(), 0);
    assert.equal(await page.locator('#todo-list').getByText('Read the synthetic brief', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('opentab.focus.v1')).deadline), focus.deadline, 'scene switches do not reset the global-in-this-tab focus timer');
    await click(page, '[data-clock-card="1"]'); await click(page, '#clock-focus-reset'); await click(page, '[data-clock-card="0"]');
  });

  await phase('held locks stale identities and epochs preserve drafts', async () => {
    await open(); await click(page, rowAction(workScene, 'rename')); await page.locator('.scene-name-input').fill('Keep my unsaved name');
    await rename(second, workScene, 'Work changed elsewhere');
    await page.waitForFunction(() => document.querySelector('.scene-name-input')?.value === 'Keep my unsaved name');
    const afterOtherTab = await graph(); await page.locator('.scene-name-input').press('Enter');
    await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-status-error`);
    assert.equal(await page.inputValue('.scene-name-input'), 'Keep my unsaved name');
    assert.deepEqual(await graph(), afterOtherTab, 'stale captured identity performs no write'); await close();
    await open(); await click(page, rowAction(workScene, 'rename')); await page.locator('.scene-name-input').fill('Keep my epoch draft');
    const oldGeneration = (await currentView(page)).generation;
    await worker.evaluate(key => OpenTabWorkspace.transaction(async ({ read, write }) => { const state = await read(null); await write({ [key]: (state[key] || 0) + 1 }); }), EPOCH_KEY);
    await page.waitForFunction(old => OpenTabSceneNavigation.getView().generation > old, oldGeneration);
    const afterEpoch = await graph(); await page.locator('.scene-name-input').press('Enter');
    await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-status-error`);
    assert.equal(await page.inputValue('.scene-name-input'), 'Keep my epoch draft'); assert.deepEqual(await graph(), afterEpoch); await close();
    await open(); await click(page, action('create')); await page.locator('.scene-name-input').fill('Uninterrupted draft');
    await holdLock(second); const count = (await stored('scenes')).scenes.length;
    await page.locator('.scene-name-input').press('Enter'); await page.waitForSelector(`${dialog}[aria-busy="true"]`);
    await page.keyboard.press('Escape'); assert.equal(await page.locator(dialog).count(), 1);
    assert.equal(await page.inputValue('.scene-name-input'), 'Uninterrupted draft'); assert.equal((await stored('scenes')).scenes.length, count);
    assert.equal(await page.locator(action('close')).isDisabled(), true);
    await releaseLock(second); await waitForAsync(worker, async count => (await chrome.storage.local.get('scenes')).scenes.length === count + 1, count);
    extraScene = (await stored('scenes')).scenes.find(item => item.name === 'Uninterrupted draft').id;
    await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-list`); await close();
    await switchTo(DEFAULT_SCENE);
    await click(page, '#add-shortcut-tile'); await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.locator('#icon-name').fill('Keep my website draft'); await page.keyboard.press('Control+k');
    assert.equal(await page.locator('#command-palette').isVisible(), false);
    assert.equal(await page.inputValue('#icon-name'), 'Keep my website draft'); assert.equal((await currentView(page)).sceneId, DEFAULT_SCENE);
    await page.keyboard.press('Escape'); await page.waitForSelector('#add-icon-modal.hidden', { state: 'attached' });
    await page.locator('#todo-input').fill('Unsubmitted daily draft');
    let beforeDirty = await graph(); await open(); await click(page, rowAction(workScene, 'switch'));
    await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-status-error`);
    assert.equal((await currentView(page)).sceneId, DEFAULT_SCENE);
    assert.equal(await page.inputValue('#todo-input'), 'Unsubmitted daily draft'); assert.deepEqual(await graph(), beforeDirty);
    await close(); await page.locator('#todo-input').fill('');
    await switchTo(workScene); await selectGroup('research'); await page.locator('#todo-input').fill('Unsubmitted work draft');
    beforeDirty = await graph(); await open(); await click(page, action('move'));
    await page.locator('.scene-target-select').selectOption(DEFAULT_SCENE);
    await click(page, action('submit'));
    await page.waitForSelector(`${dialog}:not([aria-busy]) .scene-status-error`);
    assert.equal((await currentView(page)).sceneId, workScene);
    assert.equal(await page.inputValue('#todo-input'), 'Unsubmitted work draft'); assert.deepEqual(await graph(), beforeDirty, 'dirty move cannot transfer a group or lose the input');
    await close(); await page.locator('#todo-input').fill(''); await switchTo(DEFAULT_SCENE);
  });

  await phase('separate appearance profiles and shared theme search privacy', async () => {
    const originalDefault = (await stored('sceneProfiles')).sceneProfiles.find(item => item.id === DEFAULT_SCENE);
    await switchTo(workScene); await settings('layout');
    await click(page, '.layout-size-preset[data-size="80"]'); await page.locator('#layout-columns').selectOption('4');
    await page.locator('#layout-show-names').uncheck(); await page.locator('#layout-max-width').focus(); await page.keyboard.press('Home');
    await assertProfile(workScene, { layoutIconSize: 80, layoutColumns: 4, layoutShowNames: false, layoutMaxWidth: 640 });
    await page.locator('#todo-button-visible').uncheck();
    await waitForAsync(worker, async () => (await chrome.storage.local.get('todoButtonVisible')).todoButtonVisible === false);
    await click(page, '#settings-nav-wallpaper'); await click(page, '.tab-btn[data-type="gradient"]');
    await click(page, `.preset-item[data-value="${SECOND_GRADIENT}"]`);
    await assertProfile(workScene, { background: { type: 'gradient', value: SECOND_GRADIENT, source: 'gradient' } });
    await assertRenderedGradient(page, SECOND_GRADIENT);
    await click(page, '#settings-nav-appearance'); await click(page, '.theme-mode-tab[data-theme="dark"]');
    await waitForAsync(worker, async () => (await chrome.storage.local.get('themeMode')).themeMode === 'dark'); await closeSettings();
    await page.locator('#search-input').focus(); await page.keyboard.press('Alt+ArrowDown');
    await waitForAsync(worker, async () => (await chrome.storage.local.get('searchEngine')).searchEngine === 'bing');
    await switchTo(DEFAULT_SCENE);
    assert.deepEqual((await stored('sceneProfiles')).sceneProfiles.find(item => item.id === DEFAULT_SCENE), originalDefault);
    await assertRenderedGradient(page, originalDefault.background.value);
    assert.equal(await page.evaluate(() => OpenTabLayout.get().layoutIconSize), 56);
    assert.equal(await page.evaluate(() => !document.body.classList.contains('theme-light')), true);
    assert.equal(await page.evaluate(() => OpenTabSearch.getState().searchEngine), 'bing');
    assert.equal((await stored('searchHistoryEnabled')).searchHistoryEnabled, false);
    assert.equal(await page.evaluate(() => document.body.classList.contains('hide-todo-entry')), true, 'to-do entry visibility is global, not part of a scene profile');
    assert.ok((await stored('sceneProfiles')).sceneProfiles.every(item => !Object.hasOwn(item, 'todoButtonVisible')));
    await settings('layout'); await page.locator('#todo-button-visible').check();
    await waitForAsync(worker, async () => (await chrome.storage.local.get('todoButtonVisible')).todoButtonVisible === true); await closeSettings();
    await switchTo(workScene); await page.reload(); await ready(page); await viewIs(page, workScene);
    await assertRenderedGradient(page, SECOND_GRADIENT);
    assert.deepEqual(await page.evaluate(() => { const data = OpenTabLayout.get(); return [data.layoutIconSize, data.layoutColumns, data.layoutShowNames, data.layoutMaxWidth]; }), [80, 4, false, 640]);
    assert.equal((await stored('sceneProfiles')).sceneProfiles.find(item => item.id === DEFAULT_SCENE).bingIndex, 3);
  });

  await phase('late real worker Bing response cannot repaint or save another scene', async () => {
    const before = (await stored('sceneProfiles')).sceneProfiles;
    let resolve;
    archiveGate = { promise: new Promise(done => { resolve = done; }), resolve: () => resolve() };
    delayedArchive = null;
    // Observe completion without synthesizing or replacing the message result.
    // The real worker fetches the delayed route, fills CacheStorage and invokes
    // the original page callback. The page's real scene guard must reject it.
    await page.evaluate(() => {
      window.__scenesOriginalSendMessage = chrome.runtime.sendMessage;
      window.__scenesBingCallbackReceived = false;
      chrome.runtime.sendMessage = function (request, callback) {
        return window.__scenesOriginalSendMessage.call(chrome.runtime, request, response => {
          callback(response);
          if (request.action === 'fetchBingImage') queueMicrotask(() => { window.__scenesBingCallbackReceived = true; window.__scenesBingSuccess = response?.success; });
        });
      };
    });
    const requested = context.waitForEvent('request', { predicate: request => request.url().includes('/HPImageArchive.aspx') });
    await click(page, '#refresh-bg-btn'); await requested;
    await switchTo(DEFAULT_SCENE);
    const expected = before.find(item => item.id === DEFAULT_SCENE).background.value;
    await assertRenderedGradient(page, expected);
    assert.ok(delayedArchive, 'real background service-worker request reached the offline delayed route');
    archiveGate.resolve(); await page.waitForFunction(() => window.__scenesBingCallbackReceived);
    assert.equal(await page.evaluate(() => window.__scenesBingSuccess), true, 'worker returned a successful old-scene response, not a simulated failure');
    await page.evaluate(() => { chrome.runtime.sendMessage = window.__scenesOriginalSendMessage; delete window.__scenesOriginalSendMessage; });
    archiveGate = null;
    assert.deepEqual((await stored('sceneProfiles')).sceneProfiles, before, 'late completion cannot change either scene profile or Bing index');
    await assertRenderedGradient(page, expected);
    assert.equal(await page.locator('#background-layer .bg-fade-in').count(), 0, 'no retired scene overlay survives');
    await switchTo(workScene); await assertRenderedGradient(page, SECOND_GRADIENT);
  });

  await phase('native paste import and popup append only to the selected scene', async () => {
    await selectGroup('research'); await settings('sync');
    await page.locator('#site-list-input').scrollIntoViewIfNeeded();
    const choices = await page.locator('#site-list-group option').evaluateAll(nodes => nodes.map(node => node.value));
    assert.ok(choices.includes('research')); assert.ok(!choices.includes('folder-home'));
    const before = await graph();
    await page.locator('#site-list-input').focus(); await page.keyboard.insertText('https://paste.scene.example.com/path');
    await page.keyboard.press('Control+A'); await page.keyboard.press('Control+C'); await page.keyboard.press('Backspace'); await page.keyboard.press('Control+V');
    await page.locator('#site-list-group').selectOption('research'); await click(page, '#site-list-preview-btn');
    await page.waitForSelector('#site-list-form[aria-busy="false"]'); await page.waitForFunction(() => !document.querySelector('#site-list-confirm').disabled);
    assert.deepEqual(await graph(), before, 'preview never writes');
    await reloadAfter(page, () => click(page, '#site-list-confirm'));
    const pasted = await graph(), record = pasted.icons.find(item => item.url === 'https://paste.scene.example.com/path');
    assert.equal(record.folderId, 'research');
    assert.deepEqual(pasted.icons.filter(item => item.id !== record.id), before.icons);
    assert.deepEqual(pasted.folders, before.folders); assert.deepEqual(pasted.todos, before.todos);
    await viewIs(page, workScene, 'research');
    const popup = await context.newPage();
    await popup.addInitScript(() => { chrome.tabs.query = async () => [{ id: 4242, title: 'Synthetic popup source', url: 'https://popup.scene.example.com/source' }]; });
    await popup.goto(`${base}/popup.html`); await popup.waitForFunction(() => !document.querySelector('#save-btn').disabled);
    const option = await popup.locator('#folder-select option[value="folder-home"]').textContent();
    assert.match(option, /Default|默认/);
    await popup.locator('#site-name').fill('Saved to the other scene'); await popup.locator('#folder-select').selectOption('folder-home');
    await click(popup, '#save-btn');
    await waitForAsync(worker, async () => (await chrome.storage.local.get('icons')).icons.some(item => item.name === 'Saved to the other scene'));
    const saved = await graph(), added = saved.icons.find(item => item.name === 'Saved to the other scene');
    assert.equal(added.folderId, 'folder-home'); assert.equal(added.url, 'https://popup.scene.example.com/source');
    assert.deepEqual(saved.icons.filter(item => item.id !== added.id), pasted.icons, 'popup append retains the complete other-scene array');
    for (const key of ['folders', 'scenes', 'sceneProfiles', 'todos']) assert.deepEqual(saved[key], pasted[key]);
    if (!popup.isClosed()) await popup.close();
  });

  await phase('native dialog keyboard and eight verified locale/theme screenshots', async () => {
    for (const language of ['en', 'zh-CN']) {
      if (language !== 'en') {
        await settings('appearance');
        await reloadAfter(page, () => page.locator('#language-preference').selectOption(language), { language });
      }
      for (const theme of ['light', 'dark']) {
        await settings('appearance'); await click(page, `.theme-mode-tab[data-theme="${theme}"]`);
        await waitForAsync(worker, async expected => (await chrome.storage.local.get('themeMode')).themeMode === expected, theme);
        await page.waitForFunction(theme => document.body.classList.contains('theme-light') === (theme === 'light'), theme); await closeSettings();
        await page.setViewportSize({ width: 1280, height: 900 }); await open();
        assert.equal(await page.evaluate(() => document.activeElement.dataset.sceneAction), 'close');
        for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < 12; i++) {
          await page.keyboard.press(key); assert.equal(await page.evaluate(() => !!document.activeElement.closest('.scene-dialog[open]')), true);
        }
        assert.equal(await page.locator(`${dialog} .scene-title`).textContent(), language === 'en' ? 'Scenes' : '场景空间');
        assert.equal(await page.locator(`${dialog} .scene-row-current`).getAttribute('data-scene-id'), workScene);
        for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['narrow', { width: 360, height: 800 }]]) {
          await page.setViewportSize(viewport);
          const bounds = await page.locator(dialog).evaluate(node => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: innerWidth, height: innerHeight }; });
          assert.ok(bounds.left >= 15 && bounds.right <= bounds.width - 15 && bounds.top >= 0 && bounds.bottom <= bounds.height, 'scene manager fits the viewport');
          assert.equal(await page.locator(`${dialog} .scene-body`).evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'scene labels and actions do not overflow horizontally');
          const target = page.locator(rowAction(workScene, 'rename')); await target.scrollIntoViewIfNeeded();
          assert.equal(await target.evaluate(node => { const b = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }), true);
          await page.screenshot({ path: path.join(artifacts, `scenes-${language}-${theme}-${label}.png`), animations: 'disabled' });
        }
        await close(); assert.equal(await page.evaluate(() => document.activeElement.matches('#scene-switcher .scene-trigger')), true);
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await settings('appearance');
    const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
    await page.locator('#language-preference').selectOption('en'); await navigation; await ready(page);
  });

  await phase('an old-device v1 sync event cannot replace the v2 workspace', async () => {
    // Fresh unsigned-in Chromium has an isolated sync storage area. Seed only
    // the enabled preference, then deliver a synthetic other-device change to
    // the actual storage event listener. Do not invoke any apply method.
    await seed({ browserSyncEnabled: true }); await page.reload(); await ready(page);
    await page.waitForFunction(() => document.querySelector('#browser-sync-enabled').checked);
    const before = await graph();
    await worker.evaluate(() => chrome.storage.sync.set({
      'ot.s.meta': { v: 1, n: 1, updatedAt: 1, hash: 'synthetic-old-device', deviceId: 'synthetic-legacy-device', bytes: 2 },
      'ot.s.c0': '{}'
    }));
    await page.waitForFunction(() => document.querySelector('#import-sync-status').textContent.includes('Ignored an older device'));
    assert.deepEqual(await graph(), before, 'old namespace notification is ignored before it can replace the scene graph');
    await settings('sync'); await page.locator('#browser-sync-enabled').uncheck();
    await waitForAsync(worker, async () => (await chrome.storage.local.get('browserSyncEnabled')).browserSyncEnabled === false);
    await closeSettings();
  });

  await phase('full v2 backup and safe legacy restore preserve recovery data', async () => {
    await settings('sync'); const before = await graph();
    const downloading = page.waitForEvent('download'); await click(page, '#backup-download-btn'); const download = await downloading;
    const output = path.join(artifacts, 'scenes-v2-backup.json'); await download.saveAs(output); exported = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(exported.version, 2); for (const key of graphKeys) assert.deepEqual(exported[key], before[key], `backup includes full ${key}`);
    assert.equal(Object.hasOwn(exported, 'searchHistory'), false);
    const legacy = legacyFixture(); legacy.icons = [{ id: 'legacy-restored', name: 'Legacy restored', type: 'shortcut', url: 'https://restore.example.com/', folderId: 'folder-home', uploadedIconDataUrl: `data:image/png;base64,${PIXEL}` }];
    legacy.folders = [{ id: 'folder-home', name: 'Home' }]; legacy.todos = [];
    await reloadAfter(page, () => page.locator('#backup-import-file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, ...legacy })) }));
    const restored = await stored(); Schema.validate(restored);
    assert.equal(restored[SCHEMA_KEY], 2); assert.deepEqual(restored.icons.map(item => item.id), ['legacy-restored']);
    assert.equal(restored.scenes.length, 1); assert.equal(restored.icons[0].uploadedIconDataUrl, legacy.icons[0].uploadedIconDataUrl);
    const snapshots = restored.backupSnapshots;
    assert.ok(Array.isArray(snapshots) && snapshots[0].completeness === 'full');
    for (const key of graphKeys) assert.deepEqual(snapshots[0].data[key], before[key], `legacy replacement has full pre-restore ${key}`);
    await settings('sync');
    await reloadAfter(page, () => page.locator('#backup-import-file').setInputFiles({ name: 'scenes-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) }));
    Schema.validate(await stored()); for (const key of graphKeys) assert.deepEqual((await graph())[key], before[key], `v2 restore retains complete ${key}`);
  });

  await phase('unknown schema is readable and fail-closed without repair', async () => {
    await second.close();
    const original = await stored();
    // Deliberate other-version/corruption fixture. The production transaction
    // writer correctly refuses this value, so install it with raw storage only
    // inside the same lock; this is never used to simulate a successful UI save.
    await worker.evaluate(key => OpenTabWorkspace.transaction(() => chrome.storage.local.set({ [key]: 999 })), SCHEMA_KEY);
    const unsupported = await stored(); assert.equal(unsupported[SCHEMA_KEY], 999);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#scene-recovery[open]');
    assert.equal(await page.evaluate(() => document.getElementById('homepage').inert), true);
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('#scene-recovery[open]')), true);
    assert.match(await page.locator('#scene-recovery .scene-status-error').textContent(), /data|recover|version|数据|恢复|版本/i);
    assert.deepEqual(await stored(), unsupported, 'unknown version load does not normalize, migrate, drop or overwrite data');
    assert.equal(await page.evaluate(() => globalThis.OpenTabSceneNavigation?.getView() || null), null);
    await click(page, '#scene-recovery [data-scene-action="retry"]');
    assert.deepEqual(await stored(), unsupported, 'Retry cannot treat unknown data as legacy');
    await worker.evaluate(({ key, version }) => OpenTabWorkspace.transaction(() => chrome.storage.local.set({ [key]: version })), { key: SCHEMA_KEY, version: original[SCHEMA_KEY] }); await page.reload(); await ready(page);
    Schema.validate(await stored());
    for (const key of graphKeys) assert.deepEqual((await graph())[key], original[key], `reopening supported version preserves ${key}`);
  });
  await phase('native icon changer draft blocks keyboard and API navigation', async () => {
    await switchTo(DEFAULT_SCENE); await selectGroup('folder-home');
    await click(page, '#icons-container .icon-widget[data-id="daily-docs"]', { button: 'right' });
    await page.waitForSelector('#icon-context-menu:not(.hidden)'); await click(page, '#change-icon-btn');
    await page.waitForSelector('#change-icon-modal:not(.hidden)'); await page.locator('#change-icon-letter').fill('Q');
    const before = await graph(), view = await currentView(page);
    await page.keyboard.press('Control+k');
    assert.equal(await page.locator('#command-palette').isVisible(), false, 'native shortcut cannot open cross-scene navigation behind the changer');
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('#change-icon-modal')), true);
    }
    // API navigation negative, not mouse navigation proof: this is the same
    // public route used by Cmd+K. Do not click through the blocking modal.
    const result = await page.evaluate(async () => {
      try { return { returned: await OpenTabSceneNavigation.selectGroup('research') }; }
      catch (error) { return { code: error.code }; }
    });
    assert.deepEqual(result, { code: 'SCENE_DIRTY_DRAFT' });
    assert.deepEqual(await currentView(page), view); assert.deepEqual(await graph(), before);
    assert.equal(await page.inputValue('#change-icon-letter'), 'Q');
    assert.equal(await page.locator('#change-icon-modal').isVisible(), true);
    await click(page, '#change-icon-close'); await page.waitForSelector('#change-icon-modal.hidden', { state: 'attached' });
    assert.deepEqual(await graph(), before, 'closing an unapplied changer draft does not persist it');
    await switchTo(workScene); await selectGroup('research');
  });

  await phase('another tab enabling scenes preserves a legacy rename until explicit discard', async () => {
    // A second fresh persistent profile has genuinely legacy storage. Never
    // remove v2 keys or rewind a live page to manufacture this transition.
    legacyContext = await launchIsolated();
    const legacyWorker = legacyContext.serviceWorkers()[0] || await legacyContext.waitForEvent('serviceworker');
    const legacyHome = `chrome-extension://${legacyWorker.url().split('/')[2]}/home.html`;
    const local = keys => legacyWorker.evaluate(keys => chrome.storage.local.get(keys), keys ?? null);
    await seed(legacyFixture(), legacyWorker);
    const editing = await legacyContext.newPage(), enabling = await legacyContext.newPage();
    await editing.goto(legacyHome); await ready(editing, { scenes: false });
    await enabling.goto(legacyHome); await ready(enabling, { scenes: false });
    await click(editing, '#group-tabs [data-group-id="research"]');
    await waitForAsync(legacyWorker, async () => (await chrome.storage.local.get('currentFolderId')).currentFolderId === 'research');
    await editing.waitForSelector('#group-tabs [data-group-id="research"][aria-selected="true"]');
    await editing.locator('#group-tabs [data-group-id="research"]').dblclick();
    await editing.locator('.group-rename-input').fill('Keep this unsaved rename');
    assert.equal((await local('folders')).folders.find(item => item.id === 'research').name, 'Research');
    assert.equal(Object.hasOwn(await local(), SCHEMA_KEY), false);
    await click(enabling, '#scene-switcher [data-scene-action="open"]');
    await click(enabling, '.scene-introduction [data-scene-action="enable"]');
    await enabling.waitForSelector(dialog); await viewIs(enabling, DEFAULT_SCENE);
    await editing.waitForSelector('#scene-recovery[open] [data-scene-action="discard-draft"]');
    const migrated = await local(); Schema.validate(migrated);
    const originalGraph = Object.fromEntries(graphKeys.map(key => [key, migrated[key]]));
    assert.equal(migrated.folders.find(item => item.id === 'research').name, 'Research', 'recovery focus does not blur-submit the captured rename');
    assert.equal(await editing.inputValue('.group-rename-input'), 'Keep this unsaved rename');
    assert.equal(await editing.evaluate(() => document.getElementById('homepage').inert), true);
    assert.equal(await editing.evaluate(() => !!document.activeElement.closest('#scene-recovery[open]')), true);
    assert.equal(await currentView(editing), null, 'the dirty legacy tab has not adopted v2 underneath its draft');
    for (const key of ['Tab', 'Shift+Tab', 'Escape']) {
      await editing.keyboard.press(key);
      assert.equal(await editing.locator('#scene-recovery[open]').count(), 1);
      assert.equal(await editing.evaluate(() => !!document.activeElement.closest('#scene-recovery[open]')), true);
      assert.equal(await editing.inputValue('.group-rename-input'), 'Keep this unsaved rename');
    }
    // Observe a real status update to distinguish completed Retry from the
    // already-open recovery dialog. This observer does not drive application state.
    await editing.evaluate(() => {
      window.__scenesRetryReported = false;
      const observer = new MutationObserver(() => { window.__scenesRetryReported = true; observer.disconnect(); });
      observer.observe(document.querySelector('#scene-recovery .scene-status'), { childList: true, characterData: true, subtree: true });
    });
    await click(editing, '#scene-recovery [data-scene-action="retry"]');
    await editing.waitForFunction(() => window.__scenesRetryReported);
    assert.equal(await currentView(editing), null); assert.equal(await editing.inputValue('.group-rename-input'), 'Keep this unsaved rename');
    assert.deepEqual(await local(graphKeys), originalGraph, 'Retry preserves the migrated graph and the unsaved legacy draft');
    await click(editing, '#scene-recovery [data-scene-action="discard-draft"]');
    await editing.waitForSelector('#scene-recovery', { state: 'detached' }); await ready(editing); await viewIs(editing, DEFAULT_SCENE, 'research');
    assert.equal(await editing.locator('.group-rename-input').count(), 0);
    assert.equal(await editing.evaluate(() => document.getElementById('homepage').inert), false);
    assert.deepEqual(await local(graphKeys), originalGraph, 'only the explicit discard cancels the input; it never commits the unsaved name');
    await open(editing); await close(editing);
    await legacyContext.close(); legacyContext = null;
  });
  console.log(`Scenes: all native MV3 phases passed; ${network.length} HTTP requests fulfilled with offline fixtures; 8 screenshots saved.`);
} finally {
  archiveGate?.resolve();
  await legacyContext?.close();
  await context.close();
}
