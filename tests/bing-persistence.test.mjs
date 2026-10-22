import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const imported = { icons: [{ id: 'pack', type: 'folder', folderId: 'folder-home' }, { id: 'p1', parentId: 'pack', folderId: 'folder-home', type: 'shortcut', name: 'One', url: 'https://example.com/one' }], folders: [{ id: 'folder-home', name: 'Home' }], currentFolderId: 'folder-home', background: { type: 'image', value: 'assets/imported.jpg', source: 'custom' } };
function harness() {
  const state = { icons: [], folders: [], background: { type: 'bing', value: 'assets/old.jpg', bing: {} }, bingIndex: 0 };
  const stored = clone(state), writes = [], callbacks = [], listeners = [], toasts = [];
  let failWrite = false;
  const chrome = { runtime: { lastError: null, sendMessage(message, cb) { callbacks.push({ message, cb }); } }, storage: {
    onChanged: { addListener(fn) { listeners.push(fn); } },
    local: {
      get(keys, cb) { const result = Object.fromEntries((keys || Object.keys(stored)).filter((key) => stored[key] !== undefined).map((key) => [key, clone(stored[key])])); cb?.(result); return Promise.resolve(result); },
      set(payload, cb) {
        if (failWrite) { failWrite = false; chrome.runtime.lastError = { message: 'test write failure' }; cb?.(); chrome.runtime.lastError = null; return; }
        const copy = clone(payload); writes.push(copy);
        const changes = Object.fromEntries(Object.keys(copy).map((key) => [key, { oldValue: stored[key], newValue: copy[key] }]));
        Object.assign(stored, copy); cb?.(); listeners.forEach((fn) => fn(changes, 'local'));
      }
    }
  } };
  const element = () => { const classes = new Set(); return { style: {}, disabled: false, classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) }, pause() {}, setAttribute() {}, removeAttribute() {} }; };
  const g = { state, chrome, console, setTimeout, clearTimeout, queueMicrotask, Date, URL, AbortController, navigator: { locks: { request: async (_name, _options, task) => task() } }, showToast() {},
    document: { readyState: 'loading', addEventListener() {}, documentElement: {} }, matchMedia: () => ({ matches: true }),
    Image: class { set src(_) { queueMicrotask(() => this.onerror?.()); } },
    OpenTabBoot: { DEFAULT_BG: 'assets/default.jpg', isLocalAsset: () => true },
    OpenTabBing: { shouldCheck: () => true, ymd: () => '20261022' }
  };
  vm.createContext(g); vm.runInContext(read('workspace-persistence.js'), g); vm.runInContext(read('bing-cache.js'), g); vm.runInContext(read('import.js'), g);
  const elements = { backgroundLayer: element(), backgroundVideo: element(), refreshBgBtn: element() };
  g.OpenTabBingCache.init({ state, elements, showToast: text => toasts.push(text), writeBootMirror() {}, isVideoBackground: () => false });
  g.OpenTabImport.setReloader(() => {});
  const respond = (index, extra = {}) => callbacks[index].cb({ success: true, url: 'assets/new.jpg', startdate: '20261022', nextIndex: 1, ...extra });
  return { g, state, stored, writes, callbacks, listeners, respond, elements, toasts, failNextWrite() { failWrite = true; } };
}
for (const method of ['refreshDailyIfNeeded', 'fetchRandomBackground']) {
  for (const unchanged of (method === 'refreshDailyIfNeeded' ? [false, true] : [false])) {
    const h = harness(); const pending = h.g.OpenTabBingCache[method]();
    // A separate writer commits new shortcut data while the network is outstanding.
    h.stored.icons = clone(imported.icons); h.stored.folders = clone(imported.folders);
    h.respond(0, { unchanged }); await pending;
    assert.deepEqual(h.stored.icons, imported.icons, `${method}: async save must not overwrite imported icons`);
    assert.deepEqual(h.stored.folders, imported.folders);
    assert.deepEqual(Object.keys(h.writes[0]).sort(), ['background', 'bingIndex']);
  }
}
for (const method of ['refreshDailyIfNeeded', 'fetchRandomBackground']) {
  const h = harness(); const pending = h.g.OpenTabBingCache[method]();
  await h.g.OpenTabImport.applyOpenTabBackup(imported);
  const before = clone(h.stored); const writesBefore = h.writes.length;
  h.respond(0); await pending;
  assert.deepEqual(h.stored, before, `${method}: late response after import cannot change storage`);
  assert.equal(h.writes.length, writesBefore);
}
for (const external of [false, true]) {
  const h = harness(); const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  if (external) {
    // Deterministically deliver the real cross-tab storage notification before the response.
    h.g.chrome.storage.local.set({ background: imported.background });
  } else {
    // Settings can mutate the background object in place when switching modes.
    h.state.background.type = 'gradient'; h.state.background.value = 'linear-gradient(red, blue)';
  }
  const chosen = clone(h.state.background); const writesBefore = h.writes.length;
  h.respond(0); await pending;
  assert.deepEqual(h.state.background, chosen, 'new local/cross-tab wallpaper selection wins');
  assert.equal(h.writes.length, writesBefore);
}
{
  const h = harness(); const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.g.chrome.storage.local.set({ icons: imported.icons, folders: imported.folders, background: h.state.background });
  const before = clone(h.stored); h.respond(0); await pending;
  assert.deepEqual(h.stored, before, 'cross-tab import with unchanged wallpaper still invalidates old requests');
}
{
  const h = harness(); const old = h.g.OpenTabBingCache.refreshDailyIfNeeded();
  h.failNextWrite();
  await assert.rejects(h.g.OpenTabImport.applyOpenTabBackup(imported), /test write failure/);
  const next = h.g.OpenTabBingCache.refreshDailyIfNeeded();
  assert.equal(h.callbacks.length, 2, 'failed import resumes refresh instead of locking it');
  h.respond(0); await old;
  assert.equal(h.g.OpenTabBingCache.refreshDailyIfNeeded(), next, 'old finally cannot clear a newer in-flight request');
  h.respond(1); await next;
  assert.equal(h.writes.length, 1, 'only resumed fresh request persists');
}
console.log('Bing persistence tests passed: scoped writes, import races, failed-import recovery, local and cross-tab selection');

// Negative reproduction: daily refresh displays archive index 0 but leaves the
// next manual request at index 0, so the first click asks for the same picture.
{
  const h = harness();
  const daily = h.g.OpenTabBingCache.refreshDailyIfNeeded();
  h.respond(0, { url: 'assets/today.jpg' }); await daily;
  const manual = h.g.OpenTabBingCache.fetchRandomBackground();
  assert.equal(h.callbacks[1].message.index, 1, 'manual refresh after daily picture must advance, not request index 0 again');
  h.respond(1, { url: 'assets/yesterday.jpg', nextIndex: 2 }); await manual;
}

{
  const h = harness(); const before = clone(h.state);
  const first = h.g.OpenTabBingCache.fetchRandomBackground();
  assert.equal(h.g.OpenTabBingCache.fetchRandomBackground(), first, 'repeated clicks share one operation');
  assert.equal(h.callbacks.length, 1);
  assert.equal(h.elements.refreshBgBtn.disabled, true);
  h.respond(0, { success: false, error: 'synthetic network failure' }); await first;
  assert.deepEqual(clone(h.state), before); assert.equal(h.writes.length, 0);
  assert.equal(h.toasts.length, 1); assert.equal(h.elements.refreshBgBtn.disabled, false);
  assert.equal(h.elements.refreshBgBtn.classList.contains('loading'), false);
  const retry = h.g.OpenTabBingCache.fetchRandomBackground();
  h.respond(1, { nextIndex: 0 }); await retry;
  assert.equal(h.state.bingIndex, 0, 'archive wrap to zero is not replaced by fallback');
  assert.equal(h.stored.background.value, 'assets/new.jpg');
}
{
  const h = harness(); const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.respond(0, { url: h.state.background.value, nextIndex: 1 });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.callbacks[1].message.index, 1, 'same-picture archive result is skipped');
  h.respond(1, { url: 'assets/different.jpg', nextIndex: 2 }); await pending;
  assert.equal(h.stored.background.value, 'assets/different.jpg');
}
{
  const h = harness(); const before = clone(h.state);
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.failNextWrite(); h.respond(0); await pending;
  assert.deepEqual(clone(h.state), before, 'failed durable save restores the old wallpaper and index');
  assert.deepEqual(h.stored, before); assert.equal(h.toasts.length, 1);
  assert.equal(h.elements.refreshBgBtn.disabled, false);
}
{
  const h = harness(); const before = clone(h.state);
  h.g.OpenTabBoot.isLocalAsset = url => url.startsWith('assets/');
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.respond(0, { url: 'https://www.bing.com/broken.jpg' }); await pending;
  assert.deepEqual(clone(h.state), before, 'unrenderable image preserves previous background');
  assert.deepEqual(h.stored, before); assert.equal(h.toasts.length, 1);
  assert.equal(h.elements.refreshBgBtn.disabled, false);
}
console.log('Bing refresh regressions passed: next image, single flight, failures, retry, index wrap and durable rollback');

for (const invalidate of [false, true]) {
  const h = harness(); const previous = clone(h.state.background); const images = [];
  h.g.OpenTabBoot.isLocalAsset = url => url.startsWith('assets/');
  h.g.Image = class { set src(value) { this.value = value; images.push(this); } };
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.respond(0, { url: 'https://www.bing.com/pending.jpg' });
  for (let n = 0; n < 10 && !images.length; n += 1) await Promise.resolve();
  assert.equal(images.length, 1);
  assert.deepEqual(clone(h.state.background), previous, 'pending image must not leak provisional wallpaper into shared state');
  // Simulate an unrelated settings save taking its payload from shared state.
  h.g.chrome.storage.local.set({ background: clone(h.state.background), clockFormat: '24h' });
  if (invalidate) h.g.chrome.storage.local.set({ icons: [{ id: 'external' }] });
  images[0].onload(); await pending;
  assert.deepEqual(h.stored.background, invalidate ? previous : clone(h.state.background));
  assert.equal(h.stored.background.value, invalidate ? previous.value : 'https://www.bing.com/pending.jpg');
  assert.equal(h.elements.refreshBgBtn.disabled, false);
}
console.log('Pending-image tests passed: shared state stays committed and external changes invalidate safely');
