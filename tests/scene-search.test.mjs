import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const flushAsync = () => new Promise(setImmediate);
const source = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const site = (id, name, extra = {}) => ({ id, name, url: `https://${id}.example/`, type: 'shortcut', folderId: 'home', parentId: '', ...extra });
function event(type, extra = {}) {
  return { type, key: '', button: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, stopped: false, immediate: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; this.immediate = true; }, ...extra };
}

// Execute both production modules in a small DOM. The tests below use the
// full schema-2 state, including inactive scenes, never prefiltered fixtures.
function harness({ platform = 'Linux', icons = [site('docs', 'Docs')], folders = [{ id: 'home', name: 'Home' }], developer = false, ...sceneState } = {}) {
  let document;
  const docHandlers = new Map();
  const state = { icons, folders, ...sceneState };
  const navigations = [], actions = [], groups = [], writes = [], timers = [], matched = [];
  const observers = [];
  const scrollRequests = [];
  const descendant = (node) => node.children.flatMap((child) => [child, ...descendant(child)]);
  function matches(node, selector) {
    if (selector.includes(',')) return selector.split(',').some((part) => matches(node, part.trim()));
    const not = selector.match(/:not\((.*?)\)$/);
    if (not) return matches(node, selector.slice(0, not.index)) && !matches(node, not[1]);
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    if (selector.startsWith('[')) {
      const [, key, value] = selector.match(/^\[([^=\]]+)(?:="?([^"\]]*)"?)?\]$/) || [];
      if (!key) return false;
      const actual = key.startsWith('data-') ? node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : node.getAttribute(key);
      if (key === 'hidden' && node.hidden || key === 'inert' && node.inert) return true;
      return actual != null && (value === undefined || actual === value);
    }
    if (selector.includes('[')) { const bracket = selector.indexOf('['); return matches(node, selector.slice(0, bracket)) && matches(node, selector.slice(bracket)); }
    return node.tagName.toLowerCase() === selector.toLowerCase();
  }
  class Element {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.attributes = new Map();
      this.listeners = new Map(); this.dataset = {}; this.className = ''; this.value = ''; this._text = '';
      this.tabIndex = /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(this.tagName) ? 0 : -1;
      this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = 'none';
      this.inert = false; this.disabled = false; this.hidden = false;
      this.classList = {
        contains: (value) => this.className.split(/\s+/).includes(value),
        add: (value) => { if (!this.classList.contains(value)) this.className += ` ${value}`; },
        remove: (value) => { this.className = this.className.split(/\s+/).filter((part) => part !== value).join(' '); },
        toggle: (value, on) => { this.classList[on ? 'add' : 'remove'](value); }
      };
    }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set innerHTML(value) { assert.equal(value, '', 'never interpolate content into HTML'); this.replaceChildren(); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); if (key === 'tabindex') this.tabIndex = Number(value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    replaceChildren() { this.children.forEach((node) => { node.parentElement = null; }); this.children = []; }
    contains(node) { return node === this || descendant(this).includes(node); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    querySelectorAll(selector) { return descendant(this).filter((node) => matches(node, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getClientRects() { return this.hidden || this.display === 'none' || this.closest('.hidden') ? [] : [{}]; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    dispatchEvent(e) { e.target ||= this; for (const fn of this.listeners.get(e.type) || []) { fn(e); if (e.immediate) break; } return !e.defaultPrevented; }
    focus() {
      if (document.activeElement === this) return;
      const old = document.activeElement;
      document.activeElement = this;
      old?.dispatchEvent(event('blur', { relatedTarget: this }));
      this.dispatchEvent(event('focus'));
      dispatchDocument(event('focusin', { target: this }));
    }
    blur() { document.activeElement = document.body; this.dispatchEvent(event('blur')); }
    setSelectionRange(start, end, direction = 'none') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
    scrollIntoView(options) { assert.equal(options.block, 'nearest'); scrollRequests.push({ node: this, options }); }
  }
  const body = new Element('body');
  const main = body.appendChild(new Element('main', 'content'));
  const input = main.appendChild(new Element('input', 'search-input'));
  const opener = main.appendChild(new Element('button', 'opener'));
  const unrelated = main.appendChild(new Element('textarea', 'draft'));
  main.appendChild(new Element('kbd', 'search-shortcut-hint'));
  const history = main.appendChild(new Element('div', 'search-history')); history.className = 'hidden';
  main.appendChild(new Element('div', 'search-hint'));
  const preInert = body.appendChild(new Element('aside', 'already-inert')); preInert.inert = true; preInert.setAttribute('inert', 'original');
  const palette = body.appendChild(new Element('div', 'command-palette')); palette.className = 'hidden';
  const dialog = palette.appendChild(new Element('div', 'dialog')); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  const paletteInput = dialog.appendChild(new Element('input', 'command-palette-input'));
  const close = dialog.appendChild(new Element('button', 'command-palette-close'));
  const filters = ['all', 'sites', 'groups', 'actions'].map((value) => {
    const button = dialog.appendChild(new Element('button')); button.dataset.paletteFilter = value; return button;
  });
  const scroller = dialog.appendChild(new Element('div')); scroller.className = 'command-palette-scroll'; scroller.scrollTop = 0;
  const list = scroller.appendChild(new Element('div', 'command-palette-results'));
  const empty = scroller.appendChild(new Element('div', 'command-palette-empty'));
  empty.appendChild(new Element('p')).textContent = 'No matches'; empty.appendChild(new Element('span')).textContent = 'Try another keyword';
  const status = dialog.appendChild(new Element('div', 'command-palette-status'));
  document = {
    body, documentElement: body, activeElement: body, readyState: 'complete',
    contains: (node) => body.contains(node), getElementById: (id) => descendant(body).find((node) => node.id === id) || null,
    createElement: (tag) => new Element(tag), querySelectorAll: (selector) => body.querySelectorAll(selector), querySelector: (selector) => body.querySelector(selector),
    addEventListener(type, fn) { if (!docHandlers.has(type)) docHandlers.set(type, []); docHandlers.get(type).push(fn); }
  };
  function dispatchDocument(e) {
    for (const fn of docHandlers.get(e.type) || []) { fn(e); if (e.immediate) break; }
    if (!e.stopped) e.target?.dispatchEvent(e);
    return e;
  }
  const window = {
    document, navigator: { userAgentData: { platform } },
    getComputedStyle: (node) => ({ display: node.display || 'block', visibility: node.visibility || 'visible' }),
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    MutationObserver: class { constructor(fn) { this.fn = fn; this.active = false; observers.push(this); } observe() { this.active = true; } disconnect() { this.active = false; } },
    OpenTabSettingsNav: { openSection: (id) => { actions.push(id); return true; }, isDeveloperToolsEnabled: () => developer },
    OpenTabFolders: { selectGroup: (id) => { groups.push(id); return true; } }
  };
  const chrome = { storage: { local: { get(keys, callback) { callback({ searchHistoryEnabled: false }); }, set(value) { writes.push(value); } } } };
  window.chrome = chrome;
  const context = vm.createContext({ window, document, chrome, URL, Event: class { constructor(type) { Object.assign(this, event(type)); } } });
  vm.runInContext(source('search.js'), context);
  // In production, the palette script binds before home.js initializes search.
  vm.runInContext(source('command-palette.js'), context);
  window.OpenTabSearch.init({ getState: () => state, openMatchedIcon: (icon) => matched.push(icon) });
  window.OpenTabSearch.navigateHook = (url, newTab) => navigations.push({ url, newTab });
  window.OpenTabCommandPalette.init({ openAddWebsite: () => actions.push('add-website') });
  const press = (key, extra = {}) => dispatchDocument(event('keydown', { target: document.activeElement, key, ...extra }));
  const click = (node, extra = {}) => { const e = event('click', { target: node, ...extra }); for (let at = node; at; at = at.parentElement) { at.dispatchEvent(e); if (e.stopped) break; } return e; };
  const type = (value) => { paletteInput.value = value; paletteInput.dispatchEvent(event('input')); };
  const rowNodes = () => descendant(list).filter((node) => node.getAttribute('role') === 'option');
  const filterTo = (name) => click(filters.find((node) => node.dataset.paletteFilter === name));
  return { window, state, document, body, main, input, opener, unrelated, palette, paletteInput, close, filters, list, empty, status,
    preInert, press, click, type, filterTo, rows: rowNodes, navigations, actions, groups, writes, observers, scrollRequests, scroller,
    api: window.OpenTabCommandPalette, data: window.OpenTabSearch.commandPalette, matched,
    inlineType: (value) => { input.focus(); input.value = value; input.dispatchEvent(event('input')); },
    inlineSites: () => descendant(history).filter((node) => node.classList.contains('search-site-item')),
    inlinePress: (key, extra = {}) => input.dispatchEvent(event('keydown', { key, ...extra })),
    add: (tag, id, parent = main) => parent.appendChild(new Element(tag, id)),
    flush: () => timers.splice(0).forEach((fn) => fn()), setDeveloper: (value) => { developer = value; } };
}

const copy = (value) => JSON.parse(JSON.stringify(value));
const schema = 'opentab.sceneSchemaVersion';
const fixture = () => ({
  [schema]: 2,
  currentSceneId: 'personal', currentFolderId: 'personal-home',
  scenes: [
    { id: 'personal', name: 'Personal', archivedAt: null },
    { id: 'work', name: 'Work', archivedAt: null },
    { id: 'old', name: 'Archived', archivedAt: 0 }
  ],
  folders: [
    { id: 'personal-home', name: 'Home', sceneId: 'personal' },
    { id: 'work-home', name: 'Home', sceneId: 'work' },
    { id: 'engineering', name: 'Engineering', sceneId: 'work' },
    { id: 'reference', name: 'Reference', sceneId: 'work', parentId: 'engineering' },
    { id: 'old-home', name: 'Home', sceneId: 'old' }
  ],
  icons: [
    site('old-docs', 'Docs', { folderId: 'old-home' }),
    site('personal-docs', 'Docs', { url: 'https://docs.example/', folderId: 'personal-home' }),
    site('work-docs', 'Docs', { url: 'https://docs.example/', folderId: 'reference', parentId: 'bookmarks' }),
    { id: 'bookmarks', name: 'Bookmarks', type: 'folder', folderId: 'reference' },
    { id: 'json', name: 'JSON', type: 'tool', folderId: 'work-home' },
    { id: 'old-json', name: 'Old JSON', type: 'tool', folderId: 'old-home' },
    site('unsafe', 'Unsafe', { url: 'javascript:alert(1)', folderId: 'work-home' })
  ]
});
const ids = (items) => Array.from(items, (item) => item.id);
const row = (h, id) => h.rows().find((node) => node.dataset.entryId === id);
const originalView = () => ({ sceneId: 'personal', homeGroupId: 'personal-home', currentFolderId: 'personal-home', generation: 4 });
const attachNavigation = (h, selectGroup = () => true) => {
  const view = originalView();
  h.window.OpenTabSceneNavigation = { getView: () => view, selectGroup };
  return view;
};

{
  const h = harness(fixture());
  const before = JSON.stringify(h.state);
  const results = h.data.listSites('docs');
  assert.deepEqual(ids(results), ['personal-docs', 'work-docs'], 'same names and URLs remain distinct across active scenes');
  assert.deepEqual(Array.from(results, (item) => item.location), ['Personal / Home', 'Work / Engineering / Reference / Bookmarks']);
  assert.deepEqual(copy(results[1].scene), { id: 'work', name: 'Work', archivedAt: null });
  assert.deepEqual(copy(results[1].group), { id: 'reference', name: 'Reference', sceneId: 'work' });
  assert.deepEqual(ids(h.data.listSites('Work')), ['work-docs'], 'palette can search the displayed scene location');
  assert.deepEqual(ids(h.data.listGroups('Home')), ['personal-home', 'work-home'], 'same-name groups retain stable, separate IDs');
  assert.deepEqual(ids(h.data.listGroups('Work')), ['work-home', 'engineering', 'reference']);
  assert.equal(h.data.listSites('Archived').length, 0);
  assert.equal(h.data.listGroups('Archived').length, 0);
  h.inlineType('doc');
  assert.deepEqual(h.inlineSites().map((node) => node.dataset.siteId), ['personal-docs', 'work-docs']);
  assert.match(h.inlineSites()[1].textContent, /Work \/ Engineering \/ Reference \/ Bookmarks/);
  assert.equal(h.input.getAttribute('aria-activedescendant'), null, 'cross-scene matching never implicitly selects a partial result');
  h.inlinePress('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://www.google.com/search?q=doc');
  h.inlineType('Docs'); h.inlinePress('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://docs.example/', 'exact search skips earlier archived duplicates');
  h.inlineType('JSON'); h.inlinePress('Enter');
  assert.deepEqual(h.matched.map((item) => item.id), ['json'], 'active tools retain the original callback');
  h.inlineType('Old JSON'); h.inlinePress('Enter');
  assert.equal(h.matched.length, 1, 'archived tools cannot activate through exact search');
  assert.equal(h.navigations.at(-1).url, 'https://www.google.com/search?q=Old%20JSON');
  h.inlineType('example.com'); h.inlinePress('Enter');
  assert.equal(h.navigations.at(-1).url, 'https://example.com', 'direct URL contract is unchanged');
  h.inlineType('doc'); h.inlinePress('ArrowDown'); h.inlinePress('ArrowDown'); h.inlinePress('Enter', { ctrlKey: true });
  assert.deepEqual(h.navigations.at(-1), { url: 'https://docs.example/', newTab: true });
  assert.equal(JSON.stringify(h.state), before, 'search, exact lookup, and activation never crop or alter full scene data');
  assert.equal(h.writes.length, 0, 'no persisted scene index or query history writes');
}

{
  const h = harness(fixture());
  h.state.scenes[1].name = '<img src=x onerror=alert(1)>';
  h.state.folders[3].name = '<script>Group</script>';
  h.state.icons[3].name = '<b>Folder</b>';
  h.state.icons[2].name = '<svg>Site</svg>';
  const before = JSON.stringify(h.state);
  h.api.open(); h.type('<svg>');
  const result = h.rows()[0];
  assert.match(result.textContent, /<svg>Site<\/svg>/);
  assert.match(result.textContent, /<img src=x onerror=alert\(1\)> \/ Engineering \/ <script>Group<\/script> \/ <b>Folder<\/b>/);
  assert.equal(result.querySelectorAll('img, script, svg, b').length, 0, 'all scene, group, folder and title labels are text nodes');
  h.filterTo('groups'); h.type('');
  assert.match(row(h, 'reference').textContent, /<img src=x onerror=alert\(1\)>/);
  h.api.close();
  assert.equal(JSON.stringify(h.state), before);
  assert.equal(h.writes.length, 0);
}

// Every displayed identity is rechecked, including same-label replacements.
const staleChanges = {
  sceneRename: (state) => { state.scenes[1].name = 'Renamed'; },
  sceneArchive: (state) => { state.scenes[1].archivedAt = 42; },
  sceneMissing: (state) => { state.scenes.splice(1, 1); },
  groupRename: (state) => { state.folders[3].name = 'Renamed'; },
  groupMove: (state) => { state.folders[2].sceneId = 'personal'; state.folders[3].sceneId = 'personal'; },
  groupReparent: (state) => {
    state.folders.push({ id: 'engineering-copy', name: 'Engineering', sceneId: 'work' });
    state.folders[3].parentId = 'engineering-copy';
  },
  parentRename: (state) => { state.icons[3].name = 'Renamed'; },
  parentReplacement: (state) => {
    state.icons.push({ id: 'bookmarks-copy', name: 'Bookmarks', type: 'folder', folderId: 'reference' });
    state.icons[2].parentId = 'bookmarks-copy';
  },
  recordTitle: (state) => { state.icons[2].name = 'Renamed'; },
  recordURL: (state) => { state.icons[2].url = 'https://different.example/'; },
  recordType: (state) => { state.icons[2].type = 'tool'; },
  recordGroup: (state) => { state.icons[2].folderId = 'work-home'; state.icons[2].parentId = ''; },
  recordRemoved: (state) => { state.icons.splice(2, 1); },
  duplicateRecord: (state) => { state.icons.push({ ...state.icons[2] }); },
  legacyDowngrade: (state) => { delete state[schema]; },
  unsupportedSchema: (state) => { state[schema] = 3; }
};
for (const [name, mutate] of Object.entries(staleChanges)) {
  for (const method of ['inline-pointer', 'inline-keyboard', 'palette']) {
    const h = harness(fixture());
    const snapshot = h.data.listSites('docs')[1];
    if (method === 'palette') { h.api.open(); h.filterTo('sites'); h.type('Docs'); }
    else { h.inlineType('doc'); h.inlinePress('ArrowDown'); h.inlinePress('ArrowDown'); }
    const old = method === 'palette' ? row(h, 'work-docs') : h.inlineSites()[1];
    mutate(h.state);
    assert.equal(h.data.validateSite(snapshot), null, `${name}: stale saved-site validation refuses`);
    if (method === 'inline-keyboard') h.inlinePress('Enter'); else h.click(old);
    assert.equal(h.navigations.length, 0, `${name}/${method}: stale result never navigates`);
    if (method === 'palette') { assert.equal(h.api.isOpen(), true); assert.match(h.status.textContent, /重新选择/); }
    else assert.equal(h.input.getAttribute('aria-activedescendant'), null);
    assert.equal(h.writes.length, 0);
  }
}
for (const [name, mutate] of Object.entries(staleChanges).filter(([name]) => /^(scene|group|legacy|unsupported)/.test(name))) {
  const h = harness(fixture()); let calls = 0;
  attachNavigation(h, () => { calls++; return true; });
  h.api.open(); h.filterTo('groups');
  const old = row(h, 'reference');
  const snapshot = h.data.listGroups('Reference')[0];
  mutate(h.state);
  assert.equal(h.data.validateGroup(snapshot), null, `${name}: stale group identity refuses`);
  h.click(old);
  assert.equal(calls, 0, `${name}: stale group never reaches navigation adapter`);
  assert.equal(h.groups.length, 0, 'no current-scene legacy fallback');
  assert.equal(h.api.isOpen(), true);
  assert.match(h.status.textContent, /重新选择/);
}

{
  const h = harness(fixture());
  const calls = []; let settle;
  const view = attachNavigation(h, (id, context) => { calls.push({ id, context }); return new Promise((resolve) => { settle = resolve; }); });
  const before = JSON.stringify(h.state);
  h.api.open(); h.filterTo('groups');
  assert.match(row(h, 'work-home').textContent, /Work \/ Home/);
  const oldView = copy(view);
  view.generation = 5; // the adapter receives the displayed epoch, not a fresh one
  h.click(row(h, 'reference')); h.click(row(h, 'reference')); h.press('Enter');
  assert.equal(calls.length, 1, 'cross-scene navigation is single-flight');
  assert.equal(calls[0].id, 'reference');
  assert.deepEqual(copy(calls[0].context), {
    view: oldView, scene: { id: 'work', name: 'Work', archivedAt: null },
    group: { id: 'reference', name: 'Reference', sceneId: 'work' }
  });
  assert.equal(h.groups.length, 0, 'adapter never invokes legacy group API');
  assert.equal(h.api.isOpen(), true, 'palette waits for durable selection');
  assert.equal(h.list.getAttribute('aria-busy'), 'true');
  settle('true'); await flushAsync();
  assert.equal(h.api.isOpen(), true, 'truthy-but-not-true is not durable success');
  assert.match(h.status.textContent, /未保存/);
  h.click(row(h, 'reference')); settle(true); await flushAsync();
  assert.equal(h.api.isOpen(), false);
  assert.equal(h.main.inert, false);
  assert.equal(JSON.stringify(h.state), before, 'navigation is delegated, not optimistically written by palette');
  assert.equal(h.writes.length, 0);
  h.api.open(); h.filterTo('groups'); h.click(row(h, 'work-home')); h.press('Escape');
  h.api.open(); h.filterTo('groups'); h.click(row(h, 'work-home'));
  assert.equal(calls.length, 3, 'single-flight survives reopening');
  settle(true); await flushAsync();
  assert.equal(h.api.isOpen(), true, 'older completion never dismisses newer session');
  h.window.OpenTabSceneNavigation.selectGroup = () => Promise.reject(new Error('durable read rejected'));
  h.click(row(h, 'work-home')); await flushAsync();
  assert.equal(h.api.isOpen(), true); assert.match(h.status.textContent, /未保存/);
  h.api.close();
}
for (const navigation of [undefined, {}, { getView: () => originalView() }]) {
  const h = harness(fixture()); h.window.OpenTabSceneNavigation = navigation;
  h.api.open(); h.filterTo('groups'); h.click(row(h, 'work-home')); await flushAsync();
  assert.equal(h.groups.length, 0, 'schema-2 groups cannot fall back to current-scene-only API');
  assert.equal(h.api.isOpen(), true);
}
{
  const h = harness(); // absent scene schema preserves the old group behavior
  h.api.open(); h.filterTo('groups'); h.press('Enter'); await flushAsync();
  assert.deepEqual(h.groups, ['home']); assert.equal(h.api.isOpen(), false);
}

// Ordinary incomplete/malformed snapshots fail closed without throwing.
const malformed = {
  missingScenes: (state) => { delete state.scenes; },
  invalidScenes: (state) => { state.scenes = {}; },
  unsupported: (state) => { state[schema] = 1; },
  duplicateScene: (state) => { state.scenes.push({ ...state.scenes[1] }); },
  invalidArchive: (state) => { delete state.scenes[1].archivedAt; },
  missingSceneName: (state) => { state.scenes[1].name = null; },
  missingGroupScene: (state) => { delete state.folders[3].sceneId; },
  missingGroup: (state) => { state.folders.splice(3, 1); },
  duplicateGroup: (state) => { state.folders.push({ ...state.folders[3] }); },
  orphanGroup: (state) => { state.folders[3].parentId = 'missing'; },
  groupCycle: (state) => { state.folders[2].parentId = 'reference'; },
  crossSceneParent: (state) => { state.folders[3].parentId = 'personal-home'; },
  missingIconFolder: (state) => { state.icons[2].parentId = 'missing'; },
  duplicateIconFolder: (state) => { state.icons.push({ ...state.icons[3] }); },
  crossGroupIconFolder: (state) => { state.icons[3].folderId = 'work-home'; },
  iconFolderCycle: (state) => { state.icons[3].parentId = 'bookmarks'; },
  invalidIconScene: (state) => { state.icons[2].sceneId = 'personal'; }
};
for (const [name, mutate] of Object.entries(malformed)) {
  const h = harness(fixture()); mutate(h.state);
  assert.ok(!ids(h.data.listSites('docs')).includes('work-docs'), `${name}: ambiguous site is excluded`);
  assert.doesNotThrow(() => h.data.listGroups(''));
  assert.doesNotThrow(() => h.inlineType('doc'));
  assert.equal(h.window.OpenTabSearch.resolve('Docs').icon?.id === 'work-docs', false);
  assert.equal(h.writes.length, 0);
}
{
  const h = harness(fixture()); h.state.icons = null; h.state.folders = {};
  assert.equal(h.data.listSites('').length, 0); assert.equal(h.data.listGroups('').length, 0);
  assert.doesNotThrow(() => h.inlineType('doc'));
}
{
  const h = harness(fixture());
  const old = h.data.listSites('docs')[1];
  const clone = copy(h.state); Object.assign(h.state, clone);
  assert.ok(h.data.validateSite(old), 'equivalent durable reload still validates by identity, not object reference');
  h.state.scenes[1].archivedAt = 1;
  assert.equal(h.data.listSites('Work').length, 0);
  h.state.scenes[1].archivedAt = null;
  assert.deepEqual(ids(h.data.listSites('Work')), ['work-docs'], 'restored scenes reappear from live state without rebuilding a persisted index');
}

{
  const h = harness(fixture());
  h.api.open(); h.filterTo('actions');
  assert.equal(row(h, 'manage-scenes'), undefined, 'no fictitious action when controller is absent');
  h.api.close(); let opened = 0;
  attachNavigation(h);
  h.window.OpenTabSceneNavigation.openManager = () => { opened++; assert.equal(h.api.isOpen(), false); assert.equal(h.main.inert, false); return true; };
  h.api.open(); h.filterTo('actions'); h.type('manage scenes');
  assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].dataset.entryId, 'manage-scenes');
  h.press('Enter'); assert.equal(opened, 1); assert.equal(h.api.isOpen(), false);
  h.api.open(); h.type('manage scenes'); delete h.window.OpenTabSceneNavigation.openManager;
  h.press('Enter'); assert.equal(opened, 1); assert.equal(h.api.isOpen(), true, 'disappeared manager adapter is revalidated');
  h.api.close();
  const dialog = h.add('dialog', 'scene-manager'); dialog.open = true; dialog.setAttribute('open', '');
  h.opener.focus(); assert.equal(h.press('k', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.api.isOpen(), false, 'scene manager/native modal owns its keyboard shortcuts');
  h.press('x'); assert.equal(h.input.value, '', 'type-to-search does not steal keys behind a native dialog');
}

assert.doesNotMatch(source('command-palette.js'), /fetch\(|chrome\.storage|localStorage|https?:\/\//);
console.log('Scene search tests passed: full-state matching, literal locations, archived exclusion, stale identity rejection, guarded cross-scene navigation, manager action and zero local writes.');
