(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabIcons = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const t = (s, p) => globalThis.OpenTabI18n ? globalThis.OpenTabI18n.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p?.[k] ?? m);


  const MAX_ICON_PX = 128;
  const MAX_ICON_BYTES = 20 * 1024;
  const LIBRARY_DIR = 'icons/library/';
  const DATA_PREFIX = 'data:';
  const LOCAL_ONLY_FIELDS = ['uploadedIconDataUrl', 'resolvedIconUrl'];
  const MSG_REFETCH_BLOCKED = '该站点不允许读取，已保留远程图标';

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
  let changerIntent = null;
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

  function hasExplicitCustomIcon(icon) {
    return Boolean(
      icon
      && icon.customIconUrl
      && (isHttpsUrl(icon.customIconUrl) || isPaintSafe(icon.customIconUrl))
    );
  }

  function uniqueHttps(urls) {
    const out = [];
    (urls || []).forEach((url) => {
      if (isHttpsUrl(url) && out.indexOf(url) === -1) out.push(url);
    });
    return out;
  }

  function userChosePlaceholder(icon) {
    return Boolean(icon && icon.iconCacheState === 'local' && icon.iconSource === 'placeholder');
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

  function letterPlaceholder(icon) {
    return placeholderDataUrl(
      (icon && icon.placeholderLetter) || letterFrom(icon),
      (icon && icon.placeholderColor) || colorFromHost(hostnameOf(icon && icon.url))
    );
  }

  function paintSrc(icon) {
    if (!icon || skipAutoIcon(icon) || emojiOnly(icon)) return '';
    if (isPaintSafe(icon.uploadedIconDataUrl)) return icon.uploadedIconDataUrl;
    if (isPaintSafe(icon.customIconUrl)) return icon.customIconUrl;
    if (isDataUrl(icon.resolvedIconUrl)) return icon.resolvedIconUrl;
    if (hasExplicitCustomIcon(icon)) return letterPlaceholder(icon);
    if (isPaintSafe(icon.resolvedIconUrl)) return icon.resolvedIconUrl;
    if (icon.librarySlug) return libraryRel(icon.librarySlug);
    const hit = lookupLibrary(icon.url);
    if (hit) return libraryRel(hit.slug);
    return letterPlaceholder(icon);
  }

  function remoteSrcList(icon) {
    if (!icon || skipAutoIcon(icon) || emojiOnly(icon) || userChosePlaceholder(icon)) return [];
    if (isPaintSafe(icon.uploadedIconDataUrl) || isPaintSafe(icon.customIconUrl) || isDataUrl(icon.resolvedIconUrl)) {
      return [];
    }
    if (hasExplicitCustomIcon(icon) && isHttpsUrl(icon.customIconUrl)) return [icon.customIconUrl];
    if (icon.librarySlug || lookupLibrary(icon.url)) return [];
    return uniqueHttps([
      icon.resolvedIconUrl
    ].concat(Array.isArray(icon.iconCandidates) ? icon.iconCandidates : []).concat(faviconCandidates(icon.url)));
  }

  function faviconCandidates(pageUrl) {
    const origin = originOf(pageUrl);
    if (!origin || origin.indexOf('https:') !== 0) return [];
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
    const saved = typeof host.saveState === 'function' ? host.saveState() : Promise.resolve(false);
    if (refresh && typeof host.refreshIconViews === 'function') host.refreshIconViews();
    return saved;
  }

  function prepareRecord(icon) {
    if (!icon || skipAutoIcon(icon)) return icon;
    if (isPaintSafe(icon.uploadedIconDataUrl)) {
      icon.iconSource = 'upload';
      if (!isPaintSafe(icon.resolvedIconUrl)) icon.resolvedIconUrl = icon.uploadedIconDataUrl;
      return icon;
    }
    if (hasExplicitCustomIcon(icon)) {
      icon.librarySlug = '';
      if (!icon.placeholderColor) icon.placeholderColor = colorFromHost(hostnameOf(icon.url));
      if (!icon.placeholderLetter) icon.placeholderLetter = letterFrom(icon);
      if (isPaintSafe(icon.customIconUrl)) {
        icon.resolvedIconUrl = icon.customIconUrl;
        icon.iconSource = 'remote';
        return icon;
      }
      if (!isDataUrl(icon.resolvedIconUrl)) {
        if (!isRemoteIconUrl(icon.resolvedIconUrl)) icon.resolvedIconUrl = '';
      }
      if (icon.iconSource === 'library' || icon.iconSource === 'placeholder' || !icon.iconSource) {
        icon.iconSource = 'custom';
      }
      return icon;
    }
    if (userChosePlaceholder(icon)) {
      if (!isPaintSafe(icon.resolvedIconUrl)) icon.resolvedIconUrl = '';
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
    if (isRemoteIconUrl(icon.resolvedIconUrl)) return icon;
    if (!isPaintSafe(icon.resolvedIconUrl)) icon.resolvedIconUrl = '';
    return icon;
  }

  function mountVisual(iconVisual, icon) {
    if (!iconVisual) return;
    const fallback = document.createElement('span');
    fallback.className = 'icon-fallback';
    fallback.textContent = typeof host.getIconLabel === 'function' ? host.getIconLabel(icon) : letterFrom(icon);
    iconVisual.appendChild(fallback);

    const localSrc = paintSrc(icon);
    const remotes = remoteSrcList(icon);
    const img = document.createElement('img');
    img.className = 'icon-image';
    img.alt = '';
    img.draggable = false;
    img.loading = 'eager';
    img.referrerPolicy = 'no-referrer';
    let remoteIndex = 0;
    const showPlaceholder = () => {
      const fallbackSrc = letterPlaceholder(icon);
      img.src = fallbackSrc;
      iconVisual.classList.remove('has-image', 'icon-fill');
    };
    img.addEventListener('load', () => {
      iconVisual.classList.add('has-image', 'icon-fill');
    });
    img.addEventListener('error', () => {
      if (remoteIndex < remotes.length) {
        img.src = remotes[remoteIndex];
        remoteIndex += 1;
        return;
      }
      showPlaceholder();
    });
    if (localSrc) {
      img.dataset.paintSrc = localSrc;
      img.src = localSrc;
    }
    iconVisual.appendChild(img);
    if (!remotes.length) return;
    whenGridReady(() => {
      setTimeout(() => {
        if (!iconVisual.isConnected || !img.isConnected) return;
        if (userChosePlaceholder(icon)) return;
        img.src = remotes[remoteIndex];
        remoteIndex += 1;
      }, 16);
    });
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
    try {
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
    } catch (error) {
      return '';
    }
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

  function oversizedData(value) {
    return isDataUrl(value) && byteLen(value) > MAX_ICON_BYTES;
  }

  function needsIdleWork(icon) {
    if (!icon || skipAutoIcon(icon) || emojiOnly(icon) || userChosePlaceholder(icon)) return false;
    if (hasExplicitCustomIcon(icon)) {
      return oversizedData(icon.customIconUrl) || oversizedData(icon.resolvedIconUrl);
    }
    if (isPaintSafe(icon.uploadedIconDataUrl)) return oversizedData(icon.uploadedIconDataUrl);
    if (!icon.librarySlug && lookupLibrary(icon.url)) return true;
    return oversizedData(icon.resolvedIconUrl) || oversizedData(icon.customIconUrl);
  }

  async function migrateIdleIcon(icon) {
    if (!icon) return false;
    if (!hasExplicitCustomIcon(icon) && !isPaintSafe(icon.uploadedIconDataUrl)) {
      const hit = lookupLibrary(icon.url);
      if (hit && icon.librarySlug !== hit.slug) {
        icon.librarySlug = hit.slug;
        icon.iconSource = 'library';
        icon.resolvedIconUrl = libraryRel(hit.slug);
        return true;
      }
    }
    const fields = ['uploadedIconDataUrl', 'customIconUrl', 'resolvedIconUrl'];
    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i];
      if (!oversizedData(icon[field])) continue;
      try {
        const next = await rasterize(icon[field]);
        if (next && byteLen(next) < byteLen(icon[field])) {
          icon[field] = next;
          if (field !== 'customIconUrl') icon.resolvedIconUrl = next;
          return true;
        }
      } catch (error) {
        // keep original
      }
    }
    return false;
  }

  async function resolveIcon(icon, options) {
    const opts = options || {};
    if (!icon || skipAutoIcon(icon) || emojiOnly(icon)) return false;
    if (!opts.force) return false;
    if (!gridIsReady()) return false;

    const snapshot = {
      resolvedIconUrl: icon.resolvedIconUrl,
      iconSource: icon.iconSource,
      iconCacheState: icon.iconCacheState,
      librarySlug: icon.librarySlug
    };
    const tries = [];
    if (isHttpsUrl(icon.customIconUrl)) tries.push(icon.customIconUrl);
    else faviconCandidates(icon.url).forEach((url) => tries.push(url));

    for (let i = 0; i < tries.length; i += 1) {
      const data = await fetchCandidate(tries[i]);
      if (data) {
        icon.resolvedIconUrl = data;
        icon.iconSource = 'remote';
        icon.iconCacheState = '';
        icon.iconCandidates = [];
        if (isHttpsUrl(icon.customIconUrl)) icon.librarySlug = '';
        return true;
      }
    }
    if (!isHttpsUrl(icon.customIconUrl)) {
      try {
        const manifestIcon = await fetchManifestIcon(icon.url);
        if (manifestIcon) {
          icon.resolvedIconUrl = manifestIcon;
          icon.iconSource = 'remote';
          icon.iconCacheState = '';
          icon.iconCandidates = [];
          return true;
        }
      } catch (error) {
        // keep original
      }
    }
    icon.resolvedIconUrl = snapshot.resolvedIconUrl;
    icon.iconSource = snapshot.iconSource;
    icon.iconCacheState = snapshot.iconCacheState;
    icon.librarySlug = snapshot.librarySlug;
    return false;
  }

  function resolveLater() {
    return Promise.resolve();
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
        migrateIdleIcon(icon).then((changed) => {
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
    clean.customIconUrl = stripUnsafe(clean.customIconUrl);
    delete clean.iconCacheState;
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
      status: document.getElementById('change-icon-status'),
      file: document.getElementById('change-icon-file'),
      upload: document.getElementById('change-icon-upload'),
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

  function setChangerStatus(text) {
    const ui = changerEls();
    if (ui.status) ui.status.textContent = text || '';
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
    changerIntent = null;
    if (ui.modal) ui.modal.classList.add('hidden');
    if (typeof host.restoreFocus === 'function') host.restoreFocus();
  }

  const IMAGE_FIELDS = ['uploadedIconDataUrl', 'customIconUrl', 'resolvedIconUrl', 'iconSource', 'iconCacheState', 'librarySlug', 'placeholderLetter', 'placeholderColor', 'iconCandidates'];
  function imageSignature(icon) {
    return JSON.stringify([icon.uploadedIconDataUrl || '', icon.customIconUrl || '',
      icon.iconSource === 'remote' ? icon.resolvedIconUrl || '' : '',
      userChosePlaceholder(icon) ? [icon.placeholderLetter || '', icon.placeholderColor || ''] : null]);
  }
  function renewChangerIntent(icon) {
    changerIntent = { id: icon.id, token: host.captureIntent({ icons: [icon.id] }), image: imageSignature(icon) };
  }
  function currentChanger(intent) {
    if (!intent || intent !== changerIntent) return null;
    const icon = findIcon(intent.id);
    if (icon && host.isIntentCurrent(intent.token) && imageSignature(icon) === intent.image) return icon;
    closeChanger();
    if (host.showToast) host.showToast(t('内容已变化，请重新编辑。'));
    return null;
  }
  function beginChangerAction() {
    if (!currentChanger(changerIntent)) return null;
    // A newer user action or a newly opened modal invalidates older async work.
    changerIntent = { ...changerIntent };
    return changerIntent;
  }

  function openChanger(iconId) {
    const icon = findIcon(iconId);
    if (!icon || skipAutoIcon(icon)) return;
    changerIconId = iconId;
    renewChangerIntent(icon);
    const ui = changerEls();
    if (!ui.modal) return;
    if (typeof host.hideIconContextMenu === 'function') host.hideIconContextMenu();
    if (typeof host.rememberFocus === 'function') host.rememberFocus(ui.modal);
    refreshChangerPreview(icon);
    setChangerStatus('');
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
    if (ui.upload && ui.file) ui.upload.addEventListener('click', () => ui.file.click());
    if (ui.close) ui.close.addEventListener('click', closeChanger);
    ui.modal.addEventListener('click', (event) => {
      if (event.target === ui.modal) closeChanger();
    });
    if (ui.refetch) {
      ui.refetch.addEventListener('click', async () => {
        const action = beginChangerAction();
        const icon = currentChanger(action);
        if (!icon) return;
        ui.refetch.disabled = true;
        setChangerStatus('');
        try {
          const working = JSON.parse(JSON.stringify(icon));
          const ok = await resolveIcon(working, { force: true, fetchRemote: true });
          const current = currentChanger(action);
          if (!current) return;
          if (ok) {
            IMAGE_FIELDS.forEach((key) => { if (Object.hasOwn(working, key)) current[key] = working[key]; });
            renewChangerIntent(current);
            const submitted = changerIntent;
            if (!(await persist(true)) || changerIntent !== submitted) return;
          }
          refreshChangerPreview(findIcon(action.id));
          setChangerStatus(ok ? t('已重新抓取图标') : t(MSG_REFETCH_BLOCKED));
        } catch (error) {
          const current = currentChanger(action);
          if (current) { setChangerStatus(t(MSG_REFETCH_BLOCKED)); refreshChangerPreview(current); }
        } finally {
          ui.refetch.disabled = false;
        }
      });
    }
    if (ui.file) {
      ui.file.addEventListener('change', async () => {
        const action = beginChangerAction();
        let icon = currentChanger(action);
        const file = (ui.file.files || [])[0];
        if (!icon || !file) return;
        try {
          const data = await readAndCompressFile(file);
          icon = currentChanger(action);
          if (!icon) return;
          icon.uploadedIconDataUrl = data;
          icon.resolvedIconUrl = data;
          icon.iconSource = 'upload';
          icon.iconCacheState = 'local';
          renewChangerIntent(icon);
          const submitted = changerIntent;
          if (!(await persist(true)) || changerIntent !== submitted) return;
          refreshChangerPreview(findIcon(action.id));
          if (typeof host.showToast === 'function') host.showToast(t('已使用本地图片'));
        } catch (error) {
          if (typeof host.showToast === 'function') host.showToast(t('图片读取失败'));
        }
        ui.file.value = '';
      });
    }
    if (ui.placeholder) {
      ui.placeholder.addEventListener('click', async () => {
        const action = beginChangerAction();
        const icon = currentChanger(action);
        if (!icon) return;
        const letter = (ui.letter && ui.letter.value) || letterFrom(icon);
        const color = (ui.color && ui.color.value) || icon.placeholderColor;
        applyPlaceholder(icon, letter, color);
        renewChangerIntent(icon);
        const submitted = changerIntent;
        if (!(await persist(true)) || changerIntent !== submitted) return;
        refreshChangerPreview(findIcon(action.id));
        if (typeof host.showToast === 'function') host.showToast(t('已使用首字母占位'));
      });
    }
  }

  // Keep failed reads visible and prevent Save from committing an older image.
  function createUploadGate() {
    let latest = null;
    return {
      reset() { latest?.wake(); latest = null; },
      read(draft, read, apply, fail, current) {
        latest?.wake();
        const entry = { draft, ok: false };
        entry.changed = new Promise((resolve) => { entry.wake = resolve; });
        latest = entry;
        entry.done = (async () => {
          try {
            const data = await read();
            if (latest !== entry || !current()) return;
            apply(data);
            entry.ok = true;
          } catch (error) {
            if (latest === entry && current()) fail(error);
          }
        })();
        return entry.done;
      },
      select(draft, elements, read, apply, current, t) {
        const [file] = elements.iconFile.files || [];
        if (!file) {
          this.reset();
          apply('');
          elements.iconUploadStatus.textContent = t('支持 PNG / JPG / SVG / WebP。');
          return;
        }
        elements.iconUploadStatus.textContent = t('正在读取图片…');
        return this.read(draft, () => read(file), (data) => {
          apply(data);
          elements.iconUploadStatus.textContent = t('已选择：{name}', { name: file.name });
        }, () => {
          elements.iconUploadStatus.textContent = t('读取失败，请重新选择。');
        }, current);
      },
      async wait(draft) {
        while (latest?.draft === draft) {
          const entry = latest;
          await Promise.race([entry.done, entry.changed]);
          if (latest === entry) return entry.ok;
        }
        return true;
      }
    };
  }

  function createSaveGate() {
    const pending = new WeakSet();
    let releaseCurrent = () => {};
    return {
      has: (draft) => !!draft && pending.has(draft),
      release: () => releaseCurrent(),
      async run(draft, form, task, onSuccess) {
        if (pending.has(draft)) return;
        pending.add(draft);
        const controls = [...form.querySelectorAll('input, select, textarea, button')].map((node) => [node, node.disabled]);
        controls.forEach(([node]) => { if (node.id !== 'cancel-btn') node.disabled = true; });
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          controls.forEach(([node, disabled]) => { node.disabled = disabled; });
        };
        releaseCurrent = release;
        try { if (await task()) onSuccess(); }
        finally { pending.delete(draft); release(); }
      }
    };
  }

  // Only shipped tools can resolve. Legacy records remain available for
  // backup/edit/delete without being silently redirected to another tool.
  function targetHref(icon, type, getURL) {
    if (type === 'ssh') {
      return icon.sshGatewayUrl && icon.sshGatewayToken && icon.sshHost && icon.sshUsername
        ? getURL(`ssh_terminal.html?iconId=${encodeURIComponent(icon.id)}`) : '';
    }
    if (type === 'tool') {
      return (icon.toolSubtype || 'json-format') === 'json-format' ? getURL('tool.html?tool=json-format') : '';
    }
    try {
      const parsed = new URL(icon.url || '');
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return icon.url;
    } catch (error) { /* invalid */ }
    return '';
  }

  function init(nextHost) {
    host = Object.assign(host, nextHost || {});
    if (typeof document !== 'undefined') bindChanger();
  }

  return {
    targetHref,
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
    hasExplicitCustomIcon,
    remoteSrcList,
    MSG_REFETCH_BLOCKED,
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
    migrateIdleIcon,
    sanitizeIconForSync,
    readAndCompressFile,
    applyPlaceholder,
    openChanger,
    createSaveGate,
    createUploadGate,
    closeChanger,
    placeMenu,
    handleEscape,
    gridIsReady,
    init
  };
}));
