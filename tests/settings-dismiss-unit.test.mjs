import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Load the entire production module and dispatch through its registered capture
// handlers. No extracted/reimplemented dismissal logic or browser dependency.
function harness() {
  const listeners = new Map(), nodes = new Map();
  let doc, busy = false, restored = 0, remembered = null, backgroundActions = 0;
  function node(id, hidden = false, parent = null) {
    const classes = new Set(hidden ? ['hidden'] : []), handlers = new Map();
    const el = {
      id, parent, hidden: false, value: '', disabled: false, dataset: {}, open: false,
      classList: { contains: v => classes.has(v), add: v => classes.add(v), remove: v => classes.delete(v), toggle(v, on) { on ? classes.add(v) : classes.delete(v); } },
      contains(target) { return target === this || !!target?.parent && this.contains(target.parent); },
      closest(selector) { return selector === '.hidden' && (classes.has('hidden') || parent?.closest(selector)) ? this : null; },
      querySelectorAll() { return []; },
      querySelector(selector) { return selector === '[aria-busy="true"]' && this.busy ? {} : null; },
      addEventListener(type, fn) { handlers.set(type, fn); },
      focus() { doc.activeElement = this; },
      handlers
    };
    nodes.set(id, el); return el;
  }
  const panel = node('settings-panel', true), opener = node('settings-btn');
  const search = node('settings-search', false, panel), draft = node('custom-bg-url', false, panel);
  const outside = node('underlying-delete');
  outside.handlers.set('click', () => { backgroundActions++; });
  const nested = node('inline-dialog', true);
  const selection = node('site-selection-dialog');
  doc = {
    readyState: 'loading', activeElement: opener,
    getElementById: id => nodes.get(id) || null,
    querySelectorAll: () => [],
    querySelector: selector => selector.includes('dialog[open]') && selection.open ? selection : null,
    addEventListener(type, fn, capture) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push({ fn, capture }); }
  };
  const context = { window: {}, document: doc, OpenTabSiteList: { isBusy: () => busy } };
  vm.runInNewContext(fs.readFileSync(new URL('../settings-nav.js', import.meta.url), 'utf8'), context);
  const api = context.OpenTabSettingsNav;
  api.init({ rememberFocus(el) { remembered = el; }, restoreFocus() { restored++; remembered?.focus(); } });
  function dispatch(type, target = outside, values = {}) {
    const event = { type, target, isTrusted: true, button: 0, key: '', defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
    for (const { fn } of listeners.get(type) || []) { fn(event); if (event.stopped) break; }
    if (!event.stopped) target.handlers.get(type)?.(event);
    return event;
  }
  function click(target = outside, values) { dispatch('pointerdown', target, values); return dispatch('click', target, values); }
  return { api, panel, opener, search, draft, outside, nested, selection, doc, dispatch, click,
    setBusy(value) { busy = value; }, isOpen: () => !panel.classList.contains('hidden'),
    restored: () => restored, backgroundActions: () => backgroundActions };
}
{
  const h = harness();
  h.click(h.opener);
  assert.equal(h.isOpen(), true, 'opening gesture does not immediately dismiss');
  h.draft.value = 'https://unfinished.example/';
  h.search.value = 'wallpaper';
  assert.equal(h.click(h.draft).defaultPrevented, false, 'inside fields remain interactive');
  assert.equal(h.isOpen(), true);
  assert.equal(h.dispatch('pointerdown').defaultPrevented, true, 'outside press cannot focus or activate underlying controls');
  assert.equal(h.isOpen(), true, 'wait for click, allowing pointer cancellation');
  assert.equal(h.dispatch('click').defaultPrevented, true);
  assert.equal(h.isOpen(), false);
  assert.equal(h.backgroundActions(), 0, 'dismissal does not trigger an underlying destructive click');
  assert.equal(h.doc.activeElement, h.opener, 'focus returns to opener');
  h.click(h.opener);
  assert.equal(h.search.value, 'wallpaper', 'outside dismissal preserves filter draft');
  assert.equal(h.draft.value, 'https://unfinished.example/', 'unapplied fields survive reopen');
  h.api.open();
  assert.equal(h.search.value, 'wallpaper', 'repeated open is idempotent');
  h.api.openSection('sync');
  assert.equal(h.search.value, '', 'explicit section navigation reveals its destination despite preserved filter');
  assert.equal(h.api.getActiveId(), 'sync');
  h.click();
  assert.equal(h.restored(), 2);
  h.click();
  assert.equal(h.backgroundActions(), 1, 'later intentional click works after dismissal');
}
{
  const h = harness(); h.api.open();
  h.nested.classList.remove('hidden');
  assert.equal(h.click(h.nested).defaultPrevented, false);
  assert.equal(h.isOpen(), true, 'nested confirmation is not dismissed');
  h.nested.classList.add('hidden'); h.selection.open = true;
  assert.equal(h.click(h.selection).defaultPrevented, false);
  assert.equal(h.dispatch('keydown', h.selection, { key: 'Tab' }).defaultPrevented, false, 'native selection dialog retains native Tab behavior');
  h.selection.open = false;
  h.setBusy(true); assert.equal(h.click().defaultPrevented, true); assert.equal(h.isOpen(), true, 'import commit lock is respected');
  h.setBusy(false); h.panel.busy = true; h.click(); assert.equal(h.isOpen(), true, 'pending preview/save aria-busy is respected');
  h.panel.busy = false; h.click(); assert.equal(h.isOpen(), false);
}
{
  const h = harness(); h.api.open();
  h.dispatch('pointerdown', h.draft); h.dispatch('click');
  assert.equal(h.isOpen(), true, 'slider/selection gestures begun inside cannot dismiss');
  assert.equal(h.backgroundActions(), 0);
  h.dispatch('pointerdown'); h.dispatch('pointercancel');
  assert.equal(h.isOpen(), true, 'cancelled touch leaves panel open');
  h.dispatch('dragstart', h.draft); h.click(); assert.equal(h.isOpen(), true);
  h.dispatch('dragend', h.draft); h.click(); assert.equal(h.isOpen(), false);
  h.api.open(); h.dispatch('click', h.outside, { detail: 0 });
  assert.equal(h.isOpen(), false, 'keyboard/AT outside activation dismisses without a pointer event');
  assert.equal(h.backgroundActions(), 0);
  h.api.open(); h.dispatch('click', h.outside, { isTrusted: false });
  assert.equal(h.isOpen(), true, 'application-generated backup download clicks do not dismiss');
  h.click(h.outside, { button: 2 }); assert.equal(h.isOpen(), true, 'secondary/context-menu interaction remains available');
}
console.log('Settings outside dismissal production-handler unit tests passed.');
