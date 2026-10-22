import assert from 'node:assert/strict';
import path from 'node:path';
import { waitForAsync } from './wait-for-async.mjs';

export async function runUiRefinement(page, worker, artifacts) {
  const todos = [{ id: 'preserved-task', text: 'Keep this task', done: false }];
  async function store(data) { await worker.evaluate(value => OpenTabWorkspace.transaction(({ write }) => write(value)), data); }
  async function ready(language = 'zh-CN', theme = 'light', todoVisible = true) {
    await page.waitForFunction(({ language, theme, todoVisible }) => document.documentElement.lang === language
      && document.body.classList.contains('theme-light') === (theme === 'light')
      && document.querySelector('#add-shortcut-tile')
      && window.OpenTabLayout?.get().todoButtonVisible === todoVisible, { language, theme, todoVisible });
  }
  async function settings() {
    if (await page.locator('#settings-panel').evaluate(el => el.classList.contains('hidden'))) await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.fill('#settings-search', ''); await page.click('#settings-nav-shortcuts');
  }
  async function closeSettings() {
    await page.click('#close-settings'); await page.waitForSelector('#settings-panel.hidden', { state: 'attached' });
  }
  async function visibility(value) {
    await page.locator('#todo-button-visible').setChecked(value);
    await waitForAsync(worker, async wanted => (await chrome.storage.local.get('todoButtonVisible')).todoButtonVisible === wanted, value);
    await page.waitForFunction(wanted => OpenTabLayout.get().todoButtonVisible === wanted, value);
  }
  await store({ todos, developerToolsEnabled: false, todoPanelOpen: false, todoButtonVisible: true, languagePreference: 'zh-CN', themeMode: 'light' });
  await page.reload(); await ready();
  await page.click('#todo-toggle-btn'); await page.fill('#todo-input', 'Unfinished draft stays');
  await settings(); await visibility(false);
  assert.equal(await page.locator('#todo-toggle-btn').isVisible(), false);
  assert.equal(await page.locator('#todo-widget').isVisible(), false);
  assert.equal(await page.inputValue('#todo-input'), 'Unfinished draft stays');
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('todos')).todos), todos);
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'todo-toggle-btn');
  await closeSettings();
  for (let i = 0; i < 18; i++) { await page.keyboard.press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement.id), 'todo-toggle-btn'); }
  await settings(); await visibility(true); await closeSettings();
  await page.click('#todo-toggle-btn'); assert.equal(await page.inputValue('#todo-input'), 'Unfinished draft stays');
  await settings(); await visibility(false); await closeSettings();
  await page.reload(); await ready('zh-CN', 'light', false);
  await page.waitForFunction(() => OpenTabLayout.get().todoButtonVisible === false);
  assert.equal(await page.locator('#todo-toggle-btn').isVisible(), false, 'hidden preference survives reload');
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('todos')).todos), todos);
  await settings();
  await page.click('.settings-reset-section[data-section="shortcuts"]');
  await page.waitForSelector('#inline-dialog:not(.hidden)');
  await page.locator('#inline-dialog-actions button', { hasText: '恢复默认' }).click();
  await page.waitForFunction(() => document.querySelector('#inline-dialog').classList.contains('hidden') && OpenTabLayout.get().todoButtonVisible === true);
  await closeSettings(); await page.click('#toast button');
  await page.waitForFunction(() => OpenTabLayout.get().todoButtonVisible === false);
  await waitForAsync(worker, async () => (await chrome.storage.local.get('todoButtonVisible')).todoButtonVisible === false);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('todos')).todos), todos, 'reset/Undo does not alter tasks');

  for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) {
    await store({ languagePreference: language, themeMode: theme, todoButtonVisible: true, todoPanelOpen: false,
      background: { type: 'gradient', value: 'linear-gradient(135deg, #d69b72, #64748b)', source: 'gradient' } });
    await page.reload(); await ready(language, theme); await page.setViewportSize({ width: 390, height: 844 });
    const selection = page.locator('#select-sites');
    assert.equal((await selection.textContent()).trim(), '', 'selection entry is icon-only');
    assert.ok(await selection.getAttribute('aria-label')); assert.ok(await selection.getAttribute('title'));
    await page.screenshot({ path: path.join(artifacts, `refined-home-${language}-${theme}.png`) });
    await page.click('#add-shortcut-tile'); await page.waitForSelector('#add-icon-modal:not(.hidden)');
    await page.fill('#icon-name', 'Design reference'); await page.fill('#icon-url', 'https://example.test/design');
    await page.locator('#save-btn').scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector('#add-icon-modal .modal-content'), save = document.querySelector('#save-btn'), cancel = document.querySelector('#cancel-btn');
      const p = panel.getBoundingClientRect(), a = save.getBoundingClientRect(), b = cancel.getBoundingClientRect();
      return { left: p.left, right: p.right, top: p.top, bottom: p.bottom, width: innerWidth, height: innerHeight,
        saveWidth: a.width, panelWidth: p.width, sameRow: Math.abs(a.top - b.top) < 1, saveVisible: a.bottom <= innerHeight,
        background: getComputedStyle(panel).backgroundColor, primary: getComputedStyle(save).backgroundColor };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height);
    assert.ok(geometry.sameRow && geometry.saveVisible && geometry.saveWidth < geometry.panelWidth / 2);
    assert.equal(geometry.primary, 'rgb(79, 70, 229)');
    assert.equal(geometry.background, theme === 'light' ? 'rgb(248, 250, 252)' : 'rgb(51, 65, 85)');
    await page.screenshot({ path: path.join(artifacts, `refined-add-${language}-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape'); await page.waitForSelector('#add-icon-modal.hidden', { state: 'attached' });
  }
  console.log('UI refinement: preserved to-dos/drafts, visibility reload/reset/Undo, icon-only actions and bilingual slate form screenshots passed');
}
