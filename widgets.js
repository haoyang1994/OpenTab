(function (g) {
  'use strict';
  const M = g.OpenTabWidgetModel, KEY = M.KEY, EPOCH = g.OpenTabWorkspace.EPOCH_KEY;
  const BACKUP = 'opentab.widgetMigrationBackup';
  const t = (source, params) => g.OpenTabI18n.t(source, params);
  let state = M.parse(), raw, epoch = 0, pending = false, blocked = false, loaded = false;
  let grid, status, feedback, library, settings, libraryStatus, settingsStatus, previews, registerInput, recovery, undoButton, librarySearch;
  let context, desktop, projected, libraryContext, settingsContext, undoRecord, settingsDraft = false, registrationDraft = false, layoutDraft = false;
  const cards = new Map();
  let deferredChanges = {};
  let menu, menuTrigger, libraryTrigger, editorTrigger, libraryPages;
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  function button(text, action) { const node = el('button', t(text)); node.type = 'button'; if (action) node.addEventListener('click', action); return node; }
  function field(form, labelText, value, type = 'text', options = {}) {
    const input = el(type === 'textarea' ? 'textarea' : 'input'), label = el('label', t(labelText));
    if (type !== 'textarea') input.type = type;
    input.id = `widget-field-${crypto.randomUUID()}`; label.htmlFor = input.id; input.value = value; Object.assign(input, options);
    const group = el('div', undefined, type === 'checkbox' ? 'widget-field widget-field-check' : 'widget-field');
    group.append(label, input); form.append(group); return input;
  }
  const types = () => M.BUILTINS.concat(state.definitions);
  const defFor = widget => types().find(def => def.id === widget.type);
  const title = def => def ? (def.id.startsWith('builtin.') ? t(M.renderer(def.kind)?.title || def.title) : def.title) : t('未知组件（数据已保留）');
  const getContext = () => g.OpenTabDesktop?.getContext();
  const sameContext = expected => !!expected && JSON.stringify(expected) === JSON.stringify(getContext());
  const snapshot = () => g.OpenTabDesktop?.getSnapshot() || { icons: [], folders: [] };
  const dirty = () => settingsDraft || registrationDraft || layoutDraft;
  function message(text) {
    status.textContent = text;
    if (feedback) feedback.hidden = !blocked && !text && !undoRecord;
    if (settings?.open) settingsStatus.textContent = text;
    if (library?.open) libraryStatus.textContent = text;
  }
  function failure(error) {
    if (error?.code === 'WORKSPACE_CONFLICT') return t('桌面已在其他位置变化。草稿已保留，请导出后重新读取。');
    if (error?.message === 'OCCUPIED') return t('目标位置已占用，原布局保留。请选择空位。');
    if (error?.message === 'INVALID_WIDGET_DATA' || error instanceof SyntaxError) return t('组件数据无效，请检查尺寸、字段、日期、链接和容量。');
    return t('桌面读取或保存失败，草稿与原数据已保留。');
  }
  function busy(value) {
    pending = value;
    document.getElementById('widget-add').disabled = value || !loaded || blocked;
    for (const control of document.querySelectorAll('.widget-card button, .widget-card input, .widget-dialog button, .widget-dialog input, .widget-dialog textarea')) {
      if (control.dataset.recovery) continue;
      const textInput = control.matches('textarea, input:not([type="checkbox"])');
      control.disabled = value || control.dataset.unavailable === 'true' || (blocked && !textInput && !control.dataset.close);
      if (textInput) control.readOnly = blocked || control.dataset.staticReadOnly === 'true';
    }
    recovery.hidden = !blocked; feedback.hidden = !blocked && !status.textContent && !undoRecord;
    undoButton.hidden = !undoRecord; undoButton.disabled = value || blocked;
  }
  function membership(icons, groupId) { return JSON.stringify(icons.filter(icon => (icon.folderId || 'folder-home') === groupId && !icon.parentId).map(icon => icon.id)); }
  function validTarget(latest, expected, expectedIcons) {
    if (!sameContext(expected) || g.OpenTabDesktop?.isBlocked() || (latest[EPOCH] || 0) !== epoch) return false;
    const group = latest.folders?.find(item => item.id === expected.groupId);
    if (latest['opentab.sceneSchemaVersion'] === 2) {
      if (!group || group.sceneId !== expected.sceneId || !latest.scenes?.some(scene => scene.id === group.sceneId && scene.archivedAt === null)) return false;
    } else if (!group && expected.groupId !== 'folder-home') return false;
    return expectedIcons === undefined || membership(latest.icons || [], expected.groupId) === expectedIcons;
  }
  async function change(update, expected = context, options = {}) {
    if (pending || blocked || !loaded) return false;
    if (!sameContext(expected)) { message(t('目标分组已变化，请重新打开组件库或设置。')); return false; }
    const expectedIcons = membership(snapshot().icons, expected.groupId);
    busy(true);
    try {
      const next = M.copy(state); update(next);
      const encoded = M.serialize(next);
      const saved = await g.OpenTabWorkspace.commit({ [KEY]: raw, [EPOCH]: epoch }, { [KEY]: encoded }, latest => validTarget(latest, expected, expectedIcons));
      raw = saved[KEY]; epoch = saved[EPOCH] || 0; state = M.parse(raw);
      g.OpenTabDesktop?.adoptWidgets(raw);
      if (!options.keepUndo) undoRecord = null;
      render(); message(''); return true;
    } catch (error) {
      if (error?.code === 'WORKSPACE_CONFLICT') blocked = true;
      message(failure(error)); return false;
    } finally { busy(false); flushChanges(); }
  }
  function cleanCard(card) { card.cancelPress?.(); try { card.renderer?.cleanup(card.disposable); } catch (_) { /* A broken local renderer cannot prevent recovery. */ } card.remove(); }
  function ctx(widget, def, body, form) {
    return { id: widget.id, data: M.copy(widget.data), def, body, form, el, t,
      button, field: (label, value, type, options, target = form) => field(target, label, value, type, options),
      save: async (data, focusId) => {
        const expected = { ...context };
        if (await change(next => { next.widgets.find(item => item.id === widget.id).data = M.data(def.kind, data, def); }, expected)) document.getElementById(focusId || `widget-move-${widget.id}`)?.focus();
        else render(true);
      } };
  }
  function closeMenu(restore = false) {
    if (!menu) return;
    menu.hidden = true; menuTrigger?.setAttribute('aria-expanded', 'false');
    if (restore && menuTrigger?.isConnected) menuTrigger.focus({ preventScroll: true });
  }
  function openMenu(id, trigger) {
    if (pending || blocked) return;
    closeMenu();
    menuTrigger = trigger; menu.dataset.widgetId = id; menu.replaceChildren();
    const edit = button('编辑', () => { closeMenu(); openSettings(id, null, trigger); });
    const remove = button('删除', () => { closeMenu(); void removeWidget(id); });
    remove.className = 'widget-menu-delete';
    for (const control of [edit, remove]) control.setAttribute('role', 'menuitem');
    menu.append(edit, remove); menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    const anchor = trigger.getBoundingClientRect(), rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(innerWidth - rect.width - 8, anchor.right - rect.width))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - rect.height - 8, anchor.bottom + 6))}px`;
    edit.focus();
  }
  function makeCard(widget) {
    const def = defFor(widget), renderer = def && M.renderer(def.kind), card = el('article', undefined, 'widget-card');
    card.dataset.widgetId = widget.id; card.dataset.kind = def?.kind || 'unknown'; card.signature = JSON.stringify([widget.type, widget.data, def]);
    const header = el('header'), heading = el('h3');
    const handle = button(title(def)); handle.id = `widget-move-${widget.id}`; handle.className = 'widget-handle';
    handle.title = t('拖动移动，方向键调整位置');
    handle.setAttribute('aria-label', `${t('移动')} · ${title(def)}`); heading.append(handle);
    const more = button('⋯', () => { if (!menu.hidden && menu.dataset.widgetId === widget.id) closeMenu(true); else openMenu(widget.id, more); }); more.className = 'widget-more'; more.id = `widget-more-${widget.id}`;
    more.title = t('更多操作'); more.setAttribute('aria-label', `${t('更多操作')} · ${title(def)}`);
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-controls', 'widget-menu'); more.setAttribute('aria-expanded', 'false');
    header.append(heading, more);
    const body = el('div', undefined, 'widget-body'); card.append(header, body); card.renderer = renderer;
    try {
      if (!renderer) {
        body.append(el('p', t('此类型暂不可用，可导出数据或重新注册对应定义。')));
        const text = el('textarea'); text.value = JSON.stringify(widget, null, 2); text.readOnly = true; text.setAttribute('aria-label', t('组件恢复数据')); body.append(text);
      } else card.disposable = renderer.render(ctx(widget, def, body));
    } catch (_) { body.replaceChildren(el('p', t('组件显示失败，数据已保留，可在设置中导出。'))); }
    bindDrag(handle, card, `w:${widget.id}`);
    card.addEventListener('contextmenu', event => {
      event.stopPropagation(); if (event.target.closest('input, textarea, a')) return;
      event.preventDefault(); openMenu(widget.id, more);
    });
    card.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.stopPropagation(); openMenu(widget.id, more); }
    });
    let press;
    const cancelPress = () => { if (press) clearTimeout(press.timer); press = null; };
    card.addEventListener('pointerdown', event => {
      cancelPress();
      if (event.pointerType === 'mouse' || !event.isPrimary || event.target.closest('button, input, textarea, a')) return;
      press = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { press = null; openMenu(widget.id, more); }, 550) };
    });
    card.addEventListener('pointermove', event => { if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancelPress(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) card.addEventListener(type, cancelPress);
    card.cancelPress = cancelPress;
    return card;
  }
  function render(force = false) {
    if (!grid || !loaded || !context) return;
    closeMenu();
    const visible = state.widgets.filter(item => item.groupId === context.groupId);
    const emptyHint = document.getElementById('icons-empty-hint');
    if (emptyHint) emptyHint.classList.toggle('hidden', visible.length > 0 || snapshot().icons.some(icon => (icon.folderId || 'folder-home') === context.groupId && !icon.parentId));
    for (const [id, card] of cards) if (!visible.some(item => item.id === id)) { cleanCard(card); cards.delete(id); }
    for (const widget of visible) {
      const old = cards.get(widget.id), signature = JSON.stringify([widget.type, widget.data, defFor(widget)]);
      if (old && old.signature === signature && !force) { if (old.parentElement !== grid) grid.append(old); continue; }
      const card = makeCard(widget); if (old) cleanCard(old); cards.set(widget.id, card); grid.append(card);
    }
    desktop = M.desktop(state, context.groupId, snapshot().icons, snapshot().columns || 6);
    reflow(); busy(pending);
  }
  function nodeFor(id) { return id.startsWith('w:') ? cards.get(id.slice(2)) : grid.querySelector(`.icon-widget[data-id="${CSS.escape(id.slice(2))}"]`); }
  function place(node, entry) { node.style.gridColumn = `${entry.x + 1} / span ${entry.w}`; node.style.gridRow = `${entry.y + 1} / span ${entry.h}`; }
  function reflow() {
    if (!desktop || !grid?.clientWidth) return;
    const available = Math.max(1, Math.min(desktop.columns, Math.floor((grid.clientWidth + 12) / 112)));
    const narrow = available < desktop.columns;
    if ((pointerDrag || iconDrag) && projected?.columns !== available) cancelDrag();
    grid.style.setProperty('--desktop-columns', available); grid.dataset.projected = String(narrow);
    projected = { columns: available, entries: narrow ? M.arrange(desktop.entries, available) : M.copy(desktop.entries) };
    const sorted = projected.entries.slice().sort((a, b) => a.y - b.y || a.x - b.x), active = document.activeElement;
    let anchor = grid.firstElementChild;
    const order = node => {
      if (node !== anchor) { if (typeof grid.moveBefore === 'function' && node.parentElement === grid) grid.moveBefore(node, anchor); else grid.insertBefore(node, anchor); }
      anchor = node.nextElementSibling;
    };
    for (const entry of sorted) { const node = nodeFor(entry.id); if (!node) continue; place(node, entry); order(node); }
    const add = grid.querySelector('#add-shortcut-tile');
    if (add) { place(add, { ...M.free(projected.entries, 1, 1, available), w: 1, h: 1 }); order(add); }
    if (active?.isConnected && active !== document.activeElement) active.focus({ preventScroll: true });
  }
  function movedLayout(id, patch, reorder) {
    if (id.startsWith('i:') && reorder) return M.reorderIcons(desktop, id, reorder.targetId, reorder.after);
    const layout = M.copy(desktop), entry = layout.entries.find(item => item.id === id); if (!entry) throw new Error('OCCUPIED');
    Object.assign(entry, patch);
    if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y) || !Number.isInteger(entry.w) || !Number.isInteger(entry.h)
      || entry.x < 0 || entry.y < 0 || entry.y > 511 || entry.w < 1 || entry.h < 1 || entry.h > 12 || entry.x + entry.w > layout.columns
      || layout.entries.some(other => other.id !== id && M.overlap(entry, other))) throw new Error('OCCUPIED');
    if (id.startsWith('w:')) {
      const def = defFor(state.widgets.find(item => item.id === id.slice(2))), renderer = def && M.renderer(def.kind);
      if (renderer && !renderer.customSizes && !renderer.sizes.some(([w, h]) => w === entry.w && h === entry.h)) throw new TypeError('INVALID_WIDGET_DATA');
    }
    return layout;
  }
  async function move(id, patch, focusId, reorder) {
    try { const entry = desktop?.entries.find(item => item.id === id);
      if (entry && Object.entries(patch).every(([key, value]) => entry[key] === value)) return true;
      const layout = movedLayout(id, patch, reorder); if (await change(next => M.saveDesktop(next, context.groupId, layout))) { (document.getElementById(focusId) || nodeFor(id))?.focus({ preventScroll: true }); return true; } }
    catch (error) { message(failure(error)); } return false;
  }
  function target(event, entry, offset = { x: 0, y: 0 }) {
    const rect = grid.getBoundingClientRect(), style = getComputedStyle(grid), gap = parseFloat(style.columnGap) || 12, row = parseFloat(style.gridAutoRows) || 120;
    // Keep the original grab point. Never clamp an outside drop onto a valid cell.
    if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) return null;
    return { x: Math.round((event.clientX - rect.left - offset.x) / ((rect.width + gap) / desktop.columns)), y: Math.round((event.clientY - rect.top - offset.y) / (row + gap)) };
  }
  let ghost, pointerDrag, iconDrag, scrollFrame = 0, pointerY = 0, updatePreview;
  function clearPreview() { ghost?.remove(); ghost = null; }
  function beginDrag() {
    closeMenu(); grid.style.minBlockSize = `${grid.getBoundingClientRect().height + 132}px`; grid.classList.add('desktop-drag-active');
  }
  function endDragView() {
    clearPreview(); grid?.classList.remove('desktop-drag-active'); if (grid) grid.style.minBlockSize = '';
    if (scrollFrame) cancelAnimationFrame(scrollFrame); scrollFrame = 0; updatePreview = null;
  }
  function cancelDrag() {
    pointerDrag = null; iconDrag = null;
    for (const card of cards.values()) card.classList.remove('widget-dragging');
    endDragView(); g.OpenTabDesktop?.endDrag();
  }
  function autoScroll(y, update) {
    pointerY = y; updatePreview = update;
    if (scrollFrame) return;
    const tick = () => {
      if (!pointerDrag && !iconDrag) { scrollFrame = 0; return; }
      const scroller = document.getElementById('content') || document.scrollingElement;
      const rect = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
      const delta = pointerY < rect.top + 48 ? -Math.min(12, rect.top + 48 - pointerY) : pointerY > rect.bottom - 48 ? Math.min(12, pointerY - rect.bottom + 48) : 0;
      if (delta) { scroller.scrollTop += delta; updatePreview?.(); }
      scrollFrame = requestAnimationFrame(tick);
    };
    scrollFrame = requestAnimationFrame(tick);
  }
  function preview(id, point, reorder) {
    clearPreview(); const entry = desktop.entries.find(item => item.id === id); if (!entry || !point) return false;
    ghost = el('div', undefined, 'desktop-drop-preview'); ghost.setAttribute('aria-hidden', 'true');
    // Invalid edge destinations must not create implicit columns or rows.
    let valid = true, destination = point;
    try { destination = movedLayout(id, point, reorder).entries.find(item => item.id === id); } catch (_) { valid = false; }
    place(ghost, { ...entry, x: Math.max(0, Math.min(desktop.columns - entry.w, destination.x)), y: Math.max(0, Math.min(511, destination.y)) });
    ghost.dataset.valid = String(valid); ghost.textContent = t(valid ? '可放置' : '已占用'); grid.append(ghost); return valid;
  }
  function bindDrag(handle, card, id) {
    handle.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); event.stopPropagation(); if (pending || blocked) return;
      const entry = desktop.entries.find(item => item.id === id); if (!entry) return;
      void move(id, { x: entry.x + delta[0], y: entry.y + delta[1] }, handle.id);
    });
    handle.addEventListener('pointerdown', event => {
      if (event.button || !event.isPrimary || pending || blocked) return;
      if (projected.columns !== desktop.columns) { message(t('窄窗口请在设置中输入桌面坐标。')); return; }
      const entry = desktop.entries.find(item => item.id === id), rect = card.getBoundingClientRect();
      pointerDrag = { id, context: { ...context }, entry, offset: { x: event.clientX - rect.left, y: event.clientY - rect.top }, startX: event.clientX, startY: event.clientY, moved: false };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!pointerDrag || !handle.hasPointerCapture(event.pointerId)) return;
      if (!sameContext(pointerDrag.context)) { cancelDrag(); return; }
      if (!pointerDrag.moved && Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 5) return;
      if (!pointerDrag.moved) { pointerDrag.moved = true; beginDrag(); }
      card.classList.add('widget-dragging');
      const update = () => { if (pointerDrag) preview(id, target(event, pointerDrag.entry, pointerDrag.offset)); };
      update(); autoScroll(event.clientY, update);
    });
    handle.addEventListener('pointerup', event => {
      if (!pointerDrag) return;
      const drag = pointerDrag, destination = target(event, drag.entry, drag.offset); cancelDrag();
      if (drag.moved && destination && sameContext(drag.context)) void move(id, destination, handle.id);
    });
    for (const type of ['pointercancel', 'lostpointercapture']) handle.addEventListener(type, () => { if (pointerDrag?.id === id) cancelDrag(); });
  }
  async function removeWidget(id) {
    const widget = state.widgets.find(item => item.id === id), expected = { ...context }; if (!widget) return;
    const previous = M.copy(widget);
    if (await change(next => { next.widgets = next.widgets.filter(item => item.id !== id); }, expected)) {
      undoRecord = { widget: previous, context: expected, raw, epoch }; message(t('组件已删除，可撤销。')); busy(false); document.getElementById('widget-add').focus();
    }
  }
  async function undo() {
    const receipt = undoRecord; if (!receipt || receipt.raw !== raw || receipt.epoch !== epoch || !sameContext(receipt.context)) { message(t('桌面已变化，无法撤销旧操作。')); return; }
    if (await change(next => {
      if (next.widgets.some(item => item.id === receipt.widget.id)) throw new Error('OCCUPIED');
      if (desktop.entries.some(item => M.overlap(receipt.widget, item))) throw new Error('OCCUPIED');
      next.widgets.push(receipt.widget);
    }, receipt.context, { keepUndo: true })) { undoRecord = null; message(t('组件已恢复。')); busy(false); }
  }
  function closeSettings() {
    if (pending) return;
    settingsDraft = false; settings.close(); if (!blocked) message('');
    (editorTrigger?.isConnected ? editorTrigger : document.getElementById('widget-add'))?.focus({ preventScroll: true });
  }
  function openSettings(id, definition = null, trigger = document.activeElement) {
    if (settings.open || pending || blocked) return;
    const adding = !!definition, def = definition || defFor(state.widgets.find(item => item.id === id) || {});
    const layoutNow = desktop;
    let widget = state.widgets.find(item => item.id === id);
    if (adding) {
      if (def.size.w > desktop.columns) { message(t('请先增加桌面列数，再添加此组件。')); return; }
      try { widget = { id: crypto.randomUUID(), type: def.id, groupId: context.groupId, ...M.free(layoutNow.entries, def.size.w, def.size.h, layoutNow.columns), ...def.size, data: M.copy(def.defaults) }; }
      catch (error) { message(failure(error)); return; }
      id = widget.id;
    }
    if (!widget) return;
    editorTrigger = trigger; settingsContext = { ...context }; settingsDraft = false; settings.replaceChildren();
    const renderer = def && M.renderer(def.kind), heading = el('h2', `${t(adding ? '添加' : '编辑')} · ${title(def)}`); heading.id = 'widget-settings-title';
    const header = el('div', undefined, 'widget-dialog-header'), close = button('×', closeSettings); close.dataset.close = 'true'; close.setAttribute('aria-label', t('关闭')); header.append(heading, close);
    const form = el('form', undefined, 'widget-form'), content = el('div', undefined, 'widget-content-editor'); form.append(content);
    let read;
    try { if (renderer) read = renderer.edit(ctx(widget, def, null, content)); }
    catch (_) { content.append(el('p', t('此类型暂不可编辑，数据已保留。'))); }
    if (!read) { const text = field(content, '组件恢复数据', JSON.stringify(widget.data, null, 2), 'textarea'); text.readOnly = true; text.dataset.staticReadOnly = 'true'; }
    const details = el('details', undefined, 'widget-layout-details'), layout = el('div', undefined, 'widget-layout-fields');
    details.append(el('summary', t('尺寸与位置')), layout); form.append(details);
    const presets = el('div', undefined, 'widget-size-presets'); layout.append(presets);
    const w = field(layout, '占用列数', widget.w, 'number', { min: 1, max: desktop.columns, required: true });
    const h = field(layout, '占用行数', widget.h, 'number', { min: 1, max: 12, required: true });
    const syncPresets = () => { for (const control of presets.children) control.setAttribute('aria-pressed', String(control.dataset.w === w.value && control.dataset.h === h.value)); };
    for (const [width, height] of renderer?.sizes || M.SIZES) {
      const preset = button(`${width}×${height}`, () => { w.value = width; h.value = height; settingsDraft = true; syncPresets(); });
      preset.dataset.w = width; preset.dataset.h = height; preset.dataset.unavailable = String(width > desktop.columns); presets.append(preset);
    }
    syncPresets(); w.addEventListener('input', syncPresets); h.addEventListener('input', syncPresets);
    const x = field(layout, '起始列', widget.x + 1, 'number', { min: 1, max: desktop.columns, required: true });
    const y = field(layout, '起始行', widget.y + 1, 'number', { min: 1, max: 512, required: true });
    settingsStatus = el('p', '', 'widget-status'); settingsStatus.setAttribute('role', 'status');
    const save = button(adding ? '添加' : '保存'); save.type = 'submit'; save.classList.add('btn-primary');
    const cancel = button('取消', closeSettings); cancel.dataset.close = 'true';
    const actions = el('div', undefined, 'widget-dialog-actions'); actions.append(cancel, save); form.append(settingsStatus, actions);
    settings.append(header, form);
    const recoveryDetails = el('details', undefined, 'widget-recovery-details'); recoveryDetails.append(el('summary', t('恢复数据')), exportButton()); settings.append(recoveryDetails);
    form.addEventListener('input', () => { settingsDraft = true; });
    form.addEventListener('click', event => { if (event.target.closest('button:not([type="submit"]):not([data-close])')) settingsDraft = true; });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (pending || blocked) return;
      if (!form.checkValidity()) { details.open = true; form.reportValidity(); return; }
      try {
        const data = read ? M.data(def.kind, read(), def) : widget.data;
        const patch = { w: Number(w.value), h: Number(h.value), x: Number(x.value) - 1, y: Number(y.value) - 1 };
        let layout;
        if (!adding) layout = movedLayout(`w:${id}`, patch);
        else {
          const entry = { ...widget, ...patch };
          if (![patch.w, patch.h, patch.x, patch.y].every(Number.isInteger) || patch.w < 1 || patch.h < 1 || patch.h > 12 || patch.x < 0 || patch.y < 0 || patch.y > 511 || patch.x + patch.w > desktop.columns || desktop.entries.some(other => M.overlap(entry, other))) throw new Error('OCCUPIED');
          layout = desktop;
        }
        if (renderer && !renderer.customSizes && !renderer.sizes.some(([width, height]) => width === patch.w && height === patch.h)) throw new TypeError('INVALID_WIDGET_DATA');
        if (await change(next => {
          M.saveDesktop(next, settingsContext.groupId, layout);
          if (adding) next.widgets.push({ ...widget, ...patch, data }); else next.widgets.find(item => item.id === id).data = data;
        }, settingsContext)) { settingsDraft = false; settings.close(); document.getElementById(`widget-more-${id}`)?.focus({ preventScroll: true }); }
      } catch (error) { details.open = true; message(failure(error)); }
    });
    // Invalid controls inside a collapsed layout section still need to be focusable.
    form.addEventListener('invalid', event => { if (details.contains(event.target)) details.open = true; }, true);
    settings.showModal(); busy(false); (content.querySelector('textarea, input, button') || save).focus();
  }
  const example = { id: 'my.project', title: '项目进展', kind: 'composite', size: { w: 2, h: 2 },
    fields: [{ key: 'title', label: '项目', type: 'text' }, { key: 'count', label: '已完成', type: 'number' }, { key: 'items', label: '待办', type: 'list' }, { key: 'due', label: '截止日', type: 'date' }, { key: 'progress', label: '进度', type: 'progress' }, { key: 'link', label: '项目链接', type: 'link' }],
    blocks: [{ type: 'text', field: 'title' }, { type: 'number', field: 'count', label: '已完成' }, { type: 'list', field: 'items' }, { type: 'date', field: 'due', label: '截止' }, { type: 'progress', field: 'progress' }, { type: 'link', field: 'link' }],
    defaults: { title: '我的项目', count: 3, items: ['整理资料', '完成设计'], due: '2026-12-31', progress: 30, link: { label: '项目文档', url: 'https://example.com/' } } };
  function previewData(def) {
    if (!def.id.startsWith('builtin.')) return M.copy(def.defaults);
    switch (def.kind) {
      case 'note': return { text: t('记录灵感，留住重要的小事。') };
      case 'checklist': return { items: [{ id: 'one', text: t('整理今天的计划'), done: true }, { id: 'two', text: t('留一点时间给自己'), done: false }] };
      case 'links': return { links: [{ label: t('常用网站'), url: 'https://example.com/' }, { label: t('工作资料'), url: 'https://example.com/' }] };
      case 'countdown': return { label: t('下一次旅行'), date: '2030-01-01' };
      default: return M.copy(def.defaults);
    }
  }
  function renderLibrary() {
    previews.replaceChildren();
    const query = (librarySearch?.value || '').trim().toLocaleLowerCase();
    let count = 0;
    for (const def of types()) {
      if (query && !title(def).toLocaleLowerCase().includes(query)) continue;
      count++;
      const card = el('article', undefined, 'widget-library-card'); card.dataset.kind = def.kind;
      const heading = el('h3', title(def));
      const stage = el('div', undefined, 'widget-preview-stage'), body = el('div', undefined, 'widget-preview');
      stage.append(body);
      const renderer = M.renderer(def.kind); let disposable;
      try { if (renderer) disposable = renderer.render({ ...ctx({ id: `preview-${crypto.randomUUID()}`, data: previewData(def) }, def, body), save: () => {} }); else body.append(el('p', t('需要恢复对应的本地类型'))); }
      catch (_) { body.textContent = t('预览暂不可用，定义已保留。'); }
      if (renderer) renderer.cleanup(disposable); body.inert = true;
      const footer = el('footer', undefined, 'widget-library-footer');
      const add = button('添加', () => addInstance(def));
      add.dataset.unavailable = String(!renderer || def.size.w > (desktop?.columns || 6)); add.disabled = add.dataset.unavailable === 'true'; add.className = 'widget-library-add'; add.setAttribute('aria-label', `${t('添加')} · ${title(def)}`);
      footer.append(el('span', `${def.size.w} × ${def.size.h}`, 'widget-library-size'), add);
      if (!def.id.startsWith('builtin.') && !def.id.startsWith('local.')) footer.append(button('注销定义', async () => {
        if (state.widgets.some(widget => widget.type === def.id)) { message(t('请先移除该类型在所有分组中的实例。')); return; }
        if (await change(next => { next.definitions = next.definitions.filter(item => item.id !== def.id); }, libraryContext)) renderLibrary();
      }));
      card.append(heading, stage, footer); previews.append(card);
    }
    if (!count && query) previews.append(el('p', t('没有找到小组件'), 'widget-library-empty'));
    const groups = new Set(snapshot().folders.map(group => group.id)); groups.add('folder-home');
    for (const widget of state.widgets.filter(item => !groups.has(item.groupId))) {
      const recoveryCard = el('article', undefined, 'widget-library-card'); recoveryCard.append(el('h3', t('未找到原分组的组件')), el('p', `${widget.type} · ${widget.groupId}`), button('恢复到当前分组', async () => {
        if (await change(next => { const chosen = next.widgets.find(item => item.id === widget.id), layout = M.desktop(next, libraryContext.groupId, snapshot().icons); const point = M.free(layout.entries, chosen.w, chosen.h, layout.columns); Object.assign(chosen, point, { groupId: libraryContext.groupId }); }, libraryContext)) renderLibrary();
      })); previews.append(recoveryCard);
    }
  }
  function addInstance(def) {
    if (pending || blocked || !sameContext(libraryContext) || !M.renderer(def.kind)) return;
    if (def.size.w > desktop.columns) { message(t('请先增加桌面列数，再添加此组件。')); return; }
    library.close(); openSettings(null, def, document.getElementById('widget-add'));
  }
  function openLibrary() {
    if (library.open || settings.open || !loaded || blocked || pending || !getContext() || g.OpenTabDesktop?.isBlocked()) return;
    libraryTrigger = document.activeElement; closeMenu(); libraryContext = { ...getContext() };
    librarySearch.value = ''; libraryPages?.[0]?.click(); renderLibrary();
    if (!layoutDraft) document.getElementById('desktop-column-count').value = desktop?.columns || 6;
    libraryStatus.textContent = ''; library.showModal(); busy(false); librarySearch.focus();
  }
  function exportButton() { const control = button('导出恢复数据与草稿', exportDraft); control.dataset.recovery = 'true'; return control; }
  function exportDraft() {
    const forms = [...document.querySelectorAll('.widget-dialog input, .widget-dialog textarea')].map(input => ({ id: input.id, label: document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent, value: input.value, checked: input.checked }));
    const blob = new Blob([JSON.stringify({ format: 'opentab-widget-recovery', version: 1, raw, state, forms, context, settingsContext, libraryContext }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = 'opentab-widget-recovery.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function load(migrate = false) {
    if (pending) return; busy(true);
    try {
      let saved = await g.OpenTabWorkspace.read(null); raw = saved[KEY];
      let next = M.parse(raw);
      if (migrate && raw && JSON.parse(raw).version === 1) {
        saved = await g.OpenTabWorkspace.transaction(async ({ read, write }) => {
          const latest = await read(null); if (latest[KEY] !== raw) throw Object.assign(new Error(), { code: 'WORKSPACE_CONFLICT' });
          const previous = latest[BACKUP];
          const entries = previous?.version === 2 && Array.isArray(previous.entries) ? previous.entries.slice() : Object.hasOwn(latest, BACKUP) ? [previous] : [];
          if (!entries.some(entry => entry?.raw === raw)) entries.push({ version: 1, raw, reason: 'before-unified-desktop' });
          const patch = { [KEY]: M.serialize(next), [BACKUP]: { version: 2, entries } }; await write(patch); return { ...latest, ...patch };
        });
        raw = saved[KEY]; next = M.parse(raw);
      }
      state = next; epoch = saved[EPOCH] || 0; blocked = false; loaded = true; undoRecord = null;
      g.OpenTabDesktop?.adoptWidgets(raw);
      render(); message('');
    } catch (error) { blocked = true; message(failure(error)); }
    finally { busy(false); flushChanges(); }
  }
  function receiveChanges(changes, area) {
    if (area !== 'local' || ![KEY, EPOCH, 'folders', 'icons', 'scenes'].some(key => changes[key])) return;
    if (pending) { Object.assign(deferredChanges, changes); return; }
    if (changes[KEY]?.newValue === raw && !changes[EPOCH] && !changes.folders && !changes.icons && !changes.scenes) return;
    if (dirty() || settings.open || library.open) { blocked = true; message(t('桌面已在其他位置变化。草稿已保留，请导出后重新读取。')); busy(false); }
    else void load(true);
  }
  function flushChanges() {
    const changes = deferredChanges; deferredChanges = {};
    if (Object.keys(changes).length) queueMicrotask(() => receiveChanges(changes, 'local'));
  }
  function attach(container) {
    grid = container; context = getContext();
    closeMenu(); cancelDrag();
    if (!context) return;
    try { render(); } catch (error) { blocked = true; message(failure(error)); busy(false); }
  }
  function createDialog(id, headingText) { const dialog = el('dialog', undefined, 'modal-content widget-dialog'); dialog.id = id; dialog.setAttribute('aria-labelledby', `${id}-title`); const heading = el('h2', t(headingText)); heading.id = `${id}-title`; dialog.append(heading); dialog.addEventListener('contextmenu', event => event.stopPropagation()); dialog.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault(); }); document.body.append(dialog); return dialog; }
  async function init() {
    await g.OpenTabI18n.ready;
    grid = document.getElementById('icons-container'); grid.classList.add('desktop-grid');
    feedback = document.getElementById('desktop-widget-feedback'); status = el('p', '', 'widget-status'); status.setAttribute('role', 'status');
    recovery = el('div'); const reload = button('舍弃设置和注册草稿并重新读取', () => { settingsDraft = false; registrationDraft = false; layoutDraft = false; settings.close(); library.close(); void load(true); }); reload.dataset.recovery = 'true';
    recovery.append(exportButton(), reload); undoButton = button('撤销删除', () => { void undo(); }); feedback.append(status, undoButton, recovery);
    menu = el('div', undefined, 'widget-menu'); menu.id = 'widget-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('小组件操作')); menu.hidden = true; document.body.append(menu);
    document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !event.target.closest('.widget-more')) closeMenu(); }, true);
    menu.addEventListener('keydown', event => {
      const controls = [...menu.querySelectorAll('button')], index = controls.indexOf(document.activeElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.stopPropagation(); closeMenu(true); if (event.key === 'Escape') event.preventDefault(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); controls[event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length]?.focus(); }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && (pointerDrag || iconDrag)) { event.preventDefault(); event.stopPropagation(); cancelDrag(); } }, true);
    g.addEventListener('blur', () => { closeMenu(); cancelDrag(); });
    g.addEventListener('resize', () => closeMenu());
    document.addEventListener('scroll', event => { if (!menu.contains(event.target)) closeMenu(); }, true);
    library = createDialog('widget-dialog', '组件库');
    const closeLibrary = () => { if (pending) return; registrationDraft = false; layoutDraft = false; registerInput.value = JSON.stringify(example, null, 2); library.close(); if (!blocked) message(''); (libraryTrigger?.isConnected ? libraryTrigger : document.getElementById('widget-add'))?.focus({ preventScroll: true }); };
    const close = button('×', closeLibrary); close.setAttribute('aria-label', t('关闭'));
    library.addEventListener('cancel', event => { event.preventDefault(); closeLibrary(); }); close.dataset.close = 'true';
    const libraryHeader = el('div', undefined, 'widget-dialog-header'); libraryHeader.append(library.firstElementChild, close); library.append(libraryHeader);
    const libraryShell = el('div', undefined, 'widget-library-shell');
    const navigation = el('nav', undefined, 'widget-library-nav'); navigation.setAttribute('aria-label', t('组件库导航'));
    const libraryMain = el('div', undefined, 'widget-library-main');
    const catalog = el('section', undefined, 'widget-library-page');
    const layoutPage = el('section', undefined, 'widget-library-page');
    const customPage = el('section', undefined, 'widget-library-page');
    const pageButtons = []; libraryPages = [];
    for (const [label, page] of [[t('小组件'), catalog], [t('桌面布局'), layoutPage], [t('自定义组件'), customPage]]) {
      const tab = button(label, () => { for (const [control, target] of pageButtons) { const active = target === page; target.hidden = !active; control.setAttribute('aria-pressed', String(active)); } });
      tab.setAttribute('aria-pressed', String(page === catalog)); page.hidden = page !== catalog; pageButtons.push([tab, page]); libraryPages.push(tab); navigation.append(tab);
    }
    const catalogHeader = el('div', undefined, 'widget-catalog-header');
    librarySearch = el('input', undefined, 'widget-library-search'); librarySearch.type = 'search'; librarySearch.placeholder = t('搜索小组件'); librarySearch.setAttribute('aria-label', t('搜索小组件'));
    librarySearch.addEventListener('input', renderLibrary); catalogHeader.append(librarySearch);
    previews = el('div', undefined, 'widget-library'); catalog.append(catalogHeader, previews);
    libraryMain.append(catalog, layoutPage, customPage); libraryShell.append(navigation, libraryMain); library.append(libraryShell);
    const desktopForm = el('form', undefined, 'widget-form');
    desktopForm.append(el('p', t('桌面列数按分组保存。应用列数会整理位置；已有组件大小保持不变。')));
    const columnsInput = field(desktopForm, '桌面列数', 6, 'number', { min: 1, max: 12, required: true }); columnsInput.id = 'desktop-column-count';
    desktopForm.querySelector('label').htmlFor = columnsInput.id;
    const applyColumns = button('应用列数并整理'); applyColumns.type = 'submit'; desktopForm.append(applyColumns);
    desktopForm.addEventListener('input', () => { layoutDraft = true; });
    desktopForm.append(button('取消桌面列数修改', () => { columnsInput.value = desktop?.columns || 6; layoutDraft = false; }));
    desktopForm.addEventListener('submit', async event => {
      event.preventDefault(); const columns = Number(columnsInput.value);
      if (await change(next => {
        const layout = M.desktop(next, libraryContext.groupId, snapshot().icons, snapshot().columns || 6), packed = [];
        for (const entry of layout.entries.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
          if (entry.w > columns) throw new TypeError('INVALID_WIDGET_DATA');
          packed.push({ ...entry, ...M.free(packed, entry.w, entry.h, columns) });
        }
        M.saveDesktop(next, libraryContext.groupId, { columns, entries: packed });
      }, libraryContext)) layoutDraft = false;
    });
    layoutPage.append(el('h3', t('桌面布局')), desktopForm);
    const details = el('details'); details.append(el('summary', t('注册组合组件')));
    details.append(el('p', t('用文本、数字、列表、日期、进度和链接组合自己的组件。只接受声明式 JSON，不执行脚本、HTML 或远程代码。')));
    const form = el('form', undefined, 'widget-form'); registerInput = field(form, '组件定义 JSON', JSON.stringify(example, null, 2), 'textarea', { required: true, rows: 14, maxLength: 32000 });
    form.addEventListener('input', () => { registrationDraft = true; });
    const register = button('注册组件'); register.type = 'submit'; register.classList.add('btn-primary'); form.append(register);
    form.append(button('舍弃注册草稿', () => { registerInput.value = JSON.stringify(example, null, 2); registrationDraft = false; }));
    form.addEventListener('submit', async event => {
      event.preventDefault(); try { if (await registerDefinition(JSON.parse(registerInput.value), libraryContext)) { registrationDraft = false; renderLibrary(); } } catch (error) { message(failure(error)); }
    });
    details.append(form); customPage.append(el('h3', t('自定义组件')), details, exportButton());
    libraryStatus = el('p', '', 'widget-status'); libraryStatus.setAttribute('role', 'status'); libraryHeader.after(libraryStatus);
    settings = createDialog('widget-settings', '设置'); settings.setAttribute('aria-labelledby', 'widget-settings-title');
    settings.addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
    document.getElementById('widget-add').addEventListener('click', openLibrary);
    grid.addEventListener('contextmenu', event => {
      if (event.target.closest('.widget-card, .icon-widget, input, textarea, a')) return;
      event.preventDefault(); event.stopPropagation(); openLibrary();
    });
    const iconIntent = event => {
      const node = event.target.closest('.icon-widget[data-id]'); if (!node) return undefined;
      const rect = node.getBoundingClientRect(); return { targetId: `i:${node.dataset.id}`, after: event.clientX > rect.left + rect.width / 2 };
    };
    grid.addEventListener('dragstart', event => {
      const node = event.target.closest('.icon-widget[data-id]'); if (!node) return;
      if (pending || blocked || projected.columns !== desktop.columns) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      const rect = node.getBoundingClientRect();
      iconDrag = { id: `i:${node.dataset.id}`, context: { ...context }, offset: { x: event.clientX - rect.left, y: event.clientY - rect.top } }; beginDrag();
    }, true);
    grid.addEventListener('dragover', event => {
      if (!iconDrag) return;
      if (pending || blocked || projected.columns !== desktop.columns || !sameContext(iconDrag.context)) { event.preventDefault(); event.stopImmediatePropagation(); cancelDrag(); return; }
      const entry = desktop.entries.find(item => item.id === iconDrag.id); if (!entry) return;
      event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const update = () => { if (iconDrag) preview(iconDrag.id, target(event, entry, iconDrag.offset), iconIntent(event)); };
      update(); autoScroll(event.clientY, update);
      // Hover can arm a folder merge. Only an explicit drop commits it.
      if (event.target.closest('.icon-widget[data-id]') && !event.shiftKey) return;
      event.stopImmediatePropagation(); g.OpenTabFolders?.clearMergeHover(); g.OpenTabDesktop?.hideDropIndicator();
    }, true);
    grid.addEventListener('drop', event => {
      if (!iconDrag) return;
      const drag = iconDrag, entry = desktop.entries.find(item => item.id === drag.id);
      const destination = entry && target(event, entry, drag.offset);
      if (!entry) { cancelDrag(); return; } // Folder extraction uses its existing path.
      event.preventDefault(); event.stopImmediatePropagation();
      if (pending || blocked || projected.columns !== desktop.columns || !sameContext(drag.context)) { cancelDrag(); return; }
      if (!event.shiftKey && event.target.closest('.icon-widget[data-id]') && g.OpenTabFolders?.handleGridDrop(event, drag.id.slice(2))) { cancelDrag(); return; }
      const reorder = iconIntent(event); cancelDrag(); if (destination) void move(drag.id, destination, undefined, reorder);
    }, true);
    grid.addEventListener('dragleave', event => { if (!grid.contains(event.relatedTarget)) { clearPreview(); g.OpenTabFolders?.clearMergeHover(); } });
    document.addEventListener('dragend', cancelDrag);
    document.addEventListener('drop', () => { if (iconDrag) cancelDrag(); });
    grid.addEventListener('keydown', event => {
      if (!event.altKey || event.ctrlKey || event.metaKey || !event.target.matches('.icon-widget[data-id]')) return;
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]; if (!delta) return;
      const id = `i:${event.target.dataset.id}`, entry = desktop.entries.find(item => item.id === id); if (!entry) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const point = { x: entry.x + delta[0], y: entry.y + delta[1] }, occupant = desktop.entries.find(item => item.id !== id && item.x === point.x && item.y === point.y && item.id.startsWith('i:'));
      void move(id, point, undefined, occupant ? { targetId: occupant.id, after: delta[0] > 0 || delta[1] > 0 } : undefined);
    }, true);
    g.chrome.storage.onChanged.addListener(receiveChanges);
    context = getContext(); await load(true); context = getContext(); render();
    grid.dataset.widgetsReady = 'true';
    const observer = new ResizeObserver(reflow); observer.observe(grid);
    g.addEventListener('pagehide', () => { observer.disconnect(); for (const card of cards.values()) cleanCard(card); }, { once: true });
  }
  async function registerDefinition(value, expected = getContext()) {
    const def = M.definition(value);
    if (def.kind !== 'composite' && !M.renderer(def.kind)) throw new TypeError('INVALID_WIDGET_DATA');
    return change(next => { if (types().some(item => item.id === def.id)) throw new TypeError('INVALID_WIDGET_DATA'); next.definitions.push(def); }, expected);
  }
  const ready = init();
  g.OpenTabWidgets = Object.freeze({ ready, attach, openLibrary, canSwitch: () => !pending && settings?.open !== true && library?.open !== true && !dirty(),
    register: async value => { await ready; return registerDefinition(value); } });
})(globalThis);
