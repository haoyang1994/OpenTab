(function (root) {
  'use strict';

  function ymd(now) {
    const d = now instanceof Date ? now : new Date(now);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}${m}${day}`;
  }

  function addDaysYmd(ymdStr, days) {
    const y = Number(ymdStr.slice(0, 4));
    const m = Number(ymdStr.slice(4, 6)) - 1;
    const d = Number(ymdStr.slice(6, 8));
    return ymd(new Date(y, m, d + days));
  }

  function shouldCheck(bgBing, now) {
    const current = now instanceof Date ? now : new Date(now || Date.now());
    if (!bgBing || typeof bgBing !== 'object') return true;
    const today = ymd(current);
    if (bgBing.pinnedDate === today) return false;
    const startdate = String(bgBing.startdate || '');
    if (startdate === today) return false;
    const checkedAt = Number(bgBing.checkedAt) || 0;
    const hourAgo = current.getTime() - 60 * 60 * 1000;
    if (today > startdate && checkedAt >= hourAgo) return false;
    return true;
  }

  function keepSet(entries) {
    const today = ymd(new Date());
    const min = addDaysYmd(today, -8);
    const list = (Array.isArray(entries) ? entries : []).filter((item) => (
      item && item.url && item.startdate && String(item.startdate) >= min
    ));
    const seen = new Set();
    const todayItems = [];
    const rest = [];
    list.forEach((item) => {
      if (seen.has(item.url)) return;
      seen.add(item.url);
      if (String(item.startdate) === today) todayItems.push(item);
      else rest.push(item);
    });
    rest.sort((a, b) => String(b.startdate).localeCompare(String(a.startdate)));
    return todayItems.concat(rest).slice(0, 9);
  }

  const api = { shouldCheck, keepSet, ymd, addDaysYmd };
  root.OpenTabBing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
