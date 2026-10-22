(function (global) {
  const ICON_TYPE_FOLDER = 'folder';
  const DEFAULT_FOLDER_NAME = '文件夹';
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

  function ensureGroups(folders) {
    const normalized = Array.isArray(folders)
      ? folders
        .filter((item) => item && item.id && item.name && !LEGACY_PRESET_GROUP_IDS.includes(item.id))
        .map((item) => ({ id: String(item.id), name: String(item.name) }))
      : [];
    if (!normalized.some((item) => item.id === HOME_GROUP_ID)) {
      normalized.unshift({ id: HOME_GROUP_ID, name: '主页' });
    }
    return normalized;
  }

  function getGroup(folders, groupId) {
    return ensureGroups(folders).find((item) => item.id === groupId) || null;
  }

  function addGroupRecord(folders, name, id) {
    const next = ensureGroups(folders);
    const group = {
      id: id || `folder-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
      name: String(name || '').trim() || '分组'
    };
    if (next.some((item) => item.id === group.id)) {
      return { folders: next, group: next.find((item) => item.id === group.id) };
    }
    return { folders: next.concat(group), group };
  }

  function removeGroupRecord(folders, icons, groupId, mode) {
    const nextFolders = ensureGroups(folders).filter((item) => item.id !== groupId);
    let nextIcons = Array.isArray(icons) ? icons.map((icon) => ({ ...icon })) : [];
    if (mode === 'delete') {
      nextIcons = nextIcons.filter((icon) => icon.folderId !== groupId);
    } else {
      nextIcons.forEach((icon) => {
        if (icon.folderId === groupId) icon.folderId = HOME_GROUP_ID;
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

  function state() {
    return host.state;
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
    return state().icons.filter((icon) => (
      icon.folderId === gid && !(icon.parentId)
    ));
  }

  function snapshot() {
    return {
      icons: state().icons.map((icon) => ({ ...icon })),
      folders: state().folders.map((folder) => ({ ...folder })),
      currentFolderId: state().currentFolderId
    };
  }

  function restore(before) {
    state().icons = before.icons.map((icon) => ({ ...icon }));
    state().folders = before.folders.map((folder) => ({ ...folder }));
    state().currentFolderId = before.currentFolderId;
  }

  function persistUndo(before, text) {
    const after = snapshot();
    host.saveState(() => {
      restore(before);
      closeOverlay(true);
      host.refreshIconViews();
    });
    host.showToast(text, {
      actionLabel: '撤销',
      onAction: () => {
        try { restore(OpenTabWorkspace.merge(after, before, snapshot())); }
        catch (_) { host.showToast('内容已变化，无法撤销。'); return; }
        closeOverlay(true);
        host.saveState();
        host.refreshIconViews();
        host.showToast('已恢复', { duration: 1500 });
      },
      duration: 6000
    });
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
    if (!source || !target || source.id === target.id) return false;
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
      persistUndo(before, '已加入文件夹');
      host.refreshIconViews();
      return;
    }
    const folder = {
      id: `icon-folder-${host.generateId()}`,
      type: ICON_TYPE_FOLDER,
      name: DEFAULT_FOLDER_NAME,
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
    persistUndo(before, '已创建文件夹');
    host.refreshIconViews();
  }

  function addToFolder(iconId, folderId) {
    const icon = find(iconId);
    const folder = find(folderId);
    if (!icon || !isFolder(folder) || isFolder(icon) || icon.parentId === folderId) return;
    const before = snapshot();
    icon.parentId = folderId;
    icon.folderId = folder.folderId;
    persistUndo(before, '已加入文件夹');
    host.refreshIconViews();
  }

  function extractToDesktop(iconId) {
    const icon = find(iconId);
    if (!icon || !icon.parentId) return;
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
    persistUndo(before, '已移出文件夹');
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
    el.title = icon.name || DEFAULT_FOLDER_NAME;
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
    if (!isFolder(folder)) {
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
    if (!isFolder(folder)) return;
    const ui = els();
    openFolderId = folderId;
    folderNameIntent = host.captureIntent({ icons: [folderId] });
    host.rememberFocus();
    if (ui.titleInput) ui.titleInput.value = folder.name || DEFAULT_FOLDER_NAME;
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
    if (!folder || !ui.titleInput) return;
    if (!checkIntent(folderNameIntent)) { closeOverlay(true); return; }
    const trimmed = ui.titleInput.value.trim();
    if (!trimmed || trimmed === folder.name) {
      ui.titleInput.value = folder.name || DEFAULT_FOLDER_NAME;
      return;
    }
    const before = snapshot();
    folder.name = trimmed;
    persistUndo(before, '已重命名文件夹');
    folderNameIntent = host.captureIntent({ icons: [folder.id] });
    host.refreshIconViews();
  }

  function handleDeleteIcon(iconId) {
    const icon = find(iconId);
    if (!icon) return false;
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
    persistUndo(before, `已删除「${icon.name}」`);
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
    if (!isFolder(folder)) return;
    const children = getChildren(folderId);
    const urls = children.map(iconHref).filter(Boolean);
    if (!urls.length) {
      host.showToast('这个文件夹里没有可打开的链接');
      return;
    }
    if (urls.length > OPEN_ALL_CONFIRM_LIMIT) {
      const ok = await showDialog(`将打开 ${urls.length} 个标签页，是否继续？`, [
        { label: '取消', value: false },
        { label: '打开', className: 'btn-primary', value: true }
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
    if (!state().folders.some((folder) => folder.id === groupId)) return;
    const icon = find(iconId);
    if (!icon) return;
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
    persistUndo(before, '已移动到分组');
    host.refreshIconViews(true);
  }

  function selectGroup(folderId, animated) {
    if (!state().folders.some((folder) => folder.id === folderId)) return;
    const already = state().currentFolderId === folderId;
    closeOverlay(true);
    if (already) return;
    host.selectFolder(folderId, animated);
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
      host.showToast('内容已更新，重命名已取消，请重试。');
      return;
    }
    ui.tabs.innerHTML = '';
    state().folders.forEach((folder, index) => {
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
      if (index < 9) tab.title = `Alt+${index + 1}`;
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
        if (folder.id === host.HOME_FOLDER_ID) return;
        handleDeleteGroup(folder.id);
      });
      ui.tabs.appendChild(tab);
    });
  }

  function startAddGroup() {
    const ui = els();
    if (!ui.tabsBar || document.getElementById('new-group-input')) return;
    stopEditingInputs();
    const input = document.createElement('input');
    input.id = 'new-group-input';
    input.className = 'group-inline-input';
    input.type = 'text';
    input.maxLength = 24;
    const intent = host.captureIntent();
    input.placeholder = '新分组';
    input.setAttribute('aria-label', '新分组名称');
    let committed = false;
    const commit = (save) => {
      if (committed) return;
      committed = true;
      const name = save ? input.value.trim() : '';
      if (input.isConnected) input.remove();
      if (!name || !checkIntent(intent)) return;
      const before = snapshot();
      const folder = { id: `folder-${host.generateId()}`, name };
      state().folders.push(folder);
      persistUndo(before, '已新建分组');
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
    input.addEventListener('blur', () => commit(true));
    ui.tabsBar.insertBefore(input, ui.addGroupBtn || null);
    input.focus();
  }

  function checkIntent(intent) {
    if (host.isIntentCurrent(intent)) return true;
    host.showToast('内容已变化，请重新操作。');
    return false;
  }

  function startRenameGroup(folderId, tab) {
    const folder = state().folders.find((item) => item.id === folderId);
    if (!folder || !tab) return;
    const intent = host.captureIntent({ folders: [folderId] });
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
      persistUndo(before, '已重命名分组');
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
    input.addEventListener('blur', () => finish(true));
    tab.replaceWith(input);
    input.focus();
    input.select();
  }

  async function handleDeleteGroup(folderId) {
    const folder = state().folders.find((item) => item.id === folderId);
    if (!folder || folder.id === host.HOME_FOLDER_ID) return;
    const intent = host.captureIntent({ folders: [folderId], groupMembers: [folderId], icons: state().icons.filter((item) => item.folderId === folderId).map((item) => item.id) });
    const choice = await showDialog(`删除分组「${folder.name}」？`, [
      { label: '取消', value: '' },
      { label: '移到默认分组', value: 'move' },
      { label: '一起删除', className: 'danger', value: 'delete' }
    ]);
    if ((choice !== 'move' && choice !== 'delete') || !checkIntent(intent)) return;
    const before = snapshot();
    if (choice === 'move') {
      state().icons.forEach((icon) => {
        if (icon.folderId === folderId) icon.folderId = host.HOME_FOLDER_ID;
      });
    } else {
      state().icons = state().icons.filter((icon) => icon.folderId !== folderId);
    }
    state().folders = state().folders.filter((item) => item.id !== folderId);
    if (state().currentFolderId === folderId) state().currentFolderId = host.HOME_FOLDER_ID;
    closeOverlay(true);
    persistUndo(before, `已删除分组「${folder.name}」`);
    host.refreshIconViews(true);
  }

  function switchGroupByOffset(delta) {
    const list = state().folders;
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
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target.closest('input, textarea, [contenteditable]')) return;
      const match = event.code && event.code.match(/^Digit([1-9])$/);
      if (!match) return;
      const folder = state().folders[Number(match[1]) - 1];
      if (!folder) return;
      event.preventDefault();
      selectGroup(folder.id, true);
    });
    bindOverlayGrid();
  }

  function init(nextHost) {
    host = nextHost;
    bindUi();
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
    init
  };
})(window);
