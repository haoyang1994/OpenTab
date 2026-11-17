import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the real desktop/controller and renderers with deterministic DOM geometry
// and a controlled clock. Pixel/compositing assertions belong to widgets.test.mjs.
const source = fs.readFileSync(new URL('../widgets.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../widgets.css', import.meta.url), 'utf8');
function runtime(saved) {
  let now = Date.UTC(2026, 10, 17, 12), nextTimer = 0, stored = { widgetWorkspace: saved, 'opentab.workspaceEpoch': 0 };
  const timers = new Map(), animations = new Set(), nodes = []; let lastError;
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.dataset = {}; this.attrs = {}; this.className = ''; this.listeners = new Map(); this._text = ''; nodes.push(this);
      this.classList = { contains: v => this.className.split(' ').includes(v), add: (...v) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...v])].join(' '); }, remove: (...v) => { this.className = this.className.split(' ').filter(x => !v.includes(x)).join(' '); }, toggle: (v, on) => on ? this.classList.add(v) : this.classList.remove(v) };
      this.style.setProperty = (key, value) => { this.style[key] = value; };
    }
    set textContent(value) { this._text = String(value); this.children.forEach(node => { node.parentElement = null; }); this.children = []; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    get firstElementChild() { return this.children[0] || null; }
    get nextElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
    get isConnected() { return this === grid || this === addButton || !!this.parentElement?.isConnected; }
    append(...children) { for (const child of children) this.insertBefore(child, null); }
    insertBefore(node, anchor) { node.remove(); const index = anchor ? this.children.indexOf(anchor) : this.children.length; assert.ok(index >= 0); this.children.splice(index, 0, node); node.parentElement = this; }
    moveBefore(node, anchor) { this.insertBefore(node, anchor); }
    remove() { if (this.parentElement) { const list = this.parentElement.children; list.splice(list.indexOf(this), 1); this.parentElement = null; } }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    matches(selector) { return selector.startsWith('textarea, input') && ['TEXTAREA', 'INPUT'].includes(this.tagName); }
    querySelectorAll(selector) { return nodes.filter(node => node.isConnected && selector.includes('.widget-dragging') && (node.classList.contains('widget-dragging') || node.classList.contains('desktop-native-dragging'))); }
    querySelector() { return null; }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { const x = (parseInt(this.style.gridColumn || '1') - 1) * 112, y = (parseInt(this.style.gridRow || '1') - 1) * 132; return { x, y, left: x, top: y, right: x + 212, bottom: y + 120, width: 212, height: 120 }; }
    animate() { const animation = { node: this, canceled: false, cancel() { this.canceled = true; animations.delete(this); this.oncancel?.(); } }; animations.add(animation); return animation; }
  }
  const grid = new Node('div'); grid.clientWidth = 660; grid.getBoundingClientRect = () => ({ left: 0, top: 0, right: 660, bottom: 1200, width: 660, height: 1200 });
  const addButton = new Node('button'); addButton.id = 'widget-add';
  const document = { grid, documentElement: { lang: 'zh-CN' }, getElementById: id => nodes.find(node => node.id === id && node.isConnected), createElement: tag => new Node(tag), querySelectorAll: () => nodes.filter(node => node.isConnected && ['BUTTON', 'INPUT', 'TEXTAREA'].includes(node.tagName)) };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ document, TextEncoder, URL, Intl, Date: ClockDate, CSS: { escape: value => value }, crypto: { randomUUID: () => `id-${nodes.length}` },
    getComputedStyle: node => ({ translate: node.style.translate || 'none', columnGap: '12px', gridAutoRows: '120px' }),
    matchMedia: () => ({ matches: false }), queueMicrotask, setTimeout, clearTimeout, cancelAnimationFrame() {},
    setInterval(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearInterval(id) { timers.delete(id); },
    OpenTabI18n: { t: text => text }, OpenTabDesktop: { getContext: () => ({ groupId: 'folder-home' }), getSnapshot: () => ({ icons: [], columns: 6 }), endDrag() {}, isBlocked: () => false, adoptWidgets() {}, showError(text) { lastError = text; } },
    OpenTabWorkspace: { EPOCH_KEY: 'opentab.workspaceEpoch', async commit(before, patch, guard) { assert.equal(before.widgetWorkspace, stored.widgetWorkspace); assert.equal(guard(stored), true); stored = { ...stored, ...patch }; return stored; } }
  });
  for (const name of ['widget-model.js', 'widget-renderers.js']) vm.runInContext(fs.readFileSync(new URL(`../lib/${name}`, import.meta.url), 'utf8'), context);
  const hook = `const ready = Promise.resolve();
    g.testWidgets = { render, move, preview, beginDrag, releaseDrag, cancelDrag, cleanCard, cards, motion, shifts,
      setup(rawValue) { state = M.parse(rawValue); raw = rawValue; loaded = true; grid = document.grid; context = getContext(); settings = { open: false }; library = { open: false }; recovery = {}; undoButton = {}; render(); }
    };`;
  assert.ok(source.includes('const ready = init();'));
  vm.runInContext(source.replace('const ready = init();', hook).replace('function failure(error) {', 'function failure(error) { g.testFailure = error;'), context);
  const api = context.testWidgets; api.setup(saved);
  return { api, grid, timers, animations, stored: () => stored.widgetWorkspace, error: () => String(context.testFailure?.stack || lastError),
    tick() { now += 1000; for (const callback of timers.values()) callback(); },
    finish() { for (const animation of [...animations]) { animation.onfinish?.(); assert.equal(animation.canceled, true, 'finished drag effects release compositor state'); } assert.equal(api.motion.size, 0); }
  };
}
const widget = (id, type, x, y, data, h = 2) => ({ id, type: `builtin.${type}`, groupId: 'folder-home', x, y, w: 2, h, data });
const seed = JSON.stringify({ version: 2, definitions: [], pages: [], widgets: [
  widget('clock', 'clock', 0, 0, { timezone: 'Asia/Shanghai', hour12: false }, 1),
  widget('note', 'note', 2, 0, { text: 'Keep the note' }),
  widget('countdown', 'countdown', 4, 0, { date: '2026-12-31', label: 'Keep the date' }),
  widget('tasks', 'checklist', 0, 2, { items: [{ id: 'task', text: 'Keep the task', done: false }] }),
  widget('links', 'links', 2, 2, { links: [{ label: 'Keep the link', url: 'https://example.com/' }] })
] });
const h = runtime(seed), clock = h.api.cards.get('clock'), output = clock.children[1].children[0];
const originalCards = new Map(h.api.cards), originalData = JSON.parse(seed).widgets.map(item => item.data);
for (let turn = 0; turn < 36; turn++) {
  const before = h.stored(), patch = { x: (turn % 3) * 2, y: Math.floor(turn / 3) % 3 };
  h.api.beginDrag(); const plan = h.api.preview('w:clock', patch); assert.ok(plan);
  assert.equal(h.stored(), before, 'preview never writes');
  h.api.releaseDrag(); assert.equal(await h.api.move('w:clock', patch, null, null, plan), true, h.error()); h.finish();
  assert.equal(h.api.cards.get('clock'), clock, 'dragging retains the clock renderer and its live DOM');
  const text = output.textContent; h.tick(); assert.notEqual(output.textContent, text, 'clock continues ticking after every move');
  for (const [id, card] of originalCards) { assert.equal(h.api.cards.get(id), card); assert.equal(card.isConnected, true); assert.ok(card.children[0].textContent.length); assert.ok(card.children[1].textContent.length); }
  assert.deepEqual(JSON.parse(h.stored()).widgets.map(item => item.data), originalData);
  assert.equal(h.timers.size, 2, 'clock and countdown have exactly one interval each');
  assert.equal(h.api.shifts.size, 0); assert.equal(clock.style.translate || '', '');
}
for (const id of ['note', 'countdown', 'tasks', 'links']) {
  const position = JSON.parse(h.stored()).widgets.find(item => item.id === 'clock');
  assert.equal(await h.api.move(`w:${id}`, { x: position.x, y: position.y }), true); h.finish();
  const text = output.textContent; h.tick(); assert.notEqual(output.textContent, text, 'clock still ticks when another component displaces it');
  assert.equal(h.api.cards.get('clock'), clock); assert.equal(h.timers.size, 2);
}
const beforeCancel = h.stored(); h.api.beginDrag(); h.api.preview('w:clock', { x: 2, y: 0 }); h.api.cancelDrag(); h.finish();
assert.equal(h.stored(), beforeCancel, 'cancellation restores the complete preview');
assert.equal(await h.api.move('w:clock', { x: 6, y: 0 }), false); assert.equal(h.stored(), beforeCancel, 'boundary rejection preserves saved state');
const refreshed = runtime(h.stored()); assert.deepEqual(JSON.parse(refreshed.stored()), JSON.parse(h.stored()));
const refreshedClock = refreshed.api.cards.get('clock').children[1].children[0], text = refreshedClock.textContent; refreshed.tick(); assert.notEqual(refreshedClock.textContent, text);
for (const card of [...h.api.cards.values()]) h.api.cleanCard(card); assert.equal(h.timers.size, 0); assert.equal(h.api.motion.size, 0);
const cardRule = css.slice(css.indexOf('.desktop-grid .widget-card {'), css.indexOf('.widget-card header'));
assert.doesNotMatch(cardRule.split('::before')[0], /backdrop-filter\s*:/, 'live content is not inside a filtered animated surface');
assert.match(cardRule, /\.widget-card::before[\s\S]*backdrop-filter/, 'only the separate background surface is filtered');
console.log('Widget runtime passed: 36 clock moves, occupied displacement, live ticks, stable renderers/intervals, cancellation, boundary rejection, reload and other built-in contents.');
