// Test-only, self-contained so Playwright installs capture and diagnostics in a
// single init script. None of these observations is a startup/readiness signal.
export function installStartupDiagnostics(options) {
  'use strict'; // Playwright serializes this function outside its ESM context.
  const { stripLayoutMirror = false, maxEvents = 128 } = options || {};
  const root = globalThis;
  const perf = root.performance;
  const doc = root.document;
  const nativeMark = perf.mark;
  const nativeNow = perf.now;
  const now = () => Reflect.apply(nativeNow, perf, []);
  const limit = Number.isInteger(maxEvents) ? Math.max(1, Math.min(maxEvents, 256)) : 128;
  const state = root.__startupDiagnostics = {
    events: [], limit, truncated: false, stoppedAt: null, layoutSnapshot: null,
    installed: { storageGet: false, workspaceLock: false },
    hookStatus: { storageGet: 'unavailable', workspaceLock: 'unavailable' }
  };
  let stopped = false;
  let nextId = 0;
  let observedI18n = false;
  const canRecord = () => !stopped && state.events.length < limit;
  function record(type, details = {}, at) {
    if (stopped) return;
    if (!canRecord()) { state.truncated = true; return; }
    state.events.push({ type, at: at === undefined ? now() : at, ...details });
  }

  // This is the existing cold-layout fixture setup, not another storage read.
  if (stripLayoutMirror) {
    try {
      const raw = root.localStorage.getItem('opentab.boot.v1');
      if (raw) {
        const data = JSON.parse(raw);
        delete data.layoutIconSize;
        delete data.layoutColumns;
        delete data.layoutShowNames;
        delete data.layoutMaxWidth;
        root.localStorage.setItem('opentab.boot.v1', JSON.stringify(data));
      }
    } catch {}
  }

  function keyNames(keys) {
    if (keys == null || typeof keys === 'function') return null; // all keys
    if (typeof keys === 'string') return [keys.slice(0, 80)];
    // Never inspect default values or invoke accessor values. Exotic invalid
    // input can fail inspection; only the real API decides whether to throw.
    try {
      if (Array.isArray(keys)) {
        const names = [];
        for (let i = 0; i < Math.min(keys.length, 64); i += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(keys, String(i));
          if (typeof descriptor?.value === 'string') names.push(descriptor.value.slice(0, 80));
        }
        return names;
      }
      if (typeof keys === 'object') return Object.keys(keys).slice(0, 64).map(key => key.slice(0, 80));
    } catch { /* Diagnostics must not replace the native argument validation. */ }
    return [];
  }

  const area = root.chrome?.storage?.local;
  const nativeGet = area?.get;
  function storageGet(...args) {
    if (!canRecord()) return Reflect.apply(nativeGet, this, args);
    const id = ++nextId;
    record('storage-get-invoke', { id, keys: keyNames(args[0]) });
    const callbackIndex = typeof args[1] === 'function' ? 1 : typeof args[0] === 'function' ? 0 : -1;
    if (callbackIndex !== -1) {
      const callback = args[callbackIndex];
      args[callbackIndex] = function (...callbackArgs) {
        record('storage-get-callback', { id });
        return Reflect.apply(callback, this, callbackArgs);
      };
    }
    // No .then(), await, lastError read, extra get, or Promise substitution.
    return Reflect.apply(nativeGet, this, args);
  }
  if (typeof nativeGet === 'function') {
    try {
      area.get = storageGet;
      state.installed.storageGet = area.get === storageGet;
      if (state.installed.storageGet) state.hookStatus.storageGet = 'installed';
    } catch { /* Optional diagnostics cannot make a read-only native API fail. */ }
  }

  const locks = root.navigator?.locks;
  const nativeRequest = locks?.request;
  function requestLock(...args) {
    if (args[0] !== 'opentab-workspace-v1' || !canRecord()) return Reflect.apply(nativeRequest, this, args);
    const id = ++nextId;
    record('workspace-lock-request', { id });
    const callbackIndex = args.length === 2 ? 1 : args.length === 3 ? 2 : -1;
    if (callbackIndex !== -1 && typeof args[callbackIndex] === 'function') {
      const callback = args[callbackIndex];
      args[callbackIndex] = function (...callbackArgs) {
        record(callbackArgs[0] == null ? 'workspace-lock-unavailable' : 'workspace-lock-grant', { id });
        return Reflect.apply(callback, this, callbackArgs);
      };
    }
    return Reflect.apply(nativeRequest, this, args);
  }
  if (typeof nativeRequest === 'function') {
    try {
      locks.request = requestLock;
      state.installed.workspaceLock = locks.request === requestLock;
      if (state.installed.workspaceLock) state.hookStatus.workspaceLock = 'installed';
    } catch { /* Keep the original API and explicitly report unavailable. */ }
  }

  function observeI18n() {
    if (observedI18n || !canRecord()) return;
    const ready = root.OpenTabI18n?.ready;
    if (!(ready instanceof Promise)) return;
    observedI18n = true;
    record('i18n-ready-observed');
    // Observe the existing Promise without replacing it or gating any caller.
    Promise.prototype.then.call(ready,
      () => record('i18n-ready-fulfilled'),
      () => record('i18n-ready-rejected'));
  }
  function resourceLoaded(event) {
    if (!canRecord()) return;
    const element = event.target;
    const script = element?.tagName === 'SCRIPT';
    if (!script && !(element?.tagName === 'LINK' && element.rel === 'stylesheet')) return;
    const source = script ? element.src : element.href;
    if (!source) return;
    const url = new URL(source, root.location.href);
    if (url.protocol !== root.location.protocol || url.host !== root.location.host) return;
    // Local resource paths only: no origin, query strings, fragments, or bodies.
    record('resource-load', { kind: script ? 'script' : 'style', path: url.pathname.slice(0, 160) });
    if (script && url.pathname === '/i18n.js') observeI18n();
  }
  function domReady() { observeI18n(); }
  doc.addEventListener('load', resourceLoaded, true);
  doc.addEventListener('DOMContentLoaded', domReady, true);

  function restoreHook(owner, property, wrapper, native, key) {
    if (!state.installed[key]) return;
    // A page can make an installed method read-only before the grid mark. A
    // failed diagnostic cleanup must not turn that successful real mark into
    // an application exception. A retained wrapper is inert once stopped.
    try {
      if (owner[property] !== wrapper) { state.hookStatus[key] = 'replaced'; return; }
      owner[property] = native;
      state.hookStatus[key] = owner[property] === native ? 'restored' : 'restore-unavailable';
    } catch { state.hookStatus[key] = 'restore-unavailable'; }
  }
  function stop(at) {
    stopped = true;
    state.stoppedAt = at;
    doc.removeEventListener('load', resourceLoaded, true);
    doc.removeEventListener('DOMContentLoaded', domReady, true);
    restoreHook(area, 'get', storageGet, nativeGet, 'storageGet');
    restoreHook(locks, 'request', requestLock, nativeRequest, 'workspaceLock');
  }
  perf.mark = function (...args) {
    const name = args[0];
    const grid = name === 'opentab:grid-ready';
    let snapshotStart, snapshotEnd;
    if (grid) {
      if (!stopped) snapshotStart = now();
      // Preserve the existing computed-style snapshot BEFORE the real mark.
      // Its entire overhead remains included in the unchanged 500 ms budget.
      const cs = root.getComputedStyle(doc.documentElement);
      root.__layoutAtGridReady = {
        iconSize: cs.getPropertyValue('--layout-icon-size').trim(),
        columns: cs.getPropertyValue('--layout-columns').trim(),
        maxWidth: cs.getPropertyValue('--layout-max-width').trim(),
        hideNames: doc.body.classList.contains('layout-hide-names'),
        fixedCols: doc.body.classList.contains('layout-fixed-cols')
      };
      if (!stopped) snapshotEnd = now();
    }
    // Native receiver, arguments, return object and throws stay intact.
    const result = Reflect.apply(nativeMark, this, args);
    if (!stopped) {
      if (grid) {
        state.layoutSnapshot = { start: snapshotStart, end: snapshotEnd, duration: snapshotEnd - snapshotStart };
        record('mark', { name }, result.startTime);
        stop(result.startTime);
      } else if (typeof name === 'string' && /^(?:opentab:boot-(?:start|applied)|opentab:initial-(?:read-start|read-end|validated|loader-start|loader-end))$/.test(name)) {
        record('mark', { name }, result.startTime);
      }
    }
    return result;
  };
}
