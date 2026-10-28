import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNativeFixtureFocus, reportWindowFullscreenFailure } from './window-fullscreen-native.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), Workspace = require('../workspace-persistence.js');
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const COMMAND = 'toggle-window-fullscreen', KEY = 'windowFullscreenShortcutEnabled', PREFIX = 'opentab.windowFullscreen.';
const clone = value => structuredClone(value);
const settle = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; }

// Execute the actual service-worker imports and registered command listener.
// Only Chrome's platform boundary is mocked, not the production toggle logic.
function harness({ local = {}, session = {}, windows = [{ id: 7, type: 'normal', state: 'normal' }] } = {}) {
  const hooks = {}, calls = [], updates = [], localWrites = [], windowsById = new Map(windows.map(window => [window.id, clone(window)]));
  const listeners = {};
  function area(name, store) {
    return {
      async get(keys) {
        calls.push(`${name}.get`); if (hooks[`${name}.get`]) await hooks[`${name}.get`](keys);
        const chosen = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
        return clone(Object.fromEntries(chosen.filter(key => Object.hasOwn(store, key)).map(key => [key, store[key]])));
      },
      async set(patch) {
        calls.push(`${name}.set`); if (hooks[`${name}.set`]) await hooks[`${name}.set`](patch);
        if (name === 'local') localWrites.push(clone(patch)); Object.assign(store, clone(patch));
      },
      async remove(key) {
        calls.push(`${name}.remove`); if (hooks[`${name}.remove`]) await hooks[`${name}.remove`](key);
        delete store[key];
      }
    };
  }
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
    commands: { onCommand: { addListener(fn) { listeners.command = fn; } } },
    storage: { local: area('local', local), session: area('session', session) },
    windows: {
      onRemoved: { addListener(fn) { listeners.removed = fn; } },
      async get(id) {
        calls.push('windows.get'); if (hooks.get) await hooks.get(id);
        if (!windowsById.has(id)) throw new Error('Window closed'); return clone(windowsById.get(id));
      },
      async getLastFocused(options) {
        calls.push('windows.getLastFocused'); assert.deepEqual(clone(options), { windowTypes: ['normal'] });
        if (hooks.lastFocused) return hooks.lastFocused();
        return clone([...windowsById.values()].filter(window => window.type === 'normal').at(-1));
      },
      async update(id, patch) {
        calls.push('windows.update'); if (hooks.update) await hooks.update(id, patch);
        if (!windowsById.has(id)) throw new Error('Window closed');
        updates.push({ id, ...clone(patch) }); Object.assign(windowsById.get(id), patch); return clone(windowsById.get(id));
      }
    }
  };
  const context = vm.createContext({ chrome, console, AbortController, URL, setTimeout, clearTimeout, queueMicrotask });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(read(name), context, { filename: name }));
  vm.runInContext(read('background.js'), context, { filename: 'background.js' });
  return { local, session, windowsById, chrome, hooks, calls, updates, localWrites,
    command: (tab = { windowId: 7 }) => listeners.command(COMMAND, tab),
    unknown: () => listeners.command('unrecognized-command', { windowId: 7 }),
    removed: id => listeners.removed(id) };
}
const enabledHarness = options => harness({ local: { [KEY]: true }, ...options });

const manifest = JSON.parse(read('manifest.json'));
assert.deepEqual(manifest.commands[COMMAND], { description: '__MSG_windowFullscreenShortcut__' }, 'initially unbound and never OS-global');
assert.deepEqual(manifest.permissions, ['storage', 'activeTab'], 'no tabs, scripting or broad host permission expansion');
assert.deepEqual(manifest.host_permissions, ['https://www.bing.com/*', 'https://wttr.in/*']);
assert.doesNotMatch(read('lib/window-fullscreen.js'), /requestFullscreen|executeScript|\.url\b|suggested_key|global:\s*true/);
for (const value of [undefined, false, null, 0, 1, 'true', {}, []]) {
  const local = value === undefined ? { unrelated: 'preserve' } : { [KEY]: value, unrelated: 'preserve' };
  const h = harness({ local }); const before = clone(local);
  assert.equal((await h.command()).reason, 'disabled');
  assert.deepEqual(h.updates, []); assert.deepEqual(h.session, {}); assert.deepEqual(local, before);
  assert.ok(h.calls.every(call => call === 'local.get'), 'default/disabled commands do not even inspect windows');
}
{
  const h = enabledHarness(); assert.equal(h.unknown(), undefined); assert.deepEqual(h.calls, []);
}
for (const state of ['normal', 'maximized']) {
  const session = {}, h = enabledHarness({ session, windows: [{ id: 7, type: 'normal', state }] });
  assert.equal((await h.command({ windowId: 7, url: 'chrome://settings/' })).state, 'fullscreen', 'restricted URLs are not a blocker');
  assert.equal(session[PREFIX + 7], state);
  assert.equal((await h.command()).state, state); assert.deepEqual(session, {});
  assert.deepEqual(h.updates, [{ id: 7, state: 'fullscreen' }, { id: 7, state }]);
  assert.deepEqual(h.localWrites, []);
  await h.command();
  const restarted = enabledHarness({ session, windows: [...h.windowsById.values()] });
  assert.equal((await restarted.command()).state, state, 'worker restart restores the prior native window state from session storage');
  assert.deepEqual(session, {});
}
for (const saved of [undefined, 'minimized', 'locked-fullscreen', {}, true]) {
  const h = enabledHarness({ session: { [PREFIX + 7]: saved }, windows: [{ id: 7, type: 'normal', state: 'fullscreen' }] });
  assert.equal((await h.command()).state, 'normal', 'unknown/external fullscreen has a deterministic safe fallback');
}
for (const target of [
  { id: 7, type: 'popup', state: 'normal' }, { id: 7, type: 'devtools', state: 'normal' },
  { id: 7, type: 'normal', state: 'minimized' }, { id: 7, type: 'normal', state: 'locked-fullscreen' },
  { id: 7, type: 'normal' }, { id: -1, type: 'normal', state: 'normal' }
]) {
  const h = enabledHarness({ windows: [target, { id: 8, type: 'normal', state: 'normal' }] });
  assert.equal((await h.command()).reason, 'window-unavailable'); assert.deepEqual(h.updates, []);
  assert.ok(!h.calls.includes('windows.getLastFocused'), 'explicit bad target never redirects to another window');
}
for (const tab of [null, {}, { windowId: -1 }, { windowId: '7' }]) {
  const h = enabledHarness(); assert.equal((await h.command(tab)).state, 'fullscreen');
  assert.ok(h.calls.includes('windows.getLastFocused'));
}
for (const returned of [undefined, { id: 9, type: 'popup', state: 'normal' }]) {
  const h = enabledHarness(); h.hooks.lastFocused = () => returned;
  assert.equal((await h.command(null)).reason, 'window-unavailable'); assert.deepEqual(h.updates, []);
}
{
  const h = enabledHarness(), gate = deferred(); let once = true;
  h.hooks.update = async () => { if (once) { once = false; await gate.promise; } };
  const first = h.command(), second = h.command(), third = h.command();
  await settle(); assert.equal(h.updates.length, 0); gate.resolve();
  assert.deepEqual((await Promise.all([first, second, third])).map(result => result.state), ['fullscreen', 'normal', 'fullscreen']);
  assert.equal(h.session[PREFIX + 7], 'normal', 'serialized rapid commands do not replace the restore state with fullscreen');
}
{
  const h = enabledHarness(), gate = deferred(); h.hooks['session.set'] = () => gate.promise;
  const pending = h.command(); await settle(); h.local[KEY] = false; gate.resolve();
  assert.equal((await pending).reason, 'disabled'); assert.deepEqual(h.updates, [], 'disable during a pending operation blocks its action boundary');
}
{
  const h = enabledHarness(), gate = deferred(); let once = true;
  h.hooks.update = async () => { if (once) { once = false; await gate.promise; } };
  const first = h.command(); await settle(); h.local[KEY] = false;
  const disabledAtInvocation = h.command(); await settle(); h.local[KEY] = true; gate.resolve(); await first;
  assert.equal((await disabledAtInvocation).reason, 'disabled', 'later enabling cannot authorize a queued command issued while off');
  assert.equal(h.updates.length, 1);
}
{
  const h = enabledHarness(); h.hooks['session.set'] = () => { h.windowsById.delete(7); };
  assert.equal((await h.command()).reason, 'api-error'); assert.deepEqual(h.updates, []);
  await h.removed(7); assert.deepEqual(h.session, {}, 'closed-window event cleans stale restore metadata');
}
for (const stage of ['local.get', 'session.set', 'session.get', 'get', 'update', 'lastFocused']) {
  const h = enabledHarness({ windows: [{ id: 7, type: 'normal', state: stage === 'session.get' ? 'fullscreen' : 'normal' }] });
  h.hooks[stage] = () => { throw new Error('Synthetic Chrome rejection'); };
  assert.equal((await h.command(stage === 'lastFocused' ? null : undefined)).success, false, `${stage} rejects without an uncaught event rejection`);
  assert.deepEqual(h.updates, []); delete h.hooks[stage];
  assert.equal((await h.command()).success, true, 'an API error does not poison the serialized queue');
}
{
  const h = enabledHarness({ session: { [PREFIX + 7]: 'maximized' }, windows: [{ id: 7, type: 'normal', state: 'fullscreen' }] });
  h.hooks['session.remove'] = () => { throw new Error('Cleanup refused'); };
  assert.equal((await h.command()).state, 'maximized', 'cleanup failure is not a false window-action failure');
  assert.equal((await h.command()).state, 'fullscreen'); assert.equal(h.session[PREFIX + 7], 'maximized');
}

// Use the actual workspace merge/queue for default migration and durable opt-in.
{
  const local = { icons: [], folders: [{ id: 'folder-home', name: 'Keep' }], todos: [], themeMode: 'light', custom: 'untouched' };
  const h = harness({ local }); const state = { ...clone(local), [KEY]: false };
  const bridge = Workspace.forChrome(h.chrome).connect({ state }); bridge.seed(local);
  state.themeMode = 'dark'; assert.equal(await bridge.save(), true);
  assert.equal(Object.hasOwn(local, KEY), false, 'unrelated saves do not force a missing-key migration');
  state[KEY] = true; assert.equal(await bridge.save(), true); assert.equal(local[KEY], true);
  const staleState = { ...clone(local) }, stale = Workspace.forChrome(h.chrome).connect({ state: staleState }); stale.seed(local);
  state[KEY] = false; assert.equal(await bridge.save(), true); staleState.themeMode = 'light';
  assert.equal(await stale.save(), true); assert.equal(local[KEY], false, 'another tab cannot re-enable an unchanged stale preference');
  assert.equal(local.custom, 'untouched'); assert.equal(local.folders[0].name, 'Keep');
  assert.equal((await h.command()).reason, 'disabled');
}

// Exercise real settings command-discovery and checkbox/manage handlers.
const settings = read('settings-nav.js');
{
  const nodes = new Map();
  for (const id of ['window-fullscreen-shortcut-binding', 'window-fullscreen-shortcut-enabled', 'manage-window-fullscreen-shortcut']) {
    nodes.set(id, { checked: false, disabled: false, textContent: '', handlers: {}, attributes: {},
      addEventListener(type, fn) { this.handlers[type] = fn; },
      setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } });
  }
  const output = nodes.get('window-fullscreen-shortcut-binding'), checkbox = nodes.get('window-fullscreen-shortcut-enabled');
  const local = {}, h = harness({ local }), state = { [KEY]: false };
  const bridge = Workspace.forChrome(h.chrome).connect({ state }); bridge.seed(local);
  let shortcut = '', error = false, panelHidden = true, reads = 0, readHook;
  const opened = [], toasts = [], focus = [], visibility = [];
  const document = { visibilityState: 'visible', addEventListener(type, fn) {
    assert.equal(type, 'visibilitychange'); visibility.push(fn);
  } };
  const context = vm.createContext({
    $: id => nodes.get(id), hostedBound: false, panel: () => ({ classList: {
      contains: () => panelHidden, remove: () => { panelHidden = false; }
    } }), document,
    window: { addEventListener: (type, fn) => { assert.equal(type, 'focus'); focus.push(fn); } },
    chrome: { commands: { async getAll() {
      reads++; if (readHook) return readHook();
      if (error) throw new Error('unavailable'); return [{ name: COMMAND, shortcut }];
    } },
      tabs: { async create(options) { opened.push(clone(options)); } } },
    host: { state, saveState: () => bridge.save(), showToast: value => toasts.push(value) },
    syncFromState: () => { checkbox.checked = state[KEY] === true; }, t: value => value,
    bindFocusTrap() {}, bindPanel() {}, buildNav() {}, ensureResetButtons() {}, fillAbout() {}, loadDeveloperTools() {}, noteIcons() {},
    preserveDraftsOnOpen: false, activeId: 'shortcuts', setActive() {}
  });
  vm.runInContext(settings.slice(settings.indexOf('  let shortcutRead = 0;'), settings.indexOf('  function persistDeveloperTools(')), context);
  const controls = settings.slice(settings.indexOf('  function bindHostedControls()'), settings.indexOf("    const timeFormat = $('time-format');", settings.indexOf('  function bindHostedControls()')));
  vm.runInContext(controls + '\n}', context);
  vm.runInContext(settings.slice(settings.indexOf('  function init(nextHost)'), settings.indexOf("\n  if (typeof document !== 'undefined') {", settings.indexOf('  function init(nextHost)'))), context);
  vm.runInContext(settings.slice(settings.indexOf('  function open(options = {})'), settings.indexOf('  function openSection(')), context);
  context.init(); context.init(); await settle();
  assert.equal(reads, 0, 'closed settings initialization sends no command-discovery IPC');
  assert.equal(focus.length, 1); assert.equal(visibility.length, 1, 'reinitialization does not duplicate lifecycle listeners');
  focus[0](); visibility[0](); await settle();
  assert.equal(reads, 0, 'closed settings ignore focus and visibility events');
  context.open(); await settle(); assert.equal(output.textContent, '未设置'); assert.equal(reads, 1, 'opening settings discovers the real binding');
  document.visibilityState = 'hidden'; visibility[0](); focus[0](); await settle();
  assert.equal(reads, 1, 'background tabs do not refresh on hide or an unrelated focus notification');
  shortcut = 'Ctrl+Shift+Y'; document.visibilityState = 'visible'; visibility[0](); await settle();
  assert.equal(reads, 2); assert.equal(output.textContent, shortcut, 'returning to a visible tab refreshes without any window-focus event');
  assert.equal(output.attributes['data-i18n'], undefined, 'the real assigned key is never replaced by translated fallback text');
  shortcut = 'Ctrl+Shift+U'; focus[0](); await settle();
  assert.equal(output.textContent, shortcut, 'focus return still refreshes a continuously visible tab');
  const stale = deferred(); readHook = () => stale.promise; visibility[0]();
  readHook = undefined; shortcut = 'Ctrl+Shift+Y'; focus[0](); await settle();
  stale.resolve([{ name: COMMAND, shortcut: '' }]); await settle();
  assert.equal(output.textContent, shortcut, 'a slow visibility read cannot overwrite a newer focus read');
  checkbox.checked = true; await checkbox.handlers.change(); assert.equal(local[KEY], true); assert.equal(checkbox.disabled, false);
  checkbox.checked = false; await checkbox.handlers.change(); assert.equal(local[KEY], false);
  await context.refreshWindowFullscreenShortcut(); assert.equal(output.textContent, shortcut, 'disable does not claim to clear Chrome binding');
  await nodes.get('manage-window-fullscreen-shortcut').handlers.click();
  assert.deepEqual(opened, [{ url: 'chrome://extensions/shortcuts' }]); assert.deepEqual(toasts, []);
  for (const [userAgent, scheme] of [
    ['Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36 Edg/156.0.4314.50', 'edge'],
    ['Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36', 'chrome'],
    ['', 'chrome']
  ]) {
    context.navigator = { userAgent };
    await nodes.get('manage-window-fullscreen-shortcut').handlers.click();
    assert.deepEqual(opened.at(-1), { url: `${scheme}://extensions/shortcuts` });
  }
  assert.deepEqual(toasts, []);
  error = true; visibility[0](); await settle(); assert.equal(output.textContent, '不可用', 'API failure is not mislabeled as unassigned');
  error = false; shortcut = ''; focus[0](); await settle();
  assert.equal(output.textContent, '未设置'); assert.equal(output.attributes['data-i18n'], '未设置', 'clearing the Chrome binding restores the localized fallback');
}
console.log('Browser-window fullscreen units passed: actual command listener, strict opt-in, native window targeting, serialization, restart restore, failures and settings durability.');
// Only the owned page gets a public CDP session. Reset after each navigation,
// never inject a focus event/refresh, and propagate failed setup without retry.
{
  const page = {}, calls = [], rejection = new Error('CDP reset rejected'); let reject = false;
  const focus = await createNativeFixtureFocus({ async newCDPSession(target) {
    assert.equal(target, page); calls.push('attach');
    return { async send(method, params) {
      calls.push({ method, params }); if (reject) throw rejection;
    }, async detach() { calls.push('detach'); } };
  } }, page);
  assert.deepEqual(calls, ['attach']); assert.equal(focus.resetCount(), 0);
  for (let i = 0; i < 4; i++) await focus.afterNavigation();
  assert.equal(focus.resetCount(), 4);
  assert.deepEqual(calls.slice(1), Array.from({ length: 4 }, () => ({ method: 'Emulation.setFocusEmulationEnabled', params: { enabled: false } })));
  reject = true;
  await assert.rejects(focus.afterNavigation(), error => error === rejection);
  assert.equal(calls.length, 6, 'a rejected CDP action is attempted only once');
  assert.equal(focus.resetCount(), 4, 'diagnostics count only acknowledged resets');
  await focus.detach(); assert.equal(calls.at(-1), 'detach');
  await assert.rejects(createNativeFixtureFocus({ async newCDPSession() { throw rejection; } }, page), error => error === rejection);
}
// Failure diagnostics run without a browser and never log URLs, page titles,
// process arguments, or raw errors from an unrelated target.
{
  const errors = [], screenshots = [], originalError = console.error;
  console.error = message => errors.push(message);
  try {
    const worker = { evaluate(fn, target) {
      return vm.runInNewContext(`(${fn.toString()})(target)`, { target,
        chrome: { windows: { get: async id => ({ id, type: 'normal', state: 'maximized', focused: false, title: 'private title' }) },
          tabs: { get: async id => ({ id, windowId: 7, active: false, url: 'private URL', title: 'private title' }) },
          commands: { getAll: async () => [{ name: COMMAND, shortcut: 'Ctrl+Shift+Y', description: 'private description' }] } },
        __windowFullscreenNative: {
          events: Array.from({ length: 20 }, () => ({ name: COMMAND, windowId: 7, url: 'private URL' })),
          results: Array.from({ length: 20 }, () => ({ success: true, windowId: 7, state: 'fullscreen', extra: 'private data' }))
        } });
    } };
    const page = {
      async screenshot(options) { screenshots.push(options); },
      evaluate(fn) { return vm.runInNewContext(`(${fn.toString()})()`, {
        document: { visibilityState: 'visible', hasFocus: () => false,
          getElementById: id => id === 'settings-panel' ? { classList: { contains: () => false } } : { textContent: 'Not set' } },
        __windowFullscreenLifecycle: { counts: { focus: 0, blur: 1, visibilitychange: 20, extra: 'private counter' },
          events: Array.from({ length: 20 }, () => ({ type: 'visibilitychange', visible: true, focused: false, trusted: true, extra: 'private event' })) }
      }); }
    };
    const report = await reportWindowFullscreenFailure({ worker, page,
      windowId: 7, tabId: 12, expectedCommands: 21, artifacts: '/tmp/disposable-native-artifacts', phase: 'return-binding-label', focusResetCount: 4 });
    assert.equal(report.observation.eventCount, 20); assert.equal(report.observation.resultCount, 20);
    assert.equal(report.observation.events.length, 8); assert.equal(report.observation.results.length, 8);
    assert.deepEqual(clone(report.observation.windowState), { id: 7, type: 'normal', state: 'maximized', focused: false });
    assert.deepEqual(clone(report.observation.tabState), { id: 12, windowId: 7, active: false });
    assert.deepEqual(clone(report.observation.binding), { registered: true, shortcut: 'Ctrl+Shift+Y' });
    assert.equal(report.phase, 'return-binding-label');
    assert.equal(report.focusResetCount, 4); assert.equal(report.visibilityMayRemainEmulated, true);
    assert.equal(report.pageState.visible, true); assert.equal(report.pageState.focused, false);
    assert.equal(report.pageState.settingsOpen, true); assert.equal(report.pageState.bindingPresent, true);
    assert.equal(report.pageState.bindingText, 'Not set');
    assert.deepEqual(clone(report.pageState.lifecycle.counts), { focus: 0, blur: 1, visibilitychange: 20 });
    assert.equal(report.pageState.lifecycle.events.length, 8);
    assert.deepEqual(clone(report.pageState.lifecycle.events[0]), { type: 'visibilitychange', visible: true, focused: false, trusted: true });
    assert.equal(report.screenshot.captured, true); assert.equal(screenshots[0].timeout, 2000);
    assert.equal(screenshots[0].path, '/tmp/disposable-native-artifacts/window-fullscreen-failure.png');
    const unavailable = await reportWindowFullscreenFailure({
      worker: { async evaluate() { throw new Error('private worker failure'); } },
      page: { async screenshot() { throw new Error('private screenshot failure'); } },
      windowId: 7, expectedCommands: 1, artifacts: '/tmp/disposable-native-artifacts' });
    assert.deepEqual(unavailable.observation, { unavailable: true });
    assert.deepEqual(unavailable.pageState, { unavailable: true });
    assert.deepEqual(unavailable.screenshot, { unavailable: true });
    assert.doesNotMatch(errors.join('\n'), /private/);
  } finally { console.error = originalError; }
}
execFileSync('python3', ['-B', fileURLToPath(new URL('./window-fullscreen-key.test.py', import.meta.url))], { stdio: 'inherit' });
