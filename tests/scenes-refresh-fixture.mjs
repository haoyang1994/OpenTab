import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { expectedLegacyFirstLoad, DEFAULT_SCENE } from './scenes-fixtures.mjs';
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Workspace = require('../workspace-persistence.js');
const source = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

// Exercise the E2E fixture through the actual two-tab runtime, controller,
// loader, icon/group normalization, layout and merge queue. The Node transport
// delivers storage notifications in a later task, like a second extension page;
// external effects (DOM/asset work, manager controls, and Chrome transport)
// are substituted. The separate native suite retains the real product rendering.
export async function verifySceneRefreshFixture() {
  const initial = Schema.migrateLegacy(expectedLegacyFirstLoad());
  const store = structuredClone(initial), writes = [], listeners = new Set(), tabs = [];
  let pendingEvents = 0;
  const chrome = { runtime: {}, storage: { onChanged: {
    addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)
  }, local: {
    async get(keys) { return structuredClone(keys === null ? store : Object.fromEntries(keys.filter(key => Object.hasOwn(store, key)).map(key => [key, store[key]]))); },
    async set(patch) {
      assert.ok(writes.length < 3, 'scene fixture must not create a storage feedback loop');
      const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { oldValue: structuredClone(store[key]), newValue: structuredClone(newValue) }]));
      writes.push(structuredClone(patch)); Object.assign(store, structuredClone(patch)); pendingEvents++;
      setImmediate(() => { try { listeners.forEach(fn => fn(changes, 'local')); } finally { pendingEvents--; } });
    }
  } } };
  const coordinator = Workspace.forChrome(chrome), preferences = memory();
  function tab() {
    const state = {}, counters = { loads: 0, renders: 0 }, errors = [];
    let runtime, managerHost, busy = false, id = 0;
    const bridge = coordinator.connect({ state, getViewIdentity: () => runtime?.getView(),
      onChange() { runtime?.syncVisibleAppearance(); counters.renders++; }, onError: error => errors.push(error),
      onSaved: raw => runtime.noteCommitted(raw)
    });
    const g = { structuredClone, queueMicrotask, setTimeout, clearTimeout, AbortController, TextEncoder, URL, chrome,
      crypto: { randomUUID: () => `fixture-${++id}` }, sessionStorage: memory(), localStorage: preferences,
      OpenTabWorkspace: coordinator, OpenTabSceneSchema: Schema,
      OpenTabSceneWorkspace: require('../scene-workspace.js'), OpenTabSceneController: require('../scene-controller.js'),
      OpenTabIcons: { ...require('../icons.js'), scheduleIdleMigration() {} }, OpenTabBingCache: { afterStateLoaded() {} },
      OpenTabSceneUI: { init(host) { managerHost = host; return { open() { return true; }, render() {}, destroy() {} }; } }
    };
    g.window = g; vm.createContext(g);
    for (const file of ['import.js', 'folders.js', 'layout.js', 'scene-home.js', 'scene-runtime.js']) vm.runInContext(source(file), g);
    const loader = g.OpenTabSceneHome.create({ state, workspace: bridge,
      HOME_FOLDER_ID: 'folder-home', LEGACY_PRESET_FOLDER_IDS: new Set(), activeHomeId: () => runtime?.getView()?.homeGroupId || 'folder-home',
      t: value => value, ensureFolders: g.OpenTabFolders.ensureGroups, normalizeIconType: value => value || 'shortcut',
      migrateBackground: structuredClone, backgroundsEqual: (a, b) => isDeepStrictEqual(structuredClone(a), structuredClone(b)),
      getFolderById: id => state.folders.find(item => item.id === id),
      updateClock() {}, renderTimezoneList() {}, initCalendar() {}, renderWorkspaceSettings() {}, renderTodos() {}, writeBootMirror() {},
      refreshIconViews() { counters.renders++; }, saveState: () => runtime.saveState(),
      // Preserve the actual setter's save side effect, not an inert stub.
      setTodoPanelOpen(open) { state.todoPanelOpen = open; return runtime.saveState(); }
    });
    runtime = g.OpenTabSceneRuntime.create({ state, workspace: bridge, mount: { ownerDocument: {} },
      applyLoadedState(projected, raw) {
        counters.loads++;
        try { return loader(projected, raw); } catch (error) { errors.push(error); throw error; }
      },
      onBusy: value => { busy = value; }, showToast: message => { if (message !== '场景已保存。') errors.push(message); }
    });
    const result = { runtime, bridge, counters, errors, get busy() { return busy; }, get host() { return managerHost; } };
    tabs.push(result); return result;
  }
  async function drain() {
    for (let turn = 0; turn < 100; turn++) {
      assert.ok((await Promise.all(tabs.map(item => item.bridge.whenIdle()))).every(Boolean), 'normalization saves drain successfully');
      await new Promise(setImmediate);
      if (!pendingEvents && tabs.every(item => !item.busy)) return;
    }
    assert.fail('scene fixture storage/refresh tasks did not settle');
  }
  const counts = () => ({ writes: writes.length, tabs: tabs.map(item => ({ ...item.counters })) });
  const context = item => ({ view: item.runtime.getView() });
  const a = tab(); await a.runtime.load(); const b = tab(); await b.runtime.load(); await drain();
  try {
    assert.equal(writes.length, 0);
    await a.host.onCreate({ name: 'Work', iconKey: 'briefcase', context: context(a) }); await drain();
    const work = a.runtime.getView().sceneId;
    await a.host.onRename({ sceneId: work, name: 'Work space', context: context(a) }); await drain();
    await a.host.onSwitch(DEFAULT_SCENE, context(a));
    const resolved = counts(); await drain(); const settled = counts(); await drain();
    assert.deepEqual(counts(), settled, 'legal notifications and normalization rerenders settle, not repeat indefinitely');
    assert.deepEqual(writes.map(patch => Object.keys(patch).sort()), [['folders', 'sceneProfiles', 'scenes'], ['scenes'], ['currentFolderId', 'lastOpenedSceneId']]);
    assert.deepEqual(store.icons, initial.icons, 'notification renders never overwrite the complete site graph');
    assert.deepEqual(store.todos, initial.todos); assert.deepEqual(store.folders.slice(0, initial.folders.length), initial.folders);
    assert.equal(a.runtime.getView().sceneId, DEFAULT_SCENE); assert.equal(b.runtime.getView().sceneId, DEFAULT_SCENE);
    assert.deepEqual(tabs.flatMap(item => item.errors), []);
    console.log(`Scenes fixture refresh: switch resolved ${JSON.stringify(resolved)}; settled ${JSON.stringify(settled)}; exactly 3 writes, then no further changes.`);
  } finally { tabs.forEach(item => item.runtime.dispose()); }
}
