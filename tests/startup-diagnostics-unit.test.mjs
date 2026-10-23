import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { installStartupDiagnostics } from './startup-diagnostics.mjs';

function harness(options = {}) {
  let time = 10;
  let getImpl = () => undefined;
  let requestImpl = () => undefined;
  let markError;
  let mirror = null;
  const calls = { get: [], request: [], mark: [], style: [], localReads: 0, localWrites: 0, timers: 0 };
  const entries = [];
  const listeners = new Map();
  const performance = {
    now() { assert.equal(this, performance); return time; },
    mark(...args) {
      calls.mark.push({ receiver: this, args });
      if (this !== performance) throw new TypeError('Illegal invocation');
      if (markError) throw markError;
      const entry = { name: args[0], startTime: args[1]?.startTime ?? time };
      entries.push(entry);
      return entry;
    }
  };
  const area = { get(...args) { calls.get.push({ receiver: this, args }); return Reflect.apply(getImpl, this, args); } };
  const locks = { request(...args) { calls.request.push({ receiver: this, args }); return Reflect.apply(requestImpl, this, args); } };
  const nativeGet = area.get, nativeRequest = locks.request, nativeMark = performance.mark;
  const document = {
    documentElement: {},
    body: { classList: { contains(name) { time += 1; return name === 'layout-fixed-cols'; } } },
    addEventListener(type, callback, capture) {
      assert.equal(capture, true, 'resource and DOM events use capture');
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback, capture) {
      assert.equal(capture, true);
      listeners.get(type)?.delete(callback);
    }
  };
  const context = vm.createContext({
    performance, document, Promise, URL,
    navigator: { locks }, chrome: { storage: { local: area }, runtime: {} },
    location: { href: 'chrome-extension://fixture/home.html', protocol: 'chrome-extension:', host: 'fixture' },
    getComputedStyle(element) {
      assert.equal(element, document.documentElement);
      calls.style.push({ at: time, marksBefore: entries.length });
      time += 7;
      return { getPropertyValue(name) {
        time += 1;
        return { '--layout-icon-size': ' 56px ', '--layout-columns': ' 6 ', '--layout-max-width': ' 1100px ' }[name];
      } };
    },
    localStorage: {
      getItem(key) { assert.equal(key, 'opentab.boot.v1'); calls.localReads += 1; return mirror; },
      setItem(key, value) { assert.equal(key, 'opentab.boot.v1'); calls.localWrites += 1; mirror = value; }
    },
    setTimeout() { calls.timers += 1; throw new Error('Diagnostics must not schedule timers'); },
    requestAnimationFrame() { calls.timers += 1; throw new Error('Diagnostics must not schedule frames'); }
  });
  if (options.mirror) mirror = JSON.stringify(options.mirror);
  if (options.readonlyGet) Object.defineProperty(area, 'get', { writable: false });
  if (options.readonlyRequest) Object.defineProperty(locks, 'request', { writable: false });
  vm.runInContext(`(${installStartupDiagnostics.toString()})(${JSON.stringify(options)})`, context);
  return {
    context, calls, entries, listeners, performance, area, locks, nativeGet, nativeRequest, nativeMark,
    state: context.__startupDiagnostics,
    setGet(fn) { getImpl = fn; },
    setRequest(fn) { requestImpl = fn; },
    failMark(error) { markError = error; },
    advance(ms) { time += ms; },
    mirror() { return JSON.parse(mirror); },
    fire(type, target = document) { for (const callback of listeners.get(type) || []) callback({ target }); }
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
const types = h => h.state.events.map(event => event.type);

{
  const h = harness();
  assert.equal(h.calls.get.length, 0, 'install must not issue storage reads');
  assert.equal(h.calls.request.length, 0, 'install must not acquire a lock');
  assert.equal(h.calls.localReads, 0, 'normal install must not inspect mirrors');
  assert.equal(h.calls.style.length, 0, 'no speculative style/readiness work');
  assert.equal(h.calls.timers, 0);
  assert.equal(h.entries.length, 0, 'diagnostics must not synthesize marks');
  const markOptions = { detail: { privateValue: 'not-logged' } };
  const boot = h.performance.mark('opentab:boot-start', markOptions);
  assert.equal(boot, h.entries[0], 'native mark return identity');
  assert.equal(h.calls.mark[0].receiver, h.performance);
  assert.equal(h.calls.mark[0].args[1], markOptions, 'native mark options identity');
  for (const name of ['opentab:boot-applied', 'opentab:initial-read-start', 'opentab:initial-read-end',
    'opentab:initial-validated', 'opentab:initial-loader-start', 'opentab:initial-loader-end']) h.performance.mark(name);
  h.performance.mark('unrelated');
  assert.equal(h.state.events.length, 7, 'only known startup marks are logged');
  const before = h.entries.length;
  const grid = h.performance.mark('opentab:grid-ready');
  assert.equal(h.calls.style[0].marksBefore, before, 'style snapshot must precede genuine mark');
  assert.equal(grid.startTime, 22, 'all 12 ms of snapshot overhead is charged to the real mark');
  assert.deepEqual(plain(h.state.layoutSnapshot), { start: 10, end: 22, duration: 12 });
  assert.deepEqual(plain(h.context.__layoutAtGridReady), {
    iconSize: '56px', columns: '6', maxWidth: '1100px', hideNames: false, fixedCols: true
  });
  assert.equal(h.state.stoppedAt, grid.startTime);
  assert.equal(h.state.events.at(-1).at, grid.startTime, 'record native mark time, not an adjusted clock');
  assert.equal(JSON.stringify(h.state).includes('not-logged'), false, 'mark details never enter diagnostics');
}

{
  const h = harness();
  const receiver = {}, callbackThis = {}, result = {}, returnValue = {};
  const keys = Object.defineProperty({ themeMode: 'PRIVATE DEFAULT' }, 'icons', {
    enumerable: true, get() { throw new Error('default values must never be read'); }
  });
  let lastErrorReads = 0;
  Object.defineProperty(h.context.chrome.runtime, 'lastError', { get() { lastErrorReads += 1; return 'native-error'; } });
  h.setGet(function (...args) {
    assert.equal(this, receiver);
    assert.equal(args.length, 3, 'forward exact argument count');
    assert.equal(args[0], keys);
    assert.equal(args[2], returnValue, 'forward trailing arguments without interpretation');
    assert.deepEqual(plain(types(h)), ['storage-get-invoke'], 'invoke logged before native call');
    return Reflect.apply(args[1], callbackThis, [result, 7]);
  });
  const returned = h.area.get.call(receiver, keys, function (...args) {
    assert.equal(this, callbackThis);
    assert.equal(args[0], result);
    assert.equal(args[1], 7);
    assert.deepEqual(plain(types(h)), ['storage-get-invoke', 'storage-get-callback']);
    assert.equal(h.context.chrome.runtime.lastError, 'native-error');
    return returnValue;
  }, returnValue);
  assert.equal(returned, returnValue, 'synchronous native/callback return stays exact');
  assert.equal(lastErrorReads, 1, 'only application callback reads lastError');
  assert.deepEqual(plain(h.state.events[0].keys), ['themeMode', 'icons']);
  assert.equal(JSON.stringify(h.state).includes('PRIVATE DEFAULT'), false);
  assert.equal(JSON.stringify(h.state).includes('native-error'), false);

  h.setGet(function (callback) { return callback.call(callbackThis, result); });
  assert.equal(h.area.get(function (value) { assert.equal(this, callbackThis); assert.equal(value, result); }), undefined,
    'callback-only API remains undefined, not a Promise');
  assert.equal(h.calls.get.at(-1).args.length, 1, 'optional keys are not inserted');
  assert.equal(h.state.events.at(-2).keys, null);

  const nativeFailure = new Error('native get failed');
  h.setGet(() => { throw nativeFailure; });
  assert.throws(() => h.area.get('icons'), error => error === nativeFailure);
  const callbackFailure = new Error('callback failed');
  h.setGet((keys, callback) => callback({}));
  assert.throws(() => h.area.get('icons', () => { throw callbackFailure; }), error => error === callbackFailure);
}

{
  const h = harness();
  // Test the serialized browser helper, not just its naturally strict ESM form.
  // Sloppy wrappers would substitute globalThis or box these native receivers.
  for (const receiver of [undefined, null, 0, 'receiver']) {
    h.setGet(function () { assert.equal(this, receiver); });
    h.area.get.call(receiver, 'icons');
    h.setRequest(function (name, callback) { assert.equal(this, receiver); return callback.call(receiver, {}); });
    h.locks.request.call(receiver, 'opentab-workspace-v1', function () { assert.equal(this, receiver); });
    h.setGet(function (keys, callback) { return callback.call(receiver, {}); });
    h.area.get('icons', function () { assert.equal(this, receiver); });
    assert.throws(() => h.performance.mark.call(receiver, 'opentab:boot-start'), /Illegal invocation/);
    assert.equal(h.calls.mark.at(-1).receiver, receiver);
  }
}

{
  const h = harness();
  const failure = new Error('native rejection');
  const rejected = Promise.reject(failure);
  const rejectionCheck = assert.rejects(rejected, error => error === failure);
  let thenReads = 0;
  Object.defineProperty(rejected, 'then', { get() { thenReads += 1; throw new Error('do not observe API promises'); } });
  h.setGet(() => rejected);
  assert.equal(h.area.get(['icons']), rejected, 'Promise-only get returns the native Promise itself');
  assert.equal(thenReads, 0);
  await rejectionCheck;
  assert.deepEqual(plain(types(h)), ['storage-get-invoke'], 'no fabricated promise-completion callback');

  let callback;
  const nativePromise = Promise.resolve('PRIVATE STORED VALUE');
  h.setGet((keys, cb) => { callback = cb; return nativePromise; });
  const callbackThis = {}, callbackResult = Promise.resolve('callback result');
  const value = { icons: 'PRIVATE STORED VALUE' };
  const returned = h.area.get(['icons'], function (actual) {
    assert.equal(this, callbackThis);
    assert.equal(actual, value);
    return callbackResult;
  });
  assert.equal(returned, nativePromise, 'hybrid callback/Promise API preserves native Promise identity');
  assert.equal(callback.call(callbackThis, value), callbackResult, 'callback returned Promise identity');
  assert.equal(JSON.stringify(h.state).includes('PRIVATE STORED VALUE'), false, 'callback payloads never logged');
}

{
  const h = harness();
  const receiver = {}, callbackThis = {}, lock = {}, callbackResult = Promise.resolve('held');
  const nativePromise = Promise.resolve('request');
  let thenReads = 0;
  Object.defineProperty(nativePromise, 'then', { get() { thenReads += 1; throw new Error('do not observe lock promises'); } });
  const options = Object.defineProperty({}, 'mode', { get() { throw new Error('must not preflight options'); } });
  h.setRequest(function (...args) {
    assert.equal(this, receiver);
    assert.equal(args[1], options);
    assert.equal(args.length, 3);
    assert.equal(args[2].call(callbackThis, lock, 9), callbackResult);
    return nativePromise;
  });
  assert.equal(h.locks.request.call(receiver, 'opentab-workspace-v1', options, function (actual, extra) {
    assert.equal(this, callbackThis);
    assert.equal(actual, lock);
    assert.equal(extra, 9);
    return callbackResult;
  }), nativePromise);
  assert.equal(thenReads, 0);
  assert.deepEqual(plain(types(h)), ['workspace-lock-request', 'workspace-lock-grant']);
  assert.equal(h.state.events[0].id, h.state.events[1].id);

  const unrelatedCallback = () => undefined;
  h.setRequest((name, callback) => { assert.equal(callback, unrelatedCallback); });
  h.locks.request('other-lock', unrelatedCallback);
  assert.equal(h.state.events.length, 2, 'other lock requests are fully untouched');
  h.setRequest((name, callback) => callback(null));
  h.locks.request('opentab-workspace-v1', () => undefined);
  assert.equal(h.state.events.at(-1).type, 'workspace-lock-unavailable', 'null lock is not reported as a grant');

  const nativeFailure = new Error('native lock failed');
  h.setRequest(() => { throw nativeFailure; });
  assert.throws(() => h.locks.request('opentab-workspace-v1', () => {}), error => error === nativeFailure);
  const callbackFailure = new Error('lock callback failed');
  h.setRequest((name, callback) => callback(lock));
  assert.throws(() => h.locks.request('opentab-workspace-v1', () => { throw callbackFailure; }), error => error === callbackFailure);
  const rejected = Promise.reject(nativeFailure);
  const rejectionCheck = assert.rejects(rejected, error => error === nativeFailure);
  h.setRequest(() => rejected);
  assert.equal(h.locks.request('opentab-workspace-v1', () => {}), rejected);
  await rejectionCheck;
}

{
  const h = harness({ maxEvents: 3 });
  let storageCallback, lockCallback;
  h.setGet((keys, callback) => { storageCallback = callback; });
  h.setRequest((name, callback) => { lockCallback = callback; });
  const wrappedGet = h.area.get, wrappedRequest = h.locks.request;
  h.area.get(Array.from({ length: 100 }, () => 'k'.repeat(120)), () => 4);
  h.locks.request('opentab-workspace-v1', () => 5);
  h.performance.mark('opentab:initial-read-start');
  const grid = h.performance.mark('opentab:grid-ready');
  assert.equal(h.state.events.length, 3);
  assert.equal(h.state.truncated, true);
  assert.equal(h.state.events[0].keys.length, 64, 'key count bounded');
  assert.ok(h.state.events[0].keys.every(key => key.length === 80), 'key name lengths bounded');
  assert.equal(h.state.stoppedAt, grid.startTime, 'cap never prevents genuine-grid stopping');
  assert.equal(h.area.get, h.nativeGet);
  assert.equal(h.locks.request, h.nativeRequest);
  assert.deepEqual(plain(h.state.hookStatus), { storageGet: 'restored', workspaceLock: 'restored' });
  assert.equal(h.listeners.get('load').size, 0);
  assert.equal(h.listeners.get('DOMContentLoaded').size, 0);
  const frozen = JSON.stringify(h.state);
  h.advance(20);
  assert.equal(storageCallback({ privateData: 'not logged' }), 4);
  assert.equal(lockCallback({}), 5);
  const originalCallback = () => undefined;
  wrappedGet.call(h.area, ['icons'], originalCallback);
  wrappedRequest.call(h.locks, 'opentab-workspace-v1', originalCallback);
  assert.equal(h.calls.get.at(-1).args[1], originalCallback, 'cached wrappers pass through unchanged after stop');
  assert.equal(h.calls.request.at(-1).args[1], originalCallback);
  h.performance.mark('opentab:grid-ready');
  assert.equal(h.calls.style.length, 2, 'existing later layout snapshot behavior retained');
  assert.equal(JSON.stringify(h.state), frozen, 'late callbacks/marks cannot update diagnostics');
  assert.equal(harness({ maxEvents: 1000000 }).state.limit, 256, 'hard cap cannot be raised by a caller');
}

{
  for (const options of [{ readonlyGet: true }, { readonlyRequest: true }, { readonlyGet: true, readonlyRequest: true }]) {
    const h = harness(options);
    assert.equal(h.state.installed.storageGet, !options.readonlyGet);
    assert.equal(h.state.installed.workspaceLock, !options.readonlyRequest);
    if (options.readonlyGet) {
      assert.equal(h.area.get, h.nativeGet, 'read-only get remains intact');
      assert.equal(h.state.hookStatus.storageGet, 'unavailable');
    }
    if (options.readonlyRequest) {
      assert.equal(h.locks.request, h.nativeRequest, 'read-only lock API remains intact');
      assert.equal(h.state.hookStatus.workspaceLock, 'unavailable');
    }
    const failure = new Error('application failure must not be hidden');
    h.setGet(() => { throw failure; });
    h.setRequest(() => { throw failure; });
    assert.throws(() => h.area.get('icons'), error => error === failure);
    assert.throws(() => h.locks.request('opentab-workspace-v1', () => {}), error => error === failure);
    const grid = h.performance.mark('opentab:grid-ready');
    assert.equal(h.state.stoppedAt, grid.startTime, 'unavailable optional hooks do not change genuine readiness');
    assert.equal(grid.startTime, 22, 'the whole pre-mark snapshot cost is still included');
    assert.ok(h.context.__layoutAtGridReady);
    if (options.readonlyGet) assert.equal(h.state.hookStatus.storageGet, 'unavailable');
    if (options.readonlyRequest) assert.equal(h.state.hookStatus.workspaceLock, 'unavailable');
  }
}

{
  const h = harness();
  const wrappedGet = h.area.get, wrappedRequest = h.locks.request;
  Object.defineProperty(h.area, 'get', { writable: false });
  Object.defineProperty(h.locks, 'request', { writable: false });
  const grid = h.performance.mark('opentab:grid-ready');
  assert.equal(grid, h.entries[0], 'failed diagnostic restoration cannot hide a genuine mark');
  assert.equal(h.state.stoppedAt, grid.startTime);
  assert.deepEqual(plain(h.state.installed), { storageGet: true, workspaceLock: true });
  assert.deepEqual(plain(h.state.hookStatus), { storageGet: 'restore-unavailable', workspaceLock: 'restore-unavailable' });
  assert.equal(h.area.get, wrappedGet);
  assert.equal(h.locks.request, wrappedRequest);
  const frozen = JSON.stringify(h.state);
  const callback = () => undefined;
  h.setGet((keys, actualCallback) => { assert.equal(actualCallback, callback); });
  h.setRequest((name, actualCallback) => { assert.equal(actualCallback, callback); });
  h.area.get('icons', callback);
  h.locks.request('opentab-workspace-v1', callback);
  assert.equal(JSON.stringify(h.state), frozen, 'read-only retained hooks are inert after stopping');
  const failure = new Error('native failure after restoration was blocked');
  h.setGet(() => { throw failure; });
  h.setRequest(() => { throw failure; });
  assert.throws(() => h.area.get('icons'), error => error === failure);
  assert.throws(() => h.locks.request('opentab-workspace-v1', callback), error => error === failure);
}

{
  const h = harness();
  const error = new Error('real mark rejected');
  h.failMark(error);
  assert.throws(() => h.performance.mark('opentab:grid-ready'), actual => actual === error);
  assert.equal(h.entries.length, 0);
  assert.equal(h.state.stoppedAt, null, 'a failed native mark is never readiness');
  assert.equal(h.state.layoutSnapshot, null);
  assert.equal(h.state.events.length, 0);
  h.failMark(undefined);
  assert.throws(() => h.performance.mark.call({}, 'opentab:boot-start'), /Illegal invocation/,
    'mark receiver is forwarded, not rebound');
  const options = { startTime: 41 };
  const entry = h.performance.mark('opentab:grid-ready', options);
  assert.equal(h.calls.mark.at(-1).args[1], options);
  assert.equal(h.state.stoppedAt, 41, 'native timestamps are not rewritten');
  assert.equal(entry, h.entries[0]);
}

{
  const h = harness();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const api = h.context.OpenTabI18n = { ready };
  h.fire('load', { tagName: 'SCRIPT', src: 'chrome-extension://fixture/i18n.js?private=query#secret' });
  h.fire('load', { tagName: 'LINK', rel: 'stylesheet', href: 'chrome-extension://fixture/style.css?private=query' });
  h.fire('load', { tagName: 'SCRIPT', src: 'https://other.example/private.js' });
  h.fire('load', { tagName: 'IMG', src: 'chrome-extension://fixture/private.png' });
  h.fire('DOMContentLoaded');
  assert.equal(api.ready, ready, 'readiness Promise identity is untouched');
  assert.deepEqual(plain(types(h)), ['resource-load', 'i18n-ready-observed', 'resource-load']);
  assert.equal(h.entries.length, 0, 'resource/DCL observations do not create readiness marks');
  assert.equal(JSON.stringify(h.state).includes('private'), false, 'no queries or unrelated URLs logged');
  let settled = false;
  ready.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'diagnostics never resolves readiness');
  resolveReady('private locale value');
  await ready;
  assert.equal(settled, true);
  assert.equal(h.state.events.at(-1).type, 'i18n-ready-fulfilled');
  assert.equal(h.state.events.filter(event => event.type === 'i18n-ready-observed').length, 1);
  assert.equal(JSON.stringify(h.state).includes('private locale'), false);
  assert.equal(h.calls.timers, 0);
}

{
  const h = harness();
  let rejectReady;
  const ready = new Promise((resolve, reject) => { rejectReady = reject; });
  h.context.OpenTabI18n = { ready };
  h.fire('DOMContentLoaded');
  const error = new Error('readiness still rejects');
  const rejected = assert.rejects(ready, actual => actual === error);
  rejectReady(error);
  await rejected;
  assert.equal(h.state.events.at(-1).type, 'i18n-ready-rejected');
  assert.equal(h.context.OpenTabI18n.ready, ready);
  assert.equal(h.state.stoppedAt, null);
}

{
  const h = harness();
  let resolveReady;
  h.context.OpenTabI18n = { ready: new Promise(resolve => { resolveReady = resolve; }) };
  h.fire('DOMContentLoaded');
  h.performance.mark('opentab:grid-ready');
  const frozen = JSON.stringify(h.state);
  resolveReady();
  await h.context.OpenTabI18n.ready;
  assert.equal(JSON.stringify(h.state), frozen, 'late readiness observer is inert after grid');
}

{
  const h = harness({ stripLayoutMirror: true, mirror: {
    v: 1, layoutIconSize: 80, layoutColumns: 6, layoutShowNames: false, layoutMaxWidth: 1100, theme: 'dark'
  } });
  assert.equal(h.calls.localReads, 1);
  assert.equal(h.calls.localWrites, 1);
  assert.deepEqual(h.mirror(), { v: 1, theme: 'dark' }, 'existing cold-layout setup remains identical');
  assert.equal(h.calls.get.length, 0);
}

const settingsSource = fs.readFileSync(new URL('./settings-layout.test.mjs', import.meta.url), 'utf8');
assert.match(settingsSource, /const GRID_READY_BUDGET_MS = 500;/);
assert.match(settingsSource, /navTiming\.gridReady <= GRID_READY_BUDGET_MS/);
assert.match(settingsSource, /navTiming\.dcl <= GRID_READY_BUDGET_MS/);
assert.match(settingsSource, /performance\.getEntriesByName\('opentab:grid-ready'\)\.length > 0/);
assert.equal((settingsSource.match(/\.addInitScript\(/g) || []).length, 2, 'one deterministic init script per fixture page');
assert.match(settingsSource, /page\.addInitScript\(installStartupDiagnostics\)/);
assert.match(settingsSource, /cold\.addInitScript\(installStartupDiagnostics, \{ stripLayoutMirror: true \}\)/);
assert.ok(settingsSource.indexOf("'startup-diagnostics.json'") < settingsSource.indexOf('assert.equal(navTiming.calendarBuilds'),
  'bounded diagnostics artifact is written before startup-gate assertions');
for (const field of ['responseEnd', 'domInteractive', 'domContentLoadedEventStart', 'domContentLoadedEventEnd']) {
  assert.ok(settingsSource.includes(`nav.${field}`), `navigation boundary ${field} is reported`);
}
console.log('Startup diagnostics forwarding, boundaries, privacy and readiness unit tests passed');
