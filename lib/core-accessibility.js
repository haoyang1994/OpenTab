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
  function createFeedback({ toast, getWorkspace, t }) {
    let pendingUndo = null, undoPending = false, toastTimer = 0;
    function offerUndo(action, valid = () => true, intent = getWorkspace().captureIntent()) {
      pendingUndo = { action, valid, intent };
    }
    function canUndo() {
      try { return !!pendingUndo && !undoPending && pendingUndo.valid() === true && (!pendingUndo.intent || getWorkspace().isIntentCurrent(pendingUndo.intent)); }
      catch (_) { return false; }
    }
    async function undoLastAction() {
      if (!canUndo()) return false;
      const record = pendingUndo; pendingUndo = null; undoPending = true;
      try {
        const result = await record.action();
        if (result === false && !pendingUndo) pendingUndo = record;
        return result !== false;
      } catch (_) { showToast(t('保存失败，请重试。')); return false; }
      finally { undoPending = false; }
    }
    function handleUndo(event) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey) || event.key?.toLowerCase() !== 'z') return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') || document.querySelector('dialog[open], .modal:not(.hidden), #settings-panel:not(.hidden), .desktop-drag-active')) return;
      if (canUndo()) { event.preventDefault(); void undoLastAction(); }
    }
    function showToast(text, options) {
      if (!toast) return;
      const opts = options || {};
      if (!text && opts.source && toast.dataset.source !== opts.source) return;
      clearTimeout(toastTimer); toast.replaceChildren(); toast.classList.add('hidden');
      // Successful actions register a guarded inverse, without a visual notice.
      if (opts.onAction) { offerUndo(opts.onAction, () => true, opts.intent); return; }
      if (!text || opts.kind === 'success' || opts.kind === 'inline') return;
      toast.dataset.source = opts.source || 'page'; toast.append(document.createTextNode(text));
      const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×';
      dismiss.setAttribute('aria-label', t('关闭')); dismiss.onclick = () => { clearTimeout(toastTimer); toast.classList.add('hidden'); };
      toast.append(dismiss); toast.classList.remove('hidden');
      toastTimer = setTimeout(() => toast.classList.add('hidden'), opts.duration || 5000);
    }

    return { offerUndo, canUndo, undo: undoLastAction, handleKeydown: handleUndo, showError: showToast };
  }
  root.OpenTabAccessibility = { createFocus, createFeedback };
})(typeof globalThis !== 'undefined' ? globalThis : window);
