(function (global) {
  'use strict';
  const t = (s, p) => global.OpenTabI18n ? global.OpenTabI18n.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p?.[k] ?? m);
  const byId = id => document.getElementById(id);
  let host, launcher, mode = null, pending = false;
  function close(restore = true) {
    if (pending || !mode) return false;
    const trigger = mode.trigger;
    mode = null;
    byId('group-launch-dialog').close();
    if (restore && trigger?.isConnected) trigger.focus();
    return true;
  }
  function sync() {
    if (!mode) return;
    const available = mode.preview.items.filter(item => !mode.opened.has(item.key));
    for (const item of mode.preview.items) {
      const row = mode.rows.get(item.key), opened = mode.opened.has(item.key);
      row.checkbox.checked = mode.selected.has(item.key);
      row.checkbox.disabled = pending || mode.stale || opened;
      row.node.classList.toggle('group-launch-opened', opened);
      row.result.textContent = opened ? t('已打开') : mode.failed.has(item.key) ? t('未能打开，可重试') : '';
      row.node.classList.toggle('group-launch-failed', mode.failed.has(item.key));
    }
    byId('group-launch-count').textContent = t('已选择 {count} / {total} 个网站', { count: mode.selected.size, total: mode.preview.items.length });
    byId('group-launch-limit').textContent = mode.selected.size > 20 ? t('每次最多打开 20 个网站，请取消部分选择后继续。') : '';
    byId('group-launch-confirm').disabled = pending || mode.stale || !mode.selected.size || mode.selected.size > 20;
    byId('group-launch-confirm').textContent = pending ? t('正在打开…') : t('打开选中的 {count} 个网站', { count: mode.selected.size });
    byId('group-launch-all').disabled = pending || mode.stale || available.every(item => mode.selected.has(item.key));
    byId('group-launch-clear').disabled = pending || mode.stale || !mode.selected.size;
    byId('group-launch-cancel').disabled = pending;
    byId('group-launch-cancel').textContent = mode.attempted ? t('关闭') : t('取消');
    byId('group-launch-dialog').setAttribute('aria-busy', String(pending));
  }
  function begin(trigger = byId('group-launch-entry')) {
    if (mode || pending || host.isEditingBlocked?.() || global.OpenTabSiteSelection?.isPending()) return;
    global.OpenTabSiteSelection?.cancel(false);
    host.endDesktopDrag(); host.hideIconContextMenu();
    const preview = launcher.preview();
    mode = { trigger, preview, selected: new Set(preview.items.map(item => item.key)), opened: new Set(), failed: new Set(), rows: new Map(), stale: Boolean(preview.reason), attempted: false };
    byId('group-launch-title').textContent = t('打开分组：{name}', { name: preview.groupName || t('分组') });
    byId('group-launch-status').textContent = preview.reason ? t('分组或网站已变化，请关闭后重新预览。') : '';
    const list = byId('group-launch-list'); list.replaceChildren();
    for (const item of preview.items) {
      const node = document.createElement('label'); node.className = 'group-launch-row';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.key;
      checkbox.setAttribute('aria-label', t('选择网站：{name}', { name: item.name }));
      const details = document.createElement('span'); details.className = 'group-launch-details';
      const name = document.createElement('strong'); name.textContent = item.name;
      const domain = document.createElement('span'); domain.className = 'group-launch-domain'; domain.textContent = item.domain;
      const url = document.createElement('span'); url.className = 'group-launch-url'; url.textContent = item.url;
      const result = document.createElement('span'); result.className = 'group-launch-result';
      details.append(name, domain, url, result); node.append(checkbox, details); list.appendChild(node);
      mode.rows.set(item.key, { node, checkbox, result });
      checkbox.addEventListener('change', () => {
        if (!mode || pending || mode.stale || mode.opened.has(item.key)) return;
        if (checkbox.checked) mode.selected.add(item.key); else mode.selected.delete(item.key);
        sync();
      });
    }
    byId('group-launch-empty').hidden = preview.items.length > 0;
    sync(); byId('group-launch-dialog').showModal();
    // Opening a preview must not put an immediately actionable launch under Enter.
    byId('group-launch-cancel').focus();
  }
  async function confirm() {
    if (!mode || pending || mode.stale || !mode.selected.size || mode.selected.size > 20) return;
    const active = mode;
    pending = true; mode.attempted = true;
    byId('group-launch-status').textContent = t('正在打开…'); sync();
    let result;
    try { result = await launcher.launch(mode.preview, [...mode.selected]); }
    catch (_) { result = { ok: false, reason: 'unavailable', opened: [], failed: [] }; }
    pending = false;
    if (mode !== active) return;
    for (const key of result.opened || []) { mode.opened.add(key); mode.selected.delete(key); mode.failed.delete(key); }
    for (const item of result.failed || []) mode.failed.add(item.key);
    if (['stale', 'invalid-preview', 'invalid-selection'].includes(result.reason)) {
      mode.stale = true;
      byId('group-launch-status').textContent = t('分组或网站已变化，请关闭后重新预览。');
    } else if (result.failed?.length) {
      byId('group-launch-status').textContent = t('已打开 {opened} 个网站，{failed} 个未能打开。重试只会打开仍选中的网站。', { opened: mode.opened.size, failed: result.failed.length });
    } else if (result.ok) {
      byId('group-launch-status').textContent = t('已在后台打开 {count} 个网站。', { count: mode.opened.size });
    } else {
      byId('group-launch-status').textContent = t('未能验证分组，未打开新网站。请重试。');
    }
    sync();
    (byId('group-launch-confirm').disabled ? byId('group-launch-cancel') : byId('group-launch-confirm')).focus();
  }
  function intercept(event) {
    if (!mode) return;
    if (pending) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.type === 'keydown') {
      // A native modal makes the page inert; also isolate legacy document hotkeys.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const controls = [...byId('group-launch-dialog').querySelectorAll('button, input')].filter(node => !node.disabled);
        const first = controls[0], last = controls[controls.length - 1];
        if (first && (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }
    } else if (['contextmenu', 'auxclick', 'dragstart', 'drop'].includes(event.type)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }
  function init(nextHost) {
    host = nextHost;
    launcher = global.OpenTabGroupLaunchCore.create({
      getSnapshot: () => {
        if (host.isEditingBlocked?.()) throw new Error('Workspace unavailable');
        return { data: { ...host.state, 'opentab.workspaceEpoch': host.captureIntent().epoch },
          view: host.getSceneView?.(), groupId: host.state.currentFolderId };
      },
      whenIdle: () => host.whenIdle(),
      transaction: task => global.OpenTabWorkspace.transaction(task),
      createTab: url => global.chrome.tabs.create({ url, active: false })
    });
    byId('group-launch-entry').addEventListener('click', () => begin());
    byId('group-launch-cancel').addEventListener('click', () => close());
    byId('group-launch-confirm').addEventListener('click', confirm);
    byId('group-launch-all').addEventListener('click', () => { if (!mode || pending || mode.stale) return; mode.selected = new Set(mode.preview.items.filter(item => !mode.opened.has(item.key)).map(item => item.key)); sync(); });
    byId('group-launch-clear').addEventListener('click', () => { if (!mode || pending || mode.stale) return; mode.selected.clear(); sync(); });
    byId('group-launch-dialog').addEventListener('cancel', event => { event.preventDefault(); close(); });
    for (const type of ['click', 'auxclick', 'contextmenu', 'dragstart', 'drop', 'keydown']) global.addEventListener(type, intercept, true);
  }
  global.OpenTabGroupLaunch = { init, begin, cancel: close, isActive: () => Boolean(mode), isPending: () => pending };
})(window);
