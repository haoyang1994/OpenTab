import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../site-list.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../home.html', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const context = { groups: [{ id: 'folder-home', name: 'Home' }, { id: 'work', name: '<svg onload=x> Work' }], currentFolderId: 'folder-home' };
const result = (url = 'https://a.example/', ready = 1) => ({
  ok: true, target: { id: 'work', name: '<svg onload=x> Work' },
  rows: [{ lineNumber: 1, raw: url, url, status: 'ready', reason: '' },
    { lineNumber: 3, raw: '<img onerror=x>', status: 'invalid', reason: '网址无效' },
    { lineNumber: 4, raw: url, url, status: 'duplicate', reason: '' }],
  counts: { total: 3, ready, duplicate: 1, invalid: 1 }
});
function harness(options = {}) {
  const nodes = new Map(), observers = [], listeners = [];
  let document;
  class Element {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase(); this.id = id; this.value = ''; this.type = '';
      this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = new Map();
      this.disabled = false; this.hidden = false; this._text = ''; this.classes = new Set();
      this.classList = {
        contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name),
        toggle: (name, on) => (on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name)
      };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { throw Error('Never use HTML to display user content'); }
    get options() { return this.children; }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key]; }
    addEventListener(name, callback) { listeners.push([this.id, name]); this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
    dispatch(name, extra = {}) { const e = { currentTarget: this, target: this, preventDefault() {}, ...extra }; return Promise.all((this.listeners.get(name) || []).map(callback => callback(e))); }
    click() { if (!this.disabled) return this.dispatch('click'); }
    focus() { if (!this.disabled) document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
    querySelectorAll() { return this.fields || []; }
  }
  for (const id of ['site-list-form', 'site-list-input', 'site-list-group', 'site-list-preview-btn', 'site-list-confirm', 'site-list-cancel', 'site-list-status', 'site-list-preview', 'site-list-summary', 'site-list-rows', 'settings-panel', 'modal-paste-sites', 'empty-paste-sites', 'add-icon-modal', 'save-btn', 'cancel-btn', 'icon-upload-status', 'icon-modal-title', 'icon-name', 'icon-url', 'icon-file', 'icon-type', 'ssh-port', 'add-shortcut-tile', 'settings-btn', 'close-settings', 'backup-import-btn', 'import-undo-btn', 'settings-search']) nodes.set(id, new Element('div', id));
  const $ = id => nodes.get(id);
  $('settings-panel').classes.add('hidden'); $('add-icon-modal').classes.add('hidden');
  $('save-btn').textContent = '保存'; $('icon-modal-title').textContent = '添加快捷图标';
  $('icon-file').type = 'file'; $('icon-file').files = [];
  $('settings-panel').fields = ['site-list-input', 'site-list-group', 'site-list-confirm', 'site-list-cancel', 'close-settings', 'backup-import-btn', 'import-undo-btn', 'settings-search'].map($);
  $('import-undo-btn').disabled = true;
  $('icon-type').value = 'shortcut'; $('ssh-port').value = '22';
  $('add-icon-modal').fields = ['icon-name', 'icon-url', 'icon-file', 'icon-type', 'ssh-port'].map($);
  const activeTab = { dataset: { groupId: options.activeId || 'work' } };
  document = { readyState: 'loading', getElementById: $, createElement: tag => new Element(tag), querySelector: () => activeTab,
    addEventListener: (name) => listeners.push(['document', name]), activeElement: null };
  const calls = { contexts: 0, previews: [], commits: [], opens: [], dialogs: [] };
  const g = {
    document, module: { exports: {} },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(node, config) { observers.push({ node, config, callback: this.callback }); } },
    OpenTabImport: {
      async readUrlListContext() { calls.contexts++; return options.context ? options.context() : context; },
      async previewUrlList(text, target) { calls.previews.push([text, target]); return options.preview ? options.preview(text, target) : result(); },
      async commitUrlList(issued) { calls.commits.push(issued); return options.commit ? options.commit(issued) : { ok: true }; }
    },
    OpenTabSettingsNav: { open(config) { calls.opens.push(config); $('settings-panel').classes.delete('hidden'); }, close() { $('settings-panel').classes.add('hidden'); }, setActive(value) { calls.section = value; } },
    OpenTabFolders: { showDialog(message, actions) { calls.dialogs.push({ message, actions }); return options.confirm ? options.confirm() : Promise.resolve(false); } }
  };
  g.globalThis = g; vm.createContext(g); vm.runInContext(code, g);
  const api = g.module.exports.bind(document);
  $('cancel-btn').addEventListener('click', () => { $('add-icon-modal').classes.add('hidden'); document.activeElement = $('add-shortcut-tile'); });
  function mutate(id) { observers.filter(observer => observer.node === $(id)).forEach(observer => observer.callback([])); }
  return { $, calls, api, document, g, mutate, listeners, async open() { api.open($('empty-paste-sites')); mutate('settings-panel'); await flush(); },
    async type(text) { $('site-list-input').value = text; await $('site-list-input').dispatch('input'); },
    async showModal() { $('add-icon-modal').classes.delete('hidden'); mutate('add-icon-modal'); await flush(); } };
}

// Markup remains inside settings and retains the existing import/backup surface.
assert.match(html, /<form id="site-list-form"[^>]+aria-labelledby="site-list-heading"/);
assert.match(html, /<textarea id="site-list-input"[^>]+aria-describedby="site-list-hint site-list-status"/);
assert.ok(!/<textarea id="site-list-input"[^>]+maxlength=/.test(html), 'over-limit input is explicitly reported, never silently truncated by the DOM');
for (const id of ['import-bookmarks-btn', 'import-file-btn', 'import-topsites-btn', 'import-undo-btn', 'backup-download-btn', 'backup-import-btn']) assert.ok(html.includes(`id="${id}"`));
assert.doesNotMatch(code, /navigator\.clipboard|fetch\(|XMLHttpRequest|innerHTML/);
assert.equal(html.indexOf('src="home.js"') > html.indexOf('src="site-list.js"'), true);
{
  const h = harness(); await h.open();
  assert.equal(h.$('site-list-group').value, 'work', 'current DOM group wins over stale storage');
  assert.equal(h.$('site-list-group').children[1].textContent, '<svg onload=x> Work');
  assert.equal(h.calls.opens[0].opener, h.$('empty-paste-sites'));
  assert.equal(h.document.activeElement, h.$('site-list-input'));
  assert.equal(h.calls.section, 'sync');
  assert.equal(h.$('site-list-confirm').disabled, true);
  await h.type('a.example\n\n<img onerror=x>\na.example');
  await h.$('site-list-form').dispatch('submit');
  assert.deepEqual(h.calls.previews[0], ['a.example\n\n<img onerror=x>\na.example', 'work']);
  assert.equal(h.$('site-list-rows').children.length, 3);
  assert.match(h.$('site-list-rows').textContent, /第 3 行<img onerror=x>/);
  assert.equal(h.$('site-list-confirm').textContent, '添加 1 个网站');
  assert.match(h.$('site-list-status').textContent, /<svg onload=x> Work/);
  assert.equal(h.$('site-list-confirm').disabled, false);
  await h.$('site-list-confirm').click();
  assert.equal(h.calls.commits.length, 1); assert.equal(h.calls.commits[0].rows[1].raw, '<img onerror=x>');
  assert.ok(h.$('site-list-input').value.length, 'only a real successful reload clears the list');
  assert.equal(h.$('site-list-confirm').disabled, true); assert.equal(h.$('site-list-input').disabled, true);
  assert.equal(h.g.OpenTabSiteList.isBusy(), true, 'saved form remains locked until the real reload');
  assert.equal(h.listeners.some(([, name]) => name === 'keydown'), false, 'inactive flow never captures keyboard shortcuts or Tab');
}
{
  const h = harness({ activeId: 'deleted' }); await h.open();
  assert.equal(h.$('site-list-group').value, 'folder-home', 'deleted/stale DOM group falls back to a verified group');
}
{
  const first = deferred(), second = deferred(); let request = 0;
  const h = harness({ preview: () => ++request === 1 ? first.promise : second.promise }); await h.open(); await h.type('first.example');
  const one = h.api.requestPreview(); await h.type('second.example'); const two = h.api.requestPreview();
  second.resolve(result('https://second.example/')); await two;
  first.resolve(result('https://first.example/')); await one;
  assert.match(h.$('site-list-rows').textContent, /second.example/); assert.doesNotMatch(h.$('site-list-rows').textContent, /first.example/);
  await h.$('site-list-group').dispatch('change');
  assert.equal(h.$('site-list-confirm').disabled, true, 'a target change invalidates confirmation immediately');
  assert.equal(h.$('site-list-preview').hidden, true);
}
{
  const wait = deferred(); const h = harness({ preview: () => wait.promise }); await h.open(); await h.type('a.example');
  const pending = h.api.requestPreview(); await h.api.requestPreview(); assert.equal(h.calls.previews.length, 1);
  h.g.OpenTabSettingsNav.close(); h.mutate('settings-panel'); await h.open();
  wait.resolve(result()); await pending;
  assert.equal(h.$('site-list-confirm').disabled, true, 'closing and reopening does not revive pending preview');
  assert.equal(h.$('site-list-input').value, 'a.example');
}
{
  const old = deferred(); let count = 0;
  const h = harness({ context: () => ++count === 1 ? old.promise : { ...context, groups: [{ id: 'fresh', name: 'Fresh' }], currentFolderId: 'fresh' } });
  h.api.open(h.$('empty-paste-sites')); h.mutate('settings-panel');
  h.g.OpenTabSettingsNav.close(); h.mutate('settings-panel'); await h.open();
  old.resolve(context); await flush(); assert.equal(h.$('site-list-group').value, 'fresh');
}
{
  const wait = deferred(); const h = harness({ commit: () => wait.promise }); await h.open(); await h.type('a.example'); await h.api.requestPreview();
  const first = h.api.commit(); await h.api.commit(); assert.equal(h.calls.commits.length, 1, 'confirmation is single flight');
  assert.match(h.$('site-list-status').textContent, /请稍候/);
  assert.equal(h.g.OpenTabSiteList.isBusy(), true);
  assert.equal(h.$('close-settings').disabled, true); assert.equal(h.$('backup-import-btn').disabled, true);
  assert.equal(h.document.activeElement, h.$('site-list-status'));
  assert.equal(h.$('site-list-cancel').disabled, true);
  h.g.OpenTabSettingsNav.close(); h.mutate('settings-panel');
  wait.resolve({ ok: false, message: '分组已删除' }); await first;
  assert.equal(h.$('site-list-input').value, 'a.example'); assert.equal(h.$('site-list-input').disabled, false);
  assert.equal(h.$('site-list-status').textContent, '分组已删除'); assert.equal(h.$('site-list-confirm').disabled, true);
  assert.equal(h.g.OpenTabSiteList.isBusy(), false);
  assert.equal(h.$('close-settings').disabled, false); assert.equal(h.$('backup-import-btn').disabled, false);
  assert.equal(h.$('import-undo-btn').disabled, true, 'release restores controls that were already disabled');
}
for (const options of [
  { preview: async () => { throw Error('read failed'); } },
  { preview: async () => ({ ok: false, message: '超过 100 行' }) },
  { preview: async () => result('https://a.example/', 0) },
  { commit: async () => { throw Error('write failed'); } }
]) {
  const h = harness(options); await h.open(); await h.type('a.example'); await h.api.requestPreview();
  if (options.commit) await h.api.commit();
  assert.equal(h.$('site-list-confirm').disabled, true); assert.equal(h.$('site-list-input').value, 'a.example');
  assert.equal(h.$('site-list-input').disabled, false); assert.equal(h.$('site-list-preview-btn').disabled, false);
}
{
  const h = harness(); await h.showModal();
  assert.equal(h.$('modal-paste-sites').hidden, false);
  h.$('save-btn').textContent = '更新'; h.mutate('add-icon-modal'); assert.equal(h.$('modal-paste-sites').hidden, true);
  h.$('save-btn').textContent = '保存'; h.$('icon-upload-status').textContent = '正在读取图片…'; h.mutate('add-icon-modal');
  assert.equal(h.$('modal-paste-sites').disabled, true); await h.api.switchFromModal(); assert.equal(h.calls.opens.length, 0);
  h.$('icon-upload-status').textContent = ''; h.$('save-btn').disabled = true; h.mutate('add-icon-modal');
  await h.api.switchFromModal(); assert.equal(h.calls.opens.length, 0, 'pending saves cannot switch');
}
{
  const h = harness(); await h.showModal(); h.$('icon-name').value = 'Keep my draft';
  await h.api.switchFromModal(); assert.equal(h.calls.dialogs.length, 1); assert.equal(h.calls.opens.length, 0);
  assert.equal(h.$('icon-name').value, 'Keep my draft'); assert.equal(h.document.activeElement, h.$('modal-paste-sites'));
}
{
  const h = harness({ confirm: () => Promise.resolve(true) }); await h.showModal(); h.$('icon-url').value = 'a.example';
  await h.api.switchFromModal(); assert.equal(h.calls.dialogs.length, 1); assert.equal(h.calls.opens.length, 1);
  assert.equal(h.calls.opens[0].opener, h.$('add-shortcut-tile'), 'restores the original editor opener, not a hidden modal button');
  assert.equal(h.$('add-icon-modal').classList.contains('hidden'), true);
}
{
  const wait = deferred(); const h = harness({ confirm: () => wait.promise }); await h.showModal(); h.$('icon-name').value = 'Draft';
  const pending = h.api.switchFromModal(); h.$('icon-upload-status').textContent = '正在读取图片…'; wait.resolve(true); await pending;
  assert.equal(h.calls.opens.length, 0, 'revalidate pending upload after confirmation');
}
// Exercise the changed settings API with real production open/close functions.
{
  const source = fs.readFileSync(new URL('../settings-nav.js', import.meta.url), 'utf8');
  const range = source.slice(source.indexOf('  function open('), source.indexOf('  function onContentScroll('));
  const h = harness(); const remembered = [], restored = [];
  const g = { preserveDraftsOnOpen: false, OpenTabSiteList: { isBusy: () => false }, panel: () => h.$('settings-panel'), $: h.$, activeId: 'appearance', buildNav() {}, ensureResetButtons() {}, fillAbout() {}, syncFromState() {}, async refreshWindowFullscreenShortcut() {}, setActive() {}, applyFilter() {},
    host: { rememberFocus: el => remembered.push(el), restoreFocus: () => restored.push(remembered.pop()) } };
  vm.createContext(g); vm.runInContext(range, g);
  g.open({ opener: h.$('empty-paste-sites') }); g.close(); assert.equal(restored[0], h.$('empty-paste-sites'));
  g.open(); assert.equal(remembered[0], h.$('settings-btn'), 'default settings entry remains backward compatible');
  h.$('settings-search').value = 'preserved filter'; g.OpenTabSiteList.isBusy = () => true;
  assert.equal(g.close(), false); assert.equal(g.handleEscape(), true);
  assert.equal(h.$('settings-panel').classList.contains('hidden'), false, 'pending commit keeps the visible dialog open');
  assert.equal(h.$('settings-search').value, 'preserved filter', 'pending Escape does not silently change settings filter');
}
console.log('paste-sites UI unit tests passed');
