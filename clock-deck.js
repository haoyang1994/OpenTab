(function(root) {
  'use strict';
  const DURATION = 25 * 60 * 1000;
  const DURATIONS = Object.freeze([15, 25, 50].map(minutes => minutes * 60 * 1000));
  const FOCUS_KEY = 'opentab.focus.v1';
  const SWIPE_EXCLUDE = 'button, a, input, textarea, select, [contenteditable], [role="button"], .timezone-selector, .calendar-popover, #weather-pill, [data-deck-no-swipe]';
  const t = (s, p) => root.OpenTabI18n ? root.OpenTabI18n.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p?.[k] ?? m);

  // A deadline, not tick counts: sleeping/background tabs catch up immediately.
  // Only this tab's session storage is used; there is no sync or notification.
  function createFocusTimer({ storage, now = Date.now } = {}) {
    let state = { phase: 'idle', duration: DURATION, remaining: DURATION, deadline: null };
    let persistent = Boolean(storage), raw = null, lastNow = now();
    try { raw = storage?.getItem(FOCUS_KEY); } catch (_) { persistent = false; }
    try {
      const saved = JSON.parse(raw || 'null');
      // Existing v1 records have no duration: migrate those to 25 minutes.
      // An explicit invalid duration is not a legacy record and must be rejected.
      const duration = saved && Object.prototype.hasOwnProperty.call(saved, 'duration') ? saved.duration : DURATION;
      if (saved?.version === 1 && DURATIONS.includes(duration)
        && ['running', 'paused', 'done', 'idle'].includes(saved.phase)
        && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= duration
        && (saved.phase !== 'idle' || saved.remaining === duration)
        && (saved.phase !== 'done' || saved.remaining === 0)
        && (!['running', 'paused'].includes(saved.phase) || saved.remaining > 0)
        && (saved.phase !== 'running' || (Number.isFinite(saved.deadline) && saved.deadline > 0 && saved.deadline <= now() + duration))) {
        state = { phase: saved.phase, duration, remaining: saved.remaining, deadline: saved.phase === 'running' ? saved.deadline : null };
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
        state.remaining = Math.max(0, Math.min(state.duration, state.deadline - currentNow));
        if (!state.remaining) { state = { ...state, phase: 'done', remaining: 0, deadline: null }; persist(); }
      }
      lastNow = currentNow;
      return { ...state, persistent };
    }
    return {
      snapshot,
      toggle() {
        snapshot();
        if (state.phase === 'running') state = { ...state, phase: 'paused', deadline: null };
        else {
          const remaining = state.remaining || state.duration;
          state = { ...state, phase: 'running', remaining, deadline: now() + remaining };
        }
        persist(); return snapshot();
      },
      reset() { state = { ...state, phase: 'idle', remaining: state.duration, deadline: null }; persist(); return snapshot(); },
      setDuration(duration) {
        snapshot();
        // Presets configure the next session only; they never start a timer or
        // discard a running/paused session, including programmatic activation.
        if (!DURATIONS.includes(duration) || !['idle', 'done'].includes(state.phase) || duration === state.duration) return snapshot();
        state = { phase: 'idle', duration, remaining: duration, deadline: null };
        persist(); return snapshot();
      }
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

  function sceneView(adapter) {
    if (!adapter.getSceneView) return null;
    const view = adapter.getSceneView();
    return { sceneId: view?.sceneId, homeGroupId: view?.homeGroupId, generation: view?.generation };
  }
  function sameView(adapter, view) {
    const current = sceneView(adapter);
    return !view ? !current : !!current && current.sceneId === view.sceneId
      && current.homeGroupId === view.homeGroupId && current.generation === view.generation;
  }
  function sceneActive(data, view) {
    if (!view) return true;
    const scene = (data.scenes || []).find(item => item.id === view.sceneId);
    return !!scene && scene.archivedAt === null && scene.homeGroupId === view.homeGroupId;
  }
  function visibleTodos(adapter) {
    const view = sceneView(adapter), todos = adapter.state.todos;
    return !view ? todos : sceneActive(adapter.state, view) ? todos.filter(todo => todo.sceneId === view.sceneId) : [];
  }
  // Creation stays with the host's input/save lifecycle. This helper supplies
  // ownership without clearing drafts or replacing the full task collection.
  function createTodoRecord(adapter, record) {
    const view = sceneView(adapter);
    if (!sceneActive(adapter.state, view)) return null;
    return { ...record, ...(view ? { sceneId: view.sceneId } : {}) };
  }
  function todoTarget(adapter, todo) {
    return { id: todo.id, text: todo.text, done: Boolean(todo.done), sceneId: todo.sceneId,
      view: sceneView(adapter), intent: adapter.workspace.captureIntent({ todos: [todo.id] }) };
  }
  function todoMatches(data, shown) {
    return sceneActive(data, shown.view) && (data.todos || []).some(item => item.id === shown.id
      && item.text === shown.text && Boolean(item.done) === shown.done && item.sceneId === shown.sceneId
      && (!shown.view || item.sceneId === shown.view.sceneId));
  }
  function todoCurrent(adapter, shown) {
    return !!shown && sameView(adapter, shown.view) && todoMatches(adapter.state, shown)
      && adapter.workspace.isIntentCurrent(shown.intent);
  }
  function todoGuard(adapter, shown) {
    return latest => sameView(adapter, shown.view) && todoMatches(latest, shown)
      && (latest['opentab.workspaceEpoch'] || 0) === shown.intent.epoch;
  }

  // Keep the legacy renderer independent of optional deck setup. Scene mode
  // projects only the DOM; handlers always update the full collection by ID.
  function renderTodoList(adapter) {
    const { state, elements, saveState, renderTodos } = adapter;
    const todos = visibleTodos(adapter), view = sceneView(adapter);
    elements.todoList.innerHTML = '';
    todos.forEach((todo) => {
      const shown = view ? todoTarget(adapter, todo) : null;
      const row = document.createElement('div');
      row.className = `todo-item${todo.done ? ' done' : ''}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(todo.done);
      checkbox.setAttribute('aria-label', t(todo.done ? '标记为未完成' : '标记为已完成'));
      checkbox.addEventListener('change', () => {
        if (view) {
          if (!todoCurrent(adapter, shown)) { renderTodos(); return; }
          state.todos = state.todos.map(item => item.id === shown.id ? { ...item, done: checkbox.checked } : item);
          saveState(undefined, undefined, todoGuard(adapter, shown));
        } else {
          todo.done = checkbox.checked;
          saveState();
        }
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
        if (view && !todoCurrent(adapter, shown)) { renderTodos(); return; }
        state.todos = state.todos.filter((item) => item.id !== todo.id);
        if (view) saveState(undefined, undefined, todoGuard(adapter, shown));
        else saveState();
        renderTodos();
      });
      row.appendChild(checkbox); row.appendChild(text); row.appendChild(remove);
      elements.todoList.appendChild(row);
    });
    const done = todos.filter((item) => item.done).length;
    const total = todos.length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    if (elements.todoCount) elements.todoCount.textContent = `${done}/${total}`;
    if (elements.todoEmpty) elements.todoEmpty.classList.toggle('hidden', total > 0);
    if (elements.todoProgressBar) elements.todoProgressBar.style.width = `${progress}%`;
  }

  function createTodoAction(host, onChange = () => {}) {
    let pending = false;
    function target() {
      const todo = visibleTodos(host).find(item => !item.done);
      return todo ? todoTarget(host, todo) : null;
    }
    async function complete(shown) {
      if (pending) return 'pending';
      const current = host.state.todos.find(item => item.id === shown?.id);
      if (!shown || !current || current.done || !todoCurrent(host, shown)) return 'stale';
      pending = true;
      const intent = host.workspace.captureIntent();
      const guard = todoGuard(host, shown);
      const optimistic = { ...current, done: true };
      host.state.todos = host.state.todos.map(item => item.id === shown.id ? optimistic : item);
      try {
        onChange();
        const saved = await host.saveState(undefined, undefined, guard);
        return saved && sameView(host, shown.view) && host.workspace.isIntentCurrent(intent) ? 'saved' : 'failed';
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
    const focusListeners = new Set();
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
      if (!action.pending || !shown || !sameView(adapter, shown.view) || !sceneActive(adapter.state, shown.view)) shown = action.target();
      const count = visibleTodos(adapter).filter(item => !item.done).length;
      $('clock-todo-text').textContent = shown ? shown.text : t('暂无未完成待办');
      $('clock-todo-text').title = shown?.text || '';
      $('clock-todo-count').textContent = shown ? t('还有 {count} 件未完成', { count }) : '';
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
      $('clock-focus-toggle').textContent = t(value.phase === 'running' ? '暂停' : value.phase === 'paused' ? '继续专注' : value.phase === 'done' ? '再次专注' : '开始专注');
      $('clock-focus-reset').disabled = value.phase === 'idle';
      $('clock-focus-progress').max = value.duration;
      $('clock-focus-progress').value = value.duration - value.remaining;
      $('clock-focus-note').textContent = value.persistent ? '' : t('暂存不可用；刷新将重置计时。');
      focusListeners.forEach(listener => listener(value));
      if (lastPhase !== value.phase) {
        lastPhase = value.phase;
        focusStatus.textContent = value.phase === 'idle' ? '' : t(value.phase === 'running' ? '专注中' : value.phase === 'paused' ? '已暂停' : '已完成');
      }
    }
    function tick() {
      if (disposed) return;
      renderFocus();
      clearTimeout(timerId);
      timerId = setTimeout(tick, 1000);
    }
    dots.forEach((dot, i) => dot.addEventListener('click', () => select(i)));
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
    // New cards keep their native context menu; the original clock still
    // bubbles to the existing blank-area Add Site handler and its exclusions.
    element.addEventListener('contextmenu', event => {
      if (event.target.closest('#clock-focus-card, #clock-todo-card, #clock-deck-nav, #clock-deck-peek')) event.stopPropagation();
    });
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
      $('clock-todo-status').textContent = t(outcome === 'saved' ? '已完成' : outcome === 'stale' ? '待办已更新，请确认后再试。' : '未能保存，待办已恢复，请重试。');
    });
    $('clock-todo-open').addEventListener('click', () => { if (canOpenList()) adapter.openTodoList($('clock-todo-open')); });
    const observer = new MutationObserver(syncMode);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', tick);
    root.addEventListener('pageshow', () => { disposed = false; observer.observe(document.body, { attributes: true, attributeFilter: ['class'] }); tick(); });
    root.addEventListener('pagehide', () => { clearTimeout(timerId); gesture = null; });
    root.addEventListener('beforeunload', () => { disposed = true; clearTimeout(timerId); observer.disconnect(); });
    select(0, false); syncMode(); tick();
    return { refreshTodos, focus: {
      snapshot: () => timer.snapshot(),
      toggle() { timer.toggle(); tick(); },
      reset() { timer.reset(); tick(); },
      setDuration(duration) { timer.setDuration(duration); tick(); },
      subscribe(listener) { focusListeners.add(listener); listener(timer.snapshot()); return () => focusListeners.delete(listener); }
    } };
  }
  function init(adapter) {
    if (host) return;
    host = adapter;
    // Optional card enhancement must never prevent the existing list loading.
    try { deck = createDeck(adapter); } catch (error) { root.console?.warn('Clock cards unavailable', error); }
  }
  root.OpenTabClockDeck = { getFocus: () => deck?.focus, init, renderTodos, createFocusTimer, formatRemaining, swipeDirection, createTodoAction, createTodoRecord, visibleTodos, renderTodoList, DURATION, DURATIONS, FOCUS_KEY };
})(globalThis);
