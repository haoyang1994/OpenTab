import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';

// Native MV3 fixture, not a file:// mock. Run only where Chromium is supported.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const fixture = {
  icons: [{ id: 'docs', name: 'Docs', type: 'shortcut', url: 'https://docs.example.test/', folderId: 'folder-home' }],
  folders: [{ id: 'folder-home', name: 'Home' }], currentFolderId: 'folder-home',
  todos: [{ id: 'first', text: 'Make room for one useful thing', done: false }, { id: 'second', text: 'A second real task', done: false }], todoPanelOpen: false,
  background: { type: 'gradient', value: 'linear-gradient(135deg, #dce8f8, #f8fafc)', source: 'gradient' },
  weatherEnabled: false, particlesEnabled: false, minimalMode: false, themeMode: 'light', languagePreference: 'en',
  searchHistoryEnabled: false, searchHistory: [], searchEngine: 'google', todoButtonVisible: true
};
const context = await chromium.launchPersistentContext('', {
  headless: process.env.HEADLESS === 'true', locale: 'en-US', viewport: { width: 1280, height: 900 }, hasTouch: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', route => /^https?:/.test(route.request().url()) ? route.abort() : route.continue());
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const url = `chrome-extension://${worker.url().split('/')[2]}/home.html`;
const page = await context.newPage(), cdp = await context.newCDPSession(page);
const card = async () => page.locator('#clock-deck').getAttribute('data-card');
const dot = index => `[data-clock-card="${index}"]`;
const read = keys => worker.evaluate(keys => chrome.storage.local.get(keys), keys);
async function store(value) {
  const result = await worker.evaluate(value => OpenTabWorkspace.transaction(async ({ read, write }) => { await write(value); return read(Object.keys(value)); }), value);
  assert.deepEqual(result, value, 'seed under the real workspace lock, never race extension installation');
}
async function ready(language = 'en') {
  await page.waitForFunction(language => document.documentElement.lang === language && OpenTabClockDeck && document.getElementById('time').textContent && performance.getEntriesByName('opentab:grid-ready').length, language);
}
async function reset(extra = {}) {
  const data = { ...fixture, ...extra }; await store(data); await page.goto(url);
  await page.evaluate(() => sessionStorage.removeItem('opentab.focus.v1')); await page.reload(); await ready(data.languagePreference);
  await page.waitForFunction(({ themeMode, todoButtonVisible }) => document.body.classList.contains('theme-light') === (themeMode === 'light') && OpenTabLayout.get().todoButtonVisible === todoButtonVisible && document.body.classList.contains('hide-todo-entry') === !todoButtonVisible, data);
  await page.waitForFunction(text => document.getElementById('clock-todo-text').textContent === text, data.todos.find(todo => !todo.done)?.text || (data.languagePreference === 'en' ? 'No unfinished tasks. A little breathing room is good.' : '暂时没有未完成待办，留一点空白也很好。'));
}
async function select(index) {
  await page.click(dot(index)); assert.equal(await card(), String(index));
  await page.waitForFunction(() => { const panel = document.querySelector('.clock-deck-card[data-active="true"]'); const style = getComputedStyle(panel); return style.opacity === '1' && style.transform === 'none'; });
}
async function swipe(selector, dx = -90, dy = 0) {
  const box = await page.locator(selector).boundingBox(); assert.ok(box);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 5, y: y + dy * i / 5, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function noInactiveFocus() {
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.clock-deck-card')].every(panel => panel.inert === (panel.dataset.active !== 'true'))), true);
  await page.locator('#clock-deck-next').focus();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.clock-deck-card[data-active="false"]'))), false, 'native Tab cannot enter an inactive card');
  }
}
async function bounds() {
  return page.locator('#clock-deck-stage').evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
}
try {
  await reset(); assert.equal(await card(), '0');
  const initial = await bounds(), searchTop = await page.locator('#search-widget-wrap').evaluate(el => el.getBoundingClientRect().top);
  for (let index = 0; index < 3; index++) {
    await select(index); assert.deepEqual(await bounds(), initial, 'all cards reserve the same frame');
    assert.equal(await page.locator('#search-widget-wrap').evaluate(el => el.getBoundingClientRect().top), searchTop, 'card switch never shifts search');
    await noInactiveFocus();
    const surface = await page.locator('.clock-deck-card[data-active="true"]').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter }));
    assert.match(surface.bg, /^rgb\(/); assert.equal(surface.blur, 'none', 'solid slate surface');
    await page.locator('#clock-deck').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, `clock-deck-${index}-light-en.png`), animations: 'disabled' });
  }
  await select(0); await page.click('#clock-deck-peek', { position: { x: 180, y: 12 } }); assert.equal(await card(), '1', 'real exposed lower edge is clickable');
  await page.locator('#clock-deck-next').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await card(), '2');
  await page.keyboard.press('Home'); assert.equal(await card(), '0');
  await page.locator('#search-input').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await card(), '0', 'typing/search keys are not carousel shortcuts');
  await page.click('#timezone-btn'); assert.equal(await card(), '0');
  await page.waitForSelector('#timezone-selector:not(.hidden)');
  await select(1); assert.equal(await page.locator('#timezone-btn').getAttribute('aria-expanded'), 'false');
  await select(0); await page.click('#date'); await page.waitForSelector('#calendar-popover:not(.hidden)');
  await page.locator('.flatpickr-day.today').click(); assert.equal(await card(), '0', 'calendar day remains a calendar interaction');
  assert.equal(await page.locator('#calendar-popover').evaluate(el => { const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + 80; return el.contains(document.elementFromPoint(x, y)); }), true, 'calendar is above search and group controls');
  await swipe('#time'); assert.equal(await card(), '1'); assert.equal(await page.locator('#calendar-popover').isVisible(), false, 'reachable clock swipe closes the calendar without clicking through its overlay');
  await page.locator('#clock-focus-toggle').dblclick(); assert.equal(await page.locator('body').evaluate(el => el.classList.contains('minimal-mode')), false, 'secondary controls never toggle minimal mode');
  await select(0); await page.locator('#time').dblclick();
  await waitForAsync(page, async () => (await chrome.storage.local.get('minimalMode')).minimalMode === true);
  assert.equal(await card(), '0'); assert.equal(await page.locator('#clock-deck-nav').isVisible(), false);
  await page.locator('#time').dblclick();
  await waitForAsync(page, async () => (await chrome.storage.local.get('minimalMode')).minimalMode === false);
  assert.equal(await card(), '0', 'double-click keeps clock identity on returning from minimal');
  await swipe('#time'); assert.equal(await card(), '1', 'native horizontal touch advances');
  await swipe('#clock-focus-time', 90); assert.equal(await card(), '0', 'native opposite swipe goes back');
  await swipe('#time', -20, 0); assert.equal(await card(), '0', 'short swipe is ignored');
  await swipe('#time', -15, 70); assert.equal(await card(), '0', 'vertical page pan is ignored');
  await page.locator('#clock-deck').scrollIntoViewIfNeeded();
  // The shell deliberately disables selection. Make this real text selectable
  // for the guard fixture, and prove the browser actually has a nonempty range.
  const previousStyle = await page.locator('#welcome-text').getAttribute('style');
  try {
    const selected = await page.evaluate(() => {
      const text = document.getElementById('welcome-text');
      text.style.userSelect = 'text';
      const range = document.createRange(); range.selectNodeContents(text);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return String(selection);
    });
    assert.ok(selected.trim().length > 0, 'selection veto requires an actual browser text selection');
    // Synthetic pointer delivery preserves the selection; native touch can
    // clear it before pointerdown. Native swipe behavior is tested above.
    await page.locator('#time').dispatchEvent('pointerdown', { pointerId: 2, isPrimary: true, button: 0, clientX: 200, clientY: 100 });
    await page.locator('#time').dispatchEvent('pointerup', { pointerId: 2, isPrimary: true, button: 0, clientX: 100, clientY: 100 });
    assert.equal(await card(), '0');
  } finally {
    await page.evaluate((style) => {
      getSelection().removeAllRanges();
      const text = document.getElementById('welcome-text');
      if (style === null) text.removeAttribute('style'); else text.setAttribute('style', style);
    }, previousStyle);
  }

  await reset(); await select(1); await page.click('#clock-focus-toggle');
  const running = await page.evaluate(() => JSON.parse(sessionStorage.getItem('opentab.focus.v1')));
  assert.equal(running.phase, 'running'); await select(2); await page.reload(); await ready();
  assert.equal(await card(), '0'); await select(1);
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('opentab.focus.v1')).deadline), running.deadline, 'reload preserves deadline exactly');
  assert.equal(await page.locator('#clock-focus-toggle').innerText(), 'Pause');
  await page.click('#clock-focus-toggle'); const paused = await page.evaluate(() => JSON.parse(sessionStorage.getItem('opentab.focus.v1')));
  assert.equal(paused.phase, 'paused'); await page.reload(); await ready(); await select(1);
  assert.equal(await page.locator('#clock-focus-toggle').innerText(), 'Resume focus');
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('opentab.focus.v1')).remaining), paused.remaining);
  await page.click('#clock-focus-reset'); assert.equal(await page.locator('#clock-focus-time').innerText(), '25:00');
  assert.equal(await page.locator('#clock-focus-reset').isDisabled(), true);
  await page.evaluate(() => sessionStorage.setItem('opentab.focus.v1', JSON.stringify({ version: 1, phase: 'running', remaining: 1500000, deadline: Date.now() - 1 })));
  await page.reload(); await ready(); await select(1);
  assert.equal(await page.locator('#clock-focus-time').innerText(), '00:00'); assert.equal(await page.locator('#clock-focus-toggle').innerText(), 'Focus again');
  const fresh = await context.newPage(); await fresh.goto(url); await fresh.waitForFunction(() => OpenTabClockDeck && document.getElementById('time').textContent);
  assert.equal(await fresh.locator('#clock-focus-time').textContent(), '25:00', 'a new tab does not inherit another tab timer'); await fresh.close();

  await reset(); await select(2); await page.click('#clock-todo-open'); await page.waitForSelector('#todo-widget:not(.hidden)');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'todo-input');
  await page.click('#todo-collapse-btn');
  await page.evaluate(() => OpenTabLayout.setTodoButtonVisible(false));
  await page.waitForFunction(() => document.getElementById('clock-todo-open').hidden);
  assert.equal(await page.locator('#todo-toggle-btn').isVisible(), false);
  await page.click('#clock-todo-complete');
  await waitForAsync(page, async () => (await chrome.storage.local.get('todos')).todos.find(todo => todo.id === 'first').done === true);
  assert.equal(await page.locator('#clock-todo-text').innerText(), fixture.todos[1].text);
  assert.equal(await page.locator('#clock-todo-open').isVisible(), false, 'completion never reveals hidden TODO entry');
  await page.reload(); await ready(); await select(2); assert.equal(await page.locator('#clock-todo-text').innerText(), fixture.todos[1].text);

  await reset(); await select(2);
  await worker.evaluate(() => OpenTabWorkspace.transaction(async ({ read, write }) => { const data = await read(); data.todos[0].text = 'Renamed in another tab'; await write({ todos: data.todos }); }));
  await page.click('#clock-todo-complete');
  await page.waitForFunction(() => document.getElementById('clock-todo-status').textContent.includes("Couldn't save"));
  assert.equal((await read(['todos'])).todos[0].done, false); assert.equal(await page.locator('#clock-todo-text').innerText(), 'Renamed in another tab');
  await page.click('#clock-todo-complete');
  await waitForAsync(page, async () => (await chrome.storage.local.get('todos')).todos[0].done === true);
  await reset(); await select(2);
  await page.evaluate(() => { const original = chrome.storage.local.set; chrome.storage.local.set = (...args) => { chrome.storage.local.set = original; throw new Error('Simulated clock-card write failure'); }; });
  await page.click('#clock-todo-complete'); await page.waitForFunction(() => document.getElementById('clock-todo-status').textContent.includes("Couldn't save"));
  assert.equal((await read(['todos'])).todos[0].done, false); assert.equal(await page.locator('#clock-todo-text').innerText(), fixture.todos[0].text);
  await page.click('#clock-todo-complete'); await waitForAsync(page, async () => (await chrome.storage.local.get('todos')).todos[0].done === true);

  for (const [label, viewport, themeMode, languagePreference] of [
    ['mobile-zh', { width: 390, height: 760 }, 'light', 'zh-CN'],
    ['short-en', { width: 1024, height: 600 }, 'light', 'en'],
    ['dark-en', { width: 1280, height: 900 }, 'dark', 'en']
  ]) {
    await page.setViewportSize(viewport); await reset({ themeMode, languagePreference, todos: [{ id: 'long', text: '<unsafe> ' + 'A genuinely long task with many details '.repeat(12), done: false }] });
    let frame;
    for (let index = 0; index < 3; index++) {
      await select(index); const current = await bounds(); frame ||= current; assert.deepEqual(current, frame);
      assert.ok(current.x >= 0 && current.x + current.width <= viewport.width, 'narrow screens have no horizontal clipping');
      assert.equal(await page.locator('#clock-todo-text img').count(), 0);
      await page.locator('#clock-deck').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, `clock-deck-${label}-${index}.png`), animations: 'disabled' });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#clock-todo-card').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await select(0); await page.click('#date');
    assert.equal(await page.locator('#calendar-popover').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), true, 'calendar remains within narrow viewport');
  }
  assert.deepEqual(errors, []); console.log('clock deck native MV3 checks passed');
} finally { await context.close(); }
