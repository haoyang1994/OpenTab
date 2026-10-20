import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');
const ARTIFACTS = fs.existsSync('/opt/cursor/artifacts')
  ? '/opt/cursor/artifacts'
  : path.join(EXTENSION_PATH, 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const BING_JPG = fs.readFileSync(path.join(__dirname, 'fixtures/bing-test.jpg'));
const BANNED = ['北京 (UTC+8)', '10:30', '上午好，今天也很顺利。', '2026年3月21日', '定位中'];

function ymd(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${m}${d}`;
}

function yesterdayYmd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

function resolveHeadless(defaultValue) {
  if (process.env.HEADLESS === 'false') return false;
  if (process.env.HEADLESS === 'true') return true;
  return defaultValue;
}

async function launchExt() {
  const net = { bing: [], allExternal: [] };
  const cfg = { bingMode: 'ok' };
  const errors = { page: [], console: [], sw: [] };
  const context = await chromium.launchPersistentContext('', {
    headless: resolveHeadless(false),
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });
  await context.addInitScript(() => {
    const geo = navigator.geolocation;
    if (!geo) return;
    geo.getCurrentPosition = function (_ok, err) {
      if (typeof err === 'function') err({ code: 1, message: 'denied' });
    };
  });

  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension://') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    if (url.includes('wttr.in')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (url.includes('bing.com')) {
      net.bing.push(url);
      net.allExternal.push({ url, at: Date.now() });
      if (cfg.bingMode === '500') {
        return route.fulfill({ status: 500, body: 'nope' });
      }
      if (url.includes('HPImageArchive')) {
        const payload = {
          images: [{
            startdate: ymd(),
            url: '/th?id=TEST.jpg',
            copyright: 'Test Copyright',
            title: 'Test Wallpaper'
          }]
        };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload)
        });
      }
      if (url.includes('/th?id=TEST.jpg') || url.includes('th?id=')) {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: BING_JPG });
      }
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
    }
    if (/\.(ico|png|jpe?g|svg|webp|gif)(\?|$)/i.test(url) || url.includes('favicon')) {
      return route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL });
    }
    return route.continue();
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
  try {
    serviceWorker.on('console', (msg) => {
      if (msg.type() === 'error') errors.sw.push(msg.text());
    });
  } catch {}

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.page.push(String(error)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const url = msg.location()?.url || '';
    if (/favicon\.ico/i.test(text) || /favicon\.ico/i.test(url)) return;
    if (text.includes('Failed to fetch Bing image')) return;
    errors.console.push(url ? `${text} (${url})` : text);
  });

  const extensionId = serviceWorker.url().split('/')[2];
  return { context, page, serviceWorker, extensionId, net, cfg, errors };
}

async function storageGet(sw, keys) {
  return sw.evaluate((list) => new Promise((resolve) => {
    chrome.storage.local.get(list, resolve);
  }), keys);
}

async function storageSet(sw, payload) {
  await sw.evaluate((data) => new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  }), payload);
}

async function waitStorage(sw, pred, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await storageGet(sw, null);
    if (pred(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('storage wait timeout');
}

async function openHome(page, extensionId) {
  await page.goto(`chrome-extension://${extensionId}/home.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });
  await page.waitForSelector('#time', { timeout: 10000 });
}

async function run() {
  {
    const ext = await launchExt();
    const stored = await waitStorage(ext.serviceWorker, (value) => (
      value?.background?.value === 'assets/default_background/default.webp'
    ));
    assert.equal(stored.background.value, 'assets/default_background/default.webp');
    await openHome(ext.page, ext.extensionId);
    await ext.page.waitForTimeout(600);
    assert.equal(ext.net.bing.length, 0, `E1 bing requests: ${ext.net.bing.join(' | ')}`);
    const timeText = (await ext.page.locator('#time').textContent() || '').trim();
    assert.match(timeText, /\d{1,2}:\d{2}/);
    for (const banned of BANNED) {
      const body = await ext.page.locator('#clock-widget').innerText();
      assert.equal(body.includes(banned), false, `E1 saw ${banned}`);
    }
    await ext.page.screenshot({ path: path.join(ARTIFACTS, 'ac3_first_install.png'), fullPage: true });
    assert.equal(ext.errors.page.length, 0, ext.errors.page.join(' | '));
    console.log('E1 passed');
    await ext.context.close();
  }

  {
    const observer = () => {
      window.__otSeen = { tz: [], time: [], welcome: [] };
      const watch = (id, key) => {
        const rec = () => {
          const el = document.getElementById(id);
          if (el) window.__otSeen[key].push(el.textContent || '');
        };
        const obs = new MutationObserver(rec);
        const start = () => {
          const el = document.getElementById(id);
          if (!el) return false;
          obs.observe(el, { childList: true, characterData: true, subtree: true });
          rec();
          return true;
        };
        if (!start()) {
          const boot = new MutationObserver(() => { if (start()) boot.disconnect(); });
          boot.observe(document.documentElement, { childList: true, subtree: true });
        }
      };
      document.addEventListener('DOMContentLoaded', () => {
        const layer = document.getElementById('background-layer');
        window.__otDcl = {
          themeLight: document.body.classList.contains('theme-light'),
          bg: layer ? (layer.getAttribute('style') || '') + layer.style.background + layer.style.backgroundImage : '',
          tz: document.getElementById('timezone-label')?.textContent || '',
          time: document.getElementById('time')?.textContent || ''
        };
      });
      watch('timezone-label', 'tz');
      watch('time', 'time');
      watch('welcome-text', 'welcome');
    };
    const ext = await launchExt();
    await waitStorage(ext.serviceWorker, (value) => Boolean(value?.background));
    await storageSet(ext.serviceWorker, {
      themeMode: 'light',
      background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f 0%, #537895 100%)', source: 'gradient' },
      timezone: 'America/New_York',
      clockFormat: '24h'
    });
    await openHome(ext.page, ext.extensionId);
    await ext.page.waitForFunction(() => (document.getElementById('time')?.textContent || '').trim().length > 0, null, { timeout: 8000 });
    await ext.page.waitForTimeout(400);
    await ext.context.addInitScript(observer);
    ext.net.bing.length = 0;
    await ext.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await ext.page.waitForFunction(() => window.__otDcl, null, { timeout: 8000 });
    const snap = await ext.page.evaluate(() => window.__otDcl);
    const seen = await ext.page.evaluate(() => window.__otSeen);
    assert.equal(snap.themeLight, true, 'E4 DCL theme-light');
    assert.match(String(snap.bg), /linear-gradient/);
    assert.match(String(snap.tz), /美东 \(UTC-5\)|美东 \(UTC-4\)/);
    assert.match(String(snap.time).trim(), /^\d{2}:\d{2}$/);
    const texts = [...seen.tz, ...seen.time, ...seen.welcome, snap.tz, snap.time].join('\n');
    for (const banned of BANNED) {
      assert.equal(texts.includes(banned), false, `E4 saw ${banned}`);
    }
    await ext.page.screenshot({ path: path.join(ARTIFACTS, 'ac3_light_theme.png'), fullPage: true });
    console.log('E4 passed');

    const perf = await ext.page.evaluate(() => {
      const bootMark = performance.getEntriesByName('opentab:boot-applied')[0];
      const bootMeasure = performance.getEntriesByName('opentab:boot')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const nav = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource').filter((entry) => /bing\.com/.test(entry.name));
      return {
        bootAt: bootMark ? bootMark.startTime : null,
        bootMs: bootMeasure ? bootMeasure.duration : null,
        fcp: fcp ? fcp.startTime : null,
        dcl: nav ? nav.domContentLoadedEventStart : null,
        firstExternal: resources[0] ? resources[0].startTime : null
      };
    });
    console.log('E10 metrics', JSON.stringify(perf));
    assert.ok(perf.bootAt != null, 'E10 boot-applied missing');
    assert.ok(perf.bootMs != null && perf.bootMs <= 10, `E10 boot ${perf.bootMs}ms`);
    assert.ok(perf.fcp != null && perf.fcp <= 400, `E10 FCP ${perf.fcp}ms`);
    if (perf.firstExternal != null) {
      assert.ok(perf.firstExternal > perf.dcl, `E10 external ${perf.firstExternal} before DCL ${perf.dcl}`);
    }
    console.log('E10 passed');
    await ext.context.close();
  }

  {
    const ext = await launchExt();
    await waitStorage(ext.serviceWorker, (value) => Boolean(value?.background));
    await storageSet(ext.serviceWorker, {
      background: {
        type: 'bing',
        value: 'https://www.bing.com/th?id=OLD.jpg',
        source: 'bing',
        bing: { startdate: yesterdayYmd() }
      }
    });
    ext.net.bing.length = 0;
    await openHome(ext.page, ext.extensionId);
    const updated = await waitStorage(ext.serviceWorker, (value) => (
      String(value?.background?.value || '').includes('TEST')
      && value?.background?.bing?.startdate === ymd()
    ), 12000);
    assert.match(String(updated.background.value), /TEST/);
    assert.equal(updated.background.bing.startdate, ymd());
    const cached = await ext.page.evaluate(async () => {
      const cache = await caches.open('opentab-bing-v1');
      const keys = await cache.keys();
      return keys.map((req) => req.url);
    });
    assert.ok(cached.some((url) => url.includes('TEST')), `E5 cache ${cached.join(' | ')}`);
    ext.net.bing.length = 0;
    await ext.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await ext.page.waitForTimeout(800);
    assert.equal(ext.net.bing.filter((url) => url.includes('HPImageArchive')).length, 0, 'E5 reload API');
    await ext.context.setOffline(true);
    await ext.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await ext.page.waitForTimeout(400);
    const bg = await ext.page.evaluate(() => {
      const layer = document.getElementById('background-layer');
      return (layer.style.backgroundImage || '') + (layer.getAttribute('style') || '');
    });
    assert.ok(/blob:|TEST/.test(bg), `E5 offline bg ${bg}`);
    await ext.page.screenshot({ path: path.join(ARTIFACTS, 'ac3_offline.png'), fullPage: true });
    assert.equal(ext.errors.console.length, 0, ext.errors.console.join(' | '));
    console.log('E5 passed');
    await ext.context.close();
  }

  {
    const ext = await launchExt();
    ext.cfg.bingMode = '500';
    await waitStorage(ext.serviceWorker, (value) => Boolean(value?.background));
    await storageSet(ext.serviceWorker, {
      background: {
        type: 'bing',
        value: 'assets/default_background/default.webp',
        source: 'bing',
        bing: { startdate: yesterdayYmd() }
      }
    });
    await openHome(ext.page, ext.extensionId);
    await ext.page.waitForTimeout(800);
    const bg = await ext.page.evaluate(() => {
      const layer = document.getElementById('background-layer');
      return (layer.style.backgroundImage || '') + (layer.style.background || '');
    });
    assert.ok(/default\.webp|linear-gradient|url\(/.test(bg), `E6 bg ${bg}`);
    assert.equal(ext.errors.console.length, 0, `E6 console ${ext.errors.console.join(' | ')}`);
    console.log('E6 passed');
    await ext.context.close();
  }

  console.log('first-run e2e passed');
}

run().catch((error) => {
  console.error('first-run e2e failed:', error);
  process.exit(1);
});
