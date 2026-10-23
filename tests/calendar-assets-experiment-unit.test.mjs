// Source/accounting-only checks: importing the runner must never launch Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BASELINE_SHA, GRID_READY_BUDGET_MS, SAMPLE_PAIRS, samplePlan, summarize, summarizeSamples } from './calendar-assets-experiment.mjs';
const plan = samplePlan();
assert.equal(BASELINE_SHA, '7c43d4c4fbab3a32866c02988991059c28c27bea');
assert.equal(GRID_READY_BUDGET_MS, 500);
assert.equal(SAMPLE_PAIRS, 10);
assert.equal(plan.length, 20);
for (const variant of ['baseline', 'candidate']) {
  assert.equal(plan.filter(item => item.variant === variant).length, 10);
  for (const locale of ['zh-CN', 'en-US']) assert.equal(plan.filter(item => item.variant === variant && item.locale === locale).length, 5);
}
for (let pair = 0; pair < 10; pair++) {
  const items = plan.slice(pair * 2, pair * 2 + 2);
  assert.equal(items[0].locale, items[1].locale);
  assert.deepEqual(items.map(item => item.variant), pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']);
  assert.deepEqual(items.map(item => item.order), [pair * 2 + 1, pair * 2 + 2]);
}
assert.deepEqual(summarize([1, 2, 3, 1000, null, undefined, NaN]), {
  observed: 4, missing: 3, min: 1, median: 2.5, p90: 1000, max: 1000, mean: 251.5
});
const failedSlow = { pair: 1, variant: 'candidate', failures: ['over budget'], startup: { gridReady: 900 } };
const summary = summarizeSamples([{ pair: 1, variant: 'baseline', startup: { gridReady: 400 } }, failedSlow]);
assert.equal(summary.gridReady.candidate.max, 900, 'failed and slow observations must never disappear from summaries');
assert.equal(summary.gridReady.pairedDeltas[0], 500);
assert.equal(summary.gridReady.pairedCandidateMinusBaseline.missing, 9);
assert.equal(summary.dcl.candidate.observed, 0);
for (const locale of ['zh-CN', 'en-US']) {
  const firsts = plan.filter(item => item.locale === locale && item.order % 2 === 1);
  assert.equal(new Set(firsts.map(item => item.variant)).size, 2, 'each locale uses both AB and BA ordering');
}
const source = fs.readFileSync(new URL('./calendar-assets-experiment.mjs', import.meta.url), 'utf8');
assert.match(source, /page\.addInitScript\(installStartupDiagnostics\)/);
assert.match(source, /opentab:initial-loader-end/);
assert.match(source, /process\.env\.CI, 'true'/);
assert.match(source, /git\(baseline, 'rev-parse', 'HEAD'\), BASELINE_SHA/);
assert.match(source, /git\(ROOT, 'rev-parse', 'HEAD'\), expectedCandidate/);
assert.ok(source.indexOf('for (const plan of report.plan)') < source.indexOf("for (const locale of ['zh-CN', 'en-US'])"), 'fault cases follow all timing observations');
const workflow = fs.readFileSync(new URL('../.github/workflows/calendar-assets-experiment.yml', import.meta.url), 'utf8');
assert.match(workflow, /pull_request:/);
assert.ok(workflow.includes("if: github.event_name == 'workflow_dispatch' || github.head_ref == 'perf/lazy-calendar-assets'"), 'historical comparison is scoped to this experiment branch or explicit dispatch');
assert.match(workflow, /timeout-minutes: 15/);
assert.match(workflow, /if: always\(\)/);
assert.match(workflow, /cancel-in-progress: false/);
assert.ok(!workflow.includes('matrix:'), 'timed samples must not share a runner with parallel browser variants');
console.log('Calendar experiment accounting passed: exact alternating 20-sample plan, unfiltered failure/outlier summaries, pinned revision and CI-only native execution.');
