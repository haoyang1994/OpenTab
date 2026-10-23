import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function event(type, extra = {}) {
  return { type, defaultPrevented: false, stopped: false, immediate: false, key: '', shiftKey: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; this.immediate = true; }, ...extra };
}
const initialState = () => ({
  scenes: [
    { id: 'daily', name: 'Daily', iconKey: 'home', homeGroupId: 'daily-home', archivedAt: null },
    { id: 'work', name: 'Work', iconKey: 'briefcase', homeGroupId: 'work-home', archivedAt: null },
    { id: 'old', name: 'Past project', iconKey: 'book', homeGroupId: 'old-home', archivedAt: 42 }
  ],
  folders: [
    { id: 'daily-home', name: 'Home', sceneId: 'daily' }, { id: 'reading', name: 'Reading', sceneId: 'daily' },
    { id: 'child', name: 'Later', sceneId: 'daily', parentId: 'reading' },
    { id: 'work-home', name: 'Home', sceneId: 'work' }, { id: 'old-home', name: 'Home', sceneId: 'old' }
  ],
  icons: [
    { id: 'site', type: 'shortcut', folderId: 'reading' }, { id: 'folder', type: 'folder', folderId: 'reading' },
    { id: 'nested', type: 'shortcut', folderId: 'reading', parentId: 'folder' }, { id: 'tool', type: 'tool', folderId: 'daily-home' }
  ],
  todos: [{ id: 'task', sceneId: 'daily' }, { id: 'done', sceneId: 'daily', done: true }, { id: 'past', sceneId: 'old' }]
});

// This harness runs the complete UI and catalog, not copied business logic.
// Capturing/bubbling, native modal focus restrictions and real form events are
// modeled; visual layout and browser-specific dialog behavior remain E2E work.
function harness({ state = initialState(), view = { sceneId: 'daily', currentFolderId: 'reading', generation: 8 }, callbacks = {}, initialize = true } = {}) {
  let doc;
  const all = node => node.children.flatMap(child => [child, ...all(child)]);
  function matches(node, selector) {
    if (selector.includes(',')) return selector.split(',').some(part => matches(node, part.trim()));
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const bracket = selector.indexOf('[');
    if (bracket > 0) return matches(node, selector.slice(0, bracket)) && matches(node, selector.slice(bracket));
    if (selector.startsWith('[')) {
      const [, key, value] = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/) || [];
      if (!key) throw Error(`Unsupported selector: ${selector}`);
      const actual = node.getAttribute(key);
      return actual !== null && (value === undefined || actual === value);
    }
    return node.tagName.toLowerCase() === selector.toLowerCase();
  }
  class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn, capture = false) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ fn, capture: Boolean(typeof capture === 'object' ? capture.capture : capture) });
    }
    removeEventListener(type, fn, capture = false) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.fn !== fn || item.capture !== Boolean(capture)));
    }
    fire(e, capture) {
      e.immediate = false;
      for (const item of [...this.listeners.get(e.type) || []]) {
        if (item.capture === capture) item.fn(e);
        if (e.immediate) break;
      }
    }
  }
  class Element extends EventTarget {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attributes = new Map();
      this.parentElement = null; this.className = ''; this.dataset = {}; this._text = ''; this.value = ''; this.id = '';
      this.disabled = false; this.hidden = false; this.inert = false; this.open = false;
      this.tabIndex = /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(this.tagName) ? 0 : -1;
      this.classList = {
        contains: token => this.className.split(/\s+/).includes(token),
        add: token => { if (!this.classList.contains(token)) this.className = `${this.className} ${token}`.trim(); },
        remove: token => { this.className = this.className.split(/\s+/).filter(part => part !== token).join(' '); },
        toggle: (token, value) => { this.classList[value ? 'add' : 'remove'](token); }
      };
    }
    get isConnected() { return this === doc.body || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(text) { this._text = String(text); this.replaceChildren(); }
    set innerHTML(_) { throw new Error('HTML injection is forbidden, including static HTML.'); }
    getAttribute(key) {
      if (key.startsWith('data-')) return this.dataset[key.slice(5).replace(/-([a-z])/g, (_, value) => value.toUpperCase())] ?? null;
      if (['hidden', 'inert', 'open'].includes(key) && this[key]) return '';
      if (key === 'id') return this.id || null;
      return this.attributes.get(key) ?? null;
    }
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
      if (key === 'tabindex') this.tabIndex = Number(value);
      if (key === 'id') this.id = String(value);
    }
    removeAttribute(key) { this.attributes.delete(key); }
    appendChild(node) { node.remove(); this.children.push(node); node.parentElement = this; return node; }
    replaceChildren(...nodes) { this.children.forEach(node => { node.parentElement = null; }); this.children = []; nodes.forEach(node => this.appendChild(node)); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    contains(node) { return node === this || all(this).includes(node); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    querySelectorAll(selector) { return all(this).filter(node => matches(node, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getClientRects() {
      for (let node = this; node; node = node.parentElement) if (node.hidden || node.display === 'none' || node.tagName === 'DIALOG' && !node.open) return [];
      return this.isConnected ? [{}] : [];
    }
    getBoundingClientRect() { return { left: 100, top: 100, right: 620, bottom: 600 }; }
    focus() {
      const modal = doc.body.querySelectorAll('dialog').findLast(node => node.open);
      if (!this.isConnected || this.disabled || !this.getClientRects().length || modal && !modal.contains(this)) return;
      doc.activeElement = this;
    }
    select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
    showModal() { assert.equal(this.tagName, 'DIALOG'); this.open = true; }
    close() { this.open = false; this.dispatchEvent(event('close')); }
    dispatchEvent(e) {
      e.target ||= this;
      const parents = []; for (let node = this.parentElement; node; node = node.parentElement) parents.push(node);
      const path = [win, doc, ...parents.reverse(), this];
      for (const node of path) { node.fire(e, true); if (e.stopped) return !e.defaultPrevented; }
      for (const node of [...path].reverse()) { node.fire(e, false); if (e.stopped) break; }
      return !e.defaultPrevented;
    }
  }
  const win = new EventTarget();
  win.getComputedStyle = node => ({ visibility: node.visibility || 'visible' });
  doc = new EventTarget(); doc.defaultView = win;
  doc.createElement = tag => new Element(tag); doc.createElementNS = (_, tag) => new Element(tag);
  doc.body = new Element('body'); doc.activeElement = doc.body;
  const mount = doc.body.appendChild(new Element('div'));
  const page = doc.body.appendChild(new Element('input'));
  const calls = [], errors = [], dictionary = {};
  const sandbox = { OpenTabI18n: { register: values => Object.assign(dictionary, values), t: (key, params) => (dictionary[key] || key).replace(/\{(\w+)\}/g, (token, name) => params?.[name] ?? token) } };
  vm.createContext(sandbox); vm.runInContext(source('locales/scenes-en.js'), sandbox); vm.runInContext(source('scene-ui.js'), sandbox);
  const actions = ['Switch', 'Create', 'Rename', 'Archive', 'Restore', 'MoveGroup'];
  const host = { mount, getState: () => state, getView: () => view, onError: error => errors.push(error) };
  actions.forEach(action => { host[`on${action}`] = (...args) => { calls.push({ action, args }); return callbacks[action]?.(...args) ?? true; }; });
  const ui = initialize ? sandbox.OpenTabSceneUI.init(host) : null;
  const dialog = () => doc.body.querySelector('dialog');
  const one = action => dialog()?.querySelector(`[data-scene-action="${action}"]`);
  const many = action => dialog()?.querySelectorAll(`[data-scene-action="${action}"]`) || [];
  const row = id => dialog()?.querySelector(`[data-scene-id="${id}"]`);
  function click(node) { assert.ok(node, 'click target exists'); if (node.disabled) return null; node.focus(); const e = event('click'); node.dispatchEvent(e); return e; }
  function submit() { const form = dialog()?.querySelector('form'); assert.ok(form, 'form exists'); const e = event('submit'); form.dispatchEvent(e); assert.equal(e.defaultPrevented, true); return e; }
  function input(value) { const node = dialog().querySelector('input'); node.value = value; node.dispatchEvent(event('input')); return node; }
  function key(key, target = doc.activeElement, extra = {}) { const e = event('keydown', { key, ...extra }); target.dispatchEvent(e); return e; }
  return { doc, win, page, mount, state, view, host, sandbox, ui, calls, errors, dictionary, dialog, one, many, row, click, submit, input, key, trigger: () => mount.querySelector('button') };
}

// No global event listeners, reads or DOM writes before the explicit init.
{
  const h = harness({ initialize: false });
  assert.deepEqual(Object.keys(h.sandbox.OpenTabSceneUI), ['init']);
  assert.equal(h.doc.body.querySelector('dialog'), null); assert.equal(h.win.listeners.size, 0);
}

// Render live state, compact safe trigger, actual counts, active/current rows.
{
  const h = harness();
  assert.equal(h.trigger().textContent, 'Daily'); assert.equal(h.trigger().getAttribute('aria-haspopup'), 'dialog');
  assert.equal(h.dialog().open, false); h.click(h.trigger());
  assert.equal(h.dialog().open, true); assert.equal(h.trigger().getAttribute('aria-expanded'), 'true');
  assert.equal(h.many('switch').length, 2); assert.equal(h.row('old'), null);
  assert.equal(h.row('daily').querySelector('[aria-current="true"]').textContent, 'Daily2 groups · 2 sites · 2 to-dosCurrent');
  assert.equal(h.doc.activeElement, h.one('close'));
  h.click(h.one('toggle-archived')); assert.equal(h.row('old').textContent.includes('Past project'), true);
  assert.equal(h.row('old').querySelector('[data-scene-action="switch"]'), null);
  h.click(h.one('toggle-archived')); assert.equal(h.row('old'), null);
  h.ui.close(); assert.equal(h.doc.activeElement, h.trigger());
}

// Never interpret names or icon keys as markup/URLs; bounded names in handlers.
{
  const h = harness(); const malicious = '<img src=x onerror=alert(1)>';
  h.state.scenes[0].name = malicious; h.state.scenes[0].iconKey = 'https://evil.example/icon.svg'; h.ui.render(); h.ui.open();
  assert.equal(h.trigger().textContent, malicious); assert.ok(h.row('daily').textContent.includes(malicious));
  assert.equal(h.dialog().querySelectorAll('img').length, 0); assert.equal(h.trigger().querySelector('path').getAttribute('d').startsWith('M3 10'), true);
  h.click(h.one('create')); const name = h.input(' '); assert.equal(name.maxLength, 40);
  h.submit(); assert.equal(h.calls.length, 0); assert.equal(name.getAttribute('aria-invalid'), 'true');
  h.input('a'.repeat(41)); h.submit(); assert.equal(h.calls.length, 0);
  h.input(`  ${malicious}  `); h.click(h.many('choose-icon').find(node => node.dataset.iconKey === 'code')); h.submit(); await flush();
  assert.equal(h.calls[0].action, 'Create'); assert.equal(h.calls[0].args[0].name, malicious); assert.equal(h.calls[0].args[0].iconKey, 'code');
  assert.equal(h.dialog().querySelector('form'), null);
}

// Single flight and close protection; actual submit/click/cancel/keyboard events.
{
  const wait = deferred(); const h = harness({ callbacks: { Create: () => wait.promise } }); h.ui.open(); h.click(h.one('create'));
  const input = h.input('Deep work'), submit = h.one('submit'), cancel = h.one('cancel'); h.click(submit); h.submit(); h.submit();
  assert.equal(h.calls.length, 1); assert.equal(input.disabled, true); assert.equal(submit.disabled, true); assert.equal(cancel.disabled, true); assert.equal(h.one('close').disabled, true);
  assert.equal(h.dialog().getAttribute('aria-busy'), 'true'); assert.equal(h.trigger().disabled, true); assert.equal(h.ui.close(), false);
  const escape = h.key('Escape', h.dialog()); assert.equal(escape.defaultPrevented, true); assert.equal(h.dialog().open, true);
  const cancelEvent = event('cancel'); h.dialog().dispatchEvent(cancelEvent); assert.equal(cancelEvent.defaultPrevented, true); assert.equal(h.dialog().open, true);
  h.dialog().dispatchEvent(event('pointerdown', { clientX: 0, clientY: 0 })); h.dialog().dispatchEvent(event('click', { clientX: 0, clientY: 0 })); assert.equal(h.dialog().open, true);
  h.ui.render(); assert.equal(h.dialog().querySelector('input'), input); assert.equal(input.value, 'Deep work');
  wait.resolve(true); await flush(); assert.equal(h.dialog().querySelector('input'), null); assert.equal(h.trigger().disabled, false); assert.equal(h.dialog().getAttribute('aria-busy'), null);
}

// Failed writes preserve exact form/draft/icon and the captured displayed view.
{
  const wait = deferred(); let attempt = 0;
  const h = harness({ callbacks: { Create: () => ++attempt === 1 ? wait.promise : true } }); h.ui.open(); h.click(h.one('create'));
  const input = h.input('  Launch  '); h.click(h.many('choose-icon').find(node => node.dataset.iconKey === 'compass')); h.one('submit').focus(); h.submit();
  h.view.generation = 99; h.view.sceneId = 'work'; h.ui.render(); wait.reject(new Error('Disk full. Free some space, then retry.')); await flush();
  assert.equal(h.dialog().querySelector('input'), input); assert.equal(input.value, '  Launch  '); assert.equal(input.disabled, false);
  assert.equal(h.many('choose-icon').find(node => node.dataset.iconKey === 'compass').getAttribute('aria-pressed'), 'true');
  assert.equal(h.dialog().querySelector('[role="status"]').textContent, 'Disk full. Free some space, then retry.'); assert.equal(h.errors.length, 1);
  assert.equal(h.doc.activeElement, h.one('submit')); h.submit(); await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].args[0].context.view.generation, 8); assert.equal(h.calls[1].args[0].context.view.sceneId, 'daily');
  assert.ok(Object.isFrozen(h.calls[1].args[0].context)); assert.ok(Object.isFrozen(h.calls[1].args[0].context.view));
}

// Only strict true is durable success, including false, undefined and objects.
for (const result of [false, undefined, { ok: true }]) {
  const h = harness(); h.host.onRename = (...args) => { h.calls.push({ action: 'Rename', args }); return result; };
  h.ui.open(); h.click(h.row('daily').querySelector('[data-scene-action="rename"]')); const input = h.input('Still a draft'); h.submit(); await flush();
  assert.equal(h.dialog().querySelector('input'), input); assert.equal(input.value, 'Still a draft');
  assert.equal(h.dialog().querySelector('[role="status"]').textContent, 'Couldn’t save your changes. Please try again.');
}

// Identity snapshots survive in-place state mutation; old detached handlers inert.
{
  const h = harness(); h.ui.open();
  const oldSwitch = h.row('work').querySelector('[data-scene-action="switch"]');
  h.state.scenes[1].id = 'replacement'; h.state.scenes[1].name = 'Other'; h.click(oldSwitch); await flush();
  assert.equal(h.calls[0].args[0], 'work'); assert.equal(h.calls[0].args[1].scene.name, 'Work'); assert.equal(h.dialog().open, false);
  h.ui.open(); const staleCreate = h.one('create'); h.ui.render(); staleCreate.dispatchEvent(event('click')); assert.equal(h.dialog().querySelector('form'), null);
  h.click(h.row('daily').querySelector('[data-scene-action="rename"]')); h.state.scenes[0].name = 'Changed elsewhere'; h.view.generation++;
  h.ui.render(); h.input('My name'); h.submit(); await flush(); assert.equal(h.calls[1].args[0].context.scene.name, 'Daily'); assert.equal(h.calls[1].args[0].context.view.generation, 8);
}

// Archive is a non-destructive confirmation, last active scene cannot archive.
{
  const h = harness({ callbacks: { Archive: ({ sceneId }) => { h.state.scenes.find(scene => scene.id === sceneId).archivedAt = 50; return true; }, Restore: ({ sceneId }) => { h.state.scenes.find(scene => scene.id === sceneId).archivedAt = null; return true; } } }); h.ui.open();
  h.click(h.row('work').querySelector('[data-scene-action="archive"]'));
  assert.equal(h.calls.length, 0); assert.ok(h.dialog().textContent.includes('Your groups, sites and to-dos are kept.'));
  assert.equal(h.doc.activeElement, h.one('cancel')); h.click(h.one('cancel')); assert.equal(h.calls.length, 0);
  h.click(h.row('work').querySelector('[data-scene-action="archive"]')); h.submit(); await flush();
  assert.equal(h.calls[0].action, 'Archive'); assert.equal(h.row('work'), null); assert.equal(h.row('daily').querySelector('[data-scene-action="archive"]').disabled, true);
  h.click(h.row('daily').querySelector('[data-scene-action="archive"]')); assert.equal(h.dialog().querySelector('form'), null);
  assert.equal(h.state.icons.length, 4); assert.equal(h.state.todos.length, 3);
  h.click(h.one('toggle-archived')); h.click(h.row('old').querySelector('[data-scene-action="restore"]')); await flush();
  assert.equal(h.calls[1].action, 'Restore'); assert.equal(h.calls[1].args[0].sceneId, 'old');
  assert.ok(h.row('old').querySelector('[data-scene-action="switch"]')); assert.equal(h.row('daily').querySelector('[data-scene-action="archive"]').disabled, false);
}

// Move only the current non-home group; active destinations and immutable labels.
{
  const h = harness(); assert.equal(h.ui.openMoveGroup(), true);
  const select = h.dialog().querySelector('select'); assert.deepEqual(select.children.map(node => node.value), ['work']);
  assert.ok(h.dialog().textContent.includes('Reading')); assert.ok(h.dialog().textContent.includes('To-dos stay in the original scene.'));
  h.state.folders.find(group => group.id === 'reading').name = 'New label'; h.state.scenes[1].name = 'Renamed work'; h.view.generation = 10; h.ui.render();
  h.submit(); await flush(); const payload = h.calls[0].args[0];
  assert.equal(payload.groupId, 'reading'); assert.equal(payload.targetSceneId, 'work'); assert.equal(payload.context.group.name, 'Reading'); assert.equal(payload.context.targetScene.name, 'Work'); assert.equal(payload.context.view.generation, 8);
  h.ui.close(); h.view.currentFolderId = 'daily-home'; assert.equal(h.ui.openMoveGroup(), false); assert.equal(h.dialog().open, false); h.ui.open(); assert.equal(h.one('move'), null);
  h.view.currentFolderId = 'work-home'; h.ui.render(); assert.equal(h.one('move'), null); assert.equal(h.ui.openMoveGroup(), false);
}
{
  const h = harness(); h.state.scenes[1].archivedAt = 100; h.ui.open(); assert.equal(h.one('move').disabled, true);
  h.ui.openMoveGroup(); assert.equal(h.dialog().querySelector('select').disabled, true); assert.equal(h.one('submit').disabled, true);
  h.submit(); assert.equal(h.calls.length, 0);
}

// Native Tab/arrow/text/select/context-menu defaults survive; page shortcuts do not.
{
  const h = harness(); const pageEvents = [];
  // Install document capture handlers before opening. Window capture must stop
  // both those and bubbling handlers, regardless of document registration order.
  for (const type of ['keydown', 'keyup', 'keypress', 'contextmenu']) {
    h.doc.addEventListener(type, e => pageEvents.push(e.type), true); h.doc.addEventListener(type, e => pageEvents.push(e.type));
  }
  h.ui.open(); h.click(h.one('create'));
  const input = h.dialog().querySelector('input'), first = h.one('close'), last = h.one('submit');
  input.focus(); const middleTab = h.key('Tab'); assert.equal(middleTab.defaultPrevented, false);
  first.focus(); const backwards = h.key('Tab', first, { shiftKey: true }); assert.equal(backwards.defaultPrevented, true); assert.equal(h.doc.activeElement, last);
  last.focus(); const forwards = h.key('Tab'); assert.equal(forwards.defaultPrevented, true); assert.equal(h.doc.activeElement, first);
  const ordinary = h.key('a', input); assert.equal(ordinary.defaultPrevented, false);
  assert.equal(h.key('Escape', input, { isComposing: true }).defaultPrevented, false); assert.equal(h.dialog().open, true);
  assert.equal(h.key('k', input, { ctrlKey: true }).defaultPrevented, false);
  const menu = event('contextmenu'); input.dispatchEvent(menu); assert.equal(menu.defaultPrevented, false);
  input.dispatchEvent(event('keyup')); input.dispatchEvent(event('keypress')); assert.deepEqual(pageEvents, []);
  h.click(h.one('cancel')); h.click(h.one('move')); const select = h.dialog().querySelector('select');
  assert.equal(h.key('ArrowDown', select).defaultPrevented, false);
  h.one('submit').disabled = true; h.one('cancel').focus(); const disabledBoundary = h.key('Tab'); assert.equal(disabledBoundary.defaultPrevented, true); assert.equal(h.doc.activeElement, h.one('close'));
  const escape = h.key('Escape'); assert.equal(escape.defaultPrevented, true); assert.equal(h.dialog().open, false); assert.equal(h.doc.activeElement, h.trigger());
  h.page.dispatchEvent(event('keydown', { key: 'a' })); assert.deepEqual(pageEvents, ['keydown', 'keydown']);
}

// Backdrop needs a press and release outside; interior padding and drags are safe.
{
  const h = harness(); h.ui.open();
  h.dialog().dispatchEvent(event('pointerdown', { clientX: 110, clientY: 110 })); h.dialog().dispatchEvent(event('click', { clientX: 0, clientY: 0 })); assert.equal(h.dialog().open, true);
  h.dialog().dispatchEvent(event('pointerdown', { clientX: 0, clientY: 0 })); h.dialog().dispatchEvent(event('click', { clientX: 110, clientY: 110 })); assert.equal(h.dialog().open, true);
  h.dialog().dispatchEvent(event('pointerdown', { clientX: 0, clientY: 0 })); h.dialog().dispatchEvent(event('click', { clientX: 0, clientY: 0 })); assert.equal(h.dialog().open, false); assert.equal(h.doc.activeElement, h.trigger());
  h.ui.open(); const cancel = event('cancel'); h.dialog().dispatchEvent(cancel); assert.equal(cancel.defaultPrevented, true); assert.equal(h.dialog().open, false);
}

// An external native close invalidates pending completion, even after reopen.
for (const reject of [false, true]) {
  const wait = deferred(); const h = harness({ callbacks: { Create: () => wait.promise } }); h.ui.open(); h.click(h.one('create')); h.input('Old draft'); h.submit();
  h.dialog().close(); assert.equal(h.trigger().disabled, false); h.ui.open(); h.click(h.one('create')); const freshInput = h.input('New draft');
  if (reject) wait.reject(new Error('Old failure')); else wait.resolve(true);
  await flush(); assert.equal(h.dialog().querySelector('input'), freshInput); assert.equal(freshInput.value, 'New draft'); assert.equal(h.errors.length, 0); assert.equal(h.dialog().querySelector('[role="status"]').textContent, '');
}

// Destruction is final, removes listeners/nodes and discards pending outcomes.
{
  const wait = deferred(); const h = harness({ callbacks: { Switch: () => wait.promise } }); h.ui.open(); h.click(h.row('work').querySelector('[data-scene-action="switch"]'));
  h.ui.destroy(); wait.reject(new Error('Detached failure')); await flush();
  assert.equal(h.errors.length, 0); assert.equal(h.dialog(), null); assert.equal(h.trigger(), null);
  assert.equal(h.ui.render(), false); assert.equal(h.ui.open(), false); assert.equal(h.ui.openMoveGroup(), false);
  assert.ok([...h.win.listeners.values()].every(handlers => handlers.length === 0)); h.ui.destroy();
}

// Do not focus a hidden, inert or disconnected trigger on close.
for (const hide of [h => { h.mount.hidden = true; }, h => { h.mount.inert = true; }, h => { h.trigger().remove(); }, h => { h.trigger().display = 'none'; }, h => { h.trigger().visibility = 'hidden'; }]) {
  const h = harness(); h.ui.open(); const trigger = h.trigger(); hide(h); h.ui.close(); assert.notEqual(h.doc.activeElement, trigger);
}

// Successful writes update live rows and trigger; counts may be omitted safely.
{
  const h = harness({ callbacks: {
    Rename: ({ sceneId, name }) => { h.state.scenes.find(scene => scene.id === sceneId).name = name; return true; },
    Switch: sceneId => { h.view.sceneId = sceneId; h.view.currentFolderId = 'work-home'; h.view.generation++; return true; }
  } });
  h.ui.open(); h.click(h.row('daily').querySelector('[data-scene-action="rename"]')); h.input('场景空间'); h.submit(); await flush();
  assert.equal(h.trigger().textContent, '场景空间', 'user names are never translation keys');
  assert.ok(h.row('daily').textContent.startsWith('场景空间'));
  h.click(h.row('work').querySelector('[data-scene-action="switch"]')); await flush(); assert.equal(h.trigger().textContent, 'Work'); assert.equal(h.dialog().open, false);
  delete h.state.folders; delete h.state.icons; delete h.state.todos; h.ui.open(); assert.equal(h.dialog().querySelector('.scene-row-counts'), null);
}

// Rendering refreshes live lists while preserving a logical keyboard position.
{
  const h = harness(); h.ui.open(); const rename = h.row('work').querySelector('[data-scene-action="rename"]'); rename.focus(); h.ui.render();
  assert.notEqual(h.doc.activeElement, rename); assert.equal(h.doc.activeElement, h.row('work').querySelector('[data-scene-action="rename"]'));
}

// Snapshot create/move intent when displayed, including in-place host mutations.
{
  const h = harness(); h.ui.open(); h.view.generation = 19; h.click(h.one('create')); h.input('New'); h.submit(); await flush();
  assert.equal(h.calls[0].args[0].context.view.generation, 8);
  const group = h.state.folders.find(item => item.id === 'reading'); group.name = 'Not shown'; group.id = 'replacement'; h.view.generation = 20;
  h.click(h.one('move')); assert.ok(h.dialog().textContent.includes('Reading')); h.submit(); await flush();
  assert.equal(h.calls[1].args[0].groupId, 'reading'); assert.equal(h.calls[1].args[0].context.view.generation, 19);
}

// Unsupported host actions stay inline rather than dismissing a filled form.
{
  const h = harness(); delete h.host.onCreate; h.ui.open(); h.click(h.one('create')); const input = h.input('Keep me'); h.submit(); await flush();
  assert.equal(h.dialog().querySelector('input'), input); assert.equal(input.value, 'Keep me'); assert.equal(h.dialog().querySelector('[role="status"]').textContent, 'This action is not available right now.');
}

// Catalog completeness and isolated responsive/reduced-motion surface contract.
{
  const h = harness(); const js = source('scene-ui.js'), css = source('scene-ui.css');
  for (const phrase of js.matchAll(/(?:t\(|\[)'([^']*[\u3400-\u9fff][^']*)'/g)) assert.equal(typeof h.dictionary[phrase[1]], 'string', `Missing English catalog: ${phrase[1]}`);
  for (const phrase of ['此设备使用不同的场景同步版本，现有数据未改动。', '同步数据版本不受支持或数据损坏，现有数据未改动。', '未在云端找到的本机场景已归档保留，本地内容未删除。', '已忽略旧版设备的同步更新，场景数据未改动。']) assert.ok(h.dictionary[phrase]);
  assert.match(css, /calc\(100vw - 32px\)/); assert.match(css, /100dvh - 32px/); assert.match(css, /overflow-y: auto/); assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(js, /\b(?:fetch|prompt|confirm)\s*\(|chrome\.|localStorage|innerHTML/);
}
console.log('Scene UI tests passed: rendered actions, durable single-flight, draft safety, modal keyboard/focus, stale completions, archive/restore and move intent.');
