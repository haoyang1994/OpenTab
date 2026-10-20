(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabIcons = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_ICON_PX = 128;
  const MAX_ICON_BYTES = 20 * 1024;
  const LIBRARY_DIR = 'icons/library/';
  const DATA_PREFIX = 'data:';
  const LOCAL_ONLY_FIELDS = ['uploadedIconDataUrl', 'resolvedIconUrl'];

  const LIBRARY = [
    { slug: 'baidu', hex: '2932E1', region: 'cn', hosts: ['baidu.com'] },
    { slug: 'taobao', hex: 'E94F20', region: 'cn', hosts: ['taobao.com'] },
    { slug: 'bilibili', hex: '00A1D6', region: 'cn', hosts: ['bilibili.com', 'b23.tv'] },
    { slug: 'zhihu', hex: '0084FF', region: 'cn', hosts: ['zhihu.com'] },
    { slug: 'sinaweibo', hex: 'E6162D', region: 'cn', hosts: ['weibo.com', 'weibo.cn'] },
    { slug: 'wechat', hex: '07C160', region: 'cn', hosts: ['weixin.qq.com', 'wechat.com'] },
    { slug: 'qq', hex: '1EBAFC', region: 'cn', hosts: ['qq.com', 'qzone.qq.com'] },
    { slug: 'alipay', hex: '1677FF', region: 'cn', hosts: ['alipay.com'] },
    { slug: 'xiaohongshu', hex: 'FF2442', region: 'cn', hosts: ['xiaohongshu.com', 'xhslink.com'] },
    { slug: 'gitee', hex: 'C71D23', region: 'cn', hosts: ['gitee.com'] },
    { slug: 'huawei', hex: 'FF0000', region: 'cn', hosts: ['huawei.com', 'vmall.com'] },
    { slug: 'xiaomi', hex: 'FF6900', region: 'cn', hosts: ['mi.com', 'xiaomi.com'] },
    { slug: 'meituan', hex: 'FFD100', region: 'cn', hosts: ['meituan.com'] },
    { slug: 'kuaishou', hex: 'FF4906', region: 'cn', hosts: ['kuaishou.com'] },
    { slug: 'neteasecloudmusic', hex: 'D43C33', region: 'cn', hosts: ['music.163.com'] },
    { slug: 'tripdotcom', hex: '287DFA', region: 'cn', hosts: ['trip.com', 'ctrip.com'] },
    { slug: 'bytedance', hex: '3C8CFF', region: 'cn', hosts: ['bytedance.com'] },
    { slug: 'alibabadotcom', hex: 'FF6A00', region: 'cn', hosts: ['alibaba.com', '1688.com'] },
    { slug: 'alibabacloud', hex: 'FF6A00', region: 'cn', hosts: ['aliyun.com', 'alibabacloud.com'] },
    { slug: 'csdn', hex: 'FC5531', region: 'cn', hosts: ['csdn.net'] },
    { slug: 'juejin', hex: '007FFF', region: 'cn', hosts: ['juejin.cn'] },
    { slug: 'v2ex', hex: '1F1F1F', region: 'cn', hosts: ['v2ex.com'] },
    { slug: 'github', hex: '181717', region: 'intl', hosts: ['github.com', 'gist.github.com'] },
    { slug: 'youtube', hex: 'FF0000', region: 'intl', hosts: ['youtube.com', 'youtu.be'] },
    { slug: 'google', hex: '4285F4', region: 'intl', hosts: ['google.com', 'google.com.hk', 'google.co.jp'] },
    { slug: 'gmail', hex: 'EA4335', region: 'intl', hosts: ['gmail.com', 'mail.google.com'] },
    { slug: 'x', hex: '000000', region: 'intl', hosts: ['x.com', 'twitter.com'] },
    { slug: 'facebook', hex: '0866FF', region: 'intl', hosts: ['facebook.com', 'fb.com'] },
    { slug: 'instagram', hex: 'FF0069', region: 'intl', hosts: ['instagram.com'] },
    { slug: 'reddit', hex: 'FF4500', region: 'intl', hosts: ['reddit.com'] },
    { slug: 'wikipedia', hex: '000000', region: 'intl', hosts: ['wikipedia.org'] },
    { slug: 'netflix', hex: 'E50914', region: 'intl', hosts: ['netflix.com'] },
    { slug: 'apple', hex: '000000', region: 'intl', hosts: ['apple.com'] },
    { slug: 'icloud', hex: '3693F3', region: 'intl', hosts: ['icloud.com'] },
    { slug: 'stackoverflow', hex: 'F58025', region: 'intl', hosts: ['stackoverflow.com'] },
    { slug: 'discord', hex: '5865F2', region: 'intl', hosts: ['discord.com', 'discord.gg'] },
    { slug: 'telegram', hex: '26A5E4', region: 'intl', hosts: ['telegram.org', 'web.telegram.org', 't.me'] },
    { slug: 'whatsapp', hex: '25D366', region: 'intl', hosts: ['whatsapp.com', 'wa.me'] },
    { slug: 'twitch', hex: '9146FF', region: 'intl', hosts: ['twitch.tv'] },
    { slug: 'spotify', hex: '1ED760', region: 'intl', hosts: ['spotify.com'] },
    { slug: 'duckduckgo', hex: 'DE5833', region: 'intl', hosts: ['duckduckgo.com'] },
    { slug: 'gitlab', hex: 'FC6D26', region: 'intl', hosts: ['gitlab.com'] },
    { slug: 'tiktok', hex: '000000', region: 'intl', hosts: ['tiktok.com', 'douyin.com'] },
    { slug: 'pinterest', hex: 'BD081C', region: 'intl', hosts: ['pinterest.com'] }
  ];

  let host = {
    getIcons: () => [],
    saveState: null,
    refreshIconViews: null,
    showToast: null,
    rememberFocus: null,
    restoreFocus: null,
    getContextMenuIconId: () => null,
    hideIconContextMenu: null,
    getIconLabel: null
  };
  let hostIndex = null;
  let changerIconId = null;
  let resolveChain = Promise.resolve();
  let bound = false;

  function libraryStats() {
    const cn = LIBRARY.filter((item) => item.region === 'cn').length;
    const intl = LIBRARY.filter((item) => item.region === 'intl').length;
    return { count: LIBRARY.length, cn, intl };
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (error) {
      return '';
    }
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (error) {
      return '';
    }
  }

  function buildHostIndex() {
    if (hostIndex) return hostIndex;
    hostIndex = [];
    LIBRARY.forEach((entry) => {
      (entry.hosts || []).forEach((name) => {
        hostIndex.push({ host: String(name).toLowerCase(), entry });
      });
    });
    hostIndex.sort((a, b) => b.host.length - a.host.length);
    return hostIndex;
  }

  function lookupLibrary(url) {
    const hostName = hostnameOf(url);
    if (!hostName) return null;
    const index = buildHostIndex();
    for (let i = 0; i < index.length; i += 1) {
      const item = index[i];
      if (hostName === item.host || hostName.endsWith('.' + item.host)) return item.entry;
    }
    return null;
  }

  function libraryRel(slug) {
    return LIBRARY_DIR + slug + '.svg';
  }

  function isDataUrl(value) {
    return typeof value === 'string' && value.indexOf(DATA_PREFIX) === 0;
  }

  function isPaintSafe(value) {
    if (!value || typeof value !== 'string') return false;
    if (value.indexOf(DATA_PREFIX) === 0) return true;
    if (value.indexOf('chrome-extension:') === 0) return true;
    if (value.indexOf('icons/') === 0) return true;
    return false;
  }

  function isHttpsUrl(value) {
    return typeof value === 'string' && /^https:\/\//i.test(value);
  }

  function isRemoteIconUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  function byteLen(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    return String(text || '').length;
  }

  function colorFromHost(hostName) {
    const input = String(hostName || 'site');
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const hue = Math.abs(hash) % 360;
    const sat = 58 + (Math.abs(hash >> 8) % 18);
    const light = 38 + (Math.abs(hash >> 16) % 10);
    return `hsl(${hue} ${sat}% ${light}%)`;
  }

  function letterFrom(icon) {
    const name = String((icon && icon.name) || '').trim();
    if (name) return name[0].toUpperCase();
    const hostName = hostnameOf(icon && icon.url);
    if (hostName) return hostName[0].toUpperCase();
    return '•';
  }

  function placeholderDataUrl(letter, color) {
    const glyph = String(letter || '•').slice(0, 1).replace(/[<&]/g, '');
    const fill = color || '#4c6fff';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img">`
      + `<rect width="128" height="128" rx="28" fill="${fill}"/>`
      + `<text x="64" y="84" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="64" font-weight="700" fill="#fff">${glyph}</text>`
      + `</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function emojiOnly(icon) {
    return Boolean(icon && icon.emoji) && !icon.customIconUrl && !icon.uploadedIconDataUrl
      && icon.iconSource !== 'placeholder' && icon.iconSource !== 'library' && icon.iconSource !== 'upload'
      && icon.iconSource !== 'remote';
  }

  function skipAutoIcon(icon) {
    const type = icon && icon.type;
    return type === 'folder' || type === 'ssh';
  }

  function paintSrc(icon) {
    if (!icon || skipAutoIcon(icon) || emojiOnly(icon)) return '';
    if (isPaintSafe(icon.uploadedIconDataUrl)) return icon.uploadedIconDataUrl;
    if (isPaintSafe(icon.resolvedIconUrl)) return icon.resolvedIconUrl;
    if (icon.librarySlug) return libraryRel(icon.librarySlug);
    const hit = lookupLibrary(icon.url);
    if (hit) return libraryRel(hit.slug);
    if (icon.customIconUrl && isPaintSafe(icon.customIconUrl)) return icon.customIconUrl;
    return placeholderDataUrl(icon.placeholderLetter || letterFrom(icon), icon.placeholderColor || colorFromHost(hostnameOf(icon.url)));
  }

  function faviconCandidates(pageUrl) {
    const origin = originOf(pageUrl);
    if (!origin) return [];
    return [
      origin + '/apple-touch-icon.png',
      origin + '/apple-touch-icon-precomposed.png',
      origin + '/favicon.ico',
      origin + '/favicon.png',
      origin + '/favicon.svg'
    ];
  }

  function gridIsReady() {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') return true;
    return performance.getEntriesByName('opentab:grid-ready').length > 0;
  }

  function whenGridReady(callback) {
    if (gridIsReady()) {
      callback();
      return;
    }
    if (typeof PerformanceObserver === 'undefined') {
      setTimeout(callback, 0);
      return;
    }
    const observer = new PerformanceObserver((list) => {
      if (list.getEntriesByName('opentab:grid-ready').length) {
        observer.disconnect();
        callback();
      }
    });
    try {
      observer.observe({ type: 'mark', buffered: true });
    } catch (error) {
      setTimeout(callback, 0);
    }
  }

  function persist(refresh) {
    if (typeof host.saveState === 'function') host.saveState();
    if (refresh && typeof host.refreshIconViews === 'function') host.refreshIconViews();
  }

  function prepareRecord(icon) {
    if (!icon || skipAutoIcon(icon)) return icon;
    if (isPaintSafe(icon.uploadedIconDataUrl)) {
      icon.iconSource = 'upload';
      if (!isPaintSafe(icon.resolvedIconUrl)) icon.resolvedIconUrl = icon.uploadedIconDataUrl;
      return icon;
    }
    if (icon.iconSource === 'placeholder' && icon.placeholderColor) {
      if (!isPaintSafe(icon.resolvedIconUrl)) {
        icon.resolvedIconUrl = '';
      }
      return icon;
    }
    const hit = lookupLibrary(icon.url);
    if (hit) {
      icon.librarySlug = hit.slug;
      icon.iconSource = 'library';
      if (!isPaintSafe(icon.resolvedIconUrl) || isRemoteIconUrl(icon.resolvedIconUrl)) {
        icon.resolvedIconUrl = libraryRel(hit.slug);
      }
      return icon;
    }
    if (!icon.placeholderColor) icon.placeholderColor = colorFromHost(hostnameOf(icon.url));
    if (!icon.placeholderLetter) icon.placeholderLetter = letterFrom(icon);
    if (!icon.iconSource) icon.iconSource = 'placeholder';
    if (isRemoteIconUrl(icon.resolvedIconUrl)) {
      // Keep the original remote URL in storage for idle retry (AC3), but first
      // paint uses paintSrc() which never returns http(s).
      return icon;
    }
    if (!isPaintSafe(icon.resolvedIconUrl)) icon.resolvedIconUrl = '';
    return icon;
  }

  function mountVisual(iconVisual, icon) {
    if (!iconVisual) return;
    const fallback = document.createElement('span');
    fallback.className = 'icon-fallback';
    fallback.textContent = typeof host.getIconLabel === 'function' ? host.getIconLabel(icon) : letterFrom(icon);
    iconVisual.appendChild(fallback);

    const src = paintSrc(icon);
    if (!src) return;
    const img = document.createElement('img');
    img.className = 'icon-image';
    img.alt = '';
    img.draggable = false;
    img.loading = 'eager';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => {
      iconVisual.classList.add('has-image', 'icon-fill');
    });
    img.addEventListener('error', () => {
      iconVisual.classList.remove('has-image', 'icon-fill');
      img.removeAttribute('src');
    });
    img.src = src;
    iconVisual.appendChild(img);
  }

  function decodeImage(src) {
    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') {
        reject(new Error('no Image'));
        return;
      }
      const img = new Image();
      let objectUrl = '';
      img.onload = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error('decode failed'));
      };
      if (typeof Blob !== 'undefined' && src instanceof Blob) {
        objectUrl = URL.createObjectURL(src);
        img.src = objectUrl;
      } else {
        img.src = src;
      }
    });
  }

  function canvasToLimitedDataUrl(canvas) {
    const types = [
      ['image/webp', 0.86],
      ['image/jpeg', 0.82],
      ['image/png', 0.92]
    ];
    for (let i = 0; i < types.length; i += 1) {
      try {
        const url = canvas.toDataURL(types[i][0], types[i][1]);
        if (url && byteLen(url) <= MAX_ICON_BYTES) return url;
      } catch (error) {
        // tainted canvas or unsupported type
      }
    }
    try {
      const fallback = canvas.toDataURL('image/jpeg', 0.5);
      if (fallback && byteLen(fallback) <= MAX_ICON_BYTES) return fallback;
    } catch (error) {
      return '';
    }
    return '';
  }

  async function rasterize(source) {
    const img = await decodeImage(source);
    const width = img.naturalWidth || img.width || MAX_ICON_PX;
    const height = img.naturalHeight || img.height || MAX_ICON_PX;
    const scale = Math.min(1, MAX_ICON_PX / Math.max(width, height, 1));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const url = canvasToLimitedDataUrl(canvas);
    if (!url) throw new Error('compress failed');
    return url;
  }

  async function blobToLocalDataUrl(blob) {
    const type = String((blob && blob.type) || '').toLowerCase();
    if (type.indexOf('svg') !== -1 && typeof blob.text === 'function') {
      const text = await blob.text();
      const data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
      if (byteLen(data) <= MAX_ICON_BYTES) return data;
    }
    return rasterize(blob);
  }

  async function readAndCompressFile(file) {
    if (!file) return '';
    if (file.size > 2 * 1024 * 1024) throw new Error('file too large');
    return blobToLocalDataUrl(file);
  }

  async function fetchCandidate(url) {
    if (!isHttpsUrl(url) || !gridIsReady()) return '';
    if (typeof fetch !== 'function') return '';
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store'
    });
    if (!res.ok) return '';
    const blob = await res.blob();
    if (!blob || blob.size < 16 || blob.size > 512 * 1024) return '';
    return blobToLocalDataUrl(blob);
  }

  function parseIconSize(sizes) {
    const match = String(sizes || '').match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  async function fetchManifestIcon(pageUrl) {
    const origin = originOf(pageUrl);
    if (!origin || !gridIsReady()) return '';
    const paths = ['/manifest.json', '/site.webmanifest', '/manifest.webmanifest'];
    for (let i = 0; i < paths.length; i += 1) {
      try {
        const manifestUrl = origin + paths[i];
        const res = await fetch(manifestUrl, {
          mode: 'cors',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store'
        });
        if (!res.ok) continue;
        const json = await res.json();
        const icons = Array.isArray(json && json.icons) ? json.icons.slice() : [];
        icons.sort((a, b) => parseIconSize(b && b.sizes) - parseIconSize(a && a.sizes));
        for (let j = 0; j < icons.length; j += 1) {
          const src = icons[j] && icons[j].src;
          if (!src) continue;
          const abs = new URL(src, manifestUrl).href;
          const data = await fetchCandidate(abs);
          if (data) return data;
        }
      } catch (error) {
        // CORS / parse / CSP — fall through
      }
    }
    return '';
  }

  function needsIdleWork(icon) {
    if (!icon || skipAutoIcon(icon) || emojiOnly(icon)) return false;
    if (icon.iconCacheState === 'failed' || icon.iconCacheState === 'local') return false;
    if (isPaintSafe(icon.uploadedIconDataUrl)) return false;
    if (icon.librarySlug) return false;
    if (lookupLibrary(icon.url)) return false;
    if (icon.iconSource === 'placeholder' && icon.placeholderColor && !isRemoteIconUrl(icon.resolvedIconUrl) && !isRemoteIconUrl(icon.customIconUrl)) {
      return false;
    }
    return isRemoteIconUrl(icon.resolvedIconUrl) || isRemoteIconUrl(icon.customIconUrl) || isRemoteIconUrl(icon.url);
  }

  async function resolveIcon(icon, options) {
    const opts = options || {};
    if (!icon || skipAutoIcon(icon) || emojiOnly(icon)) return false;
    if (!opts.force && isPaintSafe(icon.uploadedIconDataUrl)) return false;
    prepareRecord(icon);
    if (!opts.force && icon.librarySlug) return false;
    if (!opts.force && icon.iconSource === 'placeholder' && !isRemoteIconUrl(icon.resolvedIconUrl) && !isRemoteIconUrl(icon.customIconUrl) && !opts.fetchRemote) {
      return false;
    }
    if (!gridIsReady()) return false;

    const previousRemote = isRemoteIconUrl(icon.resolvedIconUrl) ? icon.resolvedIconUrl : '';
    const tries = [];
    if (isHttpsUrl(icon.customIconUrl)) tries.push(icon.customIconUrl);
    faviconCandidates(icon.url).forEach((url) => tries.push(url));

    for (let i = 0; i < tries.length; i += 1) {
      try {
        const data = await fetchCandidate(tries[i]);
        if (data) {
          icon.resolvedIconUrl = data;
          icon.iconSource = 'remote';
          icon.iconCacheState = 'local';
          icon.iconCandidates = [];
          return true;
        }
      } catch (error) {
        // try next candidate
      }
    }
    try {
      const manifestIcon = await fetchManifestIcon(icon.url);
      if (manifestIcon) {
        icon.resolvedIconUrl = manifestIcon;
        icon.iconSource = 'remote';
        icon.iconCacheState = 'local';
        icon.iconCandidates = [];
        return true;
      }
    } catch (error) {
      // keep original
    }
    if (previousRemote && !isPaintSafe(icon.resolvedIconUrl)) icon.resolvedIconUrl = previousRemote;
    if (!icon.placeholderColor) icon.placeholderColor = colorFromHost(hostnameOf(icon.url));
    if (!icon.iconSource || icon.iconSource === 'remote') icon.iconSource = 'placeholder';
    icon.iconCacheState = 'failed';
    return false;
  }

  function resolveLater(iconId, options) {
    resolveChain = resolveChain.then(async () => {
      const icons = typeof host.getIcons === 'function' ? host.getIcons() : [];
      const icon = (icons || []).find((item) => item && item.id === iconId);
      if (!icon) return;
      whenGridReady(() => {
        const ric = typeof requestIdleCallback === 'function'
          ? requestIdleCallback
          : (fn) => setTimeout(() => fn({ timeRemaining: () => 16 }), 0);
        ric(async () => {
          const changed = await resolveIcon(icon, Object.assign({ fetchRemote: true }, options || {}));
          persist(changed);
        });
      });
    }).catch(() => {});
    return resolveChain;
  }

  function scheduleIdleMigration() {
    whenGridReady(() => {
      const ric = typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (fn) => setTimeout(() => fn({ timeRemaining: () => 12, didTimeout: true }), 240);
      const step = (deadline) => {
        const icons = typeof host.getIcons === 'function' ? host.getIcons() : [];
        const pending = (icons || []).filter(needsIdleWork);
        const budget = deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() : 12;
        if (!pending.length) return;
        const icon = pending[0];
        if (budget < 4 && !(deadline && deadline.didTimeout)) {
          ric(step, { timeout: 2500 });
          return;
        }
        resolveIcon(icon, { fetchRemote: true, reason: 'idle' }).then((changed) => {
          persist(changed);
          if ((typeof host.getIcons === 'function' ? host.getIcons() : []).some(needsIdleWork)) {
            ric(step, { timeout: 2500 });
          }
        }).catch(() => {
          ric(step, { timeout: 2500 });
        });
      };
      setTimeout(() => ric(step, { timeout: 2500 }), 400);
    });
  }

  function stripUnsafe(value) {
    if (isDataUrl(value) || (typeof value === 'string' && (value.indexOf('chrome-extension:') === 0 || value.indexOf('blob:') === 0))) {
      return '';
    }
    return value || '';
  }

  function sanitizeIconForSync(icon) {
    const clean = Object.assign({}, icon);
    LOCAL_ONLY_FIELDS.forEach((field) => {
      clean[field] = stripUnsafe(clean[field]);
    });
    if (isDataUrl(clean.customIconUrl)) clean.customIconUrl = '';
    if (Array.isArray(clean.iconCandidates)) {
      clean.iconCandidates = clean.iconCandidates.filter((item) => isHttpsUrl(item));
    }
    return clean;
  }

  function applyPlaceholder(icon, letter, color) {
    icon.iconSource = 'placeholder';
    icon.placeholderLetter = String(letter || letterFrom(icon)).slice(0, 1);
    icon.placeholderColor = color || icon.placeholderColor || colorFromHost(hostnameOf(icon.url));
    icon.uploadedIconDataUrl = '';
    icon.librarySlug = '';
    icon.resolvedIconUrl = '';
    icon.iconCacheState = 'local';
    icon.customIconUrl = icon.customIconUrl && isHttpsUrl(icon.customIconUrl) ? icon.customIconUrl : '';
    return icon;
  }

  function findIcon(iconId) {
    const icons = typeof host.getIcons === 'function' ? host.getIcons() : [];
    return (icons || []).find((item) => item && item.id === iconId) || null;
  }

  function changerEls() {
    return {
      modal: document.getElementById('change-icon-modal'),
      preview: document.getElementById('change-icon-preview-img'),
      fallback: document.getElementById('change-icon-preview-fallback'),
      refetch: document.getElementById('change-icon-refetch'),
      file: document.getElementById('change-icon-file'),
      letter: document.getElementById('change-icon-letter'),
      color: document.getElementById('change-icon-color'),
      placeholder: document.getElementById('change-icon-placeholder'),
      close: document.getElementById('change-icon-close')
    };
  }

  function hslToHex(hsl) {
    const match = String(hsl || '').match(/hsl\(\s*(\d+)\s+(\d+)%\s+(\d+)%\s*\)/i);
    if (!match) return '#4c6fff';
    const h = Number(match[1]) / 360;
    const s = Number(match[2]) / 100;
    const l = Number(match[3]) / 100;
    const hue2rgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  }

  function refreshChangerPreview(icon) {
    const ui = changerEls();
    if (!ui.preview) return;
    const src = paintSrc(icon);
    if (src) {
      ui.preview.src = src;
      ui.preview.hidden = false;
    } else {
      ui.preview.removeAttribute('src');
      ui.preview.hidden = true;
    }
    if (ui.fallback) ui.fallback.textContent = letterFrom(icon);
    if (ui.letter) ui.letter.value = icon.placeholderLetter || letterFrom(icon);
    if (ui.color) {
      const color = icon.placeholderColor || colorFromHost(hostnameOf(icon.url));
      ui.color.value = color.charAt(0) === '#' ? color : hslToHex(color);
    }
  }

  function closeChanger() {
    const ui = changerEls();
    changerIconId = null;
    if (ui.modal) ui.modal.classList.add('hidden');
    if (typeof host.restoreFocus === 'function') host.restoreFocus();
  }

  function openChanger(iconId) {
    const icon = findIcon(iconId);
    if (!icon || skipAutoIcon(icon)) return;
    changerIconId = iconId;
    const ui = changerEls();
    if (!ui.modal) return;
    if (typeof host.hideIconContextMenu === 'function') host.hideIconContextMenu();
    if (typeof host.rememberFocus === 'function') host.rememberFocus(ui.modal);
    refreshChangerPreview(icon);
    ui.modal.classList.remove('hidden');
    if (ui.letter) ui.letter.focus();
  }

  function placeMenu(menu, event) {
    if (!menu) return;
    const pad = 8;
    const width = menu.offsetWidth || 160;
    const height = menu.offsetHeight || 160;
    let x = event && event.clientX != null ? event.clientX : 8;
    let y = event && event.clientY != null ? event.clientY : 8;
    const maxX = (window.innerWidth || 800) - width - pad;
    const maxY = (window.innerHeight || 600) - height - pad;
    if (x > maxX) x = Math.max(pad, maxX);
    if (y > maxY) y = Math.max(pad, maxY);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  function handleEscape() {
    const ui = changerEls();
    if (ui.modal && !ui.modal.classList.contains('hidden')) {
      closeChanger();
      return true;
    }
    return false;
  }

  function bindChanger() {
    if (bound) return;
    const ui = changerEls();
    if (!ui.modal) return;
    bound = true;
    const changeBtn = document.getElementById('change-icon-btn');
    if (changeBtn) {
      changeBtn.addEventListener('click', () => {
        const iconId = typeof host.getContextMenuIconId === 'function' ? host.getContextMenuIconId() : changerIconId;
        openChanger(iconId);
      });
    }
    if (ui.close) ui.close.addEventListener('click', closeChanger);
    ui.modal.addEventListener('click', (event) => {
      if (event.target === ui.modal) closeChanger();
    });
    if (ui.refetch) {
      ui.refetch.addEventListener('click', async () => {
        const icon = findIcon(changerIconId);
        if (!icon) return;
        icon.uploadedIconDataUrl = '';
        icon.iconSource = '';
        icon.iconCacheState = '';
        icon.librarySlug = '';
        icon.resolvedIconUrl = '';
        prepareRecord(icon);
        ui.refetch.disabled = true;
        try {
          await resolveIcon(icon, { force: true, fetchRemote: true });
          persist(true);
          refreshChangerPreview(icon);
          if (typeof host.showToast === 'function') host.showToast('已重新抓取图标');
        } catch (error) {
          if (typeof host.showToast === 'function') host.showToast('抓取失败，已保留占位');
          persist(true);
          refreshChangerPreview(icon);
        } finally {
          ui.refetch.disabled = false;
        }
      });
    }
    if (ui.file) {
      ui.file.addEventListener('change', async () => {
        const icon = findIcon(changerIconId);
        const file = (ui.file.files || [])[0];
        if (!icon || !file) return;
        try {
          const data = await readAndCompressFile(file);
          icon.uploadedIconDataUrl = data;
          icon.resolvedIconUrl = data;
          icon.iconSource = 'upload';
          icon.iconCacheState = 'local';
          persist(true);
          refreshChangerPreview(icon);
          if (typeof host.showToast === 'function') host.showToast('已使用本地图片');
        } catch (error) {
          if (typeof host.showToast === 'function') host.showToast('图片读取失败');
        }
        ui.file.value = '';
      });
    }
    if (ui.placeholder) {
      ui.placeholder.addEventListener('click', () => {
        const icon = findIcon(changerIconId);
        if (!icon) return;
        const letter = (ui.letter && ui.letter.value) || letterFrom(icon);
        const color = (ui.color && ui.color.value) || icon.placeholderColor;
        applyPlaceholder(icon, letter, color);
        persist(true);
        refreshChangerPreview(icon);
        if (typeof host.showToast === 'function') host.showToast('已使用首字母占位');
      });
    }
  }

  function init(nextHost) {
    host = Object.assign(host, nextHost || {});
    if (typeof document !== 'undefined') bindChanger();
  }

  return {
    LIBRARY,
    MAX_ICON_PX,
    MAX_ICON_BYTES,
    LOCAL_ONLY_FIELDS,
    libraryStats,
    hostnameOf,
    lookupLibrary,
    isPaintSafe,
    isDataUrl,
    isRemoteIconUrl,
    paintSrc,
    placeholderDataUrl,
    colorFromHost,
    letterFrom,
    faviconCandidates,
    prepareRecord,
    mountVisual,
    resolveIcon,
    resolveLater,
    scheduleIdleMigration,
    needsIdleWork,
    sanitizeIconForSync,
    readAndCompressFile,
    applyPlaceholder,
    openChanger,
    closeChanger,
    placeMenu,
    handleEscape,
    gridIsReady,
    init
  };
}));
