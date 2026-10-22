importScripts('lib/bing-daily.js', 'workspace-persistence.js');

const BING_CACHE = 'opentab-bing-v1';
const DEFAULT_LOCAL_BG = 'assets/default_background/default.webp';
let dailyInflight = null;

function absoluteBingUrl(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `https://www.bing.com${url}`;
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  OpenTabWorkspace.transaction(async ({ read, write }) => {
    const result = await read(['icons', 'background', 'clockFormat', 'showSeconds', 'timezone', 'bingIndex']);
    if (result.icons) return;
    const defaults = {
      icons: [], background: { type: 'image', value: DEFAULT_LOCAL_BG, source: 'preset' },
      clockFormat: '12h', showSeconds: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, bingIndex: 0
    };
    await write(Object.fromEntries(Object.entries(defaults).filter(([key]) => result[key] === undefined)));
  }).catch((error) => console.warn('Initial workspace setup failed:', error));
});

async function fetchArchive(idx) {
  const safeIndex = Math.max(0, Math.min(Number.isInteger(idx) ? idx : 0, 7));
  const apiUrl = `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${safeIndex}&n=1&mkt=zh-CN`;
  const response = await fetch(apiUrl);
  if (!response.ok) throw new Error(`Bing API status ${response.status}`);
  const data = await response.json();
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

async function ensureCached(url) {
  const cache = await caches.open(BING_CACHE);
  const hit = await cache.match(url);
  if (hit) return;
  const imgResp = await fetch(url);
  if (!imgResp.ok) throw new Error(`Bing image status ${imgResp.status}`);
  await cache.put(url, imgResp.clone());
}

async function pruneCache(meta, extra) {
  const entries = (Array.isArray(meta) ? meta : []).concat(extra ? [extra] : []);
  const keep = OpenTabBing.keepSet(entries);
  const keepUrls = new Set(keep.map((item) => item.url));
  const cache = await caches.open(BING_CACHE);
  const keys = await cache.keys();
  for (const req of keys) {
    if (!keepUrls.has(req.url)) await cache.delete(req);
  }
  return keep;
}

async function doRefreshDaily() {
  const stored = await chrome.storage.local.get(['background', 'bingCacheMeta']);
  const bg = stored.background || {};
  const image = await fetchArchive(0);
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
  await ensureCached(image.url);
  const keep = await pruneCache(stored.bingCacheMeta, { url: image.url, startdate: image.startdate });
  await chrome.storage.local.set({ bingCacheMeta: keep });
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
  dailyInflight = doRefreshDaily().finally(() => { dailyInflight = null; });
  return dailyInflight;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchBingImage') {
    const index = Number.isInteger(request.index) ? request.index : 0;
    fetchArchive(index)
      .then(async (image) => {
        try {
          await ensureCached(image.url);
          const stored = await chrome.storage.local.get(['bingCacheMeta']);
          const keep = await pruneCache(stored.bingCacheMeta, { url: image.url, startdate: image.startdate });
          await chrome.storage.local.set({ bingCacheMeta: keep });
        } catch (error) {
          console.warn('Failed to refresh background:', error);
        }
        sendResponse({
          success: true,
          url: image.url,
          nextIndex: image.nextIndex,
          startdate: image.startdate,
          title: image.title,
          copyright: image.copyright
        });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'refreshBingDaily') {
    refreshBingDaily()
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.warn('Failed to refresh background:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
