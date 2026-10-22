import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync(new URL('../home.css', import.meta.url), 'utf8');
const rule = selector => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return css.slice(start, css.indexOf('}', start));
};
const rgba = value => {
  if (value.startsWith('#')) return [...value.slice(1).match(/../g).map(n => parseInt(n, 16)), 1];
  return value.match(/[\d.]+/g).map(Number);
};
const token = (block, name) => rgba(block.match(new RegExp(`--${name}:\\s*([^;]+);`))[1]);
const over = (a, b) => a.slice(0, 3).map((n, i) => n * (a[3] ?? 1) + b[i] * (1 - (a[3] ?? 1)));
const lum = c => c.slice(0, 3).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((v, n, i) => v + n * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
assert.match(rule('.group-tab,\n.group-add-btn'), /background: var\(--panel-bg\)/);
assert.match(rule('.group-tab.active'), /var\(--panel-bg-solid\)/);
assert.match(rule('.calendar-popover'), /background: var\(--panel-bg-solid\)/);
assert.ok(Number(rule('#clock-widget:has(.calendar-popover:not(.hidden))').match(/z-index: (\d+)/)[1]) > Number(rule('.group-tabs-bar').match(/z-index: (\d+)/)[1]), 'open calendar stacking context exceeds group context');
const results = [];
for (const theme of [':root', 'body.theme-light']) {
  const root = rule(theme), calendar = rule(theme === ':root' ? '.calendar-popover' : 'body.theme-light .calendar-popover');
  const panel = token(root, 'panel-bg-solid');
  const pairs = [['calendar hint', token(root, 'text-hint'), panel], ['holiday', token(calendar, 'calendar-holiday'), panel], ['term', token(calendar, 'calendar-term'), panel], ['selected date/annotation', token(calendar, 'calendar-selected-text'), token(calendar, 'calendar-selected-bg')]];
  for (const backdrop of [[0, 0, 0], [255, 255, 255]]) pairs.push(['group', token(root, 'text-primary'), over(token(root, 'panel-bg'), backdrop)]);
  for (const [name, fg, bg] of pairs) {
    const ratio = contrast(fg, bg); assert.ok(ratio >= 4.5, `${theme} ${name}: ${ratio}`); results.push(ratio);
  }
}
console.log(`Wallpaper readability CSS: all sampled text pairs >= ${Math.min(...results).toFixed(2)}:1 (alpha composited over black/white, no blur credit)`);

// The final navigation overrides supersede the original glass tokens. Counts
// use their own opaque pair rather than inheriting an active/hover foreground
// over a translucent badge, which previously fell below 4.5:1 in dark mode.
const lastRule = selector => {
  const start = css.lastIndexOf(`${selector} {`);
  assert.ok(start >= 0);
  return css.slice(start, css.indexOf('}', start));
};
assert.match(lastRule('.group-tab-count'), /background: var\(--nav-surface\); color: var\(--nav-text\)/);
for (const theme of [':root', 'body.theme-light']) {
  const values = lastRule(theme);
  for (const [name, foreground, background] of [
    ['inactive/count/shortcut badge', 'nav-text', 'nav-surface'],
    ['hover', 'nav-text', 'nav-hover'],
    ['selected', 'nav-selected-text', 'nav-selected'],
    ['form label/cancel', 'form-text', 'form-surface'],
    ['form hint', 'form-muted', 'form-surface'],
    ['field hint/placeholder', 'form-muted', 'form-field']
  ]) {
    const ratio = contrast(token(values, foreground), token(values, background));
    assert.ok(ratio >= 4.5, `${theme} final ${name}: ${ratio}`);
  }
}
console.log('Final slate navigation/count and form token pairs meet 4.5:1 in both themes.');

assert.match(rule('#add-icon-modal .modal-content'), /--text-hint: var\(--form-muted\)/);
assert.match(lastRule('#add-icon-modal #cancel-btn'), /background: transparent; color: var\(--form-text\)/);
for (const selector of ['#add-icon-modal #save-btn', '#add-icon-modal #save-btn:hover']) {
  const background = rgba(lastRule(selector).match(/background:\s*(#[0-9a-f]+);/)[1]);
  assert.ok(contrast(rgba('#ffffff'), background) >= 4.5, `${selector} white label`);
}
