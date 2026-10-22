import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const OpenTabIcons = require('../icons.js');
const OpenTabSync = require('../sync.js');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'icons/library/catalog.json'), 'utf8'));

const stats = OpenTabIcons.libraryStats();
assert.ok(stats.count >= 40, `AC2: library count ${stats.count} < 40`);
assert.ok(stats.cn >= 20, `AC2: Chinese sites ${stats.cn} < 20`);
assert.ok(stats.intl >= 20, `AC2: international sites ${stats.intl} < 20`);
assert.equal(stats.count, catalog.length, 'icons.js LIBRARY must match catalog.json');

['baidu.com', 'taobao.com', 'bilibili.com', 'zhihu.com', 'weibo.com', 'github.com', 'youtube.com', 'mail.google.com'].forEach((host) => {
  const hit = OpenTabIcons.lookupLibrary(`https://${host}/`);
  assert.ok(hit && hit.slug, `AC2: library miss for ${host}`);
  assert.ok(fs.existsSync(path.join(root, 'icons/library', `${hit.slug}.svg`)));
});

assert.equal(OpenTabIcons.lookupLibrary('https://www.github.com/foo').slug, 'github');
assert.equal(OpenTabIcons.lookupLibrary('https://gist.github.com/x').slug, 'github');
assert.equal(OpenTabIcons.lookupLibrary('https://mail.google.com/mail/').slug, 'gmail');
assert.equal(OpenTabIcons.lookupLibrary('https://weixin.qq.com/'), OpenTabIcons.lookupLibrary('https://wechat.com/'));
assert.equal(OpenTabIcons.lookupLibrary('https://example.com/'), null);

const gh = { id: 'gh', name: 'GitHub', url: 'https://github.com', type: 'shortcut' };
OpenTabIcons.prepareRecord(gh);
assert.equal(gh.librarySlug, 'github');
assert.equal(OpenTabIcons.paintSrc(gh), 'icons/library/github.svg');
assert.equal(OpenTabIcons.isPaintSafe(OpenTabIcons.paintSrc(gh)), true);

const remote = {
  id: 'ex',
  name: 'Example',
  url: 'https://example.com/path',
  type: 'shortcut',
  resolvedIconUrl: 'https://example.com/favicon.ico',
  uploadedIconDataUrl: '',
  customIconUrl: 'https://cdn.example.com/icon.png'
};
OpenTabIcons.prepareRecord(remote);
const painted = OpenTabIcons.paintSrc(remote);
assert.equal(/^https?:/i.test(painted), false, `AC5: paintSrc must not return http(s), got ${painted}`);
assert.ok(painted.startsWith('data:image/svg+xml'), 'unknown site paints a local placeholder');

const upload = {
  id: 'up',
  name: 'Up',
  url: 'https://example.com',
  type: 'shortcut',
  uploadedIconDataUrl: 'data:image/png;base64,AAAA'
};
assert.equal(OpenTabIcons.paintSrc(upload), upload.uploadedIconDataUrl);

const colorA = OpenTabIcons.colorFromHost('example.com');
const colorB = OpenTabIcons.colorFromHost('example.com');
const colorC = OpenTabIcons.colorFromHost('other.test');
assert.equal(colorA, colorB, 'placeholder color is stable for a host');
assert.notEqual(colorA, colorC, 'different hosts get different placeholder colors');

const placeholder = OpenTabIcons.placeholderDataUrl('E', '#4c6fff');
assert.ok(placeholder.startsWith('data:image/svg+xml'));
assert.ok(placeholder.length <= OpenTabIcons.MAX_ICON_BYTES);

const fat = 'data:image/png;base64,' + 'A'.repeat(8000);
const sanitized = OpenTabIcons.sanitizeIconForSync({
  id: 'a',
  url: 'https://a.example/',
  uploadedIconDataUrl: fat,
  resolvedIconUrl: placeholder,
  customIconUrl: 'data:image/gif;base64,AAAA',
  iconCandidates: [fat, 'https://a.example/favicon.ico'],
  librarySlug: 'github',
  placeholderColor: '#123456'
});
assert.equal(sanitized.uploadedIconDataUrl, '');
assert.equal(sanitized.resolvedIconUrl, '');
assert.equal(sanitized.customIconUrl, '');
assert.deepEqual(sanitized.iconCandidates, ['https://a.example/favicon.ico']);
assert.equal(sanitized.librarySlug, 'github');
assert.equal(sanitized.placeholderColor, '#123456');

const popupShaped = {
  id: 'popup-1',
  name: 'Popup Site',
  url: 'https://popup-icon.example/',
  folderId: 'folder-home',
  parentId: '',
  customIconUrl: '',
  emoji: '',
  uploadedIconDataUrl: '',
  resolvedIconUrl: '',
  iconCandidates: OpenTabIcons.faviconCandidates('https://popup-icon.example/')
};
OpenTabIcons.prepareRecord(popupShaped);
assert.equal(popupShaped.iconSource, 'placeholder');
assert.equal(popupShaped.iconCacheState || '', '', 'BUG-026: default placeholder does not set iconCacheState=local');
assert.equal(
  OpenTabIcons.needsIdleWork(popupShaped),
  false,
  'BUG-025: auto path does not fetch unknown hosts'
);
assert.deepEqual(
  OpenTabIcons.remoteSrcList(popupShaped),
  OpenTabIcons.faviconCandidates('https://popup-icon.example/'),
  'BUG-026: popup-shaped records still expose deferred img candidates'
);

const userPlaceholder = { id: 'user-ph', name: 'Chosen', url: 'https://popup-icon.example/', type: 'shortcut' };
OpenTabIcons.applyPlaceholder(userPlaceholder, 'P', '#2266aa');
assert.equal(userPlaceholder.iconCacheState, 'local');
assert.equal(OpenTabIcons.needsIdleWork(userPlaceholder), false);
assert.deepEqual(OpenTabIcons.remoteSrcList(userPlaceholder), []);

const ghCustomData = {
  id: 'gh-custom-data',
  name: 'GitHub',
  url: 'https://github.com',
  type: 'shortcut',
  customIconUrl: 'data:image/png;base64,AAAA',
  uploadedIconDataUrl: ''
};
OpenTabIcons.prepareRecord(ghCustomData);
assert.equal(OpenTabIcons.paintSrc(ghCustomData), 'data:image/png;base64,AAAA', 'BUG-027: in-library custom data URL beats library');
assert.equal(ghCustomData.librarySlug || '', '');
assert.deepEqual(OpenTabIcons.remoteSrcList(ghCustomData), []);

const ghCustomRemote = {
  id: 'gh-custom-remote',
  name: 'GitHub',
  url: 'https://github.com',
  type: 'shortcut',
  customIconUrl: 'https://cdn.example.com/my.png'
};
OpenTabIcons.prepareRecord(ghCustomRemote);
const ghCustomPainted = OpenTabIcons.paintSrc(ghCustomRemote);
assert.equal(/^https?:/i.test(ghCustomPainted), false, 'BUG-027: custom https is not first-paint src');
assert.equal(ghCustomPainted.includes('icons/library/github'), false, 'BUG-027: custom beats library');
assert.deepEqual(OpenTabIcons.remoteSrcList(ghCustomRemote), ['https://cdn.example.com/my.png']);

const exCustomData = {
  id: 'ex-custom-data',
  name: 'Example',
  url: 'https://example.com',
  type: 'shortcut',
  customIconUrl: 'data:image/png;base64,BBBB'
};
OpenTabIcons.prepareRecord(exCustomData);
assert.equal(OpenTabIcons.paintSrc(exCustomData), 'data:image/png;base64,BBBB', 'BUG-027: out-of-library custom data URL');

const strippedExt = OpenTabIcons.sanitizeIconForSync({
  id: 'ext',
  customIconUrl: 'chrome-extension://abcdef/icons/x.png',
  resolvedIconUrl: 'chrome-extension://abcdef/icons/x.png',
  iconCacheState: 'local',
  iconSource: 'remote'
});
assert.equal(strippedExt.customIconUrl, '', 'BUG-028: strip chrome-extension: customIconUrl');
assert.equal(strippedExt.resolvedIconUrl, '');
assert.equal('iconCacheState' in strippedExt, false, 'BUG-028: strip iconCacheState');

const strippedBlob = OpenTabIcons.sanitizeIconForSync({
  customIconUrl: 'blob:https://example.com/uuid',
  iconCacheState: 'failed'
});
assert.equal(strippedBlob.customIconUrl, '', 'BUG-028: strip blob: customIconUrl');

const deviceB = OpenTabSync.mergeRemoteIcons(
  [{
    id: 'synced',
    name: 'Synced',
    url: 'https://example.com/',
    type: 'shortcut',
    iconCacheState: 'local',
    iconSource: 'remote',
    resolvedIconUrl: '',
    uploadedIconDataUrl: '',
    customIconUrl: ''
  }],
  []
);
assert.ok(!deviceB[0].iconCacheState, 'BUG-028: merged remote must not keep iconCacheState=local');
OpenTabIcons.prepareRecord(deviceB[0]);
assert.ok(OpenTabIcons.remoteSrcList(deviceB[0]).length > 0, 'BUG-028: device B can still deferred-load favicon');

const ghPending = { id: 'gh-idle', name: 'GitHub', url: 'https://github.com', type: 'shortcut' };
assert.equal(OpenTabIcons.needsIdleWork(ghPending), true, 'idle assigns bundled library tiles');
let fetchCalls = 0;
const prevFetch = globalThis.fetch;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new TypeError('Failed to fetch');
};
try {
  await OpenTabIcons.migrateIdleIcon(ghPending);
  assert.equal(ghPending.librarySlug, 'github');
  assert.equal(fetchCalls, 0, 'BUG-025: idle migration must not fetch');
  const noForce = { id: 'n1', name: 'Ex', url: 'https://example.com', type: 'shortcut', customIconUrl: 'https://cdn.example.com/x.png' };
  const changed = await OpenTabIcons.resolveIcon(noForce, { fetchRemote: true });
  assert.equal(changed, false);
  assert.equal(fetchCalls, 0, 'BUG-025: resolveIcon without force must not fetch');
} finally {
  globalThis.fetch = prevFetch;
}

const syncPayload = OpenTabSync.buildSyncPayload({
  icons: [{
    id: 'a',
    name: 'A',
    url: 'https://github.com/',
    uploadedIconDataUrl: fat,
    resolvedIconUrl: placeholder,
    librarySlug: 'github'
  }],
  folders: [{ id: 'folder-home', name: '主页' }]
});
const syncJson = JSON.stringify(syncPayload);
assert.equal(syncJson.includes('data:image'), false, 'sync payload must not include data URL icons');
assert.equal(syncPayload.icons[0].librarySlug, 'github');

const candidates = OpenTabIcons.faviconCandidates('https://example.com/page');
assert.ok(candidates[0].endsWith('/apple-touch-icon.png'), 'AC1: apple-touch-icon before favicon.ico');
assert.ok(candidates.some((url) => url.endsWith('/favicon.ico')));

// The actual add/edit upload handler must not update a later modal draft or file choice.
{
  const source = fs.readFileSync(path.join(root, 'home.js'), 'utf8');
  const start = source.indexOf('  async function handleIconFileChange()');
  const handler = source.slice(start, source.indexOf('  function hideIconContextMenu()', start));
  const reads = [], firstDraft = {}, nextDraft = {};
  const context = vm.createContext({
    iconUploadGate: OpenTabIcons.createUploadGate(), iconDraftIntent: firstDraft, pendingIconUploadDataUrl: '',
    elements: { iconFile: { files: [] }, iconUploadStatus: { textContent: '' } },
    workspace: { isIntentCurrent: (draft) => draft !== null },
    t: (s, params) => s.replace(/\{(\w+)\}/g, (match, key) => params?.[key] ?? match),
    window: { OpenTabIcons: true },
    OpenTabIcons: { readAndCompressFile: () => new Promise((resolve, reject) => reads.push({ resolve, reject })) }
  });
  vm.runInContext(handler, context);
  const select = (name) => {
    context.elements.iconFile.files = [{ name }];
    return context.handleIconFileChange();
  };
  const oldModalRead = select('old.png');
  context.iconDraftIntent = nextDraft;
  context.pendingIconUploadDataUrl = 'next-draft-image';
  context.elements.iconUploadStatus.textContent = 'next-draft-status';
  reads.shift().resolve('stale-image');
  await oldModalRead;
  assert.equal(context.pendingIconUploadDataUrl, 'next-draft-image', 'late read cannot overwrite another modal draft');
  assert.equal(context.elements.iconUploadStatus.textContent, 'next-draft-status');

  const older = select('older.png'), newer = select('newer.png');
  const oldRead = reads.shift(), newRead = reads.shift();
  newRead.resolve('new-image'); await newer;
  oldRead.resolve('old-image'); await older;
  assert.equal(context.pendingIconUploadDataUrl, 'new-image', 'latest file selection wins');
  assert.match(context.elements.iconUploadStatus.textContent, /newer.png/);

  const failedOldRead = select('fail.png');
  context.iconDraftIntent = {};
  context.pendingIconUploadDataUrl = 'keep-image';
  context.elements.iconUploadStatus.textContent = 'keep-status';
  reads.shift().reject(new Error('delayed file failure'));
  await failedOldRead;
  assert.equal(context.pendingIconUploadDataUrl, 'keep-image', 'late failure cannot clear another draft');
  assert.equal(context.elements.iconUploadStatus.textContent, 'keep-status');

  const closedRead = select('closed.png');
  context.iconDraftIntent = null;
  context.pendingIconUploadDataUrl = '';
  reads.shift().resolve('closed-image'); await closedRead;
  assert.equal(context.pendingIconUploadDataUrl, '', 'closed draft ignores delayed image completion');

  context.iconDraftIntent = {};
  const invalidRead = select('invalid.png');
  context.workspace.isIntentCurrent = () => false;
  reads.shift().resolve('invalid-image'); await invalidRead;
  assert.equal(context.pendingIconUploadDataUrl, '', 'workspace-invalidated draft ignores delayed image completion');
}

// Exercise the shipped Save/upload/close handlers together, not a model of them.
{
  const source = fs.readFileSync(path.join(root, 'home.js'), 'utf8');
  const handlers = source.slice(source.indexOf('  function closeAddIconModal()'), source.indexOf('  function hideIconContextMenu()'));
  function fixture(existing = '') {
    const reads = [], writes = [], controls = [];
    const elements = new Proxy({
      iconFile: { files: [] }, iconUploadStatus: { textContent: '' },
      addIconModal: {
        hidden: false,
        classList: { contains() { return elements.addIconModal.hidden; }, add() { elements.addIconModal.hidden = true; } },
        querySelectorAll: () => controls
      }
    }, { get(target, key) { return target[key] ||= { value: '', focus() {} }; } });
    elements.iconName.value = 'Example';
    elements.iconUrl.value = 'https://example.com';
    elements.iconType.value = 'shortcut';
    const cancel = { id: 'cancel-btn', disabled: false };
    const save = { id: 'save-btn', disabled: false };
    controls.push(cancel, save);
    elements.cancelBtn = cancel;
    const context = vm.createContext({
      elements, iconUploadGate: OpenTabIcons.createUploadGate(), iconSaveGate: OpenTabIcons.createSaveGate(),
      iconDraftIntent: {}, editingIconId: existing ? 'existing' : null, pendingIconUploadDataUrl: '',
      state: { icons: existing ? [{ id: 'existing', uploadedIconDataUrl: existing }] : [] },
      workspace: { isIntentCurrent: (draft) => !!draft },
      ICON_TYPE_SHORTCUT: 'shortcut', ICON_TYPE_SSH: 'ssh', ICON_TYPE_TOOL: 'tool', HOME_FOLDER_ID: 'home',
      normalizeIconType: (v) => v, normalizeUrl: (v) => v, normalizeOptionalUrl: (v) => v,
      t: (s, params) => s.replace(/\{(\w+)\}/g, (match, key) => params?.[key] ?? match),
      showToast() {}, restoreFocus() {}, window: { OpenTabIcons: true },
      OpenTabIcons: { readAndCompressFile: () => new Promise((resolve, reject) => reads.push({ resolve, reject })) },
      addIcon: async (payload) => { writes.push(payload); return true; },
      updateIcon: async (id, payload) => { writes.push({ id, ...payload }); return true; }
    });
    vm.runInContext(handlers, context);
    return { context, reads, writes, elements, save, cancel,
      select(name) { elements.iconFile.files = [{ name }]; return context.handleIconFileChange(); },
      reopen() {
        context.iconDraftIntent = {};
        context.editingIconId = null;
        elements.addIconModal.hidden = false;
        context.iconUploadGate.reset();
      }
    };
  }
  for (const existing of ['', 'image-A']) {
    const f = fixture(existing);
    const read = f.select('B.png');
    assert.equal(f.elements.iconUploadStatus.textContent, '正在读取图片…');
    const save = f.context.handleSaveIcon();
    await f.context.handleSaveIcon(); // repeated click/Enter cannot duplicate the pending save
    assert.equal(f.writes.length, 0, 'Save must not persist before compression finishes');
    assert.equal(f.save.disabled, true, 'pending Save is visibly gated');
    assert.equal(f.cancel.disabled, false, 'Cancel stays available while waiting');
    f.reads.shift().resolve('image-B');
    await Promise.all([read, save]);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].uploadedIconDataUrl, 'image-B', 'fresh and replacement saves use selected image');
    assert.equal(f.elements.addIconModal.hidden, true);
    assert.equal(f.save.disabled, false);
  }
  {
    const f = fixture('image-A');
    const read = f.select('bad.png'), save = f.context.handleSaveIcon();
    f.reads.shift().reject(new Error('compression failed'));
    await Promise.all([read, save]);
    assert.equal(f.writes.length, 0);
    assert.equal(f.context.state.icons[0].uploadedIconDataUrl, 'image-A');
    assert.equal(f.elements.addIconModal.hidden, false, 'failure leaves editor open');
    assert.equal(f.save.disabled, false, 'failed read releases Save controls');
    assert.match(f.elements.iconUploadStatus.textContent, /读取失败/);
    await f.context.handleSaveIcon();
    assert.equal(f.writes.length, 0, 'retrying Save cannot silently accept failed upload');
    const retry = f.select('good.png');
    f.reads.shift().resolve('image-good'); await retry;
    await f.context.handleSaveIcon();
    assert.equal(f.writes[0].uploadedIconDataUrl, 'image-good');
  }
  for (const outcome of [true, false, 'reject']) for (const initiallyDisabled of [false, true]) {
    const f = fixture();
    f.cancel.disabled = initiallyDisabled;
    let beginWrite, finishWrite, rejectWrite;
    const writing = new Promise(resolve => { beginWrite = resolve; });
    const persisted = new Promise((resolve, reject) => { finishWrite = resolve; rejectWrite = reject; });
    f.context.addIcon = () => { beginWrite(); return persisted; };
    const read = f.select('phase.png'), save = f.context.handleSaveIcon();
    assert.equal(f.cancel.disabled, initiallyDisabled, 'read phase preserves Cancel availability');
    f.reads.shift().resolve('image-phase');
    await read; await writing;
    assert.equal(f.cancel.disabled, true, 'Cancel cannot imply an already-issued write was withdrawn');
    if (outcome === 'reject') rejectWrite(new Error('storage failed')); else finishWrite(outcome);
    await save;
    assert.equal(f.cancel.disabled, initiallyDisabled, 'success and failure restore original Cancel state');
    assert.equal(f.save.disabled, false);
    assert.equal(f.elements.addIconModal.hidden, outcome === true);
  }
  for (const reopen of [false, true]) {
    const f = fixture('image-A');
    const read = f.select('old.png'), save = f.context.handleSaveIcon();
    f.context.closeAddIconModal();
    if (reopen) f.reopen();
    await save; // cancellation must not wait for an obsolete decoder
    f.reads.shift().resolve('stale-image');
    await read;
    assert.equal(f.writes.length, 0, 'cancel invalidates waiting Save, even after reopening');
    assert.equal(f.context.pendingIconUploadDataUrl, '');
    assert.equal(f.elements.addIconModal.hidden, !reopen);
    assert.equal(f.save.disabled, false);
  }
  {
    const f = fixture('image-A');
    const older = f.select('older.png'), save = f.context.handleSaveIcon();
    const newer = f.select('newer.png');
    f.reads[0].resolve('older-image'); await older;
    assert.equal(f.writes.length, 0, 'pending Save follows a newer file selection');
    f.reads[1].resolve('newer-image');
    await Promise.all([newer, save]);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].uploadedIconDataUrl, 'newer-image');
  }
  {
    const f = fixture('image-A');
    const older = f.select('older.png'), save = f.context.handleSaveIcon();
    const newer = f.select('newer.png');
    f.reads[1].resolve('newer-image');
    await Promise.all([newer, save]);
    assert.equal(f.writes[0].uploadedIconDataUrl, 'newer-image', 'latest read does not wait on obsolete decoder');
    f.reads[0].resolve('older-image'); await older;
    assert.equal(f.writes.length, 1);
  }
  {
    const f = fixture('image-A');
    const read = f.select('pending.png'), save = f.context.handleSaveIcon();
    f.context.workspace.isIntentCurrent = () => false;
    f.reads.shift().resolve('invalid-image');
    await Promise.all([read, save]);
    assert.equal(f.writes.length, 0, 'workspace invalidation cancels pending Save');
  }
}

function addedFileBytes() {
  const names = new Set();
  const git = (args) => {
    try {
      return execSync(args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  git('git diff --name-only --diff-filter=A origin/master').forEach((name) => names.add(name));
  git('git ls-files --others --exclude-standard').forEach((name) => names.add(name));
  return [...names].reduce((sum, rel) => {
    const abs = path.join(root, rel);
    return sum + (fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.statSync(abs).size : 0);
  }, 0);
}

const added = addedFileBytes();
assert.ok(added <= 300 * 1024, `AC6: added files ${added} bytes exceed 300KB`);
console.log(`icons library stats count=${stats.count} cn=${stats.cn} intl=${stats.intl} addedBytes=${added}`);
console.log('icons unit tests passed');

// App identity stays local and every declared raster has its true native size.
const appManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const releaseFiles = JSON.parse(fs.readFileSync(path.join(root, 'scripts/release-files.json'), 'utf8'));
for (const iconMap of [appManifest.icons, appManifest.action.default_icon]) {
  for (const [size, file] of Object.entries(iconMap)) {
    assert.ok(releaseFiles.includes(file), `${file} must be packaged`);
    const png = fs.readFileSync(path.join(root, file));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), Number(size), `${file} width`);
    assert.equal(png.readUInt32BE(20), Number(size), `${file} height`);
    assert.equal(png[25], 6, `${file} must retain RGBA transparency`);
  }
}
const appIconSvg = fs.readFileSync(path.join(root, 'icons/opentab-icon.svg'), 'utf8');
assert.match(appIconSvg, /viewBox="0 0 128 128"/);
assert.doesNotMatch(appIconSvg, /<(?:script|image|foreignObject)\b|(?:href|onload)=/i,
  'app icon must remain self-contained vector artwork');
console.log('App icon asset validation passed.');
