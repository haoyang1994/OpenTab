import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../folders.js', import.meta.url), 'utf8');

// Eventful unit fixture for the real group renderer/handler, not OS-key evidence.
function harness(navigator = { platform: 'Linux x86_64' }) {
  class Element {
    constructor(tag = 'div', parent = null) {
      this.tagName = tag.toUpperCase(); this.parentElement = parent;
      this.children = []; this.attributes = new Map(); this.events = new Map(); this.dataset = {};
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    set title(value) { this.setAttribute('title', value); }
    get title() { return this.getAttribute('title') || ''; }
    set innerHTML(value) { assert.equal(value, ''); this.children = []; }
    appendChild(node) { this.children.push(node); node.parentElement = this; }
    addEventListener(type, fn) { this.events.set(type, fn); }
    querySelector() { return null; }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector.split(',').some(part => {
          part = part.trim();
          if (part === '[contenteditable]') return node.getAttribute('contenteditable') !== null;
          if (part === '[role="textbox"]') return node.getAttribute('role') === 'textbox';
          return node.tagName.toLowerCase() === part;
        })) return node;
      }
      return null;
    }
  }
  const tabs = new Element(), events = new Map(), calls = [];
  const body = new Element('body'); let zen = false;
  body.classList = { contains: value => value === 'zen-mode' && zen };
  const document = { body, createElement: tag => new Element(tag),
    getElementById: id => id === 'group-tabs' ? tabs : null,
    addEventListener: (type, fn) => events.set(type, fn) };
  const window = { navigator };
  vm.runInNewContext(source, { window, document });
  const api = window.OpenTabFolders;
  const state = { folders: Array.from({ length: 10 }, (_, index) => ({ id: `group-${index + 1}`, name: `Group ${index + 1}` })),
    currentFolderId: 'group-10', icons: [] };
  api.init({ state, getIconsContainer: () => null, selectFolder(id) { calls.push(id); state.currentFolderId = id; return true; } });
  api.renderChrome();
  const press = (extra = {}) => {
    const event = { key: '2', code: 'Digit2', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
      defaultPrevented: false, target: body, preventDefault() { this.defaultPrevented = true; }, ...extra };
    events.get('keydown')(event); return event;
  };
  return { api, tabs, calls, state, press, element: (tag, parent) => new Element(tag, parent), zen: value => { zen = value; } };
}

const platforms = [
  [{ userAgentData: { platform: 'macOS' }, platform: 'Linux x86_64' }, true, 'UA-data macOS'],
  [{ platform: 'MacIntel' }, true, 'legacy MacIntel'],
  [{ platform: 'MacPPC' }, true, 'legacy MacPPC'],
  [{ userAgentData: { platform: '' }, platform: 'MacIntel' }, true, 'empty UA-data falls back'],
  [{ userAgentData: {}, platform: 'MacIntel' }, true, 'missing UA-data platform falls back'],
  [{ userAgentData: null, platform: 'MacIntel' }, true, 'null UA-data falls back'],
  [{ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }, false, 'UA-data remains authoritative'],
  [{ userAgentData: { platform: 'Windows' }, platform: 'Win32' }, false, 'UA-data Windows'],
  [{ platform: 'Win32' }, false, 'legacy Windows'],
  [{ userAgentData: { platform: 'Linux' } }, false, 'UA-data Linux'],
  [{ platform: 'Linux x86_64' }, false, 'legacy Linux'],
  [{}, false, 'unavailable platform preserves existing defaults']
];
for (const [navigator, mac, label] of platforms) {
  const h = harness(navigator);
  assert.deepEqual(h.tabs.children.map(tab => tab.title), Array.from({ length: 10 }, (_, index) => !mac && index < 9 ? `Alt+${index + 1}` : ''), label);
  for (const tab of h.tabs.children) assert.equal(tab.getAttribute('aria-keyshortcuts'), null, 'no hidden/dead group shortcut is advertised');
  for (let digit = 1; digit <= 9; digit++) {
    h.state.currentFolderId = 'group-10';
    const event = h.press({ key: String(digit), code: `Digit${digit}` });
    assert.equal(event.defaultPrevented, !mac, `${label}: Alt+${digit} cancellation`);
    assert.equal(h.state.currentFolderId, mac ? 'group-10' : `group-${digit}`, `${label}: Alt+${digit} navigation`);
  }
  // Mac Option can produce a non-digit key while code still says Digit2.
  h.state.currentFolderId = 'group-10';
  assert.equal(h.press({ key: '™', code: 'Digit2' }).defaultPrevented, !mac, `${label}: physical code is platform-gated`);
  assert.equal(h.state.currentFolderId, mac ? 'group-10' : 'group-2');
  h.tabs.children[2].events.get('click')();
  assert.equal(h.state.currentFolderId, 'group-3', `${label}: click navigation stays intact`);
  h.api.selectGroup('group-4', true);
  assert.equal(h.state.currentFolderId, 'group-4', `${label}: existing programmatic/palette destination stays intact`);
}

for (const [navigator, , label] of platforms) {
  const h = harness(navigator);
  for (const extra of [
    { altKey: false }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
    { altKey: false, metaKey: true }, { altKey: false, ctrlKey: true },
    { key: 'ArrowLeft', code: 'ArrowLeft' }, { key: '0', code: 'Digit0' },
    { key: '2', code: 'Numpad2' }, { key: '2', code: '' },
    { isComposing: true }, { keyCode: 229 }, { which: 229 }, { key: 'Process' }, { key: 'Dead' }
  ]) {
    assert.equal(h.press(extra).defaultPrevented, false, `${label}: ignored event ${JSON.stringify(extra)} keeps its native default`);
    assert.equal(h.state.currentFolderId, 'group-10');
  }
  assert.equal(h.press({ defaultPrevented: true }).defaultPrevented, true);
  assert.equal(h.calls.length, 0, 'an already handled event never triggers navigation');
  for (const kind of ['input', 'textarea', 'select', 'contenteditable', 'textbox']) {
    const element = h.element(['contenteditable', 'textbox'].includes(kind) ? 'div' : kind);
    if (kind === 'contenteditable') element.setAttribute('contenteditable', 'true');
    if (kind === 'textbox') element.setAttribute('role', 'textbox');
    for (const target of [element, h.element('span', element)]) {
      assert.equal(h.press({ target }).defaultPrevented, false, `${label}: ${kind} typing/descendants remain native`);
      assert.equal(h.state.currentFolderId, 'group-10');
    }
  }
  h.zen(true); assert.equal(h.press().defaultPrevented, false); assert.equal(h.calls.length, 0, 'hidden Zen groups remain inactive');
}

{
  const h = harness(); h.state.folders.length = 1;
  assert.equal(h.press().defaultPrevented, false, 'missing group never consumes a key');
  assert.equal(h.calls.length, 0);
}
console.log('Group shortcut units passed: Mac Option/digit keys untouched and unadvertised, Windows/Linux defaults retained, UA-data fallback, typing/IME/browser guards, and click/API navigation.');
