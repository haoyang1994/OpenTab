import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../calendar-assets.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../home.html', import.meta.url), 'utf8');
assert.ok(!html.includes('href="vendor/flatpickr/') && !html.includes('src="vendor/flatpickr/'), 'calendar vendor resources stay off first-screen critical path');
assert.ok(html.includes('src="calendar-assets.js"'));
function fixture() {
  const nodes = [], homeStyle = {}, timers = new Set();
  const append = node => nodes.push(node);
  const context = { setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); }, document: {
    createElement: tag => ({ tag, remove() { nodes.splice(nodes.indexOf(this), 1); } }),
    querySelector: selector => { assert.equal(selector, 'link[href="home.css"]'); return homeStyle; },
    head: { appendChild: append, insertBefore(node, before) { assert.equal(before, homeStyle); append(node); } }
  } };
  vm.runInNewContext(source, context);
  return { context, nodes, timers, api: context.OpenTabCalendarAssets,
    find: suffix => nodes.find(node => (node.src || node.href).endsWith(suffix)) };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
for (const failed of ['css', 'core', 'locale']) {
  const f = fixture();
  assert.equal(f.nodes.length, 0, 'module evaluation loads no assets');
  const p = f.api.load(), outcome = p.catch(error => error);
  assert.equal(f.api.load(), p, 'concurrent opens share the exact promise');
  assert.equal(f.nodes.length, 2);
  assert.equal(f.find('zh.js'), undefined, 'locale cannot execute before core');
  const css = f.find('.css'), core = f.find('flatpickr.min.js');
  f.context.flatpickr = Object.assign(() => {}, { l10ns: { zh: {} } });
  css[failed === 'css' ? 'onerror' : 'onload']();
  core[failed === 'core' ? 'onerror' : 'onload']();
  await tick();
  if (failed !== 'core') f.find('zh.js')[failed === 'locale' ? 'onerror' : 'onload']();
  const failure = await outcome;
  assert.match(failure.message, /Calendar asset failed/);
  assert.equal(f.api.isReady(), false);
  const successfulNodes = [...f.nodes];
  const retry = f.api.load();
  assert.equal(f.api.load(), retry);
  await tick();
  f.context.flatpickr = Object.assign(() => {}, { l10ns: { zh: {} } });
  if (failed === 'css') f.find('.css').onload();
  else if (failed === 'locale') f.find('zh.js').onload();
  else { f.find('flatpickr.min.js').onload(); await tick(); f.find('zh.js').onload(); }
  await retry;
  assert.equal(f.api.isReady(), true);
  assert.ok(successfulNodes.every(node => f.nodes.includes(node)), 'retry retains successfully loaded assets');
  assert.equal(f.nodes.length, 3, 'only one retained node per asset');
  await f.api.load(); assert.equal(f.nodes.length, 3);
}

{
  const f = fixture(), first = f.api.load().catch(error => error);
  [...f.timers][0]();
  assert.match((await first).message, /timed out/);
  const retry = f.api.load();
  assert.equal(f.nodes.length, 2, 'timeout retry joins unresolved assets without duplicate execution');
  f.context.flatpickr = Object.assign(() => {}, { l10ns: { zh: {} } });
  f.find('.css').onload(); f.find('flatpickr.min.js').onload();
  await tick(); f.find('zh.js').onload(); await retry;
  assert.equal(f.api.isReady(), true);
  assert.equal(f.timers.size, 0);
}
for (const invalid of ['core', 'locale']) {
  const f = fixture(), result = f.api.load().catch(error => error);
  f.find('.css').onload();
  if (invalid === 'locale') f.context.flatpickr = Object.assign(() => {}, { l10ns: {} });
  f.find('flatpickr.min.js').onload(); await tick();
  if (invalid === 'locale') f.find('zh.js').onload();
  assert.match((await result).message, /asset failed/);
  const retry = f.api.load(); await tick();
  f.context.flatpickr = Object.assign(() => {}, { l10ns: { zh: {} } });
  if (invalid === 'core') { f.find('flatpickr.min.js').onload(); await tick(); }
  f.find('zh.js').onload(); await retry;
  assert.equal(f.api.isReady(), true, 'invalid exports are not cached and can be retried');
}
console.log('Calendar assets passed: zero eager loads, single flight, dependency order, CSS cascade, partial failures and retries.');
