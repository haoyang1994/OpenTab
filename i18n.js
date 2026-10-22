/* Explicit UI localization only. Never scan or translate user-entered content. */
(function (g) {
  'use strict';
  const STORAGE_KEY = 'languagePreference';
  const MIRROR_KEY = 'opentab.language.v1';
  const english = Object.create(null);
  const valid = value => ['auto', 'zh-CN', 'en'].includes(value);
  const resolve = preference => preference === 'zh-CN' || preference === 'en'
    ? preference : /^zh(?:-|$)/i.test(g.navigator?.language || '') ? 'zh-CN' : 'en';
  let preference = 'auto';
  try {
    const saved = g.localStorage?.getItem(MIRROR_KEY);
    if (valid(saved)) preference = saved;
  } catch (_) { /* Storage may be unavailable; use the browser language. */ }
  let locale = resolve(preference);
  let storageError = null;
  function mirror() {
    try { g.localStorage?.setItem(MIRROR_KEY, preference); } catch (_) { /* Optional startup cache. */ }
  }
  function storage(method, argument) {
    return new Promise((resolve, reject) => {
      const area = g.chrome?.storage?.local;
      if (!area || typeof area[method] !== 'function') {
        reject(new Error('Language storage is unavailable.'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => finish(new Error('Language storage timed out.')), 5000);
      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      }
      try {
        const result = area[method](argument, value => {
          const error = g.chrome?.runtime?.lastError;
          finish(error ? new Error(error.message || 'Language storage failed.') : null, value);
        });
        if (result && typeof result.then === 'function') result.then(value => finish(null, value), error => finish(error));
      } catch (error) { finish(error); }
    });
  }
  function t(source, params = {}) {
    source = String(source);
    const phrase = locale === 'en' && Object.prototype.hasOwnProperty.call(english, source) ? english[source] : source;
    return phrase.replace(/\{([\w]+)\}/g, (token, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token);
  }
  function apply(root = g.document) {
    if (!root) return;
    if (root.documentElement) root.documentElement.lang = locale;
    root.querySelectorAll?.('[data-i18n]').forEach(element => {
      element.textContent = t(element.getAttribute('data-i18n'));
    });
    for (const attribute of ['placeholder', 'title', 'aria-label']) {
      root.querySelectorAll?.(`[data-i18n-${attribute}]`).forEach(element => {
        element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
      });
    }
  }
  async function setPreference(value) {
    if (!valid(value)) throw new TypeError('Invalid language preference.');
    try { await storage('set', { [STORAGE_KEY]: value }); }
    catch (error) { storageError = error; throw error; }
    preference = value;
    locale = resolve(preference);
    storageError = null;
    mirror();
    apply();
    return locale;
  }
  const api = {
    t, apply, setPreference,
    register(map) {
      for (const [source, translated] of Object.entries(map || {})) {
        if (typeof translated === 'string') english[source] = translated;
      }
    },
    get locale() { return locale; },
    get preference() { return preference; },
    get storageError() { return storageError; }
  };
  g.OpenTabI18n = api;
  // Catalog scripts and the static shell finish parsing before runtime consumers start.
  const domReady = new Promise(resolve => {
    if (g.document?.readyState === 'loading') {
      g.document.addEventListener('DOMContentLoaded', resolve, { once: true });
    } else resolve();
  });
  const storageReady = storage('get', STORAGE_KEY).then(saved => {
    preference = valid(saved?.[STORAGE_KEY]) ? saved[STORAGE_KEY] : 'auto';
    locale = resolve(preference);
    mirror();
  }).catch(error => { storageError = error; });
  api.ready = Promise.all([storageReady, domReady]).then(() => {
    // Apply exactly once at startup, before any ready consumer can render dynamic UI.
    apply();
    initializeShell();
    return locale;
  });
  function initializeShell() {
    const select = g.document?.getElementById('language-preference');
    const status = g.document?.getElementById('language-status');
    if (!select) return;
    select.value = preference;
    select.addEventListener('change', async () => {
      const requested = select.value;
      select.disabled = true;
      if (status) status.textContent = t('正在保存语言…');
      try {
        await setPreference(requested);
        // Runtime widgets rebuild in the new language only after the setting is durable.
        g.location.reload();
      } catch (_) {
        select.value = preference;
        select.disabled = false;
        if (status) status.textContent = t('语言保存失败，请重试。');
      }
    });
  }
})(globalThis);
