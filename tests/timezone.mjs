import assert from 'node:assert/strict';

// Runs inside first-run's existing extension suite. No extra browser suite or
// readiness/performance exemptions are added.
export async function verifyTimezoneRegression({ launchExt, waitStorage, storageSet, openHome }) {
  const ext = await launchExt(), { page, context, serviceWorker, extensionId } = ext;
  const cdp = await context.newCDPSession(page);
  const system = timezoneId => cdp.send('Emulation.setTimezoneOverride', { timezoneId });
  const ready = () => page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length > 0 && document.getElementById('time')?.textContent);
  const removePreference = () => serviceWorker.evaluate(() => chrome.storage.local.remove(['timezone', 'timezoneMode']));
  const matches = async (time, offset, ampm = '') => {
    await page.waitForFunction(({ time, offset, ampm }) => document.getElementById('time').textContent === time
      && document.getElementById('timezone-label').textContent.includes(offset) && document.getElementById('ampm').textContent === ampm, { time, offset, ampm });
  };
  try {
    await waitStorage(serviceWorker, value => Boolean(value.background));
    await system('Asia/Shanghai');
    await page.clock.setFixedTime(new Date('2026-07-15T07:30:00Z'));
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
    await page.clock.setFixedTime(new Date('2026-01-15T07:30:00Z')); await matches('02:30', 'UTC-5');
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
    await page.clock.setFixedTime(new Date('2026-12-31T16:30:00Z'));
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
  } finally { await cdp.detach(); await context.close(); }
}
