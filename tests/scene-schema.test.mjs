import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Scene = require('../scene-schema.js');
const { SCHEMA_KEY, VERSION, DEFAULT_SCENE_ID: DEFAULT, HOME_GROUP_ID: HOME } = Scene;
const copy = value => structuredClone(value);
let cases = 0;
function test(name, run) { run(); cases++; console.log(`scene-schema: ${name}`); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function error(code, run, path) {
  assert.throws(run, value => {
    assert.ok(value instanceof Scene.SceneSchemaError);
    assert.equal(value.name, 'SceneSchemaError');
    assert.equal(value.recoverable, true);
    assert.equal(value.code, code);
    assert.equal(typeof value.path, 'string');
    if (path) assert.equal(value.path, path);
    return true;
  });
}
const createWork = state => Scene.create(state, { id: 'scene-work', name: 'Work', iconKey: 'briefcase', homeGroupId: 'work-home', homeName: 'Work home' });
const legacy = () => ({
  folders: [
    { id: 'work', name: 'User work', parentId: HOME, type: 'group', unknown: { a: [1, 2] } },
    { id: HOME, name: 'My original Home', color: 'teal' },
    { id: 'child', name: 'Child', parentId: 'work' },
    { id: 'grandchild', name: 'Grandchild', parentId: 'child' },
    { id: 'spare', name: 'Spare' }
  ],
  icons: [
    { id: 'ssh-existing', type: 'ssh', folderId: 'work', name: 'Server', sshHost: 'host.example', sshPassword: 'synthetic-password', sshGatewayToken: 'synthetic-token', sshSocksPassword: 'synthetic-socks', secretRef: 'vault:ssh-existing' },
    { id: 'upload-existing', type: 'shortcut', folderId: 'child', name: 'Image', url: 'https://example.test/', uploadedIconDataUrl: 'data:image/png;base64,c3ludGhldGlj', iconSource: { kind: 'upload', checksum: 'test-only' } },
    { id: 'icon-folder', type: 'folder', folderId: 'grandchild', name: 'Nested icons', parentId: '' },
    { id: 'inside-icon-folder', type: 'shortcut', folderId: 'grandchild', parentId: 'icon-folder', name: 'Child icon' },
    { id: 'home-icon', type: 'tool', folderId: HOME, toolSubtype: 'json' },
    { id: 'spare-icon', type: 'shortcut', folderId: 'spare' }
  ],
  todos: [{ id: 'todo-two', text: 'Second first', done: true, unknown: [1] }, { id: 'todo-one', text: 'First second', done: false }],
  currentFolderId: 'work',
  background: { type: 'image', value: 'data:image/jpeg;base64,c3ludGhldGlj', source: 'upload', extra: { keep: true } },
  bingIndex: 3, layoutIconSize: 80, layoutColumns: 6, layoutShowNames: false, layoutMaxWidth: 1200,
  weatherLocation: 'Synthetic city', searchEngine: 'custom', searchHistory: ['kept'], themeMode: 'light', accentHue: 220, uiBlur: 12, timezone: 'Etc/UTC', todoButtonVisible: false,
  'opentab.secretVault': { version: 1, encrypted: 'synthetic-ciphertext', byId: { 'ssh-existing': 'synthetic-reference' } },
  'opentab.cryptoKey': { wrapped: 'synthetic-wrapped-key' },
  'unrelated.feature': { nested: [{ id: 'opaque', untouched: true }], optional: undefined }
});
const populated = () => createWork(Scene.migrateLegacy(legacy()));

// Module loading is inert apart from its UMD export; no browser APIs are needed.
test('UMD and CommonJS exports are available without activation or startup work', () => {
  const code = fs.readFileSync(new URL('../scene-schema.js', import.meta.url), 'utf8');
  const sandbox = {};
  for (const key of ['chrome', 'document', 'window', 'localStorage', 'fetch', 'setTimeout', 'navigator']) {
    Object.defineProperty(sandbox, key, { get() { throw Error(`Unexpected ${key} access`); } });
  }
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  assert.equal(sandbox.OpenTabSceneSchema.VERSION, 2);
  assert.equal(SCHEMA_KEY, 'opentab.sceneSchemaVersion');
  assert.equal(DEFAULT, 'scene-default');
  assert.equal(HOME, 'folder-home');
  assert.equal(typeof sandbox.OpenTabSceneSchema.migrateLegacy, 'function');
  assert.equal(Scene.validate(Scene.migrateLegacy({})), true);
});

test('empty legacy storage materializes one Home and caller-localized labels', () => {
  const raw = freeze({});
  const state = Scene.migrateLegacy(raw, { defaultName: '默认场景', homeName: '主页' });
  assert.equal(state[SCHEMA_KEY], VERSION);
  assert.deepEqual(state.scenes, [{ id: DEFAULT, name: '默认场景', iconKey: 'home', homeGroupId: HOME, archivedAt: null }]);
  assert.deepEqual(state.folders, [{ id: HOME, name: '主页', sceneId: DEFAULT }]);
  assert.deepEqual(state.icons, []); assert.deepEqual(state.todos, []);
  assert.deepEqual(state.sceneProfiles, [{ id: DEFAULT, background: { type: 'bing', value: '', source: '' }, bingIndex: 0, layoutIconSize: 56, layoutColumns: 0, layoutShowNames: true, layoutMaxWidth: 900 }]);
  assert.deepEqual(raw, {});
});

test('implicit legacy, explicitly installed, and newly created scene backgrounds stay distinct', () => {
  const implicit = { type: 'bing', value: '', source: '' };
  const installed = { type: 'image', value: 'assets/default_background/default.webp', source: 'preset' };
  const legacyState = Scene.migrateLegacy({});
  assert.deepEqual(legacyState.sceneProfiles[0].background, implicit);
  assert.ok(!Object.hasOwn(legacyState, 'background'), 'absent legacy global background remains absent');
  const freshInstalled = Scene.migrateLegacy(freeze({ background: installed }));
  assert.deepEqual(freshInstalled.background, installed);
  assert.deepEqual(freshInstalled.sceneProfiles[0].background, installed);
  const withNewScene = createWork(legacyState);
  assert.deepEqual(withNewScene.sceneProfiles[0].background, implicit, 'new scene does not alter default scene');
  assert.deepEqual(withNewScene.sceneProfiles[1].background, installed, 'new scene uses a bundled image without requesting Bing');
});

test('implicit Home membership is materialized only for missing/null/empty values', () => {
  const raw = freeze({ folders: [{ id: 'provided-group', name: 'Keep' }], icons: [
    { id: 'missing' }, { id: 'null', folderId: null }, { id: 'empty', folderId: '' },
    { id: 'undefined', folderId: undefined }, { id: 'provided', folderId: 'provided-group' }
  ] });
  const state = Scene.migrateLegacy(raw);
  assert.deepEqual(state.icons.map(icon => icon.folderId), [HOME, HOME, HOME, HOME, 'provided-group']);
  assert.deepEqual(state.icons.map(icon => icon.id), raw.icons.map(icon => icon.id));
  assert.deepEqual(state.folders.map(group => group.id), [HOME, 'provided-group']);
  assert.ok(!Object.hasOwn(raw.icons[0], 'folderId'));
  for (const value of [false, 0, 12, [], {}, 'missing-group', ' ']) {
    const bad = { icons: [{ id: 'bad', folderId: value }] };
    error(typeof value === 'string' && value.trim() ? 'GROUP_NOT_FOUND' : 'INVALID_STRING', () => Scene.migrateLegacy(bad));
  }
});

test('legacy IDs, array order, custom Home, uploads, SSH values, and opaque fields survive', () => {
  const raw = freeze(legacy()), before = copy(raw), state = Scene.migrateLegacy(raw, { defaultName: 'Personal', homeName: 'Do not replace' });
  assert.deepEqual(raw, before);
  for (const key of ['icons', 'folders', 'todos']) assert.deepEqual(state[key].map(item => item.id), raw[key].map(item => item.id));
  assert.deepEqual(state.icons, raw.icons);
  assert.deepEqual(state.folders, raw.folders.map(group => ({ ...group, sceneId: DEFAULT })));
  assert.deepEqual(state.todos, raw.todos.map(todo => ({ ...todo, sceneId: DEFAULT })));
  assert.equal(state.folders.find(group => group.id === HOME).name, 'My original Home');
  assert.deepEqual(state.sceneProfiles[0], { id: DEFAULT, ...Object.fromEntries(Scene.PROFILE_KEYS.map(key => [key, raw[key]])) });
  for (const [key, value] of Object.entries(raw)) if (!['icons', 'folders', 'todos'].includes(key)) assert.deepEqual(state[key], value, `${key} must survive`);
  assert.ok(!Object.hasOwn(state.icons[0], 'sceneId'));
  assert.notEqual(state['opentab.secretVault'], raw['opentab.secretVault']);
  assert.notEqual(state.icons[1].iconSource, raw.icons[1].iconSource);
  assert.notEqual(state.background, state.sceneProfiles[0].background);
});

test('v2 migration is idempotent, deep-cloned, and ignores new legacy naming options', () => {
  const state = freeze(populated()), before = copy(state);
  const next = Scene.migrateLegacy(state, { defaultName: 'Do not rename', homeName: 'Do not rename Home' });
  assert.deepEqual(next, before); assert.notEqual(next, state); assert.notEqual(next.folders[0].unknown, state.folders[0].unknown);
  next.sceneProfiles[0].background.extra.keep = false;
  assert.equal(state.sceneProfiles[0].background.extra.keep, true);
  assert.deepEqual(state, before);
});

test('unknown or malformed versions never fall back to legacy migration', () => {
  for (const value of [1, 3, 99]) error('UNSUPPORTED_SCHEMA', () => Scene.migrateLegacy({ [SCHEMA_KEY]: value, icons: [] }), SCHEMA_KEY);
  for (const value of [undefined, null, '2', 0, -1, NaN, Infinity, 2.5, true, {}]) {
    error('INVALID_SCHEMA_VERSION', () => Scene.migrateLegacy({ [SCHEMA_KEY]: value }), SCHEMA_KEY);
  }
  error('SCHEMA_REQUIRED', () => Scene.validate({}));
  error('INVALID_LIST', () => Scene.migrateLegacy({ [SCHEMA_KEY]: VERSION }));
  for (const value of [null, [], 'bad', 1]) error('INVALID_RECORD', () => Scene.migrateLegacy(value));
  for (const raw of [{ scenes: [] }, { sceneProfiles: [] }, { folders: [{ id: HOME, name: 'Home', sceneId: DEFAULT }] }, { todos: [{ id: 't', text: 'text', sceneId: DEFAULT }] }, { icons: [{ id: 'i', sceneId: DEFAULT }] }]) error('PARTIAL_SCHEMA', () => Scene.migrateLegacy(raw));
});

test('malformed provided lists and entities are rejected, never filtered or repaired', () => {
  for (const key of ['icons', 'folders', 'todos']) {
    for (const value of [null, {}, 'bad', false]) error('INVALID_LIST', () => Scene.migrateLegacy({ [key]: value }));
    for (const value of [[null], [false], [{}], [{ id: '' }], [{ id: 1 }], new Array(1)]) {
      error(value[0] && typeof value[0] === 'object' ? 'INVALID_STRING' : 'INVALID_RECORD', () => Scene.migrateLegacy({ [key]: value }));
    }
    error('DUPLICATE_ID', () => Scene.migrateLegacy({ [key]: [{ id: 'duplicate', name: 'A', text: 'A' }, { id: 'duplicate', name: 'B', text: 'B' }] }));
  }
  error('INVALID_STRING', () => Scene.migrateLegacy({ folders: [{ id: HOME }] }));
  error('INVALID_TODO', () => Scene.migrateLegacy({ todos: [{ id: 't' }] }));
  error('INVALID_TODO', () => Scene.migrateLegacy({ todos: [{ id: 't', text: 'text', done: 'true' }] }));
  assert.equal(Scene.validate(Scene.migrateLegacy({ todos: [{ id: 't', text: '' }] })), true, 'legacy omitted done remains implicit false, not synthesized');
  error('INVALID_STRING', () => Scene.migrateLegacy({}, { defaultName: '' }));
  error('INVALID_STRING', () => Scene.migrateLegacy({}, { homeName: '' }));
});

test('all v2 collection identities, memberships, Homes and profiles are validated', () => {
  const invalid = (code, change) => { const state = populated(); change(state); error(code, () => Scene.validate(state)); error(code, () => Scene.migrateLegacy(state)); };
  invalid('ID_COLLISION', state => { state.folders.push({ id: 'scene-work', name: 'Collision', sceneId: DEFAULT }); });
  invalid('DEFAULT_SCENE_REQUIRED', state => { state.scenes = state.scenes.filter(scene => scene.id !== DEFAULT); });
  invalid('INVALID_HOME', state => { state.scenes[0].homeGroupId = 'absent'; });
  invalid('INVALID_DEFAULT_HOME', state => { state.scenes[0].homeGroupId = 'spare'; });
  invalid('INVALID_HOME', state => { state.scenes[1].homeGroupId = 'spare'; });
  invalid('DUPLICATE_HOME', state => { state.scenes[1].homeGroupId = HOME; });
  invalid('HOME_HAS_PARENT', state => { state.folders.find(group => group.id === HOME).parentId = 'spare'; });
  invalid('PROFILE_REQUIRED', state => { state.sceneProfiles.pop(); });
  invalid('ORPHAN_PROFILE', state => { state.sceneProfiles.push({ ...state.sceneProfiles[0], id: 'missing' }); });
  invalid('DUPLICATE_ID', state => { state.sceneProfiles.push(copy(state.sceneProfiles[0])); });
  invalid('SCENE_NOT_FOUND', state => { state.folders[0].sceneId = 'missing'; });
  invalid('SCENE_NOT_FOUND', state => { state.todos[0].sceneId = 'missing'; });
  invalid('ICON_SCENE_FORBIDDEN', state => { state.icons[0].sceneId = DEFAULT; });
  invalid('GROUP_NOT_FOUND', state => { state.icons[0].folderId = 'missing'; });
  invalid('INVALID_STRING', state => { delete state.icons[0].folderId; });
  invalid('ACTIVE_SCENE_REQUIRED', state => { state.scenes.forEach(scene => { scene.archivedAt = 0; }); });
  for (const value of [undefined, '', -1, 1.5, Infinity, '2026-10-22T00:00:00Z']) invalid('INVALID_TIMESTAMP', state => { state.scenes[1].archivedAt = value; });
});

test('parent graphs reject orphan, cross-scene/cross-group and cyclic links', () => {
  const invalid = (code, change) => { const state = populated(); change(state); error(code, () => Scene.validate(state)); };
  invalid('PARENT_NOT_FOUND', state => { state.folders[0].parentId = 'absent'; });
  invalid('CROSS_SCENE_PARENT', state => { state.folders[0].parentId = 'work-home'; });
  invalid('PARENT_CYCLE', state => { state.folders[0].parentId = 'grandchild'; });
  invalid('INVALID_ICON_PARENT', state => { state.icons[0].parentId = 'absent'; });
  invalid('INVALID_ICON_PARENT', state => { state.icons[0].parentId = 'spare-icon'; });
  invalid('CROSS_GROUP_ICON_PARENT', state => { state.icons[0].parentId = 'icon-folder'; });
  invalid('NESTED_ICON_FOLDER', state => { state.icons[2].parentId = 'icon-folder'; });
  invalid('NESTED_ICON_FOLDER', state => { state.icons.push({ id: 'nested-icon-folder', type: 'folder', folderId: 'grandchild', parentId: 'icon-folder' }); });
  invalid('INVALID_STRING', state => { state.folders[0].parentId = 123; });
});

test('profile schema is scene-local only and never silently normalizes supplied values', () => {
  for (const key of ['weatherLocation', 'searchEngine', 'themeMode', 'accentHue', 'uiBlur', 'timezone', 'todoButtonVisible']) {
    const state = populated(); state.sceneProfiles[0][key] = 'not scene-local';
    error('INVALID_PROFILE_FIELD', () => Scene.validate(state));
  }
  for (const [key, values] of [
    ['background', [null, 'url']], ['bingIndex', [-1, 0.2, '0', Infinity]],
    ['layoutIconSize', [47, 97, '56', null]], ['layoutColumns', [1, 3, 13, 4.5, 'auto']],
    ['layoutShowNames', [0, 'false', null]], ['layoutMaxWidth', [639, 1601, NaN]]
  ]) for (const value of values) {
    error(key === 'background' ? 'INVALID_RECORD' : 'INVALID_PROFILE_VALUE', () => Scene.migrateLegacy({ [key]: value }));
  }
  const state = populated(); delete state.sceneProfiles[0].layoutColumns;
  error('INVALID_PROFILE_VALUE', () => Scene.validate(state));
});

test('create uses explicit IDs, isolated defaults, cloned input and stable original collections', () => {
  const state = freeze(Scene.migrateLegacy(legacy())), before = copy(state);
  const command = freeze({ id: 'new-scene', name: 'Study', iconKey: 'book', homeGroupId: 'study-home', homeName: 'Library', profile: { layoutColumns: 8, background: { type: 'color', value: '#123456', extra: ['retain'] } } });
  const next = Scene.create(state, command);
  assert.deepEqual(state, before);
  assert.deepEqual(next.icons, state.icons); assert.deepEqual(next.todos, state.todos);
  assert.deepEqual(next.folders.slice(0, -1), state.folders);
  assert.deepEqual(next.scenes.at(-1), { id: 'new-scene', name: 'Study', iconKey: 'book', homeGroupId: 'study-home', archivedAt: null });
  assert.equal(next.sceneProfiles.at(-1).layoutColumns, 8);
  assert.equal(next.sceneProfiles.at(-1).layoutIconSize, 56, 'new scene starts from defaults, not another scene');
  next.sceneProfiles.at(-1).background.extra.push('new');
  assert.deepEqual(command.profile.background.extra, ['retain']);
  error('DUPLICATE_ID', () => createWork(createWork(state)));
  error('DUPLICATE_ID', () => Scene.create(state, { ...command, homeGroupId: HOME }));
  error('DUPLICATE_ID', () => Scene.create(state, { ...command, id: 'work' }));
  error('DUPLICATE_ID', () => Scene.create(state, { ...command, homeGroupId: DEFAULT }));
  error('ID_COLLISION', () => Scene.create(state, { ...command, homeGroupId: command.id }));
  error('INVALID_STRING', () => Scene.create(state, { ...command, id: '' }));
  error('INVALID_PROFILE_FIELD', () => Scene.create(state, { ...command, profile: { todoButtonVisible: false } }));
  error('INVALID_PROFILE_FIELD', () => Scene.create(state, { ...command, profile: { id: 'wrong' } }));
});

test('rename changes scene label only and retains the original Home name and all other data', () => {
  const state = freeze(populated()), next = Scene.rename(state, { sceneId: DEFAULT, name: '个人' });
  const expected = copy(state); expected.scenes[0].name = '个人';
  assert.deepEqual(next, expected);
  error('INVALID_STRING', () => Scene.rename(state, { sceneId: DEFAULT, name: ' ' }));
  error('SCENE_NOT_FOUND', () => Scene.rename(state, { sceneId: 'missing', name: 'X' }));
});

test('archive retains every entity and secret, blocks last active scene, and restores losslessly', () => {
  const state = freeze(populated()), archived = Scene.archive(state, { sceneId: DEFAULT, archivedAt: 1792627200000 });
  const expected = copy(state); expected.scenes[0].archivedAt = 1792627200000;
  assert.deepEqual(archived, expected);
  assert.deepEqual(Scene.restore(archived, { sceneId: DEFAULT }), state);
  assert.deepEqual(Scene.restore(state, { sceneId: DEFAULT }), state);
  error('LAST_ACTIVE_SCENE', () => Scene.archive(archived, { sceneId: 'scene-work', archivedAt: 1 }));
  error('LAST_ACTIVE_SCENE', () => Scene.archive(Scene.migrateLegacy({}), { sceneId: DEFAULT, archivedAt: 1 }));
  error('SCENE_ARCHIVED', () => Scene.project(archived, DEFAULT));
  error('SCENE_ARCHIVED', () => Scene.rename(archived, { sceneId: DEFAULT, name: 'X' }));
  error('SCENE_ARCHIVED', () => Scene.archive(archived, { sceneId: DEFAULT, archivedAt: 2 }));
  error('INVALID_TIMESTAMP', () => Scene.archive(state, { sceneId: DEFAULT, archivedAt: null }));
  error('INVALID_TIMESTAMP', () => Scene.archive(state, { sceneId: DEFAULT }));
  error('SCENE_NOT_FOUND', () => Scene.restore(state, { sceneId: 'missing' }));
  assert.equal(Scene.archive(state, { sceneId: DEFAULT, archivedAt: 0 }).scenes[0].archivedAt, 0, 'zero timestamp is archived, not falsy active');
});

test('whole-group move includes descendants while IDs/order/uploads/SSH/todos remain stable', () => {
  const state = freeze(populated()), next = Scene.moveGroup(state, { groupId: 'work', targetSceneId: 'scene-work', targetParentId: 'work-home' });
  assert.deepEqual(next.icons, state.icons);
  assert.deepEqual(next.todos, state.todos);
  assert.deepEqual(next.scenes, state.scenes);
  assert.deepEqual(next.sceneProfiles, state.sceneProfiles);
  const expected = copy(state);
  for (const group of expected.folders) if (['work', 'child', 'grandchild'].includes(group.id)) group.sceneId = 'scene-work';
  expected.folders[0].parentId = 'work-home';
  assert.deepEqual(next, expected);
  assert.deepEqual(Scene.project(next, 'scene-work').icons.map(icon => icon.id), ['ssh-existing', 'upload-existing', 'icon-folder', 'inside-icon-folder']);
  assert.deepEqual(Scene.project(next, DEFAULT).icons.map(icon => icon.id), ['home-icon', 'spare-icon']);
  assert.deepEqual(Scene.project(next, DEFAULT).todos, state.todos);
  assert.deepEqual(Scene.project(next, 'scene-work').todos, []);
  assert.deepEqual(Scene.moveGroup(next, { groupId: 'work', targetSceneId: DEFAULT, targetParentId: HOME }), state);
});

test('move validates active destinations, protected Homes, parents, and cycle prevention', () => {
  const state = freeze(populated());
  error('HOME_MOVE_FORBIDDEN', () => Scene.moveGroup(state, { groupId: HOME, targetSceneId: 'scene-work' }));
  error('HOME_MOVE_FORBIDDEN', () => Scene.moveGroup(state, { groupId: 'work-home', targetSceneId: DEFAULT }));
  error('SCENE_NOT_FOUND', () => Scene.moveGroup(state, { groupId: 'work', targetSceneId: 'missing' }));
  error('GROUP_NOT_FOUND', () => Scene.moveGroup(state, { groupId: 'missing', targetSceneId: DEFAULT }));
  error('PARENT_NOT_FOUND', () => Scene.moveGroup(state, { groupId: 'work', targetSceneId: DEFAULT, targetParentId: 'missing' }));
  error('CROSS_SCENE_PARENT', () => Scene.moveGroup(state, { groupId: 'work', targetSceneId: 'scene-work', targetParentId: HOME }));
  for (const targetParentId of ['work', 'child', 'grandchild']) error('PARENT_CYCLE', () => Scene.moveGroup(state, { groupId: 'work', targetSceneId: DEFAULT, targetParentId }));
  const archivedTarget = Scene.archive(state, { sceneId: 'scene-work', archivedAt: 1 });
  error('SCENE_ARCHIVED', () => Scene.moveGroup(archivedTarget, { groupId: 'work', targetSceneId: 'scene-work' }));
  const archivedSource = Scene.archive(state, { sceneId: DEFAULT, archivedAt: 1 });
  error('SCENE_ARCHIVED', () => Scene.moveGroup(archivedSource, { groupId: 'work', targetSceneId: 'scene-work' }));
  const root = Scene.moveGroup(state, { groupId: 'work', targetSceneId: 'scene-work' });
  assert.equal(root.folders[0].parentId, '');
  assert.equal(root.folders[2].parentId, 'work');
  assert.deepEqual(Scene.moveGroup(state, { groupId: 'spare', targetSceneId: DEFAULT }), state, 'a same-scene root move is a cloned no-op');
});

test('projection is a detached scene-only view, never a full-state persistence patch', () => {
  let state = populated();
  state = Scene.moveGroup(state, { groupId: 'work', targetSceneId: 'scene-work' });
  state.todos.push({ id: 'work-todo', text: 'Work task', done: false, sceneId: 'scene-work' });
  const before = copy(state); freeze(state);
  const view = Scene.project(state, 'scene-work');
  assert.deepEqual(Object.keys(view).sort(), ['scene', 'profile', 'folders', 'icons', 'todos'].sort());
  assert.equal(view.scene.id, 'scene-work'); assert.equal(view.profile.id, 'scene-work');
  assert.ok(view.folders.every(group => group.sceneId === 'scene-work'));
  assert.deepEqual(view.todos.map(todo => todo.id), ['work-todo']);
  assert.ok(!Object.hasOwn(view, 'scenes')); assert.ok(!Object.hasOwn(view, SCHEMA_KEY));
  view.scene.name = 'Changed view'; view.profile.background.value = 'Changed view';
  view.folders[0].unknown.a.push(3); view.icons[1].iconSource.kind = 'Changed view'; view.todos[0].text = 'Changed view';
  view.folders.pop(); view.icons.reverse();
  assert.deepEqual(state, before);
  error('SCENE_NOT_FOUND', () => Scene.project(state, 'missing'));
});

test('unknown own properties survive safely and cyclic data fails without changing input', () => {
  const raw = JSON.parse('{"__proto__":{"keep":"data"},"constructor":{"unknown":true}}');
  raw.unrelated = { optional: undefined };
  const state = Scene.migrateLegacy(raw);
  assert.ok(Object.hasOwn(state, '__proto__')); assert.equal(Object.getPrototypeOf(state), Object.prototype);
  assert.deepEqual(state.__proto__, { keep: 'data' }); assert.deepEqual(state.constructor, { unknown: true });
  assert.ok(Object.hasOwn(state.unrelated, 'optional'));
  const cyclic = { icons: [] }; cyclic.extra = cyclic;
  error('CYCLIC_DATA', () => Scene.migrateLegacy(cyclic));
  assert.equal(cyclic.extra, cyclic);
  error('UNSUPPORTED_VALUE', () => Scene.migrateLegacy({ extra: () => 1 }));
  error('UNSUPPORTED_VALUE', () => Scene.migrateLegacy({ extra: new (class Custom { constructor() { this.keep = 1; } })() }));
});

console.log(`scene-schema: ${cases} cases passed`);
