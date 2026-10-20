import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
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
