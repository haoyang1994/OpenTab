(function (global) {
  // One live set of buttons, from the collapsed stack to the inline rail.
  // Search owns order, selection, persistence, query text and navigation.
  function create({ host, panel, input, getLabel, onSelect, onOpen }) {
    if (!host || !panel) return null;
    let expanded = false;
    let current = '';
    let rememberedSelection = null;
    let focusId = '';
    const buttons = () => Array.from(panel.querySelectorAll('.engine-btn'));
    const activeButton = () => buttons().find((button) => button.dataset.engine === current) || buttons()[0];
    const unchangedKey = (event) => event.defaultPrevented || event.isComposing ||
      event.key === 'Process' || event.keyCode === 229 || event.which === 229 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

    function setTabStop(id) {
      focusId = id;
      const active = activeButton();
      buttons().forEach((button) => {
        const selected = button === active;
        button.inert = !expanded && !selected;
        button.setAttribute('aria-hidden', !expanded && !selected ? 'true' : 'false');
        button.tabIndex = (expanded ? button.dataset.engine === id : selected) ? 0 : -1;
        if (selected) button.setAttribute('aria-expanded', String(expanded));
        else button.removeAttribute('aria-expanded');
      });
    }

    function revealButton(button) {
      if (!expanded || !button) return;
      // Scroll only this rail, never the page or its other scroll containers.
      const rail = panel.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      if (rect.left < rail.left + 2) panel.scrollLeft -= rail.left + 2 - rect.left;
      else if (rect.right > rail.right - 2) panel.scrollLeft += rect.right - rail.right + 2;
    }

    function focusButton(id) {
      const button = buttons().find((item) => item.dataset.engine === id) || activeButton();
      if (!button) return;
      setTabStop(button.dataset.engine);
      button.focus({ preventScroll: true });
      revealButton(button);
    }

    function close({ restoreFocus = false } = {}) {
      if (!expanded) return;
      expanded = false;
      host.classList.remove('engine-deck-open');
      host.dataset.expanded = 'false';
      panel.scrollLeft = 0;
      setTabStop(current);
      rememberedSelection = null;
      if (restoreFocus) activeButton()?.focus({ preventScroll: true });
    }

    function open(id = current) {
      if (!expanded) {
        rememberedSelection = input ? {
          value: input.value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection
        } : null;
        expanded = true;
        onOpen?.();
        host.dataset.expanded = 'true';
        host.classList.add('engine-deck-open');
      }
      focusButton(id);
    }

    function choose(id) {
      const selection = rememberedSelection;
      close();
      onSelect(id);
      // Never apply the snapshot to a newer query.
      if (input && selection && selection.value === input.value && selection.start !== null) {
        input.setSelectionRange(selection.start, selection.end, selection.direction || 'none');
      }
    }

    function render(id) {
      current = id;
      const hadFocus = panel.contains(document.activeElement);
      const list = buttons();
      const active = activeButton();
      let back = 0;
      host.style.setProperty('--engine-rail-width', `${Math.max(60, list.length * 44 + 4)}px`);
      list.forEach((button, index) => {
        const selected = button === active;
        const label = getLabel(button.dataset.engine);
        // Do not wrap, clone or replace original SVGs/custom initials.
        button.title = label;
        button.setAttribute('aria-label', label);
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.style.setProperty('--engine-x', `${index * 44}px`);
        button.style.setProperty('--engine-stack-x', `${selected ? 0 : Math.min(++back, 2) * 6}px`);
        button.style.setProperty('--engine-layer', selected ? String(list.length + 1) : String(list.length - index));
      });
      host.dataset.engine = active?.dataset.engine || '';
      const nextFocus = list.some((button) => button.dataset.engine === focusId) ? focusId : current;
      setTabStop(nextFocus);
      if (expanded && hadFocus) focusButton(nextFocus);
    }

    panel.addEventListener('click', (event) => {
      const button = event.target.closest('.engine-btn');
      if (event.defaultPrevented || !button || !panel.contains(button) || button.inert) return;
      if (expanded) choose(button.dataset.engine);
      else if (button === activeButton()) open();
    });
    host.addEventListener('click', (event) => {
      // The visible back edges are part of the same collapsed stack. Inert
      // background buttons retarget pointer events to the rail, not themselves.
      if (!expanded && !event.defaultPrevented && event.target === panel) open();
    });
    panel.addEventListener('keydown', (event) => {
      if (unchangedKey(event)) return;
      const list = buttons();
      const index = list.indexOf(event.target.closest('.engine-btn'));
      if (index < 0) return;
      const key = event.key;
      if (!expanded) {
        if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        open(key === 'Home' ? list[0]?.dataset.engine : key === 'End' ? list.at(-1)?.dataset.engine : current);
        return;
      }
      let next;
      if (key === 'Home') next = 0;
      else if (key === 'End') next = list.length - 1;
      else if (key === 'ArrowRight' || key === 'ArrowDown') next = (index + 1) % list.length;
      else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
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
    // The chosen button can move during expansion. Reveal the final position,
    // including after a rapid reversal; stale transition events cannot reopen.
    host.addEventListener('transitionend', () => {
      if (expanded && panel.contains(document.activeElement)) revealButton(document.activeElement);
    });
    const revealFocused = () => {
      if (expanded && panel.contains(document.activeElement)) revealButton(document.activeElement);
    };
    global.addEventListener('resize', revealFocused);
    global.visualViewport?.addEventListener('resize', revealFocused);
    if (global.MutationObserver) {
      new global.MutationObserver(() => {
        if (document.body.classList.contains('minimal-mode') || document.body.classList.contains('zen-mode')) close();
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    host.dataset.expanded = 'false';
    panel.inert = false;
    panel.removeAttribute('aria-hidden');
    setTabStop('');
    return { render, close, isOpen: () => expanded };
  }
  global.OpenTabEngineDeck = { create };
})(window);
