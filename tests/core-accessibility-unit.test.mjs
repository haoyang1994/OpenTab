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
const timezone = home.slice(home.indexOf('  function renderTimezoneList()'), home.indexOf('  function getTimePartsInTimezone('));
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
  assert.match(html, /id="search-input"[^>]*data-i18n-title="[^"]*Alt\+↓[^"]*Tab[^"]*"/);
  assert.match(html, /id="search-input"[^>]*aria-keyshortcuts="Alt\+ArrowDown Alt\+ArrowUp"/);
}

console.log('Core accessibility unit tests passed');

await import('./wallpaper-readability-unit.mjs');
