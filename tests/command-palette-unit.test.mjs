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

// Execute both complete production modules. This DOM deliberately implements
// only browser operations used by them, with no copied business logic.
function harness({ platform = 'Linux', icons = [site('docs', 'Docs')], folders = [{ id: 'home', name: 'Home' }], developer = false } = {}) {
  let document;
  const docHandlers = new Map();
  const state = { icons, folders };
  const navigations = [], actions = [], groups = [], writes = [], timers = [];
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
  const chrome = { storage: { local: { get(keys, callback) { callback({}); }, set(value) { writes.push(value); } } } };
  window.chrome = chrome;
  const context = vm.createContext({ window, document, chrome, URL, Event: class { constructor(type) { Object.assign(this, event(type)); } } });
  vm.runInContext(source('search.js'), context);
  // In production, the palette script binds before home.js initializes search.
  vm.runInContext(source('command-palette.js'), context);
  window.OpenTabSearch.init({ getState: () => state });
  window.OpenTabSearch.navigateHook = (url, newTab) => navigations.push({ url, newTab });
  window.OpenTabCommandPalette.init({ openAddWebsite: () => actions.push('add-website') });
  const press = (key, extra = {}) => dispatchDocument(event('keydown', { target: document.activeElement, key, ...extra }));
  const click = (node, extra = {}) => { const e = event('click', { target: node, ...extra }); for (let at = node; at; at = at.parentElement) { at.dispatchEvent(e); if (e.stopped) break; } return e; };
  const type = (value) => { paletteInput.value = value; paletteInput.dispatchEvent(event('input')); };
  const rowNodes = () => descendant(list).filter((node) => node.getAttribute('role') === 'option');
  const filterTo = (name) => click(filters.find((node) => node.dataset.paletteFilter === name));
  return { window, state, document, body, main, input, opener, unrelated, palette, paletteInput, close, filters, list, empty, status,
    preInert, press, click, type, filterTo, rows: rowNodes, navigations, actions, groups, writes, observers, scrollRequests, scroller,
    api: window.OpenTabCommandPalette, data: window.OpenTabSearch.commandPalette,
    add: (tag, id, parent = main) => parent.appendChild(new Element(tag, id)),
    flush: () => timers.splice(0).forEach((fn) => fn()), setDeveloper: (value) => { developer = value; } };
}

for (const [platform, modifier, other] of [['macOS', 'metaKey', 'ctrlKey'], ['Windows', 'ctrlKey', 'metaKey'], ['Linux', 'ctrlKey', 'metaKey']]) {
  const h = harness({ platform });
  assert.equal(h.document.getElementById('search-shortcut-hint').textContent, platform === 'macOS' ? '⌘ K' : 'Ctrl K');
  h.opener.focus();
  assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, true);
  assert.equal(h.api.isOpen(), true); assert.equal(h.document.activeElement, h.paletteInput);
  assert.equal(h.main.inert, true); assert.equal(h.preInert.inert, true); assert.equal(h.palette.inert, false);
  assert.equal(h.paletteInput.getAttribute('aria-expanded'), 'true');
  assert.equal(h.rows()[0].getAttribute('aria-selected'), 'true');
  assert.equal(h.paletteInput.getAttribute('aria-activedescendant'), h.rows()[0].id);
  h.type('doc'); h.paletteInput.setSelectionRange(1, 2, 'backward');
  h.press('k', { [modifier]: true, repeat: true });
  assert.equal(h.paletteInput.value, 'doc'); assert.equal(h.paletteInput.selectionStart, 1); assert.equal(h.paletteInput.selectionEnd, 2);
  h.close.focus(); h.press('k', { [modifier]: true });
  assert.equal(h.document.activeElement, h.paletteInput); assert.equal(h.paletteInput.value, 'doc');
  const escape = h.press('Escape'); assert.equal(escape.defaultPrevented, true); assert.equal(escape.immediate, true);
  assert.equal(h.document.activeElement, h.opener); assert.equal(h.main.inert, false);
  assert.equal(h.preInert.inert, true); assert.equal(h.preInert.getAttribute('inert'), 'original');
  assert.equal(h.paletteInput.getAttribute('aria-activedescendant'), null);
  assert.equal(h.press('Escape').defaultPrevented, false);
  for (const extra of [{ [other]: true }, { altKey: true, [modifier]: true }, { shiftKey: true, [modifier]: true },
    { ctrlKey: true, metaKey: true }, { defaultPrevented: true, [modifier]: true }, { isComposing: true, [modifier]: true },
    { keyCode: 229, [modifier]: true }, { which: 229, [modifier]: true }]) {
    h.opener.focus(); const result = h.press('k', extra); assert.equal(result.defaultPrevented, Boolean(extra.defaultPrevented));
    assert.equal(h.api.isOpen(), false); assert.equal(h.document.activeElement, h.opener);
  }
  for (const tag of ['input', 'textarea', 'select', 'div']) {
    const editor = h.add(tag, `draft-${tag}`); editor.value = 'unsaved'; if (tag === 'div') editor.isContentEditable = true;
    editor.focus(); assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, false);
    assert.equal(h.api.isOpen(), false); assert.equal(editor.value, 'unsaved');
  }
  for (const id of ['settings-panel', 'add-icon-modal', 'timezone-selector', 'calendar-popover', 'folder-overlay', 'inline-dialog', 'icon-context-menu', 'change-icon-modal']) {
    const overlay = h.add('div', id, h.body); h.opener.focus();
    assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, false, `${id} protects existing modal drafts`);
    overlay.classList.add('hidden');
  }
  h.window.OpenTabSiteList = { isBusy: () => true };
  h.opener.focus();
  assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, false, 'confirmed import cannot open competing actions');
  assert.equal(h.api.isOpen(), false);
  h.window.OpenTabSiteList.isBusy = () => false;
  assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, true, 'failed or finished import releases the shortcut gate');
  h.press('Escape');
  let selecting = true, pending = false, canceled = 0;
  const checkbox = h.add('input', 'selected-site-checkbox');
  checkbox.setAttribute('type', 'checkbox'); checkbox.classList.add('site-selection-checkbox');
  h.window.OpenTabSiteSelection = {
    isActive: () => selecting, isPending: () => pending,
    containsTarget: node => node === checkbox,
    cancel() { canceled++; selecting = false; h.opener.focus(); }
  };
  checkbox.focus(); pending = true;
  assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, false);
  assert.equal(canceled, 0, 'a pending move cannot be cancelled by opening the launcher');
  pending = false;
  const moveDialog = h.add('dialog', 'site-selection-dialog'); moveDialog.open = true;
  assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, false);
  assert.equal(canceled, 0, 'destination dialog retains its draft');
  moveDialog.open = false;
  assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, true);
  assert.equal(canceled, 1); assert.equal(selecting, false);
  h.press('Escape'); assert.equal(h.document.activeElement, h.opener, 'selection teardown gives the launcher a stable opener');
  selecting = true;
  const unrelated = h.add('input', 'unrelated-selection-draft'); unrelated.value = 'preserve'; unrelated.focus();
  assert.equal(h.press('k', { [modifier]: true }).defaultPrevented, false);
  assert.equal(canceled, 1); assert.equal(unrelated.value, 'preserve');
}

{
  const h = harness(); h.input.focus(); h.input.value = 'keep ordinary query'; h.input.setSelectionRange(3, 7, 'backward');
  const stateBefore = JSON.stringify(h.window.OpenTabSearch.getState());
  h.press('k', { ctrlKey: true }); h.type('weather');
  assert.equal(h.input.value, 'keep ordinary query');
  h.press('Escape'); assert.equal(h.document.activeElement, h.input);
  assert.equal(h.input.selectionStart, 3); assert.equal(h.input.selectionEnd, 7); assert.equal(h.input.selectionDirection, 'backward');
  assert.equal(JSON.stringify(h.window.OpenTabSearch.getState()), stateBefore); assert.equal(h.writes.length, 0);
  h.body.classList.add('minimal-mode'); h.opener.focus(); h.api.open();
  assert.equal(h.paletteInput.value, '', 'every fresh session clears only the palette query');
  assert.equal(h.body.classList.contains('search-shortcut-active'), false);
  h.click(h.palette); assert.equal(h.api.isOpen(), false); assert.equal(h.document.activeElement, h.opener);
  assert.equal(h.body.classList.contains('minimal-mode'), true); assert.equal(h.writes.length, 0);
}

{
  const h = harness(); h.api.open();
  assert.ok(h.rows().every((row) => row.tabIndex === -1));
  const controls = [h.paletteInput, h.close, ...h.filters];
  for (const expected of controls.slice(1).concat(controls[0])) { h.press('Tab'); assert.equal(h.document.activeElement, expected); }
  h.press('Tab', { shiftKey: true }); assert.equal(h.document.activeElement, controls.at(-1));
  h.press('Tab', { shiftKey: true }); assert.equal(h.document.activeElement, controls.at(-2));
  h.opener.focus(); assert.equal(h.document.activeElement, h.paletteInput, 'programmatic focus cannot escape the modal');
  const added = h.add('aside', 'late-background', h.body);
  h.observers.find((observer) => observer.active).fn(); assert.equal(added.inert, true, 'new body children are isolated too');
  h.press('ArrowUp'); assert.equal(h.rows().at(-1).getAttribute('aria-selected'), 'true');
  h.press('ArrowDown'); assert.equal(h.rows()[0].getAttribute('aria-selected'), 'true');
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }]) {
    assert.equal(h.press('Enter', extra).defaultPrevented, false); assert.equal(h.navigations.length, 0);
  }
  const backgroundCommand = h.press('1', { altKey: true }); assert.equal(backgroundCommand.immediate, true);
  h.api.close(); assert.equal(added.inert, false); assert.ok(h.observers.every((observer) => !observer.active));
}

{
  const h = harness(); h.api.open();
  assert.equal(h.scrollRequests.at(-1).node, h.rows()[0], 'opening scrolls the initial active row into view');
  h.scroller.scrollTop = 1000; h.api.close(); h.api.open();
  assert.equal(h.scrollRequests.at(-1).node, h.rows()[0], 'reopening after scrolling reveals the fresh first selection');
  const reopened = h.scrollRequests.length;
  h.filterTo('actions');
  assert.equal(h.scrollRequests.length, reopened + 1);
  assert.equal(h.scrollRequests.at(-1).node, h.rows()[0], 'category changes reveal their new first selection');
  h.type('weather');
  assert.equal(h.scrollRequests.at(-1).node, h.rows()[0], 'query changes reveal their new first selection');
  h.scroller.scrollTop = 1000;
  const beforeEmpty = h.scrollRequests.length;
  h.type('no-matching-entry');
  assert.equal(h.rows().length, 0); assert.equal(h.scroller.scrollTop, 0, 'empty results reset the scroll so the explanation is visible');
  assert.equal(h.scrollRequests.length, beforeEmpty, 'empty results never scroll a nonexistent option');
  h.type(''); assert.equal(h.scrollRequests.at(-1).node, h.rows()[0]);
  h.api.close();
}

for (const unavailable of ['removed', 'hidden', 'disabled', 'inert', 'display', 'visibility']) {
  const h = harness(); h.opener.focus(); h.api.open();
  if (unavailable === 'removed') { h.main.children = h.main.children.filter((node) => node !== h.opener); h.opener.parentElement = null; }
  else if (unavailable === 'display') h.opener.display = 'none';
  else if (unavailable === 'visibility') h.opener.visibility = 'hidden';
  else h.opener[unavailable] = true;
  h.api.close(); assert.equal(h.document.activeElement, h.body, `${unavailable} opener falls back to body`);
  assert.equal(h.body.getAttribute('tabindex'), null, 'fallback focus does not leave a tab stop');
}

{
  const icons = [site('domain', 'Other', { url: 'https://git.example/path?secret=hidden' }), site('contains', 'My Git workspace'),
    site('prefix', 'Git docs'), site('exact', 'GIT'), site('nested', '<script>stored name</script>', { parentId: 'nested-folder', folderId: 'work' }),
    { id: 'nested-folder', type: 'folder', name: 'Deep folder', folderId: 'work' },
    site('unsafe', 'Unsafe', { url: 'javascript:alert(1)' }), site('credentials', 'Credentials', { url: 'https://user:pass@example.com/' }),
    { id: 'tool', type: 'tool', name: 'JSON' }];
  const h = harness({ icons, folders: [{ id: 'home', name: 'Home' }, { id: 'work', name: 'Work' }] }); h.api.open();
  assert.deepEqual(h.rows().filter((row) => row.dataset.entryType === 'site').map((row) => row.dataset.entryId), ['domain', 'contains', 'prefix', 'exact', 'nested']);
  h.type('git'); assert.deepEqual(h.rows().map((row) => row.dataset.entryId), ['exact', 'prefix', 'contains', 'domain']);
  h.type('Deep folder'); assert.deepEqual(h.rows().map((row) => row.dataset.entryId), ['nested']);
  assert.match(h.rows()[0].textContent, /<script>stored name<\/script>/); assert.match(h.rows()[0].textContent, /Work \/ Deep folder/);
  h.type('secret'); assert.equal(h.rows().length, 0, 'query strings are not searched');
  h.press('Enter'); assert.equal(h.api.isOpen(), true); assert.equal(h.navigations.length, 0, 'no web fallback on no results');
  assert.equal(h.empty.children.length, 2, 'static localized empty explanation is preserved');
  h.type(''); h.filterTo('groups'); assert.deepEqual(h.rows().map((row) => row.dataset.entryId), ['home', 'work']);
  h.type('Work'); h.press('Enter'); await Promise.resolve(); assert.deepEqual(h.groups, ['work']); assert.equal(h.api.isOpen(), false);
}

{
  const h = harness({ icons: Array.from({ length: 150 }, (_, i) => site(`item-${i}`, `Site ${i}`)), folders: Array.from({ length: 30 }, (_, i) => ({ id: `group-${i}`, name: `Group ${i}` })) });
  assert.equal(h.data.listSites('').length, 20); assert.equal(h.data.listSites('', Infinity).length, 100);
  assert.equal(h.data.listGroups('').length, 20); assert.equal(h.data.listGroups('', 200).length, 30);
  h.api.open(); assert.equal(h.rows().filter((row) => row.dataset.entryType === 'site').length, 8); assert.equal(h.rows().filter((row) => row.dataset.entryType === 'group').length, 6);
  h.filterTo('sites'); assert.equal(h.rows().length, 20);
  h.type('Site 149'); assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].dataset.entryId, 'item-149', 'filter all loaded records before truncating');
  h.press('Enter'); assert.equal(h.navigations[0].url, 'https://item-149.example/');
}

{
  const h = harness({ icons: [], folders: [] }); h.api.open(); h.filterTo('sites');
  assert.equal(h.rows().length, 0); assert.equal(h.paletteInput.getAttribute('aria-activedescendant'), null);
  assert.equal(h.empty.classList.contains('hidden'), false); h.press('Enter'); assert.equal(h.navigations.length, 0);
  h.filterTo('actions'); assert.equal(h.rows().length, 8);
  assert.equal(h.rows().some((row) => row.dataset.entryId === 'advanced'), false);
  h.setDeveloper(true); h.type(''); assert.equal(h.rows().length, 9);
  h.type('developer'); assert.equal(h.rows()[0].dataset.entryId, 'advanced'); h.setDeveloper(false); h.press('Enter');
  assert.equal(h.api.isOpen(), true); assert.equal(h.actions.length, 0); assert.match(h.status.textContent, /重新选择/);
  h.type('backup'); assert.equal(h.rows()[0].dataset.entryId, 'sync'); h.press('Enter'); assert.deepEqual(h.actions, ['sync']);
  for (const action of ['add-website', 'appearance', 'wallpaper', 'shortcuts', 'search', 'weather', 'sync', 'about']) {
    h.api.open(); h.filterTo('actions'); h.click(h.rows().find((row) => row.dataset.entryId === action));
    assert.equal(h.actions.at(-1), action); assert.equal(h.api.isOpen(), false); assert.equal(h.main.inert, false);
  }
}

for (const mutation of ['remove', 'name', 'url', 'folderId', 'parentId', 'duplicate', 'group-name']) {
  const h = harness(); h.api.open(); h.filterTo('sites'); const old = h.rows()[0];
  if (mutation === 'remove') h.state.icons = [];
  else if (mutation === 'duplicate') h.state.icons.push({ ...h.state.icons[0] });
  else if (mutation === 'group-name') h.state.folders[0].name = 'Renamed';
  else h.state.icons[0][mutation] = mutation === 'url' ? 'https://changed.example/' : 'changed';
  h.click(old); assert.equal(h.navigations.length, 0, `${mutation} stale site is never opened`);
  assert.equal(h.api.isOpen(), true); assert.match(h.status.textContent, /重新选择/);
}
for (const mutation of ['remove', 'name', 'id']) {
  const h = harness(); h.api.open(); h.filterTo('groups');
  if (mutation === 'remove') h.state.folders = [];
  else h.state.folders[0][mutation] = 'changed';
  h.press('Enter'); assert.equal(h.groups.length, 0); assert.equal(h.api.isOpen(), true); assert.match(h.status.textContent, /重新选择/);
}

{
  const h = harness(); h.api.open(); h.type('Docs'); h.press('Enter', { ctrlKey: true });
  assert.deepEqual(h.navigations, [{ url: 'https://docs.example/', newTab: true }]); assert.equal(h.writes.length, 0, 'palette never writes query history');
  assert.equal(h.api.isOpen(), false);
  h.api.open(); h.window.OpenTabSearch.navigateHook = () => { throw new Error('navigation rejected'); };
  h.press('Enter'); assert.equal(h.api.isOpen(), false); assert.equal(h.main.inert, false, 'navigation failure cleans up modal isolation');
  const original = h.data.listSites; h.data.listSites = () => { throw new Error('workspace unavailable'); };
  h.opener.focus(); assert.equal(h.api.open(), false); assert.equal(h.main.inert, false); assert.equal(h.document.activeElement, h.opener);
  h.data.listSites = original; h.api.open(); h.data.listSites = () => { throw new Error('render failed'); };
  h.type('anything'); assert.equal(h.api.isOpen(), false); assert.equal(h.main.inert, false, 'render failure cleans up existing isolation');
  h.data.listSites = original; h.api.init({ openAddWebsite() { throw new Error('UI unavailable'); } }); h.api.open(); h.filterTo('actions');
  h.click(h.rows().find((row) => row.dataset.entryId === 'add-website'));
  assert.equal(h.main.inert, false); assert.equal(h.api.isOpen(), false);
}


{
  const h = harness(); let settle; let calls = 0;
  h.window.OpenTabFolders.selectGroup = () => { calls++; return new Promise((resolve) => { settle = resolve; }); };
  h.api.open(); h.filterTo('groups'); h.press('Enter'); h.press('Enter'); h.click(h.rows()[0]);
  assert.equal(calls, 1); assert.equal(h.api.isOpen(), true); assert.equal(h.list.getAttribute('aria-busy'), 'true');
  assert.match(h.status.textContent, /正在切换/); assert.equal(h.status.classList.contains('sr-only'), false);
  settle(false); await flushAsync();
  assert.equal(h.api.isOpen(), true); assert.match(h.status.textContent, /未保存/); assert.equal(h.list.getAttribute('aria-busy'), 'false');
  h.press('Enter'); assert.equal(calls, 2); settle(true); await flushAsync();
  assert.equal(h.api.isOpen(), false); assert.equal(h.main.inert, false);
  assert.equal(h.status.textContent, ''); assert.equal(h.status.classList.contains('sr-only'), true);
  h.api.open(); h.filterTo('groups'); h.press('Enter'); h.press('Escape');
  assert.equal(h.api.isOpen(), false, 'Escape dismisses without claiming to undo the issued transaction');
  h.api.open(); h.filterTo('groups'); h.press('Enter'); assert.equal(calls, 3, 'single flight survives close/reopen');
  settle(true); await flushAsync();
  assert.equal(h.api.isOpen(), true, 'an old transaction completion never closes a newer session');
  h.window.OpenTabFolders.selectGroup = () => Promise.reject(new Error('write rejected'));
  h.press('Enter'); await flushAsync();
  assert.equal(h.api.isOpen(), true); assert.match(h.status.textContent, /未保存/);
  h.api.close(); assert.equal(h.main.inert, false);
}


{
  const folderSource = source('folders.js');
  const homeSource = source('home.js');
  const extract = (script, name, next) => script.slice(script.indexOf(`  function ${name}(`), script.indexOf(`  function ${next}(`));
  let settle;
  const save = new Promise((resolve) => { settle = resolve; });
  const state = { currentFolderId: 'home', folders: [{ id: 'home' }, { id: 'work' }] };
  let rendered = 0;
  const homeContext = vm.createContext({ state, sceneRuntime: null, getFolderById: (id) => state.folders.find((group) => group.id === id),
    saveState: () => save, refreshIconViews: () => { rendered++; } });
  vm.runInContext(extract(homeSource, 'selectFolder', 'addIcon'), homeContext);
  const folderContext = vm.createContext({ state: () => state, closeOverlay() {}, host: { selectFolder: homeContext.selectFolder } });
  vm.runInContext(extract(folderSource, 'selectGroup', 'groupCount'), folderContext);
  assert.equal(folderContext.selectGroup('missing', true), false);
  assert.equal(folderContext.selectGroup('home', true), true);
  const result = folderContext.selectGroup('work', true);
  assert.equal(result, save, 'the real folder API returns the exact durable workspace-save promise');
  assert.equal(rendered, 1); assert.equal(state.currentFolderId, 'work'); settle(false);
  assert.equal(await result, false, 'save failure reaches the caller instead of being reported as success');
  const sceneSave = Promise.resolve(true); let destination;
  homeContext.sceneRuntime = { isActive: () => true };
  homeContext.window = { OpenTabSceneNavigation: { selectGroup(id) { destination = id; return sceneSave; } } };
  assert.equal(homeContext.selectFolder('home'), sceneSave, 'scene navigation returns its guarded durable operation');
  assert.equal(destination, 'home'); assert.equal(state.currentFolderId, 'work', 'scene adapter, not legacy path, owns view changes');
}

// The only new host hooks are specific existing UI entry points.
assert.match(source('folders.js'), /\n    selectGroup,/);
assert.match(source('settings-nav.js'), /function openSection\(id\)[\s\S]*?id === 'advanced' && !developerToolsEnabled/);
assert.match(source('home.js'), /OpenTabCommandPalette\?\.init\(\{ openAddWebsite\(\) \{ rememberFocus\(\); openAddIconModal\(\); \} \}\)/);
assert.doesNotMatch(source('search.js'), /shortcutSession|shortcutOpener|search-shortcut-active|onSearchShortcut/);
assert.doesNotMatch(source('command-palette.js'), /fetch\(|chrome\.storage|localStorage|https?:\/\//);
console.log('Command palette unit tests passed: real modules, native scope, independent query, modal isolation/focus, ranking/filtering, real actions, stale activation, and exception cleanup.');
