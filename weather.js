(function (global) {
  'use strict';
  const DEFAULTS = { weatherEnabled: false, weatherCity: '', weatherUnit: 'c' };
  const KEYS = Object.keys(DEFAULTS);
  const FRESH_MS = 30 * 60 * 1000;
  const STALE_MS = 24 * 60 * 60 * 1000;
  let settings = { ...DEFAULTS };
  let cache = null;
  let controller = null;
  let timer = null;
  let revision = 0;
  let initialized = false;
  let onUpdate = () => {};
  const $ = (id) => document.getElementById(id);

  function normalize(input = {}) {
    return {
      weatherEnabled: input.weatherEnabled === true,
      weatherCity: typeof input.weatherCity === 'string' ? input.weatherCity.trim().slice(0, 80) : '',
      weatherUnit: input.weatherUnit === 'f' ? 'f' : 'c'
    };
  }
  function validCity(city) {
    // Keep the endpoint a city search, never a URL, query or wttr option.
    return city.length > 0 && city.length <= 80 && /[\p{L}\p{N}]/u.test(city) && !/[\p{Cc}/\\?&#%:]/u.test(city);
  }
  function usableCache() {
    const age = Date.now() - Number(cache?.observedAt);
    return cache?.city === settings.weatherCity && age >= 0 && age < STALE_MS
      && Number.isFinite(cache?.data?.tempC) && typeof cache?.data?.location === 'string'
      && typeof cache?.data?.description === 'string';
  }
  function status(message) { $('weather-status').textContent = message; }
  function render(message = '') {
    const active = settings.weatherEnabled && validCity(settings.weatherCity);
    $('weather-enabled').checked = settings.weatherEnabled;
    if (document.activeElement !== $('weather-city')) $('weather-city').value = settings.weatherCity;
    $('weather-unit').value = settings.weatherUnit;
    $('weather-refresh').disabled = !active || !!controller;
    $('weather-pill').hidden = !active;
    const data = active && usableCache() ? cache.data : null;
    const stale = data && Date.now() - cache.observedAt >= FRESH_MS;
    $('weather-temp').textContent = data ? `${Math.round(settings.weatherUnit === 'f' ? data.tempC * 9 / 5 + 32 : data.tempC)}°${settings.weatherUnit.toUpperCase()}` : '--°';
    $('weather-location-inline').textContent = data ? data.location : settings.weatherCity;
    $('weather-icon').textContent = data?.icon || '☁';
    $('weather-pill').title = data ? `${data.location} · ${data.description}${stale ? ' · 上次更新' : ''}` : '天气暂不可用';
    $('weather-pill').dataset.stale = String(!!stale);
    status(message || (!settings.weatherEnabled ? '天气已关闭，不会请求天气或定位。' : !active ? '填写城市后保存，即可显示天气。' : data ? `${stale ? '上次更新' : '已更新'} ${new Date(cache.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '暂未获取天气。'));
    onUpdate(data);
  }
  function stop() {
    revision += 1;
    if (controller) controller.abort();
    controller = null;
    clearTimeout(timer);
    timer = null;
  }
  function schedule(delay = FRESH_MS) {
    clearTimeout(timer);
    if (settings.weatherEnabled && validCity(settings.weatherCity)) {
      timer = setTimeout(() => refresh(), Math.max(1000, delay));
    }
  }
  function parse(data) {
    const current = data?.current_condition?.[0];
    const rawTemp = current?.temp_C;
    const tempC = Number(rawTemp);
    if (rawTemp === undefined || rawTemp === null || String(rawTemp).trim() === '' || !Number.isFinite(tempC) || tempC < -100 || tempC > 70) throw new Error('Invalid weather');
    const code = Number(current.weatherCode);
    let tag = 'unknown', icon = '☁';
    if (code === 113) { tag = 'sunny'; icon = '☀'; }
    else if ([200, 386, 389, 392, 395].includes(code)) { tag = 'storm'; icon = '⚡'; }
    else if ([179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350, 368, 371, 374, 377].includes(code)) { tag = 'snowy'; icon = '❄'; }
    else if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 311, 314, 317, 353, 356, 359, 362, 365].includes(code)) { tag = 'rainy'; icon = '☔'; }
    else if ([143, 248, 260].includes(code)) { tag = 'fog'; icon = '🌫'; }
    else if ([116, 119, 122].includes(code)) { tag = 'cloudy'; icon = code === 116 ? '⛅' : '☁'; }
    return {
      tempC, tag, icon,
      location: String(data?.nearest_area?.[0]?.areaName?.[0]?.value || settings.weatherCity).slice(0, 120),
      description: String(current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '天气').slice(0, 160)
    };
  }
  async function refresh(force = false) {
    stop();
    if (!settings.weatherEnabled || !validCity(settings.weatherCity)) { render(); return; }
    if (!force && usableCache() && Date.now() - cache.observedAt < FRESH_MS) { render(); schedule(FRESH_MS - (Date.now() - cache.observedAt)); return; }
    const ticket = revision;
    const city = settings.weatherCity;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 8000);
    render('正在更新天气…');
    try {
      const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh-cn`, { signal: request.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Weather unavailable');
      const data = parse(await response.json());
      if (ticket !== revision) return;
      cache = { city, observedAt: Date.now(), data };
      await chrome.storage.local.set({ weatherCache: cache });
      if (ticket !== revision) return;
      controller = null;
      render();
    } catch (_) {
      if (ticket !== revision) return;
      controller = null;
      render(usableCache() ? '更新失败，显示上次天气。可稍后重试。' : '暂时无法获取天气，请检查城市名称或稍后重试。');
    } finally {
      clearTimeout(timeout);
      if (ticket === revision) { controller = null; schedule(); }
    }
  }
  async function replaceSettings(input) {
    const previous = settings;
    settings = normalize(input);
    const networkChanged = previous.weatherEnabled !== settings.weatherEnabled || previous.weatherCity !== settings.weatherCity;
    if (networkChanged) stop();
    const chosen = settings;
    render();
    try {
      await chrome.storage.local.set({ ...settings });
    } catch (_) {
      if (settings === chosen) {
        settings = previous;
        render('设置未能保存，请重试。');
        schedule();
      }
      return;
    }
    if (settings !== chosen) return;
    // Unit changes neither restart nor interrupt an in-flight request.
    if (networkChanged) await refresh();
  }
  async function init(options = {}) {
    if (initialized) return;
    initialized = true;
    onUpdate = options.onUpdate || onUpdate;
    let stored;
    try { stored = await chrome.storage.local.get([...KEYS, 'weatherCache']); }
    catch (_) { render('无法读取天气设置，请重新打开新标签页。'); return; }
    settings = normalize(stored);
    cache = stored.weatherCache || null;
    $('weather-enabled').addEventListener('change', () => replaceSettings({ ...settings, weatherEnabled: $('weather-enabled').checked }));
    $('weather-unit').addEventListener('change', () => replaceSettings({ ...settings, weatherUnit: $('weather-unit').value }));
    $('weather-city-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const city = $('weather-city').value.trim();
      if (!validCity(city)) { status('请输入有效城市名称，例如「上海」或「London」。'); $('weather-city').focus(); return; }
      replaceSettings({ ...settings, weatherCity: city });
    });
    $('weather-refresh').addEventListener('click', () => refresh(true));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const next = { ...settings };
      KEYS.forEach((key) => { if (changes[key]) next[key] = changes[key].newValue; });
      const normalized = normalize(next);
      const changed = JSON.stringify(normalized) !== JSON.stringify(settings);
      if (changes.weatherCache) cache = changes.weatherCache.newValue || null;
      if (changed) {
        const networkChanged = settings.weatherEnabled !== normalized.weatherEnabled || settings.weatherCity !== normalized.weatherCity;
        settings = normalized;
        if (networkChanged) refresh();
        else render();
      }
      else if (changes.weatherCache) render();
    });
    window.addEventListener('pagehide', stop);
    await refresh();
  }
  global.OpenTabWeather = { init, refresh, replaceSettings, resetToDefaults: () => replaceSettings(DEFAULTS), getBackupSlice: () => ({ ...settings }), getState: () => ({ ...settings }), normalize, validCity, parse, FRESH_MS, STALE_MS };
})(typeof window !== 'undefined' ? window : globalThis);
