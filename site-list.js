(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSiteList = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  let controller = null;
  const t = (source, params = {}) => root.OpenTabI18n
    ? root.OpenTabI18n.t(source, params)
    : String(source).replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);

  // A separate controller keeps the home boot path and single-shortcut editor
  // unchanged. No clipboard access, network lookups or global key handlers.
  function bind(doc = root.document) {
    if (!doc) return null;
    const $ = id => doc.getElementById(id);
    const form = $('site-list-form');
    if (!form || form.dataset.ready) return null;
    form.dataset.ready = '1';
    const input = $('site-list-input'), group = $('site-list-group');
    const previewButton = $('site-list-preview-btn'), confirm = $('site-list-confirm');
    const cancel = $('site-list-cancel'), status = $('site-list-status');
    const previewBox = $('site-list-preview'), summary = $('site-list-summary'), rows = $('site-list-rows');
    const panel = $('settings-panel'), modal = $('add-icon-modal'), entry = $('modal-paste-sites');
    let revision = 0, contextRequest = 0, preview = null, matchingText = '', matchingGroup = '';
    let previewing = false, committing = false, committed = false, switching = false;
    let modalWasOpen = false, modalDefaults = [], pendingControls = [];
    const opened = () => !!panel && !panel.classList.contains('hidden');
    const backend = () => root.OpenTabImport;
    const setStatus = (message = '', error = false) => {
      status.textContent = message;
      status.classList.toggle('site-list-error', error);
    };
    const current = () => preview && matchingText === input.value && matchingGroup === group.value;
    function lockSettings() {
      pendingControls = Array.from(panel.querySelectorAll('input, select, textarea, button')).map(node => [node, node.disabled]);
      pendingControls.forEach(([node]) => { node.disabled = true; });
      status.focus({ preventScroll: true });
    }
    function releaseSettings() {
      pendingControls.forEach(([node, disabled]) => { node.disabled = disabled; });
      pendingControls = [];
    }
    function syncControls() {
      const busy = committing || committed;
      input.disabled = busy;
      group.disabled = busy || !group.options.length;
      previewButton.disabled = busy || previewing || !group.value || !input.value.trim();
      confirm.disabled = busy || !current() || !preview.ok || !preview.counts.ready;
      cancel.disabled = busy;
      form.setAttribute('aria-busy', String(committing || previewing));
    }
    function invalidate(message = '') {
      revision += 1;
      preview = null;
      previewing = false;
      previewBox.hidden = true;
      rows.textContent = '';
      summary.textContent = '';
      confirm.textContent = t('确认添加');
      if (!committing && !committed) setStatus(message);
      syncControls();
    }
    async function loadGroups() {
      const request = ++contextRequest;
      try {
        const context = await backend().readUrlListContext();
        if (request !== contextRequest || !opened() || committing || committed) return;
        const previous = group.value;
        const activeTab = doc.querySelector('#group-tabs [aria-selected="true"], #group-tabs .group-tab.active');
        const activeId = activeTab && activeTab.dataset.groupId;
        const ids = new Set(context.groups.map(item => item.id));
        const preferred = input.value.trim() && ids.has(previous) ? previous
          : ids.has(activeId) ? activeId : ids.has(context.currentFolderId) ? context.currentFolderId : context.groups[0]?.id;
        group.textContent = '';
        context.groups.forEach(item => {
          const option = doc.createElement('option');
          option.value = item.id;
          option.textContent = item.name;
          group.appendChild(option);
        });
        group.value = preferred || '';
        syncControls();
      } catch (error) {
        if (request !== contextRequest || !opened()) return;
        group.textContent = '';
        setStatus(t('无法读取分组，请关闭设置后重试。'), true);
        syncControls();
      }
    }
    function render(result) {
      rows.textContent = '';
      if (!result.ok) {
        setStatus(t(result.message), true);
        previewBox.hidden = true;
        return;
      }
      const labels = { ready: t('可添加'), duplicate: t('重复，跳过'), invalid: t('无效，跳过') };
      result.rows.forEach(row => {
        const li = doc.createElement('li');
        li.className = 'site-list-row';
        li.dataset.status = row.status;
        const line = doc.createElement('span');
        line.className = 'site-list-line';
        line.textContent = t('第 {line} 行', { line: row.lineNumber });
        const value = doc.createElement('span');
        value.className = 'site-list-url';
        value.textContent = row.url || row.raw;
        const state = doc.createElement('span');
        state.className = 'site-list-result';
        state.textContent = labels[row.status] + (row.reason ? ' · ' + t(row.reason) : '');
        li.appendChild(line); li.appendChild(value); li.appendChild(state);
        rows.appendChild(li);
      });
      summary.textContent = t('可添加 {ready} 个 · 重复 {duplicate} 个 · 无效 {invalid} 个', result.counts);
      previewBox.hidden = false;
      confirm.textContent = t('添加 {count} 个网站', { count: result.counts.ready });
      setStatus(result.counts.ready
        ? t('确认后将添加到「{name}」。仅可撤销最近一次导入。', { name: result.target.name })
        : t('没有可添加的网址，请修改列表后重新预览。'));
    }
    async function requestPreview(event) {
      event?.preventDefault();
      if (!opened() || committing || committed || previewing || !group.value || !input.value.trim()) return;
      invalidate();
      const ticket = revision, text = input.value, target = group.value;
      previewing = true;
      setStatus(t('正在本机预览…'));
      syncControls();
      try {
        const result = await backend().previewUrlList(text, target);
        if (ticket !== revision || !opened() || text !== input.value || target !== group.value) return;
        preview = result;
        matchingText = text; matchingGroup = target;
        render(result);
      } catch (error) {
        if (ticket === revision && opened()) setStatus(t('预览失败，请重试。网址列表已保留。'), true);
      } finally {
        if (ticket === revision) { previewing = false; syncControls(); }
      }
    }
    async function commit() {
      if (!opened() || committing || committed || !current() || !preview.ok || !preview.counts.ready) return;
      const issued = preview;
      committing = true;
      setStatus(t('正在添加网站，请稍候…保存完成后将刷新页面。'));
      lockSettings();
      syncControls();
      try {
        const result = await backend().commitUrlList(issued);
        if (result.ok) {
          // The backend reloads after saving. Keep the draft and lock the form
          // until that actual reload, rather than implying cancellation is safe.
          committed = true;
          setStatus(t('已添加网站，正在刷新。若未自动刷新，请刷新此标签页。'));
        } else {
          invalidate();
          setStatus(t(result.message), true);
        }
      } catch (error) {
        invalidate();
        setStatus(t('添加未完成，请检查列表后重试。网址列表已保留。'), true);
      } finally {
        committing = false;
        if (!committed) releaseSettings();
        syncControls();
      }
    }
    function open(opener) {
      if (committing || committed) return;
      root.OpenTabSettingsNav.open({ opener });
      root.OpenTabSettingsNav.setActive('sync');
      form.scrollIntoView({ block: 'start' });
      input.focus({ preventScroll: true });
    }
    function modalOpen() { return modal && !modal.classList.contains('hidden'); }
    function newModal() {
      return modalOpen() && $('save-btn').textContent === t('保存')
        && [t('添加快捷图标'), t('添加 SSH 链接'), t('添加工具')].includes($('icon-modal-title').textContent);
    }
    function modalBusy() {
      return $('save-btn').disabled || $('cancel-btn').disabled
        || $('icon-upload-status').textContent === t('正在读取图片…');
    }
    function modalFields() { return Array.from(modal.querySelectorAll('input, select, textarea')); }
    function updateModalEntry() {
      if (!modal || !entry) return;
      const isOpen = modalOpen();
      if (isOpen && !modalWasOpen) modalDefaults = modalFields().map(node => [node, node.value]);
      modalWasOpen = isOpen;
      const hidden = !newModal();
      const disabled = modalBusy() || switching;
      if (entry.hidden !== hidden) entry.hidden = hidden;
      if (entry.disabled !== disabled) entry.disabled = disabled;
    }
    async function switchFromModal() {
      if (!newModal() || modalBusy() || switching) return;
      switching = true;
      updateModalEntry();
      try {
        const dirty = modalDefaults.some(([node, value]) => node.value !== value)
          || modalFields().some(node => node.type === 'file' && node.files?.length);
        if (dirty) {
          const proceed = await root.OpenTabFolders.showDialog(t('切换到批量添加将丢弃当前未保存的快捷方式，继续？'), [
            { label: t('取消'), value: false }, { label: t('继续批量添加'), value: true, className: 'btn-primary' }
          ]);
          if (!proceed) { switching = false; updateModalEntry(); if (modalOpen()) entry.focus(); return; }
        }
        if (!newModal() || modalBusy()) return;
        // Use the original Cancel handler to release upload/save intents and
        // restore the actual workspace opener, including the right-click flow.
        $('cancel-btn').click();
        if (!modalOpen()) open(doc.activeElement);
      } finally { switching = false; updateModalEntry(); }
    }
    form.addEventListener('submit', requestPreview);
    input.addEventListener('input', () => invalidate());
    group.addEventListener('change', () => invalidate());
    confirm.addEventListener('click', commit);
    cancel.addEventListener('click', () => { if (!committing && !committed) root.OpenTabSettingsNav.close(); });
    $('empty-paste-sites')?.addEventListener('click', event => open(event.currentTarget));
    entry?.addEventListener('click', switchFromModal);
    if (root.MutationObserver) {
      new root.MutationObserver(() => {
        contextRequest += 1;
        invalidate();
        if (opened()) loadGroups();
      }).observe(panel, { attributes: true, attributeFilter: ['class'] });
      if (modal) new root.MutationObserver(updateModalEntry).observe(modal, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'disabled']
      });
    }
    updateModalEntry();
    syncControls();
    if (opened()) loadGroups();
    controller = { open, loadGroups, requestPreview, commit, invalidate, updateModalEntry, switchFromModal, isBusy: () => committing || committed };
    return controller;
  }
  if (root.document) {
    const start = () => root.OpenTabI18n ? root.OpenTabI18n.ready.then(() => bind()) : bind();
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
  return { bind, isBusy: () => Boolean(controller?.isBusy()) };
}));
