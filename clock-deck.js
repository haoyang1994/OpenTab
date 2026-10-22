(function(root) {
  'use strict';
  const DURATION = 25 * 60 * 1000;
  const FOCUS_KEY = 'opentab.focus.v1';
  const SWIPE_EXCLUDE = 'button, a, input, textarea, select, [contenteditable], [role="button"], .timezone-selector, .calendar-popover, #weather-pill, [data-deck-no-swipe]';
  const t = (s, p) => root.OpenTabI18n ? root.OpenTabI18n.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p?.[k] ?? m);

  // A deadline, not tick counts: sleeping/background tabs catch up immediately.
  // Only this tab's session storage is used; there is no sync or notification.
  function createFocusTimer({ storage, now = Date.now } = {}) {
    let state = { phase: 'idle', remaining: DURATION, deadline: null };
    let persistent = Boolean(storage), raw = null, lastNow = now();
    try { raw = storage?.getItem(FOCUS_KEY); } catch (_) { persistent = false; }
    try {
      const saved = JSON.parse(raw || 'null');
      if (saved?.version === 1 && ['running', 'paused', 'done', 'idle'].includes(saved.phase)
        && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= DURATION
        && (saved.phase !== 'running' || (Number.isFinite(saved.deadline) && saved.deadline > 0 && saved.deadline <= now() + DURATION))) {
        state = { phase: saved.phase, remaining: saved.remaining, deadline: saved.phase === 'running' ? saved.deadline : null };
        if (state.phase === 'idle') state.remaining = DURATION;
        if (state.phase === 'done') state.remaining = 0;
      }
    } catch (_) { /* Invalid/blocked session storage starts a fresh local timer. */ }
    function persist() {
      try {
        if (!storage) throw new Error('No session storage');
        storage.setItem(FOCUS_KEY, JSON.stringify({ version: 1, ...state }));
      } catch (_) { persistent = false; }
    }
    function snapshot() {
      const currentNow = now();
      if (state.phase === 'running') {
        if (currentNow < lastNow) { state.deadline += currentNow - lastNow; persist(); }
        state.remaining = Math.max(0, Math.min(DURATION, state.deadline - currentNow));
        if (!state.remaining) { state = { phase: 'done', remaining: 0, deadline: null }; persist(); }
      }
      lastNow = currentNow;
      return { ...state, persistent };
    }
    return {
      snapshot,
      toggle() {
        snapshot();
        if (state.phase === 'running') state = { phase: 'paused', remaining: state.remaining, deadline: null };
        else {
          const remaining = state.remaining || DURATION;
          state = { phase: 'running', remaining, deadline: now() + remaining };
        }
        persist(); return snapshot();
      },
      reset() { state = { phase: 'idle', remaining: DURATION, deadline: null }; persist(); return snapshot(); }
    };
  }
  function formatRemaining(milliseconds) {
    const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function swipeDirection(start, end) {
    if (!start || !end || start.pointerId !== end.pointerId) return 0;
    const x = end.clientX - start.clientX, y = end.clientY - start.clientY;
    return Math.abs(x) >= 48 && Math.abs(x) > 1.3 * Math.abs(y) ? (x < 0 ? 1 : -1) : 0;
  }

  // The existing list's DOM, save calls and handlers are kept here, unchanged.
  // Keeping the list renderer independent of deck setup preserves the old UI.
  function renderTodoList({ state, elements, saveState, renderTodos }) {
    elements.todoList.innerHTML = '';
    state.todos.forEach((todo) => {
      const row = document.createElement('div');
      row.className = `todo-item${todo.done ? ' done' : ''}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(todo.done);
      checkbox.setAttribute('aria-label', t(todo.done ? '标记为未完成' : '标记为已完成'));
      checkbox.addEventListener('change', () => {
        todo.done = checkbox.checked;
        saveState();
        renderTodos();
      });
      const text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = todo.text;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'todo-delete';
      remove.textContent = '×';
      remove.setAttribute('aria-label', t('删除待办：{name}', { name: todo.text }));
      remove.addEventListener('click', () => {
        state.todos = state.todos.filter((item) => item.id !== todo.id);
        saveState();
        renderTodos();
      });
      row.appendChild(checkbox); row.appendChild(text); row.appendChild(remove);
      elements.todoList.appendChild(row);
    });
    const done = state.todos.filter((item) => item.done).length;
    const total = state.todos.length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    if (elements.todoCount) elements.todoCount.textContent = `${done}/${total}`;
    if (elements.todoEmpty) elements.todoEmpty.classList.toggle('hidden', total > 0);
    if (elements.todoProgressBar) elements.todoProgressBar.style.width = `${progress}%`;
  }

  function createTodoAction(host, onChange = () => {}) {
    let pending = false;
    function target() {
      const todo = host.state.todos.find(item => !item.done);
      return todo ? { id: todo.id, text: todo.text, intent: host.workspace.captureIntent({ todos: [todo.id] }) } : null;
    }
    async function complete(shown) {
      if (pending) return 'pending';
      const current = host.state.todos.find(item => item.id === shown?.id);
      if (!shown || !current || current.done || current.text !== shown.text || !host.workspace.isIntentCurrent(shown.intent)) return 'stale';
      pending = true;
      const intent = host.workspace.captureIntent();
      const guard = latest => (latest.todos || []).some(item => item.id === shown.id && item.text === shown.text && !item.done);
      const optimistic = { ...current, done: true };
      host.state.todos = host.state.todos.map(item => item.id === shown.id ? optimistic : item);
      try {
        onChange();
        const saved = await host.saveState(undefined, undefined, guard);
        return saved && host.workspace.isIntentCurrent(intent) ? 'saved' : 'failed';
      } catch (_) {
        // Only undo our exact in-memory object, never a newer/recovered record.
        host.state.todos = host.state.todos.map(item => item === optimistic ? current : item);
        return 'failed';
      } finally { pending = false; onChange(); }
    }
    return { target, complete, get pending() { return pending; } };
  }

  let host = null, deck = null;
  function renderTodos() {
    if (!host) return;
    renderTodoList(host);
    try { deck?.refreshTodos(); } catch (error) { root.console?.warn('Clock card refresh unavailable', error); }
  }
  function createDeck(adapter) {
    const $ = id => document.getElementById(id);
    const element = $('clock-deck'), stage = $('clock-deck-stage');
    if (!element || !stage) return null;
    const panels = ['clock-widget', 'clock-focus-card', 'clock-todo-card'].map($);
    const nav = $('clock-deck-nav'), dots = [...nav.querySelectorAll('[data-clock-card]')];
    const names = ['时间', '专注', '下一件小事'];
    const status = $('clock-deck-status'), focusStatus = $('clock-focus-status');
    let index = 0, gesture = null, timerId, shown = null, lastPhase = '', disposed = false;
    let storage;
    try { storage = root.sessionStorage; } catch (_) { /* local-memory fallback */ }
    const timer = createFocusTimer({ storage });
    const action = createTodoAction(adapter, () => {
      renderTodoList(adapter);
      refreshTodos();
    });
    const minimal = () => document.body.classList.contains('minimal-mode');
    const canOpenList = () => !minimal() && !document.body.classList.contains('hide-todo-entry');
    function select(next, announce = true) {
      if (minimal()) next = 0;
      next = (next + panels.length) % panels.length;
      const focusWasInPanel = next !== index && panels[index].contains(document.activeElement);
      if (next !== index) adapter.closeClockPopovers();
      index = next;
      panels.forEach((panel, i) => {
        panel.inert = i !== index;
        panel.setAttribute('aria-hidden', i !== index ? 'true' : 'false');
        panel.dataset.active = String(i === index);
      });
      dots.forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === index)));
      element.dataset.card = String(index);
      $('clock-deck-label').textContent = t(names[index]);
      if (focusWasInPanel) dots[index].focus();
      if (announce) status.textContent = t('{name}，第 {index} 张，共 {total} 张', { name: t(names[index]), index: index + 1, total: panels.length });
    }
    function syncMode() {
      if (minimal()) {
        const hiddenFocus = nav.contains(document.activeElement) || $('clock-deck-peek').contains(document.activeElement) || panels.some(panel => panel.contains(document.activeElement));
        adapter.closeClockPopovers();
        select(0, false);
        if (hiddenFocus) $('settings-btn')?.focus();
      }
      refreshTodos();
    }
    function refreshTodos() {
      if (!action.pending) shown = action.target();
      const count = adapter.state.todos.filter(item => !item.done).length;
      $('clock-todo-text').textContent = shown ? shown.text : t('暂时没有未完成待办，留一点空白也很好。');
      $('clock-todo-text').title = shown?.text || '';
      $('clock-todo-count').textContent = shown ? t('还有 {count} 件未完成', { count }) : t('一件一件，慢慢来');
      const complete = $('clock-todo-complete');
      complete.hidden = !shown;
      complete.disabled = action.pending || !shown;
      complete.textContent = t(action.pending ? '正在保存…' : '完成这件事');
      const open = $('clock-todo-open');
      const hidingFocus = !canOpenList() && document.activeElement === open;
      open.hidden = !canOpenList();
      if (hidingFocus) dots[index].focus();
    }
    function renderFocus() {
      const value = timer.snapshot();
      $('clock-focus-time').textContent = formatRemaining(value.remaining);
      $('clock-focus-toggle').textContent = t(value.phase === 'running' ? '暂停' : value.phase === 'paused' ? '继续专注' : value.phase === 'done' ? '再专注一次' : '开始专注');
      $('clock-focus-reset').disabled = value.phase === 'idle';
      $('clock-focus-progress').value = DURATION - value.remaining;
      $('clock-focus-note').textContent = t(value.persistent ? '仅此标签页；刷新继续，关闭结束。' : '暂存不可用；刷新将重置计时。');
      if (lastPhase !== value.phase) {
        lastPhase = value.phase;
        focusStatus.textContent = t(value.phase === 'running' ? '专注中，切换卡片不会暂停。' : value.phase === 'paused' ? '已暂停，准备好再继续。' : value.phase === 'done' ? '这一轮完成了，休息一下吧。' : '给眼前的一件事，留 25 分钟。');
      }
    }
    function tick() {
      if (disposed) return;
      renderFocus();
      clearTimeout(timerId);
      timerId = setTimeout(tick, 1000);
    }
    dots.forEach((dot, i) => dot.addEventListener('click', () => select(i)));
    $('clock-deck-prev').addEventListener('click', () => select(index - 1));
    $('clock-deck-next').addEventListener('click', () => select(index + 1));
    $('clock-deck-peek').addEventListener('click', () => select(index + 1));
    nav.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !event.target.closest('button') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
      if (target === null) return;
      event.preventDefault(); event.stopPropagation();
      select(target); dots[index].focus();
    });
    const blocked = event => minimal() || event.target.closest(SWIPE_EXCLUDE) || Boolean(String(root.getSelection?.() || ''));
    stage.addEventListener('pointerdown', event => {
      if (event.isPrimary === false || event.button !== 0 || blocked(event)) { gesture = null; return; }
      gesture = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    });
    stage.addEventListener('pointermove', event => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const x = Math.abs(event.clientX - gesture.clientX), y = Math.abs(event.clientY - gesture.clientY);
      if (y >= 16 && y * 1.3 >= x) gesture = null;
    });
    stage.addEventListener('pointercancel', () => { gesture = null; });
    document.addEventListener('pointerup', event => {
      const direction = stage.contains(event.target) && !blocked(event) ? swipeDirection(gesture, event) : 0;
      gesture = null;
      if (direction) select(index + direction);
    });
    // Keep native context menus and text selection; do not open Add Site here.
    element.addEventListener('contextmenu', event => event.stopPropagation());
    $('clock-focus-toggle').addEventListener('click', () => { timer.toggle(); tick(); });
    $('clock-focus-reset').addEventListener('click', () => { timer.reset(); tick(); });
    $('clock-todo-complete').addEventListener('click', async () => {
      if (action.pending) return;
      const restore = document.activeElement === $('clock-todo-complete');
      const outcome = await action.complete(shown);
      refreshTodos();
      if (restore && index === 2 && !minimal() && (document.activeElement === document.body || document.activeElement === $('clock-todo-complete'))) {
        (!$('clock-todo-complete').hidden ? $('clock-todo-complete') : canOpenList() ? $('clock-todo-open') : dots[index]).focus();
      }
      $('clock-todo-status').textContent = t(outcome === 'saved' ? '已完成，接着做下一件小事。' : outcome === 'stale' ? '待办已更新，请确认后再试。' : '未能保存，待办已恢复，请重试。');
    });
    $('clock-todo-open').addEventListener('click', () => { if (canOpenList()) adapter.openTodoList($('clock-todo-open')); });
    const observer = new MutationObserver(syncMode);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', tick);
    root.addEventListener('pageshow', () => { disposed = false; observer.observe(document.body, { attributes: true, attributeFilter: ['class'] }); tick(); });
    root.addEventListener('pagehide', () => { clearTimeout(timerId); gesture = null; });
    root.addEventListener('beforeunload', () => { disposed = true; clearTimeout(timerId); observer.disconnect(); });
    select(0, false); syncMode(); tick();
    return { refreshTodos };
  }
  function init(adapter) {
    if (host) return;
    host = adapter;
    // Optional card enhancement must never prevent the existing list loading.
    try { deck = createDeck(adapter); } catch (error) { root.console?.warn('Clock cards unavailable', error); }
  }
  root.OpenTabClockDeck = { init, renderTodos, createFocusTimer, formatRemaining, swipeDirection, createTodoAction, renderTodoList, DURATION, FOCUS_KEY };
})(globalThis);
