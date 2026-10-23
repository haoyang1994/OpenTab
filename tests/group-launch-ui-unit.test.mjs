import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../group-launch.js', import.meta.url), 'utf8');
const item = (id = 'a') => ({ key: `https://${id}.example/`, name: id, domain: `${id}.example`, url: `https://${id}.example/` });
function harness(items = [item('a'), item('b')]) {
  const elements = new Map(), captures = new Map();
  let document;
  class Element {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.listeners = new Map(); this.attrs = new Map();
      this.disabled = false; this.open = false; this.isConnected = true; this.className = ''; this.textContent = '';
      this.classList = { toggle: (key, value) => { this.className = this.className.split(' ').filter(x => x && x !== key).concat(value ? key : []).join(' '); } };
      if (id) elements.set(id, this);
    }
    setAttribute(key, value) { this.attrs.set(key, value); }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { document.activeElement = this; }
    querySelectorAll(selector) { return this.children.flatMap(node => [node, ...node.querySelectorAll('*')]).filter(node => selector === '*' || selector.split(',').map(x => x.trim().toUpperCase()).includes(node.tagName)); }
  }
  document = { activeElement: null, createElement: tag => new Element(tag), getElementById: id => elements.get(id) };
  const entry = new Element('button', 'group-launch-entry'), dialog = new Element('dialog', 'group-launch-dialog');
  for (const [tag, id] of [['h2', 'title'], ['p', 'status'], ['span', 'count'], ['p', 'limit'], ['button', 'all'], ['button', 'clear'], ['div', 'list'], ['p', 'empty'], ['button', 'cancel'], ['button', 'confirm']]) dialog.append(new Element(tag, `group-launch-${id}`));
  let calls = [], resolve, blocked = false, canceled = 0;
  const preview = { items, groupName: '<script>Group</script>' };
  const window = {
    addEventListener: (type, fn) => captures.set(type, fn),
    OpenTabSiteSelection: { isPending: () => false, cancel: () => canceled++ },
    OpenTabGroupLaunchCore: { create: () => ({ preview: () => preview,
      launch(token, keys) { assert.equal(token, preview); calls.push([...keys]); return new Promise(done => { resolve = done; }); } }) }
  };
  vm.runInNewContext(source, { window, document });
  window.OpenTabGroupLaunch.init({ isEditingBlocked: () => blocked, endDesktopDrag() {}, hideIconContextMenu() {} });
  function event(target, type = 'click', props = {}) {
    const e = { type, target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...props };
    captures.get(type)?.(e);
    if (!e.stopped) target.listeners.get(type)?.(e);
    return e;
  }
  return { api: window.OpenTabGroupLaunch, elements, document, entry, dialog, event, calls, preview,
    rows: () => elements.get('group-launch-list').children,
    finish: result => resolve(result), setBlocked: value => { blocked = value; }, canceled: () => canceled };
}
const tick = () => new Promise(setImmediate);
{
  const h = harness(), el = suffix => h.elements.get(`group-launch-${suffix}`);
  assert.equal(h.api.isActive(), false); assert.equal(h.dialog.open, false); assert.equal(h.calls.length, 0);
  h.setBlocked(true); h.event(h.entry); assert.equal(h.api.isActive(), false);
  h.setBlocked(false); h.event(h.entry);
  assert.equal(h.api.isActive(), true); assert.equal(h.dialog.open, true); assert.equal(h.calls.length, 0);
  assert.equal(h.document.activeElement, el('cancel'), 'preview never autofocuses the destructive confirm');
  assert.match(el('title').textContent, /<script>Group<\/script>/, 'untrusted names are assigned as text');
  assert.equal(h.canceled(), 1);
  assert.equal(h.rows().length, 2); assert.equal(h.rows()[0].children[0].checked, true);
  h.event(el('clear')); assert.equal(el('confirm').disabled, true); assert.equal(h.calls.length, 0);
  h.event(el('all')); assert.equal(el('confirm').disabled, false);
  let e = h.event(el('cancel'), 'keydown', { key: '2', altKey: true }); assert.equal(e.stopped, true); assert.equal(e.prevented, false);
  e = h.event(el('cancel'), 'contextmenu'); assert.equal(e.stopped, true); assert.equal(e.prevented, true);
  el('confirm').focus(); e = h.event(el('confirm'), 'keydown', { key: 'Tab' }); assert.equal(e.prevented, true); assert.equal(h.document.activeElement, el('clear'), 'first enabled action (all is already selected)');
  e = h.event(el('clear'), 'keydown', { key: 'Tab', shiftKey: true }); assert.equal(e.prevented, true); assert.equal(h.document.activeElement, el('confirm'));
  h.event(el('cancel'), 'keydown', { key: 'Escape' }); assert.equal(h.api.isActive(), false); assert.equal(h.document.activeElement, h.entry); assert.equal(h.calls.length, 0);
  h.event(h.entry); h.event(el('confirm')); assert.equal(h.api.isPending(), true); assert.equal(h.calls.length, 1);
  h.event(el('confirm')); h.event(el('cancel'), 'keydown', { key: 'Escape' }); h.event(el('cancel'), 'cancel');
  assert.equal(h.calls.length, 1); assert.equal(h.dialog.open, true); assert.equal(h.api.cancel(), false);
  h.finish({ ok: false, reason: 'partial', opened: [item('a').key], failed: [{ ...item('b'), reason: 'create-failed' }] }); await tick();
  assert.equal(h.api.isPending(), false); assert.equal(h.rows()[0].children[0].disabled, true); assert.equal(h.rows()[0].children[0].checked, false);
  assert.equal(h.rows()[1].children[0].checked, true); assert.match(h.rows()[1].children[1].children[3].textContent, /重试/);
  h.event(el('all')); h.event(el('confirm')); assert.deepEqual(h.calls[1], [item('b').key], 'only failures may retry');
  h.finish({ ok: true, opened: [item('b').key], failed: [] }); await tick();
  assert.equal(el('confirm').disabled, true); assert.equal(el('all').disabled, true); assert.match(el('status').textContent, /2/);
  assert.equal(h.document.activeElement, el('cancel')); h.event(el('cancel')); assert.equal(h.api.isActive(), false);
}
{
  const h = harness(Array.from({length: 21}, (_, i) => item(`site${i}`))), el = suffix => h.elements.get(`group-launch-${suffix}`);
  h.event(h.entry); assert.equal(h.rows().length, 21); assert.ok(h.rows().every(row => row.children[0].checked));
  assert.equal(el('confirm').disabled, true); assert.match(el('limit').textContent, /20/);
  h.event(el('confirm')); assert.equal(h.calls.length, 0, 'programmatic confirm cannot bypass limit');
  const check = h.rows()[0].children[0]; check.checked = false; h.event(check, 'change');
  assert.equal(el('confirm').disabled, false); assert.equal(el('limit').textContent, '');
  h.event(el('confirm')); assert.equal(h.calls[0].length, 20);
  h.finish({ ok: false, reason: 'stale', opened: [], failed: [] }); await tick();
  assert.equal(el('confirm').disabled, true); assert.equal(el('all').disabled, true); assert.match(el('status').textContent, /重新预览/);
  h.event(el('confirm')); assert.equal(h.calls.length, 1); h.event(el('cancel'));
}
{
  const h = harness([]), el = suffix => h.elements.get(`group-launch-${suffix}`);
  h.event(h.entry); assert.equal(el('empty').hidden, false); assert.equal(el('confirm').disabled, true); assert.equal(el('all').disabled, true);
  h.event(el('confirm')); assert.equal(h.calls.length, 0); h.event(el('cancel'));
}
console.log('Group launch UI unit regressions passed: inert preview, explicit max-20 confirmation, focus/keyboard isolation, singleflight and partial retry.');
