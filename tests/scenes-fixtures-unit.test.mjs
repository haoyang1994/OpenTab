import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { verifySceneRefreshFixture } from './scenes-refresh-fixture.mjs';
import { verifySceneControlFixture } from './scenes-controls-fixture.mjs';
import { createSceneDiagnostics, diagnosticProfile, diagnosticStorage, boundedDiagnostic } from './scenes-diagnostics.mjs';
import { legacyFixture, expectedLegacyFirstLoad, DEFAULT_SCENE, PIXEL, SCHEMA_KEY } from './scenes-fixtures.mjs';
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Imports = require('../import.js');
const legacy = legacyFixture(), original = structuredClone(legacy);
const migrated = Schema.migrateLegacy(legacy, { defaultName: 'Default', homeName: 'Home' });
assert.deepEqual(legacy, original, 'the fixture and migration never share mutable input');
assert.equal(Imports.stripSecretsFromState(original).customLegacyRecord.sshPassword, '', 'synthetic nested credential marker exercises full-backup redaction');
assert.equal(migrated[SCHEMA_KEY], 2);
assert.equal(Schema.validate(migrated), true);
assert.deepEqual(migrated.icons.map(item => item.id), legacy.icons.map(item => item.id));
assert.deepEqual(migrated.folders.map(item => item.id), ['folder-home', ...legacy.folders.map(item => item.id)]);
assert.ok(migrated.folders.every(item => item.sceneId === DEFAULT_SCENE));
assert.ok(migrated.todos.every(item => item.sceneId === DEFAULT_SCENE));
assert.equal(migrated.icons[0].uploadedIconDataUrl, `data:image/png;base64,${PIXEL}`);
const next = Schema.create(migrated, { id: 'scene-work', homeGroupId: 'work-home', name: 'Work', iconKey: 'briefcase', homeName: 'Home' });
const moved = Schema.moveGroup(next, { groupId: 'research', targetSceneId: 'scene-work' });
assert.equal(Schema.validate(moved), true);
assert.deepEqual(moved.icons, migrated.icons, 'the move fixture requires ownership changes, never copied websites');
assert.deepEqual(moved.folders.filter(item => item.sceneId === 'scene-work').map(item => item.id), ['research', 'research-child', 'work-home']);
assert.deepEqual(moved.todos, migrated.todos);
// Reproduce the real legacy normalization/save boundary with the actual home
// loader, icon preparation, group normalization and workspace merge. Only the
// DOM painting and storage transport are substituted in this Node preflight.
const Workspace = require('../workspace-persistence.js');
const persisted = legacyFixture(), state = {}, failures = [];
const chrome = { runtime: {}, storage: { local: {
  async get(keys) { return structuredClone(keys == null ? persisted : Object.fromEntries(keys.filter(key => Object.hasOwn(persisted, key)).map(key => [key, persisted[key]]))); },
  async set(patch) { Object.assign(persisted, structuredClone(patch)); }
} } };
const workspace = Workspace.forChrome(chrome).connect({ state, onError: error => failures.push(error) });
const context = { structuredClone, URL, state, workspace, OpenTabWorkspace: Workspace, OpenTabSceneSchema: Schema,
  OpenTabI18n: { t: value => value === '主页' ? 'Home' : value },
  OpenTabIcons: { ...require('../icons.js'), scheduleIdleMigration() {} },
  OpenTabLayout: { loadFromStorage() {} }, OpenTabBingCache: { afterStateLoaded() {} },
  HOME_FOLDER_ID: 'folder-home', LEGACY_PRESET_FOLDER_IDS: new Set(), activeHomeId: () => 'folder-home',
  t: value => value === '主页' ? 'Home' : value, normalizeIconType: value => value || 'shortcut',
  migrateBackground: structuredClone, backgroundsEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  getFolderById: id => state.folders.find(item => item.id === id),
  updateClock() {}, renderTimezoneList() {}, initCalendar() {}, renderWorkspaceSettings() {},
  refreshIconViews() {}, renderTodos() {}, writeBootMirror() {}, saveState: () => workspace.save()
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../folders.js', import.meta.url), 'utf8'), context);
context.ensureFolders = folders => context.OpenTabFolders.ensureGroups(folders);
// Use the real setter's save behavior, not an inert stub that hides this write.
context.setTodoPanelOpen = open => { state.todoPanelOpen = open; return workspace.save(); };
vm.runInContext(fs.readFileSync(new URL('../scene-home.js', import.meta.url), 'utf8'), context);
context.OpenTabSceneHome.create(context)(structuredClone(persisted));
assert.equal(await workspace.whenIdle(), true); assert.deepEqual(failures, []);
const expected = expectedLegacyFirstLoad();
for (const key of ['icons', 'folders', 'todos']) assert.deepEqual(persisted[key], expected[key], `actual legacy loader matches exact expected ${key}, including opaque metadata`);
for (const key of [SCHEMA_KEY, 'scenes', 'sceneProfiles']) assert.equal(Object.hasOwn(persisted, key), false, `the existing legacy repair does not create ${key}`);
assert.ok(['icons', 'folders', 'todos'].every(key => persisted[key].every(item => !Object.hasOwn(item, 'sceneId'))));
await verifySceneRefreshFixture();
console.log('Scenes E2E fixtures: implicit Home, stable IDs/order/assets, nested group move and scene ownership preflight passed.');

const nativeSuite = fs.readFileSync(new URL('./scenes.test.mjs', import.meta.url), 'utf8');
const controlReport = verifySceneControlFixture(nativeSuite);
for (const [before, after, error] of [
  ["settings('shortcuts')", "settings('layout')", /unknown settings section: layout/],
  ['#layout-columns', '#layout-columns-missing', /unknown native selector/],
  ["locator('#layout-columns').selectOption('4')", "locator('#layout-show-names').selectOption('4')", /correct control type/],
  ['.layout-size-preset[data-size="80"]', '.layout-size-preset[data-size="79"]', /nonexistent preset/],
  ["selectOption('4')", "selectOption('3')", /nonexistent option/]
]) {
  assert.ok(nativeSuite.includes(before), `negative control targets an actual suite operation: ${before}`);
  assert.throws(() => verifySceneControlFixture(nativeSuite.replace(before, after)), error);
}
console.log(`Scenes control preflight: ${controlReport.sections} real sections, ${controlReport.checkedIds} native IDs, control types/options/presets and five invalid-fixture negative controls passed.`);

// Exercise only the diagnostic helper, never substitute production UI in E2E.
const secret = 'DIAGNOSTIC_SYNTHETIC_SECRET';
const diagnosticData = { ...legacyFixture(), sceneProfiles: [{ id: DEFAULT_SCENE, ...legacyFixture(), sshPassword: secret },
  { id: 'uploaded-profile', background: { type: 'image', source: 'local-upload', value: `data:image/png;secret=${secret}` }, custom: { secret } }] };
const safeDiagnostic = diagnosticStorage(diagnosticData);
assert.equal(safeDiagnostic.profiles[0].background.value, legacyFixture().background.value);
assert.equal(safeDiagnostic.profiles[0].layoutIconSize, 56);
assert.equal(safeDiagnostic.profiles[1].background.value, '[omitted non-gradient background]');
assert.equal(JSON.stringify(safeDiagnostic).includes(secret), false);
for (const excluded of ['icons', 'todos', 'customLegacyRecord', 'sshPassword', 'custom']) assert.equal(JSON.stringify(safeDiagnostic).includes(`"${excluded}"`), false);
assert.equal(diagnosticStorage({ sceneProfiles: Array(20).fill(diagnosticData.sceneProfiles[0]) }).profiles.length, 8);
assert.equal(diagnosticProfile(null), null);
assert.deepEqual(await boundedDiagnostic(() => { throw new TypeError(secret); }), { unavailable: 'TypeError' });
assert.deepEqual(await boundedDiagnostic(() => new Promise(() => {}), 1), { unavailable: 'diagnostic deadline' });
const diagnosticLogs = [], diagnosticCalls = [];
const diagnostics = createSceneDiagnostics({ phase: () => 'fixture phase', artifacts: '/synthetic-artifacts', log: message => diagnosticLogs.push(message),
  storage: async keys => { diagnosticCalls.push({ storage: keys }); return diagnosticData; },
  page: () => ({ evaluate: async () => ({ view: { sceneId: DEFAULT_SCENE }, layout: { layoutIconSize: 56 } }), locator: selector => selector,
    screenshot: async options => diagnosticCalls.push({ screenshot: options }) }) });
let successCalls = 0;
assert.equal(await diagnostics.wait('success', { themeMode: 'light' }, () => { successCalls += 1; return 42; }, () => assert.fail('successful waits do not collect diagnostics')), 42);
assert.equal(successCalls, 1); assert.deepEqual(diagnosticLogs, []);
const originalCause = new Error('original native cause'), originalFailure = Object.freeze(new Error('original native error', { cause: originalCause }));
await assert.rejects(diagnostics.wait('global themeMode', { themeMode: 'dark' }, () => { throw originalFailure; }, () => ({ themeMode: 'light' })), error => error === originalFailure && error.cause === originalCause);
assert.match(diagnosticLogs[0], /"name":"global themeMode".*"expected":\{"themeMode":"dark"\}.*"actual":\{"themeMode":"light"\}/);
await diagnostics.failure();
assert.equal(diagnosticCalls.length, 2);
assert.ok(diagnosticCalls.find(call => call.storage).storage.every(key => !['icons', 'todos', 'folders'].includes(key)));
const screenshotOptions = diagnosticCalls.find(call => call.screenshot).screenshot;
assert.equal(screenshotOptions.fullPage, false); assert.equal(screenshotOptions.timeout, 1500);
assert.deepEqual(screenshotOptions.mask, ['input[type="password"]']); assert.match(screenshotOptions.path, /scenes-failure\.png$/);
assert.equal(diagnosticLogs.some(message => message.includes(secret)), false);
assert.match(diagnosticLogs[1], /"lastAwait":\{"name":"global themeMode","status":"failed"/);
let brokenLoggerCalls = 0;
const brokenLogger = createSceneDiagnostics({ phase: () => 'fixture phase', log() { brokenLoggerCalls += 1; throw new Error('logging unavailable'); } });
await assert.rejects(brokenLogger.wait('preserve original', null, () => { throw originalFailure; }, () => null), error => error === originalFailure);
assert.equal(brokenLoggerCalls, 1);
console.log('Scenes diagnostics: named expected/actual state, secret redaction, bounded reads, one viewport screenshot and original error/cause preservation passed.');
