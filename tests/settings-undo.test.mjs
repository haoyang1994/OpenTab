import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Workspace = require('../workspace-persistence.js');
const Settings = require('../settings-nav.js');
const clone = (value) => structuredClone(value);
const source = fs.readFileSync(new URL('../settings-nav.js', import.meta.url), 'utf8');
// Exercise the actual confirmation/reset/undo implementation without a browser.
const resetCode = source.slice(source.indexOf('  function confirmDialog('), source.indexOf('  function open('));
function harness(options = {}) {
  const state = {
    ...Settings.DEFAULT_APPEARANCE,
    icons: [], folders: [{ id: 'folder-home', name: 'Home' }], todos: [], currentFolderId: 'folder-home',
    background: { type: 'image', value: 'before.jpg', source: 'custom' }, bingIndex: 4,
    iconFrameEnabled: true, openInNewTab: true, windowFullscreenShortcutEnabled: true,
    ...options.state
  };
  const store = clone(state), writes = [], toasts = [], moduleWrites = [], saves = [];
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) { return clone(keys == null ? store : Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]]))); },
    async set(payload) { writes.push(clone(payload)); Object.assign(store, clone(payload)); }
  } } };
  const api = Workspace.forChrome(chrome), connection = api.connect({ state }); connection.seed(store);
  const layoutDefaults = { layoutIconSize: 56, layoutColumns: 0, layoutShowNames: true, layoutMaxWidth: 1200 };
  let layout = { ...layoutDefaults, layoutIconSize: 80 };
  let search = { searchEngine: 'bing', customSearchEngines: [], searchOpenInNewTab: true, searchHistoryEnabled: true, searchHistory: [] };
  let weather = { weatherEnabled: true, weatherCity: 'Paris', weatherUnit: 'c' };
  const syncCheckbox = { checked: true };
  const g = {
    DEFAULT_APPEARANCE: Settings.DEFAULT_APPEARANCE, SECTIONS: Settings.SECTIONS,
    document: {}, $: (id) => id === 'browser-sync-enabled' ? syncCheckbox : null,
    updatePresetSelection() {}, updateBgTabs() {}, syncFromState() {},
    developerToolsEnabled: true,
    OpenTabFolders: { showDialog: () => options.confirm ? options.confirm() : Promise.resolve(true) },
    OpenTabLayout: {
      get: () => clone(layout),
      persist(value) { layout = clone(value); moduleWrites.push('layout'); },
      reset() { layout = clone(layoutDefaults); moduleWrites.push('layout'); }
    },
    OpenTabSearch: {
      getBackupSlice: () => clone(search),
      replaceSettings(value) { search = clone(value); moduleWrites.push('search'); },
      resetToDefaults() { search = { ...search, searchEngine: 'google', searchOpenInNewTab: false }; moduleWrites.push('search'); }
    },
    OpenTabWeather: {
      getBackupSlice: () => clone(weather),
      replaceSettings(value) { weather = clone(value); moduleWrites.push('weather'); },
      resetToDefaults() { weather = { weatherEnabled: false, weatherCity: '', weatherUnit: 'c' }; moduleWrites.push('weather'); }
    },
    OpenTabSync: { async setEnabled(value) { moduleWrites.push('sync'); await Promise.resolve(); syncCheckbox.checked = value; } },
    persistDeveloperTools(value) { g.developerToolsEnabled = value; moduleWrites.push('advanced'); },
    host: {
      state, ...connection,
      saveState() { const result = connection.save(); saves.push(result); return result; },
      showToast(text, settings) { toasts.push({ text, settings }); },
      DEFAULT_BACKGROUND: { type: 'gradient', value: 'default-gradient', source: 'gradient' }
    }
  };
  g.t = (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token); vm.createContext(g); vm.runInContext(resetCode, g);
  return {
    state, store, writes, toasts, moduleWrites, api, connection, syncCheckbox,
    reset: (section) => vm.runInContext(`resetWithConfirm(${JSON.stringify(section)})`, g),
    undo: () => toasts.findLast((toast) => toast.settings?.onAction)?.settings.onAction(),
    async flush() { await Promise.all(saves.splice(0)); },
    async adopt(patch) {
      await chrome.storage.local.set(patch);
      Object.assign(state, clone(store));
      // Equivalent to sync loadState re-seeding the host with an adopted baseline.
      connection.seed(store);
    },
    setLayout(patch) { layout = { ...layout, ...patch }; },
    layout: () => clone(layout)
  };
}
{
  const h = harness(); await h.reset('sync'); await h.flush();
  assert.equal(h.syncCheckbox.checked, false);
  assert.equal(h.undo(), true); await h.flush();
  assert.equal(h.syncCheckbox.checked, true, 'sync undo records the reset target before its asynchronous checkbox update');
  assert.deepEqual(h.moduleWrites, ['sync', 'sync']);
}
{
  const h = harness(); await h.reset('shortcuts'); await h.flush();
  assert.equal(h.store.windowFullscreenShortcutEnabled, false, 'reset durably disables the optional command');
  await h.adopt({ clockFormat: '24h', themeMode: 'light', background: { type: 'image', value: 'later.jpg', source: 'custom' } });
  h.setLayout({ layoutColumns: 8 });
  const calls = h.moduleWrites.length;
  assert.equal(h.undo(), true); await h.flush();
  assert.equal(h.store.clockFormat, '24h'); assert.equal(h.store.themeMode, 'light'); assert.equal(h.store.background.value, 'later.jpg');
  assert.equal(h.store.iconFrameEnabled, true); assert.equal(h.store.openInNewTab, true);
  assert.equal(h.store.windowFullscreenShortcutEnabled, true, 'undo durably restores the prior explicit opt-in');
  assert.equal(h.layout().layoutIconSize, 80); assert.equal(h.layout().layoutColumns, 8, 'undo restores only layout fields actually changed by reset');
  assert.deepEqual(h.moduleWrites.slice(calls), ['layout'], 'section undo must not replay unrelated search, weather, sync or developer settings');
}
{
  const h = harness({ state: { clockFormat: '24h', accentHue: 240 } });
  await h.reset('appearance'); await h.flush();
  await h.adopt({ uiOpacity: 81 });
  assert.equal(h.undo(), true); await h.flush();
  assert.equal(h.store.clockFormat, '24h'); assert.equal(h.store.accentHue, 240);
  assert.equal(h.store.uiOpacity, 81, 'same-section field unchanged by reset retains a later adopted setting');
}
{
  const h = harness({ state: { themeMode: 'auto', accentHue: 240 } });
  await h.reset('appearance'); await h.flush(); await h.adopt({ themeMode: 'light' });
  const before = clone(h.state), writes = h.writes.length, modules = h.moduleWrites.length;
  assert.equal(h.undo(), false, 'a later edit to a reset field rejects the inverse'); await h.flush();
  assert.deepEqual(h.state, before); assert.equal(h.writes.length, writes); assert.equal(h.moduleWrites.length, modules);
  assert.match(h.toasts.at(-1).text, /无法安全撤销/);
}
{
  const h = harness(); await h.reset(''); await h.flush();
  h.syncCheckbox.checked = false;
  assert.equal(h.undo(), true); await h.flush();
  assert.equal(h.syncCheckbox.checked, false); assert.ok(!h.moduleWrites.includes('sync'), 'global reset/undo leaves sync untouched');
}
{
  const h = harness(); await h.reset('shortcuts'); await h.flush();
  await h.adopt({ [Workspace.EPOCH_KEY]: 1, iconFrameEnabled: false, openInNewTab: false });
  const before = clone(h.state), writes = h.writes.length;
  assert.equal(h.undo(), false, 'reset intent remains tied to its epoch even after sync loadState re-seeds the session'); await h.flush();
  assert.deepEqual(h.state, before); assert.equal(h.writes.length, writes);
}
{
  let confirm;
  const h = harness({ confirm: () => new Promise((resolve) => { confirm = resolve; }) });
  const reset = h.reset('shortcuts');
  await h.adopt({ [Workspace.EPOCH_KEY]: 1 });
  const before = clone(h.state), writes = h.writes.length;
  confirm(true);
  assert.equal(await reset, false, 'replacement during confirmation invalidates the pending reset'); await h.flush();
  assert.deepEqual(h.state, before); assert.equal(h.writes.length, writes); assert.equal(h.moduleWrites.length, 0);
}
console.log('settings reset undo tests passed: scoped inverse, adopted setting preservation, same-field conflicts, sync exclusion and immutable epoch intent');
