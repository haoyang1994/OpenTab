import { WebSocketServer } from 'ws';
import { Client as SSHClient } from 'ssh2';
import { SocksClient } from 'socks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const HOST = process.env.SSH_GATEWAY_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.SSH_GATEWAY_PORT || '8787', 10);
const PATH = process.env.SSH_GATEWAY_PATH || '/ssh';
const PRIVATE_KEY_PATH = process.env.SSH_PRIVATE_KEY_PATH || path.join(os.homedir(), '.ssh', 'id_rsa');
const PRIVATE_KEY_PASSPHRASE = process.env.SSH_PRIVATE_KEY_PASSPHRASE || '';

let PRIVATE_KEY = '';
try {
  PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
} catch (error) {
  console.error(`[ssh-gateway] failed to read private key: ${PRIVATE_KEY_PATH}`);
  console.error('[ssh-gateway] set SSH_PRIVATE_KEY_PATH to your key file path.');
  process.exit(1);
}

const wss = new WebSocketServer({ host: HOST, port: PORT, path: PATH });

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

    const dirname = path.dirname(targetPath);
    const baseName = path.basename(targetPath);
    const cmd = `cd "${dirname}" && tar -czf "${archiveName}" "${baseName}"`;

    ssh.exec(cmd, (err, stream) => {
      if (err) {
        send({ type: 'compress-error', message: err.message, name: archiveName });
        return;
      }

      let stderr = '';
      stream.on('close', (code) => {
        if (code === 0) {
          send({ type: 'compress-success', name: archiveName });
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
      const host = String(payload.host || '').trim();
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '');
      const socksHost = String(payload.socksHost || '').trim();
      const socksUsername = String(payload.socksUsername || '').trim();
      const socksPassword = String(payload.socksPassword || '');
      const port = Number.parseInt(String(payload.port || '22'), 10);
      const socksPort = Number.parseInt(String(payload.socksPort || '1080'), 10);
      const cols = Number.parseInt(String(payload.cols || '120'), 10);
      const rows = Number.parseInt(String(payload.rows || '30'), 10);

      if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) {
        send({ type: 'error', message: 'Invalid SSH target params' });
        connecting = false;
        return;
      }
      if (socksHost && (!Number.isInteger(socksPort) || socksPort < 1 || socksPort > 65535)) {
        send({ type: 'error', message: 'Invalid SOCKS5 proxy params' });
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
        host,
        port,
        username,
        privateKey: PRIVATE_KEY,
        passphrase: PRIVATE_KEY_PASSPHRASE || undefined,
        password: password || undefined
      };

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
          host,
          port
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

console.log(`SSH gateway listening on ws://${HOST}:${PORT}${PATH}`);
console.log(`[ssh-gateway] auth key: ${PRIVATE_KEY_PATH}`);
