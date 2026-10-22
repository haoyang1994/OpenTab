(function (global) {
  const t = (s, p) => globalThis.OpenTabI18n ? globalThis.OpenTabI18n.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p?.[k] ?? m);

  const STORAGE_KEYS = [
    'searchEngine',
    'customSearchEngines',
    'searchOpenInNewTab',
    'searchHistoryEnabled',
    'searchHistory'
  ];

  const MAX_HISTORY = 20;
  const MAX_SAVED_SITES = 5;
  const MAX_CUSTOM_ENGINES = 12;
  const BUILTIN_ENGINES = [
    { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s' },
    { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s' },
    { id: 'baidu', name: '百度', template: 'https://www.baidu.com/s?wd=%s' },
    { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
    { id: 'github', name: 'GitHub', template: 'https://github.com/search?q=%s&type=repositories' }
  ];

  const OVERLAY_SELECTORS = [
    '#command-palette:not(.hidden)',
    '#settings-panel:not(.hidden)',
    '#add-icon-modal:not(.hidden)',
    '#timezone-selector:not(.hidden)',
    '#calendar-popover:not(.hidden)',
    '#folder-overlay:not(.hidden)',
    '#inline-dialog:not(.hidden)',
    '#icon-context-menu:not(.hidden)',
    '#change-icon-modal:not(.hidden)'
  ];

  const searchState = {
    searchEngine: 'google',
    customSearchEngines: [],
    searchOpenInNewTab: false,
    searchHistoryEnabled: true,
    searchHistory: []
  };

  let callbacks = {
    getIcons: () => [],
    getFolders: () => [],
    openMatchedIcon: null
  };
  let historyHighlight = -1;
  let displayedSuggestions = [];
  let editingCustomId = '';
  let hideHistoryTimer = 0;
  let bound = false;

  const api = {
    STORAGE_KEYS,
    lastNavigation: null,
    navigateHook: null,
    getBackupSlice,
    normalizeBackup,
    applyFromStorage: loadFromStorage,
    replaceSettings,
    resetToDefaults,
    init,
    resolve,
    listEngines,
    selectEngine,
    // Only the current loaded workspace is exposed. The palette never receives
    // an arbitrary-navigation API or maintains a second search/storage index.
    commandPalette: {
      listSites: (query, limit = 20) => matchingSites(query, { includeEmpty: true, includeLocation: true, limit: paletteLimit(limit) }),
      listGroups: (query, limit = 20) => matchingGroups(query).slice(0, paletteLimit(limit)),
      validateSite: validatedSite,
      validateGroup: validatedGroup,
      openSite(item, forceNewTab) {
        const fresh = validatedSite(item);
        if (!fresh) return false;
        hideHistory();
        navigate(fresh.url, forceNewTab);
        return true;
      }
    },
    getState: () => ({
      searchEngine: searchState.searchEngine,
      customSearchEngines: searchState.customSearchEngines.map((item) => ({ ...item })),
      searchOpenInNewTab: searchState.searchOpenInNewTab,
      searchHistoryEnabled: searchState.searchHistoryEnabled,
      searchHistory: searchState.searchHistory.map((item) => ({ ...item }))
    })
  };

  function $(id) {
    return document.getElementById(id);
  }

  function generateId() {
    return `cse-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function builtinById(id) {
    return BUILTIN_ENGINES.find((engine) => engine.id === id) || null;
  }

  function customById(id) {
    return searchState.customSearchEngines.find((engine) => engine.id === id) || null;
  }

  function engineList() {
    return BUILTIN_ENGINES.concat(searchState.customSearchEngines);
  }

  function listEngines() {
    return engineList().map((engine) => ({
      id: engine.id,
      name: engineLabel(engine.id),
      template: engine.template
    }));
  }

  function engineIds() {
    return engineList().map((engine) => engine.id);
  }

  function engineLabel(id) {
    const engine = engineList().find((item) => item.id === id);
    return engine ? (builtinById(id) ? t(engine.name) : engine.name) : id;
  }

  function copyHistory(list) {
    return (Array.isArray(list) ? list : []).map((item) => ({
      q: String(item.q || ''),
      engine: String(item.engine || 'google'),
      at: Number(item.at) || 0
    })).filter((item) => item.q);
  }

  function normalizeCustomEngines(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set(BUILTIN_ENGINES.map((engine) => engine.id));
    const out = [];
    raw.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const name = String(item.name || '').trim().slice(0, 40);
      const template = String(item.template || item.urlTemplate || '').trim();
      const id = String(item.id || '').trim() || generateId();
      if (!name || !isValidTemplate(template) || seen.has(id)) return;
      seen.add(id);
      out.push({ id, name, template });
    });
    return out.slice(0, MAX_CUSTOM_ENGINES);
  }

  function normalizeHistory(raw) {
    const seen = new Set();
    const out = [];
    copyHistory(raw).forEach((item) => {
      const key = item.q.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out.slice(0, MAX_HISTORY);
  }

  function normalizeBackup(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const customSearchEngines = normalizeCustomEngines(source.customSearchEngines);
    const ids = new Set(BUILTIN_ENGINES.map((engine) => engine.id).concat(customSearchEngines.map((engine) => engine.id)));
    const searchEngine = ids.has(source.searchEngine) ? source.searchEngine : 'google';
    return {
      searchEngine,
      customSearchEngines,
      searchOpenInNewTab: Boolean(source.searchOpenInNewTab),
      searchHistoryEnabled: source.searchHistoryEnabled !== false,
      searchHistory: normalizeHistory(source.searchHistory)
    };
  }

  function getBackupSlice() {
    return {
      searchEngine: searchState.searchEngine,
      customSearchEngines: searchState.customSearchEngines.map((item) => ({ ...item })),
      searchOpenInNewTab: searchState.searchOpenInNewTab,
      searchHistoryEnabled: searchState.searchHistoryEnabled,
      searchHistory: searchState.searchHistory.map((item) => ({ ...item }))
    };
  }

  function persist() {
    if (!global.chrome || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.set(getBackupSlice());
  }

  function replaceSettings(slice, options) {
    const keepHistory = !options || options.keepHistory !== false;
    const incoming = slice && typeof slice === 'object' ? slice : {};
    applySlice({
      searchEngine: incoming.searchEngine,
      customSearchEngines: incoming.customSearchEngines,
      searchOpenInNewTab: incoming.searchOpenInNewTab,
      searchHistoryEnabled: incoming.searchHistoryEnabled,
      searchHistory: keepHistory ? searchState.searchHistory : incoming.searchHistory
    });
    persist();
    renderAll();
  }

  function resetToDefaults(options) {
    replaceSettings({
      searchEngine: 'google',
      customSearchEngines: [],
      searchOpenInNewTab: false,
      searchHistoryEnabled: true
    }, options);
  }

  function applySlice(slice) {
    const normalized = normalizeBackup(slice);
    searchState.searchEngine = normalized.searchEngine;
    searchState.customSearchEngines = normalized.customSearchEngines;
    searchState.searchOpenInNewTab = normalized.searchOpenInNewTab;
    searchState.searchHistoryEnabled = normalized.searchHistoryEnabled;
    searchState.searchHistory = normalized.searchHistory;
  }

  function isValidTemplate(template) {
    const value = String(template || '').trim();
    if (!value.includes('%s')) return false;
    if (!/^https?:\/\//i.test(value)) return false;
    try {
      const sample = value.replace(/%s/g, encodeURIComponent('opentab'));
      const url = new URL(sample);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function templateError(template) {
    const value = String(template || '').trim();
    if (!value) return t('请填写包含 %s 的 http(s) 地址。');
    if (!/^https?:\/\//i.test(value)) return t('自定义引擎地址必须是 http 或 https。');
    if (!value.includes('%s')) return t('自定义引擎地址必须包含 %s，用于替换关键词。');
    if (!isValidTemplate(value)) return t('自定义引擎地址无效，请检查后重试。');
    return '';
  }

  function applyTemplate(template, keyword) {
    return String(template).replace(/%s/g, encodeURIComponent(keyword));
  }

  function buildSearchUrl(engineId, keyword) {
    const builtin = builtinById(engineId);
    if (builtin) return applyTemplate(builtin.template, keyword);
    const custom = customById(engineId);
    if (custom) return applyTemplate(custom.template, keyword);
    return applyTemplate(BUILTIN_ENGINES[0].template, keyword);
  }

  function looksLikeDirectUrl(raw) {
    const input = String(raw || '').trim();
    if (!input || /\s/.test(input)) return false;

    if (/^https?:\/\//i.test(input)) {
      try {
        const url = new URL(input);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch (error) {
        return false;
      }
    }

    if (/^localhost(?::\d+)?(?:[/?#].*)?$/i.test(input)) return true;
    if (/^127\.0\.0\.1(?::\d+)?(?:[/?#].*)?$/.test(input)) return true;

    const ipv4 = input.match(/^(\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#].*)?$/);
    if (ipv4) {
      const host = input.split(/[/:?#]/)[0];
      const ok = host.split('.').every((part) => {
        if (!/^\d{1,3}$/.test(part)) return false;
        const n = Number(part);
        return n >= 0 && n <= 255;
      });
      if (ok) return true;
    }

    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d+)?(?:[/?#].*)?$/i.test(input)) {
      return false;
    }
    const host = input.split(/[/:?#]/)[0].split(':')[0];
    const tld = host.split('.').pop() || '';
    return /^[a-z]{2,}$/i.test(tld);
  }

  function toDirectUrl(raw) {
    const input = String(raw || '').trim();
    if (/^https?:\/\//i.test(input)) return input;
    if (/^localhost/i.test(input) || /^127\.0\.0\.1/.test(input) || /^(\d{1,3}\.){3}\d{1,3}/.test(input)) {
      return `http://${input}`;
    }
    return `https://${input}`;
  }

  function findShortcut(query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return null;
    const icons = typeof callbacks.getIcons === 'function' ? callbacks.getIcons() : [];
    if (!Array.isArray(icons)) return null;
    return icons.find((icon) => icon && String(icon.name || '').trim().toLowerCase() === needle) || null;
  }

  function savedSiteRecord(icon, index) {
    if (!icon || (icon.type || 'shortcut') !== 'shortcut') return null;
    const name = String(icon.name || '').trim();
    const url = String(icon.url || '').trim();
    if (!name || !/^https?:\/\//i.test(url)) return null;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
      // Snapshot displayed fields, not the mutable workspace record.
      return { type: 'site', id: icon.id, name, url, domain: parsed.host,
        folderId: icon.folderId || '', parentId: icon.parentId || '', index, source: icon };
    } catch (error) {
      return null;
    }
  }

  function siteLocation(site, icons, folders) {
    const group = folders.find((folder) => folder && folder.id === site.folderId);
    const parts = [group ? String(group.name || '') : t(site.folderId === 'folder-home' ? '主页' : '分组')];
    const ancestors = [];
    const seen = new Set();
    let parentId = site.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const folder = icons.find((icon) => icon && icon.id === parentId && icon.type === 'folder' && icon.folderId === site.folderId);
      if (!folder) break;
      ancestors.unshift(String(folder.name || t('文件夹')));
      parentId = folder.parentId;
    }
    return parts.concat(ancestors).filter(Boolean).join(' / ');
  }

  function paletteLimit(limit) {
    return Math.max(1, Math.min(100, Math.floor(Number(limit)) || 20));
  }

  function loadedWorkspace() {
    const icons = callbacks.getIcons();
    const folders = callbacks.getFolders();
    return { icons: Array.isArray(icons) ? icons : [], folders: Array.isArray(folders) ? folders : [] };
  }

  function matchingSites(query, options = {}) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle && !options.includeEmpty) return [];
    const { icons, folders } = loadedWorkspace();
    const matches = icons.map(savedSiteRecord).filter(Boolean).map((site) => {
      const name = site.name.toLowerCase();
      const location = siteLocation(site, icons, folders);
      const rank = !needle || name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 :
        site.domain.toLowerCase().includes(needle) ? 3 : options.includeLocation && location.toLowerCase().includes(needle) ? 4 : -1;
      return { ...site, location, rank, query: needle };
    }).filter((site) => site.rank >= 0).sort((a, b) => a.rank - b.rank || a.index - b.index);
    return options.limit ? matches.slice(0, options.limit) : matches;
  }

  function savedSiteMatches(query) {
    return matchingSites(query, { limit: MAX_SAVED_SITES });
  }

  function matchingGroups(query) {
    const needle = String(query || '').trim().toLowerCase();
    return loadedWorkspace().folders.filter((group) => group && group.id && String(group.name || '').trim())
      .map((group, index) => {
        const name = String(group.name);
        const lower = name.toLowerCase();
        const rank = !needle || lower === needle ? 0 : lower.startsWith(needle) ? 1 : lower.includes(needle) ? 2 : -1;
        return { type: 'group', id: group.id, name, rank, index };
      }).filter((group) => group.rank >= 0).sort((a, b) => a.rank - b.rank || a.index - b.index);
  }

  function validatedGroup(item) {
    if (!item || item.type !== 'group' || !item.id) return null;
    const matches = loadedWorkspace().folders.filter((group) => group && group.id === item.id);
    if (matches.length !== 1 || String(matches[0].name || '') !== item.name) return null;
    return { type: 'group', id: item.id, name: item.name };
  }

  function validatedSite(item) {
    if (!item || item.type !== 'site') return null;
    const { icons, folders } = loadedWorkspace();
    const matches = icons.filter((icon) => icon && (item.id ? icon.id === item.id : icon === item.source));
    if (matches.length !== 1) return null;
    const fresh = savedSiteRecord(matches[0], 0);
    // Revalidate the displayed snapshot separately from the inline input query.
    // Imports, edits, moves, and deletes cannot redirect a stale selection.
    if (!fresh || fresh.id !== item.id || fresh.name !== item.name || fresh.url !== item.url ||
        fresh.folderId !== item.folderId || fresh.parentId !== item.parentId ||
        siteLocation(fresh, icons, folders) !== item.location) return null;
    return fresh;
  }

  function openSavedSite(item, forceNewTab) {
    const input = inputEl();
    const fresh = validatedSite(item);
    if (!input || input.value.trim().toLowerCase() !== item.query || !fresh) {
      historyHighlight = -1;
      updateHint();
      renderHistory();
      return;
    }
    hideHistory();
    navigate(fresh.url, forceNewTab);
  }

  function resolve(query) {
    const keyword = String(query || '').trim();
    if (!keyword) return { type: 'empty' };

    const icon = findShortcut(keyword);
    if (icon) {
      const type = icon.type || 'shortcut';
      if (type === 'shortcut' && icon.url) {
        return { type: 'shortcut', url: icon.url, name: icon.name, icon };
      }
      return { type: 'shortcut', name: icon.name, icon };
    }

    if (looksLikeDirectUrl(keyword)) {
      return { type: 'url', url: toDirectUrl(keyword) };
    }

    return {
      type: 'search',
      engine: searchState.searchEngine,
      url: buildSearchUrl(searchState.searchEngine, keyword)
    };
  }

  function navigate(url, forceNewTab) {
    const openInNewTab = Boolean(forceNewTab) || searchState.searchOpenInNewTab;
    api.lastNavigation = { url, openInNewTab };
    if (typeof api.navigateHook === 'function') {
      api.navigateHook(url, openInNewTab);
      return;
    }
    if (openInNewTab) {
      global.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    global.location.assign(url);
  }

  function recordHistory(query, engineId) {
    if (!searchState.searchHistoryEnabled) return;
    const q = String(query || '').trim();
    if (!q) return;
    const key = q.toLowerCase();
    searchState.searchHistory = [
      { q, engine: engineId || searchState.searchEngine, at: Date.now() },
      ...searchState.searchHistory.filter((item) => item.q.toLowerCase() !== key)
    ].slice(0, MAX_HISTORY);
    persist();
    renderHistory();
  }

  function isOverlayOpen() {
    return OVERLAY_SELECTORS.some((selector) => document.querySelector(selector));
  }

  function isEditable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return Boolean(el.closest && el.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function isInteractiveTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (typeof el.closest !== 'function') return false;
    return Boolean(el.closest('button, a[href], [role="button"], summary, [tabindex]'));
  }

  function isImeKeydown(event) {
    if (!event) return false;
    if (event.key === 'Process') return true;
    return event.keyCode === 229 || event.which === 229;
  }

  function shouldIgnoreTypeToSearch(target) {
    if (isOverlayOpen()) return true;
    if (isEditable(target) && target !== inputEl()) return true;
    if (isInteractiveTarget(target)) return true;
    return false;
  }

  function inputEl() {
    return $('search-input');
  }

  function selectEngine(id, options) {
    const next = engineIds().includes(id) ? id : 'google';
    searchState.searchEngine = next;
    persist();
    renderEngineButtons();
    renderDefaultEngineSelect();
    const input = inputEl();
    if ((!options || options.focus !== false) && input) input.focus();
  }

  function cycleEngine(step) {
    const ids = engineIds();
    if (!ids.length) return;
    const current = ids.indexOf(searchState.searchEngine);
    const index = current < 0 ? 0 : (current + step + ids.length) % ids.length;
    selectEngine(ids[index], { focus: true });
  }

  function renderEngineButtons() {
    document.querySelectorAll('#search-engine-switch .engine-btn').forEach((btn) => {
      const active = btn.dataset.engine === searchState.searchEngine;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function renderCustomEngineButtons() {
    const host = $('search-custom-engines');
    if (!host) return;
    host.innerHTML = '';
    searchState.customSearchEngines.forEach((engine) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'engine-btn custom-engine';
      btn.dataset.engine = engine.id;
      btn.title = engine.name;
      btn.setAttribute('aria-label', engine.name);
      const letter = (engine.name || '?').trim().slice(0, 1).toUpperCase();
      btn.textContent = letter || '?';
      btn.addEventListener('click', () => selectEngine(engine.id));
      host.appendChild(btn);
    });
    renderEngineButtons();
  }

  function renderDefaultEngineSelect() {
    const select = $('search-default-engine');
    if (!select) return;
    const current = searchState.searchEngine;
    select.innerHTML = '';
    engineList().forEach((engine) => {
      const option = document.createElement('option');
      option.value = engine.id;
      option.textContent = engineLabel(engine.id);
      select.appendChild(option);
    });
    select.value = engineIds().includes(current) ? current : 'google';
  }

  function renderSettingsToggles() {
    const openNewTab = $('search-open-new-tab');
    const historyEnabled = $('search-history-enabled');
    if (openNewTab) openNewTab.checked = searchState.searchOpenInNewTab;
    if (historyEnabled) historyEnabled.checked = searchState.searchHistoryEnabled;
  }

  function renderCustomList() {
    const list = $('search-custom-list');
    if (!list) return;
    list.innerHTML = '';
    if (!searchState.customSearchEngines.length) {
      const empty = document.createElement('li');
      empty.className = 'search-custom-empty';
      empty.textContent = t('还没有自定义引擎');
      list.appendChild(empty);
      return;
    }
    searchState.customSearchEngines.forEach((engine) => {
      const item = document.createElement('li');
      item.className = 'search-custom-item';
      item.dataset.id = engine.id;

      const meta = document.createElement('div');
      meta.className = 'search-custom-meta';
      const name = document.createElement('strong');
      name.textContent = engine.name;
      const url = document.createElement('span');
      url.textContent = engine.template;
      meta.appendChild(name);
      meta.appendChild(url);

      const actions = document.createElement('div');
      actions.className = 'search-custom-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-small ghost';
      editBtn.textContent = t('编辑');
      editBtn.addEventListener('click', () => startEditCustom(engine.id));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-small ghost';
      deleteBtn.textContent = t('删除');
      deleteBtn.addEventListener('click', () => deleteCustom(engine.id));
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(meta);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function setCustomStatus(text, isError) {
    const status = $('search-custom-status');
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('error', Boolean(isError));
  }

  function startEditCustom(id) {
    const engine = customById(id);
    if (!engine) return;
    editingCustomId = id;
    const name = $('search-custom-name');
    const template = $('search-custom-template');
    const save = $('search-custom-save');
    if (name) name.value = engine.name;
    if (template) template.value = engine.template;
    if (save) save.textContent = t('保存');
    setCustomStatus(t('正在编辑该引擎。'));
  }

  function resetCustomForm() {
    editingCustomId = '';
    const name = $('search-custom-name');
    const template = $('search-custom-template');
    const save = $('search-custom-save');
    if (name) name.value = '';
    if (template) template.value = '';
    if (save) save.textContent = t('添加');
  }

  function saveCustomEngine() {
    const nameEl = $('search-custom-name');
    const templateEl = $('search-custom-template');
    const name = nameEl ? nameEl.value.trim() : '';
    const template = templateEl ? templateEl.value.trim() : '';
    if (!name) {
      setCustomStatus(t('请填写引擎名称。'), true);
      if (nameEl) nameEl.focus();
      return;
    }
    const error = templateError(template);
    if (error) {
      setCustomStatus(error, true);
      if (templateEl) templateEl.focus();
      return;
    }
    if (editingCustomId) {
      const current = customById(editingCustomId);
      if (current) {
        current.name = name.slice(0, 40);
        current.template = template;
      }
      setCustomStatus(t('已保存自定义引擎。'));
    } else {
      if (searchState.customSearchEngines.length >= MAX_CUSTOM_ENGINES) {
        setCustomStatus(t('最多添加 {count} 个自定义引擎。', { count: MAX_CUSTOM_ENGINES }), true);
        return;
      }
      searchState.customSearchEngines.push({
        id: generateId(),
        name: name.slice(0, 40),
        template
      });
      setCustomStatus(t('已添加自定义引擎。'));
    }
    persist();
    resetCustomForm();
    renderCustomEngineButtons();
    renderDefaultEngineSelect();
    renderCustomList();
  }

  function deleteCustom(id) {
    searchState.customSearchEngines = searchState.customSearchEngines.filter((engine) => engine.id !== id);
    if (searchState.searchEngine === id) searchState.searchEngine = 'google';
    if (editingCustomId === id) resetCustomForm();
    persist();
    setCustomStatus(t('已删除自定义引擎。'));
    renderCustomEngineButtons();
    renderDefaultEngineSelect();
    renderCustomList();
    renderEngineButtons();
  }

  // This legacy dropdown now combines local saved sites and query history.
  // Enter reads the rendered snapshot so a workspace edit cannot change what
  // an already highlighted index means; saved sites revalidate on activation.
  function filteredHistory(options) {
    if (options && options.rendered) return displayedSuggestions;
    const input = inputEl();
    const needle = input ? input.value.trim().toLowerCase() : '';
    const history = searchState.searchHistoryEnabled
      ? searchState.searchHistory.filter((item) => !needle || item.q.toLowerCase().includes(needle))
      : [];
    return savedSiteMatches(needle).concat(history);
  }

  function hideHistory() {
    const list = $('search-history');
    if (list) {
      list.classList.add('hidden');
      list.replaceChildren();
    }
    const input = inputEl();
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    displayedSuggestions = [];
    historyHighlight = -1;
  }

  function renderHistory(suggestions) {
    const list = $('search-history');
    const input = inputEl();
    if (!list || !input) return;
    if (document.activeElement !== input) {
      hideHistory();
      return;
    }
    const items = Array.isArray(suggestions) ? suggestions : filteredHistory();
    if (!items.length) {
      hideHistory();
      return;
    }
    list.replaceChildren();
    displayedSuggestions = items;
    if (historyHighlight >= items.length) historyHighlight = -1;
    input.removeAttribute('aria-activedescendant');
    let group = null;
    let previousKind = '';
    items.forEach((item, index) => {
      const isSite = item.type === 'site';
      const kind = isSite ? 'sites' : 'history';
      if (kind !== previousKind) {
        group = document.createElement('div');
        group.className = 'search-result-group';
        group.dataset.kind = kind;
        group.setAttribute('role', 'group');
        const label = t(isSite ? '已保存的网站' : '搜索历史');
        group.setAttribute('aria-label', label);
        const heading = document.createElement('div');
        heading.className = 'search-result-heading';
        heading.setAttribute('aria-hidden', 'true');
        heading.textContent = label;
        group.appendChild(heading);
        list.appendChild(group);
        previousKind = kind;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.tabIndex = -1;
      btn.id = `search-result-${index}`;
      btn.className = `search-result-item ${isSite ? 'search-site-item' : 'search-history-item'}${index === historyHighlight ? ' active' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', index === historyHighlight ? 'true' : 'false');
      if (isSite) {
        btn.dataset.siteId = item.id || '';
        btn.title = `${item.name}\n${item.url}\n${item.location}`;
        const name = document.createElement('span');
        name.className = 'search-site-name';
        name.textContent = item.name;
        const meta = document.createElement('span');
        meta.className = 'search-site-meta';
        meta.textContent = [item.domain, item.location].filter(Boolean).join(' · ');
        btn.appendChild(name);
        btn.appendChild(meta);
      } else {
        btn.dataset.q = item.q;
        btn.dataset.engine = item.engine;
        const q = document.createElement('span');
        q.className = 'search-history-q';
        q.textContent = item.q;
        const engine = document.createElement('span');
        engine.className = 'search-history-engine';
        engine.textContent = engineLabel(item.engine);
        btn.appendChild(q);
        btn.appendChild(engine);
      }
      btn.addEventListener('mousedown', (event) => {
        if (event.button === 0 || event.button === 1) event.preventDefault();
      });
      btn.addEventListener('click', (event) => {
        if (event.button !== 0) return;
        applyHistoryItem(item, event.ctrlKey || event.metaKey);
      });
      btn.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          applyHistoryItem(item, true);
        }
      });
      group.appendChild(btn);
      if (index === historyHighlight) input.setAttribute('aria-activedescendant', btn.id);
    });
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    if (historyHighlight >= 0) {
      const active = $(`search-result-${historyHighlight}`);
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }

  function applyHistoryItem(item, forceNewTab) {
    if (item.type === 'site') {
      openSavedSite(item, forceNewTab);
      return;
    }
    const input = inputEl();
    if (input) input.value = item.q;
    if (item.engine) selectEngine(item.engine, { focus: true });
    updateHint();
    submit({ forceNewTab, skipHistoryUi: true });
  }

  function updateHint() {
    const hint = $('search-hint');
    const input = inputEl();
    if (!hint || !input) return;
    const icon = findShortcut(input.value);
    if (!icon) {
      hint.textContent = '';
      hint.classList.add('hidden');
      hint.removeAttribute('data-match');
      return;
    }
    hint.textContent = t('回车打开快捷方式「{name}」', { name: icon.name });
    hint.dataset.match = 'shortcut';
    hint.classList.remove('hidden');
  }

  function submit(options) {
    const input = inputEl();
    if (!input) return;
    const keyword = input.value.trim();
    if (!keyword) {
      input.focus();
      return;
    }
    const forceNewTab = Boolean(options && options.forceNewTab);
    const result = resolve(keyword);
    if (result.type === 'shortcut') {
      updateHint();
      recordHistory(keyword, searchState.searchEngine);
      hideHistory();
      if (result.url) {
        navigate(result.url, forceNewTab);
        return;
      }
      if (typeof callbacks.openMatchedIcon === 'function') {
        callbacks.openMatchedIcon(result.icon);
      }
      return;
    }
    if (result.type === 'url' || result.type === 'search') {
      recordHistory(keyword, searchState.searchEngine);
      hideHistory();
      navigate(result.url, forceNewTab);
    }
  }

  function insertIntoSearch(char) {
    const input = inputEl();
    if (!input) return;
    input.focus();
    const start = input.selectionStart == null ? input.value.length : input.selectionStart;
    const end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
    input.value = `${input.value.slice(0, start)}${char}${input.value.slice(end)}`;
    const caret = start + char.length;
    try {
      input.setSelectionRange(caret, caret);
    } catch (error) {
      // ignore
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onGlobalKeydown(event) {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const input = inputEl();
    if (!input) return;
    if (document.activeElement === input) return;
    if (shouldIgnoreTypeToSearch(event.target)) return;

    // IME: Process / keyCode 229 / isComposing → focus only, never preventDefault.
    if (isImeKeydown(event) || event.isComposing) {
      input.focus();
      return;
    }

    if (event.key.length !== 1) return;
    // Space activates focused controls; never steal it for type-to-search.
    if (event.key === ' ') return;
    event.preventDefault();
    insertIntoSearch(event.key);
  }

  function onCompositionStart(event) {
    if (shouldIgnoreTypeToSearch(event.target)) return;
    const input = inputEl();
    if (!input) return;
    if (document.activeElement !== input) input.focus();
  }

  function onSearchKeydown(event) {
    if (event.defaultPrevented || event.isComposing || isImeKeydown(event)) return;
    // Tab and Shift+Tab retain native focus navigation. Only Alt+Up/Down
    // in this input switches engines; modified arrows remain browser/editor keys.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.altKey) {
        event.preventDefault();
        cycleEngine(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      const items = filteredHistory();
      if (items.length && (searchState.searchHistoryEnabled || items.some((item) => item.type === 'site'))) {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        historyHighlight = historyHighlight < 0 ? (step > 0 ? 0 : items.length - 1) : (historyHighlight + step + items.length) % items.length;
        renderHistory(items);
      }
      return;
    }
    if (event.key === 'Escape' && inputEl().getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      event.stopPropagation();
      hideHistory();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (historyHighlight >= 0) {
        const items = filteredHistory({ rendered: true });
        const item = items[historyHighlight];
        if (item) {
          applyHistoryItem(item, event.ctrlKey || event.metaKey);
          return;
        }
      }
      submit({ forceNewTab: event.ctrlKey || event.metaKey });
    }
  }

  function onSearchAuxClick(event) {
    if (event.button !== 1) return;
    event.preventDefault();
    submit({ forceNewTab: true });
  }

  function onSearchMouseDown(event) {
    if (event.button === 1) event.preventDefault();
  }

  function bindWidget() {
    const input = inputEl();
    if (!input) return;
    input.addEventListener('keydown', onSearchKeydown);
    input.addEventListener('input', () => {
      historyHighlight = -1;
      updateHint();
      renderHistory();
    });
    input.addEventListener('focus', () => {
      historyHighlight = -1;
      updateHint();
      renderHistory();
    });
    input.addEventListener('blur', () => {
      global.clearTimeout(hideHistoryTimer);
      hideHistoryTimer = global.setTimeout(() => {
        if (document.activeElement !== input) hideHistory();
      }, 160);
    });
    input.addEventListener('auxclick', onSearchAuxClick);
    input.addEventListener('mousedown', onSearchMouseDown);

    document.querySelectorAll('#search-engine-switch > .engine-btn[data-engine]').forEach((btn) => {
      btn.addEventListener('click', () => selectEngine(btn.dataset.engine));
    });
  }

  function bindSettings() {
    const select = $('search-default-engine');
    if (select) {
      select.addEventListener('change', () => selectEngine(select.value, { focus: false }));
    }
    const openNewTab = $('search-open-new-tab');
    if (openNewTab) {
      openNewTab.addEventListener('change', () => {
        searchState.searchOpenInNewTab = openNewTab.checked;
        persist();
      });
    }
    const historyEnabled = $('search-history-enabled');
    if (historyEnabled) {
      historyEnabled.addEventListener('change', () => {
        searchState.searchHistoryEnabled = historyEnabled.checked;
        persist();
        historyHighlight = -1;
        renderHistory();
      });
    }
    const clearBtn = $('search-history-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchState.searchHistory = [];
        persist();
        historyHighlight = -1;
        renderHistory();
        setCustomStatus(t('已清除搜索历史。'));
      });
    }
    const save = $('search-custom-save');
    if (save) save.addEventListener('click', saveCustomEngine);
    const template = $('search-custom-template');
    if (template) {
      template.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveCustomEngine();
        }
      });
    }
  }

  function renderAll() {
    renderCustomEngineButtons();
    renderEngineButtons();
    renderDefaultEngineSelect();
    renderSettingsToggles();
    renderCustomList();
    updateHint();
    historyHighlight = -1;
    renderHistory();
  }

  function loadFromStorage() {
    if (!global.chrome || !chrome.storage || !chrome.storage.local) {
      renderAll();
      return;
    }
    chrome.storage.local.get(STORAGE_KEYS, (result) => {
      applySlice(result || {});
      renderAll();
    });
  }

  function init(options) {
    const getState = options && typeof options.getState === 'function' ? options.getState : () => ({});
    callbacks = {
      getIcons: options && typeof options.getIcons === 'function' ? options.getIcons : () => getState()?.icons || [],
      getFolders: options && typeof options.getFolders === 'function' ? options.getFolders : () => getState()?.folders || [],
      openMatchedIcon: options && typeof options.openMatchedIcon === 'function' ? options.openMatchedIcon : null
    };
    if (!bound) {
      bindWidget();
      bindSettings();
      document.addEventListener('keydown', onGlobalKeydown, true);
      document.addEventListener('compositionstart', onCompositionStart, true);
      document.addEventListener('opentab-sync-applied', loadFromStorage);
      bound = true;
    }
    loadFromStorage();
  }

  global.OpenTabSearch = api;
})(window);
