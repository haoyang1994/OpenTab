import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const pixel = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const ready = page => page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0);
const cjk = /[\u3400-\u9fff]/;
async function start(locale) {
  const context = await chromium.launchPersistentContext('', {
    locale, headless: process.env.HEADLESS === 'true', viewport: { width: 1280, height: 800 },
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
  });
  let weatherRequests = 0;
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'wttr.in') {
      weatherRequests++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        current_condition: [{ temp_C: '20', temp_F: '68', weatherCode: '113', weatherDesc: [{ value: 'Sunny' }], lang_zh: [{ value: '晴' }] }],
        nearest_area: [{ areaName: [{ value: 'Test City' }], country: [{ value: 'Test Country' }] }]
      }) });
    }
    return /^https?:$/.test(url.protocol) ? route.fulfill({ contentType: 'image/gif', body: Buffer.from(pixel, 'base64') }) : route.continue();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}`;
  const page = await context.newPage();
  await page.goto(`${base}/home.html`); await ready(page);
  return { context, page, base, worker, errors, weatherRequests: () => weatherRequests };
}
async function settings(page, query = '') {
  if (await page.locator('#settings-panel').evaluate(el => el.classList.contains('hidden'))) await page.click('#settings-btn');
  await page.waitForSelector('#settings-panel:not(.hidden)');
  await page.fill('#settings-search', query);
}
async function language(page, preference, expected) {
  await settings(page);
  await page.locator('#language-preference').scrollIntoViewIfNeeded();
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.selectOption('#language-preference', preference)]);
  await ready(page);
  assert.equal(await page.getAttribute('html', 'lang'), expected);
  assert.equal(await page.evaluate(() => OpenTabI18n.locale), expected);
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('languagePreference')).languagePreference), preference);
}
async function assertEnglishShell(page) {
  const texts = await page.evaluate(() => {
    const values = [];
    for (const el of document.querySelectorAll('[data-i18n]')) {
      if (!el.closest('#language-preference')) values.push({ key: el.dataset.i18n, value: el.textContent });
    }
    for (const attribute of ['title', 'aria-label', 'placeholder']) for (const el of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
      values.push({ key: el.getAttribute(`data-i18n-${attribute}`), value: el.getAttribute(attribute) });
    }
    return values;
  });
  assert.deepEqual(texts.filter(item => cjk.test(item.value)), [], 'every explicitly owned static surface has an English translation');
  assert.equal(await page.getAttribute('#settings-btn', 'title'), 'Settings');
  assert.equal(await page.getAttribute('#search-input', 'placeholder'), 'Search, URL, or shortcut name');
}
const main = await start('en-US');
try {
  const { page, context, worker, base } = main;
  assert.equal(await page.getAttribute('html', 'lang'), 'en', 'fresh English browser uses English automatically');
  await assertEnglishShell(page);
  await waitForAsync(page, async () => (await chrome.storage.local.get('themeMode')).themeMode === 'light');
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('theme-light')), true, 'fresh install is light');
  assert.equal(main.weatherRequests(), 0, 'localization does not enable weather traffic');
  assert.equal(await page.evaluate(() => chrome.runtime.getManifest().description.includes('__MSG_')), false, 'Chrome resolves localized manifest metadata');

  await page.click('#add-shortcut-tile');
  assert.equal(await page.locator('#save-btn').textContent(), 'Save');
  await page.fill('#icon-name', 'Invalid URL'); await page.fill('#icon-url', 'https://[');
  await page.click('#save-btn');
  assert.equal(await page.locator('#toast').textContent(), 'Enter a valid URL.', 'add validation is in English');
  const title = '设置 · My link';
  await page.fill('#icon-name', title); await page.fill('#icon-url', 'https://example.com/mine');
  await page.click('#save-btn'); await page.waitForSelector('#add-icon-modal.hidden');
  const item = await page.evaluate(async () => (await chrome.storage.local.get('icons')).icons[0]);
  assert.equal(item.name, title, 'user title is not interpreted as a translation key');
  await page.locator(`.icon-widget[data-id="${item.id}"]`).click({ button: 'right' });
  assert.ok(!cjk.test(await page.locator('#edit-icon-btn').textContent()));
  await page.click('#edit-icon-btn'); await page.fill('#icon-name', `${title} 保存`);
  await page.click('#save-btn'); await page.waitForSelector('#add-icon-modal.hidden');
  await page.fill('#search-input', `${title} 保存`);
  assert.equal(await page.inputValue('#search-input'), `${title} 保存`);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(artifacts, 'i18n-en-home-light.png'), animations: 'disabled' });

  await settings(page, 'import');
  await page.setInputFiles('#import-file-input', { name: 'unknown.json', mimeType: 'application/json', buffer: Buffer.from('{"unknown":true}') });
  await page.waitForFunction(() => document.querySelector('#import-sync-status').textContent.includes('Unrecognized'));
  assert.ok(!cjk.test(await page.locator('#import-sync-status').textContent()), 'import error is English');
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('icons'))).icons[0].name, `${title} 保存`);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.setInputFiles('#import-file-input', { name: 'saved.infinity', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ data: { site: { sites: [[{ type: 'web', name: '导入的用户标题', target: 'https://example.com/imported' }]] } } })) })]);
  await page.waitForLoadState('domcontentloaded'); await ready(page);
  await waitForAsync(page, async () => (await chrome.storage.local.get('icons')).icons.some(icon => icon.name === '导入的用户标题'));
  await page.reload(); await ready(page);
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  await settings(page, 'import');
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#import-undo-btn')]); await ready(page);
  await waitForAsync(page, async () => !(await chrome.storage.local.get('icons')).icons.some(icon => icon.name === '导入的用户标题'));

  await settings(page, 'weather');
  assert.ok(!cjk.test(await page.locator('#weather-status').textContent()));
  await page.fill('#weather-city', 'Test City'); await page.click('#weather-save'); await page.check('#weather-enabled');
  await page.waitForFunction(() => document.querySelector('#weather-temp').textContent.includes('20'));
  assert.ok(!cjk.test(await page.locator('#weather-status').textContent()));
  assert.equal(main.weatherRequests(), 1);
  await page.screenshot({ path: path.join(artifacts, 'i18n-en-weather-wide.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 600, height: 800 });
  await page.screenshot({ path: path.join(artifacts, 'i18n-en-weather-narrow.png'), animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'English has no horizontal page overflow at 600px');
  await page.setViewportSize({ width: 1280, height: 800 });

  await language(page, 'zh-CN', 'zh-CN');
  assert.equal(await page.getAttribute('#settings-btn', 'title'), '设置');
  assert.match(await page.getAttribute('#weather-pill', 'title'), /晴/, 'cached condition switches to Chinese without a request');
  assert.equal(main.weatherRequests(), 1);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('icons'))).icons[0].name, `${title} 保存`, 'switching language preserves user data');
  await page.screenshot({ path: path.join(artifacts, 'i18n-zh-home-light.png'), animations: 'disabled' });
  const second = await context.newPage(); await second.goto(`${base}/home.html`); await ready(second);
  assert.equal(await second.getAttribute('html', 'lang'), 'zh-CN', 'explicit language applies to a new tab'); await second.close();
  await settings(page, '天气');
  await page.setViewportSize({ width: 600, height: 800 });
  await page.screenshot({ path: path.join(artifacts, 'i18n-zh-weather-narrow.png'), animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await language(page, 'en', 'en'); await page.reload(); await ready(page);
  await assertEnglishShell(page);
  assert.match(await page.getAttribute('#weather-pill', 'title'), /Sunny/, 'cached condition switches back to English');
  assert.equal(main.weatherRequests(), 1);

  const popup = await context.newPage();
  await popup.addInitScript(() => { chrome.tabs.query = async () => [{ id: 123, title: '设置 User page', url: 'https://example.com/page' }]; });
  await popup.goto(`${base}/popup.html`);
  await popup.waitForFunction(() => document.querySelector('#site-name').value === '设置 User page');
  assert.equal(await popup.getAttribute('html', 'lang'), 'en');
  assert.equal(await popup.inputValue('#site-name'), '设置 User page', 'popup preserves page title');
  assert.ok(!cjk.test(await popup.locator('#save-btn').textContent())); await popup.close();
  await language(page, 'auto', 'en');
  for (const choice of [undefined, 'dark', 'light', 'auto']) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(async theme => {
      await chrome.storage.local.set({ icons: [], folders: [{ id: 'folder-home', name: '主页' }] });
      if (theme === undefined) await chrome.storage.local.remove('themeMode');
      else await chrome.storage.local.set({ themeMode: theme });
    }, choice);
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('themeMode')).themeMode), choice, 'existing explicit or implicit theme is never rewritten');
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('theme-light')), choice === 'light' || choice === 'auto');
    assert.equal(await page.locator('.group-tab[data-group-id="folder-home"]').evaluate(el => el.firstChild.textContent), '主页', 'stored built-in group title remains user content');
    if (choice === 'auto') {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.reload(); await ready(page);
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('theme-light')), false, 'existing system theme still follows dark preference');
    }
  }
  assert.deepEqual(main.errors, [], 'English/Chinese flows have no uncaught page errors');
  console.log('i18n: English core flow, import/undo, weather, popup, explicit preference, new tab and data preservation passed');
} finally { await main.context.close(); }
for (const [browserLocale, expected] of [['zh-CN', 'zh-CN'], ['fr-FR', 'en']]) {
  const run = await start(browserLocale);
  try {
    assert.equal(await run.page.getAttribute('html', 'lang'), expected, 'browser locale selects Chinese or English fallback');
    if (expected === 'en') await assertEnglishShell(run.page);
    else { await language(run.page, 'en', 'en'); await language(run.page, 'auto', 'zh-CN'); }
    assert.equal(run.weatherRequests(), 0);
    assert.deepEqual(run.errors, []);
  } finally { await run.context.close(); }
}
console.log('i18n E2E passed: English/Chinese auto, unsupported fallback, preference, core workflows and narrow layouts');
