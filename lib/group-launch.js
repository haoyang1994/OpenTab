(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabGroupLaunchCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Inert core: the caller owns storage locking and the sole tabs.create adapter.
  // Tokens never persist, mutate the workspace, inspect tabs, or launch on load.
  const MAX_SELECTION = 20;
  const EPOCH_KEY = 'opentab.workspaceEpoch';
  const SCHEMA_KEY = 'opentab.sceneSchemaVersion';
  const HOME = 'folder-home';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const text = value => typeof value === 'string' ? value : '';
  const optionalId = value => value == null || value === '' ? '' : typeof value === 'string' ? value : null;
  const groupIdOf = icon => optionalId(icon.folderId) || HOME;
  const typeOf = icon => icon.type == null || icon.type === '' ? 'shortcut' : icon.type;

  function safeUrl(value) {
    if (typeof value !== 'string') return null;
    const input = value.trim();
    if (!/^https?:\/\/[^/?#]/i.test(input) || /[\u0000-\u001f\u007f\\]/.test(input)) return null;
    // Empty user-info is still credential syntax, even though URL.username is ''.
    if (/^https?:\/\/[^/?#]*@/i.test(input)) return null;
    try {
      const url = new URL(input);
      return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }

  function records(list) {
    const result = new Map();
    for (const record of Array.isArray(list) ? list : []) {
      if (!record || typeof record.id !== 'string' || !record.id.trim()) continue;
      // Ambiguous IDs must not silently bind to a different source record.
      result.set(record.id, result.has(record.id) ? null : record);
    }
    return result;
  }

  function inspect(snapshot) {
    const empty = { items: [], sources: new Map(), excludedCount: 0, dedupCount: 0, groupName: '', reason: 'stale' };
    const data = snapshot?.data;
    if (!data || typeof data !== 'object' || !Array.isArray(data.icons)
      || (own(data, 'folders') && !Array.isArray(data.folders))) return empty;
    const groupId = optionalId(snapshot.groupId) || HOME;
    if (optionalId(snapshot.groupId) === null) return empty;
    const groups = records(data.folders), icons = records(data.icons);
    const sceneAware = own(data, SCHEMA_KEY) || own(data, 'scenes') || own(data, 'sceneProfiles')
      || ['folders', 'icons', 'todos'].some(key => Array.isArray(data[key]) && data[key].some(item => item && own(item, 'sceneId')));
    const view = snapshot.view;
    let scene = null, viewIdentity = null;
    if (sceneAware) {
      if (data[SCHEMA_KEY] !== 2 || !view || typeof view.sceneId !== 'string'
        || !Number.isSafeInteger(view.generation) || view.generation < 0 || view.currentFolderId !== groupId) return empty;
      scene = records(data.scenes).get(view.sceneId);
      if (!scene || scene.archivedAt !== null || !text(scene.name).trim() || scene.homeGroupId !== view.homeGroupId) return empty;
      const home = groups.get(scene.homeGroupId);
      if (!home || home.sceneId !== scene.id || optionalId(home.parentId) !== '') return empty;
      viewIdentity = { sceneId: view.sceneId, homeGroupId: view.homeGroupId, currentFolderId: view.currentFolderId, generation: view.generation };
    } else if (view != null) return empty;
    const implicitHome = !sceneAware && groupId === HOME && !own(data, 'folders');
    const group = groups.get(groupId) || (implicitHome ? { id: HOME, name: 'Home' } : null);
    if (!group || (sceneAware && group.sceneId !== scene.id)) return empty;
    const path = [], seen = new Set();
    let ancestor = group;
    while (ancestor) {
      if (seen.has(ancestor.id) || !text(ancestor.name).trim() || optionalId(ancestor.parentId) === null
        || (sceneAware && ancestor.sceneId !== scene.id)) return empty;
      seen.add(ancestor.id);
      path.push({ id: ancestor.id, name: ancestor.name, parentId: optionalId(ancestor.parentId), sceneId: sceneAware ? ancestor.sceneId : '' });
      if (!ancestor.parentId) break;
      ancestor = groups.get(ancestor.parentId);
      if (!ancestor) return empty;
    }
    const epoch = data[EPOCH_KEY] == null ? 0 : data[EPOCH_KEY];
    if (!Number.isSafeInteger(epoch) || epoch < 0) return empty;
    const scope = {
      groupId, sceneAware, epoch, implicitHome, path,
      scene: scene ? { id: scene.id, name: scene.name, homeGroupId: scene.homeGroupId, archivedAt: scene.archivedAt } : null
    };
    const items = [], sources = new Map(), keys = new Set();
    let excludedCount = 0, dedupCount = 0;
    for (const icon of data.icons) {
      if (!icon || groupIdOf(icon) !== groupId) continue;
      const url = safeUrl(icon.url), parentId = optionalId(icon.parentId);
      if (icons.get(icon.id) !== icon || typeOf(icon) !== 'shortcut' || !url || parentId === null
        || optionalId(icon.folderId) === null || own(icon, 'sceneId')
        || (sceneAware && icon.folderId !== groupId)) { excludedCount++; continue; }
      let parent = null;
      if (parentId) {
        const folder = icons.get(parentId);
        if (!folder || folder.type !== 'folder' || groupIdOf(folder) !== groupId
          || optionalId(folder.folderId) === null || optionalId(folder.parentId) !== '' || own(folder, 'sceneId')
          || (sceneAware && folder.folderId !== groupId)) { excludedCount++; continue; }
        parent = { id: folder.id, name: text(folder.name), folderId: groupId, parentId: '', type: 'folder' };
      }
      const domain = new URL(url).host;
      const source = { id: icon.id, name: text(icon.name), url, type: 'shortcut', folderId: groupId, parentId, parent };
      sources.set(icon.id, source);
      if (keys.has(url)) { dedupCount++; continue; }
      keys.add(url);
      items.push({ key: url, name: text(icon.name) || domain, domain, url, sourceId: icon.id });
    }
    return { items, sources, scope, view: viewIdentity, excludedCount, dedupCount, groupName: group.name, reason: '' };
  }

  // Pure helper; the source identities are intentionally kept private to tokens.
  function collect(snapshot) {
    const result = inspect(snapshot);
    return { groupName: result.groupName, items: result.items.map(({ sourceId, ...item }) => item),
      excludedCount: result.excludedCount, dedupCount: result.dedupCount, reason: result.reason };
  }

  function sameScope(before, after, durable) {
    if (!before || !after) return false;
    const { implicitHome: beforeImplicit, path: beforePath, ...oldScope } = before;
    const { implicitHome: afterImplicit, path: afterPath, ...newScope } = after;
    if (!equal(oldScope, newScope)) return false;
    // Legacy hydration materializes an implicit Home group without a save. Its
    // localized display name cannot be compared to an absent durable record.
    if (durable && (beforeImplicit || afterImplicit) && !before.sceneAware && before.groupId === HOME) {
      return beforePath.length === 1 && afterPath.length === 1 && beforePath[0].parentId === '' && afterPath[0].parentId === '';
    }
    return beforeImplicit === afterImplicit && equal(beforePath, afterPath);
  }

  function create(host) {
    if (!host || ['getSnapshot', 'whenIdle', 'transaction', 'createTab'].some(key => typeof host[key] !== 'function')) {
      throw new TypeError('Group launch adapters are required.');
    }
    const tokens = new WeakMap();
    let busy = false;
    function preview() {
      let captured;
      try { captured = inspect(host.getSnapshot()); } catch (_) { captured = inspect(null); }
      const token = Object.freeze({ groupName: captured.groupName,
        items: Object.freeze(captured.items.map(({ sourceId, ...item }) => Object.freeze(item))),
        excludedCount: captured.excludedCount, dedupCount: captured.dedupCount, reason: captured.reason });
      tokens.set(token, { captured, opened: new Set(), invalid: !!captured.reason });
      return token;
    }
    function current(plan, selected, snapshot, durable = false) {
      const actual = inspect(snapshot), original = plan.captured;
      return !actual.reason && sameScope(original.scope, actual.scope, durable)
        && (durable || equal(original.view, actual.view))
        && selected.every(item => equal(original.sources.get(item.sourceId), actual.sources.get(item.sourceId)));
    }
    async function launch(token, selectedKeys) {
      const result = (ok, reason, opened = [], failed = [], remaining = []) => ({ ok, reason, opened, failed, remaining });
      const plan = token && typeof token === 'object' ? tokens.get(token) : null;
      if (!plan || plan.invalid) return result(false, 'invalid-preview');
      if (busy) return result(false, 'busy');
      if (!Array.isArray(selectedKeys) && !(selectedKeys instanceof Set)) return result(false, 'invalid-selection');
      const keys = [...new Set(selectedKeys)];
      if (!keys.length) return result(false, 'empty');
      if (keys.length > MAX_SELECTION) return result(false, 'too-many');
      const byKey = new Map(plan.captured.items.map(item => [item.key, item]));
      if (keys.some(key => typeof key !== 'string' || !byKey.has(key))) return result(false, 'invalid-selection');
      const selected = keys.filter(key => !plan.opened.has(key)).map(key => byKey.get(key));
      if (!selected.length) return result(false, 'already-opened');
      const opened = [], failed = [];
      const remaining = () => selected.filter(item => !plan.opened.has(item.key)).map(item => item.key);
      let phase = 'save-failed';
      busy = true; // Before the first await: double clicks cannot enter twice.
      try {
        if (await host.whenIdle() === false) return result(false, 'save-failed', opened, failed, remaining());
        phase = 'read-failed';
        return await host.transaction(async tx => {
          const latest = await tx.read(null);
          const durable = { data: latest, view: plan.captured.view, groupId: plan.captured.scope.groupId };
          if (!current(plan, selected, host.getSnapshot()) || !current(plan, selected, durable, true)) {
            plan.invalid = true;
            return result(false, 'stale', opened, failed, remaining());
          }
          // The read-only workspace lock remains held until all creates settle.
          // Recheck local navigation/drafts before each separate tab side effect.
          for (let index = 0; index < selected.length; index++) {
            const item = selected[index];
            if (!current(plan, selected, host.getSnapshot())) {
              plan.invalid = true;
              failed.push(...selected.slice(index).map(({ key, name, url }) => ({ key, name, url, reason: 'stale' })));
              return result(false, 'stale', opened, failed, remaining());
            }
            try {
              await host.createTab(item.url);
              plan.opened.add(item.key);
              opened.push(item.key);
            } catch (error) {
              failed.push({ key: item.key, name: item.name, url: item.url, reason: text(error?.message) || 'tab-create-failed' });
            }
          }
          return result(!failed.length, failed.length ? 'partial' : '', opened, failed, remaining());
        });
      } catch (_) {
        // Read, lock, snapshot and adapter failures never fall back to an
        // unchecked launch. Already successful tabs remain replay-protected.
        if (opened.length || failed.length) {
          const reported = new Set(failed.map(item => item.key));
          failed.push(...selected.filter(item => !plan.opened.has(item.key) && !reported.has(item.key))
            .map(({ key, name, url }) => ({ key, name, url, reason: phase })));
        }
        return result(false, phase, opened, failed, remaining());
      } finally { busy = false; }
    }
    return Object.freeze({ preview, launch });
  }
  return Object.freeze({ create, safeUrl, collect, MAX_SELECTION });
}));
