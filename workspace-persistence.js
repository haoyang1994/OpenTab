(function (root, factory) {
  const node = typeof module === 'object' && !!module.exports;
  const api = factory(root, node);
  if (node) module.exports = api;
  if (root) root.OpenTabWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, node) {
  'use strict';
  const t = (source) => root.OpenTabI18n ? root.OpenTabI18n.t(source) : source;
  const LOCK_NAME = 'opentab-workspace-v1';
  const EPOCH_KEY = 'opentab.workspaceEpoch';
  const SCHEMA_KEY = 'opentab.sceneSchemaVersion';
  const ENTITIES = ['icons', 'folders', 'todos', 'scenes', 'sceneProfiles'];
  const SCENE_GRAPH_KEYS = [SCHEMA_KEY, ...ENTITIES];
  const SCENE_VIEW_KEYS = ['currentFolderId', 'background', 'bingIndex'];
  function sceneSchema() { return root.OpenTabSceneSchema || (node ? require('./scene-schema.js') : null); }
  function validateSceneState(value) {
    if (!Object.hasOwn(value, SCHEMA_KEY) && !Object.hasOwn(value, 'scenes') && !Object.hasOwn(value, 'sceneProfiles')
      && !['icons', 'folders', 'todos'].some(key => Array.isArray(value[key]) && value[key].some(item => item && Object.hasOwn(item, 'sceneId')))) return;
    const schema = sceneSchema();
    if (!schema) throw Object.assign(new Error('Scene data requires a compatible OpenTab version. Data is unchanged.'), { code: 'SCENE_SCHEMA_UNAVAILABLE' });
    schema.validate(value);
  }
  const KEYS = ['icons', 'folders', 'currentFolderId', 'todos', 'todoPanelOpen', 'background', 'clockFormat', 'showSeconds', 'uiOpacity', 'uiBlur', 'iconFrameEnabled', 'openInNewTab', 'windowFullscreenShortcutEnabled', 'timezone', 'timezoneMode', 'bingIndex', 'themeMode', 'accentHue', 'particlesEnabled', 'gradientFlow', 'minimalMode', SCHEMA_KEY, 'scenes', 'sceneProfiles', 'lastOpenedSceneId', 'todoButtonVisible', EPOCH_KEY];
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
    return value;
  }
  const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  function conflict() { const error = new Error(t('其他标签页已修改此内容，请刷新后重试。')); error.code = 'WORKSPACE_CONFLICT'; return error; }
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
    const chosenOrder = [...after.keys()];
    for (const id of current.keys()) if (!order.includes(id)) {
      const anchor = chosenOrder.slice(chosenOrder.indexOf(id) + 1).find((key) => order.includes(key));
      if (anchor) order.splice(order.indexOf(anchor), 0, id); else order.push(id);
    }
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
    validateSceneState(result);
    return result;
  }
  function migrationOverrides(stored, view) {
    const overrides = {};
    const oldFolders = Array.isArray(stored.folders) ? (stored[SCHEMA_KEY] === 2 ? clone(stored.folders) : stored.folders.map((item) => item && ({ id: String(item.id || ''), name: String(item.name || '') }))) : [];
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
          if (error) reject(new Error(error.message || t('保存失败，请重试。'))); else resolve(value);
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
      if (!locks || typeof locks.request !== 'function') return Promise.reject(new Error(t('浏览器暂不支持安全保存，请更新浏览器后重试。')));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      return Promise.resolve().then(() => locks.request(LOCK_NAME, { mode: 'exclusive', signal: controller.signal }, async () => {
        clearTimeout(timer);
        const chrome = getChrome(), area = chrome.storage.local;
        let snapshot = {}, completeGraph = false;
        const read = async (keys = null) => {
          const value = (await call(chrome, area.get.bind(area), keys)) || {};
          if (keys === null) { snapshot = clone(value); completeGraph = true; }
          else if (Array.isArray(keys)) {
            for (const key of keys) { if (Object.hasOwn(value, key)) snapshot[key] = clone(value[key]); else delete snapshot[key]; }
            if (SCENE_GRAPH_KEYS.every(key => keys.includes(key))) completeGraph = true;
          }
          return value;
        };
        const write = async (payload) => {
          if (!completeGraph) await read(null);
          // Every coordinator writer (including import/popup transactions) must
          // reject unknown or damaged scene graphs before storage changes.
          validateSceneState(snapshot);
          const next = { ...snapshot, ...payload };
          validateSceneState(next);
          await call(chrome, area.set.bind(area), payload);
          snapshot = clone(next);
        };
        return task({ read, write, merge });
      })).catch((error) => {
        if (error.name === 'AbortError') throw new Error(t('保存等待超时，请重试。'));
        throw error;
      }).finally(() => clearTimeout(timer));
    }
    const read = (keys = KEYS) => transaction((tx) => tx.read(keys));
    const commit = (base, next, guard) => transaction(async (tx) => {
      const latest = await tx.read([...new Set(KEYS.concat(Object.keys(base), Object.keys(next)))]);
      // Optional operation preconditions also cover unchanged dependencies such
      // as a move destination. Validate against the locked latest snapshot, not
      // an earlier rendered view; asynchronous/truthy results are not approval.
      if (guard) {
        const accepted = guard(clone(latest));
        // Unsupported async guards must not leak an unhandled rejection.
        if (accepted && typeof accepted.then === 'function') Promise.resolve(accepted).catch(() => {});
        if (accepted !== true) throw conflict();
      }
      const merged = merge(base, next, latest);
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
        save(snapshot, guard) {
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
              const saved = await commit(base, next, guard);
              return { state: saved, current: ticket === serial };
            } catch (error) { broken = true; throw error; }
          });
          queue = result.catch(() => {});
          return result;
        }
      };
    }
    function connect({ state, onChange, onError, onSaved, getViewIdentity }) {
      let session = null, committed = null, epoch = 0, failedSinceIdle = false;
      const inFlight = new Set();
      const pick = (value) => Object.fromEntries(KEYS.filter((key) => Object.hasOwn(value, key) && !(value[SCHEMA_KEY] === 2 && SCENE_VIEW_KEYS.includes(key))).map((key) => [key, clone(value[key])]));
      function apply(saved) {
        epoch = saved[EPOCH_KEY] || 0;
        let changed = false;
        for (const key of KEYS) {
          if (key === EPOCH_KEY || !Object.hasOwn(saved, key) || (saved[SCHEMA_KEY] === 2 && SCENE_VIEW_KEYS.includes(key))) continue;
          if (!equal(state[key], saved[key])) { state[key] = clone(saved[key]); changed = true; }
        }
        if (changed && onChange) onChange();
      }
      function seed(stored, viewOverrides = {}) { epoch = stored[EPOCH_KEY] || 0; committed = { ...pick(state), [EPOCH_KEY]: epoch }; session = createSession(pick(stored), { ...committed, ...viewOverrides }); }
      function save(_rollback, onOk, guard) {
        if (!session) {
          if (committed) apply(committed);
          if (onError) onError(new Error(t('保存暂不可用，请重新打开标签页。')));
          return Promise.resolve(false);
        }
        const active = session;
        let operation;
        try { operation = active.save(pick(state), guard); } catch (error) { operation = Promise.reject(error); }
        const settled = operation.then((result) => {
          if (active !== session) return false;
          committed = { ...committed, ...pick(result.state) };
          if (result.current) {
            apply(result.state);
            active.rebase(result.state, pick(state));
          }
          if (onOk) onOk();
          if (onSaved) onSaved(result.state);
          return true;
        }).catch(async (error) => {
          if (active !== session) return false;
          session = null; // Reject queued edits from the failed baseline.
          if (onError) onError(error);
          try { const latest = await read(); apply({ ...committed, ...latest }); seed(latest); }
          catch (_) { if (committed) apply(committed); } // Never keep an unsaved optimistic edit.
          if (onSaved) onSaved(committed);
          return false;
        });
        inFlight.add(settled);
        settled.then(value => { if (value !== true) failedSinceIdle = true; inFlight.delete(settled); }, () => { failedSinceIdle = true; inFlight.delete(settled); });
        return settled;
      }
      async function whenIdle() {
        // A later failed queue ticket can settle before an earlier async
        // recovery read. Drain every save/recovery, not merely the last ticket.
        let successful = !failedSinceIdle;
        failedSinceIdle = false;
        while (inFlight.size) {
          const results = await Promise.allSettled([...inFlight]);
          if (results.some(result => result.status !== 'fulfilled' || result.value !== true)) successful = false;
        }
        successful = successful && !failedSinceIdle;
        failedSinceIdle = false;
        return successful;
      }
      function intentRecord(record, key) {
        if (!record) return null;
        const fields = key === 'icons'
          ? ['id', 'name', 'url', 'type', 'folderId', 'parentId', 'customIconUrl', 'emoji', 'uploadedIconDataUrl', 'toolSubtype', 'sshGatewayUrl', 'sshHost', 'sshPort', 'sshUsername', 'sshSocksHost', 'sshSocksPort', 'sshSocksUsername']
          : key === 'folders' ? ['id', 'name', 'parentId', 'type', 'sceneId']
            : key === 'scenes' ? ['id', 'name', 'iconKey', 'homeGroupId', 'archivedAt']
              : key === 'sceneProfiles' ? ['id', 'background', 'bingIndex', 'layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth']
                : ['id', 'text', 'done', 'sceneId'];
        return Object.fromEntries(fields.filter((field) => {
          const value = record[field];
          return value !== undefined && value !== '' && value !== false
            && !(field === 'type' && value === 'shortcut') && !(field === 'folderId' && value === 'folder-home')
            && !(field === 'sshPort' && value === 22) && !(field === 'sshSocksPort' && value === 1080);
        }).map((field) => [field, clone(record[field])]));
      }
      function captureIntent(targets = {}) {
        const records = {};
        for (const key of ENTITIES) if (targets[key]) {
          records[key] = Object.fromEntries(targets[key].map((id) => [id, intentRecord((state[key] || []).find((item) => item.id === id), key)]));
        }
        const groups = Object.fromEntries((targets.groupMembers || []).map((id) => [id, (state.icons || []).filter((item) => item.folderId === id).map((item) => item.id).sort()]));
        return { epoch, records, groups, view: getViewIdentity ? clone(getViewIdentity()) : undefined };
      }
      function isIntentCurrent(intent) {
        return !!intent && intent.epoch === epoch && (!getViewIdentity || equal(intent.view, getViewIdentity())) && Object.entries(intent.groups).every(([id, ids]) => equal(ids, (state.icons || []).filter((item) => item.folderId === id).map((item) => item.id).sort())) && Object.entries(intent.records).every(([key, entries]) =>
          Object.entries(entries).every(([id, before]) => equal(before, intentRecord((state[key] || []).find((item) => item.id === id), key))));
      }
      return { seed, save, captureIntent, isIntentCurrent, whenIdle };
    }
    return { transaction, read, commit, replace, createSession, connect, merge, migrationOverrides, LOCK_NAME, EPOCH_KEY, SCHEMA_KEY, KEYS };
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
