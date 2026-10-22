import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGM4o+AARAwQCgAjDgSxHkgC8wAAAABJRU5ErkJggg==', 'base64');
const replacementPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNQSHgARAwQCgAjjgWBzpymWgAAAABJRU5ErkJggg==', 'base64');
const upload = (name = 'local.png') => ({ name, mimeType: 'image/png', buffer: name === 'edit.png' ? replacementPng : png });
const closedRoots = '#settings-panel.hidden, #todo-widget.hidden, #add-icon-modal.hidden, #change-icon-modal.hidden, #timezone-selector.hidden';
const context = await chromium.launchPersistentContext('', {
  locale: 'en-US', headless: process.env.HEADLESS === 'true', viewport: { width: 1280, height: 800 },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'wttr.in') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    current_condition: [{ temp_C: '20', temp_F: '68', weatherCode: '113', weatherDesc: [{ value: 'Sunny' }] }],
    nearest_area: [{ areaName: [{ value: 'Test City' }], country: [{ value: 'Test Country' }] }]
  }) });
  return /^https?:$/.test(url.protocol) ? route.fulfill({ contentType: 'image/png', body: png }) : route.continue();
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const base = `chrome-extension://${worker.url().split('/')[2]}`;
const page = await context.newPage();
const ready = () => page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0 && document.querySelector('#weather-pill')?.hasAttribute('data-stale'));
const focused = selector => page.evaluate(s => document.activeElement?.matches(s) === true, selector);
async function assertNotHidden() {
  assert.equal(await page.evaluate(s => Boolean(document.activeElement?.closest(s)), closedRoots), false, 'keyboard focus never enters a closed surface');
}
async function tabTo(selector, key = 'Tab') {
  for (let i = 0; i < 180; i++) {
    await assertNotHidden();
    if (await focused(selector)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`Cannot reach ${selector} with ${key}; active: ${await page.evaluate(() => document.activeElement?.outerHTML)}`);
}
async function activate(selector, key = 'Enter') { await tabTo(selector); await page.keyboard.press(key); }
async function settled() {
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
}
async function closed(selector, opener) {
  await page.waitForSelector(`${selector}.hidden`, { state: 'attached' });
  await settled();
  assert.equal(await page.locator(selector).isVisible(), false, `${selector} is actually hidden`);
  if (opener) assert.equal(await focused(opener), true, `${selector} restores its opener`);
}
async function sweepClosed() {
  for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < 60; i++) { await page.keyboard.press(key); await assertNotHidden(); }
}
async function openAdd() {
  await activate('#add-shortcut-tile', 'Space');
  await page.waitForSelector('#add-icon-modal:not(.hidden)');
  await page.waitForFunction(() => !document.querySelector('#save-btn').disabled && document.querySelector('#icon-file').files.length === 0);
}
async function openMenuAction(id, action) {
  const tile = `.icon-widget[data-id="${id}"]`;
  await tabTo(tile);
  // Native Chromium keyboard context-menu gesture, not a synthetic DOM event.
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('#icon-context-menu:not(.hidden)');
  await activate(action);
  await page.waitForSelector(action === '#edit-icon-btn' ? '#add-icon-modal:not(.hidden)' : '#change-icon-modal:not(.hidden)');
  return tile;
}
const icons = () => page.evaluate(async () => (await chrome.storage.local.get('icons')).icons || []);
async function installCompressionGate() {
  await page.evaluate(() => {
    const real = OpenTabIcons.readAndCompressFile.bind(OpenTabIcons);
    window.__compression = [];
    OpenTabIcons.readAndCompressFile = file => new Promise((resolve, reject) => {
      const job = { name: file.name, released: false, finished: false };
      job.release = async () => {
        if (job.released) throw new Error('compression released twice');
        job.released = true;
        try { job.result = await real(file); resolve(job.result); }
        catch (error) { job.error = error.message; reject(error); }
        finally { job.finished = true; }
      };
      window.__compression.push(job);
    });
  });
}
async function queueFile(file) {
  const index = await page.evaluate(() => window.__compression.length);
  await page.setInputFiles('#icon-file', file);
  await page.waitForFunction(i => window.__compression.length === i + 1, index);
  return index;
}
async function release(index) {
  await page.evaluate(i => window.__compression[i].release(), index);
  await page.waitForFunction(i => window.__compression[i].finished, index);
}
async function fillDraft(name) { await page.fill('#icon-name', name); await page.fill('#icon-url', `https://example.test/${encodeURIComponent(name)}`); }
async function pendingSave(index, expectedCount) {
  await activate('#save-btn');
  // Save disables the draft controls; repeated physical Enter must not submit again.
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#save-btn').isDisabled(), true);
  assert.equal(await page.evaluate(i => window.__compression[i].released, index), false);
  assert.equal((await icons()).length, expectedCount, 'Save cannot persist before the selected image finishes');
  assert.equal(await page.locator('#add-icon-modal').isVisible(), true, 'draft stays open while image is pending');
}

// Bound the arbitrary wallpaper under each translucent panel by black and white.
// Compute the actual CSS alpha chain, never replace colors with test-only CSS.
async function contrast(selector, surface, pseudo = null) {
  await page.locator(selector).scrollIntoViewIfNeeded(); await settled();
  const result = await page.locator(selector).evaluate((el, { surface, pseudo }) => {
    const root = el.closest(surface);
    if (!root) throw new Error('Missing contrast surface');
    const color = css => {
      const match = css.match(/^rgba?\(([^)]+)\)$/);
      if (!match) throw new Error(`Unsupported computed color: ${css}`);
      const values = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const chain = []; for (let node = el; node; node = node.parentElement) { chain.unshift(node); if (node === root) break; }
    const styles = chain.map(node => getComputedStyle(node));
    for (const css of styles) {
      if (Number(css.opacity) !== 1 || css.backgroundImage !== 'none') throw new Error('Contrast requires settled opacity and no unmodelled background image inside the panel');
    }
    const textStyle = getComputedStyle(el, pseudo);
    const fg = color(textStyle.color); fg[3] *= Number(textStyle.opacity);
    const bounds = [0, 255].map(value => {
      const bg = styles.reduce((under, css) => over(color(css.backgroundColor), under), [value, value, value]);
      const painted = over(fg, bg), a = luminance(painted), b = luminance(bg);
      return { background: bg, foreground: painted, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
    return { text: pseudo ? el.getAttribute('placeholder') : el.textContent.trim(), color: textStyle.color, bounds };
  }, { surface, pseudo });
  assert.ok(result.text, `${selector} has real text to measure`);
  assert.ok(result.bounds.every(b => b.ratio >= 4.5), `${selector}${pseudo || ''} contrast below 4.5:1: ${JSON.stringify(result)}`);
  return { selector, pseudo, ...result };
}

try {
  await page.goto(`${base}/home.html`); await ready();
  await page.evaluate(async () => { await chrome.storage.local.set({ languagePreference: 'en', themeMode: 'light', icons: [], todoPanelOpen: false }); });
  await page.reload(); await ready();
  await sweepClosed();
  for (const [button, panel] of [['#settings-btn', '#settings-panel'], ['#todo-toggle-btn', '#todo-widget'], ['#timezone-btn', '#timezone-selector']]) {
    await activate(button); await page.waitForSelector(`${panel}:not(.hidden)`);
    await page.keyboard.press('Escape'); await closed(panel, button);
  }
  await openAdd(); await activate('#cancel-btn', 'Space'); await closed('#add-icon-modal', '#add-shortcut-tile');
  await openAdd(); await page.keyboard.press('Escape'); await closed('#add-icon-modal', '#add-shortcut-tile');
  await activate('#timezone-btn', 'Space');
  const zone = await page.locator('.timezone-item').last().getAttribute('data-tz');
  const zoneSelector = `.timezone-item[data-tz="${zone}"]`;
  assert.equal(await page.locator(zoneSelector).evaluate(el => el.tagName), 'BUTTON');
  await activate(zoneSelector, 'Space'); await closed('#timezone-selector', '#timezone-btn');
  await waitForAsync(page, async tz => (await chrome.storage.local.get('timezone')).timezone === tz, zone);
  await page.reload(); await ready(); await activate('#timezone-btn');
  assert.equal(await page.getAttribute(zoneSelector, 'aria-pressed'), 'true', 'timezone choice persists across reload');
  assert.equal(await focused(zoneSelector), true, 'opening focuses selected timezone');
  await page.keyboard.press('Escape'); await closed('#timezone-selector', '#timezone-btn');

  await installCompressionGate();
  await openAdd(); await fillDraft('Pending Add');
  const addJob = await queueFile(upload('add.png')); await pendingSave(addJob, 0); await release(addJob);
  await closed('#add-icon-modal', '#add-shortcut-tile');
  await waitForAsync(page, async () => (await chrome.storage.local.get('icons')).icons?.length === 1);
  let [item] = await icons();
  assert.equal(item.name, 'Pending Add'); assert.match(item.uploadedIconDataUrl, /^data:image\//);
  assert.equal(item.uploadedIconDataUrl, await page.evaluate(i => window.__compression[i].result, addJob));
  const tile = await openMenuAction(item.id, '#edit-icon-btn');
  await activate('#cancel-btn'); await closed('#add-icon-modal', tile);
  await openMenuAction(item.id, '#edit-icon-btn'); await page.keyboard.press('Escape'); await closed('#add-icon-modal', tile);
  await openMenuAction(item.id, '#edit-icon-btn'); await page.fill('#icon-name', 'Pending Edit');
  const editJob = await queueFile(upload('edit.png')); await pendingSave(editJob, 1); await release(editJob);
  await closed('#add-icon-modal', tile);
  await waitForAsync(page, async () => (await chrome.storage.local.get('icons')).icons?.[0]?.name === 'Pending Edit');
  assert.equal((await icons()).length, 1, 'duplicate Save/Enter never duplicates an edited shortcut');
  assert.equal((await icons())[0].id, item.id);
  assert.equal((await icons())[0].uploadedIconDataUrl, await page.evaluate(i => window.__compression[i].result, editJob));
  assert.notEqual((await icons())[0].uploadedIconDataUrl, item.uploadedIconDataUrl, 'Edit persists the newly compressed replacement');

  const previousImage = (await icons())[0].uploadedIconDataUrl;
  await openMenuAction(item.id, '#edit-icon-btn');
  const badJob = await queueFile({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await release(badJob);
  await page.waitForFunction(() => document.querySelector('#icon-upload-status').textContent.includes('Unable to read image'));
  assert.ok(await page.evaluate(i => Boolean(window.__compression[i].error), badJob), 'real image decoder rejects corrupt image');
  await page.fill('#icon-name', 'Retained Image'); await activate('#save-btn');
  await page.waitForFunction(() => !document.querySelector('#save-btn').disabled);
  assert.equal(await page.locator('#add-icon-modal').isVisible(), true, 'failed upload blocks Save without silently discarding the replacement');
  assert.equal((await icons())[0].uploadedIconDataUrl, previousImage);
  assert.equal((await icons())[0].name, 'Pending Edit', 'failed upload cannot partially save an edit');
  await page.setInputFiles('#icon-file', []);
  await activate('#save-btn'); await closed('#add-icon-modal', tile);
  await waitForAsync(page, async () => (await chrome.storage.local.get('icons')).icons?.[0]?.name === 'Retained Image');
  assert.equal((await icons())[0].uploadedIconDataUrl, previousImage, 'failed replacement preserves the saved icon');

  await openAdd(); await fillDraft('Cancelled Draft');
  const staleJob = await queueFile(upload('stale.png')); await pendingSave(staleJob, 1);
  await activate('#cancel-btn'); await closed('#add-icon-modal', '#add-shortcut-tile');
  await openAdd(); await fillDraft('Fresh Draft');
  const freshStatus = await page.locator('#icon-upload-status').textContent();
  await release(staleJob);
  assert.equal(await page.inputValue('#icon-name'), 'Fresh Draft');
  assert.equal(await page.locator('#icon-upload-status').textContent(), freshStatus, 'old completion cannot change reopened draft status');
  assert.equal((await icons()).length, 1, 'cancelled pending Save cannot create a shortcut');
  await activate('#save-btn'); await closed('#add-icon-modal', '#add-shortcut-tile');
  await waitForAsync(page, async () => (await chrome.storage.local.get('icons')).icons?.length === 2);
  const fresh = (await icons()).find(icon => icon.name === 'Fresh Draft');
  assert.ok(fresh); assert.equal(fresh.uploadedIconDataUrl || '', '', 'old image cannot leak into reopened draft');

  await openMenuAction(item.id, '#change-icon-btn');
  assert.equal(await page.locator('#change-icon-upload').evaluate(el => el.tagName), 'BUTTON');
  for (const key of ['Enter', 'Space']) {
    await tabTo('#change-icon-upload');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press(key);
    const chooser = await chooserPromise; await chooser.setFiles(upload(`chooser-${key}.png`));
    await page.waitForFunction(() => document.querySelector('#change-icon-file').files.length === 0);
  }
  await page.keyboard.press('Escape'); await closed('#change-icon-modal', tile);
  await sweepClosed();

  const contrasts = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async value => { await chrome.storage.local.set({ themeMode: value }); }, theme);
    await page.reload(); await ready();
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    await activate('#settings-btn'); await page.fill('#settings-search', 'weather');
    await page.fill('#weather-city', 'Test City'); await page.click('#weather-save');
    await waitForAsync(page, async () => (await chrome.storage.local.get('weatherCity')).weatherCity === 'Test City');
    await page.check('#weather-enabled');
    await waitForAsync(page, async () => (await chrome.storage.local.get('weatherEnabled')).weatherEnabled === true);
    await page.waitForFunction(() => document.querySelector('#weather-temp').textContent.includes('20'));
    contrasts.push({ theme, samples: [await contrast('#weather-privacy', '#settings-panel'), await contrast('#weather-status', '#settings-panel')] });
    await page.screenshot({ path: path.join(artifacts, `accessibility-en-${theme}-weather.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 600, height: 800 }); await settled();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '600px English settings have no horizontal page overflow');
    await page.screenshot({ path: path.join(artifacts, `accessibility-en-${theme}-weather-600px.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.fill('#settings-search', ''); await page.keyboard.press('Escape'); await closed('#settings-panel', '#settings-btn');
    for (const mode of ['add', 'edit']) {
      if (mode === 'add') await openAdd(); else await openMenuAction(item.id, '#edit-icon-btn');
      contrasts.push({ theme, mode, samples: [await contrast('#icon-upload-status', '.modal-content'), await contrast('#icon-url', '.modal-content', '::placeholder')] });
      await page.screenshot({ path: path.join(artifacts, `accessibility-en-${theme}-${mode}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape'); await closed('#add-icon-modal', mode === 'add' ? '#add-shortcut-tile' : tile);
    }
  }
  fs.writeFileSync(path.join(artifacts, 'accessibility-contrast.json'), JSON.stringify(contrasts, null, 2));
  assert.deepEqual(errors, [], 'core release workflows have no uncaught page errors');
  console.log('Accessibility: real keyboard, hidden surfaces, focus restoration, timezone persistence, native upload, pending image saves and computed contrast passed');
} finally { await context.close(); }
