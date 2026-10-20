import { WebSocketServer } from 'ws';
import { Client as SSHClient } from 'ssh2';
import { SocksClient } from 'socks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const MIN_TOKEN_LENGTH = 16;
const DEFAULT_TOKEN_FILE = path.join(os.homedir(), '.config', 'opentab', 'ssh-gateway.token');

export function posixShellSingleQuote(value) {
  const str = String(value);
  if (str.includes('\0')) {
    throw new Error('NUL byte is not allowed in shell arguments');
  }
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

export function buildCompressCommand(targetPath, archiveName) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('No target path');
  }
  if (targetPath.includes('\0')) {
    throw new Error('Invalid target path');
  }

  const dirname = path.posix.dirname(targetPath);
  const baseName = path.posix.basename(targetPath);
  const archiveBase = path.posix.basename(String(archiveName || 'archive.tar.gz'));

  if (!baseName || baseName === '.' || baseName === '..') {
    throw new Error('Invalid target path');
  }
  if (!archiveBase || archiveBase === '.' || archiveBase === '..') {
    throw new Error('Invalid archive name');
  }
  if (archiveBase.includes('/') || archiveBase.includes('\\') || archiveBase.includes('\0')) {
    throw new Error('Invalid archive name');
  }

  return `cd ${posixShellSingleQuote(dirname)} && tar -czf ${posixShellSingleQuote(archiveBase)} -- ${posixShellSingleQuote(baseName)}`;
}

export function extensionOriginFromId(id) {
  const cleaned = String(id || '').trim();
  if (!cleaned) {
    throw new Error('empty extension id');
  }
  if (cleaned.includes('://')) {
    const key = chromeExtensionOriginKey(cleaned);
    if (!key) {
      throw new Error('SSH_GATEWAY_EXTENSION_ID must be a Chrome extension id or chrome-extension:// origin');
    }
    return key;
  }
  return `chrome-extension://${cleaned}`;
}

export function chromeExtensionOriginKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'chrome-extension:') return '';
    const id = url.hostname || url.host;
    if (!id) return '';
    return `chrome-extension://${id}`;
  } catch {
    return '';
  }
}

export function parseAllowedOrigins(env = process.env) {
  const origins = [];
  const raw = String(env.SSH_GATEWAY_ALLOWED_ORIGINS || '');
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.includes('://') ? chromeExtensionOriginKey(trimmed) : extensionOriginFromId(trimmed);
    if (key) origins.push(key);
  }
  const id = String(env.SSH_GATEWAY_EXTENSION_ID || '').trim();
  if (id) {
    origins.push(extensionOriginFromId(id));
  }
  return [...new Set(origins)];
}

export function isAllowedOrigin(origin, allowedOrigins = []) {
  const key = chromeExtensionOriginKey(origin);
  if (!key) return false;
  if (!allowedOrigins.length) return true;
  return allowedOrigins.includes(key);
}

export function tokensEqual(provided, expected) {
  const a = Buffer.from(String(provided ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (b.length === 0) return false;
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function extractTokenFromRequestUrl(reqUrl) {
  try {
    const url = new URL(String(reqUrl || ''), 'http://127.0.0.1');
    return url.searchParams.get('token') || '';
  } catch {
    return '';
  }
}

export function verifyUpgradeRequest({ origin, url, token }, config) {
  if (!isAllowedOrigin(origin, config.allowedOrigins || [])) {
    return {
      ok: false,
      status: 403,
      reason: `rejected origin: ${origin || '(missing)'}`
    };
  }
  const provided = token == null ? extractTokenFromRequestUrl(url) : token;
  if (!tokensEqual(provided, config.token)) {
    return {
      ok: false,
      status: 401,
      reason: 'rejected token: missing or invalid'
    };
  }
  return { ok: true, status: 101, reason: 'ok' };
}

export function resolveGatewayToken(env = process.env, { persist = true, fsImpl = fs } = {}) {
  const fromEnv = String(env.SSH_GATEWAY_TOKEN || '').trim();
  if (fromEnv) {
    if (fromEnv.length < MIN_TOKEN_LENGTH) {
      throw new Error(`SSH_GATEWAY_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
    }
    return { token: fromEnv, source: 'env', tokenFile: '' };
  }

  const tokenFile = String(env.SSH_GATEWAY_TOKEN_FILE || DEFAULT_TOKEN_FILE);
  try {
    const existing = fsImpl.readFileSync(tokenFile, 'utf8').trim();
    if (existing.length >= MIN_TOKEN_LENGTH) {
      return { token: existing, source: 'file', tokenFile };
    }
  } catch {
    // generate below
  }

  const token = crypto.randomBytes(32).toString('base64url');
  if (persist) {
    fsImpl.mkdirSync(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
    fsImpl.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  }
  return { token, source: persist ? 'generated-file' : 'generated', tokenFile: persist ? tokenFile : '' };
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function defaultLogger() {
  return {
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args)
  };
}

export function createSshGateway({
  host = '127.0.0.1',
  port = 8787,
  path: wsPath = '/ssh',
  token,
  allowedOrigins = [],
  privateKey = '',
  privateKeyPassphrase = '',
  logger = defaultLogger()
} = {}) {
  if (!token || String(token).length < MIN_TOKEN_LENGTH) {
    throw new Error(`gateway token is required (min ${MIN_TOKEN_LENGTH} chars)`);
  }

  const config = {
    token: String(token),
    allowedOrigins: Array.isArray(allowedOrigins) ? allowedOrigins : []
  };

  const wss = new WebSocketServer({
    host,
    port,
    path: wsPath,
    verifyClient(info, done) {
      const origin = info.origin || info.req?.headers?.origin || '';
      const result = verifyUpgradeRequest(
        { origin, url: info.req?.url || '' },
        config
      );
      if (!result.ok) {
        logger.warn(`[ssh-gateway] ${result.reason}`);
        done(false, result.status, result.status === 403 ? 'Forbidden origin' : 'Unauthorized');
        return;
      }
      done(true);
    }
  });

  wss.on('connection', (ws) => {
    const ssh = new SSHClient();
    let shell = null;
    let sftp = null;
    let connecting = false;
    let connected = false;

    const send = (payload) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(payload));
    };

    function initSFTP(callback) {
      if (sftp) {
        callback(null, sftp);
        return;
      }
      ssh.sftp((err, sftpObj) => {
        if (err) {
          callback(err, null);
          return;
        }
        sftp = sftpObj;
        callback(null, sftpObj);
      });
    }

    function handleList(msg) {
      const targetPath = msg.path || '.';
      initSFTP((err, sftpObj) => {
        if (err) {
          send({ type: 'error', message: `SFTP init failed: ${err.message}` });
          return;
        }
        sftpObj.readdir(targetPath, (err, list) => {
          if (err) {
            send({ type: 'ls', files: [], path: targetPath });
            return;
          }
          const files = list.map(item => ({
            name: item.filename,
            path: path.join(targetPath, item.filename).replace(/\\/g, '/'),
            isDirectory: item.attrs.isDirectory(),
            size: item.attrs.size
          }));
          send({ type: 'ls', files, path: targetPath });
        });
      });
    }

    function handleUpload(msg) {
      const targetPath = msg.path || '';
      const data = msg.data || '';
      const name = msg.name || 'file';

      if (!targetPath) {
        send({ type: 'upload-error', message: 'No target path', name });
        return;
      }

      initSFTP((err, sftpObj) => {
        if (err) {
          send({ type: 'upload-error', message: err.message, name });
          return;
        }

        let buffer;
        try {
          buffer = Buffer.from(data, 'base64');
        } catch (e) {
          send({ type: 'upload-error', message: 'Invalid base64 data', name });
          return;
        }

        const writeStream = sftpObj.createWriteStream(targetPath);

        writeStream.on('error', (err) => {
          send({ type: 'upload-error', message: err.message, name });
        });

        writeStream.on('close', () => {
          send({ type: 'upload-success', path: targetPath, name });
        });

        const readable = Readable.from([buffer]);
        readable.pipe(writeStream);
      });
    }

    function handleDownload(msg) {
      const targetPath = msg.path || '';
      const name = msg.name || 'download';

      if (!targetPath) {
        send({ type: 'download-error', message: 'No target path', name });
        return;
      }

      initSFTP((err, sftpObj) => {
        if (err) {
          send({ type: 'download-error', message: err.message, name });
          return;
        }

        const chunks = [];
        const readStream = sftpObj.createReadStream(targetPath);

        readStream.on('error', (err) => {
          send({ type: 'download-error', message: err.message, name });
        });

        readStream.on('data', (chunk) => {
          chunks.push(chunk);
        });

        readStream.on('close', () => {
          try {
            const buffer = Buffer.concat(chunks);
            const base64 = buffer.toString('base64');
            send({ type: 'download-success', path: targetPath, name, data: base64 });
          } catch (e) {
            send({ type: 'download-error', message: e.message, name });
          }
        });
      });
    }

    function handleCompress(msg) {
      const targetPath = msg.path || '';
      const archiveName = msg.name || 'archive.tar.gz';

      if (!targetPath) {
        send({ type: 'compress-error', message: 'No target path', name: archiveName });
        return;
      }

      let cmd;
      try {
        cmd = buildCompressCommand(targetPath, archiveName);
      } catch (error) {
        send({ type: 'compress-error', message: error.message, name: archiveName });
        return;
      }

      ssh.exec(cmd, (err, stream) => {
        if (err) {
          send({ type: 'compress-error', message: err.message, name: archiveName });
          return;
        }

        let stderr = '';
        stream.on('close', (code) => {
          if (code === 0) {
            send({ type: 'compress-success', name: path.posix.basename(String(archiveName || 'archive.tar.gz')) });
          } else {
            send({ type: 'compress-error', message: stderr || `exit code ${code}`, name: archiveName });
          }
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    }

    ws.on('message', (buffer) => {
      const msg = safeJsonParse(String(buffer));
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'ls') {
        if (!connected) {
          send({ type: 'ls', files: [], path: msg.path || '.' });
          return;
        }
        handleList(msg);
        return;
      }

      if (msg.type === 'upload') {
        if (!connected) {
          send({ type: 'upload-error', message: 'Not connected', name: msg.name });
          return;
        }
        handleUpload(msg);
        return;
      }

      if (msg.type === 'download') {
        if (!connected) {
          send({ type: 'download-error', message: 'Not connected', name: msg.name });
          return;
        }
        handleDownload(msg);
        return;
      }

      if (msg.type === 'compress') {
        if (!connected) {
          send({ type: 'compress-error', message: 'Not connected', name: msg.name });
          return;
        }
        handleCompress(msg);
        return;
      }

      if (msg.type === 'connect') {
        if (connecting) return;
        connecting = true;
        const payload = msg.payload || {};
        const sshHost = String(payload.host || '').trim();
        const username = String(payload.username || '').trim();
        const password = String(payload.password || '');
        const socksHost = String(payload.socksHost || '').trim();
        const socksUsername = String(payload.socksUsername || '').trim();
        const socksPassword = String(payload.socksPassword || '');
        const sshPort = Number.parseInt(String(payload.port || '22'), 10);
        const socksPort = Number.parseInt(String(payload.socksPort || '1080'), 10);
        const cols = Number.parseInt(String(payload.cols || '120'), 10);
        const rows = Number.parseInt(String(payload.rows || '30'), 10);

        if (!sshHost || !username || !Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
          send({ type: 'error', message: 'Invalid SSH target params' });
          connecting = false;
          return;
        }
        if (socksHost && (!Number.isInteger(socksPort) || socksPort < 1 || socksPort > 65535)) {
          send({ type: 'error', message: 'Invalid SOCKS5 proxy params' });
          connecting = false;
          return;
        }
        if (!privateKey && !password) {
          send({ type: 'error', message: 'No SSH credentials: set SSH_PRIVATE_KEY_PATH on the gateway or provide a password' });
          connecting = false;
          return;
        }

        ssh
          .on('ready', () => {
            ssh.shell(
              {
                term: 'xterm-256color',
                cols,
                rows
              },
              {
                env: {
                  TERM: 'xterm-256color',
                  COLORTERM: 'truecolor'
                }
              },
              (err, stream) => {
              if (err) {
                send({ type: 'error', message: err.message });
                return;
              }
              shell = stream;
              connected = true;
              send({ type: 'ready' });
              stream.on('data', (chunk) => {
                send({ type: 'output', data: chunk.toString('utf8') });
              });
              stream.on('close', () => {
                send({ type: 'close', reason: 'shell closed' });
              });
              }
            );
          })
          .on('error', (err) => {
            send({ type: 'error', message: err.message });
            connecting = false;
          })
          .on('close', () => {
            connecting = false;
          });

        const connectConfig = {
          host: sshHost,
          port: sshPort,
          username
        };
        if (privateKey) {
          connectConfig.privateKey = privateKey;
          if (privateKeyPassphrase) {
            connectConfig.passphrase = privateKeyPassphrase;
          }
        }
        if (password) {
          connectConfig.password = password;
        }

        if (!socksHost) {
          ssh.connect(connectConfig);
          return;
        }

        SocksClient.createConnection({
          proxy: {
            host: socksHost,
            port: socksPort,
            type: 5,
            userId: socksUsername || undefined,
            password: socksPassword || undefined
          },
          command: 'connect',
          destination: {
            host: sshHost,
            port: sshPort
          }
        })
          .then(({ socket }) => {
            ssh.connect({
              ...connectConfig,
              sock: socket
            });
          })
          .catch((error) => {
            send({ type: 'error', message: `SOCKS5 connect failed: ${error.message}` });
            connecting = false;
          });
        return;
      }

      if (msg.type === 'input' && shell) {
        shell.write(String(msg.data || ''));
        return;
      }

      if (msg.type === 'resize' && shell) {
        const cols = Number.parseInt(String(msg.cols || '120'), 10);
        const rows = Number.parseInt(String(msg.rows || '30'), 10);
        if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
          shell.setWindow(rows, cols, 0, 0);
        }
        return;
      }

      if (msg.type === 'disconnect') {
        ws.close();
      }
    });

    ws.on('close', () => {
      connected = false;
      if (shell) shell.end();
      ssh.end();
    });
  });

  function close() {
    return new Promise((resolve) => {
      for (const client of wss.clients) {
        try {
          client.close();
        } catch {
          // ignore
        }
      }
      wss.close(() => resolve());
    });
  }

  const ready = new Promise((resolve, reject) => {
    const onError = (error) => {
      wss.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      wss.off('error', onError);
      resolve();
    };
    if (wss.address()) {
      resolve();
      return;
    }
    wss.once('error', onError);
    wss.once('listening', onListening);
  });

  return ready.then(() => {
    const address = wss.address();
    const listenPort = address && typeof address === 'object' ? address.port : port;
    return {
      wss,
      host,
      port: listenPort,
      path: wsPath,
      token,
      allowedOrigins: config.allowedOrigins,
      close
    };
  });
}

export async function startGatewayFromEnv(env = process.env, logger = defaultLogger()) {
  const host = env.SSH_GATEWAY_HOST || '127.0.0.1';
  const port = Number.parseInt(env.SSH_GATEWAY_PORT || '8787', 10);
  const wsPath = env.SSH_GATEWAY_PATH || '/ssh';
  const { token, source, tokenFile } = resolveGatewayToken(env);
  const allowedOrigins = parseAllowedOrigins(env);
  const privateKeyPath = String(env.SSH_PRIVATE_KEY_PATH || '').trim();
  const privateKeyPassphrase = env.SSH_PRIVATE_KEY_PASSPHRASE || '';
  let privateKey = '';

  if (privateKeyPath) {
    try {
      privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    } catch {
      logger.error(`[ssh-gateway] failed to read private key: ${privateKeyPath}`);
      logger.error('[ssh-gateway] set SSH_PRIVATE_KEY_PATH to an existing key file, or omit it to use password auth only.');
      throw new Error(`failed to read private key: ${privateKeyPath}`);
    }
  }

  const gateway = await createSshGateway({
    host,
    port,
    path: wsPath,
    token,
    allowedOrigins,
    privateKey,
    privateKeyPassphrase,
    logger
  });

  logger.info(`SSH gateway listening on ws://${gateway.host}:${gateway.port}${gateway.path}`);
  if (allowedOrigins.length) {
    logger.info(`[ssh-gateway] allowed origins: ${allowedOrigins.join(', ')}`);
  } else {
    logger.warn('[ssh-gateway] SSH_GATEWAY_EXTENSION_ID is not set; any chrome-extension:// origin is accepted. Set the OpenTab extension id to pin the allowlist.');
  }
  logger.info(`[ssh-gateway] token source: ${source}${tokenFile ? ` (${tokenFile})` : ''}`);
  logger.info(`[ssh-gateway] access token: ${token}`);
  logger.info('[ssh-gateway] paste this token into the OpenTab SSH icon (gateway token field).');
  if (privateKeyPath) {
    logger.info(`[ssh-gateway] auth key: ${privateKeyPath}`);
  } else {
    logger.info('[ssh-gateway] SSH_PRIVATE_KEY_PATH not set; ~/.ssh/id_rsa will not be used. Password auth only unless you configure a key.');
  }

  return gateway;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  startGatewayFromEnv().catch((error) => {
    console.error(`[ssh-gateway] ${error.message}`);
    process.exit(1);
  });
}
