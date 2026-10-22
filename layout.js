(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabLayout = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEYS = ['layoutIconSize', 'layoutColumns', 'layoutShowNames', 'layoutMaxWidth', 'todoButtonVisible'];
  const DEFAULTS = {
    layoutIconSize: 56,
    layoutColumns: 0,
    layoutShowNames: true,
    layoutMaxWidth: 900,
    todoButtonVisible: true
  };
  const SIZE_PRESETS = { small: 48, medium: 56, large: 80 };

  let current = Object.assign({}, DEFAULTS);
  let bound = false;

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalize(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    let columns = src.layoutColumns;
    if (columns === 'auto' || columns === '' || columns == null) columns = 0;
    columns = clamp(columns, 0, 12, 0);
    if (columns > 0 && columns < 4) columns = 4;
    return {
      layoutIconSize: clamp(src.layoutIconSize, 48, 96, DEFAULTS.layoutIconSize),
      layoutColumns: columns,
      layoutShowNames: src.layoutShowNames !== false && src.layoutShowNames !== 0,
      layoutMaxWidth: clamp(src.layoutMaxWidth, 640, 1600, DEFAULTS.layoutMaxWidth),
      todoButtonVisible: src.todoButtonVisible !== false
    };
  }

  function tileWidth(iconSize) {
    return clamp(iconSize, 48, 96, DEFAULTS.layoutIconSize) + 48;
  }

  function cssVars(settings) {
    const s = normalize(settings);
    return {
      '--layout-icon-size': s.layoutIconSize + 'px',
      '--layout-tile-width': tileWidth(s.layoutIconSize) + 'px',
      '--layout-max-width': s.layoutMaxWidth + 'px',
      '--layout-columns': String(s.layoutColumns >= 4 ? s.layoutColumns : 'auto'),
      '--layout-icon-img': Math.round(s.layoutIconSize * 0.5) + 'px',
      '--layout-icon-font': Math.round(s.layoutIconSize * 0.48) + 'px'
    };
  }

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function syncUi(settings) {
    const s = normalize(settings);
    const size = $('layout-icon-size');
    const sizeValue = $('layout-icon-size-value');
    const columns = $('layout-columns');
    const names = $('layout-show-names');
    const todo = $('todo-button-visible');
    if (todo) todo.checked = s.todoButtonVisible;
    const width = $('layout-max-width');
    const widthValue = $('layout-max-width-value');
    if (size) size.value = String(s.layoutIconSize);
    if (sizeValue) sizeValue.textContent = s.layoutIconSize + 'px';
    if (columns) columns.value = String(s.layoutColumns);
    if (names) names.checked = s.layoutShowNames;
    if (width) width.value = String(s.layoutMaxWidth);
    if (widthValue) widthValue.textContent = s.layoutMaxWidth + 'px';
    if (typeof document === 'undefined') return s;
    document.querySelectorAll('.layout-size-preset').forEach((btn) => {
      const preset = Number(btn.dataset.size);
      btn.classList.toggle('active', preset === s.layoutIconSize);
      btn.setAttribute('aria-pressed', preset === s.layoutIconSize ? 'true' : 'false');
    });
    return s;
  }

  function apply(settings, root) {
    const s = normalize(settings);
    current = s;
    const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
    if (el && el.style && typeof el.style.setProperty === 'function') {
      const vars = cssVars(s);
      Object.keys(vars).forEach((key) => el.style.setProperty(key, vars[key]));
    }
    if (typeof document !== 'undefined' && document.body) {
      const focused = document.activeElement;
      const panel = $('todo-widget');
      if (!s.todoButtonVisible && panel && !panel.classList.contains('hidden')) $('todo-collapse-btn')?.click();
      document.body.classList.toggle('hide-todo-entry', !s.todoButtonVisible);
      if (!s.todoButtonVisible && (focused === $('todo-toggle-btn') || panel?.contains(focused) || document.activeElement === $('todo-toggle-btn') || panel?.contains(document.activeElement))) $('todo-button-visible')?.focus();
      else if (focused && document.activeElement !== focused && focused.isConnected) focused.focus();
      document.body.classList.toggle('layout-hide-names', !s.layoutShowNames);
      document.body.classList.toggle('layout-fixed-cols', s.layoutColumns >= 4);
    }
    syncUi(s);
    return s;
  }

  function bootMirrorSlice(settings) {
    const s = normalize(settings || current);
    return {
      layoutIconSize: s.layoutIconSize,
      layoutColumns: s.layoutColumns,
      layoutShowNames: s.layoutShowNames,
      layoutMaxWidth: s.layoutMaxWidth,
      todoButtonVisible: s.todoButtonVisible
    };
  }

  function bootApi() {
    return typeof globalThis !== 'undefined' ? globalThis.OpenTabBoot : undefined;
  }

  function writeMirror(settings) {
    const boot = bootApi();
    if (!boot || !boot.writeMirror || !boot.readMirror) return;
    boot.writeMirror(Object.assign({}, boot.readMirror() || {}, bootMirrorSlice(settings)));
  }

  function applyFromMirror() {
    const boot = bootApi();
    if (!boot || !boot.readMirror) return false;
    const mirror = boot.readMirror();
    if (!mirror || !STORAGE_KEYS.some((key) => mirror[key] !== undefined)) return false;
    apply(mirror);
    return true;
  }

  function persist(settings) {
    const s = apply(settings);
    writeMirror(s);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const payload = {};
      STORAGE_KEYS.forEach((key) => { payload[key] = s[key]; });
      chrome.storage.local.set(payload);
    }
    return s;
  }

  function patch(partial) {
    return persist(Object.assign({}, current, partial));
  }

  function get() {
    return Object.assign({}, current);
  }

  function reset() {
    return persist(DEFAULTS);
  }

  function loadFromStorage(result) {
    const src = result || {};
    if (!STORAGE_KEYS.some((key) => src[key] !== undefined)) {
      return current.todoButtonVisible ? current : apply(Object.assign({}, current, { todoButtonVisible: true }));
    }
    return apply(src);
  }

  function readAndApply() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return Promise.resolve(current);
    }
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEYS, (result) => resolve(loadFromStorage(result || {})));
    });
  }

  function setTodoButtonVisible(visible) {
    const input = $('todo-button-visible'), status = $('todo-visibility-status');
    if (input?.disabled) return Promise.resolve(false);
    if (input) input.disabled = true;
    if (status) status.textContent = '';
    return new Promise(resolve => {
      const finish = error => {
        if (input) input.disabled = false;
        if (!error) { apply(Object.assign({}, current, { todoButtonVisible: visible !== false })); writeMirror(current); }
        else { syncUi(current); if (status) status.textContent = globalThis.OpenTabI18n?.t('保存失败，请重试') || '保存失败，请重试'; }
        resolve(!error);
      };
      try { chrome.storage.local.set({ todoButtonVisible: visible !== false }, () => finish(chrome.runtime?.lastError)); }
      catch (error) { finish(error); }
    });
  }

  function bindUi() {
    if (bound || typeof document === 'undefined') return;
    const size = $('layout-icon-size');
    if (!size) return;
    bound = true;
    size.addEventListener('input', () => patch({ layoutIconSize: Number(size.value) }));
    size.addEventListener('change', () => patch({ layoutIconSize: Number(size.value) }));
    document.querySelectorAll('.layout-size-preset').forEach((btn) => {
      btn.addEventListener('click', () => patch({ layoutIconSize: Number(btn.dataset.size) }));
    });
    const todo = $('todo-button-visible');
    if (todo) todo.addEventListener('change', () => setTodoButtonVisible(todo.checked));
    const columns = $('layout-columns');
    if (columns) columns.addEventListener('change', () => patch({ layoutColumns: Number(columns.value) }));
    const names = $('layout-show-names');
    if (names) names.addEventListener('change', () => patch({ layoutShowNames: names.checked }));
    const width = $('layout-max-width');
    if (width) {
      width.addEventListener('input', () => patch({ layoutMaxWidth: Number(width.value) }));
      width.addEventListener('change', () => patch({ layoutMaxWidth: Number(width.value) }));
    }
  }

  if (typeof document !== 'undefined') {
    applyFromMirror();
    readAndApply();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
    else bindUi();
    document.addEventListener('opentab-sync-applied', () => { readAndApply(); });
  }

  return {
    STORAGE_KEYS,
    DEFAULTS,
    SIZE_PRESETS,
    normalize,
    cssVars,
    tileWidth,
    apply,
    persist,
    patch,
    get,
    reset,
    loadFromStorage,
    readAndApply,
    bindUi,
    setTodoButtonVisible,
    bootMirrorSlice,
    applyFromMirror
  };
}));
