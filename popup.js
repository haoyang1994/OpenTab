(() => {
  // Translate only application-owned prose, never stored user content.
  function t(source, params = {}) {
    const i18n = typeof globalThis !== 'undefined' && globalThis.OpenTabI18n;
    return i18n ? i18n.t(source, params) : String(source).replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
  }

  const HOME_FOLDER_ID = 'folder-home';
  const DEFAULT_FOLDERS = [{ id: HOME_FOLDER_ID, name: '主页' }];
  const SCHEMA_KEY = 'opentab.sceneSchemaVersion';
  const EPOCH_KEY = 'opentab.workspaceEpoch';

  const elements = {
    currentUrl: document.getElementById('current-url'),
    siteName: document.getElementById('site-name'),
    folderSelect: document.getElementById('folder-select'),
    saveBtn: document.getElementById('save-btn'),
    status: document.getElementById('status')
  };

  const state = {
    tab: null,
    folders: [],
    scenes: [],
    targets: new Map(),
    ready: false,
    saving: false
  };

  function failure(code) { return Object.assign(new Error(code), { code }); }

  function graphMode(graph) {
    const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    if (owns(graph, SCHEMA_KEY)) {
      // An unknown or damaged graph is never a legacy workspace. The popup
      // does not migrate or repair stored data while saving a single website.
      try {
        if (graph[SCHEMA_KEY] !== 2 || !globalThis.OpenTabSceneSchema) throw failure('POPUP_SCHEMA_UNAVAILABLE');
        OpenTabSceneSchema.validate(graph);
      } catch (_) { throw failure('POPUP_SCHEMA_UNAVAILABLE'); }
      return 2;
    }
    if (owns(graph, 'scenes') || owns(graph, 'sceneProfiles')
      || ['icons', 'folders', 'todos'].some(key => Array.isArray(graph[key]) && graph[key].some(item => item && owns(item, 'sceneId')))) {
      throw failure('POPUP_SCHEMA_UNAVAILABLE');
    }
    return 1;
  }

  function updateControls() {
    elements.saveBtn.disabled = state.saving || !state.ready || !state.tab || !state.targets.has(elements.folderSelect.value);
    elements.folderSelect.disabled = state.saving || !state.ready;
    elements.siteName.disabled = state.saving;
  }

  function ensureFolders(folders) {
    const normalized = Array.isArray(folders)
      ? folders
          .filter((item) => item && item.id && item.name)
          .map((item) => ({ ...item }))
      : [];

    const byId = new Map(normalized.map((item) => [item.id, item]));
    DEFAULT_FOLDERS.forEach((item) => {
      if (!byId.has(item.id)) byId.set(item.id, { ...item, name: t(item.name) });
    });
    return Array.from(byId.values());
  }

  function getFaviconCandidates(url) {
    if (window.OpenTabIcons && OpenTabIcons.faviconCandidates) {
      return OpenTabIcons.faviconCandidates(url);
    }
    try {
      const origin = new URL(url).origin;
      return [`${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`, `${origin}/favicon.png`];
    } catch (error) {
      return [];
    }
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function setStatus(text, isError = false) {
    elements.status.textContent = text;
    elements.status.classList.toggle('error', isError);
  }

  function destination(graph, mode, folder, scene) {
    return {
      mode, epoch: graph[EPOCH_KEY] || 0,
      folderId: folder.id, folderName: folder.name, parentId: folder.parentId || '',
      sceneId: scene?.id, sceneName: scene?.name, archivedAt: scene?.archivedAt,
      homeGroupId: scene?.homeGroupId
    };
  }

  function renderFolderOptions(graph, mode, requireSelection = false) {
    elements.folderSelect.innerHTML = '';
    state.targets = new Map();
    if (requireSelection) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = t('请选择保存位置。');
      placeholder.disabled = true;
      elements.folderSelect.appendChild(placeholder);
    }
    const append = (folder, scene) => {
      const option = document.createElement('option');
      option.value = folder.id;
      const homeId = scene ? scene.homeGroupId : HOME_FOLDER_ID;
      const label = folder.id === homeId ? t('{name}（默认）', { name: folder.name }) : folder.name;
      // Include the scene in each option, so it remains visible even when the
      // native select is collapsed. User-authored names are always plain text.
      option.textContent = scene ? `${scene.name} / ${label}` : label;
      state.targets.set(folder.id, destination(graph, mode, folder, scene));
      elements.folderSelect.appendChild(option);
    };
    let selected = HOME_FOLDER_ID;
    if (mode === 2) {
      const active = state.scenes.filter(scene => scene.archivedAt === null);
      for (const scene of active) {
        for (const folder of state.folders) if (folder.sceneId === scene.id) append(folder, scene);
      }
      const scene = active.find(scene => scene.id === graph.lastOpenedSceneId)
        || active.find(scene => scene.id === OpenTabSceneSchema.DEFAULT_SCENE_ID) || active[0];
      const current = state.folders.find(folder => folder.id === graph.currentFolderId && folder.sceneId === scene.id);
      selected = current ? current.id : scene.homeGroupId;
    } else {
      state.folders.forEach(folder => append(folder));
    }
    elements.folderSelect.value = requireSelection ? '' : selected;
  }

  async function loadCurrentTab() {
    // Toolbar click grants activeTab; the broad `tabs` permission is not required.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || /^chrome:\/\//.test(tab.url)) {
      state.tab = null;
      elements.currentUrl.textContent = t('当前页面不支持添加');
      setStatus(t('请在普通网页中使用该功能。'), true);
      updateControls();
      return;
    }

    state.tab = tab;
    elements.currentUrl.textContent = tab.url;
    elements.siteName.value = (tab.title || '').trim();
    elements.siteName.focus();
    elements.siteName.select();
    updateControls();
  }

  async function loadFolders(requireSelection = false) {
    state.ready = false;
    updateControls();
    const result = await OpenTabWorkspace.transaction(({ read }) => read(null));
    const mode = graphMode(result);
    state.folders = mode === 2 ? result.folders : ensureFolders(result.folders);
    state.scenes = mode === 2 ? result.scenes : [];
    renderFolderOptions(result, mode, requireSelection);
    state.ready = true;
    updateControls();
  }

  async function saveCurrentTab() {
    if (state.saving || !state.ready || !state.tab || !state.tab.url) return;

    const name = elements.siteName.value.trim();
    if (!name) {
      elements.siteName.focus();
      setStatus(t('请输入名称。'), true);
      return;
    }

    // Bind the displayed destination before waiting for the shared lock. A
    // deleted, moved, renamed or replaced target must never redirect a draft.
    const target = state.targets.get(elements.folderSelect.value);
    if (!target) { setStatus(t('请选择保存位置。'), true); return; }
    const tabUrl = state.tab.url;
    const iconCandidates = getFaviconCandidates(tabUrl);

    state.saving = true;
    updateControls();
    try {
      await OpenTabWorkspace.transaction(async ({ read, write }) => {
        const result = await read(null);
        const mode = graphMode(result);
        const icons = Array.isArray(result.icons) ? result.icons.slice() : [];
        const folders = mode === 2 ? result.folders : ensureFolders(result.folders);
        const folder = folders.find(folder => folder.id === target.folderId);
        const scene = mode === 2 && result.scenes.find(scene => scene.id === folder?.sceneId);
        if (!folder || (mode === 2 && (!scene || scene.archivedAt !== null))
          || JSON.stringify(destination(result, mode, folder, scene || undefined)) !== JSON.stringify(target)) {
          throw failure('POPUP_TARGET_CHANGED');
        }
        const existingIds = new Set(icons.map(icon => icon?.id));
        const baseId = generateId();
        let id = baseId, suffix = 0;
        while (existingIds.has(id)) id = `${baseId}-${++suffix}`;

        const record = {
          id,
          name,
          url: tabUrl,
          folderId: folder.id,
          parentId: '',
          customIconUrl: '',
          emoji: '',
          uploadedIconDataUrl: '',
          resolvedIconUrl: '',
          iconCandidates
        };
        if (window.OpenTabIcons && OpenTabIcons.prepareRecord) OpenTabIcons.prepareRecord(record);
        icons.push(record);

        // Schema 2 appends to the full canonical icon list, not a scene
        // projection. Groups, profiles, other scenes and device hints stay put.
        await write(mode === 2 ? { icons } : { icons, folders });
      });
      setStatus(t('已添加到 OpenTab。'));
      setTimeout(() => window.close(), 550);
    } catch (error) {
      if (error.code === 'POPUP_TARGET_CHANGED') {
        // Refresh the choices, but require an explicit new selection. Keep the
        // user's name and tab draft intact and never retry a save automatically.
        try { await loadFolders(true); }
        catch (reloadError) { error = reloadError; }
      }
      if (error.code === 'POPUP_SCHEMA_UNAVAILABLE') state.ready = false;
      state.saving = false;
      updateControls();
      setStatus(error.code === 'POPUP_SCHEMA_UNAVAILABLE'
        ? t('场景数据暂不可用，请在 OpenTab 中检查后重新打开。')
        : error.code === 'POPUP_TARGET_CHANGED'
          ? t('保存位置已更改，请重新选择。') : t('保存失败，请重试。'), true);
    }
  }

  elements.saveBtn.addEventListener('click', saveCurrentTab);
  elements.siteName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveCurrentTab();
  });
  elements.folderSelect.addEventListener('change', () => {
    if (state.saving) return;
    updateControls();
    if (state.targets.has(elements.folderSelect.value)) setStatus('');
  });

  updateControls();
  Promise.resolve(globalThis.OpenTabI18n?.ready).then(() => Promise.all([loadFolders(), loadCurrentTab()])).catch((error) => {
    state.ready = false;
    updateControls();
    setStatus(error.code === 'POPUP_SCHEMA_UNAVAILABLE'
      ? t('场景数据暂不可用，请在 OpenTab 中检查后重新打开。') : t('读取当前页面失败，请重试。'), true);
  });
})();
