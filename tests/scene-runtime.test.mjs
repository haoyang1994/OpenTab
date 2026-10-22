import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Workspace = require('../workspace-persistence.js');
const Commands = require('../scene-workspace.js');
const Controller = require('../scene-controller.js');
const copy = structuredClone;
const source = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const flush = () => new Promise(setImmediate);
const until = async predicate => { for (let n = 0; n < 100 && !predicate(); n++) await flush(); assert.ok(predicate(), 'expected asynchronous result'); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const legacy = () => ({
  folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }],
  icons: [{ id: 'x', name: 'X', type: 'shortcut', url: 'https://example.com/', folderId: 'work' }],
  todos: [{ id: 't', text: 'Task', done: false }], currentFolderId: 'work',
  background: { type: 'gradient', value: 'old' }, bingIndex: 0,
  themeMode: 'dark', browserSyncEnabled: false, unrelated: { preserved: true }
});
const seed = () => Schema.create(Schema.migrateLegacy(legacy()), { id: 'study', name: 'Study', iconKey: 'book', homeGroupId: 'study-home', homeName: 'Home' });
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};
function documentStub() {
  const doc = { activeElement: null };
  class Element {
    constructor(tag) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.hidden = false; this.disabled = false; this.textContent = ''; }
    appendChild(child) { child.remove(); this.children.push(child); child.parentElement = this; return child; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    focus() { doc.activeElement = this; }
    showModal() { this.open = true; this.modal = true; }
    close() { this.open = false; }
    cancel() { let prevented = false; this.events.cancel?.forEach(fn => fn({ preventDefault() { prevented = true; } })); if (!prevented) this.close(); }
    click() { if (!this.disabled) this.events.click?.forEach(fn => fn({})); }
    find(action) { return this.dataset.sceneAction === action ? this : this.children.map(child => child.find(action)).find(Boolean); }
  }
  doc.createElement = tag => new Element(tag); doc.body = new Element('body');
  return { doc, mount: doc.body.appendChild(new Element('div')) };
}
function harness(initial = seed()) {
  const store = copy(initial), writes = [], preferences = memory(), listeners = new Set();
  let nextFailure = null, nextRead = null, nextWrite = null;
  const chrome = { runtime: {}, storage: { onChanged: {
    addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener)
  }, local: {
    get(keys, callback) {
      const value = copy(keys === null ? store : Object.fromEntries(keys.filter(key => Object.hasOwn(store, key)).map(key => [key, store[key]])));
      if (nextRead) { const hook = nextRead; nextRead = null; hook(); }
      if (callback) { queueMicrotask(() => callback(value)); return; }
      return Promise.resolve(value);
    },
    async set(patch) {
      if (nextFailure) { const error = nextFailure; nextFailure = null; throw error; }
      writes.push(copy(patch)); Object.assign(store, copy(patch));
      if (nextWrite) { const hook = nextWrite; nextWrite = null; hook(patch); }
    }
  } } };
  const coordinator = Workspace.forChrome(chrome);
  function tab({ session = memory(), plainSecretMigration, onDiscardDraft } = {}) {
    const { doc, mount } = documentStub(), loadStatuses = [], state = copy(initial), loads = [], errors = [], mirrors = [], undo = [], bingHost = {};
    let runtime, managerHost, provider, reloader, layoutAdapter, id = 0, dirty = false, invalidations = 0, visibleRenders = 0, opens = 0, reloads = 0, migrations = 0, loadHook;
    const bridge = coordinator.connect({ state, getViewIdentity: () => runtime?.getView(),
      onChange() { runtime?.syncVisibleAppearance(); visibleRenders++; }, onError(error) { errors.push(error); },
      onSaved(raw) { runtime.noteCommitted(raw); mirrors.push(copy(g.OpenTabLayout.bootMirrorSlice())); }
    });
    const g = { console, structuredClone, queueMicrotask, setTimeout, clearTimeout, AbortController, TextEncoder, URL, chrome,
      crypto: { randomUUID: () => `generated-${++id}` }, sessionStorage: session, localStorage: preferences,
      location: { reload() { reloads++; } },
      OpenTabWorkspace: coordinator, OpenTabSceneSchema: Schema, OpenTabSceneWorkspace: Commands, OpenTabSceneController: Controller,
      OpenTabSceneUI: { init(host) { managerHost = host; return { open() { opens++; return true; }, render() {}, destroy() {} }; } },
      OpenTabSync: { async migratePlaintextSecrets() { migrations++; return plainSecretMigration?.(); } },
      OpenTabFolders: { async selectGroup() { return true; } },
      OpenTabSettingsNav: { openSection(id) { assert.equal(id, 'sync'); } }
    };
    vm.createContext(g);
    vm.runInContext(source('import.js'), g);
    const setProvider = g.OpenTabImport.setSceneContextProvider, setReloader = g.OpenTabImport.setReloader;
    g.OpenTabImport.setSceneContextProvider = next => { provider = next; setProvider(next); };
    g.OpenTabImport.setReloader = next => { reloader = next; setReloader(next); };
    vm.runInContext(source('layout.js'), g);
    const setAdapter = g.OpenTabLayout.setSceneAdapter;
    g.OpenTabLayout.setSceneAdapter = adapter => { layoutAdapter = adapter; return setAdapter(adapter); };
    vm.runInContext(source('scene-runtime.js'), g);
    assert.equal(writes.length, 0, 'script evaluation is inert');
    runtime = g.OpenTabSceneRuntime.create({ state, workspace: bridge, mount, bingHost,
      applyLoadedState(projected, raw) {
        loads.push(copy({ projected, raw })); Object.assign(state, copy(projected));
        g.OpenTabLayout.loadFromStorage(projected); bridge.seed(raw);
        if (loadHook) return loadHook();
      }, showToast(text, options) { errors.push(text); if (options?.onAction) undo.push(options.onAction); },
      onDiscardDraft, onLoadStatus: value => loadStatuses.push(value), beforeSwitch: () => !dirty, onInvalidate: () => invalidations++, renderVisible: () => visibleRenders++
    });
    return { runtime, g, state, session, doc, loadStatuses, mount, bridge, bingHost, loads, errors, mirrors, undo,
      get host() { return managerHost; }, get layoutAdapter() { return layoutAdapter; }, get provider() { return provider; }, get reloader() { return reloader; },
      get opens() { return opens; }, get reloads() { return reloads; }, get migrations() { return migrations; },
      get invalidations() { return invalidations; }, get visibleRenders() { return visibleRenders; },
      setDirty(value) { dirty = value; }, setLoadHook(hook) { loadHook = hook; }
    };
  }
  return { store, writes, listeners, coordinator, tab,
    failNext(error = new Error('quota')) { nextFailure = error; },
    onNextRead(fn) { nextRead = fn; }, onNextWrite(fn) { nextWrite = fn; },
    emit(changes, area = 'local') { listeners.forEach(listener => listener(changes, area)); }
  };
}
const context = tab => ({ view: tab.runtime.getView() });

// Unresolved initial storage cannot use the legacy wallpaper/layout mutation paths.
{
  const h = harness(legacy()), a = h.tab(), gate = deferred(), started = deferred();
  const held = h.coordinator.transaction(async () => { started.resolve(); await gate.promise; }); await started.promise;
  const loading = a.runtime.load();
  assert.equal(a.loadStatuses.at(-1), false); assert.equal(a.bingHost.getSceneView(), null);
  assert.equal(await a.bingHost.persistBackground({}, {}), false);
  gate.resolve(); await held; assert.equal(await loading, true);
  assert.equal(typeof a.bingHost.getSceneView, 'undefined'); assert.equal(a.loadStatuses.at(-1), true);
  assert.equal(h.writes.length, 0);
}

// Validated loader normalization can save synchronously without awaiting its own load.
for (const active of [false, true]) {
  const h = harness(active ? seed() : legacy()), a = h.tab(); let saved;
  a.setLoadHook(async () => {
    a.state.background = { type: 'gradient', value: 'normalized' };
    saved = await a.runtime.saveState();
  });
  assert.equal(await a.runtime.load(), true); assert.equal(saved, true);
  if (active) assert.equal(h.store.sceneProfiles.find(profile => profile.id === a.runtime.getView().sceneId).background.value, 'normalized');
  else assert.equal(h.store.background.value, 'normalized');
  assert.equal(h.writes.length, 1);
}

// Legacy loading and opening the introduction have no storage, sync or adapter side effects.
{
  const h = harness(legacy()), a = h.tab(), before = copy(h.store);
  assert.equal(a.provider, undefined); assert.equal(typeof a.bingHost.getSceneView, 'undefined');
  assert.equal(await a.runtime.load(), true); assert.equal(a.runtime.isActive(), false);
  assert.equal(a.loads.length, 1); assert.deepEqual(a.loads[0].projected, before);
  assert.equal(await a.runtime.openManager(), true);
  assert.equal(a.mount.find('enable').parentElement.hidden, false);
  assert.equal(a.migrations, 0); assert.deepEqual(h.store, before); assert.equal(h.writes.length, 0);
  a.mount.find('cancel').click(); assert.equal(a.mount.find('enable').parentElement.hidden, true);
  assert.equal(await a.g.OpenTabSceneNavigation.selectGroup('work'), true, 'legacy palette retains its normal navigation');
  await a.runtime.openManager(); a.mount.find('enable').click(); a.mount.find('enable').click();
  await until(() => a.runtime.isActive() && a.opens === 1);
  assert.equal(a.migrations, 1); assert.equal(h.writes.length, 1);
  assert.ok(h.store[Commands.BACKUP_KEY]); assert.equal(h.store[Schema.SCHEMA_KEY], 2);
  assert.equal(a.runtime.getView().currentFolderId, 'work'); assert.equal(h.store.browserSyncEnabled, false);
  assert.equal(typeof a.bingHost.getSceneView, 'function'); assert.equal(typeof a.provider, 'function');
  await a.runtime.openManager(); assert.equal(a.migrations, 1); assert.equal(h.writes.length, 1);
}

// Migration events cannot race activation into another tab's compatibility selection.
{
  const h = harness(legacy()), a = h.tab(); await a.runtime.load(); await a.runtime.openManager();
  h.onNextWrite(() => {
    h.store.currentFolderId = 'folder-home';
    h.emit({ [Schema.SCHEMA_KEY]: {}, scenes: {}, currentFolderId: {} });
  });
  a.mount.find('enable').click(); await until(() => a.opens === 1); await flush();
  assert.equal(a.runtime.getView().currentFolderId, 'work');
  assert.equal(h.writes.length, 1); assert.equal(a.migrations, 1);
}

// Refusal and failed migration preserve the legacy workspace, including secrets.
for (const mode of ['dirty', 'write', 'vault']) {
  const initial = legacy(); if (mode === 'vault') initial.icons[0].sshPassword = 'not-for-backups';
  const h = harness(initial), a = h.tab({ plainSecretMigration: mode === 'vault' ? () => { throw new Error('vault unavailable'); } : undefined });
  await a.runtime.load(); await a.runtime.openManager();
  if (mode === 'dirty') a.setDirty(true);
  if (mode === 'write') h.failNext();
  a.mount.find('enable').click(); await until(() => a.errors.length > 0); await flush();
  assert.equal(a.runtime.isActive(), false); assert.deepEqual(h.store, initial); assert.equal(h.writes.length, 0);
  assert.equal(h.store[Commands.BACKUP_KEY], undefined); assert.equal(a.mount.find('enable').disabled, false);
  assert.ok(a.doc.body.find('settings')); assert.equal(a.doc.body.find('retry').parentElement.parentElement, a.doc.body);
  assert.equal(a.loadStatuses.at(-1), true, 'recoverable legacy failure keeps the existing page usable');
}

// Unsupported or partial data never enters the normalizer or obtains a save baseline.
for (const broken of [{ ...legacy(), [Schema.SCHEMA_KEY]: 99 }, { ...legacy(), scenes: [] },
  { ...legacy(), folders: [{ id: 'folder-home', name: 'Home', sceneId: 'orphan' }] }]) {
  const h = harness(broken), a = h.tab();
  assert.equal(await a.runtime.load(), false); assert.equal(a.loads.length, 0);
  assert.equal(await a.runtime.saveState(), false); assert.equal(await a.runtime.openManager(), false);
  assert.deepEqual(h.store, broken); assert.equal(h.writes.length, 0); assert.equal(a.bingHost.getSceneView(), null);
  assert.equal(await a.bingHost.persistBackground({}, {}), false); assert.equal(a.loadStatuses.at(-1), false);
  assert.equal(a.doc.body.find('retry').parentElement.id, 'scene-recovery');
}

// An active page encountering an unsupported graph makes its wallpaper host inert too.
{
  const h = harness(), a = h.tab(); await a.runtime.load(); const view = a.runtime.getView();
  h.store[Schema.SCHEMA_KEY] = 99; assert.equal(await a.runtime.load(), false);
  assert.deepEqual(a.runtime.getView(), view); assert.equal(a.bingHost.getSceneView(), null);
  assert.equal(a.doc.body.find('discard-draft').hidden, true);
  assert.equal(await a.bingHost.persistBackground({ background: { type: 'gradient', value: 'wrong' } }, { view, before: a.state.background }), false);
  assert.equal(h.writes.length, 0);
}

// Failed initial load recovery restores legacy-only hook absence and removes its portal.
{
  const bad = { ...legacy(), [Schema.SCHEMA_KEY]: 99 }, h = harness(bad), a = h.tab();
  await a.runtime.load(); assert.equal(a.doc.body.find('settings').hidden, true);
  delete h.store[Schema.SCHEMA_KEY];
  assert.equal(await a.runtime.load(), true); assert.equal(typeof a.bingHost.getSceneView, 'undefined');
  assert.equal(a.doc.body.find('retry'), undefined); assert.equal(a.loadStatuses.at(-1), true);
  assert.equal(h.writes.length, 0);
}

// Storage changes during the first read get a trailing read, not a permanently stale initial view.
for (const active of [false, true]) {
  const h = harness(active ? seed() : legacy()), a = h.tab();
  h.onNextRead(() => {
    h.store.icons[0].name = 'During first read';
    if (!active) Object.assign(h.store, Schema.migrateLegacy(h.store));
    h.emit({ icons: {}, [Schema.SCHEMA_KEY]: {} });
  });
  await a.runtime.load(); await until(() => a.state.icons[0].name === 'During first read');
  assert.equal(a.runtime.isActive(), true); assert.equal(h.writes.length, 0);
}

// An external upgrade cannot replace a legacy page beneath its unsaved draft.
{
  const h = harness(legacy()); let allowed = false, discarded = 0;
  const a = h.tab({ onDiscardDraft() { discarded++; if (allowed) { a.setDirty(false); return true; } return 1; } });
  await a.runtime.load(); a.setDirty(true);
  const displayed = copy(a.state); Object.assign(h.store, Schema.migrateLegacy(h.store));
  h.emit({ [Schema.SCHEMA_KEY]: {}, scenes: {} }); await until(() => a.errors.length > 0);
  assert.equal(a.runtime.isActive(), false); assert.deepEqual(a.state, displayed);
  assert.equal(await a.runtime.saveState(), false); assert.equal(a.bingHost.getSceneView(), null);
  assert.equal(a.loadStatuses.at(-1), false);
  const portal = a.doc.body.find('retry').parentElement;
  assert.equal(portal.tagName, 'dialog'); assert.equal(portal.modal, true); portal.cancel(); assert.equal(portal.open, true);
  const discard = a.doc.body.find('discard-draft'); assert.equal(discard.hidden, false);
  discard.click(); await flush(); assert.equal(discarded, 1); assert.equal(a.runtime.isActive(), false, 'truthy is not discard approval');
  allowed = true; discard.click(); discard.click(); await until(() => a.runtime.isActive());
  assert.equal(discarded, 2); assert.equal(portal.open, false); assert.equal(portal.parentElement, null);
  assert.equal(h.writes.length, 0);
}

// Explicit sync reloads during enable do not re-seed the old protocol mid-transaction.
{
  const gate = deferred(), h = harness(legacy()), a = h.tab({ plainSecretMigration: () => gate.promise });
  await a.runtime.load(); await a.runtime.openManager(); a.mount.find('enable').click();
  await until(() => a.migrations === 1);
  const reload = a.runtime.load(); await flush(); assert.equal(a.loads.length, 1);
  gate.resolve(); assert.equal(await reload, true); await until(() => a.runtime.isActive());
  assert.equal(h.writes.length, 1); assert.equal(a.state[Schema.SCHEMA_KEY], 2);
}

// A draft opened while the vault is pending is checked again before any migration write.
{
  const gate = deferred(), h = harness(legacy()), a = h.tab({ plainSecretMigration: () => gate.promise });
  await a.runtime.load(); await a.runtime.openManager(); a.mount.find('enable').click();
  await until(() => a.migrations === 1); a.setDirty(true); gate.resolve();
  await until(() => a.errors.length > 0); await flush();
  assert.equal(h.writes.length, 0); assert.equal(a.runtime.isActive(), false);
  assert.equal(a.loadStatuses.at(-1), true);
}

// Migration rechecks the captured tab/draft while holding the coordinator lock.
{
  const gate = deferred(), started = deferred(), h = harness(legacy()); let held;
  const a = h.tab({ async plainSecretMigration() {
    held = h.coordinator.transaction(async () => { started.resolve(); await gate.promise; });
    await started.promise;
  } });
  await a.runtime.load(); await a.runtime.openManager(); a.mount.find('enable').click();
  await started.promise; await flush(); a.setDirty(true); gate.resolve(); await held;
  await until(() => a.errors.length > 0); assert.equal(h.writes.length, 0);
  assert.equal(h.store[Schema.SCHEMA_KEY], undefined); assert.equal(a.runtime.isActive(), false);
}

// A draft appearing during the durable migration write is preserved for explicit recovery.
{
  const h = harness(legacy()), a = h.tab(); await a.runtime.load(); await a.runtime.openManager();
  const displayed = copy(a.state); h.onNextWrite(() => a.setDirty(true));
  a.mount.find('enable').click(); await until(() => a.errors.length > 0); await flush();
  assert.equal(h.store[Schema.SCHEMA_KEY], 2); assert.equal(h.writes.length, 1);
  assert.equal(a.runtime.isActive(), false); assert.deepEqual(a.state, displayed);
  assert.equal(a.loads.length, 1); assert.equal(a.bingHost.getSceneView(), null);
  assert.equal(a.errors.some(error => String(error).includes('未能启用场景空间')), false, 'durable migration is not reported as a failed write');
  a.setDirty(false); assert.equal(await a.runtime.load(), true); assert.equal(a.runtime.isActive(), true);
  assert.equal(h.writes.length, 1, 'retry only loads the already migrated graph');
}

// Disposing during rendering cannot create a manager when the renderer finishes.
{
  const gate = deferred(), h = harness(), a = h.tab();
  a.setLoadHook(() => gate.promise); const loading = a.runtime.load();
  await until(() => a.loads.length === 1); a.runtime.dispose(); gate.resolve();
  assert.equal(await loading, false); assert.equal(a.host, undefined);
  assert.equal(a.g.OpenTabSceneNavigation, undefined); assert.equal(h.listeners.size, 0);
}

// Undo affordance must not erase the saved-but-deferred draft notice.
{
  const h = harness(), a = h.tab(); await a.runtime.load(); const view = a.runtime.getView();
  h.onNextWrite(() => a.setDirty(true));
  assert.equal(await a.host.onArchive({ sceneId: view.sceneId, context: context(a) }), true);
  assert.deepEqual(a.runtime.getView(), view); assert.equal(a.undo.length, 1);
  assert.equal(a.errors.at(-1), '场景已保存，请完成或取消当前编辑后重新选择。');
}

// Real controller and bridge preserve full canonical arrays and isolated tab views.
{
  const h = harness(), a = h.tab(), b = h.tab();
  await Promise.all([a.runtime.load(), b.runtime.load()]);
  assert.equal(a.runtime.isActive(), true); assert.equal(h.writes.length, 0);
  const full = copy(h.store), stale = context(a);
  assert.equal(await a.host.onSwitch('study', context(a)), true);
  assert.equal(a.runtime.getView().sceneId, 'study'); assert.equal(b.runtime.getView().sceneId, Schema.DEFAULT_SCENE_ID);
  await b.runtime.load(); assert.equal(b.runtime.getView().currentFolderId, 'work'); assert.equal(b.state.background.value, 'old');
  for (const key of ['folders', 'icons', 'todos', 'scenes', 'sceneProfiles']) assert.deepEqual(a.state[key], full[key]);
  await assert.rejects(a.host.onRename({ sceneId: 'study', name: 'Stale', context: stale }), error => error.code === 'SCENE_CONFLICT');
  assert.equal(await a.host.onRename({ sceneId: 'study', name: 'Learning', context: context(a) }), true);
  assert.equal(h.store.scenes.find(item => item.id === 'study').name, 'Learning');
  assert.equal(await a.host.onCreate({ name: 'Trip', iconKey: 'book', context: context(a) }), true);
  const created = a.runtime.getView().sceneId;
  assert.equal(await a.host.onArchive({ sceneId: created, context: context(a) }), true);
  assert.equal(await a.host.onRestore({ sceneId: created, context: context(a) }), true);
  assert.equal(await a.host.onMoveGroup({ groupId: 'work', targetSceneId: 'study', context: context(a) }), true);
  assert.equal(h.store.folders.find(group => group.id === 'work').sceneId, 'study');
  assert.deepEqual(h.store.unrelated, { preserved: true }); assert.equal(h.store.browserSyncEnabled, false);
}

// Active profile writes are queued, strictly guarded, and cannot write global aliases.
{
  const h = harness(), a = h.tab(), b = h.tab(); await a.runtime.load(); await b.runtime.load();
  await b.host.onSwitch('study', context(b));
  const old = copy(a.state.background), aView = a.runtime.getView(), bView = b.runtime.getView();
  const first = { background: { type: 'gradient', value: 'A' }, bingIndex: 2 };
  const second = { background: { type: 'gradient', value: 'B' }, bingIndex: 3 };
  assert.deepEqual(await Promise.all([a.bingHost.persistBackground(first, { view: aView, before: old }),
    b.bingHost.persistBackground(second, { view: bView, before: copy(b.state.background) })]), [true, true]);
  assert.equal(h.store.sceneProfiles[0].background.value, 'A'); assert.equal(h.store.sceneProfiles[1].background.value, 'B');
  assert.equal(h.store.background.value, 'old');
  const before = copy(h.store);
  assert.equal(await a.bingHost.persistBackground(second, { view: { ...aView, generation: aView.generation - 1 }, before: first.background }), false);
  assert.deepEqual(h.store, before);
  h.store.sceneProfiles[0].background = { type: 'gradient', value: 'Remote' };
  assert.equal(await a.bingHost.persistBackground(second, { view: aView, before: first.background }), false);
  assert.equal(h.store.sceneProfiles[0].background.value, 'Remote'); assert.equal(a.state.background.value, 'Remote');
}

// Mirrors use the committed profile while a layout edit is optimistic/in flight.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  const held = deferred(), started = deferred();
  const lock = h.coordinator.transaction(async () => { started.resolve(); await held.promise; }); await started.promise;
  a.g.OpenTabLayout.patch({ layoutIconSize: 80 }); await flush();
  assert.equal(a.g.OpenTabLayout.get().layoutIconSize, 80);
  assert.equal(a.g.OpenTabLayout.bootMirrorSlice().layoutIconSize, 56);
  assert.equal(h.store.sceneProfiles[0].layoutIconSize, 56);
  held.resolve(); await lock; await a.g.OpenTabLayout.whenIdle(); await a.bridge.whenIdle();
  assert.equal(h.store.sceneProfiles[0].layoutIconSize, 80);
  assert.equal(a.g.OpenTabLayout.bootMirrorSlice().layoutIconSize, 80);
  h.failNext(); a.g.OpenTabLayout.patch({ layoutIconSize: 96 });
  await a.g.OpenTabLayout.whenIdle(); await a.bridge.whenIdle();
  assert.equal(a.g.OpenTabLayout.get().layoutIconSize, 80);
  assert.equal(a.g.OpenTabLayout.bootMirrorSlice().layoutIconSize, 80);
  assert.equal(h.store.sceneProfiles[0].layoutIconSize, 80);
}

// A failed appearance drain blocks this switch once, including saves begun during the drain.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  h.failNext(); a.g.OpenTabLayout.patch({ layoutIconSize: 80 });
  await assert.rejects(a.host.onSwitch('study', context(a)), error => error.code === 'SCENE_PENDING_SAVE_FAILED');
  assert.equal(a.runtime.getView().sceneId, Schema.DEFAULT_SCENE_ID);
  assert.equal(h.store.sceneProfiles[0].layoutIconSize, 56);
  assert.equal(await a.host.onSwitch('study', context(a)), true);
}

// A full layout display snapshot cannot reassert fields outside immutable intent keys.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  const oldDisplay = a.g.OpenTabLayout.get();
  h.store.sceneProfiles[0].layoutColumns = 8; await a.runtime.load();
  const view = a.runtime.getView();
  assert.equal(await a.layoutAdapter.persist({ ...oldDisplay, layoutIconSize: 80 }, view,
    { keys: ['layoutIconSize'], before: oldDisplay }), true);
  assert.equal(h.store.sceneProfiles[0].layoutIconSize, 80);
  assert.equal(h.store.sceneProfiles[0].layoutColumns, 8);
  assert.equal(h.store.todoButtonVisible, undefined, 'full display snapshot does not make todo visibility explicit');
  assert.equal(await a.layoutAdapter.persist({ ...oldDisplay, layoutIconSize: 96 }, view, { keys: ['unknown'] }), false);
}

// A local group's deletion changes only this tab's durable view and session.
{
  const h = harness(), a = h.tab(), b = h.tab(); await a.runtime.load(); await b.runtime.load();
  const oldView = a.runtime.getView();
  a.state.icons = []; a.state.folders = a.state.folders.filter(group => group.id !== 'work'); a.state.currentFolderId = 'folder-home';
  assert.equal(await a.runtime.saveState(), true);
  assert.equal(a.runtime.getView().currentFolderId, 'folder-home'); assert.ok(a.runtime.getView().generation > oldView.generation);
  assert.equal(JSON.parse(a.session.getItem(Controller.SESSION_KEY)).lastGroupIds[Schema.DEFAULT_SCENE_ID], 'folder-home');
  assert.equal(b.runtime.getView().currentFolderId, 'work', 'save does not directly navigate another tab');
  assert.equal(h.store.currentFolderId, 'folder-home', 'coordinator repairs a removed compatibility alias');
  assert.ok(a.visibleRenders > 0);
}

// Import descriptors are local, support omitted generation, and never revive stale selection.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  const initialView = a.runtime.getView();
  a.reloader({ sceneId: initialView.sceneId, currentFolderId: 'folder-home', generation: initialView.generation });
  assert.equal(JSON.parse(a.session.getItem(Controller.SESSION_KEY)).lastGroupIds[initialView.sceneId], 'folder-home');
  assert.equal(a.reloads, 1); assert.equal(h.writes.length, 0);
  a.reloader({ sceneId: 'study', currentFolderId: 'study-home', generation: initialView.generation - 1 });
  assert.equal(JSON.parse(a.session.getItem(Controller.SESSION_KEY)).sceneId, initialView.sceneId);
  a.reloader({ sceneId: 'study', currentFolderId: 'study-home' });
  assert.equal(JSON.parse(a.session.getItem(Controller.SESSION_KEY)).sceneId, 'study');
  const descriptor = a.session.getItem(Controller.SESSION_KEY); a.reloader();
  assert.equal(a.session.getItem(Controller.SESSION_KEY), descriptor);
  a.reloader({ resetSceneSelection: true }); assert.equal(a.session.getItem(Controller.SESSION_KEY), null);
}

// A real URL-list import persists and reloads toward the initiating scene/group.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  const preview = await a.g.OpenTabImport.previewUrlList('https://new.example.test/', 'folder-home');
  assert.equal(preview.ok, true);
  const result = await a.g.OpenTabImport.commitUrlList(preview);
  assert.equal(result.ok, true); assert.equal(a.reloads, 1);
  assert.equal(JSON.parse(a.session.getItem(Controller.SESSION_KEY)).lastGroupIds[Schema.DEFAULT_SCENE_ID], 'folder-home');
  assert.equal(h.store.icons.at(-1).folderId, 'folder-home');
}

// Storage refresh coalesces through the controller's trailing-read loop, preserving drafts.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  const held = deferred(); let count = 0;
  a.setLoadHook(() => ++count === 1 ? held.promise : undefined);
  h.store.icons[0].name = 'First'; h.emit({ icons: {} }); await until(() => count === 1);
  h.store.icons[0].name = 'Latest'; h.store.currentFolderId = 'study-home'; h.store.background.value = 'Wrong global';
  h.emit({ icons: {}, currentFolderId: {}, background: {} }); await flush();
  held.resolve(); await until(() => a.state.icons[0].name === 'Latest');
  assert.equal(a.runtime.getView().currentFolderId, 'work'); assert.equal(a.state.background.value, 'old');
  a.setLoadHook(null); a.setDirty(true);
  const before = a.runtime.getView();
  h.store.scenes[0].archivedAt = 123; h.emit({ scenes: {} }); await until(() => a.errors.length > 0);
  assert.deepEqual(a.runtime.getView(), before); assert.equal(a.state.scenes[0].archivedAt, null);
  a.setDirty(false); assert.equal(await a.runtime.load(), true); assert.equal(a.runtime.getView().sceneId, 'study');
}

// Failed normal saves restore the tab view without re-seeding while queued saves exist.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  h.failNext(); a.state.currentFolderId = 'folder-home'; a.state.icons[0].name = 'Not saved';
  assert.equal(await a.runtime.saveState(), false);
  assert.equal(a.state.currentFolderId, 'work'); assert.equal(a.runtime.getView().currentFolderId, 'work');
  assert.equal(a.state.icons[0].name, 'X');
  const count = a.loads.length; a.runtime.syncVisibleAppearance(); assert.equal(a.loads.length, count);
}

// Disposal removes runtime-owned adapters/listeners and does not perform writes.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  assert.equal(h.listeners.size, 1); a.runtime.dispose(); a.runtime.dispose();
  assert.equal(h.listeners.size, 0); assert.equal(typeof a.bingHost.getSceneView, 'undefined'); assert.equal(a.provider, null);
  assert.equal(a.g.OpenTabSceneNavigation, undefined); assert.equal(a.reloader, null);
  assert.equal(await a.runtime.load(), false); assert.equal(await a.runtime.saveState(), false); assert.equal(h.writes.length, 0);
}
console.log('Scene runtime tests passed: explicit lazy enable, actual controller/queue integration, isolated profiles, local import navigation, recovery and coalesced refresh.');
