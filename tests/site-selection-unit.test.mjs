import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../site-selection.js', import.meta.url), 'utf8');
const sandbox = { URL, window: {} };
vm.runInNewContext(source, sandbox);
const api = sandbox.window.OpenTabSiteSelection;
const site = (id, extra = {}) => ({ id, type: 'shortcut', url: `https://${id}.example/`, ...extra });
for (const record of [site('a'), site('b', { url: 'http://example.com' }), site('legacy', { type: undefined })]) assert.equal(api.eligible(record), true);
for (const record of [null, {}, site('a', { type: 'folder' }), site('a', { type: 'ssh' }), site('a', { type: 'tool' }), site('a', { url: 'javascript:alert(1)' }), site('a', { url: 'ftp://a.test' }), site('a', { url: '/relative' }), site('a', { url: 'https://' })]) assert.equal(api.eligible(record), false);
const original = new Set(['a', 'removed', 'folder', 'ssh', 'other-view']);
const next = api.selectedInView(original, { sites: [site('a'), site('b'), site('folder', { type: 'folder' }), site('ssh', { type: 'ssh' })] });
assert.deepEqual([...next], ['a']);
assert.equal(original.size, 5, 'revalidation never mutates the captured selection set');
assert.equal(api.scopeKey({ groupId: 'a', parentId: '' }), api.scopeKey({ groupId: 'a' }));
assert.notEqual(api.scopeKey({ groupId: 'a', parentId: 'b' }), api.scopeKey({ groupId: 'b', parentId: 'a' }));
assert.notEqual(api.scopeKey({ groupId: 'a|b', parentId: 'c' }), api.scopeKey({ groupId: 'a', parentId: 'b|c' }));
assert.notEqual(api.scopeKey({ groupId: 'a', view: { sceneId: 's', homeGroupId: 'a', generation: 1 } }), api.scopeKey({ groupId: 'a', view: { sceneId: 's', homeGroupId: 'a', generation: 2 } }), 'returning to the same group after navigation invalidates the old selection view');
assert.notEqual(api.scopeKey({ groupId: 'a', view: { sceneId: 's', homeGroupId: 'a', generation: 1 } }), api.scopeKey({ groupId: 'a', view: { sceneId: 'other', homeGroupId: 'a', generation: 1 } }));
const destinations = [
  { kind: 'group', id: 'g1', name: 'Duplicate', groupId: 'g1' },
  { kind: 'group', id: 'g2', name: 'Duplicate', groupId: 'g2' },
  { kind: 'folder', id: 'f1', name: 'Duplicate', groupId: 'g1' },
  { kind: 'folder', id: 'f2', name: 'Duplicate', groupId: 'g1' }
];
const labels = destinations.map(item => api.destinationLabel(item, { destinations }));
assert.equal(new Set(labels).size, 4);
assert.match(labels[0], /分组/); assert.match(labels[2], /文件夹/);
const across = { kind: 'folder', id: 'f3', name: 'Research', groupId: 'g3', sceneId: 'work-scene', path: ['Work', 'Projects', 'Read later', 'Research'] };
assert.equal(api.destinationLabel(across, { destinations }), '文件夹 · Work / Projects / Read later / Research (f3)', 'scene destinations expose their complete hierarchy and stable identity');
assert.equal(api.destinationLabel({ ...across, path: ['<Work>', 'Research'] }, { destinations }), '文件夹 · <Work> / Research (f3)', 'user names remain literal text');
console.log('Site selection eligibility, current-view revalidation, scope identity and destination labeling passed');

// Execute the complete UI against a small DOM, including capture listeners and
// async persistence. Browser tests separately exercise native activation/focus.
function harness() {
  const handlers = new Map(), elements = new Map();
  let document;
  function matches(node, selector) {
    if (selector.includes(',')) return selector.split(',').some(part => matches(node, part.trim()));
    if (selector === '[data-select-sites]') return node.entry === true;
    if (selector === '.icon-widget[data-id]') return node.classList.contains('icon-widget') && Boolean(node.dataset.id);
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    return node.tagName.toLowerCase() === selector;
  }
  class Element {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.dataset = {}; this.attrs = new Map(); this.listeners = new Map();
      this.className = ''; this.hidden = false; this.disabled = false; this.open = false; this.value = ''; this.isConnected = true;
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        add: (...names) => { for (const name of names) if (!this.classList.contains(name)) this.className += ` ${name}`; },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
        toggle: (name, yes) => this.classList[yes ? 'add' : 'remove'](name)
      };
      if (id) elements.set(id, this);
    }
    appendChild(node) { node.remove(); node.parentElement = this; this.children.push(node); if (node.id) elements.set(node.id, node); return node; }
    prepend(node) { this.appendChild(node); this.children.unshift(this.children.pop()); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    before(node) { this.parentElement.appendChild(node); }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    removeAttribute(key) { this.attrs.delete(key); }
    querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(node => selector === '*' || matches(node, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return matches(this, selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const body = new Element('body');
  document = { body, activeElement: body, createElement: tag => new Element(tag), getElementById: id => elements.get(id), querySelectorAll: selector => body.querySelectorAll(selector), addEventListener(type, fn) { const list = handlers.get(type) || []; list.push(fn); handlers.set(type, list); } };
  for (const id of ['icons-container', 'folder-icons-container', 'folder-overlay', 'site-selection-toolbar', 'site-selection-dialog']) body.appendChild(new Element('div', id));
  const dialog = elements.get('site-selection-dialog');
  for (const [tag, id] of [['select', 'site-selection-destination'], ['button', 'site-selection-dialog-cancel'], ['button', 'site-selection-confirm'], ['p', 'site-selection-error'], ['p', 'site-selection-preview']]) dialog.appendChild(new Element(tag, id));
  const entry = new Element('button', 'select-sites'); entry.entry = true; body.appendChild(entry);
  const root = elements.get('icons-container');
  for (const id of ['a', 'b']) { const tile = new Element('a'); tile.className = 'icon-widget'; tile.dataset.id = id; tile.setAttribute('href', `https://${id}.example/`); root.appendChild(tile); }
  let selectedCaptures = 0, destinationCaptures = 0, moves = 0, resolveMove, destinationValid = true;
  const context = { scope: { groupId: 'home', parentId: '' }, sites: [site('a'), site('b')], destinations: [{ kind: 'group', id: 'work', name: 'Work', groupId: 'work' }] };
  const window = { OpenTabFolders: {
    bulkMoveContext: () => context, isFolderId: () => false,
    captureBulkSelection: () => ({ original: ++selectedCaptures }), captureBulkDestination: destination => destinationValid ? ({ destination, original: ++destinationCaptures }) : null,
    moveSites: (intent, ids, destination) => { moves++; assert.equal(intent.original, 1); assert.deepEqual([...ids], ['a']); assert.equal(destination.original, 1); return new Promise(resolve => { resolveMove = resolve; }); }
  } };
  vm.runInNewContext(source, { window, document, URL, MutationObserver: class { observe() {} } });
  const selection = window.OpenTabSiteSelection;
  selection.init({ endDesktopDrag() {}, hideIconContextMenu() {}, showToast() {} });
  function dispatch(target, type = 'click', props = {}) {
    const event = { type, target, button: 0, key: '', defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...props };
    for (const fn of handlers.get(type) || []) { fn(event); if (event.stopped) break; }
    if (!event.stopped) for (const fn of target.listeners.get(type) || []) fn(event);
    return event;
  }
  return { elements, root, entry, context, selection, document, dispatch, counts: () => ({ selectedCaptures, destinationCaptures, moves }), invalidateDestination: () => { destinationValid = false; }, resolve: result => resolveMove(result) };
}
{
  const h = harness(), el = id => h.elements.get(id), a = h.root.children[0];
  h.dispatch(h.entry); assert.equal(h.selection.isActive(), true); assert.equal(el('site-selection-move').disabled, true);
  assert.equal(a.getAttribute('href'), null); assert.equal(a.querySelector('.site-selection-checkbox').type, 'checkbox');
  h.dispatch(a); assert.equal(a.querySelector('.site-selection-checkbox').checked, true);
  h.dispatch(a, 'auxclick', { button: 1 }); assert.equal(a.querySelector('.site-selection-checkbox').checked, true);
  h.dispatch(el('site-selection-move')); assert.equal(el('site-selection-dialog').open, true);
  let backgroundShortcuts = 0;
  h.document.addEventListener('keydown', () => { backgroundShortcuts++; });
  for (const props of [{ key: '2', code: 'Digit2', altKey: true }, { key: 'Tab' }, { key: 'ArrowDown' }]) {
    const event = h.dispatch(el('site-selection-destination'), 'keydown', props);
    assert.equal(event.stopped, true, 'chooser isolates document shortcuts');
    assert.equal(event.defaultPrevented, false, 'native Tab and select defaults remain available');
  }
  assert.equal(backgroundShortcuts, 0);
  el('site-selection-confirm').focus();
  assert.equal(h.dispatch(el('site-selection-confirm'), 'keydown', { key: 'Tab' }).defaultPrevented, true);
  assert.equal(h.document.activeElement, el('site-selection-destination'));
  assert.equal(h.dispatch(el('site-selection-destination'), 'keydown', { key: 'Tab', shiftKey: true }).defaultPrevented, true);
  assert.equal(h.document.activeElement, el('site-selection-confirm'));
  el('site-selection-dialog-cancel').focus();
  assert.equal(h.dispatch(el('site-selection-dialog-cancel'), 'keydown', { key: 'Tab' }).defaultPrevented, false, 'middle control keeps native Tab default');
  const menu = h.dispatch(el('site-selection-dialog'), 'contextmenu');
  assert.equal(menu.stopped, true); assert.equal(menu.defaultPrevented, true, 'chooser does not open a background Add modal or native menu');
  h.dispatch(el('site-selection-confirm')); assert.equal(h.selection.isPending(), true);
  h.dispatch(el('site-selection-confirm')); h.dispatch(el('site-selection-confirm'), 'keydown', { key: 'Escape' });
  assert.equal(h.counts().moves, 1); assert.equal(el('site-selection-dialog').open, true);
  h.resolve({ ok: false, reason: 'save-failed' }); await new Promise(setImmediate);
  assert.equal(h.selection.isPending(), false); assert.equal(h.selection.isActive(), true); assert.equal(a.querySelector('.site-selection-checkbox').checked, true);
  assert.match(el('site-selection-error').textContent, /重试/);
  h.dispatch(el('site-selection-confirm'), 'keydown', { key: 'Escape' }); assert.equal(el('site-selection-dialog').open, false); assert.equal(h.selection.isActive(), true);
  h.dispatch(el('site-selection-move'), 'keydown', { key: 'Escape' }); assert.equal(h.selection.isActive(), false);
  assert.equal(h.document.activeElement, h.entry); assert.equal(a.getAttribute('href'), 'https://a.example/'); assert.equal(a.querySelector('.site-selection-checkbox'), null);
  assert.deepEqual(h.counts(), { selectedCaptures: 1, destinationCaptures: 1, moves: 1 });
}
{
  const h = harness(); h.dispatch(h.entry); h.dispatch(h.root.children[0]); h.dispatch(h.elements.get('site-selection-move')); h.dispatch(h.elements.get('site-selection-confirm'));
  assert.equal(h.selection.isActive(), true, 'no early success before durable result');
  h.resolve({ ok: true, moved: 1 }); await new Promise(setImmediate);
  assert.equal(h.selection.isActive(), false); assert.equal(h.elements.get('site-selection-dialog').open, false);
}
console.log('Site selection real-module UI pending, duplicate-submit, failure, success, Escape and focus restoration passed');

{
  const h = harness(), el = id => h.elements.get(id);
  h.dispatch(h.entry); h.dispatch(h.root.children[0]); h.dispatch(el('site-selection-move'));
  assert.equal(el('site-selection-confirm').disabled, false); assert.equal(el('site-selection-error').textContent, '');
  h.invalidateDestination(); h.dispatch(el('site-selection-destination'), 'change');
  assert.equal(el('site-selection-confirm').disabled, true, 'an old destination option cannot recapture a changed entity');
  assert.match(el('site-selection-error').textContent, /变化/);
  el('site-selection-dialog-cancel').focus();
  assert.equal(h.dispatch(el('site-selection-dialog-cancel'), 'keydown', { key: 'Tab' }).defaultPrevented, true);
  assert.equal(h.document.activeElement, el('site-selection-destination'));
  assert.equal(h.dispatch(el('site-selection-destination'), 'keydown', { key: 'Tab', shiftKey: true }).defaultPrevented, true);
  assert.equal(h.document.activeElement, el('site-selection-dialog-cancel'), 'disabled Confirm is excluded from the loop');
  h.dispatch(el('site-selection-confirm')); assert.equal(h.counts().moves, 0, 'invalid destination never reaches the durable operation');
  assert.equal(h.selection.isActive(), true); assert.equal(el('site-selection-dialog').open, true);
}
console.log('Changed destination capture disables confirmation and preserves selection');

{
  const h = harness(), el = id => h.elements.get(id);
  h.context.scope.view = { sceneId: 'default', homeGroupId: 'home', generation: 4 };
  h.context.destinations = [across];
  h.dispatch(h.entry); h.dispatch(h.root.children[0]); h.dispatch(el('site-selection-move'));
  const option = el('site-selection-destination').children[0];
  assert.equal(option.dataset.kind, 'folder');
  assert.equal(option.dataset.destinationId, 'f3');
  assert.equal(option.dataset.sceneId, 'work-scene');
  assert.equal(option.dataset.groupId, 'g3');
  assert.match(el('site-selection-preview').textContent, /1 个网站/);
  assert.match(el('site-selection-preview').textContent, /Work \/ Projects \/ Read later \/ Research \(f3\)/);
  assert.match(el('site-selection-preview').textContent, /仍停留在当前场景/);
  h.invalidateDestination(); h.dispatch(el('site-selection-destination'), 'change');
  assert.equal(el('site-selection-preview').textContent, '', 'stale destinations do not retain a confirmable preview');
  assert.equal(h.counts().moves, 0);
}
{
  const h = harness(), el = id => h.elements.get(id);
  h.context.scope.view = { sceneId: 'default', homeGroupId: 'home', generation: 4 };
  h.context.destinations = [across, { kind: 'group', id: 'home', groupId: 'home', name: 'Home', sceneId: 'default', path: ['Default', 'Home'] }];
  h.dispatch(h.entry); h.dispatch(h.root.children[0]); h.dispatch(el('site-selection-move'));
  assert.equal(el('site-selection-destination').value, '1', 'opening the broader list keeps the source location, not an arbitrary other scene');
  assert.match(el('site-selection-preview').textContent, /Default \/ Home/);
  assert.equal(h.counts().moves, 0);
}
{
  const h = harness(), el = id => h.elements.get(id);
  h.context.scope.view = { sceneId: 'default', homeGroupId: 'home', generation: 4 };
  h.dispatch(h.entry); h.dispatch(h.root.children[0]);
  h.context.scope.view.generation++;
  h.dispatch(el('site-selection-move'));
  assert.equal(h.selection.isActive(), false, 'a changed scene view invalidates selection even if group IDs match');
  assert.equal(el('site-selection-dialog').open, false);
  assert.equal(h.counts().moves, 0);
}

assert.match(fs.readFileSync(new URL('../home.css', import.meta.url), 'utf8'), /\.site-selection-dialog\s*\{\s*margin:\s*auto;/, 'modal explicitly overrides the global margin reset');
