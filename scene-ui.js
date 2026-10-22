(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabSceneUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Deliberately inert until init. The host owns persistence, locking, schema
  // validation and stale-intent checks. No storage, permissions or network here.
  // Actions must return strict true only after their write is durable.
  // onSwitch(sceneId, context); other actions receive { ...fields, context }.
  // Context is the immutable identity/view shown when the user began the action,
  // never a fresh identity silently substituted after an asynchronous gap.
  const ICONS = Object.freeze({
    home: ['场景图标：主页', 'M3 10 12 3l9 7M5 9v11h5v-6h4v6h5V9'],
    briefcase: ['场景图标：工作', 'M8 7V4h8v3M3 7h18v13H3zM3 12c5 3 13 3 18 0M10 13h4'],
    book: ['场景图标：阅读', 'M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z'],
    code: ['场景图标：代码', 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18'],
    compass: ['场景图标：探索', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M16 8l-3 5-5 3 3-5z'],
    heart: ['场景图标：生活', 'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15z'],
    leaf: ['场景图标：休闲', 'M20 3C8 2 2 8 5 16c5 8 17 2 15-13ZM5 20 16 9'],
    sparkles: ['场景图标：灵感', 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4']
  });
  const ACTION_ICONS = Object.freeze({
    chevron: 'm7 10 5 5 5-5', close: 'm6 6 12 12M18 6 6 18',
    plus: 'M12 5v14M5 12h14', rename: 'm4 16-1 5 5-1L20 8l-4-4zM14 6l4 4',
    archive: 'M3 3h18v5H3zM5 8v13h14V8M9 12h6',
    restore: 'M4 10a8 8 0 1 1 0 7M4 3v7h7', move: 'M3 12h17m-6-6 6 6-6 6',
    check: 'm5 12 4 4L19 6'
  });
  let nextId = 0;
  const fallback = (source, params) => source.replace(/\{(\w+)\}/g, (token, key) => params?.[key] ?? token);
  const t = (source, params) => root.OpenTabI18n?.t(source, params) ?? fallback(source, params);
  const active = scene => scene.archivedAt === null;
  const identity = scene => Object.freeze({ id: scene.id, name: scene.name, archivedAt: scene.archivedAt });

  function init(host) {
    if (!host?.mount?.ownerDocument || typeof host.getState !== 'function' || typeof host.getView !== 'function') {
      throw new TypeError('Scene UI requires mount, getState and getView.');
    }
    const doc = host.mount.ownerDocument;
    const eventRoot = doc.defaultView || doc;
    const prefix = `scene-ui-${++nextId}`;
    let opened = false, destroyed = false, pending = false, session = 0, screen = 0;
    let mode = null, archivedVisible = false, backdropPress = false;
    let disabledBefore = new Map();

    function element(tag, className = '', text) {
      const node = doc.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function svg(key, action = false) {
      const node = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) node.setAttribute(name, value);
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', action ? ACTION_ICONS[key] : (Object.prototype.hasOwnProperty.call(ICONS, key) ? ICONS[key] : ICONS.home)[1]);
      node.appendChild(path);
      return node;
    }
    function visible(node) {
      if (!node?.isConnected || node.closest('[hidden], [inert]') || !node.getClientRects().length) return false;
      const style = doc.defaultView?.getComputedStyle?.(node);
      return style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
    }
    function report(error) {
      // A host notification must not replace or clear the inline error/draft.
      try { host.onError?.(error); } catch (_) { /* Keep the actionable inline error. */ }
    }
    function snapshot(view, scene, group, targetScene) {
      const result = { view: Object.freeze({ sceneId: view.sceneId, currentFolderId: view.currentFolderId, generation: view.generation }) };
      if (scene) result.scene = identity(scene);
      if (group) result.group = Object.freeze({ id: group.id, name: group.name, sceneId: group.sceneId });
      if (targetScene) result.targetScene = identity(targetScene);
      return Object.freeze(result);
    }
    function currentData() {
      const state = host.getState(), view = host.getView();
      if (!state || !Array.isArray(state.scenes)) throw new TypeError('Scene UI requires a scenes array.');
      return { state, view, current: state.scenes.find(scene => scene.id === view.sceneId && active(scene)) };
    }
    function guard(node, fn) {
      const boundSession = session, boundScreen = screen;
      return event => {
        if (destroyed || pending || !opened || session !== boundSession || screen !== boundScreen || !dialog.contains(node) || !node.isConnected) return;
        fn(event);
      };
    }
    function button(label, action, fn, icon, className = '') {
      const node = element('button', `scene-button ${className}`.trim());
      node.type = 'button'; node.dataset.sceneAction = action;
      if (icon) node.appendChild(svg(icon, true));
      node.appendChild(element('span', '', label));
      node.addEventListener('click', guard(node, fn));
      return node;
    }
    function iconButton(label, action, fn, icon) {
      const node = button(label, action, fn, icon, 'scene-icon-button');
      node.title = label; node.setAttribute('aria-label', label);
      return node;
    }
    const trigger = element('button', 'scene-trigger');
    trigger.type = 'button'; trigger.dataset.sceneAction = 'open';
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${prefix}-dialog`);
    const dialog = element('dialog', 'scene-dialog'); dialog.id = `${prefix}-dialog`; dialog.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', `${prefix}-title`);
    const shell = element('div', 'scene-shell');
    const header = element('header', 'scene-header');
    const title = element('h2', 'scene-title'); title.id = `${prefix}-title`;
    const closeButton = element('button', 'scene-button scene-icon-button'); closeButton.type = 'button';
    closeButton.dataset.sceneAction = 'close'; closeButton.appendChild(svg('close', true));
    const body = element('div', 'scene-body');
    const status = element('p', 'scene-status'); status.id = `${prefix}-status`;
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    header.appendChild(title); header.appendChild(closeButton);
    shell.appendChild(header); shell.appendChild(body); shell.appendChild(status); dialog.appendChild(shell);
    host.mount.appendChild(trigger); doc.body.appendChild(dialog);

    function setStatus(message, error = false) {
      status.textContent = message;
      status.classList.toggle('scene-status-error', error);
    }
    function renderTrigger() {
      const { current } = currentData();
      trigger.replaceChildren(); trigger.appendChild(svg(current?.iconKey));
      trigger.appendChild(element('span', 'scene-trigger-name', current?.name || t('场景空间')));
      trigger.appendChild(svg('chevron', true));
      trigger.title = t('管理场景空间'); trigger.setAttribute('aria-label', t('管理场景空间：{name}', { name: current?.name || t('场景空间') }));
    }
    function controls() {
      return [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && visible(node));
    }
    function firstFocus() { (controls()[0] || dialog).focus(); }
    function setPending(value) {
      pending = value;
      trigger.disabled = value;
      if (value) {
        dialog.setAttribute('aria-busy', 'true');
        disabledBefore = new Map([...dialog.querySelectorAll('button, input, select, textarea')].map(node => [node, node.disabled]));
        disabledBefore.forEach((_, node) => { node.disabled = true; });
      } else {
        dialog.removeAttribute('aria-busy');
        disabledBefore.forEach((wasDisabled, node) => { node.disabled = wasDisabled; });
        disabledBefore.clear();
      }
    }
    function resetClosed(restoreFocus) {
      if (!opened) return;
      opened = false; session++; screen++; mode = null; backdropPress = false;
      setPending(false); trigger.setAttribute('aria-expanded', 'false');
      body.replaceChildren(); setStatus('');
      if (restoreFocus && visible(trigger) && !trigger.disabled) trigger.focus();
    }
    function close() {
      if (destroyed || pending || !opened) return false;
      resetClosed(false); if (dialog.open) dialog.close();
      if (visible(trigger) && !trigger.disabled) trigger.focus();
      return true;
    }
    async function runAction(callback, payload, success, switchId) {
      if (pending || !opened || destroyed) return;
      const operationSession = session;
      const focusBefore = doc.activeElement;
      setPending(true); setStatus(t('正在保存场景…'));
      try {
        if (typeof callback !== 'function') throw new Error(t('此操作暂不可用。'));
        const result = switchId === undefined ? await callback(payload) : await callback(switchId, payload);
        if (destroyed || !opened || session !== operationSession) return;
        if (result !== true) throw new Error(t('未能保存场景，请重试。'));
        setPending(false);
        renderTrigger(); success();
      } catch (error) {
        if (destroyed || !opened || session !== operationSession) return;
        setPending(false);
        setStatus(typeof error?.message === 'string' && error.message.trim() ? error.message : t('未能保存场景，请重试。'), true);
        if (visible(focusBefore) && !focusBefore.disabled) focusBefore.focus();
        report(error);
      }
    }
    function beginScreen(heading) {
      screen++; body.replaceChildren(); setStatus('');
      title.textContent = heading;
      closeButton.title = t('关闭场景管理'); closeButton.setAttribute('aria-label', t('关闭场景管理'));
      body.scrollTop = 0;
    }
    function sceneCounts(state, scene) {
      const labels = [];
      const countLabel = (count, one, many) => t(count === 1 ? one : many, { count });
      if (Array.isArray(state.folders)) {
        const groups = state.folders.filter(group => group.sceneId === scene.id);
        labels.push(countLabel(groups.filter(group => group.id !== scene.homeGroupId).length, '1 个分组', '{count} 个分组'));
        if (Array.isArray(state.icons)) {
          const ids = new Set(groups.map(group => group.id));
          labels.push(countLabel(state.icons.filter(item => ids.has(item.folderId) && item.type !== 'folder' && item.type !== 'tool').length, '1 个网站', '{count} 个网站'));
        }
      }
      if (Array.isArray(state.todos)) labels.push(countLabel(state.todos.filter(todo => todo.sceneId === scene.id).length, '1 个待办', '{count} 个待办'));
      return labels.join(' · ');
    }
    function movable(data) {
      const group = data.state.folders?.find(group => group.id === data.view.currentFolderId);
      return group && data.current && group.sceneId === data.current.id && group.id !== data.current.homeGroupId ? group : null;
    }
    function renderList(focus = false, message = '') {
      const data = currentData(), { state, view, current } = data;
      mode = null; beginScreen(t('场景空间'));
      body.appendChild(element('p', 'scene-description', t('让不同的事，各有空间。')));
      const list = element('ul', 'scene-list'); list.setAttribute('aria-label', t('可用场景'));
      const activeScenes = state.scenes.filter(active);
      const currentSceneId = current?.id;
      function row(scene, archived) {
        const node = element('li', 'scene-row'); node.dataset.sceneId = scene.id;
        const context = snapshot(view, scene);
        const main = archived ? element('div', 'scene-row-main') : button('', 'switch', () => {
          if (context.scene.id === currentSceneId) { close(); return; }
          runAction(host.onSwitch, context, close, context.scene.id);
        }, null, 'scene-row-main');
        main.replaceChildren(); main.appendChild(svg(scene.iconKey));
        const text = element('span', 'scene-row-text');
        text.appendChild(element('span', 'scene-row-name', scene.name));
        const counts = sceneCounts(state, scene);
        if (counts) text.appendChild(element('span', 'scene-row-counts', counts));
        main.appendChild(text);
        if (scene.id === current?.id) {
          main.setAttribute('aria-current', 'true'); node.classList.add('scene-row-current');
          main.appendChild(element('span', 'scene-current-label', t('当前')));
        }
        if (!archived) main.setAttribute('aria-label', t('切换到场景：{name}', { name: scene.name }));
        node.appendChild(main);
        const actions = element('div', 'scene-row-actions');
        if (archived) {
          actions.appendChild(iconButton(t('恢复场景：{name}', { name: scene.name }), 'restore', () => {
            runAction(host.onRestore, { sceneId: context.scene.id, context }, () => renderList(true, t('场景已恢复。')));
          }, 'restore'));
        } else {
          actions.appendChild(iconButton(t('重命名场景：{name}', { name: scene.name }), 'rename', () => showNameForm('rename', context), 'rename'));
          const archive = iconButton(t('归档场景：{name}', { name: scene.name }), 'archive', () => showArchive(context), 'archive');
          if (activeScenes.length <= 1) {
            archive.disabled = true; archive.title = t('至少保留一个可用场景。'); archive.setAttribute('aria-label', t('至少保留一个可用场景。'));
          }
          actions.appendChild(archive);
        }
        node.appendChild(actions); return node;
      }
      for (const scene of activeScenes) list.appendChild(row(scene, false));
      if (!activeScenes.length) body.appendChild(element('p', 'scene-empty', t('没有可用场景，请先恢复一个场景。')));
      body.appendChild(list);
      const actions = element('div', 'scene-list-footer');
      const createContext = snapshot(view);
      actions.appendChild(button(t('新建场景'), 'create', () => showNameForm('create', createContext), 'plus', 'scene-primary'));
      const group = movable(data);
      if (group) {
        const intent = moveIntent(data, group);
        const move = button(t('移动当前分组'), 'move', () => showMove(intent), 'move');
        move.disabled = activeScenes.length < 2;
        if (move.disabled) move.title = t('先新建或恢复另一个场景。');
        actions.appendChild(move);
      }
      body.appendChild(actions);
      const archived = state.scenes.filter(scene => !active(scene));
      if (archived.length) {
        const toggle = button(t('已归档场景（{count}）', { count: archived.length }), 'toggle-archived', () => {
          archivedVisible = !archivedVisible; renderList();
          body.querySelector('[data-scene-action="toggle-archived"]')?.focus();
        }, 'archive', 'scene-archived-toggle');
        toggle.setAttribute('aria-expanded', String(archivedVisible)); toggle.setAttribute('aria-controls', `${prefix}-archived`);
        body.appendChild(toggle);
        const archivedList = element('ul', 'scene-list scene-archived-list'); archivedList.id = `${prefix}-archived`;
        archivedList.hidden = !archivedVisible; archivedList.setAttribute('aria-label', t('已归档场景'));
        if (archivedVisible) archived.forEach(scene => archivedList.appendChild(row(scene, true)));
        body.appendChild(archivedList);
      }
      if (message) setStatus(message);
      if (focus) firstFocus();
    }
    function formFooter(form, label) {
      const footer = element('div', 'scene-form-footer');
      footer.appendChild(button(t('取消'), 'cancel', () => renderList(true)));
      const submit = element('button', 'scene-button scene-primary', label); submit.type = 'submit'; submit.dataset.sceneAction = 'submit';
      footer.appendChild(submit); form.appendChild(footer); return submit;
    }
    function showNameForm(kind, context) {
      mode = { kind, context, name: kind === 'rename' ? context.scene.name : '', iconKey: 'home' };
      const draft = mode;
      beginScreen(t(kind === 'create' ? '新建场景' : '重命名场景'));
      const form = element('form', 'scene-form'); form.noValidate = true;
      const label = element('label', 'scene-field-label', t('场景名称')); label.htmlFor = `${prefix}-name`;
      const input = element('input', 'scene-name-input'); input.id = `${prefix}-name`; input.name = 'sceneName'; input.type = 'text';
      input.maxLength = 40; input.required = true; input.autocomplete = 'off'; input.value = draft.name;
      const hint = element('p', 'scene-field-hint', t('最多 40 个字符。')); hint.id = `${prefix}-name-hint`;
      input.setAttribute('aria-describedby', `${hint.id} ${status.id}`);
      input.addEventListener('input', guard(input, () => { draft.name = input.value; input.removeAttribute('aria-invalid'); setStatus(''); }));
      form.appendChild(label); form.appendChild(input); form.appendChild(hint);
      if (kind === 'create') {
        const choices = element('fieldset', 'scene-icon-choices'); choices.appendChild(element('legend', 'scene-field-label', t('场景图标')));
        const grid = element('div', 'scene-icon-grid');
        for (const [key, [labelKey]] of Object.entries(ICONS)) {
          const choice = button('', 'choose-icon', () => {
            draft.iconKey = key;
            for (const option of grid.children) option.setAttribute('aria-pressed', String(option.dataset.iconKey === key));
          }, null, 'scene-icon-choice');
          choice.replaceChildren(); choice.appendChild(svg(key)); choice.dataset.iconKey = key;
          choice.title = t(labelKey); choice.setAttribute('aria-label', t(labelKey)); choice.setAttribute('aria-pressed', String(key === draft.iconKey));
          grid.appendChild(choice);
        }
        choices.appendChild(grid); form.appendChild(choices);
      }
      formFooter(form, t(kind === 'create' ? '创建场景' : '保存名称'));
      form.addEventListener('submit', event => {
        event.preventDefault();
        guard(form, () => {
          draft.name = input.value;
          const name = draft.name.trim();
          if (!name || name.length > 40) {
            input.setAttribute('aria-invalid', 'true'); setStatus(t('请输入 1–40 个字符的场景名称。'), true); input.focus(); return;
          }
          const payload = kind === 'create' ? { name, iconKey: draft.iconKey, context } : { sceneId: context.scene.id, name, context };
          runAction(kind === 'create' ? host.onCreate : host.onRename, payload, () => renderList(true, t(kind === 'create' ? '场景已创建。' : '场景名称已保存。')));
        })(event);
      });
      body.appendChild(form); input.focus(); input.select();
    }
    function showArchive(context) {
      mode = { kind: 'archive', context }; beginScreen(t('归档场景'));
      const form = element('form', 'scene-form');
      form.appendChild(element('p', 'scene-description', t('归档“{name}”？', { name: context.scene.name })));
      form.appendChild(element('p', 'scene-field-hint', t('分组、网站和待办都会保留。你可以随时恢复此场景。')));
      formFooter(form, t('归档场景'));
      form.addEventListener('submit', event => {
        event.preventDefault(); guard(form, () => runAction(host.onArchive, { sceneId: context.scene.id, context }, () => renderList(true, t('场景已归档，内容已保留。'))))(event);
      });
      body.appendChild(form); form.querySelector('[data-scene-action="cancel"]').focus();
    }
    function moveIntent({ state, view, current }, group) {
      return { context: snapshot(view, current, group), targets: state.scenes.filter(scene => active(scene) && scene.id !== current.id).map(identity) };
    }
    function showMove({ context, targets }) {
      mode = { kind: 'move', context, targets }; beginScreen(t('移动分组到场景'));
      const form = element('form', 'scene-form');
      form.appendChild(element('p', 'scene-description', t('移动“{name}”及其子分组和网站。待办仍留在原场景。', { name: context.group.name })));
      const label = element('label', 'scene-field-label', t('目标场景')); label.htmlFor = `${prefix}-target`;
      const select = element('select', 'scene-target-select'); select.id = `${prefix}-target`; select.name = 'targetSceneId';
      select.setAttribute('aria-describedby', status.id);
      targets.forEach(scene => { const option = element('option', '', scene.name); option.value = scene.id; select.appendChild(option); });
      if (targets.length) select.value = targets[0].id;
      form.appendChild(label); form.appendChild(select);
      const submit = formFooter(form, t('移动分组')); submit.disabled = !targets.length; select.disabled = !targets.length;
      if (!targets.length) setStatus(t('先新建或恢复另一个场景。'));
      form.addEventListener('submit', event => {
        event.preventDefault(); guard(form, () => {
          const targetScene = targets.find(scene => scene.id === select.value);
          if (!targetScene) { setStatus(t('请选择一个可用的目标场景。'), true); return; }
          const captured = Object.freeze({ ...context, targetScene });
          runAction(host.onMoveGroup, { groupId: context.group.id, targetSceneId: targetScene.id, context: captured }, () => renderList(true, t('分组已移动。')));
        })(event);
      });
      body.appendChild(form); (targets.length ? select : form.querySelector('[data-scene-action="cancel"]')).focus();
    }
    function open() {
      if (destroyed || pending) return false;
      if (opened) return true;
      try {
        opened = true; session++; archivedVisible = false;
        renderList(); dialog.showModal(); trigger.setAttribute('aria-expanded', 'true'); firstFocus(); return true;
      } catch (error) {
        resetClosed(false); if (dialog.open) dialog.close(); report(error); return false;
      }
    }
    function openMoveGroup() {
      if (destroyed || pending) return false;
      const data = currentData(), group = movable(data);
      if (!group) return false;
      const intent = moveIntent(data, group);
      if (!opened && !open()) return false;
      showMove(intent); return true;
    }
    function intercept(event) {
      if (!opened || destroyed) return;
      // Capture before page-level bubbling shortcuts, but leave native editing,
      // select navigation, input menus and ordinary Tab movement to the browser.
      event.stopImmediatePropagation();
      if (event.type !== 'keydown' || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'Tab') {
        const nodes = controls(), first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); return; }
        if (event.shiftKey && doc.activeElement === first || !event.shiftKey && doc.activeElement === last || !dialog.contains(doc.activeElement)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }
    }
    function outside(event) {
      if (event.target !== dialog) return false;
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    }
    trigger.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (!dialog.open) resetClosed(true); });
    dialog.addEventListener('pointerdown', event => { backdropPress = !pending && outside(event); });
    dialog.addEventListener('click', event => {
      if (backdropPress && outside(event)) close();
      backdropPress = false;
    });
    const isolatedEvents = ['keydown', 'keyup', 'keypress', 'contextmenu'];
    isolatedEvents.forEach(type => eventRoot.addEventListener(type, intercept, true));
    renderTrigger();
    return Object.freeze({
      render() {
        if (destroyed) return false;
        renderTrigger();
        // Preserve the displayed identity, draft and selection while a form or
        // write is in flight; the host must reject stale intent under its lock.
        if (opened && !pending && !mode) {
          const focused = doc.activeElement;
          const action = focused?.dataset?.sceneAction;
          const sceneId = focused?.closest('.scene-row')?.dataset.sceneId;
          const inside = dialog.contains(focused);
          renderList();
          if (inside) {
            const row = sceneId ? [...body.querySelectorAll('.scene-row')].find(node => node.dataset.sceneId === sceneId) : dialog;
            const replacement = [...(row?.querySelectorAll('[data-scene-action]') || [])].find(node => node.dataset.sceneAction === action && !node.disabled);
            if (visible(replacement)) replacement.focus(); else firstFocus();
          }
        }
        return true;
      },
      open, close, openMoveGroup,
      destroy() {
        if (destroyed) return;
        resetClosed(false); destroyed = true; session++;
        if (dialog.open) dialog.close();
        isolatedEvents.forEach(type => eventRoot.removeEventListener(type, intercept, true));
        trigger.remove(); dialog.remove();
      }
    });
  }
  return Object.freeze({ init });
}));
