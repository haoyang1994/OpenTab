import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Workspace = require('../workspace-persistence.js');
const EPOCH = Workspace.EPOCH_KEY;
const clone = (value) => structuredClone(value);
const base = () => ({ icons: [{ id: 'x', name: 'X', folderId: 'folder-home' }, { id: 'y', name: 'Y', folderId: 'folder-home' }], folders: [{ id: 'folder-home', name: 'Home' }], todos: [], currentFolderId: 'folder-home', clockFormat: '24h', themeMode: 'light' });
function memory(initial = base()) {
  const store = clone(initial), writes = [];
  let fail = false;
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) {
      await Promise.resolve();
      return clone(keys == null ? store : Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])));
    },
    async set(value) {
      await Promise.resolve();
      if (fail) { fail = false; throw new Error('test storage failure'); }
      writes.push(clone(value)); Object.assign(store, clone(value));
    }
  } } };
  return { store, writes, chrome, api: Workspace.forChrome(chrome), failNext() { fail = true; } };
}
// Optional move preconditions run after lock acquisition, including records
// that this operation does not modify. Rejection uses normal recovery, never
// an optimistic success or a partial write.
{
  const h = memory(), state = base(), errors = [];
  const c = h.api.connect({ state, onError: error => errors.push(error) }); c.seed(h.store);
  let release, entered = false, guardCalls = 0, onOkCalls = 0;
  const prior = h.api.transaction(async ({ read, write }) => {
    entered = true;
    await new Promise(resolve => { release = resolve; });
    const latest = await read(); latest.icons[1].name = 'Changed destination';
    await write({ icons: latest.icons });
  });
  await until(() => entered);
  state.icons[0].name = 'Proposed move';
  const pending = c.save(undefined, () => onOkCalls++, latest => {
    guardCalls++;
    return latest.icons.find(item => item.id === 'y').name === 'Y';
  });
  await Promise.resolve(); assert.equal(guardCalls, 0, 'guard cannot approve before waiting writer finishes');
  release(); await prior;
  assert.equal(await pending, false); assert.equal(guardCalls, 1);
  assert.equal(onOkCalls, 0); assert.equal(errors[0].code, 'WORKSPACE_CONFLICT');
  assert.equal(h.writes.length, 1, 'only the prior writer persisted');
  assert.equal(state.icons[0].name, 'X', 'failed optimistic move is recovered');
  assert.equal(state.icons[1].name, 'Changed destination', 'latest remote change is preserved');
  state.clockFormat = '12h'; assert.equal(await c.save(), true, 'normal saves still work after guarded failure recovery');
}
{
  const h = memory(), state = base(), c = h.api.connect({ state }); c.seed(h.store);
  state.icons[0].name = 'Moved';
  assert.equal(await c.save(undefined, undefined, latest => {
    latest.icons[1].name = 'Guard must not mutate storage';
    return true;
  }), true);
  assert.equal(h.writes.length, 1); assert.equal(h.store.icons[0].name, 'Moved');
  assert.equal(h.store.icons[1].name, 'Y', 'guard receives an isolated snapshot');
}
for (const outcome of [false, undefined, 1, Promise.resolve(true)]) {
  const h = memory(), chosen = base(); chosen.clockFormat = '12h';
  await assert.rejects(h.api.commit(base(), chosen, () => outcome), error => error.code === 'WORKSPACE_CONFLICT');
  assert.equal(h.writes.length, 0, 'only strict synchronous true accepts a precondition');
}
{
  const h = memory(), chosen = base(); chosen.clockFormat = '12h';
  await assert.rejects(h.api.commit(base(), chosen, () => { throw new Error('guard failed'); }), /guard failed/);
  assert.equal(h.writes.length, 0, 'a throwing precondition cannot write');
}
{
  const h = memory(), chosen = base(); chosen.clockFormat = '12h';
  await assert.rejects(h.api.commit(base(), chosen, () => Promise.reject(new Error('async guard failed'))), error => error.code === 'WORKSPACE_CONFLICT');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.writes.length, 0, 'a rejected async guard cannot write or escape as an unhandled rejection');
}
// The extension installer and E2E fixture seeding share one durable-write
// boundary. Run the actual background listener with the actual coordinator,
// pausing storage only after its first read has captured the empty snapshot.
const installFixture = {
  icons: [
    { id: 'docs', name: 'Docs', type: 'shortcut', url: 'https://docs.example/start', folderId: 'folder-home' },
    { id: 'work-docs', name: 'Docs', type: 'shortcut', url: 'https://work.example/docs', folderId: 'work' }
  ],
  folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }],
  currentFolderId: 'folder-home',
  background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f, #537895)', source: 'gradient' },
  searchEngine: 'google', searchHistoryEnabled: false
};
function installHarness() {
  const h = memory({}), installedWork = [], warnings = [];
  let installed, releaseRead, captured, pauseRead = true;
  const gate = new Promise((resolve) => { releaseRead = resolve; });
  const get = h.chrome.storage.local.get;
  h.chrome.storage.local.get = async (keys) => {
    const snapshot = await get(keys);
    if (pauseRead) {
      pauseRead = false;
      captured = clone(snapshot);
      await gate;
    }
    return snapshot;
  };
  h.chrome.runtime.onInstalled = { addListener(listener) { installed = listener; } };
  h.chrome.runtime.onMessage = { addListener() {} };
  const context = vm.createContext({
    chrome: h.chrome, importScripts() {},
    console: { warn: (...args) => warnings.push(args) },
    OpenTabWorkspace: { ...h.api, transaction(task) {
      const result = h.api.transaction(task);
      installedWork.push(result);
      return result;
    } }
  });
  vm.runInContext(fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8'), context);
  assert.equal(typeof installed, 'function', 'actual background module registers the install listener');
  return { ...h, warnings, releaseRead, captured: () => captured,
    install() { installed({ reason: 'install' }); assert.equal(installedWork.length, 1); return installedWork[0]; } };
}
{
  const h = installHarness(), installing = h.install();
  await until(() => h.captured() !== undefined);
  assert.deepEqual(h.captured(), {}, 'installer captured an empty snapshot before the fixture write');
  assert.equal(h.writes.length, 0, 'the controlled installer has not written defaults yet');
  // Negative control: bypassing the lock reproduces the CI failure exactly.
  await h.chrome.storage.local.set(installFixture);
  assert.deepEqual(h.store.icons, installFixture.icons);
  h.releaseRead(); await installing;
  assert.deepEqual(h.store.icons, [], 'a raw fixture write can be overwritten by the in-flight installer');
  assert.deepEqual(h.store.background, { type: 'image', value: 'assets/default_background/default.webp', source: 'preset' });
  assert.deepEqual(h.store.folders, installFixture.folders, 'the race leaves groups but removes their websites');
  assert.equal(h.store.searchHistoryEnabled, false, 'search readiness alone does not detect overwritten fixture icons');
  assert.equal(h.writes.length, 2); assert.deepEqual(h.warnings, []);
}
{
  const h = installHarness(), installing = h.install();
  await until(() => h.captured() !== undefined);
  let fixtureEntered = false;
  const seeded = h.api.transaction(async ({ write }) => {
    fixtureEntered = true;
    await write(installFixture);
  });
  await Promise.resolve();
  assert.equal(fixtureEntered, false, 'same-lock fixture transaction waits while installation owns the lock');
  assert.deepEqual(h.store, {}); assert.equal(h.writes.length, 0);
  h.releaseRead(); await Promise.all([installing, seeded]);
  assert.equal(fixtureEntered, true);
  assert.deepEqual(h.writes[0].icons, [], 'installer writes before queued fixture seeding');
  assert.deepEqual(h.writes[1], installFixture);
  for (const [key, value] of Object.entries(installFixture)) assert.deepEqual(h.store[key], value, `locked fixture preserves ${key}`);
  assert.equal(h.writes.length, 2); assert.deepEqual(h.warnings, []);
}
{
  const h = installHarness();
  await h.api.transaction(({ write }) => write(installFixture));
  const installing = h.install();
  await until(() => h.captured() !== undefined);
  assert.deepEqual(h.captured().icons, installFixture.icons, 'late installer reads the already committed fixture');
  h.releaseRead(); await installing;
  assert.deepEqual(h.store, installFixture, 'fixture-first ordering preserves websites, background, groups, and settings');
  assert.equal(h.writes.length, 1, 'late installer performs no default write when icons already exist');
  assert.deepEqual(h.warnings, []);
}

{
  const h = memory(), a = base(), b = base();
  a.icons.push({ id: 'a', name: 'A', folderId: 'folder-home' }); b.icons.push({ id: 'b', name: 'B', folderId: 'folder-home' });
  // Both operations start against the identical stale snapshot before either read resolves.
  await Promise.all([h.api.commit(base(), a), h.api.commit(base(), b)]);
  assert.deepEqual(h.store.icons.map((x) => x.id), ['x', 'y', 'a', 'b']);
}
{
  const h = memory(), a = base(), b = base();
  a.icons[0].name = 'Changed X'; b.icons[1].name = 'Changed Y';
  await Promise.all([h.api.commit(base(), a), h.api.commit(base(), b)]);
  assert.deepEqual(h.store.icons.map((x) => x.name), ['Changed X', 'Changed Y']);
  const unrelated = base(); unrelated.clockFormat = '12h';
  await h.api.commit(base(), unrelated);
  assert.equal(h.store.clockFormat, '12h'); assert.equal(h.store.icons[0].name, 'Changed X');
}
{
  const h = memory(), removed = base(), stale = base(); removed.icons.shift(); stale.icons[1].name = 'Changed Y';
  await h.api.commit(base(), removed); await h.api.commit(base(), stale);
  assert.deepEqual(h.store.icons.map((x) => x.id), ['y'], 'stale unrelated edit cannot resurrect deleted x');
  const same = base(); same.icons[0].name = 'Resurrection';
  await assert.rejects(h.api.commit(base(), same), { code: 'WORKSPACE_CONFLICT' });
  assert.deepEqual(h.store.icons.map((x) => x.id), ['y']);
}
{
  const h = memory(), a = base(), b = base(); a.icons[0].name = 'Winner'; b.icons[0].name = 'Loser';
  await h.api.commit(base(), a); await assert.rejects(h.api.commit(base(), b), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(h.store.icons[0].name, 'Winner');
}
{
  const h = memory(), normalized = base(); normalized.icons.forEach((x) => Object.assign(x, { parentId: '', type: 'shortcut', customIconUrl: '', sshPassword: '' }));
  const a = h.api.createSession(base(), normalized), b = h.api.createSession(base(), normalized);
  await a.save(normalized); assert.equal(h.writes.length, 0, 'initial normalized view must not write defaults');
  const nextA = clone(normalized), nextB = clone(normalized); nextA.icons[0].name = 'Changed X'; nextB.icons[1].name = 'Changed Y';
  await a.save(nextA); await b.save(nextB);
  assert.deepEqual(h.store.icons.map((x) => x.name), ['Changed X', 'Changed Y'], 'unchanged normalized records are not edits');
}
{
  const h = memory(), session = h.api.createSession(base());
  const first = base(); first.icons[0].name = 'One';
  const second = clone(first); second.icons[0].name = 'Two'; second.clockFormat = '12h';
  await Promise.all([session.save(first), session.save(second)]);
  assert.equal(h.store.icons[0].name, 'Two'); assert.equal(h.store.clockFormat, '12h');
}
{
  const h = memory(), stale = base();
  await h.api.replace({ icons: [{ id: 'imported', name: 'Imported', folderId: 'folder-home' }] });
  stale.icons[0].name = 'Old edit';
  await assert.rejects(h.api.commit(base(), stale), { code: 'WORKSPACE_CONFLICT' });
  const setting = base(); setting.clockFormat = '12h'; await h.api.commit(base(), setting);
  assert.deepEqual(h.store.icons.map((x) => x.id), ['imported']); assert.equal(h.store.clockFormat, '12h'); assert.equal(h.store[EPOCH], 1);
}
{
  const h = memory(), after = base(); after.icons.push({ id: 'imported', name: 'Imported', folderId: 'folder-home' });
  await h.api.commit(base(), after);
  const later = clone(after); later.icons.push({ id: 'later', name: 'Later', folderId: 'folder-home' }); await h.api.commit(after, later);
  await h.api.commit(after, base());
  assert.deepEqual(h.store.icons.map((x) => x.id), ['x', 'y', 'later'], 'inverse undo preserves unrelated later addition');
}
{
  const h = memory(); h.failNext(); const next = base(); next.icons[0].name = 'Never saved';
  await assert.rejects(h.api.commit(base(), next), /test storage failure/); assert.deepEqual(h.store, base());
  await h.api.commit(base(), next); assert.equal(h.store.icons[0].name, 'Never saved', 'rejected operation releases lock');
}
{
  const h = memory(), session = h.api.createSession(base()); h.failNext();
  const a = base(); a.icons[0].name = 'One'; const b = clone(a); b.icons[1].name = 'Two';
  const results = await Promise.allSettled([session.save(a), session.save(b)]);
  assert.ok(results.every((x) => x.status === 'rejected')); assert.deepEqual(h.store, base(), 'queued edits from failed baseline never persist');
}
{
  const h = memory(), writes = h.chrome.storage.local.set.bind(h.chrome.storage.local);
  let wrapped = 0;
  h.chrome.storage.local.set = async (value) => { wrapped += 1; const clean = clone(value); clean.icons?.forEach((x) => { if (x.sshPassword) x.sshPassword = ''; }); await writes(clean); };
  const session = h.api.createSession(base()), first = base(); first.icons[0].sshPassword = 'synthetic-test-secret';
  await session.save(first); const second = clone(first); second.icons[0].name = 'Renamed safely'; await session.save(second);
  assert.equal(h.store.icons[0].sshPassword, ''); assert.equal(h.store.icons[0].name, 'Renamed safely'); assert.equal(wrapped, 2, 'existing secret wrapper is used, never bypassed');
}
{
  // Exercise the actual home adapter, not a reimplementation of its save path.
  const h = memory(), source = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  const adapter = source.slice(source.indexOf('  const workspace = '), source.indexOf('  function loadState()'));
  function tab() {
    const context = { state: base(), OpenTabWorkspace: h.api, window: {}, refreshIconViews() {}, renderTodos() {}, updateClock() {}, applyThemeMode() {}, renderWorkspaceSettings() {}, renderTodoPanel() {}, updateBackground() {}, writeBootMirror() {}, showToast() {} };
    context.t ||= (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token); vm.createContext(context); vm.runInContext(adapter + '\nworkspace.seed(state);', context);
    return { context, save: () => vm.runInContext('saveState()', context) };
  }
  const a = tab(), b = tab(); a.context.state.icons.push({ id: 'new', name: 'New', folderId: 'folder-home' }); await a.save();
  b.context.state.clockFormat = '12h'; await b.save();
  assert.equal(h.store.icons.at(-1).id, 'new'); assert.equal(h.store.clockFormat, '12h');
  assert.equal(b.context.state.icons.at(-1).id, 'new', 'saved tab adopts merged graph');
}
{
  const sandbox = { console, AbortController, setTimeout, clearTimeout, queueMicrotask, navigator: {}, chrome: memory().chrome };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(new URL('../workspace-persistence.js', import.meta.url), 'utf8'), sandbox);
  await assert.rejects(sandbox.OpenTabWorkspace.commit(base(), base()), /不支持安全保存/);
  assert.equal(sandbox.OpenTabWorkspace.forChrome, undefined, 'production cannot silently use test-only in-memory lock');
  sandbox.navigator.locks = { request: async () => { throw new Error('lock denied'); } };
  await assert.rejects(sandbox.OpenTabWorkspace.commit(base(), base()), /lock denied/);
}
// Import and popup writers use the same coordinator as full new-tab saves.
const OpenTabImport = require('../import.js');
const importFixture = (name) => ({ format: 'test', groups: [{ name, icons: [{ name, url: `https://${name}.example/` }] }] });
async function withImport(h, run) {
  OpenTabImport.setChrome(h.chrome);
  OpenTabImport.setReloader(() => {});
  let sequence = 0;
  OpenTabImport.setIdFactory(() => `import-test-${++sequence}`);
  try { await run(); }
  finally { OpenTabImport.setChrome(null); OpenTabImport.setReloader(null); OpenTabImport.setIdFactory(null); }
}
{
  const h = memory();
  await withImport(h, async () => {
    await Promise.all([OpenTabImport.commitImport(importFixture('one')), OpenTabImport.commitImport(importFixture('two'))]);
    assert.deepEqual(h.store.icons.map((item) => item.name), ['X', 'Y', 'one', 'two'], 'concurrent imports preserve both additions');
    const writesBeforeUndo = h.writes.length;
    await OpenTabImport.undoLastImport();
    assert.deepEqual(h.store.icons.map((item) => item.name), ['X', 'Y', 'one']);
    assert.equal(h.writes.length, writesBeforeUndo + 1, 'undo graph, record and notice commit atomically');
    assert.equal(h.store[OpenTabImport.UNDO_KEY], null);
    assert.equal(h.store[OpenTabImport.NOTICE_KEY].canUndo, false);
  });
}
{
  const h = memory();
  await withImport(h, async () => {
    await OpenTabImport.commitImport(importFixture('one'));
    await h.api.transaction(async ({ read, write }) => {
      const current = await read(null);
      current.icons[0].name = 'Later edit';
      current.icons.push({ id: 'later', name: 'Later addition', folderId: 'folder-home' });
      await write({ icons: current.icons, clockFormat: '12h' });
    });
    await OpenTabImport.undoLastImport();
    assert.deepEqual(h.store.icons.map((item) => item.name), ['Later edit', 'Y', 'Later addition']);
    assert.equal(h.store.clockFormat, '12h', 'undo does not restore unrelated settings');
    assert.ok(!Object.hasOwn(h.writes.at(-1), 'clockFormat'));
  });
}
for (const conflict of ['edited-import', 'restored-workspace']) {
  const h = memory();
  await withImport(h, async () => {
    await OpenTabImport.commitImport(importFixture('one'));
    if (conflict === 'edited-import') h.store.icons.at(-1).name = 'Changed after import';
    else await OpenTabImport.applyOpenTabBackup({ icons: [{ id: 'restored', name: 'Restored', folderId: 'folder-home' }] });
    const before = clone(h.store), writesBefore = h.writes.length;
    await assert.rejects(OpenTabImport.undoLastImport(), { code: 'WORKSPACE_CONFLICT' });
    assert.deepEqual(h.store, before); assert.equal(h.writes.length, writesBefore);
  });
}
{
  const h = memory(); h.store[OpenTabImport.UNDO_KEY] = { icons: [], folders: [] };
  await withImport(h, async () => {
    const before = clone(h.store);
    assert.equal((await OpenTabImport.undoLastImport()).error, 'legacy-undo');
    assert.deepEqual(h.store, before); assert.equal(h.writes.length, 0);
  });
}
{
  const h = memory();
  await withImport(h, async () => {
    h.failNext();
    await assert.rejects(OpenTabImport.commitImport(importFixture('failed')), /test storage failure/);
    assert.deepEqual(h.store, base(), 'failed import cannot leave an undo record or partial graph');
    await OpenTabImport.commitImport(importFixture('retry'));
    const before = clone(h.store); h.failNext();
    await assert.rejects(OpenTabImport.undoLastImport(), /test storage failure/);
    assert.deepEqual(h.store, before, 'failed undo keeps graph and undo record intact');
    await OpenTabImport.undoLastImport();
    assert.deepEqual(h.store.icons, base().icons, 'undo is retryable after storage failure');
    await Promise.all([OpenTabImport.saveSnapshotRecord('one'), OpenTabImport.saveSnapshotRecord('two')]);
    assert.equal(h.store[OpenTabImport.BACKUP_SNAPSHOTS_KEY].length, 2, 'concurrent snapshots preserve both records');
  });
}
function popupHarness(h) {
  let folderReady, tabReady;
  const ready = Promise.all([new Promise((resolve) => { folderReady = resolve; }), new Promise((resolve) => { tabReady = resolve; })]);
  const elements = Object.fromEntries(['current-url', 'site-name', 'folder-select', 'save-btn', 'status'].map((id) => [id, {
    value: '', textContent: '', disabled: false,
    classList: { toggle() {} }, focus() {}, select() { tabReady(); },
    appendChild() { folderReady(); }, addEventListener(name, handler) { this[name] = handler; }
  }]));
  h.chrome.tabs = { query: async () => [{ url: 'https://example.com/', title: 'Example' }] };
  const context = {
    chrome: h.chrome, OpenTabWorkspace: h.api, URL,
    document: { getElementById: (id) => elements[id], createElement: () => ({}) },
    setTimeout() {}, close() {}
  };
  context.window = context;
  context.t ||= (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token); vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8'), context);
  return { elements, ready };
}
{
  const h = memory();
  h.store.folders.push({ id: 'nested', name: 'Nested', parentId: 'folder-home', type: 'folder', custom: 'preserve' });
  const a = popupHarness(h), b = popupHarness(h);
  await Promise.all([a.ready, b.ready]);
  h.store.icons.push({ id: 'later', name: 'Later', folderId: 'folder-home' });
  a.elements['site-name'].value = 'Popup A'; b.elements['site-name'].value = 'Popup B';
  a.elements['folder-select'].value = 'nested'; b.elements['folder-select'].value = 'nested';
  await Promise.all([a.elements['save-btn'].click(), a.elements['save-btn'].click(), b.elements['save-btn'].click()]);
  assert.deepEqual(h.store.icons.map((item) => item.name), ['X', 'Y', 'Later', 'Popup A', 'Popup B'], 'concurrent popups add once and preserve latest graph');
  assert.deepEqual(h.store.folders.at(-1), { id: 'nested', name: 'Nested', parentId: 'folder-home', type: 'folder', custom: 'preserve' });
  const retry = popupHarness(h); await retry.ready;
  retry.elements['site-name'].value = 'Retry'; h.failNext();
  await retry.elements['save-btn'].click();
  assert.equal(retry.elements['save-btn'].disabled, false); assert.match(retry.elements.status.textContent, /保存失败/);
  await retry.elements['save-btn'].click();
  assert.equal(h.store.icons.filter((item) => item.name === 'Retry').length, 1);
}

{
  const h = memory(), OpenTabSync = require('../sync.js');
  const originalSet = h.chrome.storage.local.set.bind(h.chrome.storage.local);
  // Chrome's callback form is used by the existing secret-vault wrapper.
  h.chrome.storage.local.set = (value, callback) => originalSet(value).then(() => { callback?.(); });
  OpenTabSync.setChrome(h.chrome);
  try {
    h.store.icons[0].uploadedIconDataUrl = 'data:image/png;base64,LOCAL';
    let snapshot;
    const later = h.api.transaction(async ({ read, write }) => {
      const current = await read(null);
      current.icons.push({ id: 'before-sync', name: 'Saved before sync', folderId: 'folder-home' });
      await write({ icons: current.icons });
    });
    const remote = OpenTabSync.applyRemotePayload({
      deviceId: 'remote-test-device', hash: 'remote-test-content',
      icons: [{ id: 'x', name: 'Remote X', folderId: 'folder-home' }],
      folders: [{ id: 'folder-home', name: 'Home' }], settings: { clockFormat: '12h' }
    }, { snapshotReason: 'before-sync-pull', onSnapshot: (record) => { snapshot = record; } });
    await Promise.all([later, remote]);
    assert.deepEqual(h.store.icons.map((item) => item.name), ['Remote X']);
    assert.equal(h.store.icons[0].uploadedIconDataUrl, 'data:image/png;base64,LOCAL');
    assert.equal(h.store[EPOCH], 1, 'remote replacement invalidates stale graph writers');
    assert.equal(h.store.clockFormat, '12h');
    assert.ok(snapshot.data.icons.some((item) => item.id === 'before-sync'), 'sync backup captures the latest locked workspace');
    const replacement = h.writes.find((write) => Object.hasOwn(write, EPOCH));
    assert.ok(replacement.icons && replacement.folders && replacement[OpenTabImport.BACKUP_SNAPSHOTS_KEY], 'sync backup and replacement share one storage write');
  } finally { OpenTabSync.setChrome(null); }
}

{
  const h = memory({}), state = { ...base(), icons: [] };
  const connection = h.api.connect({ state });
  connection.seed({}, Workspace.migrationOverrides({}, state));
  await connection.save();
  state.icons.push({ id: 'fresh', name: 'Fresh', folderId: 'folder-home' }); await connection.save();
  state.folders.push({ id: 'new-group', name: 'New group' }); await connection.save();
  assert.deepEqual(h.store.folders.map((x) => x.id), ['folder-home', 'new-group']);
  assert.equal(h.store.icons[0].folderId, 'folder-home', 'fresh profile survives shortcut then group creation');
}
{
  const old = { ...base(), folders: [null, { id: 'folder-home', name: 'Home' }, { id: 'folder-blog', name: 'Legacy' }], icons: [{ id: 'legacy', name: 'Legacy', folderId: 'folder-blog', parentId: 'missing' }] };
  const h = memory(old), state = { ...base(), icons: [{ id: 'legacy', name: 'Legacy', folderId: 'folder-home', parentId: '', customIconUrl: '' }] };
  const connection = h.api.connect({ state }); connection.seed(old, Workspace.migrationOverrides(old, state)); await connection.save();
  assert.deepEqual(h.store.folders, base().folders); assert.equal(h.store.icons[0].folderId, 'folder-home'); assert.equal(h.store.icons[0].parentId, '');
}
{
  const initial = { ...base(), folders: [{ id: 'folder-home', name: 'Home' }, { id: 'g2', name: 'Other' }], icons: [{ id: 'p', type: 'folder', folderId: 'folder-home' }, { id: 'x', type: 'shortcut', folderId: 'folder-home' }] };
  const h = memory(initial), moved = clone(initial), joined = clone(initial);
  moved.icons[0].folderId = 'g2'; joined.icons[1].parentId = 'p';
  await h.api.commit(initial, moved);
  await assert.rejects(h.api.commit(initial, joined), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(h.store.icons[0].folderId, 'g2'); assert.equal(h.store.icons[1].parentId, undefined, 'cross-group child race is rejected');
}
{
  const h = memory(), state = base(), errors = [], renders = [];
  const connection = h.api.connect({ state, onError: (e) => errors.push(e.message), onChange: () => renders.push(clone(state)) });
  connection.seed(base());
  const remote = base(); remote.icons.push({ id: 'remote', name: 'Remote', folderId: 'folder-home' }); await h.api.commit(base(), remote);
  h.failNext(); state.icons[0].name = 'Failed edit'; const first = connection.save();
  state.icons[1].name = 'Queued stale edit'; const second = connection.save();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.deepEqual(state.icons, remote.icons, 'failure recovery keeps latest remote additions and rejects queued stale edits');
  assert.equal(errors.length, 1); assert.ok(renders.length);
  state.clockFormat = '12h'; assert.equal(await connection.save(), true, 'recovered session accepts a new user edit');
  assert.equal(h.store.clockFormat, '12h'); assert.equal(h.store.icons.at(-1).id, 'remote');
}
{
  const h = memory({ background: { type: 'gradient', value: 'user-choice' } });
  let listener, pending;
  const chrome = { ...h.chrome, runtime: { onInstalled: { addListener(fn) { listener = fn; } } } };
  const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  const context = { chrome, console, Intl, importScripts() {}, OpenTabWorkspace: { transaction(fn) { pending = h.api.transaction(fn); return pending; } } };
  context.t ||= (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token); vm.createContext(context); vm.runInContext(source.slice(0, source.indexOf('async function fetchArchive')), context);
  const add = h.api.commit({}, { icons: [{ id: 'early', name: 'Early', folderId: 'folder-home' }], folders: base().folders });
  listener({ reason: 'install' }); await Promise.all([add, pending]);
  assert.equal(h.store.icons[0].id, 'early', 'late onInstalled initialization never erases early user additions');
  assert.equal(h.store.background.value, 'user-choice');
}
for (const [initial, reason, expectedTheme] of [
  [{}, 'install', 'light'],
  [{ themeMode: 'dark' }, 'install', 'dark'],
  [{ themeMode: 'auto' }, 'install', 'auto'],
  [{ icons: [] }, 'install', undefined],
  [{ icons: [], themeMode: 'dark' }, 'update', 'dark'],
  [{}, 'update', undefined]
]) {
  const h = memory(initial); let listener, pending;
  const chrome = { ...h.chrome, runtime: { onInstalled: { addListener(fn) { listener = fn; } } } };
  const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  const context = { chrome, console, Intl, importScripts() {}, OpenTabWorkspace: { transaction(fn) { pending = h.api.transaction(fn); return pending; } } };
  context.t ||= (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token); vm.createContext(context); vm.runInContext(source.slice(0, source.indexOf('async function fetchArchive')), context);
  listener({ reason }); await pending;
  assert.equal(h.store.themeMode, expectedTheme, 'light default applies only to genuinely new install, preserving explicit and legacy implicit choice');
}
{
  let timer;
  const sandbox = { console, AbortController, queueMicrotask, setTimeout(fn) { timer = fn; return 1; }, clearTimeout() {}, chrome: memory().chrome,
    navigator: { locks: { request(name, options) {
      assert.equal(name, Workspace.LOCK_NAME);
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }));
    } } } };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(new URL('../workspace-persistence.js', import.meta.url), 'utf8'), sandbox);
  const pending = sandbox.OpenTabWorkspace.read(); await Promise.resolve(); timer();
  await assert.rejects(pending, /保存等待超时/, 'bounded lock acquisition fails visibly rather than waiting forever');
}
{
  const h = memory({}), state = { ...base(), icons: [] }, connection = h.api.connect({ state });
  connection.seed({}); h.failNext(); state.icons.push({ id: 'unsaved', name: 'Unsaved', folderId: 'folder-home' });
  assert.equal(await connection.save(), false); assert.deepEqual(state.icons, [], 'fresh-profile write failure rolls back optimistic icon even when storage key is absent');
  assert.equal(h.store.icons, undefined);
}
// Explicit replacement snapshots are captured at the locked write, not earlier.
for (const snapshotReason of ['before-import', 'before-restore']) {
  const h = memory();
  await withImport(h, async () => {
    const latestEdit = h.api.transaction(async ({ read, write }) => {
      const current = await read(null);
      current.icons.push({ id: 'before-replace', name: 'Latest before replace', folderId: 'folder-home' });
      await write({ icons: current.icons });
    });
    const restore = OpenTabImport.applyOpenTabBackup({ icons: [{ id: 'restored', name: 'Restored', folderId: 'folder-home' }] }, { snapshotReason });
    await Promise.all([latestEdit, restore]);
    const snapshots = h.store[OpenTabImport.BACKUP_SNAPSHOTS_KEY];
    assert.equal(snapshots[0].reason, snapshotReason);
    assert.ok(snapshots[0].data.icons.some((item) => item.id === 'before-replace'), 'replacement snapshot includes the latest preceding edit');
    const replacement = h.writes.find((write) => Object.hasOwn(write, EPOCH));
    assert.ok(replacement.icons && replacement[OpenTabImport.BACKUP_SNAPSHOTS_KEY], 'replacement and pre-change snapshot are one atomic write');
    assert.deepEqual(h.store.icons.map((item) => item.id), ['restored']);
  });
}
{
  const h = memory();
  await withImport(h, async () => {
    const before = clone(h.store); h.failNext();
    await assert.rejects(OpenTabImport.applyOpenTabBackup({ icons: [] }, { snapshotReason: 'before-import' }), /test storage failure/);
    assert.deepEqual(h.store, before, 'failed replacement does not save a partial snapshot or advance epoch');
    await OpenTabImport.applyOpenTabBackup({ icons: [] }, { snapshotReason: 'before-import' });
    assert.equal(h.store[OpenTabImport.BACKUP_SNAPSHOTS_KEY].length, 1);
    assert.equal(h.store[EPOCH], 1);
  });
}
async function withSyncUndo(h, run) {
  const OpenTabSync = require('../sync.js'), originalSet = h.chrome.storage.local.set.bind(h.chrome.storage.local);
  h.chrome.storage.local.set = (value, callback) => {
    const result = originalSet(value);
    result.then(() => { callback?.(); }, (error) => {
      h.chrome.runtime.lastError = { message: error.message };
      callback?.(); delete h.chrome.runtime.lastError;
    });
    return result;
  };
  OpenTabSync.setChrome(h.chrome);
  let undo;
  try {
    await OpenTabSync.applyRemotePayload({
      deviceId: 'undo-remote-device', hash: 'undo-remote-content',
      icons: [{ id: 'x', name: 'Remote X', folderId: 'folder-home' }, { id: 'remote-added', name: 'Remote added', folderId: 'folder-home' }],
      folders: [{ id: 'folder-home', name: 'Home' }], settings: { clockFormat: '12h' }
    }, { snapshotReason: 'before-sync-pull', onSnapshot: (_record, inverse) => { undo = inverse; } });
    assert.equal(undo.after[EPOCH], h.store[EPOCH]);
    await run(OpenTabSync, undo);
  } finally { OpenTabSync.setChrome(null); }
}
{
  const initial = base(); initial.icons[0].uploadedIconDataUrl = 'data:image/png;base64,LOCAL';
  const h = memory(initial);
  await withSyncUndo(h, async (OpenTabSync, undo) => {
    await h.api.transaction(async ({ read, write }) => {
      const current = await read(null);
      current.icons.push({ id: 'later', name: 'Later addition', folderId: 'folder-home' });
      await write({ icons: current.icons, themeMode: 'dark', todos: [{ id: 'later-todo', text: 'Later todo' }] });
    });
    await OpenTabSync.undoRemotePayload(undo);
    assert.deepEqual(new Set(h.store.icons.map((item) => item.id)), new Set(['x', 'y', 'later']), 'sync inverse removes remote addition, restores removed local record, and keeps later addition');
    assert.equal(h.store.icons.find((item) => item.id === 'x').name, 'X');
    assert.equal(h.store.icons.find((item) => item.id === 'x').uploadedIconDataUrl, 'data:image/png;base64,LOCAL', 'sync undo retains original local icon assets');
    assert.equal(h.store.clockFormat, '24h'); assert.equal(h.store.themeMode, 'dark'); assert.equal(h.store.todos[0].id, 'later-todo');
    assert.ok(!Object.hasOwn(h.writes.at(-1), 'themeMode') && !Object.hasOwn(h.writes.at(-1), 'todos'), 'sync undo writes no unrelated settings or todos');
  });
}
for (const conflict of ['same-entity-edit', 'newer-replacement']) {
  const h = memory();
  await withSyncUndo(h, async (OpenTabSync, undo) => {
    if (conflict === 'same-entity-edit') h.store.icons[0].name = 'Edited after sync';
    else await h.api.replace({ icons: [{ id: 'new-backup', name: 'New backup', folderId: 'folder-home' }] });
    const before = clone(h.store), writesBefore = h.writes.length;
    await assert.rejects(OpenTabSync.undoRemotePayload(undo), { code: 'WORKSPACE_CONFLICT' });
    assert.deepEqual(h.store, before); assert.equal(h.writes.length, writesBefore);
  });
}
{
  const h = memory();
  await withSyncUndo(h, async (OpenTabSync, undo) => {
    const before = clone(h.store); h.failNext();
    await assert.rejects(OpenTabSync.undoRemotePayload(undo), /test storage failure/);
    assert.deepEqual(h.store, before, 'failed sync undo preserves current graph');
    await OpenTabSync.undoRemotePayload(undo);
    assert.deepEqual(new Set(h.store.icons.map((item) => item.id)), new Set(['x', 'y']));
  });
}



// Intent tokens outlive session rebase: UI drafts and undo cannot borrow a newer epoch.
{
  const h = memory(), state = base(), c = h.api.connect({ state }); c.seed(h.store);
  state.icons = state.icons.filter((item) => item.id !== 'x'); await c.save();
  const undo = c.captureIntent();
  await h.api.replace({ ...base(), icons: [{ id: 'imported', name: 'Imported', folderId: 'folder-home' }] });
  state.clockFormat = '12h'; assert.equal(await c.save(), true);
  assert.equal(c.isIntentCurrent(undo), false, 'old undo stays invalid after a settings save adopts replacement');
  const sameBytes = c.captureIntent(); await h.api.replace(clone(h.store));
  state.themeMode = 'dark'; await c.save();
  assert.equal(c.isIntentCurrent(sameBytes), false, 'byte-identical restore still changes intent epoch');
}
{
  const h = memory(), state = base(), c = h.api.connect({ state }); c.seed(h.store);
  const xDraft = c.captureIntent({ icons: ['x'] }), yDraft = c.captureIntent({ icons: ['y'] });
  const remote = base(); remote.icons[0].name = 'Remote winner'; await h.api.commit(base(), remote);
  state.clockFormat = '12h'; await c.save();
  assert.equal(c.isIntentCurrent(xDraft), false, 'old modal cannot overwrite remote metadata after unrelated rebase');
  assert.equal(c.isIntentCurrent(yDraft), true, 'different entity draft remains usable');
  state.icons[1].name = 'Independent'; assert.equal(await c.save(), true);
  assert.equal(h.store.icons[0].name, 'Remote winner');
  const reloadDraft = c.captureIntent({ icons: ['y'] });
  const replacement = await h.api.replace(clone(h.store)); c.seed(replacement);
  assert.equal(c.isIntentCurrent(reloadDraft), false, 'sync loadState seed also invalidates old epoch');
}
{
  const h = memory(), state = base();
  Object.assign(state.icons[0], { type: 'shortcut', customIconUrl: '', sshPort: 22, parentId: '' });
  const c = h.api.connect({ state }); c.seed(h.store); const draft = c.captureIntent({ icons: ['x'] });
  state.clockFormat = '12h'; await c.save();
  assert.equal(c.isIntentCurrent(draft), true, 'load defaults are not a remote edit');
  state.icons[0].resolvedIconUrl = 'local-cache';
  assert.equal(c.isIntentCurrent(draft), true, 'asynchronous favicon cache does not invalidate user metadata draft');
}
{
  const before = base(); before.icons.splice(1, 0, { id: 'middle', name: 'Middle', folderId: 'folder-home' });
  const after = clone(before); after.icons.splice(1, 1);
  assert.deepEqual(Workspace.merge(after, before, after).icons.map((item) => item.id), ['x', 'middle', 'y']);
  const later = clone(after); later.icons.push({ id: 'remote', folderId: 'folder-home' });
  assert.deepEqual(Workspace.merge(after, before, later).icons.map((item) => item.id), ['x', 'middle', 'y', 'remote']);
}

{
  const h = memory(), state = base(), errors = [], c = h.api.connect({ state, onError: (error) => errors.push(error) }); c.seed(h.store);
  state.icons.push(clone(state.icons[0]));
  let saving;
  assert.doesNotThrow(() => { saving = c.save(); }, 'invalid optimistic duplicate must not throw out of event handler');
  assert.equal(await saving, false); assert.equal(errors.length, 1);
  assert.deepEqual(state.icons.map((item) => item.id), ['x', 'y'], 'failure restores current valid graph');
}
{
  const h = memory(), state = base(), c = h.api.connect({ state }); c.seed(h.store);
  const intent = c.captureIntent({ groupMembers: ['folder-home'] });
  const remote = base(); remote.icons.push({ id: 'new', folderId: 'folder-home' });
  await h.api.commit(base(), remote); state.clockFormat = '12h'; await c.save();
  assert.equal(c.isIntentCurrent(intent), false, 'old destructive group confirmation cannot consume unseen new children');
}
// Exercise the actual UI callback bodies, not only token helpers.
{
  const h = memory(), state = base(), c = h.api.connect({ state }); c.seed(h.store);
  const source = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  let button, actions = 0, closed = false, text = '';
  const toast = { textContent: '', classList: { add() {}, remove() {} }, appendChild(value) { button = value; } };
  const context = vm.createContext({ t: (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token),  workspace: c, elements: { toast }, document: { createElement: () => ({}) }, toastTimer: null, pendingUndo: null, clearTimeout() {}, setTimeout() {}, action: () => { actions++; } });
  const start = source.indexOf('  function showToast(');
  vm.runInContext(source.slice(start, source.indexOf('  function hideDropIndicator(', start)) + "\nshowToast('deleted', { actionLabel: 'Undo', onAction: action });", context);
  const oldButton = button;
  await h.api.replace({ ...base(), icons: [{ id: 'replacement', folderId: 'folder-home' }] });
  state.clockFormat = '12h'; await c.save(); oldButton.onclick();
  assert.equal(actions, 0, 'actual home toast refuses stale undo after rebase');
  assert.match(toast.textContent, /内容已变化/);

  const modalState = base(), modal = h.api.connect({ state: modalState }); modal.seed(h.store);
  const draft = modal.captureIntent({ icons: ['x'] }); modalState.icons[0].name = 'remote';
  const modalStart = source.indexOf('  async function handleSaveIcon(');
  const modalBody = source.slice(modalStart, source.indexOf('\n  }\n', modalStart) + 5);
  const modalContext = vm.createContext({ t: (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token),  workspace: modal, iconDraftIntent: draft, iconSaveGate: { has: () => false }, closeAddIconModal() { closed = true; }, showToast(value) { text = value; } });
  await vm.runInContext(modalBody + '\nhandleSaveIcon()', modalContext);
  assert.equal(closed, true); assert.match(text, /内容已变化/);
}
function iconChanger(h, state) {
  const c = h.api.connect({ state }); c.seed(h.store);
  const nodes = new Map(), messages = [], saves = [];
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', files: [], handlers: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener(type, fn) { this.handlers[type] = fn; }, removeAttribute() {}, focus() {} });
    return nodes.get(id);
  };
  const ctx = vm.createContext({ t: (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token),  URL, document: { getElementById: get }, fetch: async () => { throw new Error('unexpected fetch'); } });
  vm.runInContext(fs.readFileSync(new URL('../icons.js', import.meta.url), 'utf8'), ctx);
  ctx.OpenTabIcons.init({ ...c, getIcons: () => state.icons, saveState: () => { const p = c.save(); saves.push(p); return p; }, showToast: (message) => messages.push(message) });
  return { c, ctx, get, messages, saves, icons: ctx.OpenTabIcons };
}
{
  const h = memory(), state = base(), ui = iconChanger(h, state);
  ui.icons.openChanger('x'); ui.get('change-icon-letter').value = 'Q';
  const remote = base(); remote.icons[0].name = 'Remote icon winner'; await h.api.commit(base(), remote);
  state.clockFormat = '12h'; await ui.c.save();
  ui.get('change-icon-placeholder').handlers.click();
  assert.match(ui.messages.at(-1), /内容已变化/);
  assert.equal(h.store.icons[0].name, 'Remote icon winner');
  assert.equal(h.store.icons[0].placeholderLetter, undefined);
}
{
  const h = memory(), state = base(), ui = iconChanger(h, state); let release;
  ui.icons.openChanger('x');
  ui.get('change-icon-file').files = [{ size: 100, type: 'image/svg+xml', text: () => new Promise((resolve) => { release = resolve; }) }];
  const uploading = ui.get('change-icon-file').handlers.change();
  const detached = state.icons[0], remote = base(); remote.icons[1].name = 'Other edit';
  await h.api.commit(base(), remote); state.clockFormat = '12h'; await ui.c.save();
  assert.notEqual(state.icons[0], detached, 'settings adoption cloned the object during upload');
  release('<svg>synthetic local upload</svg>'); await uploading; await Promise.all(ui.saves);
  assert.match(h.store.icons[0].uploadedIconDataUrl, /^data:image\/svg/);
  assert.equal(detached.uploadedIconDataUrl, undefined, 'async result applies to current id, not stale object');
}
{
  const h = memory(), state = base(), ui = iconChanger(h, state); let release;
  ui.icons.openChanger('x');
  ui.get('change-icon-file').files = [{ size: 100, type: 'image/svg+xml', text: () => new Promise((resolve) => { release = resolve; }) }];
  const uploading = ui.get('change-icon-file').handlers.change();
  ui.get('change-icon-letter').value = 'N'; ui.get('change-icon-placeholder').handlers.click(); await Promise.all(ui.saves);
  release('<svg>old upload</svg>'); await uploading;
  assert.equal(h.store.icons[0].placeholderLetter, 'N', 'newer placeholder action wins over late upload');
  assert.equal(h.store.icons[0].uploadedIconDataUrl, '');
}
{
  const h = memory(), state = base(), ui = iconChanger(h, state); let release;
  state.icons[0].url = 'https://synthetic.example.test'; await ui.c.save();
  ui.ctx.fetch = async () => ({ ok: true, blob: async () => ({ size: 100, type: 'image/svg+xml', text: () => new Promise((resolve) => { release = resolve; }) }) });
  ui.icons.openChanger('x'); const original = state.icons[0];
  const refetching = ui.get('change-icon-refetch').handlers.click();
  await until(() => release);
  await h.api.replace(clone(h.store)); state.clockFormat = '12h'; await ui.c.save();
  release('<svg>late remote response</svg>'); await refetching;
  assert.equal(original.resolvedIconUrl, undefined, 'refetch never mutates the captured stale object');
  assert.equal(h.store.icons[0].resolvedIconUrl, undefined, 'byte-identical replacement invalidates late refetch');
  assert.match(ui.messages.at(-1), /内容已变化/);
}
function homeIconEditor(h, state, editId = null) {
  const c = h.api.connect({ state }); c.seed(h.store);
  let hidden = false, ids = 0;
  const elements = Object.fromEntries(['iconType', 'iconName', 'iconUrl', 'iconCustomUrl', 'sshGatewayUrl', 'sshGatewayToken', 'sshHost', 'sshPort', 'sshUsername', 'sshPassword', 'sshSocksHost', 'sshSocksPort', 'sshSocksUsername', 'sshSocksPassword', 'toolSubtype'].map((key) => [key, { value: '', focus() {} }]));
  elements.iconType.value = 'shortcut'; elements.iconName.value = 'Submitted'; elements.iconUrl.value = 'https://synthetic.example.test';
  elements.cancelBtn = { id: 'cancel-btn', disabled: false };
  elements.saveBtn = { disabled: false }; elements.addIconModal = { querySelectorAll: () => Object.values(elements).filter((node) => node !== elements.addIconModal), classList: { contains() { return hidden; }, add() { hidden = true; } } };
  const context = vm.createContext({ t: (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token),  state, elements, window: {}, workspace: c, saveState: c.save,
    editingIconId: editId, iconUploadGate: require('../icons.js').createUploadGate(), iconSaveGate: require('../icons.js').createSaveGate(), iconDraftIntent: c.captureIntent(editId ? { icons: [editId] } : {}), pendingIconUploadDataUrl: '',
    ICON_TYPE_SHORTCUT: 'shortcut', ICON_TYPE_SSH: 'ssh', ICON_TYPE_TOOL: 'tool', HOME_FOLDER_ID: 'folder-home',
    normalizeIconType: (value) => value || 'shortcut', normalizeUrl: (value) => value, normalizeOptionalUrl: (value) => value,
    generateId: () => `submitted-${++ids}`, getFolderById: (id) => state.folders.find((item) => item.id === id), refreshIconViews() {}, restoreFocus() {}, showToast() {} });
  const source = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  for (const name of ['persistOrRollback', 'addIcon', 'updateIcon', 'closeAddIconModal', 'handleSaveIcon']) {
    const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
    vm.runInContext(source.slice(start, source.indexOf('\n  }\n', start) + 5), context);
  }
  return { c, context, elements, hidden: () => hidden, reopen() { vm.runInContext('closeAddIconModal(); iconDraftIntent = workspace.captureIntent();', context); hidden = false; }, submit: () => vm.runInContext('handleSaveIcon()', context) };
}
{
  const h = memory(), state = base(), editor = homeIconEditor(h, state);
  const originalSet = h.chrome.storage.local.set; let release, entered = false;
  const gate = new Promise((resolve) => { release = resolve; });
  h.chrome.storage.local.set = async (patch) => { entered = true; await gate; return originalSet(patch); };
  const submitted = editor.submit(); await until(() => entered);
  await editor.submit();
  assert.equal(editor.hidden(), false, 'actual add modal stays open before durable storage write');
  assert.equal(editor.elements.saveBtn.disabled, true);
  assert.equal(h.store.icons.length, 2); assert.equal(state.icons.length, 3, 'double submit does not duplicate optimistic icon');
  release(); await submitted;
  assert.equal(editor.hidden(), true); assert.equal(editor.elements.saveBtn.disabled, false);
  assert.equal(h.store.icons.length, 3, 'modal completion implies stored shortcut exists');
}
{
  const h = memory(), state = base(), editor = homeIconEditor(h, state, 'x'); let release, entered = false;
  const owner = h.api.transaction(async () => { entered = true; await new Promise((resolve) => { release = resolve; }); });
  await until(() => entered);
  const submitted = editor.submit(); await Promise.resolve();
  assert.equal(editor.hidden(), false, 'edit modal stays open while another tab owns workspace lock');
  assert.equal(h.store.icons[0].name, 'X');
  release(); await owner; await submitted;
  assert.equal(editor.hidden(), true); assert.equal(h.store.icons[0].name, 'Submitted');
}
{
  const h = memory(), state = base(), editor = homeIconEditor(h, state); h.failNext();
  await editor.submit();
  assert.equal(editor.hidden(), false, 'failed persistence keeps modal available for retry');
  assert.equal(editor.elements.iconName.value, 'Submitted'); assert.equal(editor.elements.saveBtn.disabled, false);
  assert.equal(state.icons.length, 2); assert.equal(h.store.icons.length, 2);
  await editor.submit(); assert.equal(editor.hidden(), true); assert.equal(h.store.icons.length, 3);
}
{
  const h = memory(), state = base(), editor = homeIconEditor(h, state); let release, entered = false;
  const originalSet = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async (patch) => { entered = true; await new Promise((resolve) => { release = resolve; }); return originalSet(patch); };
  const submitted = editor.submit(); await until(() => entered);
  editor.reopen(); editor.elements.iconName.value = 'New modal draft';
  release(); await submitted;
  assert.equal(editor.hidden(), false, 'late completion never closes a newer modal');
  assert.equal(editor.elements.iconName.value, 'New modal draft'); assert.equal(h.store.icons.at(-1).name, 'Submitted');
}
{
  const h = memory(), state = base(), editor = homeIconEditor(h, state), releases = [];
  const originalSet = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async (patch) => { await new Promise((resolve) => releases.push(resolve)); return originalSet(patch); };
  editor.elements.sshPort.disabled = true;
  const first = editor.submit(); while (releases.length < 1) await Promise.resolve();
  assert.equal(editor.elements.iconName.disabled, true, 'pending form fields cannot accept input that completion would discard');
  editor.reopen(); editor.elements.iconName.value = 'Second draft';
  const second = editor.submit(); releases[0](); await first;
  while (releases.length < 2) await Promise.resolve();
  assert.equal(editor.hidden(), false); assert.equal(editor.elements.saveBtn.disabled, true, 'old completion cannot re-enable newer pending modal');
  releases[1](); await second;
  assert.equal(editor.hidden(), true); assert.equal(editor.elements.sshPort.disabled, true, 'original disabled control state restored');
  assert.equal(h.store.icons.length, 4);
}
{
  const h = memory(), state = base(), ui = iconChanger(h, state); let release, entered = false;
  const originalSet = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async (patch) => { entered = true; await new Promise((resolve) => { release = resolve; }); return originalSet(patch); };
  ui.icons.openChanger('x'); ui.get('change-icon-letter').value = 'P';
  const changing = ui.get('change-icon-placeholder').handlers.click(); await until(() => entered);
  assert.deepEqual(ui.messages, [], 'icon changer must not announce success before durable save');
  release(); await changing;
  assert.match(ui.messages.at(-1), /已使用/); assert.equal(h.store.icons[0].placeholderLetter, 'P');
}
{
  const h = memory(), state = base(), editor = homeIconEditor(h, state), messages = [];
  editor.context.showToast = (text, opts) => messages.push({ text, opts });
  const source = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  for (const name of ['deleteIcon', 'undoDelete']) {
    const start = source.indexOf(`  async function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n  }\n', start) + 5), editor.context);
  }
  let release, entered = false; const originalSet = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async (patch) => { entered = true; await new Promise((resolve) => { release = resolve; }); return originalSet(patch); };
  const deleting = vm.runInContext("deleteIcon('x')", editor.context); await until(() => entered);
  assert.equal(messages.length, 0, 'delete undo action is not offered before delete commits');
  release(); await deleting; assert.match(messages.at(-1).text, /已删除/);
  const action = messages.at(-1).opts.onAction; messages.length = 0; entered = false;
  const undoing = action(); await until(() => entered);
  assert.equal(messages.length, 0, 'undo success is not announced before restore commits');
  release(); await undoing; assert.match(messages.at(-1).text, /已恢复/);
  assert.deepEqual(h.store.icons.map((item) => item.id), ['x', 'y']);
}
{
  const h = memory(), state = base(), c = h.api.connect({ state }); c.seed(h.store);
  const before = clone(state), messages = []; state.icons[0].name = 'Folder operation';
  let release, entered = false; const originalSet = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async (patch) => { entered = true; await new Promise((resolve) => { release = resolve; }); return originalSet(patch); };
  const context = vm.createContext({ t: (source, values = {}) => source.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token),  OpenTabWorkspace: h.api, before, snapshot: () => clone(state), restore: (snapshot) => Object.assign(state, clone(snapshot)), closeOverlay() {}, host: { ...c, saveState: c.save, refreshIconViews() {}, showToast: (text, opts) => messages.push({ text, opts }) } });
  const source = fs.readFileSync(new URL('../folders.js', import.meta.url), 'utf8'), start = source.indexOf('  async function persistUndo(');
  vm.runInContext(source.slice(start, source.indexOf('\n  }\n', start) + 5), context);
  const saving = vm.runInContext("persistUndo(before, '已完成')", context); await until(() => entered);
  assert.equal(messages.length, 0, 'folder undo is not exposed before persistence'); release(); await saving;
  assert.equal(messages.length, 1); const action = messages[0].opts.onAction; messages.length = 0; entered = false;
  const undoing = action(); await until(() => entered); assert.equal(messages.length, 0);
  release(); await undoing; assert.match(messages.at(-1).text, /已恢复/); assert.equal(h.store.icons[0].name, 'X');
}

await assert.rejects(until(() => false), /synchronization point/, 'a broken fixture fails instead of spinning forever');
console.log('workspace persistence tests passed: real install race and locked fixture seeding, real home path, parallel writers, normalized state, conflict/epoch protection, inverse undo, failure and vault wrapper');

async function until(predicate) {
  for (let turn = 0; turn < 1000; turn++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Expected mocked async operation did not reach its synchronization point');
}
