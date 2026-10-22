(function (root) {
  'use strict';
  function createFocus() {
    const stack = [];
    function isFocusable(el) {
      if (!el || !document.contains(el) || typeof el.focus !== 'function' || el.disabled) return false;
      if (el.closest('.hidden')) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }
    function rememberFocus(el) {
      const target = el || document.activeElement;
      if (!target || target === document.body) return;
      const selector = target.matches('.icon-widget[data-id]')
        ? `.icon-widget[data-id="${CSS.escape(target.dataset.id)}"]`
        : target.matches('#add-shortcut-tile, .add-shortcut-tile') ? '#add-shortcut-tile, .add-shortcut-tile' : null;
      stack.push({ target, parent: target.parentElement, selector });
    }
    function restoreFocus() {
      while (stack.length) {
        const { target, parent, selector } = stack.pop();
        // Re-rendered shortcuts keep their identity, even when their DOM nodes change.
        const el = document.contains(target) ? target : selector && parent?.querySelector(selector);
        if (isFocusable(el)) { el.focus(); return el; }
      }
      return null;
    }
    return { rememberFocus, restoreFocus };
  }
  root.OpenTabAccessibility = { createFocus };
})(typeof globalThis !== 'undefined' ? globalThis : window);
