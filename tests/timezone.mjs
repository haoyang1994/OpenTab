import assert from 'node:assert/strict';

// Freeze only the wall-clock input this test controls. Playwright's full clock
// replaces Performance entries too, which would hide the real grid-ready mark.
// Keep browser timers, performance and Intl native, including OS-zone changes.
export function installTimezoneWallClock(initialTime) {
  const NativeDate = globalThis.Date, key = 'opentab.timezone-test-clock.v1';
  let time = initialTime;
  const valid = value => Number.isFinite(value) && Number.isFinite(new NativeDate(value).getTime());
  try {
    const saved = sessionStorage.getItem(key);
    if (saved !== null && valid(Number(saved))) time = Number(saved);
  } catch (_) { /* A new document can start without session storage. */ }
  if (!valid(time)) throw new TypeError('Invalid timezone fixture time');
  function FixedDate(...args) {
    if (!new.target) return new NativeDate(time).toString();
    return Reflect.construct(NativeDate, args.length ? args : [time], new.target);
  }
  Object.setPrototypeOf(FixedDate, NativeDate);
  FixedDate.prototype = NativeDate.prototype;
  FixedDate.now = () => time;
  globalThis.Date = FixedDate;
  globalThis.__opentabTimezoneTestClock = {
    setTime(value) {
      if (!valid(value)) throw new TypeError('Invalid timezone fixture time');
      sessionStorage.setItem(key, String(value));
      time = value;
    }
  };
}

// Runs inside first-run's existing extension suite. No extra browser suite or
// readiness/performance exemptions are added.
export async function verifyTimezoneRegression({ launchExt, waitStorage, storageSet, openHome }) {
  const ext = await launchExt(), { page, context, serviceWorker, extensionId } = ext;
  const cdp = await context.newCDPSession(page);
  const system = timezoneId => cdp.send('Emulation.setTimezoneOverride', { timezoneId });
  const setTime = instant => page.evaluate(value => globalThis.__opentabTimezoneTestClock.setTime(value), Date.parse(instant));
  const ready = () => page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0 && document.getElementById('time')?.textContent);
  const removePreference = () => serviceWorker.evaluate(() => chrome.storage.local.remove(['timezone', 'timezoneMode']));
  const matches = async (time, offset, ampm = '') => {
    await page.waitForFunction(({ time, offset, ampm }) => document.getElementById('time').textContent === time
      && document.getElementById('timezone-label').textContent.includes(offset) && document.getElementById('ampm').textContent === ampm, { time, offset, ampm });
  };
  try {
    await waitStorage(serviceWorker, value => Boolean(value.background));
    await system('Asia/Shanghai');
    await page.addInitScript(installTimezoneWallClock, Date.parse('2026-07-15T07:30:00Z'));
    await removePreference(); await storageSet(serviceWorker, { clockFormat: '24h', languagePreference: 'zh-CN' });
    await openHome(page, extensionId); await ready(); await matches('15:30', 'UTC+8');
    await page.click('#timezone-btn');
    assert.equal(await page.locator('.timezone-item[aria-pressed="true"]').getAttribute('data-mode'), 'system');
    await page.locator('.timezone-item[data-tz="Asia/Shanghai"]').click();
    await waitStorage(serviceWorker, value => value.timezone === 'Asia/Shanghai' && value.timezoneMode === 'fixed');
    await system('UTC'); await page.reload(); await ready(); await matches('15:30', 'UTC+8');
    await page.click('#timezone-btn'); await page.locator('.timezone-item[data-mode="system"]').click();
    await waitStorage(serviceWorker, value => value.timezoneMode === 'system');
    await system('America/New_York'); await matches('03:30', 'UTC-4');
    await page.click('#timezone-btn'); await page.locator('.timezone-item[data-tz="America/New_York"]').click();
    assert.equal(await page.locator('#timezone-btn').evaluate(el => document.activeElement === el), true, 'timezone choice restores keyboard focus');
    await waitStorage(serviceWorker, value => value.timezoneMode === 'fixed' && value.timezone === 'America/New_York');
    await system('UTC'); await matches('03:30', 'UTC-4');
    await setTime('2026-01-15T07:30:00Z'); await matches('02:30', 'UTC-5');
    await page.reload(); await ready(); await matches('02:30', 'UTC-5');
    await page.click('#timezone-btn'); await page.locator('.timezone-item[data-mode="system"]').click();
    await waitStorage(serviceWorker, value => value.timezoneMode === 'system');
    await page.reload(); await ready(); await matches('07:30', 'UTC+0');

    for (const timezone of ['US/Eastern', 'Etc/UTC', 'Asia/Calcutta', 'Europe/Warsaw']) {
      await storageSet(serviceWorker, { timezone, timezoneMode: 'fixed' }); await page.reload(); await ready();
      await page.click('#timezone-btn');
      const choice = await page.locator('.timezone-item[aria-pressed="true"]').evaluate(el => ({ zone: el.dataset.tz, focused: document.activeElement === el }));
      assert.equal(choice.focused, true);
      assert.equal(new Intl.DateTimeFormat('en', { timeZone: choice.zone }).resolvedOptions().timeZone,
        new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone);
      await page.keyboard.press('Escape');
    }
    await setTime('2026-12-31T16:30:00Z');
    for (const languagePreference of ['zh-CN', 'en']) for (const clockFormat of ['12h', '24h']) {
      await storageSet(serviceWorker, { timezone: 'Asia/Shanghai', timezoneMode: 'fixed', languagePreference, clockFormat });
      await page.reload(); await ready(); await matches(clockFormat === '12h' ? '12:30' : '00:30', 'UTC+8', clockFormat === '12h' ? 'AM' : '');
      assert.match(await page.locator('#date').textContent(), languagePreference === 'en' ? /January 1, 2027/ : /2027年1月1日/);
    }
    // Seed each corrupt/stale mirror before production scripts, not in a race
    // against the previous document's storage-event mirror writes.
    await page.addInitScript(() => {
      const value = sessionStorage.getItem('timezone-test-mirror');
      if (value) { localStorage.setItem('opentab.boot.v1', value); sessionStorage.removeItem('timezone-test-mirror'); }
    });
    await storageSet(serviceWorker, { timezone: 'Invalid/Zone', timezoneMode: 'fixed' });
    await page.evaluate(() => sessionStorage.setItem('timezone-test-mirror', JSON.stringify({ v: 1, tz: 'Invalid/Zone', tzMode: 'fixed', tzLabel: 'wrong', clockFormat: '24h' })));
    await page.reload(); await ready(); await matches('16:30', 'UTC+0');
    await removePreference();
    await page.evaluate(() => sessionStorage.setItem('timezone-test-mirror', JSON.stringify({ v: 1, tz: 'America/New_York', tzMode: 'fixed', tzLabel: 'wrong', clockFormat: '24h' })));
    await page.reload(); await ready(); await matches('16:30', 'UTC+0');
    await page.click('#timezone-btn');
    assert.equal(await page.locator('.timezone-item[aria-pressed="true"]').getAttribute('data-mode'), 'system');
    assert.equal(ext.errors.page.length, 0, ext.errors.page.join(' | '));
    assert.equal(ext.errors.console.length, 0, ext.errors.console.join(' | '));
    console.log('Timezone native passed: automatic OS changes, fixed/reload persistence, DST, aliases, unlisted zones, locale/date rollover and corrupt/stale boot recovery.');
  } catch (error) {
    const observed = await page.evaluate(() => ({
      url: location.href, readyState: document.readyState,
      time: document.getElementById('time')?.textContent,
      ampm: document.getElementById('ampm')?.textContent,
      label: document.getElementById('timezone-label')?.textContent,
      now: Date.now(), systemTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      marks: performance.getEntriesByType('mark').map(mark => mark.name)
    })).catch(diagnosticError => ({ diagnosticError: String(diagnosticError) }));
    console.error('Timezone native failure context:', JSON.stringify({ observed, errors: ext.errors }));
    throw error;
  } finally { await cdp.detach(); await context.close(); }
}
