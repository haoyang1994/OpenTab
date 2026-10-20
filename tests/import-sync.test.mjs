import assert from 'node:assert/strict';
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

async function withChrome(options, fn) {
  const chromeApi = createChrome(options);
  OpenTabImport.setChrome(chromeApi);
  OpenTabSync.setChrome(chromeApi);
  let seq = 0;
  OpenTabImport.setIdFactory(() => 'id-' + (++seq));
  let reloads = 0;
  OpenTabImport.setReloader(() => { reloads += 1; });
  try {
    return await fn(chromeApi, () => reloads);
  } finally {
    OpenTabImport.setChrome(null);
    OpenTabSync.setChrome(null);
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

  const folders = [{ id: 'folder-home', name: '主页' }, { id: 'folder-a', name: 'A' }];
  assert.deepEqual(OpenTabImport.groupsToFolders(OpenTabImport.foldersToGroups(folders)), folders);
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
    const hydrated = await OpenTabSync.hydrateIcons(
      [{ id: 'ssh1', sshPassword: '', sshGatewayToken: '', sshSocksPassword: '' }],
      chromeApi._local
    );
    assert.equal(hydrated[0].sshPassword, 's3cret');
    assert.equal(hydrated[0].sshGatewayToken, 'tok-1');
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
    searchEngine: 'bing'
  });
  const syncJson = JSON.stringify(syncPayload);
  assert.equal(syncJson.includes('nope'), false);
  assert.equal(syncJson.includes('WALLPAPER'), false);
  assert.equal(syncJson.includes('secret todo'), false);
  assert.equal(syncPayload.background, undefined);
  assert.equal(syncPayload.todos, undefined);
  assert.equal(syncPayload.bingIndex, undefined);
  assert.equal(syncPayload.settings.clockFormat, '24h');
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

  console.log('import-sync unit tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
