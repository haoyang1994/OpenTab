import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('lib/core-accessibility.js', root), 'utf8');
let focused = null;
const attached = new Set();
const body = {};
const context = {
  document: { body, contains: (el) => attached.has(el) },
  window: { getComputedStyle: (el) => ({ display: el.display || 'block', visibility: el.visibility || 'visible' }) },
  CSS: { escape: (value) => value }
};
vm.createContext(context);
vm.runInContext(source, context);
const { rememberFocus, restoreFocus } = context.OpenTabAccessibility.createFocus();
function node(kind = '', id = '') {
  const el = {
    dataset: { id },
    matches: (selector) => selector.includes(kind) && Boolean(kind),
    closest: () => el.hiddenAncestor ? {} : null,
    focus: () => { focused = el; }
  };
  attached.add(el);
  return el;
}
const opener = node();
rememberFocus(opener);
assert.equal(restoreFocus(), opener);
assert.equal(focused, opener);
assert.equal(restoreFocus(), null, 'restoration consumes the saved opener once');
for (const [key, value] of [['disabled', true], ['hiddenAncestor', true], ['display', 'none'], ['visibility', 'hidden']]) {
  const hidden = node(); hidden[key] = value;
  rememberFocus(opener); rememberFocus(hidden);
  assert.equal(restoreFocus(), opener, `skip ${key}`);
}
for (const kind of ['.icon-widget', '.add-shortcut-tile']) {
  const old = node(kind, 'shortcut');
  const replacement = node(kind, 'shortcut');
  old.parentElement = { querySelector: (selector) => {
    assert.ok(selector.includes(kind));
    return replacement;
  } };
  rememberFocus(old);
  attached.delete(old);
  assert.equal(restoreFocus(), replacement, `re-rendered ${kind} opener`);
}
const html = fs.readFileSync(new URL('home.html', root), 'utf8');
assert.ok(html.indexOf('src="lib/core-accessibility.js"') < html.indexOf('src="home.js"'));
assert.match(html, /<button id="change-icon-upload"[^>]*type="button"/);
const home = fs.readFileSync(new URL('home.js', root), 'utf8');
const timezone = home.slice(home.indexOf('  function renderTimezoneList()'), home.indexOf('  function updateClock('));
assert.match(timezone, /createElement\('button'\)/);
assert.match(timezone, /aria-pressed/);
assert.match(timezone, /aria-expanded/);
const css = fs.readFileSync(new URL('home.css', root), 'utf8');
for (const selector of ['.settings-panel.hidden', '#todo-widget.hidden', '.timezone-selector.hidden', '.modal.hidden']) {
  const rule = css.slice(css.indexOf(selector + ' {')).split('}')[0];
  assert.match(rule, /visibility:\s*hidden/, `${selector} excludes hidden descendants from keyboard navigation`);
}
{
  let restores = 0;
  const classes = new Set();
  const context = vm.createContext({
    iconUploadGate: { reset() {} }, iconSaveGate: { release() {} }, iconDraftIntent: {}, editingIconId: 'x', pendingIconUploadDataUrl: 'image',
    elements: { addIconModal: { classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name) } } },
    restoreFocus() { restores++; }
  });
  const start = home.indexOf('  function closeAddIconModal(');
  vm.runInContext(home.slice(start, home.indexOf('  async function handleSaveIcon(', start)) + '\ncloseAddIconModal(); closeAddIconModal();', context);
  assert.equal(restores, 1, 'repeated Add/Edit close restores focus exactly once');
  assert.equal(context.iconDraftIntent, null);
}

// Exercise the production handler without exporting a test-only API.
{
  const search = fs.readFileSync(new URL('search.js', root), 'utf8');
  const handlerStart = search.indexOf('  function onSearchKeydown(');
  const imeStart = search.indexOf('  function isImeKeydown(');
  assert.ok(handlerStart >= 0 && imeStart >= 0);
  assert.match(search, /input\.addEventListener\('keydown', onSearchKeydown\)/);
  const effects = [];
  const context = vm.createContext({
    searchState: { searchHistoryEnabled: true }, historyHighlight: -1,
    filteredHistory: () => ['first', 'second', 'third'],
    renderHistory: () => effects.push('history'),
    cycleEngine: (step) => effects.push(['engine', step]),
    submit: (options) => effects.push(['submit', options.forceNewTab]),
    applyHistoryItem: (item, forceNewTab) => effects.push(['item', item, forceNewTab])
  });
  vm.runInContext(
    search.slice(imeStart, search.indexOf('\n  function ', imeStart + 1)) +
    search.slice(handlerStart, search.indexOf('  function onSearchAuxClick(', handlerStart)), context);
  function press(key, overrides = {}) {
    effects.length = 0;
    let prevented = false;
    const event = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      preventDefault() { prevented = true; }, ...overrides };
    context.onSearchKeydown(event);
    return prevented;
  }
  for (const shiftKey of [false, true]) {
    assert.equal(press('Tab', { shiftKey }), false, 'both Tab directions allow native focus navigation');
    assert.deepEqual(effects, [], 'Tab never cycles engines or history');
  }
  for (const [key, step] of [['ArrowDown', 1], ['ArrowUp', -1]]) {
    assert.equal(press(key, { altKey: true }), true);
    assert.deepEqual(effects, [['engine', step]], `${key} with Alt cycles only engines`);
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
      for (const altKey of [false, true]) {
        assert.equal(press(key, { altKey, [modifier]: true }), false, `${modifier} is not intercepted`);
        assert.deepEqual(effects, []);
      }
    }
    for (const ime of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }]) {
      for (const altKey of [false, true]) {
        assert.equal(press(key, { altKey, ...ime }), false, 'IME keeps native arrows');
        assert.deepEqual(effects, []);
      }
      assert.equal(press('Enter', ime), false, 'IME confirmation must not submit');
      assert.deepEqual(effects, []);
    }
    assert.equal(press(key, { altKey: true, defaultPrevented: true }), false);
    assert.deepEqual(effects, []);
  }
  assert.equal(press('Process', { altKey: true }), false);
  assert.deepEqual(effects, []);
  assert.equal(press('ArrowDown'), true);
  assert.equal(context.historyHighlight, 0, 'ordinary Down selects first history item');
  assert.deepEqual(effects, ['history']);
  assert.equal(press('ArrowUp'), true);
  assert.equal(context.historyHighlight, 2, 'ordinary Up wraps history backwards');
  assert.deepEqual(effects, ['history']);
  context.searchState.searchHistoryEnabled = false;
  assert.equal(press('ArrowDown'), false, 'disabled history leaves ordinary arrows alone');
  assert.deepEqual(effects, []);
  context.searchState.searchHistoryEnabled = true;
  context.filteredHistory = () => [];
  assert.equal(press('ArrowUp'), false, 'empty history leaves ordinary arrows alone');
  assert.deepEqual(effects, []);
  assert.equal(press('ArrowDown', { altKey: true }), true, 'engine switching does not require history');
  assert.deepEqual(effects, [['engine', 1]]);
  context.historyHighlight = -1;
  for (const modifier of ['ctrlKey', 'metaKey']) {
    assert.equal(press('Enter', { [modifier]: true }), true);
    assert.deepEqual(effects, [['submit', true]], `${modifier}+Enter still opens a new tab`);
  }
  const searchInput = html.match(/<input\b[^>]*id="search-input"[^>]*>/)?.[0];
  assert.ok(searchInput, 'the native search input remains available');
  assert.doesNotMatch(searchInput, /(?:^|\s)(?:data-i18n-)?title=/, 'search has no instructional tooltip');
  assert.match(searchInput, /aria-label="搜索、网址或快捷方式名称"/, 'search retains a concise accessible name');
  assert.match(searchInput, /aria-keyshortcuts="Alt\+ArrowDown Alt\+ArrowUp"/);
}

console.log('Core accessibility unit tests passed');

await import('./wallpaper-readability-unit.mjs');

// Success must stay quiet without removing safe undo or necessary errors.
{
  const classes = new Set(['hidden']), timers = new Map(); let timerId = 0, current = true, blocked = false, calls = 0;
  const toast = { dataset: {}, children: [], classList: { add: value => classes.add(value), remove: value => classes.delete(value) }, replaceChildren() { this.children = []; }, append(...nodes) { this.children.push(...nodes); } };
  const ctx = { document: { querySelector: () => blocked ? {} : null, createTextNode: text => ({ textContent: text }), createElement: () => ({ attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } }) },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const api = ctx.OpenTabAccessibility.createFeedback({ toast, getWorkspace: () => ({ captureIntent: () => ({}), isIntentCurrent: () => current }), t: text => text });
  api.showError('已恢复', { kind: 'success' }); assert.equal(classes.has('hidden'), true); assert.equal(toast.children.length, 0);
  api.showError('已删除', { actionLabel: '撤销', onAction: () => { calls++; } });
  assert.equal(classes.has('hidden'), true, 'undo availability never creates a success notice'); assert.equal(api.canUndo(), true);
  const key = (extra = {}) => { let prevented = false; api.handleKeydown({ key: 'z', ctrlKey: true, target: { closest: () => null }, preventDefault() { prevented = true; }, ...extra }); return prevented; };
  assert.equal(key({ target: { closest: () => ({}) } }), false, 'native text undo is preserved');
  blocked = true; assert.equal(key(), false, 'dialogs and drags retain their keyboard handling'); blocked = false;
  assert.equal(key({ isComposing: true }), false); assert.equal(key(), true); await new Promise(setImmediate); assert.equal(calls, 1);
  assert.equal(await api.undo(), false, 'repeated undo cannot replay an inverse');
  api.offerUndo(() => { calls++; }); current = false; assert.equal(key(), false, 'stale views cannot undo'); current = true;
  api.showError('读取失败'); assert.equal(classes.has('hidden'), false);
  api.showError('', { source: 'widgets' }); assert.equal(classes.has('hidden'), false, 'a quiet widget refresh cannot erase another source error');
  api.showError('位置无效', { source: 'widgets' }); assert.equal(toast.children[0].textContent, '位置无效');
  const dismiss = toast.children[1]; assert.equal(dismiss.attrs['aria-label'], '关闭'); dismiss.onclick(); assert.equal(classes.has('hidden'), true);
  api.showError('保存失败', { source: 'widgets' }); api.showError('', { source: 'widgets' }); assert.equal(classes.has('hidden'), true);
  let resolveUndo; const flight = new Promise(resolve => { resolveUndo = resolve; });
  api.offerUndo(() => { calls++; return flight; }); const first = api.undo(); assert.equal(await api.undo(), false); resolveUndo(true); await first; assert.equal(calls, 2);
  api.showError('表单已有错误', { kind: 'inline' }); assert.equal(classes.has('hidden'), true, 'inline errors are not duplicated globally');
  assert.equal(fs.readFileSync(new URL('home.html', root), 'utf8').includes('desktop-widget-feedback'), false);
  for (const name of ['sync.js', 'import.js']) assert.equal(fs.readFileSync(new URL(name, root), 'utf8').includes("document.getElementById('toast')"), false, `${name} does not construct its own success notice`);
}
console.log('Quiet feedback passed: silent successes, guarded keyboard undo, single-flight inverse, native text/IME/modal handling, scoped errors and dismissal.');

// The actual tile handler must open its menu without relying on an OS-generated
// contextmenu event (which Shift+F10 does not produce on macOS Chromium).
{
  const calls = [];
  const widget = { dataset: { id: 'keyboard-site' }, getBoundingClientRect: () => ({ left: 12, bottom: 64 }) };
  const menuButton = { focus() { calls.push('focus menu'); } };
  const c = vm.createContext({
    document: { getElementById: () => ({ querySelector: selector => { assert.match(selector, /:not\(\.hidden\)/); return menuButton; } }) },
    host: { rememberFocus: node => { assert.equal(node, widget); calls.push('remember'); } },
    openIconContextMenu: (point, id) => calls.push([point.clientX, point.clientY, id])
  });
  const iconsSource = fs.readFileSync(new URL('icons.js', root), 'utf8');
  const start = iconsSource.indexOf('  function handleMenuKeydown(');
  vm.runInContext(iconsSource.slice(start, iconsSource.indexOf('  function placeMenu(', start)), c);
  assert.match(home, /OpenTabIcons\?\.handleMenuKeydown\(event, widget, openIconContextMenu\)/);
  const press = flags => {
    calls.length = 0;
    c.handleMenuKeydown({ preventDefault() { calls.push('prevent'); }, ...flags }, widget, c.openIconContextMenu);
  };
  for (const flags of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
    press(flags); assert.deepEqual(calls, ['prevent', 'remember', [12, 64, 'keyboard-site'], 'focus menu']);
  }
  for (const flags of [{ key: 'F10' }, { key: 'F10', shiftKey: true, isComposing: true },
    { key: 'F10', shiftKey: true, keyCode: 229 }, { key: 'F10', shiftKey: true, ctrlKey: true },
    { key: 'ContextMenu', metaKey: true }]) {
    press(flags); assert.deepEqual(calls, [], 'unrelated modifiers and IME remain owned by their editor');
  }
}

// Hidden panels can contain otherwise focusable descendants. Filter the actual
// production trap list before it tries to focus those invisible controls.
{
  const source = fs.readFileSync(new URL('settings-nav.js', root), 'utf8');
  const doc = { getElementById: () => null, activeElement: null };
  const control = ancestor => ({ disabled: false, hidden: false,
    closest: selector => ancestor && selector.includes(ancestor) ? {} : null,
    focus() { doc.activeElement = this; } });
  const hidden = ['.hidden', '[hidden]', '[inert]'].map(control), first = control(), last = control();
  const dialog = { querySelectorAll: () => [...hidden, first, last], contains: node => [...hidden, first, last].includes(node) };
  const c = vm.createContext({ document: doc, window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) }, FOCUSABLE: 'controls', topDialog: () => dialog });
  vm.runInContext(source.slice(source.indexOf('  function isShown('), source.indexOf('  function dialogRoot('))
    + source.slice(source.indexOf('  function onTabTrap('), source.indexOf('  function bindFocusTrap(')), c);
  assert.deepEqual([...c.focusables(dialog)], [first, last]);
  for (const [from, shiftKey, to] of [[last, false, first], [first, true, last], [doc.body, false, first]]) {
    doc.activeElement = from; let prevented = false;
    c.onTabTrap({ key: 'Tab', shiftKey, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(doc.activeElement, to);
  }
}
console.log('Hidden-panel focus trap passed: hidden/inert ancestors excluded and both keyboard wrap directions preserved.');
