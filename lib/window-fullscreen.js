(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabWindowFullscreen = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const COMMAND = 'toggle-window-fullscreen';
  const ENABLED_KEY = 'windowFullscreenShortcutEnabled';
  const RESTORE_PREFIX = 'opentab.windowFullscreen.';
  const validId = id => Number.isInteger(id) && id >= 0;
  const restorable = state => state === 'normal' || state === 'maximized';

  function create(chrome) {
    let queue = Promise.resolve();
    const enabled = async () => (await chrome.storage.local.get(ENABLED_KEY))[ENABLED_KEY] === true;
    const enqueue = task => {
      const result = queue.then(task).catch(() => ({ success: false, reason: 'api-error' }));
      queue = result;
      return result;
    };
    async function target(tab) {
      // An explicit target that closed or became invalid must not redirect the
      // command to some other window. URLs are irrelevant to the windows API.
      const window = validId(tab?.windowId)
        ? await chrome.windows.get(tab.windowId)
        : await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      return validId(window?.id) && window.type === 'normal' ? window : null;
    }
    function toggle(tab) {
      // Capture permission at invocation as well as at the action boundary:
      // queued commands issued while disabled must never become authorized later.
      const allowed = enabled().catch(() => false);
      return enqueue(async () => {
        if (!await allowed || !await enabled()) return { success: false, reason: 'disabled' };
        let window;
        try { window = await target(tab); }
        catch (_) { return { success: false, reason: 'window-unavailable' }; }
        if (!window || (!restorable(window.state) && window.state !== 'fullscreen')) {
          return { success: false, reason: 'window-unavailable' };
        }
        const key = RESTORE_PREFIX + window.id;
        const entering = window.state !== 'fullscreen';
        const saved = entering ? window.state : (await chrome.storage.session.get(key))[key];
        const next = entering ? 'fullscreen' : (restorable(saved) ? saved : 'normal');
        // Session storage survives worker suspension, but not a browser restart
        // where window IDs can be reused. Fail closed if it cannot be saved.
        if (entering) await chrome.storage.session.set({ [key]: saved });
        if (!await enabled()) return { success: false, reason: 'disabled' };
        await chrome.windows.update(window.id, { state: next });
        if (!entering) {
          // Cleanup failure cannot turn a completed window action into a retry.
          // The next entry overwrites this key with the then-current state.
          try { await chrome.storage.session.remove(key); } catch (_) {}
        }
        return { success: true, windowId: window.id, state: next };
      });
    }
    function removed(id) {
      return enqueue(async () => {
        if (validId(id)) await chrome.storage.session.remove(RESTORE_PREFIX + id);
      });
    }
    return { toggle, removed };
  }
  return { COMMAND, ENABLED_KEY, RESTORE_PREFIX, create };
}));
