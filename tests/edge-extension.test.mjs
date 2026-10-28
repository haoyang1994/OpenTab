// Genuine Microsoft Edge compatibility; never substitutes bundled Chromium.
// Microsoft-supported sideload flow: Developer mode -> Load unpacked -> folder.
// https://learn.microsoft.com/microsoft-edge/extensions/getting-started/extension-sideloading
// Branded Edge no longer supports Playwright's --load-extension approach.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { assertPackagedNavigation } from './package-navigation.mjs';
import { formatConsoleError, unexpectedErrors } from './console-allow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opentab-edge-'));
const extension = path.join(temporary, 'extension');
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const zip = path.join(root, 'dist', `opentab-${manifest.version}.zip`);
const evidence = { browser: 'Microsoft Edge', status: 'running', stages: [] };
let context, manager;
const errors = [];
function record(stage) { evidence.stages.push(stage); console.log(`Edge: ${stage}`); }
const native = (...args) => execFileSync('xdotool', args, { encoding: 'utf8', timeout: 10000 });
async function ready(page) {
  await page.waitForFunction(() => globalThis.OpenTabSearch && document.querySelector('#homepage')?.inert === false
    && performance.getEntriesByName('opentab:initial-loader-end').length > 0, undefined, { timeout: 15000 });
}
try {
  execFileSync('python3', ['scripts/package-release.py', '--output', zip], { cwd: root, stdio: 'inherit' });
  execFileSync('python3', ['-m', 'zipfile', '-e', zip, extension]);
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: false, locale: 'en-US', viewport: { width: 1440, height: 1000 },
    // Keep extensions enabled; do not use removed sideload flags, policy edits,
    // profile preference injection, or private extension-install APIs.
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  manager = await context.newPage();
  await manager.goto('edge://extensions/');
  evidence.userAgent = await manager.evaluate(() => navigator.userAgent);
  assert.match(evidence.userAgent, /\bEdg\/[\d.]+/, 'test must run actual Edge');
  evidence.version = evidence.userAgent.match(/\bEdg\/([\d.]+)/)[1];
  record(`actual Edge ${evidence.version}`);
  const developer = manager.getByRole('switch', { name: /Developer mode/i });
  if (await developer.count()) {
    if (await developer.getAttribute('aria-checked') !== 'true') await developer.click();
  } else {
    // Edge versions using a labeled native checkbox expose the same UI action.
    const checkbox = manager.getByRole('checkbox', { name: /Developer mode/i });
    await checkbox.check();
  }
  await manager.getByRole('button', { name: /Load unpacked/i }).click();
  // The directory picker is a native GTK dialog, not an HTML file input.
  // Wait for its visible window and focus that exact owned dialog before typing.
  const chooser = native('search', '--sync', '--onlyvisible', '--name', 'Select (Extension Directory|Folder)|Open Directory').trim().split('\n').at(-1);
  assert.match(chooser, /^\d+$/, 'native extension directory picker');
  native('windowfocus', '--sync', chooser);
  native('key', '--clearmodifiers', 'ctrl+l');
  native('type', '--clearmodifiers', '--delay', '1', extension + '/');
  native('key', '--clearmodifiers', 'Return');
  await delay(500); // GTK directory navigation, not application readiness.
  native('key', '--clearmodifiers', 'Return');
  record('selected extracted ZIP through Edge Load unpacked');
  const worker = context.serviceWorkers().find(w => w.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { predicate: w => w.url().endsWith('/background.js'), timeout: 20000 });
  const id = new URL(worker.url()).host;
  evidence.extensionId = id;
  const actualManifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(actualManifest.manifest_version, 3);
  assert.equal(actualManifest.version, manifest.version);
  assert.deepEqual(actualManifest.permissions, manifest.permissions);
  assert.deepEqual(actualManifest.optional_permissions, manifest.optional_permissions);
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks', 'topSites'] })), false,
    'optional permissions are not pre-granted by test setup');
  record('MV3 background and unchanged permissions');
  // Isolate web services while preserving extension-resource failures as errors.
  await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  let home;
  for (const file of ['home.html', 'popup.html', 'tool.html', 'ssh_terminal.html']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${file}: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error' && unexpectedErrors([formatConsoleError(message)]).length) errors.push(`${file}: ${formatConsoleError(message)}`);
    });
    page.on('requestfailed', request => {
      if (request.url().startsWith(`chrome-extension://${id}/`)) errors.push(`${file}: ${request.url()} ${request.failure()?.errorText}`);
    });
    const target = `chrome-extension://${id}/${file}`;
    const response = await page.goto(target, { waitUntil: 'load' });
    assertPackagedNavigation(response, await page.evaluate(() => ({ url: location.href, runtimeId: chrome.runtime.id, readyState: document.readyState })), target, id);
    if (file === 'home.html') { home = page; await ready(home); }
    else await page.close();
  }
  record('all packaged entry points load');
  assert.equal(await home.evaluate(() => OpenTabSearch.getState().searchEngine), 'google', 'Edge must not reset Chrome-compatible search defaults');
  assert.equal(await home.evaluate(() => OpenTabSearch.resolve('edge compatibility').url), 'https://www.google.com/search?q=edge%20compatibility');
  await home.locator('#settings-btn').click();
  await home.locator('#search-settings-section').scrollIntoViewIfNeeded();
  await home.locator('#search-custom-name').fill('Edge QA');
  await home.locator('#search-custom-template').fill('https://example.com/find?q=%s');
  await home.locator('#search-custom-save').click();
  await home.waitForFunction(() => OpenTabSearch.getState().customSearchEngines.length === 1);
  const custom = await home.evaluate(() => OpenTabSearch.getState().customSearchEngines[0]);
  await home.locator('#search-default-engine').selectOption(custom.id);
  await home.waitForFunction(id => OpenTabSearch.getState().searchEngine === id, custom.id);
  await home.reload(); await ready(home);
  assert.equal(await home.evaluate(() => OpenTabSearch.getState().searchEngine), custom.id);
  assert.equal(await home.evaluate(() => OpenTabSearch.resolve('edge compatibility').url), 'https://example.com/find?q=edge%20compatibility');
  record('custom search setting and engine survive reload without migration');
  await home.locator('#settings-btn').click();
  await home.locator('#manage-window-fullscreen-shortcut').scrollIntoViewIfNeeded();
  const shortcutPagePromise = context.waitForEvent('page');
  await home.locator('#manage-window-fullscreen-shortcut').click();
  const shortcuts = await shortcutPagePromise;
  await shortcuts.waitForURL('edge://extensions/shortcuts');
  record('shortcut control opens Edge keyboard shortcuts');
  await shortcuts.close();
  const newtab = await context.newPage();
  await newtab.goto('edge://newtab/', { waitUntil: 'load' });
  // Do not silently enable a disabled extension or suppress an Edge warning.
  // An unaccepted NTP override fails with screenshots for explicit inspection.
  await newtab.waitForFunction(expected => globalThis.chrome?.runtime?.id === expected, id, { timeout: 15000 });
  await ready(newtab);
  assert.equal(await newtab.evaluate(() => OpenTabSearch.getState().searchEngine), custom.id);
  await newtab.screenshot({ path: path.join(artifacts, 'edge-newtab.png') });
  record('real Edge new-tab override with persisted user settings');
  assert.deepEqual(errors, [], 'no extension page exceptions or missing packaged resources');
  evidence.status = 'passed';
  console.log('Genuine Edge packaged compatibility passed. This is not Store certification or the full Chromium regression suite.');
} catch (error) {
  evidence.status = 'failed'; evidence.error = String(error.stack || error);
  if (context) {
    for (const [index, page] of context.pages().entries()) {
      try {
        await page.screenshot({ path: path.join(artifacts, `edge-failure-${index}.png`) });
        fs.writeFileSync(path.join(artifacts, `edge-failure-${index}.txt`), `${page.url()}\n${await page.locator('body').innerText()}`);
      } catch { /* Preserve original failure even if a browser page closed. */ }
    }
  }
  throw error;
} finally {
  fs.writeFileSync(path.join(artifacts, 'edge-verification.json'), JSON.stringify(evidence, null, 2));
  await context?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
