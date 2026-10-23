import assert from 'node:assert/strict';
import { waitForAsync } from './wait-for-async.mjs';

async function settleDeck(page) {
  await page.locator('#search-engine-switch').evaluate(async (host) => {
    await Promise.all(host.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
    await new Promise(requestAnimationFrame);
  });
}

export async function chooseSearchEngine(page, id) {
  const host = page.locator('#search-engine-switch');
  if (await host.getAttribute('data-expanded') !== 'true') await page.locator('#search-engine-panel .engine-btn.active').click();
  await settleDeck(page);
  // Compare data values instead of interpolating custom IDs into selectors.
  const choices = page.locator('#search-engine-panel .engine-btn');
  const index = await choices.evaluateAll((buttons, target) => buttons.findIndex((button) => button.dataset.engine === target), id);
  assert.ok(index >= 0, `engine ${id} must have a real option`);
  await choices.nth(index).click();
  await settleDeck(page);
}

export async function verifyEngineDeck(page, serviceWorker, screenshot = async () => {}) {
  const host = page.locator('#search-engine-switch');
  const selected = page.locator('#search-engine-panel .engine-btn.active');
  const panel = page.locator('#search-engine-panel');
  const input = page.locator('#search-input');
  const choices = page.locator('#search-engine-panel .engine-btn');
  const state = () => page.evaluate(() => OpenTabSearch.getState());
  const activeId = () => page.evaluate(() => document.activeElement?.dataset.engine || document.activeElement?.id);
  const navCount = () => page.evaluate(() => window.__navLog.length);
  async function waitClosed() {
    await page.waitForFunction(() => {
      const host = document.getElementById('search-engine-switch');
      const buttons = Array.from(host.querySelectorAll('.engine-btn'));
      return host.dataset.expanded === 'false' && buttons.filter((button) => !button.inert).length === 1 &&
        buttons.find((button) => button.classList.contains('active'))?.getAttribute('aria-expanded') === 'false';
    });
    await settleDeck(page);
  }
  async function waitOpen() {
    await page.waitForFunction(() => document.getElementById('search-engine-switch').dataset.expanded === 'true' &&
      Array.from(document.querySelectorAll('#search-engine-panel .engine-btn')).every((button) => !button.inert));
    await settleDeck(page);
  }
  async function reload(expected) {
    await waitForAsync(page, async (id) => (await chrome.storage.local.get('searchEngine')).searchEngine === id, expected);
    const saved = await serviceWorker.evaluate(() => chrome.storage.local.get('searchEngine'));
    assert.equal(saved.searchEngine, expected, 'reload only after the chosen engine is durably stored');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((id) => window.OpenTabEngineDeck && window.OpenTabSearch &&
      OpenTabSearch.getState().searchEngine === id && document.getElementById('search-engine-switch').dataset.engine === id, expected);
    await page.evaluate(() => {
      window.__navLog = [];
      OpenTabSearch.navigateHook = (url, openInNewTab) => window.__navLog.push({ url, openInNewTab });
    });
  }
  async function hitChoice(index) {
    await choices.nth(index).scrollIntoViewIfNeeded();
    const hit = await choices.nth(index).evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    assert.equal(hit, true, 'the original engine button wins its native hit test');
  }
  async function assertHorizontalGeometry(before) {
    const geometry = await host.evaluate((host) => {
      const rail = document.getElementById('search-engine-panel');
      const input = document.getElementById('search-input').getBoundingClientRect();
      const rect = host.getBoundingClientRect();
      return { x: rect.x, y: rect.y, height: rect.height, right: rect.right, inputWidth: input.width,
        railHeight: rail.getBoundingClientRect().height, scrollable: rail.scrollWidth > rail.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        buttons: Array.from(rail.querySelectorAll('.engine-btn')).map((button) => {
          const box = button.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
        }) };
    });
    if (before) {
      assert.ok(Math.abs(geometry.x - before.x) < 1, 'inline expansion keeps the original left anchor');
      assert.ok(Math.abs(geometry.y - before.y) < 1, 'inline expansion never becomes a popup above/below');
      assert.equal(geometry.height, before.height, 'expansion never adds another row');
    }
    assert.equal(geometry.railHeight, 44);
    assert.ok(geometry.inputWidth >= 80, 'the query retains usable space at 360px');
    assert.equal(geometry.pageOverflow, false, 'the engine rail must not overflow the page');
    assert.ok(geometry.right <= page.viewportSize().width, 'the rail stays within the viewport');
    geometry.buttons.forEach((button, index) => {
      assert.equal(button.y, geometry.buttons[0].y, 'all original icons remain on one row');
      assert.equal(button.height, 40);
      assert.equal(button.width, 40);
      if (index) assert.ok(Math.abs(button.x - geometry.buttons[index - 1].x - 44) < 1, 'original icons unfold horizontally without overlap');
    });
    return geometry;
  }
  async function captureIdentity() {
    await choices.evaluateAll((buttons) => { window.__engineNodes = buttons.map((button) => ({ button, children: [...button.childNodes] })); });
  }
  async function assertIdentity() {
    assert.equal(await choices.evaluateAll((buttons) => window.__engineNodes.every((original, index) =>
      original.button === buttons[index] && original.children.length === buttons[index].childNodes.length &&
      original.children.every((child, offset) => child === buttons[index].childNodes[offset]))), true,
    'the original buttons and SVG/initial nodes survive expansion, selection and collapse');
    assert.equal(await page.locator('#search-engine-trigger, .engine-option-name, .engine-deck-panel').count(), 0, 'no replacement icon, second panel or text captions');
  }
  async function clickVisibleChoice(slot) {
    const target = await panel.evaluate((rail, position) => {
      const clip = rail.getBoundingClientRect();
      const visible = [...rail.querySelectorAll('.engine-btn')].map((button, index) => {
        const rect = button.getBoundingClientRect();
        if (rect.left < clip.left || rect.right > clip.right) return null;
        const points = [[rect.left + 16, rect.top + 16], [rect.right - 16, rect.bottom - 16], [rect.left + 20, rect.top + 20]];
        return { index, id: button.dataset.engine, hits: points.map(([x, y]) => button.contains(document.elementFromPoint(x, y))) };
      }).filter(Boolean);
      return visible[position === 'first' ? 0 : position === 'middle' ? Math.floor(visible.length / 2) : visible.length - 1];
    }, slot);
    assert.ok(target, `a complete ${slot} visible option exists`);
    assert.ok(target.hits.every(Boolean), `${slot} original engine wins hit tests`);
    const count = await navCount();
    await choices.nth(target.index).click(); await waitClosed();
    assert.equal((await state()).searchEngine, target.id);
    assert.equal(await navCount(), count, 'selection never navigates');
  }

  await page.evaluate(() => {
    OpenTabSearch.replaceSettings({ ...OpenTabSearch.getState(), searchEngine: 'google', searchHistoryEnabled: false, customSearchEngines: [] });
    window.__navLog = [];
    OpenTabSearch.navigateHook = (url, openInNewTab) => window.__navLog.push({ url, openInNewTab });
  });
  await waitClosed();
  assert.equal(await choices.count(), 5);
  assert.equal(await selected.getAttribute('data-engine'), 'google');
  await captureIdentity();
  await input.fill('query stays exactly here');
  await input.evaluate((el) => el.setSelectionRange(2, 9, 'backward'));
  const before = await host.boundingBox();
  const startCount = await navCount();
  await selected.click(); await waitOpen();
  await assertIdentity();
  await assertHorizontalGeometry(before);
  await hitChoice(4); await choices.nth(4).click(); await waitClosed();
  assert.equal((await state()).searchEngine, 'github');
  assert.equal(await selected.getAttribute('data-engine'), 'github');
  assert.equal(await choices.nth(4).getAttribute('aria-pressed'), 'true');
  await assertIdentity();
  assert.equal(await input.inputValue(), 'query stays exactly here');
  assert.deepEqual(await input.evaluate((el) => [el.selectionStart, el.selectionEnd, el.selectionDirection]), [2, 9, 'backward']);
  assert.equal(await activeId(), 'search-input');
  assert.equal(await navCount(), startCount);
  const topHit = await selected.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.left + 20, rect.top + 20));
  });
  assert.equal(topHit, true, 'the selected original button is on top of the collapsed stack');
  await reload('github');

  // Native keyboard activation and Tab order, not synthetic click stand-ins.
  await selected.focus(); await page.keyboard.press('Space'); await waitOpen();
  assert.equal(await activeId(), 'github');
  for (const [key, id] of [['Home', 'google'], ['ArrowLeft', 'github'], ['ArrowRight', 'google'], ['ArrowDown', 'bing'], ['End', 'github'], ['ArrowUp', 'duckduckgo']]) {
    await page.keyboard.press(key); assert.equal(await activeId(), id, `${key} moves native option focus`);
  }
  await page.keyboard.press('Enter'); await waitClosed();
  assert.equal((await state()).searchEngine, 'duckduckgo');
  await selected.focus(); await page.keyboard.press('ArrowDown'); await waitOpen();
  assert.equal(await activeId(), 'duckduckgo');
  await page.keyboard.press('Home'); await page.keyboard.press('Space'); await waitClosed();
  assert.equal((await state()).searchEngine, 'google');
  await selected.focus(); await page.keyboard.press('Enter'); await waitOpen();
  await page.keyboard.press('Escape'); await waitClosed();
  assert.equal(await activeId(), 'google', 'Escape returns to the selected original disclosure');
  await page.keyboard.press('Tab'); assert.equal(await activeId(), 'search-input');
  await page.keyboard.press('Shift+Tab'); assert.equal(await activeId(), 'google');
  await page.keyboard.press('ArrowUp'); await waitOpen();
  await page.keyboard.press('End'); await page.keyboard.press('Tab'); await waitClosed();
  assert.equal(await activeId(), 'search-input', 'Tab leaves the rail without a trap');
  await selected.click(); await waitOpen();
  await page.keyboard.press('Shift+Tab'); await waitClosed();
  assert.equal(await panel.evaluate((rail) => rail.contains(document.activeElement)), false, 'Shift+Tab leaves the complete widget');
  await selected.click(); await input.click(); await waitClosed();
  assert.equal(await activeId(), 'search-input', 'outside pointer close preserves new focus');
  await input.fill('unchanged');
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal((await state()).searchEngine, 'bing');
  assert.equal(await selected.getAttribute('data-engine'), 'bing');
  await page.keyboard.press('Alt+ArrowUp'); assert.equal((await state()).searchEngine, 'google');
  assert.equal(await input.inputValue(), 'unchanged');
  await selected.focus();
  for (const key of ['Control+ArrowDown', 'Meta+ArrowUp', 'Alt+ArrowDown', 'Shift+ArrowDown']) {
    await page.keyboard.press(key); await waitClosed();
  }
  assert.equal(await selected.evaluate((el) => {
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { prevented: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, isComposing: extra.isComposing });
      if (extra.keyCode) Object.defineProperty(event, 'keyCode', { get: () => extra.keyCode });
      if (extra.prevented) event.preventDefault();
      el.dispatchEvent(event);
      if (el.getAttribute('aria-expanded') !== 'false') return false;
    }
    return true;
  }), true, 'IME/defaultPrevented arrows cannot open the deck');
  assert.equal(await navCount(), 0);

  // Real custom-engine add/delete/persistence and safe literal names.
  await page.click('#settings-btn'); await page.locator('#search-settings-section').scrollIntoViewIfNeeded();
  await page.fill('#search-custom-name', '<img src=x>');
  await page.fill('#search-custom-template', 'https://example.com/find?q=%s');
  await page.click('#search-custom-save');
  const customId = (await state()).customSearchEngines[0].id;
  await page.click('#close-settings');
  await selected.click(); await waitOpen();
  assert.equal(await choices.count(), 6);
  assert.equal(await choices.nth(5).getAttribute('aria-label'), '<img src=x>');
  assert.equal(await choices.nth(5).getAttribute('title'), '<img src=x>');
  assert.equal(await choices.nth(5).locator('img').count(), 0);
  await hitChoice(5); await choices.nth(5).click(); await waitClosed();
  assert.equal((await state()).searchEngine, customId);
  assert.equal(await selected.getAttribute('data-engine'), customId);
  assert.deepEqual(await choices.evaluateAll((nodes) => nodes.map((node) => node.dataset.engine)), ['google', 'bing', 'baidu', 'duckduckgo', 'github', customId]);
  await reload(customId);
  await page.click('#settings-btn'); await page.locator('#search-custom-list').scrollIntoViewIfNeeded();
  await page.locator('#search-custom-list .search-custom-actions button').nth(1).click();
  assert.equal((await state()).searchEngine, 'google');
  assert.equal(await selected.getAttribute('data-engine'), 'google');
  await page.click('#close-settings');
  await selected.click(); await waitOpen(); assert.equal(await choices.count(), 5);
  await page.keyboard.press('Escape'); await waitClosed();

  const selectedBox = await selected.boundingBox(); assert.ok(selectedBox);
  for (let index = 0; index < 6; index++) {
    await page.mouse.click(selectedBox.x + 20, selectedBox.y + 20);
    assert.equal(await host.getAttribute('data-expanded'), index % 2 === 0 ? 'true' : 'false');
  }
  await waitClosed();
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  try {
    const tap = async (locator) => {
      const box = await locator.boundingBox(); assert.ok(box);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await tap(selected); await waitOpen(); await tap(choices.nth(1)); await waitClosed();
    assert.equal((await state()).searchEngine, 'bing');
  } finally { await session.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await session.detach(); }

  const originalViewport = page.viewportSize();
  const originalTheme = await page.evaluate(() => document.body.classList.contains('theme-light'));
  const manyCustom = Array.from({ length: 12 }, (_, i) => ({ id: `deck-${i}`, name: `Custom engine ${i}`, template: `https://example.com/${i}?q=%s` }));
  await page.evaluate((engines) => OpenTabSearch.replaceSettings({ ...OpenTabSearch.getState(), customSearchEngines: engines }), manyCustom);
  await captureIdentity();
  for (const theme of ['dark', 'light']) {
    await page.evaluate((light) => document.body.classList.toggle('theme-light', light), theme === 'light');
    for (const viewport of [{ width: 1024, height: 768 }, { width: 360, height: 560 }, { width: 640, height: 360 }]) {
      await page.setViewportSize(viewport); await selected.scrollIntoViewIfNeeded();
      const before = await host.boundingBox();
      await screenshot(page, `engine_deck_${theme}_${viewport.width}x${viewport.height}_collapsed.png`);
      await selected.click(); await waitOpen();
      assert.equal(await choices.count(), 17);
      assert.equal((await assertHorizontalGeometry(before)).scrollable, true, 'custom engines stay in a bounded horizontal rail');
      await assertIdentity();
      const labels = await choices.evaluateAll((nodes) => nodes.map((button) => button.getAttribute('aria-label')));
      manyCustom.forEach((engine, index) => assert.equal(labels[index + 5], engine.name));
      for (const slot of ['first', 'middle', 'last']) {
        await page.keyboard.press('End'); assert.equal(await activeId(), 'deck-11');
        const clipped = await choices.nth(16).evaluate((button) => {
          const b = button.getBoundingClientRect(), r = document.getElementById('search-engine-panel').getBoundingClientRect();
          return b.left < r.left || b.right > r.right;
        });
        assert.equal(clipped, false, 'End reveals the last custom engine without page scrolling');
        await clickVisibleChoice(slot);
        await selected.click(); await waitOpen();
      }
      await page.keyboard.press('Home'); assert.equal(await activeId(), 'google');
      await hitChoice(0);
      if (viewport.width === 360) {
        const rail = await panel.boundingBox(); assert.ok(rail);
        await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2);
        await page.mouse.wheel(160, 0);
        await page.waitForFunction(() => document.getElementById('search-engine-panel').scrollLeft > 0);
        assert.equal(await host.getAttribute('data-expanded'), 'true', 'native horizontal scrolling keeps the inline rail open');
        await page.keyboard.press('End'); await hitChoice(16);
        await page.keyboard.press('Home'); await hitChoice(0);
      }

      await screenshot(page, `engine_deck_${theme}_${viewport.width}x${viewport.height}.png`);
      await page.keyboard.press('Escape'); await waitClosed();
      await assertIdentity();
    }
  }
  await page.setViewportSize(originalViewport);
  await page.evaluate((light) => document.body.classList.toggle('theme-light', light), originalTheme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selected.click(); await waitOpen();
  assert.equal(await host.evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
  assert.ok((await choices.evaluateAll((nodes) => nodes.map((button) => getComputedStyle(button).transitionDuration))).every((duration) => duration === '0s'));
  await page.keyboard.press('Escape'); await waitClosed();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await selected.click(); await waitOpen();
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#command-palette:not(.hidden)'); await waitClosed();
  assert.equal(await choices.evaluateAll((buttons) => buttons.filter((button) => !button.inert).length), 1);
  await page.keyboard.press('Escape');
  for (const mode of ['minimal-mode', 'zen-mode']) {
    await selected.click(); await waitOpen();
    await page.evaluate((mode) => document.body.classList.add(mode), mode); await waitClosed();
    await page.evaluate((mode) => document.body.classList.remove(mode), mode); await waitClosed();
  }
  await page.evaluate(() => OpenTabSearch.replaceSettings({ ...OpenTabSearch.getState(), searchEngine: 'google', customSearchEngines: [] }));
  assert.equal(await navCount(), 0, 'all engine operations are selection only');
  console.log('Inline search-engine deck E2E passed: original nodes, horizontal geometry, native keys/touch, caret, custom persistence, 360px overflow and reduced motion.');
}
