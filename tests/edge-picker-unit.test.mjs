// Exercise the actual native-picker helpers without launching a browser or X11.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./edge-extension.test.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function setClipboard(');
const end = source.indexOf("// Edge's manager renders controls", start);
assert.ok(start >= 0 && end > start, 'actual picker helper source boundaries exist');
const helpers = source.slice(start, end);
const expected = '/tmp/opentab-edge-unit/extension/';

async function check({ readbacks = [], passes = false, attempts: expectedAttempts, lostFocus = false }) {
  let time = 0, attempts = 0, clipboard = '', snapshots = 0;
  const evidence = { stages: [] };
  const sandbox = {
    assert, evidence, Date: { now: () => time },
    delay: async ms => { time += ms; },
    chooserVisible: id => id === '123',
    native: (...args) => {
      if (args[0] === 'getwindowname') return 'Select the extension directory.\n';
      if (args[0] === 'getwindowfocus') return lostFocus ? '999\n' : '123\n';
      if (args.includes('ctrl+l')) attempts++;
      if (args.includes('ctrl+c')) {
        // If copying does nothing, retain the sentinel, not the pasted value.
        assert.equal(clipboard, `opentab-unverified-path-${attempts}`);
        clipboard = readbacks[attempts - 1] ?? clipboard;
      }
    },
    execFileSync: (command, args, options) => {
      assert.equal(command, 'xclip');
      assert.deepEqual(Array.from(args.slice(0, 2)), ['-selection', 'clipboard']);
      assert.equal(options.timeout, 2000, 'clipboard subprocess is bounded');
      if (args.includes('-in')) {
        assert.deepEqual(Array.from(options.stdio), ['pipe', 'ignore', 'ignore'], 'daemon must not inherit output pipes');
        clipboard = options.input;
      } else {
        assert.ok(args.includes('-out'));
        return clipboard;
      }
    },
    record: () => {}, nativeSnapshot: () => snapshots++
  };
  vm.createContext(sandbox);
  vm.runInContext(helpers + '\nglobalThis.run = enterChooserPath;', sandbox);
  if (passes) await sandbox.run('123', expected);
  else await assert.rejects(sandbox.run('123', expected),
    lostFocus ? /retains focus/ : /did not match.*after 3 attempts/);
  assert.equal(attempts, expectedAttempts);
  assert.equal(evidence.stages.length, attempts);
  assert.equal(snapshots, passes ? attempts - 1 : attempts);
}

await check({ readbacks: [expected], passes: true, attempts: 1 });
await check({ readbacks: ['edge-unit/extension/', expected], passes: true, attempts: 2 });
await check({ attempts: 3 }); // Ctrl+C never updates the sentinel: fail closed.
await check({ readbacks: ['wrong', 'wrong', 'wrong'], attempts: 3 });
await check({ lostFocus: true, attempts: 0 });
console.log('Edge picker unit tests passed (5 cases; no browser or X11).');
