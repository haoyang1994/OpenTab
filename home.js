(function() {
  const HOME_FOLDER_ID = 'folder-home';
  const ICON_TYPE_SHORTCUT = 'shortcut';
  const ICON_TYPE_SSH = 'ssh';
  const ICON_TYPE_TOOL = 'tool';

  const COMMON_TIMEZONES = [
    { id: 'Asia/Shanghai', name: '北京', offset: 8 },
    { id: 'America/New_York', name: '美东', offset: -5 },
    { id: 'America/Chicago', name: '美中', offset: -6 },
    { id: 'UTC', name: 'UTC', offset: 0 },
    { id: 'Asia/Hong_Kong', name: '香港', offset: 8 },
    { id: 'Asia/Tokyo', name: '东京', offset: 9 },
    { id: 'Asia/Singapore', name: '新加坡', offset: 8 },
    { id: 'Asia/Seoul', name: '首尔', offset: 9 },
    { id: 'Europe/London', name: '伦敦', offset: 0 },
    { id: 'Europe/Paris', name: '巴黎', offset: 1 },
    { id: 'Europe/Berlin', name: '柏林', offset: 1 },
    { id: 'Europe/Moscow', name: '莫斯科', offset: 3 },
    { id: 'Asia/Dubai', name: '迪拜', offset: 4 },
    { id: 'Asia/Kolkata', name: '孟买', offset: 5.5 },
    { id: 'Asia/Bangkok', name: '曼谷', offset: 7 },
    { id: 'Australia/Sydney', name: '悉尼', offset: 10 },
    { id: 'Pacific/Auckland', name: '奥克兰', offset: 12 },
    { id: 'America/Los_Angeles', name: '洛杉矶', offset: -8 },
    { id: 'America/Denver', name: '丹佛', offset: -7 },
    { id: 'America/Sao_Paulo', name: '圣保罗', offset: -3 },
    { id: 'Africa/Cairo', name: '开罗', offset: 2 },
    { id: 'Pacific/Honolulu', name: '檀香山', offset: -10 },
    { id: 'America/Anchorage', name: '安克雷奇', offset: -9 }
  ];

  const DEFAULT_FOLDERS = [
    { id: HOME_FOLDER_ID, name: '主页' }
  ];
  const LEGACY_PRESET_FOLDER_IDS = new Set(['folder-blog', 'folder-tools', 'folder-ops']);

  const DEFAULT_GRADIENT = 'linear-gradient(135deg, #09203f 0%, #537895 100%)';

  const SOLAR_TERM_NAMES = [
    '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
  ];

  const SOLAR_TERM_C = [
    6.11, 20.84, 4.6295, 19.4599, 6.3826, 21.4155,
    4.84, 20.1, 5.52, 21.04, 5.678, 21.37,
    7.108, 22.83, 7.5, 23.13, 7.646, 23.042,
    8.318, 23.438, 7.438, 22.36, 7.18, 21.94
  ];

  const LUNAR_FESTIVALS = {
    '1-1': '春节',
    '1-15': '元宵节',
    '5-5': '端午节',
    '7-7': '七夕',
    '8-15': '中秋节',
    '9-9': '重阳节',
    '12-8': '腊八节'
  };

  const SOLAR_FESTIVALS = {
    '1-1': '元旦',
    '5-1': '劳动节',
    '10-1': '国庆节'
  };

  const WELCOME_TIME_POOL = {
    deepNight: ['深夜模式已开启。', '夜深了，先做最关键的一件事。', '这个时间段适合安静地推进重点。'],
    morning: ['早安，今天从小胜开始。', '清晨效率高，先推进主线任务。', '新的一天，先完成最难的第一步。'],
    forenoon: ['上午好，保持专注节奏。', '当前状态不错，继续稳步推进。', '把复杂任务拆小，今天会更顺。'],
    noon: ['中午好，记得补水和休息。', '先短暂充电，再开始下半场。', '吃好休息好，效率会更稳。'],
    afternoon: ['下午好，适合集中清理待办。', '保持当前节奏，今天进度会很漂亮。', '把分散任务收拢，效率更高。'],
    evening: ['晚上好，适合收尾与复盘。', '把今天的成果整理一下。', '再推进一轮，就可以安心收工。'],
    lateNight: ['夜深了，完成这轮就休息。', '晚间冲刺可以，但别透支。', '保持克制，质量优先于时长。']
  };

  const WELCOME_WEATHER_POOL = {
    sunny: ['晴天在线，适合把计划拉满。', '阳光不错，行动力也拉起来。', '晴朗的一天，推进速度可以更快。'],
    cloudy: ['多云天气，节奏稳一点更高效。', '云层厚一点，专注刚刚好。', '天气温和，适合持续输出。'],
    rainy: ['下雨天也能稳步推进。', '雨声适合专注，慢一点更稳。', '雨天记得保暖，效率也别掉线。'],
    snowy: ['有雪意，注意保暖再开工。', '天气偏冷，先热身再进入状态。', '雪天节奏放稳，质量优先。'],
    storm: ['天气不太友好，任务更要有序。', '雷雨天气，先做可控的小目标。', '外面有风雨，内心要稳定。'],
    fog: ['能见度一般，计划要更清晰。', '雾天慢一点，把步骤写清楚。', '视野一般，目标更要明确。'],
    unknown: ['今天也要稳住节奏。', '先动手，再优化。', '保持连续的小进步。']
  };

  const WELCOME_MOTIVATION_POOL = [
    '先完成，再完美。',
    '你只需要比上一轮更好一点。',
    '把注意力放在可控的下一步。',
    '持续 25 分钟，会有惊喜。',
    '最小可行进展，也是进展。',
    '先把最难的开头做掉。',
    '不要等状态，先动起来。',
    '今天的专注，会变成明天的自由。',
    '把复杂问题拆成三个小动作。',
    '节奏稳，结果自然会好。'
  ];

  const elements = {
    backgroundLayer: document.getElementById('background-layer'),
    backgroundVideo: document.getElementById('background-video'),
    time: document.getElementById('time'),
    ampm: document.getElementById('ampm'),
    date: document.getElementById('date'),
    welcomeText: document.getElementById('welcome-text'),
    timezoneLabel: document.getElementById('timezone-label'),
    timezoneBtn: document.getElementById('timezone-btn'),
    timezoneSelector: document.getElementById('timezone-selector'),
    timezoneList: document.getElementById('timezone-list'),
    iconsContainer: document.getElementById('icons-container'),
    searchEngineButtons: document.querySelectorAll('.engine-btn'),
    searchInput: document.getElementById('search-input'),
    todoInput: document.getElementById('todo-input'),
    todoAddBtn: document.getElementById('todo-add-btn'),
    todoList: document.getElementById('todo-list'),
    todoCount: document.getElementById('todo-count'),
    todoEmpty: document.getElementById('todo-empty'),
    todoProgressBar: document.getElementById('todo-progress-bar'),
    todoToggleBtn: document.getElementById('todo-toggle-btn'),
    todoCollapseBtn: document.getElementById('todo-collapse-btn'),
    todoWidget: document.getElementById('todo-widget'),
    weatherPill: document.getElementById('weather-pill'),
    weatherIcon: document.getElementById('weather-icon'),
    weatherLocationInline: document.getElementById('weather-location-inline'),
    weatherTemp: document.getElementById('weather-temp'),

    workspaceBtn: document.getElementById('workspace-btn'),
    desktopFolderLabel: document.getElementById('desktop-folder-label'),
    workspaceDrawer: document.getElementById('workspace-drawer'),
    workspaceFolderTabs: document.getElementById('workspace-folder-tabs'),
    workspaceIconsContainer: document.getElementById('workspace-icons-container'),
    workspaceEmpty: document.getElementById('workspace-empty'),
    addFolderBtn: document.getElementById('add-folder-btn'),

    refreshBgBtn: document.getElementById('refresh-bg-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    closeSettings: document.getElementById('close-settings'),

    addIconModal: document.getElementById('add-icon-modal'),
    iconModalTitle: document.getElementById('icon-modal-title'),
    iconType: document.getElementById('icon-type'),
    iconName: document.getElementById('icon-name'),
    shortcutFields: document.getElementById('shortcut-fields'),
    iconUrl: document.getElementById('icon-url'),
    iconCustomUrl: document.getElementById('icon-custom-url'),
    iconFile: document.getElementById('icon-file'),
    iconUploadStatus: document.getElementById('icon-upload-status'),
    sshFields: document.getElementById('ssh-fields'),
    toolFields: document.getElementById('tool-fields'),
    toolSubtype: document.getElementById('tool-subtype'),
    sshGatewayUrl: document.getElementById('ssh-gateway-url'),
    sshHost: document.getElementById('ssh-host'),
    sshPort: document.getElementById('ssh-port'),
    sshUsername: document.getElementById('ssh-username'),
    sshPassword: document.getElementById('ssh-password'),
    sshSocksHost: document.getElementById('ssh-socks-host'),
    sshSocksPort: document.getElementById('ssh-socks-port'),
    sshSocksUsername: document.getElementById('ssh-socks-username'),
    sshSocksPassword: document.getElementById('ssh-socks-password'),
    cancelBtn: document.getElementById('cancel-btn'),
    saveBtn: document.getElementById('save-btn'),

    iconContextMenu: document.getElementById('icon-context-menu'),
    editIconBtn: document.getElementById('edit-icon-btn'),
    deleteIconBtn: document.getElementById('delete-icon-btn'),

    bgTypeTabs: document.querySelectorAll('.tab-btn'),
    bingSection: document.getElementById('bing-section'),
    gradientSection: document.getElementById('gradient-section'),
    imageSection: document.getElementById('image-section'),
    backgroundPresets: document.getElementById('background-presets'),
    imagePresets: document.getElementById('image-presets'),
    customBgUrl: document.getElementById('custom-bg-url'),
    customBgFile: document.getElementById('custom-bg-file'),
    applyBgBtn: document.getElementById('apply-bg-btn'),
    applyBgFileBtn: document.getElementById('apply-bg-file-btn'),
    timeFormat: document.getElementById('time-format'),
    showSeconds: document.getElementById('show-seconds'),
    uiOpacity: document.getElementById('ui-opacity'),
    uiOpacityValue: document.getElementById('ui-opacity-value'),
    uiBlur: document.getElementById('ui-blur'),
    uiBlurValue: document.getElementById('ui-blur-value'),
    iconFrameEnabled: document.getElementById('icon-frame-enabled'),
    themeModeTabs: document.querySelectorAll('.theme-mode-tab'),
    themeColorPresets: document.querySelectorAll('.theme-color-preset'),
    particlesEnabled: document.getElementById('particles-enabled'),
    gradientFlowEnabled: document.getElementById('gradient-flow-enabled'),
    minimalModeEnabled: document.getElementById('minimal-mode-enabled'),
    particlesCanvas: document.getElementById('particles-canvas'),
    backupDownloadBtn: document.getElementById('backup-download-btn'),
    backupImportBtn: document.getElementById('backup-import-btn'),
    backupImportFile: document.getElementById('backup-import-file'),
    backupSaveSnapshotBtn: document.getElementById('backup-save-snapshot-btn'),
    backupRestoreSnapshotBtn: document.getElementById('backup-restore-snapshot-btn'),
    backupStatus: document.getElementById('backup-status'),

    calendarPopover: document.getElementById('calendar-popover'),
    calendarInput: document.getElementById('calendar-input')
  };

  const state = {
    icons: [],
    folders: [],
    currentFolderId: HOME_FOLDER_ID,
    searchEngine: 'google',
    todoPanelOpen: false,
    todos: [],
    background: { type: 'bing', value: '', source: '' },
    clockFormat: '12h',
    showSeconds: false,
    uiOpacity: 32,
    uiBlur: 10,
    iconFrameEnabled: false,
    weatherTag: 'unknown',
    weatherDesc: '',
    weatherLocation: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    bingIndex: 0,
    // 主题相关
    themeMode: 'dark',
    accentHue: 200,
    particlesEnabled: false,
    gradientFlow: false,
    minimalMode: false
  };
  const BACKUP_SNAPSHOTS_KEY = 'backupSnapshots';
  const BACKUP_MAX_SNAPSHOTS = 20;
  const BACKUP_STATE_KEYS = [
    'icons',
    'folders',
    'currentFolderId',
    'searchEngine',
    'todos',
    'todoPanelOpen',
    'background',
    'clockFormat',
    'showSeconds',
    'uiOpacity',
    'uiBlur',
    'iconFrameEnabled',
    'timezone',
    'bingIndex',
    'themeMode',
    'accentHue',
    'particlesEnabled',
    'gradientFlow',
    'minimalMode'
  ];

  let calendarPicker = null;
  let editingIconId = null;
  let contextMenuIconId = null;
  let pendingIconUploadDataUrl = '';
  let iconSwitchToken = 0;
  let draggingIconId = null;
  let workspaceEdgeOpenTimer = null;
  let suppressWorkspaceAutoCloseUntil = 0;
  let clockTimerId = null;
  let weatherTimerId = null;
  let weatherAbortController = null;

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function ensureFolders(folders) {
    const normalized = Array.isArray(folders)
      ? folders
        .filter((f) => f && f.id && f.name)
        .map((f) => ({ id: f.id, name: f.name }))
      : [];

    const byId = new Map(normalized.map((f) => [f.id, f]));
    DEFAULT_FOLDERS.forEach((f) => {
      if (!byId.has(f.id)) byId.set(f.id, { ...f });
    });

    return Array.from(byId.values());
  }

  function getFolderById(folderId) {
    return state.folders.find((folder) => folder.id === folderId);
  }

  function normalizeUrl(rawUrl) {
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(candidate).toString();
  }

  function normalizeOptionalUrl(rawUrl) {
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    return normalizeUrl(trimmed);
  }

  function normalizeIconType(rawType) {
    if (rawType === ICON_TYPE_SSH) return ICON_TYPE_SSH;
    if (rawType === ICON_TYPE_TOOL) return ICON_TYPE_TOOL;
    return ICON_TYPE_SHORTCUT;
  }

  function normalizeSshGatewayUrl(rawUrl) {
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    const candidate = /^(wss?|https?):\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error('SSH 网关地址必须使用 ws:// 或 wss://');
    }
    return parsed.toString();
  }

  function normalizeOptionalText(raw) {
    const text = String(raw || '').trim();
    return text || '';
  }

  function updateBackupStatus(message, isError = false) {
    if (!elements.backupStatus) return;
    elements.backupStatus.textContent = message;
    elements.backupStatus.style.color = isError ? '#ffb4b4' : 'rgba(255, 255, 255, 0.65)';
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result));
    });
  }

  function storageSet(payload) {
    return new Promise((resolve) => {
      chrome.storage.local.set(payload, () => resolve());
    });
  }

  function getBackupPayloadFromState() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      icons: state.icons,
      folders: state.folders,
      currentFolderId: state.currentFolderId,
      searchEngine: state.searchEngine,
      todos: state.todos,
      todoPanelOpen: state.todoPanelOpen,
      background: state.background,
      clockFormat: state.clockFormat,
      showSeconds: state.showSeconds,
      uiOpacity: state.uiOpacity,
      uiBlur: state.uiBlur,
      iconFrameEnabled: state.iconFrameEnabled,
      timezone: state.timezone,
      bingIndex: state.bingIndex,
      themeMode: state.themeMode,
      accentHue: state.accentHue,
      particlesEnabled: state.particlesEnabled,
      gradientFlow: state.gradientFlow,
      minimalMode: state.minimalMode
    };
  }

  function normalizeBackupPayload(rawPayload) {
    const payload = rawPayload && typeof rawPayload === 'object'
      ? (rawPayload.data && typeof rawPayload.data === 'object' ? rawPayload.data : rawPayload)
      : {};

    const normalized = { ...getBackupPayloadFromState() };
    BACKUP_STATE_KEYS.forEach((key) => {
      if (payload[key] !== undefined) normalized[key] = payload[key];
    });

    normalized.folders = ensureFolders(normalized.folders).filter(
      (folder) => !LEGACY_PRESET_FOLDER_IDS.has(folder.id)
    );
    if (!normalized.folders.some((folder) => folder.id === HOME_FOLDER_ID)) {
      normalized.folders.unshift({ id: HOME_FOLDER_ID, name: '主页' });
    }

    const validFolderIds = new Set(normalized.folders.map((folder) => folder.id));
    normalized.icons = Array.isArray(normalized.icons) ? normalized.icons.map((icon) => ({
      ...icon,
      type: normalizeIconType(icon.type),
      folderId: validFolderIds.has(icon.folderId) ? icon.folderId : HOME_FOLDER_ID,
      customIconUrl: icon.customIconUrl || '',
      emoji: icon.emoji || '',
      uploadedIconDataUrl: icon.uploadedIconDataUrl || '',
      resolvedIconUrl: icon.resolvedIconUrl || '',
      sshGatewayUrl: icon.sshGatewayUrl || '',
      sshHost: icon.sshHost || '',
      sshPort: Number.isInteger(icon.sshPort) ? icon.sshPort : 22,
      sshUsername: icon.sshUsername || '',
      sshPassword: icon.sshPassword || '',
      sshSocksHost: icon.sshSocksHost || '',
      sshSocksPort: Number.isInteger(icon.sshSocksPort) ? icon.sshSocksPort : 1080,
      sshSocksUsername: icon.sshSocksUsername || '',
      sshSocksPassword: icon.sshSocksPassword || ''
    })) : [];

    normalized.currentFolderId = validFolderIds.has(normalized.currentFolderId)
      ? normalized.currentFolderId
      : HOME_FOLDER_ID;
    normalized.searchEngine = ['google', 'bing', 'github'].includes(normalized.searchEngine)
      ? normalized.searchEngine
      : 'google';
    normalized.todos = Array.isArray(normalized.todos) ? normalized.todos : [];
    normalized.todoPanelOpen = Boolean(normalized.todoPanelOpen);
    normalized.clockFormat = normalized.clockFormat === '24h' ? '24h' : '12h';
    normalized.showSeconds = Boolean(normalized.showSeconds);
    normalized.uiOpacity = Number.isFinite(Number(normalized.uiOpacity)) ? Number(normalized.uiOpacity) : 32;
    normalized.uiBlur = Number.isFinite(Number(normalized.uiBlur)) ? Number(normalized.uiBlur) : 10;
    normalized.iconFrameEnabled = Boolean(normalized.iconFrameEnabled);
    normalized.timezone = normalized.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    normalized.bingIndex = Number.isInteger(normalized.bingIndex) ? normalized.bingIndex : 0;
    normalized.themeMode = ['dark', 'light', 'auto'].includes(normalized.themeMode) ? normalized.themeMode : 'dark';
    normalized.accentHue = Number.isFinite(Number(normalized.accentHue)) ? Number(normalized.accentHue) : 200;
    normalized.particlesEnabled = Boolean(normalized.particlesEnabled);
    normalized.gradientFlow = Boolean(normalized.gradientFlow);
    normalized.minimalMode = Boolean(normalized.minimalMode);
    return normalized;
  }

  function makeBackupFilename(prefix = 'opentab-backup') {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${prefix}-${ts}.json`;
  }

  async function handleDownloadBackup() {
    const payload = getBackupPayloadFromState();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = makeBackupFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    updateBackupStatus('已下载备份文件。');
  }

  async function saveSnapshotRecord(reason = 'manual') {
    const result = await storageGet([BACKUP_SNAPSHOTS_KEY]);
    const list = Array.isArray(result[BACKUP_SNAPSHOTS_KEY]) ? result[BACKUP_SNAPSHOTS_KEY] : [];
    list.unshift({
      id: generateId(),
      createdAt: new Date().toISOString(),
      reason,
      data: getBackupPayloadFromState()
    });
    await storageSet({ [BACKUP_SNAPSHOTS_KEY]: list.slice(0, BACKUP_MAX_SNAPSHOTS) });
    return list[0];
  }

  async function applyBackupPayloadAndReload(rawPayload) {
    const normalized = normalizeBackupPayload(rawPayload);
    const writePayload = {};
    BACKUP_STATE_KEYS.forEach((key) => {
      writePayload[key] = normalized[key];
    });
    await storageSet(writePayload);
    location.reload();
  }

  async function handleSaveSnapshot() {
    await saveSnapshotRecord('manual');
    updateBackupStatus('已保存快照。');
  }

  async function handleRestoreLatestSnapshot() {
    const result = await storageGet([BACKUP_SNAPSHOTS_KEY]);
    const list = Array.isArray(result[BACKUP_SNAPSHOTS_KEY]) ? result[BACKUP_SNAPSHOTS_KEY] : [];
    if (list.length === 0) {
      updateBackupStatus('没有可恢复的快照。', true);
      return;
    }
    await saveSnapshotRecord('before-restore');
    await applyBackupPayloadAndReload(list[0].data || {});
  }

  function handleChooseImportFile() {
    elements.backupImportFile.value = '';
    elements.backupImportFile.click();
  }

  async function handleImportBackupFile() {
    const [file] = elements.backupImportFile.files || [];
    if (!file) return;

    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      await saveSnapshotRecord('before-import');
      updateBackupStatus('正在导入备份并刷新页面...');
      await applyBackupPayloadAndReload(raw);
    } catch (error) {
      updateBackupStatus('导入失败：JSON 无效或结构不支持。', true);
    } finally {
      elements.backupImportFile.value = '';
    }
  }

  function updateIconModalTypeView() {
    const iconType = normalizeIconType(elements.iconType.value);
    const isSsh = iconType === ICON_TYPE_SSH;
    const isTool = iconType === ICON_TYPE_TOOL;
    elements.shortcutFields.classList.toggle('hidden', isSsh || isTool);
    elements.sshFields.classList.toggle('hidden', !isSsh);
    elements.toolFields.classList.toggle('hidden', !isTool);
    elements.iconUrl.disabled = isSsh || isTool;
    elements.iconCustomUrl.disabled = isSsh || isTool;
    elements.iconFile.disabled = isSsh || isTool;
    const titleVerb = editingIconId ? '编辑' : '添加';
    if (isSsh) {
      elements.iconModalTitle.textContent = `${titleVerb} SSH 链接`;
    } else if (isTool) {
      elements.iconModalTitle.textContent = `${titleVerb}工具`;
    } else {
      elements.iconModalTitle.textContent = `${titleVerb}快捷图标`;
    }
  }

  function openIconTarget(icon) {
    const iconType = normalizeIconType(icon.type);
    if (iconType === ICON_TYPE_SSH) {
      if (!icon.sshGatewayUrl || !icon.sshHost || !icon.sshUsername) {
        alert('SSH 配置不完整，请先编辑这个图标。');
        return;
      }
      const terminalUrl = chrome.runtime.getURL(`ssh_terminal.html?iconId=${encodeURIComponent(icon.id)}`);
      window.location.assign(terminalUrl);
      return;
    }
    if (iconType === ICON_TYPE_TOOL) {
      const toolType = icon.toolSubtype || 'json-format';
      let toolFile = 'tool.html';
      if (toolType === 'fix-parser') {
        toolFile = 'fixparser.html';
      }
      const toolUrl = chrome.runtime.getURL(`${toolFile}?tool=${encodeURIComponent(toolType)}`);
      window.location.assign(toolUrl);
      return;
    }
    if (!icon.url) return;
    window.location.assign(icon.url);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }

  function getIconsForFolder(folderId) {
    return state.icons.filter((icon) => icon.folderId === folderId);
  }

  function getIconLabel(icon) {
    if (normalizeIconType(icon.type) === ICON_TYPE_SSH) return '>_';
    if (normalizeIconType(icon.type) === ICON_TYPE_TOOL) return '{ }';
    if (icon.emoji) return icon.emoji;
    const trimmed = (icon.name || '').trim();
    return trimmed ? trimmed[0].toUpperCase() : '•';
  }

  function getFaviconCandidates(pageUrl) {
    try {
      const origin = new URL(pageUrl).origin;
      return [`${origin}/favicon.ico`, `${origin}/apple-touch-icon.png`, `${origin}/favicon.png`];
    } catch (error) {
      return [];
    }
  }

  function cacheResolvedIcon(iconId, resolvedUrl) {
    const icon = state.icons.find((item) => item.id === iconId);
    if (!icon || !resolvedUrl || icon.resolvedIconUrl === resolvedUrl) return;
    icon.resolvedIconUrl = resolvedUrl;
    saveState();
  }

  function formatTimezoneOffset(offset) {
    const sign = offset >= 0 ? '+' : '';
    return `UTC${sign}${offset}`;
  }

  function renderTimezoneList() {
    elements.timezoneList.innerHTML = '';
    COMMON_TIMEZONES.forEach((tz) => {
      const item = document.createElement('div');
      item.className = `timezone-item${tz.id === state.timezone ? ' active' : ''}`;
      item.dataset.tz = tz.id;
      item.innerHTML = `
        <span class="timezone-item-name">${tz.name}</span>
        <span class="timezone-item-offset">${formatTimezoneOffset(tz.offset)}</span>
      `;
      item.addEventListener('click', () => selectTimezone(tz.id));
      elements.timezoneList.appendChild(item);
    });
  }

  function selectTimezone(tzId) {
    state.timezone = tzId;
    saveState();
    document.querySelectorAll('.timezone-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.tz === tzId);
    });
    const tz = COMMON_TIMEZONES.find((item) => item.id === tzId);
    elements.timezoneLabel.textContent = tz ? `${tz.name} (${formatTimezoneOffset(tz.offset)})` : tzId;
    toggleTimezoneSelector(false);
    updateClock();
  }

  function toggleTimezoneSelector(forceOpen) {
    const open = typeof forceOpen === 'boolean'
      ? forceOpen
      : elements.timezoneSelector.classList.contains('hidden');
    elements.timezoneSelector.classList.toggle('hidden', !open);
  }

  function getTimePartsInTimezone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      hour: Number(map.hour || 0),
      minute: Number(map.minute || 0),
      second: Number(map.second || 0)
    };
  }

  function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return Math.abs(hash >>> 0);
  }

  function pickBySeed(pool, seedKey) {
    if (!Array.isArray(pool) || pool.length === 0) return '';
    const idx = hashString(seedKey) % pool.length;
    return pool[idx];
  }

  function getTimeSlot(totalMinutes) {
    if (totalMinutes < 300) return 'deepNight';
    if (totalMinutes < 540) return 'morning';
    if (totalMinutes < 690) return 'forenoon';
    if (totalMinutes < 840) return 'noon';
    if (totalMinutes < 1080) return 'afternoon';
    if (totalMinutes < 1320) return 'evening';
    return 'lateNight';
  }

  function getWelcomeText(now, hour, minute) {
    const totalMinutes = hour * 60 + minute;
    const slot = getTimeSlot(totalMinutes);
    const bucket = Math.floor(totalMinutes / 30);
    const dateKey = now.toLocaleDateString('en-CA', { timeZone: state.timezone });
    const weatherTag = state.weatherTag || 'unknown';
    const baseKey = `${dateKey}-${slot}-${bucket}-${weatherTag}`;

    const timeText = pickBySeed(WELCOME_TIME_POOL[slot] || WELCOME_TIME_POOL.forenoon, `${baseKey}-time`);
    const weatherPool = WELCOME_WEATHER_POOL[weatherTag] || WELCOME_WEATHER_POOL.unknown;
    const weatherText = pickBySeed(weatherPool, `${baseKey}-weather`);
    const motivationText = pickBySeed(WELCOME_MOTIVATION_POOL, `${baseKey}-motivation`);
    return `${timeText} ${weatherText} ${motivationText}`.trim();
  }

  function updateClock() {
    const now = new Date();
    const options = {
      timeZone: state.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: state.clockFormat === '12h'
    };

    if (state.showSeconds) options.second = '2-digit';
    elements.time.textContent = now.toLocaleTimeString('zh-CN', options);

    if (state.clockFormat === '12h') {
      const hours = now.toLocaleTimeString('zh-CN', {
        timeZone: state.timezone,
        hour: 'numeric',
        hour12: true
      });
      elements.ampm.textContent = hours.includes('下午') ? 'PM' : 'AM';
      elements.ampm.style.display = 'block';
    } else {
      elements.ampm.style.display = 'none';
    }

    elements.date.textContent = now.toLocaleDateString('zh-CN', {
      timeZone: state.timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    const { hour, minute } = getTimePartsInTimezone(now, state.timezone);
    elements.welcomeText.textContent = getWelcomeText(now, hour, minute);
  }

  function getSearchUrl(engine, keyword) {
    const query = encodeURIComponent(keyword);
    if (engine === 'bing') return `https://www.bing.com/search?q=${query}`;
    if (engine === 'github') return `https://github.com/search?q=${query}&type=repositories`;
    return `https://www.google.com/search?q=${query}`;
  }

  function mapWeatherToIcon(weatherCode, descText) {
    const code = Number(weatherCode);
    const desc = String(descText || '');

    if ([113].includes(code)) return '☀';
    if ([116].includes(code)) return '⛅';
    if ([119, 122].includes(code)) return '☁';
    if ([143, 248, 260].includes(code)) return '🌫';
    if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 311, 314, 317, 353, 356, 359, 362, 365].includes(code)) return '☔';
    if ([179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350, 368, 371, 374, 377].includes(code)) return '❄';
    if ([200, 386, 389, 392, 395].includes(code)) return '⚡';

    if (/晴/.test(desc)) return '☀';
    if (/雷/.test(desc)) return '⚡';
    if (/雪|冰/.test(desc)) return '❄';
    if (/雨/.test(desc)) return '☔';
    if (/雾|霾/.test(desc)) return '🌫';
    if (/云|阴/.test(desc)) return '☁';
    return '☁';
  }

  function mapWeatherToTag(weatherCode, descText) {
    const code = Number(weatherCode);
    const desc = String(descText || '');
    if ([113].includes(code) || /晴/.test(desc)) return 'sunny';
    if ([200, 386, 389, 392, 395].includes(code) || /雷/.test(desc)) return 'storm';
    if ([179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350, 368, 371, 374, 377].includes(code) || /雪|冰/.test(desc)) return 'snowy';
    if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 311, 314, 317, 353, 356, 359, 362, 365].includes(code) || /雨/.test(desc)) return 'rainy';
    if ([143, 248, 260].includes(code) || /雾|霾/.test(desc)) return 'fog';
    if ([116, 119, 122].includes(code) || /云|阴/.test(desc)) return 'cloudy';
    return 'unknown';
  }

  function getCurrentPosition(timeoutMs = 4500) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('geolocation unavailable'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(position),
        (error) => reject(error),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  async function fetchWeatherByUrl(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`weather status ${response.status}`);
    return response.json();
  }

  async function fetchWeather() {
    if (weatherAbortController) weatherAbortController.abort();
    weatherAbortController = new AbortController();
    const { signal } = weatherAbortController;

    try {
      let data;
      try {
        const pos = await getCurrentPosition();
        const lat = pos.coords.latitude.toFixed(4);
        const lon = pos.coords.longitude.toFixed(4);
        data = await fetchWeatherByUrl(`https://wttr.in/${lat},${lon}?format=j1&lang=zh-cn`, signal);
      } catch (geoError) {
        data = await fetchWeatherByUrl('https://wttr.in/?format=j1&lang=zh-cn', signal);
      }

      const current = data?.current_condition?.[0];
      const area = data?.nearest_area?.[0];
      const city = area?.areaName?.[0]?.value || '当前位置';
      const region = area?.region?.[0]?.value || '';
      const location = region && region !== city ? `${city} · ${region}` : city;
      const temp = current?.temp_C ? `${current.temp_C}°C` : '--°';
      const desc = current?.lang_zh?.[0]?.value || current?.weatherDesc?.[0]?.value || '天气信息不可用';
      const icon = mapWeatherToIcon(current?.weatherCode, desc);
      const weatherTag = mapWeatherToTag(current?.weatherCode, desc);

      elements.weatherIcon.textContent = icon;
      elements.weatherLocationInline.textContent = location;
      elements.weatherTemp.textContent = temp;
      elements.weatherPill.title = `${location} · ${desc}`;
      state.weatherTag = weatherTag;
      state.weatherDesc = desc;
      state.weatherLocation = location;
      updateClock();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      elements.weatherIcon.textContent = '☁';
      elements.weatherLocationInline.textContent = '定位失败';
      elements.weatherTemp.textContent = '--°';
      elements.weatherPill.title = '天气获取失败';
      state.weatherTag = 'unknown';
      state.weatherDesc = '';
      state.weatherLocation = '';
      updateClock();
    } finally {
      weatherAbortController = null;
    }
  }

  function cleanupRuntimeResources() {
    if (clockTimerId) {
      clearInterval(clockTimerId);
      clockTimerId = null;
    }
    if (weatherTimerId) {
      clearInterval(weatherTimerId);
      weatherTimerId = null;
    }
    clearWorkspaceEdgeTimer();
    if (weatherAbortController) {
      weatherAbortController.abort();
      weatherAbortController = null;
    }
    if (elements.backgroundVideo) {
      elements.backgroundVideo.pause();
      elements.backgroundVideo.removeAttribute('src');
      elements.backgroundVideo.load();
    }
    if (elements.backgroundLayer) {
      elements.backgroundLayer.style.backgroundImage = 'none';
      elements.backgroundLayer.style.background = '';
    }
    if (elements.iconsContainer) {
      elements.iconsContainer.querySelectorAll('img').forEach((img) => {
        img.removeAttribute('src');
      });
      elements.iconsContainer.innerHTML = '';
    }
    if (elements.workspaceIconsContainer) {
      elements.workspaceIconsContainer.querySelectorAll('img').forEach((img) => {
        img.removeAttribute('src');
      });
      elements.workspaceIconsContainer.innerHTML = '';
    }
    state.icons = [];
    state.todos = [];
  }

  function renderSearchEngineButtons() {
    elements.searchEngineButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.engine === state.searchEngine);
    });
  }

  function handleSearch() {
    const keyword = elements.searchInput.value.trim();
    if (!keyword) {
      elements.searchInput.focus();
      return;
    }
    const url = getSearchUrl(state.searchEngine, keyword);
    window.location.assign(url);
  }

  function renderTodos() {
    elements.todoList.innerHTML = '';

    state.todos.forEach((todo) => {
      const row = document.createElement('div');
      row.className = `todo-item${todo.done ? ' done' : ''}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(todo.done);
      checkbox.addEventListener('change', () => {
        todo.done = checkbox.checked;
        saveState();
        renderTodos();
      });

      const text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = todo.text;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'todo-delete';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        state.todos = state.todos.filter((item) => item.id !== todo.id);
        saveState();
        renderTodos();
      });

      row.appendChild(checkbox);
      row.appendChild(text);
      row.appendChild(remove);
      elements.todoList.appendChild(row);
    });

    const done = state.todos.filter((item) => item.done).length;
    const total = state.todos.length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    if (elements.todoCount) elements.todoCount.textContent = `${done}/${total}`;
    if (elements.todoEmpty) elements.todoEmpty.classList.toggle('hidden', total > 0);
    if (elements.todoProgressBar) elements.todoProgressBar.style.width = `${progress}%`;
  }

  function setTodoPanelOpen(open) {
    state.todoPanelOpen = open;
    elements.todoWidget.classList.toggle('hidden', !open);
    elements.todoToggleBtn.classList.toggle('active', open);
    elements.todoCollapseBtn.textContent = '×';
    elements.todoCollapseBtn.title = '关闭待办';
    elements.todoCollapseBtn.setAttribute('aria-label', '关闭待办');
    saveState();
  }

  function toggleTodoPanel() {
    setTodoPanelOpen(!state.todoPanelOpen);
  }

  function closeTodoPanel() {
    setTodoPanelOpen(false);
  }

  function handleAddTodo() {
    const text = elements.todoInput.value.trim();
    if (!text) {
      elements.todoInput.focus();
      return;
    }
    state.todos.unshift({ id: generateId(), text, done: false });
    elements.todoInput.value = '';
    saveState();
    renderTodos();
  }

  function updateBackground() {
    elements.backgroundLayer.className = 'image-bg';

    if (state.background.type === 'gradient') {
      if (elements.backgroundVideo) {
        elements.backgroundVideo.pause();
        elements.backgroundVideo.style.display = 'none';
        elements.backgroundVideo.removeAttribute('src');
      }
      elements.backgroundLayer.style.backgroundImage = 'none';
      elements.backgroundLayer.style.background = state.background.value || DEFAULT_GRADIENT;
      return;
    }

    const value = state.background.value || '';
    const isVideo = isVideoBackground(value);

    if (elements.backgroundVideo) {
      if (isVideo && value) {
        if (elements.backgroundVideo.src !== value) {
          elements.backgroundVideo.src = value;
        }
        elements.backgroundVideo.style.display = 'block';
        elements.backgroundVideo.play().catch(() => {});
      } else {
        elements.backgroundVideo.pause();
        elements.backgroundVideo.style.display = 'none';
        elements.backgroundVideo.removeAttribute('src');
      }
    }

    elements.backgroundLayer.style.background = '';
    elements.backgroundLayer.style.backgroundImage = isVideo
      ? 'none'
      : (value ? `url(${value})` : 'none');
  }

  function isVideoBackground(url) {
    if (!url) return false;
    const normalized = url.split('#')[0].split('?')[0].toLowerCase();
    return normalized.endsWith('.mp4') || normalized.startsWith('data:video/mp4');
  }

  function applyIconFrameSetting() {
    document.body.classList.toggle('icon-frame-enabled', state.iconFrameEnabled);
  }

  function applyUiOpacitySetting() {
    const raw = Number(state.uiOpacity);
    const value = Number.isFinite(raw) ? Math.min(70, Math.max(12, raw)) : 32;
    const alpha = value / 100;
    const root = document.documentElement;
    root.style.setProperty('--ui-frame-opacity', alpha.toFixed(2));
    root.style.setProperty('--ui-frame-opacity-strong', Math.min(alpha + 0.1, 0.88).toFixed(2));
    root.style.setProperty('--ui-frame-opacity-soft', Math.max(0.04, alpha * 0.42).toFixed(2));
    root.style.setProperty('--ui-frame-opacity-soft-strong', Math.max(0.08, alpha * 0.68).toFixed(2));
    root.style.setProperty('--ui-border-opacity', Math.min(0.58, Math.max(0.18, alpha * 0.95)).toFixed(2));
    if (elements.uiOpacity) elements.uiOpacity.value = String(value);
    if (elements.uiOpacityValue) elements.uiOpacityValue.textContent = `${value}%`;
    state.uiOpacity = value;
  }

  function applyUiBlurSetting() {
    const raw = Number(state.uiBlur);
    const strong = Number.isFinite(raw) ? Math.min(20, Math.max(0, raw)) : 10;
    const medium = Math.max(0, strong - 2);
    const root = document.documentElement;
    root.style.setProperty('--ui-blur-strong', `${strong}px`);
    root.style.setProperty('--ui-blur-medium', `${medium}px`);
    if (elements.uiBlur) elements.uiBlur.value = String(strong);
    if (elements.uiBlurValue) elements.uiBlurValue.textContent = `${strong}px`;
    state.uiBlur = strong;
  }

  // ===== 主题系统函数 =====

  function applyThemeMode() {
    const body = document.body;
    body.classList.remove('theme-dark', 'theme-light');

    let effectiveTheme = state.themeMode;
    if (effectiveTheme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      effectiveTheme = prefersDark ? 'dark' : 'light';
    }

    if (effectiveTheme === 'light') {
      body.classList.add('theme-light');
    }

    // 更新 tab 激活状态
    elements.themeModeTabs.forEach((tab) => {
      const mode = tab.dataset.theme;
      tab.classList.toggle('active', mode === state.themeMode);
    });
  }

  function applyAccentColor() {
    const root = document.documentElement;
    const hue = Number(state.accentHue) || 200;
    root.style.setProperty('--accent-hue', hue);

    // 更新预设选中状态
    elements.themeColorPresets.forEach((preset) => {
      const presetHue = Number(preset.dataset.hue);
      preset.classList.toggle('active', presetHue === hue);
    });
  }

  function applyParticles() {
    const body = document.body;
    body.classList.toggle('particles-enabled', state.particlesEnabled);
    if (elements.particlesEnabled) {
      elements.particlesEnabled.checked = state.particlesEnabled;
    }

    if (state.particlesEnabled) {
      initParticles();
    } else {
      stopParticles();
    }
  }

  function applyGradientFlow() {
    const body = document.body;
    body.classList.toggle('gradient-flow', state.gradientFlow);
    if (elements.gradientFlowEnabled) {
      elements.gradientFlowEnabled.checked = state.gradientFlow;
    }
  }

  function applyMinimalMode() {
    const body = document.body;
    body.classList.toggle('minimal-mode', state.minimalMode);
    if (elements.minimalModeEnabled) {
      elements.minimalModeEnabled.checked = state.minimalMode;
    }
  }

  // ===== 粒子背景系统 =====
  let particles = [];
  let particleAnimationId = null;
  let particleCtx = null;

  function initParticles() {
    if (!elements.particlesCanvas || particleAnimationId) return;

    const canvas = elements.particlesCanvas;
    particleCtx = canvas.getContext('2d');

    resizeParticlesCanvas();
    createParticles();
    animateParticles();

    window.addEventListener('resize', resizeParticlesCanvas);
  }

  function stopParticles() {
    if (particleAnimationId) {
      cancelAnimationFrame(particleAnimationId);
      particleAnimationId = null;
    }
    window.removeEventListener('resize', resizeParticlesCanvas);
  }

  function resizeParticlesCanvas() {
    if (!elements.particlesCanvas) return;
    const canvas = elements.particlesCanvas;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function createParticles() {
    particles = [];
    const count = Math.min(120, Math.floor((window.innerWidth * window.innerHeight) / 12000));

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: Math.random() * 2 + 1,
        opacity: Math.random() * 0.4 + 0.4
      });
    }
  }

  function animateParticles() {
    if (!particleCtx || !elements.particlesCanvas) return;

    const ctx = particleCtx;
    const canvas = elements.particlesCanvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 获取当前主题的 accent 颜色
    const accentHue = getComputedStyle(document.documentElement).getPropertyValue('--accent-hue').trim() || '200';

    // 绘制粒子
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

      // 粒子发光效果
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3);
      gradient.addColorStop(0, `hsla(${accentHue}, 90%, 75%, ${p.opacity})`);
      gradient.addColorStop(0.4, `hsla(${accentHue}, 80%, 65%, ${p.opacity * 0.5})`);
      gradient.addColorStop(1, `hsla(${accentHue}, 70%, 60%, 0)`);

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // 粒子核心
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${accentHue}, 100%, 85%, ${p.opacity + 0.2})`;
      ctx.fill();

      // 绘制连接线
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 150) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `hsla(${accentHue}, 70%, 70%, ${0.2 * (1 - dist / 150)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    });

    particleAnimationId = requestAnimationFrame(animateParticles);
  }

  async function fetchBingImageFromWorker() {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Background script no response')), 5000);
      chrome.runtime.sendMessage({ action: 'fetchBingImage', index: state.bingIndex }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });

    if (!result.success) {
      throw new Error(result.error || 'Unknown Bing fetch error');
    }

    state.bingIndex = result.nextIndex || ((state.bingIndex + 1) % 8);
    return result.url;
  }

  async function fetchRandomBackground() {
    elements.refreshBgBtn.classList.add('loading');
    elements.backgroundLayer.classList.add('loading');

    try {
      const imageUrl = await fetchBingImageFromWorker();
      state.background = { type: 'bing', value: imageUrl, source: 'bing' };
      saveState();
      updateBackground();
    } catch (error) {
      console.error('Failed to refresh background:', error);
    } finally {
      elements.refreshBgBtn.classList.remove('loading');
      elements.backgroundLayer.classList.remove('loading');
    }
  }

  function createIconWidget(icon) {
    const iconEl = document.createElement('div');
    iconEl.className = 'icon-widget';
    iconEl.dataset.id = icon.id;

    const iconVisual = document.createElement('div');
    iconVisual.className = 'icon-visual';

    const fallback = document.createElement('span');
    fallback.className = 'icon-fallback';
    fallback.textContent = getIconLabel(icon);
    iconVisual.appendChild(fallback);

    const iconImg = document.createElement('img');
    iconImg.className = 'icon-image';
    iconImg.alt = `${icon.name} icon`;
    iconImg.loading = 'eager';
    iconImg.referrerPolicy = 'no-referrer';

    const iconType = normalizeIconType(icon.type);
    const storedCandidates = Array.isArray(icon.iconCandidates) ? icon.iconCandidates : [];
    const fallbackCandidates = iconType === ICON_TYPE_SHORTCUT ? getFaviconCandidates(icon.url) : [];
    const manualCandidate = icon.customIconUrl ? [icon.customIconUrl] : [];
    const resolvedCandidate = icon.resolvedIconUrl ? [icon.resolvedIconUrl] : [];
    const uploadCandidate = icon.uploadedIconDataUrl ? [icon.uploadedIconDataUrl] : [];
    const useEmojiOnly = Boolean(icon.emoji) && !icon.customIconUrl && !icon.uploadedIconDataUrl;
    const autoCandidates = useEmojiOnly ? [] : [...storedCandidates, ...fallbackCandidates];
    const candidates = [...new Set([...uploadCandidate, ...manualCandidate, ...resolvedCandidate, ...autoCandidates])];

    let candidateIndex = 0;
    const setCandidateSource = () => {
      if (candidateIndex < candidates.length) {
        iconImg.src = candidates[candidateIndex];
      }
    };

    iconImg.addEventListener('load', () => {
      iconVisual.classList.add('has-image');
      cacheResolvedIcon(icon.id, candidates[candidateIndex]);
    });

    iconImg.addEventListener('error', () => {
      iconVisual.classList.remove('has-image');
      candidateIndex += 1;
      if (candidateIndex < candidates.length) {
        setCandidateSource();
      }
    });

    if (candidates.length > 0) setCandidateSource();

    iconVisual.appendChild(iconImg);

    const nameEl = document.createElement('span');
    nameEl.className = 'icon-name';
    nameEl.textContent = icon.name;

    iconEl.appendChild(iconVisual);
    iconEl.appendChild(nameEl);

    iconEl.addEventListener('click', () => openIconTarget(icon));

    iconEl.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openIconContextMenu(event, icon.id);
    });

    return iconEl;
  }

  function renderWorkspacePreview() {
    const icons = getIconsForFolder(state.currentFolderId);
    elements.workspaceIconsContainer.innerHTML = '';

    icons.slice(0, 12).forEach((icon) => {
      const chip = document.createElement('div');
      chip.className = 'icon-widget';
      chip.style.width = '86px';
      chip.style.padding = '12px 8px';
      chip.draggable = true;
      chip.dataset.id = icon.id;
      chip.appendChild(createIconWidget(icon).querySelector('.icon-visual'));
      const name = document.createElement('span');
      name.className = 'icon-name';
      name.textContent = icon.name;
      chip.appendChild(name);
      chip.addEventListener('click', () => openIconTarget(icon));
      chip.addEventListener('dragstart', (event) => {
        draggingIconId = icon.id;
        chip.classList.add('dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', icon.id);
        }
      });
      chip.addEventListener('dragend', () => {
        draggingIconId = null;
        chip.classList.remove('dragging');
        document.querySelectorAll('.folder-tab.drop-target').forEach((tab) => {
          tab.classList.remove('drop-target');
        });
      });
      chip.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (confirm(`删除图标「${icon.name}」？`)) {
          deleteIcon(icon.id);
        }
      });
      elements.workspaceIconsContainer.appendChild(chip);
    });

    elements.workspaceEmpty.classList.toggle('hidden', icons.length > 0);
  }

  function updateWorkspaceButtonLabel() {
    const folder = getFolderById(state.currentFolderId);
    const label = folder ? `抽屉：${folder.name}` : '抽屉';
    elements.workspaceBtn.title = label;
    elements.workspaceBtn.setAttribute('aria-label', label);
    if (elements.desktopFolderLabel) {
      const isHome = !folder || folder.id === HOME_FOLDER_ID;
      elements.desktopFolderLabel.textContent = folder ? folder.name : '主页';
      elements.desktopFolderLabel.style.display = isHome ? 'none' : 'block';
    }
  }

  function renderFolderTabs() {
    elements.workspaceFolderTabs.innerHTML = '';

    state.folders.forEach((folder) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `folder-tab${folder.id === state.currentFolderId ? ' active' : ''}`;
      const count = getIconsForFolder(folder.id).length;
      tab.textContent = `${folder.name} (${count})`;
      if (folder.id !== HOME_FOLDER_ID) tab.title = '右键删除抽屉';
      tab.addEventListener('click', () => {
        suppressWorkspaceAutoCloseUntil = Date.now() + 300;
        selectFolder(folder.id, true);
      });
      tab.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleRenameFolder(folder.id);
      });
      tab.addEventListener('dragover', (event) => {
        if (!draggingIconId) return;
        event.preventDefault();
        tab.classList.add('drop-target');
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('drop-target');
      });
      tab.addEventListener('drop', (event) => {
        event.preventDefault();
        tab.classList.remove('drop-target');
        const iconId = (event.dataTransfer && event.dataTransfer.getData('text/plain')) || draggingIconId;
        if (!iconId) return;
        moveIconToFolder(iconId, folder.id);
      });
      tab.addEventListener('contextmenu', (event) => {
        if (folder.id === HOME_FOLDER_ID) return;
        event.preventDefault();
        event.stopPropagation();
        handleDeleteFolder(folder.id);
      });
      elements.workspaceFolderTabs.appendChild(tab);
    });
  }

  function handleDeleteFolder(folderId) {
    const folder = getFolderById(folderId);
    if (!folder || folder.id === HOME_FOLDER_ID) return;

    const iconsInFolder = getIconsForFolder(folderId);
    const shouldDelete = confirm(`删除抽屉「${folder.name}」？`);
    if (!shouldDelete) return;

    if (iconsInFolder.length > 0) {
      const moveToDefault = confirm(
        `这个抽屉包含 ${iconsInFolder.length} 个图标。\n\n选择“确定”：移动到默认（主页）\n选择“取消”：连同图标一并删除`
      );

      if (moveToDefault) {
        state.icons = state.icons.map((icon) => (
          icon.folderId === folderId ? { ...icon, folderId: HOME_FOLDER_ID } : icon
        ));
      } else {
        state.icons = state.icons.filter((icon) => icon.folderId !== folderId);
      }
    }

    state.folders = state.folders.filter((item) => item.id !== folderId);
    if (state.currentFolderId === folderId) state.currentFolderId = HOME_FOLDER_ID;

    saveState();
    updateWorkspaceButtonLabel();
    renderFolderTabs();
    renderWorkspacePreview();
    renderIconsForCurrentFolder(true);
  }

  function handleRenameFolder(folderId) {
    const folder = getFolderById(folderId);
    if (!folder) return;

    const nextName = prompt('输入新的文件夹名称', folder.name || '');
    if (!nextName) return;

    const trimmed = nextName.trim();
    if (!trimmed || trimmed === folder.name) return;

    folder.name = trimmed;
    saveState();
    updateWorkspaceButtonLabel();
    renderFolderTabs();
    renderWorkspacePreview();
  }

  function moveIconToFolder(iconId, targetFolderId) {
    if (!getFolderById(targetFolderId)) return;
    const icon = state.icons.find((item) => item.id === iconId);
    if (!icon || icon.folderId === targetFolderId) return;
    icon.folderId = targetFolderId;
    saveState();
    renderFolderTabs();
    renderWorkspacePreview();
    renderIconsForCurrentFolder(true);
  }

  function renderIconsForCurrentFolder(animated = false) {
    const nextIcons = getIconsForFolder(state.currentFolderId);
    const container = elements.iconsContainer;
    const oldNodes = Array.from(container.querySelectorAll('.icon-widget'));
    const token = ++iconSwitchToken;

    const mountNewIcons = () => {
      if (token !== iconSwitchToken) return;
      container.innerHTML = '';
      nextIcons.forEach((icon, idx) => {
        const node = createIconWidget(icon);
        node.classList.add('entering');
        node.style.transitionDelay = `${Math.min(idx * 22, 220)}ms`;
        container.appendChild(node);
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.querySelectorAll('.icon-widget.entering').forEach((node) => {
            node.classList.remove('entering');
            node.style.transitionDelay = '';
          });
        });
      });
    };

    if (!animated || oldNodes.length === 0) {
      mountNewIcons();
      return;
    }

    oldNodes.forEach((node, idx) => {
      node.classList.add('leaving');
      node.style.transitionDelay = `${Math.min(idx * 18, 180)}ms`;
    });

    setTimeout(mountNewIcons, 220);
  }

  function selectFolder(folderId, animated = false) {
    if (!getFolderById(folderId)) return;
    state.currentFolderId = folderId;
    saveState();
    updateWorkspaceButtonLabel();
    renderFolderTabs();
    renderWorkspacePreview();
    renderIconsForCurrentFolder(animated);
  }

  function openWorkspaceDrawer() {
    elements.workspaceDrawer.classList.remove('hidden');
    updateWorkspaceButtonLabel();
    renderFolderTabs();
    renderWorkspacePreview();
  }

  function closeWorkspaceDrawer() {
    elements.workspaceDrawer.classList.add('hidden');
  }

  function toggleWorkspaceDrawer() {
    const isHidden = elements.workspaceDrawer.classList.contains('hidden');
    if (isHidden) openWorkspaceDrawer();
    else closeWorkspaceDrawer();
  }

  function clearWorkspaceEdgeTimer() {
    if (!workspaceEdgeOpenTimer) return;
    clearTimeout(workspaceEdgeOpenTimer);
    workspaceEdgeOpenTimer = null;
  }

  function tryOpenWorkspaceFromEdge() {
    if (!elements.workspaceDrawer.classList.contains('hidden')) return;
    if (workspaceEdgeOpenTimer) return;
    workspaceEdgeOpenTimer = setTimeout(() => {
      workspaceEdgeOpenTimer = null;
      if (elements.workspaceDrawer.classList.contains('hidden')) {
        openWorkspaceDrawer();
      }
    }, 120);
  }

  function addIcon(payload) {
    const iconType = normalizeIconType(payload.type);
    const isSsh = iconType === ICON_TYPE_SSH;
    const isTool = iconType === ICON_TYPE_TOOL;
    const customIconUrl = payload.customIconUrl || '';
    const emoji = payload.emoji || '';
    const uploadedIconDataUrl = payload.uploadedIconDataUrl || '';
    const folderId = getFolderById(payload.folderId) ? payload.folderId : HOME_FOLDER_ID;
    const safePort = Number.isInteger(payload.sshPort) ? payload.sshPort : 22;
    const safeSocksPort = Number.isInteger(payload.sshSocksPort) ? payload.sshSocksPort : 1080;

    const newIcon = {
      id: generateId(),
      name: payload.name,
      type: iconType,
      url: isSsh ? '' : (isTool ? '' : payload.url),
      sshGatewayUrl: isSsh ? (payload.sshGatewayUrl || '') : '',
      sshHost: isSsh ? (payload.sshHost || '') : '',
      sshPort: isSsh ? safePort : 22,
      sshUsername: isSsh ? (payload.sshUsername || '') : '',
      sshPassword: isSsh ? (payload.sshPassword || '') : '',
      sshSocksHost: isSsh ? normalizeOptionalText(payload.sshSocksHost) : '',
      sshSocksPort: isSsh ? safeSocksPort : 1080,
      sshSocksUsername: isSsh ? normalizeOptionalText(payload.sshSocksUsername) : '',
      sshSocksPassword: isSsh ? (payload.sshSocksPassword || '') : '',
      folderId,
      customIconUrl: isSsh ? '' : customIconUrl,
      emoji: isSsh ? '>_' : (isTool ? '{ }' : emoji),
      uploadedIconDataUrl: isSsh ? '' : uploadedIconDataUrl,
      resolvedIconUrl: isSsh ? '' : (uploadedIconDataUrl || customIconUrl),
      iconCandidates: isSsh ? [] : getFaviconCandidates(payload.url),
      toolSubtype: isTool ? (payload.toolSubtype || '') : ''
    };

    state.icons.push(newIcon);
    saveState();
    renderFolderTabs();
    renderWorkspacePreview();
    renderIconsForCurrentFolder();
  }

  function updateIcon(iconId, payload) {
    const icon = state.icons.find((item) => item.id === iconId);
    if (!icon) return;
    const iconType = normalizeIconType(payload.type);
    const isSsh = iconType === ICON_TYPE_SSH;
    const isTool = iconType === ICON_TYPE_TOOL;
    const safePort = Number.isInteger(payload.sshPort) ? payload.sshPort : 22;
    const safeSocksPort = Number.isInteger(payload.sshSocksPort) ? payload.sshSocksPort : 1080;

    icon.name = payload.name;
    icon.type = iconType;
    icon.url = isSsh ? '' : (isTool ? '' : payload.url);
    icon.sshGatewayUrl = isSsh ? (payload.sshGatewayUrl || '') : '';
    icon.sshHost = isSsh ? (payload.sshHost || '') : '';
    icon.sshPort = isSsh ? safePort : 22;
    icon.sshUsername = isSsh ? (payload.sshUsername || '') : '';
    icon.sshPassword = isSsh ? (payload.sshPassword || '') : '';
    icon.sshSocksHost = isSsh ? normalizeOptionalText(payload.sshSocksHost) : '';
    icon.sshSocksPort = isSsh ? safeSocksPort : 1080;
    icon.sshSocksUsername = isSsh ? normalizeOptionalText(payload.sshSocksUsername) : '';
    icon.sshSocksPassword = isSsh ? (payload.sshSocksPassword || '') : '';
    icon.folderId = getFolderById(payload.folderId) ? payload.folderId : HOME_FOLDER_ID;
    icon.customIconUrl = isSsh ? '' : payload.customIconUrl;
    icon.emoji = isSsh ? '>_' : (isTool ? '{ }' : payload.emoji);
    icon.uploadedIconDataUrl = isSsh ? '' : payload.uploadedIconDataUrl;
    icon.iconCandidates = isSsh ? [] : getFaviconCandidates(payload.url);
    icon.toolSubtype = isTool ? (payload.toolSubtype || '') : '';

    if (isSsh) {
      icon.resolvedIconUrl = '';
    } else if (payload.uploadedIconDataUrl) {
      icon.resolvedIconUrl = payload.uploadedIconDataUrl;
    } else if (payload.customIconUrl) {
      icon.resolvedIconUrl = payload.customIconUrl;
    } else if (payload.emoji) {
      icon.resolvedIconUrl = '';
    } else if (!icon.iconCandidates.includes(icon.resolvedIconUrl || '')) {
      icon.resolvedIconUrl = '';
    }

    saveState();
    renderFolderTabs();
    renderWorkspacePreview();
    renderIconsForCurrentFolder();
  }

  function deleteIcon(iconId) {
    state.icons = state.icons.filter((icon) => icon.id !== iconId);
    saveState();
    renderFolderTabs();
    renderWorkspacePreview();
    renderIconsForCurrentFolder();
  }

  function saveState() {
    chrome.storage.local.set({
      icons: state.icons,
      folders: state.folders,
      currentFolderId: state.currentFolderId,
      searchEngine: state.searchEngine,
      todos: state.todos,
      todoPanelOpen: state.todoPanelOpen,
      background: state.background,
      clockFormat: state.clockFormat,
      showSeconds: state.showSeconds,
      uiOpacity: state.uiOpacity,
      uiBlur: state.uiBlur,
      iconFrameEnabled: state.iconFrameEnabled,
      timezone: state.timezone,
      bingIndex: state.bingIndex,
      themeMode: state.themeMode,
      accentHue: state.accentHue,
      particlesEnabled: state.particlesEnabled,
      gradientFlow: state.gradientFlow,
      minimalMode: state.minimalMode
    });
  }

  function loadState() {
    chrome.storage.local.get(
      ['icons', 'folders', 'currentFolderId', 'searchEngine', 'todos', 'todoPanelOpen', 'background', 'clockFormat', 'showSeconds', 'uiOpacity', 'uiBlur', 'iconFrameEnabled', 'timezone', 'bingIndex', 'themeMode', 'accentHue', 'particlesEnabled', 'gradientFlow', 'minimalMode'],
      (result) => {
        state.folders = ensureFolders(result.folders).filter(
          (folder) => !LEGACY_PRESET_FOLDER_IDS.has(folder.id)
        );
        if (!state.folders.some((folder) => folder.id === HOME_FOLDER_ID)) {
          state.folders.unshift({ id: HOME_FOLDER_ID, name: '主页' });
        }
        const validFolderIds = new Set(state.folders.map((folder) => folder.id));

        state.icons = Array.isArray(result.icons)
          ? result.icons.map((icon) => ({
            ...icon,
            type: normalizeIconType(icon.type),
            folderId: validFolderIds.has(icon.folderId) ? icon.folderId : HOME_FOLDER_ID,
            customIconUrl: icon.customIconUrl || '',
            emoji: icon.emoji || '',
            uploadedIconDataUrl: icon.uploadedIconDataUrl || '',
            resolvedIconUrl: icon.resolvedIconUrl || '',
            sshGatewayUrl: icon.sshGatewayUrl || '',
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

        if (result.background) state.background = result.background;
        if (result.searchEngine) state.searchEngine = result.searchEngine;
        if (Array.isArray(result.todos)) {
          state.todos = result.todos
            .filter((item) => item && item.id && typeof item.text === 'string')
            .map((item) => ({ id: item.id, text: item.text, done: Boolean(item.done) }));
        }
        if (result.todoPanelOpen !== undefined) {
          state.todoPanelOpen = Boolean(result.todoPanelOpen);
        }
        if (result.clockFormat) state.clockFormat = result.clockFormat;
        if (result.showSeconds !== undefined) state.showSeconds = result.showSeconds;
        if (result.uiOpacity !== undefined) state.uiOpacity = Number(result.uiOpacity);
        if (result.uiBlur !== undefined) state.uiBlur = Number(result.uiBlur);
        if (result.iconFrameEnabled !== undefined) state.iconFrameEnabled = Boolean(result.iconFrameEnabled);
        if (result.timezone) state.timezone = result.timezone;
        if (result.bingIndex !== undefined) state.bingIndex = result.bingIndex;
        if (result.themeMode) state.themeMode = result.themeMode;
        if (result.accentHue !== undefined) state.accentHue = Number(result.accentHue);
        if (result.particlesEnabled !== undefined) state.particlesEnabled = Boolean(result.particlesEnabled);
        if (result.gradientFlow !== undefined) state.gradientFlow = Boolean(result.gradientFlow);
        if (result.minimalMode !== undefined) state.minimalMode = Boolean(result.minimalMode);

        const requestedFolderId = result.currentFolderId || HOME_FOLDER_ID;
        state.currentFolderId = getFolderById(requestedFolderId) ? requestedFolderId : HOME_FOLDER_ID;

        const tz = COMMON_TIMEZONES.find((item) => item.id === state.timezone);
        elements.timezoneLabel.textContent = tz ? `${tz.name} (${formatTimezoneOffset(tz.offset)})` : state.timezone;

        updateBackground();
        updateClock();
        renderTimezoneList();
        initCalendar();

        elements.timeFormat.value = state.clockFormat;
        elements.showSeconds.checked = state.showSeconds;
        applyUiOpacitySetting();
        applyUiBlurSetting();
        elements.iconFrameEnabled.checked = state.iconFrameEnabled;
        applyIconFrameSetting();
        applyThemeMode();
        applyAccentColor();
        applyParticles();
        applyGradientFlow();
        applyMinimalMode();
        renderSearchEngineButtons();

        updatePresetSelection();
        updateBgTabs();
        updateWorkspaceButtonLabel();
        renderFolderTabs();
        renderWorkspacePreview();
        renderIconsForCurrentFolder(false);
        renderTodos();
        setTodoPanelOpen(state.todoPanelOpen);

        if (!state.background.value && state.background.type === 'bing') {
          fetchRandomBackground();
        }
      }
    );
  }

  function updatePresetSelection() {
    const allPresets = document.querySelectorAll('#background-presets .preset-item, #image-presets .preset-item');
    allPresets.forEach((preset) => {
      const bgType = preset.dataset.bg || '';
      preset.classList.toggle(
        'active',
        bgType === state.background.type && preset.dataset.value === state.background.value
      );
    });
  }

  function updateBgTabs() {
    elements.bgTypeTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.type === state.background.type);
    });
    elements.bingSection.classList.toggle('active', state.background.type === 'bing');
    elements.gradientSection.classList.toggle('active', state.background.type === 'gradient');
    elements.imageSection.classList.toggle('active', state.background.type === 'image');
  }

  function openAddIconModal() {
    editingIconId = null;
    pendingIconUploadDataUrl = '';

    elements.iconType.value = ICON_TYPE_SHORTCUT;
    elements.saveBtn.textContent = '保存';
    elements.addIconModal.classList.remove('hidden');

    elements.iconName.value = '';
    elements.iconUrl.value = '';
    elements.iconCustomUrl.value = '';
    elements.iconFile.value = '';
    elements.iconUploadStatus.textContent = '支持 PNG / JPG / SVG / WebP。';
    elements.sshGatewayUrl.value = '';
    elements.sshHost.value = '';
    elements.sshPort.value = '22';
    elements.sshUsername.value = '';
    elements.sshPassword.value = '';
    elements.sshSocksHost.value = '';
    elements.sshSocksPort.value = '';
    elements.sshSocksUsername.value = '';
    elements.sshSocksPassword.value = '';
    updateIconModalTypeView();

    elements.iconName.focus();
  }

  function openEditIconModal(iconId) {
    const icon = state.icons.find((item) => item.id === iconId);
    if (!icon) return;

    editingIconId = iconId;
    pendingIconUploadDataUrl = '';

    const iconType = normalizeIconType(icon.type);
    elements.iconType.value = iconType;
    elements.saveBtn.textContent = '更新';
    elements.addIconModal.classList.remove('hidden');
    updateIconModalTypeView();

    elements.iconName.value = icon.name || '';
    elements.iconUrl.value = icon.url || '';
    elements.iconCustomUrl.value = icon.customIconUrl || '';
    elements.iconFile.value = '';
    elements.sshGatewayUrl.value = icon.sshGatewayUrl || '';
    elements.sshHost.value = icon.sshHost || '';
    elements.sshPort.value = String(icon.sshPort || 22);
    elements.sshUsername.value = icon.sshUsername || '';
    elements.sshPassword.value = icon.sshPassword || '';
    elements.sshSocksHost.value = icon.sshSocksHost || '';
    elements.sshSocksPort.value = icon.sshSocksHost ? String(icon.sshSocksPort || 1080) : '';
    elements.sshSocksUsername.value = icon.sshSocksUsername || '';
    elements.sshSocksPassword.value = icon.sshSocksPassword || '';
    elements.iconUploadStatus.textContent = icon.uploadedIconDataUrl
      ? '已保存本地图标，可重新上传覆盖。'
      : '支持 PNG / JPG / SVG / WebP。';
    elements.toolSubtype.value = icon.toolSubtype || '';
    elements.iconName.focus();
  }

  function closeAddIconModal() {
    editingIconId = null;
    pendingIconUploadDataUrl = '';
    elements.addIconModal.classList.add('hidden');
  }

  async function handleSaveIcon() {
    const iconType = normalizeIconType(elements.iconType.value);
    const isSsh = iconType === ICON_TYPE_SSH;
    const isTool = iconType === ICON_TYPE_TOOL;
    const name = elements.iconName.value.trim();
    const rawUrl = elements.iconUrl.value.trim();
    const rawCustomUrl = elements.iconCustomUrl.value.trim();
    const rawGatewayUrl = elements.sshGatewayUrl.value.trim();
    const rawSshHost = elements.sshHost.value.trim();
    const rawSshPort = elements.sshPort.value.trim();
    const rawSshUsername = elements.sshUsername.value.trim();
    const rawSshPassword = elements.sshPassword.value;
    const rawSshSocksHost = elements.sshSocksHost.value.trim();
    const rawSshSocksPort = elements.sshSocksPort.value.trim();
    const rawSshSocksUsername = elements.sshSocksUsername.value.trim();
    const rawSshSocksPassword = elements.sshSocksPassword.value;
    const toolSubtype = elements.toolSubtype.value;
    const folderId = state.currentFolderId || HOME_FOLDER_ID;

    if (!name) {
      elements.iconName.focus();
      return;
    }

    let url;
    let customIconUrl = '';
    let sshGatewayUrl = '';
    let sshHost = '';
    let sshPort = 22;
    let sshUsername = '';
    let sshPassword = '';
    let sshSocksHost = '';
    let sshSocksPort = 1080;
    let sshSocksUsername = '';
    let sshSocksPassword = '';

    try {
      if (isTool) {
        // tool 类型不需要额外验证
      } else if (isSsh) {
        if (!rawGatewayUrl) {
          elements.sshGatewayUrl.focus();
          return;
        }
        if (!rawSshHost) {
          elements.sshHost.focus();
          return;
        }
        if (!rawSshUsername) {
          elements.sshUsername.focus();
          return;
        }
        sshGatewayUrl = normalizeSshGatewayUrl(rawGatewayUrl);
        sshHost = rawSshHost;
        sshUsername = rawSshUsername;
        sshPassword = rawSshPassword;
        sshPort = rawSshPort ? Number.parseInt(rawSshPort, 10) : 22;
        if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
          throw new Error('SSH 端口无效');
        }
        sshSocksHost = normalizeOptionalText(rawSshSocksHost);
        sshSocksUsername = normalizeOptionalText(rawSshSocksUsername);
        sshSocksPassword = rawSshSocksPassword;
        if (sshSocksHost) {
          sshSocksPort = rawSshSocksPort ? Number.parseInt(rawSshSocksPort, 10) : 1080;
          if (!Number.isInteger(sshSocksPort) || sshSocksPort < 1 || sshSocksPort > 65535) {
            throw new Error('SOCKS5 端口无效');
          }
        } else {
          sshSocksPort = 1080;
        }
      } else {
        if (!rawUrl) {
          elements.iconUrl.focus();
          return;
        }
        url = normalizeUrl(rawUrl);
        customIconUrl = normalizeOptionalUrl(rawCustomUrl);
      }
    } catch (error) {
      if (isTool) {
        // tool 类型不需要验证
      } else {
        alert(isSsh ? '请输入有效的 SSH 配置。' : '请输入有效的网址。');
        if (isSsh) elements.sshGatewayUrl.focus();
        else if (rawCustomUrl) elements.iconCustomUrl.focus();
        else elements.iconUrl.focus();
        return;
      }
    }

    if (editingIconId) {
      const current = state.icons.find((item) => item.id === editingIconId);
      updateIcon(editingIconId, {
        name,
        url,
        type: iconType,
        sshGatewayUrl,
        sshHost,
        sshPort,
        sshUsername,
        sshPassword,
        sshSocksHost,
        sshSocksPort,
        sshSocksUsername,
        sshSocksPassword,
        folderId: current?.folderId || state.currentFolderId || HOME_FOLDER_ID,
        customIconUrl,
        emoji: '',
        uploadedIconDataUrl: isSsh ? '' : (pendingIconUploadDataUrl || (current?.uploadedIconDataUrl || '')),
        toolSubtype: isTool ? toolSubtype : ''
      });
    } else {
      addIcon({
        name,
        url,
        type: iconType,
        sshGatewayUrl,
        sshHost,
        sshPort,
        sshUsername,
        sshPassword,
        sshSocksHost,
        sshSocksPort,
        sshSocksUsername,
        sshSocksPassword,
        folderId,
        customIconUrl,
        emoji: '',
        uploadedIconDataUrl: isSsh ? '' : pendingIconUploadDataUrl,
        toolSubtype: isTool ? toolSubtype : ''
      });
    }

    closeAddIconModal();
  }

  async function handleIconFileChange() {
    const [file] = elements.iconFile.files || [];
    if (!file) {
      pendingIconUploadDataUrl = '';
      elements.iconUploadStatus.textContent = '支持 PNG / JPG / SVG / WebP。';
      return;
    }

    try {
      pendingIconUploadDataUrl = await readFileAsDataUrl(file);
      elements.iconUploadStatus.textContent = `已选择：${file.name}`;
    } catch (error) {
      pendingIconUploadDataUrl = '';
      elements.iconUploadStatus.textContent = '读取失败，请重新选择。';
    }
  }

  function hideIconContextMenu() {
    contextMenuIconId = null;
    elements.iconContextMenu.classList.add('hidden');
  }

  function openIconContextMenu(event, iconId) {
    contextMenuIconId = iconId;
    elements.iconContextMenu.style.left = `${event.clientX}px`;
    elements.iconContextMenu.style.top = `${event.clientY}px`;
    elements.iconContextMenu.classList.remove('hidden');
  }

  function openSettings() {
    elements.settingsPanel.classList.remove('hidden');
  }

  function closeSettingsPanel() {
    elements.settingsPanel.classList.add('hidden');
  }

  function handleBgTabClick(event) {
    const tab = event.target.closest('.tab-btn');
    if (!tab) return;

    const type = tab.dataset.type;
    const previousType = state.background.type;
    state.background.type = type;

    if (type === 'bing') {
      if (!state.background.value || previousType !== 'bing') fetchRandomBackground();
      else updateBackground();
    } else if (type === 'gradient') {
      state.background.value = DEFAULT_GRADIENT;
      state.background.source = 'gradient';
      updateBackground();
    }

    saveState();
    updateBgTabs();
    updatePresetSelection();
  }

  function handlePresetClick(event) {
    const preset = event.target.closest('.preset-item');
    if (!preset) return;
    const bgType = preset.dataset.bg || 'gradient';
    state.background = {
      type: bgType === 'gradient' ? 'gradient' : 'image',
      value: preset.dataset.value,
      source: bgType === 'gradient' ? 'gradient' : 'preset-image'
    };
    saveState();
    updateBackground();
    updatePresetSelection();
    updateBgTabs();
  }

  function handleCustomBgApply() {
    const raw = elements.customBgUrl.value.trim();
    if (!raw) return;

    let url;
    try {
      url = normalizeUrl(raw);
    } catch (error) {
      alert('请输入有效的图片网址。');
      elements.customBgUrl.focus();
      return;
    }

    state.background = { type: 'image', value: url, source: 'custom' };
    saveState();
    updateBackground();
    updateBgTabs();
    updatePresetSelection();
  }

  async function handleCustomBgFileApply() {
    const [file] = elements.customBgFile.files || [];
    if (!file) {
      elements.customBgFile.click();
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl) return;
      state.background = { type: 'image', value: dataUrl, source: 'local-upload' };
      saveState();
      updateBackground();
      updateBgTabs();
      updatePresetSelection();
    } catch (error) {
      alert('读取本地图片失败，请重试。');
    }
  }

  function handleTimeFormatChange() {
    state.clockFormat = elements.timeFormat.value;
    saveState();
    updateClock();
  }

  function handleShowSecondsChange() {
    state.showSeconds = elements.showSeconds.checked;
    saveState();
    updateClock();
  }

  function handleUiOpacityChange() {
    state.uiOpacity = Number(elements.uiOpacity.value || 32);
    applyUiOpacitySetting();
    saveState();
  }

  function handleUiBlurChange() {
    state.uiBlur = Number(elements.uiBlur.value || 10);
    applyUiBlurSetting();
    saveState();
  }

  function handleIconFrameChange() {
    state.iconFrameEnabled = elements.iconFrameEnabled.checked;
    applyIconFrameSetting();
    saveState();
  }

  // ===== 主题事件处理函数 =====

  function handleThemeModeChange(mode) {
    state.themeMode = mode;
    applyThemeMode();
    saveState();
  }

  function handleAccentColorChange(hue) {
    state.accentHue = Number(hue);
    applyAccentColor();
    saveState();
  }

  function handleParticlesChange() {
    state.particlesEnabled = elements.particlesEnabled.checked;
    applyParticles();
    saveState();
  }

  function handleGradientFlowChange() {
    state.gradientFlow = elements.gradientFlowEnabled.checked;
    applyGradientFlow();
    saveState();
  }

  function handleMinimalModeChange() {
    state.minimalMode = elements.minimalModeEnabled.checked;
    applyMinimalMode();
    saveState();
  }

  function formatLunarKey(date) {
    return new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' }).format(date);
  }

  function getQingMingDay(year) {
    const y = year % 100;
    return Math.floor(y * 0.2422 + 4.81) - Math.floor((y - 1) / 4);
  }

  function getSolarTermMap(year, month) {
    const termMap = {};
    const y = year % 100;
    const indices = [month * 2, month * 2 + 1];
    indices.forEach((idx) => {
      const day = Math.floor(y * 0.2422 + SOLAR_TERM_C[idx]) - Math.floor((y - 1) / 4);
      termMap[day] = SOLAR_TERM_NAMES[idx];
    });
    return termMap;
  }

  function getHolidayLabel(date, solarTerm) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const solarKey = `${month}-${day}`;
    if (SOLAR_FESTIVALS[solarKey]) return SOLAR_FESTIVALS[solarKey];
    if (month === 4 && day === getQingMingDay(date.getFullYear())) return '清明节';

    const lunarKey = formatLunarKey(date);
    if (LUNAR_FESTIVALS[lunarKey]) return LUNAR_FESTIVALS[lunarKey];
    if (solarTerm === '清明') return '清明节';
    return '';
  }

  function getSolarTermForDate(date) {
    const terms = getSolarTermMap(date.getFullYear(), date.getMonth());
    return terms[date.getDate()] || '';
  }

  function annotateCalendarDay(dayElem, dateObj) {
    const solarTerm = getSolarTermForDate(dateObj);
    const holiday = getHolidayLabel(dateObj, solarTerm);
    const metaText = holiday || solarTerm || '';
    if (!metaText) return;

    const tag = document.createElement('span');
    tag.className = 'fp-meta';
    tag.textContent = metaText;
    dayElem.appendChild(tag);

    if (holiday) dayElem.classList.add('has-holiday');
    else dayElem.classList.add('has-solar-term');
  }

  function initCalendar() {
    if (calendarPicker || typeof flatpickr === 'undefined') return;

    if (flatpickr.l10ns && flatpickr.l10ns.zh) {
      flatpickr.localize(flatpickr.l10ns.zh);
    }

    calendarPicker = flatpickr(elements.calendarInput, {
      inline: true,
      clickOpens: false,
      defaultDate: new Date(),
      locale: 'zh',
      onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
        const dateObj = dayElem.dateObj;
        if (dateObj) annotateCalendarDay(dayElem, dateObj);
      }
    });
  }

  function toggleCalendar(forceOpen) {
    const open = typeof forceOpen === 'boolean'
      ? forceOpen
      : elements.calendarPopover.classList.contains('hidden');

    elements.calendarPopover.classList.toggle('hidden', !open);
    if (open) {
      initCalendar();
      if (calendarPicker) {
        calendarPicker.jumpToDate(new Date(), false);
        calendarPicker.redraw();
      }
    }
  }

  function handleAddFolder() {
    const name = prompt('输入文件夹名称（例如：阅读 / 学习）');
    if (!name) return;

    const trimmed = name.trim();
    if (!trimmed) return;

    const newFolder = { id: `folder-${generateId()}`, name: trimmed };
    state.folders.push(newFolder);
    saveState();
    renderFolderTabs();
  }

  document.addEventListener('contextmenu', (event) => {
    if (
      !event.target.closest('.icon-widget')
      && !event.target.closest('.modal')
      && !event.target.closest('.icon-context-menu')
      && !event.target.closest('.settings-panel')
      && !event.target.closest('.timezone-selector')
      && !event.target.closest('.calendar-popover')
      && !event.target.closest('.workspace-drawer')
    ) {
      event.preventDefault();
      hideIconContextMenu();
      openAddIconModal();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.icon-context-menu')) hideIconContextMenu();

    if (
      Date.now() >= suppressWorkspaceAutoCloseUntil
      && !event.target.closest('#workspace-drawer')
      && !event.target.closest('#workspace-btn')
    ) {
      closeWorkspaceDrawer();
    }

    if (!event.target.closest('#timezone-selector') && !event.target.closest('#timezone-btn')) {
      toggleTimezoneSelector(false);
    }

    if (!event.target.closest('#calendar-popover') && !event.target.closest('#date')) {
      toggleCalendar(false);
    }
  });

  document.addEventListener('mousemove', (event) => {
    const blockingLayerOpen = !elements.settingsPanel.classList.contains('hidden')
      || !elements.addIconModal.classList.contains('hidden');
    if (blockingLayerOpen) {
      clearWorkspaceEdgeTimer();
      return;
    }

    if (event.clientX <= 6) {
      tryOpenWorkspaceFromEdge();
      return;
    }
    clearWorkspaceEdgeTimer();
  });

  elements.timezoneBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleTimezoneSelector();
  });

  elements.date.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCalendar();
  });

  elements.workspaceBtn.addEventListener('click', toggleWorkspaceDrawer);
  elements.addFolderBtn.addEventListener('click', handleAddFolder);
  elements.todoToggleBtn.addEventListener('click', toggleTodoPanel);
  elements.todoCollapseBtn.addEventListener('click', closeTodoPanel);

  elements.editIconBtn.addEventListener('click', () => {
    if (!contextMenuIconId) return;
    const currentId = contextMenuIconId;
    hideIconContextMenu();
    openEditIconModal(currentId);
  });

  elements.deleteIconBtn.addEventListener('click', () => {
    if (!contextMenuIconId) return;
    const icon = state.icons.find((item) => item.id === contextMenuIconId);
    const currentId = contextMenuIconId;
    hideIconContextMenu();
    if (icon && confirm(`删除图标「${icon.name}」？`)) {
      deleteIcon(currentId);
    }
  });

  elements.refreshBgBtn.addEventListener('click', fetchRandomBackground);
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.closeSettings.addEventListener('click', closeSettingsPanel);
  elements.cancelBtn.addEventListener('click', closeAddIconModal);
  elements.saveBtn.addEventListener('click', handleSaveIcon);
  elements.iconType.addEventListener('change', updateIconModalTypeView);
  elements.iconFile.addEventListener('change', handleIconFileChange);
  elements.applyBgBtn.addEventListener('click', handleCustomBgApply);
  elements.applyBgFileBtn.addEventListener('click', handleCustomBgFileApply);
  elements.backgroundPresets.addEventListener('click', handlePresetClick);
  elements.imagePresets.addEventListener('click', handlePresetClick);
  elements.bgTypeTabs.forEach((tab) => tab.addEventListener('click', handleBgTabClick));
  elements.timeFormat.addEventListener('change', handleTimeFormatChange);
  elements.showSeconds.addEventListener('change', handleShowSecondsChange);
  elements.uiOpacity.addEventListener('input', handleUiOpacityChange);
  elements.uiOpacity.addEventListener('change', handleUiOpacityChange);
  elements.uiBlur.addEventListener('input', handleUiBlurChange);
  elements.uiBlur.addEventListener('change', handleUiBlurChange);
  elements.iconFrameEnabled.addEventListener('change', handleIconFrameChange);

  // 主题相关事件监听
  elements.themeModeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      handleThemeModeChange(tab.dataset.theme);
    });
  });

  elements.themeColorPresets.forEach((preset) => {
    preset.addEventListener('click', () => {
      handleAccentColorChange(preset.dataset.hue);
    });
  });

  elements.particlesEnabled.addEventListener('change', handleParticlesChange);
  elements.gradientFlowEnabled.addEventListener('change', handleGradientFlowChange);
  elements.minimalModeEnabled.addEventListener('change', handleMinimalModeChange);

  // 双击时钟切换极简模式
  const clockWidget = document.getElementById('clock-widget');
  if (clockWidget) {
    clockWidget.addEventListener('dblclick', () => {
      state.minimalMode = !state.minimalMode;
      applyMinimalMode();
      saveState();
      if (elements.minimalModeEnabled) {
        elements.minimalModeEnabled.checked = state.minimalMode;
      }
    });
  }

  // 监听系统主题变化（自动模式）
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.themeMode === 'auto') {
        applyThemeMode();
      }
    });
  }

  elements.backupDownloadBtn.addEventListener('click', handleDownloadBackup);
  elements.backupImportBtn.addEventListener('click', handleChooseImportFile);
  elements.backupImportFile.addEventListener('change', handleImportBackupFile);
  elements.backupSaveSnapshotBtn.addEventListener('click', handleSaveSnapshot);
  elements.backupRestoreSnapshotBtn.addEventListener('click', handleRestoreLatestSnapshot);
  elements.searchEngineButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.searchEngine = btn.dataset.engine || 'google';
      saveState();
      renderSearchEngineButtons();
      elements.searchInput.focus();
    });
  });
  elements.todoAddBtn.addEventListener('click', handleAddTodo);

  elements.iconUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });

  elements.iconCustomUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshGatewayUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshHost.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshPort.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshUsername.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshPassword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshSocksHost.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshSocksPort.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshSocksUsername.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });
  elements.sshSocksPassword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  });

  elements.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSearch();
  });

  elements.todoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleAddTodo();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'openAddIconModal') {
      openAddIconModal();
    } else if (message.action === 'deleteIcon') {
      deleteIcon(message.iconId);
    }
  });

  loadState();
  fetchWeather();
  weatherTimerId = setInterval(fetchWeather, 30 * 60 * 1000);
  updateClock();
  clockTimerId = setInterval(updateClock, 1000);
  window.addEventListener('beforeunload', cleanupRuntimeResources);
})();
