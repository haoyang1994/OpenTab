(() => {
  // Translate only application-owned prose, never stored user content.
  function t(source, params = {}) {
    const i18n = typeof globalThis !== 'undefined' && globalThis.OpenTabI18n;
    return i18n ? i18n.t(source, params) : String(source).replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
  }

  const HOME_FOLDER_ID = 'folder-home';
  const DEFAULT_FOLDERS = [{ id: HOME_FOLDER_ID, name: '主页' }];

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
    saving: false
  };

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

  function renderFolderOptions() {
    elements.folderSelect.innerHTML = '';
    state.folders.forEach((folder) => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.id === HOME_FOLDER_ID ? t('{name}（默认）', { name: folder.name }) : folder.name;
      elements.folderSelect.appendChild(option);
    });
    elements.folderSelect.value = HOME_FOLDER_ID;
  }

  async function loadCurrentTab() {
    // Toolbar click grants activeTab; the broad `tabs` permission is not required.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tab || null;

    if (!tab || !tab.url || /^chrome:\/\//.test(tab.url)) {
      elements.currentUrl.textContent = t('当前页面不支持添加');
      elements.saveBtn.disabled = true;
      setStatus(t('请在普通网页中使用该功能。'), true);
      return;
    }

    elements.currentUrl.textContent = tab.url;
    elements.siteName.value = (tab.title || '').trim();
    elements.siteName.focus();
    elements.siteName.select();
  }

  async function loadFolders() {
    const result = await OpenTabWorkspace.transaction(({ read }) => read(['folders']));
    state.folders = ensureFolders(result.folders);
    renderFolderOptions();
  }

  async function saveCurrentTab() {
    if (state.saving || !state.tab || !state.tab.url) return;

    const name = elements.siteName.value.trim();
    if (!name) {
      elements.siteName.focus();
      setStatus(t('请输入名称。'), true);
      return;
    }

    const folderId = elements.folderSelect.value || HOME_FOLDER_ID;
    const tabUrl = state.tab.url;
    const iconCandidates = getFaviconCandidates(tabUrl);

    state.saving = true;
    elements.saveBtn.disabled = true;
    try {
      await OpenTabWorkspace.transaction(async ({ read, write }) => {
        const result = await read(['icons', 'folders']);
        const icons = Array.isArray(result.icons) ? result.icons.slice() : [];
        const folders = ensureFolders(result.folders);
        const validFolderIds = new Set(folders.map((folder) => folder.id));
        const targetFolderId = validFolderIds.has(folderId) ? folderId : HOME_FOLDER_ID;

        const record = {
          id: generateId(),
          name,
          url: tabUrl,
          folderId: targetFolderId,
          parentId: '',
          customIconUrl: '',
          emoji: '',
          uploadedIconDataUrl: '',
          resolvedIconUrl: '',
          iconCandidates
        };
        if (window.OpenTabIcons && OpenTabIcons.prepareRecord) OpenTabIcons.prepareRecord(record);
        icons.push(record);

        await write({ icons, folders });
      });
      setStatus(t('已添加到 OpenTab。'));
      setTimeout(() => window.close(), 550);
    } catch (error) {
      state.saving = false;
      elements.saveBtn.disabled = false;
      setStatus(t('保存失败，请重试。'), true);
    }
  }

  elements.saveBtn.addEventListener('click', saveCurrentTab);
  elements.siteName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveCurrentTab();
  });

  Promise.resolve(globalThis.OpenTabI18n?.ready).then(() => Promise.all([loadFolders(), loadCurrentTab()])).catch(() => {
    setStatus(t('读取当前页面失败，请重试。'), true);
  });
})();
