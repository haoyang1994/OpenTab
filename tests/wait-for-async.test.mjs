import assert from 'node:assert/strict';
import { waitForAsync } from './wait-for-async.mjs';

let calls = 0;
await waitForAsync({ evaluate: async (predicate, arg) => { calls += 1; return predicate(arg); } },
  async (threshold) => calls >= threshold, 3, { interval: 1, timeout: 1000 });
assert.equal(calls, 3, 'false promises must be retried until the predicate resolves to true');
await assert.rejects(waitForAsync({ evaluate: async () => false }, async () => false,
  undefined, { interval: 1, timeout: 5 }), /did not resolve to true/, 'always-false must time out');
await assert.rejects(waitForAsync({ evaluate: async () => 'truthy' }, async () => 'truthy',
  undefined, { interval: 1, timeout: 5 }), /did not resolve to true/, 'only boolean true is accepted');
await assert.rejects(waitForAsync({ evaluate: async () => { throw new Error('storage unavailable'); } },
  async () => true), /storage unavailable/, 'evaluation failures must not be swallowed');
console.log('async browser wait tests passed: false promises retry, strict true, timeout and evaluation failure');
