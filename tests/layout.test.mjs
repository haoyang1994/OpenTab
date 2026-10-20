import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { formatConsoleError, isAllowedConsoleError, unexpectedErrors } from './console-allow.mjs';

const require = createRequire(import.meta.url);
const OpenTabLayout = require('../layout.js');
const OpenTabSettingsNav = require('../settings-nav.js');
const OpenTabSync = require('../sync.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

assert.deepEqual(OpenTabLayout.normalize({}), OpenTabLayout.DEFAULTS);
assert.equal(OpenTabLayout.normalize({ layoutIconSize: 12 }).layoutIconSize, 48);
assert.equal(OpenTabLayout.normalize({ layoutIconSize: 200 }).layoutIconSize, 96);
assert.equal(OpenTabLayout.normalize({ layoutColumns: 'auto' }).layoutColumns, 0);
assert.equal(OpenTabLayout.normalize({ layoutColumns: 2 }).layoutColumns, 4);
assert.equal(OpenTabLayout.normalize({ layoutColumns: 12 }).layoutColumns, 12);
assert.equal(OpenTabLayout.normalize({ layoutShowNames: false }).layoutShowNames, false);
assert.equal(OpenTabLayout.normalize({ layoutMaxWidth: 100 }).layoutMaxWidth, 640);
assert.equal(OpenTabLayout.tileWidth(56), 104);

const vars = OpenTabLayout.cssVars({ layoutIconSize: 80, layoutColumns: 6, layoutMaxWidth: 1200 });
assert.equal(vars['--layout-icon-size'], '80px');
assert.equal(vars['--layout-tile-width'], '128px');
assert.equal(vars['--layout-columns'], '6');
assert.equal(vars['--layout-max-width'], '1200px');

assert.equal(OpenTabSettingsNav.textMatches('快捷方式与布局 Layout', 'layout'), true);
assert.equal(OpenTabSettingsNav.textMatches('快捷方式与布局 Layout', 'LAYOUT'), true);
assert.equal(OpenTabSettingsNav.textMatches('Weather 天气', '天气'), true);
assert.equal(OpenTabSettingsNav.textMatches('Weather 天气', 'xyz'), false);
assert.equal(OpenTabSettingsNav.textMatches('anything', ''), true);

const ids = OpenTabSettingsNav.SECTIONS.map((section) => section.id);
assert.deepEqual(ids, [
  'appearance', 'wallpaper', 'shortcuts', 'search', 'weather', 'sync', 'advanced', 'about'
]);
assert.match(OpenTabSettingsNav.SECTIONS.find((section) => section.id === 'weather').label, /天气/);
assert.match(OpenTabSettingsNav.SECTIONS.find((section) => section.id === 'advanced').label, /高级/);

assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([], undefined), false);
assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([{ type: 'ssh' }], undefined), true);
assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([{ type: 'tool' }], undefined), true);
assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([{ type: 'ssh' }], false), false);
assert.equal(OpenTabSettingsNav.shouldEnableDeveloperTools([], true), true);

for (const key of OpenTabLayout.STORAGE_KEYS.concat(['developerToolsEnabled'])) {
  assert.ok(OpenTabSync.SYNC_SETTING_KEYS.includes(key), 'sync key missing: ' + key);
}

const payload = OpenTabSync.buildSyncPayload({
  icons: [{ id: 'a', name: 'A', url: 'https://a.example/', folderId: 'folder-home' }],
  folders: [{ id: 'folder-home', name: '主页' }],
  layoutIconSize: 80,
  layoutColumns: 6,
  layoutShowNames: false,
  layoutMaxWidth: 1200,
  developerToolsEnabled: true,
  clockFormat: '24h'
});
assert.equal(payload.settings.layoutIconSize, 80);
assert.equal(payload.settings.layoutColumns, 6);
assert.equal(payload.settings.layoutShowNames, false);
assert.equal(payload.settings.layoutMaxWidth, 1200);
assert.equal(payload.settings.developerToolsEnabled, true);
assert.equal(payload.settings.clockFormat, '24h');

const quoted = OpenTabSync.buildSyncPayload({
  icons: Array.from({ length: 80 }, (_, i) => ({
    id: 'q' + i,
    name: '中文"引号\\布局"' + i,
    url: 'https://example.com/path?q="' + i + '"\\x',
    folderId: 'folder-home',
    type: 'shortcut'
  })),
  folders: [{ id: 'folder-home', name: '主页' }],
  layoutIconSize: 96,
  layoutColumns: 12,
  layoutShowNames: true,
  layoutMaxWidth: 1600
});
const plan = OpenTabSync.planSyncWrite(quoted);
assert.equal(plan.ok, true, 'BUG-022: layout settings plus quoted names should shard');
assert.ok(plan.chunkCount >= 3, 'BUG-022: expected at least 3 shards, got ' + plan.chunkCount);
plan.items.forEach((item) => {
  const size = OpenTabSync.storedItemBytes(item.key, item.value);
  assert.ok(size <= OpenTabSync.QUOTA_BYTES_PER_ITEM, 'BUG-022 stored item ' + item.key + ' is ' + size);
  if (item.key.startsWith('ot.s.c')) {
    assert.ok(size <= OpenTabSync.CHUNK_SIZE, 'BUG-022 stored chunk exceeds 7800: ' + size);
  }
});
const restored = OpenTabSync.unshardSyncPayload(
  plan.items.filter((item) => item.key.startsWith('ot.s.c')).map((item) => item.value)
);
assert.equal(restored.settings.layoutIconSize, 96);
assert.equal(restored.settings.layoutColumns, 12);
assert.equal(restored.icons[0].name, quoted.icons[0].name);

const slice = OpenTabLayout.bootMirrorSlice({
  layoutIconSize: 80,
  layoutColumns: 6,
  layoutShowNames: false,
  layoutMaxWidth: 1100
});
assert.equal(slice.layoutIconSize, 80);
assert.equal(slice.layoutColumns, 6);
assert.equal(slice.layoutShowNames, false);
assert.equal(slice.layoutMaxWidth, 1100);
assert.equal(OpenTabLayout.applyFromMirror(), false);

OpenTabLayout.persist({
  layoutIconSize: 80,
  layoutColumns: 6,
  layoutShowNames: false,
  layoutMaxWidth: 1100
});
OpenTabLayout.loadFromStorage({});
assert.equal(OpenTabLayout.get().layoutIconSize, 80, 'empty storage must not clobber current layout');
OpenTabLayout.loadFromStorage({
  layoutIconSize: 64,
  layoutColumns: 4,
  layoutShowNames: true,
  layoutMaxWidth: 900
});
assert.equal(OpenTabLayout.get().layoutIconSize, 64);

globalThis.OpenTabBoot = {
  readMirror: () => ({ v: 1, layoutIconSize: 80, layoutColumns: 6, layoutShowNames: false, layoutMaxWidth: 1100 }),
  writeMirror() {}
};
assert.equal(OpenTabLayout.applyFromMirror(), true);
assert.equal(OpenTabLayout.get().layoutIconSize, 80);
assert.equal(OpenTabLayout.get().layoutShowNames, false);
delete globalThis.OpenTabBoot;
OpenTabLayout.reset();

const settingsNavSrc = fs.readFileSync(path.join(root, 'settings-nav.js'), 'utf8');
assert.match(settingsNavSrc, /section\.id !== 'about' && section\.id !== 'sync'/);
assert.match(settingsNavSrc, /会关闭浏览器同步/);

assert.equal(isAllowedConsoleError('Failed to load resource', 'https://example.com/a'), true);
assert.equal(isAllowedConsoleError('Failed to load resource', 'https://www.bing.com/th?id=1.jpg'), true);
assert.equal(isAllowedConsoleError('Failed to fetch Bing image'), true);
assert.equal(isAllowedConsoleError('Failed to load resource: net::ERR_FAILED'), false);
assert.equal(isAllowedConsoleError('Failed to load resource', 'chrome-extension://abc/home.js'), false);
assert.deepEqual(
  unexpectedErrors(['Failed to load resource (https://example.com/x)', 'boom']),
  ['boom']
);
assert.match(
  formatConsoleError({ text: () => 'Failed to load resource', location: () => ({ url: 'https://example.com/a' }) }),
  /example\.com/
);

console.log('layout unit tests passed');
