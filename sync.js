(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Translate only application-owned prose, never stored user content.
  function t(source, params = {}) {
    const i18n = typeof globalThis !== 'undefined' && globalThis.OpenTabI18n;
    return i18n ? i18n.t(source, params) : String(source).replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
  }


  const SECRET_FIELDS = ['sshPassword', 'sshGatewayToken', 'sshSocksPassword'];
  const LOCAL_ONLY_FIELDS = ['uploadedIconDataUrl', 'resolvedIconUrl'];
  const DATA_PREFIX = 'data:';
  const VAULT_STORE = 'opentab.secretVault';
  const CRYPTO_KEY = 'opentab.cryptoKey';
  const ENABLED_KEY = 'browserSyncEnabled';
  const DEVICE_KEY = 'opentab.syncDeviceId';
  const META_KEY = 'ot.s.meta';
  const QUOTA_BYTES = 102400;
  const QUOTA_BYTES_PER_ITEM = 8192;
  const CHUNK_SIZE = 7800;
  const PUSH_DEBOUNCE_MS = 2000;
  const IDB_NAME = 'opentab-crypto';
  const IDB_STORE = 'keys';
  const IDB_KEY = 'vault-key';
  const APPLIED_EVENT = 'opentab-sync-applied';
  const utf8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const utf8dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  const SYNC_SETTING_KEYS = [
    'searchEngine',
    'customSearchEngines',
    'searchOpenInNewTab',
    'searchHistoryEnabled',
    'clockFormat',
    'showSeconds',
    'uiOpacity',
    'uiBlur',
    'iconFrameEnabled',
    'openInNewTab',
    'timezone',
    'themeMode',
    'accentHue',
    'particlesEnabled',
    'gradientFlow',
    'minimalMode',
    'layoutIconSize',
    'layoutColumns',
    'layoutShowNames',
    'layoutMaxWidth',
    'developerToolsEnabled'
  ];
  const SYNC_TRIGGERS = new Set(['icons', 'folders'].concat(SYNC_SETTING_KEYS));
  const wrappedAreas = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  let chromeRef = null;
  let workspaceRef = null;
  let keyStoreRef = null;
  let pendingVault = {};
  let flushChain = Promise.resolve();
  let enabled = false;
  let applyingRemote = false;
  let pushTimer = 0;
  let syncBound = false;
  let deviceId = '';
  let lastPushedHash = '';
  let lastAppliedHash = '';
  let writeCount = 0;
  let cryptoKeyPromise = null;
  let pendingConflict = null;

  function getChrome() {
    if (chromeRef) return chromeRef;
    return typeof chrome !== 'undefined' ? chrome : null;
  }

  function setChrome(api) {
    chromeRef = api || null;
    workspaceRef = null;
    deviceId = '';
    lastPushedHash = '';
    lastAppliedHash = '';
    enabled = false;
    applyingRemote = false;
    pendingConflict = null;
    writeCount = 0;
    pendingVault = {};
    syncBound = false;
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = 0;
    }
    wrapLocalSet();
  }

  function getWorkspace() {
    if (workspaceRef) return workspaceRef;
    if (typeof module === 'object' && module.exports && chromeRef) {
      workspaceRef = require('./workspace-persistence.js').forChrome(chromeRef);
      return workspaceRef;
    }
    if (typeof OpenTabWorkspace !== 'undefined') return OpenTabWorkspace;
    throw new Error('Workspace persistence is unavailable.');
  }

  function setKeyStore(api) {
    keyStoreRef = api || null;
    cryptoKeyPromise = null;
  }

  function oncePair() {
    let settled = false;
    return (resolve, reject) => (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
  }

  function chromeCall(fn, args) {
    return new Promise((resolve, reject) => {
      if (typeof fn !== 'function') {
        reject(new Error('unsupported'));
        return;
      }
      const finish = oncePair()(resolve, reject);
      try {
        const list = Array.isArray(args) ? args : [];
        let usedPromise = false;
        const ret = fn(...list, (result) => {
          if (usedPromise) return;
          const err = getChrome() && getChrome().runtime && getChrome().runtime.lastError;
          if (err) finish(new Error(err.message || 'chrome error'));
          else finish(null, result);
        });
        if (ret && typeof ret.then === 'function') {
          usedPromise = true;
          ret.then((result) => finish(null, result), (error) => finish(error || new Error('denied')));
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  function areaGet(area, keys) {
    const api = getChrome();
    if (!api || !api.storage || !api.storage[area]) return Promise.resolve({});
    return chromeCall(api.storage[area].get.bind(api.storage[area]), [keys]).then((result) => result || {});
  }

  function areaSet(area, payload) {
    const api = getChrome();
    if (!api || !api.storage || !api.storage[area]) return Promise.resolve();
    return chromeCall(api.storage[area].set.bind(api.storage[area]), [payload]);
  }

  function areaRemove(area, keys) {
    const api = getChrome();
    if (!api || !api.storage || !api.storage[area] || !keys || !keys.length) return Promise.resolve();
    return chromeCall(api.storage[area].remove.bind(api.storage[area]), [keys]);
  }

  function bytesToB64(bytes) {
    const arr = new Uint8Array(bytes);
    let binary = '';
    for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
    return btoa(binary);
  }

  function b64ToBytes(b64) {
    const binary = atob(b64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) arr[i] = binary.charCodeAt(i);
    return arr;
  }

  function utf8Length(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (utf8) return utf8.encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }

  function storedItemBytes(key, value) {
    return utf8Length(key) + utf8Length(JSON.stringify(value));
  }

  function getSubtle() {
    const webCrypto = typeof crypto !== 'undefined' ? crypto : null;
    return webCrypto && webCrypto.subtle ? webCrypto.subtle : null;
  }

  function openCryptoDb() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no-idb'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb-open'));
    });
  }

  async function idbGetKey() {
    if (keyStoreRef && typeof keyStoreRef.getKey === 'function') return keyStoreRef.getKey();
    const db = await openCryptoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('idb-get'));
    });
  }

  async function idbSetKey(key) {
    if (keyStoreRef && typeof keyStoreRef.setKey === 'function') return keyStoreRef.setKey(key);
    const db = await openCryptoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(key, IDB_KEY);
      req.onsuccess = () => resolve(key);
      req.onerror = () => reject(req.error || new Error('idb-put'));
    });
  }

  async function createAesKey() {
    const subtle = getSubtle();
    if (!subtle) return null;
    return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function importNonExtractableKey(b64) {
    const subtle = getSubtle();
    if (!subtle || !b64) return null;
    return subtle.importKey('raw', b64ToBytes(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function loadOrCreateCryptoKey() {
    const existing = await idbGetKey().catch(() => null);
    if (existing) return existing;
    const stored = await areaGet('local', [CRYPTO_KEY]);
    if (stored[CRYPTO_KEY]) {
      const migrated = await importNonExtractableKey(stored[CRYPTO_KEY]);
      if (migrated) {
        await idbSetKey(migrated);
        await areaRemove('local', [CRYPTO_KEY]);
        return migrated;
      }
    }
    const generated = await createAesKey();
    if (generated) await idbSetKey(generated);
    return generated;
  }

  function getCryptoKey() {
    if (!cryptoKeyPromise) cryptoKeyPromise = loadOrCreateCryptoKey();
    return cryptoKeyPromise;
  }

  async function sealVault(vault, key) {
    const subtle = getSubtle();
    if (!subtle || !key) return { v: 1, data: '', iv: '', empty: true };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = utf8.encode(JSON.stringify(vault || {}));
    const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return { v: 1, iv: bytesToB64(iv), data: bytesToB64(cipher) };
  }

  async function unsealVault(sealed, key) {
    if (!sealed || sealed.empty || !sealed.data) return { ok: true, vault: {} };
    if (!key) return { ok: false, vault: null };
    const subtle = getSubtle();
    if (!subtle) return { ok: false, vault: null };
    try {
      const iv = b64ToBytes(sealed.iv);
      const data = b64ToBytes(sealed.data);
      const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      const parsed = JSON.parse(utf8dec.decode(plain));
      return { ok: true, vault: parsed && typeof parsed === 'object' ? parsed : {} };
    } catch (error) {
      return { ok: false, vault: null };
    }
  }

  function iconsHavePlaintextSecrets(icons) {
    return (Array.isArray(icons) ? icons : []).some((icon) => SECRET_FIELDS.some((field) => !!(icon && icon[field])));
  }

  function prepareLocalPersistSync(payload, options) {
    if (!payload || typeof payload !== 'object') return payload;
    const copy = Object.assign({}, payload);
    if (!Array.isArray(copy.icons)) return copy;
    const icons = copy.icons.map((icon) => Object.assign({}, icon));
    icons.forEach((icon) => {
      if (!icon || !icon.id) return;
      const secrets = {};
      let has = false;
      SECRET_FIELDS.forEach((field) => {
        if (icon[field]) {
          secrets[field] = icon[field];
          icon[field] = '';
          has = true;
        }
      });
      if (has) pendingVault[icon.id] = secrets;
    });
    const tombstoneIds = options && Array.isArray(options.tombstoneIds) ? options.tombstoneIds : [];
    tombstoneIds.forEach((id) => {
      if (id) pendingVault[id] = null;
    });
    copy.icons = icons;
    return copy;
  }

  async function flushVault() {
    const snapshot = pendingVault;
    pendingVault = {};
    const ids = Object.keys(snapshot);
    if (!ids.length) return null;
    flushChain = flushChain.then(async () => {
      const key = await getCryptoKey();
      if (!key) return null;
      const stored = await areaGet('local', [VAULT_STORE]);
      const opened = await unsealVault(stored[VAULT_STORE], key);
      if (!opened.ok) return null;
      const current = opened.vault || {};
      ids.forEach((id) => {
        if (snapshot[id] === null) delete current[id];
        else if (snapshot[id]) current[id] = snapshot[id];
      });
      const sealed = await sealVault(current, key);
      await areaSet('local', { [VAULT_STORE]: sealed });
      return sealed;
    });
    return flushChain;
  }

  async function hydrateIcons(icons, result) {
    const list = Array.isArray(icons) ? icons.map((icon) => Object.assign({}, icon)) : [];
    const sealed = result && Object.prototype.hasOwnProperty.call(result, VAULT_STORE)
      ? result[VAULT_STORE]
      : (await areaGet('local', [VAULT_STORE]))[VAULT_STORE];
    const key = await getCryptoKey();
    const opened = await unsealVault(sealed, key);
    const vault = opened.ok ? opened.vault : {};
    return list.map((icon) => {
      const secrets = icon && icon.id ? vault[icon.id] : null;
      if (!secrets) return icon;
      SECRET_FIELDS.forEach((field) => {
        if (!icon[field] && secrets[field]) icon[field] = secrets[field];
      });
      return icon;
    });
  }

  function wrapLocalSet() {
    const api = getChrome();
    if (!api || !api.storage || !api.storage.local) return;
    const local = api.storage.local;
    if (wrappedAreas) {
      if (wrappedAreas.has(local)) return;
    } else if (local.__otWrapped) return;
    const origSet = local.set.bind(local);
    function wrappedSet(items, callback) {
      const prepared = prepareLocalPersistSync(items || {});
      const shouldFlush = Object.keys(pendingVault).length > 0;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          if (typeof callback === 'function') callback();
          if (error) reject(error);
          else resolve();
        };
        try {
          origSet(prepared, () => {
            const err = api.runtime && api.runtime.lastError;
            const next = shouldFlush && !err ? flushVault() : Promise.resolve();
            next.then(() => finish(err ? new Error(err.message || 'storage error') : null), () => finish(err ? new Error(err.message || 'storage error') : null));
          });
        } catch (error) {
          finish(error);
        }
      });
    }
    try {
      local.set = wrappedSet;
      if (local.set !== wrappedSet) {
        Object.defineProperty(local, 'set', { configurable: true, writable: true, value: wrappedSet });
      }
      if (wrappedAreas) wrappedAreas.add(local);
      else local.__otWrapped = true;
    } catch (error) {
      // native StorageArea may reject assignment; persist path then stays plaintext
    }
  }

  function stripDataUrlField(value) {
    if (typeof value !== 'string') return value || '';
    if (value.indexOf(DATA_PREFIX) === 0) return '';
    if (value.indexOf('chrome-extension:') === 0 || value.indexOf('blob:') === 0) return '';
    return value;
  }

  function isDataUrl(value) {
    return typeof value === 'string' && value.indexOf(DATA_PREFIX) === 0;
  }

  function isLocalOnlyIconUrl(value) {
    return isDataUrl(value)
      || (typeof value === 'string' && (value.indexOf('chrome-extension:') === 0 || value.indexOf('blob:') === 0));
  }

  function sanitizeIconForSync(icon) {
    if (typeof OpenTabIcons !== 'undefined' && OpenTabIcons.sanitizeIconForSync) {
      const fromIcons = OpenTabIcons.sanitizeIconForSync(icon);
      SECRET_FIELDS.forEach((field) => {
        fromIcons[field] = '';
      });
      return fromIcons;
    }
    const clean = Object.assign({}, icon);
    SECRET_FIELDS.forEach((field) => {
      clean[field] = '';
    });
    clean.uploadedIconDataUrl = stripDataUrlField(clean.uploadedIconDataUrl);
    clean.resolvedIconUrl = stripDataUrlField(clean.resolvedIconUrl);
    if (isLocalOnlyIconUrl(clean.customIconUrl)) clean.customIconUrl = '';
    if (Array.isArray(clean.iconCandidates)) {
      clean.iconCandidates = clean.iconCandidates.filter((item) => typeof item === 'string' && item.indexOf(DATA_PREFIX) !== 0 && item.indexOf('chrome-extension:') !== 0);
    }
    return clean;
  }

  function mergeRemoteIcons(remoteIcons, localIcons) {
    const localById = new Map();
    (Array.isArray(localIcons) ? localIcons : []).forEach((icon) => {
      if (icon && icon.id) localById.set(icon.id, icon);
    });
    return (Array.isArray(remoteIcons) ? remoteIcons : []).map((remote) => {
      const clean = sanitizeIconForSync(remote || {});
      const local = remote && remote.id ? localById.get(remote.id) : null;
      if (!local) return clean;
      LOCAL_ONLY_FIELDS.forEach((field) => {
        if (isLocalOnlyIconUrl(local[field]) && !isLocalOnlyIconUrl(clean[field])) clean[field] = local[field];
      });
      return clean;
    });
  }

  function foldersToGroups(folders) {
    if (typeof OpenTabImport !== 'undefined' && OpenTabImport.foldersToGroups) {
      return OpenTabImport.foldersToGroups(folders);
    }
    return Array.isArray(folders) ? folders.filter((folder) => folder && folder.id && folder.name) : [];
  }

  function groupsToFolders(groups) {
    if (typeof OpenTabImport !== 'undefined' && OpenTabImport.groupsToFolders) {
      return OpenTabImport.groupsToFolders(groups);
    }
    return Array.isArray(groups) ? groups : [];
  }

  function buildSyncPayload(local) {
    const settings = {};
    SYNC_SETTING_KEYS.forEach((key) => {
      if (local && local[key] !== undefined) settings[key] = local[key];
    });
    if (settings.searchHistory) delete settings.searchHistory;
    return {
      v: 1,
      updatedAt: Date.now(),
      icons: (local && Array.isArray(local.icons) ? local.icons : []).map(sanitizeIconForSync),
      folders: groupsToFolders(foldersToGroups(local && local.folders)),
      settings
    };
  }

  async function hashPayload(payload) {
    const body = JSON.stringify({
      icons: payload && payload.icons,
      folders: payload && payload.folders,
      settings: payload && payload.settings
    });
    const subtle = getSubtle();
    if (subtle && typeof subtle.digest === 'function' && utf8) {
      const digest = await subtle.digest('SHA-256', utf8.encode(body));
      return bytesToB64(digest);
    }
    let hash = 0;
    for (let i = 0; i < body.length; i += 1) hash = ((hash << 5) - hash + body.charCodeAt(i)) | 0;
    return 'x' + (hash >>> 0).toString(16);
  }

  async function getDeviceId() {
    if (deviceId) return deviceId;
    return getWorkspace().transaction(async ({ read, write }) => {
      const stored = await read([DEVICE_KEY]);
      if (stored[DEVICE_KEY]) {
        deviceId = stored[DEVICE_KEY];
        return deviceId;
      }
      const next = 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await write({ [DEVICE_KEY]: next });
      deviceId = next;
      return deviceId;
    });
  }

  function chunkKey(index) {
    return 'ot.s.c' + index;
  }

  function isSurrogateSplit(text, index) {
    if (index <= 0 || index >= text.length) return false;
    const prev = text.charCodeAt(index - 1);
    const next = text.charCodeAt(index);
    return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
  }

  function maxStoredSliceEnd(json, offset, key) {
    let lo = 1;
    let hi = json.length - offset;
    let best = 1;
    while (lo <= hi) {
      let mid = (lo + hi) >> 1;
      let end = offset + mid;
      if (isSurrogateSplit(json, end)) {
        mid -= 1;
        end -= 1;
      }
      if (mid < 1) {
        lo += 1;
        continue;
      }
      if (storedItemBytes(key, json.slice(offset, end)) <= CHUNK_SIZE) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    let end = offset + best;
    if (isSurrogateSplit(json, end)) end -= 1;
    if (end <= offset) end = Math.min(offset + 1, json.length);
    return end;
  }

  function shardSyncPayload(payload) {
    const json = JSON.stringify(payload);
    const chunks = [];
    let offset = 0;
    while (offset < json.length) {
      const end = maxStoredSliceEnd(json, offset, chunkKey(chunks.length));
      chunks.push(json.slice(offset, end));
      offset = end;
    }
    return { json, jsonLength: utf8Length(json), chunks };
  }

  function unshardSyncPayload(chunks) {
    return JSON.parse((chunks || []).join(''));
  }

  function planSyncWrite(payload) {
    const sharded = shardSyncPayload(payload);
    const items = [{
      key: META_KEY,
      value: {
        v: 1,
        n: sharded.chunks.length,
        updatedAt: payload.updatedAt,
        hash: payload.hash || '',
        deviceId: payload.deviceId || '',
        bytes: sharded.jsonLength
      }
    }];
    sharded.chunks.forEach((chunk, index) => {
      items.push({ key: chunkKey(index), value: chunk });
    });
    let total = 0;
    for (let i = 0; i < items.length; i += 1) {
      const size = storedItemBytes(items[i].key, items[i].value);
      if (size > QUOTA_BYTES_PER_ITEM) {
        return {
          ok: false,
          reason: 'item',
          fallback: 'local',
          message: t('同步单项超过 8KB 限制，已改为仅保存在本地。')
        };
      }
      total += size;
    }
    if (total > QUOTA_BYTES) {
      return {
        ok: false,
        reason: 'total',
        fallback: 'local',
        bytes: total,
        message: t('同步数据超出 100KB 配额，已改为仅保存在本地。')
      };
    }
    return {
      ok: true,
      items,
      bytes: total,
      near: total > QUOTA_BYTES * 0.8,
      chunkCount: sharded.chunks.length
    };
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    return (n / 1024).toFixed(1) + ' KB';
  }

  function formatLocalUsage(bytes) {
    return t('本地存储用量 {bytes}', { bytes: formatBytes(bytes) });
  }

  function formatSyncUsage(bytes, quota) {
    const cap = quota || QUOTA_BYTES;
    const used = Number(bytes) || 0;
    const pct = Math.min(100, Math.round((used / cap) * 100));
    return t('浏览器同步 {used} / {cap}（{pct}%）', { used: formatBytes(used), cap: formatBytes(cap), pct });
  }

  function setSyncStatus(message, isError) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('import-sync-status');
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#ffb4b4' : '';
  }

  function getBytesInUse(area) {
    const api = getChrome();
    if (!api || !api.storage || !api.storage[area] || typeof api.storage[area].getBytesInUse !== 'function') {
      return Promise.resolve(0);
    }
    return new Promise((resolve) => {
      try {
        const ret = api.storage[area].getBytesInUse(null, (bytes) => resolve(Number(bytes) || 0));
        if (ret && typeof ret.then === 'function') {
          ret.then((bytes) => resolve(Number(bytes) || 0), () => resolve(0));
        }
      } catch (error) {
        resolve(0);
      }
    });
  }

  async function refreshUsage() {
    if (typeof document === 'undefined') return '';
    const el = document.getElementById('storage-usage');
    const localBytes = await getBytesInUse('local');
    let text = formatLocalUsage(localBytes);
    if (enabled) {
      const syncBytes = await getBytesInUse('sync');
      text += ' · ' + formatSyncUsage(syncBytes, QUOTA_BYTES);
    }
    if (el) el.textContent = text;
    return text;
  }

  function notifyApplied() {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent(APPLIED_EVENT));
  }

  async function readRemotePayload() {
    const metaResult = await areaGet('sync', [META_KEY]);
    const meta = metaResult[META_KEY];
    if (!meta || !meta.n) return null;
    const keys = [];
    for (let i = 0; i < meta.n; i += 1) keys.push(chunkKey(i));
    const chunkResult = await areaGet('sync', keys);
    const chunks = [];
    for (let i = 0; i < meta.n; i += 1) {
      if (typeof chunkResult[chunkKey(i)] !== 'string') return null;
      chunks.push(chunkResult[chunkKey(i)]);
    }
    try {
      return unshardSyncPayload(chunks);
    } catch (error) {
      return null;
    }
  }

  async function pushLocalToSync() {
    if (!enabled) return { ok: false, skipped: true };
    const local = await areaGet('local', ['icons', 'folders'].concat(SYNC_SETTING_KEYS));
    const payload = buildSyncPayload(local);
    payload.deviceId = await getDeviceId();
    payload.hash = await hashPayload(payload);
    if (payload.hash && payload.hash === lastPushedHash) {
      return { ok: true, skipped: true, reason: 'unchanged' };
    }
    const plan = planSyncWrite(payload);
    if (!plan.ok) {
      enabled = false;
      await areaSet('local', { [ENABLED_KEY]: false });
      const checkbox = typeof document !== 'undefined' ? document.getElementById('browser-sync-enabled') : null;
      if (checkbox) checkbox.checked = false;
      setSyncStatus(plan.message, true);
      await refreshUsage();
      return plan;
    }
    const currentMeta = await areaGet('sync', [META_KEY]);
    const previous = currentMeta[META_KEY];
    const stale = [];
    if (previous && previous.n > plan.chunkCount) {
      for (let i = plan.chunkCount; i < previous.n; i += 1) stale.push(chunkKey(i));
    }
    const toSet = {};
    plan.items.forEach((item) => {
      toSet[item.key] = item.value;
    });
    try {
      applyingRemote = true;
      await areaSet('sync', toSet);
      if (stale.length) await areaRemove('sync', stale);
      writeCount += 1;
      lastPushedHash = payload.hash;
      lastAppliedHash = payload.hash;
      if (plan.near) {
        setSyncStatus(t('同步已接近 100KB 配额，数据已分片保存。'), false);
      }
      await refreshUsage();
      return plan;
    } catch (error) {
      enabled = false;
      await areaSet('local', { [ENABLED_KEY]: false });
      const checkbox = typeof document !== 'undefined' ? document.getElementById('browser-sync-enabled') : null;
      if (checkbox) checkbox.checked = false;
      setSyncStatus(t('同步写入失败，已改为仅保存在本地。'), true);
      await refreshUsage();
      return { ok: false, fallback: 'local', message: error && error.message };
    } finally {
      applyingRemote = false;
    }
  }

  async function applyRemotePayload(payload, options) {
    if (!payload) return false;
    await getDeviceId();
    if (payload.deviceId && payload.deviceId === deviceId) return false;
    if (payload.hash && payload.hash === lastAppliedHash) return false;
    applyingRemote = true;
    try {
      let snapshot = null;
      let undoBefore = null;
      const workspace = getWorkspace();
      const applied = await workspace.replace((local) => {
        const toSet = {
          icons: mergeRemoteIcons(payload.icons, local.icons),
          folders: groupsToFolders(foldersToGroups(payload.folders))
        };
        const settings = payload.settings || {};
        SYNC_SETTING_KEYS.forEach((key) => {
          if (settings[key] !== undefined) toSet[key] = settings[key];
        });
        if (options && options.snapshotReason && typeof OpenTabImport !== 'undefined' && OpenTabImport.prepareSnapshotRecord) {
          const prepared = OpenTabImport.prepareSnapshotRecord(options.snapshotReason, local);
          toSet[OpenTabImport.BACKUP_SNAPSHOTS_KEY] = prepared.records;
          snapshot = prepared.record;
          // The compact backup drops local icon data. Keep a separate, bounded
          // in-memory inverse containing exactly the fields this pull replaces.
          undoBefore = {
            icons: Array.isArray(local.icons) ? local.icons : [],
            folders: Array.isArray(local.folders) ? local.folders : []
          };
          SYNC_SETTING_KEYS.forEach((key) => {
            if (settings[key] !== undefined && local[key] !== undefined) undoBefore[key] = local[key];
          });
        }
        return toSet;
      });
      lastAppliedHash = payload.hash || lastAppliedHash;
      if (snapshot && options && typeof options.onSnapshot === 'function') {
        const after = {};
        Object.keys(undoBefore).forEach((key) => { after[key] = applied[key]; });
        after[workspace.EPOCH_KEY] = applied[workspace.EPOCH_KEY];
        undoBefore[workspace.EPOCH_KEY] = applied[workspace.EPOCH_KEY];
        options.onSnapshot(snapshot, JSON.parse(JSON.stringify({ before: undoBefore, after })));
      }
      notifyApplied();
      return true;
    } finally {
      applyingRemote = false;
    }
  }

  function schedulePush() {
    if (!enabled || applyingRemote) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = 0;
      pushLocalToSync();
    }, PUSH_DEBOUNCE_MS);
  }

  function hideSyncConflict() {
    pendingConflict = null;
    if (typeof document === 'undefined') return;
    const row = document.getElementById('sync-conflict-row');
    if (row) row.classList.add('hidden');
  }

  function showSyncConflict() {
    if (typeof document === 'undefined') return;
    const row = document.getElementById('sync-conflict-row');
    if (row) row.classList.remove('hidden');
    setSyncStatus(t('云端已有另一台设备的数据。请选择用云端或用本机；用云端会先备份本机。'), false);
  }

  async function undoRemotePayload(undo) {
    if (!undo || !undo.before || !undo.after) throw new Error(t('没有可安全撤销的同步记录。'));
    const saved = await getWorkspace().commit(undo.after, undo.before);
    setSyncStatus(t('已撤销云端替换，保留了之后的其他修改。'), false);
    notifyApplied();
    return saved;
  }

  function showSyncUndoToast(undo) {
    if (typeof document === 'undefined' || !undo) return;
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = t('已用云端数据替换本机。');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t('撤销');
    btn.onclick = async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        await undoRemotePayload(undo);
        toast.classList.add('hidden');
      } catch (error) {
        const message = error && error.code === 'WORKSPACE_CONFLICT'
          ? t('同步后相关内容已被修改，无法安全撤销。现有数据未改动。') : t('撤销失败，请重试。');
        setSyncStatus(message, true);
        toast.textContent = message;
        toast.appendChild(btn);
        toast.classList.remove('hidden');
        btn.disabled = false;
      }
    };
    toast.appendChild(btn);
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 8000);
  }

  async function resolveSyncChoice(choice) {
    const remote = pendingConflict;
    hideSyncConflict();
    if (choice === 'remote') {
      if (!remote) return { ok: false, reason: 'no-conflict' };
      let snapshot = null;
      let undo = null;
      const pulled = await applyRemotePayload(remote, {
        snapshotReason: 'before-sync-pull',
        onSnapshot: (record, inverse) => { snapshot = record; undo = inverse; }
      });
      if (pulled) {
        setSyncStatus(t('已用云端数据替换本机快捷方式，可撤销。'), false);
        showSyncUndoToast(undo);
      }
      await refreshUsage();
      return { ok: true, pulled: !!pulled, snapshotId: snapshot && snapshot.id };
    }
    const pushed = await pushLocalToSync();
    if (pushed.ok) setSyncStatus(t('已用本机数据覆盖云端。'), false);
    await refreshUsage();
    return { ok: !!pushed.ok, pushed: true };
  }

  async function migratePlaintextSecrets() {
    return getWorkspace().transaction(async ({ read, write }) => {
      const local = await read(['icons']);
      if (!iconsHavePlaintextSecrets(local.icons)) return false;
      applyingRemote = true;
      try {
        await write({ icons: local.icons });
        return true;
      } finally {
        applyingRemote = false;
      }
    });
  }

  async function setEnabled(next) {
    enabled = !!next;
    await areaSet('local', { [ENABLED_KEY]: enabled });
    const checkbox = typeof document !== 'undefined' ? document.getElementById('browser-sync-enabled') : null;
    if (checkbox) checkbox.checked = enabled;
    if (!enabled) {
      hideSyncConflict();
      setSyncStatus(t('已关闭浏览器同步，数据只保存在本机。'), false);
      await refreshUsage();
      return { ok: true, enabled: false };
    }
    await getDeviceId();
    const remote = await readRemotePayload();
    const local = await areaGet('local', ['icons']);
    const localCount = Array.isArray(local.icons) ? local.icons.length : 0;
    const remoteFromOther = !!(remote && remote.deviceId && remote.deviceId !== deviceId);
    const remoteHasIcons = !!(remote && Array.isArray(remote.icons) && remote.icons.length);
    if (remoteFromOther && remoteHasIcons && localCount === 0) {
      const pulled = await applyRemotePayload(remote);
      if (pulled) {
        setSyncStatus(t('已从浏览器同步恢复快捷方式、分组和设置。'), false);
        await refreshUsage();
        return { ok: true, enabled: true, pulled: true };
      }
    }
    if (remoteFromOther && remoteHasIcons && localCount > 0) {
      pendingConflict = remote;
      showSyncConflict();
      await refreshUsage();
      return { ok: true, enabled: true, conflict: true, localCount, remoteCount: remote.icons.length };
    }
    const pushed = await pushLocalToSync();
    if (pushed.ok) setSyncStatus(t('已开启浏览器同步（仅快捷方式、分组和设置）。'), false);
    return { ok: pushed.ok, enabled, pushed };
  }

  function watchStorage() {
    const api = getChrome();
    if (!api || !api.storage || !api.storage.onChanged || syncBound) return;
    syncBound = true;
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        if (!enabled || applyingRemote || pendingConflict) return;
        if (changes[META_KEY]) {
          readRemotePayload().then((payload) => {
            if (!payload) return;
            return applyRemotePayload(payload);
          }).catch(() => setSyncStatus(t('读取或保存云端数据失败，请重试。'), true));
        }
        return;
      }
      if (area !== 'local' || applyingRemote || !enabled) return;
      const keys = Object.keys(changes || {});
      if (keys.some((key) => SYNC_TRIGGERS.has(key))) schedulePush();
    });
  }

  function bindUi() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('import-sync-section')) return;
    wrapLocalSet();
    migratePlaintextSecrets().catch(() => setSyncStatus(t('保护本地凭据时保存失败，请重试。'), true));
    const checkbox = document.getElementById('browser-sync-enabled');
    const useRemoteBtn = document.getElementById('sync-use-remote-btn');
    const useLocalBtn = document.getElementById('sync-use-local-btn');
    if (useRemoteBtn) {
      useRemoteBtn.addEventListener('click', () => {
        resolveSyncChoice('remote').catch(() => setSyncStatus(t('无法使用云端数据。'), true));
      });
    }
    if (useLocalBtn) {
      useLocalBtn.addEventListener('click', () => {
        resolveSyncChoice('local').catch(() => setSyncStatus(t('无法上传本机数据。'), true));
      });
    }
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        setEnabled(checkbox.checked).catch(() => {
          checkbox.checked = false;
          setSyncStatus(t('无法开启浏览器同步。'), true);
        });
      });
    }
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => { refreshUsage(); });
    }
    areaGet('local', [ENABLED_KEY, DEVICE_KEY]).then((result) => {
      enabled = !!result[ENABLED_KEY];
      if (result[DEVICE_KEY]) deviceId = result[DEVICE_KEY];
      if (checkbox) checkbox.checked = enabled;
      refreshUsage();
    });
    watchStorage();
  }

  if (typeof document !== 'undefined') {
    wrapLocalSet();
    const start = () => {
      if (globalThis.OpenTabI18n) globalThis.OpenTabI18n.ready.then(bindUi);
      else bindUi();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return {
    SECRET_FIELDS,
    SYNC_SETTING_KEYS,
    VAULT_STORE,
    CRYPTO_KEY,
    ENABLED_KEY,
    DEVICE_KEY,
    META_KEY,
    QUOTA_BYTES,
    QUOTA_BYTES_PER_ITEM,
    CHUNK_SIZE,
    PUSH_DEBOUNCE_MS,
    APPLIED_EVENT,
    setChrome,
    setKeyStore,
    wrapLocalSet,
    iconsHavePlaintextSecrets,
    migratePlaintextSecrets,
    prepareLocalPersistSync,
    flushVault,
    hydrateIcons,
    getCryptoKey,
    buildSyncPayload,
    shardSyncPayload,
    unshardSyncPayload,
    planSyncWrite,
    utf8Length,
    storedItemBytes,
    mergeRemoteIcons,
    formatBytes,
    formatLocalUsage,
    formatSyncUsage,
    refreshUsage,
    setEnabled,
    resolveSyncChoice,
    pushLocalToSync,
    applyRemotePayload,
    undoRemotePayload,
    sanitizeIconForSync,
    getWriteCount: () => writeCount,
    getDeviceId
  };
}));
