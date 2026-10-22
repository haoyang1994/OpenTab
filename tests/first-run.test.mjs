import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { formatConsoleError, isAllowedConsoleError } from './console-allow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');
const ARTIFACTS = fs.existsSync('/opt/cursor/artifacts')
  ? '/opt/cursor/artifacts'
  : path.join(EXTENSION_PATH, 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const BING_JPG = fs.readFileSync(path.join(__dirname, 'fixtures/bing-test.jpg'));
const BANNED = ['北京 (UTC+8)', '10:30', '上午好，今天也很顺利。', '2026年3月21日', '定位中'];
const E4_TZ = 'America/New_York';
const E4_FORMAT = '24h';

function expectedClockAt(at, tz = E4_TZ, clockFormat = E4_FORMAT, showSeconds = false) {
  const options = {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: clockFormat === '12h'
  };
  if (showSeconds) options.second = '2-digit';
  const time = new Intl.DateTimeFormat('zh-CN', options)
    .formatToParts(at)
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
  const date = at.toLocaleDateString('zh-CN', {
    timeZone: tz,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });
  return { time, date };
}

function clockSampleMatches(sample) {
  const at = new Date(sample.at);
  for (const delta of [-1000, 0, 1000]) {
    const expected = expectedClockAt(new Date(at.getTime() + delta));
    if (sample.time === expected.time && (!sample.date || sample.date === expected.date)) {
      return true;
    }
  }
  return false;
}

function assertClockSample(sample, label) {
  assert.ok(sample, `${label} missing`);
  assert.ok(sample.time, `${label} empty time`);
  assert.ok(sample.date, `${label} empty date`);
  assert.match(sample.time, /^\d{2}:\d{2}$/, `${label} time ${sample.time}`);
  const expected = expectedClockAt(new Date(sample.at));
  assert.ok(
    clockSampleMatches(sample),
    `${label} time=${sample.time} date=${sample.date} at=${sample.at} expected≈${expected.time} ${expected.date}`
  );
  assert.equal(sample.ampm, '', `${label} ampm text`);
  assert.equal(sample.ampmDisplay, 'none', `${label} ampm display`);
}

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
    locale: 'zh-CN',
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
            url: cfg.indexed ? `/th?id=INDEX${new URL(url).searchParams.get('idx')}.jpg` : '/th?id=TEST.jpg',
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
        if (cfg.imageDelay) await new Promise(resolve => setTimeout(resolve, cfg.imageDelay));
        if (cfg.imageGate) await cfg.imageGate;
        if (cfg.indexed) {
          const color = ['#ff0000', '#0000ff', '#00ff00', '#ffff00'][Number(/INDEX(\d+)/.exec(url)?.[1] || 0) % 4];
          return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>` });
        }
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
    const formatted = formatConsoleError(msg);
    if (isAllowedConsoleError(formatted)) return;
    errors.console.push(formatted);
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

// Inspect the active rendered base source, not the persisted URL. Distinct
// synthetic colors catch reused cache/blob pixels even when URLs differ.
async function assertActiveBingColor(page, expected, label) {
  // home.css transitions the background shorthand for 600ms. Chromium can
  // report cross-fade(old, new) even after opacity has reached 1; wait for the
  // committed single source rather than parsing an intermediate animation.
  await page.waitForFunction(() => {
    const layer = document.getElementById('background-layer');
    const style = getComputedStyle(layer);
    return Number(style.opacity) === 1
      && /^url\((?:"[^"]*"|'[^']*'|[^()]*)\)$/.test(style.backgroundImage)
      && style.backgroundImage === layer.style.backgroundImage;
  }, null, { timeout: 5000 });
  const rendered = await page.evaluate(async () => {
    const layer = document.getElementById('background-layer');
    const style = getComputedStyle(layer);
    const src = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage)?.[1];
    if (!src) return { src: style.backgroundImage };
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 1, 1);
    return { src, rgb: Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3),
      overlays: layer.querySelectorAll('.bg-fade-in').length,
      loading: layer.classList.contains('loading'), bootLqip: layer.classList.contains('boot-lqip'), opacity: Number(style.opacity), display: style.display, visibility: style.visibility,
      video: getComputedStyle(document.getElementById('background-video')).display };
  });
  assert.deepEqual(rendered.rgb, expected, `${label}: active base pixels ${JSON.stringify(rendered)}`);
  assert.equal(rendered.overlays, 0, `${label}: no transient overlay instead of committed pixels`);
  assert.equal(rendered.loading, false);
  assert.equal(rendered.bootLqip, false, `${label}: full photo must replace blurred boot preview`);
  assert.equal(rendered.opacity, 1, `${label}: active photo must be fully visible`);
  assert.notEqual(rendered.display, 'none'); assert.equal(rendered.visibility, 'visible');
  assert.equal(rendered.video, 'none', 'video must not cover the new photo');
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
      try {
        const TZ = 'America/New_York';
        window.__otLog = [];
        window.__otFirstFrame = null;
        window.__otPreLoadState = null;
        window.__otInitErr = null;
        function expectedNow() {
          const at = Date.now();
          const n = new Date(at);
          const time = new Intl.DateTimeFormat('zh-CN', {
            timeZone: TZ,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).formatToParts(n).filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
          const date = n.toLocaleDateString('zh-CN', {
            timeZone: TZ,
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
          });
          return { time, date, at };
        }
        function snap(tag) {
          const timeEl = document.getElementById('time');
          const ampmEl = document.getElementById('ampm');
          const dateEl = document.getElementById('date');
          const exp = expectedNow();
          return {
            tag,
            time: timeEl ? (timeEl.textContent || '').trim() : '',
            ampm: ampmEl ? (ampmEl.textContent || '').trim() : '',
            ampmDisplay: ampmEl ? (ampmEl.style.display || '') : '',
            date: dateEl ? (dateEl.textContent || '').trim() : '',
            expectedTime: exp.time,
            expectedDate: exp.date,
            at: exp.at
          };
        }
        function remember(rec) {
          window.__otLog.push(rec);
          return rec;
        }
        const captureFirst = () => {
          const s = snap('first-frame');
          if (s.time && !window.__otFirstFrame) {
            window.__otFirstFrame = remember(s);
          }
          return Boolean(window.__otFirstFrame);
        };
        function wrapStorage() {
          if (!window.chrome || !chrome.storage || !chrome.storage.local || chrome.storage.local.__otWrapped) return;
          const orig = chrome.storage.local.get.bind(chrome.storage.local);
          const wrapped = function (keys, callback) {
            const isLoadState = Array.isArray(keys)
              && keys.includes('timezone')
              && keys.includes('clockFormat')
              && keys.includes('icons');
            const before = (result) => {
              if (isLoadState && !window.__otPreLoadState) {
                window.__otPreLoadState = remember(snap('pre-loadState'));
              }
              return result;
            };
            if (typeof callback === 'function') {
              return orig(keys, function (result) {
                before(result);
                callback(result);
              });
            }
            const ret = orig(keys);
            if (ret && typeof ret.then === 'function') {
              return ret.then((result) => {
                before(result);
                return result;
              });
            }
            return ret;
          };
          try {
            chrome.storage.local.get = wrapped;
          } catch (e) {
            Object.defineProperty(chrome.storage.local, 'get', { configurable: true, value: wrapped });
          }
          chrome.storage.local.__otWrapped = true;
        }
        wrapStorage();
        try {
          const root = document.documentElement || document;
          const firstObs = new MutationObserver(() => { if (captureFirst()) firstObs.disconnect(); });
          firstObs.observe(root, { childList: true, characterData: true, subtree: true });
        } catch (e) {
          window.__otInitErr = String(e && e.stack || e);
        }
        (function pump() {
          if (captureFirst()) return;
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pump);
          else setTimeout(pump, 0);
        }());
        document.addEventListener('DOMContentLoaded', () => {
          wrapStorage();
          captureFirst();
          const layer = document.getElementById('background-layer');
          const ampmEl = document.getElementById('ampm');
          window.__otDcl = {
            themeLight: document.body.classList.contains('theme-light'),
            bg: layer ? (layer.getAttribute('style') || '') + layer.style.background + layer.style.backgroundImage : '',
            tz: document.getElementById('timezone-label')?.textContent || '',
            time: document.getElementById('time')?.textContent || '',
            ampm: ampmEl ? (ampmEl.textContent || '').trim() : '',
            ampmDisplay: ampmEl ? (ampmEl.style.display || '') : '',
            date: document.getElementById('date')?.textContent || '',
            at: Date.now()
          };
        });
      } catch (e) {
        window.__otInitErr = String(e && e.stack || e);
      }
    };
    const ext = await launchExt();
    await waitStorage(ext.serviceWorker, (value) => Boolean(value?.background));
    await storageSet(ext.serviceWorker, {
      themeMode: 'light',
      background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f 0%, #537895 100%)', source: 'gradient' },
      timezone: E4_TZ,
      clockFormat: E4_FORMAT,
      showSeconds: false
    });
    await openHome(ext.page, ext.extensionId);
    await ext.page.waitForFunction(() => (document.getElementById('time')?.textContent || '').trim().length > 0, null, { timeout: 8000 });
    await ext.page.waitForFunction(() => {
      try {
        const data = JSON.parse(localStorage.getItem('opentab.boot.v1') || 'null');
        return data
          && data.tz === 'America/New_York'
          && data.clockFormat === '24h'
          && data.showSeconds === false;
      } catch {
        return false;
      }
    }, null, { timeout: 8000 });
    await ext.context.addInitScript(observer);
    ext.net.bing.length = 0;
    await ext.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await ext.page.waitForFunction(
      () => window.__otFirstFrame && window.__otPreLoadState && window.__otDcl,
      null,
      { timeout: 8000 }
    );
    const snap = await ext.page.evaluate(() => window.__otDcl);
    const seen = await ext.page.evaluate(() => ({
      first: window.__otFirstFrame,
      pre: window.__otPreLoadState,
      log: window.__otLog
    }));
    assert.equal(snap.themeLight, true, 'E4 DCL theme-light');
    assert.match(String(snap.bg), /linear-gradient/);
    assert.match(String(snap.tz), /美东 \(UTC-5\)|美东 \(UTC-4\)/);
    assertClockSample(seen.first, 'E4 first frame');
    assertClockSample(seen.pre, 'E4 before loadState');
    assertClockSample({
      time: String(snap.time || '').trim(),
      date: String(snap.date || '').trim(),
      ampm: String(snap.ampm || '').trim(),
      ampmDisplay: snap.ampmDisplay,
      at: snap.at
    }, 'E4 DCL');
    for (const rec of seen.log) {
      if (rec.ampm === 'AM' || rec.ampm === 'PM') {
        assert.equal(true, false, `E4 ${rec.tag} flashed ${rec.ampm} at ${rec.at}`);
      }
      if (rec.time) {
        assert.match(rec.time, /^\d{2}:\d{2}$/, `E4 ${rec.tag} time ${rec.time}`);
        assert.ok(clockSampleMatches(rec), `E4 ${rec.tag} wrong time ${rec.time} date=${rec.date} expected≈${rec.expectedTime}`);
      }
      if (rec.date) {
        assert.ok(clockSampleMatches(rec), `E4 ${rec.tag} wrong date ${rec.date}`);
      }
      for (const banned of BANNED) {
        const blob = `${rec.time}\n${rec.ampm}\n${rec.date}`;
        assert.equal(blob.includes(banned), false, `E4 ${rec.tag} saw ${banned}`);
      }
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
    assert.equal(updated.bingIndex, 1, 'E5 next manual wallpaper advances beyond daily index zero');
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
    // Boot intentionally paints a local LQIP before Cache Storage/image decoding
    // finishes. Wait for the required offline wallpaper, not a fixed CI-speed delay.
    // E10 above independently retains its first-paint performance budget.
    await ext.page.waitForFunction(() => {
      const layer = document.getElementById('background-layer');
      return /blob:|TEST/.test(layer?.style.backgroundImage || '');
    }, null, { timeout: 5000 });
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

  {
    const ext = await launchExt();
    try {
      ext.cfg.indexed = true;
      await ext.page.emulateMedia({ reducedMotion: 'no-preference' });
      await waitStorage(ext.serviceWorker, value => Boolean(value?.background));
      await openHome(ext.page, ext.extensionId);
      const button = ext.page.locator('#refresh-bg-btn');
      await button.click();
      await waitStorage(ext.serviceWorker, value => /INDEX0/.test(value?.background?.value || ''), 12000);
      await ext.page.waitForFunction(() => !document.getElementById('refresh-bg-btn').disabled);
      await assertActiveBingColor(ext.page, [255, 0, 0], 'E7 first refresh without reload');
      // A genuinely slow cached image must outlive the former 8-second RPC
      // ceiling without being discarded. Repeated physical clicks stay single-flight.
      ext.cfg.imageDelay = 9000;
      await button.click();
      assert.equal(await button.isDisabled(), true);
      const box = await button.boundingBox();
      await ext.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await waitStorage(ext.serviceWorker, value => /INDEX1/.test(value?.background?.value || ''), 22000);
      await ext.page.waitForFunction(() => !document.getElementById('refresh-bg-btn').disabled);
      assert.equal(ext.net.bing.filter(url => url.includes('HPImageArchive') && new URL(url).searchParams.get('idx') === '1').length, 1);
      await assertActiveBingColor(ext.page, [0, 0, 255], 'E7 second refresh without reload');
      await ext.page.screenshot({ path: path.join(ARTIFACTS, 'e7-immediate-blue-wallpaper.png') });
      ext.cfg.imageDelay = 0;
      await ext.page.reload({ waitUntil: 'domcontentloaded' });
      await ext.page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0);
      assert.match((await storageGet(ext.serviceWorker, ['background'])).background.value, /INDEX1/);
      const previous = await storageGet(ext.serviceWorker, ['background', 'bingIndex']);
      ext.cfg.bingMode = '500';
      await button.click();
      await ext.page.waitForFunction(() => !document.getElementById('refresh-bg-btn').disabled);
      assert.deepEqual(await storageGet(ext.serviceWorker, ['background', 'bingIndex']), previous);
      assert.match(await ext.page.locator('#toast').textContent(), /已保留原背景/);
      ext.cfg.bingMode = 'ok';
      await button.click();
      await waitStorage(ext.serviceWorker, value => /INDEX2/.test(value?.background?.value || ''), 12000);
      await ext.page.waitForFunction(() => !document.getElementById('refresh-bg-btn').disabled);
      await assertActiveBingColor(ext.page, [0, 255, 0], 'E7 retry without reload');
      let releaseImage;
      ext.cfg.imageGate = new Promise(resolve => { releaseImage = resolve; });
      await button.click();
      // Waiting on the worker request, not a fixed render delay, makes the
      // external replacement deterministically precede the stale completion.
      const deadline = Date.now() + 5000;
      while (!ext.net.bing.some(url => url.includes('INDEX3')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(ext.net.bing.some(url => url.includes('INDEX3')));
      const external = { type: 'gradient', value: 'linear-gradient(#123, #456)', source: 'gradient' };
      await ext.page.evaluate(() => {
        window.__externalWallpaperSeen = false;
        const listener = (changes, area) => {
          if (area === 'local' && changes.background?.newValue?.type === 'gradient') {
            window.__externalWallpaperSeen = true; chrome.storage.onChanged.removeListener(listener);
          }
        };
        chrome.storage.onChanged.addListener(listener);
      });
      await storageSet(ext.serviceWorker, { background: external });
      await ext.page.waitForFunction(() => window.__externalWallpaperSeen === true);
      releaseImage(); ext.cfg.imageGate = null;
      await ext.page.waitForFunction(() => !document.getElementById('refresh-bg-btn').disabled);
      assert.deepEqual((await storageGet(ext.serviceWorker, ['background'])).background, external);
      await ext.page.reload({ waitUntil: 'domcontentloaded' });
      await ext.page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0);
      assert.deepEqual((await storageGet(ext.serviceWorker, ['background'])).background, external);
      assert.equal(ext.errors.page.length, 0, ext.errors.page.join(' | '));
      console.log('E7 passed: native Bing refresh clicks, slow image, single flight, durable reload, failure/retry and stale choice');
    } finally { await ext.context.close(); }
  }

  console.log('first-run e2e passed');
}

run().catch((error) => {
  console.error('first-run e2e failed:', error);
  process.exit(1);
});
