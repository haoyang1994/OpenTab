import assert from 'node:assert/strict';
import path from 'node:path';
import { waitForAsync } from './wait-for-async.mjs';

export function contrastRatio(first, second) {
  const luminance = color => {
    const channels = /^#[\da-f]{6}$/i.test(color)
      ? [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
      : color.match(/^rgb\((\d+), (\d+), (\d+)\)$/)?.slice(1).map(Number);
    assert.equal(channels?.length, 3, `expected an opaque RGB color, got ${color}`);
    return channels.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

async function assertKeyboardFocus(popup, id) {
  const focus = await popup.locator(`#${id}`).evaluate(element => {
    const style = getComputedStyle(element);
    return { active: document.activeElement === element, visible: element.matches(':focus-visible'),
      color: style.outlineColor, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset),
      style: style.outlineStyle, surface: getComputedStyle(document.body).backgroundColor,
      field: getComputedStyle(document.querySelector('#site-name')).backgroundColor };
  });
  assert.equal(focus.active, true); assert.equal(focus.visible, true); assert.equal(focus.style, 'solid');
  assert.ok(focus.width >= 2); assert.ok(focus.offset >= 2);
  for (const surface of [focus.surface, focus.field]) {
    assert.ok(contrastRatio(focus.color, surface) >= 3, `${id} keyboard outline contrasts with ${surface}`);
  }
}

// Native extension-page coverage at the action popup's actual width. Only
// activeTab discovery is a fixture: these pages cannot receive a toolbar click's
// temporary grant. Rendering, input events, locking and saving remain real.
export async function verifyPopupAppearance({ context, worker, base, artifacts }) {
  const appearanceKeys = ['themeMode', 'accentHue', 'languagePreference'];
  const graphKeys = ['opentab.sceneSchemaVersion', 'opentab.workspaceEpoch', 'scenes', 'sceneProfiles',
    'folders', 'icons', 'todos', 'lastOpenedSceneId', 'currentFolderId', ...appearanceKeys];
  const original = await worker.evaluate(keys => chrome.storage.local.get(keys), graphKeys);
  const read = () => worker.evaluate(keys => chrome.storage.local.get(keys), graphKeys);
  const saveTitle = '设置 User page · A deliberately long title that remains user-authored';
  const sourceUrl = 'https://example.com/a/long/source/path?kept=as-page-identity';
  async function open({ supported = true, colorScheme = 'light' } = {}) {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 328, height: 420 });
    await popup.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await popup.addInitScript(({ supported, saveTitle, sourceUrl }) => {
      chrome.tabs.query = async () => [{ id: 123, title: saveTitle,
        url: supported ? sourceUrl : 'chrome://settings/' }];
    }, { supported, saveTitle, sourceUrl });
    await popup.goto(`${base}/popup.html`);
    await popup.waitForFunction(supported => document.querySelector('#folder-select option')
      && (supported ? !document.querySelector('#save-btn').disabled : !!document.querySelector('#status.error')?.textContent), supported);
    return popup;
  }
  async function measure(popup, light, supported, accentHue = 284) {
    const result = await popup.evaluate(() => {
      const main = document.querySelector('.popup'), field = document.querySelector('#site-name'), button = document.querySelector('#save-btn');
      const style = node => getComputedStyle(node);
      return {
        width: main.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth > innerWidth,
        light: document.body.classList.contains('theme-light'),
        surface: style(document.body).backgroundColor, field: style(field).backgroundColor,
        button: style(button).backgroundColor, disabled: button.disabled,
        fieldHeight: field.getBoundingClientRect().height, buttonHeight: button.getBoundingClientRect().height,
        accent: style(document.documentElement).getPropertyValue('--accent-hue').trim(),
        statusRole: document.querySelector('#status').getAttribute('role')
      };
    });
    assert.equal(result.width, 328); assert.equal(result.overflow, false);
    assert.equal(result.light, light); assert.equal(result.disabled, !supported);
    assert.equal(result.surface, light ? 'rgb(248, 250, 252)' : 'rgb(51, 65, 85)');
    assert.equal(result.field, light ? 'rgb(255, 255, 255)' : 'rgb(61, 77, 99)');
    assert.equal(result.button, supported ? 'rgb(79, 70, 229)' : light ? 'rgb(226, 232, 240)' : 'rgb(71, 85, 105)');
    assert.equal(result.fieldHeight, 40); assert.equal(result.buttonHeight, 40);
    assert.equal(result.accent, String(accentHue)); assert.equal(result.statusRole, 'status');
  }
  try {
    for (const languagePreference of ['en', 'zh-CN']) for (const themeMode of ['light', 'dark']) {
      await worker.evaluate(settings => chrome.storage.local.set(settings), { languagePreference, themeMode, accentHue: 284 });
      for (const supported of [true, false]) {
        const before = await read();
        const popup = await open({ supported, colorScheme: themeMode === 'light' ? 'dark' : 'light' });
        try {
          await measure(popup, themeMode === 'light', supported);
          assert.equal(await popup.getAttribute('html', 'lang'), languagePreference);
          assert.equal((await popup.locator('#save-btn').textContent()).trim(), languagePreference === 'en' ? 'Save' : '保存');
          assert.deepEqual(await read(), before, 'opening either popup state is read-only');
          if (supported) {
            assert.equal(await popup.inputValue('#site-name'), saveTitle, 'stored/user page titles are never translated');
            assert.equal(await popup.locator('#current-url').textContent(), sourceUrl);
            await popup.fill('#site-name', '   '); await popup.locator('#site-name').press('Enter');
            assert.equal(await popup.getAttribute('#site-name', 'aria-invalid'), 'true');
            assert.ok((await popup.locator('#status.error').textContent()).trim());
            assert.deepEqual(await read(), before, 'blank-name rejection writes nothing');
            await popup.fill('#site-name', saveTitle);
            assert.equal(await popup.getAttribute('#site-name', 'aria-invalid'), null);
            const choices = await popup.locator('#folder-select option').evaluateAll(options => options.map(option => ({ id: option.value, text: option.textContent })));
            const destination = choices.at(-1);
            assert.ok(destination?.id);
            await popup.selectOption('#folder-select', destination.id);
            if (before['opentab.sceneSchemaVersion'] === 2) {
              const group = before.folders.find(group => group.id === destination.id);
              const scene = before.scenes.find(scene => scene.id === group.sceneId);
              assert.ok(destination.text.startsWith(`${scene.name} / `));
            }
            await popup.locator('#site-name').focus(); await popup.keyboard.press('Tab'); await popup.keyboard.press('Tab');
            await assertKeyboardFocus(popup, 'save-btn');
            await popup.locator('.popup').screenshot({ path: path.join(artifacts, `popup-${languagePreference}-${themeMode}-ready.png`), animations: 'disabled' });
            const name = `Popup ${languagePreference} ${themeMode}`;
            await popup.fill('#site-name', name);
            if (languagePreference === 'en' && themeMode === 'dark') await popup.locator('#site-name').press('Enter');
            else await popup.click('#save-btn');
            await waitForAsync(worker, async expected => (await chrome.storage.local.get('icons')).icons.some(icon => icon.name === expected), name);
            const after = await read(), added = after.icons.at(-1);
            assert.equal(after.icons.length, before.icons.length + 1, 'real popup submission appends exactly one icon');
            assert.equal(added.name, name); assert.equal(added.url, sourceUrl); assert.equal(added.folderId, destination.id);
            assert.deepEqual(after.icons.slice(0, -1), before.icons, 'other scenes and records remain intact');
            for (const key of graphKeys.filter(key => key !== 'icons')) assert.deepEqual(after[key], before[key], `popup save preserves ${key}`);
          } else {
            const status = await popup.locator('#status').textContent();
            assert.ok(status.trim());
            await popup.fill('#site-name', 'Cannot save'); await popup.locator('#site-name').press('Enter');
            const destination = await popup.locator('#folder-select option').last().getAttribute('value');
            await popup.selectOption('#folder-select', destination);
            assert.equal(await popup.locator('#status').textContent(), status, 'group change retains unsupported-page explanation');
            assert.equal(await popup.locator('#save-btn').isDisabled(), true);
            const button = await popup.locator('#save-btn').boundingBox();
            await popup.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
            await measure(popup, themeMode === 'light', false);
            assert.equal(await popup.locator('#save-btn').evaluate(button => getComputedStyle(button).transform), 'none');
            await popup.locator('.popup').screenshot({ path: path.join(artifacts, `popup-${languagePreference}-${themeMode}-unsupported.png`), animations: 'disabled' });
            assert.deepEqual(await read(), before, 'unsupported-page Enter, disabled click and group changes remain read-only');
          }
        } finally { if (!popup.isClosed()) await popup.close(); }
      }
    }
    // These hues made the original hue-only ring disappear into its surface.
    // Check real keyboard focus geometry and computed contrast for every control.
    for (const [themeMode, accentHue] of [['light', 60], ['dark', 240]]) {
      await worker.evaluate(settings => chrome.storage.local.set(settings), { themeMode, accentHue });
      const before = await read(), popup = await open();
      try {
        await measure(popup, themeMode === 'light', true, accentHue);
        await popup.keyboard.press('Tab'); await assertKeyboardFocus(popup, 'folder-select');
        await popup.keyboard.press('Shift+Tab'); await assertKeyboardFocus(popup, 'site-name');
        await popup.keyboard.press('Tab'); await popup.keyboard.press('Tab'); await assertKeyboardFocus(popup, 'save-btn');
        assert.deepEqual(await read(), before, 'extreme-accent focus changes remain read-only');
      } finally { await popup.close(); }
    }
    await worker.evaluate(() => chrome.storage.local.set({ themeMode: 'auto', accentHue: 284 }));
    const before = await read(), popup = await open();
    try {
      await measure(popup, true, true);
      await popup.emulateMedia({ colorScheme: 'dark' });
      await popup.waitForFunction(() => !document.body.classList.contains('theme-light'));
      await measure(popup, false, true);
      assert.deepEqual(await read(), before, 'system theme changes never persist new preferences');
    } finally { await popup.close(); }
  } finally {
    // Restore this suite's synthetic fixture only after testing the real writes.
    const restoreKeys = [...appearanceKeys, 'icons'];
    await worker.evaluate(async ({ original, restoreKeys }) => {
      const patch = Object.fromEntries(restoreKeys.filter(key => Object.hasOwn(original, key)).map(key => [key, original[key]]));
      await chrome.storage.local.set(patch);
      const absent = restoreKeys.filter(key => !Object.hasOwn(original, key));
      if (absent.length) await chrome.storage.local.remove(absent);
    }, { original, restoreKeys });
  }
  console.log('popup: eight 328px locale/theme/state screenshots, real click/Enter saves, unsupported feedback, extreme-hue focus contrast and live system theme passed');
}
