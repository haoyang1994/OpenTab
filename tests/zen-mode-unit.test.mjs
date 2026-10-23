import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const zenSource = source('zen-mode.js'), clockSource = source('clock-deck.js');

// Load both real modules, including getFocus(), subscription/ticking and the
// entry click handler. Only browser primitives, storage and wall time are fake.
function harness({ fullscreen = 'success', minimal = false, hiddenTodo = false, videoPlaying = false, homeReady = true } = {}) {
  let now = 1_000_000, timerId = 0, document, root;
  const timers = new Map(), session = new Map(), writes = [], order = [], observers = [];
  const pending = [], requests = [], exits = [], changes = [], warnings = [];
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  const matches = (node, selector) => selector.split(',').some(part => {
    part = part.trim();
    if (part.startsWith('#')) return node.id === part.slice(1);
    if (part.startsWith('.')) return node.classList.contains(part.slice(1));
    if (part === '[inert]') return node.inert;
    if (part.startsWith('[')) {
      const [key, value] = part.slice(1, -1).split('=');
      return node.getAttribute(key) !== null && (!value || node.getAttribute(key) === value.replaceAll('"', ''));
    }
    return node.tagName.toLowerCase() === part;
  });
  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn, options = false) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ fn, capture: options === true || options.capture === true });
    }
    invoke(event, capture) {
      for (const item of this.listeners.get(event.type) || []) {
        if (item.capture !== capture) continue;
        item.fn(event);
        if (event.immediateStopped) break;
      }
    }
    dispatchEvent(event) {
      event.target ||= this;
      const path = [];
      for (let node = this; node; node = node.parentElement) path.push(node);
      if (!path.includes(document)) path.push(document);
      path.push(root);
      for (const node of [...path].reverse()) { node.invoke(event, true); if (event.stopped) return !event.defaultPrevented; }
      for (const node of path) { node.invoke(event, false); if (event.stopped) break; }
      return !event.defaultPrevented;
    }
  }
  class Element extends Target {
    constructor(tag = 'div', id = '') {
      super(); this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.attributes = new Map(); this.dataset = {}; this.style = {}; this.className = ''; this.textContent = ''; this.inert = false; this.hidden = false; this.disabled = false; this.isConnected = true;
      this.classList = {
        contains: value => this.className.split(/\s+/).includes(value),
        toggle: (value, enabled) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          if (enabled ?? !set.has(value)) set.add(value); else set.delete(value);
          this.className = [...set].join(' ');
          if (this === document?.body) observers.forEach(fn => fn());
        },
        add: value => this.classList.toggle(value, true), remove: value => this.classList.toggle(value, false)
      };
    }
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    contains(node) { return this === node || descendants(this).includes(node); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); }
    focus() {
      if (this.disabled || this.closest('[inert]') || this.hidden || !this.isConnected) return;
      document.activeElement = this;
      this.dispatchEvent(event('focusin'));
    }
    click() { if (!this.disabled) this.dispatchEvent(event('click')); }
    setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  }
  root = new Target(); document = new Target();
  const html = new Element('html'), body = html.appendChild(new Element('body'));
  html.parentElement = document; document.body = body; document.documentElement = html; document.activeElement = body; document.fullscreenElement = null;
  const add = (id, parent = body, tag = 'div') => parent.appendChild(new Element(tag, id));
  const home = add('homepage'), entry = add('zen-toggle-btn', home, 'button'), input = add('search-input', home, 'input');
  input.value = 'keep this search'; input.setSelectionRange(5, 9, 'backward');
  const video = add('background-video', home, 'video'); video.paused = !videoPlaying; video.pauseCount = video.playCount = 0;
  video.pause = () => { video.paused = true; video.pauseCount++; };
  video.play = () => { video.paused = false; video.playCount++; return Promise.resolve(); };
  const todo = add('todo-widget', home); todo.className = 'hidden';
  const existingInert = add('already-inert'); existingInert.inert = true;
  const script = add('script', body, 'script');
  const panel = add('zen-mode'); panel.hidden = true;
  add('zen-exit', panel, 'button'); add('zen-time', panel); add('zen-focus-toggle', panel, 'button'); add('zen-focus-reset', panel, 'button'); add('zen-status', panel);
  const deck = add('clock-deck', home), stage = add('clock-deck-stage', deck);
  const clock = add('clock-widget', stage), focusCard = add('clock-focus-card', stage), todoCard = add('clock-todo-card', stage);
  for (const id of ['clock-focus-time', 'clock-focus-status', 'clock-focus-progress', 'clock-focus-note']) add(id, focusCard);
  for (const id of ['clock-focus-toggle', 'clock-focus-reset']) add(id, focusCard, 'button');
  for (const id of ['clock-todo-text', 'clock-todo-count', 'clock-todo-status']) add(id, todoCard);
  for (const id of ['clock-todo-complete', 'clock-todo-open']) add(id, todoCard, 'button');
  add('clock-deck-peek', stage, 'button'); add('clock-deck-status', deck); add('settings-btn', home, 'button');
  const nav = add('clock-deck-nav', deck);
  for (let index = 0; index < 3; index++) add(`dot-${index}`, nav, 'button').setAttribute('data-clock-card', index);
  document.getElementById = id => [html, ...descendants(html)].find(node => node.id === id) || null;
  const $ = document.getElementById;
  const event = (type, extra = {}) => ({ type, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediateStopped = this.stopped = true; }, ...extra });
  const fullscreenChange = node => { document.fullscreenElement = node; document.dispatchEvent(event('fullscreenchange')); };
  if (fullscreen !== 'unsupported') html.requestFullscreen = () => {
    order.push('requestFullscreen'); requests.push({ synchronous: inEntryClick, inert: home.inert });
    if (fullscreen === 'throw') throw Error('Synchronous fullscreen refusal');
    if (fullscreen === 'reject') return Promise.reject(Error('Fullscreen denied'));
    if (fullscreen === 'pending') return new Promise((resolve, reject) => pending.push({ resolve: () => { fullscreenChange(html); resolve(); }, reject }));
    fullscreenChange(html); return Promise.resolve();
  };
  document.exitFullscreen = () => { exits.push(document.fullscreenElement); fullscreenChange(null); return Promise.resolve(); };
  const state = { todos: [], minimalMode: minimal, todoButtonVisible: !hiddenTodo, todoPanelOpen: false, sceneId: 'study', folders: [{ id: 'study-home' }] };
  const pristine = structuredClone(state); let opened = 0, inEntryClick = false, restoreHome = homeReady;
  if (minimal) body.classList.add('minimal-mode');
  if (hiddenTodo) body.classList.add('hide-todo-entry');
  const context = vm.createContext({
    document, console: { warn: (...args) => warnings.push(args) },
    Date: class extends Date { static now() { return now; } },
    sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => { writes.push({ key, value }); session.set(key, value); } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { if (!observers.includes(this.fn)) observers.push(this.fn); } disconnect() {} },
    addEventListener: root.addEventListener.bind(root)
  });
  vm.runInContext(clockSource, context);
  context.OpenTabClockDeck.init({ state, closeClockPopovers() {}, openTodoList() { opened++; }, workspace: { captureIntent: () => ({}), isIntentCurrent: () => true } });
  assert.deepEqual(warnings, [], 'real clock deck initializes successfully in the fixture');
  const focus = context.OpenTabClockDeck.getFocus(); assert.ok(focus);
  vm.runInContext(zenSource, context);
  const options = { focus, closePopovers() { order.push('closePopovers'); }, onActiveChange: value => changes.push(value), canRestoreHome: () => restoreHome };
  context.OpenTabZenMode.init(options);
  return { $, body, html, home, input, video, todo, script, panel, existingInert, document, root, state, pristine, focus, api: context.OpenTabZenMode, context, requests, exits, pending, order, changes, writes, session, timers,
    event, fullscreenChange, setHomeReady: value => { restoreHome = value; },
    clickEntry() { entry.focus(); inEntryClick = true; entry.click(); inEntryClick = false; },
    key(key, extra = {}, type = 'keydown') { const e = event(type, { key, ...extra }); document.activeElement.dispatchEvent(e); return e; },
    advance(ms) { now += ms; for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    settle: async () => { await Promise.resolve(); await Promise.resolve(); }, opened: () => opened,
    reinit: () => context.OpenTabZenMode.init(options)
  };
}

{
  const h = harness(); h.clickEntry();
  assert.equal(h.api.isActive(), true); assert.equal(h.panel.hidden, false); assert.equal(h.body.classList.contains('zen-mode'), true);
  assert.equal(h.$('zen-toggle-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].synchronous, true, 'fullscreen is requested in the originating click, before a microtask or await');
  assert.deepEqual(h.order, ['requestFullscreen', 'closePopovers']); assert.equal(h.requests[0].inert, false);
  assert.equal(h.focus.snapshot().phase, 'idle'); assert.equal(h.$('zen-time').textContent, '25:00'); assert.equal(h.writes.length, 0, 'entering Zen does not start or persist a timer');
  assert.equal(h.$('zen-focus-reset').disabled, true); assert.equal(h.document.activeElement, h.$('zen-focus-toggle'));
  assert.equal(h.home.inert, true); assert.equal(h.existingInert.inert, true); assert.equal(h.script.inert, false); assert.equal(h.panel.inert, false);
  assert.equal(h.api.enter(), false); h.reinit(); assert.equal(h.requests.length, 1, 'duplicate initialization and entry are idempotent');
  h.$('zen-focus-toggle').click(); assert.equal(h.focus.snapshot().phase, 'running'); assert.equal(h.$('clock-focus-toggle').textContent, '暂停');
  h.advance(12_345); assert.equal(h.$('zen-time').textContent, '24:48'); assert.equal(h.$('zen-time').textContent, h.$('clock-focus-time').textContent);
  h.$('zen-focus-toggle').click(); const remaining = h.focus.snapshot().remaining;
  assert.equal(h.focus.snapshot().phase, 'paused'); assert.equal(h.$('zen-focus-toggle').getAttribute('aria-label'), '继续专注');
  h.advance(60_000); assert.equal(h.focus.snapshot().remaining, remaining);
  h.$('zen-focus-toggle').click(); h.advance(1000); assert.equal(h.focus.snapshot().remaining, remaining - 1000);
  h.$('zen-focus-reset').click(); assert.equal(h.focus.snapshot().phase, 'idle'); assert.equal(h.$('zen-time').textContent, '25:00');
  h.$('zen-exit').click(); await h.settle();
  assert.equal(h.api.isActive(), false); assert.equal(h.panel.hidden, true); assert.equal(h.home.inert, false); assert.equal(h.existingInert.inert, true);
  assert.equal(h.$('zen-toggle-btn').getAttribute('aria-expanded'), 'false'); assert.equal(h.document.activeElement, h.$('zen-toggle-btn'));
  assert.equal(h.document.fullscreenElement, null); assert.equal(h.exits.length, 1); assert.equal(h.api.exit(), false);
  assert.deepEqual(h.changes, [true, false]); assert.deepEqual(h.state, h.pristine);
}

// A running session is the same controller in both presentations, including
// background catch-up, completion and re-entry. Zen itself never autostarts.
{
  const h = harness(); h.focus.toggle(); h.advance(30_000); h.clickEntry();
  assert.equal(h.$('zen-time').textContent, '24:30'); h.api.exit(); h.advance(30_000); h.clickEntry();
  assert.equal(h.$('zen-time').textContent, '24:00'); h.advance(24 * 60_000);
  assert.equal(h.panel.dataset.phase, 'done'); assert.equal(h.$('zen-time').textContent, '00:00');
  assert.equal(h.$('zen-status').textContent, '已完成'); assert.equal(h.$('zen-focus-toggle').getAttribute('aria-label'), '再专注一次');
  h.$('zen-focus-toggle').click(); assert.equal(h.$('clock-focus-time').textContent, '25:00'); assert.equal(h.focus.snapshot().phase, 'running');
}

for (const fullscreen of ['reject', 'throw', 'unsupported']) {
  const h = harness({ fullscreen }); h.clickEntry(); await h.settle();
  assert.equal(h.api.isActive(), true, `${fullscreen}: fallback retains a usable Zen screen`);
  assert.equal(h.document.fullscreenElement, null); h.$('zen-focus-toggle').click(); assert.equal(h.focus.snapshot().phase, 'running');
  h.$('zen-exit').click(); await h.settle(); assert.equal(h.api.isActive(), false); assert.equal(h.exits.length, 0); assert.equal(h.home.inert, false);
}
{
  const h = harness({ fullscreen: 'pending' }); h.clickEntry(); assert.equal(h.pending.length, 1);
  h.$('zen-exit').click(); assert.equal(h.api.isActive(), false); assert.equal(h.home.inert, false);
  h.pending[0].resolve(); await h.settle();
  assert.equal(h.document.fullscreenElement, null, 'a late fullscreen success after rapid exit is immediately unwound'); assert.equal(h.exits.length, 1);
  assert.equal(h.api.isActive(), false); assert.equal(h.panel.hidden, true);
}
{
  const h = harness({ fullscreen: 'pending' }); h.clickEntry(); h.api.exit();
  h.pending[0].reject(Error('Late refusal')); await h.settle(); assert.equal(h.api.isActive(), false); assert.equal(h.exits.length, 0);
  h.clickEntry(); h.pending[1].resolve(); await h.settle(); assert.equal(h.api.isActive(), true); assert.equal(h.document.fullscreenElement, h.html);
  h.api.exit(); assert.equal(h.document.fullscreenElement, null);
}
{
  const h = harness({ fullscreen: 'pending' });
  h.clickEntry(); h.api.exit(); h.clickEntry();
  assert.equal(h.requests.length, 1, 'exit/re-entry shares the outstanding fullscreen request instead of issuing a second one');
  h.api.exit(); h.pending[0].resolve(); await h.settle();
  assert.equal(h.document.fullscreenElement, null, 'the first session cannot leak fullscreen after the replacement session also exits');
  assert.equal(h.exits.length, 1); assert.equal(h.api.isActive(), false);
  h.clickEntry(); assert.equal(h.requests.length, 2, 'a fresh click may request fullscreen again after the old request settles');
  h.pending[1].resolve(); await h.settle(); assert.equal(h.document.fullscreenElement, h.html);
  h.api.exit(); assert.equal(h.document.fullscreenElement, null); assert.equal(h.exits.length, 2);
}
{
  const h = harness({ fullscreen: 'pending' }); h.clickEntry(); h.api.exit(); h.clickEntry();
  h.pending[0].resolve(); await h.settle();
  assert.equal(h.api.isActive(), true); assert.equal(h.document.fullscreenElement, h.html);
  assert.equal(h.exits.length, 0, 'a late shared request does not dismiss the currently active replacement session');
  h.api.exit(); assert.equal(h.document.fullscreenElement, null); assert.equal(h.exits.length, 1);
}
{
  const h = harness(); h.clickEntry();
  const escape = h.key('Escape'); assert.equal(escape.defaultPrevented, undefined, 'Escape is never cancelled, so the browser can leave fullscreen');
  h.fullscreenChange(null); await h.settle();
  assert.equal(h.api.isActive(), true); assert.equal(h.panel.hidden, false); assert.equal(h.requests.length, 1, 'native fullscreen exit never requests fullscreen again');
  h.advance(5000); assert.equal(h.requests.length, 1); h.api.exit(); assert.equal(h.exits.length, 0, 'no fullscreen ownership remains after browser Escape');
}
{
  const h = harness(); const unrelated = h.$('clock-widget'); h.fullscreenChange(unrelated); h.clickEntry();
  assert.equal(h.requests.length, 0, 'pre-existing fullscreen is not claimed'); h.api.exit();
  assert.equal(h.document.fullscreenElement, unrelated); assert.equal(h.exits.length, 0, 'exit does not dismiss another fullscreen owner');
}

for (const minimal of [false, true]) for (const hiddenTodo of [false, true]) {
  const h = harness({ minimal, hiddenTodo, videoPlaying: true });
  h.input.focus(); h.api.enter();
  assert.equal(h.video.pauseCount, 1); assert.equal(h.video.paused, true); assert.equal(h.todo.className, 'hidden');
  assert.deepEqual(h.state, h.pristine); h.api.exit();
  assert.equal(h.input.value, 'keep this search'); assert.deepEqual([h.input.selectionStart, h.input.selectionEnd, h.input.selectionDirection], [5, 9, 'backward']);
  assert.equal(h.document.activeElement, h.input); assert.equal(h.body.classList.contains('minimal-mode'), minimal);
  assert.equal(h.body.classList.contains('hide-todo-entry'), hiddenTodo); assert.equal(h.todo.className, 'hidden');
  assert.equal(h.video.playCount, 1); assert.equal(h.video.paused, false); assert.deepEqual(h.state, h.pristine, 'scene, TODO and persisted minimal settings are never rewritten');
}
{
  const h = harness(); h.input.focus(); h.api.enter(); h.input.value = 'newer external value'; h.input.setSelectionRange(2, 2, 'none'); h.api.exit();
  assert.equal(h.input.value, 'newer external value'); assert.equal(h.input.selectionStart, 2, 'exit must not overwrite a newer input/caret'); assert.equal(h.video.playCount, 0, 'a previously paused video stays paused');
}
{
  const h = harness(); h.input.focus(); h.api.enter(); h.setHomeReady(false); h.api.exit();
  assert.equal(h.home.inert, true, 'scene readiness/busy state must still own the underlying home after exit');
  assert.notEqual(h.document.activeElement, h.input, 'focus is not restored into a newly locked home');
}
{
  const h = harness(); h.input.focus(); h.api.enter(); h.input.isConnected = false; h.api.exit();
  assert.equal(h.document.activeElement, h.$('zen-toggle-btn'), 'removed pre-Zen focus falls back to the surviving entry control');
}

{
  const h = harness(); let leaked = 0;
  h.document.addEventListener('keydown', () => leaked++, true); h.document.addEventListener('keyup', () => leaked++, true);
  h.clickEntry();
  for (const [key, extra] of [['k', { ctrlKey: true }], ['k', { metaKey: true }], ['2', { altKey: true }], ['x', {}], ['Escape', {}], ['Enter', { isComposing: true }], [' ', { keyCode: 229 }]]) {
    const e = h.key(key, extra); h.key(key, extra, 'keyup'); assert.equal(e.stopped, true);
  }
  assert.equal(leaked, 0, 'capture isolation prevents Ctrl+K, Alt+digit, typing and Escape from reaching hidden global handlers');
  assert.equal(h.input.value, 'keep this search'); assert.equal(h.focus.snapshot().phase, 'idle');
  h.key('Tab'); assert.equal(h.document.activeElement, h.$('zen-exit'), 'disabled reset is excluded from focus wrapping');
  h.key('Tab', { shiftKey: true }); assert.equal(h.document.activeElement, h.$('zen-focus-toggle'));
  h.key('Enter'); assert.equal(h.focus.snapshot().phase, 'running');
  assert.equal(h.key('Enter', { repeat: true }).defaultPrevented, true, 'repeated Enter suppresses the native default click too');
  assert.equal(h.key(' ', { repeat: true }).defaultPrevented, true, 'repeated Space suppresses native activation');
  assert.equal(h.focus.snapshot().phase, 'running', 'held activation does not repeatedly pause/resume');
  h.key(' '); assert.equal(h.focus.snapshot().phase, 'paused');
  h.key('Tab'); assert.equal(h.document.activeElement, h.$('zen-focus-reset'));
  h.key('Enter'); assert.equal(h.focus.snapshot().phase, 'idle');
  // Deliver a browser focus event directly: the capture handler redirects any
  // attempted script/assistive-technology escape back inside the dialog.
  h.document.activeElement = h.input; h.input.dispatchEvent(h.event('focusin'));
  assert.equal(h.document.activeElement, h.$('zen-focus-toggle'));
  h.api.exit(); h.key('x'); assert.equal(leaked, 1, 'normal global handling resumes only after Zen exits');
}

console.log('Zen mode unit checks passed');
