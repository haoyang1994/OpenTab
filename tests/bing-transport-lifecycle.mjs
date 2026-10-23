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
  let cdp, page, today, primaryError, archiveRequests = 0, phase = 'seed fixture';
  const errors = [], lifecycle = [], consoleErrors = [];
  const versions = new Map(), watchers = new Set();
  const record = entry => { lifecycle.push(entry); if (lifecycle.length > 40) lifecycle.shift(); };
  context.on('serviceworker', worker => record({ event: 'playwright-serviceworker', url: worker.url() }));
  context.on('console', message => {
    if (message.type() === 'error' && consoleErrors.length < 20) consoleErrors.push(message.text().slice(0, 500));
  });
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
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(home); await ready(page); await pixels(page, old, [255, 0, 0]);

    // Real stopped worker, not a mocked runtime.sendMessage. Chrome must wake
    // it from this same page, then decode and durably commit the blue image.
    phase = 'observe initial worker';
    cdp = await context.newCDPSession(page);
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updated }) => {
      updated.forEach(version => {
        const { versionId, registrationId, scriptURL, runningStatus, status, targetId } = version;
        versions.set(versionId, version);
        record({ event: 'worker-version', versionId, registrationId, scriptURL, runningStatus, status, targetId });
      });
      watchers.forEach(check => check());
    });
    cdp.on('ServiceWorker.workerErrorReported', ({ errorMessage }) => record({ event: 'worker-error', ...errorMessage,
      errorMessage: errorMessage.errorMessage.slice(0, 500) }));
    const waitVersion = (predicate, state) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { watchers.delete(check); reject(new Error(`Extension worker lifecycle did not reach ${state}`)); }, 10000);
      const check = () => {
        const match = [...versions.values()].find(predicate);
        if (match) { clearTimeout(timer); watchers.delete(check); resolve(match); }
      };
      watchers.add(check); check();
    });
    await cdp.send('ServiceWorker.enable');
    const workerURL = worker.url();
    const running = await waitVersion(version => version.scriptURL === workerURL && version.runningStatus === 'running', 'initial running');
    phase = 'stop worker';
    const stopped = waitVersion(version => version.versionId === running.versionId && version.runningStatus === 'stopped', 'stopped');
    await Promise.all([stopped, cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId })]);
    // Chromium can reuse the stopped DevTools target. Playwright emits
    // serviceworker for a newly attached target, not every worker restart.
    // The same version must actually return to running after our observed stop.
    phase = 'wake stopped worker';
    const [restarted] = await Promise.all([
      waitVersion(version => version.versionId === running.versionId && version.runningStatus === 'running', 'restarted running'),
      page.click('#refresh-bg-btn')
    ]);
    phase = 'commit blue pixels after worker wake';
    await pixels(page, blue, [0, 0, 255]);
    assert.equal(archiveRequests, 1, 'worker wake must not duplicate successful archive work');
    console.log(`Native Bing worker wake passed: version=${restarted.versionId}, reusedTarget=${restarted.targetId === running.targetId}, durable blue pixels, archiveRequests=${archiveRequests}`);
    await page.screenshot({ path: path.join(artifacts, 'bing-worker-restart-pixels.png'), animations: 'disabled' });
    await cdp.detach(); cdp = null;

    // Reload the isolated extension with the tab still open. Chrome may close
    // extension tabs or replace their document; do not invent a stale context.
    // Unlike stopWorker, extension reload unregisters/dooms the old version;
    // a new target event here proves that the extension was actually reloaded.
    phase = 'reload extension';
    await page.evaluate(() => { window.__transportDocument = 'before-extension-reload'; });
    const beforeReloadWorkers = new Set(context.serviceWorkers());
    const [reloaded] = await Promise.all([
      context.waitForEvent('serviceworker', { predicate: next => !beforeReloadWorkers.has(next) && next.url() === workerURL, timeout: 15000 }),
      page.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 0); }).catch(error => {
        if (!reloadDisposed(error)) throw error;
        // The new worker event must still prove that reload executed.
      })
    ]);
    worker = reloaded;
    phase = 'observe old tab after extension reload';
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
    phase = 'fresh tab durable reload and green refresh';
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(home); await ready(page); await pixels(page, blue, [0, 0, 255]);
    await page.click('#refresh-bg-btn'); await pixels(page, green, [0, 255, 0]);
    assert.equal(archiveRequests, 2, 'fresh tab uses the durable next index after extension reload');
    assert.deepEqual(errors, [], 'native worker stop/reload must not leak page exceptions');
    await page.screenshot({ path: path.join(artifacts, 'bing-extension-reload-pixels.png'), animations: 'disabled' });
    console.log(`Native Bing transport lifecycle passed: stopped worker woke, same-page pixels committed, extension reload preserved storage, old tab=${oldTabState}, fresh-tab refresh succeeded`);
  } catch (error) {
    primaryError = error;
    // This context contains only generated fixture data. Capture its own state,
    // not the unrelated primary suite page, and never replace the test failure.
    const diagnostic = { phase, archiveRequests, lifecycle, errors, consoleErrors, pageClosed: !page || page.isClosed() };
    if (page && !page.isClosed()) {
      let timer;
      try {
        diagnostic.page = await Promise.race([
          page.evaluate(async () => {
            const layer = document.getElementById('background-layer'), style = layer && getComputedStyle(layer);
            const state = { url: location.href, runtimeId: globalThis.chrome?.runtime?.id,
              inline: layer?.style.backgroundImage, computed: style?.backgroundImage, opacity: style?.opacity,
              loading: layer?.classList.contains('loading'), overlays: layer?.querySelectorAll('.bg-fade-in').length,
              disabled: document.getElementById('refresh-bg-btn')?.disabled, toast: document.getElementById('toast')?.textContent };
            try { state.stored = await chrome.storage.local.get(['background', 'bingIndex']); }
            catch (failure) { state.storageError = failure.message; }
            return state;
          }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture state snapshot timed out')), 2000); })
        ]);
      } catch (failure) { diagnostic.snapshotError = failure.message; }
      finally { clearTimeout(timer); }
      try { await page.screenshot({ path: path.join(artifacts, 'bing-transport-lifecycle-failure.png'), timeout: 3000 }); }
      catch (failure) { diagnostic.screenshotError = failure.message; }
    }
    console.error('Native Bing transport lifecycle failure', JSON.stringify(diagnostic));
    throw error;
  } finally {
    await cdp?.detach().catch(() => {});
    try { await context.close(); }
    catch (error) {
      if (!primaryError) throw error;
      console.error('Native Bing transport cleanup failed after test failure:', error.message);
    }
  }
}
