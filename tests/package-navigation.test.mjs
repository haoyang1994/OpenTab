import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assertPackagedNavigation } from './package-navigation.mjs';

const id = 'a'.repeat(32);
const url = `chrome-extension://${id}/home.html`;
const document = { url, runtimeId: id, readyState: 'complete' };
assertPackagedNavigation(null, document, url, id);
assertPackagedNavigation({ status: () => 200 }, document, url, id);
assert.throws(() => assertPackagedNavigation({ status: () => 404 }, document, url, id));
assert.throws(() => assertPackagedNavigation(null, { ...document, url: 'about:blank' }, url, id));
assert.throws(() => assertPackagedNavigation(null, { ...document, runtimeId: 'wrong' }, url, id));
assert.throws(() => assertPackagedNavigation(null, { ...document, runtimeId: undefined }, url, id));
assert.throws(() => assertPackagedNavigation(null, { ...document, readyState: 'loading' }, url, id));

// Validate the browser smoke's synthetic fixtures against the actual handlers
// before CI; this is not a substitute for native button clicks in Chromium.
function loadTool(file) {
  const nodes = new Map();
  const getElementById = (key) => {
    if (!nodes.has(key)) nodes.set(key, {
      value: '', innerHTML: '', textContent: '', handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      querySelectorAll() { return []; }
    });
    return nodes.get(key);
  };
  vm.runInNewContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { document: { getElementById } });
  return getElementById;
}
const json = loadTool('tool.js');
json('input-area').value = '{"packaged":true}';
json('format-btn').handlers.click();
assert.deepEqual(JSON.parse(json('output-area').value), { packaged: true });
console.log('Package navigation tests passed: nullable response, wrong-document negatives and actual JSON fixture');

// Execute the actual shortcut resolver: legacy records are retained, never
// redirected to JSON or a missing packaged page. No storage mutation is involved.
const sandbox = { module: { exports: {} }, URL };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../icons.js', import.meta.url), 'utf8'), sandbox);
const href = icon => sandbox.module.exports.targetHref(icon, icon.type, path => `chrome-extension://${id}/${path}`);
const old = { id: 'legacy', type: 'tool', toolSubtype: 'fix-parser', name: 'My FIX shortcut' };
const snapshot = JSON.stringify(old);
assert.equal(href(old), '');
assert.equal(JSON.stringify(old), snapshot);
assert.equal(href({ type: 'tool', toolSubtype: 'json-format' }), `chrome-extension://${id}/tool.html?tool=json-format`);
assert.equal(href({ type: 'url', url: 'https://example.com/' }), 'https://example.com/');
assert.ok(!fs.readFileSync(new URL('../home.html', import.meta.url), 'utf8').includes('value="fix-parser"'));
