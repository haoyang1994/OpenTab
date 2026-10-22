(function (global) {
  'use strict';

  const t = (source, params) => global.OpenTabI18n ? global.OpenTabI18n.t(source, params) :
    source.replace(/\{(\w+)\}/g, (match, key) => params?.[key] ?? match);
  const OVERLAYS = ['settings-panel', 'add-icon-modal', 'timezone-selector', 'calendar-popover',
    'folder-overlay', 'inline-dialog', 'icon-context-menu', 'change-icon-modal'];
  const FILTERS = ['all', 'sites', 'groups', 'actions'];
  const CATEGORIES = { site: '网站', group: '分组', action: '操作' };
  const ACTIONS = [
    { id: 'add-website', name: '添加网站', keywords: 'add website shortcut new 添加 网站 快捷方式', symbol: '+' },
    { id: 'appearance', name: '外观', keywords: 'appearance theme clock minimal 外观 主题 时钟 极简', symbol: '◐' },
    { id: 'wallpaper', name: '壁纸', keywords: 'wallpaper background image bing 壁纸 背景 图片 必应', symbol: '▧' },
    { id: 'shortcuts', name: '快捷方式与布局', keywords: 'shortcuts layout icons grid 快捷方式 布局 图标 网格', symbol: '▦' },
    { id: 'search', name: '搜索', keywords: 'search engines history 搜索 引擎 历史', symbol: '⌕' },
    { id: 'weather', name: '天气', keywords: 'weather city location temperature 天气 城市 位置 温度', symbol: '☀' },
    { id: 'sync', name: '导入与同步', keywords: 'import sync backup bookmarks 导入 同步 备份 书签', symbol: '⇄' },
    { id: 'advanced', name: '高级/开发者工具', keywords: 'advanced developer tools ssh json 高级 开发者 工具', symbol: '⌘' },
    { id: 'about', name: '关于', keywords: 'about version license 关于 版本 许可证', symbol: 'ⓘ' }
  ];
  let bound = false;
  let opened = false;
  let session = 0;
  let pendingActivation = null;
  let opener = null;
  let openerSelection = null;
  let filter = 'all';
  let entries = [];
  let activeIndex = -1;
  let rows = [];
  let host = {};
  let observer = null;
  const inertStates = new Map();

  const $ = (id) => document.getElementById(id);
  const root = () => $('command-palette');
  const input = () => $('command-palette-input');
  const search = () => global.OpenTabSearch?.commandPalette;
  const macPlatform = () => /Mac|iPhone|iPad|iPod/i.test(global.navigator?.userAgentData?.platform || global.navigator?.platform || '');
  const ime = (event) => event.isComposing || event.key === 'Process' || event.keyCode === 229 || event.which === 229;

  function shown(node) {
    if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.hidden || node.inert ||
        !document.contains(node) || node.closest?.('[hidden], [inert], .hidden')) return false;
    if (node.getClientRects && !node.getClientRects().length) return false;
    const style = global.getComputedStyle?.(node);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse');
  }

  function editable(node) {
    if (!node || node === document.body || node === document.documentElement) return false;
    return node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName || '') ||
      Boolean(node.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
  }

  function blocked(target) {
    if (global.OpenTabSiteList?.isBusy?.()) return true;
    if (OVERLAYS.some((id) => { const node = $(id); return node && !node.classList.contains('hidden') && !node.hidden; })) return true;
    const main = $('search-input');
    return (editable(target) && target !== main) || (editable(document.activeElement) && document.activeElement !== main);
  }

  function focusBody() {
    const body = document.body;
    const previous = body.getAttribute('tabindex');
    body.setAttribute('tabindex', '-1');
    body.focus({ preventScroll: true });
    if (previous === null) body.removeAttribute('tabindex');
    else body.setAttribute('tabindex', previous);
  }

  function restoreOpener(saved, selection) {
    if (saved !== document.body && shown(saved)) {
      saved.focus({ preventScroll: true });
      if (selection && typeof saved.setSelectionRange === 'function') {
        saved.setSelectionRange(selection.start, selection.end, selection.direction);
      }
    } else focusBody();
  }

  function isolateBackground() {
    // The root is a body child in home.html. Walking its ancestors also keeps
    // the isolation correct if the surrounding layout changes in the future.
    let branch = root();
    while (branch?.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || inertStates.has(sibling)) continue;
        inertStates.set(sibling, { value: Boolean(sibling.inert), attribute: sibling.getAttribute('inert') });
        sibling.inert = true;
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
  }

  function restoreBackground() {
    observer?.disconnect();
    observer = null;
    for (const [node, original] of inertStates) {
      node.inert = original.value;
      if (original.attribute === null) node.removeAttribute('inert');
      else node.setAttribute('inert', original.attribute);
    }
    inertStates.clear();
  }

  function close(options = {}) {
    if (!opened && !inertStates.size) return false;
    const saved = opener;
    const selection = openerSelection;
    opened = false;
    opener = null;
    openerSelection = null;
    try {
      root()?.classList.add('hidden');
      input()?.setAttribute('aria-expanded', 'false');
      input()?.removeAttribute('aria-activedescendant');
      setStatus('', false);
    } finally {
      restoreBackground();
      entries = [];
      rows = [];
      activeIndex = -1;
      if (options.restore !== false) restoreOpener(saved, selection);
    }
    return true;
  }

  function availableActions(query) {
    const needle = String(query || '').trim().toLowerCase();
    return ACTIONS.filter((action) => {
      if (action.id === 'add-website') return typeof host.openAddWebsite === 'function';
      if (typeof global.OpenTabSettingsNav?.openSection !== 'function') return false;
      return action.id !== 'advanced' || global.OpenTabSettingsNav.isDeveloperToolsEnabled();
    }).map((action, index) => {
      const name = t(action.name);
      const lower = name.toLowerCase();
      const rank = !needle || lower === needle ? 0 : lower.startsWith(needle) ? 1 : lower.includes(needle) ? 2 :
        `${action.name} ${action.keywords}`.toLowerCase().includes(needle) ? 3 : -1;
      return { type: 'action', ...action, name, rank, index };
    }).filter((action) => action.rank >= 0).sort((a, b) => a.rank - b.rank || a.index - b.index);
  }

  function collectEntries() {
    const query = input().value;
    const data = search();
    return (filter === 'all' || filter === 'sites' ? data.listSites(query, filter === 'all' ? 8 : 20) : [])
      .concat(filter === 'all' || filter === 'groups' ? data.listGroups(query, filter === 'all' ? 6 : 20) : [])
      .concat(filter === 'all' || filter === 'actions' ? availableActions(query) : []);
  }

  function setActive(index, scroll = true) {
    activeIndex = index >= 0 && index < entries.length ? index : -1;
    rows.forEach((row, position) => {
      const active = position === activeIndex;
      row.classList.toggle('active', active);
      row.setAttribute('aria-selected', String(active));
    });
    const active = rows[activeIndex];
    if (active) {
      input().setAttribute('aria-activedescendant', active.id);
      if (scroll) active.scrollIntoView({ block: 'nearest' });
    } else input().removeAttribute('aria-activedescendant');
  }

  function textNode(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function setStatus(message, visible) {
    const live = $('command-palette-status');
    if (!live) return;
    live.textContent = message;
    live.classList.toggle('sr-only', !visible);
  }

  function render(status = '') {
    const list = $('command-palette-results');
    const next = collectEntries();
    list.replaceChildren();
    entries = next;
    rows = [];
    let type = '';
    let group = null;
    entries.forEach((entry, index) => {
      if (type !== entry.type) {
        type = entry.type;
        group = document.createElement('div');
        group.className = 'command-palette-group';
        group.setAttribute('role', 'group');
        const heading = textNode('div', 'command-palette-group-title', t(CATEGORIES[type]));
        heading.id = `command-palette-group-${type}`;
        heading.setAttribute('role', 'presentation');
        group.setAttribute('aria-label', t(CATEGORIES[type]));
        group.appendChild(heading);
        list.appendChild(group);
      }
      const row = document.createElement('div');
      row.id = `command-palette-option-${index}`;
      row.className = 'command-palette-row';
      row.tabIndex = -1;
      row.dataset.entryType = entry.type;
      row.dataset.entryId = entry.id;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.setAttribute('aria-disabled', String(Boolean(pendingActivation)));
      const symbol = entry.type === 'site' ? Array.from(entry.name.trim())[0]?.toUpperCase() || '?' : entry.type === 'group' ? '▦' : entry.symbol;
      const icon = textNode('span', 'command-palette-icon', symbol);
      icon.setAttribute('aria-hidden', 'true');
      const title = textNode('span', 'command-palette-row-title', entry.name);
      const context = entry.type === 'site' ? `${entry.domain} · ${entry.location}` : entry.type === 'group' ? t('切换分组') : entry.id === 'add-website' ? t('创建快捷方式') : t('设置');
      const detail = textNode('span', 'command-palette-row-context', context);
      const text = document.createElement('span');
      text.className = 'command-palette-row-text';
      text.appendChild(title);
      text.appendChild(detail);
      row.appendChild(icon);
      row.appendChild(text);
      row.addEventListener('mousedown', (event) => { if (event.button === 0) event.preventDefault(); });
      row.addEventListener('click', (event) => {
        if (event.button !== 0 || !opened) return;
        setActive(index, false);
        activate(entry, Boolean(event.metaKey || event.ctrlKey));
      });
      group.appendChild(row);
      rows.push(row);
    });
    root().querySelectorAll('[data-palette-filter]').forEach((button) => {
      const selected = button.dataset.paletteFilter === filter;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const empty = $('command-palette-empty');
    if (empty) {
      empty.classList.toggle('hidden', entries.length > 0);
    }
    list.setAttribute('aria-busy', String(Boolean(pendingActivation)));
    setStatus(status || (pendingActivation ? t('正在切换分组…') : t('显示 {count} 个入口', { count: entries.length })), Boolean(status || pendingActivation));
    if (!entries.length) {
      const scroller = list.closest('.command-palette-scroll');
      if (scroller) scroller.scrollTop = 0;
    }
    setActive(entries.length ? 0 : -1);
  }

  function refresh(status = '') {
    if (!opened) return;
    try { render(status); } catch (error) { close(); }
  }

  function stale() {
    refresh(t('内容已更新，请重新选择。'));
  }

  async function activateGroup(entry) {
    const originSession = session;
    const operation = {};
    pendingActivation = operation;
    // Saving is single-flight even if Escape closes this session and a new one
    // opens. Closing does not cancel a workspace transaction already issued.
    $('command-palette-results').setAttribute('aria-busy', 'true');
    rows.forEach((row) => row.setAttribute('aria-disabled', 'true'));
    setStatus(t('正在切换分组…'), true);
    let saved = false;
    try { saved = await global.OpenTabFolders.selectGroup(entry.id, true); }
    catch (error) { saved = false; }
    finally { if (pendingActivation === operation) pendingActivation = null; }
    if (!opened) return saved === true;
    if (session !== originSession) { refresh(); return saved === true; }
    if (saved === true) close();
    else refresh(t('分组切换未保存，请重试。'));
    return saved === true;
  }

  function activate(entry, forceNewTab = false) {
    if (!opened || pendingActivation || !entry || !entries.includes(entry)) return false;
    try {
      if (entry.type === 'site') {
        if (!search().validateSite(entry)) { stale(); return false; }
        if (!search().openSite(entry, forceNewTab)) { stale(); return false; }
        close();
        return true;
      }
      if (entry.type === 'group') {
        if (!search().validateGroup(entry) || typeof global.OpenTabFolders?.selectGroup !== 'function') { stale(); return false; }
        return activateGroup(entry);
      }
      if (!availableActions('').some((action) => action.id === entry.id)) { stale(); return false; }
      close();
      if (entry.id === 'add-website') host.openAddWebsite();
      else return global.OpenTabSettingsNav.openSection(entry.id);
      return true;
    } catch (error) {
      close();
      return false;
    }
  }

  function open(target = document.activeElement) {
    if (opened) {
      input().focus({ preventScroll: true });
      return true;
    }
    if (!root() || !input() || !$('command-palette-results') || !search() || blocked(target)) return false;
    opener = document.activeElement;
    openerSelection = typeof opener?.selectionStart === 'number' ? {
      start: opener.selectionStart, end: opener.selectionEnd, direction: opener.selectionDirection || 'none'
    } : null;
    opened = true;
    session += 1;
    filter = 'all';
    try {
      input().value = '';
      root().classList.remove('hidden');
      input().setAttribute('aria-expanded', 'true');
      render();
      isolateBackground();
      if (global.MutationObserver) {
        observer = new global.MutationObserver(() => { if (opened) isolateBackground(); });
        observer.observe(document.body, { childList: true, subtree: true });
      }
      input().focus({ preventScroll: true });
      input().setSelectionRange(0, 0);
      return true;
    } catch (error) {
      close();
      return false;
    }
  }

  function focusables() {
    return Array.from(root().querySelectorAll('button, input, select, textarea, a[href], [tabindex]'))
      .filter((node) => node.tabIndex !== -1 && shown(node));
  }

  function stop(event, prevent = true) {
    if (prevent) event.preventDefault();
    // Do not leak Escape, Alt+digit, or any other workspace keyboard command.
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    else event.stopPropagation();
  }

  function onKeydown(event) {
    if (event.defaultPrevented) return;
    const primary = macPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!ime(event) && String(event.key).toLowerCase() === 'k' && primary && !event.altKey && !event.shiftKey) {
      if (open(event.target)) stop(event);
      return;
    }
    if (!opened) return;
    if (ime(event)) { stop(event, false); return; }
    if (event.key === 'Escape') { stop(event); close(); return; }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const nodes = focusables();
      const index = nodes.indexOf(document.activeElement);
      const next = !nodes.length ? -1 : index < 0 ? (event.shiftKey ? nodes.length - 1 : 0) :
        (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      stop(event);
      if (next >= 0) nodes[next].focus();
      else input().focus();
      return;
    }
    if (event.target === input() && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      stop(event);
      if (entries.length) setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length);
      return;
    }
    if (event.target === input() && event.key === 'Enter' && !event.altKey && !event.shiftKey) {
      stop(event);
      activate(entries[activeIndex], Boolean(event.ctrlKey || event.metaKey));
      return;
    }
    stop(event, false);
  }

  function init(options = {}) {
    host = { ...host, ...options };
    if (bound || !root() || !input()) return;
    bound = true;
    const hint = $('search-shortcut-hint');
    if (hint) hint.textContent = macPlatform() ? '⌘ K' : 'Ctrl K';
    root().setAttribute('aria-keyshortcuts', `${macPlatform() ? 'Meta' : 'Control'}+K`);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', (event) => {
      if (opened && !root().contains(event.target)) input().focus({ preventScroll: true });
    }, true);
    input().addEventListener('input', () => refresh());
    $('command-palette-close')?.addEventListener('click', () => close());
    root().addEventListener('click', (event) => { if (event.target === root()) close(); });
    root().querySelectorAll('[data-palette-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!opened || !FILTERS.includes(button.dataset.paletteFilter)) return;
        filter = button.dataset.paletteFilter;
        refresh();
        input().focus({ preventScroll: true });
      });
    });
    document.addEventListener('opentab-sync-applied', () => refresh());
  }

  global.OpenTabCommandPalette = { init, open, close, isOpen: () => opened };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();
})(window);
