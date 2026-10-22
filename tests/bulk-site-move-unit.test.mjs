import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Workspace = require('../workspace-persistence.js');
const code = fs.readFileSync(new URL('../folders.js', import.meta.url), 'utf8');
const clone = value => structuredClone(value);
const site = (id, extra = {}) => ({ id, name: id, type: 'shortcut', url: `https://${id}.example/path?q=1`, uploadedIconDataUrl: 'data:image/png;base64,abc', folderId: 'folder-home', parentId: '', ...extra });
const folder = (id, group = 'folder-home') => ({ id, type: 'folder', name: id, folderId: group, parentId: '' });
const initial = (icons = [site('a'), site('b'), site('c'), folder('target', 'work')]) => ({ icons, folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }], currentFolderId: 'folder-home' });
function harness(data = initial(), view = data) {
  const store = clone(data), state = clone(view), writes = [], toasts = [], errors = [];
  let fail = false, intercept = null, release;
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) { if (intercept) { const fn = intercept; intercept = null; await fn(); } return clone(keys == null ? store : Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
    async set(patch) { if (fail) { fail = false; throw Error('test write failure'); } writes.push(clone(patch)); Object.assign(store, clone(patch)); }
  } } };
  const workspace = Workspace.forChrome(chrome).connect({ state, onError: error => errors.push(error) });
  workspace.seed(store, Workspace.migrationOverrides(store, state));
  const context = { URL, console, setTimeout, clearTimeout, OpenTabWorkspace: Workspace, document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] } };
  context.window = context; vm.createContext(context); vm.runInContext(code, context);
  const api = context.OpenTabFolders;
  api.init({ ...workspace, state, saveState: workspace.save, refreshIconViews() {}, getIconsContainer: () => null, rememberFocus() {}, restoreFocus() {}, showToast: (text, options) => toasts.push({ text, options }) });
  return { api, state, store, writes, toasts, errors, workspace,
    select: () => api.captureBulkSelection(), target: (kind = 'group', id = 'work') => api.captureBulkDestination({ kind, id }),
    failNext() { fail = true; }, race(fn) { intercept = fn; },
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
console.log('Bulk website move real-module unit tests passed.');
