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
const fix = loadTool('fixparser.js');
fix('input-area').value = '8=FIX.4.4|35=0|10=000|';
fix('parse-btn').handlers.click();
assert.match(fix('timeline-container').innerHTML, /class="timeline-item selected"/);
assert.match(fix('timeline-container').innerHTML, />Heartbeat</);
assert.match(fix('detail-container').innerHTML, /FIX\.4\.4/);
console.log('Package navigation tests passed: nullable response, wrong-document negatives and actual JSON/FIX fixtures');
