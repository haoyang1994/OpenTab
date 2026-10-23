// Packaged calendar dependencies are optional until the user opens the calendar.
(function (root) {
  'use strict';
  let pending = null, ready = false;
  const loaded = new Set(), loading = new Map();
  function asset(path, style = false, valid = () => true) {
    if (loaded.has(path)) return Promise.resolve();
    if (loading.has(path)) return loading.get(path);
    const promise = new Promise((resolve, reject) => {
      const node = root.document.createElement(style ? 'link' : 'script');
      if (style) { node.rel = 'stylesheet'; node.href = path; }
      else node.src = path;
      const fail = () => { node.remove(); reject(new Error('Calendar asset failed: ' + path)); };
      node.onload = () => {
        if (!valid()) { fail(); return; }
        loaded.add(path); resolve();
      };
      node.onerror = fail;
      // Keep vendor styles below our overrides in cascade precedence.
      if (style) root.document.head.insertBefore(node, root.document.querySelector('link[href="home.css"]'));
      else root.document.head.appendChild(node);
    }).finally(() => { loading.delete(path); });
    loading.set(path, promise);
    return promise;
  }
  root.OpenTabCalendarAssets = {
    isReady: () => ready,
    load() {
      if (ready) return Promise.resolve();
      if (pending) return pending;
      // CSS and core may load concurrently; the locale must execute after core.
      const work = Promise.all([
        asset('vendor/flatpickr/flatpickr.min.css', true),
        asset('vendor/flatpickr/flatpickr.min.js', false, () => typeof root.flatpickr === 'function')
          .then(() => asset('vendor/flatpickr/l10n/zh.js', false, () => !!root.flatpickr?.l10ns?.zh))
      ]).then(() => { ready = true; });
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = root.setTimeout(() => reject(new Error('Calendar loading timed out')), 10000);
      });
      // A timeout releases the UI, not the resource: removing a script cannot
      // guarantee cancellation. Reopening joins any still-loading node rather
      // than executing duplicate scripts after an uncertain late completion.
      pending = Promise.race([work, timeout]).finally(() => {
        root.clearTimeout(timer); pending = null;
      });
      return pending;
    }
  };
})(globalThis);
