(function (root, factory) {
  const node = typeof module === 'object' && !!module.exports;
  const api = factory(root, node);
  if (node) module.exports = api;
  if (root) root.OpenTabWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, node) {
  'use strict';
  const LOCK_NAME = 'opentab-workspace-v1';
  const EPOCH_KEY = 'opentab.workspaceEpoch';
  const ENTITIES = ['icons', 'folders', 'todos'];
  const KEYS = ['icons', 'folders', 'currentFolderId', 'todos', 'todoPanelOpen', 'background', 'clockFormat', 'showSeconds', 'uiOpacity', 'uiBlur', 'iconFrameEnabled', 'openInNewTab', 'timezone', 'bingIndex', 'themeMode', 'accentHue', 'particlesEnabled', 'gradientFlow', 'minimalMode', EPOCH_KEY];
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
    return value;
  }
  const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  function conflict() { const error = new Error('其他标签页已修改此内容，请刷新后重试。'); error.code = 'WORKSPACE_CONFLICT'; return error; }
  function records(list, tolerant = false) {
    const map = new Map();
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item.id !== 'string' || !item.id || map.has(item.id)) {
        if (tolerant) continue;
        throw conflict();
      }
      map.set(item.id, item);
    }
    return map;
  }
  function recordEqual(a, b) {
    // Secrets are held separately by the existing encrypted vault wrapper.
    const clean = (item) => item && Object.fromEntries(Object.entries(item).filter(([key]) => !['sshPassword', 'sshGatewayToken', 'sshSocksPassword'].includes(key)));
    return equal(clean(a), clean(b));
  }
  function mergeEntities(base = [], next = [], latest = [], check = true) {
    const before = records(base, true), after = records(next), current = records(latest, true);
    const previousOrder = [...current.keys()];
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id), chosen = after.get(id), live = current.get(id);
      if (equal(old, chosen)) continue;
      if (check && !recordEqual(live, old) && !recordEqual(live, chosen)) throw conflict();
      if (chosen === undefined) current.delete(id);
      else current.set(id, clone(chosen));
    }
    const retained = [...before.keys()].filter((id) => after.has(id));
    const desired = [...after.keys()].filter((id) => before.has(id));
    let order = previousOrder.filter((id) => current.has(id));
    if (!equal(retained, desired)) {
      const liveOrder = previousOrder.filter((id) => before.has(id) && after.has(id));
      if (check && !equal(liveOrder, retained) && !equal(liveOrder, desired)) throw conflict();
      order = [...after.keys()].filter((id) => current.has(id)).concat(order.filter((id) => !after.has(id)));
    }
    for (const id of current.keys()) if (!order.includes(id)) order.push(id);
    return order.map((id) => current.get(id));
  }
  function merge(base = {}, next = {}, latest = {}) {
    const result = clone(latest);
    const graphChanged = ENTITIES.some((key) => Object.hasOwn(next, key) && !equal(base[key], next[key]));
    if (graphChanged && (base[EPOCH_KEY] || 0) !== (latest[EPOCH_KEY] || 0)) throw conflict();
    for (const key of Object.keys(next)) {
      if (key === EPOCH_KEY || equal(base[key], next[key])) continue;
      if (ENTITIES.includes(key)) result[key] = mergeEntities(base[key], next[key], latest[key]);
      else {
        if (!equal(latest[key], base[key]) && !equal(latest[key], next[key])) throw conflict();
        result[key] = clone(next[key]);
      }
    }
    if (graphChanged && Array.isArray(result.icons)) {
      const icons = records(result.icons), groups = records(result.folders || []);
      for (const icon of result.icons) {
        if (icon.folderId && groups.size && !groups.has(icon.folderId)) throw conflict();
        if (icon.parentId && (!icons.has(icon.parentId) || icons.get(icon.parentId).type !== 'folder'
          || icon.type === 'folder' || (icon.folderId || 'folder-home') !== (icons.get(icon.parentId).folderId || 'folder-home'))) throw conflict();
      }
      for (const group of groups.values()) {
        const seen = new Set([group.id]);
        let parent = group.parentId;
        while (parent && groups.has(parent)) {
          if (seen.has(parent)) throw conflict();
          seen.add(parent); parent = groups.get(parent).parentId;
        }
      }
      if (result.currentFolderId && groups.size && !groups.has(result.currentFolderId)) result.currentFolderId = groups.has('folder-home') ? 'folder-home' : groups.keys().next().value;
    }
    return result;
  }
  function migrationOverrides(stored, view) {
    const overrides = {};
    const oldFolders = Array.isArray(stored.folders) ? stored.folders.map((item) => item && ({ id: String(item.id || ''), name: String(item.name || '') })) : [];
    if (!equal(oldFolders, view.folders)) overrides.folders = oldFolders;
    const oldIcons = new Map((stored.icons || []).filter(Boolean).map((item) => [item.id, item]));
    const priorIcons = (view.icons || []).map((item) => {
      const old = oldIcons.get(item.id);
      if (!old) return item;
      const before = { ...item };
      for (const key of ['folderId', 'parentId']) {
        if ((old[key] || '') !== (item[key] || '')) before[key] = old[key];
      }
      return before;
    });
    if (!equal(priorIcons, view.icons)) overrides.icons = priorIcons;
    if (stored.currentFolderId && stored.currentFolderId !== view.currentFolderId) overrides.currentFolderId = stored.currentFolderId;
    return overrides;
  }
  function call(chrome, method, arg) {
    return new Promise((resolve, reject) => {
      let returned;
      const callback = (value) => {
        const error = chrome.runtime && chrome.runtime.lastError;
        queueMicrotask(() => {
          if (returned && typeof returned.then === 'function') return;
          if (error) reject(new Error(error.message || '保存失败，请重试。')); else resolve(value);
        });
      };
      try { returned = method(arg, callback); }
      catch (error) { reject(error); return; }
      if (returned && typeof returned.then === 'function') returned.then(resolve, reject);
    });
  }
  function createAPI(getChrome, getLocks) {
    function transaction(task) {
      const locks = getLocks();
      if (!locks || typeof locks.request !== 'function') return Promise.reject(new Error('浏览器暂不支持安全保存，请更新 Chrome 后重试。'));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      return Promise.resolve().then(() => locks.request(LOCK_NAME, { mode: 'exclusive', signal: controller.signal }, async () => {
        clearTimeout(timer);
        const chrome = getChrome(), area = chrome.storage.local;
        const read = async (keys = null) => (await call(chrome, area.get.bind(area), keys)) || {};
        const write = (payload) => call(chrome, area.set.bind(area), payload);
        return task({ read, write, merge });
      })).catch((error) => {
        if (error.name === 'AbortError') throw new Error('保存等待超时，请重试。');
        throw error;
      }).finally(() => clearTimeout(timer));
    }
    const read = (keys = KEYS) => transaction((tx) => tx.read(keys));
    const commit = (base, next) => transaction(async (tx) => {
      const latest = await tx.read([...new Set(KEYS.concat(Object.keys(base), Object.keys(next)))]), merged = merge(base, next, latest);
      const patch = Object.fromEntries(Object.keys(merged).filter((key) => !equal(latest[key], merged[key])).map((key) => [key, merged[key]]));
      if (Object.keys(patch).length) await tx.write(patch);
      return { ...merged };
    });
    const replace = (payload) => transaction(async (tx) => {
      const current = await tx.read(null);
      const value = typeof payload === 'function' ? await payload(clone(current)) : payload;
      const patch = { ...value, [EPOCH_KEY]: (Number(current[EPOCH_KEY]) || 0) + 1 };
      await tx.write(patch);
      return { ...current, ...patch };
    });
    function createSession(initial, initialView = initial) {
      let expected = clone(initial), view = clone(initialView), queue = Promise.resolve(), serial = 0, broken = false;
      return {
        rebase(persisted, currentView = persisted) { expected = clone(persisted); view = clone(currentView); },
        save(snapshot) {
          const selected = clone(snapshot), base = clone(expected), next = clone(expected), ticket = ++serial;
          for (const key of Object.keys(selected)) {
            if (key !== EPOCH_KEY && !equal(view[key], selected[key])) {
              next[key] = ENTITIES.includes(key)
                ? mergeEntities(view[key], selected[key], expected[key], false) : clone(selected[key]);
            }
          }
          expected = clone(next); view = selected;
          const result = queue.then(async () => {
            if (broken) throw conflict();
            try {
              const saved = await commit(base, next);
              return { state: saved, current: ticket === serial };
            } catch (error) { broken = true; throw error; }
          });
          queue = result.catch(() => {});
          return result;
        }
      };
    }
    function connect({ state, onChange, onError, onSaved }) {
      let session = null, committed = null;
      const pick = (value) => Object.fromEntries(KEYS.filter((key) => Object.hasOwn(value, key)).map((key) => [key, clone(value[key])]));
      function apply(saved) {
        let changed = false;
        for (const key of KEYS) {
          if (key === EPOCH_KEY || !Object.hasOwn(saved, key)) continue;
          if (!equal(state[key], saved[key])) { state[key] = clone(saved[key]); changed = true; }
        }
        if (changed && onChange) onChange();
      }
      function seed(stored, viewOverrides = {}) { committed = pick(state); session = createSession(pick(stored), { ...committed, ...viewOverrides }); }
      function save(_rollback, onOk) {
        if (!session) {
          if (committed) apply(committed);
          if (onError) onError(new Error('保存暂不可用，请重新打开标签页。'));
          return Promise.resolve(false);
        }
        const active = session;
        return active.save(pick(state)).then((result) => {
          if (active !== session) return false;
          committed = { ...committed, ...pick(result.state) };
          if (result.current) {
            apply(result.state);
            active.rebase(result.state, pick(state));
          }
          if (onOk) onOk();
          if (onSaved) onSaved();
          return true;
        }).catch(async (error) => {
          if (active !== session) return false;
          session = null; // Reject queued edits from the failed baseline.
          if (onError) onError(error);
          try { const latest = await read(); apply({ ...committed, ...latest }); seed(latest); }
          catch (_) { if (committed) apply(committed); } // Never keep an unsaved optimistic edit.
          if (onSaved) onSaved();
          return false;
        });
      }
      return { seed, save };
    }
    return { transaction, read, commit, replace, createSession, connect, merge, migrationOverrides, LOCK_NAME, EPOCH_KEY, KEYS };
  }
  const api = createAPI(() => root.chrome, () => root.navigator && root.navigator.locks);
  if (node) {
    const adapters = new WeakMap();
    api.forChrome = (chrome) => {
      const key = chrome.storage.local;
      if (!adapters.has(key)) {
        let queue = Promise.resolve();
        const locks = { request(_name, _opts, task) { const pending = queue.then(task); queue = pending.catch(() => {}); return pending; } };
        adapters.set(key, createAPI(() => chrome, () => locks));
      }
      return adapters.get(key);
    };
  }
  return api;
});
