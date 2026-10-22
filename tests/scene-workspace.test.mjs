import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Scenes = require('../scene-workspace.js');
const Workspace = require('../workspace-persistence.js');
const { stripSecretsFromState } = require('../import.js');
const copy = value => structuredClone(value);
function harness(initial = {}) {
  const store = copy(initial), writes = [];
  let fail = false;
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) { return copy(keys == null ? store : Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
    async set(patch) { if (fail) { fail = false; throw new Error('quota failure'); } writes.push(copy(patch)); Object.assign(store, copy(patch)); }
  } } };
  const workspace = Workspace.forChrome(chrome);
  const api = Scenes.create({ workspace, schema: Schema, stripSecrets: stripSecretsFromState, now: () => 123 });
  return { store, writes, workspace, api, failNext() { fail = true; } };
}
const initial = () => Schema.create(Schema.migrateLegacy({
  icons: [{ id: 'site', name: 'Site', folderId: 'work', uploadedIconDataUrl: 'data:image/png;base64,synthetic' }],
  folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }, { id: 'child', name: 'Child', parentId: 'work' }],
  todos: [{ id: 'task', text: 'Keep me', done: false }], browserSyncEnabled: false
}), { id: 'study', name: 'Study', iconKey: 'book', homeGroupId: 'study-home', homeName: 'Study home' });
const code = wanted => error => error.code === wanted;
{
  const raw = { icons: [{ id: 'ssh', name: 'SSH', uploadedIconDataUrl: 'data:upload', sshPassword: '' }],
    folders: [], todos: [{ id: 'a', text: 'Draft', done: false }], background: { type: 'image', value: 'data:wallpaper' },
    'opentab.secretVault': { v: 1, data: 'encrypted-sentinel' }, 'opentab.cryptoKey': 'key-sentinel',
    backupSnapshots: [{ id: 'old', data: { icons: [{ id: 'old', sshPassword: 'old-plaintext' }] } }], browserSyncEnabled: false };
  const h = harness(raw), result = await h.api.migrate({ defaultName: 'Default', homeName: 'Home' });
  assert.equal(result.migrated, true); assert.equal(h.writes.length, 1);
  assert.equal(h.store[Scenes.EPOCH_KEY], 1); assert.equal(h.store.browserSyncEnabled, false);
  assert.deepEqual(h.store['opentab.secretVault'], raw['opentab.secretVault']);
  const backup = h.store[Scenes.BACKUP_KEY];
  assert.equal(backup.data.icons[0].uploadedIconDataUrl, 'data:upload');
  assert.deepEqual(backup.data.background, raw.background);
  assert.equal(backup.data['opentab.secretVault'], undefined); assert.equal(backup.data['opentab.cryptoKey'], undefined);
  assert.equal(backup.data.backupSnapshots[0].data.icons[0].sshPassword, '');
  assert.deepEqual(h.store.backupSnapshots, raw.backupSnapshots, 'existing snapshots are not pruned or rewritten');
  const again = await h.api.migrate(); assert.equal(again.migrated, false); assert.equal(h.writes.length, 1);
}
{
  const raw = { icons: [{ id: 'x', sshPassword: 'do-not-strip' }], todos: [] }, h = harness(raw);
  await assert.rejects(h.api.migrate(), code('SCENE_CREDENTIALS_UNPROTECTED'));
  assert.deepEqual(h.store, raw); assert.equal(h.writes.length, 0);
  const f = harness({ icons: [], background: { type: 'image', value: 'data:large-local-image' } }), before = copy(f.store);
  f.failNext(); await assert.rejects(f.api.migrate(), /quota failure/);
  assert.deepEqual(f.store, before); assert.equal(f.writes.length, 0);
  assert.equal((await f.api.migrate()).migrated, true);
}
{
  const h = harness({ icons: [] });
  const results = await Promise.all([h.api.migrate(), h.api.migrate()]);
  assert.deepEqual(results.map(x => x.migrated), [true, false]); assert.equal(h.writes.length, 1);
  for (const raw of [{ [Schema.SCHEMA_KEY]: 99 }, { [Schema.SCHEMA_KEY]: 2 }, { icons: [], [Scenes.BACKUP_KEY]: { keep: true } }]) {
    const f = harness(raw); await assert.rejects(f.api.migrate()); assert.deepEqual(f.store, raw); assert.equal(f.writes.length, 0);
  }
}
{
  const h = harness(initial()), args = { sceneId: 'study', archivedAt: 456 };
  const preview = h.api.prepare(h.store, 'archive', args); args.sceneId = Schema.DEFAULT_SCENE_ID;
  const result = await h.api.execute(preview);
  assert.equal(result.receipt.undoable, true); assert.equal(h.store.scenes.find(x => x.id === 'study').archivedAt, 456);
  await assert.rejects(h.api.execute(preview), code('SCENE_CONFLICT'));
  // An unrelated rename survives the inverse archive edit.
  h.store.scenes.find(x => x.id === 'study').name = 'Renamed remotely';
  await h.api.undo(result.receipt);
  assert.equal(h.store.scenes.find(x => x.id === 'study').archivedAt, null);
  assert.equal(h.store.scenes.find(x => x.id === 'study').name, 'Renamed remotely');
  await assert.rejects(h.api.undo(result.receipt), code('SCENE_CONFLICT'));
}
{
  const h = harness(initial()), preview = h.api.prepare(h.store, 'moveGroup', { groupId: 'work', targetSceneId: 'study' });
  let release, entered = false;
  const blocked = h.workspace.transaction(async ({ write }) => { entered = true; await new Promise(resolve => { release = resolve; }); await write({ scenes: h.store.scenes.map(x => x.id === 'study' ? { ...x, name: 'Different target' } : x) }); });
  while (!entered) await Promise.resolve();
  const pending = h.api.execute(preview); release(); await blocked;
  const current = copy(h.store); await assert.rejects(pending, code('SCENE_CONFLICT'));
  assert.deepEqual(h.store, current, 'locked latest target identity rejects before any partial write');
}
{
  const h = harness(initial()), preview = h.api.prepare(h.store, 'moveGroup', { groupId: 'work', targetSceneId: 'study' });
  const moved = await h.api.execute(preview);
  assert.equal(h.store.folders.find(x => x.id === 'child').sceneId, 'study');
  h.store.folders.find(x => x.id === 'work').name = 'Work renamed';
  h.store.icons.push({ id: 'new', name: 'New', folderId: 'work' });
  h.store.todos.push({ id: 'other', text: 'Other scene task', done: false, sceneId: 'study' });
  await h.api.undo(moved.receipt);
  assert.equal(h.store.folders.find(x => x.id === 'work').name, 'Work renamed');
  assert.equal(h.store.folders.find(x => x.id === 'work').sceneId, Schema.DEFAULT_SCENE_ID);
  assert.equal(h.store.icons.find(x => x.id === 'new').folderId, 'work');
  assert.equal(h.store.todos.find(x => x.id === 'other').sceneId, 'study');
}
{
  const h = harness(initial()), p = h.api.prepare(h.store, 'moveGroup', { groupId: 'work', targetSceneId: 'study' });
  h.store.folders.push({ id: 'new-child', name: 'New child', parentId: 'work', sceneId: Schema.DEFAULT_SCENE_ID });
  const before = copy(h.store); await assert.rejects(h.api.execute(p), code('SCENE_CONFLICT')); assert.deepEqual(h.store, before);
  const q = h.api.prepare(h.store, 'archive', { sceneId: 'study', archivedAt: 123 });
  h.store[Scenes.EPOCH_KEY] = 1;
  await assert.rejects(h.api.execute(q), code('SCENE_CONFLICT'));
}
{
  const h = harness(initial());
  const first = h.api.prepare(h.store, 'patchProfile', { sceneId: 'study', changes: { layoutColumns: 6 } });
  const second = h.api.prepare(h.store, 'patchProfile', { sceneId: 'study', changes: { background: { type: 'gradient', value: 'synthetic' } } });
  await h.api.execute(first); await h.api.execute(second);
  const profile = h.store.sceneProfiles.find(x => x.id === 'study');
  assert.equal(profile.layoutColumns, 6); assert.equal(profile.background.value, 'synthetic');
  const stale = h.api.prepare(h.store, 'patchProfile', { sceneId: 'study', changes: { layoutColumns: 8 } });
  profile.layoutColumns = 7;
  await assert.rejects(h.api.execute(stale), code('SCENE_CONFLICT'));
  assert.throws(() => h.api.prepare(h.store, 'patchProfile', { sceneId: 'study', changes: { themeMode: 'dark' } }), code('INVALID_PROFILE_PATCH'));
}
{
  const h = harness(initial()), p = h.api.prepare(h.store, 'rename', { sceneId: 'study', name: 'New name' });
  const before = copy(h.store); h.failNext(); await assert.rejects(h.api.execute(p), /quota failure/); assert.deepEqual(h.store, before);
  const result = await h.api.execute(h.api.prepare(h.store, 'rename', { sceneId: 'study', name: 'New name' }));
  h.failNext(); await assert.rejects(h.api.undo(result.receipt), /quota failure/);
  await h.api.undo(result.receipt); assert.equal(h.store.scenes.find(x => x.id === 'study').name, 'Study');
}
{
  const h = harness(initial()), p = h.api.prepare(h.store, 'rename', { sceneId: 'study', name: 'New' });
  const result = await h.api.execute(p); h.store[Scenes.EPOCH_KEY] = 9;
  const before = copy(h.store); await assert.rejects(h.api.undo(result.receipt), code('SCENE_CONFLICT')); assert.deepEqual(h.store, before);
  const c = h.api.prepare(h.store, 'create', { id: 'third', name: 'Third', iconKey: 'book', homeGroupId: 'third-home', homeName: 'Home' });
  const created = await h.api.execute(c); assert.equal(created.receipt.undoable, false);
  await assert.rejects(h.api.execute(Object.freeze({ command: 'archive' })), code('SCENE_CONFLICT'));
}
{
  const h = harness(initial());
  const result = await h.api.execute(h.api.prepare(h.store, 'rename', { sceneId: 'study', name: 'New' }));
  let release, entered = false;
  const held = h.workspace.transaction(async () => { entered = true; await new Promise(resolve => { release = resolve; }); });
  while (!entered) await Promise.resolve();
  const first = h.api.undo(result.receipt);
  const laterEdit = h.workspace.transaction(async ({ read, write }) => {
    const live = await read(null);
    await write({ scenes: live.scenes.map(item => item.id === 'study' ? { ...item, name: 'New' } : item) });
  });
  const replay = h.api.undo(result.receipt);
  const rejected = assert.rejects(replay, code('SCENE_CONFLICT'));
  release(); await held; await first; await laterEdit; await rejected;
  assert.equal(h.store.scenes.find(item => item.id === 'study').name, 'New', 'queued ABA replay must not erase a later valid edit');
}
{
  const raw = JSON.parse('{"icons":[{"id":"opaque","unknown":{"__proto__":{"note":"icon"}}}],"background":{"type":"image","value":"data:asset","metadata":{"__proto__":{"note":"background"}}},"__proto__":{"note":"root"}}');
  const h = harness(raw); await h.api.migrate();
  assert.deepEqual(h.store[Scenes.BACKUP_KEY].data, raw, 'full migration backup retains opaque own JSON keys');
  assert.equal(Object.hasOwn(h.store[Scenes.BACKUP_KEY].data, '__proto__'), true);
}
{
  const h = harness(initial());
  const result = await h.api.execute(h.api.prepare(h.store, 'rename', { sceneId: 'study', name: 'New' }));
  const before = copy(h.store), writes = h.writes.length;
  for (const guard of [() => false, () => 1, () => Promise.resolve(true), () => Promise.reject(new Error('async guard'))]) {
    await assert.rejects(h.api.undo(result.receipt, guard), code('SCENE_CONFLICT'));
    assert.deepEqual(h.store, before); assert.equal(h.writes.length, writes);
  }
  await h.api.undo(result.receipt, () => true);
  assert.equal(h.store.scenes.find(scene => scene.id === 'study').name, 'Study');
  await assert.rejects(h.api.undo(result.receipt, () => true), code('SCENE_CONFLICT'));
}
{
  const raw = { icons: [], folders: [], todos: [], currentFolderId: 'folder-home', background: { type: 'gradient', value: 'keep' } };
  const h = harness(raw);
  for (const guard of [() => false, () => 1, () => Promise.resolve(true), () => Promise.reject(new Error('async guard'))]) {
    await assert.rejects(h.api.migrate({}, guard), code('SCENE_CONFLICT'));
    assert.deepEqual(h.store, raw); assert.equal(h.writes.length, 0);
  }
  let release, entered = false, clean = true, checked = false;
  const lock = h.workspace.transaction(async () => { entered = true; await new Promise(resolve => { release = resolve; }); });
  while (!entered) await Promise.resolve();
  const pending = h.api.migrate({}, latest => { checked = true; assert.deepEqual(latest, raw); return clean; });
  const rejected = assert.rejects(pending, code('SCENE_CONFLICT'));
  assert.equal(checked, false, 'migration predicate cannot run before its lock');
  clean = false; release(); await lock; await rejected;
  assert.equal(checked, true); assert.deepEqual(h.store, raw); assert.equal(h.writes.length, 0);
  clean = true; assert.equal((await h.api.migrate({}, () => clean)).migrated, true);
  assert.equal(h.writes.length, 1); assert.equal(h.store[Schema.SCHEMA_KEY], 2);
  assert.deepEqual(h.store[Scenes.BACKUP_KEY].data, raw, 'allowed retry still writes one intact recovery snapshot');
}
console.log('scene-workspace: atomic migration, locked scene commands and inverse undo passed');
