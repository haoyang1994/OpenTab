import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js'), Workspace = require('../workspace-persistence.js');
const source = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
const load = fs.readFileSync(new URL('../scene-home.js', import.meta.url), 'utf8');
const initial = Schema.migrateLegacy({
  folders: [{ id: 'folder-home', name: 'Home' }, { id: 'folder-tools', name: 'User named legacy ID' }],
  icons: [{ id: 'site', name: 'Preserved', type: 'shortcut', url: 'https://example.test/path?A=B', folderId: 'folder-tools' }],
  todos: [{ id: 'task', text: 'Existing', done: false }], background: { type: 'gradient', value: 'old' },
  currentFolderId: 'folder-tools', themeMode: 'light', todoButtonVisible: false
});
const raw = Schema.create(initial, { id: 'study', name: 'Study', iconKey: 'book', homeGroupId: 'study-home', homeName: 'Study home' });
raw.todos.push({ id: 'study-task', text: 'Read', done: false, sceneId: 'study' });
const profile = raw.sceneProfiles.find(item => item.id === 'study');
profile.background = { type: 'gradient', value: 'linear-gradient(red, blue)' };
profile.layoutColumns = 4;
const projected = { ...structuredClone(raw), ...structuredClone(profile), currentFolderId: 'study-home' };
const state = {}, calls = { seed: [], layout: [], calendar: [], saves: 0 };
const context = {
  state, structuredClone, HOME_FOLDER_ID: 'folder-home', LEGACY_PRESET_FOLDER_IDS: new Set(['folder-tools']),
  OpenTabSceneSchema: Schema, OpenTabWorkspace: Workspace,
  activeHomeId: () => 'study-home', t: value => value, ensureFolders: value => structuredClone(value),
  normalizeIconType: value => value || 'shortcut', migrateBackground: structuredClone,
  backgroundsEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  getFolderById: id => state.folders.find(item => item.id === id),
  OpenTabLayout: { loadFromStorage: value => calls.layout.push(structuredClone(value)) },
  OpenTabFolders: { repairIconGraph() {} }, OpenTabIcons: { prepareRecord() {}, scheduleIdleMigration() {} },
  OpenTabBingCache: { afterStateLoaded() {} }, workspace: { seed: (data, changes) => calls.seed.push(structuredClone({ data, changes })) },
  updateClock() {}, renderTimezoneList() {}, initCalendar: defer => calls.calendar.push(defer), renderWorkspaceSettings() {}, refreshIconViews() {}, renderTodos() {},
  setTodoPanelOpen() {}, writeBootMirror() {}, saveState() { calls.saves += 1; }
};
context.window = context;
vm.createContext(context); vm.runInContext(load, context);
context.OpenTabSceneHome.create(context)(projected, raw);
assert.deepEqual(state.folders, raw.folders, 'scene graph preserves all IDs, including user groups resembling old presets');
assert.deepEqual(structuredClone(state.todos), raw.todos, 'full TODO data and scene ownership survive actual home normalization');
assert.equal(state.icons[0].url, raw.icons[0].url); assert.equal(state.icons[0].folderId, 'folder-tools');
assert.equal(state.currentFolderId, 'study-home'); assert.equal(state.todoButtonVisible, false);
assert.deepEqual(state.scenes, raw.scenes); assert.deepEqual(state.sceneProfiles, raw.sceneProfiles);
assert.deepEqual(state.background, profile.background);
assert.deepEqual(calls.seed[0].data, raw, 'session baseline receives durable full graph, not projected background aliases');
assert.equal(calls.layout[0].layoutColumns, 4); assert.equal(calls.saves, 0);
assert.deepEqual(calls.calendar, [true], 'loader captures calendar date without constructing hidden DOM');
assert.deepEqual(raw.todos.map(item => item.id), ['task', 'study-task'], 'loading is not a data replacement');
const panels = { 'settings-panel': true, 'change-icon-modal': true };
let inlineDraft = false, foreignDialog = false;
context.document = {
  getElementById: id => ({ classList: { contains: () => panels[id] !== false } }),
  querySelector: selector => selector === '.group-inline-input' ? inlineDraft : foreignDialog,
  querySelectorAll: () => []
};
context.OpenTabSiteList = { isBusy: () => false };
context.OpenTabSiteSelection = { isPending: () => false, cancel() {} };
// Actual new-task handler keeps a scene draft until its ordinary save commits.
const add = source.slice(source.indexOf('  async function handleAddTodo()'), source.indexOf('  function updateBackground('));
for (const success of [false, true]) {
  let release, writes = 0, stored = structuredClone(raw);
  const heldWrite = new Promise(resolve => { release = resolve; });
  const chrome = { runtime: {}, storage: { local: {
    async get() { return structuredClone(stored); },
    async set(patch) { await heldWrite; if (!success) throw new Error('synthetic write failure'); Object.assign(stored, structuredClone(patch)); }
  } } };
  const input = { value: 'Keep this task', disabled: false, focus() {} }, button = { disabled: false };
  const c = { todoAddPending: false, sceneRuntime: { isActive: () => true }, state: structuredClone(raw),
    elements: { todoInput: input, todoAddBtn: button, addIconModal: { classList: { contains: () => true } } }, clockHost: {}, generateId: () => 'new-task',
    OpenTabClockDeck: { createTodoRecord: (_, record) => ({ ...record, sceneId: 'study' }) },
    renderTodos() {}, showToast() {}, t: value => value };
  const bridge = Workspace.forChrome(chrome).connect({ state: c.state }); bridge.seed(stored);
  c.saveState = () => { writes += 1; return bridge.save(); };
  vm.createContext(c); vm.runInContext(add, c);
  const pending = c.handleAddTodo(); await c.handleAddTodo();
  assert.equal(writes, 1); assert.equal(input.value, 'Keep this task'); assert.equal(input.disabled, true);
  assert.equal(c.state.todos[0].sceneId, 'study');
  const canSwitch = () => context.OpenTabSceneHome.canSwitch({ elements: c.elements, todoAddPending: c.todoAddPending, isSaving: false });
  assert.equal(canSwitch(), true, 'a submitted task may wait for its pending durable save');
  // Use the actual coordinator drain rather than the raw storage promise: it
  // includes error recovery and the failed-save bit used by scene-controller.
  const switchAfterSave = (async () => { if (await bridge.whenIdle() === false) return false; return canSwitch(); })();
  release(); await pending;
  assert.equal(await switchAfterSave, success, 'failed saves block queued navigation; successful tasks become durable before navigation');
  assert.equal(stored.todos.some(item => item.id === 'new-task'), success);
  assert.equal(input.value, success ? '' : 'Keep this task'); assert.equal(input.disabled, false); assert.equal(button.disabled, false);
  input.value = ''; panels['change-icon-modal'] = false;
  assert.equal(canSwitch(), false, 'icon changer is a real draft boundary despite being a div');
  panels['change-icon-modal'] = true; inlineDraft = true; assert.equal(canSwitch(), false); inlineDraft = false;
}
// The real page boundary lets recovery controls work without enabling legacy
// editing shortcuts against a graph that failed scene validation.
const boundary = { sceneReadOnly: true, sceneInteractionBusy: false, window: { addEventListener() {} } };
boundary.guardSceneRecovery = context.OpenTabSceneHome.bindInteractionGate(() => ({ readOnly: boundary.sceneReadOnly, busy: boundary.sceneInteractionBusy }), { addEventListener() {} });
for (const [type, recovery, key, metaKey, blocked] of [
  ['click', false, '', false, true], ['keydown', false, 'k', true, true],
  ['click', true, '', false, false], ['keydown', true, 'Tab', false, false],
  ['keydown', true, 'Enter', false, false], ['keydown', true, 'k', true, true],
  ['keydown', true, 'a', false, true]
]) {
  let prevented = false, stopped = false;
  boundary.guardSceneRecovery({ type, key, metaKey, target: { closest: () => recovery },
    preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert.equal(prevented, blocked); assert.equal(stopped, blocked);
}
boundary.sceneReadOnly = false;
boundary.guardSceneRecovery({ type: 'keydown', key: 'k', metaKey: true, preventDefault() { assert.fail('supported graph must keep its normal shortcuts'); } });

boundary.sceneInteractionBusy = true;
let blockedBusy = false;
boundary.guardSceneRecovery({ type: 'click', target: { closest: () => null }, preventDefault() { blockedBusy = true; }, stopImmediatePropagation() {} });
assert.equal(blockedBusy, true, 'pending scene writes cannot open another background draft');

// Only explicit discard clears drafts; busy/failed availability leaves them intact.
const discarded = [], todoDraft = { value: 'Unsaved text' };
context.CustomEvent = function(type) { this.type = type; };
context.document.querySelectorAll = () => [{ dispatchEvent(event) { discarded.push(event.type); } }];
context.OpenTabIcons.closeChanger = () => discarded.push('changer');
context.OpenTabSiteSelection.cancel = () => discarded.push('selection');
context.OpenTabFolders.handleEscape = () => discarded.push('cancel-confirmation');
context.OpenTabFolders.closeOverlay = () => discarded.push('folder');
context.OpenTabSettingsNav = { close: () => discarded.push('settings') };
const draftHost = { canDiscard: () => false, closeAddIconModal: () => discarded.push('add'), elements: { todoInput: todoDraft } };
assert.equal(context.OpenTabSceneHome.discardDraft(draftHost), false);
assert.equal(todoDraft.value, 'Unsaved text'); assert.deepEqual(discarded, []);
draftHost.canDiscard = () => true;
assert.equal(context.OpenTabSceneHome.discardDraft(draftHost), true);
assert.equal(todoDraft.value, '');
assert.deepEqual(discarded, ['add', 'changer', 'opentab-cancel-edit', 'selection', 'cancel-confirmation', 'folder', 'settings']);
assert.equal(calls.saves, 0, 'discarding drafts does not mutate durable user data');
console.log('Scene home integration passed: full graph loading, guarded recovery, explicit discard and durable task/switch ordering.');

const html = fs.readFileSync(new URL('../home.html', import.meta.url), 'utf8');
const runtimeOrder = ['scene-schema.js', 'workspace-persistence.js', 'scene-sync.js', 'sync.js', 'scene-runtime.js', 'scene-home.js', 'home.js'];
let previous = -1;
for (const file of runtimeOrder) {
  const at = html.indexOf('<script src="' + file + '"></script>');
  assert.ok(at > previous, file + ' must load after its browser-global dependencies'); previous = at;
  assert.ok(JSON.parse(fs.readFileSync(new URL('../scripts/release-files.json', import.meta.url), 'utf8')).includes(file), file + ' is shipped');
}
