import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import vm from 'node:vm';

const source = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(setImmediate);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const viewFor = (sceneId, generation = 1) => ({ sceneId, homeGroupId: `${sceneId}-home`, generation });
const background = value => ({ type: 'bing', value: `assets/${value}.jpg`, bing: {} });
const profile = (id, size = 56) => ({ id, background: background(id), bingIndex: 0,
  layoutIconSize: size, layoutColumns: 0, layoutShowNames: true, layoutMaxWidth: 900 });
function element() {
  const classes = new Set(), listeners = {};
  return { style: { setProperty(key, value) { this[key] = value; } }, children: [], className: '', disabled: false,
    classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key), toggle(key, value) { if (value) classes.add(key); else classes.delete(key); } },
    querySelectorAll() { return this.children.filter(child => child.className === 'bg-fade-in'); },
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); },
    setAttribute() {}, getAttribute(key) { return this[key]; }, removeAttribute() {}, pause() {}, play: () => Promise.resolve(),
    addEventListener(name, fn) { listeners[name] = fn; }, listeners
  };
}
function storage(items = {}) {
  const map = new Map(Object.entries(items)), writes = [];
  return { map, writes, getItem: key => map.get(key) ?? null,
    setItem(key, value) { map.set(key, value); writes.push([key, value]); }, removeItem: key => map.delete(key) };
}
function bootHarness({ local = storage(), session = storage() } = {}) {
  const layer = element(), root = element(), body = element();
  const g = { localStorage: local, sessionStorage: session, console,
    document: { documentElement: root, body, getElementById: id => id === 'background-layer' ? layer : null },
    matchMedia: () => ({ matches: true }), performance: { mark() {}, measure() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#05070d' }), requestAnimationFrame: fn => fn(),
    MutationObserver: class { observe() {} disconnect() {} }
  };
  vm.createContext(g);
  vm.runInContext(source('scene-boot.js'), g);
  vm.runInContext(source('boot.js'), g);
  return { g, local, session, layer };
}
const mirror = sceneId => JSON.stringify({ v: 1, sceneId, bg: { kind: 'image', url: `assets/${sceneId}.jpg` } });

// The tab's session selection wins the device default. Mirrors never move it.
{
  const local = storage({ 'opentab.scene.last': 'b', 'opentab.boot.v1': mirror('legacy'), 'opentab.boot.v1:a': mirror('a'), 'opentab.boot.v1:b': mirror('b') });
  const session = storage({ 'opentab.scene.view': JSON.stringify({ sceneId: 'a', lastGroupIds: { a: 'a-home' } }) });
  const h = bootHarness({ local, session });
  assert.equal(h.g.OpenTabSceneBoot.key(), 'opentab.boot.v1:a');
  assert.equal(h.layer.style.backgroundImage, 'url(assets/a.jpg)');
  h.g.OpenTabBoot.writeMirror({ sceneId: 'b', bg: { kind: 'image', url: 'assets/b-new.jpg' } });
  assert.equal(h.g.OpenTabBoot.readMirror('b').bg.url, 'assets/b-new.jpg');
  assert.equal(h.g.OpenTabBoot.readMirror().bg.url, 'assets/a.jpg');
  assert.equal(local.getItem('opentab.scene.last'), 'b');
  assert.equal(session.writes.length, 0);
  h.g.OpenTabBoot.writeMirror({ sceneId: 'a', layoutIconSize: 80 });
  assert.equal(local.getItem('opentab.scene.last'), 'b', 'passive writes never change device selection');
  assert.deepEqual(local.writes.map(([key]) => key), ['opentab.boot.v1:b', 'opentab.boot.v1:a']);
}
for (const missing of [undefined, '{invalid', JSON.stringify({ v: 2, bg: { kind: 'image', url: 'assets/wrong.jpg' } })]) {
  const local = storage({ 'opentab.scene.last': 'a', 'opentab.boot.v1': mirror('legacy'), 'opentab.boot.v1:b': mirror('b') });
  if (missing) local.map.set('opentab.boot.v1:a', missing);
  const h = bootHarness({ local });
  assert.equal(h.g.OpenTabBoot.readMirror(), null);
  assert.equal(h.layer.style.backgroundImage, `url(${h.g.OpenTabBoot.DEFAULT_BG})`, 'missing scene cache uses neutral default, not another wallpaper');
  assert.equal(local.getItem('opentab.boot.v1'), mirror('legacy'), 'bad selected cache does not remove global cache');
}
{
  const h = bootHarness({ local: storage({ 'opentab.boot.v1': mirror('legacy') }) });
  assert.equal(h.layer.style.backgroundImage, 'url(assets/legacy.jpg)', 'only tabs without a scene may read legacy cache');
  assert.equal(h.g.OpenTabSceneBoot.key('explicit'), 'opentab.boot.v1:explicit');
  const denied = { getItem() { throw new Error('storage denied'); }, setItem() { throw new Error('storage denied'); }, removeItem() { throw new Error('storage denied'); } };
  const safe = bootHarness({ local: denied, session: denied });
  assert.equal(safe.g.OpenTabSceneBoot.key(), 'opentab.boot.v1');
  assert.doesNotThrow(() => safe.g.OpenTabBoot.writeMirror({ sceneId: 'a' }));
  const fallback = bootHarness({ local: storage({ 'opentab.scene.last': 'b', 'opentab.boot.v1:b': mirror('b') }), session: denied });
  assert.equal(fallback.layer.style.backgroundImage, 'url(assets/b.jpg)');
  assert.ok(Buffer.byteLength(source('boot.js')) <= 4096, 'keep hard first-paint budget');
}

function bingHarness({ initialView = viewFor('a') } = {}) {
  let view = initialView, persistence = async () => true;
  const state = { background: background('a'), bingIndex: 0 }, profiles = [profile('a'), profile('b')];
  const callbacks = [], writes = [], persisted = [], mirrors = [], toasts = [], revoked = [], images = [], fades = [], frames = [], listeners = [];
  const elements = { backgroundLayer: element(), backgroundVideo: element(), refreshBgBtn: element() };
  const g = { console: { warn() {} }, Date, queueMicrotask, setTimeout: (fn, delay) => delay === 200 ? (fades.push(fn), -1) : setTimeout(fn, delay), clearTimeout,
    requestAnimationFrame: fn => { frames.push(fn); }, matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ getPropertyValue: () => '#05070d' }),
    URL: { createObjectURL: blob => `blob:${blob.name}`, revokeObjectURL: url => revoked.push(url) },
    caches: { open: async () => ({ match: async () => null }) },
    Image: class { set src(value) { this.value = value; images.push(this); queueMicrotask(() => this.onload?.()); } decode() { return Promise.resolve(); } },
    document: { createElement: () => element(), readyState: 'loading', addEventListener() {}, documentElement: element() },
    chrome: { runtime: { sendMessage(message, cb) { callbacks.push({ message, cb }); } }, storage: {
      onChanged: { addListener(fn) { listeners.push(fn); } }, local: { set(payload, cb) { writes.push(copy(payload)); cb?.(); } }
    } },
    OpenTabBoot: { DEFAULT_BG: 'assets/default.jpg', isLocalAsset: url => url.startsWith('assets/') },
    OpenTabBing: { shouldCheck: () => true, ymd: () => '20261022' }
  };
  vm.createContext(g); vm.runInContext(source('bing-cache.js'), g);
  const host = { state, elements, getSceneView: () => view,
    async persistBackground(payload, guard) {
      persisted.push(copy({ payload, guard }));
      const saved = await persistence(payload, guard);
      if (saved !== true || JSON.stringify(view) !== JSON.stringify(guard.view)) return false;
      const p = profiles.find(p => p.id === guard.view.sceneId);
      if (!isDeepStrictEqual(copy(p.background), copy(guard.before))) return false;
      const oldValue = copy(profiles);
      Object.assign(p, copy(payload));
      listeners.forEach(fn => fn({ sceneProfiles: { oldValue, newValue: copy(profiles) } }, 'local'));
      return true;
    },
    writeBootMirror() { mirrors.push({ view: copy(view), background: copy(state.background), meta: copy(g.OpenTabBingCache.describeBackground()) }); },
    showToast: text => toasts.push(text), isVideoBackground: value => value.endsWith('.mp4'), DEFAULT_GRADIENT: 'linear-gradient(red, blue)'
  };
  g.OpenTabBingCache.init(host);
  return { g, host, state, profiles, callbacks, persisted, mirrors, writes, toasts, revoked, images, fades, frames, elements,
    api: g.OpenTabBingCache, setPersistence: fn => { persistence = fn; }, getView: () => view,
    blockView(invalidate = true) { if (invalidate) g.OpenTabBingCache.invalidatePending(); view = null; },
    respond(index, extra = {}) { callbacks[index].cb({ success: true, url: 'assets/new.jpg', startdate: '20261022', nextIndex: 1, ...extra }); },
    changeView(sceneId, generation = view.generation + 1, invalidate = true) {
      if (invalidate) g.OpenTabBingCache.invalidatePending();
      view = viewFor(sceneId, generation);
      Object.assign(state, copy(profiles.find(p => p.id === sceneId)));
    },
    changeProfile(sceneId, next) {
      const oldValue = copy(profiles); Object.assign(profiles.find(p => p.id === sceneId), copy(next));
      listeners.forEach(fn => fn({ sceneProfiles: { oldValue, newValue: copy(profiles) } }, 'local'));
    },
    notify: changes => listeners.forEach(fn => fn(changes, 'local'))
  };
}
// Installed scene hooks fail closed while startup cannot resolve a safe view.
{
  const h = bingHarness({ initialView: null }), before = copy(h.state.background);
  h.g.document.readyState = 'complete';
  h.api.afterStateLoaded(); h.api.onVisible();
  await Promise.all([h.api.fetchRandomBackground(), h.api.refreshDailyIfNeeded(), h.api.updateBackground()]);
  assert.doesNotThrow(() => h.api.describeBackground());
  h.changeProfile('a', { background: background('changed') });
  h.notify({ background: { newValue: background('legacy') } });
  await settle();
  assert.deepEqual(h.state.background, before);
  for (const list of [h.callbacks, h.persisted, h.writes, h.mirrors, h.images]) assert.equal(list.length, 0);
  assert.equal(h.elements.backgroundLayer.className, '');
  assert.equal(h.elements.refreshBgBtn.disabled, false);
  h.changeView('b', 2);
  const pending = h.api.fetchRandomBackground(); h.respond(0); await pending;
  assert.equal(h.persisted.length, 1, 'a later valid scene resumes scoped persistence');
  assert.equal(h.writes.length, 0);
}
for (const method of ['fetchRandomBackground', 'refreshDailyIfNeeded']) {
  const h = bingHarness(), before = copy(h.state.background);
  const pending = h.api[method](); h.blockView(false); h.respond(0); await pending;
  assert.deepEqual(h.state.background, before);
  for (const list of [h.persisted, h.writes, h.mirrors, h.images]) assert.equal(list.length, 0);
}
// Disposing scene hooks cannot turn a captured scene paint into legacy work.
{
  const h = bingHarness();
  h.state.background = { type: 'image', value: 'https://www.bing.com/pending.jpg' };
  h.g.caches = { open: async () => ({ match: async () => ({ blob: async () => ({ name: 'disposed' }) }) }) };
  h.g.Image = class { set src(value) { this.value = value; h.images.push(this); } decode() { return Promise.resolve(); } };
  const pending = h.api.updateBackground(); await settle();
  assert.equal(h.images.length, 1);
  delete h.host.getSceneView;
  h.images[0].onload(); await pending;
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, undefined);
  assert.equal(h.mirrors.length, 0);
  assert.deepEqual(h.revoked, ['blob:disposed']);
}
for (const method of ['fetchRandomBackground', 'refreshDailyIfNeeded']) {
  for (const invalidate of [false, true]) {
    const h = bingHarness();
    h.profiles[1].background = copy(h.state.background); // same wallpaper is not sufficient identity
    const old = h.api[method]();
    h.changeView('b', 2, invalidate);
    await h.api.updateBackground({ fade: false });
    const mirrorCount = h.mirrors.length;
    h.respond(0); await old; await settle();
    assert.equal(h.persisted.length, 0, `${method}: old view never persists`);
    assert.equal(h.mirrors.length, mirrorCount, `${method}: old view never refreshes mirror`);
    assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/a.jpg)');
    assert.equal(h.state.background.value, 'assets/a.jpg');
    assert.equal(h.writes.length, 0);
  }
  // Another scene changes while this one waits. No cancellation or global alias adoption.
  {
    const h = bingHarness(), before = copy(h.state.background), oldView = copy(h.getView());
    const pending = h.api[method]();
    h.changeProfile('b', { background: background('other') });
    h.notify({ background: { newValue: background('legacy') }, icons: { newValue: [{ id: 'other-scene-icon' }] } });
    assert.deepEqual(h.state.background, before);
    h.respond(0); await pending;
    assert.equal(h.persisted.length, 1);
    assert.deepEqual(h.persisted[0].guard, { view: oldView, before });
    assert.equal(h.state.background.value, 'assets/new.jpg');
    assert.equal(h.profiles[1].background.value, 'assets/other.jpg');
    assert.equal(h.writes.length, 0, 'adapter never writes legacy aliases');
  }
  // Active profile notification cancels before the controller reloads state.
  {
    const h = bingHarness(), pending = h.api[method]();
    h.changeProfile('a', { background: background('external') });
    h.respond(0); await pending;
    assert.equal(h.persisted.length, 0);
    assert.equal(h.state.background.value, 'assets/a.jpg', 'controller, not cache listener, owns profile reload');
  }
  // Strict success and failure rollback never leaks the candidate into a mirror.
  for (const failure of [false, undefined, 'true', new Error('synthetic failure')]) {
    const h = bingHarness(), before = copy(h.state);
    h.setPersistence(async () => { if (failure instanceof Error) throw failure; return failure; });
    const pending = h.api[method](); h.respond(0); await pending;
    assert.deepEqual(copy(h.state), before);
    assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/a.jpg)');
    assert.equal(h.mirrors.some(m => m.background.value === 'assets/new.jpg'), false);
    assert.equal(h.toasts.length, 1);
    assert.equal(h.writes.length, 0);
  }
}
// Even re-entering the same scene must reject its earlier view generation.
{
  const h = bingHarness(), pending = h.api.fetchRandomBackground();
  h.changeView('a', 2, false); h.respond(0); await pending;
  assert.equal(h.persisted.length, 0);
}
// Decode completion and stale fade/video callbacks cannot repaint another view.
{
  const h = bingHarness();
  h.g.caches = { open: async () => ({ match: async () => ({ blob: async () => ({ name: 'candidate' }) }) }) };
  h.g.Image = class { set src(value) { this.value = value; h.images.push(this); if (value.startsWith('assets/')) queueMicrotask(() => this.onload?.()); } };
  const pending = h.api.fetchRandomBackground(); h.respond(0, { url: 'https://www.bing.com/candidate.jpg' });
  await settle();
  const image = h.images.find(img => img.value === 'blob:candidate'); assert.ok(image);
  h.changeView('b'); await h.api.updateBackground({ fade: false });
  image.onload(); await pending;
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/b.jpg)');
  assert.deepEqual(h.revoked, ['blob:candidate']);
  assert.equal(h.persisted.length, 0);
  h.changeView('a'); await h.api.updateBackground({ fade: true });
  h.changeView('b'); await h.api.updateBackground({ fade: false });
  while (h.frames.length) h.frames.shift()();
  h.fades.forEach(fn => fn());
  assert.equal(h.elements.backgroundLayer.style.backgroundImage, 'url(assets/b.jpg)');
  assert.equal(h.elements.backgroundLayer.children.length, 0);
  h.state.background = { type: 'image', value: 'assets/old.mp4' };
  await h.api.updateBackground(); const showVideo = h.elements.backgroundVideo.listeners.canplay;
  h.changeView('b'); await h.api.updateBackground(); showVideo();
  assert.equal(h.elements.backgroundVideo.style.display, 'none');
}
// A prior scene's overlay is retired synchronously, including switches to gradients.
{
  const h = bingHarness();
  await h.api.updateBackground({ fade: true });
  assert.equal(h.elements.backgroundLayer.children.length, 1);
  h.changeView('b');
  assert.equal(h.elements.backgroundLayer.children.length, 0);
  h.state.background = { type: 'gradient', value: 'linear-gradient(black, green)' };
  await h.api.updateBackground();
  h.fades.forEach(fn => fn());
  assert.equal(h.elements.backgroundLayer.style.background, 'linear-gradient(black, green)');
}
// Switching invalidates only the old button owner; its completion cannot unlock a newer request.
{
  const h = bingHarness(), first = h.api.fetchRandomBackground();
  h.changeView('b'); const second = h.api.fetchRandomBackground();
  assert.equal(h.callbacks.length, 2); h.respond(0); await first;
  assert.equal(h.elements.refreshBgBtn.disabled, true);
  h.respond(1); await second;
  assert.equal(h.elements.refreshBgBtn.disabled, false);
  assert.equal(h.persisted.length, 1);
  assert.equal(h.persisted[0].guard.view.sceneId, 'b');
}
// Completion of an already-started guarded save does not mutate the newly selected view.
{
  const h = bingHarness(), save = deferred(); h.setPersistence(() => save.promise);
  const pending = h.api.fetchRandomBackground(); h.respond(0); await settle();
  assert.equal(h.persisted.length, 1);
  h.changeView('b'); await h.api.updateBackground();
  const mirrors = h.mirrors.length; save.resolve(true); await pending;
  assert.equal(h.state.background.value, 'assets/b.jpg');
  assert.equal(h.mirrors.length, mirrors);
  assert.equal(h.toasts.length, 0);
}
// Daily unchanged metadata still persists once, and no extra network work occurs.
{
  const h = bingHarness(), original = copy(h.state.background);
  const pending = h.api.refreshDailyIfNeeded(); h.respond(0, { unchanged: true, title: 'Fresh caption' }); await pending;
  assert.equal(h.callbacks.length, 1); assert.equal(h.persisted.length, 1);
  assert.equal(h.state.background.value, original.value); assert.equal(h.state.bingIndex, 1);
  assert.equal(h.state.background.bing.title, 'Fresh caption'); assert.equal(h.writes.length, 0);
}

function layoutHarness() {
  let view = viewFor('a'), save = async () => true;
  const profiles = [profile('a', 56), profile('b', 80)], persisted = [], globalWrites = [], mirrorWrites = [], errors = [];
  const stored = { todoButtonVisible: false, layoutIconSize: 96 }, mirrors = new Map();
  const g = { console, chrome: { runtime: {}, storage: { local: {
    get(keys, cb) { cb(copy(stored)); },
    set(payload, cb) { globalWrites.push(copy(payload)); Object.assign(stored, copy(payload)); cb?.(); }
  } } }, OpenTabBoot: {
    readMirror: id => mirrors.get(id || view.sceneId),
    writeMirror(data) { mirrorWrites.push(copy(data)); mirrors.set(data.sceneId, copy(data)); }
  } };
  vm.createContext(g); vm.runInContext(source('layout.js'), g);
  const api = g.OpenTabLayout;
  api.loadFromStorage(stored);
  const adapter = { getView: () => view, getProfile: () => profiles.find(p => p.id === view.sceneId), onError: error => errors.push(error),
    async persist(settings, captured, intent) {
      persisted.push(copy({ settings, view: captured, intent }));
      const result = await save(settings, captured, intent);
      if (result !== true) return result;
      if (JSON.stringify(view) !== JSON.stringify(captured)) return false;
      const keys = intent?.keys || Object.keys(settings);
      const fields = Object.fromEntries(keys.filter(key => key !== 'todoButtonVisible').map(key => [key, settings[key]]));
      Object.assign(profiles.find(p => p.id === captured.sceneId), fields);
      if (keys.includes('todoButtonVisible')) stored.todoButtonVisible = settings.todoButtonVisible;
      return true;
    }
  };
  api.setSceneAdapter(adapter);
  return { g, api, profiles, stored, persisted, globalWrites, mirrorWrites, mirrors, errors, setSave: fn => { save = fn; },
    switchTo(sceneId, generation = view.generation + 1) { view = viewFor(sceneId, generation); api.loadFromStorage(stored); }
  };
}
{
  const h = layoutHarness();
  assert.equal(h.api.get().layoutIconSize, 56, 'active scene beats global layout aliases');
  assert.equal(h.api.get().todoButtonVisible, false);
  const returned = h.api.patch({ layoutIconSize: 70 });
  assert.equal(returned.layoutIconSize, 70); assert.equal(returned.then, undefined, 'public mutator stays synchronous');
  await h.api.whenIdle();
  assert.deepEqual(Object.keys(h.persisted[0].settings).sort(), ['layoutColumns', 'layoutIconSize', 'layoutMaxWidth', 'layoutShowNames']);
  assert.equal(h.profiles[0].layoutIconSize, 70); assert.equal(h.profiles[1].layoutIconSize, 80);
  assert.equal(h.globalWrites.length, 0); assert.equal(h.stored.layoutIconSize, 96);
  assert.equal(h.mirrors.get('a').layoutIconSize, 70);
  h.switchTo('b'); await h.api.readAndApply();
  assert.equal(h.api.get().layoutIconSize, 80); assert.equal(h.api.get().todoButtonVisible, false);
  h.api.patch({ layoutShowNames: false }); await h.api.whenIdle();
  assert.equal(h.mirrors.get('a').layoutIconSize, 70); assert.equal(h.mirrors.get('b').layoutIconSize, 80);
  assert.equal(h.profiles[0].layoutShowNames, true); assert.equal(h.profiles[1].layoutShowNames, false);
  assert.equal(await h.api.setTodoButtonVisible(true), true); await h.api.whenIdle();
  assert.deepEqual(h.globalWrites, [{ todoButtonVisible: true }]);
  assert.equal(h.profiles.some(p => 'todoButtonVisible' in p), false);
  h.switchTo('a'); assert.equal(h.api.get().todoButtonVisible, true);
  h.api.reset(); await h.api.whenIdle();
  assert.equal(h.persisted.at(-1).settings.todoButtonVisible, true, 'reset may atomically request global visibility alongside profile layout');
}
for (const failure of [false, undefined, 'true', new Error('failed')]) {
  const h = layoutHarness(), wait = deferred(); h.setSave(() => wait.promise);
  h.api.patch({ layoutIconSize: 88 });
  assert.equal(h.api.get().layoutIconSize, 88);
  assert.equal(h.mirrorWrites.length, 0, 'optimistic layout is never written to boot cache');
  let idle = false; const pending = h.api.whenIdle().then(() => { idle = true; });
  await settle(); assert.equal(idle, false, 'whenIdle waits for persistence');
  // Another controller update can change the committed profile while save waits.
  h.profiles[0].layoutIconSize = 64;
  if (failure instanceof Error) wait.reject(failure); else wait.resolve(failure);
  await pending;
  assert.equal(h.api.get().layoutIconSize, 64, 'failure restores latest committed profile, not a captured stale profile');
  assert.equal(h.mirrors.get('a').layoutIconSize, 64);
  assert.equal(h.api.get().todoButtonVisible, false); assert.equal(h.errors.length, 1);
}
// A pending old-scene failure cannot restore over the active scene or its mirror.
{
  const h = layoutHarness(), wait = deferred(); h.setSave(() => wait.promise);
  h.api.patch({ layoutIconSize: 88 }); await settle();
  h.switchTo('b'); wait.resolve(false); await h.api.whenIdle();
  assert.equal(h.api.get().layoutIconSize, 80); assert.equal(h.mirrorWrites.length, 0);
  assert.equal(h.errors.length, 0);
}
// Serialize operations and do not roll back a newer optimistic operation.
{
  const h = layoutHarness(), first = deferred(), second = deferred(); let call = 0;
  h.setSave(() => ++call === 1 ? first.promise : second.promise);
  h.api.patch({ layoutIconSize: 64 }); await settle();
  h.api.patch({ layoutIconSize: 88 }); first.resolve(false); await settle();
  assert.equal(h.api.get().layoutIconSize, 88); assert.equal(h.mirrorWrites.length, 0);
  assert.equal(h.persisted.length, 2); second.resolve(true); await h.api.whenIdle();
  assert.equal(h.mirrors.get('a').layoutIconSize, 88);
  assert.equal(h.profiles[0].layoutIconSize, 88);
}
// A global visibility save during a scene layout save remains global and current.
{
  const h = layoutHarness(), wait = deferred(); h.setSave(() => wait.promise);
  h.api.patch({ layoutIconSize: 72 }); await settle();
  const visibility = h.api.setTodoButtonVisible(true);
  assert.equal(h.globalWrites.length, 0, 'global visibility joins the scene queue');
  wait.resolve(true); await visibility; await h.api.whenIdle();
  assert.equal(h.api.get().todoButtonVisible, true); assert.equal(h.mirrors.get('a').todoButtonVisible, true);
  assert.equal(h.profiles.some(p => 'todoButtonVisible' in p), false);
}
// Home/global-todo mirror writes never cache a pending optimistic scene layout.
{
  const h = layoutHarness(), wait = deferred(); h.setSave(() => wait.promise);
  h.api.patch({ layoutIconSize: 88 }); await settle();
  assert.equal(h.api.bootMirrorSlice().layoutIconSize, 56);
  const visibility = h.api.setTodoButtonVisible(true);
  h.api.loadFromStorage(h.stored); // An independent refresh supersedes recovery.
  wait.resolve(false); await visibility; await h.api.whenIdle();
  assert.equal(h.mirrors.get('a').layoutIconSize, 56);
  assert.equal(h.mirrors.get('a').todoButtonVisible, true);
  assert.equal(h.api.get().layoutIconSize, 56);
  assert.equal(h.mirrors.get('a').layoutIconSize, 56, 'superseded recovery cannot strand a failed optimistic mirror');
}
// Recovery itself is awaited, and cannot overwrite a newer operation after its read.
{
  const h = layoutHarness(), save = deferred(); let recover;
  h.setSave(() => save.promise);
  h.api.patch({ layoutIconSize: 88 }); await settle();
  h.g.chrome.storage.local.get = (_keys, cb) => { recover = cb; };
  let idle = false; const pending = h.api.whenIdle().then(() => { idle = true; });
  save.resolve(false); await settle();
  assert.equal(typeof recover, 'function'); assert.equal(idle, false);
  assert.equal(h.api.get().layoutIconSize, 88, 'recovery has not yet applied');
  h.setSave(async () => true); h.api.patch({ layoutIconSize: 72 });
  recover({ todoButtonVisible: false }); await pending;
  assert.equal(h.api.get().layoutIconSize, 72);
  assert.equal(h.mirrors.get('a').layoutIconSize, 72);
}
// The controller may switch while a storage read waits; apply the latest profile.
{
  const h = layoutHarness(); let read;
  h.g.chrome.storage.local.get = (_keys, cb) => { read = cb; };
  const pending = h.api.readAndApply(); h.switchTo('b');
  read({ layoutIconSize: 48, todoButtonVisible: true }); await pending;
  assert.equal(h.api.get().layoutIconSize, 80); assert.equal(h.api.get().todoButtonVisible, true);
}
// Daily failure must finish recovery before manual work captures its baseline.
for (const manualSaved of [true, false]) {
  const h = bingHarness(), dailySave = deferred(); let saves = 0;
  h.setPersistence(() => ++saves === 1 ? dailySave.promise : Promise.resolve(manualSaved));
  const daily = h.api.refreshDailyIfNeeded();
  h.respond(0, { url: 'assets/daily-candidate.jpg' }); await settle();
  assert.equal(h.state.background.value, 'assets/daily-candidate.jpg');
  const manual = h.api.fetchRandomBackground();
  assert.equal(h.callbacks.length, 1, 'manual waits instead of adopting provisional daily state');
  dailySave.resolve(false); await daily; await settle();
  assert.equal(h.callbacks.length, 2);
  h.respond(1, { url: 'assets/manual-candidate.jpg' }); await manual;
  const expected = manualSaved ? 'assets/manual-candidate.jpg' : 'assets/a.jpg';
  assert.equal(h.profiles[0].background.value, expected);
  assert.equal(h.state.background.value, expected);
  assert.equal(h.mirrors.at(-1).background.value, expected);
  assert.equal(h.persisted[1].guard.before.value, 'assets/a.jpg');
  assert.equal(h.mirrors.some(m => m.background.value === 'assets/daily-candidate.jpg'), false);
}
// A click queued behind daily persistence is still bound to its original view.
{
  const h = bingHarness(), dailySave = deferred(); h.setPersistence(() => dailySave.promise);
  const daily = h.api.refreshDailyIfNeeded(); h.respond(0); await settle();
  const manual = h.api.fetchRandomBackground();
  h.changeView('b'); dailySave.resolve(false); await daily; await manual;
  assert.equal(h.callbacks.length, 1, 'old scene click cannot start a new-scene request');
  assert.equal(h.state.background.value, 'assets/b.jpg');
}
// Daily refresh cannot adopt an in-flight manual candidate as its baseline.
{
  const h = bingHarness(), save = deferred(); h.setPersistence(() => save.promise);
  const manual = h.api.fetchRandomBackground(); h.respond(0); await settle();
  const daily = h.api.refreshDailyIfNeeded();
  assert.equal(daily, manual); assert.equal(h.callbacks.length, 1);
  save.resolve(false); await manual; await daily;
  assert.equal(h.state.background.value, 'assets/a.jpg');
}
// Reset/global writes share one queue and leave the latest intent everywhere.
for (const setterFirst of [false, true]) {
  const h = layoutHarness(), hold = deferred();
  if (!setterFirst) {
    h.setSave(() => hold.promise); h.api.reset(); await settle();
    const setter = h.api.setTodoButtonVisible(false);
    assert.equal(h.globalWrites.length, 0);
    hold.resolve(true); await setter;
  } else {
    let finish;
    h.g.chrome.storage.local.set = (payload, cb) => {
      finish = () => { Object.assign(h.stored, copy(payload)); cb(); };
    };
    const setter = h.api.setTodoButtonVisible(false); await settle();
    h.api.reset(); assert.equal(h.api.get().todoButtonVisible, true);
    finish(); await setter;
  }
  assert.notEqual(await h.api.whenIdle(), false);
  const expected = setterFirst;
  assert.equal(h.stored.todoButtonVisible, expected);
  assert.equal(h.api.get().todoButtonVisible, expected);
  assert.equal(h.mirrors.get('a').todoButtonVisible, expected);
}
// Stale storage reads cannot undo a newer completed global visibility choice.
for (const readDuringWrite of [false, true]) {
  const h = layoutHarness(); let read, finish;
  h.g.chrome.storage.local.get = (_keys, cb) => { read = cb; };
  h.g.chrome.storage.local.set = (payload, cb) => {
    finish = () => { Object.assign(h.stored, copy(payload)); cb(); };
  };
  let pendingRead, setter;
  if (readDuringWrite) {
    setter = h.api.setTodoButtonVisible(true); await settle(); pendingRead = h.api.readAndApply();
  } else {
    pendingRead = h.api.readAndApply(); setter = h.api.setTodoButtonVisible(true); await settle();
  }
  finish(); await setter; read({ todoButtonVisible: false }); await pendingRead;
  assert.equal(h.stored.todoButtonVisible, true); assert.equal(h.api.get().todoButtonVisible, true);
  assert.equal(h.mirrors.get('a').todoButtonVisible, true);
}
// A failed appearance write blocks exactly one drain, including global failures.
for (const visibility of [false, true]) {
  const h = layoutHarness();
  if (visibility) {
    h.g.chrome.storage.local.set = (_payload, cb) => {
      h.g.chrome.runtime.lastError = { message: 'failed global write' }; cb(); delete h.g.chrome.runtime.lastError;
    };
    assert.equal(await h.api.setTodoButtonVisible(true), false);
  } else {
    h.setSave(async () => false); h.api.patch({ layoutIconSize: 88 });
  }
  assert.equal(await h.api.whenIdle(), false);
  const retry = await h.api.whenIdle();
  assert.equal(retry.layoutIconSize, 56); assert.equal(retry.todoButtonVisible, false);
}
// Queued size edits retain exact field intent when an earlier save adopts a
// different tab's disjoint column edit. Full normalized payloads are not patches.
{
  const h = layoutHarness(), first = deferred(); let calls = 0;
  h.setSave(() => ++calls === 1 ? first.promise : Promise.resolve(true));
  h.api.patch({ layoutIconSize: 64 }); await settle();
  h.api.patch({ layoutIconSize: 80 });
  h.profiles[0].layoutColumns = 8; // First coordinator result includes remote columns.
  first.resolve(true); assert.notEqual(await h.api.whenIdle(), false);
  assert.deepEqual(h.persisted.map(item => item.intent.keys), [['layoutIconSize'], ['layoutIconSize']]);
  assert.equal(h.persisted[1].settings.layoutColumns, 0, 'normalized queued snapshot can be stale');
  assert.equal(h.persisted[1].intent.before.layoutColumns, 0, 'before records dispatch, not execution');
  assert.equal(h.persisted[1].intent.before.layoutIconSize, 56, 'before is a committed informational snapshot');
  assert.equal(h.profiles[0].layoutIconSize, 80); assert.equal(h.profiles[0].layoutColumns, 8);
  assert.equal(h.api.get().layoutColumns, 8);
  assert.equal(h.mirrors.get('a').layoutIconSize, 80); assert.equal(h.mirrors.get('a').layoutColumns, 8);
  h.api.persist({ layoutIconSize: 72 }); await h.api.whenIdle();
  assert.deepEqual(h.persisted.at(-1).intent.keys, ['layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth']);
  h.api.reset(); await h.api.whenIdle();
  assert.deepEqual(h.persisted.at(-1).intent.keys, ['layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth', 'todoButtonVisible']);
}
console.log('Scene appearance tests passed: guarded Bing races and rollback, isolated boot mirrors, scoped layout persistence and idle recovery');
