import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const Workspace = require('../workspace-persistence.js');
const code = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const site = (id, folderId, extra = {}) => ({ id, name: 'Same site', type: 'shortcut', url: `https://${id}.example`, folderId, parentId: '', opaque: { retain: id }, uploadedIconDataUrl: 'data:image/png;base64,abc', ...extra });
const tile = (id, folderId) => ({ id, name: 'Same folder', type: 'folder', folderId, parentId: '', opaque: { retain: id } });
const A = 'scene-default', B = 'scene-work';
function fixture() {
  const base = Schema.migrateLegacy({
    folders: [{ id: 'folder-home', name: 'Home', extra: { retain: 'home' } }, { id: 'a-work', name: 'Work', type: 'group', extra: { retain: 'a' } }],
    icons: [site('a-first', 'a-work'), tile('a-folder', 'folder-home'), site('a-child1', 'folder-home', { parentId: 'a-folder' }), site('a-child2', 'folder-home', { parentId: 'a-folder' })],
    todos: [{ id: 'a-task', text: 'Same task', done: false, metadata: { retain: 'a' } }, { id: 'a-done', text: 'Done', done: true }],
    currentFolderId: 'folder-home', todoButtonVisible: false
  }, { homeName: 'Home' });
  const data = Schema.create(base, { id: B, name: 'Work', iconKey: 'briefcase', homeGroupId: 'b-home', homeName: 'Home' });
  data.folders.push({ id: 'b-work', name: 'Work', sceneId: B, type: 'group', extra: { retain: 'b' } });
  data.icons.push(site('b-first', 'b-home'), tile('b-folder', 'b-work'), site('b-second', 'b-home'), site('b-child1', 'b-work', { parentId: 'b-folder' }), site('b-child2', 'b-work', { parentId: 'b-folder' }));
  data.todos.splice(1, 0, { id: 'b-task', text: 'Same task', done: false, sceneId: B, metadata: { retain: 'b' } });
  data.todos.push({ id: 'b-done', text: 'Done', done: true, sceneId: B }, { id: 'b-next', text: 'Next task', done: false, sceneId: B });
  data.currentFolderId = 'b-home';
  data.lastOpenedSceneId = A; // Never use the cross-tab device preference as a view.
  Schema.validate(data);
  return data;
}

// Small eventful DOM, not a browser substitute. It exercises the real adapters,
// keyboard handlers, original TODO panel and clock card without launching MV3.
function dom() {
  let document;
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  const matches = (node, selector) => selector.split(',').some(part => {
    part = part.trim();
    if (part.startsWith('#')) return node.id === part.slice(1);
    if (part.startsWith('.')) return node.classList.contains(part.slice(1));
    if (part.startsWith('[')) { const [key, value] = part.slice(1, -1).split('='); return node.getAttribute(key) !== null && (!value || node.getAttribute(key) === value.replaceAll('"', '')); }
    return node.tagName.toLowerCase() === part;
  });
  class Element {
    constructor(tag = 'div', id = '') {
      Object.assign(this, { tagName: tag.toUpperCase(), id, children: [], listeners: new Map(), attributes: new Map(), dataset: {}, style: {}, className: '', _text: '', value: '', hidden: false });
      this.classList = { contains: name => this.className.split(/\s+/).includes(name), toggle: (name, on) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); if (on ?? !set.has(name)) set.add(name); else set.delete(name); this.className = [...set].join(' '); }, add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false) };
    }
    get isConnected() { return document.contains(this); }
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    insertBefore(node, anchor) { const index = this.children.indexOf(anchor); if (index < 0) return this.appendChild(node); this.children.splice(index, 0, node); node.parentElement = this; return node; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    replaceWith(node) { const parent = this.parentElement; parent.insertBefore(node, this); this.remove(); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    set innerHTML(value) { assert.equal(value, ''); this.children.forEach(node => { node.parentElement = null; }); this.children = []; this._text = ''; }
    get innerHTML() { return this.textContent; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    contains(node) { return this === node || descendants(this).includes(node); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    dispatchEvent(event) { event.target ||= this; for (const fn of this.listeners.get(event.type) || []) fn(event); if (!event.stopped) this.parentElement?.dispatchEvent(event); return !event.defaultPrevented; }
    focus() { document.activeElement = this; }
    select() {}
  }
  document = new Element('document'); document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  document.createElement = tag => new Element(tag);
  document.getElementById = id => descendants(document).find(node => node.id === id) || null;
  const add = (id, parent = document.body, tag = 'div') => parent.appendChild(new Element(tag, id));
  const tabsBar = add('group-tabs-bar'); add('group-tabs', tabsBar); add('add-group-btn', tabsBar, 'button');
  for (const id of ['folder-overlay', 'folder-title-input', 'inline-dialog', 'inline-dialog-message', 'inline-dialog-actions']) add(id);
  const deck = add('clock-deck'), stage = add('clock-deck-stage', deck);
  const clock = add('clock-widget', stage), focus = add('clock-focus-card', stage), todo = add('clock-todo-card', stage);
  for (const id of ['clock-focus-time', 'clock-focus-status', 'clock-focus-progress', 'clock-focus-note', 'clock-focus-toggle', 'clock-focus-reset']) add(id, focus, id.endsWith('toggle') || id.endsWith('reset') ? 'button' : 'p');
  for (const id of ['clock-todo-text', 'clock-todo-count', 'clock-todo-status', 'clock-todo-complete', 'clock-todo-open']) add(id, todo, id.endsWith('complete') || id.endsWith('open') ? 'button' : 'p');
  add('clock-deck-peek', stage, 'button');
  const nav = add('clock-deck-nav', deck);
  add('clock-deck-status', deck);
  for (let i = 0; i < 3; i++) add(`dot-${i}`, nav, 'button').setAttribute('data-clock-card', i);
  add('settings-btn', document.body, 'button');
  const elements = Object.fromEntries(['todoList', 'todoCount', 'todoEmpty', 'todoProgressBar', 'todoInput'].map(key => [key, add(key)]));
  const fire = (node, type, extra = {}) => { const event = { type, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; node.dispatchEvent(event); return event; };
  return { document, elements, fire, $: document.getElementById, clock };
}
function harness({ data = fixture(), scenes = true, identity = false } = {}) {
  const store = clone(data), state = clone(data), writes = [], errors = [], toasts = [], timers = new Map(), ui = dom();
  let view = { sceneId: B, homeGroupId: 'b-home', generation: 1 }, intercept = null, id = 0;
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) { if (intercept) { const fn = intercept; intercept = null; await fn(); } return clone(keys == null ? store : Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
    async set(patch) { writes.push(clone(patch)); Object.assign(store, clone(patch)); }
  } } };
  if (state.todoButtonVisible === false) ui.document.body.classList.add('hide-todo-entry');
  const workspace = Workspace.forChrome(chrome).connect({ state, onError: error => errors.push(error), ...(identity ? { getViewIdentity: () => view } : {}) });
  workspace.seed(store);
  const context = { ...ui, console, URL, OpenTabWorkspace: Workspace, setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
    sessionStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, MutationObserver: class { observe() {} disconnect() {} }, Event: class { constructor(type) { this.type = type; } } };
  context.window = context;
  vm.createContext(context); vm.runInContext(code('folders.js'), context); vm.runInContext(code('clock-deck.js'), context);
  const folders = context.OpenTabFolders, clock = context.OpenTabClockDeck;
  const host = { ...workspace, workspace, state, elements: ui.elements, saveState: workspace.save, HOME_FOLDER_ID: 'folder-home', ...(scenes ? { getSceneView: () => view } : {}),
    generateId: () => `new-${++id}`, getIconsContainer: () => null, refreshIconViews() {}, rememberFocus() {}, restoreFocus() {}, showToast: (text, options) => toasts.push({ text, options }),
    selectFolder(folderId) { state.currentFolderId = folderId; return true; }, closeClockPopovers() {}, openTodoList() {}, renderTodos: () => clock.renderTodos() };
  folders.init(host); clock.init(host); clock.renderTodos(); folders.renderChrome();
  return { ...ui, state, store, writes, errors, toasts, folders, clock, host, workspace, timers,
    setView(sceneId = B) { const scene = state.scenes.find(item => item.id === sceneId); view = { sceneId, homeGroupId: scene.homeGroupId, generation: view.generation + 1 }; state.currentFolderId = scene.homeGroupId; },
    clearView() { view = null; },
    race(fn) { intercept = fn; },
    async settle() { await Promise.resolve(); await workspace.whenIdle(); await Promise.resolve(); },
    async undo() { const toast = toasts.findLast(item => item.options?.onAction); assert.ok(toast, 'undo offered'); await toast.options.onAction(); }
  };
}

{
  const h = harness(), before = clone(h.state);
  assert.deepEqual(clone(h.folders.ensureGroups(h.state.folders)), before.folders, 'normalization retains all group metadata and order');
  const nested = [...before.folders, { id: 'nested', name: 'Work', parentId: 'b-work', type: 'custom', sceneId: B, future: { preserve: true } }, { id: 'folder-tools', name: 'Kept', sceneId: B }];
  assert.deepEqual(clone(h.folders.ensureGroups(nested)), nested, 'scene-owned historical IDs and parent/type metadata survive');
  assert.deepEqual(clone(h.folders.visibleGroups().map(group => group.id)), ['b-home', 'b-work']);
  assert.deepEqual(h.$('group-tabs').children.map(tab => tab.dataset.groupId), ['b-home', 'b-work']);
  assert.deepEqual(h.$('group-tabs').children.map(tab => tab.children[0].textContent), ['2', '1']);
  assert.deepEqual(clone(h.folders.visibleIcons('a-work')), []);
  assert.deepEqual(clone(h.folders.bulkMoveContext().sites.map(site => site.id)), ['b-first', 'b-second']);
  assert.deepEqual(clone(h.folders.bulkMoveContext().destinations.map(item => item.id)).sort(), ['folder-home', 'a-work', 'b-home', 'b-work', 'a-folder', 'b-folder'].sort(), 'only the explicit bulk chooser offers all active-scene destinations');
  const crossGroup = h.folders.bulkMoveContext().destinations.find(item => item.id === 'a-work');
  const crossFolder = h.folders.bulkMoveContext().destinations.find(item => item.id === 'a-folder');
  assert.ok(h.folders.captureBulkDestination(crossGroup), 'the displayed explicit cross-scene group option is capturable');
  assert.ok(h.folders.captureBulkDestination(crossFolder), 'the displayed explicit cross-scene folder option is capturable');
  assert.equal(h.folders.selectGroup('a-work'), false);
  assert.equal(h.folders.captureBulkDestination({ kind: 'group', id: 'a-work' }), null);
  assert.equal(h.folders.captureBulkDestination({ kind: 'folder', id: 'a-folder' }), null);
  assert.deepEqual(clone(h.state), before, 'render/projection leaves the full dataset untouched');
  h.fire(h.document.body, 'keydown', { code: 'Digit2', altKey: true }); assert.equal(h.state.currentFolderId, 'b-work');
  h.fire(h.$('group-tabs-bar'), 'wheel', { deltaY: -1 }); assert.equal(h.state.currentFolderId, 'b-home');
  h.setView(A); h.folders.renderChrome();
  assert.deepEqual(h.$('group-tabs').children.map(tab => tab.dataset.groupId), ['folder-home', 'a-work']);
  h.fire(h.document.body, 'keydown', { code: 'Digit2', altKey: true }); assert.equal(h.state.currentFolderId, 'a-work');
  assert.equal(h.writes.length, 0);
}
{
  const h = harness(), before = clone(h.state);
  h.fire(h.$('add-group-btn'), 'click'); const input = h.$('new-group-input'); input.value = 'Work';
  h.fire(input, 'keydown', { key: 'Enter' }); await h.settle();
  assert.equal(h.store.folders.at(-1).sceneId, B); assert.equal(h.store.folders.at(-1).name, 'Work');
  assert.deepEqual(h.store.folders.slice(0, -1), before.folders);
  assert.deepEqual(h.store.icons, before.icons); assert.deepEqual(h.store.todos, before.todos);
  assert.equal(h.store.folders.filter(group => group.id === 'folder-home').length, 1);
  await h.undo(); assert.deepEqual(clone(h.state.folders), before.folders, 'scene-mode group undo has the full schema context');
  assert.equal(h.state.currentFolderId, 'b-home', 'undoing the selected new group falls back to this scene Home');
}
{
  const h = harness(); h.fire(h.$('add-group-btn'), 'click'); const input = h.$('new-group-input'); input.value = 'Stale';
  h.setView(A); h.fire(input, 'keydown', { key: 'Enter' }); await h.settle(); assert.equal(h.writes.length, 0);
}
{
  const h = harness();
  h.fire(h.$('group-tabs').children[0], 'contextmenu');
  assert.equal(h.$('inline-dialog-actions').children.length, 0, 'the second scene Home is protected without host constant replacement');
  h.folders.selectGroup('b-work'); h.fire(h.$('group-tabs').children[1], 'contextmenu');
  h.fire(h.$('inline-dialog-actions').children[1], 'click'); await h.settle();
  assert.equal(h.state.currentFolderId, 'b-home'); assert.equal(h.store.folders.some(group => group.id === 'b-work'), false);
  assert.ok(h.store.icons.filter(icon => icon.id.startsWith('b-')).every(icon => icon.folderId === 'b-home'));
  assert.equal(h.store.icons.find(icon => icon.id === 'a-first').folderId, 'a-work');
  await h.undo(); assert.equal(h.state.folders.some(group => group.id === 'b-work'), true);
}
{
  const h = harness(), before = clone(h.state.icons);
  h.folders.moveIconToGroup('b-first', 'a-work'); h.folders.moveIconToGroup('a-first', 'b-work'); await h.settle();
  assert.deepEqual(clone(h.state.icons), before); assert.equal(h.writes.length, 0, 'individual websites never cross scenes');
  h.folders.moveIconToGroup('b-first', 'b-work'); await h.settle();
  assert.equal(h.store.icons.find(icon => icon.id === 'b-first').folderId, 'b-work');
  assert.deepEqual(h.store.icons.filter(icon => icon.id.startsWith('a-')), before.filter(icon => icon.id.startsWith('a-')));
  await h.undo(); assert.deepEqual(clone(h.state.icons), before);
}
for (const kind of ['group', 'folder']) {
  const h = harness(), before = clone(h.state);
  const selection = h.folders.captureBulkSelection(), destination = h.folders.captureBulkDestination({ kind, id: kind === 'group' ? 'b-work' : 'b-folder' });
  assert.equal((await h.folders.moveSites(selection, ['b-second', 'b-first'], destination)).ok, true);
  assert.deepEqual(h.store.icons.map(icon => icon.id), before.icons.map(icon => icon.id));
  assert.deepEqual(h.store.folders, before.folders); assert.deepEqual(h.store.todos, before.todos);
  assert.deepEqual(h.store.icons.filter(icon => icon.id.startsWith('a-')), before.icons.filter(icon => icon.id.startsWith('a-')));
  h.store.todos.find(todo => todo.id === 'a-task').text = 'Independent later edit';
  await h.undo(); assert.deepEqual(clone(h.state.icons), before.icons); assert.equal(h.state.todos[0].text, 'Independent later edit');
}
for (const remaining of [0, 1]) {
  const data = fixture(); if (remaining) data.icons.push(site('b-child3', 'b-work', { parentId: 'b-folder' }));
  const h = harness({ data }); h.folders.selectGroup('b-work'); h.folders.openOverlay('b-folder');
  const result = await h.folders.moveSites(h.folders.captureBulkSelection(), ['b-child1', 'b-child2'], h.folders.captureBulkDestination({ kind: 'group', id: 'b-home' }));
  assert.equal(result.ok, true); assert.equal(h.store.icons.some(icon => icon.id === 'b-folder'), false);
  if (remaining) assert.equal(h.store.icons.find(icon => icon.id === 'b-child3').parentId, '');
  await h.undo(); assert.deepEqual(clone(h.state.icons), data.icons, 'scene projection retains dissolution and undo graph semantics');
}
for (const mutate of [
  h => { h.store.scenes.find(scene => scene.id === B).archivedAt = 123; },
  h => { h.store.folders.find(group => group.id === 'b-work').sceneId = A; },
  h => { h.store.folders.find(group => group.id === 'b-work').name = 'Changed label'; },
  h => { h.store.icons.find(icon => icon.id === 'b-folder').folderId = 'b-home'; h.store.icons.filter(icon => icon.parentId === 'b-folder').forEach(icon => { icon.folderId = 'b-home'; }); },
  h => h.setView(A)
]) {
  const h = harness(), selection = h.folders.captureBulkSelection(), destination = h.folders.captureBulkDestination({ kind: 'folder', id: 'b-folder' });
  h.race(() => mutate(h));
  assert.equal((await h.folders.moveSites(selection, ['b-first'], destination)).reason, 'stale');
  assert.equal(h.writes.length, 0, 'locked archive, ownership, label, or view races do not write');
}
{
  const h = harness(); h.folders.selectGroup('b-work'); h.folders.openOverlay('b-folder');
  const selection = h.folders.captureBulkSelection(), destination = h.folders.captureBulkDestination({ kind: 'group', id: 'b-home' });
  h.race(() => { h.store.folders.find(group => group.id === 'b-work').sceneId = A; });
  assert.equal((await h.folders.moveSites(selection, ['b-child1'], destination)).reason, 'stale', 'unchanged website IDs do not authorize moved source membership');
  assert.equal(h.writes.length, 0);
}
for (const location of ['local', 'durable']) {
  const h = harness(); h.folders.selectGroup('b-work'); h.folders.openOverlay('b-folder');
  const selection = h.folders.captureBulkSelection(), destination = h.folders.captureBulkDestination({ kind: 'group', id: 'b-home' });
  if (location === 'local') { h.state.folders.find(group => group.id === 'b-work').name = 'Renamed source'; await h.workspace.save(); }
  else h.race(() => { h.store.folders.find(group => group.id === 'b-work').name = 'Renamed source'; });
  assert.equal((await h.folders.moveSites(selection, ['b-child1'], destination)).ok, true, 'an independent source label does not invalidate a stable destination');
}
{
  const h = harness(), option = h.folders.bulkMoveContext().destinations.find(item => item.id === 'b-work'), selection = h.folders.captureBulkSelection();
  h.setView(A); h.setView(B);
  assert.equal(h.folders.captureBulkDestination(option), null, 'stale displayed labels cannot be recaptured after a scene round trip');
  const destination = h.folders.captureBulkDestination({ kind: 'group', id: 'b-work' });
  assert.equal((await h.folders.moveSites(selection, ['b-first'], destination)).reason, 'stale');
}
{
  const h = harness(), before = clone(h.state);
  assert.deepEqual(clone(h.clock.visibleTodos(h.host).map(todo => todo.id)), ['b-task', 'b-done', 'b-next']);
  assert.equal(h.elements.todoList.children.length, 3); assert.equal(h.elements.todoCount.textContent, '1/3');
  assert.equal(h.elements.todoProgressBar.style.width, '33%'); assert.equal(h.$('clock-todo-text').textContent, 'Same task');
  assert.equal(h.$('clock-todo-count').textContent, '还有 2 件未完成');
  h.elements.todoInput.value = 'Unsubmitted draft'; h.fire(h.$('clock-focus-toggle'), 'click');
  h.setView(A); h.clock.renderTodos();
  assert.equal(h.elements.todoList.children.length, 2); assert.equal(h.elements.todoCount.textContent, '1/2');
  assert.equal(h.$('clock-todo-count').textContent, '还有 1 件未完成'); assert.equal(h.elements.todoInput.value, 'Unsubmitted draft');
  assert.equal(h.$('clock-focus-toggle').textContent, '暂停', 'scene changes do not reset the tab-local focus timer');
  h.setView(B); h.clock.renderTodos(); assert.equal(h.elements.todoInput.value, 'Unsubmitted draft');
  for (const key of ['folders', 'icons', 'todos', 'scenes', 'sceneProfiles']) assert.deepEqual(clone(h.state[key]), before[key]);
  const record = h.clock.createTodoRecord(h.host, { id: 'created', text: 'Added', done: false, extra: { retained: true } });
  assert.equal(record.sceneId, B); h.state.todos.unshift(record); await h.workspace.save();
  assert.deepEqual(h.store.todos.slice(1), before.todos); assert.deepEqual(h.store.todos[0].extra, { retained: true });
  assert.equal(h.store.todoButtonVisible, false);
}
{
  const h = harness(), before = clone(h.state.todos), action = h.clock.createTodoAction(h.host);
  assert.equal(action.target().id, 'b-task'); assert.equal(await action.complete(action.target()), 'saved');
  assert.deepEqual(h.store.todos, before.map(todo => todo.id === 'b-task' ? { ...todo, done: true } : todo));
  assert.equal(action.target().id, 'b-next');
  h.clock.renderTodos(); const row = h.elements.todoList.children[2]; row.children[0].checked = true; h.fire(row.children[0], 'change'); await h.settle();
  assert.equal(h.store.todos.find(todo => todo.id === 'b-next').done, true);
  h.fire(h.elements.todoList.children[0].children[2], 'click'); await h.settle();
  assert.deepEqual(h.store.todos.map(todo => todo.id), before.filter(todo => todo.id !== 'b-task').map(todo => todo.id));
  assert.deepEqual(h.store.todos.filter(todo => todo.sceneId === A), before.filter(todo => todo.sceneId === A));
}
{
  const h = harness(), before = clone(h.state.todos);
  assert.equal(h.$('clock-todo-open').hidden, true, 'the global task-button preference still hides the list entry');
  h.fire(h.$('dot-2'), 'click'); h.fire(h.$('clock-todo-complete'), 'click'); await h.settle();
  assert.equal(h.$('clock-todo-text').textContent, 'Next task'); assert.equal(h.$('clock-todo-count').textContent, '还有 1 件未完成');
  assert.equal(h.elements.todoCount.textContent, '2/3');
  assert.deepEqual(h.store.todos.filter(todo => todo.sceneId === A), before.filter(todo => todo.sceneId === A));
  h.setView(A); h.clock.renderTodos(); assert.equal(h.$('clock-todo-open').hidden, true);
}
for (const change of ['archive', 'move']) {
  const h = harness();
  assert.equal((await h.folders.moveSites(h.folders.captureBulkSelection(), ['b-first'], h.folders.captureBulkDestination({ kind: 'group', id: 'b-work' }))).ok, true);
  if (change === 'archive') h.race(() => { h.store.scenes.find(scene => scene.id === B).archivedAt = 123; });
  else h.race(() => { h.store.folders.find(group => group.id === 'b-work').sceneId = A; });
  await h.undo(); assert.equal(h.writes.length, 1, 'undo cannot mutate newly archived or moved ownership');
  assert.equal(h.store.icons.find(icon => icon.id === 'b-first').folderId, 'b-work');
}
{
  const h = harness(), before = clone(h.state.icons);
  h.race(() => { h.store.folders.find(group => group.id === 'b-work').sceneId = A; });
  h.folders.moveIconToGroup('b-first', 'b-work'); await h.settle();
  assert.equal(h.writes.length, 0); assert.deepEqual(h.store.icons, before, 'single-site same-scene moves also guard durable target ownership');
}
for (const identity of [false, true]) {
  const h = harness({ identity }), action = h.clock.createTodoAction(h.host), shown = action.target(), oldRow = h.elements.todoList.children[0];
  h.setView(A); h.setView(B);
  assert.equal(await action.complete(shown), 'stale');
  oldRow.children[0].checked = true; h.fire(oldRow.children[0], 'change'); h.fire(oldRow.children[2], 'click');
  await h.settle(); assert.equal(h.writes.length, 0, 'both card and old list callbacks reject a newer view generation');
}
for (const mutate of [
  h => { h.store.todos.find(todo => todo.id === 'b-task').sceneId = A; },
  h => { h.store.scenes.find(scene => scene.id === B).archivedAt = 123; },
  h => { h.store['opentab.workspaceEpoch'] = 3; },
  h => h.setView(A)
]) {
  const h = harness(), action = h.clock.createTodoAction(h.host), shown = action.target(); h.race(() => mutate(h));
  assert.equal(await action.complete(shown), 'failed'); assert.equal(h.writes.length, 0);
  assert.equal(h.store.todos.find(todo => todo.id === 'b-task').done, false);
}
for (const kind of ['complete', 'delete']) {
  const h = harness(); const row = h.elements.todoList.children[0];
  h.race(() => { h.store.todos.find(todo => todo.id === 'b-task').sceneId = A; });
  if (kind === 'complete') { row.children[0].checked = true; h.fire(row.children[0], 'change'); }
  else h.fire(row.children[2], 'click');
  await h.settle(); assert.equal(h.writes.length, 0); assert.equal(h.store.todos.find(todo => todo.id === 'b-task').done, false);
}
{
  const h = harness(); h.state.scenes.find(scene => scene.id === B).archivedAt = 123; h.clock.renderTodos(); h.folders.renderChrome();
  assert.equal(h.elements.todoList.children.length, 0); assert.equal(h.$('group-tabs').children.length, 0);
  assert.equal(h.clock.createTodoAction(h.host).target(), null); assert.equal(h.clock.createTodoRecord(h.host, { id: 'no', text: 'No' }), null);
  assert.equal(h.folders.captureBulkDestination({ kind: 'group', id: 'b-home' }), null); assert.equal(h.writes.length, 0);
  h.clearView(); assert.equal(h.clock.visibleTodos(h.host).length, 0); assert.equal(h.folders.visibleGroups().length, 0, 'present but unavailable scene adapters fail closed');
}
{
  const data = { folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }], icons: [site('legacy', 'folder-home')], todos: [{ id: 'legacy-task', text: 'Legacy', done: false }], currentFolderId: 'folder-home' };
  const h = harness({ data, scenes: false });
  assert.deepEqual(clone(h.folders.visibleGroups()), data.folders); assert.equal(h.elements.todoList.children.length, 1);
  assert.equal(h.clock.createTodoAction(h.host).target().id, 'legacy-task');
  assert.deepEqual(clone(h.clock.createTodoRecord(h.host, { id: 'new', text: 'New', done: false })), { id: 'new', text: 'New', done: false });
  assert.deepEqual(clone(h.folders.ensureGroups([])), [{ id: 'folder-home', name: '主页' }]);
  assert.deepEqual(clone(h.folders.addGroupRecord([], 'Work', 'new').group), { id: 'new', name: 'Work' });
  const migrated = Schema.migrateLegacy({ icons: [{ id: 'implicit', url: 'https://example.com' }], todos: [{ id: 'task', text: 'Task' }] });
  assert.deepEqual(clone(h.folders.ensureGroups(migrated.folders)), migrated.folders);
  assert.equal(migrated.icons[0].folderId, 'folder-home'); assert.equal(migrated.folders[0].sceneId, A);
  const added = h.folders.addGroupRecord(fixture().folders, 'New', 'new-scene-group', { sceneId: B, homeGroupId: 'b-home' });
  assert.equal(added.group.sceneId, B); assert.equal(added.folders.filter(group => group.id === 'folder-home').length, 1);
  const scenes = fixture(), view = { sceneId: B, homeGroupId: 'b-home' };
  assert.deepEqual(clone(h.folders.removeGroupRecord(scenes.folders, scenes.icons, 'b-home', 'delete', view)), { folders: scenes.folders, icons: scenes.icons });
  assert.deepEqual(clone(h.folders.removeGroupRecord(scenes.folders, scenes.icons, 'a-work', 'delete', view)), { folders: scenes.folders, icons: scenes.icons });
  const removed = h.folders.removeGroupRecord(scenes.folders, scenes.icons, 'b-work', 'move', view);
  assert.equal(removed.icons.find(icon => icon.id === 'b-folder').folderId, 'b-home');
}

// A new read-only/busy recovery gate may move native focus. That blur must
// preserve inline draft DOM; only ordinary blur or explicit cancel finishes it.
for (const kind of ['add', 'rename']) for (const finish of ['blur', 'cancel']) {
  const h = harness(), before = clone(h.state); let blocked = true;
  h.host.isEditingBlocked = () => blocked;
  if (kind === 'add') h.fire(h.$('add-group-btn'), 'click');
  else h.fire(h.$('group-tabs').children[1], 'dblclick');
  const input = h.document.querySelector('.group-inline-input'); input.value = 'Preserve this draft';
  h.fire(input, 'blur'); await h.settle();
  assert.equal(input.isConnected, true, kind + ': blocked focus loss retains draft input');
  assert.equal(input.value, 'Preserve this draft'); assert.deepEqual(clone(h.state), before); assert.equal(h.writes.length, 0);
  if (finish === 'blur') {
    blocked = false; h.fire(input, 'blur'); await h.settle();
    assert.equal(input.isConnected, false, 'ordinary legacy blur still commits');
    assert.equal(h.store.folders.some(group => group.name === 'Preserve this draft'), true);
    assert.equal(h.writes.length, 1);
  } else {
    h.fire(input, 'opentab-cancel-edit'); await h.settle();
    assert.equal(input.isConnected, false, 'explicit discard still cancels while blocked');
    assert.deepEqual(clone(h.state), before); assert.equal(h.writes.length, 0);
  }
}
console.log('Scene projections passed: scoped groups/todos, full-graph preservation, active Home, stale views and locked ownership/archive guards.');
