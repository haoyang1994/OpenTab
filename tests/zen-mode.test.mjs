import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';
import { verifyWindowFullscreenShortcut } from './window-fullscreen-native.mjs';

// Native MV3 fixture. Do not substitute file://: extension lifecycle, shared
// storage, scene navigation, focus, fullscreen and keyboard capture all matter.
const require = createRequire(import.meta.url), Schema = require('../scene-schema.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const protectedKeys = ['scenes', 'sceneProfiles', 'folders', 'icons', 'todos', 'minimalMode', 'todoButtonVisible', 'todoPanelOpen'];
const gradient = 'linear-gradient(135deg, #dce8f8, #f8fafc)';
function fixture(extra = {}) {
  const data = Schema.create(Schema.migrateLegacy({
    icons: [{ id: 'home-docs', name: 'Home docs', type: 'shortcut', url: 'https://home.example.test/', folderId: 'folder-home' }],
    folders: [{ id: 'folder-home', name: 'Home' }], currentFolderId: 'folder-home',
    todos: [{ id: 'home-task', text: 'Keep the other scene task', done: false }], todoPanelOpen: false,
    background: { type: 'gradient', value: gradient, source: 'gradient' },
    weatherEnabled: false, particlesEnabled: false, minimalMode: false, themeMode: 'light', languagePreference: 'en',
    searchHistoryEnabled: false, searchSuggestionsEnabled: false, searchHistory: [], searchEngine: 'google', todoButtonVisible: true,
    ...extra
  }), { id: 'study', name: 'Study', iconKey: 'book', homeGroupId: 'study-home', homeName: 'Study home', profile: { background: { type: 'gradient', value: gradient, source: 'gradient' } } });
  data.folders.push({ id: 'study-reference', name: 'Reference', sceneId: 'study' });
  data.icons.push({ id: 'study-docs', name: 'Study docs', type: 'shortcut', url: 'https://study.example.test/', folderId: 'study-home' });
  data.todos.push({ id: 'study-task', text: 'Read one chapter', done: false, sceneId: 'study' });
  Schema.validate(data); return data;
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opentab-zen-native-'));
let context;
// Own the explicit fixture directory even if browser/setup fails before checks.
try {
context = await chromium.launchPersistentContext(profile, {
  headless: process.env.HEADLESS === 'true', locale: 'en-US', viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', route => /^https?:/.test(route.request().url()) ? route.abort() : route.continue());
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const url = `chrome-extension://${worker.url().split('/')[2]}/home.html`, page = await context.newPage();
// Install before the production window capture handler, which intentionally
// stops propagation to hidden UI. Observe final cancellation after dispatch,
// not in an inter-listener microtask, and never change the event or browser API.
await page.addInitScript(() => {
  const log = window.__zenNativeEvents = { escape: [], fullscreen: [], focus: [] };
  const identity = node => node === window ? { tag: 'WINDOW', id: '' } : node === document ? { tag: 'DOCUMENT', id: '' }
    : node ? { tag: node.tagName, id: node.id || '' } : null;
  const details = node => {
    if (!(node instanceof Element)) return identity(node);
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return { ...identity(node), connected: node.isConnected, inert: Boolean(node.inert), inertAncestor: identity(node.closest('[inert]')),
      hidden: Boolean(node.hidden), hiddenAncestor: identity(node.closest('[hidden], .hidden')), disabled: Boolean(node.disabled), tabIndex: node.tabIndex,
      display: style.display, visibility: style.visibility, transitionProperty: style.transitionProperty,
      transitionDuration: style.transitionDuration, transitionDelay: style.transitionDelay, rect: { x: box.x, y: box.y, width: box.width, height: box.height } };
  };
  let focusSequence = 0;
  const recordFocus = (label, event, checkpoint = false) => {
    const item = { sequence: ++focusSequence, label, event: event ? { type: event.type, trusted: event.isTrusted,
      target: identity(event.target), currentTarget: identity(event.currentTarget), defaultPrevented: event.defaultPrevented } : null,
      active: details(document.activeElement) };
    if (checkpoint) item.surfaces = { entry: details(document.getElementById('zen-toggle-btn')),
      home: details(document.getElementById('homepage')), zen: details(document.getElementById('zen-mode')),
      bodyClass: document.body?.className, fullscreen: identity(document.fullscreenElement) };
    log.focus.push(item); if (log.focus.length > 64) log.focus.shift();
  };
  window.__zenFocusCheckpoint = label => recordFocus(label, null, true);
  for (const type of ['focusin', 'focusout']) window.addEventListener(type, event => recordFocus(type, event), true);
  for (const type of ['pointerdown', 'mousedown', 'click']) document.addEventListener(type, event => {
    if (event.target.closest?.('#zen-toggle-btn, #zen-exit')) recordFocus(`capture-${type}`, event, true);
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    for (const id of ['zen-toggle-btn', 'zen-exit']) document.getElementById(id)?.addEventListener('click', event => recordFocus('button-click', event, true), true);
  }, { once: true });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const entry = { trusted: event.isTrusted, target: event.target?.id || event.target?.tagName,
      fullscreenBefore: Boolean(document.fullscreenElement), defaultPrevented: null, settled: false };
    log.escape.push(entry);
    setTimeout(() => { entry.defaultPrevented = event.defaultPrevented; entry.settled = true; }, 0);
  }, true);
  document.addEventListener('fullscreenchange', event => {
    log.fullscreen.push({ trusted: event.isTrusted, active: Boolean(document.fullscreenElement),
      target: document.fullscreenElement?.tagName || null });
  });
});
const read = keys => worker.evaluate(keys => chrome.storage.local.get(keys), keys);
const waitForTodoPanelSaved = open => waitForAsync(worker,
  async expected => (await chrome.storage.local.get('todoPanelOpen')).todoPanelOpen === expected, open);
const phase = () => page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().phase);
const view = () => page.evaluate(() => OpenTabSceneNavigation.getView());
const focusId = () => page.evaluate(() => document.activeElement.id);
async function ready(data) {
  await page.waitForFunction(({ languagePreference, themeMode, minimalMode, todoButtonVisible }) =>
    document.documentElement.lang === languagePreference && globalThis.OpenTabZenMode && globalThis.OpenTabClockDeck?.getFocus()
      && performance.getEntriesByName('opentab:grid-ready').length
      && globalThis.OpenTabSceneNavigation?.getView()?.sceneId === 'study'
      && !document.getElementById('homepage').inert
      && document.body.classList.contains('theme-light') === (themeMode === 'light')
      && document.body.classList.contains('minimal-mode') === minimalMode
      && document.body.classList.contains('hide-todo-entry') === !todoButtonVisible, data);
}
async function reset(extra = {}, timer = null) {
  await page.goto('about:blank'); const data = fixture(extra);
  const saved = await worker.evaluate(data => OpenTabWorkspace.transaction(async ({ read, write }) => { await write(data); return read(Object.keys(data)); }), data);
  assert.deepEqual(saved, data, 'seed through the real workspace lock, not a race with first-install writes');
  await page.goto(url);
  await page.evaluate(timer => {
    sessionStorage.removeItem('opentab.focus.v1');
    if (timer) sessionStorage.setItem('opentab.focus.v1', JSON.stringify(timer));
    sessionStorage.setItem('opentab.scene.view', JSON.stringify({ sceneId: 'study', lastGroupIds: { study: 'study-home' } }));
  }, timer);
  await page.reload(); await ready(data);
  await page.waitForFunction(() => document.getElementById('clock-todo-text').textContent === 'Read one chapter');
  assert.deepEqual(await read(['minimalMode', 'todoButtonVisible', 'todoPanelOpen']),
    { minimalMode: data.minimalMode, todoButtonVisible: data.todoButtonVisible, todoPanelOpen: data.todoPanelOpen },
    'every ready fixture retains its explicitly seeded preferences before capturing a Zen baseline');
}

// Native mode wraps only to observe; it forwards requestFullscreen immediately,
// within the trusted click. Other modes are explicit deterministic API fixtures,
// never presented as successful native fullscreen evidence.
async function fullscreen(mode = 'native') {
  return page.evaluate(mode => {
    const element = document.documentElement, native = element.requestFullscreen?.bind(element);
    const log = window.__zenFullscreen = { mode, calls: [], exits: 0, status: 'untouched', available: Boolean(native && document.fullscreenEnabled), element: null };
    let inClick = false;
    document.addEventListener('click', event => {
      if (event.target.closest('#zen-toggle-btn')) inClick = true;
    }, true);
    window.addEventListener('click', () => { inClick = false; });
    const record = () => log.calls.push({ inClick, activation: navigator.userActivation.isActive });
    if (mode === 'unsupported' || (mode === 'native' && !native)) {
      Object.defineProperty(element, 'requestFullscreen', { configurable: true, value: undefined }); log.status = 'unsupported'; return log.available;
    }
    if (mode === 'native') {
      const nativeExit = document.exitFullscreen.bind(document);
      document.exitFullscreen = () => { log.exits++; return nativeExit(); };
      element.requestFullscreen = () => {
        record(); log.status = 'pending';
        let result;
        try { result = native(); } catch (error) { log.status = 'rejected'; log.reason = error.name; throw error; }
        return Promise.resolve(result).then(value => { log.status = 'fulfilled'; return value; }, error => { log.status = 'rejected'; log.reason = error.name; throw error; });
      };
      return log.available;
    }
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => log.element });
    document.exitFullscreen = () => { log.exits++; log.element = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    element.requestFullscreen = () => {
      record(); log.status = 'pending';
      if (mode === 'reject') { log.status = 'rejected'; return Promise.reject(new DOMException('Deterministic fullscreen refusal', 'NotAllowedError')); }
      if (mode === 'throw') { log.status = 'rejected'; throw new DOMException('Deterministic synchronous refusal', 'NotAllowedError'); }
      return new Promise((resolve, reject) => {
        log.resolve = () => { log.element = element; log.status = 'fulfilled'; document.dispatchEvent(new Event('fullscreenchange')); resolve(); };
        log.reject = () => { log.status = 'rejected'; reject(new DOMException('Late fullscreen refusal', 'NotAllowedError')); };
      });
    };
    return log.available;
  }, mode);
}
async function reportFocusFailure(stage) {
  const diagnostic = await page.evaluate(stage => {
    __zenFocusCheckpoint(`${stage}-failure`);
    return { stage, active: { tag: document.activeElement?.tagName, id: document.activeElement?.id || '' },
      zenActive: OpenTabZenMode.isActive(), timeline: __zenNativeEvents.focus };
  }, stage).catch(error => ({ stage, unavailable: error.message }));
  console.error(`Zen: focus diagnostics ${JSON.stringify(diagnostic)}`);
}
async function enter() {
  try {
    await page.evaluate(() => __zenFocusCheckpoint('before-entry-click'));
    await page.click('#zen-toggle-btn'); await page.waitForSelector('#zen-mode:not([hidden])');
    await page.evaluate(() => __zenFocusCheckpoint('after-entry-click'));
    assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), true);
    assert.equal(await focusId(), 'zen-focus-toggle');
    assert.equal(await page.locator('#zen-toggle-btn').getAttribute('aria-expanded'), 'true');
  } catch (error) { await reportFocusFailure('entry'); throw error; }
}
async function exit() {
  try {
    await page.evaluate(() => __zenFocusCheckpoint('before-exit-click'));
    await page.click('#zen-exit'); await page.waitForSelector('#zen-mode[hidden]', { state: 'attached' });
    await page.evaluate(() => __zenFocusCheckpoint('after-exit-click'));
    assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), false);
    assert.equal(await page.locator('#zen-toggle-btn').getAttribute('aria-expanded'), 'false');
    assert.equal(await focusId(), 'zen-toggle-btn', 'quiet exit restores the actual entry button');
    const restored = await page.evaluate(() => {
      const home = getComputedStyle(document.getElementById('homepage')), entry = getComputedStyle(document.getElementById('zen-toggle-btn'));
      return { transition: home.transitionProperty, duration: home.transitionDuration, homeVisibility: home.visibility, entryVisibility: entry.visibility };
    });
    assert.deepEqual(restored, { transition: 'none', duration: '0s', homeVisibility: 'visible', entryVisibility: 'visible' },
      'the nonanimated isolation wrapper restores immediate visibility even under reduced motion');
  } catch (error) { await reportFocusFailure('exit'); throw error; }
}
async function todoRowDiagnostics() {
  return page.evaluate(() => {
    const row = document.querySelector('.todo-input-row'), input = document.getElementById('todo-input');
    const rowStyle = getComputedStyle(row), inputStyle = getComputedStyle(input), rect = row.getBoundingClientRect();
    return { active: { tag: document.activeElement?.tagName, id: document.activeElement?.id || '' },
      row: { transition: rowStyle.transitionProperty, duration: rowStyle.transitionDuration, visibility: rowStyle.visibility,
        inert: Boolean(row.closest('[inert]')), width: rect.width, height: rect.height },
      input: { transition: inputStyle.transitionProperty, visibility: inputStyle.visibility, disabled: input.disabled },
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
}
const transitionSurfaces = [
  '#homepage', '#content', '#clock-deck', '#clock-deck-stage', '#clock-widget', '#clock-focus-card', '#clock-todo-card', '#clock-deck-nav',
  '#clock-focus-card .clock-card-actions', '#clock-todo-card .clock-card-actions', '#clock-focus-time', '#clock-focus-toggle', '.clock-deck-dots', '[data-clock-card="1"]',
  '#search-widget-wrap', '#search-widget', '#search-engine-switch', '#search-engine-panel', '.engine-deck-rail',
  '#zen-mode', '.zen-center', '.zen-controls', '#zen-focus-toggle', '#zen-exit',
  '#todo-widget', '.todo-input-row', '#todo-input', '#clock-todo-open',
  '#command-palette', '.command-palette-panel', '#command-palette-input',
  '#settings-panel', '.settings-header', '.settings-header-tools', '.settings-search-label', '.settings-shell', '.settings-main', '#settings-search',
  '#add-icon-modal', '#add-icon-modal .modal-content', '#add-icon-modal .form-group', '#icon-name',
  '#change-icon-modal', '#change-icon-modal .modal-content', '#change-icon-modal .form-group', '.change-icon-placeholder-row', '#change-icon-letter',
  '#timezone-selector', '#timezone-list', '#timezone-list .timezone-item', '#calendar-popover'
];
async function transitionSnapshot(selectors) {
  return page.evaluate(selectors => selectors.map(selector => {
    const element = document.querySelector(selector);
    if (!element) return { selector, missing: true };
    const style = getComputedStyle(element);
    return { selector, property: style.transitionProperty, duration: style.transitionDuration, delay: style.transitionDelay,
      visibility: style.visibility, display: style.display, inert: Boolean(element.closest('[inert]')), focused: element === document.activeElement };
  }), selectors);
}
async function assertReducedTransitions(label) {
  for (const surface of await transitionSnapshot(transitionSurfaces)) {
    assert.equal(surface.missing, undefined, `${label}: ${surface.selector} exists in the real page`);
    assert.ok(surface.duration.split(',').every(value => parseFloat(value) === 0), `${label}: no reduced-motion transition duration: ${JSON.stringify(surface)}`);
    assert.ok(surface.delay.split(',').every(value => parseFloat(value) === 0), `${label}: no reduced-motion transition delay: ${JSON.stringify(surface)}`);
  }
}
async function verifyReducedMotionFocusFlows() {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const surface of await transitionSnapshot(['#clock-focus-card', '#search-engine-switch', '#todo-widget'])) {
    assert.equal(surface.missing, undefined);
    assert.ok(surface.duration.split(',').some(value => parseFloat(value) > 0), `normal motion remains enabled: ${JSON.stringify(surface)}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Child controls are lazy. Open their real surface before measuring its
  // closed-child transitions, retaining both entry and dismissal coverage.
  assert.equal(await page.locator('#timezone-list .timezone-item').count(), 0, 'hidden timezone controls are not constructed at startup');
  await page.click('#timezone-btn');
  assert.equal(await page.locator('#timezone-list .timezone-item[aria-pressed="true"]').evaluate(element => element === document.activeElement), true, 'first opening immediately focuses the selected timezone');
  assert.equal(await page.locator('#timezone-list .timezone-item').evaluateAll(items => items.length >= 24 && items.every(item => /^UTC[+-]/.test(item.querySelector('.timezone-item-offset').textContent))), true, 'first opening renders every supported choice with its real current offset');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#timezone-btn').evaluate(element => element === document.activeElement), true, 'first dismissal restores the timezone opener');
  await assertReducedTransitions('all closed');
  const timezone = await page.evaluate(() => {
    const list = document.getElementById('timezone-list'); return (list.querySelector('.active') || list.firstElementChild).dataset.tz;
  });
  const flows = [
    { name: 'Zen', open: () => enter(), focused: '#zen-focus-toggle', close: () => exit(), opener: '#zen-toggle-btn' },
    { name: 'TODO', open: async () => { await page.click('[data-clock-card="2"]'); await page.click('#clock-todo-open'); }, focused: '#todo-input',
      close: () => page.keyboard.press('Escape'), opener: '#clock-todo-open', persistsTodoPanel: true, finish: () => page.click('[data-clock-card="0"]') },
    { name: 'settings', open: () => page.click('#settings-btn'), focused: '#settings-search', close: () => page.click('#close-settings'), opener: '#settings-btn' },
    { name: 'command palette', open: async () => { await page.locator('#zen-toggle-btn').focus(); await page.keyboard.press('Control+k'); },
      focused: '#command-palette-input', close: () => page.keyboard.press('Escape'), opener: '#zen-toggle-btn' },
    { name: 'add-site dialog', open: () => page.click('#add-shortcut-tile'), focused: '#icon-name', close: () => page.click('#cancel-btn'), opener: '#add-shortcut-tile' },
    { name: 'change-icon dialog', open: async () => { await page.click('.icon-widget[data-id="study-docs"]', { button: 'right' }); await page.click('#change-icon-btn'); },
      focused: '#change-icon-letter', close: () => page.click('#change-icon-close'), opener: '.icon-widget[data-id="study-docs"]' },
    { name: 'timezone', open: () => page.click('#timezone-btn'), focused: `#timezone-list [data-tz=${JSON.stringify(timezone)}]`,
      close: () => page.keyboard.press('Escape'), opener: '#timezone-btn' }
  ];
  for (const flow of flows) {
    try {
      await flow.open();
      assert.equal(await page.locator(flow.focused).evaluate(element => element === document.activeElement), true, `${flow.name} immediately focuses its exact intended control`);
      const focused = await transitionSnapshot([flow.focused]);
      assert.equal(focused[0].visibility, 'visible', `${flow.name} focus is visible immediately`);
      assert.equal(focused[0].inert, false, `${flow.name} focus is not inside an inert subtree`);
      await assertReducedTransitions(`${flow.name} open`);
      if (flow.persistsTodoPanel) await waitForTodoPanelSaved(true);
      await flow.close();
      assert.equal(await page.locator(flow.opener).evaluate(element => element === document.activeElement), true, `${flow.name} immediately restores its exact opener`);
      await assertReducedTransitions(`${flow.name} closed`);
      if (flow.persistsTodoPanel) await waitForTodoPanelSaved(false);
      await flow.finish?.();
    } catch (error) {
      console.error(`Zen: reduced-motion focus flow ${flow.name}: ${JSON.stringify({ active: await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id || '' })), surfaces: await transitionSnapshot(transitionSurfaces) })}`);
      throw error;
    }
  }
  console.log(`Zen: reduced-motion wrapper transitions and ${flows.length} exact native focus flows passed`);
}
async function nativeEscapeDiagnostics() {
  return page.evaluate(() => ({ mode: __zenFullscreen.mode, supported: __zenFullscreen.available,
    requestStatus: __zenFullscreen.status, requestCalls: __zenFullscreen.calls, exitCalls: __zenFullscreen.exits,
    fullscreenElement: document.fullscreenElement?.tagName || null, zenActive: OpenTabZenMode.isActive(),
    focusedElement: document.activeElement?.id || document.activeElement?.tagName,
    events: __zenNativeEvents }));
}
async function assertNativeEscape(theme) {
  try {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.fullscreenElement === null
      && __zenNativeEvents.escape.some(event => event.settled)
      && __zenNativeEvents.fullscreen.some(event => event.trusted && !event.active), undefined, { timeout: 10000 });
    const result = await nativeEscapeDiagnostics(), escape = result.events.escape[0];
    assert.equal(escape.trusted, true, 'Escape comes from actual browser keyboard input, not dispatchEvent');
    assert.equal(escape.defaultPrevented, false, 'the complete Escape dispatch never prevents the browser default');
    assert.ok(result.events.fullscreen.some(event => event.trusted && event.active), 'real browser fullscreen entry emits fullscreenchange');
    assert.ok(result.events.fullscreen.some(event => event.trusted && !event.active), 'real browser exit emits fullscreenchange');
    assert.equal(result.zenActive, true, 'native Escape exits fullscreen, not Zen');
    assert.equal(await page.locator('#zen-mode').isVisible(), true);
    assert.equal(result.requestCalls.length, 1, 'no request to regain fullscreen after Escape');
    assert.ok(result.exitCalls <= 1, 'the fallback never repeats native exit');
    const calls = result.exitCalls, escapes = result.events.escape.length;
    await page.keyboard.press('Escape');
    await page.waitForFunction(count => __zenNativeEvents.escape.length > count && __zenNativeEvents.escape.at(-1).settled, escapes);
    const windowed = await nativeEscapeDiagnostics();
    assert.equal(windowed.events.escape.at(-1).trusted, true);
    assert.equal(windowed.events.escape.at(-1).defaultPrevented, false);
    assert.equal(windowed.exitCalls, calls, 'windowed Escape never invokes native fullscreen exit');
    assert.equal(windowed.requestCalls.length, 1, 'windowed Escape never re-enters fullscreen');
    assert.equal(windowed.zenActive, true, 'windowed Escape keeps the Zen screen');
    console.log(`Zen: native ${theme} fullscreen entry and trusted Escape passed (${result.exitCalls} app exit call, ${result.events.fullscreen.length} fullscreenchange events)`);
  } catch (error) {
    console.error(`Zen: native ${theme} Escape diagnostics ${JSON.stringify(await nativeEscapeDiagnostics().catch(diagnosticError => ({ error: diagnosticError.message })))}`);
    throw error;
  }
}
async function assertPlainScreen() {
  assert.equal(await page.locator('#zen-mode button').count(), 6, 'only exit, three durations, focus toggle and secondary reset');
  assert.equal(await page.locator('#zen-mode h1, #zen-mode h2, #zen-mode h3, #zen-mode progress, #zen-mode [role="progressbar"], #zen-mode img, #zen-mode canvas').count(), 0, 'no headings, extra progress widgets, wallpaper or dashboard decoration');
  assert.equal(await page.locator('.zen-ring circle').count(), 2, 'the only progress treatment is a restrained track and elapsed arc');
  assert.equal(await page.locator('.zen-ring').getAttribute('aria-hidden'), 'true', 'decorative progress never duplicates the accessible countdown');
  assert.equal((await page.locator('#zen-exit').textContent()).trim(), '', 'exit remains a quiet icon');
  for (const id of ['zen-exit', 'zen-focus-toggle', 'zen-focus-reset']) assert.ok(await page.locator(`#${id}`).getAttribute('aria-label'), 'functional controls retain accessible names');
  assert.equal(await page.locator('#zen-focus-toggle').getAttribute('aria-label'), await page.locator('#zen-focus-toggle').innerText(), 'visible action and accessible name agree');
  assert.equal(await page.locator('#zen-time').getAttribute('role'), 'timer');
  assert.equal(await page.locator('#zen-time').getAttribute('aria-live'), 'off', 'countdown is not announced every second');
  const appearance = await page.locator('#zen-mode').evaluate(panel => {
    const style = getComputedStyle(panel), timer = document.getElementById('zen-time'), timeRect = timer.getBoundingClientRect();
    const ring = document.querySelector('.zen-ring'), ringStyle = getComputedStyle(ring), ringRect = ring.getBoundingClientRect();
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT), visible = [];
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent.trim() || text.parentElement.closest('.sr-only')) continue;
      const style = getComputedStyle(text.parentElement);
      if (text.parentElement.getClientRects().length && style.display !== 'none' && style.visibility !== 'hidden') visible.push(text.textContent.trim());
    }
    const state = OpenTabClockDeck.getFocus().snapshot(), editable = ['idle', 'done'].includes(state.phase), t = OpenTabI18n.t;
    const expected = [timer.textContent];
    if (state.phase !== 'idle') expected.push(t(state.phase === 'running' ? '专注中' : state.phase === 'paused' ? '已暂停' : '已完成'));
    if (editable) expected.push(t('15 分钟'), t('25 分钟'), t('50 分钟'));
    expected.push(t(state.phase === 'running' ? '暂停' : state.phase === 'paused' ? '继续专注' : state.phase === 'done' ? '再次专注' : '开始专注'));
    if (state.phase !== 'idle') expected.push(t('重置'));
    return { background: style.backgroundColor, body: getComputedStyle(document.body).backgroundColor, image: style.backgroundImage,
      backdrop: style.backdropFilter, fontSize: parseFloat(getComputedStyle(timer).fontSize), visible, expected,
      ring: { width: ringRect.width, stroke: ringStyle.strokeWidth, shadow: ringStyle.boxShadow, filter: ringStyle.filter },
      within: timeRect.left >= 0 && timeRect.right <= innerWidth && timeRect.top >= 0 && timeRect.bottom <= innerHeight,
      isolated: [...document.body.children].filter(node => node !== panel && node.tagName !== 'SCRIPT').every(node => node.inert && getComputedStyle(node).visibility === 'hidden') };
  });
  assert.equal(appearance.background, appearance.body, 'plain screen follows the current light/dark theme');
  assert.match(appearance.background, /^rgb\(/, 'background is fully opaque'); assert.equal(appearance.image, 'none'); assert.equal(appearance.backdrop, 'none');
  assert.ok(appearance.fontSize >= 70, 'large, legible countdown'); assert.equal(appearance.within, true);
  assert.ok(appearance.ring.width >= 300 && appearance.ring.width <= 340, 'progress ring remains restrained in scale');
  assert.deepEqual({ ...appearance.ring, width: 320 }, { width: 320, stroke: '2px', shadow: 'none', filter: 'none' }, 'hairline progress has no glow');
  assert.deepEqual(appearance.visible, appearance.expected, 'only time, functional state, available durations and actions are visible, never explanatory copy');
  assert.equal(appearance.isolated, true, 'underlying wallpaper, controls and content are hidden and inert');
  assert.equal(await page.locator('#homepage').evaluate(home => getComputedStyle(home).transitionProperty), 'none', 'Zen isolation never animates wrapper visibility');
}

async function assertIsolatedKeys() {
  const before = await view(), query = await page.locator('#search-input').inputValue();
  for (const key of ['Control+k', 'Meta+k', 'Alt+2', 'x']) {
    await page.locator('#zen-focus-toggle').focus(); await page.keyboard.press(key);
    assert.equal(await page.locator('#command-palette').isVisible(), false, `${key} never opens the hidden palette`);
    assert.deepEqual(await view(), before, `${key} never switches the hidden scene/group`);
    assert.equal(await page.locator('#search-input').inputValue(), query, `${key} never triggers hidden type-to-search`);
  }
  await page.locator('#zen-focus-toggle').focus();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
    assert.equal(await page.evaluate(() => document.getElementById('zen-mode').contains(document.activeElement)), true, 'keyboard focus stays inside Zen');
  }
  await page.locator('#zen-focus-toggle').focus();
}

  // Exercise real native entry and real native Escape, separately in both themes.
  for (const themeMode of ['light', 'dark']) {
    await reset({ themeMode }); await fullscreen();
    assert.equal(await page.locator('#homepage').evaluate(home => getComputedStyle(home).transitionProperty), 'none', 'the isolation-wrapper transition guard exists before entering Zen');
    assert.equal(await page.locator('#todo-toggle-btn').count(), 0, 'the old floating TODO entry is removed');
    const entry = await page.locator('#zen-toggle-btn').boundingBox(); assert.ok(entry.x < 40 && entry.y < 40, 'Zen is the upper-left entry');
    assert.equal(entry.width, 44); assert.equal(entry.height, 44, 'the icon replacement preserves the entry target size');
    const entryButton = page.locator('#zen-toggle-btn');
    assert.equal((await entryButton.textContent()).trim(), '', 'the Zen entry has no visible text');
    assert.equal(await entryButton.getAttribute('aria-label'), 'Zen mode', 'the entry retains its localized accessible name');
    assert.equal(await entryButton.getAttribute('title'), 'Zen mode', 'the entry retains its localized tooltip');
    const entryIcon = entryButton.locator('svg');
    assert.equal(await entryIcon.count(), 1);
    assert.equal(await entryIcon.getAttribute('aria-hidden'), 'true', 'the icon remains decorative for assistive technology');
    const iconBounds = await entryIcon.boundingBox();
    assert.equal(iconBounds.width, 20); assert.equal(iconBounds.height, 20, 'the lotus preserves the existing icon footprint');
    const before = await read(protectedKeys), scene = await view();
    await page.fill('#search-input', 'keep this query');
    await page.locator('#search-input').evaluate(input => input.setSelectionRange(5, 9, 'backward'));
    await enter(); assert.equal(await phase(), 'idle'); assert.equal(await page.locator('#zen-time').innerText(), '25:00');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('opentab.focus.v1')), null, 'entry never autostarts the shared focus timer');
    await assertPlainScreen();
    await page.waitForFunction(() => __zenFullscreen.status !== 'pending');
    const native = await page.evaluate(() => ({ calls: __zenFullscreen.calls, available: __zenFullscreen.available, status: __zenFullscreen.status, reason: __zenFullscreen.reason }));
    if (native.calls.length) assert.deepEqual(native.calls, [{ inClick: true, activation: true }], 'fullscreen is directly requested with the entry click activation');
    if (native.available) assert.equal(native.status, 'fulfilled', `a browser advertising native fullscreen must actually enter it, not silently pass a rejection (${native.reason || native.status})`);
    if (native.status === 'fulfilled') {
      assert.equal(await page.evaluate(() => document.fullscreenElement === document.documentElement), true, 'real browser entered fullscreen');
      await page.screenshot({ path: path.join(artifacts, `zen-${themeMode}-fullscreen.png`), animations: 'disabled' });
      await assertNativeEscape(themeMode);
    } else {
      console.log(`Zen: native fullscreen unavailable (${themeMode}: ${native.status}${native.reason ? `, ${native.reason}` : ''}); deterministic fallback checks still run`);
    }
    await assertIsolatedKeys(); await assertPlainScreen();
    await page.screenshot({ path: path.join(artifacts, `zen-${themeMode}-idle.png`), animations: 'disabled' });
    if (themeMode === 'dark') {
      // Keep both active states available for independent theme/pixel review.
      await page.click('#zen-focus-toggle'); assert.equal(await phase(), 'running');
      await page.waitForFunction(() => document.getElementById('zen-time').textContent !== '25:00');
      await assertPlainScreen();
      await page.screenshot({ path: path.join(artifacts, 'zen-dark-running.png'), animations: 'disabled' });
      await page.click('#zen-focus-toggle'); assert.equal(await phase(), 'paused');
      await assertPlainScreen();
      await page.screenshot({ path: path.join(artifacts, 'zen-dark-paused.png'), animations: 'disabled' });
      await page.click('#zen-focus-reset'); assert.equal(await phase(), 'idle');
    }
    await exit();
    assert.equal(await page.locator('#search-input').inputValue(), 'keep this query');
    assert.deepEqual(await page.locator('#search-input').evaluate(input => [input.selectionStart, input.selectionEnd, input.selectionDirection]), [5, 9, 'backward']);
    assert.equal(await focusId(), 'zen-toggle-btn'); assert.deepEqual(await view(), scene); assert.deepEqual(await read(protectedKeys), before);
    assert.equal(await page.locator('#homepage').evaluate(home => home.inert), false);
  }

  await reset(); await fullscreen('unsupported'); await verifyReducedMotionFocusFlows();

  // The real deck and Zen use one timer, in both directions, without restarting.
  await reset(); await fullscreen('unsupported'); await page.click('[data-clock-card="1"]'); await page.click('#clock-focus-toggle');
  await page.waitForFunction(() => document.getElementById('clock-focus-time').textContent !== '25:00');
  const deadline = await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().deadline);
  await enter(); assert.equal(await phase(), 'running');
  await assertPlainScreen();
  await page.screenshot({ path: path.join(artifacts, 'zen-light-running.png'), animations: 'disabled' });
  assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().deadline), deadline, 'Zen reuses the running deck deadline');
  await page.click('#zen-focus-toggle'); assert.equal(await phase(), 'paused');
  assert.equal(await page.locator('#zen-focus-toggle').getAttribute('aria-label'), 'Resume focus');
  await assertPlainScreen();
  await page.screenshot({ path: path.join(artifacts, 'zen-light-paused.png'), animations: 'disabled' });
  const paused = await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().remaining);
  await page.evaluate(() => {
    window.__zenPausedTickObserved = false;
    const observer = new MutationObserver(() => { observer.disconnect(); window.__zenPausedTickObserved = true; });
    observer.observe(document.getElementById('clock-focus-time'), { childList: true });
  });
  await page.waitForFunction(() => __zenPausedTickObserved, undefined, { timeout: 5000 });
  assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().remaining), paused, 'remaining time is stable across a real shared-deck tick');
  assert.equal(await page.locator('#clock-focus-time').textContent(), await page.locator('#zen-time').textContent());
  await page.locator('#zen-focus-toggle').focus(); await page.keyboard.press('Enter'); assert.equal(await phase(), 'running');
  await page.keyboard.down('Enter'); assert.equal(await phase(), 'paused');
  await page.keyboard.down('Enter'); assert.equal(await phase(), 'paused', 'native repeated Enter does not double-toggle');
  await page.keyboard.up('Enter'); await page.keyboard.press('Enter'); assert.equal(await phase(), 'running');
  await page.keyboard.press('Space'); assert.equal(await phase(), 'paused');
  await page.click('#zen-focus-reset'); assert.equal(await phase(), 'idle'); assert.equal(await page.locator('#zen-time').innerText(), '25:00');
  assert.equal(await page.locator('#zen-focus-reset').isDisabled(), true);
  await page.click('#zen-focus-toggle'); await exit();
  assert.equal(await page.locator('#clock-focus-toggle').innerText(), 'Pause');
  await page.click('#clock-focus-toggle'); assert.equal(await phase(), 'paused');
  await enter(); assert.equal(await page.locator('#zen-focus-toggle').getAttribute('aria-label'), 'Resume focus'); await exit();

  // All three presets configure the existing controller and survive reload.
  // Selection does not start focus; active/paused sessions cannot be overwritten.
  for (const minutes of [15, 25, 50]) {
    const duration = minutes * 60000;
    await reset(); await fullscreen('unsupported'); await enter();
    const before = await read(protectedKeys);
    await page.click(`#zen-presets [data-duration="${duration}"]`);
    assert.equal(await phase(), 'idle'); assert.equal(await page.locator('#zen-time').innerText(), `${minutes}:00`);
    assert.equal(await page.locator('#clock-focus-time').textContent(), `${minutes}:00`);
    assert.deepEqual(await page.locator('#clock-focus-progress').evaluate(el => [el.max, el.value]), [duration, 0]);
    assert.equal(await page.locator('#zen-focus-reset').isVisible(), false);
    assert.equal(await page.locator('#zen-progress').evaluate(el => el.style.strokeDashoffset), '100');
    await page.reload(); await ready(fixture()); await fullscreen('unsupported'); await enter();
    assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().duration), duration);
    assert.equal(await phase(), 'idle'); assert.equal(await page.locator('#zen-time').innerText(), `${minutes}:00`);
    await page.click('#zen-focus-toggle');
    const deadline = await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().deadline);
    assert.equal(await page.locator('#zen-presets').isVisible(), false);
    assert.deepEqual(await page.locator('#zen-presets button').evaluateAll(buttons => buttons.map(button => button.disabled)), [true, true, true]);
    await page.evaluate(() => OpenTabClockDeck.getFocus().setDuration(600000));
    assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().deadline), deadline);
    await page.reload(); await ready(fixture()); await fullscreen('unsupported'); await enter();
    assert.equal(await phase(), 'running'); assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().deadline), deadline);
    await page.click('#zen-focus-toggle'); const paused = await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().remaining);
    await page.evaluate(duration => OpenTabClockDeck.getFocus().setDuration(duration === 900000 ? 3000000 : 900000), duration);
    assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().duration), duration);
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab'); assert.ok(['zen-exit', 'zen-focus-toggle', 'zen-focus-reset'].includes(await focusId()), 'hidden presets cannot trap keyboard focus');
    }
    await page.reload(); await ready(fixture()); await fullscreen('unsupported'); await enter();
    assert.equal(await phase(), 'paused'); assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().remaining), paused);
    const progress = await page.evaluate(() => {
      const state = OpenTabClockDeck.getFocus().snapshot(), progress = document.getElementById('clock-focus-progress');
      return { max: progress.max, value: progress.value, offset: Number(document.getElementById('zen-progress').style.strokeDashoffset), duration: state.duration, remaining: state.remaining };
    });
    assert.equal(progress.max, duration); assert.equal(progress.value, duration - paused);
    assert.ok(Math.abs(progress.offset - 100 * paused / duration) < 0.001, 'native ring reflects the shared selected duration');
    await page.locator('#zen-focus-reset').focus(); await page.keyboard.press('Enter');
    assert.equal(await phase(), 'idle'); assert.equal(await focusId(), 'zen-focus-toggle', 'hiding reset restores focus immediately');
    assert.equal(await page.locator('#zen-time').innerText(), `${minutes}:00`);
    await exit(); assert.deepEqual(await read(protectedKeys), before, 'duration choices never persist new workspace settings');
  }

  await reset({}, { version: 1, phase: 'running', remaining: 1500000, deadline: 1 }); await fullscreen('unsupported'); await enter();
  assert.equal(await page.locator('#zen-time').innerText(), '00:00'); assert.equal(await phase(), 'done');
  assert.equal(await page.locator('#zen-focus-toggle').getAttribute('aria-label'), 'Focus again');
  await assertPlainScreen();
  await page.click('#zen-focus-toggle'); assert.equal(await phase(), 'running'); await exit();

  // Graceful unsupported/rejected APIs keep timer and exit usable. These are
  // intentional mocks, not a replacement for the native capability test above.
  for (const mode of ['unsupported', 'reject', 'throw']) {
    await reset(); await fullscreen(mode); await enter();
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
    await page.click('#zen-focus-toggle'); assert.equal(await phase(), 'running'); await exit();
    assert.equal(await page.locator('#homepage').evaluate(home => home.inert), false);
  }
  for (const outcome of ['resolve', 'reject']) {
    await reset(); await fullscreen('pending'); await enter();
    assert.equal(await page.evaluate(() => __zenFullscreen.status), 'pending'); await exit();
    await page.evaluate(outcome => __zenFullscreen[outcome](), outcome);
    await page.waitForFunction(() => document.fullscreenElement === null);
    assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), false);
    assert.equal(await page.locator('#zen-mode').isVisible(), false, 'a settled stale request never reopens Zen');
    assert.equal(await page.evaluate(() => __zenFullscreen.exits), outcome === 'resolve' ? 1 : 0, 'late fullscreen success after rapid exit is unwound once');
  }

  await reset(); await fullscreen('pending'); await enter(); await exit(); await enter();
  assert.equal(await page.evaluate(() => __zenFullscreen.calls.length), 1, 're-entry never duplicates an outstanding fullscreen request');
  await exit(); await page.evaluate(() => __zenFullscreen.resolve());
  await page.waitForFunction(() => document.fullscreenElement === null && __zenFullscreen.exits === 1);
  assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), false);
  await enter(); assert.equal(await page.evaluate(() => __zenFullscreen.calls.length), 2, 'fresh re-entry can request fullscreen after settlement');
  await page.evaluate(() => __zenFullscreen.resolve()); await exit();
  await page.waitForFunction(() => document.fullscreenElement === null && __zenFullscreen.exits === 2);

  await reset(); await fullscreen('pending'); await enter(); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => __zenFullscreen.exits), 0, 'Escape cannot exit a fullscreen request that is still only pending');
  assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), true);
  await page.evaluate(() => __zenFullscreen.resolve());
  await page.waitForFunction(() => document.fullscreenElement === null && __zenFullscreen.exits === 1);
  assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), true, 'late fullscreen cancellation keeps Zen active');
  assert.equal(await page.evaluate(() => __zenFullscreen.calls.length), 1); await exit();

  // Legacy minimal mode is separate, and TODO remains accessible from card 2.
  await reset(); await fullscreen('unsupported'); await page.click('[data-clock-card="2"]');
  assert.equal((await todoRowDiagnostics()).row.duration, '0s', 'the collapsed TODO input row already respects reduced motion');
  await page.click('#clock-todo-open'); await page.waitForSelector('#todo-widget:not(.hidden)');
  try { assert.equal(await focusId(), 'todo-input'); }
  catch (error) { console.error(`Zen: TODO focus diagnostics ${JSON.stringify(await todoRowDiagnostics())}`); throw error; }
  const todoRow = await todoRowDiagnostics();
  assert.deepEqual(todoRow.row, { transition: todoRow.row.transition, duration: '0s', visibility: 'visible', inert: false, width: todoRow.row.width, height: todoRow.row.height },
    'the TODO input wrapper becomes immediately visible without a reduced-motion visibility transition');
  assert.ok(todoRow.row.width > 0 && todoRow.row.height > 0); assert.equal(todoRow.input.visibility, 'visible');
  assert.equal(todoRow.input.disabled, false); assert.equal(todoRow.reducedMotion, true, 'exercise the reduced-motion regression rather than the easier default-motion path');
  assert.equal((await page.locator('#todo-list').innerText()).includes('Read one chapter'), true);
  // Opening focuses/renders synchronously, but setTodoPanelOpen does not await
  // its normal workspace save. Compare Zen against that durable open baseline,
  // not the stale closed value while the unrelated click's save is in flight.
  await waitForTodoPanelSaved(true);
  const openTodoState = await read(protectedKeys);
  assert.equal(openTodoState.todoPanelOpen, true, 'the pre-Zen baseline must include the completed normal TODO-open save');
  await enter(); assert.equal(await page.locator('#todo-widget').isVisible(), false); await exit();
  assert.equal(await page.locator('#todo-widget').isVisible(), true, 'an open TODO panel returns exactly as it was after Zen');
  assert.deepEqual(await read(protectedKeys), openTodoState, 'Zen never rewrites the panel-open preference or task data');
  await page.click('#todo-collapse-btn');
  assert.equal((await todoRowDiagnostics()).row.duration, '0s', 'closing the TODO panel retains the reduced-motion guard');
  await waitForTodoPanelSaved(false);
  for (const minimalMode of [false, true]) for (const todoButtonVisible of [false, true]) {
    await reset({ minimalMode, todoButtonVisible }); await fullscreen('unsupported');
    const before = await read(protectedKeys), scene = await view();
    assert.equal(await page.locator('#zen-toggle-btn').isVisible(), true, 'old TODO preference and minimal mode never hide Zen entry');
    await enter(); assert.equal(await page.locator('#todo-widget').isVisible(), false); await exit();
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('minimal-mode')), minimalMode);
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('hide-todo-entry')), !todoButtonVisible);
    assert.deepEqual(await read(protectedKeys), before); assert.deepEqual(await view(), scene);
    if (!minimalMode) {
      await page.click('[data-clock-card="2"]');
      assert.equal(await page.locator('#clock-todo-open').isVisible(), todoButtonVisible, 'old list-entry visibility remains respected');
    }
  }

  await page.setViewportSize({ width: 390, height: 760 }); await reset({ themeMode: 'light', languagePreference: 'zh-CN' }); await fullscreen('unsupported');
  const mobileBefore = await read(protectedKeys), mobileScene = await view();
  await enter();
  assert.equal(await page.locator('#zen-focus-toggle').getAttribute('aria-label'), '开始专注'); await assertPlainScreen();
  for (const selector of ['#zen-exit', '#zen-focus-toggle', ...[900000, 1500000, 3000000].map(duration => `#zen-presets [data-duration="${duration}"]`)]) {
    const box = await page.locator(selector).boundingBox(); assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390, 'mobile functional controls have unclipped touch targets');
  }
  await page.screenshot({ path: path.join(artifacts, 'zen-light-mobile-zh.png'), animations: 'disabled' });
  await page.click('#zen-focus-toggle'); await page.click('#zen-focus-toggle'); await assertPlainScreen();
  assert.equal(await page.locator('#zen-focus-toggle').innerText(), '继续专注');
  const resetBox = await page.locator('#zen-focus-reset').boundingBox(); assert.ok(resetBox.width >= 44 && resetBox.height >= 44 && resetBox.x >= 0 && resetBox.x + resetBox.width <= 390);
  await page.screenshot({ path: path.join(artifacts, 'zen-light-mobile-zh-paused.png'), animations: 'disabled' }); await exit();
  assert.deepEqual(await read(protectedKeys), mobileBefore); assert.deepEqual(await view(), mobileScene);
  // These compact sizes must expose the timer, presets and start action on
  // the very first viewport, not merely make them reachable after scrolling.
  for (const viewport of [{ width: 640, height: 360 }, { width: 320, height: 480 }]) {
    await page.setViewportSize(viewport); await reset({ themeMode: 'light', languagePreference: 'zh-CN' }); await fullscreen('unsupported'); await enter();
    const geometry = await page.evaluate(() => {
      const panel = document.getElementById('zen-mode');
      const selectors = ['.zen-dial', '#zen-time', '#zen-exit', '#zen-focus-toggle', ...[900000, 1500000, 3000000].map(duration => `#zen-presets [data-duration="${duration}"]`)];
      return { scrollTop: panel.scrollTop, horizontalOverflow: panel.scrollWidth - panel.clientWidth, fontSize: parseFloat(getComputedStyle(document.getElementById('zen-time')).fontSize),
        items: selectors.map(selector => {
          const el = document.querySelector(selector), rect = el.getBoundingClientRect();
          return { selector, button: el.tagName === 'BUTTON', x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
        }) };
    });
    assert.equal(geometry.scrollTop, 0, 'initial focus must not require automatic scrolling to discover the action');
    assert.ok(geometry.horizontalOverflow <= 1, 'compact Zen never creates horizontal scrolling');
    assert.ok(geometry.fontSize >= 64, 'compact countdown remains readable rather than shrinking to fit');
    for (const item of geometry.items) {
      assert.ok(item.width > 0 && item.height > 0 && item.x >= 0 && item.y >= 0 && item.right <= viewport.width + 1 && item.bottom <= viewport.height + 1,
        `${viewport.width}×${viewport.height}: initially visible ${JSON.stringify(item)}`);
      if (item.button) assert.ok(item.width >= 44 && item.height >= 44, 'compact controls retain 44px touch targets');
    }
    await page.screenshot({ path: path.join(artifacts, `zen-light-${viewport.width}x${viewport.height}-zh.png`), animations: 'disabled' });
    await page.click('#zen-focus-toggle'); await page.click('#zen-focus-toggle');
    const resetBox = await page.locator('#zen-focus-reset').boundingBox();
    assert.ok(resetBox.width >= 44 && resetBox.height >= 44 && resetBox.y >= 0 && resetBox.y + resetBox.height <= viewport.height + 1, 'secondary reset also remains visible after starting');
    await page.locator('#zen-focus-reset').focus(); await page.keyboard.press('Enter');
    assert.equal(await phase(), 'idle'); assert.equal(await focusId(), 'zen-focus-toggle');
    await exit();
  }
  await verifyWindowFullscreenShortcut({ context, worker, url, profile, root, artifacts });
  assert.deepEqual(errors, []); console.log('Zen mode native MV3 checks passed');
} finally {
  try { await context?.close(); }
  finally { fs.rmSync(profile, { recursive: true, force: true }); }
}
