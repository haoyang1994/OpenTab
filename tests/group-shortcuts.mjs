import assert from 'node:assert/strict';

// Run inside the existing MV3 group-motion fixture. Navigator values are
// controlled platform emulation: Linux Chromium DOM dispatch is not evidence
// about real macOS Option text production or OS/browser shortcut dispatch.
export async function assertGroupShortcuts(page) {
  const group = id => `#group-tabs [data-group-id="${id}"]`;
  const selected = id => page.waitForFunction(id => OpenTabSceneNavigation.getView()?.currentFolderId === id
    && !document.getElementById('homepage').inert, id);
  const clickGroup = async id => { await page.locator(group(id)).click(); await selected(id); };
  const dispatch = (extra = {}, target = '#group-tabs [data-group-id="folder-home"]') => page.evaluate(({ extra, target }) => {
    const event = new KeyboardEvent('keydown', { key: '2', code: 'Digit2', altKey: true, bubbles: true, cancelable: true, ...extra });
    // Legacy IME fields are not uniformly accepted by KeyboardEventInit.
    for (const name of ['keyCode', 'which']) if (name in extra && event[name] !== extra[name]) Object.defineProperty(event, name, { value: extra[name] });
    if (extra.alreadyPrevented) event.preventDefault();
    document.querySelector(target).dispatchEvent(event);
    return { prevented: event.defaultPrevented, trusted: event.isTrusted };
  }, { extra, target });

  await page.evaluate(() => {
    window.__groupShortcutFixture = {
      platform: Object.getOwnPropertyDescriptor(navigator, 'platform'),
      userAgentData: Object.getOwnPropertyDescriptor(navigator, 'userAgentData'), events: []
    };
    const fixture = window.__groupShortcutFixture;
    fixture.observe = event => {
      if (event.code !== 'Digit2' || !event.altKey || !event.isTrusted) return;
      const entry = { trusted: event.isTrusted, key: event.key, code: event.code, prevented: null, settled: false };
      fixture.events.push(entry);
      setTimeout(() => { entry.prevented = event.defaultPrevented; entry.settled = true; }, 0);
    };
    window.addEventListener('keydown', fixture.observe, true);
  });
  try {
    for (const { label, ua, legacy, mac } of [
      { label: 'UA-data macOS', ua: 'macOS', legacy: 'Linux x86_64', mac: true },
      { label: 'MacIntel fallback', ua: null, legacy: 'MacIntel', mac: true },
      { label: 'empty UA-data Mac fallback', ua: '', legacy: 'MacIntel', mac: true },
      { label: 'UA-data Windows precedence', ua: 'Windows', legacy: 'MacIntel', mac: false },
      { label: 'Linux fallback', ua: null, legacy: 'Linux x86_64', mac: false }
    ]) {
      await page.evaluate(({ ua, legacy }) => {
        Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: ua === null ? undefined : { platform: ua } });
        Object.defineProperty(navigator, 'platform', { configurable: true, value: legacy });
        OpenTabFolders.renderChrome();
        __groupShortcutFixture.events.length = 0;
      }, { ua, legacy });
      await clickGroup('folder-home');
      const labels = await page.locator('#group-tabs [role="tab"]').evaluateAll(tabs => tabs.map(tab => ({ title: tab.getAttribute('title'), aria: tab.getAttribute('aria-keyshortcuts') })));
      assert.deepEqual(labels, Array.from({ length: 3 }, (_, index) => ({ title: mac ? null : `Alt+${index + 1}`, aria: null })), `${label}: rendered labels match active bindings`);

      // Playwright's real Chromium key path, with only navigator data emulated.
      await page.locator(group('folder-home')).focus();
      await page.keyboard.press('Alt+Digit2');
      await page.waitForFunction(() => __groupShortcutFixture.events.at(-1)?.settled);
      const native = await page.evaluate(() => __groupShortcutFixture.events.at(-1));
      assert.equal(native.trusted, true); assert.equal(native.code, 'Digit2');
      assert.equal(native.prevented, !mac, `${label}: trusted DOM Alt+digit cancellation`);
      await selected(mac ? 'folder-home' : 'work');

      // Option on macOS can yield a symbol while the physical code is Digit2.
      // Synthetic symbol dispatch verifies the handler, not OS character input.
      await clickGroup('folder-home');
      assert.deepEqual(await dispatch({ key: '™' }), { prevented: !mac, trusted: false }, `${label}: symbol/code combination`);
      await selected(mac ? 'folder-home' : 'work');
      await clickGroup('folder-home');

      for (const extra of [
        { altKey: false }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
        { altKey: false, ctrlKey: true }, { altKey: false, metaKey: true },
        { key: 'ArrowLeft', code: 'ArrowLeft' }, { code: 'Numpad2' },
        { isComposing: true }, { keyCode: 229 }, { which: 229 }, { key: 'Process' }, { key: 'Dead' }
      ]) assert.equal((await dispatch(extra)).prevented, false, `${label}: non-group, browser or IME event stays untouched: ${JSON.stringify(extra)}`);
      assert.equal((await dispatch({ alreadyPrevented: true })).prevented, true);
      await selected('folder-home');

      await page.evaluate(() => {
        const fixture = document.createElement('div'); fixture.id = 'group-shortcut-editables';
        fixture.innerHTML = '<input id="group-shortcut-input"><textarea id="group-shortcut-textarea"></textarea><select id="group-shortcut-select"><option>One</option></select><div contenteditable="true"><span id="group-shortcut-contenteditable">Typing</span></div><div role="textbox"><span id="group-shortcut-textbox">Typing</span></div>';
        document.body.appendChild(fixture);
      });
      try {
        for (const id of ['input', 'textarea', 'select', 'contenteditable', 'textbox']) {
          assert.equal((await dispatch({}, `#group-shortcut-${id}`)).prevented, false, `${label}: editable ${id} retains its default`);
        }
        await page.locator('#group-shortcut-input').fill('Keep ™ unchanged');
        assert.equal((await dispatch({ key: '™' }, '#group-shortcut-input')).prevented, false);
        assert.equal(await page.locator('#group-shortcut-input').inputValue(), 'Keep ™ unchanged');
        await selected('folder-home');
      } finally { await page.locator('#group-shortcut-editables').evaluate(node => node.remove()); }

      await clickGroup('work');
      await page.locator(group('work')).focus();
      // Exercise existing palette access/group selection under either platform,
      // without creating a new replacement digit chord.
      assert.equal((await dispatch({ key: 'k', code: 'KeyK', altKey: false, metaKey: mac, ctrlKey: !mac }, group('work'))).prevented, true);
      await page.waitForFunction(() => OpenTabCommandPalette.isOpen());
      await page.locator('#command-palette-input').fill('Empty');
      await page.locator('.command-palette-row[data-entry-type="group"][data-entry-id="empty"]').click();
      await page.waitForFunction(() => !OpenTabCommandPalette.isOpen());
      await selected('empty');
      await clickGroup('folder-home');
    }
  } finally {
    await page.evaluate(() => {
      const fixture = window.__groupShortcutFixture;
      window.removeEventListener('keydown', fixture.observe, true);
      for (const name of ['platform', 'userAgentData']) {
        if (fixture[name]) Object.defineProperty(navigator, name, fixture[name]);
        else delete navigator[name];
      }
      document.getElementById('group-shortcut-editables')?.remove();
      delete window.__groupShortcutFixture;
      OpenTabFolders.renderChrome();
    });
  }
  console.log('MV3 group shortcut DOM checks passed with controlled platform emulation: Mac untouched/unadvertised, Windows/Linux bindings, symbol/code and typing/IME guards, click and palette navigation. Not an actual macOS OS-shortcut test.');
}
