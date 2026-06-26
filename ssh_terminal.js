(function() {
  const titleEl = document.getElementById('title');
  const metaEl = document.getElementById('meta');
  const statusEl = document.getElementById('status');
  const faviconEl = document.getElementById('page-favicon');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const terminalContainer = document.getElementById('terminal');
  const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
  const fileSidebar = document.getElementById('file-sidebar');
  const fileTreeContainer = document.getElementById('file-tree-container');
  const refreshFilesBtn = document.getElementById('refresh-files-btn');
  const contextMenu = document.getElementById('context-menu');
  const ctxUpload = document.getElementById('ctx-upload');
  const ctxDownload = document.getElementById('ctx-download');
  const ctxCompress = document.getElementById('ctx-compress');
  const uploadInput = document.getElementById('upload-input');
  const goUpBtn = document.getElementById('go-up-btn');
  const filePathInput = document.getElementById('file-path-input');

  const terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
    fontSize: 14,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: {
      background: '#050a11',
      foreground: '#d9e6f2',
      cursor: '#7bd1ff'
    }
  });
  const fitAddon = new self.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);

  let socket = null;
  let fitRafId = 0;
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');

  function setStatus(text, state) {
    statusEl.textContent = text;
    statusEl.classList.remove('status-idle', 'status-online', 'status-offline');
    statusEl.classList.add(state);
  }

  function writeLine(message) {
    terminal.writeln(message);
  }

  function setFaviconToPrompt() {
    if (!faviconEl) return;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="10" fill="#0b1726"/>
        <text x="10" y="42" font-size="28" font-family="Consolas, Menlo, Monaco, monospace" fill="#8df2c2">&gt;_</text>
      </svg>
    `;
    faviconEl.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function sendPacket(packet) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(packet));
  }

  async function copySelectionToClipboard() {
    const text = terminal.getSelection();
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    }
  }

  async function pasteClipboardToTerminal() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return false;
      sendPacket({ type: 'input', data: text });
      return true;
    } catch (error) {
      return false;
    }
  }

  function scheduleFit() {
    if (fitRafId) cancelAnimationFrame(fitRafId);
    fitRafId = requestAnimationFrame(() => {
      fitRafId = 0;
      fitAddon.fit();
      sendPacket({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
    });
  }

  function updateFullscreenButtonLabel() {
    const isFullscreen = Boolean(document.fullscreenElement);
    fullscreenBtn.textContent = isFullscreen ? '退出全屏' : '全屏';
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
      updateFullscreenButtonLabel();
      scheduleFit();
      terminal.focus();
    } catch (error) {
      writeLine(`\r\n[error] fullscreen failed: ${error.message}\r\n`);
    }
  }

  function handleServerMessage(raw) {
    if (typeof raw !== 'string') {
      terminal.write(raw);
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      payload = null;
    }

    if (!payload) {
      terminal.write(raw);
      return;
    }

    if (payload.type === 'output' && typeof payload.data === 'string') {
      terminal.write(payload.data);
      return;
    }

    if (payload.type === 'error') {
      writeLine(`\r\n[error] ${payload.message || 'unknown error'}\r\n`);
      return;
    }

    if (payload.type === 'ready') {
      writeLine('\r\n[connected] SSH session ready\r\n');
      if (socket && socket.readyState === WebSocket.OPEN) {
        sendPacket({ type: 'ls', path: '.' });
      }
      return;
    }

    if (payload.type === 'close') {
      writeLine(`\r\n[closed] ${payload.reason || 'server closed'}\r\n`);
      return;
    }

    if (payload.type === 'ls') {
      renderFileTree(payload.files, payload.path);
      return;
    }

    if (payload.type === 'upload-success') {
      writeLine(`[info] uploaded ${payload.name} successfully`);
      sendPacket({ type: 'ls', path: currentPath });
      return;
    }

    if (payload.type === 'upload-error') {
      writeLine(`[error] upload failed: ${payload.message}`);
      return;
    }

    if (payload.type === 'download-success') {
      writeLine(`[info] download ready: ${payload.name}`);
      const link = document.createElement('a');
      link.href = 'data:application/octet-stream;base64,' + payload.data;
      link.download = payload.name;
      link.click();
      writeLine(`[info] downloaded ${payload.name}`);
      return;
    }

    if (payload.type === 'download-error') {
      writeLine(`[error] download failed: ${payload.message}`);
      return;
    }

    if (payload.type === 'compress-success') {
      writeLine(`[info] compressed to ${payload.name}`);
      sendPacket({ type: 'ls', path: currentPath });
      return;
    }

    if (payload.type === 'compress-error') {
      writeLine(`[error] compress failed: ${payload.message}`);
      return;
    }

    if (typeof payload.data === 'string') {
      terminal.write(payload.data);
    }
  }

  function connect(icon) {
    const target = `${icon.sshUsername}@${icon.sshHost}:${icon.sshPort}`;
    titleEl.textContent = icon.name;
    document.title = icon.name || 'SSH Terminal';
    metaEl.textContent = `${target}  via  ${icon.sshGatewayUrl}`;

    setStatus('连接中', 'status-idle');
    writeLine(`[info] connecting to gateway ${icon.sshGatewayUrl}`);

    socket = new WebSocket(icon.sshGatewayUrl);

    socket.addEventListener('open', () => {
      scheduleFit();
      setStatus('已连接', 'status-online');
      writeLine('[info] gateway connected');
      sendPacket({
        type: 'connect',
        payload: {
          host: icon.sshHost,
          port: icon.sshPort,
          username: icon.sshUsername,
          password: icon.sshPassword || '',
          socksHost: icon.sshSocksHost || '',
          socksPort: icon.sshSocksPort || 1080,
          socksUsername: icon.sshSocksUsername || '',
          socksPassword: icon.sshSocksPassword || '',
          cols: terminal.cols,
          rows: terminal.rows
        }
      });
    });

    socket.addEventListener('message', async (event) => {
      if (typeof event.data === 'string') {
        handleServerMessage(event.data);
        return;
      }
      if (event.data instanceof Blob) {
        const text = await event.data.text();
        handleServerMessage(text);
      }
    });

    socket.addEventListener('close', () => {
      setStatus('已断开', 'status-offline');
      writeLine('\r\n[info] disconnected\r\n');
    });

    socket.addEventListener('error', () => {
      setStatus('连接失败', 'status-offline');
      writeLine('\r\n[error] websocket connection failed\r\n');
    });
  }

  function getIconIdFromQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get('iconId') || '';
  }

  function loadSshIcon(iconId) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['icons'], (result) => {
        const icons = Array.isArray(result.icons) ? result.icons : [];
        const icon = icons.find((item) => item && item.id === iconId);
        resolve(icon || null);
      });
    });
  }

  terminal.open(terminalContainer);
  fitAddon.fit();
  terminal.focus();
  setFaviconToPrompt();
  updateFullscreenButtonLabel();
  setStatus('未连接', 'status-idle');
  writeLine('[info] terminal ready');

  terminal.onData((data) => {
    sendPacket({ type: 'input', data });
  });

  terminal.onResize((size) => {
    sendPacket({ type: 'resize', cols: size.cols, rows: size.rows });
  });

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const key = (event.key || '').toLowerCase();
    const hasSelection = terminal.hasSelection();

    const isCopy =
      (isMac && event.metaKey && !event.ctrlKey && !event.altKey && key === 'c') ||
      (!isMac && event.ctrlKey && event.shiftKey && key === 'c');
    if (isCopy && hasSelection) {
      event.preventDefault();
      copySelectionToClipboard();
      return false;
    }

    const isPaste =
      (isMac && event.metaKey && !event.ctrlKey && !event.altKey && key === 'v') ||
      (!isMac && event.ctrlKey && event.shiftKey && key === 'v') ||
      (event.shiftKey && key === 'insert');
    if (isPaste) {
      event.preventDefault();
      pasteClipboardToTerminal();
      return false;
    }

    return true;
  });

  // Keep fit trigger points minimal to avoid high-frequency reflow loops.
  window.addEventListener('resize', scheduleFit);
  document.addEventListener('fullscreenchange', () => {
    updateFullscreenButtonLabel();
    scheduleFit();
  });
  scheduleFit();

  fullscreenBtn.addEventListener('click', toggleFullscreen);
  disconnectBtn.addEventListener('click', () => {
    if (!socket) return;
    sendPacket({ type: 'disconnect' });
    socket.close();
  });

  const iconId = getIconIdFromQuery();
  if (!iconId) {
    setStatus('参数错误', 'status-offline');
    writeLine('[error] missing iconId query param');
    return;
  }

  loadSshIcon(iconId).then((icon) => {
    if (!icon) {
      setStatus('未找到', 'status-offline');
      writeLine('[error] ssh icon not found');
      return;
    }

    if (icon.type !== 'ssh' || !icon.sshGatewayUrl || !icon.sshHost || !icon.sshUsername) {
      setStatus('配置错误', 'status-offline');
      writeLine('[error] invalid ssh icon config');
      return;
    }

    connect(icon);
  });

  let currentPath = '.';
  let selectedItem = null;
  let isSidebarVisible = false;

  toggleSidebarBtn.addEventListener('click', () => {
    isSidebarVisible = !isSidebarVisible;
    fileSidebar.classList.toggle('hidden', !isSidebarVisible);
    toggleSidebarBtn.classList.toggle('active', isSidebarVisible);
    scheduleFit();
  });

  refreshFilesBtn.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendPacket({ type: 'ls', path: currentPath });
    }
  });

  goUpBtn.addEventListener('click', () => {
    let parentPath;
    if (currentPath === '.' || currentPath === '/') {
      parentPath = '/';
    } else if (currentPath.endsWith('/')) {
      parentPath = currentPath.slice(0, -1).split('/').slice(0, -1).join('/') || '/';
    } else {
      parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    }
    if (parentPath !== currentPath && socket && socket.readyState === WebSocket.OPEN) {
      sendPacket({ type: 'ls', path: parentPath });
    }
  });

  filePathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && socket && socket.readyState === WebSocket.OPEN) {
      const newPath = filePathInput.value.trim();
      if (newPath) {
        sendPacket({ type: 'ls', path: newPath });
      }
    }
  });

  function hideContextMenu() {
    contextMenu.classList.add('hidden');
  }

  document.addEventListener('click', hideContextMenu);

  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function renderFileTree(files, path) {
    if (!files || files.length === 0) {
      fileTreeContainer.innerHTML = '<div class="file-tree-empty">空目录</div>';
      return;
    }

    const sorted = [...files].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    const html = sorted.map(item => {
      const icon = item.isDirectory
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"></path></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"></path></svg>';
      
      return `<div class="tree-item ${item.isDirectory ? 'directory' : 'file'}" data-path="${item.path}" data-name="${item.name}" data-is-dir="${item.isDirectory}">
        <span class="icon">${icon}</span>
        <span class="name" title="${item.name}">${item.name}</span>
        ${item.size !== undefined ? `<span class="size">${formatSize(item.size)}</span>` : ''}
      </div>`;
    }).join('');

    fileTreeContainer.innerHTML = html;
    currentPath = path;
    filePathInput.value = path === '.' ? '' : path;

    fileTreeContainer.querySelectorAll('.tree-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = item.dataset.path;
        const isDir = item.dataset.isDir === 'true';
        
        if (isDir) {
          sendPacket({ type: 'ls', path });
        } else {
          fileTreeContainer.querySelectorAll('.tree-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          selectedItem = { path, name: item.dataset.name, isDirectory: false };
        }
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideContextMenu();
        
        fileTreeContainer.querySelectorAll('.tree-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        
        const isDir = item.dataset.isDir === 'true';
        selectedItem = { path: item.dataset.path, name: item.dataset.name, isDirectory: isDir };
        
        ctxUpload.style.display = isDir ? 'block' : 'none';
        ctxDownload.style.display = isDir ? 'none' : 'block';
        
        const menuHeight = 120;
        let top = e.clientY;
        let flipUp = false;
        
        if (e.clientY + menuHeight > window.innerHeight) {
          top = e.clientY - menuHeight;
          flipUp = true;
        }
        
        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = top + 'px';
        contextMenu.classList.toggle('flip-up', flipUp);
        contextMenu.classList.remove('hidden');
      });
    });
  }

  fileTreeContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileTreeContainer.classList.add('drag-over');
  });

  fileTreeContainer.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileTreeContainer.classList.remove('drag-over');
  });

  fileTreeContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileTreeContainer.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (!files.length || !selectedItem || !selectedItem.isDirectory) {
      writeLine('[warn] 请先选择一个文件夹');
      return;
    }

    const targetPath = selectedItem.path;
    Array.from(files).forEach(file => {
      uploadFile(file, targetPath);
    });
  });

  function uploadFile(file, targetDir) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      const base64 = evt.target.result.split(',')[1];
      const targetPath = targetDir.replace(/\/$/, '') + '/' + file.name;
      
      writeLine(`[info] uploading ${file.name} to ${targetPath}...`);
      
      sendPacket({
        type: 'upload',
        path: targetPath,
        data: base64,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  }

  ctxUpload.addEventListener('click', (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (!selectedItem || !selectedItem.isDirectory) {
      writeLine('[warn] 请先选择一个文件夹');
      return;
    }
    uploadInput.dataset.targetPath = selectedItem.path;
    uploadInput.click();
  });

  uploadInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files.length) return;
    
    const targetPath = uploadInput.dataset.targetPath || currentPath;
    Array.from(files).forEach(file => {
      uploadFile(file, targetPath);
    });
    uploadInput.value = '';
  });

  ctxDownload.addEventListener('click', (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (!selectedItem || selectedItem.isDirectory) return;
    
    writeLine(`[info] downloading ${selectedItem.name}...`);
    sendPacket({ type: 'download', path: selectedItem.path, name: selectedItem.name });
  });

  ctxCompress.addEventListener('click', (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (!selectedItem) return;
    
    const name = selectedItem.name.replace(/\/$/, '');
    const archiveName = name + '.tar.gz';
    writeLine(`[info] compressing ${selectedItem.name} to ${archiveName}...`);
    sendPacket({ type: 'compress', path: selectedItem.path, name: archiveName });
  });

})();
