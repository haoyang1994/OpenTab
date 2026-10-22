(function (global) {
  // Presentation and focus only. Search remains the single source of truth for
  // engine order, selection, storage, query text and navigation.
  function create({ host, trigger, panel, input, getLabel, onSelect, onOpen }) {
    if (!host || !trigger || !panel) return null;
    let expanded = false;
    let current = '';
    let rememberedSelection = null;
    let focusId = '';
    const buttons = () => Array.from(panel.querySelectorAll('.engine-btn'));
    const unchangedKey = (event) => event.defaultPrevented || event.isComposing ||
      event.key === 'Process' || event.keyCode === 229 || event.which === 229 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

    function setTabStop(id) {
      focusId = id;
      buttons().forEach((button) => { button.tabIndex = expanded && button.dataset.engine === id ? 0 : -1; });
    }

    function focusButton(id) {
      const button = buttons().find((item) => item.dataset.engine === id) || buttons()[0];
      if (!button) return;
      setTabStop(button.dataset.engine);
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function positionPanel() {
      if (!expanded) return;
      const rect = host.getBoundingClientRect();
      const viewport = global.visualViewport;
      const top = viewport?.offsetTop || 0;
      const height = viewport?.height || global.innerHeight;
      // #content is a z=1 ancestor; root-level floating controls are z=100.
      // Raising this panel cannot escape it, while raising the entire scrolling
      // content would intercept those controls even outside the panel. Instead,
      // reserve a gap around controls that overlap the card horizontally.
      const left = viewport?.offsetLeft || 0;
      const width = viewport?.width || global.innerWidth;
      const overflow = Math.max(0, rect.left + panel.offsetWidth - (left + width - 12));
      const shift = Math.min(overflow, Math.max(0, rect.left - left - 12));
      const panelLeft = rect.left - shift;
      const panelRight = panelLeft + panel.offsetWidth;
      let safeTop = top + 4;
      let safeBottom = top + height - 4;
      document.querySelectorAll('.floating-btn').forEach((control) => {
        if (!control.getClientRects().length) return;
        const obstacle = control.getBoundingClientRect();
        if (obstacle.right <= panelLeft || obstacle.left >= panelRight) return;
        if (obstacle.bottom <= rect.top) safeTop = Math.max(safeTop, obstacle.bottom + 12);
        if (obstacle.top >= rect.bottom) safeBottom = Math.min(safeBottom, obstacle.top - 12);
      });
      const below = Math.max(0, safeBottom - rect.bottom - 12);
      const above = Math.max(0, rect.top - safeTop - 12);
      const up = below < Math.min(panel.scrollHeight, 240) && above > below;
      const fullRow = Math.max(76, ...buttons().map((button) => button.offsetHeight || 0)) + 20;
      // A short viewport can split enough room into two unusable halves. In
      // that case use the whole unobstructed band instead of clipping a row at
      // the anchor. Never force a minimum larger than the actual safe space.
      const floating = Math.max(above, below) < fullRow;
      const available = floating ? Math.max(0, safeBottom - safeTop) : up ? above : below;
      panel.dataset.placement = floating ? 'floating' : up ? 'above' : 'below';
      panel.style.top = floating ? `${safeTop - rect.top}px` : '';
      panel.style.bottom = floating ? 'auto' : '';
      panel.style.maxHeight = `${Math.min(400, available)}px`;
      panel.style.marginLeft = `${-shift}px`;
    }

    function close({ restoreFocus = false } = {}) {
      if (!expanded) return;
      expanded = false;
      host.classList.remove('engine-deck-open');
      trigger.setAttribute('aria-expanded', 'false');
      panel.setAttribute('aria-hidden', 'true');
      panel.inert = true;
      setTabStop('');
      if (restoreFocus) trigger.focus({ preventScroll: true });
    }

    function open(id = current) {
      if (!expanded) {
        rememberedSelection = input ? {
          value: input.value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection
        } : null;
        expanded = true;
        onOpen?.();
        panel.inert = false;
        panel.setAttribute('aria-hidden', 'false');
        trigger.setAttribute('aria-expanded', 'true');
        host.classList.add('engine-deck-open');
      }
      positionPanel();
      focusButton(id);
    }

    function choose(id) {
      const selection = rememberedSelection;
      close();
      onSelect(id);
      // Focusing a text input normally retains its selection. Restore it
      // explicitly as well, but never apply an old range to a newer query.
      if (input && selection && selection.value === input.value && selection.start !== null) {
        input.setSelectionRange(selection.start, selection.end, selection.direction || 'none');
      }
      rememberedSelection = null;
    }

    function render(id) {
      current = id;
      const hadPanelFocus = panel.contains(document.activeElement);
      const list = buttons();
      list.forEach((button) => {
        const label = getLabel(button.dataset.engine);
        let name = button.querySelector('.engine-option-name');
        if (!name) {
          // Existing built-in SVGs and custom initials are reused, not fetched.
          const icon = document.createElement('span');
          icon.className = 'engine-option-icon';
          icon.setAttribute('aria-hidden', 'true');
          while (button.firstChild) icon.appendChild(button.firstChild);
          name = document.createElement('span');
          name.className = 'engine-option-name';
          button.appendChild(icon);
          button.appendChild(name);
        }
        name.textContent = label;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.classList.toggle('active', button.dataset.engine === current);
        button.setAttribute('aria-pressed', button.dataset.engine === current ? 'true' : 'false');
      });
      const active = list.find((button) => button.dataset.engine === current) || list[0];
      const topIcon = trigger.querySelector('.engine-deck-icon');
      if (active && topIcon) {
        topIcon.replaceChildren(active.querySelector('.engine-option-icon').cloneNode(true));
        trigger.dataset.engine = active.dataset.engine;
        const label = `${host.getAttribute('aria-label')}: ${getLabel(active.dataset.engine)}`;
        trigger.setAttribute('aria-label', label);
        trigger.title = label;
      }
      const nextFocus = list.some((button) => button.dataset.engine === focusId) ? focusId : current;
      setTabStop(nextFocus);
      positionPanel();
      if (expanded && hadPanelFocus) focusButton(nextFocus);
    }

    trigger.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      if (expanded) close({ restoreFocus: true }); else open();
    });
    trigger.addEventListener('keydown', (event) => {
      if (unchangedKey(event)) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const list = buttons();
      open(event.key === 'Home' ? list[0]?.dataset.engine : event.key === 'End' ? list.at(-1)?.dataset.engine : current);
    });
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('.engine-btn');
      if (!expanded || event.defaultPrevented || !button || !panel.contains(button)) return;
      choose(button.dataset.engine);
    });
    panel.addEventListener('keydown', (event) => {
      if (unchangedKey(event)) return;
      const list = buttons();
      const index = list.indexOf(event.target.closest('.engine-btn'));
      if (index < 0) return;
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = list.length - 1;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % list.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
      else return; // Enter/Space activate real buttons; Tab stays native.
      event.preventDefault();
      focusButton(list[next].dataset.engine);
    });
    host.addEventListener('keydown', (event) => {
      if (!expanded || unchangedKey(event) || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close({ restoreFocus: true });
    });
    document.addEventListener('pointerdown', (event) => {
      if (expanded && !host.contains(event.target)) close();
    }, true);
    document.addEventListener('focusin', (event) => {
      if (expanded && !host.contains(event.target)) close();
    });
    document.addEventListener('scroll', (event) => {
      if (expanded && !panel.contains(event.target)) positionPanel();
    }, true);
    if (global.MutationObserver) {
      new global.MutationObserver(() => {
        if (document.body.classList.contains('minimal-mode')) close();
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    global.addEventListener('resize', positionPanel);
    global.visualViewport?.addEventListener('resize', positionPanel);
    global.visualViewport?.addEventListener('scroll', positionPanel);
    panel.inert = true;
    panel.setAttribute('aria-hidden', 'true');
    setTabStop('');
    return { render, close, isOpen: () => expanded };
  }
  global.OpenTabEngineDeck = { create };
})(window);
