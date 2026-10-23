(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSceneController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SESSION_KEY = 'opentab.scene.view', DEVICE_KEY = 'opentab.scene.last';
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fail = code => Object.assign(new Error(code), { code });
  const sceneIdentity = scene => scene && ({ id: scene.id, name: scene.name, archivedAt: scene.archivedAt });
  const groupIdentity = group => group && ({ id: group.id, name: group.name, sceneId: group.sceneId });
  function create({ state, coordinator, bridge, commands, schema, session, preferences, uuid,
    onLoad, onInvalidate = () => {}, beforeSwitch = () => true, whenAppearanceIdle = () => true,
    onUndo = () => {}, onSessionError = () => {}, onRenderError = () => {}, onBusy = () => {}, onViewDeferred = () => {}, now = Date.now, homeName = () => 'Home' }) {
    let view = null, generation = 0, epoch, busy = false, refreshPending = null, refreshRequested = 0;
    const idleWaiters = [];
    let remembered = { lastGroupIds: {} };
    try {
      const parsed = JSON.parse(session?.getItem(SESSION_KEY) || 'null');
      if (parsed && typeof parsed.sceneId === 'string' && parsed.lastGroupIds && typeof parsed.lastGroupIds === 'object' && !Array.isArray(parsed.lastGroupIds)) {
        remembered = { sceneId: parsed.sceneId, lastGroupIds: Object.fromEntries(Object.entries(parsed.lastGroupIds).filter(([key, value]) => key && typeof value === 'string')) };
      }
    } catch (_) { /* A damaged/blocked session mirror never changes stored data. */ }
    const active = (data, id) => data.scenes.find(scene => scene.id === id && scene.archivedAt === null);
    const getView = () => view ? { ...view, generation } : null;
    function remember(explicit = false) {
      if (!view) return;
      remembered.sceneId = view.sceneId;
      Object.defineProperty(remembered.lastGroupIds, view.sceneId, { value: view.currentFolderId, enumerable: true, configurable: true, writable: true });
      try { session?.setItem(SESSION_KEY, JSON.stringify(remembered)); } catch (_) { signal(onSessionError); }
      if (explicit) try { preferences?.setItem(DEVICE_KEY, view.sceneId); } catch (_) { /* Best-effort first-paint hint only. */ }
    }
    function choose(data, requestedSceneId, requestedGroupId) {
      schema.validate(data);
      const scene = active(data, requestedSceneId || view?.sceneId || remembered.sceneId)
        || active(data, data.lastOpenedSceneId) || data.scenes.find(item => item.archivedAt === null);
      if (!scene) throw fail('SCENE_NOT_FOUND');
      const proposed = requestedGroupId || (scene.id === view?.sceneId ? view.currentFolderId : remembered.lastGroupIds[scene.id]) || data.currentFolderId;
      const group = data.folders.find(item => item.id === proposed && item.sceneId === scene.id);
      return { sceneId: scene.id, homeGroupId: scene.homeGroupId, currentFolderId: group?.id || scene.homeGroupId };
    }
    function project(data, requestedSceneId, requestedGroupId) {
      const next = choose(data, requestedSceneId, requestedGroupId), nextEpoch = data[coordinator.EPOCH_KEY] || 0;
      if (!same(next, view) || nextEpoch !== epoch) generation += 1;
      view = next; epoch = nextEpoch; remember();
      const profile = data.sceneProfiles.find(item => item.id === view.sceneId);
      return { ...clone(data), ...Object.fromEntries(schema.PROFILE_KEYS.map(key => [key, clone(profile[key])])), currentFolderId: view.currentFolderId };
    }
    async function adopt(data, requestedSceneId, requestedGroupId, explicit = false) {
      const projected = project(data, requestedSceneId, requestedGroupId);
      Object.assign(state, projected);
      bridge.seed(data);
      try { await onLoad(projected, data); } catch (error) { signal(onRenderError, error); }
      // Rendering failure cannot turn a durable success into a second submit.
      remember(explicit);
    }
    // Draft checks at a commit boundary must be synchronous. Async predicates
    // cannot grant permission after that boundary has already been crossed.
    function canSwitch() {
      let allowed;
      try { allowed = beforeSwitch(); } catch (_) { return false; }
      if (allowed && typeof allowed.then === 'function') Promise.resolve(allowed).catch(() => {});
      return allowed === true;
    }
    function requireCleanDraft() { if (!canSwitch()) throw fail('SCENE_DIRTY_DRAFT'); }
    function signal(hook, value) { try { hook(value); } catch (_) { /* UI hooks never change a durable result. */ } }
    function changesView(data, sceneId, groupId) {
      return !same(choose(data, sceneId, groupId), view) || (data[coordinator.EPOCH_KEY] || 0) !== epoch;
    }
    async function adoptWhenSafe(data, sceneId, groupId, explicit = false, requireClean = false) {
      if ((requireClean || changesView(data, sceneId, groupId)) && !canSwitch()) {
        // The write already succeeded. Keep the old tab/draft intact rather
        // than throw and invite a duplicate submit. A later refresh rereads.
        signal(onViewDeferred);
        return false;
      }
      await adopt(data, sceneId, groupId, explicit);
      return true;
    }
    function checkContext(context, data) {
      if (!context) return;
      const current = getView();
      if (context.view && (!current || context.view.sceneId !== current.sceneId || context.view.currentFolderId !== current.currentFolderId || context.view.generation !== current.generation)) throw fail('SCENE_CONFLICT');
      if (context.scene && !same(context.scene, sceneIdentity(data.scenes.find(item => item.id === context.scene.id)))) throw fail('SCENE_CONFLICT');
      if (context.targetScene && !same(context.targetScene, sceneIdentity(data.scenes.find(item => item.id === context.targetScene.id)))) throw fail('SCENE_CONFLICT');
      if (context.group && !same(context.group, groupIdentity(data.folders.find(item => item.id === context.group.id)))) throw fail('SCENE_CONFLICT');
    }
    async function run(task, changingView = false) {
      if (busy) throw fail('SCENE_BUSY');
      // Refuse an existing draft before the interaction lock can move focus.
      if (changingView) requireCleanDraft();
      busy = true; signal(onBusy, true);
      try {
        const workspaceIdle = await bridge.whenIdle(), appearanceIdle = await whenAppearanceIdle();
        if (workspaceIdle === false || appearanceIdle === false) throw fail('SCENE_PENDING_SAVE_FAILED');
        return await task();
      } finally { busy = false; signal(onBusy, false); idleWaiters.splice(0).forEach(resolve => resolve()); }
    }
    async function select(sceneId, groupId, context) {
      const expectedEpoch = epoch;
      const expectedScene = clone(sceneIdentity(state.scenes.find(item => item.id === sceneId)));
      const expectedGroup = groupId ? clone(groupIdentity(state.folders.find(item => item.id === groupId))) : null;
      if (!expectedScene || expectedScene.archivedAt !== null || (groupId && (!expectedGroup || expectedGroup.sceneId !== sceneId))) throw fail('SCENE_CONFLICT');
      return run(async () => {
        checkContext(context, state);
        onInvalidate();
        const result = await coordinator.transaction(async ({ read, write }) => {
          const latest = await read(null); schema.validate(latest); checkContext(context, latest);
          if ((latest[coordinator.EPOCH_KEY] || 0) !== expectedEpoch) throw fail('SCENE_CONFLICT');
          if (!same(expectedScene, sceneIdentity(latest.scenes.find(item => item.id === sceneId)))
            || (expectedGroup && !same(expectedGroup, groupIdentity(latest.folders.find(item => item.id === groupId))))) throw fail('SCENE_CONFLICT');
          const next = choose(latest, sceneId, groupId);
          requireCleanDraft();
          // Compatibility/default hints only. Existing tabs retain their own
          // session view and never adopt these aliases through workspace.save.
          const patch = { lastOpenedSceneId: next.sceneId, currentFolderId: next.currentFolderId };
          if (Object.entries(patch).some(([key, value]) => latest[key] !== value)) await write(patch);
          return { data: { ...latest, ...patch }, next };
        });
        // A default hint may be saved even if a new draft defers local navigation.
        return adoptWhenSafe(result.data, result.next.sceneId, result.next.currentFolderId, true, true);
      }, true);
    }
    async function command(commandName, args, context, changingView = false, openCreated = false) {
      // Bind the operation before any pending save/lock wait. Do not rebuild an
      // old displayed action against a newer scene graph after awaiting.
      checkContext(context, state);
      const projectedCommand = schema[commandName](state, args);
      changingView = changingView || !same(choose(projectedCommand), view);
      const preview = commands.prepare(state, commandName, args), expectedView = getView();
      return run(async () => {
        checkContext(context, state); onInvalidate();
        const result = await commands.execute(preview, latest => {
          checkContext(context, latest);
          if (changingView) requireCleanDraft();
          return same(expectedView, getView()) && !!active(latest, expectedView.sceneId)
            && latest.folders.some(item => item.id === expectedView.currentFolderId && item.sceneId === expectedView.sceneId);
        });
        await adoptWhenSafe(result.state, openCreated ? args.id : undefined, openCreated ? args.homeGroupId : undefined, openCreated, changingView);
        if (result.receipt.undoable) signal(onUndo, () => run(async () => {
          onInvalidate();
          const restored = await commands.undo(result.receipt, () => { requireCleanDraft(); return true; });
          await adoptWhenSafe(restored, undefined, undefined, false, true);
          return true;
        }, true));
        return true;
      }, changingView);
    }
    function syncAppearance(layout) {
      if (!view) return;
      const profile = state.sceneProfiles.find(item => item.id === view.sceneId);
      if (!profile) throw fail('SCENE_CONFLICT');
      const next = { ...profile, background: clone(state.background), bingIndex: state.bingIndex };
      for (const key of schema.PROFILE_KEYS.filter(key => key.startsWith('layout'))) if (layout && Object.hasOwn(layout, key)) next[key] = layout[key];
      state.sceneProfiles = state.sceneProfiles.map(item => item.id === view.sceneId ? next : item);
    }
    function save(success, failure, guard, layout) {
      if (!view) return bridge.save(success, failure, guard);
      const expected = getView(); syncAppearance(layout);
      return bridge.save(success, failure, latest => {
        if (!same(expected, getView()) || !active(latest, expected.sceneId)) return false;
        return !guard || guard(latest) === true;
      });
    }
    // Only record a successful local navigation, never another tab's shared alias.
    function commitLocalView(groupId, expectedView) {
      if (!same(getView(), expectedView)) return false;
      const group = state.folders?.find(item => item.id === groupId && item.sceneId === view.sceneId);
      const scene = active(state, view.sceneId);
      if (!group || !scene) return false;
      if (groupId !== view.currentFolderId) {
        view = { ...view, currentFolderId: groupId }; generation += 1;
      }
      state.currentFolderId = groupId; remember(); return true;
    }
    async function refresh() {
      refreshRequested += 1;
      if (refreshPending) return refreshPending;
      const pending = (async () => {
        while (busy) await new Promise(resolve => idleWaiters.push(resolve));
        return run(async () => {
          // Read after every queued save/recovery and never adopt a snapshot
          // captured before that boundary, including coalesced storage events.
          let observed;
          do {
            observed = refreshRequested;
            const latest = await coordinator.read(null); schema.validate(latest);
            const next = choose(latest);
            if (view && changesView(latest)) requireCleanDraft();
            if (!same(next, view)) onInvalidate();
            await adopt(latest);
          } while (observed !== refreshRequested);
          return true;
        });
      })();
      refreshPending = pending;
      try { return await pending; } finally { if (refreshPending === pending) refreshPending = null; }
    }
    return {
      getView, project, refresh, save, commitLocalView, isBusy: () => busy,
      selectScene: (sceneId, context) => select(sceneId, undefined, context),
      selectGroup(groupId, context) { const group = state.folders.find(item => item.id === groupId); return group ? select(group.sceneId, group.id, context) : Promise.reject(fail('SCENE_CONFLICT')); },
      createScene({ name, iconKey }, context) {
        const value = String(name || '').trim(); if (!value || value.length > 40) return Promise.reject(fail('SCENE_INVALID_NAME'));
        if (state.scenes.length >= 64) return Promise.reject(fail('SCENE_LIMIT'));
        return command('create', { id: `scene-${uuid()}`, name: value, iconKey: iconKey || 'home', homeGroupId: `group-${uuid()}`, homeName: homeName() }, context, true, true);
      },
      renameScene({ sceneId, name }, context) {
        const value = String(name || '').trim(); if (!value || value.length > 40) return Promise.reject(fail('SCENE_INVALID_NAME'));
        return command('rename', { sceneId, name: value }, context);
      },
      archiveScene: ({ sceneId }, context) => command('archive', { sceneId, archivedAt: now() }, context, sceneId === view?.sceneId),
      restoreScene: ({ sceneId }, context) => command('restore', { sceneId }, context),
      moveGroup: ({ groupId, targetSceneId }, context) => command('moveGroup', { groupId, targetSceneId }, context, groupId === view?.currentFolderId)
    };
  }
  return { create, SESSION_KEY, DEVICE_KEY };
}));
