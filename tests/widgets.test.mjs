import { runDesktopAction } from './desktop-action.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startWidgetWebFixture } from './widget-web-fixture.mjs';
import { waitForAsync } from './wait-for-async.mjs';

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
  async function catalog() { await page.click('#add-shortcut-tile'); await page.click('#widget-add'); }
  async function add(kind) { await catalog(); await page.locator(`.widget-library-card[data-kind="${kind}"] .widget-library-add`).click(); }
  async function grab(id) { await page.waitForFunction(id => !document.getElementById(`widget-move-${id}`).closest('.widget-card').getAnimations().some(animation => animation.id === 'opentab-desktop-shift'), id); const rect = await handle(id).boundingBox(); await page.mouse.move(rect.x + 20, rect.y + 12); await page.mouse.down(); return { x: rect.x + 20, y: rect.y + 12 }; }
  async function pointerDrag(id, dx, dy, cancel = false) {
    const point = await grab(id); await page.mouse.move(point.x + dx, point.y + dy, { steps: 8 });
    if (cancel) await page.keyboard.press('Escape'); await page.mouse.up();
  }
  const cellWidth = () => page.locator('#icons-container').evaluate(node => (node.getBoundingClientRect().width + 12) / 6);

  // The add button remains an ordinary button until movement crosses the drag threshold.
  const addTile = page.locator('#add-shortcut-tile');
  async function dragAddTo(x, y, cancel = false) {
    await addTile.scrollIntoViewIfNeeded();
    await addTile.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const from = await addTile.boundingBox();
    const to = await page.locator('#icons-container').evaluate((node, { x, y }) => {
      const rect = node.getBoundingClientRect(), css = getComputedStyle(node), gap = parseFloat(css.columnGap);
      const columns = Number(css.getPropertyValue('--desktop-columns'));
      return { x: rect.left + x * (rect.width + gap) / columns + 16, y: rect.top + y * (parseFloat(css.gridAutoRows) + gap) + 16 };
    }, { x, y });
    await page.mouse.move(from.x + 16, from.y + 16); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await page.locator('#add-icon-modal').isVisible(), false, 'releasing a drag must not open Add');
  }
  const twoGroups = seed([note()]);
  twoGroups.folders.push({ id: 'other', name: '第二组' });
  await reset(twoGroups);
  await dragAddTo(0, 0, true);
  assert.deepEqual(await state(), JSON.parse(twoGroups.widgetWorkspace), 'Escape leaves the original layout intact');
  await dragAddTo(0, 0);
  await saved(value => value.pages[0].addTile?.x === 0);
  assert.notDeepEqual([ (await state()).widgets[0].x, (await state()).widgets[0].y ], [0, 0]);
  await page.keyboard.press('ControlOrMeta+z'); await saved(value => !value.pages[0].addTile);
  assert.deepEqual((await state()).widgets, JSON.parse(twoGroups.widgetWorkspace).widgets);
  await addTile.press('ArrowRight'); await saved(value => value.pages[0].addTile?.x === 3);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#add-shortcut-tile')?.style.gridColumnStart === '4');
  await addTile.click(); await page.locator('#icon-url').fill('https://saved.example/'); await page.locator('#icon-url').press('Enter');
  await page.locator('#add-icon-modal').waitFor({ state: 'hidden' });
  assert.equal(await addTile.evaluate(node => node.style.gridColumnStart), '4');
  await page.locator('#group-tabs [data-group-id="other"]').click();
  await page.waitForFunction(() => OpenTabDesktop.getContext().groupId === 'other' && document.querySelector('#add-shortcut-tile').style.gridColumnStart === '1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#icons-container').dataset.projected === 'true');
  await dragAddTo(1, 0);
  await saved(value => value.pages.find(p => p.groupId === 'other')?.addTile?.x === 1);
  assert.equal((await state()).pages.find(p => p.groupId === 'folder-home').addTile.x, 3);
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log('widgets: add tile pointer and keyboard moves, cancellation, displacement undo, activation, reload, groups and narrow projection passed');

  await reset(seed());
  const pristine = await page.evaluate(async () => (await chrome.storage.local.get('widgetWorkspace')).widgetWorkspace);
  assert.equal(await page.locator('#group-tabs').isVisible(), false, 'one group hides redundant tabs');
  assert.equal(await page.locator('#add-group-btn').isVisible(), true, 'new group remains available');
  assert.equal(await page.locator('#widget-add').isVisible(), false, 'no permanent widget add button');
  await page.click('#add-shortcut-tile');
  assert.equal(await page.locator('#icon-url').evaluate(node => node === document.activeElement), true);
  await page.locator('#icon-url').fill('https://docs.example.com/path');
  await page.locator('#icon-url').press('Enter'); await page.locator('#add-icon-modal.hidden').waitFor({ state: 'attached' });
  await waitForAsync(page, async () => (await chrome.storage.local.get('icons')).icons.some(icon => icon.name === 'docs.example.com'));
  await page.reload(); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('widgetWorkspace')).widgetWorkspace), pristine, 'refresh and website add do not relocate the desktop');
  await page.locator('#icons-container').click({ button: 'right', position: { x: 2, y: 2 } });
  assert.equal(await page.locator('#icon-url').evaluate(node => node === document.activeElement), true, 'empty grid context menu opens the same website-first panel');
  await page.keyboard.press('Escape');
  await reset(seed());
  await catalog(); await page.screenshot({ path: path.join(artifacts, 'gallery-light.png') });
  await page.keyboard.press('Escape');
  await add('note');
  assert.equal(await page.locator('#widget-settings textarea').evaluate(node => node === document.activeElement), true, 'content receives initial focus');
  await page.locator('#widget-settings textarea').fill('取消不会留下空卡片'); await page.keyboard.press('Escape');
  assert.equal((await state()).widgets.length, 0, 'cancel add is atomic');
  assert.equal(await page.evaluate(() => OpenTabWidgets.canSwitch()), true, 'Escape leaves no invisible draft blocking navigation');
  // Drafts now live in layout settings and widget management, separately.
  for (const action of ['cancel', 'save']) {
    await reset(seed()); await page.click('#settings-btn'); await page.click('#settings-nav-shortcuts');
    await page.locator('#desktop-column-count').fill('8'); await page.keyboard.press('Escape');
    await add('note');
    if (action === 'save') { await submit().click(); await saved(value => value.widgets.length === 1); }
    else await page.keyboard.press('Escape');
    assert.equal(await page.locator('#desktop-column-count').isVisible(), true);
    assert.equal(await page.locator('#desktop-column-count').inputValue(), '8');
    await page.getByRole('button', { name: '取消桌面列数修改', exact: true }).click(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => OpenTabWidgets.canSwitch()), true);
    await catalog(); await page.getByRole('button', { name: '组件管理', exact: true }).click();
    const registration = page.locator('#widget-dialog .widget-register');
    assert.equal(await registration.evaluate(node => node.open), false);
    await registration.locator('summary').press('Enter');
    const input = page.locator('#widget-dialog textarea');
    const definition = (await input.inputValue()).replace('my.project', 'my.draft'); await input.fill(definition);
    await page.getByRole('button', { name: '选择组件', exact: true }).click();
    await page.locator('.widget-library-card[data-kind="note"] .widget-library-add').click();
    if (action === 'save') { await submit().click(); await saved(value => value.widgets.length === 2); }
    else await page.keyboard.press('Escape');
    await page.locator('#widget-dialog[open]').waitFor();
    assert.equal(await input.inputValue(), definition);
    await page.getByRole('button', { name: '舍弃注册草稿', exact: true }).click(); await page.keyboard.press('Escape');
  }
  console.log('widgets: layout and registration drafts remain visible in their settings after add cancel/save');
  await reset(seed());
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
  assert.equal(await page.locator('#desktop-widget-feedback').count(), 0, 'the desktop notification panel is removed');
  assert.equal(await page.locator('#toast').isVisible(), false, 'delete is silent');
  await page.screenshot({ path: path.join(artifacts, 'delete-without-notice.png') });
  await page.evaluate(() => {
    const area = chrome.storage.local, original = area.set.bind(area); let failOnce = true;
    area.set = (patch, callback) => { if (failOnce && Object.hasOwn(patch, 'widgetWorkspace')) { failOnce = false; throw new Error('transient undo storage failure'); } return original(patch, callback); };
  });
  // Use the keyboard path: feedback must keep the action when undo returns false.
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('保存失败'));
  assert.equal((await state()).widgets.length, 0);
  assert.equal(await page.evaluate(() => OpenTabDesktop.canUndo()), true, 'failed keyboard undo remains retryable');
  await page.keyboard.press('ControlOrMeta+z'); await saved(value => value.widgets.length === 1);
  assert.equal(await page.locator('#toast').isVisible(), false, 'undo is silent');
  console.log('widgets: atomic add/edit/cancel, repeated submit, accessible action menu, delete and undo passed');

  await reset(seed([note()]));
  const initial = await state(), step = await cellWidth();
  await pointerDrag('note', step * 2, 0, true);
  assert.deepEqual(await state(), initial, 'Escape cancels drag without a write');
  assert.equal(await page.locator('.desktop-drop-preview').count(), 0);
  await pointerDrag('note', step * 2, 0); await saved(value => value.widgets[0].x === 2);
  assert.equal(await page.locator('#toast').isVisible(), false, 'successful moves have no notification');
  const moved = await state(); await page.reload(); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  assert.deepEqual(await state(), moved, 'dragged positions survive reload');
  await pointerDrag('note', -step * 2, 0); await saved(value => value.widgets[0].x === 0);
  await pointerDrag('note', step * 2, -132); assert.equal((await state()).widgets[0].x, 0, 'outside drop cannot snap into grid');
  await handle('note').focus(); await page.keyboard.press('ArrowRight'); await saved(value => value.widgets[0].x === 1);
  await handle('note').focus(); await page.keyboard.press('ArrowUp'); assert.equal((await state()).widgets[0].y, 0, 'top boundary rejected');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('超出桌面边界'));
  assert.equal(await page.locator('#toast').isVisible(), true, 'boundary errors remain available in a compact floating alert');
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
  await catalog(); await page.screenshot({ path: path.join(artifacts, 'gallery-narrow.png') });
  assert.equal(await page.locator('#add-widget-catalog').evaluate(node => node.scrollWidth <= node.clientWidth), true, 'narrow gallery has no horizontal overflow');
  await page.keyboard.press('Escape'); await edit('note'); await page.screenshot({ path: path.join(artifacts, 'editor-narrow.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.deepEqual(await state(), siteLayout);
  console.log('widgets: native website drag and responsive persistence passed');


  // Check painted clock digits, not only a visible card shell or saved coordinates.
  const liveClock = { ...note('live-clock'), type: 'builtin.clock', h: 1, data: { timezone: 'Asia/Shanghai', hour12: false } };
  const repeatSeed = seed([liveClock, note('neighbor', 2, 0),
    { ...note('live-date', 4, 0), type: 'builtin.countdown', data: { date: '2026-12-31', label: '下一次旅行' } },
    { ...note('live-tasks', 0, 2), type: 'builtin.checklist', data: { items: [{ id: 'keep', text: '整理计划', done: false }] } },
    { ...note('live-links', 2, 2), type: 'builtin.links', data: { links: [{ label: '工作资料', url: 'https://example.com/' }] } }
  ], [icon('repeat-site')]);
  repeatSeed.background = { type: 'gradient', value: 'linear-gradient(135deg, #f8fafc, #e2e8f0)', source: 'gradient' };
  await reset(repeatSeed);
  const repeating = page.locator('.widget-card[data-widget-id="live-clock"]');
  await repeating.evaluate(node => { window.repeatClockCard = node; window.repeatClockOutput = node.querySelector('time'); });
  const unchangedContents = (await state()).widgets.map(widget => widget.data);
  async function clockPainted() {
    await page.waitForFunction(() => [...document.querySelectorAll('#icons-container > *')].every(node => !node.getAnimations().some(animation => animation.id === 'opentab-desktop-shift')));
    assert.equal(await repeating.evaluate(node => node === window.repeatClockCard && node.querySelector('time') === window.repeatClockOutput), true, 'moves retain the same clock renderer');
    assert.match(await repeating.locator('time').textContent(), /\d{2}:\d{2}:\d{2}/);
    const image = await repeating.locator('time').screenshot();
    const ink = await page.evaluate(async base64 => {
      const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 120 && pixels[i + 3] > 0) count++;
      return count;
    }, image.toString('base64'));
    assert.ok(ink > 30, `clock digits remain painted after repeated moves (${ink} foreground pixels)`);
    for (const widget of (await state()).widgets) {
      assert.equal(await page.locator(`.widget-card[data-widget-id="${widget.id}"] .widget-handle`).isVisible(), true);
      assert.ok((await page.locator(`.widget-card[data-widget-id="${widget.id}"] .widget-body`).textContent()).trim().length > 0);
    }
  }
  for (let turn = 0; turn < 24; turn++) {
    await handle('live-clock').scrollIntoViewIfNeeded();
    const previous = (await state()).widgets.find(widget => widget.id === 'live-clock'), x = ((turn + 1) % 3) * 2;
    await pointerDrag('live-clock', (x - previous.x) * step, 0);
    await saved(value => value.widgets.find(widget => widget.id === 'live-clock').x === x);
    if (turn % 4 === 3) await clockPainted();
  }
  assert.deepEqual((await state()).widgets.map(widget => widget.data), unchangedContents);
  const clockTime = await repeating.locator('time').getAttribute('datetime');
  await page.waitForFunction(before => document.querySelector('[data-widget-id="live-clock"] time').dateTime !== before, clockTime);
  const repeatedLayout = await state();
  await pointerDrag('live-clock', step * 2, 0, true); assert.deepEqual(await state(), repeatedLayout);
  await handle('live-clock').scrollIntoViewIfNeeded(); const outside = await grab('live-clock');
  await page.mouse.move(-10, outside.y, { steps: 8 }); await page.mouse.up(); assert.deepEqual(await state(), repeatedLayout);
  await clockPainted(); await page.screenshot({ path: path.join(artifacts, 'clock-repeated-drag.png') });
  await page.reload(); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  assert.deepEqual(await state(), repeatedLayout);
  await repeating.evaluate(node => { window.repeatClockCard = node; window.repeatClockOutput = node.querySelector('time'); });
  await clockPainted();
  console.log('widgets: 24 clock drags, occupied displacement, painted digits, ongoing ticks, cancellation, boundary, reload and other component contents passed');
  await reset(seed([note(), { ...note('blocker', 3, 0), data: { text: '资料与安排\n拖动时自动让位。' } }]));
  const occupiedState = await state(), blocker = page.locator('.widget-card[data-widget-id="blocker"]'), blockerStart = await blocker.boundingBox(), grabPoint = await grab('note');
  await page.mouse.move(grabPoint.x + step * 2, grabPoint.y, { steps: 8 });
  assert.equal(await page.locator('.desktop-drop-preview').getAttribute('data-valid'), 'true', 'occupied widgets make room instead of rejecting the drop');
  await page.waitForFunction(({ left, step }) => document.querySelector('.widget-card[data-widget-id="blocker"]').getBoundingClientRect().left > left + step * .8, { left: blockerStart.x, step });
  assert.deepEqual(await state(), occupiedState, 'live displacement does not write before release');
  const follower = await page.locator('.widget-card[data-widget-id="note"]').boundingBox();
  assert.ok(Math.abs(follower.x - (grabPoint.x + step * 2 - 30)) < 20, 'grabbed card follows the pointer continuously');
  await page.screenshot({ path: path.join(artifacts, 'drag-displacement.png') });
  await page.mouse.up(); await saved(value => value.widgets.find(widget => widget.id === 'note').x === 2 && value.widgets.find(widget => widget.id === 'blocker').x === 4);
  const displaced = await state(); await page.reload(); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  assert.deepEqual(await state(), displaced, 'displaced neighbors and the grabbed item both survive reload');
  const cancelPoint = await grab('note'); await page.mouse.move(cancelPoint.x + step, cancelPoint.y, { steps: 8 });
  await handle('note').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true }); await page.mouse.up();
  assert.deepEqual(await state(), displaced, 'pointer cancellation restores every displaced item');
  assert.equal(await page.locator('.desktop-drop-preview').count(), 0);
  await page.waitForFunction(() => [...document.querySelectorAll('#icons-container > *')].every(node => !node.getAnimations().some(animation => animation.id === 'opentab-desktop-shift')));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stillPoint = await grab('note'); await page.mouse.move(stillPoint.x + step, stillPoint.y, { steps: 4 });
  assert.equal(await page.locator('#icons-container').evaluate(node => [...node.children].some(child => child.getAnimations().some(animation => animation.id === 'opentab-desktop-shift'))), false, 'reduced motion previews do not animate');
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.deepEqual(await state(), displaced);

  async function nativeMoveToWidget(id) {
    const source = await page.locator(`.icon-widget[data-id="${id}"]`).boundingBox(), destination = await page.locator('.widget-card[data-widget-id="note"]').boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
    await page.mouse.move(destination.x + step / 2, destination.y + 60, { steps: 12 });
    await page.waitForFunction(() => document.querySelector('.widget-card[data-widget-id="note"]').style.translate !== '');
    await page.mouse.up();
    await saved((value, id) => value.widgets[0].x === 1 && value.widgets[0].y === 0 && value.pages[0].icons.some(icon => icon.id === id && icon.x === 0 && icon.y === 0), id);
  }
  await reset(seed([note()], [icon('a'), icon('b')]));
  await nativeMoveToWidget('a');
  assert.equal(await page.locator('.icon-folder').count(), 0, 'dragging onto a widget cannot merge sites');
  await reset(seed([note()], [{ ...icon('pack'), type: 'folder', name: '资料', url: '' }, { ...icon('child'), parentId: 'pack' }, icon('b')]));
  await nativeMoveToWidget('pack');
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('icons')).icons.find(icon => icon.id === 'child').parentId), 'pack', 'a displaced icon folder retains its children');
  await reset(seed([note(), note('blocker', 3, 0)]));
  const beforeFailedDrop = await state();
  await page.evaluate(() => { const area = chrome.storage.local, original = area.set.bind(area); let fail = true; area.set = (patch, callback) => { if (fail && Object.hasOwn(patch, 'widgetWorkspace')) { fail = false; throw new Error('simulated drag save failure'); } return original(patch, callback); }; });
  await pointerDrag('note', step * 2, 0);
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('保存失败'));
  assert.deepEqual(await state(), beforeFailedDrop, 'a failed commit restores the whole preview without writing displaced neighbors');
  assert.equal(await page.locator('.desktop-drop-preview').count(), 0);
  assert.equal(await page.locator('.desktop-drag-active').count(), 0);
  const interrupted = await grab('note'); await page.mouse.move(interrupted.x + step * 2, interrupted.y, { steps: 8 });
  await page.evaluate(async () => { const value = JSON.parse((await chrome.storage.local.get('widgetWorkspace')).widgetWorkspace); value.widgets[0].data.text = '外部更新'; await chrome.storage.local.set({ widgetWorkspace: JSON.stringify(value) }); });
  await page.waitForFunction(() => document.querySelector('.widget-card[data-widget-id="note"] .widget-body').textContent.includes('外部更新'));
  await page.mouse.up();
  assert.equal((await state()).widgets[0].x, 0, 'external updates cancel an in-progress drag');
  assert.equal((await state()).widgets[1].x, 3);
  assert.equal(await page.locator('.desktop-drop-preview').count(), 0);
  await reset(seed([note(), note('blocker', 3, 0)]));
  const edgeGrab = await grab('note'), edgeGrid = await page.locator('#icons-container').boundingBox();
  await page.mouse.move(edgeGrid.x + edgeGrid.width - 1, edgeGrab.y, { steps: 12 });
  assert.equal(await page.locator('.desktop-drop-preview').evaluate(node => node.style.gridColumnStart), '5', 'the right edge fits the full widget inside the last columns');
  await page.mouse.up(); await saved(value => value.widgets[0].x === 4);
  const beforeResize = await state(), resizeGrab = await grab('note');
  await page.mouse.move(resizeGrab.x - step, resizeGrab.y, { steps: 6 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#icons-container').dataset.projected === 'true');
  await page.mouse.up(); assert.deepEqual(await state(), beforeResize, 'resizing during a drag cancels the full preview without saving');
  assert.equal(await page.locator('.desktop-drop-preview').count(), 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log('widgets: live displacement, pointer following, cancellation, reduced motion, mixed widget/icon/folder moves and reload passed');

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
  console.log('widgets: checklist keyboard flow and unsafe-link validation passed');


  await reset(seed([], [icon('a'), icon('b'), icon('c')]));
  const dropTrace = await page.evaluate(async () => {
    const source = document.querySelector('.icon-widget[data-id="c"]'), target = document.querySelector('.icon-widget[data-id="a"]');
    const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect(), dt = new DataTransfer();
    // Hold the real save until the neighbor has finished moving into the preview.
    let unlock;
    await new Promise(ready => navigator.locks.request('opentab-workspace-v1', () =>
      new Promise(resolve => { unlock = resolve; ready(); })));
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sr.x + sr.width / 2, clientY: sr.y + sr.height / 2 }));
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 4, clientY: tr.y + tr.height / 2 };
    target.dispatchEvent(new DragEvent('dragover', opts)); const valid = document.querySelector('.desktop-drop-preview')?.dataset.valid;
    target.dispatchEvent(new DragEvent('drop', opts)); source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    try {
      await Promise.all(target.getAnimations().map(animation => animation.finished.catch(() => {})));
      await nextFrame();
    } finally { unlock(); }
    const previewX = target.getBoundingClientRect().left;
    let furthestRewind = 0;
    for (let frame = 0; frame < 30; frame++) {
      await nextFrame();
      const x = document.querySelector('.icon-widget[data-id="a"]').getBoundingClientRect().left;
      furthestRewind = Math.max(furthestRewind, previewX - x);
    }
    return { valid, advanced: previewX - tr.left, furthestRewind, sameNode: target.isConnected };
  });
  assert.equal(dropTrace.valid, 'true');
  assert.ok(dropTrace.advanced > 10, 'the neighbor reached its displaced slot while the save was pending');
  assert.ok(dropTrace.furthestRewind < 2, 'committing must not replay a completed displacement');
  assert.ok(dropTrace.sameNode, 'the displaced icon survives the layout commit');
  await saved(value => value.pages[0].icons.find(icon => icon.id === 'c')?.x === 0);
  const visualIds = () => page.locator('#icons-container .icon-widget[data-id]').evaluateAll(nodes => nodes.map(node => node.dataset.id));
  assert.deepEqual(await visualIds(), ['c', 'a', 'b'], 'quick drop inserts before the target');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true');
  assert.deepEqual(await visualIds(), ['c', 'a', 'b'], 'visual sorting survives reload');
  await page.locator('.icon-widget[data-id="a"]').focus(); await page.keyboard.press('Alt+ArrowRight');
  await saved(value => value.pages[0].icons.find(icon => icon.id === 'a')?.x === 2);
  assert.deepEqual(await visualIds(), ['c', 'b', 'a']);
  assert.equal(await page.locator('.icon-widget[data-id="a"]').evaluate(node => node === document.activeElement), true);
  assert.deepEqual(await page.evaluate(async () => (await chrome.storage.local.get('icons')).icons.map(icon => icon.id)), ['a', 'b', 'c'], 'sorting does not rewrite source records');
  await reset(seed([], [icon('a'), icon('b')]));
  await page.evaluate(() => {
    const source = document.querySelector('.icon-widget[data-id="a"]'), destination = document.querySelector('.icon-widget[data-id="b"]'), a = source.getBoundingClientRect(), b = destination.getBoundingClientRect(), dt = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: a.x + a.width / 2, clientY: a.y + a.height / 2 }));
    const event = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
    destination.dispatchEvent(new DragEvent('dragover', event)); destination.dispatchEvent(new DragEvent('drop', event)); source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  });
  await saved(value => value.pages[0].icons.find(icon => icon.id === 'a')?.x === 1);
  assert.deepEqual(await visualIds(), ['b', 'a'], 'a quick center drop moves into the occupied icon slot');
  await page.locator('.icon-widget[data-id="a"]').click({ button: 'right' }); await page.click('#delete-icon-btn');
  await page.waitForFunction(async () => !(await chrome.storage.local.get('icons')).icons.some(icon => icon.id === 'a'));
  await page.waitForFunction(() => OpenTabDesktop.canUndo());
  assert.equal(await page.locator('#toast').isVisible(), false, 'website delete has no success toast');
  await page.locator('#add-shortcut-tile').focus(); await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(async () => (await chrome.storage.local.get('icons')).icons.some(icon => icon.id === 'a'));
  assert.equal(await page.locator('#toast').isVisible(), false, 'website restore has no success toast');
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
    await page.waitForFunction(() => !document.getAnimations().some(animation => animation.id === 'opentab-desktop-shift'));
    await page.evaluate(async drop => {
      const source = document.querySelector('.icon-widget[data-id="a"]'), target = document.querySelector('.icon-widget[data-id="b"]');
      const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect(), dt = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sr.x + sr.width / 2, clientY: sr.y + sr.height / 2 }));
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 };
      target.dispatchEvent(new DragEvent('dragover', opts));
      await new Promise(resolve => setTimeout(resolve, 600));
      if (!document.querySelector('.desktop-drop-preview')) throw new Error('ordinary-site hover keeps its sort preview');
      if (drop) target.dispatchEvent(new DragEvent('drop', opts));
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, drop);
  }
  await mergeGesture(false);
  assert.equal(await page.locator('.icon-folder').count(), 0, 'hover and Escape cannot merge icons');
  await mergeGesture(true);
  assert.equal(await page.locator('.icon-folder').count(), 0, 'dropping on an ordinary site only sorts');
  await page.waitForFunction(() => OpenTabDesktop.canUndo()); assert.equal(await page.locator('#toast').isVisible(), false, 'sorting is silent');
  console.log('widgets: touch long press, scroll cancellation and ordinary-site sorting passed');
  // Explicit creation is separate from sorting; existing folders accept an
  // immediate drop, including Shift, without a hover timer.
  await reset(seed([], [icon('a'), icon('b'), icon('c')]));
  await runDesktopAction(page, 'select-sites');
  assert.equal(await page.locator('#site-selection-folder').isDisabled(), true);
  await page.locator('.icon-widget[data-id="a"] .site-selection-checkbox').check();
  assert.equal(await page.locator('#site-selection-folder').isDisabled(), true);
  await page.locator('.icon-widget[data-id="b"] .site-selection-checkbox').check();
  await page.click('#site-selection-folder');
  await waitForAsync(page, async () => (await chrome.storage.local.get('icons')).icons.some(item => item.type === 'folder'));
  const created = await page.evaluate(async () => (await chrome.storage.local.get('icons')).icons.find(item => item.type === 'folder'));
  await page.locator('#site-selection-toolbar').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#icons-container')?.dataset.widgetsReady === 'true' && !document.getElementById('widget-add').disabled);
  await page.evaluate(folderId => {
    const source = document.querySelector('.icon-widget[data-id="c"]'), target = document.querySelector(`.icon-widget[data-id="${CSS.escape(folderId)}"]`);
    const a = source.getBoundingClientRect(), b = target.getBoundingClientRect(), dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer, clientX: a.x + a.width / 2, clientY: a.y + a.height / 2 }));
    const options = { bubbles: true, cancelable: true, dataTransfer, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, shiftKey: true };
    target.dispatchEvent(new DragEvent('dragover', options)); target.dispatchEvent(new DragEvent('drop', options));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
  }, created.id);
  await waitForAsync(page, async id => (await chrome.storage.local.get('icons')).icons.find(item => item.id === 'c').parentId === id, created.id);
  await page.locator('#add-shortcut-tile').focus(); await page.keyboard.press('ControlOrMeta+z');
  await waitForAsync(page, async () => !(await chrome.storage.local.get('icons')).icons.find(item => item.id === 'c').parentId);
  console.log('widgets: explicit multi-select folder creation, immediate Shift drop into existing folder and guarded inverse passed');
  await reset(seed([note('note', 0, 0), note('neighbor', 2, 0)], [icon('a'), icon('b')]));
  const layoutNow = () => page.evaluate(async () => {
    const saved = await chrome.storage.local.get(['widgetWorkspace', 'icons']);
    return OpenTabWidgetModel.desktop(OpenTabWidgetModel.parse(saved.widgetWorkspace), 'folder-home', saved.icons, 6);
  });
  const layoutBefore = await layoutNow();
  await pointerDrag('note', (await cellWidth()) * 2, 0); await saved(value => value.widgets.find(item => item.id === 'note').x === 2);
  await handle('note').focus(); await page.keyboard.press('ControlOrMeta+z');
  await saved(value => value.widgets.find(item => item.id === 'note').x === 0);
  assert.deepEqual(await layoutNow(), layoutBefore, 'one keyboard undo restores every widget and website displacement');
  console.log('widgets: native Ctrl/Cmd+Z restores the complete group layout transaction');
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
