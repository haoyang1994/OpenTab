import assert from 'node:assert/strict';
import { assertHomeControlsGeometry, assertZenEntryGeometry, assertTimezoneFocusGeometry } from './home-controls-viewport.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { formatConsoleError, isAllowedConsoleError, unexpectedErrors } from './console-allow.mjs';

const require = createRequire(import.meta.url);
const OpenTabLayout = require('../layout.js');
const OpenTabSettingsNav = require('../settings-nav.js');
const OpenTabSync = require('../sync.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

assert.deepEqual(OpenTabLayout.normalize({}), OpenTabLayout.DEFAULTS);
assert.equal(OpenTabLayout.normalize({ layoutIconSize: 12 }).layoutIconSize, 48);
assert.equal(OpenTabLayout.normalize({ layoutIconSize: 200 }).layoutIconSize, 96);
assert.equal(OpenTabLayout.normalize({ layoutColumns: 'auto' }).layoutColumns, 0);
assert.equal(OpenTabLayout.normalize({ layoutColumns: 2 }).layoutColumns, 4);
assert.equal(OpenTabLayout.normalize({ layoutColumns: 12 }).layoutColumns, 12);
assert.equal(OpenTabLayout.normalize({ layoutShowNames: false }).layoutShowNames, false);
assert.equal(OpenTabLayout.normalize({ layoutMaxWidth: 100 }).layoutMaxWidth, 640);
assert.equal(OpenTabLayout.tileWidth(56), 104);

const vars = OpenTabLayout.cssVars({ layoutIconSize: 80, layoutColumns: 6, layoutMaxWidth: 1200 });
assert.equal(vars['--layout-icon-size'], '80px');
assert.equal(vars['--layout-tile-width'], '128px');
assert.equal(vars['--layout-columns'], '6');
assert.equal(vars['--layout-max-width'], '1200px');

assert.equal(OpenTabSettingsNav.textMatches('快捷方式与布局 Layout', 'layout'), true);
assert.equal(OpenTabSettingsNav.textMatches('快捷方式与布局 Layout', 'LAYOUT'), true);
assert.equal(OpenTabSettingsNav.textMatches('Weather 天气', '天气'), true);
assert.equal(OpenTabSettingsNav.textMatches('Weather 天气', 'xyz'), false);
assert.equal(OpenTabSettingsNav.textMatches('anything', ''), true);

const ids = OpenTabSettingsNav.SECTIONS.map((section) => section.id);
assert.deepEqual(ids, [
  'appearance', 'wallpaper', 'shortcuts', 'search', 'weather', 'sync', 'advanced', 'about'
]);
assert.match(OpenTabSettingsNav.SECTIONS.find((section) => section.id === 'weather').label, /天气/);
assert.match(OpenTabSettingsNav.SECTIONS.find((section) => section.id === 'advanced').label, /高级/);

assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([], undefined), false);
assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([{ type: 'ssh' }], undefined), true);
assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([{ type: 'tool' }], undefined), true);
assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([{ type: 'ssh' }], false), false);
assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([], true), true);

for (const key of OpenTabLayout.STORAGE_KEYS.concat(['developerToolsEnabled'])) {
  assert.ok(OpenTabSync.SYNC_SETTING_KEYS.includes(key), 'sync key missing: ' + key);
}

const payload = OpenTabSync.buildSyncPayload({
  icons: [{ id: 'a', name: 'A', url: 'https://a.example/', folderId: 'folder-home' }],
  folders: [{ id: 'folder-home', name: '主页' }],
  layoutIconSize: 80,
  layoutColumns: 6,
  layoutShowNames: false,
  layoutMaxWidth: 1200,
  developerToolsEnabled: true,
  clockFormat: '24h'
});
assert.equal(payload.settings.layoutIconSize, 80);
assert.equal(payload.settings.layoutColumns, 6);
assert.equal(payload.settings.layoutShowNames, false);
assert.equal(payload.settings.layoutMaxWidth, 1200);
assert.equal(payload.settings.developerToolsEnabled, true);
assert.equal(payload.settings.clockFormat, '24h');

const quoted = OpenTabSync.buildSyncPayload({
  icons: Array.from({ length: 80 }, (_, i) => ({
    id: 'q' + i,
    name: '中文"引号\\布局"' + i,
    url: 'https://example.com/path?q="' + i + '"\\x',
    folderId: 'folder-home',
    type: 'shortcut'
  })),
  folders: [{ id: 'folder-home', name: '主页' }],
  layoutIconSize: 96,
  layoutColumns: 12,
  layoutShowNames: true,
  layoutMaxWidth: 1600
});
const plan = OpenTabSync.planSyncWrite(quoted);
assert.equal(plan.ok, true, 'BUG-022: layout settings plus quoted names should shard');
assert.ok(plan.chunkCount >= 3, 'BUG-022: expected at least 3 shards, got ' + plan.chunkCount);
plan.items.forEach((item) => {
  const size = OpenTabSync.storedItemBytes(item.key, item.value);
  assert.ok(size <= OpenTabSync.QUOTA_BYTES_PER_ITEM, 'BUG-022 stored item ' + item.key + ' is ' + size);
  if (item.key.startsWith('ot.s.c')) {
    assert.ok(size <= OpenTabSync.CHUNK_SIZE, 'BUG-022 stored chunk exceeds 7800: ' + size);
  }
});
const restored = OpenTabSync.unshardSyncPayload(
  plan.items.filter((item) => item.key.startsWith('ot.s.c')).map((item) => item.value)
);
assert.equal(restored.settings.layoutIconSize, 96);
assert.equal(restored.settings.layoutColumns, 12);
assert.equal(restored.icons[0].name, quoted.icons[0].name);

const slice = OpenTabLayout.bootMirrorSlice({
  layoutIconSize: 80,
  layoutColumns: 6,
  layoutShowNames: false,
  layoutMaxWidth: 1100
});
assert.equal(slice.layoutIconSize, 80);
assert.equal(slice.layoutColumns, 6);
assert.equal(slice.layoutShowNames, false);
assert.equal(slice.layoutMaxWidth, 1100);
assert.equal(OpenTabLayout.applyFromMirror(), false);

OpenTabLayout.persist({
  layoutIconSize: 80,
  layoutColumns: 6,
  layoutShowNames: false,
  layoutMaxWidth: 1100
});
OpenTabLayout.loadFromStorage({});
assert.equal(OpenTabLayout.get().layoutIconSize, 80, 'empty storage must not clobber current layout');
OpenTabLayout.loadFromStorage({
  layoutIconSize: 64,
  layoutColumns: 4,
  layoutShowNames: true,
  layoutMaxWidth: 900
});
assert.equal(OpenTabLayout.get().layoutIconSize, 64);

globalThis.OpenTabBoot = {
  readMirror: () => ({ v: 1, layoutIconSize: 80, layoutColumns: 6, layoutShowNames: false, layoutMaxWidth: 1100 }),
  writeMirror() {}
};
assert.equal(OpenTabLayout.applyFromMirror(), true);
assert.equal(OpenTabLayout.get().layoutIconSize, 80);
assert.equal(OpenTabLayout.get().layoutShowNames, false);
delete globalThis.OpenTabBoot;
OpenTabLayout.reset();

const settingsNavSrc = fs.readFileSync(path.join(root, 'settings-nav.js'), 'utf8');
assert.match(settingsNavSrc, /section\.id !== 'about' && section\.id !== 'sync'/);
assert.match(settingsNavSrc, /会关闭浏览器同步/);

assert.equal(isAllowedConsoleError('Failed to load resource', 'https://example.com/a'), true);
assert.equal(isAllowedConsoleError('Failed to load resource', 'https://www.bing.com/th?id=1.jpg'), true);
assert.equal(isAllowedConsoleError('Failed to fetch Bing image'), true);
assert.equal(isAllowedConsoleError('Failed to load resource: net::ERR_FAILED'), false);
assert.equal(isAllowedConsoleError('Failed to load resource', 'chrome-extension://abc/home.js'), false);
assert.equal(
  isAllowedConsoleError('Access to fetch at https://cors-blocked.test/favicon.ico from origin chrome-extension://x has been blocked by CORS policy'),
  false,
  'BUG-025: CORS errors are not allowlisted even when the URL mentions favicon.ico'
);
assert.equal(isAllowedConsoleError('Failed to load resource', 'https://cors-blocked.test/favicon.ico'), false);

const homeCss = fs.readFileSync(path.join(root, 'home.css'), 'utf8');
assert.match(homeCss, /\.change-icon-preview\s*\{[^}]*--layout-icon-size/s, '更换图标 preview follows layout icon size');
assert.match(settingsNavSrc, /'change-icon-modal'/);
assert.ok(
  settingsNavSrc.indexOf('change-icon-modal') < settingsNavSrc.indexOf("'settings-panel'"),
  'change-icon-modal must trap Tab above the settings panel'
);
assert.deepEqual(
  unexpectedErrors(['Failed to load resource (https://example.com/x)', 'boom']),
  ['boom']
);
assert.match(
  formatConsoleError({ text: () => 'Failed to load resource', location: () => ({ url: 'https://example.com/a' }) }),
  /example\.com/
);

console.log('layout unit tests passed');

// The visibility setting preserves task records and drafts, and commits before
// hiding. Exercise the real layout module against a small focused DOM.
{
  const oldDocument = global.document, oldChrome = global.chrome;
  const classes = new Set(), panelClasses = new Set();
  const input = { checked: true, disabled: false, focus() { global.document.activeElement = this; } };
  const opener = { focus() { global.document.activeElement = this; } };
  const draft = { value: 'Keep unfinished draft' };
  const panel = { classList: { contains: x => panelClasses.has(x) }, contains: el => el === draft };
  const status = { textContent: '' };
  let closed = 0, callback, written;
  const elements = { 'todo-button-visible': input, 'clock-todo-open': opener, 'todo-widget': panel, 'todo-visibility-status': status,
    'todo-collapse-btn': { click() { closed++; panelClasses.add('hidden'); opener.focus(); } } };
  global.document = { activeElement: input, getElementById: id => elements[id], querySelectorAll: () => [], documentElement: { style: { setProperty() {} } }, body: { classList: { toggle(key, value) { if (value) classes.add(key); else classes.delete(key); } } } };
  global.chrome = { runtime: {}, storage: { local: { set(patch, done) { written = patch; callback = done; } } } };
  try {
    OpenTabLayout.apply({});
    const taskRecords = [{ id: 'kept', text: 'Keep task', done: false }];
    const pending = OpenTabLayout.setTodoButtonVisible(false);
    assert.equal(input.disabled, true); assert.equal(classes.has('hide-todo-entry'), false);
    assert.deepEqual(written, { todoButtonVisible: false });
    callback(); assert.equal(await pending, true);
    assert.equal(classes.has('hide-todo-entry'), true); assert.equal(closed, 1);
    assert.equal(global.document.activeElement, input, 'closing never leaves focus on the now-hidden entry');
    assert.equal(draft.value, 'Keep unfinished draft'); assert.equal(taskRecords.length, 1);
    const retry = OpenTabLayout.setTodoButtonVisible(true);
    global.chrome.runtime.lastError = { message: 'write failed' }; callback(); delete global.chrome.runtime.lastError;
    assert.equal(await retry, false); assert.equal(OpenTabLayout.get().todoButtonVisible, false);
    assert.equal(input.checked, false); assert.match(status.textContent, /保存失败/);
    const enable = OpenTabLayout.setTodoButtonVisible(true); callback(); assert.equal(await enable, true);
    assert.equal(classes.has('hide-todo-entry'), false); assert.equal(draft.value, 'Keep unfinished draft');
    opener.focus();
    OpenTabLayout.apply({ layoutIconSize: 80, todoButtonVisible: false });
    assert.equal(global.document.activeElement, input, 'hiding the focused card opener restores a visible settings control');
    assert.equal(OpenTabLayout.loadFromStorage({ todoButtonVisible: false }).todoButtonVisible, false, 'explicit stored hidden choice remains');
    OpenTabLayout.apply({ layoutIconSize: 80, todoButtonVisible: false });
    const absent = OpenTabLayout.loadFromStorage({});
    assert.equal(absent.todoButtonVisible, true, 'absent storage preference overrides a stale hidden mirror');
    assert.equal(absent.layoutIconSize, 80, 'missing visibility does not change existing layout fallback');
    assert.equal(OpenTabLayout.normalize({}).todoButtonVisible, true);
    assert.equal(OpenTabLayout.bootMirrorSlice({ todoButtonVisible: false }).todoButtonVisible, false);
    assert.equal(OpenTabSync.buildSyncPayload({ todoButtonVisible: false }).settings.todoButtonVisible, false);
  } finally { global.document = oldDocument; global.chrome = oldChrome; }
}

// These offline counterexamples test the assertion, not a simulated browser.
// Native geometry, clipping and keyboard activation live in the settings suite.
{
  function sample(width = 360, height = 560, inset = 0) {
    const narrow = width <= 760, size = narrow ? 46 : 48;
    const bottom = height - (narrow ? 18 + inset : 28);
    const contentHeight = narrow ? height - 76 - inset : height;
    const zenLeft = narrow ? 18 : 20, zenTop = narrow ? bottom - 44 : 20;
    return { width, height, scrollWidth: width, transparent: true,
      content: { height: contentHeight, bottom: contentHeight, paddingBottom: narrow ? 18 : 104, scrollPadding: narrow ? 8 : 0 },
      zen: { id: 'zen-toggle-btn', left: zenLeft, right: zenLeft + 44, top: zenTop, bottom: zenTop + 44,
        width: 44, height: 44, hit: true, edgeHits: [true, true, true, true] },
      buttons: ['refresh-bg-btn', 'settings-btn'].map((id, i) => ({ id, width: size, height: size, top: bottom - size, bottom,
        right: width - (i ? narrow ? 18 : 28 : narrow ? 82 : 92), hit: true })),
      visibleTargets: [{ id: 'select-sites', hit: true }, { id: 'google', engine: true, hit: true }] };
  }
  for (const width of [320, 360, 390, 640, 760, 761, 1024, 1280]) assertHomeControlsGeometry(sample(width), `unit ${width}`);
  assertHomeControlsGeometry(sample(360, 560, 32), 'unit simulated inset', 32);
  const fullHeight = sample(); fullHeight.content.height = fullHeight.content.bottom = 560;
  assert.throws(() => assertHomeControlsGeometry(fullHeight, 'old full-height clip'), /real scroll viewport height/);
  const paddingOnly = sample(); paddingOnly.content.paddingBottom = 180;
  assert.throws(() => assertHomeControlsGeometry(paddingOnly, 'padding-only repair'), /end padding/);
  const intercepted = sample(); intercepted.visibleTargets[0] = { id: 'select-sites', hit: false, target: 'settings-btn' };
  assert.throws(() => assertHomeControlsGeometry(intercepted, 'mid-scroll interception'), /select-sites center is intercepted/);
  const blockedButton = sample(); blockedButton.buttons[1].hit = false;
  assert.throws(() => assertHomeControlsGeometry(blockedButton, 'covered settings'), /settings-btn center is intercepted/);
  const opaque = sample(); opaque.transparent = false;
  assert.throws(() => assertHomeControlsGeometry(opaque, 'opaque footer'), /opaque footer/);
  const wrongInset = sample(360, 560, 32); wrongInset.buttons[0].bottom += 32;
  assert.throws(() => assertHomeControlsGeometry(wrongInset, 'unshared safe area', 32), /refresh-bg-btn bottom/);
  const oldZen = sample(640, 360); Object.assign(oldZen.zen, { left: 14, right: 58, top: 14, bottom: 58 });
  assert.throws(() => assertHomeControlsGeometry(oldZen, 'old Zen corner'), /Zen left/);
  const wrongZenInset = sample(360, 560, 32); wrongZenInset.zen.bottom += 32;
  assert.throws(() => assertHomeControlsGeometry(wrongZenInset, 'Zen ignores safe area', 32), /Zen safe-area bottom/);
  const zenBlocked = sample(); zenBlocked.zen.hit = false; zenBlocked.zen.target = 'search-engine-switch';
  assert.throws(() => assertHomeControlsGeometry(zenBlocked, 'covered Zen'), /Zen center is intercepted/);
  const zenEdge = sample(); zenEdge.zen.edgeHits[2] = false;
  assert.throws(() => assertHomeControlsGeometry(zenEdge, 'partially covered Zen'), /Zen target edges/);
  const engineBlocked = sample(640, 360); engineBlocked.visibleTargets[1].hit = false; engineBlocked.visibleTargets[1].target = 'zen-toggle-btn';
  assert.throws(() => assertHomeControlsGeometry(engineBlocked, 'old engine interception'), /google center is intercepted/);
  const desktopEngine = sample(1280, 900); desktopEngine.visibleTargets[1].hit = false;
  assert.throws(() => assertHomeControlsGeometry(desktopEngine, 'desktop engine interception'), /visible engine google center is intercepted/);
  for (const width of [360, 640, 761]) {
    const minimal = sample(width), corner = width <= 760 ? 14 : 20;
    Object.assign(minimal.zen, { left: corner, right: corner + 44, top: corner, bottom: corner + 44 });
    assertZenEntryGeometry(minimal, `unit minimal ${width}`, 0, true);
    minimal.zen.top += 10;
    assert.throws(() => assertZenEntryGeometry(minimal, 'moved minimal entry', 0, true), /unchanged top-left Zen/);
  }
  assert.match(homeCss, /--home-controls-safe-area:\s*env\(safe-area-inset-bottom,\s*0px\)/, 'native safe-area inset feeds the shared narrow layout variable');
}

{
  const timezone = () => ({
    panel: { left: 41, right: 291, top: 81, bottom: 395 }, clip: { left: 0, right: 320, top: 0, bottom: 404 },
    innerClip: { left: 42, right: 280, top: 82, bottom: 394 }, target: { left: 48, right: 274, top: 352, bottom: 388 },
    outline: { width: 3, offset: 3, style: 'solid' }, scrollPadding: { top: 6, bottom: 6 },
    focused: true, focusVisible: true, hit: true
  });
  assertTimezoneFocusGeometry(timezone(), 'unit final timezone');
  const first = timezone(); Object.assign(first.target, { top: 88, bottom: 124 });
  assertTimezoneFocusGeometry(first, 'unit first timezone');
  const clippedPanel = timezone(); clippedPanel.panel.bottom = 411; clippedPanel.target.bottom = 404;
  assert.throws(() => assertTimezoneFocusGeometry(clippedPanel, 'old 330px panel'), /complete timezone panel/);
  const clippedRing = timezone(); clippedRing.target.bottom = 390;
  assert.throws(() => assertTimezoneFocusGeometry(clippedRing, 'inner ring edge clipped'), /complete 6px outward focus ring/);
  const reducedOutline = timezone(); reducedOutline.outline.width = 2;
  assert.throws(() => assertTimezoneFocusGeometry(reducedOutline, 'shrunk outline'), /original 3px focus outline/);
  const insetOutline = timezone(); insetOutline.outline.offset = -3;
  assert.throws(() => assertTimezoneFocusGeometry(insetOutline, 'inset instead of preserved ring'), /original 3px outward outline offset/);
  const noTopClearance = timezone(); noTopClearance.scrollPadding.top = 0;
  assert.throws(() => assertTimezoneFocusGeometry(noTopClearance, 'focus scroll ignores top ring'), /top 6px ring clearance/);
  const noBottomClearance = timezone(); noBottomClearance.scrollPadding.bottom = 0;
  assert.throws(() => assertTimezoneFocusGeometry(noBottomClearance, 'focus scroll ignores bottom ring'), /bottom 6px ring clearance/);
  const hiddenFocus = timezone(); hiddenFocus.focusVisible = false;
  assert.throws(() => assertTimezoneFocusGeometry(hiddenFocus, 'focus state without visible ring'), /native keyboard focus visibly styles/);
  const intercepted = timezone(); intercepted.hit = false;
  assert.throws(() => assertTimezoneFocusGeometry(intercepted, 'timezone behind nav'), /wins its center hit test/);
}
