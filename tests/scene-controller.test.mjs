import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Controller = require('../scene-controller.js');
const Schema = require('../scene-schema.js');
const Workspace = require('../workspace-persistence.js');
const Commands = require('../scene-workspace.js');
const { stripSecretsFromState } = require('../import.js');
const copy = structuredClone;
const seed = () => Schema.create(Schema.migrateLegacy({
  folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }, { id: 'child', name: 'Child', parentId: 'work' }],
  icons: [{ id: 'x', name: 'X', folderId: 'work', uploadedIconDataUrl: 'data:image/png,local' }],
  todos: [{ id: 't', text: 'Task', done: false }], currentFolderId: 'work',
  background: { type: 'gradient', value: 'old' }, themeMode: 'dark', browserSyncEnabled: false
}), { id: 'study', name: 'Study', iconKey: 'book', homeGroupId: 'study-home', homeName: 'Study home' });
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) }; };
function harness(initial = seed()) {
  const store = copy(initial), writes = [], preferences = memory(); let failed = false, writeHook;
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) { return copy(keys === null ? store : Object.fromEntries(keys.filter(key => Object.hasOwn(store, key)).map(key => [key, store[key]]))); },
    async set(patch) { if (failed) { failed = false; throw new Error('synthetic quota'); } if (writeHook) { const hook = writeHook; writeHook = null; await hook(patch); } writes.push(copy(patch)); Object.assign(store, copy(patch)); }
  } } };
  const coordinator = Workspace.forChrome(chrome);
  function tab(session = memory()) {
    const state = copy(store), undo = []; let controller, dirty = false, id = 0, invalidations = 0, loadHook; const renderErrors = [], busyEvents = []; let deferredViews = 0, draftCheck = () => !dirty, appearanceDrain = () => true;
    const bridge = coordinator.connect({ state, getViewIdentity: () => controller?.getView(),
      onChange() { Object.assign(state, controller.project(state)); }, onError() {} });
    const commands = Commands.create({ workspace: coordinator, schema: Schema, stripSecrets: stripSecretsFromState });
    controller = Controller.create({ state, coordinator, bridge, commands, schema: Schema, session, preferences,
      uuid: () => `synthetic-${++id}`, now: () => 200, beforeSwitch: () => draftCheck(), whenAppearanceIdle: () => appearanceDrain(), onBusy: value => busyEvents.push(value), onViewDeferred: () => deferredViews++, onInvalidate: () => invalidations++,
      async onLoad(projected, raw) { Object.assign(state, projected); bridge.seed(raw); if (loadHook) await loadHook(); }, onRenderError: error => renderErrors.push(error), onUndo: fn => undo.push(fn) });
    Object.assign(state, controller.project(store)); bridge.seed(store);
    return { controller, state, bridge, session, undo, renderErrors, busyEvents, get deferredViews() { return deferredViews; }, setDraftCheck(fn) { draftCheck = fn; }, setAppearanceDrain(fn) { appearanceDrain = fn; }, setLoadHook(fn) { loadHook = fn; }, setDirty(value) { dirty = value; }, get invalidations() { return invalidations; } };
  }
  return { store, writes, coordinator, preferences, tab, holdNextWrite(fn) { writeHook = fn; }, failNext() { failed = true; } };
}
const context = tab => ({ view: tab.controller.getView() });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const until = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 0)); assert.ok(predicate()); };
{
  const h = harness(), a = h.tab(), b = h.tab(), before = copy(h.store);
  assert.equal(a.controller.getView().currentFolderId, 'work');
  assert.equal(await a.controller.selectScene('study', context(a)), true);
  assert.equal(a.controller.getView().sceneId, 'study'); assert.equal(b.controller.getView().sceneId, Schema.DEFAULT_SCENE_ID);
  await b.controller.refresh(); assert.equal(b.controller.getView().sceneId, Schema.DEFAULT_SCENE_ID);
  assert.equal(b.controller.getView().currentFolderId, 'work', 'passive alias changes do not move another tab');
  assert.equal(h.tab(a.session).controller.getView().sceneId, 'study');
  assert.equal(h.tab().controller.getView().sceneId, 'study', 'new tabs use device default');
  for (const key of ['icons', 'folders', 'todos', 'scenes', 'sceneProfiles']) assert.deepEqual(h.store[key], before[key]);
  assert.equal(a.state.icons.length, before.icons.length, 'projection never filters the canonical entity arrays');
  assert.equal(a.state.background.source, 'preset'); assert.equal(b.state.background.value, 'old');
  assert.equal(a.state.themeMode, 'dark'); assert.equal(h.store.browserSyncEnabled, false);
}
{
  const h = harness(), a = h.tab();
  await a.controller.selectScene('study'); await a.controller.selectScene(Schema.DEFAULT_SCENE_ID);
  assert.equal(a.controller.getView().currentFolderId, 'work');
  await a.controller.selectGroup('folder-home'); await a.controller.selectScene('study'); await a.controller.selectScene(Schema.DEFAULT_SCENE_ID);
  assert.equal(a.controller.getView().currentFolderId, 'folder-home');
  assert.equal(h.tab(a.session).controller.getView().currentFolderId, 'folder-home');
}
{
  const h = harness(), a = h.tab(), before = copy(h.store), view = a.controller.getView();
  a.setDirty(true); await rejects(a.controller.selectScene('study'), 'SCENE_DIRTY_DRAFT');
  assert.deepEqual(a.busyEvents, [], 'existing drafts are checked before a focus-changing interaction lock');
  assert.equal(a.controller.isBusy(), false);
  assert.deepEqual(h.store, before); assert.deepEqual(a.controller.getView(), view); assert.equal(a.invalidations, 0);
  a.setDirty(false); h.failNext(); await assert.rejects(a.controller.selectScene('study'), /quota/);
  assert.deepEqual(h.store, before); assert.deepEqual(a.controller.getView(), view);
}
{
  const h = harness(), a = h.tab(); let release, held = false;
  const lock = h.coordinator.transaction(async () => { held = true; await new Promise(resolve => { release = resolve; }); });
  await until(() => held);
  const pending = a.controller.selectScene('study', context(a)); let settled = false; pending.then(() => { settled = true; });
  await rejects(a.controller.selectScene('study'), 'SCENE_BUSY');
  assert.equal(settled, false); assert.equal(a.controller.getView().sceneId, Schema.DEFAULT_SCENE_ID);
  release(); await lock; assert.equal(await pending, true); assert.equal(a.controller.getView().sceneId, 'study');
}
{
  const h = harness(), a = h.tab(); let release, held = false;
  const lock = h.coordinator.transaction(async ({ read, write }) => {
    const raw = await read(null); held = true; await new Promise(resolve => { release = resolve; });
    await write({ scenes: raw.scenes.map(item => item.id === 'study' ? { ...item, name: 'Remote renamed' } : item) });
  });
  await until(() => held); const pending = a.controller.selectScene('study'); release(); await lock;
  await rejects(pending, 'SCENE_CONFLICT'); assert.equal(a.controller.getView().sceneId, Schema.DEFAULT_SCENE_ID);
  assert.equal(h.store.lastOpenedSceneId, undefined);
}
{
  const h = harness(), a = h.tab(), before = copy(h.store);
  assert.equal(await a.controller.createScene({ name: 'Travel', iconKey: 'plane' }, context(a)), true);
  const created = a.controller.getView().sceneId;
  assert.notEqual(created, 'study'); assert.equal(a.state.scenes.find(item => item.id === created).name, 'Travel');
  assert.equal(a.undo.length, 0, 'creation is not disguised as destructive whole-snapshot undo');
  assert.deepEqual(h.store.icons, before.icons); assert.deepEqual(h.store.todos, before.todos);
  await a.controller.renameScene({ sceneId: created, name: 'Trip' }, context(a));
  assert.equal(a.undo.length, 1); await a.undo.pop()(); assert.equal(a.state.scenes.find(item => item.id === created).name, 'Travel');
  await a.controller.archiveScene({ sceneId: created }, context(a));
  assert.notEqual(a.controller.getView().sceneId, created); assert.equal(h.store.scenes.find(item => item.id === created).archivedAt, 200);
  await a.undo.pop()(); assert.equal(h.store.scenes.find(item => item.id === created).archivedAt, null);
}
{
  const h = harness(), a = h.tab(), beforeIcons = copy(h.store.icons);
  await a.controller.moveGroup({ groupId: 'work', targetSceneId: 'study' }, context(a));
  assert.equal(h.store.folders.find(item => item.id === 'work').sceneId, 'study');
  assert.equal(a.controller.getView().currentFolderId, 'folder-home'); assert.deepEqual(h.store.icons, beforeIcons);
  h.store.todos.push({ id: 'new', text: 'Keep newer work', done: false, sceneId: 'study' });
  await a.undo.pop()(); assert.equal(h.store.folders.find(item => item.id === 'work').sceneId, Schema.DEFAULT_SCENE_ID);
  assert.equal(h.store.todos.at(-1).id, 'new');
}
{
  const h = harness(), a = h.tab(), b = h.tab();
  await b.controller.selectScene('study');
  a.state.background = { type: 'gradient', value: 'A' };
  b.state.background = { type: 'gradient', value: 'B' };
  assert.deepEqual(await Promise.all([a.controller.save(), b.controller.save()]), [true, true]);
  assert.equal(h.store.sceneProfiles.find(item => item.id === Schema.DEFAULT_SCENE_ID).background.value, 'A');
  assert.equal(h.store.sceneProfiles.find(item => item.id === 'study').background.value, 'B');
  assert.equal(h.store.background.value, 'old', 'legacy global background is never a scene save target');
  assert.equal(a.state.background.value, 'A'); assert.equal(b.state.background.value, 'B');
}
{
  const h = harness(), a = h.tab(); h.failNext(); a.state.icons[0].name = 'Unsaved';
  assert.equal(await a.controller.save(), false);
  await rejects(a.controller.selectScene('study'), 'SCENE_PENDING_SAVE_FAILED');
  assert.equal(h.store.icons[0].name, 'X'); assert.equal(a.state.icons[0].name, 'X');
  assert.equal(await a.controller.selectScene('study'), true);
}
{
  const h = harness(), a = h.tab(), stale = context(a);
  await a.controller.selectScene('study');
  await rejects(a.controller.renameScene({ sceneId: 'study', name: 'Bad' }, stale), 'SCENE_CONFLICT');
  assert.equal(h.store.scenes.find(item => item.id === 'study').name, 'Study');
  await a.controller.archiveScene({ sceneId: Schema.DEFAULT_SCENE_ID }, context(a));
  await assert.rejects(a.controller.archiveScene({ sceneId: 'study' }, context(a)), error => error.code === 'LAST_ACTIVE_SCENE');
}
{
  const h = harness(), a = h.tab(); const intent = a.bridge.captureIntent({ icons: ['x'] });
  await a.controller.selectScene('study'); assert.equal(a.bridge.isIntentCurrent(intent), false);
  const before = copy(h.store); h.store[Schema.SCHEMA_KEY] = 99;
  await assert.rejects(a.controller.refresh()); assert.equal(h.writes.length, 1); h.store[Schema.SCHEMA_KEY] = 2;
  assert.deepEqual(h.store, before);
}
{
  const h = harness(), a = h.tab(); let held = false, release;
  const lock = h.coordinator.transaction(async ({ read, write }) => {
    const latest = await read(null); held = true; await new Promise(resolve => { release = resolve; });
    await write({ [h.coordinator.EPOCH_KEY]: (latest[h.coordinator.EPOCH_KEY] || 0) + 1 });
  });
  await until(() => held); const pending = a.controller.selectScene('study', context(a)); release(); await lock;
  await rejects(pending, 'SCENE_CONFLICT'); assert.equal(a.controller.getView().sceneId, Schema.DEFAULT_SCENE_ID);
  assert.equal(h.store.lastOpenedSceneId, undefined);
}
{
  const h = harness(), a = h.tab(), obsolete = copy(h.store);
  a.state.icons[0].name = 'Successfully saved'; const save = a.controller.save();
  await a.controller.refresh(obsolete); assert.equal(await save, true);
  assert.equal(a.state.icons[0].name, 'Successfully saved'); assert.equal(h.store.icons[0].name, 'Successfully saved');
}
{
  const h = harness(), a = h.tab(); await a.controller.selectGroup('child'); a.setDirty(true);
  const before = copy(h.store), oldView = a.controller.getView();
  await rejects(a.controller.moveGroup({ groupId: 'work', targetSceneId: 'study' }, context(a)), 'SCENE_DIRTY_DRAFT');
  assert.deepEqual(h.store, before); assert.deepEqual(a.controller.getView(), oldView);
}
{
  const h = harness(), a = h.tab(); let held = false, release;
  a.setLoadHook(async () => { if (held) return; held = true; await new Promise(resolve => { release = resolve; }); });
  const first = a.controller.refresh(); await until(() => held);
  await h.coordinator.transaction(async ({ read, write }) => { const raw = await read(null); raw.icons[0].name = 'During refresh'; await write({ icons: raw.icons }); });
  const trailing = a.controller.refresh(); release(); await Promise.all([first, trailing]);
  assert.equal(a.state.icons[0].name, 'During refresh', 'events during refresh schedule a fresh trailing read');
}
{
  const h = harness(), a = h.tab(); a.setLoadHook(() => { throw new Error('synthetic renderer failure'); });
  assert.equal(await a.controller.createScene({ name: 'Saved once', iconKey: 'book' }), true);
  assert.equal(h.store.scenes.filter(item => item.name === 'Saved once').length, 1);
  assert.equal(a.state.scenes.filter(item => item.name === 'Saved once').length, 1);
  assert.equal(a.renderErrors.length, 1, 'render failure reports reload need, not a failed durable submit');
}
{
  const h = harness(), a = h.tab(); const expected = a.controller.getView(), before = copy(h.store);
  assert.equal(a.controller.commitLocalView('study-home', expected), false, 'another scene group cannot become this tab view');
  assert.equal(a.controller.commitLocalView('folder-home', expected), true);
  assert.equal(a.controller.getView().currentFolderId, 'folder-home'); assert.equal(a.state.currentFolderId, 'folder-home');
  assert.deepEqual(h.store, before, 'recording a durable local navigation never writes shared aliases');
  assert.equal(a.controller.commitLocalView('work', expected), false, 'old caller cannot overwrite newer view');
  assert.equal(h.tab(a.session).controller.getView().currentFolderId, 'folder-home');
}
// A draft opened after dispatch but before acquiring the lock blocks every
// view-sensitive write, including a retryable inverse receipt.
for (const kind of ['select', 'create', 'archive', 'move', 'undo']) {
  const h = harness(), a = h.tab(); let undo;
  if (kind === 'undo') { await a.controller.renameScene({ sceneId: 'study', name: 'Changed' }); undo = a.undo.pop(); }
  const before = copy(h.store), previousView = a.controller.getView(); let held = false, release;
  const lock = h.coordinator.transaction(async () => { held = true; await new Promise(resolve => { release = resolve; }); });
  await until(() => held);
  const pending = kind === 'select' ? a.controller.selectScene('study')
    : kind === 'create' ? a.controller.createScene({ name: 'Late draft' })
      : kind === 'archive' ? a.controller.archiveScene({ sceneId: Schema.DEFAULT_SCENE_ID })
        : kind === 'move' ? a.controller.moveGroup({ groupId: 'work', targetSceneId: 'study' }) : undo();
  const rejected = rejects(pending, 'SCENE_DIRTY_DRAFT');
  await until(() => a.controller.isBusy()); await new Promise(setImmediate);
  a.setDirty(true); release(); await lock; await rejected;
  assert.deepEqual(h.store, before, kind + ': no late dirty write');
  assert.deepEqual(a.controller.getView(), previousView);
  assert.deepEqual(a.busyEvents.slice(-2), [true, false]);
  if (undo) { a.setDirty(false); assert.equal(await undo(), true, 'prewrite refusal leaves the receipt usable'); }
}
// A new draft can still appear while storage itself is awaiting completion.
// Never replace it or report a committed entity command as a failed submit.
for (const kind of ['select', 'create', 'archive', 'move', 'undo']) {
  const h = harness(), a = h.tab(); let undo;
  if (kind === 'undo') { await a.controller.renameScene({ sceneId: 'study', name: 'Changed' }); undo = a.undo.pop(); }
  const beforeState = copy(a.state), previousView = a.controller.getView(); let held = false, release;
  h.holdNextWrite(async () => { held = true; await new Promise(resolve => { release = resolve; }); });
  const pending = kind === 'select' ? a.controller.selectScene('study')
    : kind === 'create' ? a.controller.createScene({ name: 'Exactly once' })
      : kind === 'archive' ? a.controller.archiveScene({ sceneId: Schema.DEFAULT_SCENE_ID })
        : kind === 'move' ? a.controller.moveGroup({ groupId: 'work', targetSceneId: 'study' }) : undo();
  await until(() => held); a.setDirty(true); release();
  assert.equal(await pending, kind !== 'select');
  assert.deepEqual(a.state, beforeState, kind + ': draft-bound displayed state remains intact');
  assert.deepEqual(a.controller.getView(), previousView);
  assert.equal(a.deferredViews, 1); assert.deepEqual(a.busyEvents.slice(-2), [true, false]);
  if (kind === 'select') assert.equal(h.store.lastOpenedSceneId, 'study');
  if (kind === 'create') assert.equal(h.store.scenes.filter(scene => scene.name === 'Exactly once').length, 1);
  if (kind === 'archive') assert.equal(h.store.scenes[0].archivedAt, 200);
  if (kind === 'move') assert.equal(h.store.folders.find(group => group.id === 'work').sceneId, 'study');
  a.setDirty(false);
  if (undo) await rejects(undo(), 'SCENE_CONFLICT'); // Already committed; no replay.
  if (kind === 'select') assert.equal(await a.controller.selectScene('study'), true);
  else assert.equal(await a.controller.refresh(), true);
  assert.deepEqual(a.state.scenes, h.store.scenes, 'later refresh reads current durable data, not a deferred snapshot');
}
// Replacement epochs invalidate the draft even if scene/group IDs are unchanged.
{
  const h = harness(), a = h.tab(), before = copy(a.state); a.setDirty(true);
  h.store[h.coordinator.EPOCH_KEY] = 1;
  await rejects(a.controller.refresh(), 'SCENE_DIRTY_DRAFT'); assert.deepEqual(a.state, before);
}
// Promise/truthy draft predicates fail closed; neither drain may short-circuit.
{
  const h = harness(), a = h.tab(); a.setDraftCheck(() => Promise.reject(new Error('unsupported async draft guard')));
  await rejects(a.controller.selectScene('study'), 'SCENE_DIRTY_DRAFT'); assert.equal(h.writes.length, 0);
  a.setDraftCheck(() => true); h.failNext(); a.state.icons[0].name = 'Unsaved'; await a.controller.save();
  let drains = 0; a.setAppearanceDrain(() => ++drains === 1 ? false : true);
  await rejects(a.controller.selectScene('study'), 'SCENE_PENDING_SAVE_FAILED'); assert.equal(drains, 1);
  assert.equal(await a.controller.selectScene('study'), true); assert.equal(drains, 2);
}
{
  const h = harness(), a = h.tab();
  h.holdNextWrite(() => { a.setDraftCheck(() => { throw new Error('draft UI was removed during the write'); }); });
  assert.equal(await a.controller.createScene({ name: 'Durable despite UI exception' }), true);
  assert.equal(h.store.scenes.filter(scene => scene.name === 'Durable despite UI exception').length, 1);
  assert.equal(a.controller.getView().sceneId, Schema.DEFAULT_SCENE_ID); assert.equal(a.deferredViews, 1);
}
console.log('Scene controller tests passed: isolated session views, scoped appearance, durable actions, draft/lock/conflict/failure safety and inverse undo.');
