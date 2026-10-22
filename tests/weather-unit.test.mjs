import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../weather.js', import.meta.url), 'utf8');
const payload = (temp = '20') => ({ current_condition: [{ temp_C: temp, weatherCode: '113', weatherDesc: [{ value: 'Sunny' }] }], nearest_area: [{ areaName: [{ value: 'Test City' }] }] });
function harness(stored = {}) {
  const nodes = new Map();
  const listeners = [];
  const timers = new Map();
  let nextTimer = 0;
  const requests = [];
  const db = structuredClone(stored);
  const document = { activeElement: null, getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', hidden: false, dataset: {}, events: {}, addEventListener(type, fn) { this.events[type] = fn; }, focus() { document.activeElement = this; } });
    return nodes.get(id);
  } };
  const sandbox = {
    document, console, AbortController, Date, addEventListener() {},
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => { requests.push({ url, options }); return sandbox.response(url, options); },
    response: async () => ({ ok: true, json: async () => payload() }),
    chrome: { storage: { local: {
      get: async () => structuredClone(db),
      set: async (value) => { Object.assign(db, structuredClone(value)); },
    }, onChanged: { addListener(fn) { listeners.push(fn); } } } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { api: sandbox.OpenTabWeather, sandbox, db, requests, nodes, timers, listeners, node: document.getElementById };
}
const active = { weatherEnabled: true, weatherCity: 'Test City', weatherUnit: 'c' };
const cached = (age) => ({ city: 'Test City', observedAt: Date.now() - age, data: { tempC: 20, location: 'Test City', description: 'Sunny', icon: '☀', tag: 'sunny' } });
{
  const h = harness(); await h.api.init();
  assert.equal(h.requests.length, 0); assert.equal(h.node('weather-pill').hidden, true);
  assert.equal(h.timers.size, 0, 'disabled schedules nothing');
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.getState())), { weatherEnabled: false, weatherCity: '', weatherUnit: 'c' });
  for (const city of ['', ' ', '/', 'https://example.com', 'Test?foo', 'Test&foo', 'Test#foo', 'Test%20City', 'Test\nCity', 'x'.repeat(81)]) assert.equal(h.api.validCity(city), false, city);
  for (const city of ['上海', 'Test City', 'São Paulo', "Xi'an", 'New York, US']) assert.equal(h.api.validCity(city), true, city);
  for (const bad of ['', null, undefined, 'NaN', 'Infinity', '1000']) assert.throws(() => h.api.parse({ current_condition: [{ temp_C: bad }] }), /Invalid weather/);
  assert.equal(h.api.parse(payload('-10')).tempC, -10);
  await h.api.replaceSettings(active);
  assert.equal(h.requests.length, 1); assert.match(h.requests[0].url, /https:\/\/wttr.in\/Test%20City\?/);
  assert.equal(h.requests[0].options.credentials, 'omit'); assert.equal(h.requests[0].options.referrerPolicy, 'no-referrer');
  assert.equal(h.node('weather-temp').textContent, '20°C');
  await h.api.replaceSettings({ ...active, weatherUnit: 'f' });
  assert.equal(h.node('weather-temp').textContent, '68°F'); assert.equal(h.requests.length, 1);
  assert.equal('weatherCache' in h.api.getBackupSlice(), false, 'cache is not exported');
  await h.api.resetToDefaults(); assert.equal(h.node('weather-pill').hidden, true); assert.equal(h.timers.size, 0);
}
{
  const h = harness({ ...active, weatherUnit: 'f', weatherCache: cached(1000) }); await h.api.init();
  assert.equal(h.requests.length, 0, 'fresh cache avoids fetch on startup'); assert.equal(h.node('weather-temp').textContent, '68°F');
  assert.equal(h.api.getState().weatherUnit, 'f', 'saved preferences preserved');
}
{
  const h = harness({ ...active, weatherCache: cached(31 * 60 * 1000) });
  h.sandbox.response = async () => { throw new Error('offline'); }; await h.api.init();
  assert.equal(h.requests.length, 1); assert.equal(h.node('weather-temp').textContent, '20°C');
  assert.equal(h.node('weather-pill').dataset.stale, 'true'); assert.match(h.node('weather-status').textContent, /更新失败/);
}
{
  const h = harness({ ...active, weatherCache: cached(25 * 60 * 60 * 1000) });
  h.sandbox.response = async () => ({ ok: true, json: async () => payload('bad') }); await h.api.init();
  assert.equal(h.node('weather-temp').textContent, '--°', 'expired cache not presented as current weather');
  assert.match(h.node('weather-status').textContent, /暂时无法/);
}
{
  const h = harness(); await h.api.init(); let resolve;
  h.sandbox.response = () => new Promise((r) => { resolve = r; });
  const pending = h.api.replaceSettings(active); await new Promise(setImmediate);
  assert.equal(h.requests.length, 1); await h.api.resetToDefaults();
  assert.equal(h.requests[0].options.signal.aborted, true, 'disabling aborts pending request');
  resolve({ ok: true, json: async () => payload() }); await pending;
  assert.equal(h.node('weather-pill').hidden, true); assert.equal(h.db.weatherCache, undefined, 'late result cannot resurrect or persist');
  assert.equal(h.timers.size, 0);
}
{
  const h = harness(); await h.api.init();
  h.sandbox.response = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))));
  const pending = h.api.replaceSettings(active); await new Promise(setImmediate);
  const timeout = [...h.timers.values()].find((t) => t.ms === 8000); assert.ok(timeout); timeout.fn(); await pending;
  assert.match(h.node('weather-status').textContent, /暂时无法/); assert.equal(h.node('weather-refresh').disabled, false);
}
{
  const h = harness(); await h.api.init(); let resolve;
  h.sandbox.response = () => new Promise((r) => { resolve = r; });
  const pending = h.api.replaceSettings(active); await new Promise(setImmediate);
  await h.api.replaceSettings({ ...active, weatherUnit: 'f' });
  assert.equal(h.requests[0].options.signal.aborted, false, 'unit change must preserve in-flight weather request');
  resolve({ ok: true, json: async () => payload() }); await pending;
  assert.equal(h.node('weather-temp').textContent, '68°F'); assert.equal(h.requests.length, 1);
}
{
  const h = harness({ ...active, weatherCache: cached(31 * 60 * 1000) });
  h.sandbox.response = async () => { throw new Error('offline'); }; await h.api.init();
  h.listeners.forEach((fn) => fn({ weatherUnit: { oldValue: 'c', newValue: 'f' } }, 'local'));
  await new Promise(setImmediate);
  assert.equal(h.requests.length, 1, 'cross-tab unit change must not fetch even with stale cache');
  assert.equal(h.node('weather-temp').textContent, '68°F');
}
{
  const h = harness();
  h.sandbox.chrome.storage.local.get = async () => { throw new Error('storage unavailable'); };
  await h.api.init(); assert.equal(h.requests.length, 0); assert.equal(h.node('weather-pill').hidden, true);
  assert.match(h.node('weather-status').textContent, /无法读取/);
}
{
  const h = harness(); await h.api.init();
  h.sandbox.chrome.storage.local.set = async () => { throw new Error('quota exceeded'); };
  await h.api.replaceSettings(active);
  assert.equal(h.requests.length, 0, 'failed opt-in save must not fetch');
  assert.equal(h.api.getState().weatherEnabled, false, 'failed save restores previous preference');
  assert.equal(h.node('weather-pill').hidden, true); assert.match(h.node('weather-status').textContent, /未能保存/);
}
{
  const h = harness(active);
  h.sandbox.chrome.storage.local.set = async () => { throw new Error('quota exceeded'); };
  await h.api.init();
  assert.equal(h.node('weather-temp').textContent, '20°C', 'cache persistence failure still shows available weather');
  assert.equal(h.node('weather-refresh').disabled, false, 'cache write failure must not leave request busy');
}
{
  const h = harness(); await h.api.init();
  h.node('weather-city').value = 'Test?invalid';
  let prevented = false;
  h.node('weather-city-form').events.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.api.getState().weatherCity, '');
  assert.match(h.node('weather-status').textContent, /有效城市/); assert.equal(h.requests.length, 0);
}
{
  const h = harness({ ...active, weatherCache: { ...cached(1000), city: 'Other City' } });
  await h.api.init(); assert.equal(h.requests.length, 1, 'wrong-city cache must not be reused');
  assert.equal(h.node('weather-location-inline').textContent, 'Test City');
}
assert.doesNotMatch(source, /navigator\.geolocation/);
console.log('weather unit tests passed: opt-in, validation, migration, cache, units, failure, timeout and cancellation');
