import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { waitForAsync } from './wait-for-async.mjs';

const require = createRequire(import.meta.url);
const Schema = require('../scene-schema.js');
const HOME = 'folder-home';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const NARROW = [[320, 480], [360, 560], [390, 844], [640, 360], [760, 600]];
const DESKTOP = [[761, 600], [1024, 768], [1280, 900]];
const TARGETS = '#group-tabs-bar button, #icons-container .icon-widget, #add-shortcut-tile';

// Shared with offline counterexamples. Native callers supply real layout and
// elementFromPoint results; rectangle non-overlap alone is not pointer proof.
export function assertHomeControlsGeometry(report, label, inset = 0) {
  const { width, height, content, buttons } = report;
  const narrow = width <= 760, size = narrow ? 46 : 48, bottom = narrow ? 18 + inset : 28;
  const near = (actual, expected, description) => assert.ok(Math.abs(actual - expected) < 1,
    `${label}: ${description}: ${actual} != ${expected}`);
  near(content.height, narrow ? height - 76 - inset : height, 'real scroll viewport height');
  near(content.bottom, content.height, 'scroll viewport begins at top');
  near(content.paddingBottom, narrow ? 18 : 104, 'end padding');
  for (const [index, button] of buttons.entries()) {
    near(button.width, size, `${button.id} width`); near(button.height, size, `${button.id} height`);
    near(button.bottom, height - bottom, `${button.id} bottom`);
    near(button.right, width - (index === 0 ? narrow ? 82 : 92 : narrow ? 18 : 28), `${button.id} right`);
    assert.equal(button.hit, true, `${label}: ${button.id} center is intercepted by ${button.target}`);
    if (narrow) assert.ok(button.top - content.bottom >= 11, `${label}: fixed controls must clear the scroll clip`);
  }
  assert.equal(report.transparent, true, `${label}: no opaque footer or content backing is introduced`);
  assert.ok(report.scrollWidth <= width, `${label}: no horizontal page overflow`);
  if (narrow) {
    near(content.scrollPadding, 8, 'focus/scroll padding');
    for (const target of report.visibleTargets) assert.equal(target.hit, true,
      `${label}: visible ${target.id} center is intercepted by ${target.target}`);
  }
}

function fixture(themeMode, groups, count = 18) {
  const data = Schema.migrateLegacy({
    folders: Array.from({ length: groups }, (_, i) => ({ id: i ? `group-${i}` : HOME, name: i ? `分组 ${i}` : '主页' })),
    currentFolderId: HOME,
    icons: Array.from({ length: count }, (_, i) => ({ id: `viewport-${i}`, name: `网站 ${i + 1}`, type: 'shortcut',
      folderId: HOME, url: `https://example.test/${i}`, resolvedIconUrl: PIXEL, uploadedIconDataUrl: PIXEL })),
    todos: [], todoPanelOpen: false, todoButtonVisible: true, minimalMode: false,
    languagePreference: 'zh-CN', themeMode, timezoneMode: 'fixed', timezone: 'UTC',
    particlesEnabled: false, gradientFlow: false, weatherEnabled: false, browserSyncEnabled: false,
    background: { type: 'gradient', value: 'linear-gradient(135deg, #cbd5e1, #64748b)', source: 'gradient' },
    layoutIconSize: 56, layoutColumns: 0, layoutShowNames: true, layoutMaxWidth: 900,
    uiOpacity: 32, uiBlur: 10, searchEngine: 'google', customSearchEngines: [],
    searchSuggestionsEnabled: false, searchHistoryEnabled: true,
    searchHistory: Array.from({ length: 20 }, (_, i) => ({ q: `viewport history ${i}`, engine: 'google', at: 20 - i }))
  });
  Schema.validate(data); return data;
}

// Called only after the existing first-grid timing assertions. A separate
// temporary persistent profile prevents earlier settings fixtures, scene data,
// focus, storage listeners or user's real browser data from affecting this test.
export async function verifyHomeControlsViewport({ extensionPath, artifacts, headless }) {
  const context = await chromium.launchPersistentContext('', {
    headless, locale: 'zh-CN', viewport: { width: 360, height: 560 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [], reports = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => /^https?:/.test(route.request().url()) ? route.abort() : route.continue());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const url = `chrome-extension://${worker.url().split('/')[2]}/home.html`;
  const page = await context.newPage();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function reset(theme, groups, count) {
    await page.goto('about:blank');
    const data = fixture(theme, groups, count);
    await worker.evaluate(() => OpenTabWorkspace.read(['icons']));
    const stored = await worker.evaluate(value => OpenTabWorkspace.transaction(async ({ write, read }) => { await write(value); return read(Object.keys(value)); }), data);
    assert.deepEqual(stored, data, 'isolated fixture commits through the installer/workspace lock');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const ready = () => page.waitForFunction(({ themeMode, count, groups }) =>
      performance.getEntriesByName('opentab:initial-loader-end').length > 0
      && document.querySelector('#icons-container[data-grid-bound="1"]')
      && document.querySelectorAll('#icons-container .icon-widget[data-id]').length === count
      && document.querySelectorAll('#group-tabs .group-tab').length === groups
      && document.body.classList.contains('theme-light') === (themeMode === 'light')
      && document.getElementById('homepage').inert === false,
    { themeMode: theme, count: data.icons.length, groups });
    await ready();
    await page.evaluate(() => OpenTabWorkspace.read(['icons']));
    await ready(); await settle();
  }
  async function scroll(fraction) {
    await page.locator('#content').evaluate((el, fraction) => el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * fraction, behavior: 'instant' }), fraction);
    await page.mouse.move(1, 1); await settle();
  }
  async function snapshot() {
    return page.evaluate(targets => {
      const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const sample = el => {
        const box = rect(el), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { ...box, id: el.id || el.dataset.id || el.className, hit: el.contains(hit), target: hit?.closest('button, a')?.id || hit?.id || hit?.tagName };
      };
      const el = document.getElementById('content'), content = rect(el), style = getComputedStyle(el);
      const transparent = node => { const s = getComputedStyle(node); return s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.backgroundImage === 'none'; };
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        content: { ...content, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, paddingBottom: parseFloat(style.paddingBottom), scrollPadding: parseFloat(style.scrollPaddingTop) },
        buttons: ['refresh-bg-btn', 'settings-btn'].map(id => sample(document.getElementById(id))),
        transparent: transparent(el) && transparent(document.getElementById('homepage')),
        visibleTargets: [...document.querySelectorAll(targets)].filter(el => {
          const r = rect(el), s = getComputedStyle(el), y = r.top + r.height / 2;
          return r.width > 0 && r.height > 0 && s.visibility === 'visible' && !el.hidden && y >= content.top && y < content.bottom;
        }).map(sample) };
    }, TARGETS);
  }
  async function center(target, label) {
    const point = await target.evaluate(el => {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: el.contains(hit), target: hit?.id || hit?.tagName,
        inside: r.width > 0 && r.height > 0 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight };
    });
    assert.ok(point.inside && point.hit, `${label}: target center is not reachable: ${JSON.stringify(point)}`);
    return point;
  }
  async function pointer(target, label) {
    const p = await center(target, label); await page.mouse.click(p.x, p.y);
  }
  async function closeSettings() {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#settings-panel.hidden', { state: 'attached' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-btn', 'settings restores opener focus');
  }
  async function settingsAtPosition(label) {
    const before = await page.locator('#content').evaluate(el => el.scrollTop);
    await pointer(page.locator('#settings-btn'), `${label} pointer settings`);
    await page.waitForSelector('#settings-panel:not(.hidden)'); await closeSettings();
    // Native Tab and Enter/Space, not dispatchEvent or HTMLElement.click().
    for (const key of ['Enter', 'Space']) {
      await page.locator('#refresh-bg-btn').focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-btn', `${label}: native Tab reaches settings`);
      await page.keyboard.press(key); await page.waitForSelector('#settings-panel:not(.hidden)'); await closeSettings();
    }
    assert.equal(await page.locator('#content').evaluate(el => el.scrollTop), before, `${label}: settings preserves scroll position`);
    await page.mouse.move(1, 1); await settle();
  }
  async function focusedTarget(target, label) {
    await target.focus(); await settle(); await center(target, label);
    const bounds = await target.evaluate(el => {
      const r = el.getBoundingClientRect(), clip = document.getElementById('content').getBoundingClientRect();
      return { focused: document.activeElement === el, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        clip: { left: clip.left, right: clip.right, top: clip.top, bottom: clip.bottom } };
    });
    assert.equal(bounds.focused, true, `${label}: actual focus remains on the target`);
    assert.ok(bounds.left >= bounds.clip.left + 4 && bounds.right <= bounds.clip.right - 4
      && bounds.top >= bounds.clip.top + 4 && bounds.bottom <= bounds.clip.bottom - 4,
    `${label}: the complete focused target and 4px outline clear the scroll clip: ${JSON.stringify(bounds)}`);
  }
  async function groupAndLastTile(label) {
    const launch = page.locator('#group-launch-entry'); await focusedTarget(launch, `${label} focused group launch`);
    await page.keyboard.press('Space'); await page.waitForSelector('#group-launch-dialog[open]');
    await page.keyboard.press('Escape'); await page.waitForSelector('#group-launch-dialog:not([open])', { state: 'attached' });
    const select = page.locator('#select-sites'); await focusedTarget(select, `${label} focused selection`);
    await page.keyboard.press('Enter'); await page.waitForSelector('#site-selection-toolbar:not([hidden])');
    await page.keyboard.press('Escape'); await page.waitForSelector('#site-selection-toolbar[hidden]', { state: 'attached' });
    const add = page.locator('#add-shortcut-tile'); await focusedTarget(add, `${label} last tile`);
    await page.keyboard.press('Enter'); await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.keyboard.press('Escape'); await page.waitForSelector('#add-icon-modal.hidden', { state: 'attached' });
  }
  async function popovers(label) {
    const activeEngine = page.locator('#search-engine-panel .engine-btn.active');
    await activeEngine.focus(); await page.keyboard.press('End');
    const lastEngine = page.locator('#search-engine-panel .engine-btn').last();
    await settle(); await center(lastEngine, `${label} last engine`);
    assert.equal(await lastEngine.evaluate(el => document.activeElement === el), true, 'End reaches the last engine');
    const engine = await lastEngine.getAttribute('data-engine'); await page.keyboard.press('Enter');
    await page.waitForFunction(engine => OpenTabSearch.getState().searchEngine === engine
      && document.getElementById('search-engine-switch').dataset.expanded === 'false', engine);
    const timezone = page.locator('#timezone-btn'); await timezone.focus(); await page.keyboard.press('Enter');
    const lastZone = page.locator('#timezone-list button').last(); await lastZone.focus();
    await center(lastZone, `${label} last timezone`); const zone = await lastZone.getAttribute('data-tz');
    await page.keyboard.press('Enter'); await page.waitForSelector('#timezone-selector.hidden', { state: 'attached' });
    await waitForAsync(worker, async zone => (await chrome.storage.local.get('timezone')).timezone === zone, zone);
    const date = page.locator('#date'); await date.focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('#calendar-popover:not(.hidden) .flatpickr-day');
    const lastDay = page.locator('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay):not(.flatpickr-disabled)').last();
    await lastDay.scrollIntoViewIfNeeded(); const day = await lastDay.evaluate(el => el.dateObj.getTime());
    await pointer(lastDay, `${label} final calendar row`);
    assert.equal(await page.locator('#calendar-input').evaluate(el => el._flatpickr.selectedDates[0].getTime()), day, `${label}: final calendar day activates`);
    await page.keyboard.press('Escape'); await page.waitForSelector('#calendar-popover.hidden', { state: 'attached' });
    await page.locator('#search-input').fill(''); await page.locator('#search-input').focus();
    await page.waitForSelector('#search-history:not(.hidden) .search-history-item');
    const lastResult = page.locator('.search-history-item').last(); await lastResult.scrollIntoViewIfNeeded();
    await center(lastResult, `${label} last search result`);
    const query = await lastResult.getAttribute('data-q'), remove = page.locator('.search-history-delete').last();
    await remove.focus(); await center(remove, `${label} last search delete`); await page.keyboard.press('Enter');
    await waitForAsync(worker, async query => !(await chrome.storage.local.get('searchHistory')).searchHistory.some(item => item.q === query), query);
    await page.keyboard.press('Escape'); await page.waitForSelector('#search-history.hidden', { state: 'attached' });
  }
  try {
    await reset('dark', 1, 1);
    // Reproduce the CI screenshot's old full-height scroll clip. No target
    // repositioning, fake hit result, force click or event-handler replacement.
    const old = await page.addStyleTag({ content: 'body:not(.minimal-mode) #content { height: 100vh; height: 100dvh; padding-bottom: 96px; scroll-padding: 0; }' });
    await scroll(0); const negative = await snapshot();
    const covered = negative.visibleTargets.filter(target => !target.hit && ['group-launch-entry', 'select-sites', 'add-group-btn'].includes(target.id));
    assert.ok(covered.length > 0, `old 360×560 layout must reproduce the group/control hit collision: ${JSON.stringify(negative)}`);
    assert.ok(covered.some(target => ['refresh-bg-btn', 'settings-btn'].includes(target.target)), 'old row is intercepted by an actual floating control');
    await page.screenshot({ path: path.join(artifacts, 'home-controls-before-360x560.png'), animations: 'disabled' });
    await old.evaluate(el => el.remove()); await scroll(0);
    const fixed = await snapshot(); assertHomeControlsGeometry(fixed, '360×560 repaired negative-control fixture');
    await page.locator('#group-launch-entry').scrollIntoViewIfNeeded();
    await pointer(page.locator('#group-launch-entry'), 'repaired group launch');
    await page.waitForSelector('#group-launch-dialog[open]'); await page.keyboard.press('Escape');
    await page.waitForSelector('#group-launch-dialog:not([open])', { state: 'attached' });
    await page.screenshot({ path: path.join(artifacts, 'home-controls-after-360x560.png'), animations: 'disabled' });
    reports.push({ negative, fixed });

    for (const theme of ['light', 'dark']) for (const groups of [1, 6]) {
      await reset(theme, groups);
      for (const [width, height] of [...NARROW, ...DESKTOP]) {
        await page.setViewportSize({ width, height });
        const label = `${theme}/${groups} groups/${width}×${height}`;
        for (const [position, fraction] of [['top', 0], ['middle', .5], ['bottom', 1]]) {
          await scroll(fraction); const report = await snapshot();
          assertHomeControlsGeometry(report, `${label}/${position}`); reports.push({ label, position, ...report });
          if (groups === 6 && position === 'middle' && (width <= 760 || width === 1280)) {
            await page.screenshot({ path: path.join(artifacts, `home-controls-${theme}-${width}x${height}.png`), animations: 'disabled' });
          }
          if (width <= 760) await settingsAtPosition(`${label}/${position}`);
        }
        if (width <= 760) {
          await groupAndLastTile(label);
          if (groups === 6) await popovers(label);
          await scroll(1); assertHomeControlsGeometry(await snapshot(), `${label}/after actions`);
        }
      }
    }

    for (const theme of ['light', 'dark']) {
      await reset(theme, 6); await page.setViewportSize({ width: 360, height: 560 });
      // A simulated inset checks shared CSS wiring, not hardware safe-area emulation.
      await page.locator('#homepage').evaluate(el => el.style.setProperty('--home-controls-safe-area', '32px'));
      for (const fraction of [0, .5, 1]) {
        await scroll(fraction); const report = await snapshot();
        assertHomeControlsGeometry(report, `${theme}/simulated 32px inset`, 32);
        reports.push({ label: `${theme}/simulated 32px inset`, fraction, ...report });
        if (fraction === .5) await page.screenshot({ path: path.join(artifacts, `home-controls-${theme}-simulated-inset.png`), animations: 'disabled' });
      }
      await groupAndLastTile(`${theme}/simulated inset`);
      await page.locator('#homepage').evaluate(el => el.style.removeProperty('--home-controls-safe-area'));
      await scroll(1);
      for (let cycle = 0; cycle < 2; cycle++) {
        const before = await page.locator('#content').evaluate(el => el.scrollTop);
        await page.evaluate(() => {
          window.__viewportFullscreenSettled = !document.fullscreenEnabled;
          const settled = event => {
            if (event.type !== 'fullscreenerror' && document.fullscreenElement !== document.documentElement) return;
            window.__viewportFullscreenSettled = true;
            document.removeEventListener('fullscreenchange', settled);
            document.removeEventListener('fullscreenerror', settled);
          };
          if (!window.__viewportFullscreenSettled) {
            document.addEventListener('fullscreenchange', settled);
            document.addEventListener('fullscreenerror', settled);
          }
        });
        await page.locator('#zen-toggle-btn').focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => OpenTabZenMode.isActive() && document.getElementById('homepage').inert && window.__viewportFullscreenSettled);
        await page.locator('#zen-exit').focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => !OpenTabZenMode.isActive() && !document.fullscreenElement && !document.getElementById('homepage').inert);
        await page.setViewportSize({ width: 360, height: 560 }); await page.mouse.move(1, 1); await settle();
        assert.equal(await page.locator('#content').evaluate(el => el.scrollTop), before, 'Zen restores the existing scroll position');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'zen-toggle-btn', 'Zen restores its real opener');
        assertHomeControlsGeometry(await snapshot(), `${theme}/Zen restoration ${cycle}`);
      }
      await pointer(page.locator('#settings-btn'), 'minimal preference'); await page.waitForSelector('#settings-panel:not(.hidden)');
      await page.check('#minimal-mode-enabled'); await page.waitForSelector('body.minimal-mode'); await closeSettings();
      for (const [width, height] of [[360, 560], [640, 360], [761, 600]]) {
        await page.setViewportSize({ width, height }); await settle();
        const minimal = await page.locator('#content').evaluate(el => ({ height: el.getBoundingClientRect().height, padding: getComputedStyle(el).padding }));
        assert.equal(minimal.height, height, 'minimal mode retains its full-height layout'); assert.equal(minimal.padding, '0px', 'minimal mode retains zero padding');
        assert.equal(await page.locator('#refresh-bg-btn').isVisible(), false);
        await center(page.locator('#settings-btn'), 'minimal settings');
      }
      await page.setViewportSize({ width: 360, height: 560 }); await page.locator('#settings-btn').focus(); await page.keyboard.press('Space');
      await page.waitForSelector('#settings-panel:not(.hidden)'); await page.uncheck('#minimal-mode-enabled');
      await page.waitForSelector('body:not(.minimal-mode)'); await closeSettings(); await scroll(1);
      assertHomeControlsGeometry(await snapshot(), `${theme}/minimal restoration`);
    }
    assert.deepEqual(errors, [], 'responsive fixture has no page errors');
    console.log('Home controls: native old-layout hit-test counterexample; two themes, one/six groups, top/middle/bottom, 760/761 boundary, last popover actions, simulated inset and Settings/Zen/minimal restoration passed.');
  } finally {
    fs.writeFileSync(path.join(artifacts, 'home-controls-viewport.json'), JSON.stringify(reports, null, 2));
    await context.close();
  }
}
