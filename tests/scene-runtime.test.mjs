import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Workspace = require('../workspace-persistence.js');
const Commands = require('../scene-workspace.js');
const Controller = require('../scene-controller.js');
const Layout = require('../layout.js');
const loadKeys = [...new Set([...Workspace.KEYS, ...Layout.STORAGE_KEYS])];
const loadSnapshot = raw => Object.fromEntries(Object.entries(raw).filter(([key]) => loadKeys.includes(key)));
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
  const store = copy(initial), writes = [], reads = [], preferences = memory(), listeners = new Set();
  let nextFailure = null, nextRead = null, nextWrite = null;
  const chrome = { runtime: {}, storage: { onChanged: {
    addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener)
  }, local: {
    get(keys, callback) {
      reads.push(copy(keys));
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
  function tab({ session = memory(), plainSecretMigration, onDiscardDraft, onBusy } = {}) {
    const { doc, mount } = documentStub(), loadStatuses = [], state = copy(initial), loads = [], errors = [], mirrors = [], undo = [], bingHost = {}, marks = [];
    let runtime, managerHost, provider, reloader, layoutAdapter, id = 0, dirty = false, invalidations = 0, visibleRenders = 0, opens = 0, reloads = 0, migrations = 0, loadHook;
    const bridge = coordinator.connect({ state, getViewIdentity: () => runtime?.getView(),
      onChange() { runtime?.syncVisibleAppearance(); visibleRenders++; }, onError(error) { errors.push(error); },
      onSaved(raw) { runtime.noteCommitted(raw); mirrors.push(copy(g.OpenTabLayout.bootMirrorSlice())); }
    });
    const g = { console, structuredClone, queueMicrotask, setTimeout, clearTimeout, AbortController, TextEncoder, URL, chrome,
      performance: { mark: name => marks.push(name) },
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
      onDiscardDraft, onBusy, onLoadStatus: value => loadStatuses.push(value), beforeSwitch: () => !dirty, onInvalidate: () => invalidations++, renderVisible: () => visibleRenders++
    });
    return { runtime, g, state, session, doc, loadStatuses, mount, bridge, bingHost, loads, errors, mirrors, undo, marks,
      get host() { return managerHost; }, get layoutAdapter() { return layoutAdapter; }, get provider() { return provider; }, get reloader() { return reloader; },
      get opens() { return opens; }, get reloads() { return reloads; }, get migrations() { return migrations; },
      get invalidations() { return invalidations; }, get visibleRenders() { return visibleRenders; },
      setDirty(value) { dirty = value; }, setLoadHook(hook) { loadHook = hook; }
    };
  }
  return { store, writes, reads, listeners, coordinator, tab,
    failNext(error = new Error('quota')) { nextFailure = error; },
    onNextRead(fn) { nextRead = fn; }, onNextWrite(fn) { nextWrite = fn; },
    emit(changes, area = 'local') { listeners.forEach(listener => listener(changes, area)); }
  };
}
const context = tab => ({ view: tab.runtime.getView() });

// A local settings acknowledgement is not a scene transition. Exercise actual
// bound inputs and the home capture guard, including a held storage read before
// the next Home-key input can save. No sleep/durable wait separates those inputs.
{
  let busy = false, busyHook;
  const h = harness(), a = h.tab({ onBusy: value => { busy = value; if (value) busyHook?.(); } });
  const doc = a.doc, controls = new Map(), captured = {};
  const classes = () => ({ add() {}, remove() {}, contains() { return false; }, toggle() {} });
  doc.documentElement = { style: { setProperty() {} } }; doc.body.classList = classes();
  doc.readyState = 'complete'; doc.getElementById = id => controls.get(id) || null;
  doc.querySelectorAll = selector => selector === '.layout-size-preset' ? [controls.get('preset')] : [];
  doc.addEventListener = (name, handler) => { (captured[name] ||= []).push(handler); };
  for (const id of ['layout-icon-size', 'layout-columns', 'layout-show-names', 'layout-max-width', 'todo-button-visible', 'preset']) {
    const input = doc.createElement('input'); input.classList = classes(); input.dataset.size = '80'; input.value = ''; input.checked = true;
    controls.set(id, input);
  }
  a.g.document = doc; vm.runInContext(source('layout.js'), a.g); vm.runInContext(source('scene-home.js'), a.g);
  a.g.OpenTabSceneHome.bindInteractionGate(() => ({ readOnly: false, busy }), doc);
  await a.runtime.load(); a.setDirty(true);
  const initialLoads = a.loads.length, initialView = a.runtime.getView();
  const emit = patch => {
    h.emit(Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { newValue }])));
    h.onNextWrite(emit);
  };
  h.onNextWrite(emit);
  controls.get('preset').click(); await a.g.OpenTabLayout.whenIdle();
  const columns = controls.get('layout-columns'); columns.value = '4'; columns.events.change.forEach(fn => fn());
  await a.g.OpenTabLayout.whenIdle();
  const gate = deferred(), started = deferred(); let held;
  h.onNextWrite(patch => {
    emit(patch);
    held = h.coordinator.transaction(async ({ read }) => { await read(null); started.resolve(); await gate.promise; });
  });
  const names = controls.get('layout-show-names'); names.checked = false; names.events.change.forEach(fn => fn());
  await started.promise;
  const width = controls.get('layout-max-width');
  function homeKey() {
    width.focus();
    const event = { type: 'keydown', key: 'Home', target: width, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {} };
    captured.keydown.forEach(fn => fn(event));
    if (!event.defaultPrevented) {
      width.value = '640'; width.events.input.forEach(fn => fn()); width.events.change.forEach(fn => fn());
    }
    return event;
  }
  const key = homeKey();
  gate.resolve(); await held; await a.g.OpenTabLayout.whenIdle(); await flush();
  assert.equal(key.defaultPrevented, false, 'own write acknowledgement must not swallow the next native range key');
  assert.deepEqual(a.runtime.getView(), initialView); assert.equal(a.loads.length, initialLoads);
  const selected = () => h.store.sceneProfiles.find(profile => profile.id === initialView.sceneId);
  assert.deepEqual([selected().layoutIconSize, selected().layoutColumns, selected().layoutShowNames, selected().layoutMaxWidth], [80, 4, false, 640]);
  assert.deepEqual(a.errors, []);

  // The first notification may arrive after newer edits have been staged.
  // Compare with durable readback after draining, not its stale event payload
  // or the newer optimistic state. The next Home key must still be delivered.
  const delayed = copy(h.store.sceneProfiles), overlapGate = deferred(), overlapStarted = deferred();
  const overlapRead = h.coordinator.transaction(async ({ read }) => { await read(null); overlapStarted.resolve(); await overlapGate.promise; });
  await overlapStarted.promise;
  columns.value = '6'; columns.events.change.forEach(fn => fn()); await flush();
  names.checked = true; names.events.change.forEach(fn => fn());
  width.value = '900'; width.events.input.forEach(fn => fn());
  h.emit({ sceneProfiles: { newValue: delayed } }); await flush();
  const nextKey = homeKey();
  overlapGate.resolve(); await overlapRead; await a.g.OpenTabLayout.whenIdle(); await flush();
  assert.equal(nextKey.defaultPrevented, false, 'late acknowledgements cannot lock subsequent queued inputs');
  assert.deepEqual([selected().layoutColumns, selected().layoutShowNames, selected().layoutMaxWidth], [6, true, 640]);
  assert.equal(a.loads.length, initialLoads); assert.deepEqual(a.errors, []);

  // Differing external data and real navigation still retain the existing gate
  // and drain. A held read cannot permit a new key/save across adoption.
  const externalGate = deferred(), externalStarted = deferred(); let externalRead;
  busyHook = () => {
    busyHook = null;
    externalRead = h.coordinator.transaction(async ({ read }) => { await read(null); externalStarted.resolve(); await externalGate.promise; });
  };
  selected().layoutMaxWidth = 1200; h.emit({ sceneProfiles: { newValue: copy(h.store.sceneProfiles) } });
  await externalStarted.promise;
  const writesBefore = h.writes.length;
  assert.equal(homeKey().defaultPrevented, true);
  assert.equal(h.writes.length, writesBefore);
  externalGate.resolve(); await externalRead; await until(() => !busy);
  assert.equal(a.g.OpenTabLayout.get().layoutMaxWidth, 1200);
  a.setDirty(false);
  const switching = a.host.onSwitch('study', context(a));
  assert.equal(homeKey().defaultPrevented, true);
  await switching; assert.equal(a.runtime.getView().sceneId, 'study');
}

// Chrome storage dictionaries need not retain the coordinator result's key
// insertion order. Reordering nested objects alone is still an acknowledgement,
// not a refresh that locks the next input or writes data back to storage.
{
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const initial = seed();
  initial.sceneProfiles[0].background = { type: 'gradient', value: 'linear-gradient(#123,#456)', source: 'gradient',
    details: { first: 1, second: [{ left: 'x', right: null }, false] } };
  const busy = [], h = harness(initial), a = h.tab({ onBusy: value => busy.push(value) });
  await a.runtime.load(); busy.length = 0;
  const view = a.runtime.getView();
  h.onNextWrite(patch => {
    h.store.sceneProfiles = reorder(patch.sceneProfiles);
    h.emit({ sceneProfiles: { newValue: copy(h.store.sceneProfiles) } });
  });
  a.g.OpenTabLayout.patch({ layoutIconSize: 80 }); await a.g.OpenTabLayout.whenIdle();
  for (let n = 0; n < 5; n++) await flush();
  assert.notEqual(JSON.stringify(h.store.sceneProfiles), JSON.stringify(a.state.sceneProfiles), 'fixture changes dictionary order');
  assert.deepEqual(h.store.sceneProfiles, a.state.sceneProfiles, 'all stored keys and values are unchanged');
  assert.deepEqual(busy, [], 'reordered durable acknowledgement must not activate the UI lock');
  assert.equal(a.loads.length, 1); assert.equal(h.writes.length, 1);
  assert.deepEqual(a.runtime.getView(), view); assert.deepEqual(a.errors, []);
}

// Equivalence ignores dictionary order only: values, own keys, primitive types,
// and array type/length/order must still enter the original protected refresh.
for (const [name, change] of [
  ['nested value', profiles => { profiles[0].background.details.first = 2; }],
  ['added key', profiles => { profiles[0].background.details.extra = null; }],
  ['removed key', profiles => { delete profiles[0].background.details.first; }],
  ['primitive type', profiles => { profiles[0].background.details.first = '1'; }],
  ['array order', profiles => { profiles.reverse(); }],
  ['array length', profiles => { profiles[0].background.details.second.push(false); }],
  ['array type', profiles => { profiles[0].background.details.second = { 0: 'x', 1: 'y' }; }],
  ['undefined own key', profiles => { profiles[0].background.details.extra = undefined; }]
]) {
  const initial = seed(); initial.sceneProfiles[0].background.details = { first: 1, second: ['x', 'y'] };
  const busy = [], h = harness(initial), a = h.tab({ onBusy: value => busy.push(value) });
  await a.runtime.load(); busy.length = 0;
  change(h.store.sceneProfiles); const stored = copy(h.store);
  h.emit({ sceneProfiles: { newValue: copy(h.store.sceneProfiles) } });
  await until(() => busy.includes(true)); await until(() => busy.at(-1) === false);
  assert.ok(busy.includes(true), name + ' is not an acknowledgement');
  assert.deepEqual(h.store, stored, name + ' verification never rewrites storage');
  assert.equal(h.writes.length, 0);
}
{
  const busy = [], h = harness(), a = h.tab({ onBusy: value => busy.push(value) });
  await a.runtime.load(); busy.length = 0;
  assert.equal(Object.hasOwn(h.store, 'openInNewTab'), false);
  h.store.openInNewTab = undefined; h.emit({ openInNewTab: { newValue: undefined } });
  await until(() => busy.includes(true)); await until(() => busy.at(-1) === false);
  assert.equal(h.writes.length, 0, 'top-level key presence also remains significant without a storage rewrite');
}

// A matching optimistic value from another writer does not bless a failed local
// baseline. Preserve the consumed failure boundary, then recover from real data.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  const gate = deferred(), started = deferred();
  const held = h.coordinator.transaction(async () => { started.resolve(); await gate.promise; }); await started.promise;
  a.g.OpenTabLayout.patch({ layoutIconSize: 80 }); await flush();
  h.store.sceneProfiles = copy(a.state.sceneProfiles);
  h.emit({ sceneProfiles: { newValue: copy(h.store.sceneProfiles) } });
  h.onNextRead(() => { throw new Error('forced commit read failure'); });
  gate.resolve(); await held; await until(() => a.doc.body.find('retry'));
  assert.equal(a.loads.length, 1, 'notification verification must report, not consume then retry a failed drain');
  assert.ok(a.errors.some(error => error.message === 'forced commit read failure'));
  assert.equal(a.layoutAdapter.getProfile().layoutIconSize, 80, 'only recovery readback establishes the external durable value');
  a.g.OpenTabLayout.patch({ layoutIconSize: 96 }); await a.g.OpenTabLayout.whenIdle();
  assert.equal(h.store.sceneProfiles[0].layoutIconSize, 96);
  const conflictGate = deferred(), conflictStarted = deferred();
  const conflictLock = h.coordinator.transaction(async () => { conflictStarted.resolve(); await conflictGate.promise; }); await conflictStarted.promise;
  a.g.OpenTabLayout.patch({ layoutColumns: 4 }); await flush();
  h.store.sceneProfiles[0].layoutIconSize = 88;
  conflictGate.resolve(); await conflictLock; assert.equal(await a.g.OpenTabLayout.whenIdle(), false);
  assert.ok(a.errors.some(error => error.code === 'WORKSPACE_CONFLICT'));
  assert.equal(h.store.sceneProfiles[0].layoutColumns, 0);
  assert.equal(a.layoutAdapter.getProfile().layoutIconSize, 88);
}

// A recovery snapshot can be durable but require controller view/epoch adoption.
for (const replacement of ['epoch', 'group']) {
  const h = harness(), a = h.tab(); await a.runtime.load();
  const before = a.runtime.getView();
  const gate = deferred(), started = deferred();
  const held = h.coordinator.transaction(async () => { started.resolve(); await gate.promise; }); await started.promise;
  a.g.OpenTabLayout.patch({ layoutIconSize: 80 }); await flush();
  if (replacement === 'epoch') h.store[Workspace.EPOCH_KEY] = 1;
  else {
    h.store.folders = h.store.folders.filter(group => group.id !== before.currentFolderId);
    h.store.icons = h.store.icons.filter(icon => icon.folderId !== before.currentFolderId);
  }
  const event = replacement === 'epoch' ? { [Workspace.EPOCH_KEY]: { newValue: 1 } } : { folders: { newValue: copy(h.store.folders) }, icons: { newValue: copy(h.store.icons) } };
  h.emit(event); h.onNextRead(() => { throw new Error('replacement raced failed save'); });
  gate.resolve(); await held; await until(() => a.doc.body.find('retry'));
  assert.deepEqual(a.runtime.getView(), before, 'failure boundary must not adopt a replacement');
  // Actual bridge failure recovery updated the durable cache, but has not
  // projected/reconciled the controller view. A later event cannot be skipped.
  h.emit(event);
  await until(() => a.loads.length > 1);
  assert.ok(a.runtime.getView().generation > before.generation);
  if (replacement === 'group') assert.equal(a.runtime.getView().currentFolderId, before.homeGroupId);
}

// A completion during verification invalidates the captured snapshot, while
// event coalescing retains every changed key instead of just the first payload.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  h.onNextRead(() => {
    h.store.sceneProfiles[0].layoutIconSize = 80;
    // Simulate the existing synchronous onSaved receipt arriving after get
    // captured its prior value but before the verifier resumes.
    a.runtime.noteCommitted(copy(h.store));
  });
  h.emit({ sceneProfiles: { newValue: copy(h.store.sceneProfiles) } });
  for (let n = 0; n < 5; n++) await flush();
  assert.equal(a.loads.length, 1, 'a stale verification snapshot must not spuriously lock/reseed');
  assert.ok(h.reads.filter(keys => Array.isArray(keys) && keys.length === 1 && keys[0] === 'sceneProfiles').length >= 2);
  h.store.sceneProfiles[0].layoutColumns = 4;
  h.onNextRead(() => { h.store.themeMode = 'light'; h.emit({ themeMode: { newValue: 'light' } }); });
  h.emit({ sceneProfiles: { newValue: copy(h.store.sceneProfiles) } });
  await until(() => a.loads.length > 1);
  assert.equal(a.state.themeMode, 'light'); assert.equal(a.g.OpenTabLayout.get().layoutColumns, 4);
  assert.ok(h.reads.some(keys => Array.isArray(keys) && keys.includes('sceneProfiles') && keys.includes('themeMode') && keys.length === 2));
}

// Deletion is not an absent event payload/no-op, and dispose stops a queued
// verification before it can read or adopt another snapshot.
{
  const h = harness(), a = h.tab(); await a.runtime.load();
  delete h.store.sceneProfiles; h.emit({ sceneProfiles: { oldValue: copy(a.state.sceneProfiles) } });
  await until(() => a.loadStatuses.at(-1) === false);
  assert.equal(a.loads.length, 1);
  const b = harness(), tab = b.tab(); await tab.runtime.load();
  const gate = deferred(), started = deferred();
  const held = b.coordinator.transaction(async () => { started.resolve(); await gate.promise; }); await started.promise;
  b.emit({ sceneProfiles: { newValue: copy(b.store.sceneProfiles) } });
  tab.runtime.dispose(); const reads = b.reads.length;
  gate.resolve(); await held; await flush();
  assert.equal(b.reads.length, reads); assert.equal(tab.loads.length, 1);
}

// Startup reads exactly the complete graph and all home/layout settings, never
// unrelated upload/recovery/vault blobs. Those remain available to full migration.
{
  const initial = { ...legacy(), clockFormat: '24h', showSeconds: true, uiOpacity: 44, uiBlur: 3,
    iconFrameEnabled: false, openInNewTab: true, timezone: 'UTC', bingIndex: 2, themeMode: 'light',
    accentHue: 140, particlesEnabled: false, gradientFlow: false, minimalMode: true,
    todoButtonVisible: false, todoPanelOpen: true, layoutIconSize: 80, layoutColumns: 6,
    layoutShowNames: false, layoutMaxWidth: 1100, [Workspace.EPOCH_KEY]: 7,
    unrelatedUpload: { data: 'x'.repeat(512 * 1024) }, existingSnapshots: [{ intact: true }] };
  initial.icons[0].futureLocalField = { retained: true };
  const h = harness(initial), a = h.tab(), before = copy(h.store);
  assert.equal(await a.runtime.load(), true);
  assert.deepEqual([...h.reads[0]].sort(), [...loadKeys].sort(), 'one locked startup read requests the exact complete loader key set');
  assert.equal(h.reads.length, 1);
  for (const key of [...source('scene-home.js').matchAll(/\bresult\.([A-Za-z]\w*)/g)].map(match => match[1])) {
    assert.ok(h.reads[0].includes(key), 'actual home loader field must be read: ' + key);
  }
  for (const key of [Schema.SCHEMA_KEY, 'scenes', 'sceneProfiles', 'icons', 'folders', 'todos', 'lastOpenedSceneId', Workspace.EPOCH_KEY, ...Layout.STORAGE_KEYS]) {
    assert.ok(h.reads[0].includes(key), 'schema/selection/appearance discriminant must not be omitted: ' + key);
  }
  assert.deepEqual(a.loads[0].raw, loadSnapshot(before));
  assert.equal(Object.hasOwn(a.loads[0].raw, 'unrelatedUpload'), false);
  assert.equal(Object.hasOwn(a.loads[0].raw, 'existingSnapshots'), false);
  assert.deepEqual(h.store, before); assert.equal(h.writes.length, 0);
  assert.deepEqual(a.marks, ['read-start', 'read-end', 'validated', 'loader-start', 'loader-end'].map(name => 'opentab:initial-' + name));
  await a.runtime.load(); assert.equal(a.marks.length, 5, 'later reloads do not accumulate startup marks');
  await a.runtime.openManager(); a.mount.find('enable').click();
  await until(() => a.runtime.isActive() && a.opens === 1);
  assert.ok(h.reads.includes(null), 'explicit migration still obtains full storage');
  assert.deepEqual(h.store[Commands.BACKUP_KEY].data.unrelatedUpload, before.unrelatedUpload);
  assert.deepEqual(h.store[Commands.BACKUP_KEY].data.existingSnapshots, before.existingSnapshots);
  assert.deepEqual(h.store.unrelatedUpload, before.unrelatedUpload);
}

// Omitting recovery blobs from the display read must not hide a migration block.
{
  const initial = { ...legacy(), [Commands.BACKUP_KEY]: { reason: 'existing recovery', data: { retained: true } } };
  const h = harness(initial), a = h.tab(); assert.equal(await a.runtime.load(), true);
  assert.equal(h.reads[0].includes(Commands.BACKUP_KEY), false);
  await a.runtime.openManager(); a.mount.find('enable').click(); await until(() => a.errors.length > 0);
  assert.equal(a.runtime.isActive(), false); assert.deepEqual(h.store, initial); assert.equal(h.writes.length, 0);
  assert.ok(h.reads.includes(null), 'migration checks the full current recovery state');
}

// Diagnostic instrumentation is optional and cannot break loading.
{
  const h = harness(legacy()), a = h.tab(); a.g.performance.mark = () => { throw new Error('trace unavailable'); };
  assert.equal(await a.runtime.load(), true); assert.equal(h.writes.length, 0);
}

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

// A startup queued behind a migration reads the committed v2 graph, not a
// pre-lock legacy projection, while preserving the full recovery record.
{
  const h = harness(legacy()), a = h.tab(), gate = deferred(), started = deferred();
  const migrating = h.coordinator.transaction(async ({ read, write }) => {
    const raw = await read(null); started.resolve(); await gate.promise;
    await write({ ...Schema.migrateLegacy(raw), [Commands.BACKUP_KEY]: { data: raw } });
  });
  await started.promise; const loading = a.runtime.load(); await flush();
  assert.equal(a.loads.length, 0, 'startup still waits for the shared transaction lock');
  gate.resolve(); await migrating; assert.equal(await loading, true);
  assert.equal(a.runtime.isActive(), true); assert.equal(a.loads[0].raw[Schema.SCHEMA_KEY], 2);
  assert.deepEqual(h.store[Commands.BACKUP_KEY].data, legacy());
  assert.equal(h.writes.length, 1, 'only the migration writes');
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
  assert.equal(a.loads.length, 1); assert.deepEqual(a.loads[0].projected, loadSnapshot(before));
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
for (const broken of [{ ...legacy(), [Schema.SCHEMA_KEY]: 99 }, { ...legacy(), [Schema.SCHEMA_KEY]: null },
  { ...legacy(), scenes: [] }, { ...legacy(), sceneProfiles: [] },
  { ...legacy(), folders: [{ id: 'folder-home', name: 'Home', sceneId: 'orphan' }] },
  { ...legacy(), icons: [{ ...legacy().icons[0], sceneId: 'orphan' }] },
  { ...legacy(), todos: [{ ...legacy().todos[0], sceneId: 'orphan' }] }]) {
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
