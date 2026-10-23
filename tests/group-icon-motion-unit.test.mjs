import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import './group-shortcuts-unit.test.mjs';

const source = fs.readFileSync(new URL('../folders.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
function harness({ scenes = false, reduced = false, deferred = false, supportsAnimation = true } = {}) {
  const animations = [], calls = [], queued = [], events = new Map(), motionEvents = new Set();
  const state = {
    currentFolderId: 'home',
    folders: ['home', 'work', 'play', 'empty'].map(id => ({ id, name: id, ...(scenes ? { sceneId: 'scene-a' } : {}) })),
    icons: [
      { id: 'home-site', folderId: 'home' },
      { id: 'work-site', folderId: 'work' },
      { id: 'work-folder', folderId: 'work', type: 'folder' },
      { id: 'work-child', folderId: 'work', parentId: 'work-folder' },
      { id: 'play-site', folderId: 'play' }
    ],
    scenes: [{ id: 'scene-a', homeGroupId: 'home', archivedAt: null }, { id: 'scene-b', homeGroupId: 'away', archivedAt: null }]
  };
  if (scenes) state.folders.push({ id: 'away', name: 'Away', sceneId: 'scene-b' });
  let view = { sceneId: 'scene-a', homeGroupId: 'home', generation: 1 };
  const motion = { matches: reduced, addEventListener: (_, fn) => motionEvents.add(fn), removeEventListener: (_, fn) => motionEvents.delete(fn) };
  const overlay = { classList: { add() {}, remove() {}, contains: () => false } };
  const grid = { children: [], style: {}, addEventListener() {}, querySelectorAll(selector) {
    assert.equal(selector, '.icon-widget[data-id]'); return this.children.filter(node => node.dataset.id);
  } };
  let zen = false;
  const document = { body: { classList: { contains: value => value === 'zen-mode' && zen } }, getElementById: id => id === 'folder-overlay' ? overlay : null, addEventListener: (type, fn) => events.set(type, fn) };
  const window = { matchMedia: query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return motion; } };
  vm.runInNewContext(source, { window, document });
  const api = window.OpenTabFolders;
  function node(icon = {}) {
    const element = { dataset: icon.id ? { id: icon.id } : {}, style: {}, className: 'icon-widget', disabled: false, inert: false };
    if (supportsAnimation) element.animate = (frames, options) => {
      const animation = { frames: clone(frames), options: clone(options), node: element, canceled: false, finished: false,
        cancel() { this.canceled = true; this.oncancel?.(); }, finish() { this.finished = true; this.onfinish?.(); } };
      animations.push(animation); return animation;
    };
    return element;
  }
  function render() { grid.children = [...api.visibleIcons().map(node), node()]; api.animateGroupIcons(grid); }
  function commit(folderId) {
    state.currentFolderId = folderId;
    if (scenes) view = { ...view, generation: view.generation + 1 };
    render(); return true;
  }
  const host = { state, getIconsContainer: () => grid, captureIntent: () => ({}), rememberFocus() {},
    ...(scenes ? { getSceneView: () => view } : {}),
    selectFolder(folderId, animated) {
      calls.push({ folderId, animated });
      if (deferred) return new Promise((resolve, reject) => queued.push({ folderId, resolve, reject, commit: () => { const value = commit(folderId); resolve(value); return value; } }));
      return commit(folderId);
    }
  };
  api.init(host); render();
  return { api, state, grid, calls, animations, queued, render, host, createNode: node,
    reduce(value) { motion.matches = value; for (const fn of motionEvents) fn({ matches: value }); },
    zen(value) { zen = value; },
    view(value) { view = { ...view, ...value }; },
    alt(number) { events.get('keydown')({ code: `Digit${number}`, altKey: true, target: { closest: () => false }, preventDefault() {} }); }
  };
}

for (const scenes of [false, true]) {
  const h = harness({ scenes }), graph = clone({ folders: h.state.folders, icons: h.state.icons });
  assert.equal(h.animations.length, 0, 'initial rendering is still');
  assert.equal(h.api.selectGroup('work', true), true);
  assert.deepEqual(h.calls, [{ folderId: 'work', animated: false }], 'group selection bypasses the old delayed/staggered renderer');
  assert.deepEqual(h.grid.children.map(node => node.dataset.id).filter(Boolean), ['work-site', 'work-folder']);
  assert.equal(h.animations.length, 2, 'animate root site and folder, not child records or the add control');
  for (const animation of h.animations) {
    assert.deepEqual(animation.frames, [{ opacity: 0.25, scale: '0.96', translate: '0 4px' }, { opacity: 1, scale: '1', translate: '0 0' }]);
    assert.equal(animation.options.duration, 160); assert.equal(animation.options.delay ?? 0, 0);
    assert.equal(animation.options.fill, 'none'); assert.equal(animation.options.id, 'opentab-group-pop');
    assert.deepEqual(animation.node.style, {}, 'animation writes no lingering inline styles or pointer blocking');
    assert.equal(animation.node.inert, false); assert.equal(animation.node.disabled, false);
  }
  assert.deepEqual({ folders: h.state.folders, icons: h.state.icons }, graph, 'records, IDs, hierarchy and order are untouched');
  h.api.selectGroup('work', true); assert.equal(h.calls.length, 1); assert.equal(h.animations.length, 2, 'same-group clicks do not replay');
  h.api.openOverlay('work-folder'); assert.equal(h.api.currentOpenParentId(), 'work-folder');
  h.zen(true); h.alt(3); assert.equal(h.state.currentFolderId, 'work', 'Zen never switches hidden groups with Alt+number');
  h.zen(false);
  h.alt(3); assert.equal(h.state.currentFolderId, 'play'); assert.equal(h.api.currentOpenParentId(), '');
  assert.ok(h.animations.slice(0, 2).every(animation => animation.canceled), 'rapid next selection cancels old animations immediately');
  assert.equal(h.animations.length, 3); const last = h.animations.at(-1);
  h.render(); assert.equal(last.canceled, true); assert.equal(h.animations.length, 3, 'unrelated save renders clean up but never replay');
  h.api.selectGroup('empty', true); assert.equal(h.animations.length, 3, 'empty groups are immediate without add-tile motion');
  h.api.selectGroup('home', false); assert.equal(h.animations.length, 3, 'explicit nonanimated navigation stays still');
  assert.equal(h.api.selectGroup('missing', true), false);
  if (scenes) { assert.equal(h.api.selectGroup('away', true), false); assert.equal(h.state.currentFolderId, 'home'); }
}
{
  const h = harness({ reduced: true }); h.api.selectGroup('work', true);
  assert.equal(h.state.currentFolderId, 'work'); assert.equal(h.animations.length, 0); assert.equal(h.calls[0].animated, false);
  h.reduce(false); h.api.selectGroup('play', true); assert.equal(h.animations.length, 1);
  h.reduce(true); assert.equal(h.animations[0].canceled, true, 'enabling reduced motion immediately cancels active effects');
  h.render(); assert.equal(h.animations.length, 1);
}
{
  const h = harness(); h.api.selectGroup('work', true); h.animations.forEach(animation => animation.finish());
  h.api.selectGroup('play', true);
  assert.ok(h.animations.slice(0, 2).every(animation => !animation.canceled), 'finished animations are released rather than retained for later cancellation');
}
{
  const h = harness({ supportsAnimation: false }); assert.equal(h.api.selectGroup('work', true), true);
  assert.equal(h.state.currentFolderId, 'work'); assert.equal(h.animations.length, 0, 'unsupported motion remains a synchronous functional navigation');
}
{
  const h = harness({ deferred: true }), first = h.api.selectGroup('work', true);
  h.render(); assert.equal(h.animations.length, 0, 'source refresh while saving cannot consume the destination animation');
  const second = h.api.selectGroup('play', true);
  h.queued[0].resolve(false); assert.equal(await first, false); await tick();
  h.queued[1].commit(); assert.equal(await second, true);
  assert.deepEqual(h.animations.map(animation => animation.node.dataset.id), ['play-site'], 'an older completion never clears the latest request');
}
for (const race of ['different-scene', 'round-trip', 'archived', 'ownership']) {
  const h = harness({ scenes: true, deferred: true }), result = h.api.selectGroup('work', true);
  if (race === 'different-scene') h.view({ sceneId: 'scene-b', homeGroupId: 'away' });
  if (race === 'round-trip') h.view({ generation: 3 });
  if (race === 'archived') h.state.scenes[0].archivedAt = 123;
  if (race === 'ownership') h.state.folders.find(group => group.id === 'work').sceneId = 'scene-b';
  h.queued[0].commit(); await result;
  assert.equal(h.animations.length, 0, `${race} never plays a stale group animation`);
}
{
  const h = harness({ deferred: true }), result = h.api.selectGroup('work', true);
  h.queued[0].reject(new Error('navigation rejected'));
  await assert.rejects(result, /navigation rejected/); await tick();
  h.state.currentFolderId = 'work'; h.render(); assert.equal(h.animations.length, 0, 'failed navigation cannot leave an armed effect');
}
{
  const h = harness({ deferred: true }), result = h.api.selectGroup('work', true);
  h.reduce(true); h.reduce(false); h.queued[0].commit(); await result;
  assert.equal(h.animations.length, 0, 'motion preference interruption discards pending animation too');
}
{
  // Exercise the real desktop mount function too: the hook must be synchronous,
  // after insertion and before grid-ready, without its old exit timer or RAFs.
  const home = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  const renderer = home.slice(home.indexOf('  function renderIconsForCurrentFolder('), home.indexOf('  function selectFolder('));
  assert.ok(renderer.includes('animateGroupIcons'), 'home desktop renderer wires the real post-mount hook');
  const h = harness(), marks = [];
  Object.defineProperty(h.grid, 'innerHTML', { set(value) { assert.equal(value, ''); this.children = []; } });
  h.grid.appendChild = node => h.grid.children.push(node);
  const context = {
    state: h.state, elements: { iconsContainer: h.grid }, iconSwitchToken: 0,
    getIconsForFolder: () => h.api.visibleIcons(), bindDesktopGridEvents() {},
    createIconWidget: h.createNode, createAddShortcutTile: () => h.createNode(),
    window: { OpenTabFolders: h.api }, performance: { mark: value => marks.push({ value, count: h.animations.length }) },
    setTimeout() { assert.fail('group switches never wait for the legacy exit timer'); },
    requestAnimationFrame() { assert.fail('group switches never wait for two animation frames to become interactive'); }
  };
  vm.createContext(context); vm.runInContext(renderer, context);
  h.host.selectFolder = (id, animated) => { h.state.currentFolderId = id; context.renderIconsForCurrentFolder(animated); return true; };
  assert.equal(h.api.selectGroup('work', true), true);
  assert.deepEqual(h.grid.children.map(node => node.dataset.id).filter(Boolean), ['work-site', 'work-folder']);
  assert.deepEqual(marks, [{ value: 'opentab:grid-ready', count: 2 }]);
  context.renderIconsForCurrentFolder(false);
  assert.equal(h.animations.length, 2, 'real unrelated desktop mounts never re-arm the one-shot effect');
}
console.log('Group icon motion regressions passed: one-shot 160ms pop, immediate mounts, no stagger, rapid cancellation, reduced motion, scene guards and unchanged IDs/order/folders.');
