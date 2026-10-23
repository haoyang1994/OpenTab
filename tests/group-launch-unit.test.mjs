import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../lib/group-launch.js');
const Workspace = require('../workspace-persistence.js');
const Schema = require('../scene-schema.js');
const EPOCH = Workspace.EPOCH_KEY;
const HOME = 'folder-home';
const clone = value => structuredClone(value);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const site = (id, overrides = {}) => ({ id, name: id.toUpperCase(), type: 'shortcut', url: `https://${id}.example/`, folderId: HOME, parentId: '', ...overrides });
const base = () => ({ icons: [site('a'), site('b')], folders: [{ id: HOME, name: 'Home' }], currentFolderId: HOME, todos: [] });
function harness(initial = base(), options = {}) {
  const state = clone(initial), durable = clone(initial), calls = [], writes = [];
  let groupId = options.groupId || HOME, view = clone(options.view || null), transactionCalls = 0, readCalls = 0;
  const chrome = { runtime: {}, storage: { local: {
    async get() { readCalls++; if (options.readError) throw new Error('read denied'); return clone(durable); },
    async set(patch) { writes.push(clone(patch)); Object.assign(durable, clone(patch)); }
  } } };
  const coordinator = Workspace.forChrome(chrome);
  const api = Core.create({
    getSnapshot() { if (options.snapshotError) throw new Error('snapshot failed'); return { data: state, view, groupId }; },
    whenIdle: () => options.whenIdle ? options.whenIdle() : Promise.resolve(true),
    transaction(task) { transactionCalls++; if (options.lockError) return Promise.reject(new Error('lock denied')); return coordinator.transaction(task); },
    createTab(url) { calls.push(url); return options.createTab ? options.createTab(url, calls.length) : Promise.resolve({ id: calls.length }); }
  });
  return { api, state, durable, calls, writes, coordinator, options, counts: () => ({ transactionCalls, readCalls }),
    setGroup(id) { groupId = id; }, setView(next) { view = clone(next); }, getView: () => view,
    snapshot: () => ({ data: state, view, groupId }) };
}
function sceneState() {
  return Schema.migrateLegacy(base());
}
const viewFor = state => ({ sceneId: 'scene-default', homeGroupId: HOME, currentFolderId: HOME, generation: 1 });
function keys(preview) { return preview.items.map(item => item.key); }

// Requiring or evaluating either module format has no browser/storage effects.
{
  const source = fs.readFileSync(new URL('../lib/group-launch.js', import.meta.url), 'utf8');
  const browser = { URL };
  vm.runInNewContext(source, browser);
  assert.equal(browser.OpenTabGroupLaunchCore.MAX_SELECTION, 20);
  assert.equal(browser.OpenTabGroupLaunchCore.safeUrl('HTTPS://Example.com:443'), 'https://example.com/');
}

for (const value of [null, undefined, {}, 12, '', '/relative', '//example.test', 'example.test', 'http://',
  'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'chrome://settings', 'chrome-extension://id/popup.html',
  'ssh://host', 'ftp://host', 'blob:https://example.com/id', 'https://user:secret@example.com', 'http://user@example.com',
  'https://%75ser@example.com', 'https:///@example.com', 'https:////@example.com', 'https:///example.com', 'https://@example.com', 'http://:secret@example.com', 'https://user@',
  'https://exam\nple.com', 'https://example.com/\u0000hello', 'https:\\example.com', 'https://example.com\\@evil.test']) {
  assert.equal(Core.safeUrl(value), null, `Unsafe URL: ${String(value)}`);
}
assert.equal(Core.safeUrl('  HTTPS://EXAMPLE.COM:443/a?q=one#first  '), 'https://example.com/a?q=one#first');
assert.equal(Core.safeUrl('http://localhost:3000/app'), 'http://localhost:3000/app');
assert.equal(Core.safeUrl('https://example.com/path@file?q=user@host'), 'https://example.com/path@file?q=user@host');

// Current group only, with valid folder children, no tools/SSH/folder launches.
{
  const initial = base();
  initial.folders.push({ id: 'elsewhere', name: 'Elsewhere' });
  initial.icons = [site('a'), site('duplicate', { url: 'https://A.example:443' }),
    site('query1', { url: 'https://a.example/?q=one' }), site('query2', { url: 'https://a.example/?q=two' }),
    site('fragment', { url: 'https://a.example/#part' }), site('path', { url: 'https://a.example/path' }),
    site('http', { url: 'http://a.example/' }), site('child', { parentId: 'folder' }),
    site('folder', { type: 'folder' }), site('tool', { type: 'tool' }), site('ssh', { type: 'ssh' }),
    site('bad', { url: 'javascript:alert(1)' }), site('orphan', { parentId: 'missing' }),
    site('foreign', { folderId: 'elsewhere' }), site('crossed', { parentId: 'foreign-folder' }),
    site('foreign-folder', { folderId: 'elsewhere', type: 'folder' }), site('invalid-id', { id: '' }),
    site('duplicate-id'), site('duplicate-id', { url: 'https://other.example/' })];
  const h = harness(initial), before = clone(h.state), preview = h.api.preview();
  assert.equal(preview.reason, '');
  assert.deepEqual(preview.items.map(item => item.name), ['A', 'QUERY1', 'QUERY2', 'FRAGMENT', 'PATH', 'HTTP', 'CHILD']);
  assert.equal(preview.dedupCount, 1);
  assert.equal(preview.excludedCount, 9);
  assert.deepEqual(h.state, before);
  assert.equal(h.calls.length, 0); assert.equal(h.counts().readCalls, 0);
  assert.ok(Object.isFrozen(preview) && Object.isFrozen(preview.items) && Object.isFrozen(preview.items[0]));
  assert.ok(preview.items.every(item => !Object.hasOwn(item, 'sourceId')));
  const result = await h.api.launch(preview, keys(preview));
  assert.equal(result.ok, true); assert.deepEqual(h.calls, keys(preview)); assert.equal(h.writes.length, 0);
}

// Folder cycles/nesting are not valid shortcut membership.
{
  const data = base();
  data.icons = [site('child', { parentId: 'nested' }), site('nested', { type: 'folder', parentId: 'top' }), site('top', { type: 'folder' })];
  assert.equal(Core.collect({ data, groupId: HOME, view: null }).items.length, 0);
}

// No truncation at 20. Invalid selection, empty selection, and foreign tokens fail closed.
{
  const data = base(); data.icons = Array.from({ length: 21 }, (_, i) => site(`s${i}`));
  const h = harness(data), p = h.api.preview();
  assert.equal(p.items.length, 21);
  for (const [selection, reason] of [[[], 'empty'], [keys(p), 'too-many'], [['https://forged.example/'], 'invalid-selection'], [null, 'invalid-selection']]) {
    assert.equal((await h.api.launch(p, selection)).reason, reason);
  }
  assert.equal((await h.api.launch({ ...p }, keys(p).slice(0, 2))).reason, 'invalid-preview');
  assert.equal(h.calls.length, 0); assert.equal(h.counts().transactionCalls, 0);
  assert.equal((await h.api.launch(p, new Set(keys(p).slice(0, 20)))).ok, true);
  assert.equal(h.calls.length, 20);
  assert.equal((await h.api.launch(p, [keys(p)[20]])).ok, true, 'previously unselected rows can be chosen later');
  assert.equal((await h.api.launch(p, keys(p).slice(0, 20))).reason, 'already-opened');
  assert.equal(h.calls.length, 21);
}

// Scenes are bound to the current active scene, not any reachable group.
{
  const data = sceneState();
  data.scenes.push({ id: 'work', name: 'Work', iconKey: 'briefcase', homeGroupId: 'work-home', archivedAt: null });
  data.folders.push({ id: 'work-home', name: 'Work Home', sceneId: 'work' });
  data.icons.push(site('work', { folderId: 'work-home' }));
  const h = harness(data, { view: viewFor(data) });
  assert.deepEqual(h.api.preview().items.map(item => item.name), ['A', 'B']);
  h.setGroup('work-home'); assert.equal(h.api.preview().reason, 'stale');
  h.setView({ sceneId: 'work', homeGroupId: 'work-home', currentFolderId: 'work-home', generation: 2 });
  assert.deepEqual(h.api.preview().items.map(item => item.name), ['WORK']);
  h.state.scenes[1].archivedAt = 123; assert.equal(h.api.preview().reason, 'stale');
}
for (const mutate of [data => { data['opentab.sceneSchemaVersion'] = 3; }, data => { delete data['opentab.sceneSchemaVersion']; },
  data => { data.scenes[0].archivedAt = 2; }, data => { data.folders[0].sceneId = 'missing'; },
  data => { data.folders[0].parentId = HOME; }]) {
  const data = sceneState(); mutate(data);
  assert.equal(Core.collect({ data, view: viewFor(data), groupId: HOME }).reason, 'stale');
}

// Check both unsaved local edits and latest durable edits, using source identity,
// not a duplicate URL that happens to remain in the group.
for (const place of ['state', 'durable']) {
  for (const mutate of [
    data => { data.icons.splice(0, 1); },
    data => { data.icons[0].url += '?changed'; },
    data => { data.icons[0].name = 'Renamed'; },
    data => { data.icons[0].id = 'replacement'; },
    data => { data.icons[0].type = 'tool'; },
    data => { data.icons[0].folderId = 'other'; },
    data => { data.icons[0].parentId = 'folder'; },
    data => { data.folders[0].name = 'Renamed group'; },
    data => { data[EPOCH] = 1; }
  ]) {
    const data = base(); data.icons.push(site('duplicate', { url: data.icons[0].url }), site('folder', { type: 'folder' }));
    data.folders.push({ id: 'other', name: 'Other' });
    const h = harness(data), p = h.api.preview(); mutate(h[place]);
    const result = await h.api.launch(p, [keys(p)[0]]);
    assert.equal(result.reason, 'stale', `${place}: ${mutate}`); assert.equal(h.calls.length, 0);
    assert.equal((await h.api.launch(p, [keys(p)[0]])).reason, 'invalid-preview');
  }
}
// Removing the selected original must not silently switch to its duplicate.
{
  const data = base(); data.icons.unshift(site('duplicate', { url: data.icons[0].url }));
  const h = harness(data), p = h.api.preview(); h.durable.icons.shift();
  assert.equal((await h.api.launch(p, [keys(p)[0]])).reason, 'stale'); assert.equal(h.calls.length, 0);
}
// Irrelevant edits and record order do not force a stale preview.
{
  const h = harness(), p = h.api.preview();
  h.state.icons[1].name = 'Unselected edit'; h.durable.icons.reverse(); h.durable.themeMode = 'light';
  assert.equal((await h.api.launch(p, [keys(p)[0]])).ok, true);
}
// Folder parent identity is captured too, not just the child's parent ID.
for (const place of ['state', 'durable']) {
  for (const mutate of [folder => { folder.name = 'Changed'; }, folder => { folder.folderId = 'elsewhere'; }, folder => { folder.type = 'shortcut'; }]) {
    const data = base(); data.icons[0].parentId = 'folder'; data.icons.push(site('folder', { type: 'folder' }));
    const h = harness(data), p = h.api.preview(); mutate(h[place].icons[2]);
    assert.equal((await h.api.launch(p, [keys(p)[0]])).reason, 'stale'); assert.equal(h.calls.length, 0);
  }
}
// Legacy hydration defaults are equivalent, but never widen scene membership.
{
  const data = { icons: [site('a', { type: undefined, folderId: undefined, parentId: undefined })] };
  const h = harness(data);
  h.state.folders = [{ id: HOME, name: '主页' }];
  Object.assign(h.state.icons[0], { type: 'shortcut', folderId: HOME, parentId: '' });
  const p = h.api.preview(); assert.equal(p.items.length, 1);
  assert.equal((await h.api.launch(p, keys(p))).ok, true);
}
{
  const h = harness({ icons: [site('a')] }), p = h.api.preview();
  assert.equal(p.groupName, 'Home'); assert.equal((await h.api.launch(p, keys(p))).ok, true);
}
// Explicit empty group storage is not an implicit Home and may signal deletion.
{
  const h = harness(), p = h.api.preview(); h.durable.folders = [];
  assert.equal((await h.api.launch(p, keys(p))).reason, 'stale'); assert.equal(h.calls.length, 0);
  assert.equal(Core.collect({ data: { icons: [], folders: [] }, groupId: HOME, view: null }).reason, 'stale');
}
// View navigation, scene changes, archive and replacement epochs invalidate.
for (const mutation of [
  h => h.setGroup('other'),
  h => h.setView({ ...h.getView(), generation: 2 }),
  h => h.setView(null),
  h => { h.durable.scenes[0].archivedAt = 123; },
  h => { h.durable.scenes[0].name = 'Renamed scene'; },
  h => { h.durable[EPOCH] = 1; },
  h => { h.durable.folders[0].sceneId = 'other'; },
  h => { h.durable.folders = []; }
]) {
  const data = sceneState(), h = harness(data, { view: viewFor(data) }), p = h.api.preview(); mutation(h);
  assert.equal((await h.api.launch(p, keys(p))).reason, 'stale'); assert.equal(h.calls.length, 0);
}
{
  const h = harness(), p = h.api.preview(); h.setView(viewFor(h.state));
  assert.equal((await h.api.launch(p, keys(p))).reason, 'stale');
}

// Save barriers finish before locking; rejected saves never call tabs.create.
{
  const gate = deferred(), h = harness(base(), { whenIdle: () => gate.promise }), p = h.api.preview();
  const running = h.api.launch(p, keys(p)); await tick();
  assert.equal(h.counts().transactionCalls, 0); assert.equal(h.calls.length, 0);
  assert.equal((await h.api.launch(p, keys(p))).reason, 'busy');
  assert.equal((await h.api.launch(h.api.preview(), keys(p))).reason, 'busy');
  gate.resolve(true); assert.equal((await running).ok, true);
  assert.equal((await h.api.launch(p, keys(p))).reason, 'already-opened'); assert.equal(h.calls.length, 2);
}
for (const whenIdle of [() => false, () => Promise.reject(new Error('save failed'))]) {
  const h = harness(base(), { whenIdle }), p = h.api.preview();
  assert.equal((await h.api.launch(p, keys(p))).reason, 'save-failed');
  assert.equal(h.calls.length, 0); assert.equal(h.counts().transactionCalls, 0);
}
{
  const gate = deferred(), h = harness(base(), { whenIdle: () => gate.promise }), p = h.api.preview();
  const running = h.api.launch(p, keys(p)); h.state.icons[0].name = 'Draft changed'; gate.resolve(true);
  assert.equal((await running).reason, 'stale'); assert.equal(h.calls.length, 0);
}
// Read the latest snapshot only after acquiring the existing workspace lock.
{
  const gate = deferred(), h = harness(), p = h.api.preview();
  let entered = false;
  const writer = h.coordinator.transaction(async ({ read, write }) => {
    entered = true; await gate.promise;
    const data = await read(null); data.icons[0].url += '?new'; await write({ icons: data.icons });
  });
  while (!entered) await tick();
  const launch = h.api.launch(p, keys(p)); await tick(); assert.equal(h.calls.length, 0);
  gate.resolve(); await writer;
  assert.equal((await launch).reason, 'stale'); assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 1);
}
for (const option of ['lockError', 'readError', 'snapshotError']) {
  const h = harness(), p = h.api.preview(); h.options[option] = true;
  assert.equal((await h.api.launch(p, keys(p))).reason, 'read-failed'); assert.equal(h.calls.length, 0);
}

// Each successful URL is committed to a private replay set before continuing.
// Chrome promise/callback-wrapper failures retain exact names and URLs to retry.
{
  let fail = true;
  const h = harness(base(), { createTab(url) { return url.includes('b.example') && fail ? Promise.reject(new Error('Browser refused B')) : Promise.resolve({ id: 1 }); } });
  const p = h.api.preview(), first = await h.api.launch(p, keys(p));
  assert.equal(first.reason, 'partial'); assert.deepEqual(first.opened, [keys(p)[0]]);
  assert.deepEqual(first.failed, [{ key: keys(p)[1], name: 'B', url: keys(p)[1], reason: 'Browser refused B' }]);
  assert.deepEqual(first.remaining, [keys(p)[1]]); fail = false;
  const retry = await h.api.launch(p, keys(p));
  assert.equal(retry.ok, true); assert.deepEqual(retry.opened, [keys(p)[1]]);
  assert.deepEqual(h.calls, [keys(p)[0], keys(p)[1], keys(p)[1]]);
  assert.equal((await h.api.launch(p, keys(p))).reason, 'already-opened');
}
{
  const h = harness(base(), { createTab() { throw new Error('Synchronous browser failure'); } }), p = h.api.preview();
  const result = await h.api.launch(p, keys(p));
  assert.equal(result.reason, 'partial'); assert.equal(result.opened.length, 0); assert.equal(result.failed.length, 2);
  assert.ok(result.failed.every(item => item.reason === 'Synchronous browser failure'));
}
// Lock spans side effects and local view edits stop the next create.
{
  const first = deferred(), h = harness(base(), { createTab(_url, number) { return number === 1 ? first.promise : Promise.resolve({ id: number }); } }), p = h.api.preview();
  const launching = h.api.launch(p, keys(p)); while (!h.calls.length) await tick();
  let writerEntered = false;
  const writer = h.coordinator.transaction(async () => { writerEntered = true; });
  await tick(); assert.equal(writerEntered, false, 'the read-only launch transaction still holds the workspace lock');
  h.setGroup('elsewhere'); first.resolve({ id: 1 });
  const result = await launching;
  assert.equal(result.reason, 'stale'); assert.deepEqual(result.opened, [keys(p)[0]]);
  assert.deepEqual(result.failed, [{ key: keys(p)[1], name: 'B', url: keys(p)[1], reason: 'stale' }]);
  assert.equal(h.calls.length, 1); await writer; assert.equal(writerEntered, true); assert.equal(h.writes.length, 0);
}
// Revalidation failure after a previous partial cannot replay the success.
{
  const h = harness(base(), { createTab(url) { if (url.includes('b.example')) return Promise.reject(new Error('retry')); return Promise.resolve(); } }), p = h.api.preview();
  assert.equal((await h.api.launch(p, keys(p))).reason, 'partial');
  h.durable.icons[1].url += '?changed';
  assert.equal((await h.api.launch(p, keys(p))).reason, 'stale'); assert.equal(h.calls.length, 2);
}
// A later snapshot failure still reports every not-opened name and URL.
{
  let h; h = harness(base(), { createTab() { h.options.snapshotError = true; return Promise.resolve({ id: 1 }); } });
  const p = h.api.preview(), result = await h.api.launch(p, keys(p));
  assert.equal(result.reason, 'read-failed'); assert.deepEqual(result.opened, [keys(p)[0]]);
  assert.deepEqual(result.failed, [{ key: keys(p)[1], name: 'B', url: keys(p)[1], reason: 'read-failed' }]);
  assert.equal(h.calls.length, 1);
}
console.log('Group launch core URL safety, scoping, stale-source guards, locking, partial failure and replay protection passed');
