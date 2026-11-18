(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenTabWidgetModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'widgetWorkspace';
  const ADD_TILE = 'add-tile';
  const KINDS = ['note', 'checklist', 'links', 'countdown', 'clock'];
  const renderers = new Map();
  const SIZES = [[1, 1], [2, 1], [1, 2], [2, 2], [4, 2]];
  const BUILTINS = KINDS.map(kind => ({ id: `builtin.${kind}`, kind, title: kind, size: { w: 2, h: kind === 'clock' ? 1 : 2 }, defaults: data(kind, {}) }));
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function fail() { throw new TypeError('INVALID_WIDGET_DATA'); }
  function object(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();
  }
  function str(value, max = 120, empty = false) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail();
    return value;
  }
  function int(value, min, max) { if (!Number.isInteger(value) || value < min || value > max) fail(); return value; }
  function url(value) {
    str(value, 2048);
    let parsed; try { parsed = new URL(value); } catch (_) { fail(); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) fail();
    return parsed.href;
  }
  function date(value) {
    if (value === '') return value;
    str(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000'
      || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail();
    return value;
  }
  function data(kind, raw, def) {
    const renderer = renderers.get(kind);
    return renderer ? renderer.validate(copy(raw), def) : validateData(kind, raw, def);
  }
  function validateData(kind, raw, def) {
    if (kind === 'composite') return compositeData(def, raw);
    // Unknown local types are retained as inert, recoverable data.
    if (!KINDS.includes(kind)) { object(raw, Object.keys(raw || {})); return copy(raw); }
    if (kind === 'clock') {
      object(raw, ['timezone', 'hour12']);
      const timezone = str(raw.timezone ?? '', 80, true);
      try { new Intl.DateTimeFormat('en', timezone ? { timeZone: timezone } : {}).format(); } catch (_) { fail(); }
      if (raw.hour12 !== undefined && typeof raw.hour12 !== 'boolean') fail();
      return { timezone, hour12: raw.hour12 ?? false };
    }
    if (kind === 'note') { object(raw, ['text']); return { text: str(raw.text ?? '', 8000, true) }; }
    if (kind === 'countdown') {
      object(raw, ['date', 'label']);
      return { date: date(raw.date ?? ''), label: str(raw.label ?? '', 120, true) };
    }
    const key = kind === 'links' ? 'links' : 'items';
    object(raw, [key]);
    const list = raw[key] ?? [];
    if (!Array.isArray(list) || list.length > 40) fail();
    const ids = new Set();
    return { [key]: list.map(item => {
      if (kind === 'links') { object(item, ['label', 'url']); return { label: str(item.label), url: url(item.url) }; }
      object(item, ['id', 'text', 'done']);
      str(item.id, 80); if (ids.has(item.id) || typeof item.done !== 'boolean') fail(); ids.add(item.id);
      return { id: item.id, text: str(item.text, 500), done: item.done };
    }) };
  }
  function definition(raw) {
    object(raw, ['id', 'title', 'kind', 'size', 'defaults', 'fields', 'blocks']);
    const id = str(raw.id, 64);
    if (!/^[a-z][a-z0-9.-]*$/.test(id) || id.startsWith('builtin.')) fail();
    object(raw.size ?? {}, ['w', 'h']);
    const def = { id, title: str(raw.title, 80), kind: str(raw.kind, 64),
      size: { w: int(raw.size?.w ?? 2, 1, 12), h: int(raw.size?.h ?? 2, 1, 12) } };
    const renderer = renderers.get(def.kind);
    if (renderer && !renderer.customSizes && !renderer.sizes.some(([w, h]) => w === def.size.w && h === def.size.h)) fail();
    if (def.kind === 'composite') {
      if (!Array.isArray(raw.fields) || !raw.fields.length || raw.fields.length > 24 || !Array.isArray(raw.blocks) || !raw.blocks.length || raw.blocks.length > 32) fail();
      const ids = new Set();
      def.fields = raw.fields.map(field => {
        object(field, ['key', 'label', 'type']);
        const key = str(field.key, 40);
        if (!/^[a-z][a-zA-Z0-9_]*$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || ids.has(key)
          || !['text', 'number', 'list', 'date', 'progress', 'link'].includes(field.type)) fail();
        ids.add(key); return { key, label: str(field.label, 80), type: field.type };
      });
      def.blocks = raw.blocks.map(block => {
        object(block, ['type', 'field', 'label']);
        if (!['text', 'number', 'list', 'date', 'progress', 'link'].includes(block.type) || !ids.has(block.field)
          || def.fields.find(field => field.key === block.field).type !== block.type) fail();
        return { type: block.type, field: block.field, label: str(block.label ?? '', 80, true) };
      });
    } else if (raw.fields !== undefined || raw.blocks !== undefined) fail();
    def.defaults = data(def.kind, raw.defaults ?? {}, def);
    return def;
  }
  function compositeData(def, raw) {
    object(raw, def.fields.map(field => field.key));
    return Object.fromEntries(def.fields.map(field => {
      let value = Object.hasOwn(raw, field.key) ? raw[field.key] : undefined;
      if (['number', 'progress'].includes(field.type)) {
        value ??= 0;
        if (typeof value !== 'number' || !Number.isFinite(value) || (field.type === 'progress' && (value < 0 || value > 100))) fail();
      } else if (field.type === 'list') {
        value ??= []; if (!Array.isArray(value) || value.length > 40) fail(); value = value.map(item => str(item, 500, true));
      } else if (field.type === 'link') {
        value ??= { label: '', url: '' }; object(value, ['label', 'url']);
        value = { label: str(value.label ?? '', 120, true), url: value.url ? url(value.url) : '' };
      } else value = field.type === 'date' ? date(value ?? '') : str(value ?? '', 8000, true);
      return [field.key, value];
    }));
  }
  // Trusted, packaged code only. Register before Widgets.ready; user JSON cannot call this.
  function registerRenderer(kind, renderer) {
    str(kind, 58); // `local.` plus kind must fit the persisted 64-character type ID.
    if (!/^[a-z][a-z0-9-]*$/.test(kind) || renderers.has(kind) || !renderer || !['validate', 'render', 'edit', 'cleanup'].every(key => typeof renderer[key] === 'function')
      || !Array.isArray(renderer.sizes) || !renderer.sizes.length || renderer.sizes.some(size => !Array.isArray(size) || size.length !== 2 || size.some(value => !Number.isInteger(value) || value < 1 || value > 12))) fail();
    let local;
    if (!KINDS.includes(kind) && kind !== 'composite') {
      const size = renderer.size ?? { w: 2, h: 2 };
      object(size, ['w', 'h']); int(size.w, 1, 12); int(size.h, 1, 12);
      if (!renderer.customSizes && !renderer.sizes.some(([w, h]) => w === size.w && h === size.h)) fail();
      local = { id: `local.${kind}`, kind, title: str(renderer.title, 80), size: copy(size), defaults: renderer.validate(copy(renderer.defaults ?? {})) };
    }
    renderers.set(kind, Object.freeze({ ...renderer }));
    if (local) BUILTINS.push(local);
  }
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // Deterministic, nonmutating viewport projection. Desktop moves use moveLayout;
  // saved sizes/positions never come from a narrow projection.
  function arrange(widgets, columns = 6, priority) {
    int(columns, 1, 12);
    const ordered = widgets.slice().sort((a, b) => (b.id === priority) - (a.id === priority));
    const placed = [];
    for (const source of ordered) {
      const item = { ...source, w: Math.min(source.w, columns), x: Math.max(0, Math.min(source.x, columns - Math.min(source.w, columns))) };
      if (placed.some(other => overlap(item, other))) {
        let found = false;
        for (let step = 0; step < 512 && !found; step++) {
          const y = (source.y + step) % 512;
          for (let x = 0; x <= columns - item.w; x++) {
            if (!placed.some(other => overlap({ ...item, x, y }, other))) { item.x = x; item.y = y; found = true; break; }
          }
        }
        if (!found) fail();
      }
      placed.push(item);
    }
    return widgets.map(item => placed.find(other => other.id === item.id));
  }
  function parse(raw) {
    if (raw === undefined) return { version: 2, definitions: [], widgets: [], pages: [] };
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 256000) fail();
    let value; try { value = JSON.parse(raw); } catch (_) { fail(); }
    object(value, ['version', 'definitions', 'widgets', 'pages']);
    if (![1, 2].includes(value.version) || !Array.isArray(value.definitions) || value.definitions.length > 24
      || !Array.isArray(value.widgets) || value.widgets.length > 128) fail();
    const definitions = value.definitions.map(definition), types = new Map(BUILTINS.concat(definitions).map(item => [item.id, item]));
    if (types.size !== BUILTINS.length + definitions.length) fail();
    const ids = new Set();
    const widgets = value.widgets.map(item => {
      object(item, ['id', 'type', 'x', 'y', 'w', 'h', 'data', 'groupId']);
      str(item.id, 80); str(item.type, 64); if (ids.has(item.id)) fail(); ids.add(item.id);
      const max = value.version === 1 ? 6 : 12, w = int(item.w, 1, max), def = types.get(item.type);
      return { id: item.id, type: item.type, groupId: value.version === 1 ? 'folder-home' : str(item.groupId, 120), x: int(item.x, 0, max - w), y: int(item.y, 0, 511), w,
        h: int(item.h, 1, max), data: def ? data(def.kind, item.data, def) : data('unknown', item.data) };
    });
    if (widgets.some((item, i) => widgets.slice(i + 1).some(other => item.groupId === other.groupId && overlap(item, other)))) fail();
    const pages = value.version === 1 ? [{ groupId: 'folder-home', columns: 6, icons: [] }] : (value.pages ?? []);
    if (!Array.isArray(pages) || pages.length > 512) fail();
    const groups = new Set();
    for (const page of pages) {
      object(page, ['groupId', 'columns', 'icons', 'addTile']); str(page.groupId, 120); int(page.columns, 1, 12);
      if (groups.has(page.groupId) || !Array.isArray(page.icons) || page.icons.length > 4096) fail(); groups.add(page.groupId);
      if (page.addTile !== undefined) {
        object(page.addTile, ['x', 'y']);
        int(page.addTile.x, 0, page.columns - 1); int(page.addTile.y, 0, 511);
      }
      const refs = new Set();
      page.icons.forEach(icon => { object(icon, ['id', 'x', 'y']); str(icon.id, 120); int(icon.x, 0, page.columns - 1); int(icon.y, 0, 511); if (refs.has(icon.id)) fail(); refs.add(icon.id); });
      if (widgets.some(item => item.groupId === page.groupId && item.x + item.w > page.columns)) fail();
    }
    return { version: 2, definitions, widgets, pages: copy(pages) };
  }
  // Stable placements keep holes. Only missing/new references are placed; site array order never changes.
  function desktop(value, groupId, icons, columns = 6, compact = false) {
    const page = value.pages.find(item => item.groupId === groupId);
    columns = page?.columns ?? Math.max(columns, ...value.widgets.filter(item => item.groupId === groupId).map(item => item.x + item.w));
    const placed = value.widgets.filter(item => item.groupId === groupId).map(item => ({ ...copy(item), id: `w:${item.id}` }));
    if (page?.addTile) {
      const entry = { id: ADD_TILE, ...page.addTile, w: 1, h: 1 };
      if (placed.some(item => overlap(item, entry))) Object.assign(entry, free(placed, 1, 1, columns));
      placed.push(entry);
    }
    const visible = icons.filter(item => (item.folderId || 'folder-home') === groupId && !item.parentId);
    const unplaced = [];
    // Reserve every existing valid slot before fitting new icons into the holes.
    for (const icon of visible) {
      const slot = page?.icons.find(item => item.id === icon.id);
      const entry = { id: `i:${icon.id}`, x: slot?.x ?? 0, y: slot?.y ?? 0, w: 1, h: 1 };
      if (slot && !placed.some(item => overlap(entry, item))) placed.push(entry);
      else unplaced.push(entry);
    }
    for (const entry of unplaced) { Object.assign(entry, free(placed, 1, 1, columns)); placed.push(entry); }
    if (compact) {
      const packed = [];
      for (const entry of placed.sort((a, b) => a.y - b.y || a.x - b.x)) packed.push({ ...entry, ...free(packed, entry.w, entry.h, columns) });
      return { columns, entries: packed };
    }
    return { columns, entries: placed };
  }
  function free(entries, w, h, columns) {
    int(w, 1, 12); int(h, 1, 12); int(columns, 1, 12);
    if (w > columns) fail();
    for (let y = 0; y < 512; y++) for (let x = 0; x <= columns - w; x++) if (!entries.some(item => overlap({ x, y, w, h }, item))) return { x, y };
    fail();
  }
  function reorderIcons(layout, id, targetId, after = false) {
    const next = copy(layout), icons = next.entries.filter(entry => entry.id.startsWith('i:')).sort((a, b) => a.y - b.y || a.x - b.x);
    const moving = icons.find(entry => entry.id === id), target = icons.find(entry => entry.id === targetId);
    if (!moving || !target) fail();
    if (id === targetId) return next;
    const slots = icons.map(({ x, y }) => ({ x, y })), ordered = icons.filter(entry => entry !== moving);
    ordered.splice(ordered.indexOf(target) + (after ? 1 : 0), 0, moving);
    ordered.forEach((entry, index) => Object.assign(entry, slots[index]));
    return next;
  }
  // One pure plan drives pointer previews, keyboard movement and the commit.
  // Only colliding items move; row masks keep dense desktop previews inexpensive.
  function moveLayout(layout, id, patch) {
    const next = copy(layout), moving = next.entries.find(entry => entry.id === id);
    int(next.columns, 1, 12); if (!moving) fail(); Object.assign(moving, patch);
    int(moving.w, 1, next.columns); int(moving.h, 1, 12);
    int(moving.x, 0, next.columns - moving.w); int(moving.y, 0, 511);
    const displaced = [], fixed = [moving];
    for (const entry of next.entries) if (entry !== moving) (overlap(entry, moving) ? displaced : fixed).push(entry);
    const fill = (anchors, queue) => {
      const rows = new Uint16Array(524);
      const occupy = entry => { const mask = ((1 << entry.w) - 1) << entry.x; for (let y = entry.y; y < entry.y + entry.h; y++) rows[y] |= mask; };
      anchors.forEach(occupy);
      const fits = (entry, x, y) => { const mask = ((1 << entry.w) - 1) << x; for (let row = y; row < y + entry.h; row++) if (rows[row] & mask) return false; return true; };
      for (const entry of queue) {
        let point;
        // Manhattan rings choose the nearest vacancy, including the grab's old slot.
        for (let distance = 0; distance <= 32 && !point; distance++) {
          for (let y = Math.max(0, entry.y - distance); y <= Math.min(511, entry.y + distance) && !point; y++) {
            const dx = distance - Math.abs(y - entry.y);
            for (const x of dx ? [entry.x - dx, entry.x + dx] : [entry.x]) {
              if (x >= 0 && x + entry.w <= next.columns && fits(entry, x, y)) { point = { x, y }; break; }
            }
          }
        }
        if (!point) {
          let nearest = Infinity;
          for (let y = 0; y <= 511; y++) for (let x = 0; x <= next.columns - entry.w; x++) {
            const distance = Math.abs(x - entry.x) + Math.abs(y - entry.y);
            if (distance < nearest && fits(entry, x, y)) { nearest = distance; point = { x, y }; }
          }
        }
        if (!point) return false;
        Object.assign(entry, point); occupy(entry);
      }
      return true;
    };
    const order = (a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
    if (!fill(fixed, displaced.slice().sort(order))) {
      // A fully fragmented desktop may require a wider local rearrangement.
      // Rebuild from the original snapshot; never leak a half-finished plan.
      const reset = copy(layout).entries.filter(entry => entry.id !== id).sort(order);
      if (!fill([moving], reset)) fail();
      for (const entry of reset) Object.assign(next.entries.find(item => item.id === entry.id), { x: entry.x, y: entry.y });
    }
    return next;
  }
  function saveDesktop(value, groupId, layout) {
    const page = { groupId, columns: layout.columns, icons: [] };
    for (const entry of layout.entries) {
      if (entry.id === ADD_TILE) page.addTile = { x: entry.x, y: entry.y };
      else if (entry.id.startsWith('i:')) page.icons.push({ id: entry.id.slice(2), x: entry.x, y: entry.y });
      else Object.assign(value.widgets.find(item => item.id === entry.id.slice(2)), { x: entry.x, y: entry.y, w: entry.w, h: entry.h });
    }
    value.pages = value.pages.filter(item => item.groupId !== groupId).concat(page);
  }
  function removeGroup(value, groupId, targetId, icons = []) {
    if (targetId) {
      const moving = value.widgets.filter(item => item.groupId === groupId);
      const layout = desktop(value, targetId, icons);
      layout.columns = Math.max(layout.columns, ...moving.map(item => item.w));
      for (const widget of moving) {
        Object.assign(widget, free(layout.entries, widget.w, widget.h, layout.columns), { groupId: targetId });
        layout.entries.push({ ...widget, id: `w:${widget.id}` });
      }
      saveDesktop(value, targetId, layout);
    } else value.widgets = value.widgets.filter(item => item.groupId !== groupId);
    value.pages = value.pages.filter(item => item.groupId !== groupId);
    return value;
  }
  function serialize(value) { const raw = JSON.stringify(value); parse(raw); return raw; }
  function daysUntil(target, now = new Date()) {
    date(target);
    if (!target) return null;
    // Calendar days in the device's local timezone, independent of DST day length.
    return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  }
  return Object.freeze({ KEY, ADD_TILE, KINDS, BUILTINS, SIZES, copy, definition, data, validateData, parse, serialize, arrange, overlap, url, daysUntil,
    registerRenderer, renderer: kind => renderers.get(kind), desktop, free, reorderIcons, moveLayout, saveDesktop, removeGroup });
});
