import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  buildCompressCommand,
  createSshGateway,
  isAllowedOrigin,
  parseAllowedOrigins,
  posixShellSingleQuote,
  resolveGatewayToken,
  startGatewayFromEnv,
  tokensEqual,
  verifyUpgradeRequest
} from '../ssh-gateway.mjs';

const __filename = fileURLToPath(import.meta.url);
const EXTENSION_ID = 'abcdefghijklmnopqrstuvwxyzabcdef';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const VALID_TOKEN = 'ci-test-token-value-ok';

function createLogger() {
  const lines = [];
  const push = (level, args) => {
    const text = args.map(String).join(' ');
    lines.push({ level, text });
    if (level === 'warn' || level === 'error') {
      console[level](text);
    } else {
      console.log(text);
    }
  };
  return {
    lines,
    info: (...args) => push('info', args),
    warn: (...args) => push('warn', args),
    error: (...args) => push('error', args)
  };
}

function tryConnect({ host = '127.0.0.1', port, pathname = '/ssh', token, origin, timeoutMs = 3000 }) {
  const url = new URL(`ws://${host}:${port}${pathname}`);
  if (token) {
    url.searchParams.set('token', token);
  }

  return new Promise((resolve) => {
    let settled = false;
    let ws;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ opened: false, statusCode: null, error: 'timeout' });
    }, timeoutMs);

    ws = new WebSocket(url.toString(), { origin });
    ws.on('open', () => {
      finish({ opened: true, statusCode: 101, error: null });
    });
    ws.on('unexpected-response', (req, res) => {
      const statusCode = res.statusCode;
      res.resume();
      finish({ opened: false, statusCode, error: `HTTP ${statusCode}` });
    });
    ws.on('error', (err) => {
      setTimeout(() => {
        finish({ opened: false, statusCode: null, error: err.message });
      }, 50);
    });
  });
}

function runCompressInShell(targetPath, archiveName) {
  const cmd = buildCompressCommand(targetPath, archiveName);
  const script = [
    'pwned_marker() { echo PWNED_RAN; }',
    'id() { echo PWNED_RAN; }',
    'tar() { printf "ARG:%s\\n" "$@"; }',
    cmd
  ].join('\n');
  return execFileSync('sh', ['-c', script], {
    encoding: 'utf8',
    timeout: 3000
  });
}

async function testOriginAndTokenFunctions() {
  assert.equal(isAllowedOrigin('https://evil.example', [EXTENSION_ORIGIN]), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:8787', [EXTENSION_ORIGIN]), false);
  assert.equal(isAllowedOrigin('', [EXTENSION_ORIGIN]), false);
  assert.equal(isAllowedOrigin(EXTENSION_ORIGIN, [EXTENSION_ORIGIN]), true);
  assert.equal(isAllowedOrigin(`${EXTENSION_ORIGIN}/home.html`, [EXTENSION_ORIGIN]), true);
  assert.equal(isAllowedOrigin('chrome-extension://otheridotheridotheridotherido', [EXTENSION_ORIGIN]), false);
  assert.equal(isAllowedOrigin(EXTENSION_ORIGIN, []), true, 'empty allowlist still requires chrome-extension origin');
  assert.equal(isAllowedOrigin('https://example.com', []), false);

  const parsed = parseAllowedOrigins({
    SSH_GATEWAY_EXTENSION_ID: EXTENSION_ID,
    SSH_GATEWAY_ALLOWED_ORIGINS: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  });
  assert.ok(parsed.includes(EXTENSION_ORIGIN));
  assert.ok(parsed.includes('chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));

  const deniedOrigin = verifyUpgradeRequest(
    { origin: 'https://evil.example', url: `/ssh?token=${VALID_TOKEN}` },
    { token: VALID_TOKEN, allowedOrigins: [EXTENSION_ORIGIN] }
  );
  assert.equal(deniedOrigin.ok, false);
  assert.equal(deniedOrigin.status, 403);
  console.log(`PASS origin-reject (unit): ${deniedOrigin.reason}`);

  const deniedToken = verifyUpgradeRequest(
    { origin: EXTENSION_ORIGIN, url: '/ssh' },
    { token: VALID_TOKEN, allowedOrigins: [EXTENSION_ORIGIN] }
  );
  assert.equal(deniedToken.ok, false);
  assert.equal(deniedToken.status, 401);
  console.log(`PASS token-reject (unit): ${deniedToken.reason}`);

  const allowed = verifyUpgradeRequest(
    { origin: EXTENSION_ORIGIN, url: `/ssh?token=${VALID_TOKEN}` },
    { token: VALID_TOKEN, allowedOrigins: [EXTENSION_ORIGIN] }
  );
  assert.equal(allowed.ok, true);
  console.log('PASS origin+token allow (unit)');

  assert.equal(tokensEqual(VALID_TOKEN, VALID_TOKEN), true);
  assert.equal(tokensEqual('wrong-token-value-xx', VALID_TOKEN), false);
  assert.equal(tokensEqual('', VALID_TOKEN), false);
}

function testCommandEscaping() {
  assert.equal(posixShellSingleQuote("it's"), `'it'\\''s'`);
  assert.equal(
    buildCompressCommand('/home/u/project', 'app.tar.gz'),
    `cd '/home/u' && tar -czf 'app.tar.gz' -- 'project'`
  );

  const injectionNames = [
    'x.tar.gz"; pwned_marker; echo "',
    '$(pwned_marker).tar.gz',
    '`pwned_marker`.tar.gz',
    "foo'; pwned_marker; echo 'bar.tar.gz",
    '$HOME.tar.gz',
    'x.tar.gz\npwned_marker'
  ];

  for (const archiveName of injectionNames) {
    const cmd = buildCompressCommand('/tmp/file', archiveName);
    assert.equal(
      cmd,
      `cd '/tmp' && tar -czf ${posixShellSingleQuote(path.posix.basename(archiveName))} -- 'file'`
    );
    const output = runCompressInShell('/tmp/file', archiveName);
    assert.equal(
      output.includes('PWNED_RAN'),
      false,
      `shell injection executed for archive name ${JSON.stringify(archiveName)}\ncmd=${cmd}\noutput=${output}`
    );
    console.log(`PASS compress-escape: ${JSON.stringify(archiveName)}`);
  }

  const pathInjection = '/tmp/file"; pwned_marker; echo "x';
  const pathCmd = buildCompressCommand(pathInjection, 'ok.tar.gz');
  assert.ok(pathCmd.includes(posixShellSingleQuote(path.posix.basename(pathInjection))));
  const pathOutput = runCompressInShell(pathInjection, 'ok.tar.gz');
  assert.equal(pathOutput.includes('PWNED_RAN'), false, `path injection executed\n${pathCmd}\n${pathOutput}`);
  console.log('PASS compress-escape: injected target path');
}

function testTokenAndKeyDefaults() {
  const envToken = resolveGatewayToken({ SSH_GATEWAY_TOKEN: VALID_TOKEN }, { persist: false });
  assert.equal(envToken.token, VALID_TOKEN);
  assert.equal(envToken.source, 'env');

  assert.throws(
    () => resolveGatewayToken({ SSH_GATEWAY_TOKEN: 'short' }, { persist: false }),
    /at least 16/
  );

  const generated = resolveGatewayToken({}, { persist: false });
  assert.ok(generated.token.length >= 16);
  assert.equal(generated.source, 'generated');
  console.log('PASS token defaults: env token used, missing token is generated, no silent empty token');
}

async function testGatewayHandshake() {
  const logger = createLogger();
  const gateway = await createSshGateway({
    host: '127.0.0.1',
    port: 0,
    path: '/ssh',
    token: VALID_TOKEN,
    allowedOrigins: [EXTENSION_ORIGIN],
    logger
  });

  try {
    const originReject = await tryConnect({
      port: gateway.port,
      token: VALID_TOKEN,
      origin: 'https://evil.example'
    });
    assert.equal(originReject.opened, false, 'web page origin must not open a gateway socket');
    if (originReject.statusCode != null) {
      assert.equal(originReject.statusCode, 403);
    }
    const originLog = logger.lines.find((line) => line.text.includes('rejected origin: https://evil.example'));
    assert.ok(originLog, 'gateway should log illegal origin rejection');
    console.log(`PASS origin-reject (ws): opened=${originReject.opened} status=${originReject.statusCode} error=${originReject.error}`);
    console.log(originLog.text);

    const missingToken = await tryConnect({
      port: gateway.port,
      origin: EXTENSION_ORIGIN
    });
    assert.equal(missingToken.opened, false, 'missing token must not open a gateway socket');
    if (missingToken.statusCode != null) {
      assert.equal(missingToken.statusCode, 401);
    }
    const tokenLog = logger.lines.find((line) => line.text.includes('rejected token: missing or invalid'));
    assert.ok(tokenLog, 'gateway should log missing/invalid token rejection');
    console.log(`PASS token-reject (ws): opened=${missingToken.opened} status=${missingToken.statusCode} error=${missingToken.error}`);

    const wrongToken = await tryConnect({
      port: gateway.port,
      token: 'wrong-token-value-xx',
      origin: EXTENSION_ORIGIN
    });
    assert.equal(wrongToken.opened, false);
    console.log(`PASS wrong-token-reject (ws): opened=${wrongToken.opened} status=${wrongToken.statusCode}`);

    const allowed = await tryConnect({
      port: gateway.port,
      token: VALID_TOKEN,
      origin: EXTENSION_ORIGIN
    });
    assert.equal(allowed.opened, true, 'extension origin with token should connect');
    console.log('PASS allowed handshake (ws): extension origin + token opened');
  } finally {
    await gateway.close();
  }
}

async function testCliDoesNotLoadDefaultKey() {
  const logger = createLogger();
  const gateway = await startGatewayFromEnv({
    SSH_GATEWAY_HOST: '127.0.0.1',
    SSH_GATEWAY_PORT: '0',
    SSH_GATEWAY_PATH: '/ssh',
    SSH_GATEWAY_TOKEN: VALID_TOKEN,
    SSH_GATEWAY_EXTENSION_ID: EXTENSION_ID
  }, logger);

  try {
    const keyWarning = logger.lines.find((line) => line.text.includes('~/.ssh/id_rsa will not be used'));
    assert.ok(keyWarning, 'gateway should not silently load ~/.ssh/id_rsa');
    const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
    assert.equal(
      logger.lines.some((line) => line.text.includes(defaultKeyPath) && line.text.includes('auth key')),
      false
    );
    console.log('PASS default-key: SSH_PRIVATE_KEY_PATH omitted, ~/.ssh/id_rsa not loaded');
  } finally {
    await gateway.close();
  }
}

async function run() {
  await testOriginAndTokenFunctions();
  testCommandEscaping();
  testTokenAndKeyDefaults();
  await testGatewayHandshake();
  await testCliDoesNotLoadDefaultKey();
  console.log('SSH gateway security tests passed.');
}

run().catch((error) => {
  console.error('SSH gateway security tests failed:', error);
  process.exitCode = 1;
});
