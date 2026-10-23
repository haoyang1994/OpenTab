// Bounded, CI-only native experiment. Never imported by npm test's suite runner.
// Fresh Chromium process/profile per observation; OS filesystem caches are NOT
// flushed. No warm-up samples, filtering of slow observations, or timing retries.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installStartupDiagnostics } from './startup-diagnostics.mjs';
import { formatConsoleError, unexpectedErrors } from './console-allow.mjs';

export const BASELINE_SHA = '7c43d4c4fbab3a32866c02988991059c28c27bea';
export const GRID_READY_BUDGET_MS = 500;
export const SAMPLE_PAIRS = 10;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['/vendor/flatpickr/flatpickr.min.css', '/vendor/flatpickr/flatpickr.min.js', '/vendor/flatpickr/l10n/zh.js'];
const ARTIFACTS = path.join(ROOT, 'artifacts/calendar-assets-experiment');

export function samplePlan() {
  return Array.from({ length: SAMPLE_PAIRS }, (_, pair) => {
    // Each locale has both AB and BA pairs, avoiding locale/order confounding.
    const locale = [0, 1, 4, 5, 8].includes(pair) ? 'zh-CN' : 'en-US';
    return (pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
      .map(variant => ({ pair: pair + 1, locale, variant }));
  }).flat().map((sample, index) => ({ ...sample, order: index + 1 }));
}
export function summarize(values) {
  const present = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = p => present.length ? present[Math.ceil(p * present.length) - 1] : null;
  return { observed: present.length, missing: values.length - present.length,
    min: present[0] ?? null, median: present.length ? (present[Math.floor((present.length - 1) / 2)] + present[Math.floor(present.length / 2)]) / 2 : null,
    p90: percentile(0.9), max: present.at(-1) ?? null,
    mean: present.length ? present.reduce((a, b) => a + b, 0) / present.length : null };
}
export function summarizeSamples(samples) {
  const fields = {
    gridReady: s => s.startup?.gridReady, dcl: s => s.startup?.dcl,
    readWait: s => s.startup?.durations?.readWait,
    validation: s => s.startup?.durations?.validation,
    loaderToGrid: s => s.startup?.durations?.loaderToGrid,
    snapshot: s => s.startup?.startupDiagnostics?.layoutSnapshot?.duration,
    clickToStyled: s => s.calendar?.clickToStyledMs
  };
  return Object.fromEntries(Object.entries(fields).map(([key, get]) => {
    const paired = Array.from({ length: SAMPLE_PAIRS }, (_, i) => {
      const baseline = get(samples.find(s => s.pair === i + 1 && s.variant === 'baseline') || {});
      const candidate = get(samples.find(s => s.pair === i + 1 && s.variant === 'candidate') || {});
      return Number.isFinite(baseline) && Number.isFinite(candidate) ? candidate - baseline : null;
    });
    return [key, { baseline: summarize(samples.filter(s => s.variant === 'baseline').map(get)),
      candidate: summarize(samples.filter(s => s.variant === 'candidate').map(get)),
      pairedCandidateMinusBaseline: summarize(paired), pairedDeltas: paired }];
  }));
}
function save(name, data) { fs.writeFileSync(path.join(ARTIFACTS, name), JSON.stringify(data, null, 2) + '\n'); }
function errorText(error) { return String(error?.stack || error); }
function check(sample, condition, message) { if (!condition) sample.failures.push(message); }
function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); }

async function launch(extension, locale, record, onContext = () => {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opentab-calendar-experiment-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      locale, headless: false, viewport: { width: 1280, height: 800 }, timeout: 20000,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox', '--disable-dev-shm-usage']
    });
    onContext(context);
    context.setDefaultTimeout(10000);
    record.browserVersion = context.browser()?.version() || chromium.executablePath();
    record.initialPages = context.pages().map(page => page.url());
    assert.ok(record.initialPages.every(url => !url.includes('/home.html')), 'fresh profile must not prewarm home.html');
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    const page = await context.newPage();
    record.consoleErrors = []; record.pageErrors = []; record.failedRequests = []; record.cspViolations = [];
    page.on('console', message => { if (message.type() === 'error') record.consoleErrors.push(formatConsoleError(message)); });
    page.on('pageerror', error => record.pageErrors.push(error.message));
    page.on('requestfailed', request => record.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    // This is exactly AC7's test-only mark/snapshot wrapper, not a new signal.
    await page.addInitScript(installStartupDiagnostics);
    await page.addInitScript(() => {
      globalThis.__calendarCspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        __calendarCspViolations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
      });
    });
    return { context, page, home: `chrome-extension://${new URL(worker.url()).host}/home.html`,
      async close() { try { await context.close(); } finally { fs.rmSync(profile, { recursive: true, force: true }); } } };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true }); throw error;
  }
}
async function collectStartup(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const at = name => performance.getEntriesByName(name)[0]?.startTime ?? null;
    const phases = Object.fromEntries(['read-start', 'read-end', 'validated', 'loader-start', 'loader-end']
      .map(phase => [phase, at('opentab:initial-' + phase)]));
    const gridReady = at('opentab:grid-ready');
    const elapsed = (end, start) => end === null || start === null ? null : end - start;
    return {
      dcl: nav?.domContentLoadedEventEnd ?? null, gridReady, phases,
      navigation: nav ? { responseEnd: nav.responseEnd, domInteractive: nav.domInteractive,
        domContentLoadedEventStart: nav.domContentLoadedEventStart, domContentLoadedEventEnd: nav.domContentLoadedEventEnd } : null,
      startupDiagnostics: globalThis.__startupDiagnostics || null,
      layoutAtGridReady: globalThis.__layoutAtGridReady || null,
      calendarBuilds: performance.getEntriesByName('opentab:calendar-build-start').length,
      flatpickrType: typeof globalThis.flatpickr, locale: globalThis.OpenTabI18n?.locale,
      chineseLocaleLoaded: !!globalThis.flatpickr?.l10ns?.zh,
      calendarAssetNodes: [...document.querySelectorAll('script[src], link[rel="stylesheet"]')]
        .map(el => new URL(el.src || el.href).pathname).filter(name => name.startsWith('/vendor/flatpickr/')),
      calendarStyleLoaded: [...document.styleSheets].some(sheet => sheet.href?.endsWith('/vendor/flatpickr/flatpickr.min.css') && sheet.cssRules.length > 0),
      durations: { readWait: elapsed(phases['read-end'], phases['read-start']),
        validation: elapsed(phases.validated, phases['read-end']), loaderToGrid: elapsed(gridReady, phases['loader-start']) },
      resources: performance.getEntriesByType('resource').filter(entry => {
        const url = new URL(entry.name);
        return url.protocol === location.protocol && url.host === location.host && /\.(?:js|css)$/.test(url.pathname);
      }).map(entry => ({ path: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd, duration: entry.duration }))
    };
  });
}
async function startup(page, home, record) {
  const started = Date.now();
  try {
    await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#time', { timeout: 10000 });
    await page.waitForSelector('#add-shortcut-tile', { timeout: 10000 });
    await page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0, null, { timeout: 10000 });
  } finally {
    record.startupWallMs = Date.now() - started;
    record.startup = await collectStartup(page).catch(error => ({ collectionError: errorText(error) }));
  }
}
async function interactionReady(page) {
  await page.waitForFunction(() => performance.getEntriesByName('opentab:initial-loader-end').length > 0
    && document.querySelector('#icons-container[data-grid-bound="1"]')
    && document.getElementById('homepage')?.inert === false, null, { timeout: 10000 });
}
function validateStartup(record) {
  const s = record.startup;
  check(record, Number.isFinite(s.gridReady) && s.gridReady > 0 && s.gridReady <= GRID_READY_BUDGET_MS, `grid-ready ${s.gridReady} ms must be in (0, 500]`);
  check(record, Number.isFinite(s.dcl) && s.dcl > 0 && s.dcl <= GRID_READY_BUDGET_MS, `DCL ${s.dcl} ms must be in (0, 500]`);
  check(record, s.calendarBuilds === 0, 'hidden calendar must not be constructed during startup');
  check(record, !!s.layoutAtGridReady && !!s.startupDiagnostics?.layoutSnapshot, 'unchanged grid-ready computed-style snapshot must be captured');
  check(record, s.startupDiagnostics?.installed?.storageGet === true, 'native storage diagnostic hook must install');
  check(record, s.startupDiagnostics?.truncated === false, 'startup diagnostics must not truncate');
  for (const phase of ['read-start', 'read-end', 'validated', 'loader-start']) check(record, Number.isFinite(s.phases?.[phase]), `${phase} timing must be observed`);
  // Extension ResourceTiming may be empty. Retain it, but corroborate with the
  // existing native load diagnostics and real DOM/evaluated-resource state.
  const paths = [...(s.resources || []).map(entry => entry.path),
    ...(s.startupDiagnostics?.events || []).filter(event => event.type === 'resource-load').map(event => event.path),
    ...(s.calendarAssetNodes || [])];
  if (record.variant === 'candidate') {
    check(record, ASSETS.every(asset => !paths.includes(asset)), 'candidate must defer every Flatpickr resource/node before opening');
    check(record, s.flatpickrType === 'undefined' && !s.calendarStyleLoaded, 'candidate must not evaluate Flatpickr or load vendor CSS before opening');
  } else {
    check(record, ASSETS.every(asset => paths.includes(asset)), 'baseline must retain all eager Flatpickr resource nodes');
    check(record, s.flatpickrType === 'function' && s.chineseLocaleLoaded && s.calendarStyleLoaded, 'baseline core, Chinese locale and vendor styles must genuinely load');
  }
}

// A passive capture listener records the real trusted click. The first rAF with
// genuine loaded vendor CSS + 42 rendered days is an observed styled-ready bound,
// NOT a new production mark. Real navigation/selection below prove interactivity.
async function armFirstOpen(page) {
  await page.evaluate(() => {
    globalThis.__calendarFirstOpen = null;
    document.getElementById('date').addEventListener('click', () => {
      const start = performance.now();
      globalThis.__calendarFirstOpen = { start };
      function sample() {
        const calendar = document.querySelector('#calendar-popover:not(.hidden) .flatpickr-calendar');
        const day = calendar?.querySelector('.flatpickr-day');
        const sheet = [...document.styleSheets].find(sheet => sheet.href?.endsWith('/vendor/flatpickr/flatpickr.min.css'));
        const rect = calendar?.getBoundingClientRect();
        if (sheet?.cssRules.length && calendar && day && calendar.querySelectorAll('.flatpickr-day').length === 42
          && rect.width > 200 && rect.height > 200 && getComputedStyle(day).height === '40px'
          && getComputedStyle(day).borderRadius === '9px' && document.getElementById('calendar-input')._flatpickr) {
          __calendarFirstOpen.styledReady = performance.now();
          __calendarFirstOpen.clickToStyledMs = __calendarFirstOpen.styledReady - start;
        } else if (performance.now() - start < 12000) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }, { once: true, capture: true });
  });
}
async function verifyOpen(page, locale, screenshotName, measure = true) {
  if (measure) await armFirstOpen(page);
  await page.locator('#date').click();
  if (measure) await page.waitForFunction(() => Number.isFinite(globalThis.__calendarFirstOpen?.styledReady), null, { timeout: 13000 });
  await page.locator('#calendar-popover:not(.hidden) .flatpickr-calendar').waitFor({ state: 'visible' });
  const initial = await page.evaluate(() => {
    const picker = document.getElementById('calendar-input')._flatpickr;
    return { ...globalThis.__calendarFirstOpen, locale: picker.config.locale, weekday: picker.l10n.weekdays.shorthand[0],
      month: picker.currentMonth, year: picker.currentYear, selectedDay: picker.selectedDates[0]?.getDate(),
      dayCount: document.querySelectorAll('.flatpickr-day').length,
      annotations: [...document.querySelectorAll('.fp-meta')].map(el => el.textContent),
      assetNodes: [...document.querySelectorAll('script[src], link[rel="stylesheet"]')]
        .map(el => el.src || el.href).filter(url => url.includes('/vendor/flatpickr/')),
      cspViolations: __calendarCspViolations };
  });
  assert.equal(initial.locale, locale === 'en-US' ? 'default' : 'zh');
  assert.equal(initial.weekday, locale === 'en-US' ? 'Sun' : '周日');
  assert.equal(initial.dayCount, 42);
  assert.equal(initial.annotations.length === 0, locale === 'en-US', 'only Chinese has solar-term/holiday annotations');
  assert.equal(initial.assetNodes.length, 3, 'one CSS, one core script and one Chinese locale script');
  assert.equal(new Set(initial.assetNodes).size, 3, 'calendar assets cannot be duplicated');
  await page.screenshot({ path: path.join(ARTIFACTS, screenshotName), fullPage: false, timeout: 5000 });
  await page.locator('.flatpickr-next-month').click();
  await page.waitForFunction(month => document.getElementById('calendar-input')._flatpickr.currentMonth === (month + 1) % 12, initial.month);
  await page.locator('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)').first().click();
  assert.equal(await page.evaluate(() => document.getElementById('calendar-input')._flatpickr.selectedDates[0].getDate()), 1, 'native day click changes selection');
  const builds = await page.evaluate(() => performance.getEntriesByName('opentab:calendar-build-start').length);
  assert.equal(builds, 1, 'only one picker is built');
  await page.keyboard.press('Escape');
  await page.locator('#calendar-popover').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'date', 'Escape restores date focus');
  await page.locator('#date').click();
  await page.locator('#calendar-popover .flatpickr-calendar').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => performance.getEntriesByName('opentab:calendar-build-start').length), builds, 'reopen reuses the picker');
  initial.interactionVerifiedAt = await page.evaluate(() => performance.now());
  initial.interactionComplete = true;
  return initial;
}
async function collectEnd(page, record) {
  record.cspViolations = await page.evaluate(() => globalThis.__calendarCspViolations || []).catch(() => []);
  record.finalResources = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => entry.name.includes('/vendor/flatpickr/'))
    .map(entry => ({ path: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd, duration: entry.duration }))).catch(() => []);
}
async function runSample(plan, extension) {
  const record = { ...plan, failures: [], startedAt: new Date().toISOString() };
  const name = `sample-${String(plan.order).padStart(2, '0')}-${plan.variant}`;
  save(`${name}.json`, record); // Preserve even a browser-launch failure.
  let browser, activeContext;
  const deadline = setTimeout(() => {
    record.failures.push('25-second observation deadline exceeded; no retry or replacement sample');
    activeContext?.close().catch(() => {});
  }, 25000);
  try {
    browser = await launch(extension, plan.locale, record, context => { activeContext = context; });
    await startup(browser.page, browser.home, record);
    validateStartup(record);
    save(`${name}.json`, record); // Slow samples remain available before interaction checks.
    await interactionReady(browser.page);
    record.calendar = await verifyOpen(browser.page, plan.locale, `${name}-calendar.png`);
    await collectEnd(browser.page, record);
    check(record, record.cspViolations.length === 0, 'native manifest CSP must allow all packaged calendar assets');
    check(record, record.pageErrors.length === 0, `page errors: ${record.pageErrors.join(' | ')}`);
    check(record, unexpectedErrors(record.consoleErrors).length === 0, `unexpected console errors: ${unexpectedErrors(record.consoleErrors).join(' | ')}`);
    check(record, !record.failedRequests.some(request => request.url.startsWith('chrome-extension://')), 'local extension resource requests must not fail');
  } catch (error) {
    record.failures.push(errorText(error));
    if (browser) {
      record.calendar ||= await browser.page.evaluate(() => globalThis.__calendarFirstOpen
        ? { ...globalThis.__calendarFirstOpen, interactionComplete: false } : null).catch(() => null);
      await collectEnd(browser.page, record);
      await browser.page.screenshot({ path: path.join(ARTIFACTS, `${name}-failure.png`), timeout: 3000 }).catch(() => {});
    }
  } finally {
    clearTimeout(deadline);
    if (browser) await browser.close().catch(error => record.failures.push(`close: ${errorText(error)}`));
    record.finishedAt = new Date().toISOString(); save(`${name}.json`, record);
  }
  console.log(JSON.stringify({ order: record.order, variant: record.variant, locale: record.locale,
    gridReady: record.startup?.gridReady, dcl: record.startup?.dcl, clickToStyled: record.calendar?.clickToStyledMs, failures: record.failures }));
  return record;
}

// Faults are separate, untimed profiles. They alter only the transport boundary:
// real nodes are delayed or pointed at a genuinely missing local file. No fake
// Flatpickr, API promise, load/error event, readiness signal, or timer is installed.
async function injectTransport(page, mode) {
  await page.evaluate(mode => {
    const head = document.head, nativeAppend = head.appendChild;
    const state = globalThis.__calendarTransport = { held: [], interceptions: 0, mode };
    head.appendChild = function (node) {
      if (node.tagName === 'SCRIPT' && node.src.endsWith('/vendor/flatpickr/flatpickr.min.js')) {
        state.interceptions++; head.appendChild = nativeAppend;
        if (mode === 'delay') { state.held.push(node); return node; }
        node.src = 'vendor/flatpickr/missing-transport-fixture.js';
      }
      return Reflect.apply(nativeAppend, this, [node]);
    };
    state.release = () => { for (const node of state.held.splice(0)) Reflect.apply(nativeAppend, head, [node]); };
  }, mode);
}
async function runSemantic(extension, locale, scenario) {
  const record = { locale, scenario, failures: [], startedAt: new Date().toISOString() };
  const name = `semantic-${locale}-${scenario}`;
  save(`${name}.json`, record);
  let browser, activeContext;
  const deadline = setTimeout(() => {
    record.failures.push('35-second native semantic deadline exceeded');
    activeContext?.close().catch(() => {});
  }, 35000);
  try {
    browser = await launch(extension, locale, record, context => { activeContext = context; });
    const { page, home } = browser;
    await startup(page, home, record); await interactionReady(page);
    assert.equal(unexpectedErrors(record.consoleErrors).length, 0, 'fault fixture startup must have no unexpected console errors');
    if (scenario === 'csp') {
      // A real additional document CSP, installed only after production startup,
      // rejects the genuine lazy script. Manifest policy is never weakened.
      await page.evaluate(() => {
        const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy';
        meta.content = "script-src 'none'"; document.head.appendChild(meta);
      });
    } else await injectTransport(page, scenario === 'missing' ? 'missing' : 'delay');
    await page.locator('#date').click();
    if (scenario.startsWith('delay')) {
      await page.waitForFunction(() => __calendarTransport.held.length === 1);
      await page.locator('#calendar-load-status').waitFor({ state: 'visible' });
      assert.match(await page.locator('#calendar-load-status').textContent(), locale === 'en-US' ? /Loading/ : /加载/);
      await page.keyboard.press('Escape');
      await page.locator('#calendar-popover').waitFor({ state: 'hidden' });
      if (scenario === 'delay-reopen') await page.locator('#date').click();
      await page.evaluate(() => __calendarTransport.release());
      await page.waitForFunction(() => OpenTabCalendarAssets.isReady());
      if (scenario === 'delay-close') {
        assert.equal(await page.locator('#calendar-popover').isVisible(), false, 'late assets cannot reopen a dismissed popover');
        assert.equal(await page.locator('.flatpickr-calendar').count(), 0, 'late assets cannot build a hidden picker');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'date', 'late completion cannot steal focus');
      } else {
        await page.locator('#calendar-popover .flatpickr-calendar').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => performance.getEntriesByName('opentab:calendar-build-start').length), 1, 'latest open intent creates exactly one picker');
        await page.keyboard.press('Escape');
      }
      record.calendar = await verifyOpen(page, locale, `${name}.png`, false);
      assert.equal(unexpectedErrors(record.consoleErrors).length, 0, record.consoleErrors.join(' | '));
    } else {
      await page.waitForFunction(() => !document.getElementById('calendar-load-status').hidden
        && /retry|重试/.test(document.getElementById('calendar-load-status').textContent));
      assert.equal(await page.locator('.flatpickr-calendar').count(), 0);
      record.failureStatus = await page.locator('#calendar-load-status').textContent();
      await page.screenshot({ path: path.join(ARTIFACTS, `${name}-error.png`), timeout: 5000 });
      await collectEnd(page, record);
      if (scenario === 'csp') {
        assert.ok(record.cspViolations.some(event => event.directive.startsWith('script-src') && event.blockedURI.includes('/vendor/flatpickr/')), 'real Chromium CSP violation must be observed');
      } else {
        assert.ok(record.failedRequests.some(request => request.url.endsWith('/missing-transport-fixture.js'))
          || record.consoleErrors.some(error => error.includes('/missing-transport-fixture.js') && /ERR_FILE_NOT_FOUND|Failed to load resource/.test(error)),
        'real missing local resource must fail');
        await page.keyboard.press('Escape');
        record.calendar = await verifyOpen(page, locale, `${name}-retry.png`);
      }
    }
    await collectEnd(page, record);
    assert.equal(record.pageErrors.length, 0, record.pageErrors.join(' | '));
    // Expected native CSP/ERR_FILE_NOT_FOUND errors are retained and allowed
    // only for the exact injected target. Other local/CSP errors still fail.
    const expectedFault = error => scenario === 'missing'
      ? error.includes('/missing-transport-fixture.js') && /ERR_FILE_NOT_FOUND|Failed to load resource/.test(error)
      : scenario === 'csp' && error.includes('/vendor/flatpickr/flatpickr.min.js') && /Content Security Policy|content security policy/.test(error);
    assert.deepEqual(unexpectedErrors(record.consoleErrors).filter(error => !expectedFault(error)), []);
    const expectedRequest = request => scenario === 'missing' ? request.url.endsWith('/missing-transport-fixture.js')
      : scenario === 'csp' && request.url.endsWith('/vendor/flatpickr/flatpickr.min.js');
    assert.deepEqual(record.failedRequests.filter(request => request.url.startsWith('chrome-extension://') && !expectedRequest(request)), []);
  } catch (error) { record.failures.push(errorText(error)); }
  finally {
    clearTimeout(deadline);
    if (browser) await browser.close().catch(error => record.failures.push(errorText(error)));
    record.finishedAt = new Date().toISOString(); save(`${name}.json`, record);
  }
  console.log(JSON.stringify({ semantic: name, failures: record.failures }));
  return record;
}

export async function main() {
  assert.equal(process.env.CI, 'true', 'native experiment runs only in the dedicated CI job');
  const baseline = path.resolve(process.env.CALENDAR_BASELINE_PATH || '');
  const expectedCandidate = process.env.CALENDAR_CANDIDATE_SHA;
  assert.match(expectedCandidate || '', /^[a-f0-9]{40}$/);
  assert.equal(git(baseline, 'rev-parse', 'HEAD'), BASELINE_SHA, 'baseline checkout must be exact pinned SHA');
  assert.equal(git(ROOT, 'rev-parse', 'HEAD'), expectedCandidate, 'candidate checkout must be the commit under test');
  for (const checkout of [baseline, ROOT]) assert.equal(git(checkout, 'status', '--porcelain', '--untracked-files=no'), '', 'measured tracked trees must be unchanged');
  assert.equal(fs.readFileSync(path.join(baseline, 'tests/startup-diagnostics.mjs'), 'utf8'), fs.readFileSync(path.join(ROOT, 'tests/startup-diagnostics.mjs'), 'utf8'), 'both variants use the identical existing startup diagnostic');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const report = { baselineSha: BASELINE_SHA, candidateSha: expectedCandidate,
    environment: { node: process.version, platform: os.platform(), release: os.release(),
      cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
    fixture: 'AC7 fresh-profile first home navigation; no storage seeding, warm-up, or production readiness changes',
    caveats: ['Cold Chromium processes/profiles, not cold OS filesystem caches.',
      'Alternating matched pairs share one dedicated runner, with five pairs per locale.',
      'API intervals include browser scheduling/IPC and cannot isolate disk I/O.',
      'Computed-style snapshot overhead is included in unchanged 500 ms gates, never subtracted.',
      'First-open latency ends at first styled rAF observation; real clicks separately verify interactivity.',
      'All failures and outliers are retained. Missing measurements have explicit denominators; no performance significance claim.'],
    plan: samplePlan(), samples: [], semantics: [] };
  save('report.json', report);
  for (const plan of report.plan) {
    report.samples.push(await runSample(plan, plan.variant === 'baseline' ? baseline : ROOT));
    report.summary = summarizeSamples(report.samples); save('report.json', report);
  }
  // Native fault semantics never run inside or between the 20 timing samples.
  for (const locale of ['zh-CN', 'en-US']) for (const scenario of ['delay-close', 'delay-reopen', 'missing', 'csp']) {
    report.semantics.push(await runSemantic(ROOT, locale, scenario)); save('report.json', report);
  }
  report.failedObservations = [...report.samples, ...report.semantics].filter(record => record.failures.length).length;
  report.completed = true; save('report.json', report);
  console.log('Matched experiment summary: ' + JSON.stringify(report.summary));
  assert.equal(report.samples.length, 20, 'all 20 attempts must be retained');
  if (report.failedObservations) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
