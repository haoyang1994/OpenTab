(() => {
  const HOME_FOLDER_ID = 'folder-home';
  const LEGACY_PRESET_FOLDER_IDS = new Set(['folder-blog', 'folder-tools', 'folder-ops']);
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
    folders: []
  };

  function ensureFolders(folders) {
    const normalized = Array.isArray(folders)
      ? folders
          .filter((item) => item && item.id && item.name && !LEGACY_PRESET_FOLDER_IDS.has(item.id))
          .map((item) => ({ id: item.id, name: item.name }))
      : [];

    const byId = new Map(normalized.map((item) => [item.id, item]));
    DEFAULT_FOLDERS.forEach((item) => {
      if (!byId.has(item.id)) byId.set(item.id, { ...item });
    });
    return Array.from(byId.values());
  }

  function getFaviconCandidates(url, tabFavIcon) {
    const candidates = [];
    if (tabFavIcon) candidates.push(tabFavIcon);
    try {
      const origin = new URL(url).origin;
      candidates.push(`${origin}/favicon.ico`, `${origin}/apple-touch-icon.png`, `${origin}/favicon.png`);
    } catch (error) {
      // ignore invalid url
    }
    return Array.from(new Set(candidates));
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
      option.textContent = folder.id === HOME_FOLDER_ID ? `${folder.name}（首页）` : folder.name;
      elements.folderSelect.appendChild(option);
    });
    elements.folderSelect.value = HOME_FOLDER_ID;
  }

  async function loadCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tab || null;

    if (!tab || !tab.url || /^chrome:\/\//.test(tab.url)) {
      elements.currentUrl.textContent = '当前页面不支持添加';
      elements.saveBtn.disabled = true;
      setStatus('请在普通网页中使用该功能。', true);
      return;
    }

    elements.currentUrl.textContent = tab.url;
    elements.siteName.value = (tab.title || '').trim();
    elements.siteName.focus();
    elements.siteName.select();
  }

  function loadFolders() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['folders'], (result) => {
        state.folders = ensureFolders(result.folders);
        renderFolderOptions();
        resolve();
      });
    });
  }

  function saveCurrentTab() {
    if (!state.tab || !state.tab.url) return;

    const name = elements.siteName.value.trim();
    if (!name) {
      elements.siteName.focus();
      setStatus('请输入名称。', true);
      return;
    }

    const folderId = elements.folderSelect.value || HOME_FOLDER_ID;
    const tabUrl = state.tab.url;
    const tabFavIcon = state.tab.favIconUrl || '';
    const iconCandidates = getFaviconCandidates(tabUrl, tabFavIcon);

    chrome.storage.local.get(['icons', 'folders'], (result) => {
      const icons = Array.isArray(result.icons) ? result.icons : [];
      const folders = ensureFolders(result.folders);
      const validFolderIds = new Set(folders.map((folder) => folder.id));
      const targetFolderId = validFolderIds.has(folderId) ? folderId : HOME_FOLDER_ID;

      icons.push({
        id: generateId(),
        name,
        url: tabUrl,
        folderId: targetFolderId,
        customIconUrl: '',
        emoji: '',
        uploadedIconDataUrl: '',
        resolvedIconUrl: tabFavIcon || '',
        iconCandidates
      });

      chrome.storage.local.set({ icons, folders }, () => {
        setStatus('已添加到 OpenTab。');
        setTimeout(() => window.close(), 550);
      });
    });
  }

  elements.saveBtn.addEventListener('click', saveCurrentTab);
  elements.siteName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveCurrentTab();
  });

  Promise.all([loadFolders(), loadCurrentTab()]).catch(() => {
    setStatus('读取当前页面失败，请重试。', true);
  });
})();
