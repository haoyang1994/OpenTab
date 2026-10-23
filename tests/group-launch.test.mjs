import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';
import { formatConsoleError } from './console-allow.mjs';
import { PIXEL } from './scenes-fixtures.mjs';

// The real unpacked MV3 extension, its native dialog and actual Chrome tabs.
// Only tab creation gets an observable wrapper and explicit failure/pending
// fixtures. No launch planner, storage, lock, scene or UI implementation is mocked.
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const A = 'scene-default', B = 'scene-work', HOME = 'folder-home';
const alpha = 'https://launch-a.example.test/docs?mode=one#top';
const query = 'https://launch-a.example.test/docs?mode=two#top';
const fragment = 'https://launch-a.example.test/docs?mode=one#bottom';
const nested = 'https://launch-folder.example.test/inside';
const peer = 'https://launch-peer.example.test/inside';
const literal = 'https://launch-literal.example.test/';
const plainHttp = 'http://launch-http.example.test/start';
const expectedUrls = [alpha, query, fragment, nested, peer, literal, plainHttp];
const literalName = '<img src=x onerror=alert(1)> Literal reference ' + 'Long title '.repeat(9);
const site = (id, name, url, folderId = HOME, parentId = '') => ({
  id, name, url, folderId, parentId, type: 'shortcut',
  uploadedIconDataUrl: `data:image/png;base64,${PIXEL}`, iconSource: 'upload'
});
function fixture(extra = {}) {
  const legacy = {
    folders: [{ id: HOME, name: 'Home' }, { id: 'other-group', name: 'Other group' },
      { id: 'child-group', name: 'Child group', parentId: HOME }, { id: 'empty-group', name: 'Empty group' }],
    icons: [site('alpha', 'Alpha documents', alpha),
      site('duplicate', 'Duplicate must not appear', 'https://LAUNCH-A.example.test:443/docs?mode=one#top'),
      site('query', 'Query variant', query), site('fragment', 'Fragment variant', fragment),
      { id: 'reference-folder', name: 'Reference folder', type: 'folder', folderId: HOME, parentId: '' },
      site('nested', 'Inside folder', nested, HOME, 'reference-folder'),
      site('peer', 'Folder companion', peer, HOME, 'reference-folder'),
      site('literal', literalName, literal), site('plain-http', 'Plain HTTP', plainHttp),
      site('other', 'Other group only', 'https://other-group.example.test/', 'other-group'),
      site('child', 'Child group excluded', 'https://child-group.example.test/', 'child-group'),
      site('credential', 'Credentials excluded', 'https://synthetic:never-transmit@credential.example.test/'),
      ...['javascript:alert(1)', 'data:text/html,unsafe', 'chrome://settings', 'file:///tmp/unsafe', 'ftp://unsafe.example.test/file'].map((url, index) => site(`unsafe-${index}`, `Unsafe ${index}`, url)),
      { id: 'ssh', name: 'SSH excluded', type: 'ssh', url: 'https://ssh.example.test/', folderId: HOME, parentId: '' },
      { id: 'tool', name: 'Tool excluded', type: 'tool', toolId: 'json', url: 'https://tool.example.test/', folderId: HOME, parentId: '' }],
    todos: [{ id: 'retained-task', text: 'Synthetic retained task', done: false }], currentFolderId: HOME,
    background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f, #537895)', source: 'gradient' },
    weatherEnabled: false, particlesEnabled: false, gradientFlow: false, minimalMode: false, themeMode: 'light', languagePreference: 'en',
    searchHistory: ['unchanged synthetic history'], searchHistoryEnabled: false, searchSuggestionsEnabled: false,
    searchEngine: 'google', searchOpenInNewTab: false, openInNewTab: false, developerToolsEnabled: false,
    browserSyncEnabled: false, todoPanelOpen: false
  };
  const data = Schema.create(Schema.migrateLegacy(legacy), { id: B, name: 'Work scene', iconKey: 'briefcase', homeGroupId: 'work-home', homeName: 'Work home' });
  data.icons.push(site('different-scene', 'Other scene only', 'https://other-scene.example.test/', 'work-home'));
  // The device preference is intentionally not the current tab's scene.
  data.lastOpenedSceneId = B;
  Object.assign(data, extra);
  Schema.validate(data);
  return data;
}
const context = await chromium.launchPersistentContext('', {
  headless: process.env.HEADLESS === 'true', locale: 'en-US', reducedMotion: 'reduce', viewport: { width: 1280, height: 900 },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
const errors = [], network = [];
let phaseName = 'setup';
function recordErrors(p) {
  p.on('pageerror', error => errors.push(`[${phaseName}] ${error.message}`));
  p.on('console', message => { if (message.type() === 'error') errors.push(`[${phaseName}] ${formatConsoleError(message)}`); });
}
context.on('page', recordErrors);
context.pages().forEach(recordErrors);
context.on('console', message => {
  if (!message.page() && message.type() === 'error') errors.push(`[${phaseName}] worker: ${formatConsoleError(message)}`);
});
// All fixture HTTP requests, including launched tabs and favicons, are fulfilled
// locally. Nothing in this suite sends synthetic names or URLs to a server.
await context.route('**/*', route => {
  const request = route.request(), url = request.url();
  if (!/^https?:/.test(url)) return route.continue();
  network.push({ url, type: request.resourceType() });
  const headers = { 'access-control-allow-origin': '*' };
  if (request.resourceType() === 'image' || /favicon|touch-icon/.test(url)) return route.fulfill({ status: 200, contentType: 'image/png', headers, body: Buffer.from(PIXEL, 'base64') });
  if (request.resourceType() === 'document') return route.fulfill({ status: 200, contentType: 'text/html', headers, body: '<!doctype html><title>Offline launch fixture</title><p>Local fixture only.</p>' });
  return route.fulfill({ status: 200, contentType: 'application/json', headers, body: '{}' });
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const home = `chrome-extension://${worker.url().split('/')[2]}/home.html`;
const page = await context.newPage();
await page.addInitScript(({ sceneId, groupId }) => {
  if (location.protocol === 'chrome-extension:') sessionStorage.setItem('opentab.scene.view', JSON.stringify({ sceneId, lastGroupIds: { [sceneId]: groupId } }));
}, { sceneId: A, groupId: HOME });
const dialog = '#group-launch-dialog';
const boxes = () => page.locator('#group-launch-list input[type="checkbox"]');
const box = url => page.locator(`#group-launch-list input[type="checkbox"][value=${JSON.stringify(url)}]`);
const stored = () => worker.evaluate(() => chrome.storage.local.get(null));
const calls = () => page.evaluate(() => window.__groupLaunchCalls);
const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
async function reset(extra = {}) {
  await page.goto('about:blank');
  for (const p of context.pages()) if (p !== page) await p.close();
  const data = fixture(extra);
  const persisted = await worker.evaluate(data => OpenTabWorkspace.transaction(async ({ write, read }) => { await write(data); return read(Object.keys(data)); }), data);
  assert.deepEqual(persisted, data, 'fixture is durably seeded under the actual installer/workspace lock');
  await page.goto(home);
  await page.waitForFunction(({ sceneId, groupId, language, light }) => {
    const view = globalThis.OpenTabSceneNavigation?.getView();
    return performance.getEntriesByName('opentab:grid-ready').length > 0 && globalThis.OpenTabGroupLaunch?.isActive
      && view?.sceneId === sceneId && view.currentFolderId === groupId
      && globalThis.OpenTabI18n?.locale === language && document.documentElement.lang === language
      && document.body.classList.contains('theme-light') === light;
  }, { sceneId: A, groupId: HOME, language: data.languagePreference, light: data.themeMode === 'light' });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const original = chrome.tabs.create.bind(chrome.tabs);
    window.__groupLaunchCalls = [];
    window.__groupLaunchFailureUrls = [];
    window.__groupLaunchGate = null;
    chrome.tabs.create = async options => {
      const call = { options: structuredClone(options), result: 'pending' };
      window.__groupLaunchCalls.push(call);
      if (window.__groupLaunchGate) await window.__groupLaunchGate;
      if (window.__groupLaunchFailureUrls.includes(options.url)) { call.result = 'failed'; throw new Error('Synthetic definite tab creation failure'); }
      const tab = await original(options);
      call.result = 'opened'; call.tabId = tab.id; call.active = tab.active;
      return tab;
    };
  });
  return data;
}
async function open(key) {
  await page.locator('#group-launch-entry').focus();
  if (key) await page.keyboard.press(key); else await page.click('#group-launch-entry');
  await page.waitForSelector(`${dialog}[open]`);
  assert.equal(await page.locator(dialog).evaluate(el => el instanceof HTMLDialogElement && el.matches(':modal')), true, 'launch preview is a native modal dialog');
  assert.equal(await page.locator(dialog).evaluate(el => el.contains(document.activeElement)), true, 'opening moves focus into the modal');
}
async function close(key = 'Escape') {
  if (key === 'Escape') await page.keyboard.press(key); else await page.click('#group-launch-cancel');
  await page.waitForFunction(() => !document.querySelector('#group-launch-dialog')?.open && !OpenTabGroupLaunch.isActive());
  assert.equal(await focused(), 'group-launch-entry', 'closing restores focus to the launch entry');
}
async function select(urls) {
  await page.click('#group-launch-clear');
  for (const url of urls) await box(url).check();
  assert.deepEqual((await boxes().evaluateAll(nodes => nodes.filter(node => node.checked).map(node => node.value))).sort(), [...urls].sort());
}
async function finished() {
  await page.waitForFunction(() => !OpenTabGroupLaunch.isPending() && document.querySelector('#group-launch-status')?.textContent.trim().length > 0);
}
async function assertNoLaunch(before, note) {
  assert.deepEqual(await calls(), [], note);
  assert.equal(page.url(), home, 'the current tab never navigates');
  assert.equal(context.pages().length, 1, 'preview never opens another browser page through any navigation adapter');
  assert.deepEqual(await stored(), before, 'preview, selection and cancellation never mutate workspace/history/preferences');
}
async function assertBounds() {
  const bounds = await page.locator(dialog).evaluate(el => {
    const b = el.getBoundingClientRect(), css = getComputedStyle(el);
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: innerWidth, height: innerHeight, background: css.backgroundColor, opacity: css.opacity, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  assert.ok(bounds.left >= 12 && bounds.right <= bounds.width - 12 && bounds.top >= 12 && bounds.bottom <= bounds.height - 12, JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.left - (bounds.width - bounds.right)) <= 1, 'dialog is horizontally centered');
  assert.equal(bounds.opacity, '1'); assert.match(bounds.background, /^rgb\(/, 'dialog surface is opaque');
  assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, 'long literal names and exact URLs do not cause horizontal overflow');
}
async function phase(name, run) {
  phaseName = name; console.log(`Group launch: START ${name}`);
  await run(); assert.deepEqual(errors, [], `${name}: no console or page errors`);
  console.log(`Group launch: PASS ${name}`);
}
try {
  await phase('safe unique current-group preview is read-only', async () => {
    await reset(); const before = await stored(), requestCount = network.length;
    await open('Enter');
    assert.deepEqual((await boxes().evaluateAll(nodes => nodes.map(node => node.value))).sort(), [...expectedUrls].sort(), 'root and folder children are included; other groups, scenes, unsafe types/URLs and duplicate normalized URLs are excluded');
    assert.equal(await boxes().count(), 7);
    assert.equal(await boxes().evaluateAll(nodes => nodes.every(node => node.checked)), true);
    assert.match(await page.textContent('#group-launch-count'), /7/);
    assert.equal(await page.locator('#group-launch-list img, #group-launch-list iframe, #group-launch-list script').count(), 0, 'user labels are text, never interpreted markup or fetched previews');
    assert.ok((await page.textContent('#group-launch-list')).includes(literalName));
    assert.ok((await page.textContent('#group-launch-list')).includes('launch-folder.example.test'));
    assert.ok((await page.textContent('#group-launch-list')).includes(alpha), 'exact URL disambiguates same-domain query/fragment variants');
    for (const url of expectedUrls) assert.ok(await box(url).evaluate(el => [...el.labels].some(label => label.textContent.trim().length > 0)), 'every native checkbox has a visible accessible label');
    await box(alpha).focus(); await page.keyboard.press('Space'); assert.equal(await box(alpha).isChecked(), false);
    await page.keyboard.press('Enter'); assert.deepEqual(await calls(), [], 'Enter on a checkbox is not an implicit launch');
    await page.click('#group-launch-clear'); assert.equal(await boxes().evaluateAll(nodes => nodes.every(node => !node.checked)), true);
    assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
    await page.click('#group-launch-all'); assert.equal(await boxes().evaluateAll(nodes => nodes.every(node => node.checked)), true);
    for (const key of ['Tab', 'Shift+Tab']) for (let step = 0; step < 18; step++) {
      await page.keyboard.press(key);
      assert.equal(await page.locator(dialog).evaluate(el => el.contains(document.activeElement)), true, `${key} never escapes the native modal`);
    }
    const view = await page.evaluate(() => OpenTabSceneNavigation.getView());
    await page.keyboard.press('Alt+2'); await page.keyboard.press('Control+k');
    assert.deepEqual(await page.evaluate(() => OpenTabSceneNavigation.getView()), view, 'modal input cannot activate background group shortcuts');
    assert.equal(await page.locator('#command-palette').isVisible(), false, 'modal input cannot open a competing palette');
    await close(); await assertNoLaunch(before, 'opening, typing and cancelling do not create any tabs');
    assert.equal(network.length, requestCount, 'preview/selection/cancellation send no network requests');
    await open('Space'); await close('button'); await assertNoLaunch(before, 'both explicit Cancel and Escape are read-only');
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#group-launch-dialog'))), false, 'closed dialog controls leave the normal tab order');
    }
  });

  await phase('explicit confirmation creates only selected real background tabs', async () => {
    await reset(); const before = await stored();
    await open(); await select([alpha, nested]);
    const activeBefore = await page.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true })).map(tab => tab.id));
    await page.locator('#group-launch-confirm').focus(); await page.keyboard.press('Enter'); await finished();
    const actual = await calls();
    assert.deepEqual(actual.map(call => call.options).sort((a, b) => a.url.localeCompare(b.url)), [alpha, nested].map(url => ({ url, active: false })).sort((a, b) => a.url.localeCompare(b.url)));
    assert.ok(actual.every(call => call.result === 'opened' && Number.isInteger(call.tabId) && call.active === false));
    await waitForAsync(page, async ids => { const tabs = await chrome.tabs.query({}); return ids.every(id => tabs.some(tab => tab.id === id && !tab.active)); }, actual.map(call => call.tabId));
    await waitForAsync({ evaluate: async () => [alpha, nested].every(url => context.pages().some(p => p.url() === url)) });
    for (const url of [alpha, nested]) assert.ok(context.pages().some(p => p.url() === url), `actual Chrome tab navigated to ${url}`);
    assert.deepEqual(await page.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true })).map(tab => tab.id)), activeBefore, 'the original active tab stays active');
    assert.equal(page.url(), home);
    for (const url of [alpha, nested]) { assert.equal(await box(url).isChecked(), false); assert.equal(await box(url).isDisabled(), true); }
    assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
    await page.click('#group-launch-all');
    for (const url of [alpha, nested]) assert.equal(await box(url).isChecked(), false, 'Select all never reselects already opened rows');
    await close('button'); assert.deepEqual(await stored(), before);
  });

  await phase('workspace lock is awaited before the first tab side effect', async () => {
    await reset(); const before = await stored(); await open(); await select([alpha]);
    await worker.evaluate(() => {
      globalThis.__groupLaunchLockHeld = false;
      globalThis.__groupLaunchLock = OpenTabWorkspace.transaction(async () => {
        globalThis.__groupLaunchLockHeld = true;
        await new Promise(resolve => { globalThis.__releaseGroupLaunchLock = resolve; });
      });
    });
    await waitForAsync(worker, () => globalThis.__groupLaunchLockHeld === true);
    await page.click('#group-launch-confirm');
    await page.waitForFunction(() => OpenTabGroupLaunch.isPending());
    assert.deepEqual(await calls(), [], 'confirmation cannot launch before durable locked revalidation');
    assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    assert.equal(await page.locator(dialog).isVisible(), true);
    assert.deepEqual(await calls(), [], 'repeated native input cannot bypass the held workspace lock');
    await worker.evaluate(async () => { globalThis.__releaseGroupLaunchLock(); await globalThis.__groupLaunchLock; });
    await finished();
    assert.deepEqual((await calls()).map(call => call.options), [{ url: alpha, active: false }]);
    assert.equal((await calls())[0].result, 'opened');
    await close('button'); assert.deepEqual(await stored(), before);
  });

  await phase('partial failure and singleflight retry never duplicate successes', async () => {
    await reset(); const before = await stored();
    await open(); await select([alpha, nested]);
    await page.evaluate(url => {
      window.__groupLaunchFailureUrls = [url];
      window.__groupLaunchGate = new Promise(resolve => { window.__releaseGroupLaunch = resolve; });
    }, nested);
    await page.click('#group-launch-confirm');
    await page.waitForFunction(() => OpenTabGroupLaunch.isPending() && window.__groupLaunchCalls.length > 0);
    assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    assert.equal(await page.locator(dialog).isVisible(), true, 'pending tab creation cannot dismiss or duplicate the batch');
    await page.evaluate(() => { window.__releaseGroupLaunch(); window.__groupLaunchGate = null; });
    await finished();
    const firstAttempt = await calls();
    assert.deepEqual(firstAttempt.map(call => call.options.url).sort(), [alpha, nested].sort(), 'repeated native input submits one batch');
    assert.equal(firstAttempt.find(call => call.options.url === alpha).result, 'opened');
    assert.equal(firstAttempt.find(call => call.options.url === nested).result, 'failed');
    assert.equal(await box(alpha).isDisabled(), true); assert.equal(await box(alpha).isChecked(), false);
    assert.equal(await box(nested).isDisabled(), false); assert.equal(await box(nested).isChecked(), true);
    assert.match(await page.textContent('#group-launch-status'), /1/);
    assert.match(await box(nested).evaluate(el => el.closest('label').textContent), /fail|retry/i, 'failure is identified on the affected URL, not only in a generic toast');
    await page.evaluate(() => { window.__groupLaunchFailureUrls = []; });
    await page.click('#group-launch-confirm'); await finished();
    const retried = await calls();
    assert.equal(retried.filter(call => call.options.url === alpha).length, 1, 'successful tabs are never retried');
    assert.equal(retried.filter(call => call.options.url === nested).length, 2, 'only the failed URL is retried');
    assert.equal(retried.at(-1).result, 'opened');
    assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
    await close('button'); assert.deepEqual(await stored(), before);
  });

  await phase('durable selected-source changes fail closed before creating tabs', async () => {
    for (const change of ['url', 'remove', 'move']) {
      await reset(); await open(); await select([alpha, nested]);
      await worker.evaluate(change => OpenTabWorkspace.transaction(async ({ read, write }) => {
        const { icons } = await read(['icons']);
        const next = change === 'remove' ? icons.filter(icon => icon.id !== 'alpha')
          : icons.map(icon => icon.id !== 'alpha' ? icon : change === 'url' ? { ...icon, url: 'https://changed.example.test/' } : { ...icon, folderId: 'other-group' });
        await write({ icons: next });
      }), change);
      const expected = await stored();
      // The real scene subscription can briefly lock pointer input while it
      // adopts a different tab's write. Observe completion instead of racing
      // that gate with the native confirmation click.
      await page.waitForFunction(change => {
        const source = OpenTabFolders.bulkMoveContext().sites.find(item => item.id === 'alpha');
        return !document.querySelector('#homepage').inert
          && (change === 'url' ? source?.url === 'https://changed.example.test/' : !source);
      }, change);
      await page.click('#group-launch-confirm'); await finished();
      assert.equal(await page.locator(dialog).isVisible(), true);
      assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
      assert.match(await page.textContent('#group-launch-status'), /chang|reopen|open.*again/i);
      assert.deepEqual(await calls(), [], `durable ${change} cannot launch a captured stale URL or a partial batch`);
      assert.deepEqual(await stored(), expected, 'source rejection does not change the durable graph');
      await close();
    }
  });

  await phase('over-limit and empty previews cannot launch implicitly', async () => {
    const many = Array.from({ length: 23 }, (_, index) => site(`many-${index}`, `Batch site ${index + 1}`, `https://batch-${index}.example.test/path?entry=${index}#section`));
    await reset({ icons: many }); const before = await stored(); await open();
    assert.equal(await boxes().count(), 23, 'over-limit groups are not silently truncated');
    assert.equal(await boxes().evaluateAll(nodes => nodes.every(node => node.checked)), true);
    assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
    assert.match(await page.textContent(dialog), /20/);
    for (const item of many.slice(20)) await box(item.url).uncheck();
    assert.equal(await page.locator('#group-launch-confirm').isDisabled(), false, 'exactly 20 selections is launchable');
    await box(many[20].url).check(); assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true, '21 is blocked');
    await page.click('#group-launch-clear'); assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
    await close(); await assertNoLaunch(before, 'limit and selection exploration create no tabs');
    await reset(); await page.click('#group-tabs [data-group-id="empty-group"]');
    await page.waitForFunction(() => OpenTabSceneNavigation.getView().currentFolderId === 'empty-group');
    await open(); assert.equal(await boxes().count(), 0); assert.equal(await page.locator('#group-launch-confirm').isDisabled(), true);
    assert.match(await page.textContent(dialog), /no .*web|no .*site|empty/i);
    await close(); assert.deepEqual(await calls(), []);
  });

  await phase('new previews follow this tab’s current group and scene', async () => {
    await reset(); await page.click('#group-tabs [data-group-id="other-group"]');
    await page.waitForFunction(() => OpenTabSceneNavigation.getView().currentFolderId === 'other-group');
    await open(); assert.deepEqual(await boxes().evaluateAll(nodes => nodes.map(node => node.value)), ['https://other-group.example.test/']); await close();
    await page.click('#scene-switcher .scene-trigger');
    await page.waitForSelector('.scene-dialog[open]');
    await page.click(`.scene-dialog[open] [data-scene-id="${B}"] [data-scene-action="switch"]`);
    await page.waitForFunction(sceneId => OpenTabSceneNavigation.getView().sceneId === sceneId, B);
    await page.waitForSelector('.scene-dialog[open]', { state: 'detached' });
    await open(); assert.deepEqual(await boxes().evaluateAll(nodes => nodes.map(node => node.value)), ['https://other-scene.example.test/']); await close();
    assert.deepEqual(await calls(), []);
  });

  await phase('bilingual opaque responsive native preview screenshots', async () => {
    for (const languagePreference of ['en', 'zh-CN']) for (const themeMode of ['light', 'dark']) {
      await reset({ languagePreference, themeMode });
      for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 560 }]) {
        await page.setViewportSize(viewport); await open(); await assertBounds();
        assert.match(await page.textContent('#group-launch-title'), languagePreference === 'en' ? /^Open group:/ : /^打开分组：/);
        assert.match(await page.textContent('#group-launch-confirm'), languagePreference === 'en' ? /^Open 7 selected websites$/ : /^打开选中的 7 个网站$/);
        await page.screenshot({ path: path.join(artifacts, `group-launch-${languagePreference}-${themeMode}-${viewport.width}.png`), animations: 'disabled' });
        await box(plainHttp).scrollIntoViewIfNeeded();
        assert.equal(await box(plainHttp).evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }), true, 'last row remains physically reachable on a short viewport');
        await page.locator('#group-launch-cancel').scrollIntoViewIfNeeded(); await close('button');
      }
      assert.deepEqual(await calls(), []);
    }
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab'], 'group launching needs no tabs permission or persistent access expansion');
  assert.deepEqual(errors, []);
  console.log('Group launch: installed-MV3 safety, selection, native input, real background tabs, stale-source guards, retry and responsive UI passed.');
} catch (error) {
  console.error('Group launch failure:', phaseName, await page.evaluate(() => ({
    activeId: document.activeElement?.id, dialogOpen: document.querySelector('#group-launch-dialog')?.open,
    status: document.querySelector('#group-launch-status')?.textContent,
    count: document.querySelector('#group-launch-count')?.textContent,
    view: globalThis.OpenTabSceneNavigation?.getView(), calls: window.__groupLaunchCalls
  })).catch(() => null));
  await page.screenshot({ path: path.join(artifacts, 'group-launch-failure.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally { await context.close(); }
