(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabImport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Translate only application-owned prose, never stored user content.
  function t(source, params = {}) {
    const i18n = typeof globalThis !== 'undefined' && globalThis.OpenTabI18n;
    return i18n ? i18n.t(source, params) : String(source).replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
  }


  const HOME_GROUP_ID = 'folder-home';
  const TOP_SITES_LIMIT = 12;
  const URL_LIST_MAX_LINES = 100;
  const URL_LIST_MAX_BYTES = 32768;
  const UNDO_KEY = 'opentab.importUndo';
  const NOTICE_KEY = 'opentab.importNotice';
  const EPOCH_KEY = 'opentab.workspaceEpoch';
  const SCENE_SCHEMA_KEY = 'opentab.sceneSchemaVersion';
  const SCENE_KEYS = [SCENE_SCHEMA_KEY, 'scenes', 'sceneProfiles'];
  const GRAPH_KEYS = ['icons', 'folders', 'todos', ...SCENE_KEYS];
  const SECRET_FIELDS = ['sshPassword', 'sshGatewayToken', 'sshSocksPassword'];

  const MSG_BOOKMARKS_DENIED = '未获得书签权限，已取消导入。可在下次点击时重新授权。';
  const MSG_TOPSITES_DENIED = '未获得常用网站权限，已取消导入。可在下次点击时重新授权。';
  const MSG_UNRECOGNIZED = '无法识别该备份文件（请使用 Infinity / WeTab / iTab 的 JSON 备份）。现有数据未改动。';
  const MSG_INVALID_JSON = '无法解析该文件：不是有效的 JSON。现有数据未改动。';

  let chromeRef = null;
  let workspaceRef = null;
  let sceneContextProvider = null;
  let idFactory = null;
  let reloader = null;
  let urlListPreviews = new WeakMap();

  function getChrome() {
    if (chromeRef) return chromeRef;
    return typeof chrome !== 'undefined' ? chrome : null;
  }

  function setChrome(api) {
    chromeRef = api || null;
    workspaceRef = null;
    sceneContextProvider = null;
    urlListPreviews = new WeakMap();
  }

  function getWorkspace() {
    if (workspaceRef) return workspaceRef;
    if (typeof module === 'object' && module.exports && chromeRef) {
      workspaceRef = require('./workspace-persistence.js').forChrome(chromeRef);
      return workspaceRef;
    }
    if (typeof OpenTabWorkspace !== 'undefined') return OpenTabWorkspace;
    throw new Error('Workspace persistence is unavailable.');
  }

  function getSceneSchema() {
    if (typeof module === 'object' && module.exports) return require('./scene-schema.js');
    if (globalThis.OpenTabSceneSchema) return globalThis.OpenTabSceneSchema;
    throw new Error('Scene schema support is unavailable.');
  }

  function compatibilityError(code) {
    const error = new Error(t('导入失败：JSON 无效或结构不支持。'));
    error.code = code;
    error.recoverable = true;
    return error;
  }

  function validateSceneState(state) {
    if (Object.hasOwn(state, SCENE_SCHEMA_KEY)) {
      getSceneSchema().validate(state);
      return true;
    }
    if (Object.hasOwn(state, 'scenes') || Object.hasOwn(state, 'sceneProfiles')
      || ['icons', 'folders', 'todos'].some(key => Array.isArray(state[key]) && state[key].some(item => item && Object.hasOwn(item, 'sceneId')))) {
      throw compatibilityError('PARTIAL_SCHEMA');
    }
    return false;
  }

  // Hidden integration seam: selection belongs to this tab, not a persisted
  // last-opened scene. Explicit options are useful for a destination picker.
  function setSceneContextProvider(provider) {
    sceneContextProvider = typeof provider === 'function' ? provider : null;
    urlListPreviews = new WeakMap();
  }

  function captureSceneContext(options) {
    const explicit = options && Object.hasOwn(options, 'sceneId');
    const provider = explicit ? null : sceneContextProvider;
    const value = explicit ? options : provider && provider();
    return { provider, value: value ? { sceneId: value.sceneId, generation: value.generation, currentFolderId: value.currentFolderId } : null };
  }

  function sceneConflict() {
    const error = new Error(t('其他标签页已修改此内容，请刷新后重试。'));
    error.code = 'WORKSPACE_CONFLICT';
    return error;
  }

  function selectedScene(current, context) {
    if (!validateSceneState(current)) {
      if (context && context.value && context.value.sceneId) throw sceneConflict();
      return null;
    }
    const value = context && context.value;
    if (!value || typeof value.sceneId !== 'string') throw compatibilityError('SCENE_CONTEXT_REQUIRED');
    if (context.provider) {
      const latest = context.provider();
      if (context.provider !== sceneContextProvider || !latest || latest.sceneId !== value.sceneId || latest.generation !== value.generation) throw sceneConflict();
    }
    const scene = current.scenes.find(item => item.id === value.sceneId);
    if (!scene || scene.archivedAt !== null) throw sceneConflict();
    return scene;
  }

  async function captureStoredSceneContext(context) {
    const current = await getWorkspace().read(GRAPH_KEYS.concat([EPOCH_KEY]));
    const scene = selectedScene(current, context);
    return { ...context, epoch: current[EPOCH_KEY] || 0, scene: sceneReceipt(scene) };
  }

  function graphSnapshot(current) {
    return Object.fromEntries(GRAPH_KEYS.concat([EPOCH_KEY]).filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
  }

  function sceneReceipt(scene, target) {
    return scene ? { sceneId: scene.id, identity: urlListTargetIdentity(scene), target: target ? urlListTargetIdentity(target) : null, targetId: target ? target.id : null } : null;
  }

  function checkSceneReceipt(current, receipt) {
    const sceneMode = validateSceneState(current);
    if (!receipt) { if (sceneMode) throw sceneConflict(); return; }
    if (!sceneMode) throw sceneConflict();
    const scene = current.scenes.find(item => item.id === receipt.sceneId);
    const target = receipt.targetId && current.folders.find(item => item.id === receipt.targetId);
    if (!scene || scene.archivedAt !== null || urlListTargetIdentity(scene) !== receipt.identity
      || (receipt.target && (!target || urlListTargetIdentity(target) !== receipt.target))) throw sceneConflict();
  }

  function sceneNavigation(sceneId, currentFolderId, context) {
    const value = context && context.value;
    return { sceneId, currentFolderId, ...(value && value.generation !== undefined ? { generation: value.generation } : {}) };
  }

  function localUndoNavigation(current, snapshot, context) {
    const saved = snapshot.navigation, value = context && context.value;
    if (!saved || !context.provider || context.provider !== sceneContextProvider || !value) return undefined;
    const live = context.provider();
    if (!live || live.sceneId !== value.sceneId || live.currentFolderId !== value.currentFolderId || live.generation !== value.generation
      || value.sceneId !== saved.after.sceneId || value.currentFolderId !== saved.after.currentFolderId) return undefined;
    const scene = current.scenes.find(item => item.id === value.sceneId);
    if (!scene || scene.archivedAt !== null) return undefined;
    const previous = current.folders.find(group => group.id === saved.before.currentFolderId && group.sceneId === scene.id);
    return sceneNavigation(scene.id, previous ? previous.id : scene.homeGroupId, context);
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

  function reloadPage(navigation) {
    if (reloader) {
      reloader(navigation);
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

  function copyGroupRecord(item) {
    const group = { id: String(item.id), name: String(item.name) };
    for (const key of ['parentId', 'type', 'sceneId']) {
      if (Object.hasOwn(item, key)) group[key] = item[key];
    }
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
    const next = { ...icon };
    next.folderId = groupId || HOME_GROUP_ID;
    return next;
  }

  function stripSecretsFromState(input) {
    if (Array.isArray(input)) return input.map(stripSecretsFromState);
    if (!input || typeof input !== 'object') return input;
    const out = {};
    Object.keys(input).forEach((key) => {
      if (key === 'opentab.secretVault' || key === 'opentab.cryptoKey') return;
      const value = SECRET_FIELDS.indexOf(key) >= 0 ? '' : stripSecretsFromState(input[key]);
      // Assignment invokes Object.prototype.__proto__ instead of copying that
      // legitimate JSON key. Define data properties to preserve opaque records.
      Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    });
    return out;
  }

  const BACKUP_SNAPSHOTS_KEY = 'backupSnapshots';
  const BACKUP_MAX_SNAPSHOTS = 20;
  const BACKUP_SNAPSHOT_MAX_BYTES = 1500 * 1024;
  const BACKUP_CORE_KEYS = [
    ...SCENE_KEYS,
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
    'todoButtonVisible',
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
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) throw compatibilityError('INVALID_BACKUP');
    if (Object.hasOwn(rawPayload, 'version') && ![1, 2].includes(rawPayload.version)) throw compatibilityError('UNSUPPORTED_BACKUP_VERSION');
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
    el.textContent = t(message);
    el.style.color = isError ? '#ffb4b4' : 'rgba(255, 255, 255, 0.65)';
  }

  function makeBackupFilename(prefix) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
      + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    return (prefix || 'opentab-backup') + '-' + ts + '.json';
  }

  function inspectBackup(rawPayload) {
    const payload = unwrapBackupPayload(rawPayload);
    const backupVersion = Object.hasOwn(rawPayload, 'version') ? rawPayload.version : payload.version;
    if ((Object.hasOwn(payload, 'version') && ![1, 2].includes(payload.version))
      || (payload !== rawPayload && Object.hasOwn(rawPayload, 'version') && Object.hasOwn(payload, 'version') && payload.version !== rawPayload.version)
      || (payload !== rawPayload && SCENE_KEYS.some(key => Object.hasOwn(rawPayload, key)))) throw compatibilityError('INVALID_BACKUP_VERSION');
    const sceneMode = validateSceneState(payload);
    if ((backupVersion === 2 && !sceneMode) || (backupVersion === 1 && sceneMode)) throw compatibilityError('INVALID_BACKUP_VERSION');
    return { payload, sceneMode, version: backupVersion };
  }

  function mergeBackupPayload(rawPayload, current = {}) {
    const { payload, sceneMode: payloadSceneMode } = inspectBackup(rawPayload);
    const currentSceneMode = validateSceneState(current);
    const includeHistory = payload.searchHistory !== undefined || current.searchHistory !== undefined;
    const merged = {};
    backupStateKeys(includeHistory).forEach((key) => {
      if (payload[key] !== undefined) merged[key] = payload[key];
      else if (current[key] !== undefined) merged[key] = current[key];
    });
    if (payloadSceneMode || currentSceneMode) {
      // A restore replaces the entire ownership graph. Never fill missing
      // legacy graph fields with unrelated records from the current scenes.
      const restored = payloadSceneMode ? payload : getSceneSchema().migrateLegacy(payload);
      GRAPH_KEYS.forEach(key => { merged[key] = restored[key]; });
      const requested = payload.currentFolderId;
      merged.currentFolderId = restored.folders.some(group => group.id === requested) ? requested : HOME_GROUP_ID;
    }
    if (typeof OpenTabSearch !== 'undefined' && OpenTabSearch.normalizeBackup) {
      const normalizedSearch = OpenTabSearch.normalizeBackup({ ...current, ...payload });
      searchBackupKeys(true).forEach((key) => {
        if (payload[key] !== undefined || current[key] !== undefined) merged[key] = normalizedSearch[key];
      });
      if (payload.searchHistory === undefined && current.searchHistory === undefined) delete merged.searchHistory;
    }
    const clean = stripSecretsFromState(merged);
    validateSceneState(clean);
    return clean;
  }

  async function buildBackupPayload(includeHistory) {
    const keys = backupStateKeys(!!includeHistory);
    const current = await storageLocalGet(keys);
    const sceneMode = validateSceneState(current);
    const payload = {
      version: sceneMode ? 2 : 1,
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
      const next = { ...icon };
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

  function prepareSnapshotRecord(reason, current, options = {}) {
    const completeness = options.completeness || 'compact';
    if (!['compact', 'full'].includes(completeness)) throw compatibilityError('INVALID_SNAPSHOT_MODE');
    const list = Array.isArray(current[BACKUP_SNAPSHOTS_KEY]) ? current[BACKUP_SNAPSHOTS_KEY].slice() : [];
    const data = mergeBackupPayload(current, current);
    delete data[BACKUP_SNAPSHOTS_KEY];
    if (completeness === 'compact' && Array.isArray(data.icons)) data.icons = stripSnapshotIconData(data.icons);
    list.unshift({
      id: generateId(),
      createdAt: new Date().toISOString(),
      reason: reason || 'manual',
      completeness,
      data
    });
    // A full recovery point must not trade away local assets or older recovery
    // records to fit the compact budget. The caller's atomic write owns quota
    // failure, so a failure preserves both the live graph and prior backups.
    const records = completeness === 'full' ? list : trimSnapshotList(list);
    return { record: records[0], records };
  }

  async function saveSnapshotRecord(reason) {
    return getWorkspace().transaction(async ({ read, write }) => {
      const current = await read(backupStateKeys(true).concat([BACKUP_SNAPSHOTS_KEY]));
      const prepared = prepareSnapshotRecord(reason, current);
      await write({ [BACKUP_SNAPSHOTS_KEY]: prepared.records });
      return prepared.record;
    });
  }

  async function applyOpenTabBackup(rawPayload, options) {
    const inspected = inspectBackup(rawPayload);
    if (inspected.version === undefined && !backupStateKeys(true).some(key => Object.hasOwn(inspected.payload, key))) throw compatibilityError('INVALID_BACKUP');
    const resumeBackground = typeof OpenTabBingCache !== 'undefined' && OpenTabBingCache.suspendUpdates
      ? OpenTabBingCache.suspendUpdates() : null;
    try {
      let writePayload;
      await getWorkspace().replace(async (current) => {
        writePayload = mergeBackupPayload(rawPayload, current);
        Object.keys(writePayload).forEach((key) => {
          if (writePayload[key] === undefined) delete writePayload[key];
        });
        if (!Object.hasOwn(writePayload, SCENE_SCHEMA_KEY) && Array.isArray(writePayload.icons) && typeof OpenTabFolders !== 'undefined' && OpenTabFolders.repairIconGraph) {
          OpenTabFolders.repairIconGraph(writePayload.icons);
        }
        const sceneRestore = Object.hasOwn(current, SCENE_SCHEMA_KEY);
        if (sceneRestore || options && options.snapshotReason) {
          const prepared = prepareSnapshotRecord(options && options.snapshotReason || 'before-restore', current, { completeness: sceneRestore ? 'full' : 'compact' });
          writePayload[BACKUP_SNAPSHOTS_KEY] = prepared.records;
        }
        return writePayload;
      });
      reloadPage({ resetSceneSelection: true });
      return writePayload;
    } catch (error) {
      if (resumeBackground) resumeBackground();
      throw error;
    }
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
    updateBackupStatus(t('已下载备份文件。'), false);
  }

  async function handleSaveSnapshot() {
    await saveSnapshotRecord('manual');
    updateBackupStatus(t('已保存快照。'), false);
  }

  async function handleRestoreLatestSnapshot() {
    const result = await storageLocalGet([BACKUP_SNAPSHOTS_KEY]);
    const list = Array.isArray(result[BACKUP_SNAPSHOTS_KEY]) ? result[BACKUP_SNAPSHOTS_KEY] : [];
    if (!list.length) {
      updateBackupStatus(t('没有可恢复的快照。'), true);
      return;
    }
    updateBackupStatus(t('正在恢复快照并刷新页面...'), false);
    const data = list[0].data || {};
    await applyOpenTabBackup({ version: Object.hasOwn(data, SCENE_SCHEMA_KEY) ? 2 : 1, data }, { snapshotReason: 'before-restore' });
  }

  function noticeMessage(notice) {
    if (notice.format === 'url-list') return urlListResultMessage(notice.iconCount, notice.targetName, notice.duplicateCount);
    return Number.isFinite(notice.iconCount) && Number.isFinite(notice.groupCount)
      ? importResultMessage(notice.iconCount, notice.groupCount) : t(notice.text);
  }

  function showImportToast(notice) {
    if (typeof document === 'undefined' || !notice || !notice.text) return;
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = noticeMessage(notice);
    if (notice.canUndo) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t('撤销');
      btn.onclick = () => {
        toast.classList.add('hidden');
        undoLastImport().catch((error) => {
          toast.textContent = undoFailureMessage(error);
          toast.classList.remove('hidden');
        });
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
      handleDownloadBackup().catch(() => updateBackupStatus(t('下载备份失败。'), true));
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
          updateBackupStatus(t('正在导入备份并刷新页面...'), false);
          return applyOpenTabBackup(raw, { snapshotReason: 'before-import' });
        }).catch(() => {
          updateBackupStatus(t('导入失败：JSON 无效或结构不支持。'), true);
        }).then(() => {
          importFile.value = '';
        });
      });
    }
    if (saveBtn) saveBtn.addEventListener('click', () => {
      handleSaveSnapshot().catch(() => updateBackupStatus(t('保存快照失败。'), true));
    });
    if (restoreBtn) restoreBtn.addEventListener('click', () => {
      handleRestoreLatestSnapshot().catch(() => updateBackupStatus(t('恢复快照失败。'), true));
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

  // This stricter parser is intentionally separate from legacy backup import.
  // A pasted line is a URL, never a title/search query or permission to repair it.
  function parseUrlListLine(raw) {
    const value = raw.trim();
    if (/[\s\u0000-\u001f\u007f-\u009f\\]/.test(value)) {
      return { reason: '网址不能包含空白、控制字符或反斜杠。' };
    }
    const explicitHttp = /^https?:/i.test(value);
    const domainPort = /^[^/?#:@]+(?:\.[^/?#:@]+)+:\d{1,5}(?:[/?#]|$)/.test(value);
    if (!explicitHttp && /^[a-z][a-z\d+.-]*:/i.test(value) && !domainPort) {
      return { reason: '仅支持 HTTP 或 HTTPS 网址。' };
    }
    if (value.startsWith('/') || (explicitHttp && !/^https?:\/\/[^/?#]/i.test(value))) {
      return { reason: '网址格式无效，请填写完整网址或域名。' };
    }
    try {
      const parsed = new URL(explicitHttp ? value : 'https://' + value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { reason: '仅支持 HTTP 或 HTTPS 网址。' };
      }
      // Even empty userinfo (https://@host) is rejected, not silently removed.
      const authority = (explicitHttp ? value.replace(/^https?:\/\//i, '') : value).split(/[/?#]/)[0];
      if (parsed.username || parsed.password || authority.includes('@')) {
        return { reason: '网址不能包含用户名或密码。' };
      }
      if (!explicitHttp) {
        const hostname = parsed.hostname.replace(/\.$/, '');
        const labels = hostname.split('.');
        if (!authority.includes('.') || labels.length < 2 || labels.some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) {
          return { reason: '请填写完整网址或有效域名，不支持搜索词。' };
        }
      }
      if (!parsed.hostname) throw new Error('Missing hostname');
      return { url: parsed.href, name: parsed.hostname, reason: '可添加。' };
    } catch (_) {
      return { reason: '网址格式无效，请填写完整网址或域名。' };
    }
  }

  function urlListCounts(rows) {
    return rows.reduce((counts, row) => {
      counts.total += 1;
      counts[row.status] += 1;
      return counts;
    }, { total: 0, ready: 0, duplicate: 0, invalid: 0 });
  }

  function urlListFailure(error, message) {
    return { ok: false, format: 'url-list', error, message: t(message), rows: [], counts: urlListCounts([]), acceptedUrls: [] };
  }

  function parseUrlList(text) {
    // Keep parsing pure: no storage, IDs, icon preparation, lookup or translation.
    const failure = (error, message) => ({ ok: false, format: 'url-list', error, message, rows: [], counts: urlListCounts([]), acceptedUrls: [] });
    if (typeof text !== 'string') return failure('invalid-input', '请粘贴网址文本。');
    if (text.length > URL_LIST_MAX_BYTES || new TextEncoder().encode(text).length > URL_LIST_MAX_BYTES) {
      return failure('text-too-long', '网址文本过长，请控制在 32 KiB 以内。');
    }
    const lines = text.split(/\r\n|\n|\r/).map((raw, index) => ({ raw, lineNumber: index + 1 })).filter((line) => line.raw.trim());
    if (lines.length > URL_LIST_MAX_LINES) return failure('too-many-lines', '一次最多添加 100 行网址，请分批导入。');
    const seen = new Set();
    const rows = lines.map(({ raw, lineNumber }) => {
      const parsed = parseUrlListLine(raw);
      const row = { lineNumber, raw, url: parsed.url || '', name: parsed.name || '', status: parsed.url ? 'ready' : 'invalid', reason: parsed.reason };
      if (parsed.url && seen.has(parsed.url)) {
        row.status = 'duplicate';
        row.reason = '与本次列表中的网址重复。';
      }
      if (parsed.url) seen.add(parsed.url);
      return row;
    });
    return { ok: true, format: 'url-list', rows, counts: urlListCounts(rows), acceptedUrls: rows.filter((row) => row.status === 'ready').map((row) => row.url) };
  }

  function urlListGroups(current, scene) {
    const groups = Array.isArray(current.folders) ? current.folders.filter(group => !scene || group.sceneId === scene.id) : [];
    const valid = groups.filter((group) => group && typeof group.id === 'string' && group.id && typeof group.name === 'string' && group.name
      && groups.filter((item) => item && item.id === group.id).length === 1);
    // Home exists logically even before a fresh profile has saved folders.
    // Never synthesize an arbitrary destination or replace a malformed record.
    const homeId = scene ? scene.homeGroupId : HOME_GROUP_ID;
    if (!groups.some((group) => group && group.id === homeId)) valid.unshift({ id: homeId, name: t('主页'), ...(scene ? { sceneId: scene.id } : {}) });
    return valid;
  }

  function hasStoredUrlListTarget(current, id) {
    return Array.isArray(current.folders) && current.folders.some((group) => group && group.id === id);
  }

  function urlListTargetIdentity(target) {
    return JSON.stringify(Object.fromEntries(Object.keys(target).sort().map((key) => [key, target[key]])));
  }

  async function readUrlListContext(options) {
    const context = captureSceneContext(options);
    const current = await getWorkspace().read(GRAPH_KEYS.concat(['currentFolderId', EPOCH_KEY]));
    const scene = selectedScene(current, context), groups = urlListGroups(current, scene);
    const preferred = context.value && context.value.currentFolderId || current.currentFolderId;
    const currentFolderId = groups.some(group => group.id === preferred) ? preferred : scene ? scene.homeGroupId : HOME_GROUP_ID;
    return { groups: groups.map(({ id, name }) => ({ id, name })), currentFolderId, epoch: current[EPOCH_KEY] || 0, ...(scene ? { sceneId: scene.id } : {}) };
  }

  function targetUrlSet(current, targetId) {
    const urls = new Set();
    (Array.isArray(current.icons) ? current.icons : []).forEach((icon) => {
      // Folder children share folderId with their containing group. A folder
      // tile or developer tool is not a shortcut, even if it has a URL field.
      if (!icon || ['folder', 'tool', 'ssh'].includes(icon.type) || readIconGroupId(icon) !== targetId || typeof icon.url !== 'string') return;
      const parsed = parseUrlListLine(icon.url);
      if (parsed.url) urls.add(parsed.url);
    });
    return urls;
  }

  async function previewUrlList(text, targetGroupId, options) {
    const context = captureSceneContext(options);
    const parsed = parseUrlList(text);
    if (!parsed.ok) return { ...parsed, message: t(parsed.message) };
    const current = await getWorkspace().read(GRAPH_KEYS.concat([EPOCH_KEY]));
    const scene = selectedScene(current, context);
    const target = urlListGroups(current, scene).find((group) => group.id === targetGroupId);
    if (!target) return urlListFailure('target-missing', '目标分组不存在，请重新选择分组并预览。');
    const existing = targetUrlSet(current, target.id);
    const rows = parsed.rows.map((row) => row.status === 'ready' && existing.has(row.url)
      ? { ...row, status: 'duplicate', reason: '目标分组中已存在该网址。' } : row);
    const preview = { ...parsed, rows, counts: urlListCounts(rows), acceptedUrls: rows.filter((row) => row.status === 'ready').map((row) => row.url), target: { id: target.id, name: target.name }, targetSource: hasStoredUrlListTarget(current, target.id) ? 'stored' : 'builtin', epoch: current[EPOCH_KEY] || 0 };
    // A preview is an in-memory confirmation receipt, not a new durable store.
    // Retain its private copy so edits or synthetic objects cannot change what
    // was reviewed, and an already-confirmed receipt cannot be replayed.
    urlListPreviews.set(preview, { signature: JSON.stringify(preview), target: urlListTargetIdentity(target), context, scene: sceneReceipt(scene, target), snapshot: JSON.parse(JSON.stringify(preview)) });
    return preview;
  }

  function urlListResultMessage(iconCount, groupName, duplicateCount) {
    return t('已向「{groupName}」添加 {iconCount} 个网站，跳过 {duplicateCount} 个重复网址。', { iconCount, groupName, duplicateCount });
  }

  async function commitUrlList(preview) {
    const result = await getWorkspace().transaction(async ({ read, write, merge }) => {
      const receipt = preview && urlListPreviews.get(preview);
      if (!receipt || receipt.signature !== JSON.stringify(preview)) {
        return urlListFailure('invalid-preview', '预览已失效，请重新预览后确认。');
      }
      const expected = receipt.snapshot;
      const current = await read(GRAPH_KEYS.concat(['currentFolderId', EPOCH_KEY]));
      if ((current[EPOCH_KEY] || 0) !== expected.epoch) {
        return urlListFailure('workspace-changed', '工作区已被替换，请重新预览后确认。');
      }
      let scene;
      try { scene = selectedScene(current, receipt.context); checkSceneReceipt(current, receipt.scene); }
      catch (error) {
        if (error.code !== 'WORKSPACE_CONFLICT') throw error;
        return urlListFailure('target-changed', '目标分组已变化，请重新预览后确认。');
      }
      const groups = urlListGroups(current, scene);
      const target = groups.find((group) => group.id === expected.target.id);
      const storedTarget = hasStoredUrlListTarget(current, expected.target.id);
      if (!target || (expected.targetSource === 'stored' && !storedTarget)) return urlListFailure('target-missing', '目标分组不存在，请重新选择分组并预览。');
      if (urlListTargetIdentity(target) !== receipt.target) return urlListFailure('target-changed', '目标分组已变化，请重新预览后确认。');
      const existing = targetUrlSet(current, target.id);
      const rows = expected.rows.map((row) => row.status === 'ready' && existing.has(row.url)
        ? { ...row, status: 'duplicate', reason: '目标分组中已存在该网址。' } : row);
      const counts = urlListCounts(rows);
      const skippedDuplicateCount = expected.counts.ready - counts.ready;
      if (!counts.ready) {
        return { ...urlListFailure('empty', '没有可添加的新网址，现有数据未改动。'), rows, counts, iconCount: 0, groupCount: 0, skippedDuplicateCount };
      }
      const icons = Array.isArray(current.icons) ? current.icons : [];
      const additions = rows.filter((row) => row.status === 'ready').map((row) => withIconGroup(makeShortcut(row.name, row.url), target.id));
      const folders = Array.isArray(current.folders) ? current.folders : [];
      // Home is logically present even when importing into another group.
      // Materialize it only after successful target/duplicate checks, retaining
      // the latest stored Home (including a newer name) whenever one exists.
      // Identical before/after folders make this normalization non-destructive
      // on undo, including when the prior implicit current group was Home.
      const homeId = scene ? scene.homeGroupId : HOME_GROUP_ID;
      const materializeHome = !hasStoredUrlListTarget(current, homeId);
      const logicalFolders = materializeHome ? [groups.find((group) => group.id === homeId), ...folders] : folders;
      const before = stripSecretsFromState({ ...graphSnapshot(current), icons, folders: logicalFolders, currentFolderId: current.currentFolderId || homeId, [EPOCH_KEY]: expected.epoch });
      const after = stripSecretsFromState({ ...before, icons: icons.concat(additions), currentFolderId: target.id });
      // Reuse workspace graph validation and the existing storage wrapper. The
      // lock spans the latest read, validation and single atomic storage write.
      const merged = merge(before, after, { ...current, folders: logicalFolders, currentFolderId: before.currentFolderId });
      validateSceneState(merged);
      const message = urlListResultMessage(additions.length, target.name, counts.duplicate);
      const previousLocalGroup = scene && groups.find(group => group.id === (receipt.context.value && receipt.context.value.currentFolderId));
      const navigation = scene ? {
        before: sceneNavigation(scene.id, previousLocalGroup ? previousLocalGroup.id : scene.homeGroupId, receipt.context),
        after: sceneNavigation(scene.id, target.id, receipt.context)
      } : undefined;
      await write({ icons: merged.icons, currentFolderId: target.id, ...(materializeHome ? { folders: logicalFolders } : {}),
        [UNDO_KEY]: { id: generateId(), format: 'url-list', createdAt: new Date().toISOString(), before, after, scene: receipt.scene, ...(navigation ? { navigation } : {}) },
        [NOTICE_KEY]: { format: 'url-list', text: message, targetName: target.name, iconCount: additions.length, duplicateCount: counts.duplicate, canUndo: true }
      });
      urlListPreviews.delete(preview);
      return { ok: true, format: 'url-list', iconCount: additions.length, groupCount: 0, rows, counts, skippedDuplicateCount, message, ...(navigation ? { navigation: navigation.after } : {}) };
    });
    if (result.ok) {
      // A rendering/reload failure after a successful write is not a failed
      // import, and must not encourage submitting the same list again.
      try { setStatus(result.message, false); } catch (_) { /* Already saved. */ }
      try { Promise.resolve(refreshUndoButton()).catch(() => {}); } catch (_) { /* Already saved. */ }
      try { reloadPage(result.navigation); } catch (_) { result.reloadRequired = true; }
    } else setStatus(result.message, true);
    return result;
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
    let base = String(desired || '').trim() || t('导入');
    if (base === '主页') base = t('导入的主页');
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
    groups.push({ name: name || t('导入'), icons });
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
      const title = node.title || t('未命名');
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
          pushGroup(groups, item.name || item.title || t('Infinity 文件夹'), nested);
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
      const name = folder.id === HOME_GROUP_ID ? t('导入的主页') : folder.name;
      pushGroup(groups, name, links);
    });
    byId.forEach((links, folderId) => {
      if (folderList.some((folder) => folder.id === folderId)) return;
      pushGroup(groups, t('导入'), links);
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
        return { ok: false, error: 'invalid-json', message: t(MSG_INVALID_JSON) };
      }
    }
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'unrecognized', message: t(MSG_UNRECOGNIZED) };
    }

    const openTabFile = looksOpenTab(raw) || SCENE_KEYS.some(key => Object.hasOwn(raw, key))
      || raw.data && (looksOpenTab(raw.data) || SCENE_KEYS.some(key => Object.hasOwn(raw.data, key)));
    if (openTabFile) {
      try { inspectBackup(raw); }
      catch (_) { return { ok: false, error: 'unsupported-schema', message: t(MSG_UNRECOGNIZED) }; }
    }
    let format = '';
    let groups = [];
    if (openTabFile) {
      format = 'opentab';
      groups = parseOpenTab(unwrapBackupPayload(raw));
    } else if (looksInfinity(raw, filename)) {
      format = 'infinity';
      groups = parseInfinity(raw);
    } else if (looksWeTab(raw, filename)) {
      format = 'wetab';
      groups = parseWeTab(raw);
    } else if (looksITab(raw)) {
      format = 'itab';
      groups = parseITab(raw);
    } else {
      return { ok: false, error: 'unrecognized', message: t(MSG_UNRECOGNIZED) };
    }

    const iconCount = groups.reduce((sum, group) => sum + ((group.icons || []).length), 0);
    if (!iconCount) {
      return { ok: false, error: 'empty', message: t('备份里没有可导入的图标，现有数据未改动。') };
    }
    return { ok: true, format, groups, iconCount, groupCount: groups.length };
  }

  function materializeImport(parsed, current, options) {
    const scene = selectedScene(current || {}, captureSceneContext(options));
    // Existing records, opaque metadata, IDs and order are never normalized by
    // an additive import. Only newly created groups receive scene ownership.
    const groups = Array.isArray(current && current.folders) ? current.folders.slice() : [];
    const icons = Array.isArray(current && current.icons) ? current.icons.slice() : [];
    let iconCount = 0, groupCount = 0;
    (parsed.groups || []).forEach((incoming) => {
      const made = [];
      (incoming.icons || []).forEach((item) => {
        const shortcut = makeShortcut(item.name, item.url);
        if (shortcut) made.push(shortcut);
      });
      if (!made.length) return;
      const name = nextGroupName(incoming.name, groups.filter(group => !scene || group.sceneId === scene.id));
      const group = { id: 'folder-' + generateId(), name, ...(scene ? { sceneId: scene.id } : {}) };
      groups.push(group);
      groupCount += 1;
      made.forEach((shortcut) => { icons.push(withIconGroup(shortcut, group.id)); iconCount += 1; });
    });
    return { folders: groups, icons, iconCount, groupCount };
  }

  function importResultMessage(iconCount, groupCount) {
    return t('已导入 {iconCount} 个图标、{groupCount} 个分组。', { iconCount, groupCount });
  }

  function setStatus(message, isError) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('import-sync-status');
    if (!el) return;
    el.textContent = t(message);
    el.style.color = isError ? '#ffb4b4' : '';
  }

  function refreshUndoButton() {
    const btn = typeof document !== 'undefined' ? document.getElementById('import-undo-btn') : null;
    if (!btn) return Promise.resolve(false);
    return storageLocalGet([UNDO_KEY]).then((result) => {
      const snapshot = result && result[UNDO_KEY];
      const enabled = !!(snapshot && snapshot.before && snapshot.after);
      btn.disabled = !enabled;
      const legacy = snapshot && !enabled;
      btn.title = legacy ? t('旧版撤销记录缺少冲突信息，无法安全撤销；原记录保留。') : '';
      if (legacy) setStatus(btn.title, true);
      return enabled;
    }, () => {
      btn.disabled = true;
      return false;
    });
  }

  function consumeNotice(callback) {
    return getWorkspace().transaction(async ({ read, write }) => {
      const result = await read([NOTICE_KEY]);
      const notice = result && result[NOTICE_KEY];
      if (!notice) return null;
      await write({ [NOTICE_KEY]: null });
      return notice;
    }).then((notice) => {
      if (!notice) return null;
      if (notice.text) setStatus(noticeMessage(notice), !!notice.error);
      if (typeof callback === 'function') callback(notice);
      return notice;
    });
  }

  async function commitImport(parsed, options) {
    return commitImportWithContext(parsed, captureSceneContext(options));
  }

  async function commitImportWithContext(parsed, context) {
    const result = await getWorkspace().transaction(async ({ read, write }) => {
      const current = await read(GRAPH_KEYS.concat([EPOCH_KEY]));
      const scene = selectedScene(current, context);
      if (Object.hasOwn(context, 'epoch')) {
        if (context.epoch !== (current[EPOCH_KEY] || 0)) throw sceneConflict();
        checkSceneReceipt(current, context.scene);
      }
      const materialized = materializeImport(parsed, current, context.value);
      if (!materialized.iconCount) {
        return { ok: false, error: 'empty', message: t('备份里没有可导入的图标，现有数据未改动。') };
      }
      const epoch = current[EPOCH_KEY] || 0;
      const before = stripSecretsFromState({
        ...graphSnapshot(current),
        icons: Array.isArray(current.icons) ? current.icons : [],
        folders: Array.isArray(current.folders) ? current.folders : [],
        [EPOCH_KEY]: epoch
      });
      const after = stripSecretsFromState({
        ...before,
        icons: materialized.icons,
        folders: materialized.folders,
        [EPOCH_KEY]: epoch
      });
      validateSceneState(after);
      const text = importResultMessage(materialized.iconCount, materialized.groupCount);
      await write({
        icons: materialized.icons,
        folders: materialized.folders,
        [UNDO_KEY]: { id: generateId(), createdAt: new Date().toISOString(), before, after, scene: sceneReceipt(scene) },
        [NOTICE_KEY]: { text, iconCount: materialized.iconCount, groupCount: materialized.groupCount, canUndo: true }
      });
      return { ok: true, format: parsed.format, iconCount: materialized.iconCount, groupCount: materialized.groupCount, message: text };
    });
    setStatus(result.message, !result.ok);
    if (!result.ok) return result;
    refreshUndoButton();
    reloadPage();
    return result;
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
      return { ok: false, denied: true, message: t(MSG_BOOKMARKS_DENIED) };
    }
    const api = getChrome();
    if (!api || !api.bookmarks || typeof api.bookmarks.getTree !== 'function') {
      return { ok: false, denied: true, message: t(MSG_BOOKMARKS_DENIED) };
    }
    try {
      const tree = await chromeCall(api.bookmarks.getTree.bind(api.bookmarks), []);
      const folders = flattenBookmarkFolders(tree).filter((folder) => folder.id !== '0');
      return { ok: true, tree, folders };
    } catch (error) {
      return { ok: false, denied: true, message: t(MSG_BOOKMARKS_DENIED) };
    }
  }

  function parsedFromBookmarkFolder(tree, folderId) {
    const folders = flattenBookmarkFolders(tree);
    const folder = folders.find((item) => item.id === String(folderId));
    if (!folder) return { ok: false, error: 'missing', message: t('未找到该书签文件夹。') };
    const groups = [];
    pushGroup(groups, folder.title, collectBookmarkLinks(folder.node));
    if (!groups.length) return { ok: false, error: 'empty', message: t('该文件夹没有可导入的书签，现有数据未改动。') };
    return { ok: true, format: 'bookmarks', groups, iconCount: groups[0].icons.length, groupCount: 1 };
  }

  function parsedFromTopSites(sites) {
    const sliced = (Array.isArray(sites) ? sites : []).slice(0, TOP_SITES_LIMIT);
    const groups = [];
    pushGroup(groups, t('常用网站'), sliced.map((site) => ({ name: site && site.title, url: site && site.url })));
    if (!groups.length) return { ok: false, error: 'empty', message: t('没有可导入的常用网站。') };
    return { ok: true, format: 'topsites', groups, iconCount: groups[0].icons.length, groupCount: 1 };
  }

  async function importTopSites(options) {
    const context = captureSceneContext(options);
    const permissionPromise = requestOptionalPermission('topSites');
    const baselinePromise = captureStoredSceneContext(context);
    baselinePromise.catch(() => {});
    const permission = await permissionPromise;
    if (!permission.granted) {
      setStatus(MSG_TOPSITES_DENIED, true);
      return { ok: false, denied: true, message: t(MSG_TOPSITES_DENIED) };
    }
    const api = getChrome();
    if (!api || !api.topSites || typeof api.topSites.get !== 'function') {
      setStatus(MSG_TOPSITES_DENIED, true);
      return { ok: false, denied: true, message: t(MSG_TOPSITES_DENIED) };
    }
    try {
      const baseline = await baselinePromise;
      const sites = await chromeCall(api.topSites.get.bind(api.topSites), []);
      const parsed = parsedFromTopSites(sites);
      if (!parsed.ok) {
        setStatus(parsed.message, true);
        return parsed;
      }
      return await commitImportWithContext(parsed, baseline);
    } catch (error) {
      if (error.code) {
        setStatus(error.message, true);
        return { ok: false, error: error.code, message: error.message };
      }
      setStatus(MSG_TOPSITES_DENIED, true);
      return { ok: false, denied: true, message: t(MSG_TOPSITES_DENIED) };
    }
  }

  function undoFailureMessage(error) {
    return error && error.code === 'WORKSPACE_CONFLICT'
      ? t('导入后相关内容已被修改，无法安全撤销。现有数据未改动。')
      : t('撤销失败，请重试。');
  }

  async function undoLastImport() {
    const context = captureSceneContext();
    let result;
    try {
      result = await getWorkspace().transaction(async ({ read, write, merge }) => {
        const current = await read(null);
        validateSceneState(current);
        const snapshot = current[UNDO_KEY];
        if (!snapshot) return { ok: false, message: t('没有可撤销的导入。') };
        if (!snapshot.before || !snapshot.after) {
          return { ok: false, error: 'legacy-undo', message: t('该导入记录较旧，无法安全撤销。现有数据未改动。') };
        }
        checkSceneReceipt(current, snapshot.scene);
        // Apply only the inverse import delta, preserving later independent edits.
        const before = { ...snapshot.before }, after = { ...snapshot.after };
        if (snapshot.format === 'url-list' && current.currentFolderId !== after.currentFolderId) {
          // Preserve the shared compatibility alias if another tab changed it.
          // This is independent of the invoking tab's local inverse navigation.
          delete before.currentFolderId;
          delete after.currentFolderId;
        }
        const merged = merge(after, before, current);
        validateSceneState(merged);
        const navigation = snapshot.format === 'url-list' ? localUndoNavigation(current, snapshot, context) : undefined;
        const patch = {
          [UNDO_KEY]: null,
          [NOTICE_KEY]: { text: '已撤销上次导入。', canUndo: false }
        };
        GRAPH_KEYS.concat(['currentFolderId']).forEach((key) => {
          if (JSON.stringify(merged[key]) !== JSON.stringify(current[key])) patch[key] = merged[key];
        });
        await write(patch);
        return { ok: true, ...(navigation ? { navigation } : {}) };
      });
    } catch (error) {
      setStatus(undoFailureMessage(error), true);
      throw error;
    }
    if (!result.ok) {
      setStatus(result.message, true);
      return result;
    }
    setStatus(t('已撤销上次导入。'), false);
    refreshUndoButton();
    reloadPage(result.navigation);
    return result;
  }

  function fillBookmarkSelect(folders) {
    const select = document.getElementById('bookmark-folder-select');
    const row = document.getElementById('bookmark-folder-row');
    if (!select || !row) return;
    select.innerHTML = '';
    folders.forEach((folder) => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = t('{path}（{count}）', { path: folder.path, count: folder.count });
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
    let bookmarkContext = null;
    let fileContext = null;

    if (bookmarkBtn) {
      bookmarkBtn.addEventListener('click', () => {
        bookmarkTree = null;
        const context = captureSceneContext();
        const loading = loadBookmarkFolders();
        const baseline = captureStoredSceneContext(context);
        baseline.catch(() => {});
        bookmarkContext = baseline;
        loading.then(async (result) => {
          await baseline;
          if (bookmarkContext !== baseline) return;
          if (!result.ok) {
            setStatus(result.message, true);
            return;
          }
          bookmarkTree = result.tree;
          fillBookmarkSelect(result.folders);
          setStatus(t('请选择要导入的书签文件夹，导入后会成为一个分组。'), false);
        }).catch(() => {
          setStatus(MSG_BOOKMARKS_DENIED, true);
        });
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const select = document.getElementById('bookmark-folder-select');
        if (!bookmarkTree || !select || !select.value) {
          setStatus(t('请先选择一个书签文件夹。'), true);
          return;
        }
        const parsed = parsedFromBookmarkFolder(bookmarkTree, select.value);
        if (!parsed.ok) {
          setStatus(parsed.message, true);
          return;
        }
        Promise.resolve(bookmarkContext).then(context => commitImportWithContext(parsed, context)).catch(() => setStatus(t('导入失败，现有数据未改动。'), true));
      });
    }

    if (topSitesBtn) {
      topSitesBtn.addEventListener('click', () => {
        importTopSites().catch(() => setStatus(MSG_TOPSITES_DENIED, true));
      });
    }

    if (fileBtn && fileInput) {
      fileBtn.addEventListener('click', () => {
        fileContext = captureStoredSceneContext(captureSceneContext());
        fileContext.catch(() => {});
        fileInput.value = '';
        fileInput.click();
      });
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const baseline = fileContext || captureStoredSceneContext(captureSceneContext());
        baseline.catch(() => {});
        Promise.resolve(file.text()).then(async (text) => {
          const context = await baseline;
          const parsed = parseBackupFile(text, file.name);
          if (!parsed.ok) {
            setStatus(parsed.message, true);
            return null;
          }
          return commitImportWithContext(parsed, context);
        }).catch(() => {
          setStatus(MSG_INVALID_JSON, true);
        }).then(() => {
          fileInput.value = '';
        });
      });
    }

    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        undoLastImport().catch((error) => setStatus(undoFailureMessage(error), true));
      });
    }

    bindBackupUi();
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => { refreshUndoButton(); });
    }
    consumeNotice((notice) => { showImportToast(notice); }).catch(() => setStatus(t('读取导入状态失败，请重试。'), true));
    refreshUndoButton();
  }

  if (typeof document !== 'undefined') {
    const start = () => {
      if (globalThis.OpenTabI18n) globalThis.OpenTabI18n.ready.then(bindUi);
      else bindUi();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return {
    HOME_GROUP_ID,
    TOP_SITES_LIMIT,
    URL_LIST_MAX_LINES,
    URL_LIST_MAX_BYTES,
    UNDO_KEY,
    NOTICE_KEY,
    SECRET_FIELDS,
    MSG_BOOKMARKS_DENIED,
    MSG_TOPSITES_DENIED,
    MSG_UNRECOGNIZED,
    MSG_INVALID_JSON,
    setChrome,
    setIdFactory,
    setSceneContextProvider,
    setReloader,
    foldersToGroups,
    groupsToFolders,
    readIconGroupId,
    withIconGroup,
    stripSecretsFromState,
    flattenBookmarkFolders,
    parseBackupFile,
    parseUrlList,
    readUrlListContext,
    previewUrlList,
    commitUrlList,
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
    prepareSnapshotRecord,
    stripSnapshotIconData,
    BACKUP_SNAPSHOTS_KEY,
    BACKUP_SNAPSHOT_MAX_BYTES
  };
}));
