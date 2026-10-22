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
const payload = {
  current_condition: [{ temp_C: '20', temp_F: '68', weatherCode: '113', weatherDesc: [{ value: 'Sunny' }], lang_zh: [{ value: '晴' }] }],
  nearest_area: [{ areaName: [{ value: 'Test City' }], country: [{ value: 'Test Country' }] }]
};
let requests = 0;
let mode = 'success';
let releasePending;
let pendingStarted;
const errors = [];
try {
  // All remote requests are intercepted. No real city, geolocation, or weather request leaves this test.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'wttr.in') {
      requests += 1;
      assert.equal(decodeURIComponent(url.pathname), '/Test City');
      if (mode === 'pending') await new Promise((resolve) => { releasePending = resolve; pendingStarted?.(); });
      if (mode === 'failure') return route.fulfill({ status: 503, body: 'unavailable' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }).catch(() => {});
    }
    if (/^https?:$/.test(url.protocol)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__weatherGeoCalls = 0;
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition() { window.__weatherGeoCalls += 1; throw new Error('Unexpected geolocation'); } } });
  });
  const home = `chrome-extension://${sw.url().split('/')[2]}/home.html`;
  await page.goto(home);
  await page.waitForFunction(() => window.OpenTabWeather && performance.getEntriesByName('opentab:grid-ready').length > 0 && document.querySelector('#weather-status').textContent.includes('天气已关闭'));
  assert.equal(await page.locator('#weather-pill').isVisible(), false, 'default weather hidden');
  assert.equal(requests, 0, 'default must not contact weather provider');
  assert.equal(await page.evaluate(() => window.__weatherGeoCalls), 0, 'no geolocation request');
  async function settings() {
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.locator('#settings-search').fill('天气');
  }
  await settings();
  await page.locator('#weather-city').fill('Test City');
  await page.locator('#weather-save').click();
  assert.equal(requests, 0, 'saving city while disabled must not fetch');
  await page.locator('#weather-enabled').check();
  await page.waitForFunction(() => document.querySelector('#weather-temp').textContent.includes('20'));
  assert.equal(requests, 1);
  await page.locator('#weather-unit').selectOption('f');
  await page.waitForFunction(() => document.querySelector('#weather-temp').textContent.includes('68'));
  assert.equal(requests, 1, 'unit switch reuses cache');
  await page.waitForFunction(async () => (await chrome.storage.local.get('weatherUnit')).weatherUnit === 'f');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#weather-temp').textContent.includes('68'));
  assert.equal(requests, 1, 'reload reuses fresh cache');
  await settings();
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.locator('#settings-search').fill('');
  await page.locator('.theme-mode-tab[data-theme="dark"]').click();
  await page.locator('#settings-search').fill('天气');
  await page.screenshot({ animations: 'disabled', path: path.join(root, 'artifacts/weather-dark.png') });
  await page.locator('#settings-search').fill('');
  await page.locator('.theme-mode-tab[data-theme="light"]').click();
  await page.locator('#settings-search').fill('天气');
  await page.screenshot({ animations: 'disabled', path: path.join(root, 'artifacts/weather-light.png') });
  await page.setViewportSize({ width: 600, height: 800 });
  await page.locator('#weather-city').scrollIntoViewIfNeeded();
  const cityBox = await page.locator('#weather-city').boundingBox();
  const saveBox = await page.locator('#weather-save').boundingBox();
  assert.ok(cityBox && saveBox && cityBox.x >= 0 && saveBox.x + saveBox.width <= 600, 'weather city controls fit narrow viewport');
  await page.screenshot({ animations: 'disabled', path: path.join(root, 'artifacts/weather-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  mode = 'failure';
  await page.locator('#weather-refresh').click();
  await page.waitForFunction(() => /缓存|更新失败|暂时/.test(document.querySelector('#weather-status').textContent));
  assert.ok((await page.locator('#weather-temp').textContent()).includes('68'), 'failure preserves cached weather');
  mode = 'pending';
  const started = new Promise((resolve) => { pendingStarted = resolve; });
  await page.locator('#weather-refresh').click();
  let pendingTimeout;
  try { await Promise.race([started, new Promise((_, reject) => { pendingTimeout = setTimeout(() => reject(new Error('Pending weather request did not start')), 10000); })]); } finally { clearTimeout(pendingTimeout); }
  await page.waitForFunction(() => document.querySelector('#weather-refresh').disabled);
  await page.locator('#weather-enabled').uncheck();
  releasePending?.();
  await page.waitForFunction(async () => (await chrome.storage.local.get('weatherEnabled')).weatherEnabled === false);
  assert.equal(await page.locator('#weather-pill').isVisible(), false, 'disable hides weather immediately');
  await page.reload();
  await page.waitForFunction(() => window.OpenTabWeather && document.querySelector('#weather-status').textContent.includes('天气已关闭'));
  assert.equal(await page.locator('#weather-pill').isVisible(), false, 'disabled persists');
  const count = requests;
  await settings();
  await page.locator('#weather-city').fill('   ');
  await page.locator('#weather-save').click();
  await page.waitForFunction(() => document.querySelector('#weather-status').textContent.includes('有效城市'));
  assert.equal(requests, count, 'invalid city must not send a request');
  assert.equal(await page.evaluate(() => window.__weatherGeoCalls), 0);
  assert.deepEqual(errors, [], 'no uncaught page errors');
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ animations: 'disabled', path: path.join(root, 'artifacts/weather-settings.png') });
  console.log('weather E2E passed: privacy default, opt-in, cache, units, failure, disable, validation');
} finally {
  releasePending?.();
  await context.close();
}
