import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForAsync } from './wait-for-async.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pasteSitesFixture = {
  icons: [{ id: 'existing-site', type: 'shortcut', name: 'Existing', url: 'https://existing.example.com/', folderId: 'work', parentId: '' }],
  folders: [{ id: 'folder-home', name: '主页' }, { id: 'work', name: 'Work <svg onload=alert(1)> ' + 'Long group '.repeat(8) }],
  currentFolderId: 'folder-home', themeMode: 'dark', languagePreference: 'zh-CN',
  background: { type: 'gradient', value: 'linear-gradient(135deg, #09203f, #537895)', source: 'gradient' },
  browserSyncEnabled: false, weatherEnabled: false, particlesEnabled: false, minimalMode: false
};
export const pasteSitesInput = 'new.example.com/path\nhttps://new.example.com/path\n\nhttps://existing.example.com/\nnot a website\njavascript:alert(1)';
const expectedNew = 'https://new.example.com/path';
const input = '#site-list-input', confirm = '#site-list-confirm';

export async function verifyPasteSites(page, worker, requests = []) {
  async function store(payload) {
    const persisted = await worker.evaluate(data => OpenTabWorkspace.transaction(async ({ write, read }) => {
      await write(data);
      return read(Object.keys(data));
    }), payload);
    assert.deepEqual(persisted, payload, 'fixture is durably installed under the same lock as first-install initialization');
  }
  async function ready() {
    await page.waitForFunction(() => window.OpenTabSiteList && document.querySelector('#site-list-form')?.dataset.ready === '1'
      && performance.getEntriesByName('opentab:grid-ready').length > 0);
    await page.evaluate(() => OpenTabI18n.ready);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
    });
  }
  async function goReload(action) {
    const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
    await action(); await navigation; await ready();
  }
  async function openSettings() {
    await page.locator('#settings-btn').click();
    await page.locator('#settings-nav-sync').click();
    await page.locator(input).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.getElementById('site-list-group').options.length === 2);
  }
  async function preview() {
    await page.locator('#site-list-preview-btn').click();
    await page.waitForFunction(() => document.getElementById('site-list-form').getAttribute('aria-busy') === 'false');
  }
  async function workspace() { return worker.evaluate(() => chrome.storage.local.get(['icons', 'folders'])); }
  async function screenshots(language) {
    for (const theme of ['dark', 'light']) {
      await page.locator('#settings-nav-appearance').click();
      await page.locator(`.theme-mode-tab[data-theme="${theme}"]`).click();
      await waitForAsync(page, async expected => (await chrome.storage.local.get('themeMode')).themeMode === expected, theme);
      await page.locator('#settings-nav-sync').click();
      await page.locator('#site-list-form').evaluate(form => form.scrollIntoView({ block: 'start' }));
      const content = await page.locator('#site-list-form').textContent();
      if (language === 'en') assert.doesNotMatch(content.replace(pasteSitesFixture.folders[1].name, ''), /批量|可添加|无效|重复|确认|分组|网址/);
      for (const selector of [input, '#site-list-group', '#site-list-confirm', '#site-list-rows']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width, `${selector} fits the narrow viewport`);
      }
      assert.equal(await page.locator('#site-list-rows').evaluate(node => {
        const bg = getComputedStyle(node).backgroundColor;
        return !bg.startsWith('rgba') && bg !== 'transparent';
      }), true, 'preview has a solid readable surface');
      fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
      await page.screenshot({ animations: 'disabled', path: path.join(root, 'artifacts', `paste-sites-${language}-${theme}-narrow.png`) });
    }
  }

  // Install fixture under the same workspace transaction as first-install
  // defaults. Waiting for the page alone cannot rule out an onInstalled race.
  await ready();
  await store(pasteSitesFixture);
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#empty-paste-sites').isVisible(), true);
  await page.locator('#empty-paste-sites').click();
  await page.waitForFunction(() => document.getElementById('site-list-group').value === 'folder-home');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'site-list-input');
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#command-palette').isVisible(), false, 'active settings form excludes the command palette');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'site-list-input');
  const before = await workspace(), requestCount = requests.length;

  // Use Chromium's real copy/paste key path, not dispatchEvent or navigator.clipboard.
  // This requires no clipboard permission and observes a trusted paste event.
  await page.locator(input).evaluate(node => {
    window.__siteListPaste = [];
    node.addEventListener('paste', event => window.__siteListPaste.push({ trusted: event.isTrusted, type: event.type }));
  });
  await page.keyboard.insertText(pasteSitesInput);
  await page.keyboard.press('Control+A'); await page.keyboard.press('Control+C');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Control+V');
  await page.waitForFunction(expected => document.getElementById('site-list-input').value === expected, pasteSitesInput);
  assert.deepEqual(await page.evaluate(() => window.__siteListPaste), [{ trusted: true, type: 'paste' }]);
  await page.locator('#site-list-group').selectOption('work');
  await preview();
  assert.equal(await page.locator('#site-list-rows [data-status="ready"]').count(), 1);
  assert.equal(await page.locator('#site-list-rows [data-status="duplicate"]').count(), 2);
  assert.equal(await page.locator('#site-list-rows [data-status="invalid"]').count(), 2);
  assert.equal(await page.locator(confirm).textContent(), '添加 1 个网站');
  assert.match(await page.locator('#site-list-rows').textContent(), /第 5 行/);
  assert.equal(await page.locator('#site-list-preview img, #site-list-preview a, #site-list-preview svg').count(), 0);
  assert.deepEqual(await workspace(), before, 'preview never changes the workspace');
  assert.equal(requests.length, requestCount, 'paste, preview and group choice make no remote request');

  // Changing text or destination immediately invalidates the old confirmation.
  await page.locator(input).press('End'); await page.keyboard.insertText('\nhttps://extra.example.com/');
  assert.equal(await page.locator(confirm).isDisabled(), true);
  await page.locator(input).fill(pasteSitesInput); await preview();
  await page.locator('#site-list-group').selectOption('folder-home');
  assert.equal(await page.locator(confirm).isDisabled(), true);
  await page.locator('#site-list-group').selectOption('work'); await preview();
  await page.locator('#site-list-cancel').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'empty-paste-sites', 'Cancel restores the direct opener');
  await page.locator('#empty-paste-sites').click();
  await page.waitForFunction(() => document.getElementById('site-list-group').options.length === 2);
  assert.equal(await page.inputValue(input), pasteSitesInput);
  assert.equal(await page.locator(confirm).isDisabled(), true, 'reopening requires a fresh preview');
  await preview();
  // A rejected durable write keeps the draft and restores each original
  // disabled flag rather than enabling unavailable actions such as Undo.
  const undoWasDisabled = await page.locator('#import-undo-btn').isDisabled();
  await page.evaluate(() => {
    window.__siteListOriginalLocks = navigator.locks.request;
    navigator.locks.request = () => Promise.reject(new Error('Synthetic batch save failure'));
  });
  await page.locator(confirm).click();
  await page.waitForFunction(() => !OpenTabSiteList.isBusy() && document.getElementById('site-list-status').textContent.includes('添加未完成'));
  assert.equal(await page.inputValue(input), pasteSitesInput);
  assert.equal(await page.locator('#close-settings').isDisabled(), false);
  assert.equal(await page.locator('#backup-import-btn').isDisabled(), false);
  assert.equal(await page.locator('#import-undo-btn').isDisabled(), undoWasDisabled);
  assert.equal(await page.locator(confirm).isDisabled(), true);
  assert.deepEqual(await workspace(), before, 'failed write does not mutate data');
  await page.evaluate(() => { navigator.locks.request = window.__siteListOriginalLocks; delete window.__siteListOriginalLocks; });
  await preview();
  // A real held workspace lock proves no optimistic success, reload or second
  // UI action can occur before the actual transaction becomes durable.
  await page.evaluate(() => {
    window.__siteListLockHeld = false;
    navigator.locks.request('opentab-workspace-v1', () => new Promise(resolve => {
      window.__siteListReleaseLock = resolve; window.__siteListLockHeld = true;
    }));
  });
  await page.waitForFunction(() => window.__siteListLockHeld);
  await page.locator(confirm).click();
  assert.equal(await page.evaluate(() => OpenTabSiteList.isBusy()), true);
  assert.equal(await page.locator('#settings-panel').isVisible(), true);
  for (const selector of [input, confirm, '#site-list-cancel', '#close-settings', '#backup-import-btn']) {
    assert.equal(await page.locator(selector).isDisabled(), true, `${selector} waits for the durable write`);
  }
  assert.match(await page.locator('#site-list-status').textContent(), /请稍候/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settings-panel').isVisible(), true, 'Escape cannot imply cancellation of a confirmed pending write');
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#command-palette').isVisible(), false);
  assert.deepEqual(await workspace(), before, 'pending lock has not reported an optimistic write');
  await goReload(() => page.evaluate(() => window.__siteListReleaseLock()));
  await waitForAsync(page, async url => (await chrome.storage.local.get('icons')).icons.filter(icon => icon.url === url).length === 1, expectedNew);
  const added = (await workspace()).icons.find(icon => icon.url === expectedNew);
  assert.equal(added.folderId, 'work'); assert.equal(added.parentId || '', '');
  assert.equal((await workspace()).icons.length, 2);
  await page.waitForSelector('#toast:not(.hidden) button');
  await goReload(() => page.locator('#toast button').click());
  assert.equal((await workspace()).icons.some(icon => icon.url === expectedNew), false, 'native toast Undo restores workspace');
  assert.equal((await workspace()).icons.some(icon => icon.id === 'existing-site'), true);

  // A second add survives an independent reload, then the durable settings Undo.
  await openSettings();
  await page.locator(input).fill('https://persist.example.com/');
  await page.locator('#site-list-group').selectOption('work'); await preview();
  await goReload(() => page.locator(confirm).click());
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  assert.equal((await workspace()).icons.filter(icon => icon.url === 'https://persist.example.com/').length, 1);
  await openSettings();
  await page.waitForFunction(() => !document.getElementById('import-undo-btn').disabled);
  await goReload(() => page.locator('#import-undo-btn').click());
  assert.equal((await workspace()).icons.length, 1);

  // Actual blank-area right-click opens the single-item modal; its subtle batch
  // entry is new-mode only and requires explicit discard of a filled draft.
  await page.mouse.click(6, 6, { button: 'right' });
  await page.waitForSelector('#add-icon-modal:not(.hidden)');
  assert.equal(await page.locator('#modal-paste-sites').isVisible(), true);
  await page.locator('#icon-name').fill('Keep this draft');
  await page.locator('#modal-paste-sites').click();
  await page.waitForSelector('#inline-dialog:not(.hidden)');
  await page.locator('#inline-dialog-actions button').first().click();
  assert.equal(await page.inputValue('#icon-name'), 'Keep this draft');
  assert.equal(await page.locator('#add-icon-modal').isVisible(), true);
  await page.locator('#modal-paste-sites').click();
  await page.locator('#inline-dialog-actions button').last().click();
  await page.waitForSelector('#settings-panel:not(.hidden)');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'site-list-input');
  await page.locator('#site-list-cancel').click();
  await page.locator('#group-tabs [data-group-id="work"]').click();
  await page.locator('.icon-widget[data-id="existing-site"]').click({ button: 'right' });
  await page.locator('#edit-icon-btn').click();
  assert.equal(await page.locator('#modal-paste-sites').isVisible(), false);
  await page.locator('#cancel-btn').click();

  await openSettings();
  const tooMany = Array.from({ length: 101 }, (_, i) => `https://limit${i}.example.com/`).join('\n');
  await page.locator(input).fill(tooMany); await preview();
  assert.equal(await page.inputValue(input), tooMany, 'all over-limit input remains available to correct');
  assert.equal(await page.locator(confirm).isDisabled(), true);
  assert.match(await page.locator('#site-list-status').textContent(), /100/);
  const tooLarge = 'https://long.example.com/' + 'x'.repeat(32768);
  await page.locator(input).fill(tooLarge); await preview();
  assert.equal(await page.inputValue(input), tooLarge);
  assert.equal(await page.locator(confirm).isDisabled(), true);
  assert.match(await page.locator('#site-list-status').textContent(), /32/);

  // Native input, keyboard tabbing, long text, narrow layout, both locales/themes.
  await page.setViewportSize({ width: 390, height: 844 });
  const longInput = pasteSitesInput + '\nhttps://very-long-subdomain.example.com/' + 'long-path-'.repeat(35);
  await page.locator(input).fill(longInput); await preview();
  await screenshots('zh');
  await page.locator('#site-list-rows').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#settings-panel')), true, 'existing settings focus trap remains active');
  await page.locator('#settings-nav-appearance').click();
  await goReload(() => page.locator('#language-preference').selectOption('en'));
  await openSettings();
  await page.locator(input).fill(longInput); await page.locator('#site-list-group').selectOption('work'); await preview();
  await screenshots('en');
  await page.locator('#close-settings').click();
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#command-palette:not(.hidden)');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'command-palette-input', 'closed batch form does not block the independent command palette');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#command-palette.hidden', { state: 'attached' });
  console.log('paste-sites MV3 passed: trusted paste, preview privacy, statuses, invalidation, add/persistence/undo, modal drafts, limits and bilingual narrow themes');
}
