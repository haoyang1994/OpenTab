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
