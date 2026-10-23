importScripts('lib/bing-daily.js', 'scene-schema.js', 'workspace-persistence.js', 'lib/window-fullscreen.js');

const windowFullscreen = OpenTabWindowFullscreen.create(chrome);
chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === OpenTabWindowFullscreen.COMMAND) return windowFullscreen.toggle(tab);
});
chrome.windows?.onRemoved.addListener(id => windowFullscreen.removed(id));

const BING_CACHE = 'opentab-bing-v1';
const DEFAULT_LOCAL_BG = 'assets/default_background/default.webp';
// Keep below the page's 25 s message timeout. This includes response bodies,
// CacheStorage and metadata work, not just the time to receive HTTP headers.
const BING_REQUEST_TIMEOUT_MS = 20000;
let dailyInflight = null;

function withBingDeadline(work) {
  const controller = new AbortController();
  const timeoutError = new Error('Bing request timed out');
  let expired = false;
  let timer;
  const request = {
    signal: controller.signal,
    stage: 'archive',
    async wait(promise) {
      const value = await promise;
      // Cache/storage operations cannot be aborted. Do not continue a late
      // operation into pruning, metadata writes or a successful response.
      if (expired) throw timeoutError;
      return value;
    }
  };
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      reject(timeoutError);
    }, BING_REQUEST_TIMEOUT_MS);
  });
  // Racing is intentional: abort alone does not bound an unresponsive API or
  // CacheStorage operation. The guards above stop work that settles afterward.
  return Promise.race([Promise.resolve().then(() => work(request)), timeout])
    .catch((error) => {
      const failure = expired ? timeoutError : error;
      failure.bingStage = expired ? 'timeout' : (failure.bingStage || request.stage);
      throw failure;
    })
    .finally(() => clearTimeout(timer));
}

function absoluteBingUrl(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `https://www.bing.com${url}`;
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  OpenTabWorkspace.transaction(async ({ read, write }) => {
    const result = await read(null);
    if (result.icons) return;
    const defaults = {
      icons: [], background: { type: 'image', value: DEFAULT_LOCAL_BG, source: 'preset' },
      clockFormat: '12h', showSeconds: false, themeMode: 'light',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneMode: result.timezone ? 'fixed' : 'system', bingIndex: 0
    };
    await write(Object.fromEntries(Object.entries(defaults).filter(([key]) => result[key] === undefined)));
  }).catch((error) => console.warn('Initial workspace setup failed:', error));
});

async function fetchArchive(idx, request) {
  request.stage = 'archive';
  const safeIndex = Math.max(0, Math.min(Number.isInteger(idx) ? idx : 0, 7));
  const apiUrl = `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${safeIndex}&n=1&mkt=zh-CN`;
  const response = await request.wait(fetch(apiUrl, { signal: request.signal }));
  if (!response.ok) throw new Error(`Bing API status ${response.status}`);
  const data = await request.wait(response.json());
  const image = data?.images?.[0];
  if (!image?.url) throw new Error('Bing API response missing image url');
  return {
    url: absoluteBingUrl(image.url),
    startdate: image.startdate || '',
    title: image.title || '',
    copyright: image.copyright || '',
    nextIndex: (safeIndex + 1) % 8
  };
}

async function ensureCached(url, request, repair = false) {
  request.stage = 'cache';
  const cache = await request.wait(caches.open(BING_CACHE));
  const hit = !repair && await request.wait(cache.match(url));
  if (hit) return;
  request.stage = 'image';
  const imgResp = await request.wait(fetch(url, { signal: request.signal, ...(repair ? { cache: 'reload' } : {}) }));
  if (!imgResp.ok) throw new Error(`Bing image status ${imgResp.status}`);
  request.stage = 'cache';
  await request.wait(cache.put(url, imgResp.clone()));
}

async function pruneCache(meta, extra, request) {
  request.stage = 'cache';
  const entries = (Array.isArray(meta) ? meta : []).concat(extra ? [extra] : []);
  const keep = OpenTabBing.keepSet(entries);
  const keepUrls = new Set(keep.map((item) => item.url));
  const cache = await request.wait(caches.open(BING_CACHE));
  const keys = await request.wait(cache.keys());
  for (const req of keys) {
    if (!keepUrls.has(req.url)) await request.wait(cache.delete(req));
  }
  return keep;
}

async function doRefreshDaily(request) {
  const stored = await request.wait(chrome.storage.local.get(['background', 'bingCacheMeta']));
  const bg = stored.background || {};
  const image = await fetchArchive(0, request);
  const prev = bg.bing || {};
  if (prev.startdate && prev.startdate === image.startdate && bg.value) {
    return {
      success: true,
      unchanged: true,
      checkedAt: Date.now(),
      url: bg.value,
      startdate: prev.startdate,
      title: image.title,
      copyright: image.copyright
    };
  }
  await ensureCached(image.url, request);
  const keep = await pruneCache(stored.bingCacheMeta, { url: image.url, startdate: image.startdate }, request);
  await request.wait(chrome.storage.local.set({ bingCacheMeta: keep }));
  return {
    success: true,
    unchanged: false,
    url: image.url,
    startdate: image.startdate,
    title: image.title,
    copyright: image.copyright
  };
}

function refreshBingDaily() {
  if (dailyInflight) return dailyInflight;
  dailyInflight = withBingDeadline(doRefreshDaily).finally(() => { dailyInflight = null; });
  return dailyInflight;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'repairBingImage') {
    // Only the official image path used by the archive may be repaired. This
    // message must never become a general-purpose privileged fetch endpoint.
    let url;
    try { url = new URL(request.url); } catch (_) {}
    if (!url || url.origin !== 'https://www.bing.com' || url.pathname !== '/th'
      || url.username || url.password || !url.searchParams.get('id') || url.hash) {
      sendResponse({ success: false, error: 'Invalid Bing image URL', stage: 'image' });
      return false;
    }
    withBingDeadline(operation => ensureCached(url.href, operation, true))
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message, stage: error.bingStage }));
    return true;
  }
  if (request.action === 'fetchBingImage') {
    const index = Number.isInteger(request.index) ? request.index : 0;
    withBingDeadline(async (operation) => {
      const image = await fetchArchive(index, operation);
      await ensureCached(image.url, operation);
      const stored = await operation.wait(chrome.storage.local.get(['bingCacheMeta']));
      const keep = await pruneCache(stored.bingCacheMeta, { url: image.url, startdate: image.startdate }, operation);
      await operation.wait(chrome.storage.local.set({ bingCacheMeta: keep }));
      return {
        success: true,
        url: image.url,
        nextIndex: image.nextIndex,
        startdate: image.startdate,
        title: image.title,
        copyright: image.copyright
      };
    })
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({ success: false, error: error.message, stage: error.bingStage });
      });
    return true;
  }

  if (request.action === 'refreshBingDaily') {
    refreshBingDaily()
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.warn('Failed to refresh background:', error);
        sendResponse({ success: false, error: error.message, stage: error.bingStage });
      });
    return true;
  }
});
