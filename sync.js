(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SECRET_FIELDS = ['sshPassword', 'sshGatewayToken', 'sshSocksPassword'];
  const VAULT_STORE = 'opentab.secretVault';
  const CRYPTO_KEY = 'opentab.cryptoKey';
  const ENABLED_KEY = 'browserSyncEnabled';
  const META_KEY = 'ot.s.meta';
  const QUOTA_BYTES = 102400;
  const QUOTA_BYTES_PER_ITEM = 8192;
  const CHUNK_SIZE = 7000;
  const SYNC_SETTING_KEYS = [
    'searchEngine',
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
    'currentFolderId'
  ];
  const SYNC_TRIGGERS = new Set(['icons', 'folders'].concat(SYNC_SETTING_KEYS));

  let chromeRef = null;
  let pendingVault = {};
  let flushChain = Promise.resolve();
  let enabled = false;
  let applyingRemote = false;
  let pushTimer = 0;
  let syncBound = false;

  function getChrome() {
    if (chromeRef) return chromeRef;
    return typeof chrome !== 'undefined' ? chrome : null;
  }

  function setChrome(api) {
    chromeRef = api || null;
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

  function getSubtle() {
    const webCrypto = typeof crypto !== 'undefined' ? crypto : null;
    return webCrypto && webCrypto.subtle ? webCrypto.subtle : null;
  }

  async function importAesKey(b64) {
    const subtle = getSubtle();
    if (!subtle) return null;
    return subtle.importKey('raw', b64ToBytes(b64), 'AES-GCM', true, ['encrypt', 'decrypt']);
  }

  async function createAesKey() {
    const subtle = getSubtle();
    if (!subtle) return null;
    return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  async function exportAesKey(key) {
    const subtle = getSubtle();
    if (!subtle || !key) return '';
    const raw = await subtle.exportKey('raw', key);
    return bytesToB64(raw);
  }

  async function getOrCreateKeyB64() {
    const stored = await areaGet('local', [CRYPTO_KEY]);
    if (stored[CRYPTO_KEY]) return stored[CRYPTO_KEY];
    const key = await createAesKey();
    if (!key) return '';
    return exportAesKey(key);
  }

  async function sealVault(vault, keyB64) {
    const subtle = getSubtle();
    if (!subtle) return { v: 1, data: '', iv: '', empty: true };
    const key = await importAesKey(keyB64);
    if (!key) return { v: 1, data: '', iv: '', empty: true };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(vault || {}));
    const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return { v: 1, iv: bytesToB64(iv), data: bytesToB64(cipher) };
  }

  async function unsealVault(sealed, keyB64) {
    if (!sealed || sealed.empty || !sealed.data || !keyB64) return {};
    const subtle = getSubtle();
    if (!subtle) return {};
    try {
      const key = await importAesKey(keyB64);
      const iv = b64ToBytes(sealed.iv);
      const data = b64ToBytes(sealed.data);
      const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      const parsed = JSON.parse(new TextDecoder().decode(plain));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function iconsHavePlaintextSecrets(icons) {
    return (Array.isArray(icons) ? icons : []).some((icon) => SECRET_FIELDS.some((field) => !!(icon && icon[field])));
  }

  function prepareLocalPersistSync(payload) {
    const copy = Object.assign({}, payload);
    const icons = Array.isArray(copy.icons) ? copy.icons.map((icon) => Object.assign({}, icon)) : [];
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
      pendingVault[icon.id] = has ? secrets : null;
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
      const keyB64 = await getOrCreateKeyB64();
      const stored = await areaGet('local', [VAULT_STORE, CRYPTO_KEY]);
      const current = await unsealVault(stored[VAULT_STORE], stored[CRYPTO_KEY] || keyB64);
      ids.forEach((id) => {
        if (snapshot[id] === null) delete current[id];
        else if (snapshot[id]) current[id] = snapshot[id];
      });
      const sealed = await sealVault(current, keyB64);
      await areaSet('local', { [VAULT_STORE]: sealed, [CRYPTO_KEY]: keyB64 });
      return sealed;
    });
    return flushChain;
  }

  async function hydrateIcons(icons, result) {
    const list = Array.isArray(icons) ? icons.map((icon) => Object.assign({}, icon)) : [];
    const sealed = result && result[VAULT_STORE];
    const keyB64 = result && result[CRYPTO_KEY];
    const vault = await unsealVault(sealed, keyB64);
    return list.map((icon) => {
      const secrets = icon && icon.id ? vault[icon.id] : null;
      if (!secrets) return icon;
      SECRET_FIELDS.forEach((field) => {
        if (!icon[field] && secrets[field]) icon[field] = secrets[field];
      });
      return icon;
    });
  }

  function stripDataUrlField(value) {
    return typeof value === 'string' && value.indexOf('data:') === 0 ? '' : (value || '');
  }

  function sanitizeIconForSync(icon) {
    const clean = Object.assign({}, icon);
    SECRET_FIELDS.forEach((field) => {
      clean[field] = '';
    });
    clean.uploadedIconDataUrl = stripDataUrlField(clean.uploadedIconDataUrl);
    clean.resolvedIconUrl = stripDataUrlField(clean.resolvedIconUrl);
    return clean;
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
    return {
      v: 1,
      updatedAt: Date.now(),
      icons: (local && Array.isArray(local.icons) ? local.icons : []).map(sanitizeIconForSync),
      folders: groupsToFolders(foldersToGroups(local && local.folders)),
      settings
    };
  }

  function chunkKey(index) {
    return 'ot.s.c' + index;
  }

  function shardSyncPayload(payload) {
    const json = JSON.stringify(payload);
    const chunks = [];
    for (let offset = 0; offset < json.length; offset += CHUNK_SIZE) {
      chunks.push(json.slice(offset, offset + CHUNK_SIZE));
    }
    return { json, jsonLength: json.length, chunks };
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
        bytes: sharded.jsonLength
      }
    }];
    sharded.chunks.forEach((chunk, index) => {
      items.push({ key: chunkKey(index), value: chunk });
    });
    let total = 0;
    for (let i = 0; i < items.length; i += 1) {
      const size = items[i].key.length + JSON.stringify(items[i].value).length;
      if (size > QUOTA_BYTES_PER_ITEM) {
        return {
          ok: false,
          reason: 'item',
          fallback: 'local',
          message: '同步单项超过 8KB 限制，已改为仅保存在本地。'
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
        message: '同步数据超出 100KB 配额，已改为仅保存在本地。'
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
    return '本地存储用量 ' + formatBytes(bytes);
  }

  function formatSyncUsage(bytes, quota) {
    const cap = quota || QUOTA_BYTES;
    const used = Number(bytes) || 0;
    const pct = Math.min(100, Math.round((used / cap) * 100));
    return '浏览器同步 ' + formatBytes(used) + ' / ' + formatBytes(cap) + '（' + pct + '%）';
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
      if (plan.near) {
        setSyncStatus('同步已接近 100KB 配额，数据已分片保存。', false);
      }
      await refreshUsage();
      return plan;
    } catch (error) {
      enabled = false;
      await areaSet('local', { [ENABLED_KEY]: false });
      const checkbox = typeof document !== 'undefined' ? document.getElementById('browser-sync-enabled') : null;
      if (checkbox) checkbox.checked = false;
      setSyncStatus('同步写入失败，已改为仅保存在本地。', true);
      await refreshUsage();
      return { ok: false, fallback: 'local', message: error && error.message };
    } finally {
      applyingRemote = false;
    }
  }

  async function applyRemotePayload(payload) {
    if (!payload) return false;
    applyingRemote = true;
    const toSet = {
      icons: Array.isArray(payload.icons) ? payload.icons.map(sanitizeIconForSync) : [],
      folders: groupsToFolders(foldersToGroups(payload.folders))
    };
    const settings = payload.settings || {};
    SYNC_SETTING_KEYS.forEach((key) => {
      if (settings[key] !== undefined) toSet[key] = settings[key];
    });
    try {
      await areaSet('local', toSet);
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
    }, 400);
  }

  async function setEnabled(next) {
    enabled = !!next;
    await areaSet('local', { [ENABLED_KEY]: enabled });
    const checkbox = typeof document !== 'undefined' ? document.getElementById('browser-sync-enabled') : null;
    if (checkbox) checkbox.checked = enabled;
    if (!enabled) {
      setSyncStatus('已关闭浏览器同步，数据只保存在本机。', false);
      await refreshUsage();
      return { ok: true, enabled: false };
    }
    const remote = await readRemotePayload();
    const local = await areaGet('local', ['icons']);
    const localCount = Array.isArray(local.icons) ? local.icons.length : 0;
    if (remote && (localCount === 0 || (remote.updatedAt && remote.icons && remote.icons.length && localCount <= remote.icons.length))) {
      await applyRemotePayload(remote);
      setSyncStatus('已从浏览器同步恢复快捷方式、分组和设置。', false);
      if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload();
      return { ok: true, enabled: true, pulled: true };
    }
    const pushed = await pushLocalToSync();
    if (pushed.ok) setSyncStatus('已开启浏览器同步（仅快捷方式、分组和设置）。', false);
    return { ok: pushed.ok, enabled, pushed };
  }

  function watchStorage() {
    const api = getChrome();
    if (!api || !api.storage || !api.storage.onChanged || syncBound) return;
    syncBound = true;
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        if (!enabled || applyingRemote) return;
        if (changes[META_KEY]) {
          readRemotePayload().then((payload) => {
            if (!payload) return;
            applyRemotePayload(payload).then((changed) => {
              if (changed && typeof location !== 'undefined') location.reload();
            });
          });
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
    const checkbox = document.getElementById('browser-sync-enabled');
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        setEnabled(checkbox.checked).catch(() => {
          checkbox.checked = false;
          setSyncStatus('无法开启浏览器同步。', true);
        });
      });
    }
    areaGet('local', [ENABLED_KEY]).then((result) => {
      enabled = !!result[ENABLED_KEY];
      if (checkbox) checkbox.checked = enabled;
      refreshUsage();
      if (enabled) schedulePush();
    });
    watchStorage();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
    else bindUi();
  }

  return {
    SECRET_FIELDS,
    VAULT_STORE,
    CRYPTO_KEY,
    ENABLED_KEY,
    META_KEY,
    QUOTA_BYTES,
    QUOTA_BYTES_PER_ITEM,
    CHUNK_SIZE,
    setChrome,
    iconsHavePlaintextSecrets,
    prepareLocalPersistSync,
    flushVault,
    hydrateIcons,
    buildSyncPayload,
    shardSyncPayload,
    unshardSyncPayload,
    planSyncWrite,
    formatBytes,
    formatLocalUsage,
    formatSyncUsage,
    refreshUsage,
    setEnabled,
    pushLocalToSync,
    sanitizeIconForSync
  };
}));
