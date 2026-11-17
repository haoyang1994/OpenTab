// Development-only storage adapter. Runtime UI, layout, renderer and coordinator
// code are served unchanged. This does not replace installed-extension testing.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function startWidgetWebFixture(root, context) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/__blank') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html>'); return; }
      const file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await context.addInitScript(() => {
    const listeners = [], storageKey = 'opentab-test-store';
    const all = () => JSON.parse(localStorage.getItem(storageKey) || '{}');
    const emit = changes => { for (const f of listeners) f(changes, 'local'); };
    const area = {
      get(keys, callback) { const data = all(), result = keys == null ? data : Object.fromEntries((typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)).map(key => [key, data[key] ?? (typeof keys === 'object' && !Array.isArray(keys) ? keys[key] : undefined)]).filter(([, value]) => value !== undefined)); callback?.(result); return Promise.resolve(result); },
      set(patch, callback) { const data = all(), changes = {}; for (const [key, value] of Object.entries(patch)) { if (JSON.stringify(data[key]) !== JSON.stringify(value)) changes[key] = { oldValue: data[key], newValue: value }; data[key] = value; } localStorage.setItem(storageKey, JSON.stringify(data)); queueMicrotask(() => { if (Object.keys(changes).length) emit(changes); callback?.(); }); return Promise.resolve(); },
      clear(callback) { localStorage.setItem(storageKey, '{}'); callback?.(); return Promise.resolve(); },
      remove(keys, callback) { const data = all(); for (const key of [].concat(keys)) delete data[key]; localStorage.setItem(storageKey, JSON.stringify(data)); callback?.(); return Promise.resolve(); }
    };
    window.chrome = { runtime: { id: 'opentab-web-test', getURL: p => new URL(p, location.origin).href, getManifest: () => ({ version: '1.1.0' }), sendMessage: (_, cb) => cb?.({ ok: false }) }, storage: { local: area, sync: area, session: area, onChanged: { addListener: f => listeners.push(f), removeListener: f => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } } }, tabs: { create: async () => ({}) }, commands: { getAll: cb => cb?.([]) } };
    addEventListener('storage', event => { if (event.key !== storageKey) return; const before = JSON.parse(event.oldValue || '{}'), after = JSON.parse(event.newValue || '{}'), changes = {}; for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { oldValue: before[key], newValue: after[key] }; emit(changes); });
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
