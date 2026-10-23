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
  const chrome = { runtime: { id: 'opentab-test', lastError: null, sendMessage(message, cb) { callbacks.push({ message, cb }); } }, storage: {
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
  const element = () => { const classes = new Set(); return { style: {}, children: [], querySelectorAll() { return this.children.filter(child => child.className === 'bg-fade-in'); }, appendChild(child) { this.children.push(child); child.parentNode = this; }, remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }, disabled: false, classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) }, pause() {}, setAttribute() {}, removeAttribute() {} }; };
  const g = { state, chrome, console, setTimeout, clearTimeout, queueMicrotask, Date, URL, AbortController, navigator: { locks: { request: async (_name, _options, task) => task() } }, showToast() {},
    document: { createElement: () => element(), readyState: 'loading', addEventListener() {}, documentElement: {} }, matchMedia: () => ({ matches: true }),
    Image: class { set src(url) { queueMicrotask(() => url.startsWith('assets/') ? this.onload?.() : this.onerror?.()); } },
    OpenTabBoot: { DEFAULT_BG: 'assets/default.jpg', isLocalAsset: () => true },
    OpenTabBing: { shouldCheck: () => true, ymd: () => '20261022' }
  };
  vm.createContext(g); vm.runInContext(read('workspace-persistence.js'), g); vm.runInContext(read('bing-cache.js'), g); vm.runInContext(read('import.js'), g);
  const elements = { backgroundLayer: element(), backgroundVideo: element(), refreshBgBtn: element() };
  const host = { state, elements, showToast: text => toasts.push(text), writeBootMirror() {}, isVideoBackground: () => false };
  g.OpenTabBingCache.init(host);
  g.OpenTabImport.setReloader(() => {});
  const respond = (index, extra = {}) => callbacks[index].cb({ success: true, url: 'assets/new.jpg', startdate: '20261022', nextIndex: 1, ...extra });
  return { g, host, state, stored, writes, callbacks, listeners, respond, elements, toasts, failNextWrite() { failWrite = true; } };
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

// Normal motion must commit the active base layer, not only storage or a
// temporary fade child. Exercise the real refresh handler with held fade timers.
{
  const h = harness(), fades = [];
  h.g.matchMedia = () => ({ matches: false });
  h.g.requestAnimationFrame = fn => fn();
  h.g.setTimeout = (fn, ms) => ms === 200 ? (fades.push(fn), -1) : setTimeout(fn, ms);
  await h.g.OpenTabBingCache.updateBackground({ fade: false });
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.respond(0); await pending;
  h.g.chrome.storage.local.set({ icons: [{ id: 'external-edit' }] });
  fades.forEach(fn => fn());
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/new.jpg)', 'saved manual wallpaper must remain on the active layer after workspace invalidation');
  assert.equal(h.elements.backgroundLayer.children.length, 0, 'no temporary overlay can hide a stale base layer');
}

// A settings/workspace render of the unchanged old background during decode
// must not silently cancel the manual candidate yet still save it as success.
for (const superseded of [false, true]) {
  const h = harness(), images = [], revoked = [];
  h.g.matchMedia = () => ({ matches: false });
  h.g.OpenTabBoot.isLocalAsset = url => url.startsWith('assets/');
  h.g.caches = { open: async () => ({ match: async () => ({ blob: async () => ({ color: 'blue' }) }) }) };
  h.g.URL = { createObjectURL: blob => `blob:${blob.color}`, revokeObjectURL: url => revoked.push(url) };
  h.g.Image = class { set src(value) { this.value = value; images.push(this); if (value.startsWith('assets/')) queueMicrotask(() => this.onload?.()); } decode() { return Promise.resolve(); } };
  await h.g.OpenTabBingCache.updateBackground({ fade: false });
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.respond(0, { url: 'https://www.bing.com/blue.jpg' });
  for (let n = 0; n < 20 && !images.some(img => img.value === 'blob:blue'); n++) await Promise.resolve();
  const candidate = images.find(img => img.value === 'blob:blue');
  assert.ok(candidate);
  if (superseded) h.g.chrome.storage.local.set({ background: { type: 'image', value: 'assets/red.jpg' } });
  await h.g.OpenTabBingCache.updateBackground({ fade: false });
  candidate.onload(); await pending;
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, superseded ? 'url(assets/red.jpg)' : 'url(blob:blue)', 'the active decoded source must match the latest authorized choice on the same page');
  assert.equal(h.stored.background.value, superseded ? 'assets/red.jpg' : 'https://www.bing.com/blue.jpg');
  assert.deepEqual(revoked, superseded ? ['blob:blue'] : [], 'accepted object URL stays alive; stale candidate is released');
}
console.log('Immediate wallpaper tests passed: normal-motion base layer, workspace fade invalidation, concurrent repaint and stale decoded candidate');

// A daily fade already in progress must not cover a completed manual refresh.
{
  const h = harness(), fades = [];
  h.g.matchMedia = () => ({ matches: false });
  h.g.requestAnimationFrame = fn => fn();
  h.g.setTimeout = (fn, ms) => ms === 200 ? (fades.push(fn), -1) : setTimeout(fn, ms);
  await h.g.OpenTabBingCache.updateBackground({ fade: false });
  await h.g.OpenTabBingCache.updateBackground({ fade: true });
  assert.equal(h.elements.backgroundLayer.children.length, 1, 'daily photo overlay is present before manual refresh');
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.respond(0); await pending;
  assert.equal(h.elements.backgroundLayer.children.length, 0, 'manual completion immediately removes the preceding daily overlay');
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/new.jpg)');
  fades.forEach(fn => fn());
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/new.jpg)', 'obsolete daily timer cannot replace the manual photo');
}
console.log('Overlapping wallpaper test passed: completed manual photo is not covered by an earlier daily fade');

const flush = () => new Promise(setImmediate);
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function photoHarness() {
  const h = harness(), revoked = [], entries = new Map(), created = [];
  h.g.console = { warn() {} };
  h.g.OpenTabBoot.isLocalAsset = url => url.startsWith('assets/');
  h.g.URL = { createObjectURL: blob => { const url = `blob:${blob.name}-${created.length}`; created.push(url); return url; }, revokeObjectURL: url => revoked.push(url) };
  h.g.caches = { open: async () => ({ match: async url => entries.has(url) ? { blob: async () => ({ name: entries.get(url) }) } : null }) };
  h.g.Image = class {
    set src(url) { this.url = url; queueMicrotask(() => url.includes('corrupt') ? this.onerror?.() : this.onload?.()); }
    decode() { return Promise.resolve(); }
  };
  return { ...h, revoked, entries, created };
}
const oldUrl = 'https://www.bing.com/th?id=previous.jpg', nextUrl = 'https://www.bing.com/th?id=next.jpg';
async function displayOld(h) {
  h.state.background = { type: 'bing', value: oldUrl, bing: {} }; h.entries.set(oldUrl, 'previous');
  await h.g.OpenTabBingCache.updateBackground({ fade: false });
  return h.elements.backgroundLayer.style.backgroundImage;
}
for (const repair of ['ok', 'bad-body', 'failed']) {
  const h = photoHarness(), before = await displayOld(h);
  h.entries.set(nextUrl, 'corrupt');
  const pending = h.g.OpenTabBingCache.fetchRandomBackground(); h.respond(0, { url: nextUrl }); await flush();
  assert.equal(h.callbacks[1].message.action, 'repairBingImage');
  assert.equal(h.callbacks[1].message.url, nextUrl);
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, before, 'old actual pixels remain throughout repair');
  assert.equal(h.revoked.includes(h.created[0]), false, 'old displayed object URL remains alive');
  if (repair === 'ok') h.entries.set(nextUrl, 'repaired');
  h.respond(1, repair === 'failed' ? { success: false, stage: 'image', error: 'repair offline' } : {});
  await pending;
  assert.equal(h.callbacks.length, 2, 'one cache repair only, including a second corrupt body');
  if (repair === 'ok') {
    assert.equal(h.stored.background.value, nextUrl); assert.equal(h.toasts.length, 0);
    assert.match(h.elements.backgroundLayer.style.backgroundImage, /repaired/);
    assert.equal(h.revoked.includes(h.created[0]), true, 'retire old object URL only after successful commit');
  } else {
    assert.equal(h.elements.backgroundLayer.style.backgroundImage, before);
    assert.equal(h.revoked.includes(h.created[0]), false);
    assert.equal(h.writes.length, 0); assert.equal(h.toasts.length, 1);
    assert.match(h.toasts[0], /图片无法加载/);
  }
}
// An API failure must never reload or replace an already visible old blob even
// if its cache entry has meanwhile become unusable.
{
  const h = photoHarness(), before = await displayOld(h);
  h.entries.set(oldUrl, 'corrupt');
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  h.respond(0, { success: false, stage: 'archive', error: 'offline' }); await pending;
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, before);
  assert.deepEqual(h.revoked, []); assert.equal(h.created.length, 1);
  assert.match(h.toasts[0], /信息获取失败/);
}
// Exercise scene-mode persistence and callbacks with a held durable save. Both
// optimistic candidate renders and rollback renders must leave old pixels live.
for (const outcome of ['saved', 'failed', 'switched']) {
  const h = photoHarness(), save = defer();
  let view = { sceneId: 'a', homeGroupId: 'a-home', generation: 1 };
  h.host.getSceneView = () => view;
  const before = await displayOld(h);
  h.host.persistBackground = async () => { await h.g.OpenTabBingCache.updateBackground({ fade: false }); return save.promise; };
  h.entries.set(nextUrl, 'candidate');
  const pending = h.g.OpenTabBingCache.fetchRandomBackground(); h.respond(0, { url: nextUrl }); await flush();
  assert.equal(h.state.background.value, nextUrl, 'save is holding a provisional candidate');
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, before, 'onChange cannot reveal it before storage succeeds');
  assert.equal(h.revoked.includes(h.created[0]), false);
  if (outcome === 'switched') {
    h.g.OpenTabBingCache.invalidatePending(); view = { sceneId: 'b', homeGroupId: 'b-home', generation: 2 };
    h.state.background = { type: 'image', value: 'assets/other.jpg' };
    await h.g.OpenTabBingCache.updateBackground({ fade: false });
  } else if (outcome === 'failed') {
    h.state.background = { type: 'bing', value: oldUrl, bing: {} };
    h.entries.set(oldUrl, 'corrupt');
    await h.g.OpenTabBingCache.updateBackground({ fade: false });
  }
  save.resolve(outcome !== 'failed'); await pending;
  assert.equal(h.elements.refreshBgBtn.disabled, false);
  if (outcome === 'saved') assert.match(h.elements.backgroundLayer.style.backgroundImage, /candidate/);
  if (outcome === 'failed') {
    assert.equal(h.elements.backgroundLayer.style.backgroundImage, before);
    assert.equal(h.revoked.includes(h.created[0]), false); assert.match(h.toasts[0], /保存失败/);
  }
  if (outcome === 'switched') {
    assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/other.jpg)');
    assert.equal(h.revoked.includes(h.created[1]), true, 'stale candidate released');
    assert.equal(h.toasts.length, 0);
  }
}
// A scene switch during the one repair attempt releases its rejected source and
// cannot create another blob, paint, persist or send a follow-on repair.
{
  const h = photoHarness(); await displayOld(h); h.entries.set(nextUrl, 'corrupt');
  const pending = h.g.OpenTabBingCache.fetchRandomBackground(); h.respond(0, { url: nextUrl }); await flush();
  h.g.OpenTabBingCache.invalidatePending(); h.state.background = { type: 'image', value: 'assets/other.jpg' };
  await h.g.OpenTabBingCache.updateBackground({ fade: false });
  h.entries.set(nextUrl, 'repaired'); h.respond(1); await pending;
  assert.equal(h.created.length, 2); assert.equal(h.writes.length, 0);
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/other.jpg)');
}
console.log('Bing display transaction tests passed: one repair, truthful failure, old pixel/blob lifetime, delayed storage and scene cancellation');

// Cache materialization and decoder promises are finite too. Neither a late
// cache body nor late decode completion may paint after the timeout.
for (const stage of ['cache', 'decode']) {
  const h = photoHarness(), before = await displayOld(h), gate = defer(), timers = new Map(); let timerId = 0;
  h.g.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
  h.g.clearTimeout = id => timers.delete(id);
  h.entries.set(nextUrl, 'candidate');
  if (stage === 'cache') h.g.caches = { open: async () => ({ match: async () => ({ blob: () => gate.promise }) }) };
  else h.g.Image = class { set src(_) { queueMicrotask(() => this.onload?.()); } decode() { return gate.promise; } };
  const pending = h.g.OpenTabBingCache.fetchRandomBackground(); h.respond(0, { url: nextUrl }); await flush();
  const deadline = [...timers.values()].find(timer => timer.ms === 15000); assert.ok(deadline); deadline.fn(); await pending;
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, before); assert.equal(h.elements.refreshBgBtn.disabled, false);
  assert.match(h.toasts[0], /超时/); assert.equal(h.callbacks.length, 1, 'a timeout does not trigger a corruption retry');
  const created = h.created.length;
  gate.resolve({ name: 'late' }); await flush();
  assert.equal(h.created.length, created, 'late cache body does not allocate a leaked object URL');
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, before); assert.equal(h.writes.length, 0);
}
console.log('Bing display deadlines passed: bounded cache read and image decode, no late source or pixel leaks');

// A newer same-tab appearance is not owned by a pending Bing display hold,
// even when the scene/generation did not change. Its boot mirror must match the
// visible choice immediately, not remain the previous Bing image indefinitely.
for (const scene of [false, true]) for (const type of ['gradient', 'image']) {
  const h = photoHarness(), mirrors = []; await displayOld(h);
  if (scene) h.host.getSceneView = () => ({ sceneId: 'a', homeGroupId: 'a-home', generation: 1 });
  h.host.writeBootMirror = () => mirrors.push(clone(h.g.OpenTabBingCache.describeBackground()));
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  const value = type === 'gradient' ? 'linear-gradient(red, blue)' : 'assets/new-preset.jpg';
  h.state.background = { type, value };
  await h.g.OpenTabBingCache.updateBackground({ fade: false }); await flush();
  assert.equal(mirrors.at(-1).kind, type, 'new appearance owns the mirror before the old response arrives');
  assert.equal(mirrors.at(-1).css, value);
  h.respond(0, { success: false, stage: 'archive', error: 'old request failed' }); await pending;
  assert.equal(h.state.background.value, value); assert.equal(h.toasts.length, 0);
  assert.equal(mirrors.at(-1).css, value, 'late old completion cannot restore stale display metadata');
  assert.equal(h.elements.backgroundLayer.style[type === 'gradient' ? 'background' : 'backgroundImage'], type === 'gradient' ? value : `url(${value})`);
}
console.log('Bing mirror supersession passed: newer same-tab gradient/preset wins in legacy and scene views');

// Chrome storage can reconstruct dictionary keys in a different order. Model
// its asynchronous onChanged delivery and the home's adoption/render boundary,
// rather than JSON-cloning callbacks synchronously in insertion order.
function chromeDictionary(value) {
  if (Array.isArray(value)) return value.map(chromeDictionary);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, chromeDictionary(value[key])]));
  return value;
}
for (const scene of [false, true]) for (const order of ['notification-first', 'callback-first', 'adoption-first']) {
  const h = photoHarness(), before = await displayOld(h), original = clone(h.state.background);
  h.entries.set(nextUrl, 'candidate');
  let finishSave, notified = 0;
  const save = (payload, resolve) => {
    const saved = chromeDictionary(payload);
    const changes = scene ? { sceneProfiles: { oldValue: [{ id: 'a', background: original }], newValue: [{ id: 'a', ...saved }] } }
      : { background: { oldValue: original, newValue: saved.background }, bingIndex: { newValue: saved.bingIndex } };
    const notify = () => { notified++; h.listeners.forEach(listener => listener(changes, 'local')); };
    finishSave = async () => {
      Object.assign(h.stored, saved);
      if (order === 'callback-first') { resolve(true); queueMicrotask(notify); return; }
      if (order === 'adoption-first') {
        h.state.background = saved.background; h.state.bingIndex = saved.bingIndex;
        await h.g.OpenTabBingCache.updateBackground({ fade: false });
        assert.equal(h.elements.backgroundLayer.style.backgroundImage, before, 'reordered provisional adoption must not paint before save acknowledgement');
      }
      notify(); resolve(true);
    };
  };
  if (scene) {
    h.host.getSceneView = () => ({ sceneId: 'a', homeGroupId: 'a-home', generation: 1 });
    h.host.persistBackground = payload => new Promise(resolve => save(payload, resolve));
  } else h.g.chrome.storage.local.set = (payload, callback) => save(payload, () => callback());
  const pending = h.g.OpenTabBingCache.fetchRandomBackground(); h.respond(0, { url: nextUrl }); await flush();
  assert.equal(typeof finishSave, 'function');
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, before);
  await finishSave(); await pending; await flush();
  assert.equal(notified, 1);
  assert.equal(h.stored.background.value, nextUrl);
  assert.match(h.elements.backgroundLayer.style.backgroundImage, /candidate/, `${scene ? 'scene' : 'legacy'} ${order}: own durable acknowledgement cannot cancel the decoded pixel commit`);
  assert.equal(h.revoked.includes(h.created[0]), true, 'old object URL retires after successful pixel commit');
  assert.equal(h.revoked.includes(h.created[1]), false, 'committed candidate remains alive');
  assert.equal(h.toasts.length, 0); assert.equal(h.elements.refreshBgBtn.disabled, false);
}
console.log('Bing native storage ordering passed: reordered nested dictionaries, async own-write notifications and adoption before/after acknowledgement');

// A transport rejection is not an archive/network rejection. Retry only the
// exact pre-delivery no-receiver error, within one deadline and the same view.
const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';
async function transportHarness(getSceneView) {
  const h = photoHarness();
  if (getSceneView) h.host.getSceneView = getSceneView;
  const previous = await displayOld(h), timers = new Map(), failures = [];
  let now = 0, nextTimer = 0;
  h.g.console.warn = (_label, error) => failures.push(error);
  h.g.setTimeout = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; };
  h.g.clearTimeout = id => timers.delete(id);
  h.entries.set(nextUrl, 'candidate');
  return { ...h, previous, timers, failures,
    error(index, message) {
      h.g.chrome.runtime.lastError = { message };
      h.callbacks[index].cb();
      h.g.chrome.runtime.lastError = null;
    },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await flush();
    }
  };
}
function assertTransportRetained(h) {
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, h.previous);
  assert.deepEqual(h.revoked, []);
  assert.equal(h.writes.length, 0);
  assert.equal(h.elements.refreshBgBtn.disabled, false);
  assert.equal(h.timers.size, 0, 'every dispatch/retry/deadline timer is cleared');
}
for (const outcome of ['success', 'unavailable', 'timeout']) {
  const h = await transportHarness();
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  assert.equal(h.g.OpenTabBingCache.fetchRandomBackground(), pending, 'recovery stays single-flight');
  h.error(0, NO_RECEIVER);
  await h.advance(249); assert.equal(h.callbacks.length, 1);
  await h.advance(1); assert.equal(h.callbacks.length, 2);
  assert.deepEqual(h.callbacks[1].message, h.callbacks[0].message, 'retry preserves action and archive index');
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, h.previous);
  assert.equal(h.writes.length, 0);
  if (outcome === 'success') h.respond(1, { url: nextUrl });
  if (outcome === 'unavailable') h.error(1, NO_RECEIVER);
  if (outcome === 'timeout') await h.advance(24750);
  await pending;
  assert.equal(h.callbacks.length, 2, 'never dispatch a third attempt');
  assert.equal(h.timers.size, 0);
  if (outcome === 'success') {
    assert.match(h.elements.backgroundLayer.style.backgroundImage, /candidate/);
    assert.equal(h.stored.background.value, nextUrl); assert.equal(h.toasts.length, 0);
    assert.deepEqual(h.revoked, [h.created[0]]);
  } else {
    assertTransportRetained(h);
    assert.equal(h.failures[0].bingStage, outcome === 'timeout' ? 'timeout' : 'transport');
    assert.equal(h.toasts.length, 1);
    if (outcome === 'unavailable') assert.match(h.toasts[0], /扩展后台/);
    h.respond(1, { url: nextUrl }); await flush();
    assertTransportRetained(h);
  }
}
for (const failure of ['missing-id', 'sync-invalid', 'callback-invalid', 'sync-other', 'closed-port', 'api-error', 'no-response', 'timeout']) {
  const h = await transportHarness();
  if (failure === 'missing-id') delete h.g.chrome.runtime.id;
  if (failure.startsWith('sync-')) h.g.chrome.runtime.sendMessage = () => { throw new Error(failure === 'sync-invalid' ? 'Extension context invalidated.' : 'Synthetic dispatch error'); };
  const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  if (failure === 'callback-invalid') h.error(0, 'Extension context invalidated.');
  if (failure === 'closed-port') h.error(0, 'The message port closed before a response was received.');
  if (failure === 'api-error') h.respond(0, { success: false, stage: 'archive', error: 'Bing API status 503' });
  if (failure === 'no-response') h.callbacks[0].cb();
  if (failure === 'timeout') await h.advance(25000);
  await pending;
  assertTransportRetained(h);
  assert.ok(h.callbacks.length <= 1, `${failure}: cannot safely replay`);
  assert.equal(h.toasts.length, 1);
  if (['missing-id', 'sync-invalid', 'callback-invalid'].includes(failure)) {
    assert.equal(h.failures[0].bingStage, 'context'); assert.match(h.toasts[0], /刷新此标签页/);
  }
  if (['sync-other', 'closed-port', 'no-response'].includes(failure)) assert.equal(h.failures[0].bingStage, 'transport');
  if (failure === 'timeout') { h.respond(0, { url: nextUrl }); await flush(); assertTransportRetained(h); }
}
for (const changed of ['scene', 'choice', 'import', 'context']) {
  let view = { sceneId: 'a', homeGroupId: 'a-home', generation: 1 };
  const h = await transportHarness(() => view);
  const pending = h.g.OpenTabBingCache.fetchRandomBackground(); h.error(0, NO_RECEIVER);
  if (changed === 'scene') view = { sceneId: 'b', homeGroupId: 'b-home', generation: 2 };
  if (changed === 'choice') h.state.background = { type: 'gradient', value: 'linear-gradient(red, blue)' };
  if (changed === 'import') h.g.OpenTabBingCache.invalidatePending();
  if (changed === 'context') h.g.chrome.runtime.id = undefined;
  await h.advance(250); await pending;
  assert.equal(h.callbacks.length, 1, `${changed}: stale recovery must not dispatch`);
  assertTransportRetained(h);
  assert.equal(h.toasts.length, changed === 'context' ? 1 : 0);
  if (changed === 'choice') assert.equal(h.state.background.type, 'gradient', 'new choice not rolled back');
}
console.log('Bing transport tests passed: bounded no-receiver recovery, truthful context/transport failures, no uncertain replay, timer cleanup and stale-view cancellation');
// A transport failure during automatic refresh must not re-read a now-corrupt
// cached copy and replace the still-valid source already on screen.
{
  const h = await transportHarness(); h.entries.set(oldUrl, 'corrupt');
  const pending = h.g.OpenTabBingCache.refreshDailyIfNeeded();
  h.error(0, NO_RECEIVER); await h.advance(250); h.error(1, NO_RECEIVER); await pending;
  assertTransportRetained(h);
}
// Retry backoff never extends the original total message deadline.
{
  const h = await transportHarness(); const pending = h.g.OpenTabBingCache.fetchRandomBackground();
  await h.advance(24900); h.error(0, NO_RECEIVER); await h.advance(100); await pending;
  assert.equal(h.callbacks.length, 1, 'deadline cancels a retry not yet dispatched');
  assertTransportRetained(h);
}
{
  const h = await transportHarness(); h.elements.backgroundLayer.style.backgroundImage = 'none';
  const pending = h.g.OpenTabBingCache.refreshDailyIfNeeded();
  h.error(0, NO_RECEIVER); await h.advance(250); h.error(1, NO_RECEIVER); await pending;
  assert.match(h.elements.backgroundLayer.style.backgroundImage, /url\(blob:previous-/,
    'an explicitly empty initial layer still receives its existing cached background');
  assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 0);
}
// Display ownership is semantic, unlike asynchronous request freshness. A new
// generation in the same scene/home group does not invalidate committed pixels.
for (const method of ['fetchRandomBackground', 'refreshDailyIfNeeded']) for (const lateGeneration of [false, true]) {
  let view = { sceneId: 'a', homeGroupId: 'a-home', generation: 1 };
  const h = await transportHarness(() => view); h.entries.set(oldUrl, 'corrupt');
  if (!lateGeneration) view = { ...view, generation: 2 };
  const pending = h.g.OpenTabBingCache[method]();
  if (lateGeneration) view = { ...view, generation: 2 };
  h.error(0, 'The message port closed before a response was received.'); await pending;
  assertTransportRetained(h); assert.equal(h.created.length, 1);
  assert.equal(h.toasts.length, !lateGeneration && method === 'fetchRandomBackground' ? 1 : 0,
    'late request generations remain rejected even when the existing pixels still belong to the scene');
}
// A selected, decoded fade is a usable source even before its base-layer timer.
// Complete that exact transition; never replace it by rereading a corrupt cache.
for (const method of ['fetchRandomBackground', 'refreshDailyIfNeeded']) {
  let view = { sceneId: 'a', homeGroupId: 'a-home', generation: 1 };
  const h = await transportHarness(() => view);
  h.g.matchMedia = () => ({ matches: false }); h.g.requestAnimationFrame = fn => fn();
  await h.g.OpenTabBingCache.updateBackground({ fade: true });
  const overlay = h.elements.backgroundLayer.children[0], visible = overlay.style.backgroundImage;
  assert.equal(overlay.style.opacity, '1'); assert.notEqual(visible, h.previous);
  h.entries.set(oldUrl, 'corrupt'); view = { ...view, generation: 2 };
  const pending = h.g.OpenTabBingCache[method]();
  h.error(0, 'The message port closed before a response was received.'); await pending;
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, visible);
  assert.equal(h.elements.backgroundLayer.children.length, 0);
  assert.equal(h.created.length, 2, 'no new cache materialization');
  assert.deepEqual(h.revoked, [h.created[0]], 'the usable decoded fade blob is never revoked');
  await h.advance(200);
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, visible, 'old fade timer cannot overwrite its synchronous ownership commit');
  assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 0);
}
console.log('Bing display ownership passed: same-scene generation retention, strict stale requests and decoded fade promotion without cache reread');
