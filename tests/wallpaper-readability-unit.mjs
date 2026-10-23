import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertClearGlassSamples } from './interface-glass.mjs';
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
assert.match(rule('.group-tab.active'), /var\(--glass-selected-bg\)/);
assert.match(rule('.calendar-popover'), /background: var\(--panel-bg-solid\)/);
assert.ok(Number(rule('#clock-widget:has(.calendar-popover:not(.hidden))').match(/z-index: (\d+)/)[1]) > Number(rule('.group-tabs-bar').match(/z-index: (\d+)/)[1]), 'open calendar stacking context exceeds group context');
const results = [];
for (const theme of [':root', 'body.theme-light']) {
  const root = rule(theme), calendar = rule(theme === ':root' ? '.calendar-popover' : 'body.theme-light .calendar-popover');
  const panel = token(root, 'panel-bg-solid');
  const pairs = [['calendar hint', token(root, 'text-hint'), panel], ['holiday', token(calendar, 'calendar-holiday'), panel], ['term', token(calendar, 'calendar-term'), panel], ['selected date/annotation', token(calendar, 'calendar-selected-text'), token(calendar, 'calendar-selected-bg')]];
  for (const [name, fg, bg] of pairs) {
    const ratio = contrast(fg, bg); assert.ok(ratio >= 4.5, `${theme} ${name}: ${ratio}`); results.push(ratio);
  }
}
console.log(`Wallpaper readability CSS: all sampled text pairs >= ${Math.min(...results).toFixed(2)}:1 (alpha composited over black/white, no blur credit)`);

// The final navigation uses one readable glass fill. Counts must not add a
// second full fill or inherit an accent foreground with insufficient contrast.
const lastRule = selector => {
  const start = css.lastIndexOf(`${selector} {`);
  assert.ok(start >= 0);
  return css.slice(start, css.indexOf('}', start));
};
assert.match(lastRule('.group-tab-count'), /background: transparent; color: var\(--glass-text\)/);
for (const theme of [':root', 'body.theme-light']) {
  const values = lastRule(theme);
  for (const [name, foreground, background] of [
    ['form label/cancel', 'form-text', 'form-surface'],
    ['form hint', 'form-muted', 'form-surface'],
    ['field hint/placeholder', 'form-muted', 'form-field']
  ]) {
    const ratio = contrast(token(values, foreground), token(values, background));
    assert.ok(ratio >= 4.5, `${theme} final ${name}: ${ratio}`);
  }
}
console.log('Solid form token pairs retain 4.5:1 in both themes.');

assert.match(rule('#add-icon-modal .modal-content'), /--text-hint: var\(--form-muted\)/);
assert.match(lastRule('#add-icon-modal #cancel-btn'), /background: transparent; color: var\(--form-text\)/);
for (const selector of ['#add-icon-modal #save-btn', '#add-icon-modal #save-btn:hover']) {
  const background = rgba(lastRule(selector).match(/background:\s*(#[0-9a-f]+);/)[1]);
  assert.ok(contrast(rgba('#ffffff'), background) >= 4.5, `${selector} white label`);
}

// Read the real mapping, preserving the user's global numeric preference.
const glassMapping = rule(':root').match(/--glass-alpha: calc\(([\d.]+) \+ var\(--ui-frame-opacity\) \* ([\d.]+)\)/);
assert.ok(glassMapping, 'glass has one live, monotonic opacity mapping');
const [floor, scale] = glassMapping.slice(1).map(Number);
assert.equal(floor, .60); assert.equal(scale, .24);
const glassResults = [];
for (const theme of [':root', 'body.theme-light']) {
  const values = rule(theme), tint = values.match(/--glass-tint: ([^;]+);/)[1].split(',').map(Number);
  assert.match(values, /--panel-bg: var\(--glass-bg\)/);
  assert.match(values, /--button-bg: var\(--glass-bg\)/);
  for (const opacity of [12, 32, 70]) {
    const alpha = floor + scale * opacity / 100;
    assert.ok(alpha < .78, 'primary glass never becomes an opaque paper slab');
    for (const backdrop of [[0, 0, 0], [255, 255, 255]]) {
      for (const extra of [0, .06, .08]) {
        const surface = over([...tint, alpha + extra], backdrop);
        const nested = [surface, over(token(values, 'glass-section-bg'), surface),
          over(token(values, 'glass-control-bg'), surface), over(token(values, 'glass-control-hover'), surface),
          over(token(values, 'glass-field-bg'), surface)];
        for (const bg of nested) for (const text of ['glass-text', 'glass-muted']) {
          const value = contrast(token(values, text), bg);
          assert.ok(value >= 4.5, `${theme}/${opacity}/${text}: ${value}`); glassResults.push(value);
        }
      }
    }
  }
}
assert.match(rule(':root'), /--card-bg: rgba\(10, 16, 28, calc\(var\(--ui-frame-opacity\) \* 0\.72 \+ 0\.12\)\)/, 'existing dark search/icon alpha stays unchanged');
assert.match(rule('body.theme-light'), /--card-bg: rgba\(255, 255, 255, calc\(var\(--ui-frame-opacity\) \* 0\.5 \+ 0\.4\)\)/, 'existing light search/icon alpha stays unchanged');
for (const selector of ['#search-widget', '.settings-panel', '.folder-panel', '#todo-widget', '.timezone-selector', '.floating-btn', 'body.icon-frame-enabled .icon-widget']) {
  assert.match(rule(selector), /backdrop-filter: blur\(var\(--ui-blur-strong\)\)/, selector + ' uses the chosen blur, including zero');
}
const deck = fs.readFileSync(new URL('../clock-deck.css', import.meta.url), 'utf8');
assert.match(deck, /--deck-surface: var\(--glass-bg\)/);
await import('./clock-stack-unit.mjs');
assert.match(deck, /backdrop-filter: blur\(var\(--ui-blur-strong\)\)/);
const scene = fs.readFileSync(new URL('../scene-ui.css', import.meta.url), 'utf8');
assert.match(scene, /\.scene-trigger \{ background: var\(--glass-bg\)/);
assert.match(fs.readFileSync(new URL('../zen-mode.css', import.meta.url), 'utf8'), /background: var\(--bg-base\)/, 'Zen remains an isolated solid canvas');
console.log(`Glass: alpha .6288/.6768/.768, all sampled text pairs >= ${Math.min(...glassResults).toFixed(2)}:1 without blur credit; existing search/icon alpha is unchanged.`);

assert.match(rule('#background-layer.boot-lqip'), /filter: blur\(24px\)/, 'low-quality startup wallpaper smoothing is not an interface blur preference');

// The real helper must wait for the same interaction/persistence boundary as
// packaged-home tests, not only the early grid-ready performance mark.
const integration = fs.readFileSync(new URL('./interface-glass.mjs', import.meta.url), 'utf8');
const readiness = integration.slice(integration.indexOf('async function ready(target)'), integration.indexOf('const settle ='));
for (const expected of ['opentab:grid-ready', 'opentab:initial-loader-end', '#icons-container[data-grid-bound="1"]', "getElementById('homepage')?.inert === false", "OpenTabWorkspace.read(['icons'])"]) assert.ok(readiness.includes(expected), 'glass readiness includes ' + expected);
assert.match(readiness, /await interactive\(\);[\s\S]*OpenTabWorkspace\.read[\s\S]*await interactive\(\);/, 'read-only workspace barrier is bracketed by current interactive checks');
assert.match(integration, /sheet: \{ x: sheet\.right - 8, y: sheet\.top \+ sheet\.height \/ 2 \}/, 'sample uses the far gutter rather than the overlapping left clock area');
assert.match(integration, /assertClearGlassSamples\(report\)/, 'real browser snapshots pass the same pure geometry guard');
assert.doesNotMatch(integration, /waitForTimeout|setTimeout/, 'no fixed sleeps replace readiness or paint boundaries');
const sampleGeometry = {
  points: { sheet: { x: 1580, y: 500 }, section: { x: 1547, y: 220 } },
  behindSheet: [{ name: 'clock-deck', rect: { left: 490, right: 1110, top: 100, bottom: 416 } },
    { name: 'settings-btn', rect: { left: 1524, right: 1572, top: 924, bottom: 972 } }]
};
assert.doesNotThrow(() => assertClearGlassSamples(sampleGeometry));
assert.throws(() => assertClearGlassSamples({ ...sampleGeometry, points: { ...sampleGeometry.points, sheet: { x: 955, y: 362 } } }), /overlaps underlying clock-deck/, 'original left-gutter sampling bug is a negative control');
assert.throws(() => assertClearGlassSamples({ ...sampleGeometry, points: { ...sampleGeometry.points, section: { x: 1115, y: 300 } } }), /overlaps underlying clock-deck/, 'shadow/blur margin is checked too');
console.log('Glass readiness and sample geometry: production barriers, verified far gutter and overlap negative controls passed.');
