(async function() {
  if (window.OpenTabI18n) await OpenTabI18n.ready;
  const t = (s, p) => globalThis.OpenTabI18n ? globalThis.OpenTabI18n.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p?.[k] ?? m);

  const HOME_FOLDER_ID = 'folder-home';
  let sceneRuntime = null, sceneReadOnly = false, sceneInteractionBusy = false;
  OpenTabSceneHome.bindInteractionGate(() => ({ readOnly: sceneReadOnly, busy: sceneInteractionBusy }));
  const activeHomeId = () => sceneRuntime?.getView()?.homeGroupId || HOME_FOLDER_ID;
  const sceneViewAdapter = () => sceneRuntime?.isActive() ? () => sceneRuntime.getView() : undefined;
  const ICON_TYPE_SHORTCUT = 'shortcut';
  const ICON_TYPE_SSH = 'ssh';
  const ICON_TYPE_TOOL = 'tool';

  const COMMON_TIMEZONES = OpenTabTimezone.ZONES;

  const DEFAULT_FOLDERS = [
    { id: HOME_FOLDER_ID, name: t('主页') }
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

  const elements = {
    backgroundLayer: document.getElementById('background-layer'),
    backgroundVideo: document.getElementById('background-video'),
    time: document.getElementById('time'),
    ampm: document.getElementById('ampm'),
    date: document.getElementById('date'),
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
    ...OpenTabTimezone.preference(),
    bingIndex: 0,
    themeMode: 'dark',
    accentHue: 200,
    particlesEnabled: false,
    gradientFlow: false,
    minimalMode: false
  };

  let calendarPicker = null, calendarDefaultDate = null;
  let todoAddPending = false;
  let editingIconId = null;
  let iconDraftIntent = null;
  const iconSaveGate = OpenTabIcons.createSaveGate();
  let contextMenuIconId = null;
  let pendingIconUploadDataUrl = '';
  const iconUploadGate = OpenTabIcons.createUploadGate();
  let iconSwitchToken = 0;
  let draggingIconId = null;
  let dragPointerY = 0;
  let dragScrollRaf = 0;
  let toastTimer = 0;
  let pendingUndo = null;
  const { rememberFocus, restoreFocus } = OpenTabAccessibility.createFocus();
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
      throw new Error(t('SSH 网关地址必须使用 ws:// 或 wss://'));
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
    const titles = isSsh ? ['添加 SSH 链接', '编辑 SSH 链接'] : isTool ? ['添加工具', '编辑工具'] : ['添加快捷图标', '编辑快捷图标'];
    elements.iconModalTitle.textContent = t(titles[editingIconId ? 1 : 0]);
  }

  function getIconHref(icon) {
    return OpenTabIcons.targetHref(icon, normalizeIconType(icon.type), path => chrome.runtime.getURL(path));
  }

  function navigateTo(url) {
    if (!url) return;
    if (state.openInNewTab) window.open(url, '_blank', 'noopener,noreferrer');
    else window.location.assign(url);
  }

  function disabledIconToast(icon) {
    if (normalizeIconType(icon.type) === ICON_TYPE_TOOL) return t('此工具已移除，快捷方式数据仍保留');
    return normalizeIconType(icon.type) === ICON_TYPE_SSH ? t('SSH 配置不完整，请先编辑这个图标') : t('网址无效，请编辑');
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
        if (!workspace.isIntentCurrent(actionIntent)) { showToast(t('内容已变化，无法执行旧操作。')); return; }
        opts.onAction();
      };
      toast.appendChild(btn);
    }
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.add('hidden'); pendingUndo = null; }, opts.duration || 6000);
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
      reader.onerror = () => reject(new Error(t('读取文件失败')));
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

  let timezoneMenuStamp = '';
  function renderTimezoneList() {
    const current = OpenTabTimezone.preference(state);
    const zones = COMMON_TIMEZONES.slice();
    if (!zones.some(tz => OpenTabTimezone.sameZone(tz.id, current.timezone))) {
      zones.unshift({ id: current.timezone, name: current.timezone });
    }
    elements.timezoneList.innerHTML = '';
    [{ id: '', name: '跟随系统时区' }, ...zones].forEach((tz) => {
      const automatic = !tz.id;
      const selected = automatic ? current.timezoneMode === 'system'
        : current.timezoneMode === 'fixed' && OpenTabTimezone.sameZone(tz.id, current.timezone);
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('aria-pressed', selected);
      item.className = `timezone-item${selected ? ' active' : ''}`;
      item.dataset.tz = tz.id;
      item.dataset.mode = automatic ? 'system' : 'fixed';
      const name = document.createElement('span'), offset = document.createElement('span');
      name.className = 'timezone-item-name'; name.textContent = t(tz.name);
      offset.className = 'timezone-item-offset';
      item.append(name, offset);
      item.addEventListener('click', () => selectTimezone(tz.id));
      elements.timezoneList.appendChild(item);
    });
    timezoneMenuStamp = '';
    refreshTimezoneOffsets();
  }

  function refreshTimezoneOffsets(now = new Date()) {
    if (elements.timezoneSelector.classList.contains('hidden')) return;
    const system = OpenTabTimezone.systemZone(), stamp = `${Math.floor(now.getTime() / 60000)}|${system}`;
    if (stamp === timezoneMenuStamp) return;
    timezoneMenuStamp = stamp;
    for (const item of elements.timezoneList.children) {
      item.children[1].textContent = OpenTabTimezone.offset(item.dataset.mode === 'system' ? system : item.dataset.tz, now);
    }
  }

  function selectTimezone(tzId) {
    Object.assign(state, OpenTabTimezone.preference({ timezone: tzId, timezoneMode: tzId ? 'fixed' : 'system' }));
    saveState();
    toggleTimezoneSelector(false);
    updateClock();
    renderTimezoneList();
  }

  function toggleTimezoneSelector(forceOpen) {
    const open = typeof forceOpen === 'boolean'
      ? forceOpen
      : elements.timezoneSelector.classList.contains('hidden');
    const focused = elements.timezoneSelector.contains(document.activeElement);
    elements.timezoneSelector.classList.toggle('hidden', !open);
    if (open) renderTimezoneList();
    elements.timezoneBtn.setAttribute('aria-expanded', open);
    if (open) elements.timezoneList.querySelector('.active')?.focus();
    else if (focused) elements.timezoneBtn.focus();
  }

  function updateClock() {
    const now = new Date(), clock = OpenTabTimezone.clock(now, state, window.OpenTabI18n?.locale || 'zh-CN');
    elements.time.textContent = clock.time;
    elements.ampm.textContent = clock.ampm;
    elements.ampm.style.display = clock.ampm ? 'block' : 'none';
    elements.date.textContent = clock.date;
    elements.timezoneLabel.textContent = OpenTabTimezone.label(clock.timezone, now, t);
    refreshTimezoneOffsets(now);
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

  function renderTodos() { OpenTabClockDeck.renderTodos(); }

  function setTodoPanelOpen(open) {
    if (open) rememberFocus(document.activeElement);
    state.todoPanelOpen = open;
    renderTodoPanel();
    saveState();
  }

  function renderTodoPanel() {
    const open = state.todoPanelOpen;
    elements.todoWidget.classList.toggle('hidden', !open);
    elements.todoCollapseBtn.textContent = '×';
    elements.todoCollapseBtn.title = t('关闭待办');
    elements.todoCollapseBtn.setAttribute('aria-label', t('关闭待办'));
  }

  function toggleTodoPanel() {
    setTodoPanelOpen(!state.todoPanelOpen);
  }

  function closeTodoPanel() {
    setTodoPanelOpen(false);
  }

  async function handleAddTodo() {
    if (todoAddPending) return;
    const draft = elements.todoInput.value, text = draft.trim();
    if (!text) { elements.todoInput.focus(); return; }
    const record = OpenTabClockDeck.createTodoRecord(clockHost, { id: generateId(), text, done: false });
    if (!record) { showToast(t('内容已变化，请重新编辑。')); return; }
    state.todos.unshift(record);
    if (!sceneRuntime?.isActive()) {
      elements.todoInput.value = ''; saveState(); renderTodos(); return;
    }
    // A scene cannot change underneath a pending task draft. Only acknowledge
    // insertion after the ordinary workspace transaction has committed.
    todoAddPending = true;
    const controls = [elements.todoInput, elements.todoAddBtn].map(node => [node, node.disabled]);
    controls.forEach(([node]) => { node.disabled = true; });
    try {
      const saved = await saveState();
      if (saved === true && elements.todoInput.value === draft) elements.todoInput.value = '';
    } catch (_) {
      showToast(t('保存失败，请重试。'));
    } finally {
      todoAddPending = false;
      controls.forEach(([node, disabled]) => { node.disabled = disabled; });
      renderTodos();
    }
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
    if (state.particlesEnabled && !window.OpenTabZenMode?.isActive()) initParticles();
    else stopParticles();
  }

  function applyGradientFlow() {
    document.body.classList.toggle('gradient-flow', state.gradientFlow);
  }

  function applyMinimalMode() {
    document.body.classList.toggle('minimal-mode', state.minimalMode);
  }
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
    const accentHue = getComputedStyle(document.documentElement).getPropertyValue('--accent-hue').trim() || '200';
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3);
      gradient.addColorStop(0, `hsla(${accentHue}, 90%, 75%, ${p.opacity})`);
      gradient.addColorStop(0.4, `hsla(${accentHue}, 80%, 65%, ${p.opacity * 0.5})`);
      gradient.addColorStop(1, `hsla(${accentHue}, 70%, 60%, 0)`);

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${accentHue}, 100%, 85%, ${p.opacity + 0.2})`;
      ctx.fill();
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
    const timezone = OpenTabTimezone.preference(state);
    OpenTabBoot.writeMirror(Object.assign({
      ...(sceneRuntime?.getView() ? { sceneId: sceneRuntime.getView().sceneId } : {}),
      theme: state.themeMode || 'dark',
      accentHue: state.accentHue,
      uiOpacity: state.uiOpacity,
      uiBlur: state.uiBlur,
      minimalMode: state.minimalMode,
      bg: OpenTabBingCache.describeBackground(),
      tz: timezone.timezone,
      tzMode: timezone.timezoneMode,
      clockFormat: state.clockFormat,
      showSeconds: state.showSeconds
    }, window.OpenTabLayout ? OpenTabLayout.bootMirrorSlice() : {}));
  }

  function applyBootMirror() {
    const mirror = OpenTabBoot.readMirror();
    if (!mirror) return;
    Object.assign(state, OpenTabTimezone.preference({ timezone: mirror.tz, timezoneMode: mirror.tzMode }));
    if (mirror.clockFormat === '12h' || mirror.clockFormat === '24h') {
      state.clockFormat = mirror.clockFormat;
    }
    if (mirror.showSeconds !== undefined) state.showSeconds = Boolean(mirror.showSeconds);
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
    btn.setAttribute('aria-label', t('添加快捷方式'));
    btn.innerHTML = `<div class="icon-visual">+</div><span class="icon-name">${t('添加')}</span>`;
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
      if (elements.dragLive) elements.dragLive.textContent = t('已移动到第 {position} 位', { position });
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
      window.OpenTabFolders?.animateGroupIcons?.(container);
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
    if (!getFolderById(folderId)) return false;
    if (sceneRuntime?.isActive()) return window.OpenTabSceneNavigation.selectGroup(folderId);
    state.currentFolderId = folderId;
    const saved = saveState();
    refreshIconViews(animated);
    return saved;
  }

  function addIcon(payload) {
    const iconType = normalizeIconType(payload.type);
    const isSsh = iconType === ICON_TYPE_SSH;
    const isTool = iconType === ICON_TYPE_TOOL;
    const customIconUrl = payload.customIconUrl || '';
    const emoji = payload.emoji || '';
    const uploadedIconDataUrl = payload.uploadedIconDataUrl || '';
    const folderId = getFolderById(payload.folderId) ? payload.folderId : activeHomeId();
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
    icon.folderId = getFolderById(payload.folderId) ? payload.folderId : activeHomeId();
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
    if (await saved) showToast(t('已恢复'), { duration: 1500 });
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
    showToast(t('已删除「{name}」', { name: snapshot.icon.name }), {
      actionLabel: t('撤销'),
      onAction: () => undoDelete(snapshot), intent,
      duration: 6000
    });
  }

  function renderWorkspaceSettings() {
    updateClock();
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

  function renderCurrentWorkspace() {
    sceneRuntime?.syncVisibleAppearance();
    refreshIconViews(false); renderTodos(); updateClock();
    renderWorkspaceSettings(); renderTodoPanel(); updateBackground({ fade: false });
  }
  const workspace = OpenTabWorkspace.connect({
    state,
    getViewIdentity: () => sceneRuntime?.getView(),
    onChange: renderCurrentWorkspace,
    onError: (error) => showToast(error.message || t('保存失败，请重试')),
    onSaved: raw => { sceneRuntime?.noteCommitted(raw); writeBootMirror(); }
  });
  const saveState = (...args) => sceneRuntime ? sceneRuntime.saveState(...args) : workspace.save(...args);

  const applyLoadedState = OpenTabSceneHome.create({
    state, HOME_FOLDER_ID, LEGACY_PRESET_FOLDER_IDS, activeHomeId, t, ensureFolders, normalizeIconType, migrateBackground, backgroundsEqual, getFolderById, updateClock, renderTimezoneList, initCalendar, renderWorkspaceSettings, workspace, refreshIconViews, renderTodos, setTodoPanelOpen, saveState, writeBootMirror
  });
  function loadState() { return sceneRuntime.load(); }

  function openAddIconModal() {
    iconSaveGate.release();
    iconUploadGate.reset();
    iconDraftIntent = workspace.captureIntent();
    editingIconId = null;
    pendingIconUploadDataUrl = '';

    elements.iconType.value = ICON_TYPE_SHORTCUT;
    elements.saveBtn.textContent = t('保存');
    elements.addIconModal.classList.remove('hidden');

    elements.iconName.value = '';
    elements.iconUrl.value = '';
    elements.iconCustomUrl.value = '';
    elements.iconFile.value = '';
    elements.iconUploadStatus.textContent = '';
    elements.sshGatewayUrl.value = '';
    elements.sshGatewayToken.value = '';
    elements.sshHost.value = '';
    elements.sshPort.value = '22';
    elements.sshUsername.value = '';
    elements.sshPassword.value = '';
    elements.sshPassword.placeholder = t('留空表示由网关决定认证方式');
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
    iconUploadGate.reset();
    editingIconId = iconId;
    iconDraftIntent = workspace.captureIntent({ icons: [iconId], folders: [icon.folderId] });
    pendingIconUploadDataUrl = '';

    const iconType = normalizeIconType(icon.type);
    elements.iconType.value = iconType;
    elements.saveBtn.textContent = t('更新');
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
    elements.sshPassword.placeholder = t('已保存，留空则不修改');
    elements.sshSocksHost.value = icon.sshSocksHost || '';
    elements.sshSocksPort.value = icon.sshSocksHost ? String(icon.sshSocksPort || 1080) : '';
    elements.sshSocksUsername.value = icon.sshSocksUsername || '';
    elements.sshSocksPassword.value = icon.sshSocksPassword || '';
    elements.iconUploadStatus.textContent = icon.uploadedIconDataUrl
      ? t('已保存本地图标')
      : '';
    elements.toolSubtype.value = icon.toolSubtype || '';
    elements.iconName.focus();
  }

  function closeAddIconModal() {
    iconSaveGate.release();
    iconUploadGate.reset();
    iconDraftIntent = null;
    editingIconId = null;
    pendingIconUploadDataUrl = '';
    const wasOpen = !elements.addIconModal.classList.contains('hidden');
    elements.addIconModal.classList.add('hidden');
    if (wasOpen) restoreFocus();
  }

  async function handleSaveIcon() {
    if (iconSaveGate.has(iconDraftIntent)) return;
    if (!workspace.isIntentCurrent(iconDraftIntent)) {
      closeAddIconModal(); showToast(t('内容已变化，请重新编辑。')); return;
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
    const toolSubtype = elements.toolSubtype.value || (editingIconId ? state.icons.find(item => item.id === editingIconId)?.toolSubtype : '') || 'json-format';
    const folderId = state.currentFolderId || activeHomeId();

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
          throw new Error(t('SSH 端口无效'));
        }
        sshSocksHost = normalizeOptionalText(rawSshSocksHost);
        sshSocksUsername = normalizeOptionalText(rawSshSocksUsername);
        sshSocksPassword = rawSshSocksPassword;
        if (sshSocksHost) {
          sshSocksPort = rawSshSocksPort ? Number.parseInt(rawSshSocksPort, 10) : 1080;
          if (!Number.isInteger(sshSocksPort) || sshSocksPort < 1 || sshSocksPort > 65535) {
            throw new Error(t('SOCKS5 端口无效'));
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
        if (isSsh) alert(t('请输入有效的 SSH 配置。'));
        else showToast(t('请输入有效的网址。'));
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
      toolSubtype: isTool ? toolSubtype : ''
    };
    try {
      await iconSaveGate.run(draft, elements.addIconModal,
        async () => {
          if (!await iconUploadGate.wait(draft) || draft !== iconDraftIntent || !workspace.isIntentCurrent(draft)) return false;
          elements.cancelBtn.disabled = true;
          payload.uploadedIconDataUrl = isSsh ? '' : (pendingIconUploadDataUrl || current?.uploadedIconDataUrl || '');
          return id ? updateIcon(id, payload) : addIcon(payload);
        },
        () => { if (iconDraftIntent === draft) closeAddIconModal(); });
    } catch (error) {
      showToast(t('保存失败，请重试。'));
    }
  }

  async function handleIconFileChange() {
    const draft = iconDraftIntent;
    await iconUploadGate.select(draft, elements, OpenTabIcons.readAndCompressFile,
      (data) => { pendingIconUploadDataUrl = data; },
      () => draft === iconDraftIntent && workspace.isIntentCurrent(draft), t);
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
    if (event.key !== 'Escape' || window.OpenTabZenMode?.isActive()) return;
    endDesktopDrag();
    if (window.OpenTabIcons && OpenTabIcons.handleEscape()) {
      event.preventDefault();
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
        if (el === elements.timezoneSelector) elements.timezoneBtn.focus();
        else if (el !== elements.addIconModal) restoreFocus();
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
    if (window.OpenTabI18n?.locale === 'en') return;
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

  function initCalendar(defer = false) {
    if (calendarPicker || typeof flatpickr === 'undefined') return;
    calendarDefaultDate ||= new Date();
    if (defer === true) return;
    try { performance.mark('opentab:calendar-build-start'); } catch (_) {}

    if (window.OpenTabI18n?.locale !== 'en' && flatpickr.l10ns && flatpickr.l10ns.zh) {
      flatpickr.localize(flatpickr.l10ns.zh);
    }

    calendarPicker = flatpickr(elements.calendarInput, {
      inline: true,
      clickOpens: false,
      defaultDate: calendarDefaultDate,
      now: calendarDefaultDate,
      locale: window.OpenTabI18n?.locale === 'en' ? 'default' : 'zh',
      onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
        const dateObj = dayElem.dateObj;
        if (dateObj) annotateCalendarDay(dayElem, dateObj);
      }
    });
    try { performance.mark('opentab:calendar-build-end'); } catch (_) {}
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
    if (window.OpenTabZenMode?.isActive()) return;
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

  [elements.iconUrl, elements.iconCustomUrl, elements.sshGatewayUrl, elements.sshGatewayToken,
    elements.sshHost, elements.sshPort, elements.sshUsername, elements.sshPassword,
    elements.sshSocksHost, elements.sshSocksPort, elements.sshSocksUsername, elements.sshSocksPassword
  ].forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSaveIcon();
  }));

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
  const clockHost = { state, elements, workspace, saveState, renderTodos,
    get getSceneView() { return sceneViewAdapter(); },
    closeClockPopovers() { toggleTimezoneSelector(false); toggleCalendar(false); },
    openTodoList(opener) { setTodoPanelOpen(true); rememberFocus(opener); elements.todoInput.focus(); }
  };
  OpenTabClockDeck.init(clockHost);
  window.OpenTabZenMode?.init({
    focus: OpenTabClockDeck.getFocus(),
    closePopovers() {
      toggleTimezoneSelector(false); toggleCalendar(false); hideIconContextMenu();
      window.OpenTabSearch?.closeEngineDeck({ restore: false });
      window.OpenTabFolders?.closeOverlay();
      window.OpenTabCommandPalette?.close();
    },
    onActiveChange(active) { if (active) stopParticles(); else applyParticles(); },
    canRestoreHome: () => !sceneReadOnly && !sceneInteractionBusy
  });
  window.OpenTabCommandPalette?.init({ openAddWebsite() { rememberFocus(); openAddIconModal(); } });
  OpenTabSearch.init({
    getState: () => state,
    openMatchedIcon: async (icon) => {
      if (window.OpenTabFolders && OpenTabFolders.isFolder(icon)) {
        if (sceneRuntime?.isActive() && icon.folderId !== state.currentFolderId) {
          try { if (!await window.OpenTabSceneNavigation.selectGroup(icon.folderId)) return; } catch (_) { showToast(t('内容已变化，请重新编辑。')); return; }
        }
        const current = state.icons.find(item => item.id === icon.id && item.type === 'folder' && item.folderId === state.currentFolderId);
        if (current) OpenTabFolders.openOverlay(current.id);
        return;
      }
      openIconTarget(icon);
    }
  });
  const bingHost = {
    state,
    elements,
    showToast,
    writeBootMirror,
    DEFAULT_GRADIENT,
    isVideoBackground
  };
  OpenTabBingCache.init(bingHost);
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
      isEditingBlocked: () => sceneReadOnly || sceneInteractionBusy,
      ...workspace,
      state,
      get HOME_FOLDER_ID() { return activeHomeId(); },
      get getSceneView() { return sceneViewAdapter(); },
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

  sceneRuntime = OpenTabSceneRuntime.create({
    state, workspace, applyLoadedState, renderVisible: renderCurrentWorkspace,
    showToast, writeBootMirror, bingHost, mount: document.getElementById('scene-switcher'),
    onLoadStatus(ready) {
      sceneReadOnly = !ready; document.getElementById('homepage').inert = sceneReadOnly || sceneInteractionBusy || Boolean(window.OpenTabZenMode?.isActive());
    },
    onBusy(busy) {
      sceneInteractionBusy = busy; document.getElementById('homepage').inert = sceneReadOnly || sceneInteractionBusy || Boolean(window.OpenTabZenMode?.isActive());
    },
    onDiscardDraft: () => OpenTabSceneHome.discardDraft({
      canDiscard: () => OpenTabSceneHome.canDiscard({ isSaving: iconSaveGate.has(iconDraftIntent), todoAddPending }),
      closeAddIconModal, elements
    }),
    onViewDeferred() { showToast(t('场景已保存，请完成或取消当前编辑后重新选择。')); },
    beforeSwitch: () => OpenTabSceneHome.canSwitch({ isSaving: iconSaveGate.has(iconDraftIntent), todoAddPending, elements }),
    onInvalidate() {
      OpenTabBingCache.invalidatePending(); OpenTabSiteSelection.cancel(false);
      OpenTabFolders.closeOverlay(); hideIconContextMenu();
      toggleTimezoneSelector(false); toggleCalendar(false);
    }
  });

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
