import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { value: '', selectionStart: 0, selectionEnd: 0, handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; } });
  return nodes.get(id);
}
vm.runInNewContext(fs.readFileSync(new URL('../tool.js', import.meta.url), 'utf8'), {
  document: { getElementById: node }
});
const input = node('input-area');
function key(key, modifiers = {}) {
  input.value = 'abcd'; input.selectionStart = 1; input.selectionEnd = 3;
  let prevented = false;
  const event = { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    isComposing: false, keyCode: 0, defaultPrevented: false, ...modifiers,
    preventDefault() { prevented = true; } };
  input.handlers.keydown(event);
  return { prevented, value: input.value, start: input.selectionStart, end: input.selectionEnd };
}
const untouched = { prevented: false, value: 'abcd', start: 1, end: 3 };
assert.deepEqual(key('Tab'), untouched, 'Tab leaves the editor without editing');
assert.deepEqual(key('Tab', { shiftKey: true }), untouched, 'Shift+Tab leaves backwards without editing');
assert.deepEqual(key('Tab', { ctrlKey: true }), untouched);
assert.deepEqual(key('Escape'), untouched);
assert.deepEqual(key(']'), untouched);
for (const modifiers of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
  { altKey: true }, { metaKey: true }, { shiftKey: true }]) {
  assert.deepEqual(key(']', { ctrlKey: true, ...modifiers }), untouched);
}
assert.deepEqual(key(']', { ctrlKey: true }), { prevented: true, value: 'a  d', start: 3, end: 3 });
const html = fs.readFileSync(new URL('../tool.html', import.meta.url), 'utf8');
assert.match(html, /<label[^>]*for="input-area"/);
assert.match(html, /aria-keyshortcuts="Control\+\]"/);
assert.doesNotMatch(html, /input-keyboard-hint/, 'no visible keyboard tutorial or dangling description reference');
console.log('JSON keyboard tests passed: native Tab/Shift+Tab, input preservation, explicit indent and IME/modifier guards');
