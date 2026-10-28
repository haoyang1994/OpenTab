import assert from 'node:assert/strict';
import { buildSchedule, summarize, BUDGET_MS } from './startup-probe.mjs';
const schedule = buildSchedule();
assert.equal(BUDGET_MS, 500);
assert.equal(schedule.length, 48);
assert.deepEqual(schedule.map(s => s.index), Array.from({ length: 48 }, (_, i) => i));
for (const fixture of ['search', 'settings']) {
  for (const pagePolicy of ['original', 'close-unused', 'settled-install']) {
    for (const revision of ['baseline', 'candidate']) {
      assert.equal(schedule.filter(s => s.fixture === fixture && s.pagePolicy === pagePolicy && s.revision === revision).length, 4);
    }
  }
}
for (let i = 0; i < schedule.length; i += 4) {
  const revisions = schedule.slice(i, i + 4).map(s => s.revision);
  assert.deepEqual(revisions, schedule[i].block === 0 ? ['baseline', 'candidate', 'candidate', 'baseline'] : ['candidate', 'baseline', 'baseline', 'candidate']);
}
const cell = { fixture: 'search', pagePolicy: 'original', revision: 'candidate' };
const samples = [
  { ...cell, index: 0, timing: { gridReady: 501, dcl: 400 }, budgetPassed: false },
  { ...cell, index: 1, timing: { gridReady: 200, dcl: 100 }, budgetPassed: true },
  { ...cell, index: 2, error: 'browser failed' },
  { ...cell, index: 3, timing: { gridReady: null, dcl: 0 }, budgetPassed: false }
];
const group = summarize(samples)['search/original/candidate'];
assert.deepEqual(group.samples, [0, 1, 2, 3], 'all planned outcomes retained');
assert.equal(group.errors, 1);
assert.equal(group.budgetFailures, 2, 'a fast median never erases individual failures');
assert.deepEqual(group.gridReady, [501, 200, null]);
assert.equal(group.gridReadyMedian, 350.5);
assert.deepEqual(group.gridReadyRange, [200, 501]);
console.log('Startup probe schedule and failure-retention unit tests passed');
