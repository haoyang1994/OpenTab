(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSceneRuntime = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  // Loading this bridge is inert. Legacy data is upgraded only by the explicit
  // enable action, not by loading the page or opening the scene introduction.
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Storage dictionaries may return keys in another order. Acknowledgements
  // still require every key/value and ordered array entry, without coercion.
  function sameStoredValue(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const array = Array.isArray(a);
    if (array !== Array.isArray(b) || (array && a.length !== b.length)) return false;
    if (!array && [a, b].some(value => Object.prototype.toString.call(value) !== '[object Object]')) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameStoredValue(a[key], b[key]));
  }
  const fail = code => Object.assign(new Error(code), { code });
  const t = source => root.OpenTabI18n?.t(source) ?? source;
  const LAYOUT_KEYS = ['layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth'];

  function create({ state, workspace, applyLoadedState, showToast = () => {}, beforeSwitch = () => true,
    onInvalidate = () => {}, writeBootMirror = () => {}, renderVisible = () => {}, onLoadStatus = () => {}, onBusy = () => {}, onViewDeferred, onDiscardDraft = () => false, mount, bingHost }) {
    const coordinator = root.OpenTabWorkspace, schema = root.OpenTabSceneSchema;
    const controllerAPI = root.OpenTabSceneController, commandAPI = root.OpenTabSceneWorkspace;
    if (!state || !workspace?.save || !coordinator?.read || !schema?.validate || !controllerAPI?.create
      || !commandAPI?.create || typeof applyLoadedState !== 'function') throw new TypeError('Scene runtime adapters are required.');
    // Loading needs the complete graph/settings, not unrelated recovery blobs.
    // Migration and destructive recovery still read all storage under the lock.
    const loadKeys = [...new Set([...coordinator.KEYS, ...LAYOUT_KEYS])];
    const initialMarks = new Set();
    let controller = null, manager = null, commands = null, initialized = false, disposed = false, blocked = false, applyingValidatedState = false, deferredView = false;
    let loadPending = null, enablePending = null, refreshQueued = false, refreshAfterEnable = false, refreshAfterLoad = false, blockedAdapters = false, committedProfiles = [];
    let committedSnapshot = {}, committedRevision = 0, notificationRevision = 0, loadedEpoch;
    let entry = null, introduction = null, status = null, retry = null, recovery = null, settingsButton = null, discardButton = null, enable = null, lastError = null, discardPending = false;
    const originalBing = new Map();
    const session = storage('sessionStorage'), preferences = storage('localStorage');
    function storage(name) { try { return root[name]; } catch (_) { return undefined; } }
    const getView = () => controller?.getView() || null;
    const isActive = () => !!controller;
    const active = (data, id) => data.scenes?.find(scene => scene.id === id && scene.archivedAt === null);
    const sameView = expected => {
      const current = getView();
      return !!expected && !!current && ['sceneId', 'generation'].every(key => expected[key] === current[key])
        && ['homeGroupId', 'currentFolderId'].every(key => expected[key] === undefined || expected[key] === current[key]);
    };
    function markInitial(phase) {
      if (initialized || initialMarks.has(phase)) return;
      initialMarks.add(phase);
      try { root.performance?.mark('opentab:initial-' + phase); } catch (_) {}
    }
    function protocol(raw) {
      if (Object.hasOwn(raw, schema.SCHEMA_KEY) || Object.hasOwn(raw, 'scenes') || Object.hasOwn(raw, 'sceneProfiles')
        || ['folders', 'icons', 'todos'].some(key => Array.isArray(raw[key]) && raw[key].some(item => item && Object.hasOwn(item, 'sceneId')))) {
        schema.validate(raw); return true;
      }
      return false;
    }
    function notify(message) { try { showToast(t(message)); } catch (_) {} }
    function make(tag, className, text) {
      const node = mount.ownerDocument.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = t(text);
      return node;
    }
    function canSwitch() {
      let allowed;
      try { allowed = beforeSwitch(); } catch (_) { return false; }
      if (allowed && typeof allowed.then === 'function') Promise.resolve(allowed).catch(() => {});
      return allowed === true;
    }
    function viewDeferred() {
      deferredView = true;
      try {
        if (typeof onViewDeferred === 'function') onViewDeferred();
        else notify('场景已保存，请完成或取消当前编辑后重新选择。');
      } catch (_) { /* A notification cannot change a durable result. */ }
    }
    function setReady(ready) { if (!disposed) try { onLoadStatus(ready === true); } catch (_) {} }
    function setBusy(busy) { if (busy === true) deferredView = false; if (!disposed) try { onBusy(busy === true); } catch (_) {} }
    function clearStatus() {
      lastError = null; recovery?.close?.(); recovery?.remove();
      status = retry = recovery = settingsButton = discardButton = null;
    }
    function ensureRecovery() {
      if (!mount?.ownerDocument || recovery) return;
      recovery = make('dialog', 'scene-recovery'); recovery.id = 'scene-recovery';
      recovery.setAttribute('aria-label', t('场景空间'));
      // Keep native dialog defaults, but never route portal input into hidden
      // page shortcuts that could cancel a retained draft or open another editor.
      ['keydown', 'contextmenu'].forEach(type => recovery.addEventListener(type, event => event.stopPropagation()));
      recovery.addEventListener('cancel', event => { if (blocked) event.preventDefault(); else clearStatus(); });
      status = make('p', 'scene-status scene-status-error');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      retry = make('button', 'scene-button', '重试'); retry.type = 'button'; retry.dataset.sceneAction = 'retry';
      retry.addEventListener('click', () => {
        if (controller || blocked || !initialized) void load();
        else { clearStatus(); void openManager(); }
      });
      discardButton = make('button', 'scene-button', '放弃未保存编辑并重试'); discardButton.type = 'button';
      discardButton.dataset.sceneAction = 'discard-draft'; discardButton.hidden = true;
      discardButton.addEventListener('click', async () => {
        if (disposed || discardPending || !blocked || lastError?.code !== 'SCENE_DIRTY_DRAFT') return;
        discardPending = true; const button = discardButton; button.disabled = true;
        try { if (await onDiscardDraft() === true && !disposed) await load(); }
        catch (_) { /* Keep the draft/recovery boundary if discard is unavailable. */ }
        finally { discardPending = false; button.disabled = false; }
      });
      settingsButton = make('button', 'scene-button', '打开设置'); settingsButton.type = 'button';
      settingsButton.dataset.sceneAction = 'settings';
      settingsButton.addEventListener('click', () => { clearStatus(); root.OpenTabSettingsNav?.openSection('sync'); });
      recovery.appendChild(status); recovery.appendChild(retry); recovery.appendChild(discardButton); recovery.appendChild(settingsButton);
      // Keep recovery controls outside the inert homepage, with no export,
      // upload or mutation implied by merely opening this portal.
      mount.ownerDocument.body.appendChild(recovery);
    }
    function report(error, migration = false) {
      if (disposed) return;
      ensureRecovery();
      if (error) lastError = error;
      const unsupported = (error || lastError)?.code === 'UNSUPPORTED_SCHEMA';
      const dirty = blocked && (error || lastError)?.code === 'SCENE_DIRTY_DRAFT';
      const message = dirty ? '检测到未保存编辑，场景切换已暂停。可放弃编辑后重试。' : unsupported ? '场景数据版本不受支持，请更新 OpenTab 后重试。原始数据未更改。'
        : migration ? '未能启用场景空间，请重试。原始数据已保留。'
          : '场景数据暂不可用，请重试。原始数据未更改。';
      if (settingsButton) settingsButton.hidden = unsupported || blocked || !initialized;
      if (discardButton) discardButton.hidden = !dirty;
      if (status) status.textContent = t(message);
      if (recovery && !recovery.open) recovery.showModal?.();
      notify(message);
    }
    function ensureEntry() {
      if (disposed || !mount?.ownerDocument || entry || controller) return;
      entry = make('button', 'scene-trigger', '场景空间'); entry.type = 'button';
      entry.dataset.sceneAction = 'open'; entry.setAttribute('aria-expanded', 'false');
      entry.addEventListener('click', () => { void openManager(); });
      introduction = make('div', 'scene-introduction'); introduction.hidden = true;
      introduction.appendChild(make('p', 'scene-description', '启用后，可为不同场景分别保存分组、待办和外观。数据格式会升级，旧版 OpenTab 不能安全编辑此配置；同步设备需先更新。启用前可在“导入与同步”导出备份。'));
      enable = make('button', 'scene-button scene-primary', '启用场景空间'); enable.type = 'button'; enable.dataset.sceneAction = 'enable';
      enable.addEventListener('click', () => { void enableScenes(); });
      const cancel = make('button', 'scene-button', '取消'); cancel.type = 'button'; cancel.dataset.sceneAction = 'cancel';
      function dismissIntroduction() {
        if (enablePending) return;
        introduction.hidden = true; entry.setAttribute('aria-expanded', 'false'); entry.focus?.();
      }
      cancel.addEventListener('click', dismissIntroduction);
      introduction.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || enablePending) return;
        event.preventDefault(); event.stopPropagation(); dismissIntroduction();
      });
      introduction.appendChild(enable); introduction.appendChild(cancel);
      mount.appendChild(entry); mount.appendChild(introduction);
    }
    async function whenAppearanceIdle() {
      // Layout can enqueue a workspace save while it drains. Check the bridge
      // afterwards as well, including failures consumed during that interval.
      const layoutResult = await root.OpenTabLayout?.whenIdle?.();
      const workspaceResult = await workspace.whenIdle();
      return layoutResult !== false && workspaceResult !== false;
    }
    function noteCommitted(raw) {
      if (!raw || !controller) return false;
      try { schema.validate(raw); } catch (_) { return false; }
      committedProfiles = clone(raw.sceneProfiles);
      committedSnapshot = Object.fromEntries([...relevant].filter(key => Object.hasOwn(raw, key)).map(key => [key, clone(raw[key])]));
      committedRevision += 1;
      return true;
    }
    function committedProfile() {
      return clone(committedProfiles.find(item => item.id === getView()?.sceneId));
    }
    function syncVisibleAppearance() {
      if (!controller || disposed) return false;
      const view = getView(), profile = state.sceneProfiles?.find(item => item.id === view.sceneId);
      if (!profile) return false;
      for (const key of schema.PROFILE_KEYS) state[key] = clone(profile[key]);
      // A raw compatibility alias from another tab never becomes this tab's view.
      state.currentFolderId = view.currentFolderId;
      root.OpenTabLayout?.apply?.({ ...clone(profile), todoButtonVisible: state.todoButtonVisible !== false });
      manager?.render();
      return true;
    }
    function validatePatch(changes, includeTodo = false) {
      const view = getView(), candidate = clone(state);
      const profile = candidate.sceneProfiles.find(item => item.id === view.sceneId);
      Object.assign(profile, clone(Object.fromEntries(Object.entries(changes).filter(([key]) => schema.PROFILE_KEYS.includes(key)))));
      schema.validate(candidate);
      if (includeTodo && typeof changes.todoButtonVisible !== 'boolean') throw fail('SCENE_INVALID_PROFILE');
      return profile;
    }
    async function persistProfile(changes, expected, before) {
      if (disposed || blocked || !sameView(expected)) return false;
      const includesTodo = Object.hasOwn(changes, 'todoButtonVisible');
      const profile = validatePatch(changes, includesTodo);
      state.sceneProfiles = state.sceneProfiles.map(item => item.id === expected.sceneId ? profile : item);
      for (const key of schema.PROFILE_KEYS) if (Object.hasOwn(changes, key)) state[key] = clone(changes[key]);
      if (includesTodo) state.todoButtonVisible = changes.todoButtonVisible;
      // Use the normal queue, not a full-state replacement or a re-seed. A
      // layout save must not accidentally promote a pending Bing alias to data.
      const saved = await workspace.save(undefined, undefined, latest => sameView(expected)
        && !!active(latest, expected.sceneId)
        && (before === undefined || sameStoredValue(latest.sceneProfiles.find(item => item.id === expected.sceneId)?.background, before)));
      if (saved !== true && !disposed) { syncVisibleAppearance(); renderVisible(); }
      return saved === true;
    }
    function setBingHooks(getSceneView, persistBackground) {
      if (!bingHost) return;
      for (const [key, value] of Object.entries({ getSceneView, persistBackground })) {
        if (!originalBing.has(key)) originalBing.set(key, Object.getOwnPropertyDescriptor(bingHost, key));
        Object.defineProperty(bingHost, key, { configurable: true, enumerable: true, value });
      }
    }
    function restoreBingHooks() {
      if (bingHost) for (const [key, descriptor] of originalBing) {
        if (descriptor) Object.defineProperty(bingHost, key, descriptor); else delete bingHost[key];
      }
      originalBing.clear();
    }
    function failClosedAdapters() {
      if (controller || blockedAdapters) return;
      blockedAdapters = true; onInvalidate();
      setBingHooks(() => null, () => Promise.resolve(false));
      root.OpenTabLayout?.setSceneAdapter?.({
        getView: () => ({ sceneId: '', homeGroupId: '', generation: -1 }),
        getProfile: () => clone(root.OpenTabLayout.DEFAULTS), persist: () => Promise.resolve(false)
      });
    }
    function clearBlockedAdapters() {
      if (!blockedAdapters) return;
      blockedAdapters = false; restoreBingHooks();
      root.OpenTabLayout?.setSceneAdapter?.(null);
    }
    function installAdapters() {
      root.OpenTabLayout?.setSceneAdapter?.({
        getView, getProfile: committedProfile,
        persist(payload, expected, intent) {
          const permitted = [...LAYOUT_KEYS, 'todoButtonVisible'];
          if (!payload || Object.keys(payload).some(key => !permitted.includes(key))) return Promise.resolve(false);
          const keys = intent?.keys ?? Object.keys(payload);
          if (!Array.isArray(keys) || keys.some(key => !permitted.includes(key) || !Object.hasOwn(payload, key))) return Promise.resolve(false);
          // Full normalized settings are a display snapshot, not an instruction
          // to overwrite untouched fields. The workspace queue owns baselines.
          return persistProfile(Object.fromEntries(keys.map(key => [key, payload[key]])), clone(expected));
        },
        onError() { notify('保存失败，请重试。'); }
      });
      blockedAdapters = false;
      setBingHooks(() => blocked || disposed ? null : getView(), (payload, context) => {
        if (!payload || Object.keys(payload).some(key => !['background', 'bingIndex'].includes(key))
          || !Object.hasOwn(payload, 'background') || !context || !Object.hasOwn(context, 'before')) return Promise.resolve(false);
        return persistProfile(payload, clone(context.view), clone(context.before));
      });
      root.OpenTabImport?.setSceneContextProvider?.(getView);
    }
    async function applyValidated(projected, raw) {
      // The validated raw baseline is ready before synchronous loader callbacks
      // normalize and save legacy values. No load-dependent queue or deadlock.
      markInitial('loader-start');
      workspace.seed(raw); applyingValidatedState = true;
      try { await applyLoadedState(projected, raw); }
      finally { applyingValidatedState = false; markInitial('loader-end'); }
    }
    async function loaded(projected, raw) {
      if (disposed) return;
      blocked = false;
      noteCommitted(raw);
      loadedEpoch = raw[coordinator.EPOCH_KEY] || 0;
      await applyValidated(projected, raw);
      if (disposed) return;
      initialized = true; ensureManager(); manager?.render(); clearStatus(); setReady(true);
    }
    function ensureManager() {
      if (disposed || manager || !controller || !mount?.ownerDocument || !root.OpenTabSceneUI?.init) return;
      const action = method => ({ context, ...args }) => {
        if (blocked || disposed) return Promise.reject(fail('SCENE_UNAVAILABLE'));
        return controller[method](args, context);
      };
      manager = root.OpenTabSceneUI.init({ mount, getState: () => state, getView,
        onSwitch: (id, context) => blocked || disposed ? Promise.reject(fail('SCENE_UNAVAILABLE')) : controller.selectScene(id, context),
        onCreate: action('createScene'), onRename: action('renameScene'), onArchive: action('archiveScene'),
        onRestore: action('restoreScene'), onMoveGroup: action('moveGroup'),
        onError() { notify('未能保存场景，请重试。'); }
      });
      entry?.remove(); introduction?.remove(); entry = introduction = enable = null;
    }
    async function activate(raw, requestedSceneId, requestedGroupId) {
      schema.validate(raw);
      if (controller) return controller.refresh();
      commands ||= commandAPI.create({ workspace: coordinator, schema, stripSecrets: root.OpenTabImport.stripSecretsFromState });
      controller = controllerAPI.create({ state, coordinator, bridge: workspace, commands, schema, session, preferences,
        onBusy: setBusy, onViewDeferred: viewDeferred, uuid: () => root.crypto.randomUUID(), homeName: () => t('主页'), beforeSwitch, whenAppearanceIdle, onInvalidate,
        onLoad: loaded,
        onUndo: undo => showToast(t(deferredView ? '场景已保存，请完成或取消当前编辑后重新选择。' : '场景已保存。'), { actionLabel: t('撤销'), onAction: () => undo().catch(error => report(error)), duration: 6000 }),
        onSessionError: () => notify('无法记住当前场景；重新打开标签页时可能需要重新选择。'),
        onRenderError: error => report(error)
      });
      const projected = controller.project(raw, requestedSceneId, requestedGroupId);
      Object.assign(state, projected); noteCommitted(raw); installAdapters();
      workspace.seed(raw);
      await loaded(projected, raw);
      if (disposed) return false;
      ensureManager();
      return true;
    }
    function load() {
      if (disposed) return Promise.resolve(false);
      if (enablePending) {
        refreshAfterEnable = true;
        return enablePending.then(() => initialized && !blocked && !disposed);
      }
      if (controller) return controller.refresh().then(() => true, error => {
        if (error.name === 'SceneSchemaError') blocked = true;
        setReady(initialized && !blocked); report(error); return false;
      });
      if (loadPending) return loadPending;
      if (!initialized) { setReady(false); failClosedAdapters(); }
      const pending = (async () => {
        try {
          markInitial('read-start');
          const raw = await coordinator.read(loadKeys);
          markInitial('read-end');
          if (disposed) return false;
          const usesScenes = protocol(raw);
          markInitial('validated');
          if (usesScenes) {
            // Another tab can enable scenes while this legacy page is editing.
            // Do not normalize a new protocol underneath that captured draft.
            if (initialized && !canSwitch()) throw fail('SCENE_DIRTY_DRAFT');
            return await activate(raw);
          }
          blocked = false; clearBlockedAdapters();
          await applyValidated(raw, raw);
          if (disposed) return false;
          initialized = true; ensureEntry(); clearStatus(); setReady(true);
          return true;
        } catch (error) {
          // Never normalize unsupported or partial scene data as legacy state.
          if (!controller || error.name === 'SceneSchemaError') blocked = true;
          failClosedAdapters(); setReady(false); report(error); return false;
        }
      })();
      loadPending = pending;
      pending.finally(() => {
        if (loadPending === pending) loadPending = null;
        if (refreshAfterLoad) { refreshAfterLoad = false; if (!disposed) void load(); }
      });
      return pending;
    }
    async function enableScenes() {
      if (disposed || blocked) return false;
      if (controller) { ensureManager(); return manager?.open() === true; }
      if (enablePending) return enablePending;
      const expectedGroup = state.currentFolderId;
      const pending = (async () => {
        let migratedDurably = false;
        try {
          if (!canSwitch()) throw fail('SCENE_DIRTY_DRAFT');
          setBusy(true); setReady(false);
          if (!await whenAppearanceIdle()) throw fail('SCENE_PENDING_SAVE_FAILED');
          if (state.currentFolderId !== expectedGroup) throw fail('SCENE_CONFLICT');
          if (disposed) return false;
          onInvalidate();
          // The vault owns credential verification. No automatic backup upload,
          // plaintext recovery record, sync opt-in change or new permission.
          await root.OpenTabSync?.migratePlaintextSecrets?.();
          if (disposed) return false;
          if (state.currentFolderId !== expectedGroup) throw fail('SCENE_CONFLICT');
          if (!canSwitch()) throw fail('SCENE_DIRTY_DRAFT');
          commands ||= commandAPI.create({ workspace: coordinator, schema, stripSecrets: root.OpenTabImport.stripSecretsFromState });
          await commands.migrate({ defaultName: t('默认场景'), homeName: t('主页') }, () => {
            if (disposed || state.currentFolderId !== expectedGroup) throw fail('SCENE_CONFLICT');
            if (!canSwitch()) throw fail('SCENE_DIRTY_DRAFT');
            return true;
          });
          migratedDurably = true;
          // Another tab may have changed the graph after the migration lock.
          // Read again and retain the initiating tab's still-valid group only.
          const latest = await coordinator.read(null); schema.validate(latest);
          if (disposed) return false;
          if (!canSwitch()) throw fail('SCENE_DIRTY_DRAFT');
          const group = latest.folders.find(item => item.id === expectedGroup);
          const scene = group && active(latest, group.sceneId);
          onInvalidate();
          await activate(latest, scene?.id, scene ? group.id : undefined);
          return manager?.open() === true;
        } catch (error) {
          if (migratedDurably || error.name === 'SceneSchemaError') blocked = true;
          if (blocked) failClosedAdapters();
          setReady(initialized && !blocked); report(error, !migratedDurably);
          if (migratedDurably && error.code === 'SCENE_DIRTY_DRAFT') viewDeferred();
          return migratedDurably;
        }
      })();
      enablePending = pending;
      if (enable) enable.disabled = true;
      pending.finally(() => {
        if (enablePending === pending) enablePending = null;
        setBusy(false);
        if (enable) enable.disabled = false;
        if (refreshAfterEnable) { refreshAfterEnable = false; if (!disposed) void load(); }
      });
      return pending;
    }
    async function openManager() {
      if (disposed) return false;
      if (!initialized && !await load()) return false;
      if (blocked) { report(); return false; }
      if (controller) { ensureManager(); return manager?.open() === true; }
      ensureEntry();
      if (!introduction) return false;
      introduction.hidden = false; entry.setAttribute('aria-expanded', 'true'); enable.focus?.();
      return true;
    }
    async function saveState(...args) {
      if (disposed || blocked || (!initialized && !applyingValidatedState)) return false;
      if (!controller) return workspace.save(...args);
      const expected = getView(), target = state.currentFolderId;
      const saved = await controller.save(...args);
      if (disposed) return saved === true;
      if (saved === true && sameView(expected) && target !== expected.currentFolderId) {
        if (controller.commitLocalView?.(target, expected) === true) { syncVisibleAppearance(); renderVisible(); }
      } else if (saved !== true) {
        syncVisibleAppearance(); renderVisible();
      }
      return saved === true;
    }
    function reload(navigation) {
      if (disposed) return;
      if (navigation?.resetSceneSelection === true) {
        try { session?.removeItem(controllerAPI.SESSION_KEY); } catch (_) { notify('无法记住当前场景；重新打开标签页时可能需要重新选择。'); }
      } else if (navigation && typeof navigation.sceneId === 'string' && navigation.sceneId
        && typeof navigation.currentFolderId === 'string' && navigation.currentFolderId
        && (navigation.generation === undefined || navigation.generation === getView()?.generation)) {
        try {
          let previous; try { previous = JSON.parse(session?.getItem(controllerAPI.SESSION_KEY) || 'null'); } catch (_) {}
          const lastGroupIds = Object.fromEntries(Object.entries(previous?.lastGroupIds || {}).filter(([key, value]) => key && typeof value === 'string'));
          Object.defineProperty(lastGroupIds, navigation.sceneId, { value: navigation.currentFolderId, enumerable: true });
          session?.setItem(controllerAPI.SESSION_KEY, JSON.stringify({ sceneId: navigation.sceneId, lastGroupIds }));
        } catch (_) { notify('无法记住当前场景；重新打开标签页时可能需要重新选择。'); }
      }
      onInvalidate(); root.location?.reload();
    }
    const priorNavigation = root.OpenTabSceneNavigation;
    const navigation = {
      getView, openManager,
      selectGroup(id, context) {
        if (disposed || blocked) return Promise.resolve(false);
        return controller ? controller.selectGroup(id, context) : root.OpenTabFolders?.selectGroup(id, true) ?? Promise.resolve(false);
      }
    };
    root.OpenTabSceneNavigation = navigation;
    root.OpenTabImport?.setReloader?.(reload);
    const relevant = new Set([...(coordinator.KEYS || []), ...LAYOUT_KEYS]);
    const changedKeys = new Set();
    function committedViewIsCurrent() {
      const view = getView(), scene = active(committedSnapshot, view?.sceneId);
      return !!scene && scene.homeGroupId === view.homeGroupId
        && (committedSnapshot[coordinator.EPOCH_KEY] || 0) === loadedEpoch
        && committedSnapshot.folders?.some(group => group.id === view.currentFolderId && group.sceneId === view.sceneId);
    }
    function scheduleRefresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      queueMicrotask(verifyNotifications);
    }
    async function verifyNotifications() {
      let observed = notificationRevision;
      try {
        while (!disposed) {
          observed = notificationRevision;
          if (controller) {
            // Acknowledgements can arrive after newer local edits. Verify only
            // against an accepted durable snapshot, never optimistic state.
            // This read does not adopt/reseed or lock out adjacent UI input.
            if (!await whenAppearanceIdle()) {
              observed = notificationRevision;
              if (!disposed) { setReady(initialized && !blocked); report(fail('SCENE_PENDING_SAVE_FAILED')); }
              return;
            }
            if (disposed) return;
            const revision = committedRevision, keys = [...changedKeys];
            const latest = await coordinator.read(keys);
            if (disposed) return;
            if (revision !== committedRevision || observed !== notificationRevision) continue;
            if (committedViewIsCurrent() && keys.every(key => Object.hasOwn(latest, key) === Object.hasOwn(committedSnapshot, key)
              && sameStoredValue(latest[key], committedSnapshot[key]))) return;
          }
          // Differences and unknown data still use the original protected
          // drain/read/adopt boundary, including real scene transitions.
          if (!disposed) await load();
          if (observed === notificationRevision) return;
        }
      } catch (_) {
        if (!disposed) await load();
      } finally {
        refreshQueued = false;
        if (!disposed && observed !== notificationRevision) scheduleRefresh();
        else changedKeys.clear();
      }
    }
    function changed(changes, area) {
      if (disposed || area !== 'local' || !Object.keys(changes).some(key => relevant.has(key))) return;
      if (loadPending && !initialized) { refreshAfterLoad = true; return; }
      if (!initialized) return;
      if (enablePending) { refreshAfterEnable = true; return; }
      if (!controller && ![schema.SCHEMA_KEY, 'scenes', 'sceneProfiles'].some(key => Object.hasOwn(changes, key))) return;
      Object.keys(changes).filter(key => relevant.has(key)).forEach(key => changedKeys.add(key));
      notificationRevision += 1;
      scheduleRefresh();
    }
    root.chrome?.storage?.onChanged?.addListener(changed);
    function dispose() {
      if (disposed) return;
      setBusy(false); disposed = true;
      root.chrome?.storage?.onChanged?.removeListener?.(changed);
      manager?.destroy(); entry?.remove(); introduction?.remove(); clearStatus();
      if (controller || blockedAdapters) {
        root.OpenTabLayout?.setSceneAdapter?.(null);
        root.OpenTabImport?.setSceneContextProvider?.(null);
        restoreBingHooks();
      }
      if (root.OpenTabSceneNavigation === navigation) {
        if (priorNavigation === undefined) delete root.OpenTabSceneNavigation; else root.OpenTabSceneNavigation = priorNavigation;
        root.OpenTabImport?.setReloader?.(null);
      }
    }
    return Object.freeze({ load, getView, isActive, saveState, noteCommitted, syncVisibleAppearance, openManager, dispose });
  }
  return Object.freeze({ create });
}));
