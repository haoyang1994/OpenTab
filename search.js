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
  const MAX_CUSTOM_ENGINES = 12;
  const BUILTIN_ENGINES = [
    { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s' },
    { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s' },
    { id: 'baidu', name: '百度', template: 'https://www.baidu.com/s?wd=%s' },
    { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
    { id: 'github', name: 'GitHub', template: 'https://github.com/search?q=%s&type=repositories' }
  ];

  const OVERLAY_SELECTORS = [
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
    openMatchedIcon: null
  };
  let historyHighlight = -1;
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
    return icons.find((icon) => String(icon.name || '').trim().toLowerCase() === needle) || null;
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

  function filteredHistory() {
    const input = inputEl();
    const needle = input ? input.value.trim().toLowerCase() : '';
    if (!needle) return searchState.searchHistory.slice();
    return searchState.searchHistory.filter((item) => item.q.toLowerCase().includes(needle));
  }

  function hideHistory() {
    const list = $('search-history');
    if (!list) return;
    list.classList.add('hidden');
    list.innerHTML = '';
    historyHighlight = -1;
  }

  function renderHistory() {
    const list = $('search-history');
    const input = inputEl();
    if (!list || !input) return;
    if (!searchState.searchHistoryEnabled || document.activeElement !== input) {
      hideHistory();
      return;
    }
    const items = filteredHistory();
    if (!items.length) {
      hideHistory();
      return;
    }
    list.innerHTML = '';
    items.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `search-history-item${index === historyHighlight ? ' active' : ''}`;
      btn.setAttribute('role', 'option');
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
      btn.addEventListener('mousedown', (event) => event.preventDefault());
      btn.addEventListener('click', () => applyHistoryItem(item, false));
      btn.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          applyHistoryItem(item, true);
        }
      });
      list.appendChild(btn);
    });
    list.classList.remove('hidden');
  }

  function applyHistoryItem(item, forceNewTab) {
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
    if (event.key === 'Tab') {
      event.preventDefault();
      cycleEngine(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = filteredHistory();
      if (searchState.searchHistoryEnabled && items.length) {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        historyHighlight = (historyHighlight + step + items.length) % items.length;
        renderHistory();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (historyHighlight >= 0) {
        const items = filteredHistory();
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
        if (!searchState.searchHistoryEnabled) hideHistory();
      });
    }
    const clearBtn = $('search-history-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchState.searchHistory = [];
        persist();
        hideHistory();
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
    callbacks = {
      getIcons: options && typeof options.getIcons === 'function' ? options.getIcons : () => [],
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
