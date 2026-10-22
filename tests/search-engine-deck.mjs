import assert from 'node:assert/strict';
import { waitForAsync } from './wait-for-async.mjs';

export async function chooseSearchEngine(page, id) {
  const trigger = page.locator('#search-engine-trigger');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  // Compare data values in the DOM instead of interpolating custom IDs into CSS.
  const choice = page.locator('#search-engine-panel .engine-btn');
  const index = await choice.evaluateAll((buttons, target) => buttons.findIndex((button) => button.dataset.engine === target), id);
  assert.ok(index >= 0, `engine ${id} must have a real option`);
  await choice.nth(index).click();
}

export async function verifyEngineDeck(page, serviceWorker, screenshot = async () => {}) {
  const trigger = page.locator('#search-engine-trigger');
  const panel = page.locator('#search-engine-panel');
  const input = page.locator('#search-input');
  const choices = page.locator('#search-engine-panel .engine-btn');
  const state = () => page.evaluate(() => OpenTabSearch.getState());
  const activeId = () => page.evaluate(() => document.activeElement?.dataset.engine || document.activeElement?.id);
  const navCount = () => page.evaluate(() => window.__navLog.length);
  const waitClosed = () => page.waitForFunction(() => {
    const trigger = document.getElementById('search-engine-trigger');
    const panel = document.getElementById('search-engine-panel');
    return trigger.getAttribute('aria-expanded') === 'false' && panel.inert && panel.getAttribute('aria-hidden') === 'true';
  });
  const waitOpen = () => page.waitForFunction(() => {
    const panel = document.getElementById('search-engine-panel');
    return !panel.inert && panel.getAttribute('aria-hidden') === 'false' && getComputedStyle(panel).opacity === '1';
  });
  async function reload(expected) {
    await waitForAsync(page, async (id) => (await chrome.storage.local.get('searchEngine')).searchEngine === id, expected);
    const saved = await serviceWorker.evaluate(() => chrome.storage.local.get('searchEngine'));
    assert.equal(saved.searchEngine, expected, 'reload only after the chosen engine is durably stored');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((id) => window.OpenTabEngineDeck && window.OpenTabSearch &&
      OpenTabSearch.getState().searchEngine === id && document.getElementById('search-engine-trigger').dataset.engine === id, expected);
    await page.evaluate(() => {
      window.__navLog = [];
      OpenTabSearch.navigateHook = (url, openInNewTab) => window.__navLog.push({ url, openInNewTab });
    });
  }
  async function hitChoice(index) {
    await choices.nth(index).scrollIntoViewIfNeeded();
    const hit = await choices.nth(index).evaluate((button) => {
      const b = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
    });
    assert.equal(hit, true, 'actual engine option must win the hit test above group tabs');
  }
  async function assertFloatingControlsClear() {
    const controls = await panel.evaluate((el) => {
      const card = el.getBoundingClientRect();
      return Array.from(document.querySelectorAll('.floating-btn')).filter((button) => button.getClientRects().length).map((button) => {
        const rect = button.getBoundingClientRect();
        return { id: button.id,
          overlaps: rect.left < card.right && rect.right > card.left && rect.top < card.bottom && rect.bottom > card.top,
          reachable: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
      });
    });
    for (const control of controls) {
      assert.equal(control.overlaps, false, `${control.id} must not cover any part of the card`);
      assert.equal(control.reachable, true, `${control.id} remains reachable outside the card`);
    }
  }
  async function clickVisibleChoice(slot) {
    // Recompute after every scroll/open. Sample corners as well as center:
    // a top-left floating button can overlap an option without covering center.
    const target = await panel.evaluate((el, position) => {
      const card = el.getBoundingClientRect();
      const visible = Array.from(el.querySelectorAll('.engine-btn')).map((button, index) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        const radius = Math.max(...['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
          .map((property) => parseFloat(style[property]) || 0));
        // Intersect the inscribed rounded-rect interior with the scroll clip.
        // Half-visible rows are sampled only where actual button content exists.
        const left = Math.max(rect.left + radius + 2, card.left + el.clientLeft + 2);
        const right = Math.min(rect.right - radius - 2, card.left + el.clientLeft + el.clientWidth - 2);
        const top = Math.max(rect.top + radius + 2, card.top + el.clientTop + 2);
        const bottom = Math.min(rect.bottom - radius - 2, card.top + el.clientTop + el.clientHeight - 2);
        if (right - left < 4 || bottom - top < 4) return null;
        const points = [[left + 1, top + 1], [right - 1, top + 1],
          [(left + right) / 2, (top + bottom) / 2], [left + 1, bottom - 1], [right - 1, bottom - 1]];
        return { index, id: button.dataset.engine,
          hits: points.map(([x, y]) => button.contains(document.elementFromPoint(x, y))),
          position: { x: points[0][0] - rect.left, y: points[0][1] - rect.top } };
      }).filter(Boolean);
      return visible[position === 'first' ? 0 : position === 'middle' ? Math.floor(visible.length / 2) : visible.length - 1];
    }, slot);
    assert.ok(target, `a ${slot} visible option exists`);
    assert.equal(target.hits.every(Boolean), true, `${slot} visible engine wins corner and center hit tests`);
    const count = await navCount();
    await choices.nth(target.index).click({ position: target.position });
    await waitClosed();
    assert.equal((await state()).searchEngine, target.id, `${slot} visible engine responds to native pointer click`);
    assert.equal(await navCount(), count, 'visible option activation only changes the engine');
    assert.equal(await page.locator('#search-widget-wrap').evaluate((el) => getComputedStyle(el).zIndex), '6', 'closing restores the original search layer');
  }
  await page.evaluate(() => {
    OpenTabSearch.replaceSettings({ ...OpenTabSearch.getState(), searchEngine: 'google', searchHistoryEnabled: false, customSearchEngines: [] });
    window.__navLog = [];
    OpenTabSearch.navigateHook = (url, openInNewTab) => window.__navLog.push({ url, openInNewTab });
  });
  await waitClosed();
  assert.equal(await choices.count(), 5);
  assert.equal(await trigger.getAttribute('data-engine'), 'google', 'production controller initializes the selected top card');
  assert.equal(await choices.locator('.engine-option-name').count(), 5, 'actual options have readable native labels');
  await input.fill('query stays exactly here');
  await input.evaluate((el) => el.setSelectionRange(2, 9, 'backward'));
  const originalWidth = await input.evaluate((el) => el.getBoundingClientRect().width);
  const startCount = await navCount();
  await trigger.click(); await waitOpen();
  assert.equal(await input.evaluate((el) => el.getBoundingClientRect().width), originalWidth, 'opening the floating picker cannot squeeze the input');
  assert.equal(await page.locator('#search-widget-wrap').evaluate((el) => getComputedStyle(el).zIndex), '1265');
  await hitChoice(4);
  await choices.nth(4).click();
  await waitClosed();
  assert.equal((await state()).searchEngine, 'github');
  assert.equal(await trigger.getAttribute('data-engine'), 'github');
  assert.equal(await choices.nth(4).getAttribute('aria-pressed'), 'true');
  assert.equal(await input.inputValue(), 'query stays exactly here');
  assert.deepEqual(await input.evaluate((el) => [el.selectionStart, el.selectionEnd, el.selectionDirection]), [2, 9, 'backward']);
  assert.equal(await activeId(), 'search-input');
  assert.equal(await navCount(), startCount, 'choosing an engine must never navigate or submit');
  await reload('github');

  // Use native keyboard events, including default button Enter/Space actions.
  await trigger.focus(); await page.keyboard.press('Space'); await waitOpen();
  assert.equal(await activeId(), 'github');
  for (const [key, id] of [['Home', 'google'], ['ArrowLeft', 'github'], ['ArrowRight', 'google'], ['ArrowDown', 'bing'], ['End', 'github'], ['ArrowUp', 'duckduckgo']]) {
    await page.keyboard.press(key); assert.equal(await activeId(), id, `${key} moves native option focus`);
  }
  await page.keyboard.press('Enter'); await waitClosed();
  assert.equal((await state()).searchEngine, 'duckduckgo');
  await trigger.focus(); await page.keyboard.press('ArrowDown'); await waitOpen();
  assert.equal(await activeId(), 'duckduckgo');
  await page.keyboard.press('Home'); await page.keyboard.press('Space'); await waitClosed();
  assert.equal((await state()).searchEngine, 'google', 'native Space activates an option once');
  await trigger.focus(); await page.keyboard.press('Enter'); await waitOpen();
  await page.keyboard.press('Escape'); await waitClosed();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search-engine-trigger');
  await page.keyboard.press('Tab');
  assert.equal(await activeId(), 'search-input', 'closed options are absent from native Tab order');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search-engine-trigger');
  await page.keyboard.press('ArrowUp'); await waitOpen();
  await page.keyboard.press('Tab'); await waitClosed();
  assert.equal(await activeId(), 'search-input', 'Tab leaves an expanded picker without a focus trap');
  await trigger.click(); await waitOpen();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search-engine-trigger');
  await page.keyboard.press('Shift+Tab'); await waitClosed();
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'search-engine-trigger', 'Shift+Tab can leave the complete widget');
  await trigger.click(); await input.click(); await waitClosed();
  assert.equal(await activeId(), 'search-input', 'outside pointer close never steals new focus');
  await input.fill('unchanged');
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal((await state()).searchEngine, 'bing');
  assert.equal(await trigger.getAttribute('data-engine'), 'bing', 'Alt+Down updates the top card without opening it');
  await page.keyboard.press('Alt+ArrowUp'); assert.equal((await state()).searchEngine, 'google');
  assert.equal(await input.inputValue(), 'unchanged');
  await trigger.focus();
  for (const key of ['Control+ArrowDown', 'Meta+ArrowUp', 'Alt+ArrowDown', 'Shift+ArrowDown']) {
    await page.keyboard.press(key); await waitClosed();
  }
  const ignored = await trigger.evaluate((el) => {
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { prevented: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, isComposing: extra.isComposing });
      if (extra.keyCode) Object.defineProperty(event, 'keyCode', { get: () => extra.keyCode });
      if (extra.prevented) event.preventDefault();
      el.dispatchEvent(event);
      if (el.getAttribute('aria-expanded') !== 'false') return false;
    }
    return true;
  });
  assert.equal(ignored, true, 'IME/defaultPrevented arrow keys cannot open the deck');
  assert.equal(await navCount(), 0, 'keyboard/pointer picker interactions never trigger navigation');

  // The real custom-engine settings UI, including literal untrusted labels.
  await page.click('#settings-btn');
  await page.locator('#search-settings-section').scrollIntoViewIfNeeded();
  await page.fill('#search-custom-name', '<img src=x>');
  await page.fill('#search-custom-template', 'https://example.com/find?q=%s');
  await page.click('#search-custom-save');
  const customId = (await state()).customSearchEngines[0].id;
  await page.click('#close-settings');
  await trigger.click(); await waitOpen();
  assert.equal(await choices.count(), 6);
  assert.equal(await choices.nth(5).locator('.engine-option-name').textContent(), '<img src=x>');
  assert.equal(await choices.nth(5).locator('img').count(), 0);
  await hitChoice(5); await choices.nth(5).click(); await waitClosed();
  assert.equal((await state()).searchEngine, customId, 'real dynamically added custom option selects through native click');
  assert.equal(await trigger.getAttribute('data-engine'), customId);
  const orderedIds = await choices.evaluateAll((nodes) => nodes.map((node) => node.dataset.engine));
  assert.deepEqual(orderedIds, ['google', 'bing', 'baidu', 'duckduckgo', 'github', customId], 'selection cannot reorder stored or displayed engines');
  await reload(customId);
  await page.click('#settings-btn'); await page.locator('#search-custom-list').scrollIntoViewIfNeeded();
  await page.locator('#search-custom-list .search-custom-actions button').nth(1).click();
  assert.equal((await state()).searchEngine, 'google', 'deleting the selected custom engine normalizes to Google');
  assert.equal(await trigger.getAttribute('data-engine'), 'google');
  await page.click('#close-settings');
  await trigger.click(); await waitOpen(); assert.equal(await choices.count(), 5);
  await page.keyboard.press('Escape'); await waitClosed();

  // Native rapid reversals and touch taps exercise real pointer hit testing.
  const triggerBox = await trigger.boundingBox(); assert.ok(triggerBox);
  for (let index = 0; index < 6; index++) {
    await page.mouse.click(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    assert.equal(await trigger.getAttribute('aria-expanded'), index % 2 === 0 ? 'true' : 'false');
  }
  await waitClosed();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('search-engine-panel')).visibility === 'hidden');
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  try {
    const tap = async (locator) => {
      const box = await locator.boundingBox(); assert.ok(box);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await tap(trigger); await waitOpen(); await tap(choices.nth(1)); await waitClosed();
    assert.equal((await state()).searchEngine, 'bing', 'touch selects the real second engine');
  } finally { await session.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await session.detach(); }

  const originalViewport = page.viewportSize();
  const originalTheme = await page.evaluate(() => document.body.classList.contains('theme-light'));
  const manyCustom = Array.from({ length: 12 }, (_, i) => ({ id: `deck-${i}`, name: `Custom engine ${i}`, template: `https://example.com/${i}?q=%s` }));
  await page.evaluate((engines) => OpenTabSearch.replaceSettings({ ...OpenTabSearch.getState(), customSearchEngines: engines }), manyCustom);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((light) => document.body.classList.toggle('theme-light', light), theme === 'light');
    for (const viewport of [{ width: 1024, height: 768 }, { width: 360, height: 560 }, { width: 640, height: 360 }]) {
      await page.setViewportSize(viewport);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click(); await waitOpen();
      assert.equal(await choices.count(), 17);
      const box = await panel.boundingBox(); assert.ok(box);
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, 'card stays inside narrow viewport');
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, 'card stays inside short viewport');
      await assertFloatingControlsClear();
      const labels = await choices.locator('.engine-option-name').evaluateAll((nodes) => nodes.map((label) => ({
        text: label.textContent, whitespace: getComputedStyle(label).whiteSpace,
        clipped: label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight
      })));
      for (let index = 0; index < manyCustom.length; index++) {
        assert.equal(labels[index + 5].text, manyCustom[index].name);
        assert.equal(labels[index + 5].whitespace, 'normal', 'touch labels wrap to expose distinguishing suffixes');
        assert.equal(labels[index + 5].clipped, false, 'custom engine label is fully laid out, not ellipsized or clamped');
      }
      for (const slot of ['first', 'middle', 'last']) {
        await page.keyboard.press('End');
        assert.equal(await activeId(), 'deck-11');
        await assertFloatingControlsClear();
        await clickVisibleChoice(slot);
        await trigger.click(); await waitOpen();
      }
      await page.keyboard.press('End');
      await assertFloatingControlsClear();
      await hitChoice(16);
      const surface = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.match(surface, /^rgb\(/, 'dense option grid has an opaque surface in both themes');
      await screenshot(page, `engine_deck_${theme}_${viewport.width}x${viewport.height}.png`);
      await page.keyboard.press('Escape'); await waitClosed();
    }
  }
  await page.setViewportSize(originalViewport);
  await page.evaluate((light) => document.body.classList.toggle('theme-light', light), originalTheme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click(); await waitOpen();
  assert.equal(await panel.evaluate((el) => getComputedStyle(el).transitionDuration), '0s', 'reduced motion eliminates open/close animation');
  await page.keyboard.press('Escape'); await waitClosed();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await trigger.click(); await waitOpen();
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#command-palette:not(.hidden)'); await waitClosed();
  assert.equal(await panel.evaluate((el) => el.inert), true, 'command palette focus dismisses the lower-layer deck');
  await page.keyboard.press('Escape');
  await trigger.click(); await waitOpen();
  await page.evaluate(() => document.body.classList.add('minimal-mode')); await waitClosed();
  assert.equal(await trigger.isVisible(), false, 'minimal mode keeps the search deck hidden');
  await page.evaluate(() => document.body.classList.remove('minimal-mode'));
  await waitClosed();
  await page.evaluate(() => OpenTabSearch.replaceSettings({ ...OpenTabSearch.getState(), searchEngine: 'google', customSearchEngines: [] }));
  assert.equal(await navCount(), 0, 'all engine operations are selection only, never navigation');
  console.log('Search-engine deck E2E passed: native keys, pointer/touch, caret, persisted custom engines, layers, narrow/short viewports and reduced motion.');
}
