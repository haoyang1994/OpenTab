import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';
import { verifyClockStackPixels } from './clock-stack.mjs';

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
  await page.waitForFunction(text => document.getElementById('clock-todo-text').textContent === text, data.todos.find(todo => !todo.done)?.text || (data.languagePreference === 'en' ? 'No unfinished tasks' : '暂无未完成待办'));
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
  await page.locator('#clock-deck-nav [aria-pressed="true"]').focus();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.clock-deck-card[data-active="false"]'))), false, 'native Tab cannot enter an inactive card');
  }
}
async function bounds() {
  return page.locator('#clock-deck-stage').evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
}
async function navigationGeometry(activeIndex, label) {
  const geometry = await page.locator('#clock-deck-nav').evaluate(nav => {
    const center = element => { const rect = element.getBoundingClientRect(); return rect.left + rect.width / 2; };
    const buttons = [...nav.querySelectorAll('button')];
    return {
      text: nav.textContent.trim(), icons: nav.querySelectorAll('svg, img, i').length,
      extraContent: [nav, ...nav.querySelectorAll('*')].some(element => ['::before', '::after'].some(pseudo => !['none', 'normal', '""', "''"].includes(getComputedStyle(element, pseudo).content))),
      center: center(nav), stageCenter: center(document.getElementById('clock-deck-stage')),
      indicators: buttons.map(button => {
        const span = button.querySelector('span'), rect = span?.getBoundingClientRect(), style = span && getComputedStyle(span);
        return { active: button.getAttribute('aria-pressed'), label: button.getAttribute('aria-label'), children: button.children.length,
          width: rect?.width, height: rect?.height, center: span && center(span), buttonCenter: center(button),
          radii: style && [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius],
          visible: Boolean(style && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0) };
      })
    };
  });
  assert.equal(geometry.indicators.length, 3, `${label}: only three navigation dots`);
  assert.equal(geometry.text, '', `${label}: no visible instructional labels or text arrows`);
  assert.equal(geometry.icons, 0, `${label}: no graphical arrows`);
  assert.equal(geometry.extraContent, false, `${label}: pseudo-elements do not reintroduce arrows or labels`);
  assert.ok(Math.abs(geometry.center - geometry.stageCenter) <= 1, `${label}: navigation is centered beneath the card`);
  for (const [index, indicator] of geometry.indicators.entries()) {
    const detail = `${label}: dot ${index}: ${JSON.stringify(indicator)}`;
    assert.equal(indicator.active, String(index === activeIndex), detail);
    assert.ok(indicator.label, `${detail}: accessible card label remains`);
    assert.equal(indicator.children, 1, detail);
    assert.equal(indicator.visible, true, detail);
    assert.ok(indicator.width > 0 && Math.abs(indicator.width - indicator.height) < 0.1, `${detail}: active and inactive dots are circular, not dashes`);
    assert.ok(Math.abs(indicator.width - geometry.indicators[0].width) < 0.1, `${detail}: all dots have the same diameter`);
    assert.ok(indicator.radii.every(radius => radius.endsWith('%') ? parseFloat(radius) >= 50 : parseFloat(radius) >= indicator.width / 2), `${detail}: every corner is round`);
    assert.ok(Math.abs(indicator.center - indicator.buttonCenter) <= 0.5, `${detail}: dot is centered in its target`);
  }
  assert.ok(Math.abs((geometry.indicators[0].center + geometry.indicators[2].center) / 2 - geometry.center) <= 1, `${label}: the three-dot group is centered inside navigation`);
}
async function zenEntryClearance(expectedText, label) {
  const geometry = await page.locator('#timezone-label').evaluate(timezone => {
    const entry = document.getElementById('zen-toggle-btn'), rect = timezone.getBoundingClientRect(), entryRect = entry.getBoundingClientRect();
    const serialize = value => ({ left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height });
    const hit = (x, y) => { const target = document.elementFromPoint(x, y); return { x, y, timezone: timezone.contains(target), target: target?.id || target?.tagName || null }; };
    const range = document.createRange(); range.selectNodeContents(timezone);
    // Sample both the box center and the visible text itself. The first letters
    // can be covered by the corner button even when the label center is clear.
    const textHits = [...range.getClientRects()].flatMap(text => {
      const left = Math.max(rect.left, text.left), right = Math.min(rect.right, text.right);
      const top = Math.max(rect.top, text.top), bottom = Math.min(rect.bottom, text.bottom);
      if (right <= left || bottom <= top) return [];
      const inset = Math.min(1, (right - left) / 4), y = (top + bottom) / 2;
      return [hit(left + inset, y), hit((left + right) / 2, y), hit(right - inset, y)];
    });
    return { text: timezone.textContent, timezone: serialize(rect), entry: serialize(entryRect),
      visible: getComputedStyle(timezone).visibility === 'visible' && Number(getComputedStyle(timezone).opacity) > 0,
      centerHit: hit(rect.left + rect.width / 2, rect.top + rect.height / 2), textHits,
      entryHit: entry.contains(document.elementFromPoint(entryRect.left + entryRect.width / 2, entryRect.top + entryRect.height / 2)),
      minimal: document.body.classList.contains('minimal-mode'),
      contentBottom: document.getElementById('content').getBoundingClientRect().bottom,
      viewport: { width: innerWidth, height: innerHeight } };
  });
  const detail = `${label}: ${JSON.stringify(geometry)}`, { timezone, entry, viewport } = geometry;
  assert.equal(geometry.text, expectedText, `${detail}: resizing preserves timezone content`);
  assert.ok(geometry.text.trim() && geometry.visible && timezone.width > 0 && timezone.height > 0, `${detail}: timezone text remains visible`);
  assert.equal(entry.width, 44, `${detail}: Zen retains its target width`);
  assert.equal(entry.height, 44, `${detail}: Zen retains its target height`);
  assert.ok(entry.left >= 0 && entry.left <= 24, `${detail}: Zen retains its left-edge placement`);
  if (viewport.width <= 760 && !geometry.minimal) {
    assert.ok(Math.abs(entry.bottom - (viewport.height - 18)) < 1 && entry.top >= geometry.contentBottom + 12,
      `${detail}: narrow Zen clears the scrolling content in the existing bottom control lane`);
  } else {
    assert.ok(entry.top >= 0 && entry.top <= 24, `${detail}: desktop and minimal Zen retain the top-left entry`);
  }
  assert.ok(timezone.left >= 0 && timezone.right <= viewport.width && timezone.top >= 0 && timezone.bottom <= viewport.height, `${detail}: timezone is inside the viewport`);
  assert.equal(entry.left < timezone.right && entry.right > timezone.left && entry.top < timezone.bottom && entry.bottom > timezone.top, false, `${detail}: Zen and timezone rectangles never intersect`);
  if (entry.top < timezone.bottom && entry.bottom > timezone.top) {
    assert.ok(timezone.left - entry.right >= 4, `${detail}: timezone also clears the Zen entry's 2px focus outline plus 2px offset`);
  }
  assert.equal(geometry.centerHit.timezone, true, `${detail}: timezone center wins its hit test`);
  assert.ok(geometry.textHits.length > 0 && geometry.textHits.every(hit => hit.timezone), `${detail}: visible timezone text wins every hit test`);
  assert.equal(geometry.entryHit, true, `${detail}: Zen entry remains directly reachable`);
}
try {
  await reset(); assert.equal(await card(), '0');
  assert.equal(await page.locator('#clock-deck-nav button').count(), 3, 'only the three card dots remain');
  assert.deepEqual(await page.locator('#clock-deck-nav button').allTextContents(), ['', '', ''], 'card navigation has no visible instructional labels');
  for (let index = 0; index < 3; index++) {
    assert.ok(await page.locator(dot(index)).getAttribute('aria-label'), 'each dot retains its accessible card name');
    assert.equal(await page.locator(dot(index)).getAttribute('aria-controls'), ['clock-widget', 'clock-focus-card', 'clock-todo-card'][index]);
  }
  const initial = await bounds(), searchTop = await page.locator('#search-widget-wrap').evaluate(el => el.getBoundingClientRect().top);
  for (let index = 0; index < 3; index++) {
    await select(index); assert.deepEqual(await bounds(), initial, 'all cards reserve the same frame');
    await navigationGeometry(index, `desktop card ${index}`);
    assert.equal(await page.locator('#search-widget-wrap').evaluate(el => el.getBoundingClientRect().top), searchTop, 'card switch never shifts search');
    await noInactiveFocus();
    const surface = await page.locator('.clock-deck-card[data-active="true"]').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter }));
    assert.match(surface.bg, /^rgba\(/, 'clock uses the chosen translucent glass surface');
    assert.match(surface.blur, /^blur\(\d+(?:\.\d+)?px\)$/, 'clock consumes the user blur setting');
    await page.locator('#clock-deck').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, `clock-deck-${index}-light-en.png`), animations: 'disabled' });
  }
  await select(0);
  const timezoneText = await page.locator('#timezone-label').textContent();
  // Reuse the loaded fixture: responsive geometry needs no additional reloads,
  // screenshots or fixed sleeps, including the narrow and short viewports.
  for (const viewport of [
    { width: 320, height: 480 }, { width: 360, height: 640 }, { width: 390, height: 760 },
    { width: 640, height: 480 }, { width: 760, height: 600 }, { width: 1280, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const origin = { left: 0, top: 0, behavior: 'instant' };
      document.getElementById('content').scrollTo(origin); window.scrollTo(origin);
    });
    await navigationGeometry(0, `${viewport.width}x${viewport.height}`);
    await zenEntryClearance(timezoneText, `${viewport.width}x${viewport.height}`);
  }
  await select(0); await page.click('#clock-deck-peek', { position: { x: 180, y: 12 } }); assert.equal(await card(), '1', 'real exposed lower edge is clickable');
  await page.locator('#clock-deck-nav [aria-pressed="true"]').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await card(), '2');
  assert.equal(await page.locator(dot(2)).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('ArrowRight'); assert.equal(await card(), '0', 'right arrow wraps to the first dot');
  await page.keyboard.press('ArrowLeft'); assert.equal(await card(), '2', 'left arrow wraps to the last dot');
  await page.keyboard.press('Home'); assert.equal(await card(), '0');
  await page.keyboard.press('End'); assert.equal(await card(), '2');
  await page.keyboard.press('Home'); assert.equal(await card(), '0');
  assert.equal(await page.locator(dot(0)).evaluate(el => el === document.activeElement), true);
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
  const previousStyle = await page.locator('#time').getAttribute('style');
  try {
    const selected = await page.evaluate(() => {
      const text = document.getElementById('time');
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
      const text = document.getElementById('time');
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

  for (const languagePreference of ['en', 'zh-CN']) {
    await reset({ languagePreference, todos: [] }); await select(2);
    assert.equal(await page.locator('#clock-todo-complete').isVisible(), false, 'empty task cards cannot complete a nonexistent task');
    assert.equal(await page.locator('#clock-todo-count').textContent(), '', 'empty task cards contain no secondary description');
    assert.equal(await page.locator('#clock-todo-open').isVisible(), true, 'the real task-list entry remains reachable when empty');
  }

  await reset(); await select(2);
  assert.notEqual(await page.locator('#clock-todo-open').evaluate(el => getComputedStyle(el).position), 'fixed', 'the task-list entry belongs to its card, not the floating corner');
  await page.click('#clock-todo-open'); await page.waitForSelector('#todo-widget:not(.hidden)');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'todo-input');
  await page.click('#todo-collapse-btn');
  await page.evaluate(() => OpenTabLayout.setTodoButtonVisible(false));
  await page.waitForFunction(() => document.getElementById('clock-todo-open').hidden);
  assert.equal(await page.locator('#todo-toggle-btn').count(), 0, 'the floating to-do entry has been removed');
  assert.equal(await page.locator('#zen-toggle-btn').isVisible(), true, 'to-do visibility never hides Zen');
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
      await navigationGeometry(index, `${label} card ${index}`);
      if (index === 0) await zenEntryClearance(await page.locator('#timezone-label').textContent(), `${label} clock`);
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
  await page.setViewportSize({ width: 1280, height: 900 });
  await reset({ languagePreference: 'zh-CN' });
  await verifyClockStackPixels(page, artifacts, select);
  assert.deepEqual(errors, []); console.log('clock deck native MV3 checks passed');
} finally { await context.close(); }
