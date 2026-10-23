import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PIXEL } from './scenes-fixtures.mjs';
import { assertGroupShortcuts } from './group-shortcuts.mjs';

// Real MV3 navigation/storage/DOM and real Web Animations. The observable wrapper
// records effects; pausing is used only to make interruption tests deterministic.
const require = createRequire(import.meta.url), Schema = require('../scene-schema.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const site = (id, folderId, parentId = '') => ({ id, name: id, folderId, parentId, type: 'shortcut', url: `https://${id}.example.test/`, uploadedIconDataUrl: `data:image/png;base64,${PIXEL}`, iconSource: 'upload' });
const data = Schema.migrateLegacy({
  folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }, { id: 'empty', name: 'Empty' }],
  icons: [site('home-site', 'folder-home'), site('work-site', 'work'),
    { id: 'work-folder', name: 'Folder', type: 'folder', folderId: 'work', parentId: '' },
    site('work-child-one', 'work', 'work-folder'), site('work-child-two', 'work', 'work-folder')],
  todos: [], currentFolderId: 'folder-home', background: { type: 'gradient', source: 'gradient', value: 'linear-gradient(135deg, #dce8f8, #f8fafc)' },
  weatherEnabled: false, particlesEnabled: false, gradientFlow: false, minimalMode: false, themeMode: 'light', languagePreference: 'en',
  searchHistoryEnabled: false, searchSuggestionsEnabled: false, browserSyncEnabled: false, todoPanelOpen: false
});
const context = await chromium.launchPersistentContext('', {
  headless: process.env.HEADLESS === 'true', reducedMotion: 'no-preference', locale: 'en-US', viewport: { width: 1280, height: 900 },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
let page;
try {
  const errors = [];
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => /^https?:/.test(route.request().url())
    ? route.fulfill({ status: 200, contentType: route.request().resourceType() === 'image' ? 'image/png' : 'application/json', body: route.request().resourceType() === 'image' ? Buffer.from(PIXEL, 'base64') : '{}', headers: { 'access-control-allow-origin': '*' } })
    : route.continue());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const home = `chrome-extension://${worker.url().split('/')[2]}/home.html`;
  // A persistent Chromium context closes when its last tab closes. Keep the
  // blank test tab alive while removing startup pages and seeding the workspace.
  page = await context.newPage();
  for (const item of context.pages()) if (item !== page) await item.close();
  const seeded = await worker.evaluate(data => OpenTabWorkspace.transaction(async ({ write, read }) => { await write(data); return read(Object.keys(data)); }), data);
  assert.deepEqual(seeded, data, 'seed under the installer/workspace lock');
  await page.addInitScript(() => {
    // The animation's existing Alt navigation assertion is the non-Mac DOM
    // contract. The helper below separately covers Mac/fallback platform data;
    // neither emulation claims actual macOS OS/browser shortcut dispatch.
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: 'Linux' } });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
    sessionStorage.setItem('opentab.scene.view', JSON.stringify({ sceneId: 'scene-default', lastGroupIds: { 'scene-default': 'folder-home' } }));
    window.__groupPops = []; window.__holdGroupPops = false;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (options?.id === 'opentab-group-pop') {
        window.__groupPops.push({ animation, node: this, frames: structuredClone(frames), options: structuredClone(options), connected: this.isConnected });
        if (window.__holdGroupPops) animation.pause();
      }
      return animation;
    };
  });
  await page.goto(home);
  await page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length
    && OpenTabSceneNavigation.getView()?.currentFolderId === 'folder-home'
    && document.documentElement.lang === 'en' && !document.getElementById('homepage').inert);
  await page.waitForLoadState('networkidle');
  const graph = () => worker.evaluate(() => chrome.storage.local.get(['icons', 'folders', 'scenes', 'sceneProfiles']));
  const before = await graph();
  assert.equal(await page.evaluate(() => __groupPops.length), 0, 'initial and startup refreshes never animate');
  await page.locator('#group-tabs [data-group-id="work"]').click();
  await page.waitForFunction(() => OpenTabSceneNavigation.getView()?.currentFolderId === 'work' && !document.getElementById('homepage').inert);
  const first = await page.evaluate(() => ({
    records: __groupPops.map(({ node, options, frames, connected }) => ({ id: node.dataset.id, options, frames, connected, pointer: getComputedStyle(node).pointerEvents, inert: node.inert })),
    mounted: [...document.querySelectorAll('#icons-container .icon-widget[data-id]')].map(node => node.dataset.id),
    hiddenByLegacy: document.querySelectorAll('#icons-container .entering, #icons-container .leaving').length
  }));
  assert.deepEqual(first.mounted, ['work-site', 'work-folder']); assert.equal(first.hiddenByLegacy, 0);
  assert.deepEqual(first.records.map(record => record.id), first.mounted);
  for (const record of first.records) {
    assert.equal(record.options.duration, 160); assert.equal(record.options.delay ?? 0, 0);
    assert.equal(record.options.fill, 'none'); assert.equal(record.connected, true); assert.equal(record.inert, false); assert.notEqual(record.pointer, 'none');
    assert.deepEqual(record.frames, [{ opacity: 0.25, scale: '0.96', translate: '0 4px' }, { opacity: 1, scale: '1', translate: '0 0' }]);
  }
  await page.waitForFunction(() => __groupPops.every(({ animation }) => ['finished', 'idle'].includes(animation.playState)));
  assert.equal(await page.locator('#icons-container').evaluate(grid => [...grid.querySelectorAll('[data-id]')].every(node => getComputedStyle(node).opacity === '1' && node.style.transitionDelay === '' && node.style.scale === '' && node.style.translate === '')), true, 'effects leave no retained styles');
  await page.screenshot({ path: path.join(artifacts, 'group-icon-motion-work.png'), animations: 'disabled' });

  const rapid = await page.evaluate(async () => {
    __holdGroupPops = true;
    await OpenTabFolders.selectGroup('folder-home', true);
    const old = __groupPops.at(-1);
    const next = OpenTabFolders.selectGroup('work', true);
    const canceledBeforeNavigationSettles = old.animation.playState === 'idle';
    await next;
    const current = __groupPops.slice(-2);
    document.querySelector('#icons-container [data-id="work-folder"]').click();
    const folderOpenedDuringPop = OpenTabFolders.currentOpenParentId() === 'work-folder';
    const input = document.getElementById('search-input'); input.focus();
    const inputFocusedDuringPop = document.activeElement === input;
    return { canceledBeforeNavigationSettles, folderOpenedDuringPop, inputFocusedDuringPop, active: current.every(({ animation }) => animation.playState === 'paused'), inert: document.getElementById('homepage').inert };
  });
  assert.deepEqual(rapid, { canceledBeforeNavigationSettles: true, folderOpenedDuringPop: true, inputFocusedDuringPop: true, active: true, inert: false });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => __groupPops.every(({ animation }) => ['idle', 'finished'].includes(animation.playState)));
  const count = await page.evaluate(() => __groupPops.length);
  await page.evaluate(async () => {
    await OpenTabFolders.selectGroup('folder-home', true);
    await OpenTabFolders.selectGroup('work', true);
  });
  assert.equal(await page.evaluate(() => __groupPops.length), count, 'reduced motion mounts immediately without new effects');
  assert.equal(await page.evaluate(() => OpenTabFolders.currentOpenParentId()), '', 'switch retains existing overlay close behavior');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { __holdGroupPops = false; });
  await page.locator('#group-tabs [data-group-id="work"]').click();
  await page.evaluate(() => OpenTabFolders.renderChrome());
  assert.equal(await page.evaluate(() => __groupPops.length), count, 'same-group clicks and unrelated chrome renders do not replay');
  await page.locator('#group-tabs [data-group-id="empty"]').click();
  await page.waitForFunction(() => OpenTabSceneNavigation.getView()?.currentFolderId === 'empty' && !document.getElementById('homepage').inert);
  assert.equal(await page.locator('#icons-container .icon-widget[data-id]').count(), 0);
  assert.equal(await page.locator('#add-shortcut-tile').isVisible(), true);
  assert.equal(await page.evaluate(() => __groupPops.length), count, 'empty group does not animate the add tile');
  await page.locator('#group-tabs [data-group-id="empty"]').focus(); await page.keyboard.press('Alt+1');
  await page.waitForFunction(() => OpenTabSceneNavigation.getView()?.currentFolderId === 'folder-home' && !document.getElementById('homepage').inert);
  assert.equal(await page.evaluate(() => __groupPops.length), count + 1, 'native Alt+number uses the same bounded effect');
  await assertGroupShortcuts(page);
  assert.deepEqual(await graph(), before, 'navigation preserves full graph records, IDs, order, hierarchy and scene ownership');
  assert.deepEqual(errors, []);
  console.log('Native MV3 group icon motion passed: 160ms unstaggered pop, native tab/Alt navigation, immediate folder/search input, rapid and reduced-motion cancellation, empty groups and graph preservation.');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'group-icon-motion-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await context.close(); }
