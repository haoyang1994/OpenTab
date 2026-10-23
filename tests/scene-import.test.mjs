import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const importer = require('../import.js');

const opaque = JSON.parse('{"__proto__":{"preserve":"top"},"icons":[{"id":"opaque","unknown":{"__proto__":{"preserve":"icon","sshPassword":"SECRET"}}}],"background":{"metadata":{"__proto__":{"preserve":"background","opentab.cryptoKey":"SECRET"}}},"sshGatewayToken":"SECRET","opentab.secretVault":{"secret":"SECRET"}}');
const clean = importer.stripSecretsFromState(opaque);
assert.equal(Object.getPrototypeOf(clean), Object.prototype);
assert.equal(Object.hasOwn(clean, '__proto__'), true);
assert.equal(clean.__proto__.preserve, 'top');
assert.equal(clean.icons[0].unknown.__proto__.preserve, 'icon');
assert.equal(clean.background.metadata.__proto__.preserve, 'background');
assert.equal(JSON.stringify(clean).includes('SECRET'), false);
assert.equal(JSON.stringify(opaque).includes('SECRET'), true, 'sanitization never mutates its source');
assert.deepEqual(JSON.parse(JSON.stringify(clean)), clean, 'all opaque JSON keys survive serialization');
console.log('Scene import sanitizer tests passed.');

const schema = require('../scene-schema.js');
const workspace = require('../workspace-persistence.js');
const clone = value => structuredClone(value);
const KEY = schema.SCHEMA_KEY, EPOCH = workspace.EPOCH_KEY;
const DEFAULT = schema.DEFAULT_SCENE_ID;
const WORK = 'scene-work', ARCHIVE = 'scene-archive';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const SECRET = 'DO_NOT_EXPORT_SYNTHETIC_SECRET';
const sceneOptions = { sceneId: WORK, generation: 1 };
const graphKeys = ['icons', 'folders', 'todos', 'scenes', 'sceneProfiles', KEY];
const graph = state => Object.fromEntries(graphKeys.map(key => [key, clone(state[key])]));
const imported = () => ({ ok: true, format: 'bookmarks', groups: [{ name: 'New group', icons: [{ name: 'New site', url: 'https://new.example/' }] }] });
function initial() {
  let state = schema.migrateLegacy({
    folders: [{ id: 'folder-home', name: 'Default Home' }, { id: 'default-child', name: 'Default child', parentId: 'folder-home', type: 'folder', opaque: { retained: true } }],
    icons: [{ id: 'keep', name: 'Keep', type: 'shortcut', folderId: 'default-child', url: 'https://keep.example/', uploadedIconDataUrl: png, sshPassword: SECRET, sshSecretId: 'keep', unknown: JSON.parse('{"__proto__":{"preserve":"opaque"}}') }],
    todos: [{ id: 'default-task', text: 'Keep default task', done: false }],
    currentFolderId: 'default-child', [EPOCH]: 7, themeMode: 'dark', accentHue: 220,
    background: { type: 'image', value: png, metadata: { sshGatewayToken: SECRET } },
    layoutIconSize: 64, layoutColumns: 5, layoutMaxWidth: 1000, layoutShowNames: false,
    searchEngine: 'bing', searchHistory: [{ q: 'private query', engine: 'bing', at: 1 }],
    'opentab.secretVault': { blob: SECRET }, 'opentab.cryptoKey': { key: SECRET }
  });
  state = schema.create(state, { id: WORK, name: 'Work', iconKey: 'briefcase', homeGroupId: 'work-home', homeName: 'Work Home', profile: { background: { type: 'image', value: png, metadata: { 'opentab.secretVault': SECRET, keep: true } }, bingIndex: 3, layoutColumns: 7 } });
  state = schema.create(state, { id: ARCHIVE, name: 'Archived', iconKey: 'archive', homeGroupId: 'archive-home', homeName: 'Archived Home' });
  state.folders.push({ id: 'work-child', name: 'New group', parentId: 'work-home', type: 'folder', sceneId: WORK, opaque: { preserved: true } });
  state.icons.push({ id: 'archived-icon', name: 'Archived upload', folderId: 'archive-home', uploadedIconDataUrl: png, customIconUrl: png, resolvedIconUrl: 'blob:synthetic', iconCacheState: 'ready' });
  state.todos.push({ id: 'work-task', text: 'Work task', sceneId: WORK }, { id: 'archived-task', text: 'Archived task', done: true, sceneId: ARCHIVE });
  return schema.archive(state, { sceneId: ARCHIVE, archivedAt: 123 });
}
async function scenario(data, test) {
  const state = clone(data), writes = [], reads = [], navigations = [];
  let ids = 0, reloads = 0, prepared = 0, failWrites = false;
  let onRead = null, onWrite = null;
  const api = { runtime: {}, storage: { local: {
    async get(keys) {
      reads.push(clone(keys));
      if (onRead) { const action = onRead; onRead = null; await action(); }
      return clone(Object.fromEntries((keys == null ? Object.keys(state) : keys).filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]])));
    },
    async set(patch) {
      if (failWrites) throw new Error('quota exceeded');
      writes.push(clone(patch));
      Object.assign(state, clone(patch));
      if (onWrite) { const action = onWrite; onWrite = null; await action(patch); }
    }
  } }, permissions: { request(_request, callback) { callback(true); return Promise.resolve(true); } }, topSites: { async get() { return [{ title: 'Top', url: 'https://top.example/' }]; } } };
  importer.setChrome(api);
  importer.setIdFactory(() => `scene-import-${++ids}`);
  importer.setReloader(navigation => { reloads++; navigations.push(clone(navigation)); });
  globalThis.OpenTabIcons = { prepareRecord() { prepared++; } };
  try {
    await test({ state, api, writes, reads, navigations, ids: () => ids, prepared: () => prepared, reloads: () => reloads,
      onRead(action) { onRead = action; }, onWrite(action) { onWrite = action; }, failWrites(value) { failWrites = value; } });
  } finally {
    importer.setChrome(null); importer.setIdFactory(null); importer.setReloader(null);
    delete globalThis.OpenTabIcons; delete globalThis.OpenTabSearch; delete globalThis.OpenTabFolders; delete globalThis.OpenTabBingCache;
  }
}

const adapters = [{ id: 'group', name: 'Group', parentId: 'parent', type: 'folder', sceneId: WORK }];
assert.deepEqual(importer.groupsToFolders(importer.foldersToGroups(adapters)), adapters);
const emptyParent = [{ id: 'root', name: 'Root', parentId: '', type: '', sceneId: DEFAULT }];
assert.deepEqual(importer.groupsToFolders(importer.foldersToGroups(emptyParent)), emptyParent);

// Full v2 backup preserves all scene graphs, archives and opaque local assets.
await scenario(initial(), async ({ state, api, writes, reads, reloads }) => {
  const before = clone(state), vault = clone(state['opentab.secretVault']);
  globalThis.OpenTabSync = { hydrateIcons() { throw new Error('export must never hydrate the vault'); } };
  const backup = await importer.buildBackupPayload(false);
  delete globalThis.OpenTabSync;
  assert.equal(backup.version, 2);
  assert.equal(backup.searchHistory, undefined);
  assert.equal(JSON.stringify(backup).includes(SECRET), false);
  assert.deepEqual(graph(backup), graph(importer.stripSecretsFromState(before)));
  assert.equal(backup.icons[0].uploadedIconDataUrl, png);
  assert.equal(backup.icons[0].unknown.__proto__.preserve, 'opaque');
  assert.equal(backup.sceneProfiles[1].background.value, png);
  assert.equal(backup.scenes.find(scene => scene.id === ARCHIVE).archivedAt, 123);
  assert.deepEqual(state, before);
  assert.equal(writes.length, 0);
  assert.equal(reads.some(keys => keys && keys.includes('opentab.secretVault')), false);
  const withHistory = await importer.buildBackupPayload(true);
  assert.deepEqual(withHistory.searchHistory, before.searchHistory);
  state.scenes[1].name = 'Later name'; state.icons.push({ id: 'later', name: 'Later', folderId: 'work-home' });
  let repairs = 0;
  globalThis.OpenTabFolders = { repairIconGraph() { repairs++; } };
  await importer.applyOpenTabBackup(JSON.parse(JSON.stringify(backup)), { snapshotReason: 'before-import' });
  assert.deepEqual(graph(state), graph(backup));
  assert.equal(repairs, 0, 'valid v2 restore must not run lossy legacy graph repair');
  assert.equal(state[EPOCH], 8);
  assert.equal(reloads(), 1);
  assert.deepEqual(state['opentab.secretVault'], vault, 'backup restoration leaves the existing vault untouched');
  assert.equal(state.backupSnapshots[0].completeness, 'full');
  assert.equal(state.backupSnapshots[0].data[KEY], 2);
  assert.equal(state.backupSnapshots[0].data.scenes[1].name, 'Later name');
  assert.equal(state.backupSnapshots[0].data.icons[0].uploadedIconDataUrl, png);
});

// Restore supports wrapped v2 and legacy v1, but never merges absent graph fields.
await scenario(initial(), async ({ state, writes }) => {
  const old = { version: 1, folders: [{ id: 'folder-home', name: 'Old Home' }, { id: 'old-group', name: 'Old group', parentId: 'folder-home', type: 'folder' }], icons: [{ id: 'old-icon', name: 'Old upload', folderId: 'old-group', uploadedIconDataUrl: png, sshPassword: SECRET }], background: { type: 'image', value: png }, layoutColumns: 8 };
  await importer.applyOpenTabBackup({ version: 1, data: old });
  assert.equal(state[EPOCH], 8);
  assert.equal(state[KEY], 2);
  assert.equal(state.scenes.length, 1);
  assert.equal(state.scenes[0].id, DEFAULT);
  assert.equal(state.scenes[0].homeGroupId, 'folder-home');
  assert.deepEqual(state.todos, [], 'absent old tasks do not keep current scene tasks');
  assert.deepEqual(state.icons.map(icon => icon.id), ['old-icon']);
  assert.deepEqual(state.folders.map(group => group.sceneId), [DEFAULT, DEFAULT]);
  assert.equal(state.sceneProfiles[0].layoutColumns, 8);
  assert.equal(state.sceneProfiles[0].background.value, png);
  assert.equal(state.icons[0].uploadedIconDataUrl, png);
  assert.equal(state.themeMode, 'dark', 'unmentioned global settings remain global');
  assert.equal(state.currentFolderId, 'folder-home', 'current group cannot retain a removed scene');
  assert.equal(writes.length, 1);
  const backup = await importer.buildBackupPayload(false);
  await importer.applyOpenTabBackup({ version: 2, data: backup });
  assert.deepEqual(graph(state), graph(backup));
  assert.equal(state[EPOCH], 9);
});
await scenario(initial(), async ({ state }) => {
  await importer.applyOpenTabBackup({ version: 1, background: { type: 'color', value: '#123456' } });
  assert.deepEqual(state.icons, []);
  assert.deepEqual(state.todos, []);
  assert.deepEqual(state.folders.map(group => group.id), ['folder-home']);
  assert.equal(state.sceneProfiles[0].background.value, '#123456');
});

// Unknown and malformed formats fail before normalization, IDs, graph repair or writes.
const invalidBackups = [
  {}, { unrecognized: true }, { version: 99, icons: [], folders: [] }, { version: '2', icons: [], folders: [] },
  { version: 2, icons: [], folders: [] }, { version: 1, ...initial() },
  { version: 2, ...initial(), [KEY]: 3 }, { ...initial(), [KEY]: '2' },
  { icons: [], folders: [], scenes: [] }, { icons: [], folders: [{ id: 'g', name: 'G', sceneId: WORK }] },
  { version: 1, data: { version: 99, icons: [], folders: [] } },
  { version: 2, ...initial(), sceneProfiles: [] },
  { version: 2, ...initial(), folders: [] }, null, [],
];
for (const payload of invalidBackups) await scenario(initial(), async ({ state, writes, reads, ids, prepared }) => {
  const before = clone(state);
  globalThis.OpenTabSearch = { normalizeBackup() { throw new Error('must not normalize unsupported data'); } };
  await assert.rejects(importer.applyOpenTabBackup(payload));
  assert.deepEqual(state, before);
  assert.equal(writes.length, 0); assert.equal(reads.length, 0); assert.equal(ids(), 0); assert.equal(prepared(), 0);
});
for (const invalidState of [{ ...initial(), [KEY]: 99 }, { ...initial(), sceneProfiles: [] }]) {
  await scenario(invalidState, async ({ state, writes, ids, prepared }) => {
    const before = clone(state);
    globalThis.OpenTabSearch = { normalizeBackup() { throw new Error('must not normalize unsupported current schema'); } };
    await assert.rejects(importer.buildBackupPayload(false));
    await assert.rejects(importer.applyOpenTabBackup({ version: 1, icons: [], folders: [] }));
    await assert.rejects(importer.commitImport(imported(), sceneOptions));
    await assert.rejects(importer.previewUrlList('example.com', 'work-home', sceneOptions));
    await assert.rejects(importer.undoLastImport());
    await assert.rejects(importer.saveSnapshotRecord('manual'));
    assert.deepEqual(state, before); assert.equal(writes.length, 0); assert.equal(ids(), 0); assert.equal(prepared(), 0);
  });
}
await scenario(initial(), async ({ state, writes, failWrites, reloads }) => {
  const before = clone(state);
  let suspended = 0, resumed = 0;
  globalThis.OpenTabBingCache = { suspendUpdates() { suspended++; return () => { resumed++; }; } };
  failWrites(true);
  await assert.rejects(importer.applyOpenTabBackup({ version: 1, icons: [], folders: [] }, { snapshotReason: 'before-import' }), /quota/);
  assert.deepEqual(state, before); assert.equal(writes.length, 0); assert.equal(reloads(), 0);
  assert.equal(suspended, 1); assert.equal(resumed, 1);
});

// Selected-scene additive imports preserve all other records and assets byte for byte.
await scenario(initial(), async ({ state, writes }) => {
  const before = clone(state);
  importer.setSceneContextProvider(() => ({ ...sceneOptions, currentFolderId: 'work-child' }));
  const context = await importer.readUrlListContext();
  assert.deepEqual(context.groups.map(group => group.id), ['work-home', 'work-child']);
  assert.equal(context.currentFolderId, 'work-child');
  const added = await importer.commitImport(imported());
  assert.equal(added.ok, true);
  assert.deepEqual(state.folders.slice(0, before.folders.length), before.folders);
  assert.deepEqual(state.icons.slice(0, before.icons.length), before.icons);
  const newGroup = state.folders.at(-1);
  assert.equal(newGroup.sceneId, WORK); assert.equal(newGroup.name, 'New group (2)');
  assert.equal(state.icons.at(-1).folderId, newGroup.id);
  for (const key of ['scenes', 'sceneProfiles', 'todos']) assert.deepEqual(state[key], before[key]);
  assert.equal(JSON.stringify(state[importer.UNDO_KEY]).includes(SECRET), false);
  assert.deepEqual(state[importer.UNDO_KEY].before.scenes, before.scenes);
  state.scenes[0].name = 'Independent renamed default';
  state.sceneProfiles[0].layoutIconSize = 80;
  state.todos.push({ id: 'later-task', text: 'Later task', sceneId: DEFAULT });
  state.icons.push({ id: 'later-icon', name: 'Later', folderId: 'folder-home' });
  await importer.undoLastImport();
  assert.equal(state.scenes[0].name, 'Independent renamed default');
  assert.equal(state.sceneProfiles[0].layoutIconSize, 80);
  assert.equal(state.todos.at(-1).id, 'later-task');
  assert.equal(state.icons.at(-1).id, 'later-icon');
  assert.equal(state.folders.some(group => group.id === newGroup.id), false);
  assert.deepEqual(state.icons.slice(0, before.icons.length), before.icons);
  assert.equal(writes.length, 2);
});
await scenario(initial(), async ({ state, writes }) => {
  await assert.rejects(importer.commitImport(imported()), error => error.code === 'SCENE_CONTEXT_REQUIRED');
  assert.equal(writes.length, 0, 'scene mode never falls back to a device-wide last scene');
  const context = await importer.readUrlListContext(sceneOptions);
  assert.equal(context.currentFolderId, 'work-home', 'another scene current group falls back to the actual selected home');
  assert.equal((await importer.previewUrlList('example.com', 'folder-home', sceneOptions)).ok, false);
  assert.equal(writes.length, 0);
  const preview = await importer.previewUrlList('example.com', context.currentFolderId, sceneOptions);
  assert.equal((await importer.commitUrlList(preview)).ok, true);
  assert.equal(state.icons.at(-1).folderId, 'work-home');
  assert.equal(state.folders.filter(group => group.id === 'folder-home').length, 1);
  assert.equal(state[importer.UNDO_KEY].before.scenes.length, 3);
  state.sceneProfiles[0].bingIndex = 19;
  await importer.undoLastImport();
  assert.equal(state.sceneProfiles[0].bingIndex, 19);
  assert.equal(state.icons.some(icon => icon.url === 'https://example.com/'), false);
});

// Preview is an exact scene/target/epoch receipt, checked against the locked latest state.
for (const change of [
  state => { state.scenes.find(scene => scene.id === WORK).archivedAt = 456; },
  state => { state.scenes.find(scene => scene.id === WORK).name = 'Changed scene'; },
  state => { state[EPOCH]++; },
  state => { state.folders.find(group => group.id === 'work-child').name = 'Renamed'; },
  state => { const group = state.folders.find(group => group.id === 'work-child'); group.sceneId = DEFAULT; group.parentId = 'folder-home'; },
  state => { state.folders.find(group => group.id === 'work-child').opaque = { replacement: true }; },
]) await scenario(initial(), async ({ state, writes, ids, onRead }) => {
  const preview = await importer.previewUrlList('example.com', 'work-child', sceneOptions);
  onRead(() => change(state));
  const result = await importer.commitUrlList(preview);
  assert.equal(result.ok, false);
  assert.equal(writes.length, 0); assert.equal(ids(), 0);
});
await scenario(initial(), async ({ writes }) => {
  let selection = { ...sceneOptions };
  importer.setSceneContextProvider(() => selection);
  const preview = await importer.previewUrlList('example.com', 'work-home');
  selection = { ...selection, generation: 2 };
  assert.equal((await importer.commitUrlList(preview)).ok, false);
  assert.equal(writes.length, 0);
});
await scenario(initial(), async ({ writes, onRead }) => {
  let selection = { ...sceneOptions };
  importer.setSceneContextProvider(() => selection);
  onRead(() => { selection = { sceneId: DEFAULT, generation: 2 }; });
  await assert.rejects(importer.commitImport(imported()), error => error.code === 'WORKSPACE_CONFLICT');
  assert.equal(writes.length, 0);
});

// Delayed top-site results retain the original scene and reject replacement/archives/switches.
for (const change of [
  state => { state.scenes.find(scene => scene.id === WORK).archivedAt = 456; },
  state => { state[EPOCH]++; },
]) await scenario(initial(), async ({ state, api, writes }) => {
  api.topSites.get = async () => { change(state); return [{ title: 'Top', url: 'https://top.example/' }]; };
  const result = await importer.importTopSites(sceneOptions);
  assert.equal(result.ok, false); assert.equal(writes.length, 0);
});
await scenario(initial(), async ({ api, writes }) => {
  let selection = { ...sceneOptions };
  importer.setSceneContextProvider(() => selection);
  api.topSites.get = async () => { selection = { sceneId: DEFAULT, generation: 2 }; return [{ title: 'Top', url: 'https://top.example/' }]; };
  assert.equal((await importer.importTopSites()).ok, false);
  assert.equal(writes.length, 0);
});
await scenario(initial(), async ({ state }) => {
  assert.equal((await importer.importTopSites(sceneOptions)).ok, true);
  assert.equal(state.folders.at(-1).sceneId, WORK);
});

// Undo refuses related later edits, archives, replacements and cross-scene moves.
for (const change of [
  state => { state.scenes.find(scene => scene.id === WORK).archivedAt = 456; },
  state => { state[EPOCH]++; },
  state => { state.icons.at(-1).name = 'Later edit'; },
  state => { const group = state.folders.find(group => group.id === 'work-child'); group.sceneId = DEFAULT; group.parentId = 'folder-home'; },
]) await scenario(initial(), async ({ state, writes }) => {
  const preview = await importer.previewUrlList('example.com', 'work-child', sceneOptions);
  await importer.commitUrlList(preview);
  change(state);
  const before = clone(state), count = writes.length;
  await assert.rejects(importer.undoLastImport(), error => error.code === 'WORKSPACE_CONFLICT');
  assert.deepEqual(state, before); assert.equal(writes.length, count);
});

// Unknown OpenTab versions are rejected by ordinary site-file parsing as well.
await scenario(initial(), async ({ ids, prepared }) => {
  assert.equal(importer.parseBackupFile({ version: 99, icons: [{ name: 'Bad', url: 'https://bad.example/' }], folders: [] }).ok, false);
  assert.equal(ids(), 0); assert.equal(prepared(), 0);
});

await scenario(initial(), async ({ state, writes }) => {
  const target = clone(state);
  await importer.applyOpenTabBackup({ exportedAt: '2026-01-01', data: { version: 2, ...target } });
  assert.deepEqual(graph(state), graph(importer.stripSecretsFromState(target)));
  assert.equal(writes.length, 1);
});
await scenario(initial(), async ({ state }) => {
  const icon = state.icons[0];
  Object.defineProperty(icon, '__proto__', { value: { preserve: 'icon-top', sshPassword: SECRET }, enumerable: true, writable: true, configurable: true });
  const compact = importer.prepareSnapshotRecord('manual', state);
  assert.equal(compact.record.completeness, 'compact');
  assert.equal(compact.record.data.icons[0].__proto__.preserve, 'icon-top');
  assert.equal(JSON.stringify(compact).includes(SECRET), false);
});
await scenario(initial(), async ({ state, writes }) => {
  await importer.commitImport(imported(), sceneOptions);
  const newGroup = state.folders.at(-1).id;
  state.icons.push({ id: 'later-related', folderId: newGroup, name: 'Independent addition to imported group' });
  const before = clone(state);
  await assert.rejects(importer.undoLastImport(), error => error.code === 'WORKSPACE_CONFLICT');
  assert.deepEqual(state, before);
  assert.equal(writes.length, 1);
});

await scenario({}, async ({ state }) => {
  const record = await importer.saveSnapshotRecord('manual');
  assert.deepEqual(record.data, {});
  assert.equal(record.completeness, 'compact');
  await importer.applyOpenTabBackup({ version: 1, data: record.data });
  assert.equal(state[EPOCH], 1);
});

// A full sync recovery point is opt-in; its newest data is never trimmed to fit.
await scenario(initial(), async ({ state, writes, ids }) => {
  state.icons[0].uploadedIconDataUrl = png + 'x'.repeat(importer.BACKUP_SNAPSHOT_MAX_BYTES + 1);
  const before = clone(state);
  const full = importer.prepareSnapshotRecord('before-scene-sync', state, { completeness: 'full' });
  assert.equal(full.record.completeness, 'full');
  assert.deepEqual(graph(full.record.data), graph(importer.stripSecretsFromState(state)));
  assert.equal(full.record.data.icons[0].uploadedIconDataUrl, state.icons[0].uploadedIconDataUrl);
  assert.equal(full.records.length, 1, 'one oversized newest full recovery record is retained, never silently trimmed');
  assert.equal(JSON.stringify(full).includes(SECRET), false);
  assert.deepEqual(state, before); assert.equal(writes.length, 0);
  const count = ids();
  assert.throws(() => importer.prepareSnapshotRecord('manual', state, { completeness: 'unknown' }), error => error.code === 'INVALID_SNAPSHOT_MODE');
  assert.equal(ids(), count);
});

// Read the written full recovery point back through storage, then restore it.
await scenario(initial(), async ({ state, api, failWrites, writes }) => {
  state.backupSnapshots = Array.from({ length: 21 }, (_, i) => ({ id: `prior-${i}`, completeness: 'compact', data: { icons: [] }, reason: 'prior' }));
  const original = clone(state), expectedGraph = graph(importer.stripSecretsFromState(original));
  const ws = workspace.forChrome(api);
  const replace = () => ws.replace(current => {
    const prepared = importer.prepareSnapshotRecord('before-scene-sync', current, { completeness: 'full' });
    const replacement = schema.migrateLegacy({ icons: [], folders: [], todos: [] });
    return { ...graph(replacement), backupSnapshots: prepared.records };
  });
  failWrites(true);
  await assert.rejects(replace(), /quota/);
  assert.deepEqual(state, original); assert.equal(writes.length, 0);
  failWrites(false);
  await replace();
  const persisted = await api.storage.local.get(['backupSnapshots']);
  assert.equal(persisted.backupSnapshots[0].completeness, 'full');
  assert.deepEqual(persisted.backupSnapshots.slice(1), original.backupSnapshots, 'full recovery keeps all existing snapshots, even beyond compact count limits');
  assert.deepEqual(graph(persisted.backupSnapshots[0].data), expectedGraph);
  assert.equal(state.icons.length, 0);
  await importer.applyOpenTabBackup(persisted.backupSnapshots[0].data);
  assert.deepEqual(graph(state), expectedGraph);
  assert.equal(state.icons[0].uploadedIconDataUrl, png);
  assert.equal(state.icons[1].uploadedIconDataUrl, png, 'archived local assets recover too');
  assert.equal(state[EPOCH], original[EPOCH] + 2);
});

// Successful paste uses its locked target, not a later shared navigation alias.
await scenario(initial(), async ({ state, navigations, onWrite }) => {
  let selection = { sceneId: WORK, currentFolderId: 'work-home', generation: 7 };
  importer.setSceneContextProvider(() => selection);
  const preview = await importer.previewUrlList('local-target.example', 'work-child');
  onWrite(() => { state.currentFolderId = 'default-child'; });
  const result = await importer.commitUrlList(preview);
  assert.deepEqual(result.navigation, { sceneId: WORK, currentFolderId: 'work-child', generation: 7 });
  assert.deepEqual(navigations, [result.navigation]);
  assert.equal(state.currentFolderId, 'default-child');
  assert.equal(state[importer.UNDO_KEY].navigation.before.currentFolderId, 'work-home', 'receipt saves tab-local previous group, not default-child alias');
  selection = { sceneId: WORK, currentFolderId: 'work-child', generation: 8 };
  const undone = await importer.undoLastImport();
  assert.deepEqual(undone.navigation, { sceneId: WORK, currentFolderId: 'work-home', generation: 8 });
  assert.deepEqual(navigations.at(-1), undone.navigation);
  assert.equal(state.currentFolderId, 'default-child', 'another tab alias stays untouched while this tab returns locally');
  assert.equal(state.icons.some(icon => icon.url === 'https://local-target.example/'), false);
});

// This tab's newer navigation wins even when the shared alias still says target.
for (const nextSelection of [
  { sceneId: WORK, currentFolderId: 'work-home', generation: 3 },
  { sceneId: DEFAULT, currentFolderId: 'folder-home', generation: 3 },
]) await scenario(initial(), async ({ state, navigations }) => {
  let selection = { sceneId: WORK, currentFolderId: 'work-home', generation: 2 };
  importer.setSceneContextProvider(() => selection);
  await importer.commitUrlList(await importer.previewUrlList('navigate-away.example', 'work-child'));
  assert.equal(state.currentFolderId, 'work-child');
  selection = nextSelection;
  const undone = await importer.undoLastImport();
  assert.equal(undone.navigation, undefined);
  assert.equal(navigations.at(-1), undefined, 'ordinary reload retains this tab current selection');
  assert.equal(state.currentFolderId, 'default-child', 'unchanged shared compatibility alias may still be inverted');
});
await scenario(initial(), async ({ navigations, onRead }) => {
  let selection = { sceneId: WORK, currentFolderId: 'work-home', generation: 3 };
  importer.setSceneContextProvider(() => selection);
  await importer.commitUrlList(await importer.previewUrlList('queued-undo.example', 'work-child'));
  selection = { sceneId: WORK, currentFolderId: 'work-child', generation: 4 };
  onRead(() => { selection = { ...selection, generation: 5 }; });
  const undone = await importer.undoLastImport();
  assert.equal(undone.navigation, undefined, 'view generation changed while undo waited for the lock');
  assert.equal(navigations.at(-1), undefined);
});
await scenario(initial(), async ({ state, navigations }) => {
  let selection = { sceneId: WORK, currentFolderId: 'work-child', generation: 9 };
  importer.setSceneContextProvider(() => selection);
  await importer.commitUrlList(await importer.previewUrlList('previous-removed.example', 'work-home'));
  state.folders = state.folders.filter(group => group.id !== 'work-child');
  selection = { sceneId: WORK, currentFolderId: 'work-home', generation: 10 };
  const undone = await importer.undoLastImport();
  assert.deepEqual(undone.navigation, { sceneId: WORK, currentFolderId: 'work-home', generation: 10 }, 'removed local previous group falls back only to this scene Home');
  assert.deepEqual(navigations.at(-1), undone.navigation);
});
await scenario(initial(), async ({ navigations, failWrites }) => {
  importer.setSceneContextProvider(() => ({ sceneId: WORK, currentFolderId: 'work-home', generation: 11 }));
  const preview = await importer.previewUrlList('quota-navigation.example', 'work-child');
  failWrites(true);
  await assert.rejects(importer.commitUrlList(preview), /quota/);
  assert.deepEqual(navigations, [], 'failed paste must not navigate');
});
await scenario(initial(), async ({ navigations }) => {
  importer.setSceneContextProvider(() => ({ sceneId: WORK, currentFolderId: 'work-child', generation: 12 }));
  await importer.commitImport(imported());
  assert.deepEqual(navigations, [undefined], 'ordinary group/file imports retain current tab selection');
  await importer.applyOpenTabBackup({ version: 1, icons: [], folders: [] });
  assert.deepEqual(navigations.at(-1), { resetSceneSelection: true }, 'explicit full restore resets tab selection instead of reusing stale IDs');
});

// Every destructive restore from v2 keeps a full recovery point and older backups.
await scenario(initial(), async ({ state, failWrites, navigations }) => {
  state.backupSnapshots = [{ id: 'older-full', completeness: 'full', data: { ...graph(state), icons: clone(state.icons) } }];
  const before = clone(state);
  const backup = { version: 1, icons: [], folders: [] };
  failWrites(true);
  await assert.rejects(importer.applyOpenTabBackup(backup, { snapshotReason: 'before-import' }), /quota/);
  assert.deepEqual(state, before); assert.deepEqual(navigations, []);
  failWrites(false);
  await importer.applyOpenTabBackup(backup, { snapshotReason: 'before-import' });
  assert.equal(state.backupSnapshots[0].completeness, 'full');
  assert.deepEqual(state.backupSnapshots.slice(1), before.backupSnapshots);
  assert.equal(state.backupSnapshots[0].data.icons[0].uploadedIconDataUrl, png);
  assert.equal(state.backupSnapshots[0].data.icons[1].uploadedIconDataUrl, png);
  const recovery = clone(state.backupSnapshots[0].data);
  await importer.applyOpenTabBackup(recovery);
  assert.equal(state.backupSnapshots[0].reason, 'before-restore');
  assert.equal(state.backupSnapshots[0].completeness, 'full', 'direct restore without options also protects the graph being replaced');
  assert.deepEqual(graph(state), graph(importer.stripSecretsFromState(before)));
});
await scenario({ icons: [], folders: [] }, async ({ state, navigations }) => {
  await importer.applyOpenTabBackup({ version: 1, icons: [], folders: [] }, { snapshotReason: 'before-import' });
  assert.equal(state.backupSnapshots[0].completeness, 'compact', 'legacy snapshot behavior is unchanged');
  assert.deepEqual(navigations, [{ resetSceneSelection: true }]);
});

console.log('Scene backup, restore, scoped import, delayed target and undo tests passed.');
