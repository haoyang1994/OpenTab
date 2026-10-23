import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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
const context = await chromium.launchPersistentContext('', {
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
  const log = window.__zenNativeEvents = { escape: [], fullscreen: [] };
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
async function enter() {
  await page.click('#zen-toggle-btn'); await page.waitForSelector('#zen-mode:not([hidden])');
  assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), true);
  assert.equal(await focusId(), 'zen-focus-toggle');
  assert.equal(await page.locator('#zen-toggle-btn').getAttribute('aria-expanded'), 'true');
}
async function exit() {
  await page.click('#zen-exit'); await page.waitForSelector('#zen-mode[hidden]', { state: 'attached' });
  assert.equal(await page.evaluate(() => OpenTabZenMode.isActive()), false);
  assert.equal(await page.locator('#zen-toggle-btn').getAttribute('aria-expanded'), 'false');
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
  assert.equal(await page.locator('#zen-mode button').count(), 3, 'only exit, focus toggle and reset controls');
  assert.deepEqual((await page.locator('#zen-mode button').allTextContents()).map(text => text.trim()), ['', '', ''], 'buttons contain icons, not visible instructional copy');
  assert.equal(await page.locator('#zen-mode h1, #zen-mode h2, #zen-mode h3, #zen-mode progress, #zen-mode [role="progressbar"], #zen-mode circle, #zen-mode img, #zen-mode canvas').count(), 0, 'no heading, ring, progress or wallpaper decoration');
  for (const id of ['zen-exit', 'zen-focus-toggle', 'zen-focus-reset']) assert.ok(await page.locator(`#${id}`).getAttribute('aria-label'), 'icon-only controls retain accessible names');
  assert.equal(await page.locator('#zen-time').getAttribute('role'), 'timer');
  assert.equal(await page.locator('#zen-time').getAttribute('aria-live'), 'off', 'countdown is not announced every second');
  const appearance = await page.locator('#zen-mode').evaluate(panel => {
    const style = getComputedStyle(panel), timer = document.getElementById('zen-time'), timeRect = timer.getBoundingClientRect();
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT), visible = [];
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent.trim() || text.parentElement.closest('.sr-only')) continue;
      const style = getComputedStyle(text.parentElement);
      if (style.display !== 'none' && style.visibility !== 'hidden') visible.push(text.textContent.trim());
    }
    return { background: style.backgroundColor, body: getComputedStyle(document.body).backgroundColor, image: style.backgroundImage,
      backdrop: style.backdropFilter, fontSize: parseFloat(getComputedStyle(timer).fontSize), visible,
      within: timeRect.left >= 0 && timeRect.right <= innerWidth && timeRect.top >= 0 && timeRect.bottom <= innerHeight,
      isolated: [...document.body.children].filter(node => node !== panel && node.tagName !== 'SCRIPT').every(node => node.inert && getComputedStyle(node).visibility === 'hidden') };
  });
  assert.equal(appearance.background, appearance.body, 'plain screen follows the current light/dark theme');
  assert.match(appearance.background, /^rgb\(/, 'background is fully opaque'); assert.equal(appearance.image, 'none'); assert.equal(appearance.backdrop, 'none');
  assert.ok(appearance.fontSize >= 70, 'large, legible countdown'); assert.equal(appearance.within, true);
  assert.deepEqual(appearance.visible, [await page.locator('#zen-time').innerText()], 'countdown is the only visible text');
  assert.equal(appearance.isolated, true, 'underlying wallpaper, controls and content are hidden and inert');
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

try {
  // Exercise real native entry and real native Escape, separately in both themes.
  for (const themeMode of ['light', 'dark']) {
    await reset({ themeMode }); await fullscreen();
    assert.equal(await page.locator('#todo-toggle-btn').count(), 0, 'the old floating TODO entry is removed');
    const entry = await page.locator('#zen-toggle-btn').boundingBox(); assert.ok(entry.x < 40 && entry.y < 40, 'Zen is the upper-left entry');
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
    await exit();
    assert.equal(await page.locator('#search-input').inputValue(), 'keep this query');
    assert.deepEqual(await page.locator('#search-input').evaluate(input => [input.selectionStart, input.selectionEnd, input.selectionDirection]), [5, 9, 'backward']);
    assert.equal(await focusId(), 'zen-toggle-btn'); assert.deepEqual(await view(), scene); assert.deepEqual(await read(protectedKeys), before);
    assert.equal(await page.locator('#homepage').evaluate(home => home.inert), false);
  }

  // The real deck and Zen use one timer, in both directions, without restarting.
  await reset(); await fullscreen('unsupported'); await page.click('[data-clock-card="1"]'); await page.click('#clock-focus-toggle');
  await page.waitForFunction(() => document.getElementById('clock-focus-time').textContent !== '25:00');
  const deadline = await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().deadline);
  await enter(); assert.equal(await phase(), 'running');
  await page.screenshot({ path: path.join(artifacts, 'zen-light-running.png'), animations: 'disabled' });
  assert.equal(await page.evaluate(() => OpenTabClockDeck.getFocus().snapshot().deadline), deadline, 'Zen reuses the running deck deadline');
  await page.click('#zen-focus-toggle'); assert.equal(await phase(), 'paused');
  assert.equal(await page.locator('#zen-focus-toggle').getAttribute('aria-label'), 'Resume focus');
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

  await reset({}, { version: 1, phase: 'running', remaining: 1500000, deadline: 1 }); await fullscreen('unsupported'); await enter();
  assert.equal(await page.locator('#zen-time').innerText(), '00:00'); assert.equal(await phase(), 'done');
  assert.equal(await page.locator('#zen-focus-toggle').getAttribute('aria-label'), 'Focus again');
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
  await page.click('#clock-todo-open'); await page.waitForSelector('#todo-widget:not(.hidden)');
  assert.equal(await focusId(), 'todo-input'); assert.equal((await page.locator('#todo-list').innerText()).includes('Read one chapter'), true);
  const openTodoState = await read(protectedKeys);
  await enter(); assert.equal(await page.locator('#todo-widget').isVisible(), false); await exit();
  assert.equal(await page.locator('#todo-widget').isVisible(), true, 'an open TODO panel returns exactly as it was after Zen');
  assert.deepEqual(await read(protectedKeys), openTodoState, 'Zen never rewrites the panel-open preference or task data');
  await page.click('#todo-collapse-btn');
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

  await page.setViewportSize({ width: 390, height: 760 }); await reset({ themeMode: 'light', languagePreference: 'zh-CN' }); await fullscreen('unsupported'); await enter();
  assert.equal(await page.locator('#zen-focus-toggle').getAttribute('aria-label'), '开始专注'); await assertPlainScreen();
  for (const selector of ['#zen-exit', '#zen-focus-toggle', '#zen-focus-reset']) {
    const box = await page.locator(selector).boundingBox(); assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390, 'mobile icon controls have unclipped touch targets');
  }
  await page.screenshot({ path: path.join(artifacts, 'zen-light-mobile-zh.png'), animations: 'disabled' }); await exit();
  assert.deepEqual(errors, []); console.log('Zen mode native MV3 checks passed');
} finally { await context.close(); }
