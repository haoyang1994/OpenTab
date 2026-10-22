import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Scene = require('../scene-schema.js');
const Protocol = require('../scene-sync.js');
const Sync = require('../sync.js');
const Workspace = require('../workspace-persistence.js');
const K = Scene.SCHEMA_KEY, E = Workspace.EPOCH_KEY;
const clone = value => structuredClone(value);
let cases = 0;
async function test(name, fn) { await fn(); console.log(`scene-sync: ${name}`); cases++; }
const add = (state, id = 'scene-work') => Scene.create(state, { id, name: id, iconKey: 'briefcase', homeGroupId: id + '-home', homeName: id + ' home' });
function local() {
  const state = add(Scene.migrateLegacy({
    icons: [{ id: 'site-one', folderId: 'folder-home', name: 'Site one', url: 'https://one.example/', type: 'shortcut', uploadedIconDataUrl: 'data:image/png;base64,UPLOAD_SENTINEL', resolvedIconUrl: 'blob:RESOLVED_SENTINEL', customIconUrl: 'data:image/png;base64,CUSTOM_SENTINEL', secretRef: 'vault:LOCAL_REFERENCE', futureSecret: 'UNKNOWN_SECRET_SENTINEL', iconSource: 'upload' }],
    todos: [{ id: 'todo-one', text: 'TODO_SENTINEL', done: false }],
    background: { type: 'image', value: 'data:image/png;base64,BACKGROUND_SENTINEL', source: 'upload' }, bingIndex: 9,
    clockFormat: '24h', searchHistory: ['HISTORY_SENTINEL'], currentSceneId: 'scene-work', currentFolderId: 'folder-home', browserSyncEnabled: false,
    'opentab.secretVault': { ciphertext: 'VAULT_SENTINEL' }, [E]: 3
  }));
  state.icons.push({ id: 'work-icon', folderId: 'scene-work-home', type: 'shortcut', name: 'Work', url: 'https://work.example/', uploadedIconDataUrl: 'data:image/png;base64,WORK_UPLOAD_SENTINEL' });
  state.todos.push({ id: 'work-todo', sceneId: 'scene-work', text: 'WORK_TODO_SENTINEL' });
  state.sceneProfiles[1].background = { type: 'bing', value: 'BACKGROUND_WORK_SENTINEL' };
  state.sceneProfiles[1].bingIndex = 7;
  return state;
}
function chromeMock(initial, cloud = {}) {
  const data = clone(initial), remote = clone(cloud), writes = [], listeners = [];
  const area = (store, name) => ({
    get(keys, cb) { const result = clone(Object.fromEntries((keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]).filter(key => store[key] !== undefined).map(key => [key, store[key]]))); cb?.(result); return Promise.resolve(result); },
    set(patch, cb) { writes.push({ area: name, patch: clone(patch) }); Object.assign(store, clone(patch)); cb?.(); return Promise.resolve(); },
    remove(keys, cb) { writes.push({ area: name, remove: clone(keys) }); keys.forEach(key => delete store[key]); cb?.(); return Promise.resolve(); },
    getBytesInUse(_, cb) { const size = Buffer.byteLength(JSON.stringify(store)); cb?.(size); return Promise.resolve(size); }
  });
  return { runtime: { lastError: null }, storage: { local: area(data, 'local'), sync: area(remote, 'sync'), onChanged: { addListener(fn) { listeners.push(fn); } } }, data, remote, writes, listeners };
}
async function using(state, cloud, fn) {
  const api = chromeMock(state, cloud); Sync.setChrome(api);
  try { await fn(api); } finally { Sync.setChrome(null); }
}
async function payload(state = local(), deviceId = 'other-device') {
  const value = Sync.buildSyncPayload(state); value.deviceId = deviceId; value.hash = await Sync.hashPayload(value); return value;
}
const storePayload = value => Object.fromEntries(Sync.planSyncWrite(value).items.map(item => [item.key, item.value]));
async function zeroWrites(state, value, code) {
  await using(state, {}, async api => {
    const before = clone(api.data);
    await assert.rejects(Sync.applyRemotePayload(value, { snapshotReason: 'test', onSnapshot() { assert.fail('snapshot must not happen'); } }), error => !code || error.code === code);
    assert.deepEqual(api.data, before); assert.deepEqual(api.writes, []);
  });
}

await test('pure module loading is inert and the browser dependency is registered', () => {
  const sandbox = {};
  for (const key of ['chrome', 'document', 'fetch', 'localStorage', 'setTimeout']) Object.defineProperty(sandbox, key, { get() { throw new Error('Unexpected ' + key); } });
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(new URL('../scene-sync.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(typeof sandbox.OpenTabSceneSync.planRemote, 'function');
  assert.ok(fs.readFileSync(new URL('../home.html', import.meta.url), 'utf8').includes('<script src="scene-sync.js"></script>'));
});
await test('explicit projection excludes real synthetic secrets, backgrounds, tasks, history and uploads', async () => {
  const state = local();
  Object.assign(state.icons[0], { sshPassword: 'PASSWORD_SENTINEL', sshGatewayToken: 'TOKEN_SENTINEL', sshSocksPassword: 'SOCKS_SENTINEL', nested: { password: 'NESTED_SENTINEL' }, iconCandidates: ['https://valid.example/icon.png', 'data:IMAGE_SENTINEL', 'blob:BLOB_SENTINEL'] });
  state.customSearchEngines = [{ id: 'custom-a', name: 'Custom', template: 'https://search.example/?q={query}', password: 'ENGINE_SECRET_SENTINEL' }];
  const original = clone(state), result = Sync.buildSyncPayload(state), text = JSON.stringify(result);
  for (const forbidden of ['PASSWORD_SENTINEL', 'TOKEN_SENTINEL', 'SOCKS_SENTINEL', 'NESTED_SENTINEL', 'ENGINE_SECRET_SENTINEL', 'UPLOAD_SENTINEL', 'RESOLVED_SENTINEL', 'CUSTOM_SENTINEL', 'LOCAL_REFERENCE', 'UNKNOWN_SECRET_SENTINEL', 'TODO_SENTINEL', 'BACKGROUND_SENTINEL', 'BACKGROUND_WORK_SENTINEL', 'HISTORY_SENTINEL', 'VAULT_SENTINEL', 'IMAGE_SENTINEL', 'BLOB_SENTINEL']) assert.ok(!text.includes(forbidden), forbidden);
  assert.equal(result.v, 2); assert.equal(result[K], 2); assert.equal(result.sceneProfiles, undefined);
  assert.equal(result.settings.layoutColumns, undefined); assert.equal(result.settings.clockFormat, '24h');
  assert.deepEqual(Object.keys(result.sceneLayouts[0]), ['id', ...Protocol.LAYOUT_KEYS]);
  assert.deepEqual(result.folders.map(group => group.sceneId), ['scene-default', 'scene-work']);
  assert.deepEqual(state, original);
});
await test('v2 hash covers scene metadata, affiliations and per-scene layout but not updatedAt', async () => {
  const value = await payload(), initial = value.hash;
  for (const change of [p => { p.scenes[1].name = 'Renamed'; }, p => { p.sceneLayouts[0].layoutColumns = 6; }, p => { p.folders[1].name = 'Group renamed'; }, p => { p.folders.push({ id: 'group-new', sceneId: 'scene-default', name: 'new' }); }]) {
    const next = clone(value); change(next); assert.notEqual(await Sync.hashPayload(next), initial);
  }
  value.updatedAt++; assert.equal(await Sync.hashPayload(value), initial);
});
await test('namespace is isolated, UTF-8 chunks bounded, and retained v1 bytes count against quota', async () => {
  const state = local(); state.icons[0].name = '中😀"\\'.repeat(600);
  const value = await payload(state), plan = Sync.planSyncWrite(value);
  assert.ok(plan.ok); assert.ok(plan.items.every(item => item.key.startsWith('ot.s2.')));
  plan.items.forEach(item => assert.ok(Sync.storedItemBytes(item.key, item.value) <= Sync.QUOTA_BYTES_PER_ITEM));
  assert.deepEqual(Sync.unshardSyncPayload(plan.items.slice(1).map(item => item.value)), value);
  const retained = Object.fromEntries(Array.from({ length: 12 }, (_, index) => ['ot.s.c' + index, 'x'.repeat(7800)]));
  const over = Sync.planSyncWrite(value, retained); assert.equal(over.ok, false); assert.equal(over.reason, 'total');
});
await test('unknown local and remote schemas, v1-to-v2, and v2-to-v1 apply reject before all writes', async () => {
  const valid = await payload();
  await zeroWrites(local(), { v: 1, icons: [], folders: [], settings: {} }, 'SYNC_SCHEMA_MISMATCH');
  await zeroWrites({}, valid, 'SYNC_SCHEMA_MISMATCH');
  for (const version of [1, 3, '2', null]) { const state = local(); state[K] = version; await zeroWrites(state, valid); }
  for (const version of [0, 3, '2', null]) { const value = clone(valid); value.v = version; await zeroWrites(local(), value); }
  const partial = local(); delete partial[K]; await zeroWrites(partial, valid);
  const unknown = clone(valid); unknown[K] = 44; await zeroWrites(local(), unknown);
});
await test('malformed actual scene graphs and injected unknown transport fields fail closed', async () => {
  const valid = await payload();
  for (const mutate of [
    p => { p.folders[1].parentId = 'folder-home'; },
    p => { p.icons[0].folderId = 'missing'; },
    p => { p.scenes[1].homeGroupId = 'folder-home'; },
    p => { p.scenes.forEach(scene => scene.archivedAt = 1); },
    p => { p.sceneLayouts[0].layoutColumns = 3; },
    p => { p.sceneLayouts.push(clone(p.sceneLayouts[0])); },
    p => { p.sceneLayouts[0].background = { type: 'bing' }; },
    p => { p.icons[0].sshPassword = 'INJECTED_PASSWORD'; },
    p => { p.icons[0].customIconUrl = 'data:image/png;base64,INJECTED'; },
    p => { p.settings.background = 'INJECTED'; },
    p => { p.settings.layoutColumns = 8; },
    p => { p.folders[0].schemaVersion = 3; },
    p => { p.todos = []; }
  ]) { const value = clone(valid); mutate(value); value.hash = await Sync.hashPayload(value); await zeroWrites(local(), value); }
});
await test('strict metadata rejects unbounded counts, missing chunks, hash/version/byte mismatches without enabling or overwriting', async () => {
  const value = await payload(), initial = storePayload(value);
  for (const mutate of [
    cloud => { cloud[Sync.SCENE_META_KEY].n = 0; }, cloud => { cloud[Sync.SCENE_META_KEY].n = -1; }, cloud => { cloud[Sync.SCENE_META_KEY].n = Infinity; },
    cloud => { cloud[Sync.SCENE_META_KEY].n = 1.5; }, cloud => { cloud[Sync.SCENE_META_KEY].n = Sync.MAX_CHUNKS + 1; },
    cloud => { cloud[Sync.SCENE_META_KEY].v = 3; }, cloud => { cloud[Sync.SCENE_META_KEY].bytes++; },
    cloud => { cloud[Sync.SCENE_META_KEY].hash = 'xdead'; }, cloud => { cloud['ot.s2.c999999'] = 'unexpected'; }, cloud => { cloud[Sync.SCENE_META_KEY].extra = 1; },
    cloud => { delete cloud['ot.s2.c0']; }, cloud => { cloud['ot.s2.c0'] = '{'; }, cloud => { delete cloud[Sync.SCENE_META_KEY]; },
    cloud => { cloud['ot.s2.c0'] = cloud['ot.s2.c0'].replace('Site one', 'Site two'); }
  ]) await using(local(), (() => { const next = clone(initial); mutate(next); return next; })(), async api => {
    const before = clone(api.data), cloudBefore = clone(api.remote);
    await assert.rejects(Sync.setEnabled(true)); assert.deepEqual(api.data, before); assert.deepEqual(api.remote, cloudBefore); assert.deepEqual(api.writes, []);
  });
});
await test('remote planning preserves local-only records, archived scenes, selection and four-layout ownership', async () => {
  const before = local(), remote = local();
  remote.scenes[1].archivedAt = 55; remote.sceneProfiles[0].layoutColumns = 8;
  remote.sceneProfiles[0].background.value = 'REMOTE_BACKGROUND_MUST_NOT_APPEAR'; remote.sceneProfiles[0].bingIndex = 0;
  remote.icons[0].name = 'Renamed remote'; remote.icons[0].customIconUrl = 'https://remote.example/icon.png';
  const value = await payload(remote), planned = Protocol.planRemote(before, value, Sync.SYNC_SETTING_KEYS), after = { ...before, ...planned.patch };
  assert.ok(Scene.validate(after)); assert.equal(after.icons[0].name, 'Renamed remote');
  for (const key of ['uploadedIconDataUrl', 'resolvedIconUrl', 'customIconUrl', 'secretRef', 'futureSecret']) assert.equal(after.icons[0][key], before.icons[0][key]);
  assert.deepEqual(after.todos, before.todos); assert.equal(after.currentSceneId, before.currentSceneId);
  assert.deepEqual(after.sceneProfiles[0].background, before.sceneProfiles[0].background); assert.equal(after.sceneProfiles[0].bingIndex, 9); assert.equal(after.sceneProfiles[0].layoutColumns, 8);
  assert.equal(after.scenes[1].archivedAt, 55);
});
await test('omitted scenes are archived recovery graphs, never silent orphan/drop, and collisions reject', async () => {
  const before = local(), remote = Scene.migrateLegacy({ icons: [] }), value = await payload(remote);
  const planned = Protocol.planRemote(before, value, Sync.SYNC_SETTING_KEYS, 123), after = { ...before, ...planned.patch };
  assert.deepEqual(planned.recoveredSceneIds, ['scene-work']); assert.equal(after.scenes[1].archivedAt, 123);
  assert.deepEqual(after.sceneProfiles[1], before.sceneProfiles[1]); assert.deepEqual(after.todos, before.todos);
  assert.deepEqual(after.icons.find(item => item.id === 'work-icon'), before.icons[1]); assert.equal(after.scenes[1].homeGroupId, 'scene-work-home'); assert.ok(Scene.validate(after));
  value.icons.push({ id: 'work-icon', folderId: 'folder-home', name: 'collision' });
  assert.throws(() => Protocol.planRemote(before, value, Sync.SYNC_SETTING_KEYS), error => error.code === 'SCENE_RECOVERY_COLLISION');
});
await test('v2 enable/push preserves opt-in and never dual-writes or removes v1', async () => {
  const old = { 'ot.s.meta': { v: 1, n: 1 }, 'ot.s.c0': 'LEGACY_RETAINED' };
  await using(local(), old, async api => {
    assert.deepEqual(await Sync.pushLocalToSync(), { ok: false, skipped: true }); assert.equal(api.writes.length, 0);
    const result = await Sync.setEnabled(true); assert.ok(result.ok); assert.equal(api.data.browserSyncEnabled, true);
    assert.deepEqual(Object.fromEntries(Object.keys(old).map(key => [key, api.remote[key]])), old);
    assert.ok(api.writes.filter(write => write.area === 'sync').every(write => Object.keys(write.patch || {}).every(key => key.startsWith('ot.s2.'))));
    assert.equal((await Sync.readRemotePayload()).v, 2);
  });
});
await test('metadata-only v2 divergence asks for a conflict choice rather than overwriting empty site arrays', async () => {
  const state = Scene.migrateLegacy({}), remote = clone(state); remote.scenes[0].name = 'Another name';
  await using(state, storePayload(await payload(remote)), async api => {
    const result = await Sync.setEnabled(true); assert.equal(result.conflict, true);
    assert.equal(api.writes.filter(write => write.area === 'sync').length, 0); assert.equal(api.data.scenes[0].name, 'Default');
  });
});
await test('pull and delta undo preserve subsequent local-only edits and unrelated additions', async () => {
  const before = local(), remote = local(); remote.sceneProfiles[0].layoutColumns = 8; remote.scenes[1].name = 'Remote Work'; remote.icons[0].name = 'Remote name'; remote.clockFormat = '12h';
  const value = await payload(remote);
  await using(before, {}, async api => {
    let undo;
    assert.equal(await Sync.applyRemotePayload(value, { onSnapshot(_snapshot, inverse) { undo = inverse; } }), true);
    assert.equal(undo.v, 2); assert.equal(api.data[E], 4);
    const changedBackground = { type: 'image', value: 'data:image/png;base64,AFTER_BACKGROUND' };
    api.data.sceneProfiles[0].background = changedBackground; api.data.sceneProfiles[0].bingIndex = 27; api.data.sceneProfiles[1].layoutIconSize = 88;
    api.data.icons[0].uploadedIconDataUrl = 'data:image/png;base64,AFTER_UPLOAD'; api.data.icons[0].resolvedIconUrl = 'blob:AFTER_RESOLVED';
    api.data.todos.push({ id: 'later-task', sceneId: 'scene-work', text: 'Keep later task' });
    api.data.icons.push({ id: 'later-icon', folderId: 'scene-work-home', name: 'Keep later icon' });
    await Sync.undoRemotePayload(undo);
    assert.equal(api.data.icons[0].name, 'Site one'); assert.equal(api.data.scenes[1].name, 'scene-work'); assert.equal(api.data.sceneProfiles[0].layoutColumns, 0); assert.equal(api.data.clockFormat, '24h');
    assert.deepEqual(api.data.sceneProfiles[0].background, changedBackground); assert.equal(api.data.sceneProfiles[0].bingIndex, 27); assert.ok(api.data.todos.some(item => item.id === 'later-task')); assert.ok(api.data.icons.some(item => item.id === 'later-icon'));
    assert.equal(api.data.sceneProfiles[1].layoutIconSize, 88);
    assert.equal(api.data.icons[0].uploadedIconDataUrl, 'data:image/png;base64,AFTER_UPLOAD'); assert.ok(Scene.validate(api.data));
  });
});
await test('undo checks epochs, same synchronized fields and local data added to a new remote scene', async () => {
  const before = local(), remote = add(local(), 'scene-new'); remote.sceneProfiles[0].layoutColumns = 8;
  for (const mutate of [api => { api.data[E]++; }, api => { api.data.sceneProfiles[0].layoutColumns = 10; }, api => { api.data.todos.push({ id: 'new-local-task', sceneId: 'scene-new', text: 'Do not orphan' }); }, api => { api.data.sceneProfiles[2].background.value = 'NEW_LOCAL_BACKGROUND'; }]) {
    await using(before, {}, async api => {
      let undo; await Sync.applyRemotePayload(await payload(remote), { onSnapshot(_snapshot, inverse) { undo = inverse; } }); mutate(api);
      const unchanged = clone(api.data), count = api.writes.length;
      await assert.rejects(Sync.undoRemotePayload(undo), error => error.code === 'WORKSPACE_CONFLICT'); assert.deepEqual(api.data, unchanged); assert.equal(api.writes.length, count);
    });
  }
});
await test('old-device notifications do not apply or write into a v2 workspace', async () => {
  await using(local(), {}, async api => {
    await Sync.setEnabled(true); Sync.watchStorage();
    const before = clone(api.data), count = api.writes.length;
    api.remote['ot.s.meta'] = { v: 1, n: 1 }; api.remote['ot.s.c0'] = JSON.stringify({ v: 1, icons: [], folders: [] });
    api.listeners[0]({ 'ot.s.meta': { newValue: api.remote['ot.s.meta'] } }, 'sync');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(api.data, before); assert.equal(api.writes.length, count);
  });
});

await test('pull rejects a v1 migration race inside the locked replacement before writes or snapshot', async () => {
  await using({ icons: [], folders: [] }, {}, async api => {
    const originalGet = api.storage.local.get;
    let first = true;
    api.storage.local.get = (keys, cb) => {
      const result = originalGet(keys, cb);
      if (first) { first = false; Object.assign(api.data, Scene.migrateLegacy(api.data)); }
      return result;
    };
    await assert.rejects(Sync.applyRemotePayload({ v: 1, icons: [], folders: [] }, { snapshotReason: 'must-not-run' }), error => error.code === 'SYNC_SCHEMA_MISMATCH');
    assert.deepEqual(api.writes, []); assert.equal(api.data[K], 2); assert.equal(api.data[Sync.DEVICE_KEY], undefined);
  });
});
await test('corruption appearing after opt-in stops push without mutating cloud or local state', async () => {
  await using(local(), {}, async api => {
    await Sync.setEnabled(true);
    api.remote[Sync.SCENE_META_KEY].v = 3;
    const before = clone(api.data), cloudBefore = clone(api.remote), count = api.writes.length;
    await assert.rejects(Sync.pushLocalToSync());
    assert.deepEqual(api.data, before); assert.deepEqual(api.remote, cloudBefore); assert.equal(api.writes.length, count);
  });
});
await test('direct envelope hash tampering and unknown schemas during opt-out or secret migration never write', async () => {
  const value = await payload(); value.icons[0].name = 'Tampered'; await zeroWrites(local(), value);
  const state = local(); state[K] = 300;
  await using(state, {}, async api => {
    await assert.rejects(Sync.setEnabled(false)); await assert.rejects(Sync.migratePlaintextSecrets());
    assert.deepEqual(api.writes, []);
  });
});
await test('identical v2 clouds do not trigger legacy icon-count conflict heuristics', async () => {
  const state = local();
  await using(state, storePayload(await payload(state)), async () => {
    assert.notEqual((await Sync.setEnabled(true)).conflict, true);
  });
});
await test('new formerly absent global setting undo fails closed rather than serializing undefined', async () => {
  const state = local(), remote = clone(state); remote.themeMode = 'dark';
  await using(state, {}, async api => {
    let undo; await Sync.applyRemotePayload(await payload(remote), { onSnapshot(_snapshot, inverse) { undo = inverse; } });
    assert.equal(undo.undoable, false); assert.equal(undo.reason, 'SETTING_ABSENCE');
    const count = api.writes.length, before = clone(api.data);
    await assert.rejects(Sync.undoRemotePayload(undo), error => error.code === 'WORKSPACE_CONFLICT');
    assert.equal(api.writes.length, count); assert.deepEqual(api.data, before);
  });
});

await test('split meta/chunk notifications in both orders eventually apply exactly once without timers or invalid writes', async () => {
  for (const metadataFirst of [true, false]) await using(local(), {}, async api => {
    await Sync.setEnabled(true); Sync.watchStorage();
    const remote = local(); remote.scenes[1].name = 'New split remote';
    const update = storePayload(await payload(remote));
    const keys = Object.keys(update), meta = keys.filter(key => key === Sync.SCENE_META_KEY), chunks = keys.filter(key => key !== Sync.SCENE_META_KEY);
    const first = metadataFirst ? meta : chunks, second = metadataFirst ? chunks : meta;
    const baseline = clone(api.data), count = api.writes.length;
    const emit = names => {
      const changes = {};
      names.forEach(key => { api.remote[key] = update[key]; changes[key] = { newValue: update[key] }; });
      api.listeners[0](changes, 'sync');
    };
    emit(first); await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(api.data, baseline); assert.equal(api.writes.length, count);
    emit(second); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(api.data.scenes[1].name, 'New split remote'); assert.equal(api.data[E], baseline[E] + 1);
    emit(first); emit(second); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(api.data[E], baseline[E] + 1, 'duplicate complete notifications must not replace twice');
  });
});
await test('explicit v2 replacement requires its full recovery provider before any replacement write', async () => {
  const state = local(), remote = clone(state); remote.themeMode = 'dark';
  const status = { textContent: '', style: {} }, toast = { textContent: '', appendChild() { assert.fail('must not offer a known-unusable Undo'); }, classList: { add() {}, remove() {} } };
  await using(state, storePayload(await payload(remote)), async api => {
    await Sync.setEnabled(true);
    const unchanged = clone(api.data), count = api.writes.length;
    globalThis.document = { getElementById(id) { return id === 'import-sync-status' ? status : id === 'toast' ? toast : null; }, dispatchEvent() {} };
    try {
      await assert.rejects(Sync.resolveSyncChoice('remote'), error => error.code === 'SCENE_RECOVERY_UNAVAILABLE');
      assert.deepEqual(api.data, unchanged); assert.equal(api.writes.length, count);
      assert.ok(!status.textContent.includes('恢复最近快照')); assert.ok(!status.textContent.includes('可撤销。'));
    } finally { delete globalThis.document; }
  });
});

await test('projection redaction is not deletion of same-ID local source, URL or candidate metadata', async () => {
  const state = local(); Object.assign(state.icons[0], { iconSource: { kind: 'local', secret: 'SOURCE_SENTINEL' }, url: 'chrome-extension://local/tool.html', iconCandidates: ['data:LOCAL_CANDIDATE', 'https://public.example/old.png', { local: 'OPAQUE_CANDIDATE_SENTINEL' }] });
  delete state.icons[0].uploadedIconDataUrl; delete state.icons[0].customIconUrl;
  const projected = await payload(state), self = Protocol.planRemote(state, projected, Sync.SYNC_SETTING_KEYS).patch;
  for (const key of ['iconSource', 'url', 'iconCandidates']) assert.deepEqual(self.icons[0][key], state.icons[0][key]);
  const wire = JSON.stringify(projected); for (const sentinel of ['SOURCE_SENTINEL', 'local/tool.html', 'LOCAL_CANDIDATE', 'OPAQUE_CANDIDATE_SENTINEL']) assert.ok(!wire.includes(sentinel));
  Object.assign(projected.icons[0], { iconSource: 'favicon', url: 'https://changed.example/', iconCandidates: ['https://public.example/new.png'] });
  const changed = Protocol.planRemote(state, projected, Sync.SYNC_SETTING_KEYS).patch.icons[0];
  assert.equal(changed.iconSource, 'favicon'); assert.equal(changed.url, 'https://changed.example/');
  assert.deepEqual(changed.iconCandidates, ['https://public.example/new.png', 'data:LOCAL_CANDIDATE', { local: 'OPAQUE_CANDIDATE_SENTINEL' }]);
});
await test('queued opt-out winning the workspace lock prevents every later push write', async () => {
  await using(local(), {}, async api => {
    await Sync.setEnabled(true); api.data.scenes[0].name = 'Changed locally';
    let unlock, acquired;
    const ready = new Promise(resolve => { acquired = resolve; });
    const gate = new Promise(resolve => { unlock = resolve; });
    const holding = Workspace.forChrome(api).transaction(async () => { acquired(); await gate; });
    await ready;
    const count = api.writes.length, disabling = Sync.setEnabled(false), pushing = Sync.pushLocalToSync();
    unlock(); await holding; await disabling;
    assert.equal((await pushing).skipped, true); assert.equal(api.data.browserSyncEnabled, false);
    assert.ok(api.writes.slice(count).every(write => write.area === 'local' && Object.keys(write.patch).every(key => key === Sync.ENABLED_KEY)));
  });
});
await test('another tab durable opt-out prevents cloud reads and local device writes', async () => {
  await using(local(), {}, async api => {
    await Sync.setEnabled(true); api.data.scenes[0].name = 'Another local edit'; api.data.browserSyncEnabled = false;
    delete api.data[Sync.DEVICE_KEY];
    api.storage.sync.get = () => { assert.fail('must not read sync after locked durable opt-out'); };
    const count = api.writes.length;
    assert.equal((await Sync.pushLocalToSync()).skipped, true); assert.equal(api.writes.length, count); assert.equal(api.data[Sync.DEVICE_KEY], undefined);
  });
});
await test('disable intent arriving during a slow cloud read stops the pending upload', async () => {
  await using(local(), {}, async api => {
    await Sync.setEnabled(true); api.data.scenes[0].name = 'Slow read edit';
    let resume, started; const ready = new Promise(resolve => { started = resolve; });
    const originalGet = api.storage.sync.get;
    api.storage.sync.get = async keys => { started(); await new Promise(resolve => { resume = resolve; }); return originalGet(keys); };
    const count = api.writes.length, pushing = Sync.pushLocalToSync(); await ready;
    const disabling = Sync.setEnabled(false); resume();
    assert.equal((await pushing).skipped, true); await disabling;
    assert.ok(api.writes.slice(count).every(write => write.area === 'local' && Object.keys(write.patch).every(key => key === Sync.ENABLED_KEY)));
  });
});

await test('late automatic pull rechecks disabled intent and durable preference inside its replacement lock', async () => {
  await using(local(), {}, async api => {
    await Sync.setEnabled(true);
    const remote = local(); remote.scenes[0].name = 'Must not apply'; const value = await payload(remote);
    let release, started; const ready = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const holding = Workspace.forChrome(api).transaction(async () => { started(); await gate; }); await ready;
    const count = api.writes.length, beforeEpoch = api.data[E], pending = Sync.applyRemotePayload(value, { automatic: true });
    const disabling = Sync.setEnabled(false); release(); await holding; await disabling;
    assert.equal(await pending, false); assert.equal(api.data[E], beforeEpoch); assert.notEqual(api.data.scenes[0].name, 'Must not apply');
    assert.ok(api.writes.slice(count).every(write => write.area === 'local' && Object.keys(write.patch).every(key => key === Sync.ENABLED_KEY)));
  });
});
await test('watcher held on its first local read cannot apply after opt-out completes', async () => {
  await using(local(), {}, async api => {
    await Sync.setEnabled(true); Sync.watchStorage();
    const remote = local(); remote.scenes[0].name = 'Late watcher must not apply'; Object.assign(api.remote, storePayload(await payload(remote)));
    let release, started; const ready = new Promise(resolve => { started = resolve; });
    const originalGet = api.storage.local.get; let first = true;
    api.storage.local.get = async (keys, cb) => {
      if (!first) return originalGet(keys, cb);
      first = false; const snapshot = await originalGet(keys); started(); await new Promise(resolve => { release = resolve; }); return snapshot;
    };
    api.listeners[0]({ [Sync.SCENE_META_KEY]: { newValue: api.remote[Sync.SCENE_META_KEY] } }, 'sync'); await ready;
    await Sync.setEnabled(false); const before = clone(api.data), count = api.writes.length; release();
    await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(api.data, before); assert.equal(api.writes.length, count);
  });
});

await test('real full-snapshot provider retains removed uploads before explicit replacement and unavailable Undo has a real recovery path', async () => {
  const Import = require('../import.js');
  const state = local(), remote = clone(state); remote.themeMode = 'dark'; remote.icons = [];
  const status = { textContent: '', style: {} }, toast = { appendChild() { assert.fail('unavailable inverse must not create Undo'); }, classList: { add() {}, remove() {} } };
  try {
    await using(state, storePayload(await payload(remote)), async api => {
      Import.setChrome(api);
      await Sync.setEnabled(true);
      globalThis.document = { getElementById(id) { return id === 'import-sync-status' ? status : id === 'toast' ? toast : null; }, dispatchEvent() {} };
      const result = await Sync.resolveSyncChoice('remote');
      assert.equal(result.undoable, false); assert.ok(result.snapshotId); assert.ok(status.textContent.includes('恢复最近快照'));
      const saved = api.data[Import.BACKUP_SNAPSHOTS_KEY][0];
      assert.equal(saved.id, result.snapshotId); assert.equal(saved.completeness, 'full'); assert.equal(saved.data[K], 2);
      assert.equal(saved.data.icons[0].uploadedIconDataUrl, state.icons[0].uploadedIconDataUrl); assert.equal(saved.data.icons[0].customIconUrl, state.icons[0].customIconUrl);
      assert.deepEqual(saved.data.sceneProfiles, state.sceneProfiles); assert.deepEqual(saved.data.todos, state.todos);
      delete globalThis.document;
      const restored = Import.mergeBackupPayload(saved.data, api.data);
      assert.equal(restored.icons[0].uploadedIconDataUrl, state.icons[0].uploadedIconDataUrl); assert.ok(Scene.validate(restored));
    });
  } finally { Import.setChrome(null); delete globalThis.OpenTabImport; delete globalThis.document; }
});
await test('compact or failing recovery providers cannot permit a v2 replacement', async () => {
  for (const provider of [() => ({ record: { completeness: 'compact' }, records: [] }), () => { throw new Error('synthetic snapshot quota'); }]) {
    globalThis.OpenTabImport = { BACKUP_SNAPSHOTS_KEY: 'backupSnapshots', prepareSnapshotRecord: provider };
    try { await using(local(), {}, async api => {
      const before = clone(api.data);
      await assert.rejects(Sync.applyRemotePayload(await payload(), { snapshotReason: 'before-sync-pull' }));
      assert.deepEqual(api.data, before); assert.deepEqual(api.writes, []);
    }); } finally { delete globalThis.OpenTabImport; }
  }
});

await test('a delayed automatic cloud response cannot replace a newer local upload with stale remote state', async () => {
  await using(local(), {}, async api => {
    await Sync.setEnabled(true); Sync.watchStorage();
    const oldRemote = local(); oldRemote.scenes[0].name = 'Earlier cloud edit'; Object.assign(api.remote, storePayload(await payload(oldRemote)));
    let release, started; const ready = new Promise(resolve => { started = resolve; });
    const originalGet = api.storage.sync.get; let first = true;
    api.storage.sync.get = async (keys, cb) => {
      if (!first) return originalGet(keys, cb);
      first = false; const snapshot = await originalGet(keys); started(); await new Promise(resolve => { release = resolve; }); return snapshot;
    };
    api.listeners[0]({ [Sync.SCENE_META_KEY]: { newValue: api.remote[Sync.SCENE_META_KEY] } }, 'sync'); await ready;
    api.data.scenes[0].name = 'Newer local upload'; assert.ok((await Sync.pushLocalToSync()).ok);
    const before = clone(api.data), cloud = clone(api.remote), count = api.writes.length; release();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(api.data, before); assert.deepEqual(api.remote, cloud); assert.equal(api.writes.length, count);
  });
});

await test('failed full snapshot storage write leaves all local scene data unchanged', async () => {
  const Import = require('../import.js'); globalThis.OpenTabImport = Import;
  try { await using(local(), {}, async api => {
    Import.setChrome(api); const before = clone(api.data);
    api.storage.local.set = async () => { throw new Error('synthetic full recovery quota failure'); };
    const remote = local(); remote.scenes[0].name = 'Never persisted';
    await assert.rejects(Sync.applyRemotePayload(await payload(remote), { snapshotReason: 'before-sync-pull' }));
    assert.deepEqual(api.data, before); assert.deepEqual(api.writes, []);
  }); } finally { Import.setChrome(null); delete globalThis.OpenTabImport; }
});

const syntheticSecrets = { sshPassword: 'SYNTHETIC_MIGRATION_PASSWORD', sshSocksPassword: 'SYNTHETIC_MIGRATION_SOCKS' };
async function realSeal(vault, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(vault)));
  return { v: 1, iv: Buffer.from(iv).toString('base64'), data: Buffer.from(data).toString('base64') };
}
async function realOpen(vault, key) {
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(vault.iv, 'base64') }, key, Buffer.from(vault.data, 'base64'))));
}
async function migrationHarness(run, { seed = true, keyUsages = ['encrypt', 'decrypt'], scene = false } = {}) {
  let key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, keyUsages);
  const originalVault = { unrelated: { sshPassword: 'SYNTHETIC_UNRELATED_PASSWORD' }, ssh: { sshGatewayToken: 'SYNTHETIC_EXISTING_GATEWAY' } };
  const state = { icons: [{ id: 'ssh', name: 'Original synthetic server', folderId: 'folder-home', type: 'ssh', ...syntheticSecrets }], folders: [{ id: 'folder-home', name: 'Home' }] };
  if (seed) state[Sync.VAULT_STORE] = await realSeal(originalVault, key);
  const api = chromeMock(scene ? Scene.migrateLegacy(state) : state);
  const controls = { fault: '', vaultWritten: false, keyFault: '', gate: null }, events = [];
  const initialSealed = clone(state[Sync.VAULT_STORE]);
  api.storage.local.get = (keys, cb) => {
    const list = keys == null ? Object.keys(api.data) : Array.isArray(keys) ? keys : [keys];
    queueMicrotask(() => {
      if (controls.vaultWritten && list.includes(Sync.VAULT_STORE) && controls.fault === 'vault-read') {
        api.runtime.lastError = { message: 'synthetic read failure' }; cb?.(); api.runtime.lastError = null; return;
      }
      if (controls.vaultWritten && list.includes(Sync.VAULT_STORE) && controls.fault === 'pending-readback') Sync.prepareLocalPersistSync({ icons: [{ id: 'ssh', sshPassword: 'SYNTHETIC_LATE_PENDING' }] });
      const value = clone(Object.fromEntries(list.filter(k => api.data[k] !== undefined).map(k => [k, api.data[k]])));
      if (controls.vaultWritten && list.includes(Sync.VAULT_STORE) && controls.fault === 'vault-mismatch') value[Sync.VAULT_STORE] = clone(initialSealed);
      events.push('read:' + list.join(',')); cb?.(value);
    });
  };
  api.storage.local.set = (patch, cb) => {
    queueMicrotask(() => {
      const vaultWrite = Object.hasOwn(patch, Sync.VAULT_STORE), iconWrite = Object.hasOwn(patch, 'icons');
      events.push(vaultWrite ? 'write:vault' : iconWrite ? 'write:icons' : 'write:other');
      if ((vaultWrite && controls.fault === 'vault-write') || (iconWrite && controls.fault === 'icons-write')) {
        api.runtime.lastError = { message: 'synthetic write failure' }; cb?.(); api.runtime.lastError = null; return;
      }
      api.writes.push({ area: 'local', patch: clone(patch) }); Object.assign(api.data, clone(patch));
      if (vaultWrite) controls.vaultWritten = true;
      cb?.();
    });
  };
  Sync.setChrome(api);
  Sync.setKeyStore({
    async getKey() { if (controls.gate) await controls.gate; if (controls.keyFault === 'read' || (controls.keyFault === 'readback' && controls.vaultWritten)) throw new Error('synthetic key read'); return key; },
    async setKey(next) { if (controls.keyFault === 'write') throw new Error('synthetic key write'); key = next; }
  });
  try { await run({ api, controls, events, originalVault, getKey: () => key, dropKey: () => { key = null; } }); }
  finally { Sync.setChrome(null); Sync.setKeyStore(null); }
}
const migrationFailure = error => error.code === 'SECRET_MIGRATION_FAILED' && error.message === '保护本地凭据时保存失败，请重试。' && !error.message.includes('SYNTHETIC');

await test('plaintext migration persists and verifies real AES-GCM recovery before clearing, retaining existing records and fields', async () => {
  await migrationHarness(async ({ api, events, originalVault, getKey }) => {
    assert.equal(await Sync.migratePlaintextSecrets(), true);
    assert.ok(events.indexOf('write:vault') < events.indexOf('write:icons'));
    assert.ok(events.slice(events.indexOf('write:vault') + 1, events.indexOf('write:icons')).some(event => event === 'read:' + Sync.VAULT_STORE));
    assert.equal(api.data.icons[0].sshPassword, ''); assert.equal(api.data.icons[0].sshSocksPassword, '');
    const decrypted = await realOpen(api.data[Sync.VAULT_STORE], getKey());
    assert.deepEqual(decrypted.unrelated, originalVault.unrelated); assert.deepEqual(decrypted.ssh, { ...originalVault.ssh, ...syntheticSecrets });
    assert.ok(!JSON.stringify(api.data[Sync.VAULT_STORE]).includes('SYNTHETIC'));
    const count = api.writes.length; assert.equal(await Sync.migratePlaintextSecrets(), false); assert.equal(api.writes.length, count);
    assert.equal(api.data.backupSnapshots, undefined);
  }, { scene: true });
});
await test('encrypted-vault write failures leave original icons untouched and retry safely', async () => {
  await migrationHarness(async ({ api, controls, getKey }) => {
    const original = clone(api.data); controls.fault = 'vault-write';
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data, original);
    controls.fault = ''; assert.equal(await Sync.migratePlaintextSecrets(), true);
    assert.equal((await realOpen(api.data[Sync.VAULT_STORE], getKey())).ssh.sshPassword, syntheticSecrets.sshPassword);
  });
});
await test('vault readback failures and valid-but-wrong decrypted records cannot clear plaintext', async () => {
  for (const fault of ['vault-read', 'vault-mismatch']) await migrationHarness(async ({ api, controls, getKey }) => {
    const original = clone(api.data.icons); controls.fault = fault;
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data.icons, original);
    assert.equal((await realOpen(api.data[Sync.VAULT_STORE], getKey())).ssh.sshPassword, syntheticSecrets.sshPassword);
    controls.fault = ''; assert.equal(await Sync.migratePlaintextSecrets(), true);
  });
});
await test('failed icons clear retains originals plus verified encrypted recovery, then retry completes', async () => {
  await migrationHarness(async ({ api, controls, getKey }) => {
    const original = clone(api.data.icons); controls.fault = 'icons-write';
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data.icons, original);
    assert.equal((await realOpen(api.data[Sync.VAULT_STORE], getKey())).ssh.sshPassword, syntheticSecrets.sshPassword);
    controls.fault = ''; assert.equal(await Sync.migratePlaintextSecrets(), true); assert.equal(api.data.icons[0].sshPassword, '');
  });
});
await test('unavailable keys, failed key persistence and unsupported encryption never clear original credentials', async () => {
  await migrationHarness(async ({ api, controls }) => {
    const before = clone(api.data); controls.keyFault = 'read';
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data, before);
    controls.keyFault = ''; assert.equal(await Sync.migratePlaintextSecrets(), true);
  });
  await migrationHarness(async ({ api, controls, dropKey }) => {
    dropKey(); const before = clone(api.data); controls.keyFault = 'write';
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data, before);
    controls.keyFault = ''; assert.equal(await Sync.migratePlaintextSecrets(), true);
  }, { seed: false });
  await migrationHarness(async ({ api }) => {
    const before = clone(api.data); await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data, before);
  }, { seed: false, keyUsages: ['decrypt'] });
});
await test('persisted key readback failure leaves plaintext and a safe encrypted copy for retry', async () => {
  await migrationHarness(async ({ api, controls, getKey }) => {
    const original = clone(api.data.icons); controls.keyFault = 'readback';
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data.icons, original);
    assert.equal((await realOpen(api.data[Sync.VAULT_STORE], getKey())).ssh.sshPassword, syntheticSecrets.sshPassword);
    controls.keyFault = ''; assert.equal(await Sync.migratePlaintextSecrets(), true);
  });
});
await test('missing persisted keys and unknown vault structures fail closed instead of replacing existing encrypted records', async () => {
  await migrationHarness(async ({ api, dropKey }) => {
    dropKey(); const before = clone(api.data); await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data, before);
  });
  for (const vault of [{ v: 9, data: 'UNKNOWN_VERSION', iv: 'unknown' }, { unexpected: 'OPAQUE_LOCAL_RECORD' }]) await migrationHarness(async ({ api }) => {
    api.data[Sync.VAULT_STORE] = vault; const before = clone(api.data);
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data, before);
  });
});
await test('a rejected older flush chain does not poison retry of intact plaintext migration', async () => {
  await migrationHarness(async ({ api, controls }) => {
    controls.fault = 'vault-write'; Sync.prepareLocalPersistSync({ icons: clone(api.data.icons) });
    await assert.rejects(Sync.flushVault());
    assert.equal(api.data.icons[0].sshPassword, syntheticSecrets.sshPassword);
    controls.fault = ''; assert.equal(await Sync.migratePlaintextSecrets(), true); assert.equal(api.data.icons[0].sshPassword, '');
  });
});
await test('pending unflushed credentials or tombstones cannot trigger a destructive wrapper flush during migration', async () => {
  for (const tombstone of [false, true]) await migrationHarness(async ({ api, originalVault, getKey }) => {
    const original = clone(api.data);
    if (tombstone) Sync.prepareLocalPersistSync({ icons: [] }, { tombstoneIds: ['ssh'] });
    else Sync.prepareLocalPersistSync({ icons: [{ id: 'ssh', sshPassword: 'SYNTHETIC_PENDING_EDIT' }] });
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure);
    assert.deepEqual(api.data, original); assert.deepEqual(api.writes, []);
    assert.deepEqual(await realOpen(api.data[Sync.VAULT_STORE], getKey()), originalVault);
  });
});
await test('late pending edits at key preparation or vault readback stop migration before any scrub', async () => {
  await migrationHarness(async ({ api, getKey }) => {
    const before = clone(api.data);
    Sync.setKeyStore({ async getKey() { Sync.prepareLocalPersistSync({ icons: [{ id: 'ssh', sshPassword: 'SYNTHETIC_LATE_PENDING' }] }); return getKey(); } });
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data, before); assert.deepEqual(api.writes, []);
  });
  await migrationHarness(async ({ api, controls, originalVault, getKey }) => {
    const original = clone(api.data.icons); controls.fault = 'pending-readback';
    await assert.rejects(Sync.migratePlaintextSecrets(), migrationFailure); assert.deepEqual(api.data.icons, original);
    const recovered = await realOpen(api.data[Sync.VAULT_STORE], getKey());
    assert.deepEqual(recovered.unrelated, originalVault.unrelated);
    assert.deepEqual(recovered.ssh, { ...originalVault.ssh, ...syntheticSecrets });
    assert.equal(api.writes.length, 1); assert.ok(Object.hasOwn(api.writes[0].patch, Sync.VAULT_STORE));
  });
});
await test('migration and a queued edit share the lock; repeated startup migrations remain idempotent', async () => {
  await migrationHarness(async ({ api, controls, getKey }) => {
    let release, reached; const ready = new Promise(resolve => { reached = resolve; });
    controls.gate = new Promise(resolve => { release = resolve; });
    const keyStore = { async getKey() { reached(); await controls.gate; return getKey(); }, async setKey() { assert.fail('existing key must not change'); } };
    Sync.setKeyStore(keyStore);
    const first = Sync.migratePlaintextSecrets(); await ready;
    const second = Sync.migratePlaintextSecrets();
    const queuedEdit = Workspace.forChrome(api).transaction(async ({ read, write }) => {
      const current = await read(null); const icons = clone(current.icons); icons[0].name = 'Later queued edit'; await write({ icons });
    });
    release(); assert.equal(await first, true); assert.equal(await second, false); await queuedEdit;
    assert.equal(api.data.icons[0].name, 'Later queued edit'); assert.equal(api.data.icons[0].sshPassword, '');
    assert.equal((await realOpen(api.data[Sync.VAULT_STORE], getKey())).ssh.sshPassword, syntheticSecrets.sshPassword);
    assert.equal(api.writes.filter(write => Object.hasOwn(write.patch, Sync.VAULT_STORE)).length, 1);
  });
});
console.log(`scene-sync: ${cases} tests passed`);
