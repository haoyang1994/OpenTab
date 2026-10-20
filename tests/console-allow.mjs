const ALLOWED_HOST_RE = /(?:^|\.)((?:example|bing)\.com)$/i;

function hostnameFromUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function hostAllowed(hostname) {
  return ALLOWED_HOST_RE.test(String(hostname || '').toLowerCase());
}

function urlsIn(text) {
  return String(text || '').match(/https?:\/\/[^\s)"']+/gi) || [];
}

export function isAllowedConsoleError(text, url = '') {
  const t = String(text || '');
  const u = String(url || '');
  if (t.includes('Failed to fetch Bing image')) return true;
  if (/favicon\.ico/i.test(t) || /favicon\.ico/i.test(u)) return true;
  if (hostAllowed(hostnameFromUrl(u))) return true;
  const combined = u ? `${t} ${u}` : t;
  for (const found of urlsIn(combined)) {
    if (hostAllowed(hostnameFromUrl(found))) return true;
  }
  return /(?:^|[\s/"'(])(?:https?:\/\/)?(?:[\w-]+\.)*(?:example|bing)\.com(?:[/:?#\s"')]|$)/i.test(combined);
}

export function formatConsoleError(msg) {
  const text = typeof msg === 'string'
    ? msg
    : (msg && typeof msg.text === 'function' ? msg.text() : String(msg || ''));
  let url = '';
  if (msg && typeof msg.location === 'function') {
    try {
      url = msg.location()?.url || '';
    } catch {
      url = '';
    }
  }
  return url ? `${text} (${url})` : text;
}

export function unexpectedErrors(errors) {
  return (errors || []).filter((error) => !isAllowedConsoleError(error));
}
