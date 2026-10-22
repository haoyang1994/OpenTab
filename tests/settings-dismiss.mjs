import assert from 'node:assert/strict';

// Reuse the installed MV3 extension page from the aggregate suite, never a mock
// web copy. Pointer/touch capture and native dialog focus need a real browser.
export async function verifySettingsDismissal(page) {
  const oldViewport = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.OpenTabSettingsNav.close();
    window.__settingsDismissActions = 0;
    const button = document.createElement('a');
    button.id = 'settings-dismiss-sentinel'; button.href = '#must-not-navigate';
    button.textContent = 'Underlying action';
    button.style.cssText = 'position:fixed;left:8px;top:400px;width:150px;height:40px;z-index:99;background:white;color:black;';
    button.addEventListener('click', () => { window.__settingsDismissActions++; });
    document.body.appendChild(button);
  });
  const isOpen = () => page.locator('#settings-panel').evaluate(el => !el.classList.contains('hidden'));
  const open = async () => {
    await page.locator('#settings-btn').click();
    assert.equal(await isOpen(), true, 'opening click does not immediately dismiss');
  };
  const sentinel = page.locator('#settings-dismiss-sentinel');
  const oldURL = page.url();
  let cdp;
  try {
    await open();
    const addTile = page.locator('#add-shortcut-tile');
    const originalAddStyle = await addTile.getAttribute('style');
    try {
      // Prior layout cases can leave Add underneath the sidebar. Keep its grid
      // ancestry and real delegated handler, but give this outside-click fixture
      // an exposed, stable target without forcing a click through the panel.
      await addTile.evaluate(el => Object.assign(el.style, {
        position: 'fixed', left: '8px', top: '460px', width: '150px', height: '80px',
        zIndex: '99', transform: 'none', transition: 'none'
      }));
      const target = await addTile.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const panel = document.getElementById('settings-panel').getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        return {
          inViewport: rect.width > 0 && rect.height > 0 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
          outsidePanel: x < panel.left || x >= panel.right || y < panel.top || y >= panel.bottom,
          receivesPointer: el.contains(document.elementFromPoint(x, y))
        };
      });
      assert.equal(target.inViewport, true, 'native Add click target is inside the viewport');
      assert.equal(target.outsidePanel, true, 'native Add click target is outside settings');
      assert.equal(target.receivesPointer, true, 'native Add click target is not clipped or intercepted');
      await addTile.click();
      assert.equal(await isOpen(), false, 'native outside Add click dismisses settings first');
      assert.equal(await page.locator('#add-icon-modal').isVisible(), false, 'dismissal never opens underlying Add');
    } finally {
      await addTile.evaluate((el, style) => {
        if (style === null) el.removeAttribute('style');
        else el.setAttribute('style', style);
      }, originalAddStyle);
    }
    await open();
    await page.locator('#settings-search').fill('sync');
    await page.locator('#site-list-input').fill('https://unfinished.example/draft.png');
    await sentinel.click();
    assert.equal(await isOpen(), false, 'outside click closes sidebar');
    assert.equal(page.url(), oldURL, 'dismissal does not navigate underlying link');
    assert.equal(await page.evaluate(() => window.__settingsDismissActions), 0);
    assert.equal(await page.locator('#settings-btn').evaluate(el => document.activeElement === el), true);
    await open();
    assert.equal(await page.locator('#settings-search').inputValue(), 'sync');
    assert.equal(await page.locator('#site-list-input').inputValue(), 'https://unfinished.example/draft.png');
    await page.locator('#settings-search').fill('');
    await page.locator('#settings-search').click();
    assert.equal(await isOpen(), true, 'inside interactions remain usable');

    await page.evaluate(() => document.getElementById('site-list-form').setAttribute('aria-busy', 'true'));
    await sentinel.click();
    assert.equal(await isOpen(), true, 'pending import cannot be dismissed');
    assert.equal(await page.evaluate(() => window.__settingsDismissActions), 0);
    await page.evaluate(() => document.getElementById('site-list-form').setAttribute('aria-busy', 'false'));

    await page.locator('#settings-reset-all').click();
    await page.waitForSelector('#inline-dialog:not(.hidden)');
    await page.locator('#inline-dialog-actions button').first().click();
    assert.equal(await isOpen(), true, 'nested confirmation cancel retains settings');

    // A real touch gesture exercises the compatibility click, not just dispatchEvent.
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const box = await sentinel.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 20, y: box.y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.getElementById('settings-panel').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => window.__settingsDismissActions), 0, 'touch dismissal consumes compatibility activation');
    assert.equal(page.url(), oldURL);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await open();
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(), false, 'keyboard close still works after repeated pointer/touch reopen');
    assert.equal(await page.locator('#settings-btn').evaluate(el => document.activeElement === el), true);
  } finally {
    if (cdp) { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach(); }
    await page.evaluate(() => {
      document.getElementById('settings-dismiss-sentinel')?.remove();
      document.getElementById('site-list-form')?.setAttribute('aria-busy', 'false');
      document.getElementById('site-list-input').value = '';
      window.OpenTabSettingsNav.close();
      delete window.__settingsDismissActions;
    });
    if (oldViewport) await page.setViewportSize(oldViewport);
  }
  console.log('Native MV3 settings dismissal: outside click/touch, consumption, drafts, nested confirmation, pending import, repeated reopen and focus passed.');
}
