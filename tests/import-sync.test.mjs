import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const OpenTabImport = require('../import.js');
const OpenTabSync = require('../sync.js');

function memoryArea(store) {
  return {
    get: (keys, cb) => {
      const result = {};
      const list = Array.isArray(keys)
        ? keys
        : (keys == null ? Object.keys(store) : [keys]);
      list.forEach((key) => {
        if (store[key] !== undefined) result[key] = store[key];
      });
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    },
    set: (payload, cb) => {
      Object.assign(store, payload);
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    },
    remove: (keys, cb) => {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        delete store[key];
      });
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    },
    getBytesInUse: (_keys, cb) => {
      const bytes = JSON.stringify(store).length;
      if (typeof cb === 'function') cb(bytes);
      return Promise.resolve(bytes);
    }
  };
}

function createChrome(options = {}) {
  const local = { ...(options.local || {}) };
  const sync = { ...(options.sync || {}) };
  const permissionMap = {
    bookmarks: options.bookmarksGranted !== false,
    topSites: options.topSitesGranted !== false,
    ...(options.permissions || {})
  };
  return {
    runtime: { lastError: null },
    permissions: {
      request: (opts, cb) => {
        const name = (opts && opts.permissions && opts.permissions[0]) || '';
        const granted = !!permissionMap[name];
        if (typeof cb === 'function') cb(granted);
        return Promise.resolve(granted);
      }
    },
    bookmarks: {
      getTree: (cb) => {
        if (typeof cb === 'function') cb(options.bookmarkTree || []);
        return Promise.resolve(options.bookmarkTree || []);
      }
    },
    topSites: {
      get: (cb) => {
        if (typeof cb === 'function') cb(options.topSites || []);
        return Promise.resolve(options.topSites || []);
      }
    },
    storage: {
      local: memoryArea(local),
      sync: memoryArea(sync),
      onChanged: { addListener() {} }
    },
    _local: local,
    _sync: sync
  };
}

const BOOKMARK_TREE = [{
  id: '0',
  title: '',
  children: [{
    id: '1',
    title: '书签栏',
    children: [{
      id: '10',
      title: 'Work',
      children: [
        { id: '101', title: 'GitHub', url: 'https://github.com/' },
        { id: '102', title: 'Docs', url: 'https://docs.example.com/' },
        {
          id: '11',
          title: 'Nested',
          children: [{ id: '111', title: 'Nested Site', url: 'https://nested.example.com/' }]
        }
      ]
    }]
  }]
}];

const INFINITY_BACKUP = {
  data: {
    site: {
      sites: [[
        { type: 'web', name: 'Google', target: 'https://google.com/' },
        {
          name: 'Dev',
          children: [{ type: 'web', name: 'MDN', target: 'https://developer.mozilla.org/' }]
        }
      ]]
    }
  },
  time: 1
};

const WETAB_BACKUP = {
  data: {
    'store-icon': {
      icons: [{
        name: '常用',
        children: [
          { type: 'site', name: 'Weibo', target: 'https://weibo.com/' },
          {
            type: 'folder-icon',
            name: '工具',
            children: [{ type: 'site', name: 'Translate', target: 'https://translate.google.com/' }]
          }
        ]
      }]
    }
  }
};

const ITAB_BACKUP = {
  config: { nav: [{ name: '工作' }, { name: '生活' }] },
  nav: [
    [{ name: 'GitHub', url: 'https://github.com/' }, { name: '天气组件' }],
    [{ name: 'Bilibili', url: 'https://www.bilibili.com/' }]
  ]
};

function memoryKeyStore() {
  let key = null;
  return {
    getKey: async () => key,
    setKey: async (next) => { key = next; }
  };
}

async function withChrome(options, fn) {
  const chromeApi = createChrome(options);
  OpenTabImport.setChrome(chromeApi);
  OpenTabSync.setChrome(chromeApi);
  OpenTabSync.setKeyStore(memoryKeyStore());
  let seq = 0;
  OpenTabImport.setIdFactory(() => 'id-' + (++seq));
  let reloads = 0;
  OpenTabImport.setReloader(() => { reloads += 1; });
  try {
    return await fn(chromeApi, () => reloads);
  } finally {
    OpenTabImport.setChrome(null);
    OpenTabSync.setChrome(null);
    OpenTabSync.setKeyStore(null);
    OpenTabImport.setIdFactory(null);
    OpenTabImport.setReloader(null);
  }
}

function existingWorkspace() {
  return {
    folders: [{ id: 'folder-home', name: '主页' }],
    icons: [{
      id: 'keep-me',
      name: 'Keep',
      url: 'https://keep.example.com/',
      folderId: 'folder-home',
      type: 'shortcut'
    }],
    currentFolderId: 'folder-home'
  };
}

async function run() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(!manifest.permissions.includes('bookmarks'), 'AC7: bookmarks must not be required');
  assert.ok(!manifest.permissions.includes('topSites'), 'AC7: topSites must not be required');
  assert.deepEqual(
    [...(manifest.optional_permissions || [])].sort(),
    ['bookmarks', 'topSites'],
    'AC1/AC2: bookmarks and topSites are optional_permissions'
  );
  assert.ok(!fs.readFileSync(path.join(root, 'ssh-gateway.mjs'), 'utf8').includes('OpenTabImport'));
  try {
    const masterBytes = Number(execSync('git cat-file -s origin/master:home.js', { encoding: 'utf8' }).trim());
    const localBytes = fs.statSync(path.join(root, 'home.js')).size;
    assert.ok(
      localBytes <= masterBytes,
      `home.js grew vs origin/master: ${localBytes} > ${masterBytes}`
    );
  } catch (error) {
    if (error && error.code === 'ERR_ASSERTION') throw error;
  }

  const folders = [{ id: 'folder-home', name: '主页' }, { id: 'folder-a', name: 'A' }];
  assert.deepEqual(OpenTabImport.groupsToFolders(OpenTabImport.foldersToGroups(folders)), folders);
  const nestedFolders = [
    { id: 'folder-home', name: '主页' },
    { id: 'folder-work', name: '工作', parentId: 'folder-home', type: 'folder' }
  ];
  assert.deepEqual(OpenTabImport.groupsToFolders(OpenTabImport.foldersToGroups(nestedFolders)), nestedFolders);
  assert.equal(OpenTabImport.readIconGroupId({ folderId: 'folder-a' }), 'folder-a');
  assert.equal(OpenTabImport.withIconGroup({ name: 'x' }, 'folder-a').folderId, 'folder-a');

  await withChrome({ bookmarksGranted: false }, async () => {
    const result = await OpenTabImport.requestOptionalPermission('bookmarks');
    assert.equal(result.granted, false);
    assert.equal(result.reason, 'denied');
    const loaded = await OpenTabImport.loadBookmarkFolders();
    assert.equal(loaded.ok, false);
    assert.equal(loaded.denied, true);
    assert.match(loaded.message, /书签权限/);
  });

  await withChrome({
    bookmarkTree: BOOKMARK_TREE,
    local: existingWorkspace()
  }, async (chromeApi, reloads) => {
    const parsed = OpenTabImport.parsedFromBookmarkFolder(BOOKMARK_TREE, '10');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.groupCount, 1);
    assert.equal(parsed.groups[0].name, 'Work');
    assert.equal(parsed.groups[0].icons.length, 3);
    const committed = await OpenTabImport.commitImport(parsed);
    assert.equal(committed.ok, true);
    assert.equal(committed.iconCount, 3);
    assert.equal(committed.groupCount, 1);
    assert.equal(reloads(), 1);
    assert.ok(chromeApi._local.folders.some((folder) => folder.name === 'Work'));
    assert.ok(chromeApi._local.icons.some((icon) => icon.name === 'GitHub'));
    assert.ok(chromeApi._local.icons.some((icon) => icon.id === 'keep-me'), 'existing shortcuts stay');
    assert.ok(chromeApi._local[OpenTabImport.UNDO_KEY]);
    const undone = await OpenTabImport.undoLastImport();
    assert.equal(undone.ok, true);
    assert.ok(chromeApi._local.icons.every((icon) => icon.id === 'keep-me' || icon.name === 'Keep'));
    assert.ok(!chromeApi._local.folders.some((folder) => folder.name === 'Work'));
  });

  await withChrome({ topSitesGranted: false }, async () => {
    const result = await OpenTabImport.importTopSites();
    assert.equal(result.denied, true);
    assert.match(result.message, /常用网站权限/);
  });

  const manySites = Array.from({ length: 15 }, (_, i) => ({
    title: 'Site ' + i,
    url: 'https://example.com/' + i
  }));
  await withChrome({
    topSites: manySites,
    local: existingWorkspace()
  }, async (chromeApi) => {
    const parsed = OpenTabImport.parsedFromTopSites(manySites);
    assert.equal(parsed.groups[0].icons.length, 12);
    const committed = await OpenTabImport.commitImport(parsed);
    assert.equal(committed.iconCount, 12);
    assert.ok(chromeApi._local.folders.some((folder) => folder.name === '常用网站'));
  });

  const infinity = OpenTabImport.parseBackupFile(JSON.stringify(INFINITY_BACKUP), 'backup.infinity');
  assert.equal(infinity.ok, true);
  assert.equal(infinity.format, 'infinity');
  assert.ok(infinity.iconCount >= 2);
  assert.ok(infinity.groupCount >= 2);

  const wetab = OpenTabImport.parseBackupFile(WETAB_BACKUP, 'wetab-bak.json');
  assert.equal(wetab.ok, true);
  assert.equal(wetab.format, 'wetab');
  assert.equal(wetab.iconCount, 2);

  const itab = OpenTabImport.parseBackupFile(ITAB_BACKUP, 'startpage.json');
  assert.equal(itab.ok, true);
  assert.equal(itab.format, 'itab');
  assert.equal(itab.iconCount, 2);
  assert.equal(itab.groupCount, 2);

  const unknown = OpenTabImport.parseBackupFile('{"foo":1}', 'mystery.json');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'unrecognized');
  assert.match(unknown.message, /无法识别/);

  const invalid = OpenTabImport.parseBackupFile('{not json', 'bad.json');
  assert.equal(invalid.error, 'invalid-json');

  await withChrome({ local: existingWorkspace() }, async (chromeApi, reloads) => {
    const before = JSON.stringify(chromeApi._local.icons);
    const parsed = OpenTabImport.parseBackupFile('{"nope":true}', 'x.json');
    assert.equal(parsed.ok, false);
    assert.equal(JSON.stringify(chromeApi._local.icons), before);
    assert.equal(reloads(), 0);
    const imported = await OpenTabImport.commitImport(infinity);
    assert.equal(imported.ok, true);
    assert.ok(chromeApi._local.icons.some((icon) => icon.name === 'Google'));
    assert.ok(chromeApi._local.icons.some((icon) => icon.id === 'keep-me'));
  });

  const secretState = {
    icons: [{
      id: 'ssh1',
      name: 'Jump',
      type: 'ssh',
      sshPassword: 's3cret',
      sshGatewayToken: 'tok-1',
      sshSocksPassword: 'socks-pw',
      sshHost: '10.0.0.1'
    }],
    folders: [{ id: 'folder-home', name: '主页' }],
    background: { type: 'image', value: 'data:image/png;base64,AAAA' }
  };
  const stripped = OpenTabImport.stripSecretsFromState(secretState);
  assert.equal(stripped.icons[0].sshPassword, '');
  assert.equal(stripped.icons[0].sshGatewayToken, '');
  assert.equal(stripped.icons[0].sshSocksPassword, '');
  assert.equal(secretState.icons[0].sshPassword, 's3cret');
  assert.equal(stripped.icons[0].sshHost, '10.0.0.1');

  const prepared = OpenTabSync.prepareLocalPersistSync({
    icons: [{ id: 'ssh1', sshPassword: 's3cret', sshGatewayToken: 'tok-1', sshSocksPassword: 'socks-pw' }],
    folders: []
  });
  assert.equal(prepared.icons[0].sshPassword, '');
  assert.equal(prepared.icons[0].sshGatewayToken, '');
  assert.equal(prepared.icons[0].sshSocksPassword, '');

  await withChrome({ local: {} }, async (chromeApi) => {
    OpenTabSync.prepareLocalPersistSync({
      icons: [{ id: 'ssh1', sshPassword: 's3cret', sshGatewayToken: 'tok-1', sshSocksPassword: 'socks-pw' }]
    });
    await OpenTabSync.flushVault();
    const serialized = JSON.stringify(chromeApi._local);
    assert.equal(serialized.includes('s3cret'), false);
    assert.equal(serialized.includes('tok-1'), false);
    assert.equal(serialized.includes('socks-pw'), false);
    assert.ok(chromeApi._local[OpenTabSync.VAULT_STORE]);
    assert.equal(chromeApi._local[OpenTabSync.CRYPTO_KEY], undefined);
    const key = await OpenTabSync.getCryptoKey();
    assert.equal(key.extractable, false);
    await assert.rejects(() => crypto.subtle.exportKey('raw', key));
    const hydrated = await OpenTabSync.hydrateIcons(
      [{ id: 'ssh1', sshPassword: '', sshGatewayToken: '', sshSocksPassword: '' }],
      chromeApi._local
    );
    assert.equal(hydrated[0].sshPassword, 's3cret');
    assert.equal(hydrated[0].sshGatewayToken, 'tok-1');
  });

  await withChrome({ local: {} }, async (chromeApi) => {
    await chromeApi.storage.local.set({
      icons: [{ id: 'ssh1', sshPassword: 's3cret', sshGatewayToken: 'tok-1' }]
    });
    assert.equal(chromeApi._local.icons[0].sshPassword, '');
    OpenTabSync.prepareLocalPersistSync({
      icons: [{ id: 'ssh1', sshPassword: '', sshGatewayToken: '' }]
    });
    await OpenTabSync.flushVault();
    const hydrated = await OpenTabSync.hydrateIcons(
      [{ id: 'ssh1', sshPassword: '', sshGatewayToken: '' }],
      chromeApi._local
    );
    assert.equal(hydrated[0].sshPassword, 's3cret', 'BUG-020: empty persist does not tombstone vault');
  });

  await withChrome({
    local: {
      icons: [{ id: 'ssh1', name: 'Jump', sshPassword: '', folderId: 'folder-home' }],
      folders: [{ id: 'folder-home', name: '主页' }]
    }
  }, async (chromeApi) => {
    OpenTabSync.prepareLocalPersistSync({
      icons: [{ id: 'ssh1', sshPassword: 'keep-me' }]
    });
    await OpenTabSync.flushVault();
    await OpenTabImport.applyOpenTabBackup({
      icons: [{ id: 'ssh1', name: 'Jump restored', sshPassword: '', folderId: 'folder-home' }],
      folders: [{ id: 'folder-home', name: '主页' }]
    });
    const hydrated = await OpenTabSync.hydrateIcons(chromeApi._local.icons, chromeApi._local);
    assert.equal(hydrated[0].sshPassword, 'keep-me', 'BUG-020: backup restore keeps vault for same id');
  });

  const rawKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rawBits = await crypto.subtle.exportKey('raw', rawKey);
  const rawB64 = Buffer.from(new Uint8Array(rawBits)).toString('base64');
  await withChrome({ local: { [OpenTabSync.CRYPTO_KEY]: rawB64 } }, async (chromeApi) => {
    const migrated = await OpenTabSync.getCryptoKey();
    assert.equal(migrated.extractable, false);
    assert.equal(chromeApi._local[OpenTabSync.CRYPTO_KEY], undefined);
  });

  const syncPayload = OpenTabSync.buildSyncPayload({
    icons: [{
      id: 'a',
      name: 'A',
      url: 'https://a.example/',
      folderId: 'folder-home',
      sshPassword: 'nope',
      uploadedIconDataUrl: 'data:image/png;base64,AAAA',
      resolvedIconUrl: 'data:image/gif;base64,AAAA'
    }],
    folders: [{ id: 'folder-home', name: '主页' }],
    background: { type: 'image', value: 'data:image/png;base64,WALLPAPER' },
    todos: [{ id: 't1', text: 'secret todo' }],
    bingIndex: 4,
    clockFormat: '24h',
    searchEngine: 'bing',
    currentFolderId: 'folder-should-stay-local'
  });
  const syncJson = JSON.stringify(syncPayload);
  assert.equal(syncJson.includes('nope'), false);
  assert.equal(syncJson.includes('WALLPAPER'), false);
  assert.equal(syncJson.includes('secret todo'), false);
  assert.equal(syncPayload.background, undefined);
  assert.equal(syncPayload.todos, undefined);
  assert.equal(syncPayload.bingIndex, undefined);
  assert.equal(syncPayload.settings.clockFormat, '24h');
  assert.equal(syncPayload.settings.currentFolderId, undefined);
  assert.equal(syncPayload.icons[0].uploadedIconDataUrl, '');

  const modest = OpenTabSync.buildSyncPayload({
    icons: Array.from({ length: 8 }, (_, i) => ({
      id: 'i' + i,
      name: 'Site ' + i,
      url: 'https://example.com/' + i,
      folderId: 'folder-home'
    })),
    folders: [{ id: 'folder-home', name: '主页' }],
    clockFormat: '12h'
  });
  const modestPlan = OpenTabSync.planSyncWrite(modest);
  assert.equal(modestPlan.ok, true);
  modestPlan.items.forEach((item) => {
    const size = item.key.length + JSON.stringify(item.value).length;
    assert.ok(size <= OpenTabSync.QUOTA_BYTES_PER_ITEM, 'chunk exceeds 8KB: ' + size);
  });
  const restored = OpenTabSync.unshardSyncPayload(
    modestPlan.items.filter((item) => item.key.startsWith('ot.s.c')).map((item) => item.value)
  );
  assert.equal(restored.settings.clockFormat, '12h');

  const huge = OpenTabSync.buildSyncPayload({
    icons: Array.from({ length: 4000 }, (_, i) => ({
      id: 'x' + i,
      name: 'Name ' + i + ' ' + 'y'.repeat(24),
      url: 'https://example.com/path/' + i + '/' + 'z'.repeat(24),
      folderId: 'folder-home',
      type: 'shortcut'
    })),
    folders: [{ id: 'folder-home', name: '主页' }]
  });
  const hugePlan = OpenTabSync.planSyncWrite(huge);
  assert.equal(hugePlan.ok, false);
  assert.equal(hugePlan.fallback, 'local');
  assert.match(hugePlan.message, /本地/);

  assert.match(OpenTabSync.formatLocalUsage(2048), /本地存储用量/);
  assert.match(OpenTabSync.formatSyncUsage(51200, 102400), /50%/);

  const chinese = OpenTabSync.buildSyncPayload({
    icons: Array.from({ length: 20 }, (_, i) => ({
      id: 'c' + i,
      name: '中文站点名称测试😀' + i,
      url: 'https://example.com/' + i,
      folderId: 'folder-home'
    })),
    folders: [{ id: 'folder-home', name: '主页' }]
  });
  const chinesePlan = OpenTabSync.planSyncWrite(chinese);
  assert.equal(chinesePlan.ok, true, 'BUG-018: 20 Chinese/emoji names stay under quota');
  chinesePlan.items.forEach((item) => {
    const size = OpenTabSync.storedItemBytes(item.key, item.value);
    assert.ok(size <= OpenTabSync.QUOTA_BYTES_PER_ITEM, 'BUG-018 utf8 item exceeds 8KB: ' + size);
    if (item.key.startsWith('ot.s.c')) {
      assert.ok(size <= OpenTabSync.CHUNK_SIZE, 'BUG-022 stored chunk exceeds 7800: ' + size);
    }
  });
  const bulky = OpenTabSync.shardSyncPayload({ v: 1, blob: '中'.repeat(4000) + '😀'.repeat(200) });
  bulky.chunks.forEach((chunk, index) => {
    const size = OpenTabSync.storedItemBytes('ot.s.c' + index, chunk);
    assert.ok(size <= OpenTabSync.CHUNK_SIZE, 'BUG-022 bulky stored chunk exceeds 7800: ' + size);
  });
  const bulkyRestored = OpenTabSync.unshardSyncPayload(bulky.chunks);
  assert.equal(bulkyRestored.blob.startsWith('中'), true);
  assert.match(bulkyRestored.blob, /😀/);

  const quotedIcons = Array.from({ length: 80 }, (_, i) => ({
    id: 'q' + i,
    name: '中文"引号\\站点"' + i,
    url: 'https://example.com/path?q="' + i + '"\\x',
    folderId: 'folder-home',
    type: 'shortcut'
  }));
  const quotedPayload = OpenTabSync.buildSyncPayload({
    icons: quotedIcons,
    folders: [{ id: 'folder-home', name: '主页' }]
  });
  const quotedPlan = OpenTabSync.planSyncWrite(quotedPayload);
  assert.equal(quotedPlan.ok, true, 'BUG-022: quoted Chinese payload should stay under quota');
  assert.ok(
    quotedPlan.chunkCount >= 3,
    'BUG-022: expected at least 3 shards, got ' + quotedPlan.chunkCount
  );
  quotedPlan.items.forEach((item) => {
    const size = OpenTabSync.storedItemBytes(item.key, item.value);
    assert.ok(size <= OpenTabSync.QUOTA_BYTES_PER_ITEM, 'BUG-022 stored item ' + item.key + ' is ' + size);
  });
  const quotedRestored = OpenTabSync.unshardSyncPayload(
    quotedPlan.items.filter((item) => item.key.startsWith('ot.s.c')).map((item) => item.value)
  );
  assert.equal(quotedRestored.icons.length, 80);
  assert.equal(quotedRestored.icons[0].name, quotedIcons[0].name);
  assert.equal(quotedRestored.icons[79].url, quotedIcons[79].url);

  const merged = OpenTabSync.mergeRemoteIcons(
    [{ id: 'a', name: 'Remote', uploadedIconDataUrl: '', resolvedIconUrl: '', sshPassword: 'nope' }],
    [{ id: 'a', name: 'Local', uploadedIconDataUrl: 'data:image/png;base64,AAAA', resolvedIconUrl: 'data:image/gif;base64,BBBB', sshPassword: 'local-secret' }]
  );
  assert.equal(merged[0].uploadedIconDataUrl, 'data:image/png;base64,AAAA', 'BUG-017: keep local data URL');
  assert.equal(merged[0].resolvedIconUrl, 'data:image/gif;base64,BBBB');
  assert.equal(merged[0].sshPassword, '', 'remote sanitize still strips secrets from the icon record');

  await withChrome({ local: { icons: [{ id: 'a', name: 'Keep', uploadedIconDataUrl: 'data:image/png;base64,KEEP' }] } }, async (chromeApi) => {
    const mine = await OpenTabSync.getDeviceId();
    const skippedSelf = await OpenTabSync.applyRemotePayload({
      deviceId: mine,
      hash: 'other',
      icons: [{ id: 'b', name: 'Injected' }],
      folders: [],
      settings: {}
    });
    assert.equal(skippedSelf, false, 'BUG-016: ignore payload from this deviceId');
    const applied = await OpenTabSync.applyRemotePayload({
      deviceId: 'dev-other',
      hash: 'payload-1',
      icons: [{ id: 'a', name: 'FromRemote', uploadedIconDataUrl: '', url: 'https://a.example/' }],
      folders: [{ id: 'folder-home', name: '主页' }],
      settings: { clockFormat: '24h', customSearchEngines: [], searchOpenInNewTab: true }
    });
    assert.equal(applied, true);
    assert.equal(chromeApi._local.icons[0].uploadedIconDataUrl, 'data:image/png;base64,KEEP');
    assert.equal(chromeApi._local.clockFormat, '24h');
    assert.equal(chromeApi._local.searchOpenInNewTab, true);
    assert.equal(chromeApi._local.currentFolderId, undefined);
    const again = await OpenTabSync.applyRemotePayload({
      deviceId: 'dev-other',
      hash: 'payload-1',
      icons: [{ id: 'a', name: 'FromRemote' }],
      folders: [],
      settings: {}
    });
    assert.equal(again, false, 'BUG-016: same content hash is not applied twice');
  });

  const backup = OpenTabImport.mergeBackupPayload(
    { background: { type: 'image', value: 'assets/default_background/x.jpg', source: 'preset-image' } },
    { icons: [{ id: 'keep-me' }], searchHistory: [{ q: 'secret', engine: 'google', at: 1 }] }
  );
  assert.equal(backup.background.value, 'assets/default_background/x.jpg');
  assert.equal(backup.icons[0].id, 'keep-me');
  const downloaded = OpenTabImport.mergeBackupPayload(
    { searchEngine: 'bing', searchHistory: [{ q: 'x', engine: 'bing', at: 1 }] },
    {}
  );
  assert.equal(Array.isArray(downloaded.searchHistory), true);

  await withChrome({
    local: {
      icons: [{
        id: 'keep-me',
        name: 'Keep',
        url: 'https://keep.example.com/',
        folderId: 'folder-home',
        type: 'shortcut'
      }],
      folders: [{ id: 'folder-home', name: '主页' }],
      currentFolderId: 'folder-home'
    }
  }, async (chromeApi) => {
    await OpenTabImport.applyOpenTabBackup({
      folders: [
        { id: 'folder-home', name: '主页' },
        { id: 'folder-work', name: '工作', parentId: 'folder-home', type: 'folder' }
      ],
      icons: [
        {
          id: 'folder-icon-1',
          name: '工作',
          type: 'folder',
          folderId: 'folder-home',
          parentId: ''
        },
        {
          id: 'nested-site',
          name: 'Nested',
          url: 'https://nested.example.com/',
          folderId: 'folder-home',
          parentId: 'folder-icon-1',
          type: 'shortcut'
        }
      ],
      currentFolderId: 'folder-work'
    });
    const work = chromeApi._local.folders.find((folder) => folder.id === 'folder-work');
    assert.equal(work.parentId, 'folder-home');
    assert.equal(work.type, 'folder');
    const nested = chromeApi._local.icons.find((icon) => icon.id === 'nested-site');
    assert.equal(nested.parentId, 'folder-icon-1');
    assert.equal(nested.type, 'shortcut');
    assert.equal(chromeApi._local.currentFolderId, 'folder-work');
  });

  await withChrome({
    local: { icons: [{ id: 'ssh1', name: 'Jump', sshPassword: 'old-plain' }] }
  }, async (chromeApi) => {
    chromeApi._local.icons = [{ id: 'ssh1', name: 'Jump', sshPassword: 'old-plain' }];
    assert.equal(chromeApi._local.icons[0].sshPassword, 'old-plain');
    const migrated = await OpenTabSync.migratePlaintextSecrets();
    assert.equal(migrated, true);
    assert.equal(chromeApi._local.icons[0].sshPassword, '');
    const hydrated = await OpenTabSync.hydrateIcons(chromeApi._local.icons, chromeApi._local);
    assert.equal(hydrated[0].sshPassword, 'old-plain');
  });

  function seedRemoteSync(chromeApi, localShape, device) {
    const payload = OpenTabSync.buildSyncPayload(localShape);
    payload.deviceId = device;
    payload.hash = 'remote-' + device;
    const plan = OpenTabSync.planSyncWrite(payload);
    assert.equal(plan.ok, true);
    plan.items.forEach((item) => {
      chromeApi._sync[item.key] = item.value;
    });
    return payload;
  }

  await withChrome({
    local: {
      icons: [{
        id: 'local-1',
        name: 'LocalOnly',
        url: 'https://local.example/',
        folderId: 'folder-home',
        type: 'shortcut'
      }],
      folders: [{ id: 'folder-home', name: '主页' }]
    }
  }, async (chromeApi) => {
    seedRemoteSync(chromeApi, {
      icons: [
        { id: 'remote-1', name: 'CloudA', url: 'https://a.example/', folderId: 'folder-home', type: 'shortcut' },
        { id: 'remote-2', name: 'CloudB', url: 'https://b.example/', folderId: 'folder-home', type: 'shortcut' }
      ],
      folders: [{ id: 'folder-home', name: '主页' }]
    }, 'dev-other');
    const localBefore = chromeApi._local.icons.map((icon) => icon.id);
    const enabled = await OpenTabSync.setEnabled(true);
    assert.equal(enabled.conflict, true, 'BUG-023: second device must not auto-overwrite');
    assert.deepEqual(chromeApi._local.icons.map((icon) => icon.id), localBefore);
    assert.equal(chromeApi._local.backupSnapshots, undefined);

    const resolved = await OpenTabSync.resolveSyncChoice('remote');
    assert.equal(resolved.pulled, true);
    assert.ok(chromeApi._local.backupSnapshots && chromeApi._local.backupSnapshots.length);
    assert.equal(chromeApi._local.backupSnapshots[0].reason, 'before-sync-pull');
    assert.ok(chromeApi._local.icons.some((icon) => icon.id === 'remote-1'));
    assert.ok(!chromeApi._local.icons.some((icon) => icon.id === 'local-1'));
    const snap = chromeApi._local.backupSnapshots[0];
    assert.ok(snap.data.icons.some((icon) => icon.id === 'local-1'));
    await OpenTabImport.applyOpenTabBackup(snap.data);
    assert.ok(chromeApi._local.icons.some((icon) => icon.id === 'local-1'), 'BUG-023: undo restores local');
  });

  await withChrome({
    local: {
      icons: [{
        id: 'local-keep',
        name: 'KeepLocal',
        url: 'https://keep-local.example/',
        folderId: 'folder-home',
        type: 'shortcut'
      }],
      folders: [{ id: 'folder-home', name: '主页' }]
    }
  }, async (chromeApi) => {
    seedRemoteSync(chromeApi, {
      icons: [
        { id: 'remote-x', name: 'CloudX', url: 'https://x.example/', folderId: 'folder-home', type: 'shortcut' }
      ],
      folders: [{ id: 'folder-home', name: '主页' }]
    }, 'dev-other');
    const enabled = await OpenTabSync.setEnabled(true);
    assert.equal(enabled.conflict, true);
    const resolved = await OpenTabSync.resolveSyncChoice('local');
    assert.equal(resolved.pushed, true);
    assert.equal(chromeApi._local.icons[0].id, 'local-keep');
    const restored = OpenTabSync.unshardSyncPayload(
      Object.keys(chromeApi._sync)
        .filter((key) => key.startsWith('ot.s.c'))
        .sort()
        .map((key) => chromeApi._sync[key])
    );
    assert.ok(restored.icons.some((icon) => icon.id === 'local-keep'));
    assert.ok(!restored.icons.some((icon) => icon.id === 'remote-x'));
  });

  await withChrome({
    local: { icons: [], folders: [{ id: 'folder-home', name: '主页' }] }
  }, async (chromeApi) => {
    seedRemoteSync(chromeApi, {
      icons: [
        { id: 'cloud-only', name: 'CloudOnly', url: 'https://cloud.example/', folderId: 'folder-home', type: 'shortcut' }
      ],
      folders: [{ id: 'folder-home', name: '主页' }]
    }, 'dev-other');
    const enabled = await OpenTabSync.setEnabled(true);
    assert.equal(enabled.pulled, true);
    assert.ok(chromeApi._local.icons.some((icon) => icon.id === 'cloud-only'));
  });

  await withChrome({
    local: {
      icons: [{ id: 'a', name: 'A', url: 'https://a.example/' }],
      currentFolderId: 'folder-keep'
    }
  }, async (chromeApi) => {
    await OpenTabSync.applyRemotePayload({
      deviceId: 'dev-other',
      hash: 'cf-1',
      icons: [{ id: 'a', name: 'A', url: 'https://a.example/' }],
      folders: [{ id: 'folder-home', name: '主页' }],
      settings: { currentFolderId: 'folder-remote', clockFormat: '24h' }
    });
    assert.equal(chromeApi._local.currentFolderId, 'folder-keep');
    assert.equal(chromeApi._local.clockFormat, '24h');
  });

  console.log('import-sync unit tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
