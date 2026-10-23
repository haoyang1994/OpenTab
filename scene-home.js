// Normalize the complete durable graph before rendering a projected home view.
// Never replace canonical entity arrays with a scene-filtered subset.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSceneHome = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  function create(host) {
    const window = root;
    const { OpenTabSceneSchema, OpenTabWorkspace, OpenTabLayout, OpenTabFolders, OpenTabIcons, OpenTabBingCache } = root;
    const { state, HOME_FOLDER_ID, LEGACY_PRESET_FOLDER_IDS, activeHomeId, t, ensureFolders, normalizeIconType, migrateBackground, backgroundsEqual, getFolderById, updateClock, renderTimezoneList, initCalendar, renderWorkspaceSettings, workspace, refreshIconViews, renderTodos, setTodoPanelOpen, saveState, writeBootMirror } = host;
    return function applyLoadedState(result, raw = result) {
    const sceneEnabled = result[OpenTabSceneSchema.SCHEMA_KEY] === 2;
    if (sceneEnabled) {
      for (const key of [OpenTabSceneSchema.SCHEMA_KEY, 'scenes', 'sceneProfiles', 'lastOpenedSceneId', OpenTabWorkspace.EPOCH_KEY]) {
        if (Object.hasOwn(result, key)) state[key] = structuredClone(result[key]);
      }
  }
    if (!Object.keys(result).length) state.themeMode = 'light';
    if (window.OpenTabLayout) OpenTabLayout.loadFromStorage(result);
    state.folders = sceneEnabled ? structuredClone(result.folders) : ensureFolders(result.folders).filter(
      (folder) => !LEGACY_PRESET_FOLDER_IDS.has(folder.id)
    );
    if (!sceneEnabled && !state.folders.some((folder) => folder.id === HOME_FOLDER_ID)) {
      state.folders.unshift({ id: HOME_FOLDER_ID, name: t('主页') });
  }
    const validFolderIds = new Set(state.folders.map((folder) => folder.id));

    state.icons = Array.isArray(result.icons)
      ? result.icons.map((icon) => ({
        ...icon,
        type: icon.type === 'folder' ? 'folder' : normalizeIconType(icon.type),
        parentId: typeof icon.parentId === 'string' ? icon.parentId : '',
        folderId: validFolderIds.has(icon.folderId) ? icon.folderId : activeHomeId(),
        customIconUrl: icon.customIconUrl || '',
        emoji: icon.emoji || '',
        uploadedIconDataUrl: icon.uploadedIconDataUrl || '',
        resolvedIconUrl: icon.resolvedIconUrl || '',
        sshGatewayUrl: icon.sshGatewayUrl || '',
        sshGatewayToken: icon.sshGatewayToken || '',
        sshHost: icon.sshHost || '',
        sshPort: Number.isInteger(icon.sshPort) ? icon.sshPort : 22,
        sshUsername: icon.sshUsername || '',
        sshPassword: icon.sshPassword || '',
        sshSocksHost: icon.sshSocksHost || '',
        sshSocksPort: Number.isInteger(icon.sshSocksPort) ? icon.sshSocksPort : 1080,
        sshSocksUsername: icon.sshSocksUsername || '',
        sshSocksPassword: icon.sshSocksPassword || ''
      }))
      : [];

    let backgroundChanged = false;
    if (result.background) {
      const migratedBackground = migrateBackground(result.background);
      backgroundChanged = !backgroundsEqual(migratedBackground, result.background);
      state.background = migratedBackground;
  }
    if (Array.isArray(result.todos)) {
      state.todos = result.todos
        .filter((item) => item && item.id && typeof item.text === 'string')
        .map((item) => ({ ...(sceneEnabled ? item : {}), id: item.id, text: item.text, done: Boolean(item.done) }));
  }
    state.todoButtonVisible = result.todoButtonVisible !== false;
    if (result.todoPanelOpen !== undefined) {
      state.todoPanelOpen = Boolean(result.todoPanelOpen);
  }
    if (result.clockFormat) state.clockFormat = result.clockFormat;
    if (result.showSeconds !== undefined) state.showSeconds = result.showSeconds;
    if (result.uiOpacity !== undefined) state.uiOpacity = Number(result.uiOpacity);
    if (result.uiBlur !== undefined) state.uiBlur = Number(result.uiBlur);
    if (result.iconFrameEnabled !== undefined) state.iconFrameEnabled = Boolean(result.iconFrameEnabled);
    state.openInNewTab = Boolean(result.openInNewTab);
    // Keep the durable preference distinct from its effective system fallback.
    // Missing values clear stale boot state and remain absent until chosen.
    state.timezone = result.timezone;
    state.timezoneMode = result.timezoneMode;
    if (result.bingIndex !== undefined) state.bingIndex = result.bingIndex;
    if (result.themeMode) state.themeMode = result.themeMode;
    if (result.accentHue !== undefined) state.accentHue = Number(result.accentHue);
    if (result.particlesEnabled !== undefined) state.particlesEnabled = Boolean(result.particlesEnabled);
    if (result.gradientFlow !== undefined) state.gradientFlow = Boolean(result.gradientFlow);
    if (result.minimalMode !== undefined) state.minimalMode = Boolean(result.minimalMode);

    if (window.OpenTabFolders) OpenTabFolders.repairIconGraph(state.icons);
    if (window.OpenTabIcons) state.icons.forEach((icon) => OpenTabIcons.prepareRecord(icon));
    const requestedFolderId = result.currentFolderId || activeHomeId();
    state.currentFolderId = getFolderById(requestedFolderId) ? requestedFolderId : activeHomeId();

    updateClock();
    renderTimezoneList();
    // Preserve the initial selected date, but build hidden calendar DOM only
    // when its actual control opens it, never on the first-grid path.
    initCalendar(true);

    renderWorkspaceSettings();
    workspace.seed(raw, { ...OpenTabWorkspace.migrationOverrides(raw, state), ...(!sceneEnabled && backgroundChanged ? { background: raw.background } : {}) });
    refreshIconViews(false);
    renderTodos();
    setTodoPanelOpen(state.todoPanelOpen);
    if (window.OpenTabIcons) OpenTabIcons.scheduleIdleMigration();

    if (backgroundChanged) saveState();
    OpenTabBingCache.afterStateLoaded();
    writeBootMirror();

  }
  }
  // Unsupported graphs and pending scene commands cannot reach legacy shortcuts.
  function bindInteractionGate(getFlags, target = root) {
    const guard = event => {
      const { readOnly, busy } = getFlags();
      if (!readOnly && !busy) return;
      const recovery = event.target?.closest?.(readOnly ? '#scene-recovery' : '.scene-dialog');
      if (recovery && (event.type !== 'keydown' || (!event.altKey && !event.ctrlKey && !event.metaKey && ['Tab', 'Enter', ' ', 'Escape'].includes(event.key)))) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    ['click', 'auxclick', 'contextmenu', 'keydown', 'pointerdown', 'submit'].forEach(type => target.addEventListener(type, guard, true));
    return guard;
  }
  function canDiscard(host) {
    return !host.isSaving && !host.todoAddPending && !root.OpenTabSiteList.isBusy() && !root.OpenTabSiteSelection.isPending();
  }
  function canSwitch(host) {
    const { elements, todoAddPending } = host;
    return !host.isSaving && !root.OpenTabSiteList.isBusy() && !root.OpenTabSiteSelection.isPending()
      && elements.addIconModal.classList.contains('hidden')
      && root.document.getElementById('settings-panel').classList.contains('hidden')
      && root.document.getElementById('change-icon-modal')?.classList.contains('hidden') !== false
      && !root.document.querySelector('.group-inline-input') && (!elements.todoInput.value.trim() || todoAddPending)
      && !root.document.querySelector('dialog[open]:not(.scene-dialog):not(.scene-enable-dialog):not(.scene-recovery)');
  }
  function discardDraft(host) {
    if (host.canDiscard() !== true) return false;
    host.closeAddIconModal();
    root.OpenTabIcons?.closeChanger();
    host.elements.todoInput.value = '';
    root.document.querySelectorAll('.group-inline-input').forEach(input => input.dispatchEvent(new root.CustomEvent('opentab-cancel-edit')));
    root.OpenTabSiteSelection?.cancel(false);
    root.OpenTabFolders?.handleEscape();
    root.OpenTabFolders?.closeOverlay();
    root.OpenTabSettingsNav?.close();
    return true;
  }
  return { create, bindInteractionGate, canSwitch, canDiscard, discardDraft };
}));
