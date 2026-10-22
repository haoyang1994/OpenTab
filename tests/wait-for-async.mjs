import { setTimeout as delay } from 'node:timers/promises';

// Playwright's waitForFunction tests a returned Promise's truthiness before it
// settles. Poll in Node so an async predicate must actually resolve to true.
export async function waitForAsync(page, predicate, arg, { timeout = 10000, interval = 25 } = {}) {
  const deadline = performance.now() + timeout;
  do {
    if (await page.evaluate(predicate, arg) === true) return;
    if (performance.now() >= deadline) break;
    await delay(Math.min(interval, Math.max(0, deadline - performance.now())));
  } while (performance.now() < deadline);
  throw new Error(`Async predicate did not resolve to true within ${timeout}ms`);
}
