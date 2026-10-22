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
  const DEFAULT_BACKGROUND = { type: 'bing', value: '', source: '' };
  const PRESET_IMAGE_BACKGROUNDS = [
    'assets/default_background/default.webp',
    'assets/default_background/bg-mountain-dawn.jpg',
    'assets/default_background/bg-forest-golden.jpg',
    'assets/default_background/bg-ocean-night.jpg'
  ];
  const PRESET_IMAGE_BACKGROUND_SET = new Set(PRESET_IMAGE_BACKGROUNDS);
  const LEGACY_PRESET_IMAGE_MAP = {
    'assets/default_background/pexels-pixabay-40896.jpg': 'assets/default_background/bg-forest-golden.jpg',
    'assets/default_background/pexels-elina-sazonova-4275497.jpg': 'assets/default_background/bg-mountain-dawn.jpg',
    'assets/default_background/pexels-souvenirpixels-417074.jpg': 'assets/default_background/bg-mountain-dawn.jpg'
  };

  function bundledBackgroundPath(value) {
    if (typeof value !== 'string' || !value) return '';
    if (/^(data:|https?:|blob:)/i.test(value)) return '';
    const cleaned = value.split(/[?#]/)[0].replace(/\\/g, '/');
    const marker = 'assets/default_background/';
    const idx = cleaned.indexOf(marker);
    if (idx !== -1) return cleaned.slice(idx);
    const file = cleaned.split('/').pop() || '';
    if (!file) return '';
    const candidate = marker + file;
    if (PRESET_IMAGE_BACKGROUND_SET.has(candidate) || LEGACY_PRESET_IMAGE_MAP[candidate]) {
      return candidate;
    }
    return '';
  }

  function migrateBackground(background) {
    const bg = background && typeof background === 'object'
      ? {
        ...background,
        type: background.type || DEFAULT_BACKGROUND.type,
        value: typeof background.value === 'string' ? background.value : '',
        source: background.source || ''
      }
      : { ...DEFAULT_BACKGROUND };

    if (bg.type !== 'image') return bg;

    const bundled = bundledBackgroundPath(bg.value);
    if (!bundled) return bg;

    if (PRESET_IMAGE_BACKGROUND_SET.has(bundled)) {
      if (bg.value === bundled) return bg;
      return { type: 'image', value: bundled, source: bg.source || 'preset-image' };
    }

    const mapped = LEGACY_PRESET_IMAGE_MAP[bundled];
    if (mapped) {
      return { type: 'image', value: mapped, source: 'preset-image' };
    }

    return { ...DEFAULT_BACKGROUND };
  }

  function backgroundsEqual(a, b) {
    return Boolean(
      a && b && a.type === b.type && a.value === b.value && a.source === b.source
    );
  }

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
    iconsEmptyHint: document.getElementById('icons-empty-hint'),
    dragLive: document.getElementById('drag-live'),
    dropIndicator: document.getElementById('icon-drop-indicator'),
    toast: document.getElementById('toast'),
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

    refreshBgBtn: document.getElementById('refresh-bg-btn'),

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
    sshGatewayToken: document.getElementById('ssh-gateway-token'),
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

    particlesCanvas: document.getElementById('particles-canvas'),

    calendarPopover: document.getElementById('calendar-popover'),
    calendarInput: document.getElementById('calendar-input')
  };

  const state = {
    icons: [],
    folders: [],
    currentFolderId: HOME_FOLDER_ID,
    todoPanelOpen: false,
    todos: [],
    background: { type: 'bing', value: '', source: '' },
    clockFormat: '12h',
    showSeconds: false,
    uiOpacity: 32,
    uiBlur: 10,
    iconFrameEnabled: false,
    openInNewTab: false,
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

  let calendarPicker = null;
  let editingIconId = null;
  let iconDraftIntent = null;
  const iconSaveGate = OpenTabIcons.createSaveGate();
  let contextMenuIconId = null;
  let pendingIconUploadDataUrl = '';
  let iconSwitchToken = 0;
  let draggingIconId = null;
  let dragPointerY = 0;
  let dragScrollRaf = 0;
  let toastTimer = 0;
  let pendingUndo = null;
  const focusStack = [];
  let gridEventsBound = false;
  const ICON_DND_TYPE = 'application/x-opentab-icon';
  let clockTimerId = null;

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function ensureFolders(folders) {
    return window.OpenTabFolders ? OpenTabFolders.ensureGroups(folders) : (Array.isArray(folders) ? folders : DEFAULT_FOLDERS.slice());
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
    if (rawType === 'folder') return 'folder';
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

  function getIconHref(icon) {
    const iconType = normalizeIconType(icon.type);
    if (iconType === ICON_TYPE_SSH) {
      return isSshConfigComplete(icon) ? chrome.runtime.getURL(`ssh_terminal.html?iconId=${encodeURIComponent(icon.id)}`) : '';
    }
    if (iconType === ICON_TYPE_TOOL) {
      const toolType = icon.toolSubtype || 'json-format';
      const file = toolType === 'fix-parser' ? 'fixparser.html' : 'tool.html';
      return chrome.runtime.getURL(`${file}?tool=${encodeURIComponent(toolType)}`);
    }
    try {
      const parsed = new URL(icon.url || '');
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return icon.url;
    } catch (error) { /* invalid */ }
    return '';
  }

  function isSshConfigComplete(icon) {
    return Boolean(icon.sshGatewayUrl && icon.sshGatewayToken && icon.sshHost && icon.sshUsername);
  }

  function navigateTo(url) {
    if (!url) return;
    if (state.openInNewTab) window.open(url, '_blank', 'noopener,noreferrer');
    else window.location.assign(url);
  }

  function disabledIconToast(icon) {
    return normalizeIconType(icon.type) === ICON_TYPE_SSH ? 'SSH 配置不完整，请先编辑这个图标' : '网址无效，请编辑';
  }

  function openIconTarget(icon) {
    const href = getIconHref(icon);
    if (!href) { showToast(disabledIconToast(icon)); return; }
    navigateTo(href);
  }

  function showToast(text, options) {
    const toast = elements.toast;
    if (!toast) return;
    const opts = options || {};
    toast.textContent = text;
    if (opts.actionLabel && opts.onAction) {
      const actionIntent = opts.intent || workspace.captureIntent();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opts.actionLabel;
      btn.onclick = () => {
        clearTimeout(toastTimer);
        toast.classList.add('hidden');
        pendingUndo = null;
        if (!workspace.isIntentCurrent(actionIntent)) { showToast('内容已变化，无法执行旧操作。'); return; }
        opts.onAction();
      };
      toast.appendChild(btn);
    }
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.add('hidden'); pendingUndo = null; }, opts.duration || 6000);
  }

  function isFocusable(el) {
    if (!el || !document.contains(el) || typeof el.focus !== 'function' || el.disabled) return false;
    if (el.closest && el.closest('.hidden')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  function rememberFocus(el) {
    const target = el || document.activeElement;
    if (target && target !== document.body) focusStack.push(target);
  }
  function restoreFocus() {
    while (focusStack.length) {
      const el = focusStack.pop();
      if (isFocusable(el)) {
        el.focus();
        return el;
      }
    }
    return null;
  }
  function hideDropIndicator() {
    if (elements.dropIndicator) elements.dropIndicator.style.display = 'none';
  }
  function refreshIconViews(animated) {
    if (window.OpenTabFolders) OpenTabFolders.renderChrome();
    renderIconsForCurrentFolder(animated);
  }
  function iconSelector(id) {
    return `.icon-widget[data-id="${CSS.escape(String(id))}"]`;
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
    if (window.OpenTabFolders) return OpenTabFolders.visibleIcons(folderId);
    return state.icons.filter((icon) => icon.folderId === folderId && !(icon.parentId));
  }

  function getIconLabel(icon) {
    if (normalizeIconType(icon.type) === ICON_TYPE_SSH) return '>_';
    if (normalizeIconType(icon.type) === ICON_TYPE_TOOL) return '{ }';
    if (icon.emoji) return icon.emoji;
    const trimmed = (icon.name || '').trim();
    return trimmed ? trimmed[0].toUpperCase() : '•';
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
    if (open) rememberFocus(elements.timezoneBtn);
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
    // Strip the localized day period; #ampm renders AM/PM separately.
    elements.time.textContent = new Intl.DateTimeFormat('zh-CN', options)
      .formatToParts(now)
      .filter((part) => part.type !== 'dayPeriod')
      .map((part) => part.value)
      .join('')
      .trim();

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

  function cleanupRuntimeResources() {
    if (clockTimerId) {
      clearInterval(clockTimerId);
      clockTimerId = null;
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
    state.icons = [];
    state.todos = [];
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
    if (open) rememberFocus(elements.todoToggleBtn);
    state.todoPanelOpen = open;
    renderTodoPanel();
    saveState();
  }

  function renderTodoPanel() {
    const open = state.todoPanelOpen;
    elements.todoWidget.classList.toggle('hidden', !open);
    elements.todoToggleBtn.classList.toggle('active', open);
    elements.todoCollapseBtn.textContent = '×';
    elements.todoCollapseBtn.title = '关闭待办';
    elements.todoCollapseBtn.setAttribute('aria-label', '关闭待办');
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

  function updateBackground(opts) {
    return OpenTabBingCache.updateBackground(opts);
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
    state.uiOpacity = OpenTabBoot.applyUiOpacity(state.uiOpacity);
  }

  function applyUiBlurSetting() {
    state.uiBlur = OpenTabBoot.applyUiBlur(state.uiBlur);
  }

  function applyThemeMode() {
    OpenTabBoot.applyTheme(state.themeMode);
  }

  function applyAccentColor() {
    OpenTabBoot.applyAccentHue(state.accentHue);
  }

  function applyParticles() {
    document.body.classList.toggle('particles-enabled', state.particlesEnabled);
    if (state.particlesEnabled) initParticles();
    else stopParticles();
  }

  function applyGradientFlow() {
    document.body.classList.toggle('gradient-flow', state.gradientFlow);
  }

  function applyMinimalMode() {
    document.body.classList.toggle('minimal-mode', state.minimalMode);
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

  function fetchRandomBackground() {
    return OpenTabBingCache.fetchRandomBackground();
  }

  function writeBootMirror() {
    const tz = COMMON_TIMEZONES.find((item) => item.id === state.timezone);
    OpenTabBoot.writeMirror(Object.assign({
      theme: state.themeMode || 'dark',
      accentHue: state.accentHue,
      uiOpacity: state.uiOpacity,
      uiBlur: state.uiBlur,
      minimalMode: state.minimalMode,
      bg: OpenTabBingCache.describeBackground(),
      tz: state.timezone,
      tzLabel: tz ? `${tz.name} (${formatTimezoneOffset(tz.offset)})` : state.timezone,
      clockFormat: state.clockFormat,
      showSeconds: state.showSeconds
    }, window.OpenTabLayout ? OpenTabLayout.bootMirrorSlice() : {}));
  }

  function applyBootMirror() {
    const mirror = OpenTabBoot.readMirror();
    if (!mirror) return;
    if (mirror.tz) state.timezone = mirror.tz;
    if (mirror.clockFormat === '12h' || mirror.clockFormat === '24h') {
      state.clockFormat = mirror.clockFormat;
    }
    if (mirror.showSeconds !== undefined) state.showSeconds = Boolean(mirror.showSeconds);
    if (mirror.tzLabel) elements.timezoneLabel.textContent = mirror.tzLabel;
    updateClock();
  }

  function createIconWidget(icon) {
    const iconEl = document.createElement('a');
    iconEl.className = 'icon-widget';
    iconEl.dataset.id = icon.id;
    iconEl.draggable = true;
    iconEl.title = icon.name || '';
    const href = getIconHref(icon);
    if (href) {
      iconEl.href = href;
      if (state.openInNewTab) { iconEl.target = '_blank'; iconEl.rel = 'noopener noreferrer'; }
    } else {
      iconEl.role = 'link';
      iconEl.ariaDisabled = 'true';
      iconEl.tabIndex = 0;
    }

    const iconVisual = document.createElement('div');
    iconVisual.className = 'icon-visual';
    if (window.OpenTabIcons) OpenTabIcons.mountVisual(iconVisual, icon);
    else {
      const fallback = document.createElement('span');
      fallback.className = 'icon-fallback';
      fallback.textContent = getIconLabel(icon);
      iconVisual.appendChild(fallback);
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'icon-name';
    nameEl.textContent = icon.name;

    iconEl.appendChild(iconVisual);
    iconEl.appendChild(nameEl);
    if (window.OpenTabFolders) OpenTabFolders.decorateWidget(iconEl, icon);
    return iconEl;
  }

  function createAddShortcutTile() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'add-shortcut-tile';
    btn.className = 'icon-widget';
    btn.setAttribute('aria-label', '添加快捷方式');
    btn.innerHTML = '<div class="icon-visual">+</div><span class="icon-name">添加</span>';
    return btn;
  }

  function gridRoot(event) {
    if (event && event.currentTarget && event.currentTarget.querySelectorAll) return event.currentTarget;
    if (window.OpenTabFolders) return OpenTabFolders.activeGridRoot() || elements.iconsContainer;
    return elements.iconsContainer;
  }

  function getFolderIconEls(event) {
    return Array.from(gridRoot(event).querySelectorAll('.icon-widget[data-id]'));
  }

  function folderIconSlots() {
    const indices = [], items = [];
    const parentId = window.OpenTabFolders ? OpenTabFolders.slotsParentId() : '';
    state.icons.forEach((icon, i) => {
      if (icon.folderId === state.currentFolderId && (icon.parentId || '') === parentId) {
        indices.push(i);
        items.push(icon);
      }
    });
    return { indices, items };
  }

  function reorderFolderIcons(iconId, insertIndex) {
    const { indices, items } = folderIconSlots();
    const from = items.findIndex((icon) => icon.id === iconId);
    if (from < 0) return 0;
    let dest = Math.max(0, Math.min(insertIndex, items.length));
    if (from < dest) dest -= 1;
    if (from === dest) return 0;
    const [moved] = items.splice(from, 1);
    items.splice(dest, 0, moved);
    items.forEach((icon, i) => { state.icons[indices[i]] = icon; });
    return dest + 1;
  }

  function computeInsertIndex(event) {
    const icons = getFolderIconEls();
    if (event.target.closest('#add-shortcut-tile, .add-shortcut-tile') || !icons.length) return icons.length;
    const target = event.target.closest('.icon-widget[data-id]');
    if (!target) return icons.length;
    const rect = target.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? icons.indexOf(target) : icons.indexOf(target) + 1;
  }

  function updateDropLine(event) {
    const indicator = elements.dropIndicator;
    if (!indicator) return;
    const addTile = gridRoot(event).querySelector('#add-shortcut-tile, .add-shortcut-tile');
    let ref = event.target.closest('#add-shortcut-tile, .add-shortcut-tile') ? addTile : event.target.closest('.icon-widget[data-id]');
    let before = true;
    if (!ref) {
      if (!addTile) { hideDropIndicator(); return; }
      ref = addTile;
    } else if (ref !== addTile) {
      const rect = ref.getBoundingClientRect();
      before = event.clientX < rect.left + rect.width / 2;
    }
    const r = ref.getBoundingClientRect();
    indicator.style.cssText = `display:block;left:${(before ? r.left : r.right) - 1}px;top:${r.top}px;height:${r.height}px`;
  }

  function tickDragScroll() {
    if (!draggingIconId) { dragScrollRaf = 0; return; }
    const el = document.getElementById('content');
    if (el) {
      const r = el.getBoundingClientRect();
      if (dragPointerY - r.top < 48) el.scrollTop -= Math.min(12, 48 - (dragPointerY - r.top));
      else if (r.bottom - dragPointerY < 48) el.scrollTop += Math.min(12, 48 - (r.bottom - dragPointerY));
    }
    dragScrollRaf = requestAnimationFrame(tickDragScroll);
  }

  function endDesktopDrag() {
    draggingIconId = null;
    if (window.OpenTabFolders) OpenTabFolders.clearMergeHover();
    document.querySelectorAll('#icons-container .icon-widget[data-id], #folder-icons-container .icon-widget[data-id]').forEach((n) => {
      n.style.opacity = '';
    });
    hideDropIndicator();
    if (dragScrollRaf) { cancelAnimationFrame(dragScrollRaf); dragScrollRaf = 0; }
    document.querySelectorAll('.drop-target,.dragging,.folder-merge-target').forEach((n) => {
      n.classList.remove('drop-target', 'dragging', 'folder-merge-target');
    });
  }

  function persistOrRollback() { return saveState(); }

  function commitFolderReorder(iconId, insertIndex, announce) {
    const before = state.icons.slice();
    const position = reorderFolderIcons(iconId, insertIndex);
    if (!position) { endDesktopDrag(); return false; }
    persistOrRollback(before);
    const container = gridRoot();
    const add = container.querySelector('#add-shortcut-tile, .add-shortcut-tile');
    folderIconSlots().items.forEach((icon) => {
      const node = container.querySelector(iconSelector(icon.id));
      if (node && add) container.insertBefore(node, add);
    });
    endDesktopDrag();
    if (window.OpenTabFolders) OpenTabFolders.renderChrome();
    if (announce) {
      const node = container.querySelector(iconSelector(iconId));
      if (node) node.focus();
      if (elements.dragLive) elements.dragLive.textContent = `已移动到第 ${position} 位`;
    }
    return true;
  }

  function onGridDragStart(event) {
    const widget = event.target.closest('.icon-widget[data-id]');
    if (!widget) { event.preventDefault(); return; }
    const icon = state.icons.find((item) => item.id === widget.dataset.id);
    if (!icon) return;
    draggingIconId = icon.id;
    if (window.OpenTabFolders) OpenTabFolders.setActiveGrid(event.currentTarget);
    widget.style.opacity = '0.4';
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.effectAllowed = 'copyMove';
    transfer.setData(ICON_DND_TYPE, icon.id);
    const href = getIconHref(icon);
    if (href) {
      transfer.setData('text/uri-list', href);
      transfer.setData('text/plain', href);
    }
  }

  function onGridDragOver(event) {
    if (!draggingIconId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragPointerY = event.clientY;
    if (window.OpenTabFolders) OpenTabFolders.setActiveGrid(event.currentTarget);
    if (window.OpenTabFolders && OpenTabFolders.handleGridDragOver(event, draggingIconId)) return;
    updateDropLine(event);
    if (!dragScrollRaf) dragScrollRaf = requestAnimationFrame(tickDragScroll);
  }

  function onGridDrop(event) {
    if (!draggingIconId) return;
    event.preventDefault();
    const iconId = (event.dataTransfer && event.dataTransfer.getData(ICON_DND_TYPE)) || draggingIconId;
    if (window.OpenTabFolders) OpenTabFolders.setActiveGrid(event.currentTarget);
    if (window.OpenTabFolders && OpenTabFolders.handleGridDrop(event, iconId)) {
      endDesktopDrag();
      return;
    }
    endDesktopDrag();
    commitFolderReorder(iconId, computeInsertIndex(event), false);
  }

  function onGridClick(event) {
    const addTile = event.target.closest('#add-shortcut-tile, .add-shortcut-tile');
    if (addTile) { rememberFocus(addTile); openAddIconModal(); return; }
    const widget = event.target.closest('.icon-widget[data-id]');
    if (!widget) return;
    const icon = state.icons.find((item) => item.id === widget.dataset.id);
    if (!icon) return;
    if (window.OpenTabFolders && OpenTabFolders.handleGridClick(event, icon)) return;
    if (!getIconHref(icon)) { event.preventDefault(); showToast(disabledIconToast(icon)); }
  }

  function onGridContextMenu(event) {
    const widget = event.target.closest('.icon-widget[data-id]');
    if (!widget) return;
    event.preventDefault();
    rememberFocus(widget);
    openIconContextMenu(event, widget.dataset.id);
  }

  function onGridKeydown(event) {
    const widget = event.target.closest('.icon-widget[data-id]');
    if (!widget) return;
    if ((event.key === 'Enter' || event.key === ' ') && window.OpenTabFolders && OpenTabFolders.isFolderId(widget.dataset.id)) {
      event.preventDefault();
      OpenTabFolders.openOverlay(widget.dataset.id);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && widget.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      const icon = state.icons.find((item) => item.id === widget.dataset.id);
      if (icon) showToast(disabledIconToast(icon));
      return;
    }
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const { items } = folderIconSlots();
    const from = items.findIndex((icon) => icon.id === widget.dataset.id);
    const dir = event.key === 'ArrowRight' ? 1 : -1;
    const to = from + dir;
    if (from < 0 || to < 0 || to >= items.length) return;
    commitFolderReorder(widget.dataset.id, dir > 0 ? to + 1 : to, true);
  }

  function bindGrid(container) {
    if (!container || container.dataset.gridBound === '1') return;
    container.dataset.gridBound = '1';
    [
      ['dragstart', onGridDragStart], ['dragover', onGridDragOver], ['drop', onGridDrop],
      ['dragend', endDesktopDrag], ['click', onGridClick], ['contextmenu', onGridContextMenu], ['keydown', onGridKeydown]
    ].forEach(([type, fn]) => container.addEventListener(type, fn));
    container.addEventListener('dragleave', (event) => {
      if (!container.contains(event.relatedTarget)) {
        hideDropIndicator();
        if (window.OpenTabFolders) OpenTabFolders.clearMergeHover();
      }
    });
  }

  function bindDesktopGridEvents() {
    if (gridEventsBound) return;
    gridEventsBound = true;
    bindGrid(elements.iconsContainer);
  }

  function renderIconsForCurrentFolder(animated = false) {
    const nextIcons = getIconsForFolder(state.currentFolderId);
    const container = elements.iconsContainer;
    const oldNodes = Array.from(container.querySelectorAll('.icon-widget[data-id]'));
    const token = ++iconSwitchToken;
    const skipEnter = animated !== true;
    bindDesktopGridEvents();

    const mountNewIcons = () => {
      if (token !== iconSwitchToken) return;
      container.innerHTML = '';
      nextIcons.forEach((icon, idx) => {
        const node = createIconWidget(icon);
        if (!skipEnter) {
          node.classList.add('entering');
          node.style.transitionDelay = `${Math.min(idx * 22, 220)}ms`;
        }
        container.appendChild(node);
      });
      container.appendChild(createAddShortcutTile());
      if (elements.iconsEmptyHint) elements.iconsEmptyHint.classList.toggle('hidden', nextIcons.length !== 0);
      if (!skipEnter) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            container.querySelectorAll('.icon-widget.entering').forEach((node) => {
              node.classList.remove('entering');
              node.style.transitionDelay = '';
            });
          });
        });
      }
      performance.mark('opentab:grid-ready');
    };

    if (skipEnter || oldNodes.length === 0) {
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
    refreshIconViews(animated);
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
      sshGatewayToken: isSsh ? (payload.sshGatewayToken || '') : '',
      sshHost: isSsh ? (payload.sshHost || '') : '',
      sshPort: isSsh ? safePort : 22,
      sshUsername: isSsh ? (payload.sshUsername || '') : '',
      sshPassword: isSsh ? (payload.sshPassword || '') : '',
      sshSocksHost: isSsh ? normalizeOptionalText(payload.sshSocksHost) : '',
      sshSocksPort: isSsh ? safeSocksPort : 1080,
      sshSocksUsername: isSsh ? normalizeOptionalText(payload.sshSocksUsername) : '',
      sshSocksPassword: isSsh ? (payload.sshSocksPassword || '') : '',
      folderId,
      parentId: (window.OpenTabFolders && OpenTabFolders.currentOpenParentId()) || '',
      customIconUrl: isSsh ? '' : customIconUrl,
      emoji: isSsh ? '>_' : (isTool ? '{ }' : emoji),
      uploadedIconDataUrl: isSsh ? '' : uploadedIconDataUrl,
      resolvedIconUrl: isSsh ? '' : (uploadedIconDataUrl || customIconUrl),
      iconCandidates: [],
      toolSubtype: isTool ? (payload.toolSubtype || '') : ''
    };
    if (window.OpenTabIcons) OpenTabIcons.prepareRecord(newIcon);

    const before = state.icons.slice();
    state.icons.push(newIcon);
    const saved = persistOrRollback(before);
    refreshIconViews();
    if (window.OpenTabIcons) OpenTabIcons.resolveLater(newIcon.id);
    return saved;
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
    icon.sshGatewayToken = isSsh ? (payload.sshGatewayToken || '') : '';
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
    icon.iconCandidates = [];
    icon.toolSubtype = isTool ? (payload.toolSubtype || '') : '';
    if (isSsh) icon.resolvedIconUrl = '';
    else if (window.OpenTabIcons) OpenTabIcons.prepareRecord(icon);
    else icon.resolvedIconUrl = payload.uploadedIconDataUrl || payload.customIconUrl || '';

    const saved = saveState();
    refreshIconViews();
    if (window.OpenTabIcons && !isSsh) OpenTabIcons.resolveLater(icon.id);
    return saved;
  }

  async function undoDelete(snapshot) {
    if (state.icons.some((item) => item.id === snapshot.icon.id)) return;
    const before = state.icons.slice();
    const next = before.slice();
    next.splice(Math.min(snapshot.index, next.length), 0, snapshot.icon);
    state.icons = next;
    const saved = persistOrRollback(before);
    refreshIconViews();
    if (await saved) showToast('已恢复', { duration: 1500 });
  }

  async function deleteIcon(iconId) {
    if (window.OpenTabFolders && OpenTabFolders.handleDeleteIcon(iconId)) return;
    const index = state.icons.findIndex((icon) => icon.id === iconId);
    if (index < 0) return;
    const snapshot = { icon: { ...state.icons[index] }, index };
    const before = state.icons.slice();
    state.icons = before.filter((icon) => icon.id !== iconId);
    pendingUndo = snapshot;
    const intent = workspace.captureIntent(), saved = persistOrRollback(before);
    refreshIconViews();
    if (!(await saved) || !workspace.isIntentCurrent(intent)) return;
    showToast(`已删除「${snapshot.icon.name}」`, {
      actionLabel: '撤销',
      onAction: () => undoDelete(snapshot), intent,
      duration: 6000
    });
  }

  function renderWorkspaceSettings() {
    const tz = COMMON_TIMEZONES.find((item) => item.id === state.timezone);
    elements.timezoneLabel.textContent = tz ? `${tz.name} (${formatTimezoneOffset(tz.offset)})` : state.timezone;
    applyUiOpacitySetting();
    applyUiBlurSetting();
    applyIconFrameSetting();
    applyThemeMode();
    applyAccentColor();
    applyParticles();
    applyGradientFlow();
    applyMinimalMode();
    if (window.OpenTabSettingsNav) {
      OpenTabSettingsNav.syncFromState();
      OpenTabSettingsNav.noteIcons(state.icons);
    }
  }

  const workspace = OpenTabWorkspace.connect({
    state,
    onChange: () => {
      refreshIconViews(false);
      renderTodos();
      updateClock();
      renderWorkspaceSettings();
      renderTodoPanel();
      updateBackground({ fade: false });
    },
    onError: (error) => showToast(error.message || '保存失败，请重试'),
    onSaved: writeBootMirror
  });
  const saveState = workspace.save;

  function loadState() {
    chrome.storage.local.get(
      OpenTabWorkspace.KEYS.concat(
        window.OpenTabLayout ? OpenTabLayout.STORAGE_KEYS : []
      ),
      (result) => {
        if (window.OpenTabLayout) OpenTabLayout.loadFromStorage(result);
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
            type: icon.type === 'folder' ? 'folder' : normalizeIconType(icon.type),
            parentId: typeof icon.parentId === 'string' ? icon.parentId : '',
            folderId: validFolderIds.has(icon.folderId) ? icon.folderId : HOME_FOLDER_ID,
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
        state.openInNewTab = Boolean(result.openInNewTab);
        if (result.timezone) state.timezone = result.timezone;
        if (result.bingIndex !== undefined) state.bingIndex = result.bingIndex;
        if (result.themeMode) state.themeMode = result.themeMode;
        if (result.accentHue !== undefined) state.accentHue = Number(result.accentHue);
        if (result.particlesEnabled !== undefined) state.particlesEnabled = Boolean(result.particlesEnabled);
        if (result.gradientFlow !== undefined) state.gradientFlow = Boolean(result.gradientFlow);
        if (result.minimalMode !== undefined) state.minimalMode = Boolean(result.minimalMode);

        if (window.OpenTabFolders) OpenTabFolders.repairIconGraph(state.icons);
        if (window.OpenTabIcons) state.icons.forEach((icon) => OpenTabIcons.prepareRecord(icon));
        const requestedFolderId = result.currentFolderId || HOME_FOLDER_ID;
        state.currentFolderId = getFolderById(requestedFolderId) ? requestedFolderId : HOME_FOLDER_ID;

        updateClock();
        renderTimezoneList();
        initCalendar();

        renderWorkspaceSettings();
        workspace.seed(result, { ...OpenTabWorkspace.migrationOverrides(result, state), ...(backgroundChanged ? { background: result.background } : {}) });
        refreshIconViews(false);
        renderTodos();
        setTodoPanelOpen(state.todoPanelOpen);
        if (window.OpenTabIcons) OpenTabIcons.scheduleIdleMigration();

        if (backgroundChanged) saveState();
        OpenTabBingCache.afterStateLoaded();
        writeBootMirror();
      }
    );
  }

  function openAddIconModal() {
    iconSaveGate.release();
    iconDraftIntent = workspace.captureIntent();
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
    elements.sshGatewayToken.value = '';
    elements.sshHost.value = '';
    elements.sshPort.value = '22';
    elements.sshUsername.value = '';
    elements.sshPassword.value = '';
    elements.sshPassword.placeholder = '留空表示由网关决定认证方式';
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

    iconSaveGate.release();
    editingIconId = iconId;
    iconDraftIntent = workspace.captureIntent({ icons: [iconId], folders: [icon.folderId] });
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
    elements.sshGatewayToken.value = icon.sshGatewayToken || '';
    elements.sshHost.value = icon.sshHost || '';
    elements.sshPort.value = String(icon.sshPort || 22);
    elements.sshUsername.value = icon.sshUsername || '';
    elements.sshPassword.value = icon.sshPassword || '';
    elements.sshPassword.placeholder = '已保存，留空则不修改';
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
    iconSaveGate.release();
    iconDraftIntent = null;
    editingIconId = null;
    pendingIconUploadDataUrl = '';
    elements.addIconModal.classList.add('hidden');
  }

  async function handleSaveIcon() {
    if (iconSaveGate.has(iconDraftIntent)) return;
    if (!workspace.isIntentCurrent(iconDraftIntent)) {
      closeAddIconModal(); showToast('内容已变化，请重新编辑。'); return;
    }
    const iconType = normalizeIconType(elements.iconType.value);
    const isSsh = iconType === ICON_TYPE_SSH;
    const isTool = iconType === ICON_TYPE_TOOL;
    const name = elements.iconName.value.trim();
    const rawUrl = elements.iconUrl.value.trim();
    const rawCustomUrl = elements.iconCustomUrl.value.trim();
    const rawGatewayUrl = elements.sshGatewayUrl.value.trim();
    const rawGatewayToken = elements.sshGatewayToken.value.trim();
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
    let sshGatewayToken = '';
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
        if (!rawGatewayToken) {
          elements.sshGatewayToken.focus();
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
        sshGatewayToken = rawGatewayToken;
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
      if (!isTool) {
        if (isSsh) alert('请输入有效的 SSH 配置。');
        else showToast('请输入有效的网址。');
        if (isSsh) elements.sshGatewayUrl.focus();
        else if (rawCustomUrl) elements.iconCustomUrl.focus();
        else elements.iconUrl.focus();
        return;
      }
    }

    const id = editingIconId, draft = iconDraftIntent;
    const current = state.icons.find((item) => item.id === id);
    const payload = {
      name, url, type: iconType, sshGatewayUrl, sshGatewayToken, sshHost, sshPort,
      sshUsername, sshPassword, sshSocksHost, sshSocksPort, sshSocksUsername, sshSocksPassword,
      folderId: current?.folderId || folderId, customIconUrl, emoji: '',
      uploadedIconDataUrl: isSsh ? '' : (pendingIconUploadDataUrl || current?.uploadedIconDataUrl || ''),
      toolSubtype: isTool ? toolSubtype : ''
    };
    try {
      await iconSaveGate.run(draft, elements.addIconModal,
        () => id ? updateIcon(id, payload) : addIcon(payload),
        () => { if (iconDraftIntent === draft) closeAddIconModal(); });
    } catch (error) {
      showToast('保存失败，请重试。');
    }
  }

  async function handleIconFileChange() {
    const [file] = elements.iconFile.files || [];
    if (!file) {
      pendingIconUploadDataUrl = '';
      elements.iconUploadStatus.textContent = '支持 PNG / JPG / SVG / WebP。';
      return;
    }

    try {
      pendingIconUploadDataUrl = window.OpenTabIcons
        ? await OpenTabIcons.readAndCompressFile(file)
        : await readFileAsDataUrl(file);
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
    elements.iconContextMenu.classList.remove('hidden');
    if (window.OpenTabFolders) OpenTabFolders.syncContextMenu(iconId);
    if (window.OpenTabIcons) OpenTabIcons.placeMenu(elements.iconContextMenu, event);
    else {
      elements.iconContextMenu.style.left = `${event.clientX}px`;
      elements.iconContextMenu.style.top = `${event.clientY}px`;
    }
  }

  function handleEscape(event) {
    if (event.key !== 'Escape') return;
    endDesktopDrag();
    if (window.OpenTabIcons && OpenTabIcons.handleEscape()) {
      event.preventDefault();
      restoreFocus();
      return;
    }
    if (window.OpenTabFolders && OpenTabFolders.handleEscape()) {
      event.preventDefault();
      restoreFocus();
      return;
    }
    const settingsEsc = window.OpenTabSettingsNav && OpenTabSettingsNav.handleEscape();
    if (settingsEsc === 'search') {
      event.preventDefault();
      return;
    }
    if (settingsEsc) {
      event.preventDefault();
      return;
    }
    const layers = [
      [elements.iconContextMenu, hideIconContextMenu],
      [elements.addIconModal, closeAddIconModal],
      [elements.timezoneSelector, () => toggleTimezoneSelector(false)],
      [elements.calendarPopover, () => toggleCalendar(false)]
    ];
    for (const [el, close] of layers) {
      if (el && !el.classList.contains('hidden')) {
        event.preventDefault();
        close();
        restoreFocus();
        return;
      }
    }
    if (state.todoPanelOpen) {
      event.preventDefault();
      closeTodoPanel();
      restoreFocus();
    }
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
      rememberFocus(elements.date);
      initCalendar();
      if (calendarPicker) {
        calendarPicker.jumpToDate(new Date(), false);
        calendarPicker.redraw();
      }
    }
  }

  document.addEventListener('contextmenu', (event) => {
    if (event.altKey || (window.getSelection && String(window.getSelection()))) return;
    if (event.target.closest('input, textarea, [contenteditable], #search-widget-wrap, #search-widget, #todo-widget, .icon-widget[data-id], .modal, .icon-context-menu, .settings-panel, .timezone-selector, .calendar-popover, #folder-overlay, #group-tabs-bar, #inline-dialog')) return;
    event.preventDefault();
    hideIconContextMenu();
    rememberFocus();
    openAddIconModal();
  });

  document.addEventListener('keydown', handleEscape);
  document.addEventListener('dragover', (event) => { if (draggingIconId) event.preventDefault(); });
  document.addEventListener('drop', (event) => { if (draggingIconId) { event.preventDefault(); endDesktopDrag(); } });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.icon-context-menu')) hideIconContextMenu();

    if (!event.target.closest('#timezone-selector') && !event.target.closest('#timezone-btn')) {
      toggleTimezoneSelector(false);
    }

    if (!event.target.closest('#calendar-popover') && !event.target.closest('#date')) {
      toggleCalendar(false);
    }
  });

  elements.timezoneBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleTimezoneSelector();
  });

  elements.date.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCalendar();
  });

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
    const currentId = contextMenuIconId;
    hideIconContextMenu();
    deleteIcon(currentId);
  });

  elements.refreshBgBtn.addEventListener('click', fetchRandomBackground);
  elements.cancelBtn.addEventListener('click', closeAddIconModal);
  elements.saveBtn.addEventListener('click', handleSaveIcon);
  elements.iconType.addEventListener('change', updateIconModalTypeView);
  elements.iconFile.addEventListener('change', handleIconFileChange);

  const clockWidget = document.getElementById('clock-widget');
  if (clockWidget) {
    clockWidget.addEventListener('dblclick', () => {
      state.minimalMode = !state.minimalMode;
      applyMinimalMode();
      saveState();
      if (window.OpenTabSettingsNav) OpenTabSettingsNav.syncFromState();
    });
  }

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
  elements.sshGatewayToken.addEventListener('keydown', (event) => {
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

  elements.todoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleAddTodo();
  });

  if (window.OpenTabIcons) {
    OpenTabIcons.init({
      ...workspace,
      getIcons: () => state.icons,
      saveState,
      refreshIconViews,
      showToast,
      rememberFocus,
      restoreFocus,
      getContextMenuIconId: () => contextMenuIconId,
      hideIconContextMenu,
      getIconLabel
    });
  }
  OpenTabSearch.init({
    getIcons: () => state.icons,
    openMatchedIcon: (icon) => {
      if (window.OpenTabFolders && OpenTabFolders.isFolder(icon)) {
        OpenTabFolders.openOverlay(icon.id);
        return;
      }
      openIconTarget(icon);
    }
  });
  OpenTabBingCache.init({
    state,
    elements,
    showToast,
    writeBootMirror,
    DEFAULT_GRADIENT,
    isVideoBackground
  });
  if (window.OpenTabSettingsNav) {
    OpenTabSettingsNav.init({
      ...workspace,
      state,
      saveState,
      showToast,
      rememberFocus,
      restoreFocus,
      updateClock,
      updateBackground,
      fetchRandomBackground,
      applyUiOpacitySetting,
      applyUiBlurSetting,
      applyIconFrameSetting,
      applyThemeMode,
      applyAccentColor,
      applyParticles,
      applyGradientFlow,
      applyMinimalMode,
      renderIconsForCurrentFolder,
      normalizeUrl,
      readFileAsDataUrl,
      DEFAULT_GRADIENT,
      DEFAULT_BACKGROUND
    });
  }
  if (window.OpenTabFolders) {
    OpenTabFolders.init({
      ...workspace,
      state,
      HOME_FOLDER_ID,
      ICON_DND_TYPE,
      generateId,
      saveState,
      showToast,
      refreshIconViews,
      renderIconsForCurrentFolder,
      createIconWidget,
      createAddShortcutTile,
      getIconHref,
      openIconTarget,
      rememberFocus,
      restoreFocus,
      getDraggingIconId: () => draggingIconId,
      setDraggingIconId: (id) => { draggingIconId = id; },
      endDesktopDrag,
      commitFolderReorder,
      computeInsertIndex,
      hideDropIndicator,
      hideIconContextMenu,
      getContextMenuIconId: () => contextMenuIconId,
      selectFolder,
      bindGrid,
      getIconsContainer: () => elements.iconsContainer
    });
  }

  document.addEventListener('opentab-sync-applied', () => {
    if (window.OpenTabFolders && OpenTabFolders.closeOverlay) OpenTabFolders.closeOverlay();
    loadState();
  });

  applyBootMirror();
  loadState();
  OpenTabWeather.init({ onUpdate: (data) => {
    state.weatherTag = data?.tag || 'unknown';
    state.weatherDesc = data?.description || '';
    state.weatherLocation = data?.location || '';
    updateClock();
  } });
  clockTimerId = setInterval(updateClock, 1000);
  window.addEventListener('beforeunload', cleanupRuntimeResources);
})();
