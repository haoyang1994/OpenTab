(function (g) {
  'use strict';
  const CACHE_NAME = 'opentab-bing-v1';
  let ctx;
  let lastBlob = '';
  let lastMeta = { kind: 'image', css: '', lqip: '', color: '' };
  let paintGen = 0;
  let dailyInflight = null;
  let pendingAfterState = false;
  let requestGeneration = 0;
  let suspended = false;

  // A backup replacement owns storage until reload. Invalidate old responses,
  // but allow callers to resume after a failed replacement.
  function invalidatePending() {
    requestGeneration += 1;
    paintGen += 1;
    dailyInflight = null;
  }

  function suspendUpdates() {
    suspended = true;
    invalidatePending();
    return function resumeUpdates() { suspended = false; };
  }

  function requestIsCurrent(generation, background) {
    return !suspended && generation === requestGeneration
      && JSON.stringify(ctx.state.background || {}) === background;
  }

  // Network completions own wallpaper keys, never the rest of the workspace.
  function saveBackground() {
    chrome.storage.local.set({ background: ctx.state.background, bingIndex: ctx.state.bingIndex }, () => {
      if (chrome.runtime.lastError && ctx.showToast) ctx.showToast('背景保存失败，请重试');
    });
  }

  function revokeBlob(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (e) {}
  }

  function adoptBlob(next) {
    if (lastBlob && lastBlob !== next) revokeBlob(lastBlob);
    lastBlob = next || '';
  }

  function themeColor() {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#05070d';
    } catch (e) {
      return '#05070d';
    }
  }

  function send(action, extra) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Background script no response')), 8000);
      chrome.runtime.sendMessage(Object.assign({ action: action }, extra || {}), (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  async function resolveDisplayUrl(url) {
    if (!url) return { display: '' };
    if (url.indexOf('data:') === 0 || g.OpenTabBoot.isLocalAsset(url)) {
      return { display: url, local: true };
    }
    try {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) {
        const blob = await hit.blob();
        const obj = URL.createObjectURL(blob);
        return { display: obj, fromCache: true, blobUrl: obj };
      }
    } catch (e) {}
    return { display: url };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('bg image failed')); };
      img.src = src;
    });
  }

  function lqipFromImage(img) {
    try {
      const canvas = document.createElement('canvas');
      const w = 32;
      const h = Math.max(1, Math.round((img.naturalHeight || 1) * (w / (img.naturalWidth || w))));
      canvas.width = w;
      canvas.height = h;
      const c = canvas.getContext('2d');
      c.drawImage(img, 0, 0, w, h);
      const data = c.getImageData(0, 0, w, h).data;
      let r = 0, gg = 0, b = 0, n = w * h;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        gg += data[i + 1];
        b += data[i + 2];
      }
      return {
        lqip: canvas.toDataURL('image/jpeg', 0.5),
        color: `rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})`
      };
    } catch (e) {
      return { lqip: '', color: '' };
    }
  }

  function paintPhoto(css, fade) {
    const layer = ctx.elements.backgroundLayer;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    layer.classList.remove('boot-lqip');
    if (!fade || reduced) {
      layer.style.background = '';
      layer.style.backgroundImage = css;
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'bg-fade-in';
    overlay.style.backgroundImage = css;
    overlay.style.backgroundSize = 'cover';
    overlay.style.backgroundPosition = 'center';
    layer.appendChild(overlay);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    });
    setTimeout(() => {
      layer.style.background = '';
      layer.style.backgroundImage = css;
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
      if (overlay.parentNode) overlay.remove();
    }, 200);
  }

  function stopVideo() {
    const video = ctx.elements.backgroundVideo;
    if (!video) return;
    video.pause();
    video.style.display = 'none';
    video.removeAttribute('src');
  }

  async function updateBackground(opts) {
    const fade = Boolean(opts && opts.fade);
    const layer = ctx.elements.backgroundLayer;
    const video = ctx.elements.backgroundVideo;
    const bg = ctx.state.background || {};
    const value = bg.value || '';
    const gen = ++paintGen;
    layer.className = 'image-bg';

    if (bg.type === 'gradient') {
      stopVideo();
      adoptBlob('');
      layer.style.backgroundImage = 'none';
      layer.style.background = value || ctx.DEFAULT_GRADIENT;
      lastMeta = { kind: 'gradient', css: value || ctx.DEFAULT_GRADIENT, lqip: '', color: '' };
      if (gen === paintGen) ctx.writeBootMirror();
      return;
    }

    if (ctx.isVideoBackground(value)) {
      adoptBlob('');
      lastMeta = { kind: 'video', css: '', lqip: '', color: lastMeta.color || themeColor() };
      layer.style.background = lastMeta.color;
      layer.style.backgroundImage = 'none';
      if (video) {
        if (video.getAttribute('src') !== value) video.src = value;
        const show = function () { video.style.display = 'block'; };
        if (video.readyState >= 2) show();
        else video.addEventListener('canplay', show, { once: true });
        video.play().catch(() => {});
      }
      if (gen === paintGen) ctx.writeBootMirror();
      return;
    }

    stopVideo();
    const fallback = g.OpenTabBoot.DEFAULT_BG;
    const url = value || fallback;
    if (g.OpenTabBoot.isLocalAsset(url)) {
      if (gen !== paintGen) return;
      adoptBlob('');
      paintPhoto(`url(${url})`, fade);
      lastMeta = { kind: 'image', css: url, lqip: lastMeta.lqip || '', color: lastMeta.color || themeColor() };
      ctx.writeBootMirror();
      loadImage(url).then((img) => {
        if (gen !== paintGen) return;
        const extra = lqipFromImage(img);
        if (extra.color) lastMeta.color = extra.color;
        if (extra.lqip) lastMeta.lqip = extra.lqip;
        ctx.writeBootMirror();
      }).catch(() => {});
      return;
    }
    let resolved;
    try {
      resolved = await resolveDisplayUrl(url);
    } catch (e) {
      resolved = { display: fallback, local: true };
    }

    try {
      const img = await loadImage(resolved.display);
      if (img.decode) await img.decode();
      const sameOrigin = resolved.fromCache || resolved.local || /^(data:|blob:|chrome-extension:)/.test(resolved.display || '');
      const extra = sameOrigin ? lqipFromImage(img) : { lqip: '', color: '' };
      if (!extra.color) extra.color = themeColor();
      if (gen !== paintGen) {
        revokeBlob(resolved.blobUrl);
        return;
      }
      paintPhoto(`url(${resolved.display})`, fade);
      lastMeta = {
        kind: bg.type === 'bing' ? 'bing' : 'image',
        css: g.OpenTabBoot.isLocalAsset(url) ? url : '',
        lqip: extra.lqip,
        color: extra.color
      };
      adoptBlob(resolved.blobUrl || '');
      ctx.writeBootMirror();
    } catch (e) {
      console.warn('Failed to refresh background:', e);
      revokeBlob(resolved && resolved.blobUrl);
      if (url !== fallback && gen === paintGen) {
        try {
          const img = await loadImage(fallback);
          if (gen !== paintGen) return;
          adoptBlob('');
          paintPhoto(`url(${fallback})`, false);
          lastMeta = { kind: 'image', css: fallback, lqip: '', color: themeColor() };
          ctx.writeBootMirror();
        } catch (e2) {
          console.warn('Failed to refresh background:', e2);
        }
      }
    }
  }

  function setButtonCaption(title, copyright) {
    const btn = ctx.elements.refreshBgBtn;
    if (!btn) return;
    const text = [title, copyright].filter(Boolean).join(' · ');
    if (text) btn.title = text;
  }

  async function fetchRandomBackground() {
    if (suspended) return;
    const generation = ++requestGeneration;
    const background = JSON.stringify(ctx.state.background || {});
    const btn = ctx.elements.refreshBgBtn;
    const layer = ctx.elements.backgroundLayer;
    if (btn) btn.classList.add('loading');
    if (layer) layer.classList.add('loading');
    try {
      const index = Number.isInteger(ctx.state.bingIndex) ? ctx.state.bingIndex : 0;
      const result = await send('fetchBingImage', { index: index });
      if (!requestIsCurrent(generation, background)) return;
      if (!result || !result.success) throw new Error((result && result.error) || 'Unknown Bing fetch error');
      ctx.state.bingIndex = result.nextIndex || ((index + 1) % 8);
      const today = g.OpenTabBing.ymd(new Date());
      const prev = (ctx.state.background && ctx.state.background.bing) || {};
      ctx.state.background = {
        type: 'bing',
        value: result.url,
        source: 'bing',
        bing: {
          startdate: result.startdate || prev.startdate || '',
          title: result.title || '',
          copyright: result.copyright || '',
          checkedAt: Date.now(),
          pinnedDate: today
        }
      };
      saveBackground();
      setButtonCaption(result.title, result.copyright);
      await updateBackground({ fade: true });
    } catch (e) {
      console.warn('Failed to fetch Bing image:', e);
    } finally {
      if (btn) btn.classList.remove('loading');
      if (layer) layer.classList.remove('loading');
    }
  }

  async function doRefreshDailyIfNeeded() {
    const bg = ctx.state.background || {};
    if (suspended || bg.type !== 'bing') return;
    const generation = requestGeneration;
    const background = JSON.stringify(bg);
    if (!g.OpenTabBing.shouldCheck(bg.bing, new Date())) {
      await updateBackground({ fade: false });
      return;
    }
    try {
      const result = await send('refreshBingDaily');
      if (!requestIsCurrent(generation, background)) return;
      if (!result || !result.success) {
        console.warn('Failed to refresh background:', result && result.error);
        await updateBackground({ fade: false });
        return;
      }
      const prev = bg.bing || {};
      if (result.unchanged) {
        ctx.state.background.bing = Object.assign({}, prev, {
          checkedAt: result.checkedAt || Date.now(),
          title: result.title || prev.title,
          copyright: result.copyright || prev.copyright
        });
        saveBackground();
        setButtonCaption(result.title, result.copyright);
        await updateBackground({ fade: false });
        return;
      }
      ctx.state.background = {
        type: 'bing',
        value: result.url,
        source: 'bing',
        bing: {
          startdate: result.startdate,
          title: result.title,
          copyright: result.copyright,
          checkedAt: Date.now(),
          pinnedDate: prev.pinnedDate
        }
      };
      saveBackground();
      setButtonCaption(result.title, result.copyright);
      await updateBackground({ fade: true });
    } catch (e) {
      if (!requestIsCurrent(generation, background)) return;
      console.warn('Failed to refresh background:', e);
      await updateBackground({ fade: false });
    }
  }

  function refreshDailyIfNeeded() {
    if (suspended) return Promise.resolve();
    if (dailyInflight) return dailyInflight;
    const pending = doRefreshDailyIfNeeded().finally(() => {
      if (dailyInflight === pending) dailyInflight = null;
    });
    dailyInflight = pending;
    return pending;
  }

  function afterStateLoaded() {
    const run = () => {
      pendingAfterState = false;
      const bg = ctx.state.background || {};
      if (bg.type === 'bing') refreshDailyIfNeeded();
      else updateBackground({ fade: false });
    };
    if (document.readyState === 'loading') {
      if (!pendingAfterState) {
        pendingAfterState = true;
        document.addEventListener('DOMContentLoaded', run, { once: true });
      }
      return;
    }
    run();
  }

  function describeBackground() {
    const bg = ctx.state.background || {};
    if (bg.type === 'gradient') {
      return { kind: 'gradient', css: bg.value || ctx.DEFAULT_GRADIENT, lqip: '', color: '' };
    }
    if (ctx.isVideoBackground(bg.value)) {
      return { kind: 'video', css: '', lqip: '', color: lastMeta.color || themeColor() };
    }
    if (g.OpenTabBoot.isLocalAsset(bg.value)) {
      return { kind: 'image', css: bg.value, lqip: lastMeta.lqip || '', color: lastMeta.color || '' };
    }
    if ((bg.value || '').indexOf('data:image') === 0) {
      return { kind: 'image', css: '', lqip: lastMeta.lqip || '', color: lastMeta.color || themeColor() };
    }
    return {
      kind: bg.type === 'bing' ? 'bing' : 'image',
      css: '',
      lqip: lastMeta.lqip || '',
      color: lastMeta.color || themeColor()
    };
  }

  function onVisible() {
    const bg = ctx.state.background || {};
    if (bg.type === 'bing' && g.OpenTabBing.shouldCheck(bg.bing, new Date())) {
      refreshDailyIfNeeded();
    }
  }

  g.OpenTabBingCache = {
    init: function (c) {
      ctx = c;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (['icons', 'folders'].some((key) => changes[key]
          && JSON.stringify(changes[key].newValue) !== JSON.stringify(ctx.state[key]))) {
          invalidatePending();
        }
        if (!changes.background) return;
        const next = changes.background.newValue || { type: 'image', value: g.OpenTabBoot.DEFAULT_BG };
        // Our own scoped saves already match state. Other tabs' choices supersede
        // pending network work and must become the baseline for later refreshes.
        if (JSON.stringify(next) !== JSON.stringify(ctx.state.background)) {
          invalidatePending();
          ctx.state.background = next;
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) onVisible();
      });
    },
    suspendUpdates: suspendUpdates,
    updateBackground: updateBackground,
    fetchRandomBackground: fetchRandomBackground,
    refreshDailyIfNeeded: refreshDailyIfNeeded,
    afterStateLoaded: afterStateLoaded,
    describeBackground: describeBackground,
    onVisible: onVisible
  };
})(globalThis);
