(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabImport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOME_GROUP_ID = 'folder-home';
  const TOP_SITES_LIMIT = 12;
  const UNDO_KEY = 'opentab.importUndo';
  const NOTICE_KEY = 'opentab.importNotice';
  const SECRET_FIELDS = ['sshPassword', 'sshGatewayToken', 'sshSocksPassword'];

  const MSG_BOOKMARKS_DENIED = '未获得书签权限，已取消导入。可在下次点击时重新授权。';
  const MSG_TOPSITES_DENIED = '未获得常用网站权限，已取消导入。可在下次点击时重新授权。';
  const MSG_UNRECOGNIZED = '无法识别该备份文件（请使用 Infinity / WeTab / iTab 的 JSON 备份）。现有数据未改动。';
  const MSG_INVALID_JSON = '无法解析该文件：不是有效的 JSON。现有数据未改动。';

  let chromeRef = null;
  let idFactory = null;
  let reloader = null;

  function getChrome() {
    if (chromeRef) return chromeRef;
    return typeof chrome !== 'undefined' ? chrome : null;
  }

  function setChrome(api) {
    chromeRef = api || null;
  }

  function setIdFactory(fn) {
    idFactory = typeof fn === 'function' ? fn : null;
  }

  function setReloader(fn) {
    reloader = typeof fn === 'function' ? fn : null;
  }

  function generateId() {
    if (idFactory) return idFactory();
    return 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function reloadPage() {
    if (reloader) {
      reloader();
      return;
    }
    if (typeof location !== 'undefined' && typeof location.reload === 'function') {
      location.reload();
    }
  }

  function oncePair() {
    let settled = false;
    return (resolve, reject) => (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
  }

  function chromeCall(fn, args) {
    return new Promise((resolve, reject) => {
      if (typeof fn !== 'function') {
        reject(new Error('unsupported'));
        return;
      }
      const finish = oncePair()(resolve, reject);
      try {
        const list = Array.isArray(args) ? args : [];
        let usedPromise = false;
        const ret = fn(...list, (result) => {
          if (usedPromise) return;
          const err = getChrome() && getChrome().runtime && getChrome().runtime.lastError;
          if (err) finish(new Error(err.message || 'chrome error'));
          else finish(null, result);
        });
        if (ret && typeof ret.then === 'function') {
          usedPromise = true;
          ret.then((result) => finish(null, result), (error) => finish(error || new Error('denied')));
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  function storageLocalGet(keys) {
    const api = getChrome();
    if (!api || !api.storage || !api.storage.local) return Promise.resolve({});
    return chromeCall(api.storage.local.get.bind(api.storage.local), [keys]).then((result) => result || {});
  }

  function storageLocalSet(payload) {
    const api = getChrome();
    if (!api || !api.storage || !api.storage.local) return Promise.resolve();
    return chromeCall(api.storage.local.set.bind(api.storage.local), [payload]);
  }

  function copyGroupRecord(item) {
    const group = { id: String(item.id), name: String(item.name) };
    if (item.parentId != null && item.parentId !== '') group.parentId = String(item.parentId);
    if (item.type) group.type = String(item.type);
    return group;
  }

  function foldersToGroups(folders) {
    if (!Array.isArray(folders)) return [];
    return folders
      .filter((folder) => folder && folder.id && folder.name)
      .map(copyGroupRecord);
  }

  function groupsToFolders(groups) {
    if (!Array.isArray(groups)) return [];
    return groups
      .filter((group) => group && group.id && group.name)
      .map(copyGroupRecord);
  }

  function readIconGroupId(icon) {
    if (icon && icon.folderId) return icon.folderId;
    return HOME_GROUP_ID;
  }

  function withIconGroup(icon, groupId) {
    const next = Object.assign({}, icon);
    next.folderId = groupId || HOME_GROUP_ID;
    return next;
  }

  function stripSecretsFromState(input) {
    if (Array.isArray(input)) return input.map(stripSecretsFromState);
    if (!input || typeof input !== 'object') return input;
    const out = {};
    Object.keys(input).forEach((key) => {
      if (key === 'opentab.secretVault' || key === 'opentab.cryptoKey') return;
      if (SECRET_FIELDS.indexOf(key) >= 0) {
        out[key] = '';
        return;
      }
      out[key] = stripSecretsFromState(input[key]);
    });
    return out;
  }

  const BACKUP_SNAPSHOTS_KEY = 'backupSnapshots';
  const BACKUP_MAX_SNAPSHOTS = 20;
  const BACKUP_SNAPSHOT_MAX_BYTES = 1500 * 1024;
  const BACKUP_CORE_KEYS = [
    'icons',
    'folders',
    'currentFolderId',
    'todos',
    'todoPanelOpen',
    'background',
    'clockFormat',
    'showSeconds',
    'uiOpacity',
    'uiBlur',
    'iconFrameEnabled',
    'openInNewTab',
    'timezone',
    'bingIndex',
    'themeMode',
    'accentHue',
    'particlesEnabled',
    'gradientFlow',
    'minimalMode',
    'layoutIconSize',
    'layoutColumns',
    'layoutShowNames',
    'layoutMaxWidth',
    'developerToolsEnabled'
  ];

  function searchBackupKeys(includeHistory) {
    const keys = (typeof OpenTabSearch !== 'undefined' && Array.isArray(OpenTabSearch.STORAGE_KEYS))
      ? OpenTabSearch.STORAGE_KEYS.slice()
      : ['searchEngine', 'customSearchEngines', 'searchOpenInNewTab', 'searchHistoryEnabled', 'searchHistory'];
    return includeHistory ? keys : keys.filter((key) => key !== 'searchHistory');
  }

  function backupStateKeys(includeHistory) {
    return BACKUP_CORE_KEYS.concat(searchBackupKeys(includeHistory));
  }

  function unwrapBackupPayload(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') return {};
    if (rawPayload.data && typeof rawPayload.data === 'object' && !Array.isArray(rawPayload.data)
      && (rawPayload.version || rawPayload.exportedAt || rawPayload.data.icons || rawPayload.data.background)) {
      return rawPayload.data;
    }
    return rawPayload;
  }

  function updateBackupStatus(message, isError) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('backup-status');
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#ffb4b4' : 'rgba(255, 255, 255, 0.65)';
  }

  function makeBackupFilename(prefix) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
      + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    return (prefix || 'opentab-backup') + '-' + ts + '.json';
  }

  function mergeBackupPayload(rawPayload, current) {
    const payload = unwrapBackupPayload(rawPayload);
    const includeHistory = payload.searchHistory !== undefined || (current && current.searchHistory !== undefined);
    const keys = backupStateKeys(includeHistory);
    const merged = {};
    keys.forEach((key) => {
      if (payload[key] !== undefined) merged[key] = payload[key];
      else if (current && current[key] !== undefined) merged[key] = current[key];
    });
    if (typeof OpenTabSearch !== 'undefined' && OpenTabSearch.normalizeBackup) {
      const normalizedSearch = OpenTabSearch.normalizeBackup(Object.assign({}, current || {}, payload));
      searchBackupKeys(true).forEach((key) => {
        if (payload[key] !== undefined || (current && current[key] !== undefined)) {
          merged[key] = normalizedSearch[key];
        }
      });
      if (payload.searchHistory === undefined && !(current && current.searchHistory !== undefined)) {
        delete merged.searchHistory;
      }
    }
    return stripSecretsFromState(merged);
  }

  async function buildBackupPayload(includeHistory) {
    const keys = backupStateKeys(!!includeHistory);
    const current = await storageLocalGet(keys);
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString()
    };
    keys.forEach((key) => {
      if (current[key] !== undefined) payload[key] = current[key];
    });
    if (typeof OpenTabSearch !== 'undefined' && OpenTabSearch.getBackupSlice && includeHistory) {
      Object.assign(payload, OpenTabSearch.getBackupSlice());
    }
    if (!includeHistory) delete payload.searchHistory;
    return stripSecretsFromState(payload);
  }

  function stripSnapshotIconData(icons) {
    return (Array.isArray(icons) ? icons : []).map((icon) => {
      if (!icon || typeof icon !== 'object') return icon;
      const next = Object.assign({}, icon);
      ['uploadedIconDataUrl', 'resolvedIconUrl', 'customIconUrl'].forEach((field) => {
        const value = next[field];
        if (typeof value === 'string' && (value.indexOf('data:') === 0 || value.indexOf('blob:') === 0 || value.indexOf('chrome-extension:') === 0)) {
          next[field] = '';
        }
      });
      delete next.iconCacheState;
      return next;
    });
  }

  function trimSnapshotList(list) {
    let trimmed = (Array.isArray(list) ? list : []).slice(0, BACKUP_MAX_SNAPSHOTS);
    while (trimmed.length > 1) {
      const bytes = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(JSON.stringify(trimmed)).length
        : JSON.stringify(trimmed).length;
      if (bytes <= BACKUP_SNAPSHOT_MAX_BYTES) break;
      trimmed.pop();
    }
    return trimmed;
  }

  async function saveSnapshotRecord(reason) {
    const current = await storageLocalGet(backupStateKeys(true).concat([BACKUP_SNAPSHOTS_KEY]));
    const list = Array.isArray(current[BACKUP_SNAPSHOTS_KEY]) ? current[BACKUP_SNAPSHOTS_KEY] : [];
    const data = mergeBackupPayload(current, current);
    delete data[BACKUP_SNAPSHOTS_KEY];
    if (Array.isArray(data.icons)) data.icons = stripSnapshotIconData(data.icons);
    list.unshift({
      id: generateId(),
      createdAt: new Date().toISOString(),
      reason: reason || 'manual',
      data
    });
    const trimmed = trimSnapshotList(list);
    await storageLocalSet({ [BACKUP_SNAPSHOTS_KEY]: trimmed });
    return trimmed[0];
  }

  async function applyOpenTabBackup(rawPayload) {
    const current = await storageLocalGet(backupStateKeys(true));
    const writePayload = mergeBackupPayload(rawPayload, current);
    Object.keys(writePayload).forEach((key) => {
      if (writePayload[key] === undefined) delete writePayload[key];
    });
    if (Array.isArray(writePayload.icons) && typeof OpenTabFolders !== 'undefined' && OpenTabFolders.repairIconGraph) {
      OpenTabFolders.repairIconGraph(writePayload.icons);
    }
    await storageLocalSet(writePayload);
    reloadPage();
    return writePayload;
  }

  async function handleDownloadBackup() {
    const payload = await buildBackupPayload(false);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = makeBackupFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    updateBackupStatus('已下载备份文件。', false);
  }

  async function handleSaveSnapshot() {
    await saveSnapshotRecord('manual');
    updateBackupStatus('已保存快照。', false);
  }

  async function handleRestoreLatestSnapshot() {
    const result = await storageLocalGet([BACKUP_SNAPSHOTS_KEY]);
    const list = Array.isArray(result[BACKUP_SNAPSHOTS_KEY]) ? result[BACKUP_SNAPSHOTS_KEY] : [];
    if (!list.length) {
      updateBackupStatus('没有可恢复的快照。', true);
      return;
    }
    await saveSnapshotRecord('before-restore');
    updateBackupStatus('正在恢复快照并刷新页面...', false);
    await applyOpenTabBackup(list[0].data || {});
  }

  function showImportToast(notice) {
    if (typeof document === 'undefined' || !notice || !notice.text) return;
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = notice.text;
    if (notice.canUndo) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '撤销';
      btn.onclick = () => {
        toast.classList.add('hidden');
        undoLastImport();
      };
      toast.appendChild(btn);
    }
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, notice.canUndo ? 8000 : 5000);
  }

  function bindBackupUi() {
    if (typeof document === 'undefined') return;
    const downloadBtn = document.getElementById('backup-download-btn');
    const importBtn = document.getElementById('backup-import-btn');
    const importFile = document.getElementById('backup-import-file');
    const saveBtn = document.getElementById('backup-save-snapshot-btn');
    const restoreBtn = document.getElementById('backup-restore-snapshot-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => {
      handleDownloadBackup().catch(() => updateBackupStatus('下载备份失败。', true));
    });
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => {
        importFile.value = '';
        importFile.click();
      });
      importFile.addEventListener('change', () => {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        Promise.resolve(file.text()).then((text) => {
          const raw = JSON.parse(text);
          return saveSnapshotRecord('before-import').then(() => {
            updateBackupStatus('正在导入备份并刷新页面...', false);
            return applyOpenTabBackup(raw);
          });
        }).catch(() => {
          updateBackupStatus('导入失败：JSON 无效或结构不支持。', true);
        }).then(() => {
          importFile.value = '';
        });
      });
    }
    if (saveBtn) saveBtn.addEventListener('click', () => {
      handleSaveSnapshot().catch(() => updateBackupStatus('保存快照失败。', true));
    });
    if (restoreBtn) restoreBtn.addEventListener('click', () => {
      handleRestoreLatestSnapshot().catch(() => updateBackupStatus('恢复快照失败。', true));
    });
  }

  function isSafeHttpUrl(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    if (!trimmed || /^(javascript|data|file|chrome|chrome-extension):/i.test(trimmed)) return false;
    try {
      const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
      const parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function normalizeHttpUrl(raw) {
    const trimmed = String(raw || '').trim();
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
    return new URL(candidate).toString();
  }

  function pickLink(item) {
    if (!item || typeof item !== 'object') return { name: '', url: '' };
    const url = [item.url, item.target, item.href, item.link, item.website, item.page]
      .find((value) => typeof value === 'string' && isSafeHttpUrl(value));
    const name = item.name || item.title || item.label || item.text || '';
    return { name: String(name || ''), url: url ? normalizeHttpUrl(url) : '' };
  }

  function makeShortcut(name, url) {
    if (!isSafeHttpUrl(url)) return null;
    const normalized = normalizeHttpUrl(url);
    let label = String(name || '').trim();
    if (!label) {
      try {
        label = new URL(normalized).hostname.replace(/^www\./, '');
      } catch (error) {
        label = normalized;
      }
    }
    const shortcut = {
      id: generateId(),
      name: label,
      type: 'shortcut',
      url: normalized,
      customIconUrl: '',
      emoji: '',
      uploadedIconDataUrl: '',
      resolvedIconUrl: '',
      iconCandidates: []
    };
    if (typeof OpenTabIcons !== 'undefined' && OpenTabIcons.prepareRecord) {
      OpenTabIcons.prepareRecord(shortcut);
    }
    return shortcut;
  }

  function nextGroupName(desired, groups) {
    let base = String(desired || '').trim() || '导入';
    if (base === '主页') base = '导入的主页';
    const used = new Set((groups || []).map((group) => group.name));
    if (!used.has(base)) return base;
    let index = 2;
    while (used.has(base + ' (' + index + ')')) index += 1;
    return base + ' (' + index + ')';
  }

  function pushGroup(groups, name, links) {
    const icons = [];
    (links || []).forEach((item) => {
      const shortcut = makeShortcut(item.name, item.url);
      if (shortcut) icons.push(shortcut);
    });
    if (!icons.length) return;
    groups.push({ name: name || '导入', icons });
  }

  function collectBookmarkLinks(node) {
    const links = [];
    if (!node) return links;
    if (node.url && isSafeHttpUrl(node.url)) {
      links.push({ name: node.title || '', url: node.url });
    }
    (node.children || []).forEach((child) => {
      collectBookmarkLinks(child).forEach((link) => links.push(link));
    });
    return links;
  }

  function flattenBookmarkFolders(nodes, trail) {
    const folders = [];
    const path = trail || [];
    (nodes || []).forEach((node) => {
      if (!node || node.url) return;
      const title = node.title || '未命名';
      const nextPath = node.id === '0' ? path : path.concat([title]);
      const links = collectBookmarkLinks(node);
      folders.push({
        id: String(node.id),
        title,
        path: nextPath.join(' / ') || title,
        count: links.length,
        node
      });
      flattenBookmarkFolders(node.children || [], nextPath).forEach((folder) => folders.push(folder));
    });
    return folders;
  }

  function parseInfinity(raw) {
    const root = raw && raw.data && raw.data.site ? raw.data.site : (raw && raw.site ? raw.site : raw);
    const sites = root && Array.isArray(root.sites) ? root.sites : (Array.isArray(root) ? root : []);
    const pages = sites.length && Array.isArray(sites[0]) ? sites : [sites];
    const groups = [];
    pages.forEach((page, pageIndex) => {
      const loose = [];
      (Array.isArray(page) ? page : []).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        if (Array.isArray(item.children) && item.children.length) {
          const nested = item.children.map(pickLink);
          pushGroup(groups, item.name || item.title || 'Infinity 文件夹', nested);
          return;
        }
        const link = pickLink(item);
        if (link.url) loose.push(link);
      });
      if (loose.length) pushGroup(groups, pages.length > 1 ? 'Infinity ' + (pageIndex + 1) : 'Infinity', loose);
    });
    return groups;
  }

  function parseWeTab(raw) {
    const categories = raw && raw.data && raw.data['store-icon'] && Array.isArray(raw.data['store-icon'].icons)
      ? raw.data['store-icon'].icons
      : [];
    const groups = [];
    function walk(nodes, fallbackName) {
      const loose = [];
      (nodes || []).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        if (item.type === 'folder-icon' || Array.isArray(item.children) && item.type !== 'site') {
          walk(item.children || [], item.name || fallbackName);
          return;
        }
        const link = pickLink(item);
        if (link.url) loose.push(link);
      });
      if (loose.length) pushGroup(groups, fallbackName || 'WeTab', loose);
    }
    categories.forEach((category) => {
      walk(category && category.children, category && category.name ? category.name : 'WeTab');
    });
    return groups;
  }

  function parseITab(raw) {
    const pages = Array.isArray(raw.nav) ? raw.nav : [];
    const meta = raw.config && Array.isArray(raw.config.nav) ? raw.config.nav : [];
    const groups = [];
    pages.forEach((page, index) => {
      const name = (meta[index] && (meta[index].name || meta[index].title)) || 'iTab ' + (index + 1);
      const links = (Array.isArray(page) ? page : []).map(pickLink);
      pushGroup(groups, name, links);
    });
    return groups;
  }

  function parseOpenTab(raw) {
    const groups = [];
    const folderList = foldersToGroups(raw.folders);
    const byId = new Map();
    folderList.forEach((folder) => byId.set(folder.id, []));
    (Array.isArray(raw.icons) ? raw.icons : []).forEach((icon) => {
      const link = pickLink(icon);
      if (!link.url) return;
      const groupId = readIconGroupId(icon);
      if (!byId.has(groupId)) byId.set(groupId, []);
      byId.get(groupId).push(link);
    });
    folderList.forEach((folder) => {
      const links = byId.get(folder.id) || [];
      const name = folder.id === HOME_GROUP_ID ? '导入的主页' : folder.name;
      pushGroup(groups, name, links);
    });
    byId.forEach((links, folderId) => {
      if (folderList.some((folder) => folder.id === folderId)) return;
      pushGroup(groups, '导入', links);
    });
    return groups;
  }

  function looksInfinity(raw, filename) {
    if (filename && /\.infinity$/i.test(filename)) return true;
    if (!raw || typeof raw !== 'object') return false;
    if (raw.data && raw.data.site && Array.isArray(raw.data.site.sites)) return true;
    if (raw.site && Array.isArray(raw.site.sites)) return true;
    return false;
  }

  function looksWeTab(raw, filename) {
    if (filename && /(wetab|\.data$)/i.test(filename) && raw && raw.data && raw.data['store-icon']) return true;
    return !!(raw && raw.data && raw.data['store-icon'] && Array.isArray(raw.data['store-icon'].icons));
  }

  function looksITab(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (Array.isArray(raw.nav) && raw.config) return true;
    if (Array.isArray(raw.nav) && Array.isArray(raw.nav[0])) return true;
    return false;
  }

  function looksOpenTab(raw) {
    return !!(raw && Array.isArray(raw.icons) && (Array.isArray(raw.folders) || raw.version));
  }

  function parseBackupFile(textOrObject, filename) {
    let raw = textOrObject;
    if (typeof textOrObject === 'string') {
      try {
        raw = JSON.parse(String(textOrObject).replace(/^\uFEFF/, '').trim());
      } catch (error) {
        return { ok: false, error: 'invalid-json', message: MSG_INVALID_JSON };
      }
    }
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'unrecognized', message: MSG_UNRECOGNIZED };
    }

    let format = '';
    let groups = [];
    if (looksInfinity(raw, filename)) {
      format = 'infinity';
      groups = parseInfinity(raw);
    } else if (looksWeTab(raw, filename)) {
      format = 'wetab';
      groups = parseWeTab(raw);
    } else if (looksITab(raw)) {
      format = 'itab';
      groups = parseITab(raw);
    } else if (looksOpenTab(raw)) {
      format = 'opentab';
      groups = parseOpenTab(raw);
    } else {
      return { ok: false, error: 'unrecognized', message: MSG_UNRECOGNIZED };
    }

    const iconCount = groups.reduce((sum, group) => sum + ((group.icons || []).length), 0);
    if (!iconCount) {
      return { ok: false, error: 'empty', message: '备份里没有可导入的图标，现有数据未改动。' };
    }
    return { ok: true, format, groups, iconCount, groupCount: groups.length };
  }

  function materializeImport(parsed, current) {
    const currentFolders = groupsToFolders(foldersToGroups(current && current.folders));
    let groups = foldersToGroups(currentFolders);
    const icons = Array.isArray(current && current.icons) ? current.icons.slice() : [];
    let iconCount = 0;
    let groupCount = 0;
    (parsed.groups || []).forEach((incoming) => {
      const made = [];
      (incoming.icons || []).forEach((item) => {
        const shortcut = makeShortcut(item.name, item.url);
        if (shortcut) made.push(shortcut);
      });
      if (!made.length) return;
      const name = nextGroupName(incoming.name, groups);
      const group = { id: 'folder-' + generateId(), name };
      groups = groups.concat([group]);
      groupCount += 1;
      made.forEach((shortcut) => {
        icons.push(withIconGroup(shortcut, group.id));
        iconCount += 1;
      });
    });
    return {
      folders: groupsToFolders(groups),
      icons,
      iconCount,
      groupCount
    };
  }

  function importResultMessage(iconCount, groupCount) {
    return '已导入 ' + iconCount + ' 个图标、' + groupCount + ' 个分组。';
  }

  function setStatus(message, isError) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('import-sync-status');
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#ffb4b4' : '';
  }

  function refreshUndoButton() {
    const btn = typeof document !== 'undefined' ? document.getElementById('import-undo-btn') : null;
    if (!btn) return Promise.resolve(false);
    return storageLocalGet([UNDO_KEY]).then((result) => {
      const enabled = !!(result && result[UNDO_KEY]);
      btn.disabled = !enabled;
      return enabled;
    }, () => {
      btn.disabled = true;
      return false;
    });
  }

  function consumeNotice(callback) {
    return storageLocalGet([NOTICE_KEY]).then((result) => {
      const notice = result && result[NOTICE_KEY];
      if (!notice) return null;
      return storageLocalSet({ [NOTICE_KEY]: null }).then(() => {
        if (notice.text) setStatus(notice.text, !!notice.error);
        if (typeof callback === 'function') callback(notice);
        return notice;
      });
    });
  }

  async function snapshotWorkspace(current) {
    await storageLocalSet({
      [UNDO_KEY]: {
        createdAt: new Date().toISOString(),
        icons: Array.isArray(current.icons) ? current.icons : [],
        folders: Array.isArray(current.folders) ? current.folders : [],
        currentFolderId: current.currentFolderId || HOME_GROUP_ID
      }
    });
  }

  async function commitImport(parsed) {
    const current = await storageLocalGet(['icons', 'folders', 'currentFolderId']);
    const materialized = materializeImport(parsed, current);
    if (!materialized.iconCount) {
      const empty = { ok: false, error: 'empty', message: '备份里没有可导入的图标，现有数据未改动。' };
      setStatus(empty.message, true);
      return empty;
    }
    await snapshotWorkspace(current);
    const text = importResultMessage(materialized.iconCount, materialized.groupCount);
    await storageLocalSet({
      icons: materialized.icons,
      folders: materialized.folders,
      [NOTICE_KEY]: { text, canUndo: true }
    });
    setStatus(text, false);
    refreshUndoButton();
    reloadPage();
    return { ok: true, format: parsed.format, iconCount: materialized.iconCount, groupCount: materialized.groupCount };
  }

  async function requestOptionalPermission(name) {
    const api = getChrome();
    if (!api || !api.permissions || typeof api.permissions.request !== 'function') {
      return { granted: false, reason: 'unsupported' };
    }
    try {
      const granted = await chromeCall(api.permissions.request.bind(api.permissions), [{ permissions: [name] }]);
      return { granted: !!granted, reason: granted ? 'ok' : 'denied' };
    } catch (error) {
      return { granted: false, reason: 'denied' };
    }
  }

  async function loadBookmarkFolders() {
    const permission = await requestOptionalPermission('bookmarks');
    if (!permission.granted) {
      return { ok: false, denied: true, message: MSG_BOOKMARKS_DENIED };
    }
    const api = getChrome();
    if (!api || !api.bookmarks || typeof api.bookmarks.getTree !== 'function') {
      return { ok: false, denied: true, message: MSG_BOOKMARKS_DENIED };
    }
    try {
      const tree = await chromeCall(api.bookmarks.getTree.bind(api.bookmarks), []);
      const folders = flattenBookmarkFolders(tree).filter((folder) => folder.id !== '0');
      return { ok: true, tree, folders };
    } catch (error) {
      return { ok: false, denied: true, message: MSG_BOOKMARKS_DENIED };
    }
  }

  function parsedFromBookmarkFolder(tree, folderId) {
    const folders = flattenBookmarkFolders(tree);
    const folder = folders.find((item) => item.id === String(folderId));
    if (!folder) return { ok: false, error: 'missing', message: '未找到该书签文件夹。' };
    const groups = [];
    pushGroup(groups, folder.title, collectBookmarkLinks(folder.node));
    if (!groups.length) return { ok: false, error: 'empty', message: '该文件夹没有可导入的书签，现有数据未改动。' };
    return { ok: true, format: 'bookmarks', groups, iconCount: groups[0].icons.length, groupCount: 1 };
  }

  function parsedFromTopSites(sites) {
    const sliced = (Array.isArray(sites) ? sites : []).slice(0, TOP_SITES_LIMIT);
    const groups = [];
    pushGroup(groups, '常用网站', sliced.map((site) => ({ name: site && site.title, url: site && site.url })));
    if (!groups.length) return { ok: false, error: 'empty', message: '没有可导入的常用网站。' };
    return { ok: true, format: 'topsites', groups, iconCount: groups[0].icons.length, groupCount: 1 };
  }

  async function importTopSites() {
    const permission = await requestOptionalPermission('topSites');
    if (!permission.granted) {
      setStatus(MSG_TOPSITES_DENIED, true);
      return { ok: false, denied: true, message: MSG_TOPSITES_DENIED };
    }
    const api = getChrome();
    if (!api || !api.topSites || typeof api.topSites.get !== 'function') {
      setStatus(MSG_TOPSITES_DENIED, true);
      return { ok: false, denied: true, message: MSG_TOPSITES_DENIED };
    }
    try {
      const sites = await chromeCall(api.topSites.get.bind(api.topSites), []);
      const parsed = parsedFromTopSites(sites);
      if (!parsed.ok) {
        setStatus(parsed.message, true);
        return parsed;
      }
      return commitImport(parsed);
    } catch (error) {
      setStatus(MSG_TOPSITES_DENIED, true);
      return { ok: false, denied: true, message: MSG_TOPSITES_DENIED };
    }
  }

  async function undoLastImport() {
    const result = await storageLocalGet([UNDO_KEY]);
    const snapshot = result && result[UNDO_KEY];
    if (!snapshot) {
      setStatus('没有可撤销的导入。', true);
      return { ok: false };
    }
    await storageLocalSet({
      icons: snapshot.icons || [],
      folders: snapshot.folders || [],
      currentFolderId: snapshot.currentFolderId || HOME_GROUP_ID,
      [UNDO_KEY]: null,
      [NOTICE_KEY]: { text: '已撤销上次导入。', canUndo: false }
    });
    setStatus('已撤销上次导入。', false);
    refreshUndoButton();
    reloadPage();
    return { ok: true };
  }

  function fillBookmarkSelect(folders) {
    const select = document.getElementById('bookmark-folder-select');
    const row = document.getElementById('bookmark-folder-row');
    if (!select || !row) return;
    select.innerHTML = '';
    folders.forEach((folder) => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.path + '（' + folder.count + '）';
      select.appendChild(option);
    });
    row.classList.remove('hidden');
  }

  function bindUi() {
    if (typeof document === 'undefined') return;
    const bookmarkBtn = document.getElementById('import-bookmarks-btn');
    const confirmBtn = document.getElementById('import-bookmarks-confirm-btn');
    const topSitesBtn = document.getElementById('import-topsites-btn');
    const fileBtn = document.getElementById('import-file-btn');
    const fileInput = document.getElementById('import-file-input');
    const undoBtn = document.getElementById('import-undo-btn');
    let bookmarkTree = null;

    if (bookmarkBtn) {
      bookmarkBtn.addEventListener('click', () => {
        loadBookmarkFolders().then((result) => {
          if (!result.ok) {
            setStatus(result.message, true);
            return;
          }
          bookmarkTree = result.tree;
          fillBookmarkSelect(result.folders);
          setStatus('请选择要导入的书签文件夹，导入后会成为一个分组。', false);
        }).catch(() => {
          setStatus(MSG_BOOKMARKS_DENIED, true);
        });
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const select = document.getElementById('bookmark-folder-select');
        if (!bookmarkTree || !select || !select.value) {
          setStatus('请先选择一个书签文件夹。', true);
          return;
        }
        const parsed = parsedFromBookmarkFolder(bookmarkTree, select.value);
        if (!parsed.ok) {
          setStatus(parsed.message, true);
          return;
        }
        commitImport(parsed).catch(() => setStatus('导入失败，现有数据未改动。', true));
      });
    }

    if (topSitesBtn) {
      topSitesBtn.addEventListener('click', () => {
        importTopSites().catch(() => setStatus(MSG_TOPSITES_DENIED, true));
      });
    }

    if (fileBtn && fileInput) {
      fileBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
      });
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        Promise.resolve(file.text()).then((text) => {
          const parsed = parseBackupFile(text, file.name);
          if (!parsed.ok) {
            setStatus(parsed.message, true);
            return null;
          }
          return commitImport(parsed);
        }).catch(() => {
          setStatus(MSG_INVALID_JSON, true);
        }).then(() => {
          fileInput.value = '';
        });
      });
    }

    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        undoLastImport().catch(() => setStatus('撤销失败。', true));
      });
    }

    bindBackupUi();
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => { refreshUndoButton(); });
    }
    consumeNotice((notice) => { showImportToast(notice); });
    refreshUndoButton();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
    else bindUi();
  }

  return {
    HOME_GROUP_ID,
    TOP_SITES_LIMIT,
    UNDO_KEY,
    NOTICE_KEY,
    SECRET_FIELDS,
    MSG_BOOKMARKS_DENIED,
    MSG_TOPSITES_DENIED,
    MSG_UNRECOGNIZED,
    MSG_INVALID_JSON,
    setChrome,
    setIdFactory,
    setReloader,
    foldersToGroups,
    groupsToFolders,
    readIconGroupId,
    withIconGroup,
    stripSecretsFromState,
    flattenBookmarkFolders,
    parseBackupFile,
    materializeImport,
    parsedFromBookmarkFolder,
    parsedFromTopSites,
    importResultMessage,
    requestOptionalPermission,
    loadBookmarkFolders,
    importTopSites,
    commitImport,
    undoLastImport,
    consumeNotice,
    refreshUndoButton,
    mergeBackupPayload,
    applyOpenTabBackup,
    buildBackupPayload,
    saveSnapshotRecord,
    stripSnapshotIconData,
    BACKUP_SNAPSHOTS_KEY,
    BACKUP_SNAPSHOT_MAX_BYTES
  };
}));
