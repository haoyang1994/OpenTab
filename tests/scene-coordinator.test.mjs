import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Workspace = require('../workspace-persistence.js');
const copy = value => structuredClone(value);
const seed = () => Schema.create(Schema.migrateLegacy({
  icons: [{ id: 'x', name: 'Site', folderId: 'folder-home' }], todos: [{ id: 't', text: 'Task', done: false }],
  folders: [{ id: 'folder-home', name: 'Home' }], currentFolderId: 'folder-home', background: { type: 'gradient', value: 'legacy-background' }, bingIndex: 4
}), { id: 'other', name: 'Other', iconKey: 'book', homeGroupId: 'other-home', homeName: 'Home' });
function harness(initial = seed()) {
  const store = copy(initial), writes = [];
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) { return copy(keys === null ? store : Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
    async set(patch) { writes.push(copy(patch)); Object.assign(store, copy(patch)); }
  } } };
  return { store, writes, chrome, api: Workspace.forChrome(chrome) };
}
for (const operation of [
  api => api.transaction(({ write }) => write({ clockFormat: '24h' })),
  api => api.replace({ icons: [] }),
  api => api.commit({}, { themeMode: 'light' })
]) {
  const h = harness({ [Schema.SCHEMA_KEY]: 99, icons: [{ id: 'keep' }] }), before = copy(h.store);
  await assert.rejects(operation(h.api)); assert.deepEqual(h.store, before); assert.equal(h.writes.length, 0);
}
{
  const h = harness(), before = copy(h.store);
  await assert.rejects(h.api.transaction(async ({ read, write }) => {
    const { folders } = await read(['folders']);
    await write({ folders: folders.map(({ sceneId, ...rest }) => rest) });
  }));
  assert.deepEqual(h.store, before); assert.equal(h.writes.length, 0, 'legacy direct writer cannot erase affiliations');
  await assert.rejects(h.api.replace({ [Schema.SCHEMA_KEY]: 1 }));
  assert.equal(h.writes.length, 0);
}
{
  const h = harness(), base = copy(h.store), a = copy(base), b = copy(base);
  a.sceneProfiles[0].layoutColumns = 6;
  b.sceneProfiles[1].background = { type: 'gradient', value: 'other-view' };
  await Promise.all([h.api.commit(base, a), h.api.commit(base, b)]);
  assert.equal(h.store.sceneProfiles[0].layoutColumns, 6);
  assert.equal(h.store.sceneProfiles[1].background.value, 'other-view');
  assert.deepEqual(h.store.icons, base.icons); assert.deepEqual(h.store.todos, base.todos);
}
{
  const h = harness(), state = copy(h.store);
  state.currentFolderId = 'other-home'; state.background = { type: 'gradient', value: 'visible-other' }; state.bingIndex = 7;
  let view = { sceneId: 'other', generation: 1 };
  const bridge = h.api.connect({ state, getViewIdentity: () => view });
  bridge.seed(h.store);
  const intent = bridge.captureIntent({ todos: ['t'], folders: ['folder-home'] });
  state.clockFormat = '24h'; assert.equal(await bridge.save(), true); assert.equal(await bridge.whenIdle(), true);
  assert.equal(h.store.currentFolderId, 'folder-home'); assert.equal(h.store.background.value, 'legacy-background'); assert.equal(h.store.bingIndex, 4);
  assert.equal(state.currentFolderId, 'other-home'); assert.equal(state.background.value, 'visible-other');
  assert.equal(bridge.isIntentCurrent(intent), true);
  view = { sceneId: 'scene-default', generation: 2 };
  assert.equal(bridge.isIntentCurrent(intent), false, 'scene switch invalidates old draft without replacing data');
  const next = bridge.captureIntent({ todos: ['t'] });
  state.todos[0].sceneId = 'other'; assert.equal(bridge.isIntentCurrent(next), false, 'todo ownership belongs in intent identity');
}
{
  const state = seed();
  state.folders.push({ id: 'child', name: 'Child', parentId: 'folder-home', type: 'group', sceneId: Schema.DEFAULT_SCENE_ID });
  assert.deepEqual(Workspace.migrationOverrides(copy(state), copy(state)), {}, 'normalized v2 folders retain all ownership/parent metadata');
  const base = copy(state), next = copy(base); next.folders.find(x => x.id === 'child').sceneId = 'other';
  assert.throws(() => Workspace.merge(base, next, base), /same scene/);
}
{
  for (const key of ['folders', 'todos', 'icons']) {
    const h = harness({ folders: [{ id: 'folder-home', name: 'Home' }], icons: [], todos: [] });
    h.store[key] = [{ id: 'partial', sceneId: 'scene-default' }];
    const before = copy(h.store);
    await assert.rejects(h.api.transaction(({ write }) => write({ [key]: [] })));
    assert.deepEqual(h.store, before); assert.equal(h.writes.length, 0);
  }
}
{
  const h = harness(), state = copy(h.store);
  const bridge = h.api.connect({ state }); bridge.seed(h.store);
  const get = h.chrome.storage.local.get;
  let failed = false, held = false, release;
  const recovery = new Promise(resolve => { release = resolve; });
  h.chrome.storage.local.get = async keys => {
    const value = await get(keys);
    if (failed && !held) { held = true; await recovery; }
    return value;
  };
  h.chrome.storage.local.set = async () => { failed = true; throw new Error('synthetic write failure'); };
  state.clockFormat = '24h'; const first = bridge.save();
  state.showSeconds = true; const second = bridge.save();
  assert.equal(await second, false);
  assert.equal(held, true);
  let idleSettled = false;
  const idle = bridge.whenIdle().then(result => { idleSettled = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(idleSettled, false, 'later failed save cannot hide earlier pending recovery');
  release(); assert.equal(await first, false); assert.equal(await idle, false);
  assert.equal(await bridge.whenIdle(), true, 'a completed recovery does not permanently block future scene navigation');
  assert.deepEqual(state.icons, h.store.icons);
}
console.log('scene coordinator: all writer guards, disjoint scenes, tab-local views and intent boundaries passed');
