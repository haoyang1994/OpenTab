import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
import { installTimezoneWallClock } from './timezone.mjs';
const require = createRequire(import.meta.url);
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const home = read('home.js');
function environment(system = 'Asia/Shanghai', instant = '2026-10-23T07:30:00Z') {
  let zone = system, at = instant;
  const formatterCalls = [];
  function DateTimeFormat(locale, options) { formatterCalls.push({ locale, options }); return new Intl.DateTimeFormat(locale, { ...options, timeZone: options?.timeZone ?? zone }); }
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [at])); } static now() { return Date.parse(at); } }
  const context = vm.createContext({ Intl: { DateTimeFormat }, Date: TestDate, console, structuredClone });
  vm.runInContext(read('lib/timezone.js'), context);
  return { context, api: context.OpenTabTimezone, formatterCalls, setSystem(value) { zone = value; }, setTime(value) { at = value; } };
}

const env = environment(), tz = env.api;
for (const value of [{}, { timezone: '' }, { timezone: 'Invalid/Zone' }, { timezone: 8 }, { timezoneMode: 'fixed' }, { timezoneMode: 'garbage' }]) {
  assert.deepEqual(copy(tz.preference(value)), { timezone: 'Asia/Shanghai', timezoneMode: 'system' });
}
for (const timezone of ['America/New_York', 'US/Eastern', 'Asia/Calcutta', 'Etc/UTC', 'Europe/Warsaw']) {
  for (const timezoneMode of [undefined, 'fixed', 'invalid']) {
    assert.deepEqual(copy(tz.preference({ timezone, timezoneMode })), { timezone, timezoneMode: 'fixed' }, 'legacy/unknown-mode valid choice stays fixed');
  }
}
assert.equal(tz.sameZone('US/Eastern', 'America/New_York'), true);
assert.equal(tz.sameZone('Etc/UTC', 'UTC'), true);
assert.equal(tz.sameZone('Asia/Calcutta', 'Asia/Kolkata'), true);
assert.equal(tz.sameZone('Invalid/Zone', 'Invalid/Zone'), false);
for (const [zone, at, expected] of [
  ['America/New_York', '2026-01-15', 'UTC-5'], ['America/New_York', '2026-07-15', 'UTC-4'],
  ['Europe/London', '2026-07-15', 'UTC+1'], ['Australia/Sydney', '2026-01-15', 'UTC+11'],
  ['Asia/Shanghai', '2026-07-15', 'UTC+8'], ['Asia/Kolkata', '2026-07-15', 'UTC+5:30'],
  ['Asia/Kathmandu', '2026-07-15', 'UTC+5:45'], ['UTC', '2026-07-15', 'UTC+0']
]) assert.equal(tz.offset(zone, new Date(`${at}T07:30:00Z`)), expected);
for (const locale of ['zh-CN', 'en']) for (const clockFormat of ['12h', '24h']) {
  const midnight = tz.clock(new Date('2026-10-23T16:30:00Z'), { timezone: 'Asia/Shanghai', clockFormat }, locale);
  assert.equal(midnight.time, clockFormat === '12h' ? '12:30' : '00:30');
  assert.equal(midnight.ampm, clockFormat === '12h' ? 'AM' : '');
  assert.match(midnight.date, locale === 'en' ? /October 24, 2026/ : /2026年10月24日/);
}
assert.equal(tz.clock(new Date('2026-07-15T07:30:00Z'), { timezone: 'America/New_York', clockFormat: '24h' }).time, '03:30');
assert.equal(tz.clock(new Date('2026-01-15T07:30:00Z'), { timezone: 'America/New_York', clockFormat: '24h' }).time, '02:30');
assert.match(tz.clock(new Date('2026-12-31T23:59:59Z'), { timezone: 'Asia/Shanghai', showSeconds: true }).date, /2027年1月1日/);
assert.equal(tz.clock(new Date('2026-12-31T23:59:59Z'), { timezone: 'UTC', clockFormat: '24h', showSeconds: true }).time, '23:59:59');
env.setSystem('America/New_York');
assert.equal(tz.preference({ timezone: 'Asia/Shanghai', timezoneMode: 'system' }).timezone, 'America/New_York');
assert.equal(tz.preference({ timezone: 'Asia/Shanghai' }).timezone, 'Asia/Shanghai');

function pageHarness(preferences = {}, mirror = null) {
  const e = environment(), c = e.context, nodes = new Map();
  const work = { elements: 0, listeners: 0 };
  const document = { activeElement: null, querySelectorAll: () => [], getElementById: id => nodes.get(id), createElement: make };
  function make(tag = 'div') {
    work.elements += 1;
    const classes = new Set();
    return { tagName: tag, children: [], dataset: {}, textContent: '', style: { setProperty() {} }, attributes: {},
      classList: { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)), contains: v => classes.has(v), toggle(v, force) { if (force ?? !classes.has(v)) classes.add(v); else classes.delete(v); } },
      setAttribute(key, value) { this.attributes[key] = String(value); }, addEventListener() { work.listeners += 1; }, append(...els) { els.forEach(el => this.appendChild(el)); },
      appendChild(el) { el.parentElement = this; this.children.push(el); },
      set innerHTML(_) { this.children = []; },
      querySelector(selector) { return selector === '.active' ? this.children.find(el => el.className?.includes(' active')) : null; },
      contains(el) { return Boolean(el) && (el === this || this.children.some(child => child.contains(el))); },
      focus() { document.activeElement = this; }
    };
  }
  for (const id of ['time', 'ampm', 'date', 'timezone-label', 'timezone-list', 'timezone-selector', 'timezone-btn', 'background-layer']) nodes.set(id, make());
  nodes.get('timezone-selector').appendChild(nodes.get('timezone-list'));
  nodes.get('timezone-selector').classList.add('hidden');
  document.documentElement = make(); document.body = make();
  const elements = Object.fromEntries(Object.entries({ time: 'time', ampm: 'ampm', date: 'date', timezoneLabel: 'timezone-label', timezoneList: 'timezone-list', timezoneSelector: 'timezone-selector', timezoneBtn: 'timezone-btn' }).map(([key, id]) => [key, nodes.get(id)]));
  Object.assign(c, { document, elements, state: { clockFormat: '12h', showSeconds: false, ...copy(e.api.preference(preferences)) },
    t: value => value, OpenTabI18n: { locale: 'zh-CN', t: value => value },
    localStorage: { getItem: () => mirror && JSON.stringify({ v: 1, ...mirror }), setItem() {}, removeItem() {} },
    performance: { mark() {}, measure() {} }, requestAnimationFrame: fn => fn(), getComputedStyle: () => ({ getPropertyValue: () => '' }), matchMedia: () => ({ matches: true }),
    saveState() { c.saved = copy(c.state); }, sceneRuntime: null, OpenTabBingCache: { describeBackground: () => ({}) },
    OpenTabBoot: { readMirror: () => mirror, writeMirror: value => { c.writtenMirror = copy(value); } },
    applyUiOpacitySetting() {}, applyUiBlurSetting() {}, applyIconFrameSetting() {}, applyThemeMode() {}, applyAccentColor() {},
    applyParticles() {}, applyGradientFlow() {}, applyMinimalMode() {}, refreshIconViews() {}, renderTodos() {}, renderTodoPanel() {}, updateBackground() {}
  });
  c.window = c;
  vm.runInContext('let timezoneMenuStamp = \"\";\n' + home.slice(home.indexOf('  function renderTimezoneList()'), home.indexOf('  function cleanupRuntimeResources('))
    + home.slice(home.indexOf('  function writeBootMirror()'), home.indexOf('  function createIconWidget('))
    + home.slice(home.indexOf('  function renderWorkspaceSettings()'), home.indexOf('  const workspace =')), c);
  return { ...e, c, nodes, elements, work, sample: () => ({ time: elements.time.textContent, ampm: elements.ampm.textContent, date: elements.date.textContent, label: elements.timezoneLabel.textContent }) };
}
for (const [preference, mirror] of [
  [{}, { tz: 'Invalid/Zone', tzMode: 'fixed', tzLabel: 'wrong' }],
  [{}, { tz: 'America/New_York', tzLabel: '北京 (UTC+8)' }],
  [{}, { tz: 'America/New_York', tzMode: 'system', tzLabel: 'stale' }]
]) {
  const h = pageHarness(preference, mirror);
  vm.runInContext(read('boot.js'), h.c);
  const first = h.sample();
  h.c.applyBootMirror();
  assert.deepEqual(h.sample(), first, 'real boot and runtime agree for malformed, stale and automatic mirrors');
  assert.notEqual(first.label, mirror.tzLabel);
  assert.ok(first.time && first.date, 'invalid timezone does not leave startup blank');
}
{
  const h = pageHarness(); h.c.updateClock(); assert.equal(h.sample().time, '03:30'); assert.equal(h.sample().ampm, 'PM');
  h.setSystem('America/New_York'); h.c.updateClock();
  assert.equal(h.sample().time, '03:30'); assert.equal(h.sample().ampm, 'AM'); assert.equal(h.sample().label, '美东 (UTC-4)');
  h.c.selectTimezone('Asia/Shanghai'); h.setSystem('UTC'); h.c.updateClock();
  assert.equal(h.sample().ampm, 'PM'); assert.equal(h.c.saved.timezoneMode, 'fixed');
  h.c.selectTimezone(''); assert.equal(h.c.saved.timezoneMode, 'system'); assert.equal(h.c.saved.timezone, 'UTC');
  h.c.writeBootMirror(); assert.equal(h.c.writtenMirror.tzMode, 'system'); assert.equal(h.c.writtenMirror.tz, 'UTC');
  h.c.selectTimezone('America/New_York'); h.setTime('2026-01-15T07:30:00Z'); h.c.updateClock();
  assert.equal(h.sample().label, '美东 (UTC-5)'); assert.equal(h.sample().time, '02:30');
  h.setTime('2026-07-15T07:30:00Z'); h.c.updateClock(); assert.equal(h.sample().label, '美东 (UTC-4)');
}
for (const zone of ['US/Eastern', 'Etc/UTC', 'Asia/Calcutta', 'Europe/Warsaw']) {
  const h = pageHarness({ timezone: zone }); h.c.toggleTimezoneSelector(true);
  const selected = h.elements.timezoneList.children.filter(item => item.attributes['aria-pressed'] === 'true');
  assert.equal(selected.length, 1); assert.equal(h.api.sameZone(selected[0].dataset.tz, zone), true);
  assert.equal(h.c.document.activeElement, selected[0], 'focus follows actual alias/unlisted selection, not Beijing');
  h.c.selectTimezone('UTC'); assert.equal(h.c.document.activeElement, h.elements.timezoneBtn, 'selection restores the opener before rebuilding menu buttons');
}
{
  const h = pageHarness(), before = { ...h.work }; h.formatterCalls.length = 0; h.c.renderTimezoneList();
  assert.equal(h.elements.timezoneList.children.length, 0, 'hidden menu controls are not constructed before first opening');
  assert.deepEqual(h.work, before, 'hidden menu adds no elements or listeners');
  assert.equal(h.formatterCalls.length, 0, 'hidden menu does no timezone resolution work');
  assert.equal(h.formatterCalls.filter(call => call.options?.timeZoneName).length, 0, 'hidden menu does no offset formatting before the grid');
  h.c.updateClock(); h.formatterCalls.length = 0; h.c.updateClock();
  assert.equal(h.formatterCalls.filter(call => call.options?.timeZoneName).length, 0, 'visible offset formatter is reused, never 23 new formatters per tick');
  h.c.toggleTimezoneSelector(true); assert.equal(h.elements.timezoneList.children.length, 24, 'first opening builds every supported choice and the system option');
  assert.ok(h.elements.timezoneList.children.every(item => item.children[1].textContent.startsWith('UTC')));
  assert.equal(h.c.document.activeElement.dataset.mode, 'system', 'first opening focuses the actual selected system choice');
  h.formatterCalls.length = 0; h.setTime('2026-10-23T07:31:00Z'); h.c.updateClock();
  assert.equal(h.formatterCalls.filter(call => call.options?.timeZoneName).length, 0, 'open-menu minute refresh also reuses offset formatters');
  h.c.selectTimezone('America/New_York');
  const closed = { ...h.work }; h.c.renderTimezoneList(); assert.deepEqual(h.work, closed, 'hidden refresh does not rebuild the closed menu');
  assert.equal(h.c.document.activeElement, h.elements.timezoneBtn);
  h.c.toggleTimezoneSelector(true);
  assert.equal(h.c.document.activeElement.dataset.tz, 'America/New_York', 'reopening rebuilds and focuses the latest preference');
  assert.equal(h.c.document.activeElement.children[1].textContent, 'UTC-4');
}
{
  const h = pageHarness({}, { tz: 'America/New_York', tzMode: 'fixed' }); h.c.applyBootMirror();
  const renderEvents = [], updateClock = h.c.updateClock;
  h.c.updateClock = () => { renderEvents.push('clock'); updateClock(); };
  h.c.refreshIconViews = () => renderEvents.push('grid');
  Object.assign(h.c, { OpenTabSceneSchema: { SCHEMA_KEY: 'schema' }, OpenTabWorkspace: { migrationOverrides: () => ({}) }, OpenTabBingCache: { afterStateLoaded() {} } });
  vm.runInContext(read('scene-home.js'), h.c);
  let seeded;
  const host = { state: h.c.state, HOME_FOLDER_ID: 'home', LEGACY_PRESET_FOLDER_IDS: new Set(), activeHomeId: () => 'home', t: value => value,
    ensureFolders: value => value || [], normalizeIconType: value => value, migrateBackground: value => value, backgroundsEqual: () => true,
    getFolderById: () => true, updateClock: h.c.updateClock, renderTimezoneList: h.c.renderTimezoneList, initCalendar() {}, renderWorkspaceSettings: h.c.renderWorkspaceSettings,
    workspace: { seed(raw, overrides) { seeded = { raw, overrides }; } }, refreshIconViews: h.c.refreshIconViews, renderTodos() {}, setTodoPanelOpen() {}, saveState() {}, writeBootMirror() {} };
  const loadState = h.c.OpenTabSceneHome.create(host);
  const load = value => {
    renderEvents.length = 0; loadState(value);
    assert.deepEqual(renderEvents, ['clock', 'grid'], 'actual loader and settings renderer update the clock exactly once, before the grid');
  };
  const initialWork = { ...h.work };
  load({}); assert.equal(h.api.preference(h.c.state).timezoneMode, 'system'); assert.equal(h.c.state.timezone, undefined); assert.equal(h.sample().ampm, 'PM');
  assert.equal(h.elements.timezoneList.children.length, 0); assert.deepEqual(h.work, initialWork, 'real state loading does not build the hidden timezone menu');
  const beforeRefresh = h.sample(); renderEvents.length = 0; h.c.renderCurrentWorkspace();
  assert.deepEqual(renderEvents, ['grid', 'clock'], 'workspace refresh also renders the clock only once through settings');
  assert.deepEqual(h.sample(), beforeRefresh, 'removing redundant renders preserves clock, date and timezone label');
  h.c.toggleTimezoneSelector(true);
  assert.equal(h.c.document.activeElement.dataset.mode, 'system');
  load({ timezone: 'Europe/Warsaw', timezoneMode: 'fixed' });
  const selected = h.elements.timezoneList.children.filter(item => item.attributes['aria-pressed'] === 'true');
  assert.equal(selected.length, 1); assert.equal(selected[0].dataset.tz, 'Europe/Warsaw', 'state reload still refreshes a visible menu and adds unlisted zones');
  assert.equal(selected[0].children[1].textContent, 'UTC+2', 'visible reloaded choice keeps its current seasonal offset');
  assert.equal(h.sample().label, 'Europe/Warsaw (UTC+2)');
  h.c.toggleTimezoneSelector(false); load({});
  const stored = {}, chrome = { runtime: {}, storage: { local: { async get() { return copy(stored); }, async set(patch) { Object.assign(stored, copy(patch)); } } } };
  const bridge = require('../workspace-persistence.js').forChrome(chrome).connect({ state: h.c.state });
  bridge.seed(seeded.raw, seeded.overrides);
  assert.equal(await bridge.save(), true); assert.deepEqual(stored, {}, 'hydration never creates a dirty default or no-op storage write');
  let saving; h.c.saveState = () => { saving = bridge.save(); return saving; };
  h.c.selectTimezone('Asia/Shanghai'); // The chosen zone equals the displayed system default.
  assert.equal(await saving, true);
  assert.equal(stored.timezone, 'Asia/Shanghai', 'same-zone fixed selection persists both halves of a formerly absent preference');
  assert.equal(stored.timezoneMode, 'fixed');
  h.setSystem('UTC'); assert.equal(h.api.preference(stored).timezone, 'Asia/Shanghai', 'reload on another system zone retains the explicit selection');
  h.setSystem('Asia/Shanghai');
  load({}); delete stored.timezone; delete stored.timezoneMode; bridge.seed(seeded.raw, seeded.overrides);
  h.c.selectTimezone(''); assert.equal(await saving, true);
  assert.equal(stored.timezone, 'Asia/Shanghai'); assert.equal(stored.timezoneMode, 'system', 'explicit automatic selection also persists a complete compatibility pair');
  load({ timezone: 'US/Eastern' }); assert.equal(h.api.preference(h.c.state).timezoneMode, 'fixed'); assert.equal(h.c.state.timezone, 'US/Eastern');
  load({ timezone: 'broken', timezoneMode: 'fixed' }); assert.equal(h.api.preference(h.c.state).timezoneMode, 'system'); assert.ok(h.sample().time);
}

const Workspace = require('../workspace-persistence.js'), Import = require('../import.js'), Sync = require('../sync.js');
assert.ok(Workspace.KEYS.includes('timezoneMode')); assert.ok(Sync.SYNC_SETTING_KEYS.includes('timezoneMode'));
for (const mode of ['system', 'fixed']) {
  const state = { timezone: 'Asia/Shanghai', timezoneMode: mode, icons: [], folders: [{ id: 'folder-home', name: 'Home' }] };
  assert.equal(Sync.buildSyncPayload(state).settings.timezoneMode, mode);
  assert.equal(Import.mergeBackupPayload({ version: 1, ...state }, {}).timezoneMode, mode);
}
assert.equal(Import.mergeBackupPayload({ version: 1, timezone: 'US/Eastern' }, { timezone: 'Asia/Shanghai', timezoneMode: 'system' }).timezoneMode, 'fixed', 'legacy backup zone does not inherit automatic mode');
assert.equal(Import.mergeBackupPayload({ version: 1, themeMode: 'light' }, { timezone: 'Asia/Shanghai', timezoneMode: 'system' }).timezoneMode, 'system', 'unrelated backup preserves mode');
const Schema = require('../scene-schema.js');
for (const scene of [false, true]) {
  const base = { timezone: 'Asia/Shanghai', timezoneMode: 'system', icons: [], folders: [{ id: 'folder-home', name: 'Home' }] };
  const stored = scene ? Schema.migrateLegacy(base) : base;
  const area = {
    get(keys, callback) { const value = copy(keys == null ? stored : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in stored).map(key => [key, stored[key]]))); callback?.(value); return Promise.resolve(value); },
    set(patch, callback) { Object.assign(stored, copy(patch)); callback?.(); return Promise.resolve(); }
  };
  const chrome = { runtime: {}, storage: { local: area, sync: area, onChanged: { addListener() {} } } };
  Sync.setChrome(chrome); Import.setChrome(chrome);
  try {
    const backup = await Import.buildBackupPayload(false); assert.equal(backup.timezoneMode, 'system');
    const remote = { ...copy(stored), timezone: 'US/Eastern' }; delete remote.timezoneMode;
    const payload = Sync.buildSyncPayload(remote); payload.deviceId = 'legacy-device'; payload.hash = await Sync.hashPayload(payload);
    const original = copy(payload); let inverse;
    await Sync.applyRemotePayload(payload, { onSnapshot(_snapshot, value) { inverse = value; } });
    assert.equal(stored.timezone, 'US/Eastern'); assert.equal(stored.timezoneMode, 'fixed');
    assert.deepEqual(payload, original, 'legacy compatibility does not rewrite a verified remote envelope');
    if (scene) { await Sync.undoRemotePayload(inverse); assert.equal(stored.timezone, 'Asia/Shanghai'); assert.equal(stored.timezoneMode, 'system'); }
    const state = { ...copy(stored), timezone: 'UTC', timezoneMode: 'fixed' };
    const bridge = Workspace.forChrome(chrome).connect({ state }); bridge.seed(stored);
    state.timezoneMode = 'system'; assert.equal(await bridge.save(), true); assert.equal(stored.timezoneMode, 'system');
  } finally { Sync.setChrome(null); Import.setChrome(null); }
}
for (const old of [{}, { timezone: 'America/New_York' }]) {
  const h = environment(); let installed, pending, written;
  Object.assign(h.context, { importScripts() {}, chrome: { runtime: { onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener() {} } } },
    OpenTabWorkspace: { transaction(fn) { pending = fn({ read: async () => old, write: async value => { written = copy(value); } }); return pending; } } });
  vm.runInContext(read('background.js'), h.context); installed({ reason: 'install' }); await pending;
  assert.equal(written.timezoneMode, old.timezone ? 'fixed' : 'system');
  if (old.timezone) assert.equal(written.timezone, undefined, 'installation never overwrites an existing choice');
  else assert.equal(written.timezone, 'Asia/Shanghai', 'automatic mode retains a valid compatibility timezone');
}
const html = read('home.html');
assert.ok(html.indexOf('src="lib/timezone.js"') < html.indexOf('src="boot.js"'));
assert.ok(Buffer.byteLength(read('boot.js')) <= 4096, 'boot budget stays intact');

// Execute the installed Playwright implementation as a negative control: its
// setFixedTime setup replaces native Performance entries, making our genuine
// production readiness barrier impossible. Do not mask that barrier in tests.
{
  const source = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/generated/clockSource.js')).source;
  const fixture = read('tests/timezone.mjs');
  const readySource = fixture.match(/const ready = \(\) => page.waitForFunction\((\(\) => [^\n]+)\);/)[1];
  const gridMark = home.match(/performance\.mark\('opentab:grid-ready'\);/)[0];
  function browserContext(saved = new Map()) {
    const entries = [], timerCalls = [], native = vm.createContext({ module: { exports: {} }, console, Intl,
      Event: class Event {}, document: { getElementById: () => ({ textContent: '15:30' }) },
      sessionStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
      setTimeout: (...args) => { timerCalls.push(['timeout', ...args]); return timerCalls.length; }, clearTimeout() {},
      setInterval: (...args) => { timerCalls.push(['interval', ...args]); return timerCalls.length; }, clearInterval() {},
      requestAnimationFrame: (...args) => { timerCalls.push(['raf', ...args]); return timerCalls.length; }, cancelAnimationFrame() {},
      performance: Object.create({ now: () => 123, mark(name) { entries.push({ name, entryType: 'mark', startTime: 123 }); },
        getEntries: () => entries.slice(), getEntriesByName: name => entries.filter(entry => entry.name === name), getEntriesByType: type => entries.filter(entry => entry.entryType === type) })
    });
    return { native, entries, timerCalls, ready: () => Boolean(vm.runInContext(`(${readySource})()`, native)) };
  }
  const broken = browserContext();
  vm.runInContext(source + '\nglobalThis.__pwClock = module.exports.inject()(globalThis); __pwClock.controller.setFixedTime(1784100600000);', broken.native);
  vm.runInContext(gridMark, broken.native);
  assert.equal(broken.ready(), false, 'installed Playwright full-clock fixture erases the real production grid mark');
  assert.equal(broken.entries.length, 0);

  const saved = new Map(), fixed = browserContext(saved), browser = fixed.native;
  const original = Object.fromEntries(['performance', 'Intl', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, browser[key]]));
  const summer = Date.parse('2026-07-15T07:30:00Z'), winter = Date.parse('2026-01-15T07:30:00Z');
  vm.runInContext(`(${installTimezoneWallClock.toString()})(${summer})`, browser);
  assert.equal(fixed.ready(), false, 'clock text alone is not readiness');
  vm.runInContext(gridMark, browser);
  assert.equal(fixed.ready(), true, 'the unchanged barrier sees only the actual production mark');
  for (const [key, value] of Object.entries(original)) assert.equal(browser[key], value, `${key} remains native, not restored from Playwright internals`);
  assert.equal(vm.runInContext('Date.now()', browser), summer);
  assert.equal(vm.runInContext('new Date().getTime()', browser), summer);
  assert.equal(vm.runInContext('new Date(0).getTime()', browser), 0, 'explicit Date construction stays native');
  assert.equal(vm.runInContext('Date()', browser), new Date(summer).toString(), 'callable Date retains its native string contract');
  assert.equal(vm.runInContext('Date.parse("2026-01-15T07:30:00Z")', browser), winter);
  assert.equal(vm.runInContext('Date.UTC(2026, 0, 15, 7, 30)', browser), winter);
  assert.equal(vm.runInContext('class DateSubclass extends Date {}; new DateSubclass().getTime()', browser), summer);
  browser.__opentabTimezoneTestClock.setTime(winter);
  assert.equal(vm.runInContext('Date.now()', browser), winter);
  vm.runInContext(read('lib/timezone.js'), browser);
  assert.equal(vm.runInContext("OpenTabTimezone.clock(new Date(), { timezone: 'America/New_York', clockFormat: '24h' }).time", browser), '02:30', 'production clock consumes the fixed Date through untouched Intl');
  vm.runInContext('globalThis.timerFired = false; setTimeout(() => { globalThis.timerFired = true; }, 10);', browser);
  assert.equal(fixed.timerCalls[0][0], 'timeout'); fixed.timerCalls[0][1](); assert.equal(browser.timerFired, true, 'the native timer path remains live while wall time is fixed');
  const reloaded = browserContext(saved);
  vm.runInContext(`(${installTimezoneWallClock.toString()})(${summer})`, reloaded.native);
  assert.equal(vm.runInContext('new Date().getTime()', reloaded.native), winter, 'fixed date persists across actual fresh-script reloads');
  assert.equal(reloaded.ready(), false, 'reload cannot inherit a previous document readiness mark');
  assert.throws(() => browser.__opentabTimezoneTestClock.setTime(NaN), /Invalid timezone fixture time/);
  assert.equal(vm.runInContext('Date.now()', browser), winter, 'invalid test input cannot silently change the chosen date');
  assert.doesNotMatch(fixture, /page\.clock\./, 'timezone fixture must not replace native performance/timers through the full clock API');
  assert.doesNotMatch(fixture, /performance\.(?:mark|measure)\(/, 'native fixture cannot fabricate production readiness or timing entries');
}
console.log('Timezone passed: system/manual compatibility, DST/date/locale, boot recovery, authoritative hydration, alias focus and preference transport.');
