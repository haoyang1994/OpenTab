import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Independent rounded-card oracle, in stage-local coordinates. The rear cards
// retain the original scaled silhouettes; only visible set differences paint.
export function stackRects(width, height, radius) {
  return [1, .97, .94].map((scale, index) => ({
    left: width * (1 - scale) / 2, top: height * (1 - scale) + index * 8,
    width: width * scale, height: height * scale, radius: radius * scale,
    right: width * (1 + scale) / 2, bottom: height + index * 8
  }));
}
export function roundedDistance(rect, x, y) {
  const dx = Math.abs(x - (rect.left + rect.width / 2)) - rect.width / 2 + rect.radius;
  const dy = Math.abs(y - (rect.top + rect.height / 2)) - rect.height / 2 + rect.radius;
  const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rect.radius;
  return Math.abs(distance) < 1e-8 ? 0 : distance;
}
export function visibleStackLayer(rects, x, y) {
  return rects.findIndex(rect => roundedDistance(rect, x, y) < 0);
}
// Model the actual three-gradient mask separately from the set-difference
// oracle. This catches a missing corner, incorrect inset, or center overlap.
export function rearMaskPaints(rects, index, x, y) {
  const rear = rects[index], previous = rects[index - 1];
  if (roundedDistance(rear, x, y) >= 0) return false;
  if (y >= previous.bottom) return true;
  if (y < previous.bottom - previous.radius) return false;
  const centerX = x < (rear.left + rear.right) / 2 ? previous.left + previous.radius : previous.right - previous.radius;
  const inCornerTile = x < previous.left + previous.radius || x > previous.right - previous.radius;
  return inCornerTile && Math.hypot(x - centerX, y - (previous.bottom - previous.radius)) >= previous.radius;
}

export function stackSamplePoints(rects, origin = { x: 0, y: 0 }, minimumClearance = 1.05) {
  const front = rects[0], points = { center: { x: front.radius + 6, y: front.height - 40, layer: 0 } };
  for (const index of [1, 2]) {
    const previous = rects[index - 1], rear = rects[index];
    // Search pixel centers for a genuine rounded shoulder above the previous
    // card's bottom, clear of the preceding silhouette and inside the rear border.
    const candidates = [];
    for (let y = Math.floor(previous.bottom - previous.radius + origin.y) - origin.y; y < previous.bottom - .5; y++) {
      for (let x = Math.floor(rear.left + origin.x) - origin.x; x < front.radius + rear.left; x++) {
        const point = { x: x + .5, y: y + .5, layer: index };
        const clearance = Math.min(-roundedDistance(rear, point.x, point.y), ...rects.slice(0, index).map(rect => roundedDistance(rect, point.x, point.y)));
        if (clearance > minimumClearance) candidates.push({ ...point, clearance });
      }
    }
    candidates.sort((a, b) => b.clearance - a.clearance);
    assert.ok(candidates.length, `rear ${index} has a connected curved shoulder, not a flat ribbon`);
    const best = candidates[0];
    points[`rear${index}Left`] = best;
    points[`rear${index}Right`] = { ...best, x: front.width - best.x };
    points[`rear${index}Center`] = { x: front.width / 2, y: previous.bottom + 4, layer: index };
  }
  return points;
}

export function assertRoundedStackGeometry({ width, height, radius, backing }) {
  const expected = stackRects(width, height, radius);
  for (const [i, item] of backing.entries()) {
    const rear = expected[i + 1];
    for (const key of ['left', 'top', 'width', 'height', 'radius']) {
      assert.ok(Math.abs(item[key] - rear[key]) < .15, `rear ${i + 1} ${key}: ${item[key]} matches rounded card ${rear[key]}`);
    }
    assert.equal(item.pointerEvents, 'none', 'only noninteractive decorative backs are masked');
    assert.match(item.mask, /linear-gradient/);
    assert.equal((item.mask.match(/radial-gradient/g) || []).length, 2, 'both curved shoulders have inverse-circle masks');
    assert.equal(item.transform, 'none', 'explicit rear geometry and cutout use the same coordinate space');
  }
  return expected;
}

async function decodePixels(page, buffer, points, clip) {
  return page.evaluate(async ({ base64, points, clip }) => {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    image.src = `data:image/png;base64,${base64}`; await loaded;
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([name, point]) => {
      const rgb = [...ctx.getImageData(Math.floor(point.x - clip.x), Math.floor(point.y - clip.y), 1, 1).data].slice(0, 3);
      return [name, { rgb, mean: rgb.reduce((sum, value) => sum + value, 0) / 3 }];
    }));
  }, { base64: buffer.toString('base64'), points, clip });
}

// Integrated into the existing clock-deck native suite; no extra browser suite.
// Production CSS and Boot preference applicators are used without test styles.
export async function verifyClockStackPixels(page, artifacts, select) {
  const originalViewport = page.viewportSize(), reports = [];
  const original = await page.evaluate(() => ({
    root: document.documentElement.getAttribute('style'), body: document.body.className,
    background: document.getElementById('background-layer').getAttribute('style')
  }));
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    const interactive = () => page.waitForFunction(() => performance.getEntriesByName('opentab:grid-ready').length && performance.getEntriesByName('opentab:initial-loader-end').length && document.querySelector('#icons-container[data-grid-bound="1"]') && document.getElementById('homepage')?.inert === false);
    await interactive(); await page.evaluate(() => OpenTabWorkspace.read(['icons'])); await interactive();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 760 }, { width: 320, height: 640 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) for (const opacity of [12, 70]) {
        await page.evaluate(({ theme, opacity }) => {
          OpenTabBoot.applyTheme(theme); OpenTabBoot.applyUiOpacity(opacity); OpenTabBoot.applyUiBlur(0);
          document.getElementById('content').scrollTo({ top: 0, left: 0, behavior: 'instant' });
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        }, { theme, opacity });
        for (let index = 0; index < 3; index++) {
          await select(index); await paint();
          const geometry = await page.evaluate(() => {
            const stage = document.getElementById('clock-deck-stage'), r = stage.getBoundingClientRect();
            const face = document.querySelector('.clock-deck-card[data-active="true"]'), style = getComputedStyle(face);
            const nav = document.getElementById('clock-deck-nav').getBoundingClientRect();
            return {
              x: r.x, y: r.y, width: r.width, height: r.height, radius: parseFloat(style.borderBottomLeftRadius),
              front: { width: face.getBoundingClientRect().width, height: face.getBoundingClientRect().height, background: style.backgroundColor },
              nav: { bottom: nav.bottom, count: document.querySelectorAll('#clock-deck-nav button').length },
              backing: ['::before', '::after'].map(pseudo => {
                const s = getComputedStyle(stage, pseudo);
                return { left: parseFloat(s.left), top: r.height - parseFloat(s.bottom) - parseFloat(s.height), width: parseFloat(s.width), height: parseFloat(s.height),
                  radius: parseFloat(s.borderBottomLeftRadius), mask: s.maskImage || s.webkitMaskImage, pointerEvents: s.pointerEvents, transform: s.transform };
              })
            };
          });
          const rects = assertRoundedStackGeometry(geometry), local = stackSamplePoints(rects, geometry);
          assert.equal(geometry.front.width, geometry.width); assert.equal(geometry.front.height, geometry.height);
          assert.equal(geometry.nav.count, 3, 'existing three-dot navigation is unchanged');
          assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= viewport.width, 'the whole stack fits mobile width');
          const clip = { x: Math.max(0, Math.floor(geometry.x - 12)), y: Math.max(0, Math.floor(geometry.y - 12)) };
          clip.width = Math.min(viewport.width, Math.ceil(geometry.x + geometry.width + 12)) - clip.x;
          clip.height = Math.min(viewport.height, Math.ceil(geometry.nav.bottom + 8)) - clip.y;
          const points = Object.fromEntries(Object.entries(local).map(([name, point]) => [name, { ...point, x: point.x + geometry.x, y: point.y + geometry.y }]));
          for (const point of Object.values(points)) assert.ok(point.x >= clip.x && point.x < clip.x + clip.width && point.y >= clip.y && point.y < clip.y + clip.height, 'every pixel sample is in the actual screenshot');
          const label = `clock-stack-${viewport.width}-${theme}-${opacity}-card-${index}`, pixels = {};
          for (const [name, value] of [['black', '#000'], ['white', '#fff']]) {
            await page.locator('#background-layer').evaluate((element, value) => { element.style.background = value; }, value); await paint();
            const buffer = await page.screenshot({ clip, animations: 'disabled' });
            pixels[name] = await decodePixels(page, buffer, points, clip);
          }
          const alpha = .60 + .24 * opacity / 100;
          for (const [name, point] of Object.entries(local)) {
            const transmission = pixels.white[name].mean - pixels.black[name].mean;
            const actualAlpha = 1 - transmission / 255;
            assert.ok(transmission > (name.endsWith('Left') || name.endsWith('Right') ? 5 : 20), `${label}/${name}: exposed card still reveals wallpaper, allowing antialiased corner borders (${transmission})`);
            assert.ok(actualAlpha > .55, `${label}/${name}: real curved shoulder is filled, not missing like the old flat strips (${actualAlpha})`);
            if (point.layer === 0) assert.ok(Math.abs(actualAlpha - alpha) < .025, `${label}: central face stays single-filled, not compounded (${actualAlpha} vs ${alpha})`);
          }
          // A colored, ordinary wallpaper view makes the focus-card regression
          // independently inspectable, not just a computed-style/pixel report.
          if ((index === 1 && viewport.width !== 320) || (index !== 1 && viewport.width === 1280 && opacity === 70)) {
            await page.evaluate(() => OpenTabBoot.applyUiBlur(20));
            await page.locator('#background-layer').evaluate(element => { element.style.background = 'linear-gradient(150deg, #d8e5f4, #f4ba98 52%, #40618a)'; }); await paint();
            await page.screenshot({ path: path.join(artifacts, `${label}-${index === 1 ? 'focus' : 'card'}-wallpaper-blur20.png`), clip, animations: 'disabled' });
            await page.evaluate(() => OpenTabBoot.applyUiBlur(0));
          }
          reports.push({ viewport, theme, opacity, card: index, geometry, points, pixels });
        }
      }
    }
    for (const width of [1280, 390, 320]) for (const theme of ['light', 'dark']) for (const card of [0, 1, 2]) {
      const low = reports.find(r => r.viewport.width === width && r.theme === theme && r.card === card && r.opacity === 12);
      const high = reports.find(r => r.viewport.width === width && r.theme === theme && r.card === card && r.opacity === 70);
      const backdrop = theme === 'light' ? 'black' : 'white';
      assert.ok(Math.abs(high.pixels[backdrop].center.mean - low.pixels[backdrop].center.mean) > 25, 'opacity endpoints remain visibly separate on every card and viewport');
    }
    fs.writeFileSync(path.join(artifacts, 'clock-stack-pixels.json'), JSON.stringify(reports, null, 2));
    console.log('Rounded clock stack: all 3 cards, both themes, 12/70 opacity, desktop/390/320px actual corner pixels and single-fill transmission passed.');
  } finally {
    await page.evaluate(original => {
      const restore = (element, value) => value === null ? element.removeAttribute('style') : element.setAttribute('style', value);
      restore(document.documentElement, original.root); document.body.className = original.body;
      restore(document.getElementById('background-layer'), original.background);
    }, original);
    await page.setViewportSize(originalViewport); await page.emulateMedia({ reducedMotion: 'no-preference' }); await select(0);
  }
}
