import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { waitForAsync } from './wait-for-async.mjs';
const execute = promisify(execFile);

// Playwright 1.58.2 enables focus emulation on every main-frame session. A
// public CDP session can disable Blink's page-global focus override, but cannot
// release the original session's visible capturer (Chromium 145 EmulationHandler).
// Test real tab/focus transitions instead of claiming native hidden visibility;
// the visibility-only application path is covered by offline production units.
export async function createNativeFixtureFocus(context, page) {
  const session = await context.newCDPSession(page);
  let resets = 0;
  return {
    async afterNavigation() {
      await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
      resets++;
    },
    resetCount: () => resets,
    detach: () => session.detach()
  };
}

// Failure-only diagnostics are bounded and never replace the original error.
// This inspects only the disposable fixture page and its known target window.
export async function reportWindowFullscreenFailure({ page, worker, windowId, tabId, expectedCommands, artifacts, phase = 'unknown', focusResetCount = 0 }) {
  async function bounded(task) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Diagnostic timeout')), 2000);
      })]);
    } catch (_) { return { unavailable: true }; }
    finally { clearTimeout(timer); }
  }
  const observation = await bounded(() => worker.evaluate(async ({ windowId, tabId }) => {
    const log = globalThis.__windowFullscreenNative || {}, events = log.events || [], results = log.results || [];
    let windowState, tabState, binding;
    try {
      const window = await chrome.windows.get(windowId);
      windowState = { id: window.id, type: window.type, state: window.state, focused: window.focused };
    } catch (_) { windowState = { unavailable: true }; }
    try {
      const tab = await chrome.tabs.get(tabId);
      tabState = { id: tab.id, windowId: tab.windowId, active: tab.active };
    } catch (_) { tabState = { unavailable: true }; }
    try {
      const command = (await chrome.commands.getAll()).find(item => item.name === 'toggle-window-fullscreen');
      binding = { registered: !!command, shortcut: String(command?.shortcut || '').slice(0, 80) };
    } catch (_) { binding = { unavailable: true }; }
    return { eventCount: events.length, resultCount: results.length, windowState, tabState, binding,
      events: events.slice(-8).map(event => ({ name: String(event.name).slice(0, 80), windowId: event.windowId })),
      results: results.slice(-8).map(result => ({ success: result.success, reason: result.reason, windowId: result.windowId, state: result.state })) };
  }, { windowId, tabId }));
  const pageState = await bounded(() => page.evaluate(() => {
    const panel = document.getElementById('settings-panel'), binding = document.getElementById('window-fullscreen-shortcut-binding');
    const trace = globalThis.__windowFullscreenLifecycle;
    return { visible: document.visibilityState === 'visible', focused: document.hasFocus(),
      settingsOpen: !!panel && !panel.classList.contains('hidden'),
      bindingPresent: !!binding, bindingText: String(binding?.textContent || '').slice(0, 80),
      lifecycle: trace ? { counts: { focus: trace.counts.focus, blur: trace.counts.blur, visibilitychange: trace.counts.visibilitychange },
        events: trace.events.slice(-8).map(event => ({ type: event.type, visible: event.visible, focused: event.focused, trusted: event.trusted })) } : { unavailable: true } };
  }));
  const screenshot = await bounded(async () => {
    await page.screenshot({ path: path.join(artifacts, 'window-fullscreen-failure.png'), animations: 'disabled', timeout: 2000 });
    return { captured: true, file: 'window-fullscreen-failure.png' };
  });
  const diagnostics = { phase, expectedCommands, focusResetCount, visibilityMayRemainEmulated: true, observation, pageState, screenshot };
  console.error('Native browser fullscreen failure diagnostics: ' + JSON.stringify(diagnostics));
  return diagnostics;
}

// Runs only inside the existing disposable native MV3 suite/profile. Binding
// goes through Chrome's real shortcut UI, not developerPrivate, a synthetic
// command event, or a production test message. The wrapper only observes the
// actual handler's returned result and forwards every argument unchanged.
export async function verifyWindowFullscreenShortcut({ context, worker, url, profile, root, artifacts }) {
  const key = 'windowFullscreenShortcutEnabled', command = 'toggle-window-fullscreen';
  const page = await context.newPage(); let shortcuts;
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const trace = globalThis.__windowFullscreenLifecycle = { counts: { focus: 0, blur: 0, visibilitychange: 0 }, events: [] };
    const record = event => {
      trace.counts[event.type]++;
      trace.events.push({ type: event.type, visible: document.visibilityState === 'visible', focused: document.hasFocus(), trusted: event.isTrusted });
      if (trace.events.length > 8) trace.events.shift();
    };
    window.addEventListener('focus', record); window.addEventListener('blur', record);
    document.addEventListener('visibilitychange', record);
  });
  await worker.evaluate(async key => {
    await chrome.storage.local.remove(key);
    await chrome.storage.local.set({ languagePreference: 'en' });
    globalThis.__windowFullscreenNative = { events: [], results: [] };
    chrome.commands.onCommand.addListener((name, tab) => {
      __windowFullscreenNative.events.push({ name, windowId: tab?.windowId });
    });
    const toggle = windowFullscreen.toggle;
    windowFullscreen.toggle = (...args) => {
      const pending = toggle(...args);
      pending.then(result => __windowFullscreenNative.results.push(result));
      return pending;
    };
  }, key);
  await page.goto(url);
  await page.waitForFunction(() => globalThis.OpenTabSettingsNav && performance.getEntriesByName('opentab:grid-ready').length);
  const initial = await page.evaluate(() => chrome.windows.getCurrent());
  assert.equal(initial.type, 'normal');
  const tabId = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  assert.ok(Number.isInteger(tabId) && tabId >= 0, 'fixture has a real Chrome tab identity');
  const preservedKeys = ['icons', 'folders', 'todos', 'scenes', 'sceneProfiles'];
  const before = await worker.evaluate(keys => chrome.storage.local.get(keys), preservedKeys);
  const binding = () => worker.evaluate(async command => (await chrome.commands.getAll()).find(item => item.name === command), command);
  const windowState = () => worker.evaluate(id => chrome.windows.get(id).then(window => window.state), initial.id);
  const waitState = state => waitForAsync(worker, async ({ id, state }) => (await chrome.windows.get(id)).state === state, { id: initial.id, state });
  const waitTabActive = active => waitForAsync(worker, async ({ tabId, windowId, active }) => {
    const tab = await chrome.tabs.get(tabId);
    return tab.windowId === windowId && tab.active === active;
  }, { tabId, windowId: initial.id, active });
  const combo = 'Control+Shift+Y';
  const nativeTitle = `OpenTab fullscreen native ${randomUUID()}`;
  let commands = 0, failure = null, nativeFocus, phase = 'disable-focus-emulation';
  async function press(expectedState, enabled) {
    phase = 'native-key-emission';
    await page.bringToFront();
    await page.evaluate(title => { document.title = title; }, nativeTitle);
    // CDP keyboard events bypass Chrome's browser accelerator routing. Use
    // genuine X-server input only after native focus/title/PID/profile checks.
    // This call is never retried: failure after partial emission is uncertain.
    const native = await execute('python3', ['-B', fileURLToPath(new URL('./window-fullscreen-key.py', import.meta.url)),
      '--title', nativeTitle, '--profile', profile, '--extension-root', root], { timeout: 10000, killSignal: 'SIGTERM' });
    const evidence = JSON.parse(native.stdout);
    assert.ok(Number.isInteger(evidence.xid) && evidence.xid > 1 && Number.isInteger(evidence.pid) && evidence.pid > 0,
      'native keys have positively identified focused test-browser evidence');
    commands++;
    phase = 'native-command-result';
    await waitForAsync(worker, count => __windowFullscreenNative.events.length === count && __windowFullscreenNative.results.length === count, commands);
    const observed = await worker.evaluate(() => ({ event: __windowFullscreenNative.events.at(-1), result: __windowFullscreenNative.results.at(-1) }));
    assert.equal(observed.event.name, command, 'trusted browser key dispatch reaches the registered Chrome command');
    if (enabled) {
      assert.deepEqual(observed.result, { success: true, windowId: initial.id, state: expectedState });
      await waitState(expectedState);
    } else {
      assert.deepEqual(observed.result, { success: false, reason: 'disabled' });
      assert.equal(await windowState(), expectedState, 'disabled command dispatch leaves the native window unchanged');
    }
  }
  try {
    nativeFocus = await createNativeFixtureFocus(context, page);
    await nativeFocus.afterNavigation();
    phase = 'unbound-settings';
    await waitTabActive(true);
    await page.waitForFunction(() => document.hasFocus());
    assert.equal((await binding()).shortcut, '', 'a fresh profile has a real registered but unassigned Chrome command');
    await page.click('#settings-btn'); await page.fill('#settings-search', 'fullscreen');
    assert.equal(await page.locator('#window-fullscreen-shortcut-enabled').isChecked(), false);
    assert.equal(await page.locator('#window-fullscreen-shortcut-binding').innerText(), 'Not set');
    await page.screenshot({ path: path.join(artifacts, 'window-fullscreen-settings-unbound.png'), animations: 'disabled' });
    phase = 'chrome-shortcut-binding';
    const blurBefore = await page.evaluate(() => __windowFullscreenLifecycle.counts.blur);
    const opening = context.waitForEvent('page');
    await page.click('#manage-window-fullscreen-shortcut'); shortcuts = await opening;
    await shortcuts.waitForURL('chrome://extensions/shortcuts');
    await waitTabActive(false);
    await page.waitForFunction(count => !document.hasFocus() && __windowFullscreenLifecycle.counts.blur > count &&
      __windowFullscreenLifecycle.events.findLast(event => event.type === 'blur')?.trusted === true, blurBefore);
    const extensionId = worker.url().split('/')[2];
    // Both supported Chrome UI generations are selected through normal DOM
    // controls. Playwright pierces their open shadow roots for a real click/key.
    const scope = shortcuts.locator(`select[data-extension-id="${extensionId}"][data-command-name="${command}"]`);
    const entry = shortcuts.locator('.command-entry').filter({ has: scope });
    const input = entry.locator('cr-shortcut-input, extensions-shortcut-input');
    await input.locator('#edit').click();
    await shortcuts.keyboard.press(combo);
    await waitForAsync(worker, async command => !!(await chrome.commands.getAll()).find(item => item.name === command)?.shortcut, command);
    const assigned = (await binding()).shortcut;
    assert.ok(assigned, 'the browser, not the test, reports the registered binding');
    assert.equal(await scope.inputValue(), 'CHROME', 'binding stays scoped to Chrome, not OS-global');
    await shortcuts.screenshot({ path: path.join(artifacts, 'window-fullscreen-chrome-binding.png'), animations: 'disabled' });
    phase = 'return-binding-label';
    const focusBefore = await page.evaluate(() => __windowFullscreenLifecycle.counts.focus);
    // No emulation reset at this boundary: only the real tab return may focus
    // the page and trigger production settings refresh.
    await page.bringToFront();
    await waitTabActive(true);
    await page.waitForFunction(count => document.hasFocus() && __windowFullscreenLifecycle.counts.focus > count &&
      __windowFullscreenLifecycle.events.findLast(event => event.type === 'focus')?.trusted === true, focusBefore);
    await page.waitForFunction(shortcut => document.getElementById('window-fullscreen-shortcut-binding').textContent === shortcut, assigned);
    await press(initial.state, false);
    phase = 'durable-opt-in';
    await page.check('#window-fullscreen-shortcut-enabled');
    await waitForAsync(worker, async key => (await chrome.storage.local.get(key))[key] === true, key);
    await page.reload(); await nativeFocus.afterNavigation();
    await page.waitForFunction(() => globalThis.OpenTabSettingsNav && performance.getEntriesByName('opentab:grid-ready').length);
    await page.click('#settings-btn'); await page.fill('#settings-search', 'fullscreen');
    assert.equal(await page.locator('#window-fullscreen-shortcut-enabled').isChecked(), true, 'explicit opt-in survives page reload');
    assert.equal(await page.locator('#window-fullscreen-shortcut-binding').innerText(), assigned);
    await page.screenshot({ path: path.join(artifacts, 'window-fullscreen-settings-enabled.png'), animations: 'disabled' });
    await page.click('#close-settings');
    for (const state of ['normal', 'maximized']) {
      phase = 'prepare-window-state';
      await worker.evaluate(({ id, state }) => chrome.windows.update(id, { state }), { id: initial.id, state }); await waitState(state);
      await press('fullscreen', true);
      assert.equal(await page.evaluate(() => document.fullscreenElement), null, 'browser-window fullscreen does not enter DOM Zen fullscreen');
      await press(state, true);
    }
    // A chrome:// page exercises the same browser command without page injection.
    await page.goto('chrome://settings/'); await nativeFocus.afterNavigation();
    await press('fullscreen', true); await press('maximized', true);
    await page.goto(url); await nativeFocus.afterNavigation();
    await page.waitForFunction(() => globalThis.OpenTabSettingsNav && performance.getEntriesByName('opentab:grid-ready').length);
    phase = 'disable-shortcut';
    await page.click('#settings-btn'); await page.fill('#settings-search', 'fullscreen');
    await page.uncheck('#window-fullscreen-shortcut-enabled');
    await waitForAsync(worker, async key => (await chrome.storage.local.get(key))[key] === false, key);
    await press('maximized', false);
    assert.equal((await binding()).shortcut, assigned, 'disabling does not pretend to unregister a Chrome-managed binding');
    assert.deepEqual(await worker.evaluate(keys => chrome.storage.local.get(keys), preservedKeys), before, 'native shortcut actions preserve scene and user-content fixtures');
    console.log('Native browser fullscreen: real Chrome tab/focus return, binding/command dispatch, default off, durable opt-in, normal/maximized restore and chrome:// targeting passed; visibility-only refresh is unit-covered (Playwright capture remains)');
  } catch (error) {
    failure = error;
    try { await reportWindowFullscreenFailure({ page, worker, windowId: initial.id, tabId, expectedCommands: commands, artifacts, phase, focusResetCount: nativeFocus?.resetCount() || 0 }); }
    catch (_) { console.error('Native fullscreen failure diagnostics unavailable; the original error is preserved.'); }
    throw error;
  } finally {
    const cleanupErrors = [];
    try {
      await worker.evaluate(async ({ key, id, state }) => {
        await chrome.storage.local.set({ [key]: false });
        await chrome.windows.update(id, { state });
      }, { key, id: initial.id, state: initial.state });
    } catch (error) { cleanupErrors.push(error); }
    if (nativeFocus) {
      try { await nativeFocus.detach(); } catch (error) { cleanupErrors.push(error); }
    }
    for (const target of [shortcuts, page].filter(Boolean)) {
      try { await target.close(); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      console.error(`Native fullscreen fixture cleanup failures: ${cleanupErrors.length}; primary failure preserved: ${Boolean(failure)}`);
      if (!failure) throw cleanupErrors[0];
    }
  }
}
