// Only extension-packaged modules register executable renderers. JSON defines data, never code.
(function (g) {
  'use strict';
  const M = g.OpenTabWidgetModel;
  const register = (kind, title, render, edit) => M.registerRenderer(kind, {
    title, sizes: M.SIZES, customSizes: true, defaults: M.BUILTINS.find(item => item.kind === kind)?.defaults ?? {},
    validate: (value, def) => M.validateData(kind, value, def), render, edit,
    cleanup: disposable => { if (typeof disposable === 'function') disposable(); }
  });
  register('note', '便笺', c => { c.body.append(c.el('p', c.data.text || c.t('写下你的想法'), 'widget-note')); }, c => {
    const input = c.field('内容', c.data.text, 'textarea', { maxLength: 8000 });
    return () => ({ text: input.value });
  });
  register('checklist', '清单', c => {
    if (!c.data.items.length) c.body.append(c.el('p', c.t('在设置中添加事项')));
    c.data.items.forEach(item => {
      const row = c.el('div', undefined, 'widget-check-row'), input = c.el('input'), label = c.el('label', item.text);
      input.type = 'checkbox'; input.id = `check-${c.id}-${item.id}`; input.checked = item.done; label.htmlFor = input.id;
      input.addEventListener('change', () => c.save({ items: c.data.items.map(old => old.id === item.id ? { ...old, done: input.checked } : old) }, input.id));
      row.append(input, label); c.body.append(row);
    });
  }, c => {
    const rows = [];
    const list = c.el('div'); c.form.append(list);
    const addButton = c.button('添加事项', () => { if (rows.length < 40) { add({ id: crypto.randomUUID(), text: '', done: false }); rows.at(-1).text.focus(); } });
    const syncAdd = () => { addButton.dataset.unavailable = String(rows.length >= 40); addButton.disabled = rows.length >= 40; };
    const add = value => {
      const row = c.el('div', undefined, 'widget-editor-row'); list.append(row);
      const text = c.field('事项', value.text, 'text', { maxLength: 500, required: true }, row);
      const done = c.field('已完成', '', 'checkbox', {}, row); done.checked = value.done;
      const entry = { id: value.id, text, done, row }; rows.push(entry);
      row.append(c.button('删除事项', () => { const index = rows.indexOf(entry); row.remove(); rows.splice(index, 1); syncAdd(); (rows[index]?.text || rows[index - 1]?.text || addButton).focus(); }));
      text.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (text.value.trim()) addButton.click(); } });
      syncAdd();
    };
    c.data.items.forEach(add);
    c.form.append(addButton); syncAdd();
    return () => ({ items: rows.map(row => ({ id: row.id, text: row.text.value, done: row.done.checked })) });
  });
  register('links', '常用链接', c => {
    const list = c.el('ul');
    c.data.links.forEach(link => { const row = c.el('li'), anchor = c.el('a', link.label); anchor.href = M.url(link.url); anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; row.append(anchor); list.append(row); });
    c.body.append(list); if (!c.data.links.length) c.body.append(c.el('p', c.t('在设置中添加链接')));
  }, c => {
    const rows = [], list = c.el('div'); c.form.append(list);
    const addButton = c.button('添加链接', () => { if (rows.length < 40) { add({ label: '', url: '' }); rows.at(-1).label.focus(); } });
    const syncAdd = () => { addButton.dataset.unavailable = String(rows.length >= 40); addButton.disabled = rows.length >= 40; };
    const add = value => {
      const row = c.el('div', undefined, 'widget-editor-row'); list.append(row);
      const label = c.field('链接名称', value.label, 'text', { maxLength: 120, required: true }, row);
      const url = c.field('网址', value.url, 'url', { maxLength: 2048, required: true }, row);
      const entry = { row, label, url }; rows.push(entry);
      row.append(c.button('删除链接', () => { const index = rows.indexOf(entry); row.remove(); rows.splice(index, 1); syncAdd(); (rows[index]?.label || rows[index - 1]?.label || addButton).focus(); })); syncAdd();
    };
    c.data.links.forEach(add); c.form.append(addButton); syncAdd();
    return () => ({ links: rows.map(row => ({ label: row.label.value, url: row.url.value })) });
  });
  register('countdown', '倒计日', c => {
    const output = c.el('p', '', 'widget-countdown'); c.body.append(output, c.el('p', c.data.label));
    const tick = () => { const days = M.daysUntil(c.data.date); output.textContent = days === null ? c.t('请选择目标日期') : days >= 0 ? c.t('还有 {days} 天', { days }) : c.t('已过 {days} 天', { days: -days }); };
    tick(); const timer = setInterval(tick, 60000); return () => clearInterval(timer);
  }, c => {
    const label = c.field('事项', c.data.label, 'text', { maxLength: 120 });
    const date = c.field('目标日期', c.data.date, 'date', { min: '0001-01-01', max: '9999-12-31' });
    return () => ({ label: label.value, date: date.value });
  });
  register('clock', '时钟', c => {
    const output = c.el('time', '', 'widget-clock'); c.body.append(output);
    const tick = () => { const now = new Date(); output.dateTime = now.toISOString(); output.textContent = new Intl.DateTimeFormat(document.documentElement.lang || 'zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: c.data.hour12, ...(c.data.timezone ? { timeZone: c.data.timezone } : {}) }).format(now); };
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, c => {
    const zone = c.field('时区（留空使用系统时区）', c.data.timezone, 'text', { maxLength: 80 });
    const hour12 = c.field('十二小时制', '', 'checkbox'); hour12.checked = c.data.hour12;
    return () => ({ timezone: zone.value.trim(), hour12: hour12.checked });
  });
  register('composite', '组合组件', c => {
    c.def.blocks.forEach(block => {
      const value = c.data[block.field], row = c.el('div', undefined, `widget-block widget-block-${block.type}`);
      if (block.label) row.append(c.el('span', block.label, 'widget-block-label'));
      if (block.type === 'list') { const list = c.el('ul'); value.forEach(text => list.append(c.el('li', text))); row.append(list); }
      else if (block.type === 'progress') { const progress = c.el('progress'); progress.max = 100; progress.value = value; progress.setAttribute('aria-label', block.label || c.def.fields.find(field => field.key === block.field).label); row.append(progress, c.el('span', `${value}%`)); }
      else if (block.type === 'link') { if (value.url) { const link = c.el('a', value.label || value.url); link.href = M.url(value.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); } }
      else { const node = c.el(block.type === 'date' ? 'time' : 'span', String(value)); if (block.type === 'date' && value) node.dateTime = value; row.append(node); }
      c.body.append(row);
    });
  }, c => {
    const readers = c.def.fields.map(field => {
      const value = c.data[field.key];
      if (field.type === 'link') {
        const label = c.field(field.label, value.label, 'text', { maxLength: 120 });
        const url = c.field('网址', value.url, 'url', { maxLength: 2048 });
        return () => [field.key, { label: label.value, url: url.value }];
      }
      const input = c.field(field.label, field.type === 'list' ? value.join('\n') : value,
        ['number', 'progress'].includes(field.type) ? 'number' : field.type === 'date' ? 'date' : 'textarea',
        field.type === 'progress' ? { min: 0, max: 100, step: 'any', required: true } : field.type === 'number' ? { step: 'any', required: true } : field.type === 'date' ? { min: '0001-01-01', max: '9999-12-31' } : { maxLength: field.type === 'list' ? 21000 : 8000 });
      return () => [field.key, field.type === 'list' ? input.value.split('\n').filter(Boolean) : ['number', 'progress'].includes(field.type) ? Number(input.value) : input.value];
    });
    return () => Object.fromEntries(readers.map(read => read()));
  });
})(globalThis);
