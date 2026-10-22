import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const importer = require('../import.js');
const workspace = require('../workspace-persistence.js');
const clone = value => structuredClone(value);
const HOME = { id: 'folder-home', name: '主页' };
const WORK = { id: 'folder-work', name: '工作 <personal>' };
const OTHER = { id: 'folder-other', name: 'Other' };
const EPOCH = workspace.EPOCH_KEY;
const shortcut = (id, url, folderId = WORK.id, extras = {}) => ({ id, name: id, type: 'shortcut', url, folderId, ...extras });
const initial = () => ({ folders: [HOME, WORK, OTHER], icons: [], currentFolderId: HOME.id, [EPOCH]: 7 });

async function scenario(data, test) {
  const state = clone(data);
  const writes = [];
  let reads = 0, reloads = 0, prepared = 0, ids = 0;
  let readFailure = false, writeFailure = false;
  const api = { runtime: {}, storage: { local: {
    async get(keys) {
      reads++;
      if (readFailure) throw new Error('read denied');
      return clone(Object.fromEntries((keys == null ? Object.keys(state) : keys).filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]])));
    },
    async set(patch) {
      if (writeFailure) throw new Error('quota exceeded');
      writes.push(clone(patch));
      Object.assign(state, clone(patch));
    }
  } } };
  importer.setChrome(api);
  importer.setIdFactory(() => `url-import-${++ids}`);
  importer.setReloader(() => { reloads++; });
  globalThis.OpenTabIcons = { prepareRecord(record) { prepared++; record.placeholderLetter = record.name.slice(0, 1); } };
  try {
    await test({ state, writes, api, ws: workspace.forChrome(api),
      reads: () => reads, reloads: () => reloads, prepared: () => prepared, ids: () => ids,
      failReads: value => { readFailure = value; }, failWrites: value => { writeFailure = value; } });
  } finally {
    importer.setChrome(null);
    importer.setIdFactory(null);
    importer.setReloader(null);
    delete globalThis.OpenTabIcons;
  }
}

// Pure parsing does not consult translation, storage, IDs, or icon/network work.
globalThis.OpenTabI18n = { t() { throw new Error('parsing must not translate'); } };
globalThis.OpenTabIcons = { prepareRecord() { throw new Error('parsing must not prepare icons'); } };
importer.setIdFactory(() => { throw new Error('parsing must not create IDs'); });
const parsed = importer.parseUrlList('\n  HTTPS://WWW.Example.COM:443/Path?b=2&a=1&utm_source=keep#Section  \r\n\nwww.example.com/Path?b=2&a=1&utm_source=keep#Section\r\nexample.com:8080/a\n');
assert.deepEqual(parsed.counts, { total: 3, ready: 2, duplicate: 1, invalid: 0 });
assert.deepEqual(parsed.rows.map(row => row.lineNumber), [2, 4, 5]);
assert.equal(parsed.rows[0].raw, '  HTTPS://WWW.Example.COM:443/Path?b=2&a=1&utm_source=keep#Section  ');
assert.equal(parsed.rows[0].name, 'www.example.com');
assert.equal(parsed.rows[0].url, 'https://www.example.com/Path?b=2&a=1&utm_source=keep#Section');
assert.equal(parsed.rows[2].url, 'https://example.com:8080/a');
assert.deepEqual(importer.parseUrlList(' \n\t\r\n').counts, { total: 0, ready: 0, duplicate: 0, invalid: 0 });
for (const raw of [
  'javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'ftp://example.com/', 'mailto:a@example.com', 'chrome://settings',
  'javascript:443', 'https:example.com', 'http:/example.com', 'https:///example.com', '//example.com', '/example.com',
  'https://example.com/a b', 'https://example.com/a\tb', 'https://exa\u0000mple.com', 'https://example.com\\other',
  'https://user:secret@example.com', 'https://user@example.com', 'https://@example.com', 'user:password@example.com', 'user@example.com',
  'word', 'localhost', '2130706433', '0x7f000001', 'not a URL', 'https://', 'https://[::1', 'example.com:99999', 'a..example.com',
]) {
  assert.equal(importer.parseUrlList(raw).rows[0].status, 'invalid', raw);
}
for (const raw of ['http://localhost:3000/a', 'http://127.0.0.1:8000/', 'https://[::1]/', '192.168.1.1:8080/a', '例子.测试', 'example.com:8080', 'https://example.com/%20?q=one+two#frag']) {
  assert.equal(importer.parseUrlList(raw).rows[0].status, 'ready', raw);
}
const variants = ['https://example.com/p?a=1&b=2#x', 'https://example.com/p?b=2&a=1#x', 'https://example.com/p?a=1&b=2#y', 'https://example.com/P?a=1&b=2#x', 'https://www.example.com/p?a=1&b=2#x'];
assert.deepEqual(importer.parseUrlList(variants.join('\n')).acceptedUrls, variants, 'query order, fragment, path case, www stay distinct');
assert.equal(importer.parseUrlList(Array.from({ length: 100 }, (_, i) => `${i}.example.com`).join('\n')).counts.ready, 100);
for (const raw of [Array(101).fill('x.example.com').join('\n'), Array(101).fill('invalid').join('\n')]) {
  assert.equal(importer.parseUrlList(raw).error, 'too-many-lines');
  assert.deepEqual(importer.parseUrlList(raw).rows, [], 'over-limit input is never silently truncated');
}
assert.equal(importer.parseUrlList(' '.repeat(importer.URL_LIST_MAX_BYTES)).ok, true);
assert.equal(importer.parseUrlList(' '.repeat(importer.URL_LIST_MAX_BYTES + 1)).error, 'text-too-long');
assert.equal(importer.parseUrlList('中'.repeat(11000)).error, 'text-too-long', 'UTF-8 bytes, not just code units');
assert.equal(importer.parseUrlList(null).error, 'invalid-input');
delete globalThis.OpenTabI18n;
delete globalThis.OpenTabIcons;
importer.setIdFactory(null);

await scenario({ ...initial(), icons: [
  { id: 'folder-tile', type: 'folder', name: 'Nested', folderId: WORK.id },
  shortcut('nested', 'HTTPS://EXAMPLE.COM:443/a?b=2&a=1#f', WORK.id, { parentId: 'folder-tile' }),
  shortcut('legacy', 'legacy.example.com', WORK.id, { type: 'web' }),
  shortcut('elsewhere', 'https://elsewhere.example.com/', OTHER.id),
  shortcut('broken', 'https://[broken', WORK.id),
  shortcut('tool', 'https://tool.example.com/', WORK.id, { type: 'tool' }),
] }, async ({ state, writes, reads, prepared, ids }) => {
  const original = clone(state);
  const context = await importer.readUrlListContext();
  assert.deepEqual(context.groups, [HOME, WORK, OTHER]);
  assert.equal(context.currentFolderId, HOME.id);
  assert.equal(context.epoch, 7);
  const preview = await importer.previewUrlList('https://example.com/a?b=2&a=1#f\nhttps://example.com/a?b=2&a=1#f\nhttps://example.com/a?b=2&a=1#other\nelsewhere.example.com\nlegacy.example.com\ntool.example.com\ninvalid', WORK.id);
  assert.deepEqual(preview.target, WORK);
  assert.equal(preview.targetSource, 'stored');
  assert.deepEqual(preview.counts, { total: 7, ready: 3, duplicate: 3, invalid: 1 });
  assert.ok(preview.rows[0].reason.includes('分组'));
  assert.ok(preview.rows[1].reason.includes('列表'));
  assert.deepEqual(state, original, 'preview never normalizes or rewrites old records');
  assert.equal(reads(), 2);
  assert.equal(writes.length, 0);
  assert.equal(prepared(), 0);
  assert.equal(ids(), 0);
  assert.equal((await importer.previewUrlList('new.example.com', 'missing')).error, 'target-missing');
});

await scenario(initial(), async ({ state, writes, ws, reloads, prepared }) => {
  const preview = await importer.previewUrlList('a.example.com\nb.example.com\na.example.com\ninvalid', WORK.id);
  const base = clone(state);
  await ws.commit(base, { ...base, icons: [shortcut('concurrent', 'https://a.example.com/')] });
  const beforeImport = clone(state);
  const count = writes.length;
  const result = await importer.commitUrlList(preview);
  assert.equal(result.ok, true);
  assert.equal(result.iconCount, 1);
  assert.equal(result.groupCount, 0);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.deepEqual(result.counts, { total: 4, ready: 1, duplicate: 2, invalid: 1 });
  assert.equal(writes.length, count + 1, 'one atomic import write');
  assert.deepEqual(Object.keys(writes.at(-1)).sort(), ['icons', 'currentFolderId', importer.UNDO_KEY, importer.NOTICE_KEY].sort());
  assert.deepEqual(state.folders, beforeImport.folders, 'existing groups unchanged');
  assert.equal(state.currentFolderId, WORK.id);
  assert.equal(prepared(), 1, 'only confirmed nonduplicates become icons');
  assert.equal(reloads(), 1);
  assert.equal(state[importer.NOTICE_KEY].iconCount, 1);
  assert.equal(state[importer.NOTICE_KEY].duplicateCount, 2);
  assert.equal(state[importer.UNDO_KEY].before.currentFolderId, HOME.id);
  assert.equal(state[importer.UNDO_KEY].after.currentFolderId, WORK.id);
  state.icons.push(shortcut('later', 'https://later.example.com/', WORK.id));
  state.todos = [{ id: 'later-todo', text: 'Keep me', done: false }];
  assert.equal((await importer.undoLastImport()).ok, true);
  assert.deepEqual(state.icons.map(icon => icon.id), ['concurrent', 'later']);
  assert.equal(state.currentFolderId, HOME.id);
  assert.equal(state.todos[0].text, 'Keep me');
  assert.equal(reloads(), 2);
});

await scenario(initial(), async ({ state, writes, prepared, reloads }) => {
  const preview = await importer.previewUrlList('a.example.com', WORK.id);
  state.icons.push(shortcut('concurrent', 'https://a.example.com/'));
  state[importer.UNDO_KEY] = { keep: true };
  state[importer.NOTICE_KEY] = { text: 'Keep notice' };
  const before = clone(state);
  const result = await importer.commitUrlList(preview);
  assert.equal(result.error, 'empty');
  assert.equal(result.iconCount, 0);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.deepEqual(result.counts, { total: 1, ready: 0, duplicate: 1, invalid: 0 });
  assert.deepEqual(state, before);
  assert.equal(writes.length, 0);
  assert.equal(prepared(), 0);
  assert.equal(reloads(), 0);
});

for (const [modify, error] of [
  [state => { state.folders = state.folders.filter(group => group.id !== WORK.id); }, 'target-missing'],
  [state => { state.folders.find(group => group.id === WORK.id).name = 'Renamed'; }, 'target-changed'],
  [state => { state.folders.find(group => group.id === WORK.id).parentId = OTHER.id; }, 'target-changed'],
  [state => { state.folders = state.folders.filter(group => group.id !== WORK.id).concat({ id: WORK.id, name: 'Replacement' }); }, 'target-changed'],
  [state => { state[EPOCH]++; }, 'workspace-changed'],
]) await scenario(initial(), async ({ state, writes, prepared, reloads }) => {
  const preview = await importer.previewUrlList('a.example.com', WORK.id);
  modify(state);
  const before = clone(state);
  assert.equal((await importer.commitUrlList(preview)).error, error);
  assert.deepEqual(state, before);
  assert.equal(writes.length, 0);
  assert.equal(prepared(), 0);
  assert.equal(reloads(), 0);
});

await scenario(initial(), async ({ state, writes }) => {
  const preview = await importer.previewUrlList('a.example.com', HOME.id);
  state.folders = state.folders.filter(group => group.id !== HOME.id);
  assert.equal((await importer.commitUrlList(preview)).error, 'target-missing', 'deleted stored Home never silently becomes virtual');
  assert.equal(writes.length, 0);
});

await scenario(initial(), async ({ state, writes, reloads, failReads, failWrites }) => {
  failReads(true);
  await assert.rejects(importer.previewUrlList('a.example.com', WORK.id), /read denied/);
  failReads(false);
  const preview = await importer.previewUrlList('a.example.com', WORK.id);
  const before = clone(state);
  failReads(true);
  await assert.rejects(importer.commitUrlList(preview), /read denied/);
  failReads(false);
  failWrites(true);
  await assert.rejects(importer.commitUrlList(preview), /quota exceeded/);
  assert.deepEqual(state, before, 'failed write leaves undo/notice/current group untouched');
  assert.equal(writes.length, 0);
  assert.equal(reloads(), 0);
  failWrites(false);
  assert.equal((await importer.commitUrlList(preview)).ok, true, 'known failed write can retry original preview');
  assert.equal(writes.length, 1);
  assert.equal(reloads(), 1);
});

await scenario(initial(), async ({ state, writes }) => {
  const preview = await importer.previewUrlList('a.example.com', WORK.id);
  assert.equal((await importer.commitUrlList(clone(preview))).error, 'invalid-preview');
  preview.acceptedUrls.push('https://injected.example.com/');
  assert.equal((await importer.commitUrlList(preview)).error, 'invalid-preview');
  assert.equal(writes.length, 0);
  assert.deepEqual(state, initial());
});

await scenario(initial(), async ({ state, writes, reloads }) => {
  const first = await importer.previewUrlList('a.example.com', WORK.id);
  const second = await importer.previewUrlList('a.example.com', WORK.id);
  const results = await Promise.all([importer.commitUrlList(first), importer.commitUrlList(second)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).error, 'empty');
  assert.equal(state.icons.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(reloads(), 1);
  assert.equal((await importer.commitUrlList(first)).error, 'invalid-preview', 'successful receipt cannot replay');
});

for (const data of [{}, { folders: [WORK], icons: [shortcut('existing', 'https://existing.example.com/')] }]) {
  await scenario(data, async ({ state, writes }) => {
    const original = clone(state);
    const context = await importer.readUrlListContext();
    assert.deepEqual(context.groups[0], HOME);
    assert.equal(context.currentFolderId, HOME.id);
    const preview = await importer.previewUrlList('fresh.example.com', HOME.id);
    assert.equal(preview.targetSource, 'builtin');
    assert.equal(writes.length, 0);
    assert.deepEqual(state, original, 'fresh-profile context/preview must not materialize Home');
    assert.equal((await importer.commitUrlList(preview)).ok, true);
    assert.deepEqual(state.folders, [HOME, ...(data.folders || [])]);
    assert.equal(writes.length, 1);
    assert.deepEqual(state[importer.UNDO_KEY].before.folders, state.folders);
    assert.deepEqual(state[importer.UNDO_KEY].after.folders, state.folders);
    assert.equal(state[importer.UNDO_KEY].before.currentFolderId, HOME.id);
    state.icons.push(shortcut('later-home', 'https://later.example.com/', HOME.id));
    assert.equal((await importer.undoLastImport()).ok, true);
    assert.deepEqual(state.icons.map(icon => icon.id), [...(data.icons || []).map(icon => icon.id), 'later-home']);
    assert.deepEqual(state.folders, [HOME, ...(data.folders || [])]);
    assert.equal(state.currentFolderId, HOME.id);
  });
}

// A legacy workspace can have other groups but no persisted Home. Importing
// into Work must still retain the user's implicit Home for inverse navigation.
for (const currentFolderId of [undefined, HOME.id, WORK.id, OTHER.id]) {
  await scenario({ folders: [WORK, OTHER], icons: [], ...(currentFolderId === undefined ? {} : { currentFolderId }) }, async ({ state, writes }) => {
    const preview = await importer.previewUrlList('work.example.com', WORK.id);
    assert.equal(preview.targetSource, 'stored');
    assert.equal(writes.length, 0);
    assert.equal((await importer.commitUrlList(preview)).ok, true);
    assert.equal(writes.length, 1);
    assert.deepEqual(state.folders, [HOME, WORK, OTHER]);
    assert.equal(state.currentFolderId, WORK.id);
    assert.deepEqual(state[importer.UNDO_KEY].before.folders, [HOME, WORK, OTHER]);
    assert.deepEqual(state[importer.UNDO_KEY].after.folders, [HOME, WORK, OTHER]);
    state.folders.find(group => group.id === HOME.id).name = 'Renamed Home after import';
    state.folders.find(group => group.id === OTHER.id).name = 'Renamed unrelated group';
    state.icons.push(shortcut('later-home', 'https://later.example.com/', HOME.id));
    assert.equal((await importer.undoLastImport()).ok, true);
    assert.equal(state.currentFolderId, currentFolderId || HOME.id);
    assert.deepEqual(state.icons.map(icon => icon.id), ['later-home']);
    assert.deepEqual(state.folders, [{ ...HOME, name: 'Renamed Home after import' }, WORK, { ...OTHER, name: 'Renamed unrelated group' }]);
    assert.ok(writes.every(patch => Object.values(patch).every(value => value !== undefined)), 'undo never writes an undefined currentFolderId');
  });
}

// A Home created/renamed by another writer is unrelated to the Work target.
// Preserve that latest record and all later user data through commit and undo.
for (const name of [HOME.name, 'Home created and renamed during preview']) {
  await scenario({ folders: [WORK, OTHER], icons: [] }, async ({ state, writes }) => {
    const preview = await importer.previewUrlList('work.example.com', WORK.id);
    const liveHome = { id: HOME.id, name };
    state.folders.push(liveHome);
    state.icons.push(shortcut('parallel-home', 'https://parallel.example.com/', HOME.id));
    const foldersBefore = clone(state.folders);
    assert.equal((await importer.commitUrlList(preview)).ok, true);
    assert.deepEqual(state.folders, foldersBefore);
    assert.equal(Object.hasOwn(writes[0], 'folders'), false, 'existing Home must not be rewritten');
    assert.equal((await importer.undoLastImport()).ok, true);
    assert.equal(state.currentFolderId, HOME.id);
    assert.deepEqual(state.folders, foldersBefore);
    assert.deepEqual(state.icons.map(icon => icon.id), ['parallel-home']);
  });
}

// Serialized confirmation order is deterministic under the shared workspace
// lock. Both previews are allowed, but only the last import is the undo target.
for (const order of [[WORK.id, HOME.id], [HOME.id, WORK.id]]) {
  await scenario({ folders: [WORK], icons: [] }, async ({ state, writes }) => {
    const previews = {
      [WORK.id]: await importer.previewUrlList('shared.example.com', WORK.id),
      [HOME.id]: await importer.previewUrlList('shared.example.com', HOME.id),
    };
    const results = await Promise.all(order.map(id => importer.commitUrlList(previews[id])));
    assert.ok(results.every(result => result.ok));
    assert.equal(writes.length, 2);
    assert.deepEqual(state.folders, [HOME, WORK]);
    assert.deepEqual(state.icons.map(icon => icon.folderId), order, 'the same URL may exist in different groups');
    assert.equal(state.currentFolderId, order[1]);
    const later = shortcut('later-independent', 'https://later.example.com/', order[1]);
    state.icons.push(later);
    assert.equal((await importer.undoLastImport()).ok, true);
    assert.equal(state.currentFolderId, order[0]);
    assert.deepEqual(state.icons.map(icon => icon.folderId), [order[0], order[1]]);
    assert.deepEqual(state.icons.at(-1), later);
    assert.deepEqual(state.folders, [HOME, WORK]);
  });
}

// A stale Home preview must never overwrite a later name. Test a Home that
// appeared before the Work commit as well as Home materialized by that commit.
for (const renameBeforeWorkCommit of [true, false]) {
  await scenario({ folders: [WORK], icons: [] }, async ({ state, writes }) => {
    const homePreview = await importer.previewUrlList('home.example.com', HOME.id);
    const workPreview = await importer.previewUrlList('work.example.com', WORK.id);
    const renamedHome = { id: HOME.id, name: 'Latest Home name' };
    if (renameBeforeWorkCommit) state.folders.unshift(clone(renamedHome));
    assert.equal((await importer.commitUrlList(workPreview)).ok, true);
    if (!renameBeforeWorkCommit) state.folders.find(group => group.id === HOME.id).name = renamedHome.name;
    const before = clone(state);
    const count = writes.length;
    assert.equal((await importer.commitUrlList(homePreview)).error, 'target-changed');
    assert.deepEqual(state, before);
    assert.equal(writes.length, count, 'stale Home confirmation performs no write');
    assert.equal((await importer.undoLastImport()).ok, true);
    assert.equal(state.currentFolderId, HOME.id);
    assert.deepEqual(state.folders, [renamedHome, WORK]);
    assert.deepEqual(state.icons, []);
  });
}

// Invalid destination checks happen before any logical Home materialization.
for (const liveHome of [null, HOME, { ...HOME, name: 'Latest existing Home' }]) {
  for (const change of ['delete', 'rename', 'replace', 'epoch']) {
    await scenario({ folders: [WORK], icons: [] }, async ({ state, writes, prepared }) => {
      const preview = await importer.previewUrlList('work.example.com', WORK.id);
      if (liveHome) state.folders.unshift(clone(liveHome));
      if (change === 'delete') state.folders = state.folders.filter(group => group.id !== WORK.id);
      if (change === 'rename') state.folders.find(group => group.id === WORK.id).name = 'Latest Work';
      if (change === 'replace') state.folders.find(group => group.id === WORK.id).type = 'replacement';
      if (change === 'epoch') state[EPOCH] = 1;
      const before = clone(state);
      const result = await importer.commitUrlList(preview);
      assert.equal(result.error, change === 'delete' ? 'target-missing' : change === 'epoch' ? 'workspace-changed' : 'target-changed');
      assert.deepEqual(state, before);
      assert.equal(writes.length, 0);
      assert.equal(prepared(), 0);
    });
  }
}

await scenario({ folders: [WORK], icons: [] }, async ({ state, writes }) => {
  const preview = await importer.previewUrlList('work.example.com', WORK.id);
  state.icons.push(shortcut('parallel-work', 'https://work.example.com/', WORK.id));
  const before = clone(state);
  assert.equal((await importer.commitUrlList(preview)).error, 'empty');
  assert.deepEqual(state, before, 'all-duplicate no-op must not materialize even built-in Home');
  assert.equal(writes.length, 0);
});

await scenario({ folders: [WORK], icons: [] }, async ({ state, writes, failWrites }) => {
  const preview = await importer.previewUrlList('work.example.com', WORK.id);
  const before = clone(state);
  failWrites(true);
  await assert.rejects(importer.commitUrlList(preview), /quota exceeded/);
  assert.deepEqual(state, before, 'Home, icons, navigation, notice and undo must fail together');
  assert.equal(writes.length, 0);
  failWrites(false);
  assert.equal((await importer.commitUrlList(preview)).ok, true);
  assert.equal(writes.length, 1);
  assert.equal((await importer.undoLastImport()).ok, true);
  assert.deepEqual(state.folders, [HOME, WORK]);
  assert.equal(state.currentFolderId, HOME.id);
});

await scenario({}, async ({ state, writes }) => {
  const first = await importer.previewUrlList('same.example.com', HOME.id);
  const second = await importer.previewUrlList('same.example.com\nnew.example.com', HOME.id);
  assert.equal((await importer.commitUrlList(first)).ok, true);
  const result = await importer.commitUrlList(second);
  assert.equal(result.ok, true, 'concurrent identical Home materialization is the same logical target');
  assert.equal(result.iconCount, 1);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.equal(state.icons.length, 2);
  assert.equal(state.folders.length, 1);
  assert.equal(writes.length, 2);
});

for (const target of [{ id: HOME.id, name: 'New Home' }, { ...HOME, type: 'replacement' }]) {
  await scenario({}, async ({ state, writes }) => {
    const preview = await importer.previewUrlList('a.example.com', HOME.id);
    state.folders = [target];
    assert.equal((await importer.commitUrlList(preview)).error, 'target-changed');
    assert.equal(writes.length, 0);
  });
}

await scenario({ ...initial(), icons: [shortcut('secret', 'https://existing.example.com/', HOME.id, { sshPassword: 'do-not-copy', sshGatewayToken: 'secret-token' })] }, async ({ state }) => {
  await importer.commitUrlList(await importer.previewUrlList('a.example.com', WORK.id));
  const undo = JSON.stringify(state[importer.UNDO_KEY]);
  assert.ok(!undo.includes('do-not-copy') && !undo.includes('secret-token'), 'undo snapshots never retain secrets');
  state.currentFolderId = OTHER.id;
  state.icons.push(shortcut('later', 'https://later.example.com/', OTHER.id));
  assert.equal((await importer.undoLastImport()).ok, true);
  assert.equal(state.currentFolderId, OTHER.id, 'new independent navigation wins over inverse navigation');
  assert.deepEqual(state.icons.map(icon => icon.id), ['secret', 'later']);
  assert.equal(state.icons[0].sshPassword, 'do-not-copy', 'existing secret wrapper semantics are preserved');
});

await scenario(initial(), async ({ state, writes }) => {
  await importer.commitUrlList(await importer.previewUrlList('a.example.com', WORK.id));
  state.icons[0].name = 'Later edit';
  const before = clone(state);
  const count = writes.length;
  await assert.rejects(importer.undoLastImport(), error => error.code === 'WORKSPACE_CONFLICT');
  assert.deepEqual(state, before, 'undo cannot erase later edits to the imported record');
  assert.equal(writes.length, count);
});

await scenario(initial(), async ({ state, writes }) => {
  importer.setReloader(() => { throw new Error('reload unavailable'); });
  const result = await importer.commitUrlList(await importer.previewUrlList('a.example.com', WORK.id));
  assert.equal(result.ok, true, 'successful persistence must not become a rejected import because reload failed');
  assert.equal(result.reloadRequired, true);
  assert.equal(state.icons.length, 1);
  assert.equal(writes.length, 1);
});

console.log('url-list-import.test.mjs passed');
