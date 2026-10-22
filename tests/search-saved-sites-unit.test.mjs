import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../search.js', import.meta.url), 'utf8');

// Small DOM/event harness runs the whole production module, including callbacks,
// rendering and keyboard/pointer activation, without browser sockets or packages.
function harness({ icons = [], folders = [], settings = {}, legacy = false, omitFolders = false } = {}) {
  const handlers = new Map();
  const timers = [];
  const navigations = [];
  const matched = [];
  const writes = [];
  const state = { icons, folders };
  let document;
  class Element {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.value = '';
      this.dataset = {};
      this.attributes = new Map();
      this.children = [];
      this.listeners = new Map();
      this.className = '';
      this._text = '';
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (name) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
        remove: (name) => { this.className = this.className.split(/\s+/).filter((x) => x !== name).join(' '); },
        toggle: (name, on) => { this.classList[on ? 'add' : 'remove'](name); }
      };
    }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(value) {
      assert.equal(value, '', 'user content must never become HTML');
      this.replaceChildren();
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    replaceChildren() { this.children.forEach((child) => { child.parentElement = null; }); this.children = []; this._text = ''; }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    dispatchEvent(event) {
      event.target ||= this;
      for (const fn of this.listeners.get(event.type) || []) fn(event);
      return !event.defaultPrevented;
    }
    focus() {
      if (document.activeElement === this) return;
      document.activeElement = this;
      this.dispatchEvent(event('focus'));
    }
    blur() { document.activeElement = document.body; this.dispatchEvent(event('blur')); }
    scrollIntoView(options) { assert.equal(options.block, 'nearest'); }
    closest() { return null; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  const body = new Element('body');
  const input = body.appendChild(new Element('input', 'search-input'));
  const list = body.appendChild(new Element('div', 'search-history'));
  list.className = 'search-history hidden';
  body.appendChild(new Element('div', 'search-hint'));
  const historyToggle = body.appendChild(new Element('input', 'search-history-enabled'));
  const clearHistory = body.appendChild(new Element('button', 'search-history-clear'));
  function descendants(root) { return root.children.flatMap((child) => [child, ...descendants(child)]); }
  document = {
    body, documentElement: body, activeElement: body,
    getElementById: (id) => descendants(body).find((node) => node.id === id) || null,
    querySelectorAll: () => [], querySelector: () => null,
    createElement: (tag) => new Element(tag),
    addEventListener(name, fn) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
    }
  };
  const context = vm.createContext({ document, URL, Event: class { constructor(type) { Object.assign(this, event(type)); } } });
  const chrome = { storage: { local: {
    get(keys, callback) { callback(settings); },
    set(value) { writes.push(JSON.parse(JSON.stringify(value))); }
  } } };
  Object.assign(context, { chrome, window: {
    chrome, clearTimeout() {}, setTimeout(fn) { timers.push(fn); return timers.length; },
    open() { assert.fail('navigation must use the hook'); },
    location: { assign() { assert.fail('navigation must use the hook'); } }
  } });
  vm.runInContext(source, context);
  const api = context.window.OpenTabSearch;
  api.navigateHook = (url, newTab) => navigations.push({ url, newTab });
  const options = legacy ? { getIcons: () => state.icons } : { getState: () => state };
  if (legacy && !omitFolders) options.getFolders = () => state.folders;
  options.openMatchedIcon = (icon) => matched.push(icon);
  api.init(options);
  const type = (value) => { input.focus(); input.value = value; input.dispatchEvent(event('input')); };
  const press = (key, extra = {}) => { const e = event('keydown', { key, ...extra }); input.dispatchEvent(e); return e; };
  const sites = () => descendants(list).filter((node) => node.classList.contains('search-site-item'));
  const history = () => descendants(list).filter((node) => node.classList.contains('search-history-item'));
  const click = (node, extra = {}) => { node.dispatchEvent(event('click', extra)); };
  return { state, api, input, list, type, press, sites, history, click, navigations, matched, writes,
    historyToggle, clearHistory, flushTimers: () => timers.splice(0).forEach((fn) => fn()), document };
}

function event(type, extra = {}) {
  return { type, key: '', button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...extra };
}
function site(id, name, url = `https://${id}.example/`, extra = {}) {
  return { id, name, url, type: 'shortcut', folderId: 'folder-home', parentId: '', ...extra };
}
function ids(h) { return h.sites().map((node) => node.dataset.siteId); }

{
  const icons = [
    site('domain', 'Other', 'https://git.example/path'),
    site('contains', 'My Git workspace'),
    site('prefix', 'Git docs'),
    site('exact', 'GIT'),
    site('prefix-two', 'Git hosting'),
    site('contains-two', 'Read git now')
  ];
  const h = harness({ icons });
  h.type(' GiT ');
  assert.deepEqual(ids(h), ['exact', 'prefix', 'prefix-two', 'contains', 'contains-two'], 'rank exact, prefix, contains before domain and cap at five');
  assert.equal(h.input.getAttribute('aria-expanded'), 'true');
  assert.equal(h.input.getAttribute('aria-activedescendant'), null, 'typing never implicitly selects a site');
  assert.ok(h.sites().every((node) => node.getAttribute('aria-selected') === 'false' && node.tabIndex === -1));
  h.state.icons = icons.slice(0, 4);
  h.type('git');
  assert.deepEqual(ids(h), ['exact', 'prefix', 'contains', 'domain'], 'same-rank results remain in workspace order');
  h.type('gIt.ExAmPlE');
  assert.deepEqual(ids(h), ['domain'], 'domains match case-insensitively');
  h.type('');
  assert.equal(h.sites().length, 0, 'empty query never lists sites');
  assert.equal(h.input.getAttribute('aria-expanded'), 'false');
}

{
  const h = harness({
    folders: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: 'Work' }],
    icons: [
      site('one', 'Docs', 'https://one.example/', { folderId: 'work', parentId: 'inner' }),
      { id: 'inner', name: 'Reference', type: 'folder', folderId: 'work', parentId: 'outer' },
      { id: 'outer', name: 'Engineering', type: 'folder', folderId: 'work' },
      site('two', 'Docs', 'https://two.example/'),
      site('legacy', 'Legacy Docs', 'http://localhost:3000/', { type: undefined })
    ]
  });
  h.type('doc');
  assert.deepEqual(ids(h), ['one', 'two', 'legacy'], 'same-name sites with distinct URLs remain separate across all groups and folders');
  assert.match(h.sites()[0].textContent, /one\.example · Work \/ Engineering \/ Reference/);
  assert.match(h.sites()[1].textContent, /two\.example · Home/);
  assert.match(h.sites()[2].textContent, /localhost:3000/);
  h.state.folders[1].name = 'Renamed group';
  h.type('doc');
  assert.match(h.sites()[0].textContent, /Renamed group/);
  h.state.icons.push(site('three', 'Docs', 'https://two.example/', { parentId: 'missing-parent' }));
  h.type('doc');
  assert.deepEqual(ids(h), ['one', 'two', 'three', 'legacy'], 'same-URL records remain distinct and missing parent references stay safe');
  h.state.icons.find((icon) => icon.id === 'outer').parentId = 'inner';
  h.type('doc');
  assert.equal(h.sites().length, 4, 'malformed cyclic folders cannot hang matching');
}

{
  const bad = ['javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/test', 'chrome://settings', 'chrome-extension://id/tool.html', '//example.com', 'https://', 'https://user:secret@example.com/'];
  const h = harness({ icons: [null, {}, ...bad.map((url, i) => site(`bad-${i}`, 'Match', url)),
    { id: 'folder', name: 'Match folder', type: 'folder' },
    site('tool', 'Match tool', 'https://valid.example/', { type: 'tool' }),
    site('safe', 'Match safe', 'HTTPS://safe.example/')] });
  h.type('mat');
  assert.deepEqual(ids(h), ['safe'], 'only ordinary HTTP(S) shortcuts enter partial matches');
  const payload = '<img src=x onerror=alert(1)>';
  h.state.icons = [site('xss', payload, 'https://safe.example/')];
  h.type('<img');
  assert.equal(h.sites()[0].children[0].textContent, payload, 'title remains literal text');
  assert.equal(h.sites()[0].children[0].children.length, 0);
}

{
  const h = harness({ icons: [site('docs', 'Docs'), { id: 'folder', name: 'Folder', type: 'folder' }, { id: 'tool', name: 'JSON', type: 'tool' }] });
  h.type('Doc'); h.press('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://www.google.com/search?q=Doc', 'partial suggestion does not hijack Enter');
  h.type('Docs'); h.press('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://docs.example/', 'unselected exact shortcut contract is unchanged');
  h.type('Folder'); h.press('Enter');
  h.type('JSON'); h.press('Enter');
  assert.deepEqual(h.matched.map((item) => item.id), ['folder', 'tool'], 'exact folders/tools still use existing matched-icon callback');
  h.type('example.com'); h.press('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://example.com');
  h.type('localhost:3000'); h.press('Enter');
  assert.equal(h.navigations.at(-1).url, 'http://localhost:3000');
  h.type('no saved match');
  assert.equal(h.list.classList.contains('hidden'), true);
  h.press('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://www.google.com/search?q=no%20saved%20match');
}

{
  const h = harness({ icons: [site('first', 'Docs one'), site('second', 'Docs two')], settings: {
    searchHistory: [{ q: 'docs query', engine: 'bing', at: 1 }]
  } });
  h.type('doc');
  assert.deepEqual(h.list.children.map((node) => node.dataset.kind), ['sites', 'history']);
  assert.equal(h.history().length, 1);
  assert.equal(h.press('ArrowDown').defaultPrevented, true);
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.sites()[0].id);
  assert.equal(h.sites()[0].getAttribute('aria-selected'), 'true');
  h.press('ArrowDown');
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.sites()[1].id);
  h.press('ArrowDown');
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.history()[0].id, 'arrows cross group boundary');
  h.press('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://www.bing.com/search?q=docs%20query');
  assert.equal(h.input.getAttribute('aria-expanded'), 'false');
  assert.equal(h.input.getAttribute('aria-activedescendant'), null);
  h.type('doc');
  h.press('ArrowUp');
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.history()[0].id, 'initial Up selects the last option');
  h.press('ArrowDown');
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.sites()[0].id, 'last wraps to first');
  h.press('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://first.example/');
  assert.equal(h.api.getState().searchHistory.some((item) => item.q === 'Docs one'), false, 'site activation is not a web query history item');
  h.type('doc'); h.press('ArrowDown'); h.type('docs');
  assert.equal(h.input.getAttribute('aria-activedescendant'), null, 'editing resets explicit selection');
}

{
  const h = harness({ icons: [site('first', 'Docs one'), site('second', 'Docs two')], settings: {
    searchHistoryEnabled: false, searchHistory: [{ q: 'docs query', engine: 'google' }]
  } });
  h.type('doc');
  assert.equal(h.history().length, 0);
  assert.equal(h.sites().length, 2, 'history opt-out does not disable saved sites');
  assert.equal(h.press('ArrowDown').defaultPrevented, true);
  h.press('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://first.example/');
  assert.equal(h.writes.length, 0, 'local matching and site activation need no persisted index or history write');
  h.type('doc');
  h.historyToggle.checked = true; h.historyToggle.dispatchEvent(event('change'));
  assert.equal(h.history().length, 1);
  h.historyToggle.checked = false; h.historyToggle.dispatchEvent(event('change'));
  assert.equal(h.sites().length, 2); assert.equal(h.history().length, 0);
  h.clearHistory.dispatchEvent(event('click'));
  assert.equal(h.sites().length, 2, 'clearing query history keeps saved sites');
  h.type('');
  assert.equal(h.input.getAttribute('aria-expanded'), 'false');
  assert.equal(h.press('ArrowDown').defaultPrevented, false);
}

for (const modifier of ['ctrlKey', 'metaKey']) {
  const h = harness({ icons: [site('one', 'Docs')] });
  h.type('doc'); h.press('ArrowDown'); h.press('Enter', { [modifier]: true });
  assert.deepEqual(h.navigations.at(-1), { url: 'https://one.example/', newTab: true });
  h.type('doc'); h.click(h.sites()[0], { [modifier]: true });
  assert.deepEqual(h.navigations.at(-1), { url: 'https://one.example/', newTab: true });
}
{
  const h = harness({ icons: [site('one', 'Docs')] });
  h.type('doc'); h.click(h.sites()[0]);
  assert.deepEqual(h.navigations.at(-1), { url: 'https://one.example/', newTab: false });
  h.type('doc');
  const middle = event('auxclick', { button: 1 });
  h.sites()[0].dispatchEvent(middle);
  assert.equal(middle.defaultPrevented, true);
  assert.deepEqual(h.navigations.at(-1), { url: 'https://one.example/', newTab: true });
  h.type('doc');
  const count = h.navigations.length;
  h.sites()[0].dispatchEvent(event('auxclick', { button: 2 }));
  assert.equal(h.navigations.length, count, 'right click does not activate a result');
}
{
  const h = harness({ icons: [site('one', 'Docs')], settings: { searchOpenInNewTab: true } });
  h.type('doc'); h.click(h.sites()[0]);
  assert.deepEqual(h.navigations.at(-1), { url: 'https://one.example/', newTab: true }, 'saved site honors existing new-tab preference');
}

for (const mutate of [
  (state) => { state.icons = []; },
  (state) => { state.icons[0].name = 'Docs renamed'; },
  (state) => { state.icons[0].url = 'https://changed.example/'; },
  (state) => { state.icons[0].url = 'javascript:alert(1)'; },
  (state) => { state.icons[0].type = 'tool'; },
  (state) => { state.icons[0].folderId = 'elsewhere'; },
  (state) => { state.icons = [site('replacement', 'Docs', 'https://replacement.example/')]; }
]) {
  for (const pointer of [false, true]) {
    const h = harness({ icons: [site('one', 'Docs'), site('second', 'Docs second')] });
    h.type('doc'); h.press('ArrowDown');
    const oldButton = h.sites()[0];
    mutate(h.state);
    if (pointer) h.click(oldButton); else h.press('Enter');
    assert.equal(h.navigations.length, 0, 'stale snapshot never opens a deleted/renamed/changed/replaced target');
    assert.equal(h.input.getAttribute('aria-activedescendant'), null, 'stale activation clears selection and refreshes options');
  }
}
{
  const h = harness({ icons: [site('one', 'Docs')] });
  h.type('doc'); h.press('ArrowDown');
  h.input.value = 'different'; // programmatic update without an input event
  h.press('Enter');
  assert.equal(h.navigations.length, 0, 'selection belongs to the query that displayed it');
  h.type('doc');
  h.state.icons = [site('one', 'Docs')];
  h.click(h.sites()[0]);
  assert.equal(h.navigations.length, 1, 'equivalent fresh records with the same ID remain valid after workspace replacement');
}

{
  const h = harness({ icons: [site('one', 'Docs')] });
  h.type('doc'); h.press('ArrowDown');
  for (const extra of [{}, { shiftKey: true }]) {
    assert.equal(h.press('Tab', extra).defaultPrevented, false, 'native Tab navigation stays untouched');
  }
  const active = h.input.getAttribute('aria-activedescendant');
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }]) {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      assert.equal(h.press(key, extra).defaultPrevented, false, 'IME owns composition keys');
      assert.equal(h.input.getAttribute('aria-activedescendant'), active);
    }
  }
  for (const key of ['ArrowDown', 'ArrowUp']) {
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
      assert.equal(h.press(key, { [modifier]: true }).defaultPrevented, false);
    }
  }
  assert.equal(h.navigations.length, 0);
  assert.equal(h.press('ArrowDown', { altKey: true }).defaultPrevented, true);
  assert.equal(h.api.getState().searchEngine, 'bing', 'Alt arrows remain engine shortcuts');
  const escape = h.press('Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.stopped, true, 'dropdown Escape never closes a page-level panel');
  assert.equal(h.input.value, 'doc');
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.input.getAttribute('aria-expanded'), 'false');
  assert.equal(h.input.getAttribute('aria-activedescendant'), null);
  assert.equal(h.press('Escape').defaultPrevented, false, 'second Escape is available to the page');
  h.press('ArrowDown');
  assert.equal(h.input.getAttribute('aria-expanded'), 'true', 'Down can reopen dismissed options');
  h.input.blur(); h.flushTimers();
  assert.equal(h.input.getAttribute('aria-expanded'), 'false', 'blur closes dropdown and clears ARIA');
}

{
  const h = harness({ legacy: true, omitFolders: true, icons: [site('one', 'Docs')] });
  h.type('doc');
  assert.match(h.sites()[0].textContent, /主页/, 'getIcons-only callers have a safe location fallback');
  h.state.icons = [site('two', 'Docs fresh')]; h.type('doc');
  assert.deepEqual(ids(h), ['two'], 'legacy callback stays live');
  h.api.init({ getState: () => null }); h.type('doc');
  assert.equal(h.sites().length, 0, 'missing workspace state has a safe empty fallback');
}

console.log('Saved-site search unit tests passed: ranking, safety, live workspace, navigation, history, ARIA and IME.');
