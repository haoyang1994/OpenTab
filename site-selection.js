(function (global) {
  'use strict';
  const t = (s, p) => global.OpenTabI18n ? global.OpenTabI18n.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p?.[k] ?? m);
  let host, mode = null, pending = false, observer;
  const saved = new Map();
  const byId = id => document.getElementById(id);
  const api = () => global.OpenTabFolders;
  const scopeKey = scope => JSON.stringify([scope.groupId, scope.parentId || '',
    scope.view ? [scope.view.sceneId, scope.view.homeGroupId, scope.view.generation] : null]);
  function eligible(site) {
    if (!site || (site.type && site.type !== 'shortcut')) return false;
    try { return ['http:', 'https:'].includes(new URL(site.url).protocol); } catch (_) { return false; }
  }
  function current() { return api().bulkMoveContext(); }
  function selectedInView(ids, context) {
    const available = new Set(context.sites.filter(eligible).map(site => site.id));
    return new Set([...ids].filter(id => available.has(id)));
  }
  function button(text, action) {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = t(text); node.addEventListener('click', action);
    return node;
  }
  function restoreTiles() {
    for (const [tile, attrs] of saved) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null) tile.removeAttribute(key); else tile.setAttribute(key, value);
      }
      tile.classList.remove('site-selectable', 'site-selected', 'site-unselectable');
      tile.querySelector('.site-selection-checkbox')?.remove();
    }
    saved.clear();
  }
  function finish(restore = true) {
    if (typeof restore === 'object') restore = restore.restoreFocus !== false;
    if (pending) return;
    const trigger = mode?.trigger;
    mode = null;
    restoreTiles();
    byId('site-selection-dialog').close();
    byId('site-selection-toolbar').hidden = true;
    document.body.classList.remove('site-selection-active');
    document.querySelectorAll('[data-select-sites]').forEach(node => { node.hidden = false; });
    if (restore) {
      if (trigger?.isConnected && !trigger.closest('.hidden')) trigger.focus();
      else byId('select-sites').focus();
    }
  }
  function sync() {
    if (!mode || pending) return;
    const context = current();
    if (scopeKey(context.scope) !== mode.scope) { finish(false); return; }
    const previousCount = mode.ids.size;
    mode.ids = selectedInView(mode.ids, context);
    if (byId('site-selection-dialog').open && mode.ids.size !== previousCount) {
      byId('site-selection-confirm').disabled = true;
      byId('site-selection-error').textContent = t('网站或目标已变化。请取消并重新选择。');
    }
    const available = new Map(context.sites.filter(eligible).map(site => [site.id, site]));
    const root = byId(mode.parentId ? 'folder-icons-container' : 'icons-container');
    root.querySelectorAll('.icon-widget').forEach(tile => {
      if (!saved.has(tile)) {
        saved.set(tile, Object.fromEntries(['href', 'role', 'tabindex', 'draggable', 'aria-disabled'].map(key => [key, tile.getAttribute(key)])));
        tile.removeAttribute('href'); tile.removeAttribute('role'); tile.tabIndex = -1; tile.draggable = false;
      }
      const site = available.get(tile.dataset.id);
      tile.classList.toggle('site-unselectable', !site);
      if (!site) { tile.setAttribute('aria-disabled', 'true'); return; }
      tile.removeAttribute('aria-disabled');
      tile.classList.add('site-selectable');
      let checkbox = tile.querySelector('.site-selection-checkbox');
      if (!checkbox) {
        checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'site-selection-checkbox';
        checkbox.setAttribute('aria-label', t('选择网站：{name}', { name: site.name || site.url }));
        tile.prepend(checkbox);
      }
      checkbox.checked = mode.ids.has(site.id);
      tile.classList.toggle('site-selected', checkbox.checked);
    });
    byId('site-selection-count').textContent = t('已选择 {count} 个网站', { count: mode.ids.size });
    byId('site-selection-move').disabled = !mode.ids.size;
    byId('site-selection-clear').disabled = !mode.ids.size;
    byId('site-selection-all').disabled = available.size === mode.ids.size;
  }
  function begin(trigger) {
    if (pending || mode) return;
    host.endDesktopDrag(); host.hideIconContextMenu();
    const context = current();
    mode = { trigger, scope: scopeKey(context.scope), parentId: context.scope.parentId, ids: new Set(), intent: api().captureBulkSelection() };
    const toolbar = byId('site-selection-toolbar');
    const root = byId(mode.parentId ? 'folder-icons-container' : 'icons-container');
    root.before(toolbar); toolbar.hidden = false;
    document.body.classList.add('site-selection-active');
    document.querySelectorAll('[data-select-sites]').forEach(node => { node.hidden = true; });
    byId('site-selection-status').textContent = '';
    sync();
    (byId('site-selection-all').disabled ? byId('site-selection-cancel') : byId('site-selection-all')).focus();
  }
  function toggle(id) {
    if (!mode || pending) return;
    const context = current();
    if (!context.sites.some(site => site.id === id && eligible(site))) return;
    if (mode.ids.has(id)) mode.ids.delete(id); else mode.ids.add(id);
    sync();
  }
  function destinationLabel(destination, context) {
    const group = context.destinations.find(item => item.kind === 'group' && item.id === destination.groupId);
    const prefix = destination.kind === 'group' ? t('分组') : t('文件夹');
    if (Array.isArray(destination.path) && destination.path.length) {
      return `${prefix} · ${destination.path.join(' / ')} (${destination.id})`;
    }
    // Every label includes stable identity, so even identical names within a
    // group remain unambiguous without depending on their current order.
    return `${prefix} · ${destination.name}${destination.kind === 'folder' && group ? ` · ${group.name}` : ''} (${destination.id})`;
  }
  function closeDestination() {
    if (pending) return;
    byId('site-selection-dialog').close();
    byId('site-selection-move').focus();
  }
  function chooseDestination() {
    sync();
    if (!mode || !mode.ids.size) return;
    const context = current(), select = byId('site-selection-destination');
    select.replaceChildren(); mode.destinations = context.destinations;
    context.destinations.forEach((destination, index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.dataset.kind = destination.kind; option.dataset.destinationId = destination.id;
      option.dataset.groupId = destination.groupId;
      if (destination.sceneId) option.dataset.sceneId = destination.sceneId;
      option.textContent = destinationLabel(destination, context); select.appendChild(option);
    });
    // Expanding the list must not make an earlier, unrelated scene the default.
    // Keep the source location selected until the user chooses a destination.
    const sourceIndex = context.scope.view ? context.destinations.findIndex(destination => context.scope.parentId
      ? destination.kind === 'folder' && destination.id === context.scope.parentId
      : destination.kind === 'group' && destination.id === context.scope.groupId) : 0;
    select.value = context.destinations.length ? String(Math.max(0, sourceIndex)) : '';
    byId('site-selection-error').textContent = '';
    captureDestination();
    byId('site-selection-confirm').disabled = !mode.destination;
    byId('site-selection-dialog').showModal(); select.focus();
  }
  function captureDestination() {
    const destination = mode?.destinations?.[Number(byId('site-selection-destination').value)];
    if (mode) {
      mode.destination = destination ? api().captureBulkDestination(destination) : null;
      const label = destination ? destinationLabel(destination, { destinations: mode.destinations }) : '';
      byId('site-selection-preview').textContent = mode.destination
        ? t('将 {count} 个网站移到「{path}」。', { count: mode.ids.size, path: label })
          + (destination.sceneId ? ' ' + t('移动后仍停留在当前场景，可撤销。') : '') : '';
      byId('site-selection-confirm').disabled = !mode.destination || !mode.ids.size;
      byId('site-selection-error').textContent = mode.destination ? '' : t('网站或目标已变化。请取消并重新选择。');
    }
  }
  async function confirm() {
    if (!mode || pending || !mode.destination || !mode.ids.size) return;
    pending = true;
    byId('site-selection-dialog').setAttribute('aria-busy', 'true');
    byId('site-selection-dialog').querySelectorAll('button, select').forEach(node => { node.disabled = true; });
    byId('site-selection-error').textContent = t('正在移动…');
    let result;
    try { result = await api().moveSites(mode.intent, [...mode.ids], mode.destination); }
    catch (_) { result = { ok: false, reason: 'save-failed' }; }
    pending = false;
    byId('site-selection-dialog').removeAttribute('aria-busy');
    byId('site-selection-dialog').querySelectorAll('button, select').forEach(node => { node.disabled = false; });
    if (result?.ok) { finish(); return; }
    const message = result?.reason === 'stale' || result?.reason === 'invalid'
      ? t('网站或目标已变化。请取消并重新选择。')
      : t('未能保存移动，网站未移动。请重试。');
    // Keep the original intent: retrying must never silently consent to a new
    // identity after a rebase. Revalidate visible IDs, not the intent token.
    sync();
    byId('site-selection-error').textContent = message;
    byId('site-selection-status').textContent = message;
    if (!mode) host.showToast(message);
    if (mode) byId('site-selection-confirm').disabled = !mode.ids.size || ['stale', 'invalid'].includes(result?.reason);
  }
  function intercept(event) {
    if (!mode) return;
    const dialog = byId('site-selection-dialog');
    if (pending) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (dialog.open) {
      if (event.type === 'contextmenu') { event.preventDefault(); event.stopImmediatePropagation(); }
      if (event.type === 'keydown') {
        // Keep native Tab/select behavior, but never let document shortcuts
        // switch groups or activate a surface behind the modal chooser.
        event.stopImmediatePropagation();
        if (event.key === 'Tab') {
          const controls = [...dialog.querySelectorAll('select, button')].filter(node => !node.disabled);
          const first = controls[0], last = controls[controls.length - 1];
          if (first && (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) {
            event.preventDefault(); (event.shiftKey ? last : first).focus();
          }
        }
        if (event.key === 'Escape') { event.preventDefault(); closeDestination(); }
      }
      return;
    }
    if (event.type === 'keydown' && ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' || event.altKey && /^Digit[1-9]$/.test(event.code || ''))) {
      finish(false); return;
    }
    if (event.type === 'keydown' && event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); finish(); return;
    }
    const root = byId(mode.parentId ? 'folder-icons-container' : 'icons-container');
    if (!root.contains(event.target)) {
      if ((event.type === 'click' || event.type === 'keydown') && !byId('site-selection-toolbar').contains(event.target)) {
        // Do not consume the ordinary interaction: searching, switching groups,
        // and opening another surface all leave selection first.
        if (event.type === 'click' || event.key !== 'Tab' && !['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) finish(false);
      }
      return;
    }
    if (event.type === 'keydown' && event.key === 'Tab') return;
    const tile = event.target.closest('.icon-widget[data-id]');
    if (tile && api().isFolderId(tile.dataset.id) && event.type === 'click' && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      finish(false); return;
    }
    if (!(event.type === 'click' && event.target.classList.contains('site-selection-checkbox'))) event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'click' && event.button === 0 || event.type === 'keydown' && [' ', 'Enter'].includes(event.key)) {
      if (tile) { toggle(tile.dataset.id); tile.querySelector('.site-selection-checkbox')?.focus(); }
    }
  }
  function init(nextHost) {
    host = nextHost;
    const toolbar = byId('site-selection-toolbar');
    toolbar.appendChild(Object.assign(document.createElement('span'), { id: 'site-selection-count' }));
    byId('site-selection-count').setAttribute('aria-live', 'polite');
    for (const [id, text, action] of [
      ['all', '全选当前视图', () => { mode.ids = new Set(current().sites.filter(eligible).map(site => site.id)); sync(); }],
      ['clear', '清除选择', () => { mode.ids.clear(); sync(); }],
      ['move', '移动到…', chooseDestination], ['cancel', '取消', () => finish()]
    ]) { const node = button(text, action); node.id = `site-selection-${id}`; toolbar.appendChild(node); }
    toolbar.appendChild(Object.assign(document.createElement('span'), { id: 'site-selection-status', role: 'status' }));
    document.querySelectorAll('[data-select-sites]').forEach(node => node.addEventListener('click', () => begin(node)));
    byId('site-selection-destination').addEventListener('change', captureDestination);
    byId('site-selection-confirm').addEventListener('click', confirm);
    byId('site-selection-dialog-cancel').addEventListener('click', closeDestination);
    byId('site-selection-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDestination(); });
    for (const type of ['click', 'auxclick', 'contextmenu', 'dragstart', 'dragover', 'drop', 'keydown']) document.addEventListener(type, intercept, true);
    observer = new MutationObserver(() => sync());
    // Observe structural changes only, never our own attributes/checkbox state.
    for (const id of ['icons-container', 'folder-icons-container']) observer.observe(byId(id), { childList: true });
    observer.observe(byId('folder-overlay'), { attributes: true, attributeFilter: ['class'] });
  }
  function containsTarget(target) {
    if (!mode || !target) return false;
    return byId('site-selection-toolbar').contains(target) || byId(mode.parentId ? 'folder-icons-container' : 'icons-container').contains(target);
  }
  global.OpenTabSiteSelection = { init, containsTarget, cancel: finish, isActive: () => Boolean(mode), isPending: () => pending,
    eligible, selectedInView, scopeKey, destinationLabel };
})(window);
