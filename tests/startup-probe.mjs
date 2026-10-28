// Diagnostic experiment only: this does not replace or change either 500 ms gate.
// Usage: HEADLESS=false node tests/startup-probe.mjs BASELINE_DIR CANDIDATE_DIR [OUTPUT]
// Both trees use this same harness and the same installed Playwright/browser.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installStartupDiagnostics } from './startup-diagnostics.mjs';

export const BUDGET_MS = 500;
export function buildSchedule() {
  const rows = [];
  // Fixed, counterbalanced order, chosen before observing any result. Four
  // samples per revision/fixture/page-policy cell; no adaptive retries.
  for (let block = 0; block < 2; block++) {
    for (const fixture of block ? ['settings', 'search'] : ['search', 'settings']) {
      for (const pagePolicy of block ? ['settled-install', 'close-unused', 'original'] : ['original', 'close-unused', 'settled-install']) {
        for (const revision of block ? ['candidate', 'baseline', 'baseline', 'candidate'] : ['baseline', 'candidate', 'candidate', 'baseline']) {
          rows.push({ index: rows.length, block, fixture, pagePolicy, revision });
        }
      }
    }
  }
  return rows;
}
export function summarize(samples) {
  const groups = {};
  for (const s of samples) {
    const key = `${s.fixture}/${s.pagePolicy}/${s.revision}`;
    const g = groups[key] ||= { samples: [], errors: 0, budgetFailures: 0, gridReady: [], dcl: [] };
    g.samples.push(s.index);
    if (s.error) g.errors++;
    if (s.timing) {
      g.gridReady.push(s.timing.gridReady);
      g.dcl.push(s.timing.dcl);
      if (!s.budgetPassed) g.budgetFailures++;
    }
  }
  for (const g of Object.values(groups)) {
    for (const key of ['gridReady', 'dcl']) {
      const values = g[key].filter(Number.isFinite).sort((a, b) => a - b);
      g[`${key}Median`] = values.length ? (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2 : null;
      g[`${key}Range`] = values.length ? [values[0], values.at(-1)] : null;
    }
  }
  return groups;
}
function machine() {
  return { load: os.loadavg(), freeMemory: os.freemem(), cpus: os.cpus().map(c => ({ model: c.model, speed: c.speed, times: c.times })) };
}
function commit(dir) {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
async function measure(chromium, row, extensionPath, tracePath = null) {
  const result = { ...row, extensionPath, before: machine(), startedAt: new Date().toISOString(), profile: 'fresh temporary persistent profile', pageEvents: [] };
  let context, cdp;
  let tracing = false;
  const start = performance.now();
  try {
    context = await chromium.launchPersistentContext('', {
      locale: 'zh-CN', headless: process.env.HEADLESS === 'true',
      ...(row.fixture === 'settings' ? { viewport: { width: 1280, height: 800 } } : {}),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox', '--disable-dev-shm-usage']
    });
    result.browserVersion = context.browser()?.version() ?? null;
    result.initialPagesAtLaunch = context.pages().map(p => p.url());
    const observe = page => {
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) result.pageEvents.push({ at: performance.now() - start, type: 'navigation', url: frame.url() });
      });
      page.on('close', () => result.pageEvents.push({ at: performance.now() - start, type: 'close' }));
    };
    context.pages().forEach(observe);
    context.on('page', observe);
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    if (row.pagePolicy === 'settled-install') {
      const installStart = performance.now();
      result.installBarrier = await worker.evaluate(async () => {
        // Observe default initialization without writing storage or navigating
        // the app. Register first, then read, so completion cannot be missed.
        const observation = await new Promise((resolve, reject) => {
          let timer;
          const finish = (error, source) => {
            clearTimeout(timer);
            chrome.storage.onChanged.removeListener(changed);
            if (error) reject(error); else resolve(source);
          };
          const changed = (changes, area) => {
            if (area === 'local' && changes.icons && changes.icons.newValue !== undefined) finish(null, 'storage-change');
          };
          chrome.storage.onChanged.addListener(changed);
          timer = setTimeout(() => finish(new Error('Install defaults not observed within 10 seconds')), 10000);
          chrome.storage.local.get('icons', data => {
            if (chrome.runtime.lastError) finish(new Error(chrome.runtime.lastError.message));
            else if (data.icons !== undefined) finish(null, 'storage-read');
          });
        });
        // The defaults write may resolve before the transaction releases its
        // lock. Queue behind it rather than sleeping or guessing completion.
        await navigator.locks.request('opentab-workspace-v1', { mode: 'exclusive', signal: AbortSignal.timeout(10000) }, () => undefined);
        return { observation, workspaceLockReleased: true };
      });
      result.installBarrierMs = performance.now() - installStart;
      result.profile = 'fresh profile; cold page navigation after observed install defaults and workspace-lock barrier';
    }
    const homeUrl = `chrome-extension://${worker.url().split('/')[2]}/home.html`;
    const initialPages = context.pages();
    result.initialPagesBeforeSetup = initialPages.map(p => p.url());
    // Use newPage in BOTH cells. The only treatment is closing the otherwise
    // unused initial page(s), before measured navigation; no app warm-up,
    // storage clearing/seeding, timing subtraction, or artificial readiness.
    const page = await context.newPage();
    if (row.pagePolicy === 'close-unused') {
      for (const unused of initialPages) await unused.close();
    }
    if (row.fixture === 'settings') await page.addInitScript(installStartupDiagnostics);
    result.consoleErrors = [];
    page.on('pageerror', e => result.consoleErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
    result.pagesBeforeNavigation = context.pages().map(p => p.url());
    if (tracePath) {
      cdp = await context.newCDPSession(page);
      await cdp.send('Tracing.start', {
        categories: '-*,devtools.timeline,v8.execute,disabled-by-default-v8.compile',
        transferMode: 'ReturnAsStream'
      });
      tracing = true;
    }
    const navStart = performance.now();
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#time', { timeout: 10000 });
    if (row.fixture === 'search') {
      await page.waitForSelector('#search-input', { timeout: 10000 });
      await page.waitForFunction(() => window.OpenTabSearch && typeof window.OpenTabSearch.resolve === 'function');
    } else {
      await page.waitForSelector('#add-shortcut-tile', { timeout: 10000 });
    }
    await page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0, null, { timeout: 10000 });
    result.wallMs = performance.now() - navStart;
    result.timing = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return {
        dcl: n?.domContentLoadedEventEnd ?? null,
        gridReady: performance.getEntriesByName('opentab:grid-ready')[0]?.startTime ?? null,
        navigation: n?.toJSON() ?? null,
        marks: performance.getEntriesByType('mark').filter(e => e.name.startsWith('opentab:')).map(e => ({ name: e.name, at: e.startTime })),
        diagnostics: window.__startupDiagnostics ?? null,
        resources: performance.getEntriesByType('resource').map(e => ({ name: e.name, start: e.startTime, end: e.responseEnd, duration: e.duration })),
        calendarBuilds: performance.getEntriesByName('opentab:calendar-build-start').length,
        visibility: document.visibilityState
      };
    });
    result.budgetPassed = result.timing.gridReady !== null && result.timing.gridReady <= BUDGET_MS && result.timing.dcl > 0 && result.timing.dcl <= BUDGET_MS;
    result.pagesAfterGrid = [];
    for (const p of context.pages()) {
      result.pagesAfterGrid.push(await p.evaluate(() => ({ url: location.href, visibility: document.visibilityState, timeOrigin: performance.timeOrigin, gridReady: performance.getEntriesByName('opentab:grid-ready')[0]?.startTime ?? null })).catch(e => ({ error: e.message })));
    }
  } catch (error) {
    result.error = error.stack || String(error);
  } finally {
    if (tracing) {
      try {
        const completed = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Trace completion timeout')), 10000);
          cdp.once('Tracing.tracingComplete', value => { clearTimeout(timer); resolve(value); });
        });
        await cdp.send('Tracing.end');
        const { stream } = await completed;
        const fd = fs.openSync(tracePath, 'w');
        try {
          while (true) {
            const chunk = await cdp.send('IO.read', { handle: stream, size: 1024 * 1024 });
            fs.writeSync(fd, chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
            if (chunk.eof) break;
          }
        } finally { fs.closeSync(fd); await cdp.send('IO.close', { handle: stream }); }
        result.tracePath = tracePath;
      } catch (error) { result.traceError = error.stack || String(error); }
    }
    if (context) await context.close().catch(error => { result.closeError = String(error); });
    result.after = machine();
    result.elapsedMs = performance.now() - start;
  }
  return result;
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 && process.env.STARTUP_BASELINE_PATH) args = [process.env.STARTUP_BASELINE_PATH, process.env.STARTUP_CANDIDATE_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')];
  if (args.length < 2 || args.length > 3) throw new Error('Usage: startup-probe.mjs BASELINE_DIR CANDIDATE_DIR [OUTPUT]');
  const paths = { baseline: path.resolve(args[0]), candidate: path.resolve(args[1]) };
  const output = path.resolve(args[2] || 'artifacts/startup-probe.json');
  const report = {
    purpose: 'Diagnostic only; existing search/settings 500 ms assertions remain authoritative. Every planned sample is retained, including failures. Medians do not waive failed samples.',
    limits: 'Fresh browser profiles, not a cold OS file cache. No prewarm. Closing unused pages changes only fixture page count. Observational diagnostics cannot by themselves isolate CPU, disk, IPC, and scheduler costs.',
    budgetMs: BUDGET_MS, platform: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version },
    revisions: Object.fromEntries(Object.entries(paths).map(([label, dir]) => [label, { path: dir, commit: commit(dir) }])),
    schedule: buildSchedule(), samples: []
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const save = () => { report.summary = summarize(report.samples); fs.writeFileSync(output, JSON.stringify(report, null, 2)); };
  save();
  const { chromium } = await import('playwright');
  for (const row of report.schedule) {
    const sample = await measure(chromium, row, paths[row.revision]);
    report.samples.push(sample);
    save();
    console.log(JSON.stringify({ index: row.index, fixture: row.fixture, policy: row.pagePolicy, revision: row.revision, dcl: sample.timing?.dcl, gridReady: sample.timing?.gridReady, budgetPassed: sample.budgetPassed, error: sample.error }));
  }
  // Tracing has nontrivial overhead. Keep these separate from the fixed
  // untraced timing samples and never use them to decide the 500 ms gate.
  report.traces = [];
  for (const revision of ['baseline', 'candidate']) {
    const tracePath = output.replace(/\.json$/, '') + `-trace-${revision}.json`;
    const traced = await measure(chromium, { fixture: 'settings', pagePolicy: 'original', revision, traceOnly: true }, paths[revision], tracePath);
    report.traces.push(traced);
    save();
  }
  report.completed = report.samples.length === report.schedule.length;
  save();
  console.log(JSON.stringify(report.summary, null, 2));
  // A diagnostic budget failure is reported, not treated as acceptance success.
  // Harness failures fail this invocation; canonical suites enforce the budget.
  if ([...report.samples, ...report.traces].some(s => s.error || s.closeError || s.traceError)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
