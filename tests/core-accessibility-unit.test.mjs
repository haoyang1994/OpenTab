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

console.log('Core accessibility unit tests passed');
