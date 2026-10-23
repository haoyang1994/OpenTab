import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { contrastRatio } from './popup-appearance.mjs';

const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Workspace = require('../workspace-persistence.js');
const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const copy = value => structuredClone(value);
const epoch = Workspace.EPOCH_KEY;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  assert.fail('Popup did not reach the expected state');
}

function seed() {
  let graph = Schema.migrateLegacy({
    folders: [{ id: 'folder-home', name: 'Home', opaque: { keep: true } }, { id: 'personal-projects', name: 'Projects' }],
    icons: [{ id: 'personal-site', name: 'Personal', folderId: 'folder-home', opaque: { arbitrary: ['preserved'] } }],
    todos: [{ id: 'personal-task', text: 'Keep my task', done: false }],
    background: { type: 'gradient', value: 'local-background' },
    languagePreference: 'en', deviceMetadata: { untouched: true }, [epoch]: 4
  }, { defaultName: 'Personal', homeName: 'Home' });
  graph = Schema.create(graph, { id: 'work', name: 'Work', iconKey: 'book', homeGroupId: 'work-home', homeName: 'Home' });
  graph.folders.push({ id: 'work-projects', name: 'Projects', sceneId: 'work', parentId: 'work-home', metadata: { keep: 1 } });
  graph.icons.push({ id: 'work-folder', type: 'folder', name: 'Links', folderId: 'work-home' },
    { id: 'work-site', name: 'Work site', folderId: 'work-home', parentId: 'work-folder', uploadedIconDataUrl: 'data:image/png;base64,test', opaque: { vaultRef: 'opaque-reference' } });
  graph.todos.push({ id: 'work-task', text: 'Work task', sceneId: 'work', done: true });
  graph = Schema.create(graph, { id: 'archive', name: 'Archived', iconKey: 'box', homeGroupId: 'archive-home', homeName: 'Home' });
  graph.icons.push({ id: 'archived-site', name: 'Archived site', folderId: 'archive-home' });
  graph = Schema.archive(graph, { sceneId: 'archive', archivedAt: 123 });
  graph.lastOpenedSceneId = 'work'; graph.currentFolderId = 'work-projects';
  Schema.validate(graph);
  return graph;
}

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = new Map(); this.classes = new Set();
    this._value = ''; this.textContent = ''; this.disabled = false;
    this.attributes = new Map();
    this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  }
  set innerHTML(value) { assert.equal(value, ''); this.children = []; this._value = ''; }
  get innerHTML() { return ''; }
  set value(value) { this._value = this.tag === 'select' && !this.children.some(child => child.value === value) ? '' : value; }
  get value() { return this._value; }
  appendChild(child) { this.children.push(child); if (this.children.length === 1 && this.tag === 'select') this._value = child.value; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  select() {}
  dispatch(name, event = {}) { return this.listeners.get(name)?.(event); }
}

function harness(initial = seed(), { schema = Schema, tab = { url: 'https://example.com/article', title: 'Example article' }, tabWait, storageWait, math, date, systemDark = false } = {}) {
  const store = copy(initial), writes = [], reads = [], timers = [], queries = [];
  let fail = false, closed = 0, attemptedWrites = 0;
  const chrome = { runtime: {}, tabs: { async query(options) { queries.push(options); if (tabWait) await tabWait; return tab ? [tab] : []; } }, storage: { local: {
    async get(keys) { reads.push(keys); return copy(keys == null ? store : Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
    async set(patch) {
      attemptedWrites++;
      if (storageWait) await storageWait;
      if (fail) { fail = false; throw new Error('QUOTA_BYTES exceeded'); }
      writes.push(copy(patch)); Object.assign(store, copy(patch));
    }
  } } };
  const api = Workspace.forChrome(chrome);
  const elements = Object.fromEntries(['current-url', 'site-name', 'folder-select', 'save-btn', 'status']
    .map(id => [id, new Element(id === 'folder-select' ? 'select' : id === 'site-name' ? 'input' : 'div')]));
  const body = new Element('body'), styles = new Map();
  const media = { matches: systemDark, addEventListener(event, listener) { assert.equal(event, 'change'); this.listener = listener; } };
  const context = {
    chrome, OpenTabWorkspace: api, OpenTabSceneSchema: schema, URL,
    OpenTabIcons: {
      faviconCandidates: () => ['https://example.com/favicon.ico'],
      prepareRecord(record) { record.type = 'shortcut'; record.prepared = true; }
    },
    document: { body, documentElement: { style: { setProperty: (key, value) => styles.set(key, value) } }, getElementById: id => elements[id], createElement: tag => new Element(tag) },
    matchMedia(query) { assert.equal(query, '(prefers-color-scheme: dark)'); return media; },
    setTimeout(callback, delay) { timers.push({ callback, delay }); }, close() { closed++; }
  };
  if (math) context.Math = math;
  if (date) context.Date = date;
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'popup.js' });
  return {
    store, writes, reads, timers, queries, api, elements, body, styles,
    systemTheme(dark) { media.matches = dark; media.listener(); },
    input: elements['site-name'], select: elements['folder-select'], button: elements['save-btn'], status: elements.status,
    get closed() { return closed; }, get attemptedWrites() { return attemptedWrites; },
    failNext() { fail = true; },
    async ready() { await until(() => elements['folder-select'].children.length || elements.status.classes.has('error')); await tick(); },
    click: () => elements['save-btn'].dispatch('click'),
    enter: () => elements['site-name'].dispatch('keydown', { key: 'Enter' }),
    choose(id) { elements['folder-select'].value = id; elements['folder-select'].dispatch('change'); }
  };
}

// The real handler reads the whole graph, displays both memberships even with
// duplicate group names, and uses only the existing activeTab query.
{
  const initial = seed(), h = harness(initial); await h.ready();
  assert.equal(h.select.value, 'work-projects');
  assert.deepEqual(h.select.children.map(item => [item.value, item.textContent]), [
    ['folder-home', 'Personal / Home（默认）'], ['personal-projects', 'Personal / Projects'],
    ['work-home', 'Work / Home（默认）'], ['work-projects', 'Work / Projects']
  ]);
  assert.ok(h.reads.every(keys => keys === null), 'the complete graph is read under the coordinator lock');
  assert.deepEqual(copy(h.queries), [{ active: true, currentWindow: true }]);
  assert.equal(h.writes.length, 0, 'opening a popup does not migrate data or update the global scene');
  h.choose('personal-projects'); h.input.value = 'Explicit personal destination';
  await h.click();
  const added = h.store.icons.at(-1);
  assert.equal(added.folderId, 'personal-projects'); assert.equal(added.name, 'Explicit personal destination');
  assert.equal(added.url, 'https://example.com/article'); assert.equal(added.prepared, true);
  assert.equal(Object.hasOwn(added, 'sceneId'), false, 'icon ownership is derived from its group');
  assert.deepEqual(h.store.icons.slice(0, -1), initial.icons, 'append retains every other scene, archived item and opaque field');
  for (const [key, value] of Object.entries(initial)) if (key !== 'icons') assert.deepEqual(h.store[key], value, `preserve ${key}`);
  assert.deepEqual(Object.keys(h.writes[0]), ['icons'], 'schema 2 never rewrites or filters canonical groups');
  assert.equal(h.timers.length, 1); assert.equal(h.closed, 0); assert.equal(h.button.disabled, true);
  await h.click(); h.enter(); await tick(); assert.equal(h.writes.length, 1, 'successful save cannot double-submit during close delay');
}

for (const [changes, expected] of [
  [{ currentFolderId: 'personal-projects' }, 'work-home'],
  [{ currentFolderId: 'missing' }, 'work-home'],
  [{ lastOpenedSceneId: 'missing', currentFolderId: 'work-projects' }, 'folder-home'],
  [{ lastOpenedSceneId: 'archive', currentFolderId: 'archive-home' }, 'folder-home']
]) {
  const h = harness({ ...seed(), ...changes }); await h.ready(); assert.equal(h.select.value, expected);
}
{
  const graph = Schema.archive(seed(), { sceneId: Schema.DEFAULT_SCENE_ID, archivedAt: 456 });
  graph.lastOpenedSceneId = 'missing'; graph.currentFolderId = 'missing';
  const h = harness(graph); await h.ready(); assert.equal(h.select.value, 'work-home');
  assert.equal(h.select.children.some(option => option.value === 'folder-home'), false, 'archived default Home is not synthesized or shown');
  await h.click(); assert.equal(h.store.icons.at(-1).folderId, 'work-home'); assert.deepEqual(h.store.folders, graph.folders);
}

// Hold the real coordinator lock, then change the displayed destination before
// the click acquires it. Each rejected click must retain its draft and must not
// write or silently fall back to any Home group.
const staleCases = [
  ['removed group', graph => { graph.folders = graph.folders.filter(group => group.id !== 'work-projects'); return graph; }],
  ['archived scene', graph => Schema.archive(graph, { sceneId: 'work', archivedAt: 789 })],
  ['moved group', graph => Schema.moveGroup(graph, { groupId: 'work-projects', targetSceneId: Schema.DEFAULT_SCENE_ID })],
  ['reparented group', graph => { graph.folders.find(group => group.id === 'work-projects').parentId = ''; return graph; }],
  ['renamed group', graph => { graph.folders.find(group => group.id === 'work-projects').name = 'Changed Projects'; return graph; }],
  ['renamed scene', graph => Schema.rename(graph, { sceneId: 'work', name: 'Changed Work' })],
  ['replaced workspace epoch', graph => ({ ...graph, [epoch]: graph[epoch] + 1 })],
  ['removed scene', graph => {
    const groups = new Set(graph.folders.filter(group => group.sceneId === 'work').map(group => group.id));
    graph.scenes = graph.scenes.filter(scene => scene.id !== 'work'); graph.sceneProfiles = graph.sceneProfiles.filter(profile => profile.id !== 'work');
    graph.folders = graph.folders.filter(group => group.sceneId !== 'work'); graph.icons = graph.icons.filter(icon => !groups.has(icon.folderId));
    graph.todos = graph.todos.filter(todo => todo.sceneId !== 'work'); return graph;
  }]
];
for (const [reason, mutate] of staleCases) {
  const h = harness(); await h.ready(); h.input.value = `Unsent draft: ${reason}`;
  let release, entered = false;
  const hold = h.api.transaction(async ({ read, write }) => {
    entered = true; await new Promise(resolve => { release = resolve; });
    await write(mutate(await read(null)));
  });
  await until(() => entered);
  const save = h.click(); await tick();
  assert.equal(h.button.disabled, true); assert.equal(h.writes.length, 0); assert.equal(h.timers.length, 0);
  release(); await hold; const afterConcurrentChange = copy(h.store); await save;
  assert.deepEqual(h.store, afterConcurrentChange, `${reason}: stale popup performs no write`);
  assert.equal(h.writes.length, 1, `${reason}: only the lock owner wrote`);
  assert.equal(h.input.value, `Unsent draft: ${reason}`); assert.equal(h.input.disabled, false);
  assert.match(h.status.textContent, /保存位置已更改/); assert.equal(h.timers.length, 0);
  assert.equal(h.select.value, ''); assert.equal(h.button.disabled, true); assert.equal(h.select.disabled, false);
  await h.click(); h.enter(); await tick(); assert.equal(h.writes.length, 1, 'no implicit retry without a new selection');
  h.choose('personal-projects'); assert.equal(h.button.disabled, false); await h.click();
  assert.equal(h.store.icons.at(-1).folderId, 'personal-projects');
  assert.equal(h.store.icons.at(-1).name, `Unsent draft: ${reason}`);
}

// A queued append must preserve unrelated concurrent additions and all foreign
// records instead of saving the old opening snapshot or a visible projection.
{
  const h = harness(); await h.ready(); let release, entered = false;
  const hold = h.api.transaction(async ({ read, write }) => {
    entered = true; await new Promise(resolve => { release = resolve; });
    const latest = await read(null); latest.icons.push({ id: 'concurrent', name: 'Other tab', folderId: 'folder-home', metadata: { keep: 2 } });
    await write({ icons: latest.icons, lastOpenedSceneId: Schema.DEFAULT_SCENE_ID, currentFolderId: 'personal-projects' });
  });
  await until(() => entered); const save = h.click(); release(); await hold; await save;
  assert.equal(h.store.icons.at(-2).id, 'concurrent'); assert.equal(h.store.icons.at(-1).folderId, 'work-projects');
  assert.equal(h.store.lastOpenedSceneId, Schema.DEFAULT_SCENE_ID); assert.equal(h.store.currentFolderId, 'personal-projects');
  assert.equal(h.writes.length, 2);
}

// Storage errors never claim success, close the popup, discard the draft, or
// leave it permanently disabled; a user-initiated retry appends exactly once.
{
  const initial = seed(), h = harness(initial); await h.ready();
  h.input.value = 'Keep this draft'; h.failNext(); await h.click();
  assert.deepEqual(h.store, initial); assert.equal(h.writes.length, 0); assert.equal(h.attemptedWrites, 1);
  assert.equal(h.input.value, 'Keep this draft'); assert.equal(h.input.disabled, false); assert.equal(h.select.value, 'work-projects');
  assert.equal(h.button.disabled, false); assert.equal(h.select.disabled, false);
  assert.match(h.status.textContent, /保存失败/); assert.equal(h.timers.length, 0);
  await h.click(); assert.equal(h.writes.length, 1); assert.equal(h.store.icons.filter(icon => icon.name === 'Keep this draft').length, 1);
}
{
  let release; const storageWait = new Promise(resolve => { release = resolve; });
  const h = harness(seed(), { storageWait }); await h.ready();
  const pending = h.click(); await until(() => h.attemptedWrites === 1);
  await h.click(); h.enter(); await tick();
  assert.equal(h.attemptedWrites, 1); assert.equal(h.writes.length, 0); assert.equal(h.timers.length, 0);
  assert.equal(h.input.disabled, true); assert.equal(h.select.disabled, true);
  release(); await pending; assert.equal(h.writes.length, 1); assert.equal(h.timers.length, 1);
}

// Unknown, partial, damaged or unsupported graphs fail closed on opening and
// on a later save, without a popup migration or phantom folder-home repair.
const invalidGraphs = [
  { ...seed(), [Schema.SCHEMA_KEY]: 99 },
  { ...seed(), [Schema.SCHEMA_KEY]: '2' },
  Object.fromEntries(Object.entries(seed()).filter(([key]) => key !== Schema.SCHEMA_KEY)),
  { folders: [{ id: 'partial', name: 'Partial', sceneId: 'work' }], icons: [] },
  { icons: [{ id: 'partial', sceneId: 'work' }], folders: [] },
  { todos: [{ id: 'partial', text: '', sceneId: 'work' }], folders: [] },
  { scenes: [], folders: [] }, { sceneProfiles: [], folders: [] },
  { ...seed(), folders: seed().folders.filter(folder => folder.id !== 'folder-home') },
  { ...seed(), icons: undefined }
];
for (const initial of invalidGraphs) {
  const h = harness(initial); await h.ready(); assert.equal(h.button.disabled, true); assert.equal(h.select.disabled, true);
  assert.match(h.status.textContent, /场景数据暂不可用/); h.input.value = 'Do not save'; await h.click(); h.enter(); await tick();
  assert.deepEqual(h.store, initial); assert.equal(h.writes.length, 0); assert.equal(h.select.children.length, 0); assert.equal(h.timers.length, 0);
}
{
  const missing = harness(seed(), { schema: null }); await missing.ready();
  assert.equal(missing.button.disabled, true); assert.match(missing.status.textContent, /场景数据暂不可用/); assert.equal(missing.writes.length, 0);
}
{
  const h = harness(); await h.ready(); h.input.value = 'Unsent after external replacement';
  h.store[Schema.SCHEMA_KEY] = 9; const before = copy(h.store); await h.click();
  assert.deepEqual(h.store, before); assert.equal(h.writes.length, 0); assert.equal(h.button.disabled, true);
  assert.equal(h.input.value, 'Unsent after external replacement'); assert.match(h.status.textContent, /场景数据暂不可用/);
}

// Legacy storage stays legacy, including implicit Home and arbitrary folder
// metadata. Only unsafe silent fallback on a stale destination is removed.
{
  const initial = { icons: [{ id: 'legacy', name: 'Keep me', opaque: 7 }], folders: [{ id: 'legacy-group', name: 'Legacy group', metadata: { keep: true } }], currentFolderId: 'legacy-group' };
  const h = harness(initial, { schema: null }); await h.ready();
  assert.equal(h.select.value, 'folder-home'); assert.deepEqual(h.select.children.map(item => item.textContent), ['Legacy group', '主页（默认）']);
  h.choose('legacy-group'); await h.click();
  assert.deepEqual(h.store.icons[0], initial.icons[0]); assert.deepEqual(h.store.folders[0], initial.folders[0]);
  assert.equal(h.store.icons.at(-1).folderId, 'legacy-group'); assert.equal(h.store.currentFolderId, 'legacy-group');
  assert.equal(Object.hasOwn(h.store, Schema.SCHEMA_KEY), false); assert.equal(Object.hasOwn(h.store, 'scenes'), false);
}
{
  const h = harness({ folders: [{ id: 'legacy-group', name: 'Legacy group' }], icons: [] }); await h.ready();
  h.choose('legacy-group'); h.store.folders = []; await h.click();
  assert.equal(h.writes.length, 0); assert.equal(h.store.icons.length, 0); assert.equal(h.select.value, '');
  h.choose('folder-home'); await h.click(); assert.equal(h.store.icons.at(-1).folderId, 'folder-home');
}
{
  const h = harness({}, { schema: null }); await h.ready(); await h.click();
  assert.equal(h.store.folders[0].id, 'folder-home'); assert.equal(h.store.icons.length, 1);
}

// Early keyboard events, unsupported tabs, empty names and improbable random
// ID collisions cannot turn into unexpected writes or duplicate identifiers.
{
  let release; const tabWait = new Promise(resolve => { release = resolve; });
  const h = harness(seed(), { tabWait }); h.input.value = 'Too early'; h.enter(); await h.click(); await tick();
  assert.equal(h.writes.length, 0); assert.equal(h.button.disabled, true);
  release(); await h.ready(); assert.equal(h.button.disabled, false);
  h.input.value = '   '; await h.click(); assert.equal(h.writes.length, 0); assert.match(h.status.textContent, /请输入名称/);
  assert.equal(h.input.attributes.get('aria-invalid'), 'true');
  h.input.value = 'Corrected'; h.input.dispatch('input'); assert.equal(h.input.attributes.has('aria-invalid'), false);
}
for (const tab of [null, { url: 'chrome://newtab/', title: 'New tab' }]) {
  const h = harness(seed(), { tab }); await h.ready(); h.input.value = 'Cannot save'; h.enter(); await h.click(); await tick();
  assert.equal(h.writes.length, 0); assert.equal(h.button.disabled, true); assert.equal(h.timers.length, 0);
  const reason = h.status.textContent;
  assert.match(reason, /普通网页/);
  h.choose('personal-projects');
  assert.equal(h.status.textContent, reason, 'choosing a destination cannot erase unsupported-page feedback');
  assert.equal(h.status.classes.has('error'), true); assert.equal(h.button.disabled, true);
  assert.equal(h.button.attributes.get('aria-busy'), 'false');
}
{
  const graph = seed(); graph.icons.push({ id: '1i', name: 'Collision', folderId: 'folder-home' });
  const h = harness(graph, { math: { random: () => 0.5 }, date: { now: () => 1 } }); await h.ready(); await h.click();
  assert.equal(h.store.icons.at(-1).id, '1i-1'); assert.deepEqual(h.store.icons.slice(0, -1), graph.icons);
  assert.equal(new Set(h.store.icons.map(icon => icon.id)).size, h.store.icons.length);
}

// Appearance follows the existing global settings but never persists defaults,
// migrates storage, or enables an unsupported page. System changes affect auto only.
for (const themeMode of ['dark', 'light', 'auto']) for (const systemDark of [false, true]) {
  const initial = { ...seed(), themeMode, accentHue: 284 };
  const h = harness(initial, { systemDark }); await h.ready();
  assert.equal(h.body.classes.has('theme-light'), themeMode === 'light' || (themeMode === 'auto' && !systemDark));
  assert.equal(h.styles.get('--accent-hue'), '284');
  h.systemTheme(!systemDark);
  assert.equal(h.body.classes.has('theme-light'), themeMode === 'light' || (themeMode === 'auto' && systemDark));
  assert.deepEqual(h.store, initial); assert.equal(h.writes.length, 0);
}
for (const [initial, light] of [[{}, true], [seed(), false], [{ ...seed(), themeMode: 'unknown', accentHue: 'broken' }, false]]) {
  const h = harness(initial); await h.ready();
  assert.equal(h.body.classes.has('theme-light'), light); assert.equal(h.styles.get('--accent-hue'), '200');
  assert.deepEqual(h.store, initial); assert.equal(h.writes.length, 0);
}
{
  const h = harness({ ...seed(), themeMode: 'light' }, { tab: null }); await h.ready();
  assert.equal(h.body.classes.has('theme-light'), true); assert.equal(h.button.disabled, true);
  assert.match(h.status.textContent, /普通网页/);
}

// Keep the deliberately small standalone CSS aligned with the canonical form
// palette without adding homepage CSS, scripts, or requests to the popup.
const css = fs.readFileSync(new URL('../popup.css', import.meta.url), 'utf8');
const homeCss = fs.readFileSync(new URL('../home.css', import.meta.url), 'utf8');
for (const selector of [':root', 'body.theme-light']) {
  const block = text => text.slice(text.lastIndexOf(`${selector} {`)).split('}')[0];
  for (const token of ['surface', 'field', 'border', 'text', 'muted']) {
    const pattern = new RegExp(`--form-${token}: ([^;]+);`);
    assert.equal(block(css).match(pattern)?.[1], block(homeCss).match(pattern)?.[1], `${selector} form ${token} matches homepage`);
  }
  const color = token => block(css).match(new RegExp(`--${token}: (#[\\da-f]{6});`, 'i'))?.[1];
  assert.ok(color('focus-ring'), 'the focus outline must not depend on arbitrary accent hue');
  for (const surface of ['form-surface', 'form-field']) {
    assert.ok(contrastRatio(color('focus-ring'), color(surface)) >= 3, `${selector} outline contrasts with ${surface}`);
  }
}
assert.equal(contrastRatio('#000000', '#ffffff'), 21);
assert.equal(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)'), 21);
for (const themeMode of ['light', 'dark']) for (const accentHue of [0, 60, 146, 200, 240, 284, 360]) {
  const initial = { ...seed(), themeMode, accentHue }, h = harness(initial); await h.ready();
  assert.equal(h.styles.get('--accent-hue'), String(accentHue), 'preserve user accent for the decorative halo');
  assert.equal(h.styles.has('--focus-ring'), false, 'runtime accent must not override the contrast-safe outline');
  assert.deepEqual(h.store, initial); assert.equal(h.writes.length, 0);
}
assert.match(css, /\.primary:hover:not\(:disabled\)/);
assert.match(css, /\.primary:disabled\s*\{[^}]*background: var\(--disabled-bg\)/);
assert.match(css, /\.primary:focus-visible\s*\{[^}]*outline:/);
assert.match(css, /input:focus-visible,\s*select:focus-visible,\s*\.primary:focus-visible\s*\{[^}]*outline: 2px solid var\(--focus-ring\)/);
assert.match(css, /prefers-reduced-motion: reduce/);
const html = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
assert.match(html, /id="status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
assert.doesNotMatch(html, /(?:home\.css|boot\.js)/);

console.log('scene popup: actual handlers, destination guards, appearance, accessible state, failure recovery and legacy behavior passed');
