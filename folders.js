(function (global) {
  const t = (s, p) => globalThis.OpenTabI18n ? globalThis.OpenTabI18n.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p?.[k] ?? m);

  const ICON_TYPE_FOLDER = 'folder';
  const MERGE_HOVER_MS = 500;
  const WHEEL_THROTTLE_MS = 250;
  const OPEN_ALL_CONFIRM_LIMIT = 10;
  const HOME_GROUP_ID = 'folder-home';
  const LEGACY_PRESET_GROUP_IDS = ['folder-blog', 'folder-tools', 'folder-ops'];
  const STORAGE_KEYS = {
    groups: 'folders',
    currentGroupId: 'currentFolderId',
    iconGroupId: 'folderId',
    iconParentId: 'parentId'
  };

  function iconSelector(id) {
    return `.icon-widget[data-id="${CSS.escape(String(id))}"]`;
  }

  function groupSelector(id) {
    return `#group-tabs [data-group-id="${CSS.escape(String(id))}"]`;
  }

  // Option+digits are text-producing keys on macOS, not group shortcuts.
  const hasGroupDigitShortcuts = () => !/Mac/i.test(global.navigator?.userAgentData?.platform || global.navigator?.platform || '');

  function ensureGroups(folders) {
    const normalized = Array.isArray(folders)
      ? folders
        .filter((item) => item && item.id && item.name && (item.sceneId || !LEGACY_PRESET_GROUP_IDS.includes(item.id)))
        .map((item) => ({ ...item, id: String(item.id), name: String(item.name) }))
      : [];
    if (!normalized.some((item) => item.id === HOME_GROUP_ID)) {
      normalized.unshift({ id: HOME_GROUP_ID, name: t('主页'), ...(normalized.some(item => item.sceneId) ? { sceneId: 'scene-default' } : {}) });
    }
    return normalized;
  }

  function getGroup(folders, groupId) {
    return ensureGroups(folders).find((item) => item.id === groupId) || null;
  }

  function addGroupRecord(folders, name, id, view = null) {
    const next = ensureGroups(folders);
    const group = {
      id: id || `folder-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
      name: String(name || '').trim() || t('分组'),
      ...(view ? { sceneId: view.sceneId } : {})
    };
    if (next.some((item) => item.id === group.id)) {
      return { folders: next, group: next.find((item) => item.id === group.id) };
    }
    return { folders: next.concat(group), group };
  }

  function removeGroupRecord(folders, icons, groupId, mode, view = null) {
    const groups = ensureGroups(folders);
    if (view && (groupId === view.homeGroupId || !groups.some(group => group.id === groupId && group.sceneId === view.sceneId))) {
      return { folders: groups, icons: Array.isArray(icons) ? icons.map(icon => ({ ...icon })) : [] };
    }
    const nextFolders = groups.filter((item) => item.id !== groupId);
    let nextIcons = Array.isArray(icons) ? icons.map((icon) => ({ ...icon })) : [];
    if (mode === 'delete') {
      nextIcons = nextIcons.filter((icon) => icon.folderId !== groupId);
    } else {
      nextIcons.forEach((icon) => {
        if (icon.folderId === groupId) icon.folderId = view?.homeGroupId || HOME_GROUP_ID;
      });
    }
    return { folders: nextFolders, icons: nextIcons };
  }

  function iconsInGroup(icons, groupId, options) {
    const parentId = options && options.parentId !== undefined ? options.parentId : null;
    return (icons || []).filter((icon) => {
      if (icon.folderId !== groupId) return false;
      if (parentId === null) return true;
      return (icon.parentId || '') === parentId;
    });
  }

  function assignIconGroup(icon, groupId) {
    icon.folderId = groupId;
    return icon;
  }

  let host = null;
  let mergeTimer = 0;
  let mergeTargetId = null;
  let mergeSourceId = null;
  let lastWheelAt = 0;
  let openFolderId = null;
  let folderNameIntent = null;
  let activeRoot = null;
  let dialogResolver = null;
  let uiBound = false;
  let groupPopRequest = null;
  let groupMotionQuery = null;
  const groupPopAnimations = new Set();

  function state() {
    return host.state;
  }

  // A scene is a projection of the full graph. Never persist a visible subset.
  // The absent adapter preserves the pre-scenes module contract.
  function sceneView() {
    if (!host?.getSceneView) return null;
    const view = host.getSceneView();
    return { sceneId: view?.sceneId, homeGroupId: view?.homeGroupId, generation: view?.generation };
  }

  function sceneActive(view, data = state()) {
    if (!view) return true;
    const scene = (data.scenes || []).find(item => item.id === view.sceneId);
    return !!scene && scene.archivedAt === null && scene.homeGroupId === view.homeGroupId;
  }

  function sameView(view) {
    const current = sceneView();
    return !view ? !current : !!current && view.sceneId === current.sceneId
      && view.homeGroupId === current.homeGroupId && view.generation === current.generation;
  }

  function groupInView(groupId, view = sceneView(), data = state()) {
    if (!view) return true;
    return sceneActive(view, data) && (data.folders || []).some(group => group.id === groupId && group.sceneId === view.sceneId);
  }

  function visibleGroups() {
    const view = sceneView();
    return !view ? state().folders : sceneActive(view) ? state().folders.filter(group => group.sceneId === view.sceneId) : [];
  }

  function activeHomeId() { return sceneView()?.homeGroupId || host.HOME_FOLDER_ID || HOME_GROUP_ID; }
  function iconInView(icon) { return !!icon && groupInView(icon.folderId); }

  const intentViews = new WeakMap();
  function captureIntent(targets) {
    const intent = host.captureIntent(targets);
    intentViews.set(intent, sceneView());
    return intent;
  }
  function isIntentCurrent(intent) {
    const view = intentViews.get(intent);
    return host.isIntentCurrent(intent) && sameView(view) && sceneActive(view);
  }

  function sceneGuard(view, groupIds = []) {
    return latest => sameView(view) && sceneActive(view, latest)
      && groupIds.every(id => groupInView(id, view, latest));
  }

  function els() {
    return {
      tabsBar: document.getElementById('group-tabs-bar'),
      tabs: document.getElementById('group-tabs'),
      addGroupBtn: document.getElementById('add-group-btn'),
      overlay: document.getElementById('folder-overlay'),
      backdrop: document.getElementById('folder-overlay-backdrop'),
      panel: document.getElementById('folder-panel'),
      titleInput: document.getElementById('folder-title-input'),
      overlayIcons: document.getElementById('folder-icons-container'),
      dialog: document.getElementById('inline-dialog'),
      dialogMessage: document.getElementById('inline-dialog-message'),
      dialogActions: document.getElementById('inline-dialog-actions'),
      openAllBtn: document.getElementById('open-all-icon-btn'),
      editBtn: document.getElementById('edit-icon-btn'),
      changeIconBtn: document.getElementById('change-icon-btn')
    };
  }

  function find(id) {
    return state().icons.find((icon) => icon.id === id);
  }

  function isFolder(icon) {
    return Boolean(icon && icon.type === ICON_TYPE_FOLDER);
  }

  function isFolderId(id) {
    return isFolder(find(id));
  }

  function getChildren(folderId) {
    return state().icons.filter((icon) => (icon.parentId || '') === folderId);
  }

  function visibleIcons(groupId) {
    const gid = groupId || state().currentFolderId;
    if (!groupInView(gid)) return [];
    return state().icons.filter((icon) => (
      icon.folderId === gid && !(icon.parentId)
    ));
  }

  function snapshot() {
    return {
      icons: state().icons.map((icon) => ({ ...icon })),
      folders: state().folders.map((folder) => ({ ...folder })),
      currentFolderId: state().currentFolderId,
      ...(state()['opentab.sceneSchemaVersion'] ? {
        'opentab.sceneSchemaVersion': state()['opentab.sceneSchemaVersion'],
        scenes: state().scenes.map(scene => ({ ...scene })),
        sceneProfiles: state().sceneProfiles.map(profile => ({ ...profile })),
        todos: state().todos.map(todo => ({ ...todo }))
      } : {})
    };
  }

  function restore(before) {
    state().icons = before.icons.map((icon) => ({ ...icon }));
    state().folders = before.folders.map((folder) => ({ ...folder }));
    state().currentFolderId = before.currentFolderId;
    if (sceneView() && (!state().folders.some(group => group.id === state().currentFolderId) || !groupInView(state().currentFolderId))) {
      state().currentFolderId = activeHomeId();
    }
  }

  // Only the bulk website transaction can mint this scoped cross-scene capability.
  const bulkUndoScopes = new WeakMap();
  function sceneUndoGuards(before, after, view, options) {
    // Only affected memberships are dependencies, not independent group labels.
    const changedGroups = new Set();
    for (const key of ['icons', 'folders']) {
      const old = new Map(before[key].map(item => [item.id, item]));
      const next = new Map(after[key].map(item => [item.id, item]));
      for (const id of new Set([...old.keys(), ...next.keys()])) {
        if (JSON.stringify(old.get(id)) === JSON.stringify(next.get(id))) continue;
        if (key === 'folders') changedGroups.add(id);
        else for (const item of [old.get(id), next.get(id)]) if (item) changedGroups.add(item.folderId);
      }
    }
    const protect = (snapshot, supplied) => {
      const groupIds = new Set(snapshot.folders.map(group => group.id));
      const ids = [...changedGroups].filter(id => groupIds.has(id)), scope = bulkUndoScopes.get(options);
      const scoped = scope && bulkEqual(view, scope.sourceView) && bulkEqual(before.folders, after.folders)
        && ids.every(id => id === scope.sourceGroupId || id === scope.destinationGroupId);
      const guard = scoped
        ? latest => sceneGuard(view, [scope.sourceGroupId])(latest) && groupInView(scope.destinationGroupId, scope.destinationScene, latest)
        : sceneGuard(view, ids);
      return latest => (!supplied || supplied(latest)) && guard(latest);
    };
    return { guard: protect(before, options.guard), undoGuard: protect(after, options.undoGuard) };
  }

  async function persistUndo(before, text, options = {}) {
    const after = snapshot(), intent = host.captureIntent();
    const view = host.getSceneView ? sceneView() : null;
    const current = () => host.isIntentCurrent(intent) && (!view || sameView(view) && sceneActive(view));
    const { guard, undoGuard } = view ? sceneUndoGuards(before, after, view, options) : options;
    // Workspace owns failure recovery and rehydrates the latest durable state.
    const saved = await host.saveState(undefined, undefined, guard);
    if (!saved || !current()) return false;
    host.showToast(text, {
      intent, actionLabel: t('撤销'),
      onAction: async () => {
        if (!current()) return false;
        try { restore(OpenTabWorkspace.merge(after, before, snapshot())); }
        catch (_) { host.showToast(t('内容已变化，无法撤销。')); return; }
        closeOverlay(true);
        const saved = host.saveState(undefined, undefined, undoGuard);
        host.refreshIconViews();
        if (await saved) host.showToast(t('已恢复'), { duration: 1500 });
      },
      duration: 6000
    });
    return true;
  }

  function ensureFolders(folders) {
    return ensureGroups(folders);
  }

  function repairIconGraph(icons) {
    const list = Array.isArray(icons) ? icons : [];
    const folders = new Set(list.filter(isFolder).map((icon) => icon.id));
    list.forEach((icon) => {
      if (icon.parentId && !folders.has(icon.parentId)) icon.parentId = '';
      if (icon.parentId === icon.id) icon.parentId = '';
      if (isFolder(icon)) icon.parentId = '';
    });
    return list;
  }

  function normalizeLoadedIcon(icon, validFolderIds, homeId, normalizeType) {
    const type = icon && icon.type === ICON_TYPE_FOLDER
      ? ICON_TYPE_FOLDER
      : normalizeType(icon.type);
    return {
      ...icon,
      type,
      parentId: typeof icon.parentId === 'string' ? icon.parentId : '',
      folderId: validFolderIds.has(icon.folderId) ? icon.folderId : homeId
    };
  }

  function setActiveGrid(root) {
    activeRoot = root || host.getIconsContainer();
  }

  function activeGridRoot() {
    if (activeRoot && document.contains(activeRoot)) return activeRoot;
    return host.getIconsContainer();
  }

  function slotsParentId() {
    const root = activeGridRoot();
    if (openFolderId && root && root.id === 'folder-icons-container') return openFolderId;
    return '';
  }

  function clearMergeHover() {
    if (mergeTimer) {
      clearTimeout(mergeTimer);
      mergeTimer = 0;
    }
    mergeTargetId = null;
    mergeSourceId = null;
    document.querySelectorAll('.folder-merge-target').forEach((node) => {
      node.classList.remove('folder-merge-target');
    });
  }

  function armMerge(sourceId, targetId) {
    if (mergeTargetId === targetId && mergeSourceId === sourceId) return;
    clearMergeHover();
    mergeSourceId = sourceId;
    mergeTargetId = targetId;
    const target = document.querySelector(iconSelector(targetId));
    if (target) target.classList.add('folder-merge-target');
    mergeTimer = setTimeout(() => {
      const src = mergeSourceId;
      const dst = mergeTargetId;
      mergeTimer = 0;
      clearMergeHover();
      host.endDesktopDrag();
      mergeIcons(src, dst);
    }, MERGE_HOVER_MS);
  }

  function canMerge(source, target) {
    if (!source || !target || source.id === target.id || !iconInView(source) || !iconInView(target)) return false;
    if (isFolder(source)) return false;
    if (source.parentId) return false;
    if (target.parentId) return false;
    return true;
  }

  function handleGridDragOver(event, draggingId) {
    const widget = event.target.closest('.icon-widget[data-id]');
    if (!widget || widget.dataset.id === draggingId) {
      if (mergeTargetId) clearMergeHover();
      return false;
    }
    const source = find(draggingId);
    const target = find(widget.dataset.id);
    if (!canMerge(source, target)) {
      if (mergeTargetId) clearMergeHover();
      return false;
    }
    host.hideDropIndicator();
    armMerge(draggingId, target.id);
    return true;
  }

  function handleGridDrop(event, iconId) {
    const icon = find(iconId);
    if (!icon) return false;
    const destRoot = event.currentTarget;
    const destParent = destRoot && destRoot.id === 'folder-icons-container' ? (openFolderId || '') : '';
    const srcParent = icon.parentId || '';
    if (srcParent === destParent) return false;
    if (isFolder(icon) && destParent) return true;
    if (!destParent) {
      extractToDesktop(iconId);
      return true;
    }
    addToFolder(iconId, destParent);
    return true;
  }

  function handleGridClick(event, icon) {
    if (!isFolder(icon)) return false;
    event.preventDefault();
    openOverlay(icon.id);
    return true;
  }

  function mergeIcons(sourceId, targetId) {
    const source = find(sourceId);
    const target = find(targetId);
    if (!canMerge(source, target)) return;
    const before = snapshot();
    if (isFolder(target)) {
      source.parentId = target.id;
      source.folderId = target.folderId;
      persistUndo(before, t('已加入文件夹'));
      host.refreshIconViews();
      return;
    }
    const folder = {
      id: `icon-folder-${host.generateId()}`,
      type: ICON_TYPE_FOLDER,
      name: t('文件夹'),
      folderId: target.folderId,
      parentId: '',
      url: '',
      emoji: '',
      customIconUrl: '',
      uploadedIconDataUrl: '',
      resolvedIconUrl: '',
      iconCandidates: []
    };
    const targetIndex = state().icons.findIndex((item) => item.id === target.id);
    source.parentId = folder.id;
    target.parentId = folder.id;
    source.folderId = target.folderId;
    state().icons.splice(targetIndex < 0 ? state().icons.length : targetIndex, 0, folder);
    persistUndo(before, t('已创建文件夹'));
    host.refreshIconViews();
  }

  function addToFolder(iconId, folderId) {
    const icon = find(iconId);
    const folder = find(folderId);
    if (!icon || !isFolder(folder) || !iconInView(icon) || !iconInView(folder) || isFolder(icon) || icon.parentId === folderId) return;
    const before = snapshot();
    icon.parentId = folderId;
    icon.folderId = folder.folderId;
    persistUndo(before, t('已加入文件夹'));
    host.refreshIconViews();
  }

  function extractToDesktop(iconId) {
    const icon = find(iconId);
    if (!icon || !icon.parentId || !iconInView(icon)) return;
    const before = snapshot();
    const folderId = icon.parentId;
    const folder = find(folderId);
    icon.parentId = '';
    icon.folderId = (folder && folder.folderId) || state().currentFolderId;
    const from = state().icons.indexOf(icon);
    if (from >= 0) state().icons.splice(from, 1);
    const folderIndex = state().icons.findIndex((item) => item.id === folderId);
    state().icons.splice(folderIndex >= 0 ? folderIndex + 1 : state().icons.length, 0, icon);
    dissolveIfNeeded(folderId);
    persistUndo(before, t('已移出文件夹'));
    host.refreshIconViews();
  }

  function dissolveIfNeeded(folderId) {
    const folder = find(folderId);
    if (!folder) return;
    const children = getChildren(folderId);
    if (children.length > 1) return;
    if (children.length === 1) {
      const child = children[0];
      child.parentId = '';
      child.folderId = folder.folderId;
      const childIndex = state().icons.indexOf(child);
      if (childIndex >= 0) state().icons.splice(childIndex, 1);
      const folderIndex = state().icons.findIndex((item) => item.id === folderId);
      if (folderIndex >= 0) state().icons.splice(folderIndex, 1, child);
      else state().icons.push(child);
    } else {
      state().icons = state().icons.filter((item) => item.id !== folderId);
    }
    if (openFolderId === folderId) closeOverlay(true);
  }

  function decorateWidget(el, icon) {
    if (!el || !isFolder(icon)) return el;
    el.classList.add('icon-folder');
    el.dataset.type = ICON_TYPE_FOLDER;
    el.removeAttribute('href');
    el.removeAttribute('aria-disabled');
    el.role = 'button';
    el.tabIndex = 0;
    el.title = icon.name || t('文件夹');
    const visual = el.querySelector('.icon-visual');
    if (visual) {
      visual.innerHTML = '';
      visual.classList.add('folder-preview');
      visual.classList.remove('has-image');
      getChildren(icon.id).slice(0, 4).forEach((child) => {
        const cell = document.createElement('span');
        cell.className = 'folder-preview-cell';
        const imgUrl = (typeof OpenTabIcons !== 'undefined' && OpenTabIcons.paintSrc)
          ? OpenTabIcons.paintSrc(child)
          : (child.uploadedIconDataUrl || '');
        if (imgUrl) {
          const img = document.createElement('img');
          img.src = imgUrl;
          img.alt = '';
          img.draggable = false;
          cell.appendChild(img);
        } else {
          cell.textContent = ((child.name || '•').trim()[0] || '•').toUpperCase();
        }
        visual.appendChild(cell);
      });
    }
    return el;
  }

  function renderOverlayIcons() {
    const ui = els();
    if (!ui.overlayIcons || !openFolderId) return;
    const folder = find(openFolderId);
    if (!isFolder(folder) || !iconInView(folder)) {
      closeOverlay(true);
      return;
    }
    ui.overlayIcons.innerHTML = '';
    getChildren(openFolderId).forEach((icon) => {
      ui.overlayIcons.appendChild(host.createIconWidget(icon));
    });
    const add = host.createAddShortcutTile();
    add.removeAttribute('id');
    add.classList.add('add-shortcut-tile');
    ui.overlayIcons.appendChild(add);
    bindOverlayGrid();
  }

  function openOverlay(folderId) {
    const folder = find(folderId);
    if (!isFolder(folder) || !iconInView(folder)) return;
    const ui = els();
    openFolderId = folderId;
    folderNameIntent = captureIntent({ icons: [folderId] });
    host.rememberFocus();
    if (ui.titleInput) ui.titleInput.value = folder.name || t('文件夹');
    if (ui.overlay) ui.overlay.classList.remove('hidden');
    renderOverlayIcons();
    if (ui.titleInput) {
      ui.titleInput.focus();
      ui.titleInput.select();
    }
  }

  function closeOverlay(silent) {
    const ui = els();
    const wasOpen = Boolean(openFolderId);
    openFolderId = null;
    if (ui.overlay) ui.overlay.classList.add('hidden');
    if (activeRoot && activeRoot.id === 'folder-icons-container') activeRoot = host.getIconsContainer();
    if (!silent && wasOpen) host.restoreFocus();
  }

  function saveOpenFolderName() {
    const ui = els();
    const folder = find(openFolderId);
    if (!folder || !ui.titleInput || !iconInView(folder)) return;
    if (!checkIntent(folderNameIntent)) { closeOverlay(true); return; }
    const trimmed = ui.titleInput.value.trim();
    if (!trimmed || trimmed === folder.name) {
      ui.titleInput.value = folder.name || t('文件夹');
      return;
    }
    const before = snapshot();
    folder.name = trimmed;
    persistUndo(before, t('已重命名文件夹'));
    folderNameIntent = captureIntent({ icons: [folder.id] });
    host.refreshIconViews();
  }

  function handleDeleteIcon(iconId) {
    const icon = find(iconId);
    if (!icon || !iconInView(icon)) return false;
    if (!isFolder(icon) && !icon.parentId) return false;
    const before = snapshot();
    if (isFolder(icon)) {
      const removed = new Set([icon.id, ...getChildren(icon.id).map((child) => child.id)]);
      state().icons = state().icons.filter((item) => !removed.has(item.id));
      if (openFolderId === icon.id) closeOverlay(true);
    } else {
      const folderId = icon.parentId;
      state().icons = state().icons.filter((item) => item.id !== icon.id);
      dissolveIfNeeded(folderId);
    }
    persistUndo(before, t('已删除「{name}」', { name: icon.name }));
    host.refreshIconViews();
    return true;
  }

  function iconHref(icon) {
    return host.getIconHref(icon) || '';
  }

  function openUrls(urls) {
    urls.forEach((url) => {
      if (chrome.tabs && typeof chrome.tabs.create === 'function') {
        chrome.tabs.create({ url, active: false });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  }

  async function openAll(folderId) {
    const folder = find(folderId);
    if (!isFolder(folder) || !iconInView(folder)) return;
    const children = getChildren(folderId);
    const urls = children.map(iconHref).filter(Boolean);
    if (!urls.length) {
      host.showToast(t('这个文件夹里没有可打开的链接'));
      return;
    }
    if (urls.length > OPEN_ALL_CONFIRM_LIMIT) {
      const ok = await showDialog(t('将打开 {count} 个标签页，是否继续？', { count: urls.length }), [
        { label: t('取消'), value: false },
        { label: t('打开'), className: 'btn-primary', value: true }
      ]);
      if (!ok) return;
    }
    openUrls(urls);
  }

  function showDialog(message, actions) {
    const ui = els();
    return new Promise((resolve) => {
      closeDialog(undefined, true);
      if (host.rememberFocus) host.rememberFocus();
      dialogResolver = resolve;
      if (ui.dialogMessage) ui.dialogMessage.textContent = message;
      if (ui.dialogActions) {
        ui.dialogActions.innerHTML = '';
        actions.forEach((action) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = action.label;
          btn.className = action.className || 'btn-secondary';
          btn.addEventListener('click', () => closeDialog(action.value));
          ui.dialogActions.appendChild(btn);
        });
      }
      if (ui.dialog) ui.dialog.classList.remove('hidden');
      const focusBtn = ui.dialogActions && ui.dialogActions.querySelector('button');
      if (focusBtn) focusBtn.focus();
    });
  }

  function closeDialog(value, silent) {
    const ui = els();
    if (ui.dialog) ui.dialog.classList.add('hidden');
    const resolver = dialogResolver;
    dialogResolver = null;
    if (!silent && resolver) resolver(value);
  }

  function dialogOpen() {
    const ui = els();
    return Boolean(ui.dialog && !ui.dialog.classList.contains('hidden'));
  }

  function overlayOpen() {
    const ui = els();
    return Boolean(openFolderId && ui.overlay && !ui.overlay.classList.contains('hidden'));
  }

  function higherLayerOpen() {
    return ['icon-context-menu', 'add-icon-modal'].some((id) => {
      const node = document.getElementById(id);
      return node && !node.classList.contains('hidden');
    });
  }

  function handleEscape() {
    if (dialogOpen()) {
      closeDialog(false);
      return true;
    }
    const renaming = document.querySelector('.group-inline-input');
    if (renaming) {
      renaming.dispatchEvent(new CustomEvent('opentab-cancel-edit'));
      if (renaming.isConnected) renaming.remove();
      return true;
    }
    if (higherLayerOpen()) return false;
    if (overlayOpen()) {
      closeOverlay(true);
      return true;
    }
    return false;
  }

  function syncContextMenu(iconId) {
    const ui = els();
    const folder = isFolderId(iconId);
    if (ui.openAllBtn) ui.openAllBtn.classList.toggle('hidden', !folder);
    if (ui.editBtn) ui.editBtn.classList.toggle('hidden', folder);
    if (ui.changeIconBtn) {
      const icon = find(iconId);
      ui.changeIconBtn.classList.toggle('hidden', !!(folder || (icon && icon.type === 'ssh')));
    }
  }

  function onAuxClick(event) {
    if (event.button !== 1) return;
    const widget = event.target.closest('.icon-widget[data-id]');
    if (!widget) return;
    const icon = find(widget.dataset.id);
    if (!isFolder(icon)) return;
    event.preventDefault();
    openAll(icon.id);
  }

  function onMiddleDown(event) {
    if (event.button !== 1) return;
    const widget = event.target.closest('.icon-widget[data-id]');
    if (widget && isFolderId(widget.dataset.id)) event.preventDefault();
  }

  function bindOverlayGrid() {
    const ui = els();
    if (!ui.overlayIcons || ui.overlayIcons.dataset.bound === '1') return;
    ui.overlayIcons.dataset.bound = '1';
    host.bindGrid(ui.overlayIcons);
    ui.overlayIcons.addEventListener('auxclick', onAuxClick);
    ui.overlayIcons.addEventListener('mousedown', onMiddleDown);
  }

  function moveIconToGroup(iconId, groupId) {
    if (!state().folders.some((folder) => folder.id === groupId) || !groupInView(groupId)) return;
    const icon = find(iconId);
    if (!icon || !iconInView(icon)) return;
    if (icon.folderId === groupId && !icon.parentId) return;
    const before = snapshot();
    const fromParent = icon.parentId || '';
    const moving = isFolder(icon)
      ? [icon, ...getChildren(icon.id)]
      : [icon];
    moving.forEach((item) => {
      item.folderId = groupId;
      if (item.id === icon.id) item.parentId = '';
    });
    if (fromParent) dissolveIfNeeded(fromParent);
    persistUndo(before, t('已移动到分组'));
    host.refreshIconViews(true);
  }

  // Tokens retain the original view, rather than accepting refreshed objects at Confirm.
  const bulkSelections = new WeakMap();
  const bulkDestinations = new WeakMap();
  let bulkMovePending = false;
  const copyBulk = (value) => JSON.parse(JSON.stringify(value));
  const bulkStable = (value) => Array.isArray(value) ? value.map(bulkStable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, bulkStable(value[key])])) : value;
  const bulkEqual = (a, b) => JSON.stringify(bulkStable(a)) === JSON.stringify(bulkStable(b));

  // Match the editable intent fields, not hydration defaults or derived favicon caches.
  function bulkIconRecord(icon) {
    if (!icon) return null;
    const fields = ['id', 'name', 'url', 'type', 'folderId', 'parentId', 'customIconUrl', 'emoji', 'uploadedIconDataUrl', 'toolSubtype', 'sshGatewayUrl', 'sshHost', 'sshPort', 'sshUsername', 'sshSocksHost', 'sshSocksPort', 'sshSocksUsername'];
    return Object.fromEntries(fields.filter((key) => icon[key] !== undefined && icon[key] !== '' && icon[key] !== false
      && !(key === 'type' && icon[key] === 'shortcut') && !(key === 'folderId' && icon[key] === HOME_GROUP_ID)
      && !(key === 'sshPort' && icon[key] === 22) && !(key === 'sshSocksPort' && icon[key] === 1080)).map((key) => [key, icon[key]]));
  }

  function isBulkWebsite(icon) {
    if (!icon || (icon.type && icon.type !== 'shortcut')) return false;
    try { return ['http:', 'https:'].includes(new URL(icon.url).protocol); }
    catch (_) { return false; }
  }

  function bulkSceneIdentity(sceneId, data = state()) {
    const scene = (data.scenes || []).find(item => item.id === sceneId);
    return scene ? { sceneId: scene.id, homeGroupId: scene.homeGroupId, name: scene.name, iconKey: scene.iconKey, archivedAt: scene.archivedAt } : null;
  }

  function bulkGroupPath(groupId, scene, data = state()) {
    if (!scene || !sceneActive(scene, data)) return null;
    const groups = new Map((data.folders || []).map(group => [group.id, group])), path = [], seen = new Set();
    for (let id = groupId; id;) {
      const group = groups.get(id);
      if (!group || seen.has(id) || group.sceneId !== scene.sceneId) return null;
      seen.add(id); path.unshift(group); id = group.parentId;
    }
    return path.length ? path : null;
  }

  function bulkPathIdentity(path, names = true) {
    return path && path.map(group => ({ id: group.id, sceneId: group.sceneId, parentId: group.parentId || '', ...(names ? { name: group.name } : {}) }));
  }

  function bulkDestinationMetadata(group, folder, view) {
    const destinationScene = bulkSceneIdentity(group.sceneId), ancestors = bulkGroupPath(group.id, destinationScene);
    if (!ancestors) return null;
    const groupPath = ancestors.map(item => ({ id: item.id, name: item.name }));
    return { view: { ...view }, sourceView: { ...view }, destinationScene, sceneId: destinationScene.sceneId,
      sceneName: destinationScene.name, groupPath, path: [destinationScene.name, ...groupPath.map(item => item.name), ...(folder ? [folder.name] : [])] };
  }

  function bulkMoveContext() {
    const groupId = state().currentFolderId, parentId = openFolderId || '', view = sceneView();
    const groups = view ? state().folders.filter(group => bulkGroupPath(group.id, bulkSceneIdentity(group.sceneId))) : visibleGroups();
    const groupIds = new Set(groups.map(group => group.id));
    const sourceValid = groupIds.has(groupId) && groupInView(groupId, view);
    const destinations = [
      ...groups.map(group => ({ kind: 'group', id: group.id, name: group.name, groupId: group.id, ...(view ? bulkDestinationMetadata(group, null, view) : {}) })),
      ...state().icons.filter(icon => isFolder(icon) && (!view || !icon.parentId) && groupIds.has(icon.folderId)).map(folder => {
        const group = groups.find(item => item.id === folder.folderId);
        return { kind: 'folder', id: folder.id, name: folder.name, groupId: group.id, groupName: group.name, ...(view ? bulkDestinationMetadata(group, folder, view) : {}) };
      })
    ];
    return {
      scope: { groupId, parentId, ...(view ? { view } : {}) },
      sites: state().icons.filter(icon => sourceValid && icon.folderId === groupId && (icon.parentId || '') === parentId && isBulkWebsite(icon)).map(copyBulk),
      destinations: sceneActive(view) ? destinations : []
    };
  }

  function captureBulkSelection() {
    const context = bulkMoveContext(), token = {};
    const icons = context.sites.map((icon) => icon.id);
    if (context.scope.parentId) icons.push(context.scope.parentId, ...getChildren(context.scope.parentId).map((icon) => icon.id));
    bulkSelections.set(token, { ...context, before: snapshot(), intent: captureIntent({ icons, folders: context.scope.view ? [] : [context.scope.groupId] }) });
    return token;
  }

  function captureBulkDestination(destination) {
    if (!destination || !['group', 'folder'].includes(destination.kind)) return null;
    const view = sceneView();
    if (!sceneActive(view) || destination.view && !sameView(destination.view)
      || destination.sourceView && !sameView(destination.sourceView)) return null;
    const record = destination.kind === 'group'
      ? state().folders.find((group) => group.id === destination.id) : find(destination.id);
    if (!record || (destination.kind === 'folder' && (!isFolder(record) || view && record.parentId))) return null;
    const token = {}, groupId = destination.kind === 'group' ? record.id : record.folderId;
    if (destination.name !== undefined && destination.name !== record.name
      || destination.groupId !== undefined && destination.groupId !== groupId) return null;
    const group = state().folders.find((item) => item.id === groupId);
    if (!group || destination.groupName !== undefined && destination.groupName !== group.name) return null;
    const metadata = view ? bulkDestinationMetadata(group, destination.kind === 'folder' ? record : null, view) : null;
    if (view && (!metadata || group.sceneId !== view.sceneId && (!destination.sourceView || !destination.destinationScene))) return null;
    if (view && ['destinationScene', 'sceneId', 'sceneName', 'groupPath', 'path'].some(key => destination[key] !== undefined && !bulkEqual(destination[key], metadata[key]))) return null;
    bulkDestinations.set(token, { view, sourceView: view, destinationScene: metadata?.destinationScene || null,
      path: metadata?.path, ancestors: view ? bulkPathIdentity(bulkGroupPath(groupId, metadata.destinationScene)) : null,
      kind: destination.kind, id: record.id, groupId, record: copyBulk(record), group: copyBulk(group),
      intent: captureIntent({ icons: destination.kind === 'folder' ? [record.id] : [], folders: [groupId] }) });
    return token;
  }

  // Runs again on the latest durable state under the workspace lock. Bind both
  // scenes and each ancestor, not just the leaf with the displayed target name.
  function bulkGuard(before, ids, sourceParent, destination, epoch, sourceGroupId, sourceBefore = before) {
    const watched = new Set(ids), sourceView = destination.sourceView;
    const sourceScene = sourceView ? bulkSceneIdentity(sourceView.sceneId, sourceBefore) : null;
    const sourcePath = sourceView ? bulkPathIdentity(bulkGroupPath(sourceGroupId, sourceScene, sourceBefore), false) : null;
    if (sourceParent) {
      watched.add(sourceParent);
      before.icons.filter((icon) => icon.parentId === sourceParent).forEach((icon) => watched.add(icon.id));
    }
    return (latest) => {
      if ((latest['opentab.workspaceEpoch'] || 0) !== epoch || !sceneGuard(sourceView, [sourceGroupId])(latest)) return false;
      if (sourceView && (!sourcePath || !bulkEqual(sourceScene, bulkSceneIdentity(sourceView.sceneId, latest))
        || !bulkEqual(sourcePath, bulkPathIdentity(bulkGroupPath(sourceGroupId, sourceScene, latest), false))
        || !bulkEqual(destination.destinationScene, bulkSceneIdentity(destination.destinationScene.sceneId, latest))
        || !bulkEqual(destination.ancestors, bulkPathIdentity(bulkGroupPath(destination.groupId, destination.destinationScene, latest))))) return false;
      const currentIcons = latest.icons || [];
      // Legacy workspaces omit folders entirely; hydration supplies the Home group.
      // A present array remains authoritative, including an explicitly deleted Home.
      const currentGroups = Array.isArray(latest.folders) ? latest.folders : ensureGroups([]);
      if (![...watched].every((id) => bulkEqual(bulkIconRecord(before.icons.find((icon) => icon.id === id)), bulkIconRecord(currentIcons.find((icon) => icon.id === id))))) return false;
      if (sourceParent && !bulkEqual(before.icons.filter((icon) => icon.parentId === sourceParent).map((icon) => icon.id), currentIcons.filter((icon) => icon.parentId === sourceParent).map((icon) => icon.id))) return false;
      if (!bulkEqual(destination.group, currentGroups.find((group) => group.id === destination.groupId))) return false;
      return destination.kind !== 'folder' || bulkEqual(bulkIconRecord(destination.record), bulkIconRecord(currentIcons.find((icon) => icon.id === destination.id)));
    };
  }

  async function moveSites(selectionToken, selectedIds, destinationToken) {
    if (bulkMovePending) return { ok: false, reason: 'busy' };
    const selection = bulkSelections.get(selectionToken), destination = bulkDestinations.get(destinationToken);
    if (!selection || !destination || !Array.isArray(selectedIds) || !selectedIds.length
      || selectedIds.length > selection.sites.length || new Set(selectedIds).size !== selectedIds.length
      || !selectedIds.every((id) => selection.sites.some((icon) => icon.id === id))) return { ok: false, reason: 'invalid' };
    if (!sameView(destination.sourceView) || !sceneActive(destination.sourceView)
      || !isIntentCurrent(selection.intent) || !isIntentCurrent(destination.intent)
      || !bulkEqual(selection.scope, bulkMoveContext().scope)) return { ok: false, reason: 'stale' };
    const before = snapshot(), parentId = destination.kind === 'folder' ? destination.id : '';
    const ids = new Set(selectedIds), moving = state().icons.filter((icon) => ids.has(icon.id));
    if (moving.length !== ids.size || !moving.every(isBulkWebsite)) return { ok: false, reason: 'stale' };
    const guard = bulkGuard(selection.before, selectedIds, selection.scope.parentId, destination, selection.intent.epoch, selection.scope.groupId);
    if (!guard({ ...state(), ...before, 'opentab.workspaceEpoch': selection.intent.epoch })) return { ok: false, reason: 'stale' };
    if (moving.every((icon) => icon.folderId === destination.groupId && (icon.parentId || '') === parentId)) return { ok: true, moved: 0 };
    bulkMovePending = true;
    try {
      moving.forEach((icon) => { icon.folderId = destination.groupId; icon.parentId = parentId; });
      if (selection.scope.parentId && selection.scope.parentId !== parentId) dissolveIfNeeded(selection.scope.parentId);
      const after = snapshot();
      const affectedIds = selectedIds.concat(before.icons.filter((icon) => icon.parentId === selection.scope.parentId && selection.scope.parentId).map((icon) => icon.id));
      const undoGuard = bulkGuard(after, affectedIds, selection.scope.parentId, destination, selection.intent.epoch, selection.scope.groupId, selection.before);
      let stale = false;
      const checkedGuard = latest => { const accepted = guard(latest); if (!accepted) stale = true; return accepted; };
      const options = { guard: checkedGuard, undoGuard };
      if (destination.sourceView && destination.sourceView.sceneId !== destination.destinationScene.sceneId) {
        bulkUndoScopes.set(options, { sourceView: destination.sourceView, sourceGroupId: selection.scope.groupId,
          destinationScene: destination.destinationScene, destinationGroupId: destination.groupId });
      }
      const text = destination.path ? t('已将 {count} 个网站移到「{path}」。', { count: moving.length, path: destination.path.join(' / ') }) : t('已移动 {count} 个网站', { count: moving.length });
      const saving = persistUndo(before, text, options);
      host.refreshIconViews();
      const saved = await saving;
      // The scene controller can reject its outer view/active-scene guard
      // before checkedGuard runs. Save settles only after workspace recovery;
      // classify that recovered graph, never the optimistic moved records.
      // Epoch lives in the workspace bridge, not the hydrated state object.
      if (!saved && !stale) stale = !guard({ ...state(), 'opentab.workspaceEpoch': host.captureIntent().epoch });
      host.refreshIconViews();
      return saved ? { ok: true, moved: moving.length } : { ok: false, reason: stale ? 'stale' : 'save-failed' };
    } finally { bulkMovePending = false; }
  }

  function cancelGroupPop() {
    for (const animation of groupPopAnimations) animation.cancel();
    groupPopAnimations.clear();
  }

  function onGroupMotionChange(event) {
    if (!event.matches) return;
    groupPopRequest = null;
    cancelGroupPop();
  }

  // Called only after the desktop's new nodes are mounted. A one-shot request,
  // rather than a render/CSS class, keeps saves and unrelated refreshes still.
  function animateGroupIcons(container) {
    cancelGroupPop();
    const request = groupPopRequest;
    if (!request) return;
    if (state().currentFolderId !== request.folderId) {
      // A pending save may refresh the source before navigation commits.
      if (state().currentFolderId !== request.sourceId || !sameView(request.view)) groupPopRequest = null;
      return;
    }
    groupPopRequest = null;
    const view = sceneView(), source = request.view;
    const currentView = !source ? !view : view && source.sceneId === view.sceneId
      && source.homeGroupId === view.homeGroupId
      && (view.generation === source.generation || view.generation === source.generation + 1);
    if (!currentView || !groupInView(request.folderId) || groupMotionQuery?.matches) return;
    for (const node of container?.querySelectorAll('.icon-widget[data-id]') || []) {
      if (typeof node.animate !== 'function') continue;
      try {
        // Individual transforms compose with hover/drag transforms. No layout,
        // stagger, exit delay, retained styles or pointer/focus blocking.
        const animation = node.animate([
          { opacity: 0.25, scale: '0.96', translate: '0 4px' },
          { opacity: 1, scale: '1', translate: '0 0' }
        ], { id: 'opentab-group-pop', duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'none' });
        groupPopAnimations.add(animation);
        animation.onfinish = animation.oncancel = () => groupPopAnimations.delete(animation);
      } catch (_) { /* Motion is optional and cannot break group navigation. */ }
    }
  }

  function selectGroup(folderId, animated) {
    if (!state().folders.some((folder) => folder.id === folderId) || (host.getSceneView && !groupInView(folderId))) return false;
    const already = state().currentFolderId === folderId;
    closeOverlay(true);
    if (already) return true;
    cancelGroupPop();
    const request = animated === true && !groupMotionQuery?.matches
      ? { folderId, sourceId: state().currentFolderId, view: sceneView() } : null;
    groupPopRequest = request;
    const clearRequest = () => { if (groupPopRequest === request) groupPopRequest = null; };
    try {
      // Never wait for the legacy exit/stagger before accepting the next group.
      const result = host.selectFolder(folderId, false);
      if (result && typeof result.then === 'function') result.then(clearRequest, clearRequest);
      else clearRequest();
      return result;
    } catch (error) { clearRequest(); throw error; }
  }

  function groupCount(folderId) {
    return visibleIcons(folderId).length;
  }

  function stopEditingInputs() {
    document.querySelectorAll('.group-inline-input').forEach((node) => node.remove());
  }

  function renderGroupTabs() {
    const ui = els();
    if (!ui.tabs) return;
    const draft = ui.tabs.querySelector('.group-rename-input');
    if (draft) {
      draft.dispatchEvent(new Event('opentab-cancel-edit'));
      host.showToast(t('内容已更新，重命名已取消，请重试。'));
      return;
    }
    ui.tabs.innerHTML = '';
    visibleGroups().forEach((folder, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `group-tab${folder.id === state().currentFolderId ? ' active' : ''}`;
      tab.dataset.groupId = folder.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', folder.id === state().currentFolderId ? 'true' : 'false');
      tab.textContent = folder.name;
      const count = document.createElement('span');
      count.className = 'group-tab-count';
      count.textContent = String(groupCount(folder.id));
      tab.appendChild(count);
      if (index < 9 && hasGroupDigitShortcuts()) tab.title = `Alt+${index + 1}`;
      tab.addEventListener('click', () => selectGroup(folder.id, true));
      tab.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startRenameGroup(folder.id, tab);
      });
      tab.addEventListener('dragover', (event) => {
        if (!host.getDraggingIconId()) return;
        event.preventDefault();
        tab.classList.add('drop-target');
      });
      tab.addEventListener('dragleave', () => tab.classList.remove('drop-target'));
      tab.addEventListener('drop', (event) => {
        event.preventDefault();
        tab.classList.remove('drop-target');
        const iconId = (event.dataTransfer && event.dataTransfer.getData(host.ICON_DND_TYPE)) || host.getDraggingIconId();
        host.endDesktopDrag();
        if (iconId) moveIconToGroup(iconId, folder.id);
      });
      tab.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (folder.id === activeHomeId()) return;
        handleDeleteGroup(folder.id);
      });
      ui.tabs.appendChild(tab);
    });
  }

  function startAddGroup() {
    const ui = els();
    if (!ui.tabsBar || document.getElementById('new-group-input') || !sceneActive(sceneView())) return;
    stopEditingInputs();
    const input = document.createElement('input');
    input.id = 'new-group-input';
    input.className = 'group-inline-input';
    input.type = 'text';
    input.maxLength = 24;
    const intent = captureIntent(), view = sceneView();
    input.placeholder = t('新分组');
    input.setAttribute('aria-label', t('新分组名称'));
    let committed = false;
    const commit = (save) => {
      if (committed) return;
      committed = true;
      const name = save ? input.value.trim() : '';
      if (input.isConnected) input.remove();
      if (!name || !checkIntent(intent) || !sameView(view) || !sceneActive(view)) return;
      const before = snapshot();
      const folder = { id: `folder-${host.generateId()}`, name, ...(view ? { sceneId: view.sceneId } : {}) };
      state().folders.push(folder);
      persistUndo(before, t('已新建分组'));
      selectGroup(folder.id, true);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        commit(false);
      }
    });
    input.addEventListener('opentab-cancel-edit', () => commit(false));
    input.addEventListener('blur', () => { if (host.isEditingBlocked?.() !== true) commit(true); });
    ui.tabsBar.insertBefore(input, ui.addGroupBtn || null);
    input.focus();
  }

  function checkIntent(intent) {
    if (isIntentCurrent(intent)) return true;
    host.showToast(t('内容已变化，请重新操作。'));
    return false;
  }

  function startRenameGroup(folderId, tab) {
    const folder = state().folders.find((item) => item.id === folderId);
    if (!folder || !tab || !groupInView(folderId)) return;
    const intent = captureIntent({ folders: [folderId] });
    stopEditingInputs();
    const input = document.createElement('input');
    input.className = 'group-inline-input group-rename-input';
    input.type = 'text';
    input.maxLength = 24;
    input.value = folder.name;
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const next = input.value.trim();
      if (input.isConnected) input.remove();
      renderGroupTabs();
      if (!save || !next || next === folder.name || !checkIntent(intent)) return;
      const before = snapshot();
      state().folders.find((item) => item.id === folderId).name = next;
      persistUndo(before, t('已重命名分组'));
      host.refreshIconViews();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('opentab-cancel-edit', () => finish(false));
    input.addEventListener('blur', () => { if (host.isEditingBlocked?.() !== true) finish(true); });
    tab.replaceWith(input);
    input.focus();
    input.select();
  }

  async function handleDeleteGroup(folderId) {
    const folder = state().folders.find((item) => item.id === folderId);
    if (!folder || !groupInView(folderId) || folder.id === activeHomeId()) return;
    const intent = captureIntent({ folders: [folderId], groupMembers: [folderId], icons: state().icons.filter((item) => item.folderId === folderId).map((item) => item.id) });
    const choice = await showDialog(t('删除分组「{name}」？', { name: folder.name }), [
      { label: t('取消'), value: '' },
      { label: t('移到默认分组'), value: 'move' },
      { label: t('一起删除'), className: 'danger', value: 'delete' }
    ]);
    if ((choice !== 'move' && choice !== 'delete') || !checkIntent(intent)) return;
    const before = snapshot();
    if (choice === 'move') {
      state().icons.forEach((icon) => {
        if (icon.folderId === folderId) icon.folderId = activeHomeId();
      });
    } else {
      state().icons = state().icons.filter((icon) => icon.folderId !== folderId);
    }
    state().folders = state().folders.filter((item) => item.id !== folderId);
    if (state().currentFolderId === folderId) state().currentFolderId = activeHomeId();
    closeOverlay(true);
    persistUndo(before, t('已删除分组「{name}」', { name: folder.name }));
    host.refreshIconViews(true);
  }

  function switchGroupByOffset(delta) {
    const list = visibleGroups();
    const index = list.findIndex((folder) => folder.id === state().currentFolderId);
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    selectGroup(list[next].id, true);
  }

  function renderChrome() {
    renderGroupTabs();
    if (openFolderId) renderOverlayIcons();
  }

  function currentOpenParentId() {
    return openFolderId || '';
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    const ui = els();
    const desktop = host.getIconsContainer();
    if (desktop) {
      desktop.addEventListener('auxclick', onAuxClick);
      desktop.addEventListener('mousedown', onMiddleDown);
    }
    if (ui.addGroupBtn) ui.addGroupBtn.addEventListener('click', startAddGroup);
    if (ui.tabsBar) {
      ui.tabsBar.addEventListener('wheel', (event) => {
        if (!event.deltaY) return;
        event.preventDefault();
        const now = Date.now();
        if (now - lastWheelAt < WHEEL_THROTTLE_MS) return;
        lastWheelAt = now;
        switchGroupByOffset(event.deltaY > 0 ? 1 : -1);
      }, { passive: false });
    }
    if (ui.backdrop) {
      ui.backdrop.addEventListener('click', () => {
        if (!dialogOpen()) closeOverlay();
      });
      ui.backdrop.addEventListener('dragover', (event) => {
        if (!host.getDraggingIconId()) return;
        event.preventDefault();
      });
      ui.backdrop.addEventListener('drop', (event) => {
        const iconId = (event.dataTransfer && event.dataTransfer.getData(host.ICON_DND_TYPE)) || host.getDraggingIconId();
        event.preventDefault();
        host.endDesktopDrag();
        if (iconId) extractToDesktop(iconId);
      });
    }
    if (ui.titleInput) {
      ui.titleInput.addEventListener('change', saveOpenFolderName);
      ui.titleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          ui.titleInput.blur();
        }
      });
    }
    if (ui.openAllBtn) {
      ui.openAllBtn.addEventListener('click', () => {
        const menu = document.getElementById('icon-context-menu');
        const iconId = host.getContextMenuIconId && host.getContextMenuIconId();
        if (host.hideIconContextMenu) host.hideIconContextMenu();
        if (iconId) openAll(iconId);
      });
    }
    document.addEventListener('keydown', (event) => {
      if (!hasGroupDigitShortcuts() || document.body?.classList.contains('zen-mode')) return;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.which === 229 || event.key === 'Process' || event.key === 'Dead') return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable], [role="textbox"]')) return;
      const match = event.code && event.code.match(/^Digit([1-9])$/);
      if (!match) return;
      const folder = visibleGroups()[Number(match[1]) - 1];
      if (!folder) return;
      event.preventDefault();
      selectGroup(folder.id, true);
    });
    bindOverlayGrid();
  }

  function init(nextHost) {
    groupPopRequest = null;
    cancelGroupPop();
    groupMotionQuery?.removeEventListener?.('change', onGroupMotionChange);
    groupMotionQuery = global.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    groupMotionQuery?.addEventListener?.('change', onGroupMotionChange);
    host = nextHost;
    bindUi();
    global.OpenTabSiteSelection?.init(nextHost);
    global.OpenTabGroupLaunch?.init(nextHost);
  }

  // Groups are the old drawers: storage still uses folders[] / folderId / currentFolderId.
  // Nested desktop folders are type:'folder' tiles with parentId. Iter 6 can import
  // bookmarks as groups through ensureGroups / addGroupRecord / assignIconGroup.
  global.OpenTabFolders = {
    HOME_GROUP_ID,
    ICON_TYPE_FOLDER,
    MERGE_HOVER_MS,
    STORAGE_KEYS,
    iconSelector,
    groupSelector,
    ensureGroups,
    ensureFolders,
    getGroup,
    addGroupRecord,
    removeGroupRecord,
    iconsInGroup,
    assignIconGroup,
    normalizeLoadedIcon,
    repairIconGraph,
    isFolder,
    isFolderId,
    visibleIcons,
    visibleGroups,
    decorateWidget,
    handleGridDragOver,
    handleGridDrop,
    handleGridClick,
    handleDeleteIcon,
    clearMergeHover,
    setActiveGrid,
    activeGridRoot,
    slotsParentId,
    currentOpenParentId,
    renderChrome,
    closeOverlay,
    openOverlay,
    overlayOpen,
    handleEscape,
    showDialog,
    syncContextMenu,
    moveIconToGroup,
    bulkMoveContext,
    captureBulkSelection,
    captureBulkDestination,
    moveSites,
    selectGroup,
    animateGroupIcons,
    init
  };
})(window);
