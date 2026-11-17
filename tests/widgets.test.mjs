import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startWidgetWebFixture } from './widget-web-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webFixture = process.argv.includes('--web-fixture');
const artifacts = path.join(root, 'test-results/widgets'); fs.mkdirSync(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext('', {
  headless: process.env.HEADLESS === 'true', locale: 'zh-CN', viewport: { width: 1280, height: 900 },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [...(webFixture ? [] : [`--disable-extensions-except=${root}`, `--load-extension=${root}`]), '--no-sandbox', '--disable-dev-shm-usage']
});
let fixture;
const errors = [];
const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const icon = id => ({ id, name: id, type: 'shortcut', url: `https://example.com/${id}`, folderId: 'folder-home', parentId: '', resolvedIconUrl: pixel, uploadedIconDataUrl: pixel });
const seed = (widgets = [], icons = []) => ({ icons, folders: [{ id: 'folder-home', name: '主页' }], currentFolderId: 'folder-home', languagePreference: 'zh-CN', themeMode: 'light', particlesEnabled: false,
  background: { type: 'image', value: 'assets/default_background/default.webp', source: 'preset' },
  widgetWorkspace: JSON.stringify({ version: 2, definitions: [], widgets, pages: [{ groupId: 'folder-home', columns: 6, icons: [] }] }) });
const note = (id = 'note', x = 0, y = 0) => ({ id, type: 'builtin.note', groupId: 'folder-home', x, y, w: 2, h: 2, data: { text: '项目笔记\n整理想法，专注当下。' } });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(async () => JSON.parse((await chrome.storage.local.get('widgetWorkspace')).widgetWorkspace));
async function saved(predicate, arg) {
  const deadline = Date.now() + 10000;
  while (!predicate(await state(), arg)) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for persisted widget state: ${predicate}`);
    await page.waitForTimeout(20);
  }
  await page.waitForFunction(() => !document.getElementById('widget-add').disabled);
}

let base;
try {
  await context.route('https://**/*', route => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from(pixel.split(',')[1], 'base64') }));
  if (webFixture) { fixture = await startWidgetWebFixture(root, context); base = fixture.origin; }
  else { const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 }); base = `chrome-extension://${worker.url().split('/')[2]}`; }
  const home = `${base}/home.html`;
  async function reset(data) {
    await page.goto(webFixture ? `${base}/__blank` : home);
    if (!webFixture) await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
    await page.evaluate(async data => { await chrome.storage.local.clear(); await chrome.storage.local.set(data); }, data);
    await page.goto(home); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  }
  const more = id => page.locator(`[id="widget-more-${id}"]`);
  const handle = id => page.locator(`[id="widget-move-${id}"]`);
  async function edit(id) { await more(id).click(); await page.getByRole('menuitem', { name: '编辑', exact: true }).click(); }
  const submit = () => page.locator('#widget-settings button[type="submit"]');
  async function add(kind) { await page.click('#widget-add'); await page.locator(`.widget-library-card[data-kind="${kind}"] .widget-library-add`).click(); }
  async function grab(id) { const rect = await handle(id).boundingBox(); await page.mouse.move(rect.x + 20, rect.y + 12); await page.mouse.down(); return { x: rect.x + 20, y: rect.y + 12 }; }
  async function pointerDrag(id, dx, dy, cancel = false) {
    const point = await grab(id); await page.mouse.move(point.x + dx, point.y + dy, { steps: 8 });
    if (cancel) await page.keyboard.press('Escape'); await page.mouse.up();
  }
  const cellWidth = () => page.locator('#icons-container').evaluate(node => (node.getBoundingClientRect().width + 12) / 6);

  await reset(seed());
  await page.click('#widget-add'); await page.screenshot({ path: path.join(artifacts, 'gallery-light.png') });
  await page.keyboard.press('Escape');
  await add('note');
  assert.equal(await page.locator('#widget-settings textarea').evaluate(node => node === document.activeElement), true, 'content receives initial focus');
  await page.locator('#widget-settings textarea').fill('取消不会留下空卡片'); await page.keyboard.press('Escape');
  assert.equal((await state()).widgets.length, 0, 'cancel add is atomic');
  assert.equal(await page.evaluate(() => OpenTabWidgets.canSwitch()), true, 'Escape leaves no invisible draft blocking navigation');
  await add('note'); await page.locator('#widget-settings textarea').fill('新便笺');
  await submit().evaluate(button => { button.click(); button.click(); });
  await page.waitForSelector('#widget-settings:not([open])', { state: 'attached' });
  assert.equal((await state()).widgets.length, 1, 'double submit adds only once');
  const id = (await state()).widgets[0].id;
  assert.equal(await page.locator('.widget-card-actions').count(), 0, 'no permanently visible edit/delete buttons');
  await edit(id); await page.locator('#widget-settings textarea').fill('未保存'); await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal((await state()).widgets[0].data.text, '新便笺');
  await edit(id); await page.locator('#widget-settings textarea').fill('已保存的便笺'); await page.screenshot({ path: path.join(artifacts, 'editor-light.png') }); await submit().click();
  await saved(value => value.widgets[0].data.text === '已保存的便笺');
  await handle(id).focus(); await page.keyboard.press('Shift+F10');
  assert.equal(await page.getByRole('menuitem', { name: '编辑', exact: true }).isVisible(), true);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  assert.equal(await more(id).evaluate(node => node === document.activeElement), true, 'menu restores focus');
  await more(id).click(); await page.screenshot({ path: path.join(artifacts, 'actions-light.png') });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click(); await saved(value => value.widgets.length === 0);
  await page.getByRole('button', { name: '撤销删除', exact: true }).click(); await saved(value => value.widgets.length === 1);
  console.log('widgets: atomic add/edit/cancel, repeated submit, accessible action menu, delete and undo passed');

  await reset(seed([note()]));
  const initial = await state(), step = await cellWidth();
  await pointerDrag('note', step * 2, 0, true);
  assert.deepEqual(await state(), initial, 'Escape cancels drag without a write');
  assert.equal(await page.locator('.desktop-drop-preview').count(), 0);
  await pointerDrag('note', step * 2, 0); await saved(value => value.widgets[0].x === 2);
  assert.equal(await page.locator('#desktop-widget-feedback').isVisible(), false, 'successful moves have no persistent notification');
  const moved = await state(); await page.reload(); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  assert.deepEqual(await state(), moved, 'dragged positions survive reload');
  await pointerDrag('note', -step * 2, 0); await saved(value => value.widgets[0].x === 0);
  await pointerDrag('note', step * 2, -132); assert.equal((await state()).widgets[0].x, 0, 'outside drop cannot snap into grid');
  await handle('note').focus(); await page.keyboard.press('ArrowRight'); await saved(value => value.widgets[0].x === 1);
  await handle('note').focus(); await page.keyboard.press('ArrowUp'); assert.equal((await state()).widgets[0].y, 0, 'top boundary rejected');
  await page.waitForFunction(() => document.querySelector('#desktop-widget-feedback')?.textContent.includes('已占用'));
  assert.equal(await page.locator('#desktop-widget-feedback').isVisible(), true, 'occupied/boundary feedback remains visible');
  console.log('widgets: pointer preview/drop, Escape, outside bounds, keyboard movement and reload passed');

  // A native website drag uses its original grab point and the same saved grid.
  await reset(seed([note()], [icon('site-a'), icon('site-b')]));
  const site = page.locator('.icon-widget[data-id="site-a"]');
  const rect = await site.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 + 132, { steps: 10 });
  await page.mouse.up();
  await saved(value => value.pages[0].icons.some(icon => icon.id === 'site-a' && icon.y === 1));
  const siteLayout = await state();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.projected === 'true');
  assert.deepEqual(await state(), siteLayout, 'responsive reflow cannot write positions');
  await page.click('#widget-add'); await page.screenshot({ path: path.join(artifacts, 'gallery-narrow.png') });
  assert.equal(await page.locator('#widget-dialog').evaluate(node => node.scrollWidth <= node.clientWidth), true, 'narrow gallery has no horizontal overflow');
  await page.keyboard.press('Escape'); await edit('note'); await page.screenshot({ path: path.join(artifacts, 'editor-narrow.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.deepEqual(await state(), siteLayout);
  console.log('widgets: native website drag and responsive persistence passed');
  await reset(seed([note(), note('blocker', 3, 0)]));
  const occupiedState = await state(), grabPoint = await grab('note');
  await page.mouse.move(grabPoint.x + step * 2, grabPoint.y, { steps: 8 });
  assert.equal(await page.locator('.desktop-drop-preview').getAttribute('data-valid'), 'false', 'preview identifies the same occupied target as drop');
  await page.screenshot({ path: path.join(artifacts, 'drag-occupied.png') });
  await page.mouse.up(); assert.deepEqual(await state(), occupiedState, 'occupied drops preserve the original layout');
  const cancelPoint = await grab('note'); await page.mouse.move(cancelPoint.x, cancelPoint.y + 132, { steps: 8 });
  await handle('note').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true }); await page.mouse.up();
  assert.deepEqual(await state(), occupiedState, 'pointer cancellation never commits');
  assert.equal(await page.locator('.desktop-drop-preview').count(), 0);

  await reset(seed()); await add('checklist');
  await page.getByRole('button', { name: '添加事项', exact: true }).click();
  const firstItem = page.locator('.widget-content-editor input[type="text"]').first(); await firstItem.fill('第一项'); await firstItem.press('Enter');
  assert.equal(await page.locator('.widget-content-editor input[type="text"]').count(), 2);
  await page.locator('.widget-content-editor input[type="text"]').last().fill('第二项'); await submit().click();
  await saved(value => value.widgets[0]?.data.items?.length === 2);
  await page.locator('.widget-body input[type="checkbox"]').first().check(); await saved(value => value.widgets[0].data.items[0].done);
  await add('links'); await page.getByRole('button', { name: '添加链接', exact: true }).click();
  await page.locator('.widget-content-editor input[type="text"]').fill('不安全链接'); await page.locator('.widget-content-editor input[type="url"]').fill('javascript:alert(1)'); await submit().click();
  assert.equal(await page.locator('#widget-settings').isVisible(), true);
  assert.ok((await page.locator('#widget-settings .widget-status').textContent()).includes('无效'));
  await page.keyboard.press('Escape'); assert.equal((await state()).widgets.length, 1, 'invalid or cancelled links leave no orphan widget');
  console.log('widgets: occupied preview/drop agreement, pointer cancellation, checklist keyboard flow and unsafe-link validation passed');


  await reset(seed([], [icon('a'), icon('b'), icon('c')]));
  const previewValid = await page.evaluate(() => {
    const source = document.querySelector('.icon-widget[data-id="c"]'), target = document.querySelector('.icon-widget[data-id="a"]');
    const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect(), dt = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sr.x + sr.width / 2, clientY: sr.y + sr.height / 2 }));
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 4, clientY: tr.y + tr.height / 2 };
    target.dispatchEvent(new DragEvent('dragover', opts)); const valid = document.querySelector('.desktop-drop-preview')?.dataset.valid;
    target.dispatchEvent(new DragEvent('drop', opts)); source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); return valid;
  });
  assert.equal(previewValid, 'true'); await saved(value => value.pages[0].icons.find(icon => icon.id === 'c')?.x === 0);
  const visualIds = () => page.locator('#icons-container .icon-widget[data-id]').evaluateAll(nodes => nodes.map(node => node.dataset.id));
  assert.deepEqual(await visualIds(), ['c', 'a', 'b'], 'quick drop inserts before the target');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  assert.deepEqual(await visualIds(), ['c', 'a', 'b'], 'visual sorting survives reload');
  await page.locator('.icon-widget[data-id="a"]').focus(); await page.keyboard.press('Alt+ArrowRight');
  await saved(value => value.pages[0].icons.find(icon => icon.id === 'a')?.x === 2);
  assert.deepEqual(await visualIds(), ['c', 'b', 'a']);
  assert.equal(await page.locator('.icon-widget[data-id="a"]').evaluate(node => node === document.activeElement), true);
  assert.deepEqual(await page.evaluate(async () => (await chrome.storage.local.get('icons')).icons.map(icon => icon.id)), ['a', 'b', 'c'], 'sorting does not rewrite source records');
  console.log('widgets: icon insertion preview, visual sorting, Alt-arrow focus and refresh persistence passed');

  await reset(seed([note()], [icon('a'), icon('b')]));
  // Touch long press and movement cancellation use actual PointerEvents; the
  // browser separately verifies real pointer capture through mouse drag above.
  const body = page.locator('.widget-card .widget-body');
  await body.dispatchEvent('pointerdown', { pointerId: 22, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 100 });
  await page.getByRole('menuitem', { name: '编辑', exact: true }).waitFor(); await page.keyboard.press('Escape');
  await body.dispatchEvent('pointerdown', { pointerId: 23, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 100 });
  await body.dispatchEvent('pointermove', { pointerId: 23, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 140 });
  await body.dispatchEvent('pointerup', { pointerId: 23, pointerType: 'touch', isPrimary: true });
  await page.waitForTimeout(600); assert.equal(await page.locator('#widget-menu').isVisible(), false, 'scrolling does not trigger long press');

  async function mergeGesture(drop) {
    await page.evaluate(async drop => {
      const source = document.querySelector('.icon-widget[data-id="a"]'), target = document.querySelector('.icon-widget[data-id="b"]');
      const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect(), dt = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sr.x + sr.width / 2, clientY: sr.y + sr.height / 2 }));
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 };
      target.dispatchEvent(new DragEvent('dragover', opts));
      await new Promise(resolve => setTimeout(resolve, 600));
      if (drop) target.dispatchEvent(new DragEvent('drop', opts));
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, drop);
  }
  await mergeGesture(false);
  assert.equal(await page.locator('.icon-folder').count(), 0, 'hover and Escape cannot merge icons');
  await mergeGesture(true); await page.waitForSelector('.icon-folder');
  console.log('widgets: touch long press, scroll cancellation and explicit-drop folder merge passed');
  const display = [note(),
    { ...note('tasks', 2, 0), type: 'builtin.checklist', data: { items: [{ id: 'one', text: '完成今日计划', done: true }, { id: 'two', text: '准备下一个版本', done: false }] } },
    { ...note('links', 4, 0), type: 'builtin.links', data: { links: [{ label: '项目文档', url: 'https://example.com/docs' }] } },
    { ...note('date', 0, 2), type: 'builtin.countdown', h: 1, data: { label: '下一次旅行', date: '2030-01-01' } },
    { ...note('time', 2, 2), type: 'builtin.clock', h: 1, data: { timezone: 'Asia/Shanghai', hour12: false } }
  ];
  await reset(seed(display, [icon('docs'), icon('work')]));
  await page.locator('#content').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.screenshot({ path: path.join(artifacts, 'desktop-light.png') });
  await page.evaluate(() => chrome.storage.local.set({ themeMode: 'dark' }));
  await page.reload(); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  await page.waitForFunction(() => !document.body.classList.contains('theme-light'));
  await more('note').click(); await page.screenshot({ path: path.join(artifacts, 'actions-dark.png') });
  await page.keyboard.press('Escape');


  await reset(seed([note()]));
  await edit('note'); await page.locator('#widget-settings textarea').fill('失败时保留草稿');
  await page.evaluate(() => {
    const area = chrome.storage.local, original = area.set.bind(area); let failOnce = true;
    area.set = (patch, callback) => { if (failOnce && Object.hasOwn(patch, 'widgetWorkspace')) { failOnce = false; throw new Error('simulated storage failure'); } return original(patch, callback); };
  });
  await submit().click();
  await page.waitForFunction(() => document.querySelector('#widget-settings .widget-status')?.textContent.includes('保存失败'));
  assert.equal(await page.locator('#widget-settings textarea').inputValue(), '失败时保留草稿');
  await submit().click(); await saved(value => value.widgets[0].data.text === '失败时保留草稿');
  await edit('note'); await page.locator('#widget-settings textarea').fill('冲突时保留草稿');

  // Exercise concurrency through a real second page/storage notification.
  const other = await context.newPage(); await other.goto(home); await other.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  await other.evaluate(async () => { const raw = (await chrome.storage.local.get('widgetWorkspace')).widgetWorkspace, value = JSON.parse(raw); value.widgets[0].data.text = '其他标签页'; await chrome.storage.local.set({ widgetWorkspace: JSON.stringify(value) }); });
  await page.waitForFunction(() => document.querySelector('#widget-settings .widget-status')?.textContent.includes('草稿已保留'));
  assert.equal(await page.locator('#widget-settings textarea').inputValue(), '冲突时保留草稿');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#widget-settings').isVisible(), false, 'conflict never traps the modal'); await other.close();
  assert.deepEqual(errors, [], `Unexpected runtime errors: ${errors.join(' | ')}`);
  console.log(`Widget browser regression passed (${webFixture ? 'HTTP storage adapter; extension integration still required' : 'installed MV3 extension'}).`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
  console.error('Widget browser failure', error, 'runtime errors:', errors); throw error;
} finally { await context.close(); await fixture?.close(); }
