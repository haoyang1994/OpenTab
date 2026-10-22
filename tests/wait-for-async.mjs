import { setTimeout as delay } from 'node:timers/promises';

// Playwright's waitForFunction tests a returned Promise's truthiness before it
// settles. Poll in Node so an async predicate must actually resolve to true.
export async function waitForAsync(page, predicate, arg, { timeout = 10000, interval = 25 } = {}) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Async predicate did not resolve to true within ${timeout}ms`)), timeout);
  });
  try {
    while (true) {
      if (await Promise.race([page.evaluate(predicate, arg), expired]) === true) return;
      await Promise.race([delay(interval), expired]);
    }
  } finally {
    clearTimeout(timer);
  }
}
