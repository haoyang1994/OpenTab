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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opentab-e2e-runner-'));
const bin = path.join(temp, 'bin');
const log = path.join(temp, 'suites.log');
const xvfbLog = path.join(temp, 'xvfb.log');
fs.mkdirSync(bin);

function executable(name, contents, interpreter = bash) {
  fs.writeFileSync(path.join(bin, name), `#!${interpreter}\n${contents}`, { mode: 0o755 });
}

// A closed PATH guarantees these checks can never launch real Node/Chromium or
// xvfb. Only the shell, env, and a short cancellation-test sleep are real.
for (const name of ['bash', 'env', 'sleep']) {
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
"$@"
status=$?
exit "\${FAKE_XVFB_EXIT:-$status}"
`, '/bin/sh');
executable('node', `
suite=$1
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
  return {
    ...process.env,
    PATH: bin,
    CI: mode.CI,
    DISPLAY: mode.DISPLAY,
    HEADLESS: 'true',
    PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS: '0',
    E2E_LOG: log,
    E2E_XVFB_LOG: xvfbLog,
    ...extra,
  };
}

function calls() {
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
}

function assertCalls(expected) {
  assert.deepEqual(calls(), expected.map((suite) => `${suite}|false|1`),
    'each suite must run exactly once in order with the required browser environment');
}

function run(mode, extra = {}) {
  const result = spawnSync(bash, [runner], {
    cwd: root,
    env: prepare(mode, extra),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${mode.name}: unexpected runner signal`);
  assert.equal(fs.readFileSync(xvfbLog, 'utf8'), mode.xvfb ? 'xvfb\n' : '');
  return result;
}

async function cancel(mode, signal, expectedStatus) {
  const child = spawn(bash, [runner], {
    cwd: root,
    env: prepare(mode, { FAKE_BLOCK_SUITE: suites[1] }),
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
  assertCalls(suites.slice(0, 2));
  assert.doesNotMatch(stdout, /all 13 suites passed/);
}

try {
  for (const mode of modes) {
    const success = run(mode);
    assert.equal(success.status, 0, mode.name);
    assertCalls(suites);
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
    assert.doesNotMatch(failed.stdout, /all 13 suites passed/);

    const timedOut = run(mode, { FAKE_TIMEOUT_SUITE: suites[5] });
    assert.equal(timedOut.status, 1, 'a suite timeout must never be reported as success');
    assertCalls(suites);
    assert.ok(timedOut.stderr.includes(`${suites[5]} (exit 124)`));

    for (const [signal, status] of [['HUP', 129], ['INT', 130], ['TERM', 143]]) {
      const terminated = run(mode, { FAKE_SIGNAL_SUITE: suites[1], FAKE_SIGNAL: signal });
      assert.equal(terminated.status, status, `${mode.name}: ${signal} suite termination must abort`);
      assertCalls(suites.slice(0, 2));
      assert.ok(terminated.stdout.includes(`E2E: ${suites[1]} exited ${status}\n`));
      assert.doesNotMatch(terminated.stdout, /all 13 suites passed/);
    }
    await cancel(mode, 'SIGINT', 130);
    await cancel(mode, 'SIGTERM', 143);
  }

  const xvfbFailure = run(modes[2], { FAKE_XVFB_EXIT: '42' });
  assert.equal(xvfbFailure.status, 42, 'xvfb failure must not be hidden by successful suites');

  fs.unlinkSync(path.join(bin, 'xvfb-run'));
  for (const mode of modes.filter((candidate) => candidate.xvfb)) {
    const missing = spawnSync(bash, [runner], { env: prepare(mode), encoding: 'utf8', timeout: 5000 });
    assert.ifError(missing.error);
    assert.equal(missing.status, 1, 'missing xvfb must fail before any browser suite');
    assertCalls([]);
    assert.match(missing.stdout, /xvfb-run is not installed/);
  }
  console.log('E2E runner tests passed: ordered aggregation, exit codes, output, cancellation, and xvfb prerequisites');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
