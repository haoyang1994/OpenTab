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
    vm.createContext(context); vm.runInContext(adapter + '\nworkspace.seed(state);', context);
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
  vm.createContext(context);
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
  vm.createContext(context); vm.runInContext(source.slice(0, source.indexOf('async function fetchArchive')), context);
  const add = h.api.commit({}, { icons: [{ id: 'early', name: 'Early', folderId: 'folder-home' }], folders: base().folders });
  listener({ reason: 'install' }); await Promise.all([add, pending]);
  assert.equal(h.store.icons[0].id, 'early', 'late onInstalled initialization never erases early user additions');
  assert.equal(h.store.background.value, 'user-choice');
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

console.log('workspace persistence tests passed: real home path, parallel writers, normalized state, conflict/epoch protection, inverse undo, failure and vault wrapper');
