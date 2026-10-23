import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stackRects, roundedDistance, visibleStackLayer, rearMaskPaints, stackSamplePoints, assertRoundedStackGeometry } from './clock-stack.mjs';
const css = fs.readFileSync(new URL('../clock-deck.css', import.meta.url), 'utf8');
const block = selector => {
  const start = css.indexOf('\n' + selector + ' {') + 1; assert.ok(start > 0);
  return css.slice(start, css.indexOf('}', start));
};
const backs = block('#clock-deck-stage::before, #clock-deck-stage::after');
assert.match(backs, /box-sizing: border-box/);
assert.match(backs, /bottom: -8px/); assert.match(backs, /width: 97%/); assert.match(backs, /height: 97%/);
assert.match(backs, /border-radius: calc\(var\(--deck-radius\) \* \.97\)/);
assert.match(backs, /--deck-cutout-radius: var\(--deck-radius\)/);
assert.match(backs, /--deck-corner-width: calc\(var\(--deck-cutout-radius\) - 1\.546392%\)/);
assert.match(backs, /linear-gradient\(#000 0 0\) bottom \/ 100% 8px no-repeat/);
assert.match(backs, /radial-gradient\(circle at right top, transparent var\(--deck-cutout-radius\), #000 var\(--deck-cutout-radius\)\) left bottom 8px \/ var\(--deck-corner-width\) var\(--deck-cutout-radius\) no-repeat/);
assert.match(backs, /radial-gradient\(circle at left top, transparent var\(--deck-cutout-radius\), #000 var\(--deck-cutout-radius\)\) right bottom 8px \/ var\(--deck-corner-width\) var\(--deck-cutout-radius\) no-repeat/);
for (const declaration of ['-webkit-mask: var(--deck-rear-mask)', 'mask: var(--deck-rear-mask)', 'pointer-events: none']) assert.ok(backs.includes(declaration));
assert.doesNotMatch(backs, /mask-composite|clip-path|border-top: 0|height: 8px/, 'no sliced ribbons or newer shape/compositing features');
const last = block('#clock-deck-stage::after');
assert.match(last, /bottom: -16px/); assert.match(last, /left: 3%/); assert.match(last, /width: 94%/); assert.match(last, /height: 94%/);
assert.match(last, /border-radius: calc\(var\(--deck-radius\) \* \.94\)/);
assert.match(last, /--deck-cutout-radius: calc\(var\(--deck-radius\) \* \.97\)/);
assert.match(last, /--deck-corner-width: calc\(var\(--deck-cutout-radius\) - 1\.595745%\)/);
assert.match(css, /#clock-deck \{ --deck-radius: 26px;/, 'cutout follows the unchanged mobile face radius');
const front = block('#clock-deck .clock-deck-card');
assert.doesNotMatch(front, /\bmask:/, 'interactive front and popovers are never masked');
assert.match(front, /min-height: 316px/); assert.match(front, /border-radius: var\(--radius-xl\)/);

let pointsChecked = 0;
for (const [width, height, radius] of [[620, 316, 32], [620, 294, 32], [712, 306, 26], [342, 306, 26], [312, 306, 26], [272, 306, 26], [271.5, 347.25, 26]]) {
  const rects = stackRects(width, height, radius), points = stackSamplePoints(rects, { x: 0, y: 0 }, .4);
  for (const index of [1, 2]) {
    for (const name of [`rear${index}Left`, `rear${index}Right`]) {
      const point = points[name];
      assert.equal(visibleStackLayer(rects, point.x, point.y), index);
      assert.ok(point.y < rects[index - 1].bottom, 'rounded shoulder rises behind the preceding bottom edge');
      assert.equal(rearMaskPaints(rects, index, point.x, point.y), true);
      assert.equal(point.y >= rects[index - 1].bottom, false, 'old detached8px strip is a failing negative control');
    }
  }
  // Dense lower-contour comparison checks the implemented gradient construction
  // against true rounded-card set differences, including fractional geometry.
  for (let y = height - radius - 1; y < height + 17; y += .5) for (let x = .25; x < width; x += .5) {
    const expected = visibleStackLayer(rects, x, y);
    const actual = [roundedDistance(rects[0], x, y) < 0, rearMaskPaints(rects, 1, x, y), rearMaskPaints(rects, 2, x, y)];
    assert.ok(actual.filter(Boolean).length <= 1, `no double-filled pixel ${width}/${height}/${x}/${y}`);
    assert.equal(actual.findIndex(Boolean), expected, 'mask preserves the complete original rounded silhouettes');
    pointsChecked++;
  }
  assert.equal(rearMaskPaints(rects, 1, width / 2, height / 2), false);
  assert.equal(rearMaskPaints(rects, 2, width / 2, height / 2), false);
  assert.ok(roundedDistance(rects[1], width / 2, height / 2) < 0, 'unmasked full rear is an opacity-compounding negative control');
  const backing = rects.slice(1).map(rect => ({ ...rect, mask: 'linear-gradient(...), radial-gradient(...), radial-gradient(...)', pointerEvents: 'none', transform: 'none' }));
  assert.doesNotThrow(() => assertRoundedStackGeometry({ width, height, radius, backing }));
  assert.throws(() => assertRoundedStackGeometry({ width, height, radius, backing: backing.map((item, index) => ({ ...item, top: height + index * 8, height: 8, radius: 4 })) }), /matches rounded card/, 'old ribbon CSS cannot satisfy the actual geometry guard');
}
const native = fs.readFileSync(new URL('./clock-stack.mjs', import.meta.url), 'utf8');
assert.match(native, /index === 1 && viewport.width !== 320/, 'focus card receives desktop/mobile reviewable wallpaper crops at both endpoints');
assert.match(native, /for \(let index = 0; index < 3; index\+\+\)/);
assert.match(native, /\['light', 'dark'\]/); assert.match(native, /\[12, 70\]/);
assert.match(native, /width: 390/); assert.match(native, /width: 320/);
assert.doesNotMatch(native, /waitForTimeout|setTimeout/, 'native pixels use paint/interaction boundaries, not sleeps');
console.log(`Rounded stack: ${pointsChecked} contour points preserve full card geometry without overlap; detached strips and unmasked backs rejected.`);
