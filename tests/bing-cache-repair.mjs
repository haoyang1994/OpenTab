import assert from 'node:assert/strict';
import path from 'node:path';

// Consumed by the existing native extension suite. Uses the real MV3 worker,
// CacheStorage, image decoder, page handler and durable Chrome storage callback.
export async function verifyBingCacheRepair(page, worker, resetHome, artifacts) {
  const context = page.context();
  const previous = await worker.evaluate(() => chrome.storage.local.get(null));
  const old = 'https://www.bing.com/th?id=OpenTabRepairOld.jpg';
  const next = 'https://www.bing.com/th?id=OpenTabRepairNext.jpg';
  const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`;
  const today = await page.evaluate(() => OpenTabBing.ymd(new Date()));
  let mode = 'ok', imageRequests = 0;
  const route = async request => {
    const url = request.request().url();
    if (url.includes('HPImageArchive.aspx')) {
      if (mode === 'offline') return request.fulfill({ status: 503, body: 'Synthetic unavailable archive' });
      return request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: [{ url: '/th?id=OpenTabRepairNext.jpg', startdate: today, title: 'Cache repair fixture' }] }) });
    }
    if (url === next) {
      imageRequests++;
      return request.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg('#0000ff') });
    }
    return request.fulfill({ status: 404, body: 'Unexpected fixture URL' });
  };
  const pixels = async (rgb, label, settled = true) => {
    await page.waitForFunction(settled => {
      const layer = document.getElementById('background-layer'), style = getComputedStyle(layer);
      return /^url\(/.test(style.backgroundImage) && style.backgroundImage === layer.style.backgroundImage
        && (!settled || (Number(style.opacity) === 1 && !layer.classList.contains('loading')
          && layer.querySelectorAll('.bg-fade-in').length === 0));
    }, settled);
    const actual = await page.evaluate(async () => {
      const layer = document.getElementById('background-layer'), style = getComputedStyle(layer);
      const src = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage)?.[1];
      if (!src) throw new Error(`Not a committed image: ${style.backgroundImage}`);
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const draw = canvas.getContext('2d'); draw.drawImage(image, 0, 0, 1, 1);
      return { rgb: [...draw.getImageData(0, 0, 1, 1).data].slice(0, 3), src,
        overlays: layer.querySelectorAll('.bg-fade-in').length, display: style.display, visibility: style.visibility,
        opacity: Number(style.opacity), loading: layer.classList.contains('loading'), video: getComputedStyle(document.getElementById('background-video')).display };
    });
    assert.deepEqual(actual.rgb, rgb, `${label}: active source decoded pixels`);
    assert.equal(actual.overlays, 0); assert.notEqual(actual.display, 'none'); assert.equal(actual.visibility, 'visible');
    assert.equal(actual.video, 'none');
    if (settled) { assert.equal(actual.opacity, 1); assert.equal(actual.loading, false); }
    return actual.src;
  };
  await context.route('https://www.bing.com/**', route);
  try {
    await worker.evaluate(async ({ old, next, red }) => {
      const cache = await caches.open('opentab-bing-v1');
      await cache.put(old, new Response(red, { headers: { 'content-type': 'image/svg+xml' } }));
      await cache.put(next, new Response('corrupt image body', { headers: { 'content-type': 'image/jpeg' } }));
    }, { old, next, red: svg('#ff0000') });
    await resetHome(page, { background: { type: 'bing', value: old, bing: { startdate: today, pinnedDate: today } },
      bingIndex: 0, bingCacheMeta: [{ url: old, startdate: today }, { url: next, startdate: today }], icons: [], folders: [{ id: 'folder-home', name: 'Home' }] });
    const originalSource = await pixels([255, 0, 0], 'Before repair');
    await page.evaluate(next => {
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      window.__repairSave = { original, pending: null };
      chrome.storage.local.set = (payload, callback) => {
        if (payload.background?.value === next) { window.__repairSave.pending = () => original(payload, callback); return; }
        return original(payload, callback);
      };
    }, next);
    await page.click('#refresh-bg-btn');
    await page.waitForFunction(() => typeof window.__repairSave?.pending === 'function');
    assert.equal(imageRequests, 1, 'a corrupt cache hit causes one real worker repair fetch');
    assert.equal(await pixels([255, 0, 0], 'Durable save pending', false), originalSource, 'old visible blob remains alive');
    await page.evaluate(() => OpenTabBingCache.updateBackground({ fade: false }));
    assert.equal(await pixels([255, 0, 0], 'Incidental render during save', false), originalSource);
    const cached = await worker.evaluate(async next => (await (await caches.open('opentab-bing-v1')).match(next)).text(), next);
    assert.match(cached, /#0000ff/, 'repair replaced the corrupt bytes, not merely the CSS URL');
    await page.evaluate(() => window.__repairSave.pending());
    await page.waitForFunction(() => !document.getElementById('refresh-bg-btn').disabled);
    const committed = await pixels([0, 0, 255], 'Repaired wallpaper on the same page');
    assert.notEqual(committed, originalSource);
    assert.equal((await worker.evaluate(() => chrome.storage.local.get('background'))).background.value, next);
    await page.screenshot({ path: path.join(artifacts, 'bing-cache-repair-committed.png'), animations: 'disabled' });
    await page.evaluate(() => { chrome.storage.local.set = window.__repairSave.original; delete window.__repairSave; });

    // Poison only the stored copy of the already-displayed blue image. A later
    // unrelated archive failure must retain its live blue blob, not reread it.
    await worker.evaluate(async next => (await caches.open('opentab-bing-v1')).put(next, new Response('corrupt again')), next);
    mode = 'offline';
    await page.click('#refresh-bg-btn');
    await page.waitForFunction(() => !document.getElementById('refresh-bg-btn').disabled && !document.getElementById('toast').classList.contains('hidden'));
    assert.equal(await pixels([0, 0, 255], 'Failed request retains previous pixels'), committed);
    assert.match(await page.locator('#toast').innerText(), /Bing.*(?:获取失败|information)/i);
    assert.equal(imageRequests, 1, 'failure did not reread or repair the old displayed source');
    await page.screenshot({ path: path.join(artifacts, 'bing-cache-repair-failure-retains-pixels.png'), animations: 'disabled' });
    console.log('Native Bing cache repair passed: real cached bytes/decoder, held durable save, same-page pixels and failure retention');
  } finally {
    await page.evaluate(() => { if (window.__repairSave) { chrome.storage.local.set = window.__repairSave.original; delete window.__repairSave; } }).catch(() => {});
    await context.unroute('https://www.bing.com/**', route);
    await worker.evaluate(async ({ old, next }) => {
      const cache = await caches.open('opentab-bing-v1'); await cache.delete(old); await cache.delete(next);
    }, { old, next });
    await resetHome(page, previous);
  }
}
