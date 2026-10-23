import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const copy = (value) => JSON.parse(JSON.stringify(value));
const TODAY = '20261022';
const IMAGE = 'https://www.bing.com/th?id=today.jpg';
const TIMEOUT_MS = 20000;
const settle = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the production service-worker listener and imports. Network, cache,
// Chrome storage and time are deterministic; no browser or real network runs.
function harness(initial = {}) {
  const hooks = {}, timers = new Map(), requests = [], writes = [], deletes = [], warnings = [];
  const entries = new Map(initial.entries || []), stored = copy(initial.stored || {});
  let now = 0, nextTimer = 0, listener;
  const epoch = Date.parse('2026-10-22T12:00:00Z');
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch + now])); }
    static now() { return epoch + now; }
  }
  const archive = () => ({
    ok: true,
    json: async () => hooks.apiBody ? hooks.apiBody() : ({ images: [{ url: '/th?id=today.jpg', startdate: TODAY, title: 'Today', copyright: 'Bing' }] })
  });
  const image = () => ({
    ok: true,
    clone() { return this; },
    arrayBuffer: async () => hooks.imageBody ? hooks.imageBody() : new Uint8Array([1, 2, 3]).buffer
  });
  const cache = {
    match: async (url) => hooks.match ? hooks.match(url) : entries.get(url),
    put: async (url, response) => {
      // Real Cache.put waits for the whole image body, not merely its headers.
      await response.arrayBuffer();
      if (hooks.put) await hooks.put(url, response);
      entries.set(url, response);
    },
    keys: async () => hooks.keys ? hooks.keys() : [...entries.keys()].map((url) => ({ url })),
    delete: async (request) => {
      deletes.push(request.url);
      if (hooks.delete) await hooks.delete(request);
      return entries.delete(request.url);
    }
  };
  const context = {
    AbortController, URL, Date: TestDate,
    console: { warn: (...args) => warnings.push(args) },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => {
      requests.push({ url, options });
      assert.ok(options.signal, 'every network request must have the operation abort signal');
      if (url.includes('HPImageArchive.aspx')) return hooks.apiFetch ? hooks.apiFetch(url, options) : archive();
      return hooks.imageFetch ? hooks.imageFetch(url, options) : image();
    },
    caches: { open: async () => hooks.open ? hooks.open() : cache },
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: {
        get: async (keys) => hooks.get ? hooks.get(keys) : Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, copy(stored[key])])),
        set: async (value) => {
          writes.push(copy(value));
          if (hooks.set) await hooks.set(value);
          Object.assign(stored, copy(value));
        }
      } }
    },
    importScripts(...names) { names.forEach((name) => vm.runInContext(read(name), context, { filename: name })); }
  };
  vm.createContext(context);
  vm.runInContext(read('background.js'), context, { filename: 'background.js' });
  return {
    hooks, timers, requests, writes, deletes, warnings, entries, stored, archive, image, cache,
    send(action = 'fetchBingImage', extra = {}) {
      const responses = [], done = deferred();
      const keepAlive = listener({ action, ...extra }, {}, (response) => {
        responses.push(copy(response));
        done.resolve(response);
      });
      if (!responses.length) assert.equal(keepAlive, true, 'the service worker must retain the async response channel');
      return { responses, done: done.promise };
    },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) {
        timers.delete(id);
        timer.fn();
      }
      await settle();
    }
  };
}

function assertOnlyMetadataWrites(h) {
  h.writes.forEach((write) => assert.deepEqual(Object.keys(write), ['bingCacheMeta'], 'worker must never select or persist a wallpaper'));
}
async function assertSingleTimeout(h, pending) {
  await h.advance(TIMEOUT_MS - 1);
  assert.equal(pending.responses.length, 0, 'must not expire before the configured total deadline');
  await h.advance(1);
  assert.equal(pending.responses.length, 1, 'hung operations must receive a bounded response');
  assert.deepEqual(pending.responses[0], { success: false, error: 'Bing request timed out', stage: 'timeout' });
  assert.equal(h.timers.size, 0, 'timeout timer must be removed');
  h.requests.forEach(({ options }) => assert.equal(options.signal.aborted, true, 'timeout must abort actual fetch/body work'));
}

// A slow but valid image must not be reported as ready before the body is cached.
for (const stage of ['imageFetch', 'imageBody']) {
  const h = harness(), gate = deferred();
  h.hooks[stage] = () => gate.promise;
  const pending = h.send('fetchBingImage', { index: 7 });
  await settle();
  await h.advance(9000);
  assert.equal(pending.responses.length, 0, `${stage}: no premature success`);
  assert.equal(h.writes.length, 0);
  gate.resolve(stage === 'imageFetch' ? h.image() : new ArrayBuffer(3));
  await pending.done;
  assert.equal(pending.responses[0].success, true);
  assert.equal(pending.responses[0].nextIndex, 0, 'archive index still wraps');
  assert.equal(pending.responses[0].startdate, TODAY);
  assert.equal(pending.responses[0].url, IMAGE);
  assert.equal(h.entries.has(IMAGE), true, 'success means a complete cached image is available');
  assert.equal(h.timers.size, 0, 'successful response cleans deadline timer');
  assert.equal(h.requests[0].options.signal.aborted, false);
  assertOnlyMetadataWrites(h);
  await h.advance(TIMEOUT_MS);
  assert.equal(pending.responses.length, 1, 'no second response after success');
}

// Successive stages share one total budget, rather than resetting a timeout at
// each network call and accidentally exceeding the page's response deadline.
{
  const h = harness(), apiGate = deferred(), imageGate = deferred();
  h.hooks.apiFetch = () => apiGate.promise;
  h.hooks.imageBody = () => imageGate.promise;
  const pending = h.send(); await settle();
  await h.advance(12000);
  apiGate.resolve(h.archive()); await settle();
  assert.equal(h.requests.length, 2);
  await h.advance(7999);
  assert.equal(pending.responses.length, 0);
  await h.advance(1);
  assert.deepEqual(pending.responses, [{ success: false, error: 'Bing request timed out', stage: 'timeout' }]);
  assert.equal(h.timers.size, 0);
  imageGate.reject(new Error('late aborted body')); await settle();
  assert.equal(pending.responses.length, 1, 'a late body rejection remains handled');
  assert.equal(h.writes.length, 0);
}

// Every awaited boundary is under the same deadline, including body/cache work
// that deliberately ignores abort. A late result cannot resume the pipeline.
for (const stage of ['apiFetch', 'apiBody', 'imageFetch', 'imageBody', 'open', 'match', 'put', 'get', 'keys', 'delete', 'set']) {
  const h = harness({ entries: [['https://www.bing.com/expired.jpg', {}]] }), gate = deferred();
  h.hooks[stage] = () => gate.promise;
  const pending = h.send();
  await settle();
  await assertSingleTimeout(h, pending);
  const requestsAtTimeout = h.requests.length, writesAtTimeout = h.writes.length, deletesAtTimeout = h.deletes.length;
  const late = { apiFetch: h.archive(), apiBody: { images: [{ url: '/late.jpg', startdate: TODAY }] }, imageFetch: h.image(),
    imageBody: new ArrayBuffer(3), open: h.cache, match: undefined, put: undefined, get: {}, keys: [], delete: true, set: undefined };
  gate.resolve(late[stage]);
  await settle();
  assert.equal(pending.responses.length, 1, `${stage}: late result cannot respond a second time`);
  assert.equal(h.requests.length, requestsAtTimeout, `${stage}: no follow-on fetch after deadline`);
  assert.equal(h.writes.length, writesAtTimeout, `${stage}: no new metadata write after deadline`);
  assert.equal(h.deletes.length, deletesAtTimeout, `${stage}: no new pruning after deadline`);
  assert.equal(h.timers.size, 0);
  assertOnlyMetadataWrites(h);
}

// Headers, parsing, image body and cache failures must not become false success.
for (const [stage, failure, error] of [
  ['apiFetch', () => ({ ok: false, status: 503 }), /Bing API status 503/],
  ['apiBody', () => ({ images: [] }), /missing image url/],
  ['apiBody', () => { throw new Error('bad JSON'); }, /bad JSON/],
  ['imageFetch', () => ({ ok: false, status: 404 }), /Bing image status 404/],
  ['imageFetch', () => { throw new Error('offline'); }, /offline/],
  ['imageBody', () => { throw new Error('incomplete image body'); }, /incomplete image body/],
  ['put', () => { throw new Error('cache quota'); }, /cache quota/]
]) {
  const h = harness(); h.hooks[stage] = failure;
  const pending = h.send(); await pending.done;
  assert.equal(pending.responses[0].success, false, `${stage}: must report failure`);
  assert.match(pending.responses[0].error, error);
  assert.equal(h.writes.length, 0, `${stage}: failed image must not persist metadata`);
  assert.equal(h.timers.size, 0, `${stage}: failure must clean deadline timer`);
  await h.advance(TIMEOUT_MS);
  assert.equal(pending.responses.length, 1);
}

// A previously cached image remains usable when its image endpoint is offline.
{
  const h = harness({ entries: [[IMAGE, { cached: true }]] });
  h.hooks.imageFetch = () => { throw new Error('offline image endpoint'); };
  const pending = h.send(); await pending.done;
  assert.equal(pending.responses[0].success, true);
  assert.equal(h.requests.length, 1, 'cache hit must skip image network request');
  assert.equal(h.timers.size, 0);
}

// Preserve real daily unchanged/startdate semantics and bounded cache pruning.
{
  const background = { type: 'bing', value: 'https://www.bing.com/existing.jpg', bing: { startdate: TODAY } };
  const h = harness({ stored: { background } });
  const pending = h.send('refreshBingDaily'); await pending.done;
  assert.equal(pending.responses[0].unchanged, true);
  assert.equal(pending.responses[0].url, background.value);
  assert.equal(pending.responses[0].startdate, TODAY);
  assert.equal(pending.responses[0].checkedAt, Date.parse('2026-10-22T12:00:00Z'));
  assert.equal(h.requests.length, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
}
{
  const previous = 'https://www.bing.com/previous.jpg', expired = 'https://www.bing.com/expired.jpg';
  const h = harness({ entries: [[previous, {}], [expired, {}]], stored: { bingCacheMeta: [
    { url: previous, startdate: '20261021' }, { url: expired, startdate: '20261001' }
  ] } });
  const pending = h.send('refreshBingDaily'); await pending.done;
  assert.equal(pending.responses[0].unchanged, false);
  assert.equal(pending.responses[0].startdate, TODAY);
  assert.deepEqual([...h.entries.keys()].sort(), [IMAGE, previous].sort());
  assert.deepEqual(h.deletes, [expired]);
  assert.deepEqual(h.stored.bingCacheMeta, [{ url: IMAGE, startdate: TODAY }, { url: previous, startdate: '20261021' }]);
  assertOnlyMetadataWrites(h);
  assert.equal(h.timers.size, 0);
}

// Shared daily requests each receive exactly one response and can retry after a
// timeout; the abandoned operation must not clear or contaminate the retry.
{
  const h = harness(), gate = deferred();
  h.hooks.imageBody = () => gate.promise;
  const first = h.send('refreshBingDaily'), second = h.send('refreshBingDaily');
  await settle();
  assert.equal(h.requests.length, 2, 'concurrent daily calls must coalesce API and image fetches');
  assert.equal(h.timers.size, 1);
  await assertSingleTimeout(h, first);
  assert.equal(second.responses.length, 1);
  assert.equal(second.responses[0].success, false);
  delete h.hooks.imageBody;
  const retry = h.send('refreshBingDaily'); await retry.done;
  assert.equal(retry.responses[0].success, true);
  const writes = h.writes.length;
  gate.resolve(new ArrayBuffer(3)); await settle();
  assert.equal(h.writes.length, writes, 'late timed-out daily operation cannot write metadata');
  assert.equal(first.responses.length, 1);
  assert.equal(second.responses.length, 1);
  assert.equal(retry.responses.length, 1);
  assert.equal(h.timers.size, 0);
}

console.log('Bing background tests passed: bounded API/body/cache work, abort, truthful failures, cache hits, daily retry and pruning');

// Repair may replace only the approved archive image endpoint, and must skip
// both the rejected application-cache hit and any stale HTTP-cache response.
for (const url of ['https://example.com/th?id=x', 'http://www.bing.com/th?id=x',
  'https://www.bing.com/HPImageArchive.aspx?id=x', 'https://www.bing.com/th',
  'https://attacker@www.bing.com/th?id=x', 'https://www.bing.com/th?id=x#fragment', 'not a URL']) {
  const h = harness(), pending = h.send('repairBingImage', { url }); await pending.done;
  assert.equal(pending.responses[0].success, false);
  assert.equal(pending.responses[0].stage, 'image');
  assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
}
{
  const corrupt = { corrupt: true }, h = harness({ entries: [[IMAGE, corrupt]] });
  const pending = h.send('repairBingImage', { url: IMAGE }); await pending.done;
  assert.equal(pending.responses[0].success, true);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, IMAGE);
  assert.equal(h.requests[0].options.cache, 'reload');
  assert.notEqual(h.entries.get(IMAGE), corrupt);
  assert.equal(h.writes.length, 0, 'repair cannot select a wallpaper or rewrite metadata');
}
for (const stage of ['imageBody', 'put']) {
  const h = harness(), gate = deferred(); h.hooks[stage] = () => gate.promise;
  const pending = h.send('repairBingImage', { url: IMAGE }); await settle();
  await assertSingleTimeout(h, pending);
  gate.reject(new Error('late repair failure')); await settle();
  assert.equal(pending.responses.length, 1); assert.equal(h.writes.length, 0);
}
{
  const h = harness(); h.hooks.imageFetch = () => ({ ok: false, status: 503 });
  const pending = h.send('repairBingImage', { url: IMAGE }); await pending.done;
  assert.equal(pending.responses[0].success, false); assert.equal(pending.responses[0].stage, 'image');
}
console.log('Bing repair worker tests passed: approved endpoint only, fresh body, bounded completion and truthful failures');
