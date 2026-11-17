import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), M = require('../lib/widget-model.js');
const icon = id => ({ id, folderId: 'folder-home' });
const value = M.parse();
value.pages.push({ groupId: 'folder-home', columns: 4, icons: [{ id: 'saved', x: 0, y: 0 }, { id: 'last', x: 3, y: 2 }] });
const layout = M.desktop(value, 'folder-home', [icon('new'), icon('saved'), icon('last')]);
assert.deepEqual(layout.entries.find(e => e.id === 'i:saved'), { id: 'i:saved', x: 0, y: 0, w: 1, h: 1 }, 'new icon must not steal a saved slot');
assert.deepEqual(layout.entries.find(e => e.id === 'i:last'), { id: 'i:last', x: 3, y: 2, w: 1, h: 1 }, 'saved holes remain');
assert.equal(layout.entries.find(e => e.id === 'i:new').x, 1);
M.saveDesktop(value, 'folder-home', layout);
const byId = entries => entries.slice().sort((a, b) => a.id.localeCompare(b.id));
assert.deepEqual(byId(M.desktop(M.parse(M.serialize(value)), 'folder-home', [icon('last'), icon('saved'), icon('new')]).entries), byId(layout.entries), 'reload and icon array order preserve saved coordinates');
const original = M.serialize(value);
const narrow = M.arrange(layout.entries, 1);
assert.equal(M.serialize(value), original, 'narrow projection never mutates persisted positions');
assert.ok(narrow.every((e, i) => e.x === 0 && !narrow.slice(i + 1).some(other => M.overlap(e, other))));
value.widgets.push({ id: 'note', type: 'builtin.note', groupId: 'folder-home', x: 0, y: 0, w: 2, h: 2, data: { text: 'preserve' } });
const repaired = M.desktop(value, 'folder-home', [icon('new'), icon('saved'), icon('last')]);
assert.equal(repaired.entries.find(e => e.id === 'i:last').y, 2, 'repairing an old overlap must not move unrelated saved slots');
assert.ok(repaired.entries.every((e, i) => !repaired.entries.slice(i + 1).some(other => M.overlap(e, other))));
M.saveDesktop(value, 'folder-home', repaired);
assert.deepEqual(byId(M.desktop(M.parse(M.serialize(value)), 'folder-home', [icon('new'), icon('saved'), icon('last')]).entries), byId(repaired.entries));
console.log('Widget layout regressions passed: reserved slots, new icons, collisions, saved holes, projection and reload.');

const sortLayout = { columns: 6, entries: [{ id: 'i:a', x: 0, y: 0, w: 1, h: 1 }, { id: 'i:b', x: 2, y: 0, w: 1, h: 1 }, { id: 'i:c', x: 4, y: 0, w: 1, h: 1 }, { id: 'w:fixed', x: 1, y: 1, w: 2, h: 2 }] };
const reordered = M.reorderIcons(sortLayout, 'i:c', 'i:a');
assert.deepEqual(reordered.entries.filter(e => e.id.startsWith('i:')).sort((a,b) => a.x-b.x).map(e => e.id), ['i:c', 'i:a', 'i:b']);
assert.deepEqual(reordered.entries.find(e => e.id === 'w:fixed'), sortLayout.entries[3]);
assert.deepEqual(reordered.entries.filter(e => e.id.startsWith('i:')).map(e => e.x).sort(), [0, 2, 4], 'sorting reuses the original slots and holes');
assert.equal(sortLayout.entries[2].x, 4, 'preview cannot mutate the original layout');
const keyboard = M.reorderIcons(sortLayout, 'i:a', 'i:b', true);
assert.equal(keyboard.entries.find(e => e.id === 'i:a').x, 2);
console.log('Icon sorting regressions passed: before/after insertion, keyboard order, widget isolation, holes and nonmutating preview.');

const occupied = { columns: 6, entries: [
  { id: 'w:grab', x: 0, y: 0, w: 2, h: 2, data: { text: 'keep' } },
  { id: 'w:neighbor', x: 2, y: 0, w: 2, h: 2 },
  { id: 'i:fixed', x: 5, y: 4, w: 1, h: 1 }
] };
const originalOccupied = JSON.stringify(occupied), planned = M.moveLayout(occupied, 'w:grab', { x: 2, y: 0 });
assert.equal(JSON.stringify(occupied), originalOccupied, 'preview planning never mutates its baseline');
assert.equal(planned.entries[0].x, 2);
assert.deepEqual(planned.entries[1], { id: 'w:neighbor', x: 0, y: 0, w: 2, h: 2 }, 'an occupied widget makes room using the vacated nearby slot');
assert.deepEqual(planned.entries[2], occupied.entries[2], 'unaffected positions stay fixed');
assert.deepEqual(M.moveLayout(occupied, 'w:grab', { x: 2, y: 0 }), planned, 'the preview and released move are deterministic');
assert.throws(() => M.moveLayout(occupied, 'w:grab', { x: 5, y: 0 }), /INVALID_WIDGET_DATA/, 'no implicit columns at an invalid boundary');
const mixed = { columns: 6, entries: [{ id: 'i:grab', x: 4, y: 0, w: 1, h: 1 }, { id: 'w:note', x: 0, y: 0, w: 2, h: 2 }, { id: 'i:stay', x: 5, y: 4, w: 1, h: 1 }] };
const mixedPlan = M.moveLayout(mixed, 'i:grab', { x: 0, y: 0 });
assert.equal(mixedPlan.entries[0].x, 0); assert.equal(mixedPlan.entries[0].y, 0);
assert.deepEqual(mixedPlan.entries[2], mixed.entries[2]);
assert.ok(!M.overlap(mixedPlan.entries[0], mixedPlan.entries[1]), 'an icon can displace a larger widget');
assert.equal(mixedPlan.entries[1].w, 2); assert.equal(mixedPlan.entries[1].h, 2);
let random = 4812;
const sample = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
let maxPlanMs = 0;
for (let trial = 0; trial < 180; trial++) {
  const layout = { columns: 6, entries: [] };
  for (let index = 0; index < 64; index++) {
    const w = index < 4 ? 2 : 1, h = index < 4 ? 2 : 1;
    layout.entries.push({ id: `${index < 4 ? 'w:' : 'i:'}${index}`, w, h, ...M.free(layout.entries, w, h, 6) });
  }
  const baseline = JSON.stringify(layout), moving = layout.entries[sample(layout.entries.length)];
  const begin = performance.now(), plan = M.moveLayout(layout, moving.id, { x: sample(7 - moving.w), y: sample(15) });
  maxPlanMs = Math.max(maxPlanMs, performance.now() - begin);
  assert.equal(JSON.stringify(layout), baseline);
  assert.equal(plan.entries.length, layout.entries.length);
  for (const [index, entry] of plan.entries.entries()) {
    assert.ok(entry.x >= 0 && entry.y >= 0 && entry.x + entry.w <= plan.columns && entry.y <= 511);
    assert.equal(entry.w, layout.entries[index].w); assert.equal(entry.h, layout.entries[index].h);
    assert.ok(!plan.entries.slice(index + 1).some(other => M.overlap(entry, other)), 'dense mixed-size displacement cannot overlap');
  }
}
console.log(`Fluid layout regressions passed: nearby displacement, mixed-size items, unchanged neighbors, deterministic plans and 180 dense cases (max planner ${maxPlanMs.toFixed(2)}ms).`);
const full = { columns: 2, entries: [{ id: 'w:large', x: 0, y: 0, w: 2, h: 2 }] };
for (let y = 2; y < 512; y++) for (let x = 0; x < 2; x++) full.entries.push({ id: `i:${x}-${y}`, x, y, w: 1, h: 1 });
const fullBegin = performance.now(), fullPlan = M.moveLayout(full, 'i:0-2', { x: 0, y: 0 });
const fullRows = new Uint16Array(524);
for (const entry of fullPlan.entries) { const mask = ((1 << entry.w) - 1) << entry.x; for (let y = entry.y; y < entry.y + entry.h; y++) { assert.equal(fullRows[y] & mask, 0); fullRows[y] |= mask; } }
assert.equal(fullPlan.entries.length, full.entries.length);
assert.equal(full.entries[0].y, 0, 'fragmentation fallback does not mutate the original');
console.log(`Fragmented full-capacity displacement passed (${(performance.now() - fullBegin).toFixed(2)}ms).`);

await import('./widget-runtime.test.mjs');
