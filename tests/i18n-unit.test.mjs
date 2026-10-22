import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../i18n.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../locales/static-en.js', import.meta.url), 'utf8');
function create({ language = 'en-US', saved, mirror, readError = false, writeError = false, noStorage = false } = {}) {
  const data = saved === undefined ? {} : { languagePreference: saved };
  const cache = new Map(mirror ? [['opentab.language.v1', mirror]] : []);
  const element = {
    textContent: '', innerHTML: 'unchanged',
    getAttribute: () => '你好，{name}',
  };
  const context = {
    navigator: { language }, setTimeout, clearTimeout,
    localStorage: { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value) },
    chrome: noStorage ? undefined : { runtime: {}, storage: { local: {
      get(key, callback) { if (readError) throw new Error('Read denied'); callback({ ...data }); },
      set(value, callback) { if (writeError) throw new Error('Write denied'); Object.assign(data, value); callback(); }
    } } },
    document: { readyState: 'loading', documentElement: {}, addEventListener() {},
      querySelectorAll: selector => selector === '[data-i18n]' ? [element] : [], },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext(catalog, context);
  return { api: context.OpenTabI18n, context, data, cache, element };
}
for (const [language, expected] of [['en-US', 'en'], ['zh-CN', 'zh-CN'], ['zh-TW', 'zh-CN'], ['fr-FR', 'en'], ['', 'en']]) {
  const { api } = create({ language });
  assert.equal(await api.ready, expected);
  assert.equal(api.locale, expected);
}
{
  const { api, context, data, cache } = create({ language: 'en-GB', saved: 'zh-CN', mirror: 'en' });
  await api.ready;
  assert.equal(api.locale, 'zh-CN');
  assert.equal(api.t('设置'), '设置');
  await api.setPreference('en');
  assert.equal(api.t('设置'), 'Settings');
  assert.equal(context.document.documentElement.lang, 'en');
  assert.equal(data.languagePreference, 'en');
  assert.equal(cache.get('opentab.language.v1'), 'en');
  await api.setPreference('auto');
  assert.equal(data.languagePreference, 'auto');
  assert.equal(api.locale, 'en');
  await assert.rejects(api.setPreference('fr'));
}
{
  const { api, element } = create();
  await api.ready;
  api.register({ '你好，{name}': 'Hello, {name}', '计数：{count}': 'Count: {count}' });
  assert.equal(api.t('未知'), '未知');
  assert.equal(api.t('计数：{count}', { count: 0 }), 'Count: 0');
  assert.equal(api.t('你好，{name}'), 'Hello, {name}');
  const userValue = '<img src=x onerror=alert(1)>';
  element.getAttribute = () => '你好，{name}';
  // t returns plain text, not HTML. Consumers must use textContent / safe attributes.
  element.textContent = api.t('你好，{name}', { name: userValue });
  assert.equal(element.textContent, `Hello, ${userValue}`);
  assert.equal(element.innerHTML, 'unchanged');
  api.apply();
  assert.equal(element.textContent, 'Hello, {name}');
  assert.equal(element.innerHTML, 'unchanged');
}
for (const options of [{ readError: true }, { noStorage: true }]) {
  const { api } = create({ ...options, language: 'zh-CN' });
  assert.equal(await api.ready, 'zh-CN');
  assert.ok(api.storageError);
}
{
  const { api, cache, data } = create({ saved: 'zh-CN', writeError: true });
  await api.ready;
  await assert.rejects(api.setPreference('en'), /Write denied/);
  assert.equal(api.locale, 'zh-CN');
  assert.equal(api.preference, 'zh-CN');
  assert.equal(data.languagePreference, 'zh-CN');
  assert.equal(cache.get('opentab.language.v1'), 'zh-CN');
}
{
  const { api } = create({ language: 'en-US', readError: true, mirror: 'zh-CN' });
  assert.equal(api.locale, 'zh-CN');
  await api.ready;
  assert.equal(api.locale, 'zh-CN');
}
// Promise-only storage adapters and Chrome callback errors both settle safely.
{
  const { api, context } = create();
  await api.ready;
  context.chrome.storage.local.set = () => Promise.resolve();
  await api.setPreference('zh-CN');
  assert.equal(api.locale, 'zh-CN');
  context.chrome.storage.local.set = (value, callback) => {
    context.chrome.runtime.lastError = { message: 'Quota exceeded' };
    callback();
    delete context.chrome.runtime.lastError;
  };
  await assert.rejects(api.setPreference('en'), /Quota exceeded/);
  assert.equal(api.locale, 'zh-CN');
  context.chrome.storage.local.set = () => Promise.reject(new Error('Promise rejected'));
  await assert.rejects(api.setPreference('en'), /Promise rejected/);
}
// Every static annotation must have an English catalog entry. Brand marks are excluded.
{
  const { api } = create();
  await api.ready;
  for (const file of ['home.html', 'popup.html']) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g)) {
      const key = match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&');
      assert.notEqual(api.t(key), key, `Missing English translation: ${key}`);
    }
  }
}
console.log('i18n unit tests passed');
// Shared canonical phrases cannot silently change meaning with catalog load order.
{
  const messages = new Map();
  for (const name of ['static', 'core', 'services']) {
    vm.runInNewContext(readFileSync(new URL(`../locales/${name}-en.js`, import.meta.url), 'utf8'), {
      OpenTabI18n: { register(entries) {
        for (const [key, value] of Object.entries(entries)) {
          if (messages.has(key)) assert.equal(value, messages.get(key), `Conflicting translation for ${key}`);
          messages.set(key, value);
          const tokens = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
          assert.deepEqual(tokens(key), tokens(value), `Translation placeholders preserved for ${key}`);
        }
      } }
    });
  }
  for (const file of ['home.js', 'folders.js', 'icons.js', 'search.js', 'weather.js', 'import.js', 'sync.js', 'settings-nav.js', 'popup.js', 'workspace-persistence.js', 'bing-cache.js']) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of code.matchAll(/\bt\('((?:\\.|[^'\\])*)'/g)) {
      const key = vm.runInNewContext(`'${match[1]}'`);
      if (/[\u3400-\u9fff]/.test(key)) assert.ok(messages.has(key), `Missing dynamic translation in ${file}: ${key}`);
    }
  }
}
