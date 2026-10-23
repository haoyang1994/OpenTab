import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/search-engine-deck.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../engine-deck.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../home.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('lib/search-engine-deck.js') < html.indexOf('src="search.js"'), 'controller loads before search');
assert.match(html, /href="engine-deck\.css"/);
assert.doesNotMatch(html, /id="search-engine-trigger"/, 'there is no cloned-icon disclosure');
assert.match(html, /id="search-engine-panel" class="engine-deck-rail"/);
assert.doesNotMatch(source, /cloneNode|replaceChildren|createElement/, 'the deck never replaces or clones an engine icon');
assert.doesNotMatch(css, /grid-template-columns|position: fixed|translateY/, 'the engine rail has no separate chooser or vertical animation');
assert.match(css, /overflow-x: auto/);
assert.match(css, /max-width: calc\(100% - 88px\)/, 'the input retains bounded space');
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /transition: none !important/, 'reduced motion disables duration and delay');
for (const surface of ['--engine-front', '--engine-back', '--engine-selected']) {
  assert.equal([...css.matchAll(new RegExp(`${surface}: #[0-9a-f]{6}`, 'g'))].length, 2, `${surface} is opaque in both themes`);
}

// Exercise the actual production controller, with DOM focus/propagation and
// inert exclusion modeled explicitly. Native key activation is verified in E2E.
function harness() {
  let document;
  const listeners = new Map();
  const selectionCalls = [];
  const observers = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = { setProperty(name, value) { this[name] = value; } }; this.scrollLeft = 0;
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
    get scrollLeft() { return this._scrollLeft || 0; }
    set scrollLeft(value) { this._scrollLeft = Math.max(0, value); }
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
    removeAttribute(name) { this.attributes.delete(name); }
    getBoundingClientRect() { return this.rect; }
    getClientRects() { return this.hidden ? [] : [this.rect]; }
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
    body, activeElement: input,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); }
  };
  const window = { addEventListener: document.addEventListener, MutationObserver: class {
    constructor(callback) { observers.push(callback); }
    observe() {}
  } };
  const context = vm.createContext({ window, document }); vm.runInContext(source, context);
  deck = window.OpenTabEngineDeck.create({ host, panel, input, getLabel: (id) => labels.get(id), onOpen: () => { opens++; }, onSelect: (id) => { writes.push(id); deck.render(id); input.focus(); } });
  deck.render('google');
  const fire = (target, type, extra = {}) => { const e = event(type, extra); target.dispatchEvent(e); return e; };
  const docFire = (type, target) => { for (const fn of listeners.get(type) || []) fn(event(type, { target })); };
  return { body, host, panel, input, outside, labels, choices, writes, selectionCalls, notifyMutation: () => observers.forEach((callback) => callback()), deck, document, window, add, fire, docFire, get opens() { return opens; } };
}
function event(type, extra = {}) {
  return { type, key: '', defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}

{
  const h = harness();
  const originals = h.choices.map((button) => ({ button, glyph: button.firstChild }));
  const selected = () => h.choices.find((button) => button.getAttribute('aria-pressed') === 'true');
  assert.equal(h.panel.inert, false);
  assert.equal(h.panel.getAttribute('aria-hidden'), null);
  assert.equal(selected().getAttribute('aria-label'), 'Google');
  assert.equal(selected().getAttribute('aria-expanded'), 'false');
  assert.equal(selected().tabIndex, 0);
  assert.ok(h.choices.slice(1).every((button) => button.tabIndex === -1 && button.inert));
  assert.equal(h.choices.at(-1).getAttribute('aria-label'), h.labels.get('custom'), 'custom labels stay literal accessible names');
  h.fire(selected().firstChild, 'click');
  assert.equal(h.deck.isOpen(), true);
  assert.ok(h.choices.every((button) => !button.inert));
  assert.equal(selected().getAttribute('aria-expanded'), 'true');
  assert.equal(h.document.activeElement, h.choices[0]);
  assert.equal(h.opens, 1);
  for (const [key, index] of [['End', 5], ['ArrowRight', 0], ['ArrowLeft', 5], ['Home', 0], ['ArrowDown', 1], ['ArrowUp', 0]]) {
    assert.equal(h.fire(h.document.activeElement, 'keydown', { key }).defaultPrevented, true);
    assert.equal(h.document.activeElement, h.choices[index], `${key} moves roving focus`);
    assert.equal(h.choices.filter((button) => button.tabIndex === 0).length, 1);
  }
  for (const key of ['Tab', 'Enter', ' ']) assert.equal(h.fire(h.choices[0], 'keydown', { key }).defaultPrevented, false, `${key} stays native`);
  h.fire(h.choices.at(-1).firstChild, 'click');
  assert.deepEqual(h.writes, ['custom']);
  assert.equal(h.deck.isOpen(), false);
  assert.equal(h.host.dataset.engine, 'custom');
  assert.equal(h.input.value, 'keep my query');
  assert.deepEqual(h.selectionCalls, [[2, 6, 'backward']]);
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.choices.filter((button) => !button.inert).length, 1);
  assert.equal(selected(), h.choices.at(-1));
  assert.equal(selected().style['--engine-stack-x'], '0px');
  assert.ok(h.choices.slice(0, -1).every((button) => Number(button.style['--engine-layer']) < Number(selected().style['--engine-layer'])));
  for (let i = 0; i < originals.length; i++) {
    assert.equal(h.panel.querySelectorAll('.engine-btn')[i], originals[i].button, 'DOM order and original buttons never change');
    assert.equal(h.choices[i].firstChild, originals[i].glyph, 'original SVG/initial nodes survive selection');
  }
  h.fire(selected(), 'click');
  h.fire(selected(), 'click');
  assert.equal(h.deck.isOpen(), false, 'same selected button opens and closes');
}
{
  const h = harness();
  const selected = h.choices[0];
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Process']) {
      const e = h.fire(selected, 'keydown', { key, ...extra });
      assert.equal(e.defaultPrevented, Boolean(extra.defaultPrevented));
      assert.equal(h.deck.isOpen(), false, 'modified/IME/defaultPrevented trigger events are untouched');
    }
  }
  h.fire(selected, 'keydown', { key: 'End' });
  assert.equal(h.document.activeElement, h.choices.at(-1));
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }]) {
    const e = h.fire(h.choices.at(-1), 'keydown', { key: 'Escape', ...extra });
    assert.equal(e.defaultPrevented, Boolean(extra.defaultPrevented));
    assert.equal(h.deck.isOpen(), true);
  }
  const escape = h.fire(h.choices.at(-1), 'keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true); assert.equal(escape.stopped, true);
  assert.equal(h.document.activeElement, selected); assert.equal(h.deck.isOpen(), false);
  assert.deepEqual(h.writes, []);
}
{
  const h = harness();
  for (let index = 0; index < 8; index++) {
    h.fire(h.choices[0], 'click'); assert.equal(h.deck.isOpen(), true);
    h.fire(h.choices[0], 'click'); assert.equal(h.deck.isOpen(), false);
  }
  h.fire(h.choices[0], 'click'); h.fire(h.choices[0], 'keydown', { key: 'End' });
  const priorFocus = h.document.activeElement;
  h.docFire('pointerdown', h.outside);
  assert.equal(h.deck.isOpen(), false);
  assert.equal(h.document.activeElement, priorFocus, 'outside close does not steal focus');
  h.outside.focus(); assert.equal(h.document.activeElement, h.outside);
  h.fire(h.choices[0], 'click'); h.outside.focus();
  assert.equal(h.deck.isOpen(), false, 'native Tab out closes without trapping');
  assert.equal(h.document.activeElement, h.outside);
  h.fire(h.choices[0], 'click'); h.input.value = 'new query'; h.fire(h.choices[1], 'click');
  assert.equal(h.selectionCalls.length, 8, 'only unchanged-query selections restore the original range');
  h.fire(h.choices[1], 'click'); h.deck.close();
  h.fire(h.host, 'transitionend');
  assert.equal(h.deck.isOpen(), false, 'stale transition events cannot reopen the deck');
}
{
  const h = harness();
  const originals = h.choices.map((button) => button.firstChild);
  h.deck.render('github');
  assert.equal(h.host.dataset.engine, 'github');
  assert.equal(h.choices[4].getAttribute('aria-expanded'), 'false');
  assert.equal(h.choices[0].getAttribute('aria-expanded'), null);
  assert.equal(h.choices[4].tabIndex, 0, 'programmatic/Alt selection updates the collapsed disclosure');
  assert.equal(h.host.style['--engine-rail-width'], '268px');
  h.fire(h.choices[4], 'click');
  h.panel.rect = { left: 20, right: 220 };
  h.choices.at(-1).rect = { left: 240, right: 280 };
  h.fire(h.choices[4], 'keydown', { key: 'End' });
  assert.equal(h.panel.scrollLeft, 62, 'keyboard reveals a clipped engine inside the horizontal rail');
  h.panel.scrollLeft = 120;
  h.deck.close({ restoreFocus: true });
  assert.equal(h.panel.scrollLeft, 0, 'collapse restores the original stack anchor');
  assert.equal(h.document.activeElement, h.choices[4]);
  h.choices.forEach((button, index) => assert.equal(button.firstChild, originals[index]));
  const added = h.add('later'); h.labels.set('later', 'Later');
  h.deck.render('later');
  assert.equal(added.tabIndex, 0, 'new custom engines can become the real collapsed disclosure');
  assert.equal(h.host.style['--engine-rail-width'], '312px');
}
{
  const h = harness();
  h.fire(h.panel, 'click');
  assert.equal(h.deck.isOpen(), true, 'clicking a visible back edge opens the same stack');
  h.deck.close();
  for (const mode of ['minimal-mode', 'zen-mode']) {
    h.fire(h.choices[0], 'click');
    assert.equal(h.deck.isOpen(), true);
    h.body.classList.add(mode); h.notifyMutation();
    assert.equal(h.deck.isOpen(), false, `${mode} entry dismisses the deck`);
    h.body.classList.remove(mode); h.notifyMutation();
    assert.equal(h.deck.isOpen(), false, `${mode} exit cannot reopen a stale rail`);
  }
}
console.log('Search-engine deck unit tests passed: original node identity, inline stack/rail state, focus, keys, selection, literal labels and interrupted transitions.');
