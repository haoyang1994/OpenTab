import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/search-engine-deck.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../engine-deck.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../home.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('lib/search-engine-deck.js') < html.indexOf('src="search.js"'), 'controller loads before search');
assert.match(html, /href="engine-deck\.css"/);
assert.match(html, /id="search-engine-trigger"[^>]*type="button"[^>]*aria-expanded="false"[^>]*aria-controls="search-engine-panel"/);
assert.match(html, /id="search-engine-panel"[^>]*aria-hidden="true" inert/);
assert.match(css, /visibility: hidden/);
assert.match(css, /visibility 0s 260ms/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /\.engine-deck-panel, \.engine-deck-open \.engine-deck-panel \{ transition: none; \}/);
assert.match(css, /body:not\(\.minimal-mode\) #search-widget-wrap:has\(\.engine-deck-open\) \{ z-index: 1265; \}/);
for (const surface of ['--engine-surface', '--engine-front', '--engine-back', '--engine-selected']) {
  assert.equal([...css.matchAll(new RegExp(`${surface}: #[0-9a-f]{6}`, 'g'))].length, 2, `${surface} is opaque in both themes`);
}

// Exercise the actual production controller, with DOM focus/propagation and
// inert exclusion modeled explicitly. Native key activation is verified in E2E.
function harness() {
  let document;
  const listeners = new Map();
  const selectionCalls = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {};
      this.className = ''; this._text = ''; this.tabIndex = 0; this.inert = false;
      this.offsetWidth = 276; this.scrollHeight = 310;
      this.rect = { left: 16, top: 90, bottom: 134 };
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (name) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
        remove: (name) => { this.className = this.className.split(/\s+/).filter((item) => item !== name).join(' '); },
        toggle: (name, yes) => this.classList[yes ? 'add' : 'remove'](name)
      };
    }
    get firstChild() { return this.children[0] || null; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    appendChild(child) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
      this.children.push(child); child.parentElement = this; return child;
    }
    replaceChildren(...children) {
      this.children.forEach((child) => { child.parentElement = null; });
      this.children = []; this._text = ''; children.forEach((child) => this.appendChild(child));
    }
    cloneNode(deep) {
      const clone = new Element(this.tagName); clone._text = this._text; clone.className = this.className;
      clone.attributes = new Map(this.attributes); clone.dataset = { ...this.dataset };
      if (deep) this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
      return clone;
    }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.classList.contains(selector.slice(1)) ? this : this.parentElement?.closest(selector) || null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    getBoundingClientRect() { return this.rect; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(event) {
      event.target ||= this;
      for (const fn of this.listeners.get(event.type) || []) fn(event);
      if (!event.stopped && event.bubbles !== false) this.parentElement?.dispatchEvent(event);
      return !event.defaultPrevented;
    }
    focus() {
      for (let node = this; node; node = node.parentElement) assert.equal(node.inert, false, 'cannot focus inert descendants');
      document.activeElement = this;
      for (const fn of listeners.get('focusin') || []) fn(event('focusin', { target: this }));
    }
    scrollIntoView(options) { assert.equal(options.block, 'nearest'); }
    setSelectionRange(start, end, direction) {
      this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
      selectionCalls.push([start, end, direction]);
    }
  }
  // Querying descendants is separate from matching, just like native DOM.
  Element.prototype.querySelectorAll = function (selector) {
    assert.ok(selector.startsWith('.') || selector === '*', `explicit fixture selector: ${selector}`);
    const nodes = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? nodes : nodes.filter((node) => node.classList.contains(selector.slice(1)));
  };
  const body = new Element(); const host = body.appendChild(new Element());
  host.setAttribute('aria-label', 'Search engines');
  const trigger = host.appendChild(new Element('button'));
  const icon = trigger.appendChild(new Element('span')); icon.className = 'engine-deck-icon';
  const panel = host.appendChild(new Element());
  const custom = panel.appendChild(new Element());
  const input = body.appendChild(new Element('input'));
  input.value = 'keep my query'; input.selectionStart = 2; input.selectionEnd = 6; input.selectionDirection = 'backward';
  const outside = body.appendChild(new Element('button'));
  const labels = new Map([['google', 'Google'], ['bing', 'Bing'], ['baidu', 'Baidu'], ['duckduckgo', 'DuckDuckGo'], ['github', 'GitHub'], ['custom', '<img src=x onerror=alert(1)>']]);
  function add(id, parent = panel) {
    const button = parent.appendChild(new Element('button')); button.className = 'engine-btn'; button.dataset.engine = id;
    const glyph = button.appendChild(new Element(id === 'custom' ? 'span' : 'svg')); glyph.textContent = id[0];
    return button;
  }
  const choices = [...labels.keys()].map((id) => add(id, id === 'custom' ? custom : panel));
  // The custom host follows built-in buttons in the real markup.
  panel.appendChild(custom);
  const writes = []; let opens = 0; let deck;
  document = {
    activeElement: input, createElement: (tag) => new Element(tag),
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); }
  };
  const window = { innerHeight: 720, innerWidth: 1024, addEventListener: document.addEventListener };
  const context = vm.createContext({ window, document }); vm.runInContext(source, context);
  deck = window.OpenTabEngineDeck.create({ host, trigger, panel, input, getLabel: (id) => labels.get(id), onOpen: () => { opens++; }, onSelect: (id) => { writes.push(id); deck.render(id); input.focus(); } });
  deck.render('google');
  const fire = (target, type, extra = {}) => { const e = event(type, extra); target.dispatchEvent(e); return e; };
  const docFire = (type, target) => { for (const fn of listeners.get(type) || []) fn(event(type, { target })); };
  return { body, host, trigger, panel, input, outside, labels, choices, writes, selectionCalls, deck, document, window, add, fire, docFire, get opens() { return opens; } };
}
function event(type, extra = {}) {
  return { type, key: '', defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}

{
  const h = harness();
  assert.equal(h.panel.inert, true);
  assert.equal(h.panel.getAttribute('aria-hidden'), 'true');
  assert.equal(h.trigger.getAttribute('aria-label'), 'Search engines: Google');
  assert.ok(h.choices.every((button) => button.tabIndex === -1));
  assert.equal(h.choices.at(-1).querySelector('.engine-option-name').textContent, h.labels.get('custom'), 'custom names remain literal text');
  h.fire(h.trigger, 'click');
  assert.equal(h.deck.isOpen(), true);
  assert.equal(h.panel.inert, false);
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(h.document.activeElement, h.choices[0]);
  assert.equal(h.opens, 1);
  for (const [key, index] of [['End', 5], ['ArrowRight', 0], ['ArrowLeft', 5], ['Home', 0], ['ArrowDown', 1], ['ArrowUp', 0]]) {
    assert.equal(h.fire(h.document.activeElement, 'keydown', { key }).defaultPrevented, true);
    assert.equal(h.document.activeElement, h.choices[index], `${key} moves roving focus`);
    assert.equal(h.choices.filter((button) => button.tabIndex === 0).length, 1);
  }
  for (const key of ['Tab', 'Enter', ' ']) assert.equal(h.fire(h.choices[0], 'keydown', { key }).defaultPrevented, false, `${key} stays native`);
  const last = h.choices.at(-1);
  h.fire(last.querySelector('.engine-option-name'), 'click');
  assert.deepEqual(h.writes, ['custom']);
  assert.equal(h.deck.isOpen(), false);
  assert.equal(h.trigger.dataset.engine, 'custom');
  assert.equal(h.input.value, 'keep my query');
  assert.deepEqual(h.selectionCalls, [[2, 6, 'backward']]);
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.panel.inert, true);
  assert.ok(h.choices.every((button) => button.tabIndex === -1));
  assert.equal(h.choices.filter((button) => button.getAttribute('aria-pressed') === 'true').length, 1);
}
{
  const h = harness();
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      const e = h.fire(h.trigger, 'keydown', { key, ...extra });
      assert.equal(e.defaultPrevented, Boolean(extra.defaultPrevented));
      assert.equal(h.deck.isOpen(), false, 'modified/IME/defaultPrevented trigger events are untouched');
    }
  }
  h.fire(h.trigger, 'keydown', { key: 'End' });
  assert.equal(h.document.activeElement, h.choices.at(-1));
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }]) {
    const e = h.fire(h.choices.at(-1), 'keydown', { key: 'Escape', ...extra });
    assert.equal(e.defaultPrevented, Boolean(extra.defaultPrevented));
    assert.equal(h.deck.isOpen(), true);
  }
  const escape = h.fire(h.choices.at(-1), 'keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true); assert.equal(escape.stopped, true);
  assert.equal(h.document.activeElement, h.trigger); assert.equal(h.deck.isOpen(), false);
  assert.deepEqual(h.writes, []);
}
{
  const h = harness();
  for (let index = 0; index < 8; index++) {
    h.fire(h.trigger, 'click'); assert.equal(h.deck.isOpen(), true);
    h.fire(h.trigger, 'click'); assert.equal(h.deck.isOpen(), false);
  }
  h.fire(h.trigger, 'click');
  h.docFire('pointerdown', h.outside);
  assert.equal(h.deck.isOpen(), false);
  assert.notEqual(h.document.activeElement, h.trigger, 'outside close does not restore focus');
  h.outside.focus(); assert.equal(h.document.activeElement, h.outside);
  h.fire(h.trigger, 'click'); h.outside.focus();
  assert.equal(h.deck.isOpen(), false, 'native Tab out closes without trapping');
  assert.equal(h.document.activeElement, h.outside);
  h.fire(h.trigger, 'click'); h.input.value = 'new query'; h.fire(h.choices[1], 'click');
  assert.deepEqual(h.selectionCalls, [], 'a stale captured range cannot overwrite a newer query selection');
}
{
  const h = harness();
  h.host.rect = { left: 90, top: 280, bottom: 324 }; h.window.innerHeight = 360; h.window.innerWidth = 320;
  h.fire(h.trigger, 'click');
  assert.equal(h.panel.dataset.placement, 'above');
  assert.equal(h.panel.style.maxHeight, '264px');
  assert.equal(h.panel.style.marginLeft, '-58px');
  const expectedOrder = h.choices.map((button) => button.dataset.engine);
  h.deck.render('github');
  assert.deepEqual(h.panel.querySelectorAll('.engine-btn').map((button) => button.dataset.engine), expectedOrder, 'selection never reorders engines');
  h.window.innerHeight = 900; h.deck.render('google');
  assert.equal(h.panel.dataset.placement, 'below');
  assert.equal(h.panel.style.maxHeight, '400px');
  h.window.visualViewport = { offsetTop: 30, offsetLeft: 0, width: 320, height: 330 };
  h.deck.render('google');
  assert.equal(h.panel.style.maxHeight, '234px', 'visual viewport keyboard constraints are respected');
}
console.log('Search-engine deck unit tests passed: state, focus, keys, selection, custom labels, repeat interruption, viewport and reduced-motion contracts.');
