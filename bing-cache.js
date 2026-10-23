(function (g) {
  'use strict';
  const t = (source) => g.OpenTabI18n ? g.OpenTabI18n.t(source) : source;
  const CACHE_NAME = 'opentab-bing-v1';
  let ctx;
  let lastBlob = '';
  let lastMeta = { kind: 'image', css: '', lqip: '', color: '' };
  let paintGen = 0;
  let dailyInflight = null;
  let dailyPersistence = null;
  let manualInflight = null;
  let pendingAfterState = false;
  let requestGeneration = 0;
  let suspended = false;
  let manualCleanup = null;
  let manualDisplayHold = null;
  let metaScene = '', metaBackground = '';
  let displayedOwner = null;
  let pendingFade = null;

  // Chrome's storage dictionaries need not preserve insertion order. Compare
  // values, not serialization order, or our own durable acknowledgement can
  // invalidate the decoded image just before its pixel commit. Array order is
  // still meaningful (for example, an imported icon/group ordering).
  function stateSignature(value) {
    return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  }

  function scopeMetadata(background) {
    if (!sceneEnabled()) return;
    const id = sceneView()?.sceneId || '', signature = stateSignature(background);
    if (metaScene !== id || metaBackground !== signature) {
      lastMeta = { kind: 'image', css: '', lqip: '', color: '' };
      metaScene = id;
      metaBackground = signature;
    }
  }

  function sceneEnabled() { return typeof ctx.getSceneView === 'function'; }

  function sceneView() {
    if (!sceneEnabled()) return null;
    const view = ctx.getSceneView();
    return view ? { sceneId: view.sceneId, homeGroupId: view.homeGroupId, generation: view.generation } : null;
  }

  function viewIsCurrent(view) {
    if (!view) return !sceneEnabled();
    const current = sceneView();
    return current && ['sceneId', 'homeGroupId', 'generation'].every(key => current[key] === view[key]);
  }

  function displayedSource() {
    const layer = ctx.elements.backgroundLayer, video = ctx.elements.backgroundVideo;
    return {
      image: layer?.style.backgroundImage || '', background: layer?.style.background || '',
      video: video?.style.display === 'block' ? video.src || '' : ''
    };
  }

  function recordDisplayed(background, view, signature = stateSignature(background || {})) {
    displayedOwner = { background: signature, view, source: displayedSource() };
  }

  function sameDisplayOwner(owner, background) {
    if (!owner || owner.background !== background) return false;
    const view = sceneView();
    // Request generations reject late work, but do not change ownership of
    // already committed pixels in the same scene/home group/background.
    return owner.view ? view && owner.view.sceneId === view.sceneId && owner.view.homeGroupId === view.homeGroupId : !sceneEnabled();
  }

  function retainDisplayed(background) {
    const layer = ctx.elements.backgroundLayer, fade = pendingFade;
    // Complete a matching selected photo's transition rather than rereading
    // its cache. The overlay is not recorded as base-owner before this commit.
    if (sameDisplayOwner(fade, background) && fade.overlay.parentNode === layer
      && fade.overlay.style.backgroundImage === fade.source) {
      ++paintGen;
      paintPhoto(fade.source, false, () => sameDisplayOwner(fade, background), ctx.state.background, sceneView());
    }
    if (!sameDisplayOwner(displayedOwner, background)) return false;
    const source = displayedSource();
    if (stateSignature(source) !== stateSignature(displayedOwner.source)
      || !((source.image && source.image !== 'none') || (source.background && source.background !== 'none') || source.video)) return false;
    // An obsolete overlay cannot hide the current owner's retained base.
    if (layer.querySelectorAll('.bg-fade-in').length) {
      ++paintGen;
      layer.querySelectorAll('.bg-fade-in').forEach(overlay => overlay.remove());
      pendingFade = null;
    }
    return true;
  }

  // A backup replacement owns storage until reload. Invalidate old responses,
  // but allow callers to resume after a failed replacement.
  function invalidatePending() {
    requestGeneration += 1;
    paintGen += 1;
    dailyInflight = null;
    dailyPersistence = null;
    manualDisplayHold = null;
    if (ctx && sceneEnabled()) {
      manualInflight = null;
      if (manualCleanup) manualCleanup();
      ctx.elements.backgroundLayer?.querySelectorAll('.bg-fade-in').forEach(overlay => overlay.remove());
      pendingFade = null;
    }
  }

  function suspendUpdates() {
    suspended = true;
    invalidatePending();
    return function resumeUpdates() { suspended = false; };
  }

  function requestIsCurrent(generation, background, view = null) {
    return !suspended && generation === requestGeneration && viewIsCurrent(view)
      && stateSignature(ctx.state.background || {}) === background;
  }

  // Network completions own wallpaper keys, never the rest of the workspace.
  function saveBackground(silent, view, before) {
    if (sceneEnabled()) {
      if (!viewIsCurrent(view) || typeof ctx.persistBackground !== 'function') return Promise.resolve(false);
      const payload = JSON.parse(JSON.stringify({ background: ctx.state.background, bingIndex: ctx.state.bingIndex }));
      const generation = requestGeneration, selected = stateSignature(payload.background);
      return Promise.resolve().then(() => requestIsCurrent(generation, selected, view)
        ? ctx.persistBackground(payload, { view, before: JSON.parse(before) }) : false)
        .then(saved => saved === true);
    }
    return new Promise((resolve) => {
      chrome.storage.local.set({ background: ctx.state.background, bingIndex: ctx.state.bingIndex }, () => {
        const failed = Boolean(chrome.runtime.lastError);
        if (failed && !silent && ctx.showToast) ctx.showToast(t('背景保存失败，请重试'));
        resolve(!failed);
      });
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

  function send(action, extra, canSend = () => true) {
    return new Promise((resolve, reject) => {
      const runtime = g.chrome?.runtime, extensionId = runtime?.id;
      let settled = false, retried = false, retryTimer;
      const finish = (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout); clearTimeout(retryTimer);
        if (error) reject(error); else resolve(response);
      };
      // One deadline covers both dispatches. A missing receiver means the
      // channel never opened; a closed port or timeout may have executed work
      // and must not be retried. Chrome normally wakes dormant workers itself.
      const timeout = setTimeout(() => finish(bingError('timeout', 'Background script no response')), 25000);
      const contextIsValid = () => Boolean(extensionId && runtime?.id === extensionId && g.chrome?.runtime === runtime);
      const attempt = () => {
        retryTimer = undefined;
        if (settled) return;
        if (!canSend()) { finish(null); return; }
        if (!contextIsValid() || typeof runtime.sendMessage !== 'function') {
          finish(bingError('context', 'Extension context invalidated.')); return;
        }
        let answered = false;
        const receive = (error, response) => {
          if (answered || settled) return;
          answered = true;
          if (!error) {
            finish(response == null ? bingError('transport', 'Background script returned no response') : null, response);
            return;
          }
          const message = error.message || String(error);
          if (!contextIsValid() || /Extension context invalidated\.?$/i.test(message)) {
            finish(bingError('context', message)); return;
          }
          if (!retried && message === 'Could not establish connection. Receiving end does not exist.' && canSend()) {
            retried = true;
            retryTimer = setTimeout(attempt, 250);
            return;
          }
          finish(bingError('transport', message));
        };
        try {
          runtime.sendMessage(Object.assign({ action }, extra || {}), response => {
            // Read lastError even after the deadline to consume Chrome's error.
            const error = runtime.lastError;
            receive(error, response);
          });
        } catch (error) { receive(error); }
      };
      attempt();
    });
  }

  function bingError(stage, message) { return Object.assign(new Error(message), { bingStage: stage }); }

  function failureMessage(error) {
    const labels = {
      context: '扩展连接已失效，已保留原背景，请刷新此标签页后重试',
      transport: '扩展后台不可用，已保留原背景，请重新加载扩展后重试',
      archive: 'Bing 壁纸信息获取失败，已保留原背景，请稍后重试',
      timeout: '壁纸更新超时，已保留原背景，请稍后重试',
      image: '壁纸图片无法加载，已保留原背景，请稍后重试',
      cache: '壁纸缓存失败，已保留原背景，请稍后重试',
      storage: '壁纸保存失败，已保留原背景，请稍后重试'
    };
    return t(labels[error.bingStage] || '壁纸更新失败，已保留原背景，请稍后重试');
  }

  async function resolveDisplayUrl(url, bounded = false) {
    if (!url) return { display: '' };
    if (url.indexOf('data:') === 0 || g.OpenTabBoot.isLocalAsset(url)) {
      return { display: url, local: true };
    }
    let expired = false, timer;
    const read = async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(url);
        if (hit) {
          const blob = await hit.blob();
          if (expired) return { display: url };
          const obj = URL.createObjectURL(blob);
          return { display: obj, fromCache: true, blobUrl: obj };
        }
      } catch (e) {}
      return { display: url };
    };
    if (!bounded) return read();
    try {
      return await Promise.race([read(), new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(bingError('timeout', 'bg cache timeout')); }, 15000);
      })]);
    } finally { clearTimeout(timer); }
  }

  function loadImage(src, decode = false) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); img.onload = img.onerror = null;
        if (error) reject(error); else resolve(img);
      };
      const timer = setTimeout(() => { finish(bingError('timeout', 'bg image timeout')); img.src = ''; }, 15000);
      img.onload = async function () {
        try {
          if (decode && img.decode) await img.decode();
          if (typeof img.naturalWidth === 'number' && !img.naturalWidth) throw new Error('empty image');
          finish();
        } catch (_) { finish(bingError('image', 'bg image decode failed')); }
      };
      img.onerror = function () { finish(bingError('image', 'bg image failed')); };
      img.src = src;
    });
  }

  async function prepareManualPhoto(background, canApply) {
    let resolved = await resolveDisplayUrl(background.value, true), img;
    try {
      try { img = await loadImage(resolved.display, true); }
      catch (error) {
        if (!resolved.fromCache || error.bingStage === 'timeout' || !canApply()) throw error;
        revokeBlob(resolved.blobUrl); resolved = null;
        const repair = await send('repairBingImage', { url: background.value }, canApply);
        if (!repair?.success) throw bingError(repair?.stage || 'image', repair?.error || 'Bing image repair failed');
        if (!canApply()) return null;
        // The worker replaced the entry only after its complete body arrived.
        // Do not reuse the rejected blob, and never repair more than once.
        resolved = await resolveDisplayUrl(background.value, true);
        img = await loadImage(resolved.display, true);
      }
      if (!canApply()) { revokeBlob(resolved?.blobUrl); return null; }
      const extra = resolved.fromCache || resolved.local ? lqipFromImage(img) : { lqip: '', color: '' };
      let released = false;
      return {
        release() { if (!released) { released = true; revokeBlob(resolved.blobUrl); } },
        commit() {
          if (released || !canApply()) return false;
          released = true; ++paintGen;
          ctx.elements.backgroundLayer.className = 'image-bg'; stopVideo();
          paintPhoto(`url(${resolved.display})`, false, canApply, background, sceneView());
          scopeMetadata(background);
          lastMeta = { kind: 'bing', css: resolved.local ? background.value : '', lqip: extra.lqip, color: extra.color || themeColor() };
          adoptBlob(resolved.blobUrl || '');
          return true;
        }
      };
    } catch (error) { revokeBlob(resolved?.blobUrl); throw error; }
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

  function paintPhoto(css, fade, canApply, background, view) {
    if (!canApply()) return;
    const generation = paintGen;
    const signature = stateSignature(background || {});
    const layer = ctx.elements.backgroundLayer;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    layer.classList.remove('boot-lqip');
    if (!fade || reduced) {
      // A preceding daily fade may still cover the base layer. A synchronous
      // commit must retire it now, not wait for its obsolete timer.
      layer.querySelectorAll('.bg-fade-in').forEach((overlay) => overlay.remove());
      pendingFade = null;
      layer.style.background = '';
      layer.style.backgroundImage = css;
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
      recordDisplayed(background, view, signature);
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'bg-fade-in';
    overlay.style.backgroundImage = css;
    overlay.style.backgroundSize = 'cover';
    overlay.style.backgroundPosition = 'center';
    layer.appendChild(overlay);
    const transition = { background: signature, view, source: overlay.style.backgroundImage, overlay };
    pendingFade = transition;
    const retire = () => { overlay.remove(); if (pendingFade === transition) pendingFade = null; };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { if (generation === paintGen && canApply()) overlay.style.opacity = '1'; else retire(); });
    });
    setTimeout(() => {
      if (generation !== paintGen || !canApply()) { retire(); return; }
      layer.style.background = '';
      layer.style.backgroundImage = css;
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
      retire();
      recordDisplayed(background, view, signature);
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
    const bg = (opts && opts.background) || ctx.state.background || {};
    // A settings/storage callback may render the provisional candidate while
    // its save is pending, or reread the old cache during rollback. Neither is
    // allowed to replace the actual displayed image owned by this operation.
    if (manualDisplayHold && manualDisplayHold.generation === requestGeneration && viewIsCurrent(manualDisplayHold.view)
      && [manualDisplayHold.before, manualDisplayHold.selected].includes(stateSignature(bg))) return;
    const value = bg.value || '';
    const gen = ++paintGen;
    const view = sceneView(), request = requestGeneration;
    const expected = stateSignature(ctx.state.background || {});
    const sceneCurrent = () => (!view && !sceneEnabled()) || requestIsCurrent(request, expected, view);
    const canApply = () => sceneCurrent() && (opts && opts.canApply ? opts.canApply() : gen === paintGen);
    const writeMirror = () => { if (canApply() && !(opts && opts.deferMirror)) ctx.writeBootMirror(); };
    if (!canApply()) return;
    scopeMetadata(bg);
    layer.className = 'image-bg';

    if (bg.type === 'gradient') {
      stopVideo();
      adoptBlob('');
      layer.style.backgroundImage = 'none';
      layer.style.background = value || ctx.DEFAULT_GRADIENT;
      recordDisplayed(bg, view);
      lastMeta = { kind: 'gradient', css: value || ctx.DEFAULT_GRADIENT, lqip: '', color: '' };
      writeMirror();
      return;
    }

    if (ctx.isVideoBackground(value)) {
      adoptBlob('');
      lastMeta = { kind: 'video', css: '', lqip: '', color: lastMeta.color || themeColor() };
      layer.style.background = lastMeta.color;
      layer.style.backgroundImage = 'none';
      if (video) {
        if (video.getAttribute('src') !== value) video.src = value;
        const show = function () { if (canApply()) { video.style.display = 'block'; recordDisplayed(bg, view); } };
        if (video.readyState >= 2) show();
        else video.addEventListener('canplay', show, { once: true });
        video.play().catch(() => {});
      }
      recordDisplayed(bg, view);
      writeMirror();
      return;
    }

    stopVideo();
    const fallback = g.OpenTabBoot.DEFAULT_BG;
    const url = value || fallback;
    if (g.OpenTabBoot.isLocalAsset(url)) {
      if (!canApply()) return;
      adoptBlob('');
      paintPhoto(`url(${url})`, fade, sceneCurrent, bg, view);
      lastMeta = { kind: 'image', css: url, lqip: lastMeta.lqip || '', color: lastMeta.color || themeColor() };
      writeMirror();
      loadImage(url).then((img) => {
        if (!canApply()) return;
        const extra = lqipFromImage(img);
        if (extra.color) lastMeta.color = extra.color;
        if (extra.lqip) lastMeta.lqip = extra.lqip;
        writeMirror();
      }).catch(() => {});
      return;
    }
    let resolved;
    try {
      resolved = await resolveDisplayUrl(url);
    } catch (e) {
      resolved = { display: fallback, local: true };
    }

    if (!canApply()) { revokeBlob(resolved.blobUrl); return; }
    try {
      const img = await loadImage(resolved.display);
      if (img.decode) await img.decode();
      const sameOrigin = resolved.fromCache || resolved.local || /^(data:|blob:|chrome-extension:)/.test(resolved.display || '');
      const extra = sameOrigin ? lqipFromImage(img) : { lqip: '', color: '' };
      if (!extra.color) extra.color = themeColor();
      // An unrelated workspace repaint may advance paintGen while this decoded
      // manual candidate is still the latest user request. Only its request/
      // background guard can decide whether that candidate was superseded.
      if (!canApply()) {
        revokeBlob(resolved.blobUrl);
        return;
      }
      if (gen !== paintGen) paintGen += 1;
      scopeMetadata(bg);
      paintPhoto(`url(${resolved.display})`, fade, sceneCurrent, bg, view);
      lastMeta = {
        kind: bg.type === 'bing' ? 'bing' : 'image',
        css: g.OpenTabBoot.isLocalAsset(url) ? url : '',
        lqip: extra.lqip,
        color: extra.color
      };
      adoptBlob(resolved.blobUrl || '');
      writeMirror();
    } catch (e) {
      if (opts && opts.preserveOnError) { revokeBlob(resolved && resolved.blobUrl); throw e; }
      console.warn('Failed to refresh background:', e);
      revokeBlob(resolved && resolved.blobUrl);
      if (url !== fallback && canApply()) {
        try {
          const img = await loadImage(fallback);
          if (!canApply()) return;
          adoptBlob('');
          paintPhoto(`url(${fallback})`, false, sceneCurrent, bg, view);
          lastMeta = { kind: 'image', css: fallback, lqip: '', color: themeColor() };
          writeMirror();
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

  function fetchRandomBackground() {
    if (manualInflight) return manualInflight;
    const pending = fetchNextBackground().finally(() => {
      if (manualInflight === pending) manualInflight = null;
    });
    manualInflight = pending;
    return pending;
  }

  async function fetchNextBackground() {
    // Installed hooks with no view mean a blocked/unresolved scene, not legacy mode.
    if (suspended || (sceneEnabled() && !sceneView())) return;
    // Daily persistence temporarily owns shared appearance state. Do not capture
    // its uncommitted candidate as the manual request's rollback baseline.
    if (sceneEnabled() && dailyPersistence) {
      const waitingView = sceneView(), waitingGeneration = requestGeneration;
      await dailyPersistence;
      if (suspended || requestGeneration !== waitingGeneration || !viewIsCurrent(waitingView)) return;
    }
    const generation = ++requestGeneration;
    const view = sceneView();
    const background = stateSignature(ctx.state.background || {});
    const previousIndex = ctx.state.bingIndex;
    let selectedBackground = '';
    let prepared = null;
    const btn = ctx.elements.refreshBgBtn;
    const layer = ctx.elements.backgroundLayer;
    retainDisplayed(background);
    const hold = { generation, view, before: background, selected: '', description: describeBackground() };
    manualDisplayHold = hold;
    const choiceIsCurrent = () => requestIsCurrent(generation, selectedBackground || background, view);
    const wasDisabled = btn && btn.disabled;
    if (btn) { btn.classList.add('loading'); btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    if (layer) layer.classList.add('loading');
    const cleanup = () => {
      if (manualCleanup !== cleanup) return;
      manualCleanup = null;
      if (btn) { btn.classList.remove('loading'); btn.disabled = wasDisabled; btn.removeAttribute('aria-busy'); }
      if (layer) layer.classList.remove('loading');
    };
    manualCleanup = cleanup;
    try {
      const index = Number.isInteger(ctx.state.bingIndex) ? ctx.state.bingIndex : 0;
      let result = await send('fetchBingImage', { index: index }, choiceIsCurrent);
      if (!requestIsCurrent(generation, background, view)) return;
      // Existing daily/pinned backgrounds may still carry archive index zero.
      if (result && result.success && result.url === ctx.state.background.value) {
        const next = Number.isInteger(result.nextIndex) ? result.nextIndex : (index + 1) % 8;
        result = await send('fetchBingImage', { index: next }, choiceIsCurrent);
      }
      if (!requestIsCurrent(generation, background, view)) return;
      if (!result || !result.success) throw bingError(result?.stage || 'archive', result?.error || 'Unknown Bing fetch error');
      if (result.url === ctx.state.background.value) throw bingError('image', 'Bing returned the current wallpaper');
      const nextIndex = Number.isInteger(result.nextIndex) ? result.nextIndex : ((index + 1) % 8);
      const today = g.OpenTabBing.ymd(new Date());
      const prev = (ctx.state.background && ctx.state.background.bing) || {};
      const candidate = {
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
      // Decode first without touching pixels or revoking their source. Keep
      // unrelated renders from exposing the candidate before durable success.
      prepared = await prepareManualPhoto(candidate, choiceIsCurrent);
      if (!prepared || !requestIsCurrent(generation, background, view)) return;
      ctx.state.background = candidate;
      ctx.state.bingIndex = nextIndex;
      selectedBackground = stateSignature(candidate);
      hold.selected = selectedBackground;
      try {
        if (!await saveBackground(true, view, background)) throw new Error('Background storage failed');
      } catch (error) { throw bingError('storage', error.message); }
      if (!choiceIsCurrent() || !prepared.commit()) return;
      if (manualDisplayHold === hold) manualDisplayHold = null;
      ctx.writeBootMirror();
      setButtonCaption(result.title, result.copyright);
    } catch (e) {
      if (choiceIsCurrent() || requestIsCurrent(generation, background, view)) {
        ctx.state.background = JSON.parse(background);
        ctx.state.bingIndex = previousIndex;
        if (!retainDisplayed(background)) {
          if (manualDisplayHold === hold) manualDisplayHold = null;
          try { await updateBackground({ fade: false }); } catch (_) {}
        }
        if (requestIsCurrent(generation, background, view) && ctx.showToast) ctx.showToast(failureMessage(e));
      }
      console.warn('Failed to fetch Bing image:', e);
    } finally {
      prepared?.release();
      if (manualDisplayHold === hold) manualDisplayHold = null;
      cleanup();
    }
  }

  async function doRefreshDailyIfNeeded() {
    const bg = ctx.state.background || {};
    if (suspended || bg.type !== 'bing') return;
    const generation = requestGeneration;
    const view = sceneView();
    if (sceneEnabled() && !view) return;
    const background = stateSignature(bg);
    if (!g.OpenTabBing.shouldCheck(bg.bing, new Date())) {
      await updateBackground({ fade: false });
      return;
    }
    try {
      const result = await send('refreshBingDaily', null, () => requestIsCurrent(generation, background, view));
      if (!requestIsCurrent(generation, background, view)) return;
      if (!result || !result.success) {
        console.warn('Failed to refresh background:', result && result.error);
        await updateBackground({ fade: false });
        return;
      }
      const prev = bg.bing || {};
      if (view) {
        const previousIndex = ctx.state.bingIndex;
        const candidate = result.unchanged ? Object.assign({}, bg, { bing: Object.assign({}, prev, {
          checkedAt: result.checkedAt || Date.now(), title: result.title || prev.title, copyright: result.copyright || prev.copyright
        }) }) : {
          type: 'bing', value: result.url, source: 'bing', bing: {
            startdate: result.startdate, title: result.title, copyright: result.copyright,
            checkedAt: Date.now(), pinnedDate: prev.pinnedDate
          }
        };
        ctx.state.background = candidate;
        ctx.state.bingIndex = 1;
        const selected = stateSignature(candidate);
        const pending = (async () => {
          try {
            if (!await saveBackground(true, view, background)) throw new Error('Background storage failed');
            if (!requestIsCurrent(generation, selected, view)) return;
            setButtonCaption(result.title, result.copyright);
            await updateBackground({ fade: !result.unchanged });
          } catch (error) {
            if (requestIsCurrent(generation, selected, view)) {
              ctx.state.background = JSON.parse(background);
              ctx.state.bingIndex = previousIndex;
              await updateBackground({ fade: false });
              if (requestIsCurrent(generation, background, view) && ctx.showToast) ctx.showToast(t('背景保存失败，请重试'));
            }
            console.warn('Failed to refresh background:', error);
          }
        })();
        dailyPersistence = pending;
        try { await pending; }
        finally { if (dailyPersistence === pending) dailyPersistence = null; }
        return;
      }
      ctx.state.bingIndex = 1;
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
      if (!requestIsCurrent(generation, background, view)) return;
      console.warn('Failed to refresh background:', e);
      // Retain only this view/background's committed pixels, not a preceding
      // scene or boot placeholder. Metadata scoping alone is not a paint.
      if (['context', 'transport', 'timeout'].includes(e.bingStage) && retainDisplayed(background)) return;
      await updateBackground({ fade: false });
    }
  }

  function refreshDailyIfNeeded() {
    if (suspended) return Promise.resolve();
    // A manual choice pins today's wallpaper. Do not start daily work from its
    // provisional state while that choice is being saved or rolled back.
    if (sceneEnabled() && manualInflight) return manualInflight;
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
    if (manualDisplayHold && manualDisplayHold.generation === requestGeneration && viewIsCurrent(manualDisplayHold.view)
      && [manualDisplayHold.before, manualDisplayHold.selected].includes(stateSignature(ctx.state.background || {}))) {
      return Object.assign({}, manualDisplayHold.description);
    }
    const bg = ctx.state.background || {};
    scopeMetadata(bg);
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
      displayedOwner = null;
      pendingFade = null;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (sceneEnabled()) {
          const change = changes.sceneProfiles;
          if (!change) return;
          const view = sceneView();
          if (!view) return;
          const id = view.sceneId;
          const profile = value => Array.isArray(value) ? value.find(item => item.id === id) : undefined;
          const old = profile(change.oldValue), next = profile(change.newValue);
          if (stateSignature(old?.background) !== stateSignature(next?.background)
            && stateSignature(next?.background) !== stateSignature(ctx.state.background)) invalidatePending();
          // The controller reloads the whole active profile. Never adopt legacy
          // aliases, or cancel this view because another scene changed.
          return;
        }
        if (['icons', 'folders'].some((key) => changes[key]
          && stateSignature(changes[key].newValue) !== stateSignature(ctx.state[key]))) {
          invalidatePending();
        }
        if (!changes.background) return;
        const next = changes.background.newValue || { type: 'image', value: g.OpenTabBoot.DEFAULT_BG };
        // Our own scoped saves already match state. Other tabs' choices supersede
        // pending network work and must become the baseline for later refreshes.
        if (stateSignature(next) !== stateSignature(ctx.state.background)) {
          invalidatePending();
          ctx.state.background = next;
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) onVisible();
      });
    },
    invalidatePending: invalidatePending,
    suspendUpdates: suspendUpdates,
    updateBackground: updateBackground,
    fetchRandomBackground: fetchRandomBackground,
    refreshDailyIfNeeded: refreshDailyIfNeeded,
    afterStateLoaded: afterStateLoaded,
    describeBackground: describeBackground,
    onVisible: onVisible
  };
})(globalThis);
