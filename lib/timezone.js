(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabTimezone = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ZONES = [
    ['Asia/Shanghai', '北京'], ['America/New_York', '美东'], ['America/Chicago', '美中'], ['UTC', 'UTC'],
    ['Asia/Hong_Kong', '香港'], ['Asia/Tokyo', '东京'], ['Asia/Singapore', '新加坡'], ['Asia/Seoul', '首尔'],
    ['Europe/London', '伦敦'], ['Europe/Paris', '巴黎'], ['Europe/Berlin', '柏林'], ['Europe/Moscow', '莫斯科'],
    ['Asia/Dubai', '迪拜'], ['Asia/Kolkata', '孟买'], ['Asia/Bangkok', '曼谷'], ['Australia/Sydney', '悉尼'],
    ['Pacific/Auckland', '奥克兰'], ['America/Los_Angeles', '洛杉矶'], ['America/Denver', '丹佛'],
    ['America/Sao_Paulo', '圣保罗'], ['Africa/Cairo', '开罗'], ['Pacific/Honolulu', '檀香山'], ['America/Anchorage', '安克雷奇']
  ].map(([id, name]) => ({ id, name }));
  const canonicalZones = new Map(), offsetFormatters = new Map();

  function canonical(zone) {
    if (typeof zone !== 'string' || !zone.trim()) return '';
    if (canonicalZones.has(zone)) return canonicalZones.get(zone);
    try {
      const resolved = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
      canonicalZones.set(zone, resolved); return resolved;
    }
    catch (_) { return ''; }
  }
  function systemZone() {
    try { return canonical(Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC'; }
    catch (_) { return 'UTC'; }
  }
  function preference(value = {}) {
    // A legacy valid string may be an intentional override. Its origin cannot
    // be inferred from the current device zone, so preserve it as fixed.
    if (value.timezoneMode !== 'system' && canonical(value.timezone)) {
      return { timezone: value.timezone, timezoneMode: 'fixed' };
    }
    return { timezone: systemZone(), timezoneMode: 'system' };
  }
  function sameZone(a, b) {
    const resolved = canonical(a);
    return Boolean(resolved) && resolved === canonical(b);
  }
  function offset(zone, date = new Date()) {
    if (!offsetFormatters.has(zone)) offsetFormatters.set(zone, new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' }));
    const part = offsetFormatters.get(zone).formatToParts(date).find(item => item.type === 'timeZoneName').value;
    // Keep familiar UTC+8 labels, but use HH:MM for fractional-hour zones.
    return part.replace(/^GMT$/, 'UTC+0').replace(/^GMT([+-])0?(\d+):00$/, 'UTC$1$2')
      .replace(/^GMT([+-])0?(\d+):/, 'UTC$1$2:');
  }
  function name(zone, translate = value => value) {
    const entry = ZONES.find(item => sameZone(item.id, zone));
    return entry ? translate(entry.name) : zone;
  }
  function label(zone, date = new Date(), translate) {
    return `${name(zone, translate)} (${offset(zone, date)})`;
  }
  function clock(date, value = {}, locale = 'zh-CN') {
    const { timezone } = preference(value), twelve = value.clockFormat !== '24h';
    const options = { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: twelve ? 'h12' : 'h23' };
    if (value.showSeconds) options.second = '2-digit';
    const parts = new Intl.DateTimeFormat(locale, options).formatToParts(date);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).find(part => part.type === 'hour').value);
    return {
      timezone,
      time: parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim(),
      ampm: twelve ? (hour >= 12 ? 'PM' : 'AM') : '',
      date: new Intl.DateTimeFormat(locale, { timeZone: timezone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date)
    };
  }
  return { ZONES, canonical, systemZone, preference, sameZone, offset, name, label, clock };
}));
