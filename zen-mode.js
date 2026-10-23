(function(root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = value => root.OpenTabI18n ? root.OpenTabI18n.t(value) : value;
  let host, active = false, saved, fullscreenOwner = false, fullscreenRequest = null;
  const fullscreenTarget = () => document.documentElement;
  function leaveOwnedFullscreen() {
    if (!fullscreenOwner || document.fullscreenElement !== fullscreenTarget()) return;
    fullscreenOwner = false;
    try { Promise.resolve(document.exitFullscreen?.()).catch(() => {}); } catch (_) { /* Browser controls remain available. */ }
  }
  function render(value) {
    const panel = $('zen-mode');
    panel.dataset.phase = value.phase;
    $('zen-time').textContent = root.OpenTabClockDeck.formatRemaining(value.remaining);
    const label = value.phase === 'running' ? '暂停' : value.phase === 'paused' ? '继续专注' : value.phase === 'done' ? '再专注一次' : '开始专注';
    $('zen-focus-toggle').setAttribute('aria-label', t(label));
    $('zen-focus-reset').disabled = value.phase === 'idle';
    const status = value.phase === 'running' ? '专注中' : value.phase === 'paused' ? '已暂停' : value.phase === 'done' ? '已完成' : '';
    if ($('zen-status').textContent !== t(status)) $('zen-status').textContent = t(status);
  }
  function enter() {
    if (active || !host?.focus) return false;
    const input = $('search-input'), video = $('background-video');
    saved = { focus: document.activeElement, query: input?.value, start: input?.selectionStart, end: input?.selectionEnd, direction: input?.selectionDirection,
      nodes: [...document.body.children].filter(node => node !== $('zen-mode') && node.tagName !== 'SCRIPT').map(node => [node, node.inert]),
      videoPlaying: video && !video.paused };
    active = true;
    $('zen-mode').hidden = false;
    document.body.classList.add('zen-mode');
    $('zen-toggle-btn').setAttribute('aria-expanded', 'true');
    // Keep this request in the originating click stack: no await, timer, or
    // promise callback may precede the browser's user-activation boundary.
    if (!document.fullscreenElement && !fullscreenRequest && fullscreenTarget().requestFullscreen) {
      // Only one browser request may be outstanding across quick exit/re-entry.
      // A late success is still ours and must be unwound if Zen has closed.
      const request = {};
      fullscreenRequest = request;
      try {
        Promise.resolve(fullscreenTarget().requestFullscreen()).then(() => {
          if (fullscreenRequest === request) fullscreenRequest = null;
          fullscreenOwner = document.fullscreenElement === fullscreenTarget();
          if (!active) leaveOwnedFullscreen();
        }, () => { if (fullscreenRequest === request) fullscreenRequest = null; });
      } catch (_) { fullscreenRequest = null; }
    }
    host.closePopovers?.();
    saved.nodes.forEach(([node]) => { node.inert = true; });
    if (saved.videoPlaying) video.pause();
    host.onActiveChange?.(true);
    render(host.focus.snapshot());
    $('zen-focus-toggle').focus({ preventScroll: true });
    return true;
  }
  function exit() {
    if (!active) return false;
    active = false;
    $('zen-mode').hidden = true;
    document.body.classList.remove('zen-mode');
    $('zen-toggle-btn').setAttribute('aria-expanded', 'false');
    leaveOwnedFullscreen();
    saved.nodes.forEach(([node, inert]) => { node.inert = node.id === 'homepage' && host.canRestoreHome ? !host.canRestoreHome() : inert; });
    const input = $('search-input');
    if (input && input.value === saved.query && Number.isInteger(saved.start)) input.setSelectionRange(saved.start, saved.end, saved.direction);
    host.onActiveChange?.(false);
    if (saved.videoPlaying) { try { Promise.resolve($('background-video').play()).catch(() => {}); } catch (_) {} }
    const target = saved.focus?.isConnected && !saved.focus.closest('[inert]') ? saved.focus : $('zen-toggle-btn');
    target?.focus({ preventScroll: true });
    return true;
  }
  function keydown(event) {
    if (!active) return;
    event.stopImmediatePropagation();
    // Never prevent Escape: the browser owns leaving fullscreen. Zen stays.
    if (event.key === 'Escape' || event.isComposing || event.keyCode === 229) return;
    const controls = [...$('zen-mode').querySelectorAll('button')].filter(button => !button.disabled);
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const index = controls.indexOf(document.activeElement);
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat && controls.includes(document.activeElement)) document.activeElement.click();
    }
  }
  function init(options) {
    if (host || !options?.focus || !$('zen-mode')) return;
    host = options;
    host.focus.subscribe(render);
    $('zen-toggle-btn').addEventListener('click', enter);
    $('zen-exit').addEventListener('click', exit);
    $('zen-focus-toggle').addEventListener('click', () => host.focus.toggle());
    $('zen-focus-reset').addEventListener('click', () => host.focus.reset());
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) fullscreenOwner = false; });
    root.addEventListener('keydown', keydown, true);
    root.addEventListener('keyup', event => { if (active) event.stopImmediatePropagation(); }, true);
    root.addEventListener('focusin', event => { if (active && !$('zen-mode').contains(event.target)) $('zen-focus-toggle').focus({ preventScroll: true }); }, true);
  }
  root.OpenTabZenMode = { init, enter, exit, isActive: () => active };
})(globalThis);
