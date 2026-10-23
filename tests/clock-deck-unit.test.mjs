import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Workspace = require('../workspace-persistence.js');
const source = fs.readFileSync(new URL('../clock-deck.js', import.meta.url), 'utf8');
const apiContext = vm.createContext({ console }); vm.runInContext(source, apiContext);
const { createFocusTimer, formatRemaining, swipeDirection, createTodoAction, DURATION, FOCUS_KEY } = apiContext.OpenTabClockDeck;
const memory = initial => { const data = new Map(Object.entries(initial || {})); return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) }; };
{
  let now = 1_000_000; const storage = memory(); const timer = createFocusTimer({ storage, now: () => now });
  assert.equal(timer.snapshot().phase, 'idle'); assert.equal(formatRemaining(timer.snapshot().remaining), '25:00');
  timer.toggle(); now += 12_345; assert.equal(formatRemaining(timer.snapshot().remaining), '24:48');
  const restored = createFocusTimer({ storage, now: () => now }); assert.equal(restored.snapshot().remaining, DURATION - 12_345, 'reload restores deadline, not saved tick count');
  restored.toggle(); const paused = restored.snapshot().remaining; now += 100_000;
  assert.equal(restored.snapshot().remaining, paused); assert.equal(createFocusTimer({ storage, now: () => now }).snapshot().remaining, paused);
  restored.toggle(); now += 123; assert.equal(restored.snapshot().remaining, paused - 123);
  restored.reset(); now += DURATION * 2; assert.equal(restored.snapshot().phase, 'idle'); assert.equal(restored.snapshot().remaining, DURATION, 'reset cancels old deadline');
  restored.toggle(); now += DURATION + 1000; assert.equal(restored.snapshot().phase, 'done'); assert.equal(formatRemaining(restored.snapshot().remaining), '00:00');
  assert.equal(createFocusTimer({ storage, now: () => now }).snapshot().phase, 'done');
  restored.toggle(); assert.equal(restored.snapshot().remaining, DURATION, 'completed session can restart');
  now -= 5_000_000; assert.equal(restored.snapshot().remaining, DURATION, 'wall-clock rollback does not extend the duration');
  now += 5000; assert.equal(restored.snapshot().remaining, DURATION - 5000, 'countdown resumes after a backwards clock adjustment');
  assert.equal(formatRemaining(1), '00:01'); assert.equal(formatRemaining(-10), '00:00');
}
for (const invalid of ['bad JSON', '{}', JSON.stringify({ version: 1, phase: 'running', remaining: DURATION, deadline: Infinity }), JSON.stringify({ version: 1, phase: 'paused', remaining: -1 }), JSON.stringify({ version: 1, phase: 'running', remaining: 1000, deadline: 5_000_000 })]) {
  const timer = createFocusTimer({ storage: memory({ [FOCUS_KEY]: invalid }), now: () => 100_000 });
  assert.equal(timer.snapshot().phase, 'idle', 'malformed or impossible session cannot start a timer');
}
{
  const expired = createFocusTimer({ storage: memory({ [FOCUS_KEY]: JSON.stringify({ version: 1, phase: 'running', remaining: DURATION, deadline: 10_000 }) }), now: () => 100_000 });
  assert.equal(expired.snapshot().phase, 'done'); assert.equal(expired.snapshot().remaining, 0);
  const blocked = createFocusTimer({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } } });
  assert.equal(blocked.snapshot().persistent, false); blocked.toggle(); assert.equal(blocked.snapshot().phase, 'running'); assert.equal(blocked.snapshot().persistent, false);
  blocked.reset(); assert.equal(blocked.snapshot().phase, 'idle');
  const writeBlocked = createFocusTimer({ storage: { getItem() { return null; }, setItem() { throw Error('quota'); } } });
  writeBlocked.toggle(); assert.equal(writeBlocked.snapshot().persistent, false);
}
{
  const start = { pointerId: 1, clientX: 100, clientY: 100 };
  for (const [dx, dy, result] of [[47, 0, 0], [48, 0, -1], [-48, 0, 1], [-70, 60, 0], [-65, 50, 0], [-66, 50, 1], [0, 100, 0]]) assert.equal(swipeDirection(start, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy }), result);
  assert.equal(swipeDirection(start, { pointerId: 2, clientX: 0, clientY: 0 }), 0);
}
function workspaceHarness(todos = [{ id: 'one', text: 'First', done: false }, { id: 'two', text: 'Second', done: false }]) {
  const store = { todos: structuredClone(todos), icons: [{ id: 'site', name: 'Existing site' }], folders: [{ id: 'home', name: 'Home' }], clockFormat: '12h' }, writes = [];
  let fail = false, changed = () => {};
  const chrome = { runtime: {}, storage: { local: {
    async get(keys) { return structuredClone(keys ? Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]])) : store); },
    async set(value) { if (fail) { fail = false; throw Error('storage unavailable'); } writes.push(structuredClone(value)); Object.assign(store, structuredClone(value)); }
  } } };
  const api = Workspace.forChrome(chrome), state = structuredClone(store), errors = [], changes = [];
  const workspace = api.connect({ state, onError: error => errors.push(error), onChange: () => { changes.push(structuredClone(state)); changed(); } }); workspace.seed(store);
  const host = { state, workspace, saveState: workspace.save };
  return { store, writes, api, state, workspace, errors, changes, host, failNext: () => { fail = true; }, setOnChange: callback => { changed = callback; } };
}
{
  const h = workspaceHarness(), action = createTodoAction(h.host); const target = action.target();
  const before = structuredClone(h.store), parallel = structuredClone(before); parallel.todos[1].text = 'Changed in another tab'; parallel.icons[0].name = 'Changed site';
  await h.api.commit(before, parallel);
  assert.equal(await action.complete(target), 'saved'); assert.equal(h.store.todos[0].done, true);
  assert.equal(h.store.todos[1].text, 'Changed in another tab'); assert.equal(h.store.icons[0].name, 'Changed site');
  assert.equal(action.target().id, 'two'); assert.equal(h.state.todos[1].text, 'Changed in another tab');
}
for (const mutate of [state => { state.todos[0].text = 'Renamed'; }, state => { state.todos[0].done = true; }, state => { state.todos.shift(); }]) {
  const h = workspaceHarness(), action = createTodoAction(h.host), shown = action.target(); mutate(h.state);
  assert.equal(await action.complete(shown), 'stale'); assert.equal(h.writes.length, 0, 'visible identity check rejects stale callbacks before writing');
}
for (const mutate of [state => { state.todos[0].text = 'Remote rename'; }, state => { state.todos.shift(); }, state => { state.todos[0].done = true; }]) {
  const h = workspaceHarness(), action = createTodoAction(h.host), shown = action.target();
  const before = structuredClone(h.store), remote = structuredClone(before); mutate(remote); await h.api.commit(before, remote);
  assert.equal(await action.complete(shown), 'failed', 'durable guard catches remote changes after render');
  assert.deepEqual(h.store.todos, remote.todos); assert.deepEqual(structuredClone(h.state.todos), remote.todos); assert.equal(h.writes.length, 1, 'no stale completion write');
}
{
  const h = workspaceHarness(), action = createTodoAction(h.host), shown = action.target(); h.failNext();
  assert.equal(await action.complete(shown), 'failed'); assert.equal(h.state.todos[0].done, false); assert.equal(h.store.todos[0].done, false);
  assert.equal(await action.complete(action.target()), 'saved', 'save failure recovers and permits a fresh action');
}
{
  const h = workspaceHarness(); let release, entered = false;
  const lock = h.api.transaction(async () => { entered = true; await new Promise(resolve => { release = resolve; }); });
  while (!entered) await new Promise(resolve => setImmediate(resolve));
  const action = createTodoAction(h.host), shown = action.target(), first = action.complete(shown);
  assert.equal(action.pending, true); assert.equal(await action.complete(shown), 'pending');
  release(); await lock; assert.equal(await first, 'saved'); assert.equal(h.writes.length, 1, 'repeated activation cannot double-save');
}
{
  const h = workspaceHarness(), action = createTodoAction(h.host), shown = action.target();
  await h.api.replace({ todos: [{ id: 'one', text: 'First', done: false }] });
  assert.equal(await action.complete(shown), 'failed', 'import/replacement epoch invalidates old task identity even when text and ID match');
  assert.equal(h.store.todos[0].done, false);
}

for (const parallel of [false, true]) {
  const h = workspaceHarness();
  h.host.saveState = async () => {
    if (parallel) h.state.todos[0] = { id: 'one', text: 'Newer local version', done: false };
    throw Error('Unexpected adapter failure');
  };
  const action = createTodoAction(h.host);
  assert.equal(await action.complete(action.target()), 'failed'); assert.equal(action.pending, false);
  assert.equal(h.state.todos[0].done, false);
  assert.equal(h.state.todos[0].text, parallel ? 'Newer local version' : 'First');
  assert.equal(h.writes.length, 0);
}

// Exercise real event handlers and legacy list rendering without browser sockets.
function domHarness({ brokenDeck = false, hiddenTodo = false } = {}) {
  let document, selection = '', observer;
  const timers = new Map(), globalListeners = new Map(); let timerId = 0;
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
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {}; this.className = ''; this._text = ''; this.inert = false; this.hidden = false;
      this.classList = { contains: value => this.className.split(/\s+/).includes(value), toggle: (value, enabled) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); if (enabled ?? !set.has(value)) set.add(value); else set.delete(value); this.className = [...set].join(' '); }, add: value => this.classList.toggle(value, true), remove: value => this.classList.toggle(value, false) };
    }
    set disabled(value) { this._disabled = value; if (value && document?.activeElement === this) document.activeElement = document.body; }
    get disabled() { return this._disabled; }
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { assert.equal(value, '', 'never insert user text as HTML'); this.children = []; }
    get innerHTML() { return this.textContent; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    contains(node) { return this === node || descendants(this).includes(node); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    dispatchEvent(event) {
      event.target ||= this;
      for (const fn of this.listeners.get(event.type) || []) { const result = fn(event); if (result?.then) pending.push(result); }
      if (!event.stopped) this.parentElement?.dispatchEvent(event);
      return !event.defaultPrevented;
    }
    focus() { if (!this.disabled && !this.hidden && !this.inert) document.activeElement = this; }
  }
  const pending = [], body = new Element('body');
  document = new Element('document'); document.body = body; body.parentElement = document; document.activeElement = body;
  const add = (id, parent = body, tag = 'div') => parent.appendChild(new Element(tag, id));
  const deck = add('clock-deck'), stage = add('clock-deck-stage', deck);
  const clock = add('clock-widget', stage), focus = add('clock-focus-card', stage), todo = add('clock-todo-card', stage);
  const addText = (id, parent) => add(id, parent, 'p'), addButton = (id, parent) => add(id, parent, 'button');
  const date = addButton('date', clock), timezone = addButton('timezone-btn', clock), calendar = add('calendar-popover', clock); calendar.className = 'calendar-popover';
  const day = add('day', calendar, 'span'); const weather = add('weather-pill', clock);
  const time = add('time', clock), input = add('nested-input', focus, 'input'), editable = add('editable', focus); editable.setAttribute('contenteditable', 'true');
  for (const id of ['clock-focus-time', 'clock-focus-status', 'clock-focus-progress', 'clock-focus-note']) addText(id, focus);
  for (const id of ['clock-focus-toggle', 'clock-focus-reset']) addButton(id, focus);
  for (const id of ['clock-todo-text', 'clock-todo-count', 'clock-todo-status']) addText(id, todo);
  for (const id of ['clock-todo-complete', 'clock-todo-open']) addButton(id, todo);
  addButton('clock-deck-peek', stage);
  const nav = add('clock-deck-nav', deck);
  addText('clock-deck-status', deck);
  const dots = [0, 1, 2].map(index => { const dot = addButton(`dot-${index}`, nav); dot.setAttribute('data-clock-card', index); return dot; });
  addButton('settings-btn'); add('search-input', body, 'input');
  const elements = Object.fromEntries(['todoList', 'todoCount', 'todoEmpty', 'todoProgressBar'].map(key => [key, add(key)]));
  document.createElement = tag => new Element(tag);
  document.getElementById = id => [body, ...descendants(body)].find(node => node.id === id) || null;
  if (hiddenTodo) body.classList.add('hide-todo-entry');
  const h = workspaceHarness(), host = { ...h.host, elements }; let popoversClosed = 0, opened = 0;
  host.closeClockPopovers = () => { popoversClosed++; calendar.classList.add('hidden'); };
  host.openTodoList = () => { opened++; };
  const context = vm.createContext({ document, console: { warn() {} }, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), sessionStorage: memory(), getSelection: () => selection,
    MutationObserver: class { constructor(fn) { if (brokenDeck) throw Error('observer unavailable'); observer = fn; } observe() {} disconnect() {} },
    addEventListener: (type, fn) => { globalListeners.set(type, fn); } });
  vm.runInContext(source, context); const api = context.OpenTabClockDeck;
  host.renderTodos = () => api.renderTodos(); h.setOnChange(host.renderTodos); api.init(host); api.renderTodos();
  const $ = document.getElementById;
  const event = (type, extra = {}) => ({ type, button: 0, isPrimary: true, pointerId: 1, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });
  const fire = (node, type, extra) => { const e = event(type, extra); node.dispatchEvent(e); return e; };
  const click = node => { node.focus(); return fire(node, 'click'); };
  const swipe = (node = time, dx = -80, dy = 0, end = node, extra = {}) => { fire(node, 'pointerdown', { clientX: 100, clientY: 100, ...extra }); fire(end, 'pointerup', { clientX: 100 + dx, clientY: 100 + dy, ...extra }); };
  return { ...h, host, api, $, body, document, deck, stage, clock, focus, todo, nav, dots, time, date, timezone, calendar, day, weather, input, editable, elements, fire, click, swipe, timers, globalListeners,
    setSelection: text => { selection = text; }, mode: () => observer(), popoversClosed: () => popoversClosed, opened: () => opened,
    settle: async () => { await Promise.all(pending.splice(0)); } };
}
{
  const h = domHarness();
  assert.equal(h.deck.dataset.card, '0'); assert.equal(h.clock.inert, false); assert.equal(h.focus.inert, true); assert.equal(h.todo.getAttribute('aria-hidden'), 'true');
  h.click(h.$('clock-deck-peek')); assert.equal(h.deck.dataset.card, '1'); assert.equal(h.clock.inert, true);
  h.click(h.$('clock-focus-toggle')); assert.equal(h.deck.dataset.card, '1'); assert.equal(h.$('clock-focus-toggle').textContent, '暂停');
  h.click(h.dots[2]); assert.equal(h.deck.dataset.card, '2');
  h.click(h.dots[0]); assert.equal(h.deck.dataset.card, '0');
  assert.equal(h.popoversClosed(), 3);
  h.fire(h.$('search-input'), 'keydown', { key: 'ArrowRight' }); assert.equal(h.deck.dataset.card, '0', 'outside keys never navigate cards');
  assert.equal(h.fire(h.dots[0], 'keydown', { key: 'ArrowRight' }).defaultPrevented, true);
  assert.equal(h.deck.dataset.card, '1'); assert.equal(h.document.activeElement, h.dots[1]);
  h.fire(h.dots[1], 'keydown', { key: 'End' }); assert.equal(h.deck.dataset.card, '2');
  h.fire(h.dots[2], 'keydown', { key: 'Home' }); assert.equal(h.deck.dataset.card, '0');
  h.fire(h.dots[0], 'keydown', { key: 'ArrowLeft' }); assert.equal(h.deck.dataset.card, '2'); assert.equal(h.document.activeElement, h.dots[2]);
  h.fire(h.dots[2], 'keydown', { key: 'ArrowRight' }); assert.equal(h.deck.dataset.card, '0'); assert.equal(h.document.activeElement, h.dots[0]);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) { h.fire(h.dots[0], 'keydown', { key: 'ArrowRight', ...extra }); assert.equal(h.deck.dataset.card, '0'); }
  h.click(h.date); assert.equal(h.deck.dataset.card, '0', 'original clock face clicks are not used for navigation');
  for (const node of [h.date, h.timezone, h.day, h.weather, h.input, h.editable]) { h.swipe(node); assert.equal(h.deck.dataset.card, '0', `${node.id} gesture excluded`); }
  h.swipe(h.time, -47); assert.equal(h.deck.dataset.card, '0');
  h.swipe(h.time, -70, 60); assert.equal(h.deck.dataset.card, '0');
  h.swipe(h.time, -80, 0, h.date); assert.equal(h.deck.dataset.card, '0', 'ending on an action cannot navigate');
  h.setSelection('selected words'); h.swipe(); assert.equal(h.deck.dataset.card, '0'); h.setSelection('');
  h.swipe(h.time, -80, 0, h.time, { isPrimary: false }); assert.equal(h.deck.dataset.card, '0');
  h.swipe(h.time, -80, 0, h.time, { button: 2 }); assert.equal(h.deck.dataset.card, '0');
  h.fire(h.time, 'pointerdown', { clientX: 100, clientY: 100 }); h.fire(h.time, 'pointercancel'); h.fire(h.time, 'pointerup', { clientX: 0, clientY: 100 }); assert.equal(h.deck.dataset.card, '0');
  h.fire(h.time, 'pointerdown', { clientX: 100, clientY: 100 }); h.fire(h.time, 'pointermove', { clientX: 98, clientY: 130 }); h.fire(h.time, 'pointerup', { clientX: 0, clientY: 100 }); assert.equal(h.deck.dataset.card, '0', 'vertical gesture stays cancelled even if it ends horizontal');
  h.swipe(); assert.equal(h.deck.dataset.card, '1'); h.swipe(h.focus, 80); assert.equal(h.deck.dataset.card, '0');
  h.click(h.dots[2]); h.click(h.$('clock-todo-open')); assert.equal(h.opened(), 1);
  h.body.classList.add('hide-todo-entry'); h.mode(); assert.equal(h.$('clock-todo-open').hidden, true);
  h.click(h.$('clock-todo-open')); assert.equal(h.opened(), 1, 'hidden preference cannot be bypassed through card callback');
  h.click(h.$('clock-todo-complete')); await h.settle(); assert.equal(h.store.todos[0].done, true); assert.equal(h.$('clock-todo-text').textContent, 'Second');
  assert.equal(h.document.activeElement, h.$('clock-todo-complete'), 'completion restores useful focus without stealing it from navigation');
  h.body.classList.add('minimal-mode'); h.mode(); assert.equal(h.deck.dataset.card, '0'); assert.equal(h.document.activeElement, h.$('settings-btn'));
  h.swipe(); assert.equal(h.deck.dataset.card, '0'); h.body.classList.remove('minimal-mode'); h.mode(); assert.equal(h.deck.dataset.card, '0');
  assert.equal(h.$('clock-focus-toggle').textContent, '暂停', 'minimal mode and switching never pause focus');
  let blankAreaMenus = 0; h.document.addEventListener('contextmenu', () => { blankAreaMenus++; });
  for (const target of [h.clock, h.time, h.date]) assert.equal(h.fire(target, 'contextmenu').stopped, undefined, 'original clock context menu keeps the global Add Site handler and its exclusions');
  assert.equal(blankAreaMenus, 3);
  for (const target of [h.focus, h.todo, h.nav, h.$('clock-deck-peek')]) {
    const context = h.fire(target, 'contextmenu'); assert.equal(context.stopped, true); assert.equal(context.defaultPrevented, undefined, 'new card controls keep native selection context menu');
  }
  assert.equal(blankAreaMenus, 3, 'new card context menus must not reach Add Site');
}
{
  const h = domHarness({ hiddenTodo: true }); assert.equal(h.$('clock-todo-open').hidden, true);
  h.state.todos[0].text = '<img src=x onerror=alert(1)>'; h.api.renderTodos();
  assert.equal(h.$('clock-todo-text').textContent, '<img src=x onerror=alert(1)>'); assert.equal(h.$('clock-todo-text').children.length, 0);
  const rows = h.elements.todoList.children;
  assert.equal(rows.length, 2); assert.equal(rows[0].className, 'todo-item'); assert.equal(rows[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  rows[0].children[0].checked = true; h.fire(rows[0].children[0], 'change'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.todos[0].done, true); assert.equal(h.elements.todoCount.textContent, '1/2'); assert.equal(h.elements.todoProgressBar.style.width, '50%');
  h.fire(h.elements.todoList.children[1].children[2], 'click'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.todos.length, 1); assert.equal(h.elements.todoList.children.length, 1, 'legacy delete preserves the existing immediate render/save contract');
}
{
  const h = domHarness(); h.failNext();
  const checkbox = h.elements.todoList.children[0].children[0]; checkbox.checked = true; h.fire(checkbox, 'change');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.todos[0].done, false); assert.equal(h.elements.todoList.children[0].children[0].checked, false, 'legacy checkbox failure rerenders recovered workspace');
  assert.equal(h.elements.todoCount.textContent, '0/2');
  h.globalListeners.get('beforeunload')(); assert.equal(h.timers.size, 0);
  h.globalListeners.get('pageshow')(); assert.equal(h.timers.size, 1, 'bfcache/pageshow can resume deadline updates after cleanup');
}
{
  const h = domHarness({ hiddenTodo: true }); h.click(h.dots[2]);
  h.click(h.$('clock-todo-complete')); await h.settle(); h.click(h.$('clock-todo-complete')); await h.settle();
  assert.equal(h.$('clock-todo-text').textContent, '暂无未完成待办', 'empty tasks use only the concise state');
  assert.equal(h.$('clock-todo-complete').hidden, true); assert.equal(h.document.activeElement, h.dots[2], 'empty state retains a visible focus target when list action is hidden');
}
{
  const h = domHarness({ brokenDeck: true }); assert.equal(h.elements.todoList.children.length, 2, 'optional deck failure does not prevent legacy list rendering');
}
const html = fs.readFileSync(new URL('../home.html', import.meta.url), 'utf8'), css = fs.readFileSync(new URL('../clock-deck.css', import.meta.url), 'utf8'), home = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
assert.doesNotMatch(html, /id="(?:clock-deck-prev|clock-deck-next|clock-deck-label|welcome-text|todo-toggle-btn)"/, 'removed descriptions and floating to-do entry do not return');
assert.equal([...html.matchAll(/data-clock-card="[012]"/g)].length, 3, 'the clock has exactly three dot controls');
assert.ok(html.indexOf('src="clock-deck.js"') < html.indexOf('src="home.js"'));
assert.match(home, /openTodoList\(opener\).*setTodoPanelOpen\(true\).*rememberFocus\(opener\).*todoInput\.focus/);
assert.match(css, /touch-action: pan-y/); assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*#clock-deck \.clock-deck-card, \.clock-deck-dots span\s*\{\s*transition: none !important;/, 'scoped reduced-motion shorthand must override home.css universal !important duration and remain truly instantaneous');
assert.doesNotMatch(source, /chrome\.storage|fetch\(|Notification|Audio\(|setInterval/);
assert.equal([...source.matchAll(/innerHTML\s*=([^;]+);/g)].every(match => match[1].trim() === "''"), true);
console.log('clock deck unit tests passed: deadline restore, cancellation, stale/durable tasks, legacy DOM, gestures, accessibility, preferences');
