import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = await chromium.launchPersistentContext('', {
  headless: process.env.HEADLESS === 'true',
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
const HOME = 'folder-home';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const icon = (id, name = id) => ({ id, name, type: 'shortcut', url: `https://example.com/${id}`,
  folderId: HOME, parentId: '', uploadedIconDataUrl: PIXEL, resolvedIconUrl: PIXEL });
const background = { type: 'image', value: 'assets/default_background/default.webp', source: 'preset' };
const errors = [];
let pages = [];
try {
  await context.route('**/*', (route) => /^https?:/.test(route.request().url())
    ? route.fulfill({ contentType: 'image/gif', body: Buffer.from(PIXEL.split(',')[1], 'base64') })
    : route.continue());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}`;
  const home = `${base}/home.html`;
  const ready = (page) => page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0);
  // Let first-install initialization finish before replacing synthetic fixtures.
  const bootstrap = await context.newPage();
  await bootstrap.goto(home); await ready(bootstrap); await bootstrap.close();
  async function pair(icons = [icon('x'), icon('y')]) {
    for (const page of pages) if (!page.isClosed()) await page.close();
    await worker.evaluate(async (fixture) => { await chrome.storage.local.clear(); await chrome.storage.local.set(fixture); }, {
      icons, folders: [{ id: HOME, name: '主页' }], currentFolderId: HOME,
      background, clockFormat: '24h', themeMode: 'light', todos: [], todoPanelOpen: false
    });
    pages = await Promise.all([context.newPage(), context.newPage()]);
    for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
    await Promise.all(pages.map(async (page) => { await page.goto(home); await ready(page); }));
    return pages;
  }
  async function stored() { return worker.evaluate(() => chrome.storage.local.get(['icons', 'folders', 'clockFormat', 'background'])); }
  async function expectNames(page, names) {
    await page.waitForFunction(async (expected) => {
      const { icons = [] } = await chrome.storage.local.get('icons');
      return JSON.stringify(icons.map((item) => item.name).sort()) === JSON.stringify(expected.slice().sort());
    }, names, { timeout: 10000 });
  }
  async function addForm(page, name) {
    await page.click('#add-shortcut-tile');
    await page.fill('#icon-name', name); await page.fill('#icon-url', `https://example.com/${name}`);
  }
  async function add(page, name) { await addForm(page, name); await page.click('#save-btn'); }
  async function editForm(page, id, name) {
    await page.locator(`#icons-container .icon-widget[data-id="${id}"]`).click({ button: 'right' });
    await page.click('#edit-icon-btn'); await page.fill('#icon-name', name);
  }
  async function remove(page, id) {
    await page.locator(`#icons-container .icon-widget[data-id="${id}"]`).click({ button: 'right' });
    await page.click('#delete-icon-btn');
  }
  async function clock12(page) {
    await page.click('#settings-btn'); await page.selectOption('#time-format', '12h');
    await page.waitForFunction(async () => (await chrome.storage.local.get('clockFormat')).clockFormat === '12h');
  }
  async function reloadCheck(names) {
    for (const page of pages) {
      if (page.isClosed()) continue;
      await page.reload(); await ready(page);
      const rendered = await page.locator('#icons-container .icon-name').allTextContents();
      assert.deepEqual(rendered.sort(), names.slice().sort(), 'persisted merge survives reload');
    }
  }
  async function backup(page, icons) {
    await page.evaluate(async (payload) => {
      OpenTabImport.setReloader(() => {});
      try { await OpenTabImport.applyOpenTabBackup(payload); }
      finally { OpenTabImport.setReloader(null); }
    }, { icons, folders: [{ id: HOME, name: '主页' }], currentFolderId: HOME, background });
  }
  let [a, b] = await pair();
  await add(a, 'A'); await expectNames(a, ['x', 'y', 'A']);
  await clock12(b); await expectNames(b, ['x', 'y', 'A']);
  await reloadCheck(['x', 'y', 'A']);
  console.log('workspace: stale unrelated setting preserves new shortcut');

  [a, b] = await pair();
  await Promise.all([addForm(a, 'A'), addForm(b, 'B')]);
  await Promise.all([a.click('#save-btn'), b.click('#save-btn')]);
  await expectNames(a, ['x', 'y', 'A', 'B']); await reloadCheck(['x', 'y', 'A', 'B']);
  console.log('workspace: concurrent additions both persist');

  [a, b] = await pair();
  await Promise.all([editForm(a, 'x', 'X renamed'), editForm(b, 'y', 'Y renamed')]);
  await Promise.all([a.click('#save-btn'), b.click('#save-btn')]);
  await expectNames(a, ['X renamed', 'Y renamed']); await reloadCheck(['X renamed', 'Y renamed']);
  console.log('workspace: independent renames both persist');

  [a, b] = await pair();
  await editForm(b, 'y', 'Y renamed');
  await remove(a, 'x'); await expectNames(a, ['y']);
  await b.click('#save-btn'); await expectNames(b, ['Y renamed']); await reloadCheck(['Y renamed']);
  console.log('workspace: stale edit cannot resurrect deleted shortcut');

  [a, b] = await pair();
  await editForm(b, 'x', 'Deleted target edit');
  await remove(a, 'x'); await expectNames(a, ['y']);
  await b.click('#save-btn');
  await b.waitForFunction(() => /其他标签页|冲突|重试/.test(document.querySelector('#toast')?.textContent || ''));
  await expectNames(b, ['y']); await reloadCheck(['y']);
  console.log('workspace: editing a remotely deleted target is rejected');

  [a, b] = await pair();
  await Promise.all([editForm(a, 'x', 'First winner'), editForm(b, 'x', 'Stale loser')]);
  await a.click('#save-btn'); await expectNames(a, ['First winner', 'y']);
  await b.click('#save-btn');
  await b.waitForFunction(() => /其他标签页|冲突|重试/.test(document.querySelector('#toast')?.textContent || ''));
  await expectNames(b, ['First winner', 'y']); await reloadCheck(['First winner', 'y']);
  console.log('workspace: same-item conflict is reported without overwriting winner');

  [a, b] = await pair();
  await editForm(b, 'x', 'Draft from old record');
  await editForm(a, 'x', 'New record winner');
  await a.click('#save-btn'); await expectNames(a, ['New record winner', 'y']);
  // An unrelated save can also be triggered by async application work while a
  // modal is open. Exercise the real settings handler without dismissing it.
  await b.evaluate(() => {
    const input = document.querySelector('#time-format');
    input.value = '12h'; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await b.waitForFunction(async () => (await chrome.storage.local.get('clockFormat')).clockFormat === '12h');
  await b.waitForFunction(() => document.querySelector('#icons-container .icon-widget[data-id="x"] .icon-name')?.textContent === 'New record winner');
  assert.equal(await b.inputValue('#icon-name'), 'Draft from old record', 'old draft remains distinct from adopted storage');
  await b.click('#save-btn');
  await b.waitForFunction(() => /其他标签页|冲突|重试|已变化|已更新|失效/.test(document.querySelector('#toast')?.textContent || ''));
  await expectNames(b, ['New record winner', 'y']); await reloadCheck(['New record winner', 'y']);
  console.log('workspace: intermediate setting rebase cannot bless an old edit draft');


  [a, b] = await pair();
  await b.locator('#icons-container .icon-widget[data-id="x"]').click({ button: 'right' });
  await b.click('#change-icon-btn');
  await b.fill('#change-icon-letter', 'Q');
  await editForm(a, 'x', 'New icon record');
  await a.click('#save-btn'); await expectNames(a, ['New icon record', 'y']);
  await b.evaluate(() => {
    const input = document.querySelector('#time-format');
    input.value = '12h'; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await b.waitForFunction(() => document.querySelector('#icons-container .icon-widget[data-id="x"] .icon-name')?.textContent === 'New icon record');
  await b.click('#change-icon-placeholder');
  await b.waitForFunction(() => /其他标签页|冲突|重试|已变化|已更新|失效/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal((await stored()).icons.find((item) => item.id === 'x').uploadedIconDataUrl, PIXEL,
    'old icon-changer draft cannot replace the adopted image');
  await expectNames(b, ['New icon record', 'y']); await reloadCheck(['New icon record', 'y']);
  console.log('workspace: icon changer draft cannot overwrite a rebased item');


  [a, b] = await pair();
  await b.locator(`.group-tab[data-group-id="${HOME}"]`).dblclick();
  await b.fill('.group-rename-input', 'Uncommitted group draft');
  await add(a, 'New independent item'); await expectNames(a, ['x', 'y', 'New independent item']);
  await b.evaluate(() => {
    const input = document.querySelector('#time-format');
    input.value = '12h'; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await b.waitForFunction(() => /重命名已取消/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(await b.locator('.group-rename-input').count(), 0, 'rebuilt tabs explicitly cancel stale inline input');
  assert.equal((await stored()).folders.find((item) => item.id === HOME).name, '主页');
  await expectNames(b, ['x', 'y', 'New independent item']); await reloadCheck(['x', 'y', 'New independent item']);
  console.log('workspace: inline rename cancellation is explicit during merged-view refresh');

  [a, b] = await pair();
  await backup(a, [icon('imported', 'Imported')]);
  await clock12(b); await expectNames(b, ['Imported']); await reloadCheck(['Imported']);
  console.log('workspace: stale setting does not undo explicit backup restore');

  [a, b] = await pair();
  await remove(a, 'x'); await expectNames(a, ['y']);
  await backup(b, [icon('imported', 'Imported')]);
  await clock12(a);
  await a.waitForFunction(() => document.querySelector('#icons-container .icon-widget[data-id="imported"] .icon-name')?.textContent === 'Imported');
  await a.locator('#toast button').click();
  await a.waitForFunction(() => /其他标签页|冲突|重试|已变化|已更新|失效/.test(document.querySelector('#toast')?.textContent || ''));
  await expectNames(a, ['Imported']); await reloadCheck(['Imported']);
  console.log('workspace: old undo cannot cross replacement after a setting rebase');

  [a, b] = await pair();
  await editForm(b, 'x', 'Old workspace edit');
  await backup(a, [icon('imported', 'Imported')]);
  await b.click('#save-btn');
  await b.waitForFunction(() => /其他标签页|冲突|重试|恢复|更新/.test(document.querySelector('#toast')?.textContent || ''));
  await expectNames(b, ['Imported']); await reloadCheck(['Imported']);
  console.log('workspace: pre-restore edit cannot replay into replacement workspace');

  [a, b] = await pair();
  await remove(a, 'x'); await expectNames(a, ['y']);
  await add(b, 'After deletion'); await expectNames(b, ['y', 'After deletion']);
  await a.locator('#toast button').click();
  await expectNames(a, ['x', 'y', 'After deletion']); await reloadCheck(['x', 'y', 'After deletion']);
  console.log('workspace: delete undo preserves another tab addition');

  [a, b] = await pair();
  await a.evaluate(async () => {
    OpenTabImport.setReloader(() => {});
    try { await OpenTabImport.commitImport(OpenTabImport.parsedFromTopSites([{ title: 'Imported site', url: 'https://example.com/imported' }])); }
    finally { OpenTabImport.setReloader(null); }
  });
  await expectNames(a, ['x', 'y', 'Imported site']);
  await add(b, 'After import'); await expectNames(b, ['x', 'y', 'Imported site', 'After import']);
  const undone = await a.evaluate(async () => {
    OpenTabImport.setReloader(() => {});
    try { return await OpenTabImport.undoLastImport(); }
    finally { OpenTabImport.setReloader(null); }
  });
  assert.equal(undone.ok, true, 'nonconflicting import undo succeeds');
  await expectNames(a, ['x', 'y', 'After import']); await reloadCheck(['x', 'y', 'After import']);
  console.log('workspace: import undo preserves later unrelated addition');

  [a, b] = await pair();
  await a.evaluate(async (payload) => {
    await OpenTabSync.applyRemotePayload(payload, {
      snapshotReason: 'before-sync-pull',
      onSnapshot: (_snapshot, undo) => { window.__workspaceSyncUndo = undo; }
    });
  }, { deviceId: 'synthetic-other-device', hash: 'synthetic-remote-workspace',
    icons: [icon('remote', 'Remote item')], folders: [{ id: HOME, name: '主页' }], settings: { clockFormat: '12h' } });
  await expectNames(a, ['Remote item']);
  await b.reload(); await ready(b);
  await add(b, 'After sync'); await expectNames(b, ['Remote item', 'After sync']);
  await a.evaluate(() => OpenTabSync.undoRemotePayload(window.__workspaceSyncUndo));
  await expectNames(a, ['x', 'y', 'After sync']);
  assert.equal((await stored()).clockFormat, '24h', 'sync undo also restores its unchanged setting');
  await reloadCheck(['x', 'y', 'After sync']);
  console.log('workspace: sync inverse undo preserves later independent addition');

  [a, b] = await pair();
  const popup = await context.newPage();
  await popup.addInitScript(() => {
    chrome.tabs.query = (_query, callback) => {
      const tabs = [{ id: 77, title: 'Popup item', url: 'https://example.com/popup' }];
      callback?.(tabs); return Promise.resolve(tabs);
    };
  });
  await popup.goto(`${base}/popup.html`);
  await popup.waitForFunction(() => document.querySelector('#site-name').value === 'Popup item');
  await addForm(a, 'Home item');
  await Promise.all([a.click('#save-btn'), popup.click('#save-btn')]);
  await expectNames(a, ['x', 'y', 'Home item', 'Popup item']);
  if (!popup.isClosed()) await popup.close();
  await reloadCheck(['x', 'y', 'Home item', 'Popup item']);
  console.log('workspace: popup and home additions share serialized writes');

  [a, b] = await pair();
  await a.evaluate(() => {
    window.__workspaceLockHeld = false;
    void navigator.locks.request(OpenTabWorkspace.LOCK_NAME, () => {
      window.__workspaceLockHeld = true;
      return new Promise(() => {});
    });
  });
  await a.waitForFunction(() => window.__workspaceLockHeld);
  await add(b, 'After lock owner closed');
  assert.equal(await b.locator('#add-icon-modal').isVisible(), true, 'save remains pending while lock is held');
  assert.equal(await b.locator('#save-btn').isDisabled(), true, 'pending save cannot be submitted twice');
  assert.deepEqual((await stored()).icons.map((item) => item.name), ['x', 'y'], 'waiting writer has not bypassed the held lock');
  await a.close();
  await b.waitForSelector('#add-icon-modal.hidden');
  await expectNames(b, ['x', 'y', 'After lock owner closed']); await reloadCheck(['x', 'y', 'After lock owner closed']);
  console.log('workspace: closing lock owner releases waiting save');

  assert.deepEqual(errors, [], 'no uncaught page errors');
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await b.screenshot({ path: path.join(root, 'artifacts/workspace-two-tab.png'), animations: 'disabled' });
  console.log('workspace E2E passed: concurrent edits, conflicts, restore/undo, popup and lock-owner closure');
} catch (error) {
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  for (const [index, page] of pages.entries()) {
    if (!page.isClosed()) await page.screenshot({ path: path.join(root, `artifacts/workspace-failure-${index}.png`), animations: 'disabled' }).catch(() => {});
  }
  throw error;
} finally { await context.close(); }
