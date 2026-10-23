import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Workspace = require('../workspace-persistence.js');
const Schema = require('../scene-schema.js');
const Controller = require('../scene-controller.js');
const code = fs.readFileSync(new URL('../folders.js', import.meta.url), 'utf8');
const clone = value => structuredClone(value);
const site = (id, extra = {}) => ({ id, name: id, type: 'shortcut', url: `https://${id}.example/path?q=1`, uploadedIconDataUrl: 'data:image/png;base64,abc', folderId: 'folder-home', parentId: '', ...extra });
const folder = (id, group = 'folder-home') => ({ id, type: 'folder', name: id, folderId: group, parentId: '' });
const initial = (icons = [site('a'), site('b'), site('c'), folder('target', 'work')]) => ({ icons, folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }], currentFolderId: 'folder-home' });
function harness(data = initial(), view = data) {
  const store = clone(data), state = clone(view), writes = [], toasts = [], errors = [];
  let fail = false, intercept = null, release, controller;
  let sceneView = data[Schema.SCHEMA_KEY] === 2 ? { sceneId: 'scene-default', homeGroupId: 'folder-home', generation: 1 } : null;
  const getSceneView = () => controller ? controller.getView() : sceneView;
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) { if (intercept) { const fn = intercept; intercept = null; await fn(); } return clone(keys == null ? store : Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
    async set(patch) { if (fail) { fail = false; throw Error('test write failure'); } writes.push(clone(patch)); Object.assign(store, clone(patch)); }
  } } };
  const workspace = Workspace.forChrome(chrome).connect({ state, onError: error => errors.push(error),
    onChange() { if (controller) Object.assign(state, controller.project(state)); },
    ...(sceneView ? { getViewIdentity: getSceneView } : {}) });
  workspace.seed(store, Workspace.migrationOverrides(store, state));
  const context = { URL, console, setTimeout, clearTimeout, OpenTabWorkspace: Workspace, document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] } };
  context.window = context; vm.createContext(context); vm.runInContext(code, context);
  const api = context.OpenTabFolders;
  api.init({ ...workspace, state, ...(sceneView ? { getSceneView } : {}), saveState: (...args) => controller ? controller.save(...args) : workspace.save(...args), refreshIconViews() {}, getIconsContainer: () => null, rememberFocus() {}, restoreFocus() {}, showToast: (text, options) => toasts.push({ text, options }) });
  return { api, state, store, writes, toasts, errors, workspace,
    select: () => api.captureBulkSelection(), target: (kind = 'group', id = 'work') => api.captureBulkDestination({ kind, id }),
    failNext() { fail = true; }, race(fn) { intercept = fn; },
    getView: () => clone(getSceneView()),
    withController() {
      controller = Controller.create({ state, coordinator: Workspace.forChrome(chrome), bridge: workspace, schema: Schema, onLoad() {} });
      Object.assign(state, controller.project(store, sceneView.sceneId, state.currentFolderId)); workspace.seed(store);
    },
    setView(sceneId) {
      const scene = state.scenes.find(item => item.id === sceneId);
      if (controller) Object.assign(state, controller.project(state, sceneId, scene.homeGroupId));
      else { sceneView = { sceneId, homeGroupId: scene.homeGroupId, generation: sceneView.generation + 1 }; state.currentFolderId = scene.homeGroupId; }
    },
    pause() { intercept = () => new Promise(resolve => { release = resolve; }); }, resume() { release(); },
    async undo() { const toast = toasts.findLast(item => item.options?.onAction); assert.ok(toast); await toast.options.onAction(); }
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
{
  const h = harness(initial([site('a'), site('b'), { id: 'tool', type: 'tool' }, { id: 'ssh', type: 'ssh' }, site('bad', { url: 'javascript:alert(1)' }), folder('target', 'work')]));
  assert.deepEqual(plain(h.api.bulkMoveContext().sites.map(item => item.id)), ['a', 'b']);
  const before = clone(h.state.icons), result = await h.api.moveSites(h.select(), ['b', 'a'], h.target());
  assert.equal(result.ok, true); assert.equal(result.moved, 2); assert.equal(h.writes.length, 1);
  assert.deepEqual(h.state.icons.map(item => item.id), before.map(item => item.id));
  for (const item of h.state.icons.slice(0, 2)) assert.deepEqual(item, { ...before.find(old => old.id === item.id), folderId: 'work' });
  assert.equal(h.toasts.length, 1);
  // Undo merges only its inverse; an unrelated edit made later survives.
  h.state.icons.find(item => item.id === 'tool').name = 'Later edit'; await h.workspace.save();
  await h.undo(); assert.equal(h.writes.length, 3); assert.equal(h.state.icons[0].folderId, 'folder-home');
  assert.equal(h.state.icons.find(item => item.id === 'tool').name, 'Later edit');
}
{
  const h = harness(); const token = h.select();
  for (const ids of [[], ['a', 'a'], ['a', 'missing'], ['target']]) assert.equal((await h.api.moveSites(token, ids, h.target())).ok, false);
  assert.equal(h.writes.length, 0);
  assert.equal((await h.api.moveSites(token, ['a'], h.target('group', 'folder-home'))).moved, 0);
  assert.equal(h.writes.length, 0); assert.equal(h.toasts.length, 0);
}
for (const remain of [0, 1, 2]) {
  const icons = [site('before'), folder('source'), ...Array.from({ length: 2 + remain }, (_, n) => site(`s${n}`, { parentId: 'source' })), folder('target', 'work'), site('after')];
  const h = harness(initial(icons)); h.api.openOverlay('source');
  assert.equal((await h.api.moveSites(h.select(), ['s0', 's1'], h.target('folder', 'target'))).ok, true);
  assert.equal(h.writes.length, 1); assert.equal(!!h.state.icons.find(item => item.id === 'source'), remain > 1);
  assert.equal(h.state.icons.find(item => item.id === 's0').parentId, 'target');
  assert.equal(h.state.icons.find(item => item.id === 's0').folderId, 'work');
  if (remain === 1) { assert.equal(h.state.icons[1].id, 's2'); assert.equal(h.state.icons[1].parentId, ''); }
  await h.undo(); assert.deepEqual(plain(h.state.icons), icons);
}
{
  const h = harness(); const selection = h.select(), destination = h.target();
  h.state.icons[0].name = 'Changed'; await h.workspace.save();
  assert.equal((await h.api.moveSites(selection, ['a'], destination)).reason, 'stale');
  assert.equal(h.writes.length, 1);
}
{
  const h = harness(); const selection = h.select(), destination = h.target('folder', 'target');
  h.state.icons.find(item => item.id === 'target').folderId = 'folder-home'; await h.workspace.save();
  assert.equal((await h.api.moveSites(selection, ['a'], destination)).reason, 'stale');
}
for (const change of [
  h => { h.store.icons = h.store.icons.filter(item => item.id !== 'target'); },
  h => { h.store.icons.find(item => item.id === 'target').folderId = 'folder-home'; },
  h => { h.store.icons.find(item => item.id === 'a').name = 'Concurrent edit'; },
  h => { h.store['opentab.workspaceEpoch'] = 1; },
  h => { h.store.folders.find(item => item.id === 'work').name = 'Renamed'; }
]) {
  const h = harness(); h.race(() => change(h));
  assert.equal((await h.api.moveSites(h.select(), ['a', 'b'], h.target('folder', 'target'))).reason, 'stale', 'locked dependency conflicts are distinct from write failures');
  assert.equal(h.writes.length, 0); assert.equal(h.toasts.length, 0);
  assert.deepEqual(h.state.icons, h.store.icons, 'failure recovers latest, never old rollback');
}
{
  const h = harness(initial([folder('source'), site('a', { parentId: 'source' }), site('b', { parentId: 'source' }), folder('target', 'work')]));
  h.api.openOverlay('source'); h.race(() => h.store.icons.push(site('new', { parentId: 'source' })));
  assert.equal((await h.api.moveSites(h.select(), ['a', 'b'], h.target())).ok, false); assert.equal(h.writes.length, 0);
}
{
  const h = harness(); h.failNext();
  assert.equal((await h.api.moveSites(h.select(), ['a'], h.target())).reason, 'save-failed');
  assert.deepEqual(h.state.icons, h.store.icons); assert.equal(h.toasts.length, 0); assert.equal(h.writes.length, 0);
}
{
  const h = harness(); h.pause(); const selected = h.select(), target = h.target();
  const pending = h.api.moveSites(selected, ['a'], target);
  assert.equal((await h.api.moveSites(selected, ['a'], target)).reason, 'busy');
  for (let i = 0; i < 10; i++) await Promise.resolve(); h.resume();
  assert.equal((await pending).ok, true); assert.equal(h.writes.length, 1);
}
{
  const h = harness(); await h.api.moveSites(h.select(), ['a'], h.target());
  h.state.icons[0].name = 'Later conflicting edit'; await h.workspace.save();
  await h.undo(); assert.equal(h.writes.length, 2); assert.equal(h.state.icons[0].folderId, 'work');
}
{
  const h = harness(); await h.api.moveSites(h.select(), ['a'], h.target());
  h.store['opentab.workspaceEpoch'] = 1; h.workspace.seed(h.store);
  await h.undo(); assert.equal(h.writes.length, 1);
}
// Duplicate URLs are distinct saved records; bulk movement never deduplicates them.
{
  const h = harness(initial([site('a'), site('b', { url: 'https://a.example/path?q=1' }), folder('target', 'work')]));
  assert.equal((await h.api.moveSites(h.select(), ['a', 'b'], h.target())).moved, 2);
  assert.equal(h.state.icons.length, 3); assert.equal(h.writes.length, 1);
}
{
  const h = harness(initial([folder('source'), site('a', { parentId: 'source' }), site('b', { parentId: 'source' })]));
  h.api.openOverlay('source'); const before = clone(h.state.icons);
  assert.equal((await h.api.moveSites(h.select(), ['a'], h.target('folder', 'source'))).moved, 0);
  assert.deepEqual(h.state.icons, before); assert.equal(h.writes.length, 0);
}
{
  const h = harness(); const selected = h.select(), target = h.target();
  h.state.currentFolderId = 'work';
  assert.equal((await h.api.moveSites(selected, ['a'], target)).reason, 'stale'); assert.equal(h.writes.length, 0);
}
{
  const h = harness(); await h.api.moveSites(h.select(), ['a'], h.target());
  h.race(() => { h.store['opentab.workspaceEpoch'] = 1; });
  await h.undo(); assert.equal(h.writes.length, 1); assert.equal(h.state.icons[0].folderId, 'work');
}
{
  const h = harness(); await h.api.moveSites(h.select(), ['a'], h.target());
  h.failNext(); await h.undo(); assert.equal(h.writes.length, 1); assert.equal(h.state.icons[0].folderId, 'work');
}
{
  const h = harness();
  // Loading normalizes records without writing those defaults to storage.
  for (const icon of h.state.icons) Object.assign(icon, { customIconUrl: '', emoji: '', resolvedIconUrl: 'icons/derived.svg', sshPort: 22, sshSocksPort: 1080, sshPassword: '', librarySlug: 'derived' });
  h.workspace.seed(h.store);
  assert.equal((await h.api.moveSites(h.select(), ['a'], h.target('folder', 'target'))).ok, true);
  assert.equal(h.writes.length, 1);
}
// Legacy storage can contain Home folder icons but no explicit group records.
for (const kind of ['group', 'folder']) {
  const raw = { icons: [folder('source'), site('a', { parentId: 'source' }), site('b', { parentId: 'source' }), folder('target')], currentFolderId: 'folder-home' };
  const view = { ...clone(raw), folders: [{ id: 'folder-home', name: '主页' }] };
  const h = harness(raw, view); h.api.openOverlay('source');
  assert.equal((await h.api.moveSites(h.select(), ['a', 'b'], h.target(kind, kind === 'group' ? 'folder-home' : 'target'))).ok, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.store.icons.find(icon => icon.id === 'a').parentId, kind === 'group' ? '' : 'target');
  await h.undo(); assert.deepEqual(plain(h.state.icons), raw.icons);
}
{
  const h = harness(initial([folder('source'), site('a', { parentId: 'source' }), site('b', { parentId: 'source' })]));
  h.api.openOverlay('source'); h.race(() => { h.store.folders = h.store.folders.filter(group => group.id !== 'folder-home'); });
  assert.equal((await h.api.moveSites(h.select(), ['a'], h.target('group', 'folder-home'))).ok, false);
  assert.equal(h.writes.length, 0, 'deleting an explicitly stored Home is not implicit Home');
}
{
  const h = harness();
  h.race(() => { h.store.folders.find(group => group.id === 'folder-home').name = 'Latest source label'; });
  assert.equal((await h.api.moveSites(h.select(), ['a', 'b'], h.target())).ok, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.state.folders.find(group => group.id === 'folder-home').name, 'Latest source label');
  await h.undo();
  assert.equal(h.state.folders.find(group => group.id === 'folder-home').name, 'Latest source label');
}


// A chooser snapshot must not silently resolve an old label to a changed target.
for (const change of ['name', 'folderId']) {
  const h = harness();
  const option = h.api.bulkMoveContext().destinations.find(item => item.id === 'target');
  h.state.icons.find(item => item.id === 'target')[change] = change === 'name' ? 'Renamed' : 'folder-home';
  assert.equal(h.api.captureBulkDestination(option), null);
  assert.equal(h.writes.length, 0);
}

{
  const h = harness();
  const option = h.api.bulkMoveContext().destinations.find(item => item.id === 'target');
  h.state.folders.find(group => group.id === 'work').name = 'Renamed containing group';
  assert.equal(h.api.captureBulkDestination(option), null);
  assert.equal(h.writes.length, 0);
}
// Scene fixtures deliberately repeat every visible label, carry a nested group
// tree, and include a third archived scene that must never become a destination.
const SOURCE = 'scene-default', TARGET = 'scene-target', ARCHIVED = 'scene-archived';
function sceneInitial() {
  let data = Schema.migrateLegacy({
    folders: [{ id: 'folder-home', name: 'Home' }, { id: 'source-root', name: 'Repeat' }, { id: 'source-leaf', name: 'Repeat', parentId: 'source-root' }, { id: 'source-other', name: 'Other' }],
    icons: ['a', 'b', 'c'].map(id => site(id, { folderId: 'source-leaf', opaque: { keep: id } })),
    todos: [{ id: 'source-task', text: 'Source task', done: false }], currentFolderId: 'source-leaf'
  }, { defaultName: 'Repeat' });
  for (const [id, homeGroupId] of [[TARGET, 'target-home'], [ARCHIVED, 'archived-home']]) data = Schema.create(data, { id, name: 'Repeat', iconKey: 'briefcase', homeGroupId, homeName: 'Home' });
  data.folders.push({ id: 'target-root', name: 'Repeat', sceneId: TARGET }, { id: 'target-middle', name: 'Repeat', parentId: 'target-root', sceneId: TARGET },
    { id: 'target-leaf', name: 'Repeat', parentId: 'target-middle', sceneId: TARGET });
  data.icons.push(folder('target', 'target-leaf'), folder('target-twin', 'target-leaf'), site('target-existing', { folderId: 'target-leaf', parentId: 'target' }), site('archived', { folderId: 'archived-home' }));
  data.scenes.find(scene => scene.id === ARCHIVED).archivedAt = 123;
  data.todos.push({ id: 'target-task', text: 'Target task', done: false, sceneId: TARGET });
  data.lastOpenedSceneId = TARGET; // A shared default hint is not this tab's view.
  Schema.validate(data); return data;
}
function sceneTarget(h, kind = 'group', id = 'target-leaf') {
  return h.api.captureBulkDestination(h.api.bulkMoveContext().destinations.find(item => item.kind === kind && item.id === id));
}
{
  const h = harness(sceneInitial()), before = clone(h.state), context = h.api.bulkMoveContext();
  assert.deepEqual(plain(context.sites.map(item => item.id)), ['a', 'b', 'c']);
  assert.ok(context.destinations.some(item => item.id === 'target-leaf'));
  assert.ok(!context.destinations.some(item => item.sceneId === ARCHIVED));
  const option = context.destinations.find(item => item.id === 'target');
  assert.deepEqual(plain(option.sourceView), h.getView());
  assert.equal(option.destinationScene.sceneId, TARGET);
  assert.deepEqual(plain(option.groupPath.map(item => item.id)), ['target-root', 'target-middle', 'target-leaf']);
  assert.deepEqual(plain(option.path), ['Repeat', 'Repeat', 'Repeat', 'Repeat', 'target']);
  assert.equal(h.target('group', 'target-leaf'), null, 'cross-scene target requires explicit scene and source-view identities');
  assert.equal(h.target('folder', 'target'), null);
  for (const malformed of [{ destinationScene: null }, { destinationScene: undefined }, { sourceView: undefined }, { destinationScene: { ...option.destinationScene, sceneId: SOURCE } }, { sceneId: SOURCE }, { path: ['Wrong'] }, { sourceView: { ...option.sourceView, generation: 0 } }]) {
    assert.equal(h.api.captureBulkDestination({ ...option, ...malformed }), null);
  }
  assert.deepEqual(h.state, before, 'enumerating all destinations never persists a projection');
}
{
  const h = harness(sceneInitial());
  h.state.folders.find(group => group.id === 'target-leaf').sceneId = 'missing-scene';
  assert.ok(!h.api.bulkMoveContext().destinations.some(item => item.id === 'target-leaf' || item.id === 'target'));
  assert.equal(h.target('group', 'target-leaf'), null, 'orphan destination ownership fails closed without throwing');
}
for (const kind of ['group', 'folder']) {
  const h = harness(sceneInitial()), before = clone(h.state), view = h.getView();
  // Duplicate URLs remain independent records with their IDs and opaque assets.
  h.state.icons[1].url = h.state.icons[0].url; h.store.icons[1].url = h.store.icons[0].url; h.workspace.seed(h.store);
  before.icons[1].url = before.icons[0].url;
  const result = await h.api.moveSites(h.select(), ['b', 'a'], sceneTarget(h, kind, kind === 'group' ? 'target-leaf' : 'target'));
  assert.equal(result.ok, true); assert.equal(result.moved, 2); assert.equal(h.writes.length, 1);
  assert.deepEqual(h.state.icons.map(item => item.id), before.icons.map(item => item.id));
  for (const id of ['a', 'b']) assert.deepEqual(h.store.icons.find(item => item.id === id), { ...before.icons.find(item => item.id === id), folderId: 'target-leaf', parentId: kind === 'folder' ? 'target' : '' });
  for (const key of ['folders', 'scenes', 'sceneProfiles', 'todos']) assert.deepEqual(h.store[key], before[key]);
  assert.equal(h.state.currentFolderId, 'source-leaf'); assert.equal(h.store.currentFolderId, 'source-leaf');
  assert.equal(h.store.lastOpenedSceneId, TARGET); assert.deepEqual(h.getView(), view);
  assert.match(h.toasts[0].text, /Repeat \/ Repeat \/ Repeat \/ Repeat/);
  // A new site and unrelated scene profile/task edits survive both directions.
  h.store.icons.push(site('later', { folderId: 'target-leaf', parentId: kind === 'folder' ? 'target' : '' }));
  h.store.todos.find(todo => todo.id === 'target-task').text = 'Later target task';
  h.store.sceneProfiles.find(profile => profile.id === ARCHIVED).layoutColumns = 6;
  await h.undo();
  assert.deepEqual(h.store.icons.filter(item => item.id !== 'later'), before.icons);
  assert.equal(h.store.icons.at(-1).id, 'later');
  assert.equal(h.state.todos.find(todo => todo.id === 'target-task').text, 'Later target task');
  assert.equal(h.state.sceneProfiles.find(profile => profile.id === ARCHIVED).layoutColumns, 6);
  assert.deepEqual(h.getView(), view); assert.equal(h.state.currentFolderId, 'source-leaf');
}
for (const remain of [0, 1, 2]) {
  const data = sceneInitial();
  data.icons = [site('before', { folderId: 'source-leaf' }), folder('source', 'source-leaf'), ...Array.from({ length: 2 + remain }, (_, n) => site(`s${n}`, { folderId: 'source-leaf', parentId: 'source' })), ...data.icons.filter(icon => icon.folderId !== 'source-leaf')];
  const h = harness(data); h.api.openOverlay('source');
  assert.equal((await h.api.moveSites(h.select(), ['s0', 's1'], sceneTarget(h, 'folder', 'target'))).ok, true);
  assert.equal(!!h.store.icons.find(icon => icon.id === 'source'), remain > 1);
  if (remain === 1) { assert.equal(h.store.icons[1].id, 's2'); assert.equal(h.store.icons[1].parentId, ''); }
  await h.undo(); assert.deepEqual(h.store.icons, data.icons, 'cross-scene Undo restores dissolved source folder and exact sibling order');
}
const sceneRaces = [
  ['source archive', h => { h.store.scenes.find(scene => scene.id === SOURCE).archivedAt = 12; }],
  ['target archive', h => { h.store.scenes.find(scene => scene.id === TARGET).archivedAt = 12; }],
  ['source scene deletion', h => { h.store.scenes = h.store.scenes.filter(scene => scene.id !== SOURCE); }],
  ['target scene deletion', h => { h.store.scenes = h.store.scenes.filter(scene => scene.id !== TARGET); }],
  ['source scene name', h => { h.store.scenes.find(scene => scene.id === SOURCE).name = 'Renamed'; }],
  ['target scene name', h => { h.store.scenes.find(scene => scene.id === TARGET).name = 'Renamed'; }],
  ['target scene home', h => { h.store.scenes.find(scene => scene.id === TARGET).homeGroupId = 'target-root'; }],
  ['target group move', h => { h.store.folders.find(group => group.id === 'target-leaf').sceneId = SOURCE; }],
  ['source group move', h => { h.store.folders.find(group => group.id === 'source-leaf').sceneId = TARGET; }],
  ['source group deletion', h => { h.store.folders = h.store.folders.filter(group => group.id !== 'source-leaf'); }],
  ['target group deletion', h => { h.store.folders = h.store.folders.filter(group => group.id !== 'target-leaf'); }],
  ['source ancestor move', h => { h.store.folders.find(group => group.id === 'source-root').sceneId = TARGET; }],
  ['source reparent', h => { h.store.folders.find(group => group.id === 'source-leaf').parentId = 'source-other'; }],
  ['target ancestor rename', h => { h.store.folders.find(group => group.id === 'target-root').name = 'Renamed'; }],
  ['target ancestor reparent', h => { h.store.folders.find(group => group.id === 'target-middle').parentId = 'target-home'; }],
  ['target folder move', h => { h.store.icons.find(icon => icon.id === 'target').folderId = 'target-home'; h.store.icons.find(icon => icon.id === 'target-existing').folderId = 'target-home'; }],
  ['target folder deletion', h => { h.store.icons = h.store.icons.filter(icon => icon.id !== 'target' && icon.parentId !== 'target'); }],
  ['selected site edit', h => { h.store.icons.find(icon => icon.id === 'a').name = 'Changed'; }],
  ['selected site move', h => { h.store.icons.find(icon => icon.id === 'a').folderId = 'source-other'; }],
  ['epoch replacement', h => { h.store['opentab.workspaceEpoch'] = 1; }],
  ['view round trip', h => { h.setView(TARGET); h.setView(SOURCE); }]
];
for (const [label, change] of sceneRaces) {
  const h = harness(sceneInitial()), selection = h.select(), destination = sceneTarget(h, 'folder', 'target');
  h.race(() => change(h));
  assert.equal((await h.api.moveSites(selection, ['a', 'b'], destination)).reason, 'stale', label);
  assert.equal(h.writes.length, 0, label); assert.equal(h.toasts.length, 0, label);
  assert.deepEqual(h.state.icons, h.store.icons, `${label}: stale rejection rehydrates latest, not a captured projection`);
}
for (const [label, change] of sceneRaces) {
  const h = harness(sceneInitial());
  assert.equal((await h.api.moveSites(h.select(), ['a'], sceneTarget(h, 'folder', 'target'))).ok, true);
  h.race(() => change(h)); await h.undo();
  assert.equal(h.writes.length, 1, `Undo rejects ${label}`);
  assert.deepEqual(h.state.icons, h.store.icons, `Undo ${label}: durable state survives`);
}
// Every displayed ancestor is checked at capture too, not only after waiting for
// the shared writer lock. Old chooser options cannot silently acquire new labels.
for (const change of [
  h => { h.state.scenes.find(scene => scene.id === TARGET).name = 'Renamed'; },
  h => { h.state.folders.find(group => group.id === 'target-root').name = 'Renamed'; },
  h => { h.state.folders.find(group => group.id === 'target-middle').parentId = 'target-home'; },
  h => { h.state.folders.find(group => group.id === 'target-leaf').sceneId = SOURCE; },
  h => { h.state.scenes.find(scene => scene.id === TARGET).archivedAt = 123; },
  h => { h.setView(TARGET); h.setView(SOURCE); }
]) {
  const h = harness(sceneInitial()), option = h.api.bulkMoveContext().destinations.find(item => item.id === 'target');
  change(h); assert.equal(h.api.captureBulkDestination(option), null); assert.equal(h.writes.length, 0);
}
{
  const h = harness(sceneInitial()); h.race(() => {
    h.store.folders.find(group => group.id === 'source-root').name = 'Independent source ancestor';
    h.store.folders.find(group => group.id === 'source-leaf').name = 'Independent source group';
    h.store.icons.find(icon => icon.id === 'c').name = 'Independent site';
  });
  assert.equal((await h.api.moveSites(h.select(), ['a'], sceneTarget(h))).ok, true);
  await h.undo();
  assert.equal(h.store.folders.find(group => group.id === 'source-root').name, 'Independent source ancestor');
  assert.equal(h.store.icons.find(icon => icon.id === 'c').name, 'Independent site');
}
for (const undo of [false, true]) {
  const h = harness(sceneInitial()), before = clone(h.state.icons);
  if (undo) assert.equal((await h.api.moveSites(h.select(), ['a'], sceneTarget(h))).ok, true);
  h.failNext();
  if (undo) { await h.undo(); assert.equal(h.store.icons.find(icon => icon.id === 'a').folderId, 'target-leaf'); }
  else { assert.equal((await h.api.moveSites(h.select(), ['a'], sceneTarget(h))).reason, 'save-failed'); assert.deepEqual(h.store.icons, before); }
  assert.deepEqual(h.state.icons, h.store.icons); assert.equal(h.writes.length, undo ? 1 : 0);
}
{
  const h = harness(sceneInitial()); h.pause(); const selected = h.select(), target = sceneTarget(h);
  const pending = h.api.moveSites(selected, ['a'], target);
  assert.equal((await h.api.moveSites(selected, ['a'], target)).reason, 'busy');
  for (let i = 0; i < 10; i++) await Promise.resolve(); h.resume();
  assert.equal((await pending).ok, true); assert.equal(h.writes.length, 1);
}
// The real scene controller rejects invalid source scenes/views before calling
// the operation's supplied guard. Recovered-state classification must therefore
// work even when that guard never observed the locked conflict.
for (const [label, change] of [
  ['source archive', h => { h.store.scenes.find(scene => scene.id === SOURCE).archivedAt = 123; }],
  ['source view switch', h => h.setView(TARGET)],
  ['source view round trip', h => { h.setView(TARGET); h.setView(SOURCE); }]
]) {
  const h = harness(sceneInitial()); h.withController(); const before = clone(h.store.icons);
  h.race(() => change(h));
  assert.equal((await h.api.moveSites(h.select(), ['a'], sceneTarget(h))).reason, 'stale', `controller precondition: ${label}`);
  assert.equal(h.writes.length, 0); assert.equal(h.toasts.length, 0);
  assert.deepEqual(h.state.icons, h.store.icons); assert.deepEqual(h.store.icons, before);
}
for (const unrelatedChange of [false, true]) {
  const h = harness(sceneInitial()); h.withController(); h.failNext();
  if (unrelatedChange) h.race(() => { h.store.icons.find(icon => icon.id === 'c').name = 'Independent concurrent edit'; });
  assert.equal((await h.api.moveSites(h.select(), ['a'], sceneTarget(h))).reason, 'save-failed', 'unchanged move dependencies remain retryable after genuine write failure');
  assert.equal(h.writes.length, 0); assert.equal(h.toasts.length, 0); assert.deepEqual(h.state.icons, h.store.icons);
  if (unrelatedChange) assert.equal(h.state.icons.find(icon => icon.id === 'c').name, 'Independent concurrent edit');
}
console.log('Bulk website move real-module unit tests passed.');
