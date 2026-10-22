import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { formatConsoleError, unexpectedErrors } from './console-allow.mjs';
import { verifyPasteSites } from './paste-sites.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = await chromium.launchPersistentContext('', {
  locale: 'zh-CN', headless: process.env.HEADLESS === 'true',
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox', '--disable-dev-shm-usage']
});
const errors = [], requests = [];
try {
  // Synthetic fixtures never contact a live website. Preview still asserts that
  // no attempted remote request was made, including favicon/provider lookups.
  await context.route('**/*', route => {
    if (/^https?:/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(formatConsoleError(message)); });
  await page.goto(`chrome-extension://${worker.url().split('/')[2]}/home.html`, { waitUntil: 'domcontentloaded' });
  await verifyPasteSites(page, worker, requests);
  assert.deepEqual(unexpectedErrors(errors), [], 'no unexpected browser errors');
} finally {
  await context.close();
}
