import assert from 'node:assert/strict';
import path from 'node:path';
import { waitForAsync } from './wait-for-async.mjs';

// Called once from the existing extension suite. Reload only this disposable
// profile; never invalidate the primary suite's Worker/page handles.
export async function verifyBingTransportLifecycle({ chromium, extensionPath, artifacts, headless }) {
  const context = await chromium.launchPersistentContext('', {
    headless, locale: 'zh-CN',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox', '--disable-dev-shm-usage']
  });
  const old = 'https://www.bing.com/th?id=OpenTabTransportOld.jpg';
  const blue = 'https://www.bing.com/th?id=OpenTabTransportBlue.jpg';
  const green = 'https://www.bing.com/th?id=OpenTabTransportGreen.jpg';
  const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`;
  let cdp, today, archiveRequests = 0;
  const errors = [];
  const reloadDisposed = error => /Execution context was destroyed|Target page, context or browser has been closed/.test(error.message);
  const ready = page => page.waitForFunction(() => globalThis.OpenTabBingCache
    && performance.getEntriesByName('opentab:initial-loader-end').length
    && !document.getElementById('homepage').inert, null, { timeout: 15000 });
  const pixels = async (page, url, rgb, persisted = true) => {
    await waitForAsync(page, async ({ url, rgb, persisted }) => {
      const layer = document.getElementById('background-layer'), style = getComputedStyle(layer);
      if (style.backgroundImage !== layer.style.backgroundImage || Number(style.opacity) !== 1
        || layer.classList.contains('loading') || layer.querySelector('.bg-fade-in')
        || document.getElementById('refresh-bg-btn').disabled) return false;
      if (persisted && (await chrome.storage.local.get('background')).background?.value !== url) return false;
      const src = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage)?.[1];
      if (!src) return false;
      const image = new Image(); image.src = src;
      try { await image.decode(); } catch (_) { return false; }
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const draw = canvas.getContext('2d'); draw.drawImage(image, 0, 0, 1, 1);
      return [...draw.getImageData(0, 0, 1, 1).data].slice(0, 3).every((value, index) => value === rgb[index]);
    }, { url, rgb, persisted }, { timeout: 15000 });
    const state = await page.evaluate(() => {
      const layer = document.getElementById('background-layer'), style = getComputedStyle(layer);
      return { src: style.backgroundImage, inline: layer.style.backgroundImage, opacity: Number(style.opacity),
        overlays: layer.querySelectorAll('.bg-fade-in').length, visibility: style.visibility, display: style.display,
        video: getComputedStyle(document.getElementById('background-video')).display };
    });
    assert.equal(state.src, state.inline); assert.equal(state.opacity, 1); assert.equal(state.overlays, 0);
    assert.equal(state.visibility, 'visible'); assert.notEqual(state.display, 'none'); assert.equal(state.video, 'none');
    return state.src;
  };
  try {
    await context.route(/^https?:\/\//, route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.bing.com' && url.pathname === '/HPImageArchive.aspx') {
        archiveRequests++;
        const image = Number(url.searchParams.get('idx')) === 0 ? blue : green;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: [{ url: image, startdate: today, title: 'Transport fixture' }] }) });
      }
      if ([blue, green].includes(url.href)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(url.href === blue ? '#0000ff' : '#00ff00') });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).host, home = `chrome-extension://${extensionId}/home.html`;
    today = await worker.evaluate(() => OpenTabBing.ymd(new Date()));
    // Join installation's transaction before seeding isolated fixture data.
    await worker.evaluate(() => OpenTabWorkspace.read(['background']));
    await worker.evaluate(async ({ old, red, today }) => {
      await (await caches.open('opentab-bing-v1')).put(old, new Response(red, { headers: { 'content-type': 'image/svg+xml' } }));
      await chrome.storage.local.set({ icons: [], folders: [{ id: 'folder-home', name: 'Home' }], currentFolderId: 'folder-home',
        background: { type: 'bing', value: old, source: 'bing', bing: { startdate: today, pinnedDate: today } },
        bingIndex: 0, bingCacheMeta: [{ url: old, startdate: today }] });
    }, { old, red: svg('#ff0000'), today });
    let page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(home); await ready(page); await pixels(page, old, [255, 0, 0]);

    // Real stopped worker, not a mocked runtime.sendMessage. Chrome must wake
    // it from this same page, then decode and durably commit the blue image.
    cdp = await context.newCDPSession(page);
    const versions = new Map(), watchers = new Set();
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updated }) => {
      updated.forEach(version => versions.set(version.versionId, version));
      watchers.forEach(check => check());
    });
    const waitVersion = predicate => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { watchers.delete(check); reject(new Error('Extension worker lifecycle did not reach expected state')); }, 10000);
      const check = () => {
        const match = [...versions.values()].find(predicate);
        if (match) { clearTimeout(timer); watchers.delete(check); resolve(match); }
      };
      watchers.add(check); check();
    });
    await cdp.send('ServiceWorker.enable');
    const running = await waitVersion(version => version.scriptURL === worker.url() && version.runningStatus === 'running');
    const stopped = waitVersion(version => version.versionId === running.versionId && version.runningStatus === 'stopped');
    await Promise.all([stopped, cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId })]);
    const [restarted] = await Promise.all([
      context.waitForEvent('serviceworker', { predicate: next => next.url() === worker.url(), timeout: 15000 }),
      page.click('#refresh-bg-btn')
    ]);
    worker = restarted;
    await pixels(page, blue, [0, 0, 255]);
    assert.equal(archiveRequests, 1, 'worker wake must not duplicate successful archive work');
    await page.screenshot({ path: path.join(artifacts, 'bing-worker-restart-pixels.png'), animations: 'disabled' });
    await cdp.detach(); cdp = null;

    // Reload the isolated extension with the tab still open. Chrome may close
    // extension tabs or replace their document; do not invent a stale context.
    await page.evaluate(() => { window.__transportDocument = 'before-extension-reload'; });
    const [reloaded] = await Promise.all([
      context.waitForEvent('serviceworker', { predicate: next => next !== worker && next.url() === worker.url(), timeout: 15000 }),
      page.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 0); }).catch(error => {
        if (!reloadDisposed(error)) throw error;
        // The new worker event must still prove that reload executed.
      })
    ]);
    worker = reloaded;
    let oldTabState = 'closed';
    if (!page.isClosed()) {
      const stale = await page.evaluate(() => ({ marker: window.__transportDocument, runtimeId: globalThis.chrome?.runtime?.id })).catch(error => {
        if (!reloadDisposed(error)) throw error;
        return null;
      });
      oldTabState = page.isClosed() ? 'closed' : stale?.marker
        ? (stale.runtimeId ? 'retained-context' : 'invalidated-context') : 'document-replaced';
      if (stale?.marker && !stale.runtimeId) {
        try {
          const previous = await page.locator('#background-layer').evaluate(layer => layer.style.backgroundImage);
          await page.click('#refresh-bg-btn');
          assert.equal(await pixels(page, blue, [0, 0, 255], false), previous);
          assert.match(await page.locator('#toast').innerText(), /刷新此标签页/);
          assert.equal(archiveRequests, 1, 'invalidated tab must not dispatch work');
        } catch (error) {
          if (!reloadDisposed(error)) throw error;
          oldTabState = page.isClosed() ? 'closed' : 'context-disposed-during-reload';
        }
      }
    }
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(home); await ready(page); await pixels(page, blue, [0, 0, 255]);
    await page.click('#refresh-bg-btn'); await pixels(page, green, [0, 255, 0]);
    assert.equal(archiveRequests, 2, 'fresh tab uses the durable next index after extension reload');
    assert.deepEqual(errors, [], 'native worker stop/reload must not leak page exceptions');
    await page.screenshot({ path: path.join(artifacts, 'bing-extension-reload-pixels.png'), animations: 'disabled' });
    console.log(`Native Bing transport lifecycle passed: stopped worker woke, same-page pixels committed, extension reload preserved storage, old tab=${oldTabState}, fresh-tab refresh succeeded`);
  } finally {
    await cdp?.detach().catch(() => {});
    await context.close();
  }
}
