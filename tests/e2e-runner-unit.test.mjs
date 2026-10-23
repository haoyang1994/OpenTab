import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(root, 'scripts/run-e2e.sh');
const bash = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
const suites = [
  'tests/scenes.test.mjs',
  'tests/clock-deck.test.mjs',
  'tests/zen-mode.test.mjs',
  'tests/group-icon-motion.test.mjs',
  'tests/group-launch.test.mjs',
  'tests/site-selection.test.mjs',
  'tests/paste-sites.test.mjs',
  'tests/command-palette.test.mjs',
  'tests/accessibility.test.mjs',
  'tests/i18n.test.mjs',
  'tests/workspace.test.mjs',
  'tests/extension.test.mjs',
  'tests/search.test.mjs',
  'tests/first-run.test.mjs',
  'tests/settings-layout.test.mjs',
  'tests/weather.test.mjs',
];
const groups = {
  scenes: ['tests/scenes.test.mjs'],
  core: suites.filter(suite => suite !== 'tests/scenes.test.mjs'),
};
assert.equal(suites.length, 16, 'the canonical native gate contains all 16 expected suites');
assert.equal(new Set(suites).size, 16, 'canonical suites are unique');
assert.equal(groups.core.length, 15);
assert.deepEqual([...groups.scenes, ...groups.core], suites, 'CI groups form the exact ordered, exhaustive canonical suite list');
assert.equal(groups.scenes.some(suite => groups.core.includes(suite)), false, 'CI groups never overlap');

// Test the actual aggregate shell guard, not a separately reimplemented boolean.
// Missing completion outputs, cancellation, skipping and failure must all block
// the stable required Test check and its downstream package/candidate actions.
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const workflowJobs = workflow.split('\n  test:\n');
assert.equal(workflowJobs.length, 2, 'CI preserves one stable aggregate Test job');
const [nativeJob, aggregateJob] = workflowJobs;
assert.match(nativeJob, /e2e_group: \[scenes, core\]/);
assert.match(nativeJob, /fail-fast: false/);
assert.doesNotMatch(workflow, /continue-on-error:/);
assert.match(nativeJob, /timeout-minutes: 35/);
assert.match(nativeJob, /- name: Run tests\n        timeout-minutes: 15\n/);
assert.match(nativeJob, /OPENTAB_E2E_GROUP: \$\{\{ matrix\.e2e_group \}\}/);
assert.match(nativeJob, /scenes: \$\{\{ steps\.complete\.outputs\.scenes \}\}/);
assert.match(nativeJob, /core: \$\{\{ steps\.complete\.outputs\.core \}\}/);
assert.ok(nativeJob.indexOf('- name: Record completed native group') > nativeJob.indexOf('run: npm test'));
assert.match(nativeJob, /run: echo "\$E2E_GROUP=success" >> "\$GITHUB_OUTPUT"/);
assert.match(nativeJob, /name: browser-verification-\$\{\{ matrix\.e2e_group \}\}/);
assert.match(nativeJob, /- name: Install Chromium and native desktop dependencies\n        timeout-minutes: 18/);
assert.match(nativeJob, /E2E_GROUP: \$\{\{ matrix\.e2e_group \}\}/);
assert.match(nativeJob, /npx playwright install --with-deps chromium[\s\S]*if \[\[ "\$E2E_GROUP" == core \]\] && ! command -v openbox/);
assert.doesNotMatch(nativeJob, /sudo apt-get update/, 'reuse the indexes already refreshed by Playwright dependency setup');
assert.match(nativeJob, /sudo apt-get install --no-install-recommends -y openbox/);
assert.doesNotMatch(nativeJob, /test:package:smoke|unsigned-extension-candidate/);
assert.match(aggregateJob, /name: Test\n    if: always\(\)\n    needs: \[test-suites\]/);
assert.match(aggregateJob, /timeout-minutes: 35/);
assert.match(aggregateJob, /steps:\n      - name: Require every test group to pass/);
assert.match(aggregateJob, /TEST_SUITES_RESULT: \$\{\{ needs\.test-suites\.result \}\}/);
assert.match(aggregateJob, /SCENES_RESULT: \$\{\{ needs\.test-suites\.outputs\.scenes \}\}/);
assert.match(aggregateJob, /CORE_RESULT: \$\{\{ needs\.test-suites\.outputs\.core \}\}/);
assert.match(aggregateJob, /- name: Install Playwright Chromium\n        timeout-minutes: 18/);
assert.match(aggregateJob, /- name: Verify extracted release candidate\n        timeout-minutes: 3/);
assert.match(aggregateJob, /run: \|\n          npm run test:package:smoke/);
assert.match(aggregateJob, /name: unsigned-extension-candidate/);
assert.match(aggregateJob, /name: browser-verification-package/);
const guardMatch = aggregateJob.match(/        run: \|\n((?:          [^\n]*\n)+)/);
assert.ok(guardMatch, 'the aggregate gate has a testable shell guard');
const guard = guardMatch[1].replace(/^          /gm, '');
const results = ['success', 'failure', 'cancelled', 'skipped', ''];
for (const overall of results) for (const scenes of results) for (const core of results) {
  const guarded = spawnSync(bash, ['-e', '-c', guard], {
    env: { ...process.env, TEST_SUITES_RESULT: overall, SCENES_RESULT: scenes, CORE_RESULT: core },
    encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(guarded.error);
  assert.equal(guarded.signal, null);
  assert.equal(guarded.status, [overall, scenes, core].every(result => result === 'success') ? 0 : 1,
    `only both completed groups and an overall success can authorize packaging (${[overall, scenes, core].join('/')})`);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opentab-e2e-runner-'));
const bin = path.join(temp, 'bin');
const log = path.join(temp, 'suites.log');
const xvfbLog = path.join(temp, 'xvfb.log');
const wmLog = path.join(temp, 'wm.log');
fs.mkdirSync(bin);

function executable(name, contents, interpreter = bash) {
  fs.writeFileSync(path.join(bin, name), `#!${interpreter}\n${contents}`, { mode: 0o755 });
}

// A closed PATH guarantees these checks can never launch real Node/Chromium or
// xvfb. Only the shell, env, and a short cancellation-test sleep are real.
for (const name of ['bash', 'sh', 'python3', 'env', 'sleep', 'mktemp', 'touch', 'rm']) {
  const actual = execFileSync(bash, ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
  fs.symlinkSync(actual, path.join(bin, name));
}
executable('uname', 'printf "Linux\\n"\n');
// Match the real xvfb-run's POSIX-shell boundary: /bin/sh can strip exported
// Bash function definitions, so the runner must not rely on inheriting them.
executable('xvfb-run', `
[ "$1" = "-a" ] || exit 90
printf 'xvfb\\n' >> "$E2E_XVFB_LOG"
shift
DISPLAY=:owned
export DISPLAY
"$@"
status=$?
exit "\${FAKE_XVFB_EXIT:-$status}"
`, '/bin/sh');
executable('openbox', `
[[ "$1" == --sm-disable && "$2" == --startup ]] || exit 91
[[ "$OPENTAB_E2E_OWNED_DISPLAY" == 1 && "$DISPLAY" == :owned ]] || exit 92
printf 'start\\n' >> "$E2E_WM_LOG"
trap 'printf "stop\\n" >> "$E2E_WM_LOG"; exit 0' HUP INT TERM
if [[ "\${FAKE_WM_EXIT:-}" == 1 ]]; then exit 44; fi
# Openbox uses g_shell_parse_argv + g_spawn_async, not implicit shell eval.
if [[ "\${FAKE_WM_NOT_READY:-}" != 1 ]]; then
  python3 -c 'import shlex, subprocess, sys; subprocess.run(shlex.split(sys.argv[1]), check=True)' "$3"
fi
while true; do sleep 0.05; done
`);
executable('node', `
suite=$1
if [[ "$suite" == tests/zen-mode.test.mjs && "\${OPENTAB_E2E_OWNED_DISPLAY:-}" == 1 ]]; then
  [[ -f "$OPENTAB_WM_READY_FILE" ]] || exit 93
  printf 'suite\\n' >> "$E2E_WM_LOG"
fi
printf '%s|%s|%s\\n' "$suite" "\${HEADLESS:-}" "\${PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS:-}" >> "$E2E_LOG"
printf 'stdout: %s\\n' "$suite"
printf 'stderr: %s\\n' "$suite" >&2
if [[ "$suite" == "\${FAKE_SIGNAL_SUITE:-}" ]]; then
  kill -s "$FAKE_SIGNAL" "$$"
  exit 99
fi
if [[ "$suite" == "\${FAKE_BLOCK_SUITE:-}" ]]; then
  # Even a child that handles cancellation by exiting zero must not turn the
  # whole interrupted run green or allow the next suite to start.
  trap 'exit 0' HUP INT TERM
  printf 'ready for cancellation\\n'
  sleep 2 &
  wait $!
  exit 98
fi
if [[ "$suite" == "\${FAKE_FAIL_FIRST:-}" ]]; then exit 7; fi
if [[ "$suite" == "\${FAKE_FAIL_MIDDLE:-}" ]]; then exit 19; fi
if [[ "$suite" == "\${FAKE_TIMEOUT_SUITE:-}" ]]; then exit 124; fi
exit 0
`);

const modes = [
  { name: 'headed', CI: 'false', DISPLAY: ':fake', xvfb: false },
  { name: 'Linux without DISPLAY', CI: 'false', DISPLAY: '', xvfb: true },
  { name: 'CI', CI: 'true', DISPLAY: ':fake', xvfb: true },
];

function prepare(mode, extra = {}) {
  fs.writeFileSync(log, '');
  fs.writeFileSync(xvfbLog, '');
  fs.writeFileSync(wmLog, '');
  const env = {
    ...process.env,
    PATH: bin,
    CI: mode.CI,
    DISPLAY: mode.DISPLAY,
    HEADLESS: 'true',
    PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS: '0',
    E2E_LOG: log,
    E2E_XVFB_LOG: xvfbLog,
    E2E_WM_LOG: wmLog,
  };
  // CI deliberately sets this variable. Default-run coverage must remain full
  // even when the runner unit tests execute inside either CI partition.
  delete env.OPENTAB_E2E_GROUP;
  delete env.OPENTAB_E2E_OWNED_DISPLAY;
  return { ...env, ...extra };
}

function calls() {
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
}

function assertCalls(expected) {
  assert.deepEqual(calls(), expected.map((suite) => `${suite}|false|1`),
    'each suite must run exactly once in order with the required browser environment');
}

function run(mode, extra = {}, { xvfb = mode.xvfb } = {}) {
  const result = spawnSync(bash, [runner], {
    cwd: root,
    env: prepare(mode, extra),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${mode.name}: unexpected runner signal`);
  assert.equal(fs.readFileSync(xvfbLog, 'utf8'), xvfb ? 'xvfb\n' : '');
  return result;
}

async function cancel(mode, signal, expectedStatus, selected = suites, extra = {}) {
  const blockedIndex = extra.FAKE_BLOCK_SUITE ? selected.indexOf(extra.FAKE_BLOCK_SUITE) : Math.min(1, selected.length - 1);
  const child = spawn(bash, [runner], {
    cwd: root,
    env: prepare(mode, { ...extra, FAKE_BLOCK_SUITE: selected[blockedIndex] }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let cancelled = false;
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (!cancelled && stdout.includes('ready for cancellation')) {
      cancelled = true;
      child.kill(signal);
    }
  });
  child.stderr.resume();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('cancellation timed out')); }, 5000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, exitSignal) => { clearTimeout(timer); resolve({ code, exitSignal }); });
  });
  assert.equal(cancelled, true, 'the fixture must be cancelled while a suite is active');
  assert.equal(result.code, expectedStatus, `${mode.name}: ${signal} must remain a failed/cancelled run`);
  assert.equal(result.exitSignal, null);
  assertCalls(selected.slice(0, blockedIndex + 1));
  assert.doesNotMatch(stdout, /E2E: all \d+ suites passed/);
}

try {
  for (const mode of modes) {
    const success = run(mode);
    assert.equal(success.status, 0, mode.name);
    assertCalls(suites);
    assert.equal(fs.readFileSync(wmLog, 'utf8'), mode.xvfb ? 'start\nsuite\nstop\n' : '',
      'only the Zen suite on a runner-owned display gets a scoped, cleaned-up WM');
    assert.match(success.stdout, new RegExp(`E2E: all ${suites.length} suites passed`));
    for (const suite of suites) {
      assert.ok(success.stdout.includes(`stdout: ${suite}\n`), 'suite stdout must remain visible');
      assert.ok(success.stderr.includes(`stderr: ${suite}\n`), 'suite stderr must remain visible');
      assert.ok(success.stdout.includes(`E2E: ${suite} exited 0\n`));
    }

    const failed = run(mode, { FAKE_FAIL_FIRST: suites[0], FAKE_FAIL_MIDDLE: suites[5] });
    assert.equal(failed.status, 1, `${mode.name}: ordinary failures must fail the final result`);
    assertCalls(suites);
    assert.ok(failed.stdout.includes(`E2E: ${suites[0]} exited 7\n`));
    assert.ok(failed.stdout.includes(`E2E: ${suites[5]} exited 19\n`));
    assert.ok(failed.stderr.endsWith(`E2E: 2 suite(s) failed:\n  ${suites[0]} (exit 7)\n  ${suites[5]} (exit 19)\n`));
    assert.doesNotMatch(failed.stdout, /E2E: all \d+ suites passed/);

    const timedOut = run(mode, { FAKE_TIMEOUT_SUITE: suites[5] });
    assert.equal(timedOut.status, 1, 'a suite timeout must never be reported as success');
    assertCalls(suites);
    assert.ok(timedOut.stderr.includes(`${suites[5]} (exit 124)`));

    for (const [signal, status] of [['HUP', 129], ['INT', 130], ['TERM', 143]]) {
      const terminated = run(mode, { FAKE_SIGNAL_SUITE: suites[1], FAKE_SIGNAL: signal });
      assert.equal(terminated.status, status, `${mode.name}: ${signal} suite termination must abort`);
      assertCalls(suites.slice(0, 2));
      assert.ok(terminated.stdout.includes(`E2E: ${suites[1]} exited ${status}\n`));
      assert.doesNotMatch(terminated.stdout, /E2E: all \d+ suites passed/);
    }
    await cancel(mode, 'SIGINT', 130);
    await cancel(mode, 'SIGTERM', 143);
    if (mode.xvfb) {
      await cancel(mode, 'SIGTERM', 143, suites, { FAKE_BLOCK_SUITE: 'tests/zen-mode.test.mjs' });
      assert.equal(fs.readFileSync(wmLog, 'utf8'), 'start\nsuite\nstop\n', 'cancelling the WM-backed suite cleans up its manager');
      const wmFailure = run(mode, { FAKE_WM_EXIT: '1' });
      assert.equal(wmFailure.status, 1);
      assertCalls(suites.filter(suite => suite !== 'tests/zen-mode.test.mjs'));
      assert.match(wmFailure.stderr, /window manager exited before readiness/);
    }

    const explicitAll = run(mode, { OPENTAB_E2E_GROUP: 'all' });
    assert.equal(explicitAll.status, 0);
    assertCalls(suites);
    for (const [group, selected] of Object.entries(groups)) {
      const env = { OPENTAB_E2E_GROUP: group };
      const success = run(mode, env);
      assert.equal(success.status, 0, `${mode.name}/${group}`);
      assertCalls(selected);
      assert.match(success.stdout, new RegExp(`E2E: all ${selected.length} suites passed`));

      const failed = run(mode, { ...env, FAKE_FAIL_FIRST: selected[0], FAKE_FAIL_MIDDLE: selected.at(-1) });
      assert.equal(failed.status, 1, `${group}: an ordinary failure must fail the partition`);
      assertCalls(selected);
      assert.ok(failed.stderr.includes(`${selected[0]} (exit 7)`));
      if (selected.length > 1) assert.ok(failed.stderr.includes(`${selected.at(-1)} (exit 19)`));
      assert.doesNotMatch(failed.stdout, /E2E: all \d+ suites passed/);

      const timedOut = run(mode, { ...env, FAKE_TIMEOUT_SUITE: selected[0] });
      assert.equal(timedOut.status, 1);
      assertCalls(selected);
      assert.ok(timedOut.stderr.includes(`${selected[0]} (exit 124)`));
      for (const [signal, status] of [['HUP', 129], ['INT', 130], ['TERM', 143]]) {
        const terminated = run(mode, { ...env, FAKE_SIGNAL_SUITE: selected[0], FAKE_SIGNAL: signal });
        assert.equal(terminated.status, status);
        assertCalls(selected.slice(0, 1));
        assert.doesNotMatch(terminated.stdout, /E2E: all \d+ suites passed/);
      }
      await cancel(mode, 'SIGINT', 130, selected, env);
      await cancel(mode, 'SIGTERM', 143, selected, env);
    }

    for (const invalid of ['', 'unknown', 'SCENES', 'scenes core', '../tests/scenes.test.mjs']) {
      const rejected = run(mode, { OPENTAB_E2E_GROUP: invalid }, { xvfb: false });
      assert.equal(rejected.status, 2, 'invalid groups fail before invoking either the display wrapper or a suite');
      assertCalls([]);
      assert.match(rejected.stderr, /invalid OPENTAB_E2E_GROUP/);
    }
  }

  const xvfbFailure = run(modes[2], { FAKE_XVFB_EXIT: '42' });
  assert.equal(xvfbFailure.status, 42, 'xvfb failure must not be hidden by successful suites');

  const desktop = path.join(root, 'scripts/run-native-desktop.sh');
  const desktopEnv = extra => prepare(modes[2], { DISPLAY: ':owned', OPENTAB_E2E_OWNED_DISPLAY: '1', ...extra });
  for (const extra of [{ OPENTAB_E2E_OWNED_DISPLAY: '' }, { DISPLAY: '' }]) {
    const rejected = spawnSync(bash, [desktop, 'node', suites[2]], { env: desktopEnv(extra), encoding: 'utf8' });
    assert.equal(rejected.status, 2, 'never start a window manager on an unowned/absent display');
    assertCalls([]);
    assert.equal(fs.readFileSync(wmLog, 'utf8'), '');
  }
  const notReady = spawnSync(bash, [desktop, 'node', suites[2]], {
    env: desktopEnv({ FAKE_WM_NOT_READY: '1' }), encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(notReady.error);
  assert.equal(notReady.status, 1);
  assert.match(notReady.stderr, /did not become ready within 5 seconds/);
  assertCalls([]);
  assert.equal(fs.readFileSync(wmLog, 'utf8'), 'start\nstop\n');
  fs.unlinkSync(path.join(bin, 'openbox'));
  const noManager = spawnSync(bash, [desktop, 'node', suites[2]], { env: desktopEnv({}), encoding: 'utf8' });
  assert.equal(noManager.status, 1);
  assert.match(noManager.stderr, /needs Openbox/);
  assertCalls([]);

  fs.unlinkSync(path.join(bin, 'xvfb-run'));
  for (const mode of modes.filter((candidate) => candidate.xvfb)) {
    const missing = spawnSync(bash, [runner], { env: prepare(mode), encoding: 'utf8', timeout: 5000 });
    assert.ifError(missing.error);
    assert.equal(missing.status, 1, 'missing xvfb must fail before any browser suite');
    assertCalls([]);
    assert.match(missing.stdout, /xvfb-run is not installed/);
  }
  console.log('E2E runner tests passed: exact 16-suite partitions, strict CI/package gate, ordered aggregation, exit codes, output, cancellation, and xvfb prerequisites');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
