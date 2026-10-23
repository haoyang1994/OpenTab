(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSettingsNav = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Translate only application-owned prose, never stored user content.
  function t(source, params = {}) {
    const i18n = typeof globalThis !== 'undefined' && globalThis.OpenTabI18n;
    return i18n ? i18n.t(source, params) : String(source).replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
  }


  const NARROW_MQ = '(max-width: 719px)';
  const DEVELOPER_TOOLS_KEY = 'developerToolsEnabled';
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const DIALOG_IDS = ['inline-dialog', 'change-icon-modal', 'add-icon-modal', 'folder-overlay', 'settings-panel'];
  const SECTIONS = [
    { id: 'appearance', label: '外观', keywords: 'appearance theme clock opacity blur particle minimal 外观 主题 时钟 界面 粒子 极简 不透明 虚化' },
    { id: 'wallpaper', label: '壁纸', keywords: 'wallpaper background bing gradient image 壁纸 背景 图片 渐变' },
    { id: 'shortcuts', label: '快捷方式与布局', keywords: 'shortcut layout icon size columns grid name keyboard fullscreen 快捷方式 布局 图标 大小 每行 名称 网格 更换图标 图标库 占位 快捷键 全屏' },
    { id: 'search', label: '搜索', keywords: 'search engine history custom 搜索 引擎 历史 自定义' },
    { id: 'weather', label: '天气', keywords: 'weather city location temperature unit 天气 城市 定位 温度' },
    { id: 'sync', label: '导入与同步', keywords: 'import sync backup bookmark snapshot 导入 同步 备份 书签 快照' },
    { id: 'advanced', label: '高级/开发者工具', keywords: 'advanced developer ssh json 高级 开发者 工具' },
    { id: 'about', label: '关于', keywords: 'about version license apache github 关于 版本 许可证' }
  ];

  const DEFAULT_APPEARANCE = {
    clockFormat: '12h',
    showSeconds: false,
    uiOpacity: 32,
    uiBlur: 10,
    themeMode: 'dark',
    accentHue: 200,
    particlesEnabled: false,
    gradientFlow: false,
    minimalMode: false
  };

  let host = null;
  let bound = false;
  let hostedBound = false;
  let trapBound = false;
  let activeId = 'appearance';
  let filterQuery = '';
  let preserveDraftsOnOpen = false;
  let pointerStartedInside = false;
  let dragging = false;
  let developerToolsEnabled = false;
  let developerMigrated = false;

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function normalizeQuery(query) {
    return String(query || '').trim().toLowerCase();
  }

  function textMatches(text, query) {
    const q = normalizeQuery(query);
    if (!q) return true;
    return String(text || '').toLowerCase().indexOf(q) !== -1;
  }

  function sectionSearchText(sectionEl) {
    const marked = sectionEl && sectionEl.getAttribute ? (sectionEl.getAttribute('data-settings-search') || '') : '';
    const visible = sectionEl && sectionEl.innerText ? sectionEl.innerText : '';
    return marked + ' ' + visible;
  }

  function isShown(el) {
    if (!el || el.disabled) return false;
    if (el.hidden) return false;
    if (el.closest && el.closest('.hidden')) return false;
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function focusables(container) {
    if (!container || !container.querySelectorAll) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE)).filter(isShown);
  }

  function dialogRoot(id, el) {
    if (id === 'folder-overlay') return $('folder-panel') || el;
    if (id === 'add-icon-modal' || id === 'change-icon-modal') {
      return (el && el.querySelector && el.querySelector('.modal-content')) || el;
    }
    return el;
  }

  function topDialog() {
    if (typeof document === 'undefined') return null;
    for (let i = 0; i < DIALOG_IDS.length; i += 1) {
      const el = $(DIALOG_IDS[i]);
      if (el && !el.classList.contains('hidden')) return dialogRoot(DIALOG_IDS[i], el);
    }
    return null;
  }

  function onTabTrap(event) {
    if (event.key !== 'Tab') return;
    if (document.getElementById('site-selection-dialog')?.open) return;
    const dialog = topDialog();
    if (!dialog) return;
    const nodes = focusables(dialog);
    if (!nodes.length) {
      event.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindFocusTrap() {
    if (trapBound || typeof document === 'undefined') return;
    trapBound = true;
    document.addEventListener('keydown', onTabTrap, true);
  }

  function panel() {
    return $('settings-panel');
  }

  function content() {
    return $('settings-content');
  }

  function sectionNodes() {
    const root = content();
    if (!root) return [];
    return Array.from(root.querySelectorAll('[data-settings-section]'));
  }

  function metaById(id) {
    return SECTIONS.find((item) => item.id === id) || null;
  }

  function setActive(id, options) {
    if (!id || !metaById(id)) return;
    activeId = id;
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.settings-nav-btn').forEach((btn) => {
      const on = btn.dataset.section === id;
      btn.classList.toggle('active', on);
      if (on) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
    if (options && options.scroll) {
      const target = $('settings-section-' + id) || document.querySelector('[data-settings-section="' + id + '"]');
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
    }
  }

  function applyFilter(query) {
    filterQuery = String(query || '');
    const q = normalizeQuery(filterQuery);
    const nodes = sectionNodes();
    const visibleIds = new Set();
    nodes.forEach((node) => {
      const id = node.getAttribute('data-settings-section');
      const match = textMatches(sectionSearchText(node), q);
      node.classList.toggle('filtered-out', !match);
      if (match && id) visibleIds.add(id);
    });
    document.querySelectorAll('.settings-nav-btn').forEach((btn) => {
      btn.hidden = q ? !visibleIds.has(btn.dataset.section) : false;
    });
    const empty = $('settings-empty');
    const has = visibleIds.size > 0;
    if (empty) empty.classList.toggle('hidden', has);
    const root = content();
    if (root) root.classList.toggle('hidden', !has && !!q);
    return has;
  }

  function buildNav() {
    const nav = $('settings-nav');
    if (!nav || nav.dataset.ready === '1') return;
    nav.dataset.ready = '1';
    SECTIONS.forEach((section) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-nav-btn';
      btn.dataset.section = section.id;
      btn.id = 'settings-nav-' + section.id;
      btn.textContent = t(section.label);
      const first = document.querySelector('[data-settings-section="' + section.id + '"]');
      if (first && first.id) btn.setAttribute('aria-controls', first.id);
      btn.addEventListener('click', () => {
        const search = $('settings-search');
        if (search && search.value) {
          search.value = '';
          applyFilter('');
        }
        setActive(section.id, { scroll: true });
      });
      nav.appendChild(btn);
    });
    setActive(activeId);
  }

  function ensureResetButtons() {
    SECTIONS.forEach((section) => {
      const first = document.querySelector('[data-settings-section="' + section.id + '"]');
      if (!first || first.querySelector('.settings-reset-section')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-small ghost settings-reset-section';
      btn.dataset.section = section.id;
      btn.textContent = t('恢复默认');
      btn.setAttribute('aria-label', t('恢复{section}默认设置', { section: t(section.label) }));
      btn.addEventListener('click', () => { resetWithConfirm(section.id); });
      first.appendChild(btn);
    });
  }

  function fillAbout() {
    const version = $('about-version');
    if (!version) return;
    let label = '';
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        label = chrome.runtime.getManifest().version || '';
      }
    } catch (error) {
      label = '';
    }
    version.textContent = label ? 'v' + label : '';
  }

  function updatePresetSelection() {
    if (!host || !host.state) return;
    document.querySelectorAll('#background-presets .preset-item, #image-presets .preset-item').forEach((preset) => {
      const bgType = preset.dataset.bg || '';
      preset.classList.toggle(
        'active',
        bgType === host.state.background.type && preset.dataset.value === host.state.background.value
      );
    });
  }

  function updateBgTabs() {
    if (!host || !host.state) return;
    const type = host.state.background.type;
    document.querySelectorAll('.tab-btn[data-type]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.type === type);
    });
    ['bing', 'gradient', 'image'].forEach((name) => {
      const section = $(name + '-section');
      if (section) section.classList.toggle('active', type === name);
    });
  }

  function syncFromState() {
    if (!host || !host.state || typeof document === 'undefined') return;
    const state = host.state;
    const timeFormat = $('time-format');
    const showSeconds = $('show-seconds');
    const uiOpacity = $('ui-opacity');
    const uiOpacityValue = $('ui-opacity-value');
    const uiBlur = $('ui-blur');
    const uiBlurValue = $('ui-blur-value');
    const iconFrame = $('icon-frame-enabled');
    const openNew = $('open-in-new-tab');
    const fullscreenShortcut = $('window-fullscreen-shortcut-enabled');
    if (timeFormat) timeFormat.value = state.clockFormat;
    if (showSeconds) showSeconds.checked = state.showSeconds;
    if (uiOpacity) uiOpacity.value = String(state.uiOpacity);
    if (uiOpacityValue) uiOpacityValue.textContent = state.uiOpacity + '%';
    if (uiBlur) uiBlur.value = String(state.uiBlur);
    if (uiBlurValue) uiBlurValue.textContent = state.uiBlur + 'px';
    if (iconFrame) iconFrame.checked = state.iconFrameEnabled;
    if (openNew) openNew.checked = state.openInNewTab;
    if (fullscreenShortcut) fullscreenShortcut.checked = state.windowFullscreenShortcutEnabled === true;
    document.querySelectorAll('.theme-mode-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.theme === state.themeMode);
    });
    document.querySelectorAll('.theme-color-preset').forEach((preset) => {
      preset.classList.toggle('active', Number(preset.dataset.hue) === Number(state.accentHue));
    });
    const particles = $('particles-enabled');
    const flow = $('gradient-flow-enabled');
    const minimal = $('minimal-mode-enabled');
    if (particles) particles.checked = state.particlesEnabled;
    if (flow) flow.checked = state.gradientFlow;
    if (minimal) minimal.checked = state.minimalMode;
    const dev = $('developer-tools-enabled');
    if (dev) dev.checked = developerToolsEnabled;
    updatePresetSelection();
    updateBgTabs();
  }

  function applyDeveloperTools(enabled) {
    developerToolsEnabled = !!enabled;
    if (typeof document === 'undefined') return developerToolsEnabled;
    document.body.classList.toggle('developer-tools-enabled', developerToolsEnabled);
    document.querySelectorAll('[data-dev-tool]').forEach((el) => {
      el.hidden = !developerToolsEnabled;
      if (el.tagName === 'OPTION') el.disabled = !developerToolsEnabled;
    });
    const checkbox = $('developer-tools-enabled');
    if (checkbox) checkbox.checked = developerToolsEnabled;
    return developerToolsEnabled;
  }

  let shortcutRead = 0;
  async function refreshWindowFullscreenShortcut() {
    const output = $('window-fullscreen-shortcut-binding'), ticket = ++shortcutRead;
    if (!output) return;
    try {
      const commands = await chrome.commands.getAll();
      if (ticket !== shortcutRead) return;
      const shortcut = commands.find(command => command.name === 'toggle-window-fullscreen')?.shortcut;
      // Chrome owns the binding, including bindings retained while disabled.
      if (shortcut) output.removeAttribute('data-i18n');
      else output.setAttribute('data-i18n', '未设置');
      output.textContent = shortcut || t('未设置');
    } catch (_) {
      if (ticket === shortcutRead) {
        output.setAttribute('data-i18n', '不可用');
        output.textContent = t('不可用');
      }
    }
  }

  function persistDeveloperTools(enabled) {
    applyDeveloperTools(enabled);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [DEVELOPER_TOOLS_KEY]: developerToolsEnabled });
    }
  }

  function shouldEnableDeveloperTools(icons, stored) {
    if (stored === true) return true;
    if (stored === false) return false;
    return (Array.isArray(icons) ? icons : []).some((icon) => icon && (icon.type === 'ssh' || icon.type === 'tool'));
  }

  function noteIcons(icons) {
    if (developerMigrated && developerToolsEnabled) {
      applyDeveloperTools(true);
      return developerToolsEnabled;
    }
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      applyDeveloperTools(shouldEnableDeveloperTools(icons, undefined));
      return developerToolsEnabled;
    }
    chrome.storage.local.get([DEVELOPER_TOOLS_KEY], (result) => {
      const stored = result ? result[DEVELOPER_TOOLS_KEY] : undefined;
      const enabled = shouldEnableDeveloperTools(icons, stored);
      developerMigrated = true;
      if (stored === undefined && enabled) persistDeveloperTools(true);
      else applyDeveloperTools(enabled);
    });
    return developerToolsEnabled;
  }

  function loadDeveloperTools() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get([DEVELOPER_TOOLS_KEY], (result) => {
      if (result && result[DEVELOPER_TOOLS_KEY] === true) {
        developerMigrated = true;
        applyDeveloperTools(true);
      } else if (result && result[DEVELOPER_TOOLS_KEY] === false) {
        developerMigrated = true;
        applyDeveloperTools(false);
      }
    });
  }

  function confirmDialog(message) {
    if (typeof OpenTabFolders !== 'undefined' && typeof OpenTabFolders.showDialog === 'function') {
      return OpenTabFolders.showDialog(message, [
        { label: t('取消'), value: false },
        { label: t('恢复默认'), value: true, className: 'btn-primary' }
      ]);
    }
    return Promise.resolve(false);
  }

  function takeSnapshot() {
    const state = host && host.state ? host.state : {};
    const layout = typeof OpenTabLayout !== 'undefined' ? OpenTabLayout.get() : {};
    const search = typeof OpenTabSearch !== 'undefined' && OpenTabSearch.getBackupSlice
      ? OpenTabSearch.getBackupSlice()
      : {};
    const weather = typeof OpenTabWeather !== 'undefined' && OpenTabWeather.getBackupSlice
      ? OpenTabWeather.getBackupSlice()
      : null;
    return cloneSnapshot({
      appearance: {
        clockFormat: state.clockFormat,
        showSeconds: state.showSeconds,
        uiOpacity: state.uiOpacity,
        uiBlur: state.uiBlur,
        themeMode: state.themeMode,
        accentHue: state.accentHue,
        particlesEnabled: state.particlesEnabled,
        gradientFlow: state.gradientFlow,
        minimalMode: state.minimalMode
      },
      wallpaper: state.background ? {
        type: state.background.type,
        value: state.background.value,
        source: state.background.source
      } : null,
      bingIndex: state.bingIndex,
      shortcuts: {
        iconFrameEnabled: state.iconFrameEnabled,
        openInNewTab: state.openInNewTab,
        windowFullscreenShortcutEnabled: state.windowFullscreenShortcutEnabled === true
      },
      layout: layout,
      search: search,
      advanced: { developerToolsEnabled: developerToolsEnabled },
      weather: weather,
      browserSyncEnabled: !!(typeof document !== 'undefined' && $('browser-sync-enabled') && $('browser-sync-enabled').checked)
    });
  }

  function cloneSnapshot(value) {
    if (Array.isArray(value)) return value.map(cloneSnapshot);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).map((key) => [key, cloneSnapshot(value[key])]));
    }
    return value;
  }

  function sameSnapshotValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function resetInverse(before, after) {
    const grouped = new Set(['appearance', 'shortcuts', 'layout', 'search', 'advanced', 'weather']);
    const inverse = {};
    Object.keys(before).forEach((section) => {
      if (sameSnapshotValue(before[section], after[section])) return;
      if (grouped.has(section) && before[section] && after[section]) {
        const fields = {};
        Object.keys(before[section]).forEach((key) => {
          if (!sameSnapshotValue(before[section][key], after[section][key])) {
            fields[key] = { before: before[section][key], after: after[section][key] };
          }
        });
        if (Object.keys(fields).length) inverse[section] = { fields };
      } else {
        inverse[section] = { before: before[section], after: after[section] };
      }
    });
    return inverse;
  }

  function applyResetInverse(inverse) {
    const current = takeSnapshot();
    const patch = {};
    for (const [section, change] of Object.entries(inverse)) {
      if (change.fields) {
        const values = Object.assign({}, current[section]);
        for (const [key, field] of Object.entries(change.fields)) {
          if (!sameSnapshotValue(values[key], field.after) && !sameSnapshotValue(values[key], field.before)) return false;
          values[key] = cloneSnapshot(field.before);
        }
        patch[section] = values;
      } else {
        if (!sameSnapshotValue(current[section], change.after) && !sameSnapshotValue(current[section], change.before)) return false;
        patch[section] = cloneSnapshot(change.before);
      }
    }
    // Validate every changed field before touching state or any independent module.
    applySnapshot(patch);
    return true;
  }

  function applyAppearance(values) {
    if (!host || !host.state) return;
    Object.keys(DEFAULT_APPEARANCE).forEach((key) => {
      if (values && values[key] !== undefined) host.state[key] = values[key];
    });
    if (host.applyUiOpacitySetting) host.applyUiOpacitySetting();
    if (host.applyUiBlurSetting) host.applyUiBlurSetting();
    if (host.applyThemeMode) host.applyThemeMode();
    if (host.applyAccentColor) host.applyAccentColor();
    if (host.applyParticles) host.applyParticles();
    if (host.applyGradientFlow) host.applyGradientFlow();
    if (host.applyMinimalMode) host.applyMinimalMode();
    if (host.updateClock) host.updateClock();
  }

  function applyShortcuts(values) {
    if (!host || !host.state || !values) return;
    host.state.iconFrameEnabled = !!values.iconFrameEnabled;
    host.state.openInNewTab = !!values.openInNewTab;
    host.state.windowFullscreenShortcutEnabled = values.windowFullscreenShortcutEnabled === true;
    if (host.applyIconFrameSetting) host.applyIconFrameSetting();
    if (host.renderIconsForCurrentFolder) host.renderIconsForCurrentFolder();
  }

  function applyWallpaper(background) {
    if (!host || !host.state) return;
    const fallback = host.DEFAULT_BACKGROUND || { type: 'bing', value: '', source: '' };
    host.state.background = background ? {
      type: background.type || fallback.type,
      value: background.value || '',
      source: background.source || ''
    } : Object.assign({}, fallback);
    if (host.updateBackground) host.updateBackground();
    if (host.state.background.type === 'bing' && !host.state.background.value && host.fetchRandomBackground) {
      host.fetchRandomBackground();
    }
    updatePresetSelection();
    updateBgTabs();
  }

  function applySnapshot(snap) {
    if (!snap) return;
    if (snap.appearance) applyAppearance(snap.appearance);
    if (snap.shortcuts) applyShortcuts(snap.shortcuts);
    if (Object.prototype.hasOwnProperty.call(snap, 'wallpaper')) applyWallpaper(snap.wallpaper);
    if (snap.layout && typeof OpenTabLayout !== 'undefined') OpenTabLayout.persist(snap.layout);
    if (snap.search && typeof OpenTabSearch !== 'undefined' && OpenTabSearch.replaceSettings) {
      OpenTabSearch.replaceSettings(snap.search, { keepHistory: true });
    }
    if (snap.advanced) persistDeveloperTools(!!snap.advanced.developerToolsEnabled);
    if (snap.weather && typeof OpenTabWeather !== 'undefined' && OpenTabWeather.replaceSettings) {
      OpenTabWeather.replaceSettings(snap.weather);
    }
    if (Object.prototype.hasOwnProperty.call(snap, 'browserSyncEnabled')
      && typeof OpenTabSync !== 'undefined' && OpenTabSync.setEnabled) {
      OpenTabSync.setEnabled(!!snap.browserSyncEnabled);
    }
    if (host && host.saveState) host.saveState();
    syncFromState();
  }

  function resetSection(id) {
    if (id === 'appearance') applyAppearance(DEFAULT_APPEARANCE);
    else if (id === 'wallpaper') applyWallpaper(host && host.DEFAULT_BACKGROUND);
    else if (id === 'shortcuts') {
      applyShortcuts({ iconFrameEnabled: false, openInNewTab: false, windowFullscreenShortcutEnabled: false });
      if (typeof OpenTabLayout !== 'undefined') OpenTabLayout.reset();
    } else if (id === 'search') {
      if (typeof OpenTabSearch !== 'undefined' && OpenTabSearch.resetToDefaults) {
        OpenTabSearch.resetToDefaults({ keepHistory: true });
      }
    } else if (id === 'weather') {
      if (typeof OpenTabWeather !== 'undefined' && OpenTabWeather.resetToDefaults) {
        OpenTabWeather.resetToDefaults();
      }
    } else if (id === 'sync') {
      if (typeof OpenTabSync !== 'undefined' && OpenTabSync.setEnabled) OpenTabSync.setEnabled(false);
    } else if (id === 'advanced') {
      persistDeveloperTools(false);
    } else if (id === 'about') {
      return;
    }
    if (host && host.saveState) host.saveState();
    syncFromState();
  }

  function resetAll() {
    SECTIONS.forEach((section) => {
      if (section.id !== 'about' && section.id !== 'sync') resetSection(section.id);
    });
  }

  function resetWithConfirm(sectionId) {
    const intent = host && host.captureIntent ? host.captureIntent() : null;
    const intentIsCurrent = () => !intent || !host || !host.isIntentCurrent || host.isIntentCurrent(intent);
    const message = sectionId === 'sync'
      ? t('恢复该分区的默认设置？会关闭浏览器同步。快捷方式不会改动。')
      : sectionId
        ? t('恢复该分区的默认设置？快捷方式不会改动。')
        : t('恢复全部设置为默认？快捷方式不会改动。');
    return confirmDialog(message).then((ok) => {
      if (!ok) return false;
      if (!intentIsCurrent()) {
        if (host && host.showToast) host.showToast(t('内容已变化，请重新选择恢复默认。'));
        return false;
      }
      const snap = takeSnapshot();
      if (sectionId) resetSection(sectionId);
      else resetAll();
      const after = takeSnapshot();
      // setEnabled updates its checkbox only after storage resolves.
      if (sectionId === 'sync') after.browserSyncEnabled = false;
      const inverse = resetInverse(snap, after);
      if (host && host.showToast) {
        host.showToast(t('已恢复默认'), {
          actionLabel: t('撤销'),
          onAction: () => {
            if (!intentIsCurrent() || !applyResetInverse(inverse)) {
              if (host.showToast) host.showToast(t('相关设置已变化，无法安全撤销。'));
              return false;
            }
            if (host.showToast) host.showToast(t('已恢复'), { duration: 1500 });
            return true;
          },
          duration: 6000
        });
      }
      return true;
    });
  }

  function open(options = {}) {
    const el = panel();
    if (!el) return;
    if (!el.classList.contains('hidden')) return;
    if (host && host.rememberFocus) host.rememberFocus(options.opener || $('settings-btn'));
    el.classList.remove('hidden');
    buildNav();
    ensureResetButtons();
    fillAbout();
    syncFromState();
    const search = $('settings-search');
    void refreshWindowFullscreenShortcut();
    if (search) {
      if (!preserveDraftsOnOpen) search.value = '';
      applyFilter(search.value);
      search.focus();
    }
    preserveDraftsOnOpen = false;
    setActive(activeId);
  }

  function openSection(id) {
    if (!metaById(id) || (id === 'advanced' && !developerToolsEnabled) || !panel()) return false;
    open();
    // Explicit navigation must reveal its destination even after a preserved
    // filter, or when a different settings section is already open.
    const search = $('settings-search');
    if (search) search.value = '';
    applyFilter('');
    setActive(id, { scroll: true });
    return true;
  }

  function close(options = {}) {
    if (globalThis.OpenTabSiteList?.isBusy()) return false;
    const el = panel();
    if (!el || el.classList.contains('hidden')) return false;
    const search = $('settings-search');
    preserveDraftsOnOpen = options.preserveDrafts === true;
    if (!preserveDraftsOnOpen) {
      if (search) search.value = '';
      applyFilter('');
    }
    el.classList.add('hidden');
    if (host && host.restoreFocus) host.restoreFocus();
    return true;
  }

  // Capture before background controls see a dismissal gesture. Close on click,
  // not pointerdown: a cancelled touch or a slider drag must not dismiss settings.
  function hasNestedLayer() {
    return DIALOG_IDS.filter(id => id !== 'settings-panel').some(id => {
      const node = $(id);
      return node && isShown(node);
    }) || !!document.querySelector('dialog[open], .flatpickr-calendar.open')
      || ['icon-context-menu', 'timezone-selector', 'calendar-popover', 'command-palette'].some(id => {
        const node = $(id);
        return node && isShown(node);
      });
  }

  function consumeOutsideEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onOutsidePointerDown(event) {
    pointerStartedInside = false;
    const el = panel();
    if (!el || el.classList.contains('hidden') || event.button !== 0 || hasNestedLayer()) return;
    pointerStartedInside = el.contains(event.target);
    if (pointerStartedInside || dragging) return;
    consumeOutsideEvent(event);
  }

  function onOutsideClick(event) {
    // Application-generated clicks (for example backup download anchors) are
    // not user dismissal gestures and must keep their existing behavior.
    if (event.isTrusted === false) return;
    const startedInside = pointerStartedInside;
    pointerStartedInside = false;
    const el = panel();
    if (!el || el.classList.contains('hidden') || event.button > 0 || hasNestedLayer()) return;
    if (el.contains(event.target)) return;
    // Even a gesture that cannot dismiss must not activate an underlying link.
    consumeOutsideEvent(event);
    if (startedInside || dragging) return;
    if (globalThis.OpenTabSiteList?.isBusy() || el.querySelector('[aria-busy="true"]')) return;
    // Keyboard/AT clicks have no preceding pointerdown and are handled too.
    close({ preserveDrafts: true });
  }

  function bindOutsideDismissal() {
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('pointercancel', () => {
      pointerStartedInside = false;
    }, true);
    document.addEventListener('dragstart', () => { dragging = true; }, true);
    document.addEventListener('dragend', () => { dragging = false; }, true);
    document.addEventListener('drop', () => { dragging = false; }, true);
  }

  function handleEscape() {
    const modal = $('add-icon-modal');
    const changer = $('change-icon-modal');
    const menu = $('icon-context-menu');
    const dialog = $('inline-dialog');
    if ((modal && !modal.classList.contains('hidden'))
      || (changer && !changer.classList.contains('hidden'))
      || (menu && !menu.classList.contains('hidden'))
      || (dialog && !dialog.classList.contains('hidden'))) {
      return false;
    }
    const el = panel();
    if (!el || el.classList.contains('hidden')) return false;
    if (globalThis.OpenTabSiteList?.isBusy()) return true;
    const search = $('settings-search');
    if (search && search.value) {
      search.value = '';
      applyFilter('');
      return 'search';
    }
    close();
    return true;
  }

  function onContentScroll() {
    if (normalizeQuery(filterQuery)) return;
    const root = content();
    if (!root) return;
    const nodes = sectionNodes().filter((node) => !node.classList.contains('filtered-out'));
    if (!nodes.length) return;
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 8) {
      setActive(nodes[nodes.length - 1].getAttribute('data-settings-section'));
      return;
    }
    const top = root.getBoundingClientRect().top;
    let current = activeId;
    nodes.forEach((node) => {
      if (node.getBoundingClientRect().top - top <= 80) current = node.getAttribute('data-settings-section');
    });
    if (current) setActive(current);
  }

  function bindHostedControls() {
    if (!host || hostedBound) return;
    hostedBound = true;
    const fullscreenShortcut = $('window-fullscreen-shortcut-enabled');
    if (fullscreenShortcut) fullscreenShortcut.addEventListener('change', async () => {
      fullscreenShortcut.disabled = true;
      host.state.windowFullscreenShortcutEnabled = fullscreenShortcut.checked === true;
      try { await host.saveState(); }
      catch (_) { host.showToast?.(t('保存失败，请重试。')); }
      finally { fullscreenShortcut.disabled = false; syncFromState(); }
    });
    const manageShortcut = $('manage-window-fullscreen-shortcut');
    if (manageShortcut) manageShortcut.addEventListener('click', async () => {
      try { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); }
      catch (_) { host.showToast?.(t('未能打开快捷键设置。')); }
    });
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', () => {
      if (panel() && !panel().classList.contains('hidden')) void refreshWindowFullscreenShortcut();
    });
    const timeFormat = $('time-format');
    if (timeFormat) {
      timeFormat.addEventListener('change', () => {
        host.state.clockFormat = timeFormat.value;
        host.saveState();
        if (host.updateClock) host.updateClock();
      });
    }
    const showSeconds = $('show-seconds');
    if (showSeconds) {
      showSeconds.addEventListener('change', () => {
        host.state.showSeconds = showSeconds.checked;
        host.saveState();
        if (host.updateClock) host.updateClock();
      });
    }
    const uiOpacity = $('ui-opacity');
    if (uiOpacity) {
      const onOpacity = () => {
        host.state.uiOpacity = Number(uiOpacity.value || 32);
        if (host.applyUiOpacitySetting) host.applyUiOpacitySetting();
        host.saveState();
        syncFromState();
      };
      uiOpacity.addEventListener('input', onOpacity);
      uiOpacity.addEventListener('change', onOpacity);
    }
    const uiBlur = $('ui-blur');
    if (uiBlur) {
      const onBlur = () => {
        host.state.uiBlur = Number(uiBlur.value || 10);
        if (host.applyUiBlurSetting) host.applyUiBlurSetting();
        host.saveState();
        syncFromState();
      };
      uiBlur.addEventListener('input', onBlur);
      uiBlur.addEventListener('change', onBlur);
    }
    const iconFrame = $('icon-frame-enabled');
    if (iconFrame) {
      iconFrame.addEventListener('change', () => {
        host.state.iconFrameEnabled = iconFrame.checked;
        if (host.applyIconFrameSetting) host.applyIconFrameSetting();
        host.saveState();
      });
    }
    const openNew = $('open-in-new-tab');
    if (openNew) {
      openNew.addEventListener('change', () => {
        host.state.openInNewTab = openNew.checked;
        host.saveState();
        if (host.renderIconsForCurrentFolder) host.renderIconsForCurrentFolder();
      });
    }
    document.querySelectorAll('.theme-mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        host.state.themeMode = tab.dataset.theme;
        if (host.applyThemeMode) host.applyThemeMode();
        host.saveState();
        syncFromState();
      });
    });
    document.querySelectorAll('.theme-color-preset').forEach((preset) => {
      const applyHue = () => {
        host.state.accentHue = Number(preset.dataset.hue);
        if (host.applyAccentColor) host.applyAccentColor();
        host.saveState();
        syncFromState();
      };
      preset.addEventListener('click', applyHue);
      preset.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        applyHue();
      });
    });
    const particles = $('particles-enabled');
    if (particles) {
      particles.addEventListener('change', () => {
        host.state.particlesEnabled = particles.checked;
        if (host.applyParticles) host.applyParticles();
        host.saveState();
      });
    }
    const flow = $('gradient-flow-enabled');
    if (flow) {
      flow.addEventListener('change', () => {
        host.state.gradientFlow = flow.checked;
        if (host.applyGradientFlow) host.applyGradientFlow();
        host.saveState();
      });
    }
    const minimal = $('minimal-mode-enabled');
    if (minimal) {
      minimal.addEventListener('change', () => {
        host.state.minimalMode = minimal.checked;
        if (host.applyMinimalMode) host.applyMinimalMode();
        host.saveState();
      });
    }
    document.querySelectorAll('.tab-btn[data-type]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const type = tab.dataset.type;
        const previous = host.state.background.type;
        host.state.background.type = type;
        if (type === 'bing') {
          if (!host.state.background.value || previous !== 'bing') {
            if (host.fetchRandomBackground) host.fetchRandomBackground();
          } else if (host.updateBackground) host.updateBackground();
        } else if (type === 'gradient') {
          host.state.background.value = host.DEFAULT_GRADIENT || host.state.background.value;
          host.state.background.source = 'gradient';
          if (host.updateBackground) host.updateBackground();
        }
        host.saveState();
        updateBgTabs();
        updatePresetSelection();
      });
    });
    const onPreset = (event) => {
      const preset = event.target.closest('.preset-item');
      if (!preset) return;
      const bgType = preset.dataset.bg || 'gradient';
      host.state.background = {
        type: bgType === 'gradient' ? 'gradient' : 'image',
        value: preset.dataset.value,
        source: bgType === 'gradient' ? 'gradient' : 'preset-image'
      };
      host.saveState();
      if (host.updateBackground) host.updateBackground();
      updatePresetSelection();
      updateBgTabs();
    };
    const presets = $('background-presets');
    const images = $('image-presets');
    const onPresetKey = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!event.target.closest || !event.target.closest('.preset-item')) return;
      event.preventDefault();
      onPreset(event);
    };
    if (presets) {
      presets.addEventListener('click', onPreset);
      presets.addEventListener('keydown', onPresetKey);
    }
    if (images) {
      images.addEventListener('click', onPreset);
      images.addEventListener('keydown', onPresetKey);
    }
    const applyBg = $('apply-bg-btn');
    if (applyBg) {
      applyBg.addEventListener('click', () => {
        const raw = ($('custom-bg-url') && $('custom-bg-url').value || '').trim();
        if (!raw) return;
        let url;
        try {
          url = host.normalizeUrl(raw);
        } catch (error) {
          if (host.showToast) host.showToast(t('请输入有效的图片网址。'));
          if ($('custom-bg-url')) $('custom-bg-url').focus();
          return;
        }
        host.state.background = { type: 'image', value: url, source: 'custom' };
        host.saveState();
        if (host.updateBackground) host.updateBackground();
        updateBgTabs();
        updatePresetSelection();
      });
    }
    const applyFile = $('apply-bg-file-btn');
    if (applyFile) {
      applyFile.addEventListener('click', async () => {
        const input = $('custom-bg-file');
        const file = input && input.files && input.files[0];
        if (!file) {
          if (input) input.click();
          return;
        }
        try {
          const dataUrl = await host.readFileAsDataUrl(file);
          if (!dataUrl) return;
          host.state.background = { type: 'image', value: dataUrl, source: 'local-upload' };
          host.saveState();
          if (host.updateBackground) host.updateBackground();
          updateBgTabs();
          updatePresetSelection();
        } catch (error) {
          if (host.showToast) host.showToast(t('读取本地图片失败，请重试。'));
        }
      });
    }
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (host.state.themeMode === 'auto' && host.applyThemeMode) host.applyThemeMode();
      });
    }
    const dev = $('developer-tools-enabled');
    if (dev) {
      dev.addEventListener('change', () => persistDeveloperTools(dev.checked));
    }
  }

  function bindPanel() {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    bindOutsideDismissal();
    const settingsBtn = $('settings-btn');
    const closeBtn = $('close-settings');
    const search = $('settings-search');
    const resetAllBtn = $('settings-reset-all');
    const root = content();
    if (settingsBtn) settingsBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (search) {
      search.addEventListener('input', () => applyFilter(search.value));
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !search.value) return;
        event.preventDefault();
        event.stopPropagation();
        search.value = '';
        applyFilter('');
      }, true);
    }
    if (resetAllBtn) resetAllBtn.addEventListener('click', () => { resetWithConfirm(''); });
    if (root) root.addEventListener('scroll', onContentScroll);
    document.addEventListener('opentab-sync-applied', () => {
      loadDeveloperTools();
      syncFromState();
    });
  }

  function init(nextHost) {
    host = nextHost || host;
    bindFocusTrap();
    bindPanel();
    buildNav();
    ensureResetButtons();
    fillAbout();
    bindHostedControls();
    loadDeveloperTools();
    syncFromState();
    if (host && host.state) noteIcons(host.state.icons);
    void refreshWindowFullscreenShortcut();
  }

  if (typeof document !== 'undefined') {
    bindFocusTrap();
    const start = () => {
      const bind = () => {
        bindPanel();
        buildNav();
        ensureResetButtons();
        fillAbout();
      };
      if (globalThis.OpenTabI18n) globalThis.OpenTabI18n.ready.then(bind);
      else bind();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return {
    SECTIONS,
    DEFAULT_APPEARANCE,
    DEVELOPER_TOOLS_KEY,
    NARROW_MQ,
    normalizeQuery,
    textMatches,
    shouldEnableDeveloperTools,
    applyDeveloperTools,
    persistDeveloperTools,
    noteIcons,
    syncFromState,
    applyFilter,
    setActive,
    open,
    openSection,
    close,
    handleEscape,
    init,
    isDeveloperToolsEnabled: () => developerToolsEnabled,
    getActiveId: () => activeId
  };
}));
