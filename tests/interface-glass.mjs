import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { waitForAsync } from './wait-for-async.mjs';

// Pure geometry guard is shared with offline negative controls. A settings
// pixel over another UI surface cannot prove single-surface transmission.
export function assertClearGlassSamples({ points, behindSheet }) {
  for (const name of ['sheet', 'section']) {
    const point = points[name];
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${name} has a finite sample point`);
    const overlap = behindSheet.find(({ rect }) => point.x >= rect.left - 24 && point.x <= rect.right + 24 && point.y >= rect.top - 24 && point.y <= rect.bottom + 24);
    assert.equal(overlap, undefined, `${name} sample overlaps underlying ${overlap?.name}`);
  }
}

// Production MV3 integration. No test-only opacity, blur, foreground or surface
// CSS: real settings handlers persist every endpoint before pixels are sampled.
export async function verifyInterfaceGlass(page, worker, artifacts) {
  const viewport = page.viewportSize();
  const original = await worker.evaluate(() => chrome.storage.local.get(null));
  const url = page.url(), reports = [], pixels = new Map();
  async function ready(target) {
    const interactive = () => target.waitForFunction(() =>
      performance.getEntriesByName('opentab:grid-ready').length > 0
      && performance.getEntriesByName('opentab:initial-loader-end').length > 0
      && document.querySelector('#icons-container[data-grid-bound="1"]')
      && document.getElementById('homepage')?.inert === false, undefined, { timeout: 10000 });
    await interactive();
    // Match the packaged-home readiness contract: startup preference saves can
    // acknowledge after grid paint and rebuild nodes. Join their lock read-only.
    await target.evaluate(() => OpenTabWorkspace.read(['icons']));
    await interactive();
  }
  const settle = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function setSlider(id, value, key) {
    await page.locator(id).evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await waitForAsync(page, async ({ key, value }) => (await chrome.storage.local.get(key))[key] === value, { key, value });
    await page.evaluate(() => OpenTabWorkspace.read(['uiOpacity', 'uiBlur']));
    await settle();
  }
  async function background(value) {
    await page.locator('#background-layer').evaluate((el, value) => { el.style.background = value; }, value);
    await settle();
  }
  async function samplePng(buffer, points) {
    return page.evaluate(async ({ base64, points }) => {
      const image = new Image();
      const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      image.src = 'data:image/png;base64,' + base64; await loaded;
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      return Object.fromEntries(Object.entries(points).map(([name, point]) => {
        const data = ctx.getImageData(Math.round(point.x), Math.round(point.y), point.size || 1, point.size || 1).data;
        const values = []; for (let i = 0; i < data.length; i += 4) values.push((data[i] + data[i + 1] + data[i + 2]) / 3);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return [name, { rgb: [...data.slice(0, 3)], mean, deviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) }];
      }));
    }, { base64: buffer.toString('base64'), points });
  }
  async function snapshot() {
    return page.evaluate(() => {
      const color = value => { const parts = value.match(/[\d.]+/g).map(Number); return [...parts.slice(0, 3), parts[3] ?? 1]; };
      const over = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3]));
      const luminance = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
      const surfaces = Object.fromEntries(['#clock-widget', '#search-widget', '.settings-panel', '#todo-widget', '.floating-btn', '.group-tab', '.group-add-btn', '#scene-switcher .scene-trigger', '.icon-widget[data-id]'].map(selector => {
        const element = document.querySelector(selector); if (!element) return [selector, null];
        const style = getComputedStyle(element); return [selector, { background: color(style.backgroundColor), blur: style.backdropFilter, opacity: style.opacity }];
      }));
      const samples = [];
      for (const [selector, rootSelector] of [['#timezone-label', '#clock-widget'], ['#date', '#clock-widget'], ['.group-tab', '.group-tab'], ['.group-tab-count', '.group-tab'], ['#settings-panel h2', '#settings-panel'], ['#settings-nav-appearance', '#settings-panel'], ['label[for="ui-opacity"]', '#settings-panel'], ['#ui-opacity-value', '#settings-panel'], ['#ui-blur-value', '#settings-panel'], ['#settings-panel .setting-section h3', '#settings-panel'], ['#settings-panel .theme-mode-tab:not(.active)', '#settings-panel']]) {
        const element = document.querySelector(selector); if (!element) continue;
        const root = element.closest(rootSelector), chain = []; for (let node = element; node; node = node.parentElement) { chain.unshift(node); if (node === root) break; }
        if (!root || chain[0] !== root) throw Error('Missing contrast root: ' + selector);
        const styles = chain.map(node => getComputedStyle(node));
        if (styles.slice(0, -1).some(style => Number(style.opacity) !== 1)) throw Error('Unmodelled ancestor opacity: ' + selector);
        for (const backdrop of [[0, 0, 0], [255, 255, 255]]) {
          let bg = backdrop;
          for (const style of styles) { if (style.backgroundImage !== 'none') throw Error('Unmodelled contrast layer: ' + selector); bg = over(color(style.backgroundColor), bg); }
          const style = getComputedStyle(element), fg = color(style.color); fg[3] *= Number(style.opacity);
          samples.push({ selector, backdrop, ratio: ratio(over(fg, bg), bg) });
        }
      }
      const clock = document.getElementById('clock-widget').getBoundingClientRect(), sheet = document.getElementById('settings-panel').getBoundingClientRect();
      const section = document.getElementById('ui-opacity').closest('.setting-section').getBoundingClientRect();
      const stage = document.getElementById('clock-deck-stage');
      const backing = ['::before', '::after'].map(pseudo => { const s = getComputedStyle(stage, pseudo); return { top: parseFloat(s.top), height: parseFloat(s.height), transform: s.transform }; });
      const points = {
        clock: { x: clock.left + 40, y: clock.top + 105, size: 20 },
        sheet: { x: sheet.right - 8, y: sheet.top + sheet.height / 2 },
        section: { x: section.right - 24, y: section.bottom - 12 }
      };
      // Single-surface transmission must sample wallpaper, not a legitimate
      // overlap with the clock/search/tiles behind the settings sheet. Inspect
      // real visible geometry, including a shadow/blur safety margin.
      const behindSheet = [...document.querySelectorAll('#content > *, .floating-btn, #todo-widget')]
        .filter(element => { const style = getComputedStyle(element); return element.getClientRects().length && style.visibility === 'visible' && Number(style.opacity) > 0; })
        .map(element => { const r = element.getBoundingClientRect(); return { name: element.id || element.className, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }; });
      for (const name of ['sheet', 'section']) {
        const point = points[name];
        const hit = document.elementFromPoint(point.x, point.y);
        if (!hit?.closest('#settings-panel')) throw Error(`${name} sample is outside the actual settings sheet`);
        if (name === 'section' && hit?.closest('.setting-section') !== document.getElementById('ui-opacity').closest('.setting-section')) throw Error('Section sample misses its intended fill');
      }
      for (const [dx, dy] of [[0, 0], [19, 0], [0, 19], [19, 19]]) {
        if (!document.elementFromPoint(points.clock.x + dx, points.clock.y + dy)?.closest('#clock-widget')) throw Error('Clock pixel sample is obscured');
      }
      if (getComputedStyle(document.getElementById('clock-widget'), '::before').display !== 'none') throw Error('Unmodelled clock foreground overlay');
      return { surfaces, samples, backing, stageHeight: stage.getBoundingClientRect().height, points, behindSheet };

    });
  }
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await worker.evaluate(async () => chrome.storage.local.set({ particlesEnabled: false, gradientFlow: false, minimalMode: false, iconFrameEnabled: true,
      background: { type: 'gradient', value: 'linear-gradient(#000, #000)', source: 'gradient' } }));
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
    await page.click('#settings-btn'); await page.waitForSelector('#settings-panel:not(.hidden)');
    await page.fill('#settings-search', 'opacity');
    for (const theme of ['light', 'dark']) {
      // Theme buttons are outside the filter; switch through their real handler.
      await page.fill('#settings-search', '');
      await page.locator(`.theme-mode-tab[data-theme="${theme}"]`).click();
      await waitForAsync(page, async theme => (await chrome.storage.local.get('themeMode')).themeMode === theme, theme);
      await page.fill('#settings-search', 'opacity');
      for (const opacity of [12, 32, 70]) for (const blur of [0, 10, 20]) {
        await setSlider('#ui-opacity', opacity, 'uiOpacity'); await setSlider('#ui-blur', blur, 'uiBlur');
        const report = await snapshot(); assertClearGlassSamples(report); report.theme = theme; report.setting = opacity; report.blur = blur;
        const alpha = .60 + opacity / 100 * .24;
        for (const selector of ['#clock-widget', '.settings-panel', '#todo-widget', '.floating-btn', '.group-tab', '.group-add-btn', '#scene-switcher .scene-trigger']) {
          const surface = report.surfaces[selector]; if (!surface) continue;
          // The first group is selected and intentionally adds a little tint.
          assert.ok(Math.abs(surface.background[3] - alpha) < .006 || (selector === '.group-tab' && Math.abs(surface.background[3] - alpha - .08) < .006), `${selector} tracks chosen opacity: ${JSON.stringify(surface)}`);
        }
        for (const selector of ['#clock-widget', '#search-widget', '.settings-panel', '#todo-widget', '.floating-btn', '.icon-widget[data-id]']) {
          const surface = report.surfaces[selector]; if (!surface) continue;
          assert.equal(surface.blur, `blur(${blur}px)`, `${selector} consumes live blur including zero`);
        }
        const oldCardAlpha = theme === 'light' ? opacity / 100 * .5 + .4 : opacity / 100 * .72 + .12;
        assert.ok(Math.abs(report.surfaces['#search-widget'].background[3] - oldCardAlpha) < .006, 'existing search alpha remains unchanged');
        for (const sample of report.samples) assert.ok(sample.ratio >= 4.5, `${theme}/${opacity}/${blur} ${sample.selector}: ${sample.ratio}`);
        assert.ok(report.backing[0].top >= report.stageHeight - 1, 'first backing begins below the front face');
        assert.ok(report.backing[1].top >= report.backing[0].top + report.backing[0].height - 1, 'backing strips never overlap');
        for (const backdrop of ['#000', '#fff']) {
          await background(backdrop);
          const sampled = await samplePng(await page.screenshot({ animations: 'disabled' }), report.points);
          pixels.set(`${theme}/${opacity}/${blur}/${backdrop}`, sampled);
        }
        for (const name of ['clock', 'sheet', 'section']) {
          const black = pixels.get(`${theme}/${opacity}/${blur}/#000`)[name], white = pixels.get(`${theme}/${opacity}/${blur}/#fff`)[name];
          assert.ok(Math.abs(white.mean - black.mean) > 20, `${theme}/${opacity}/${blur} ${name} genuinely reveals wallpaper, not an opaque backing`);
        }
        await background('repeating-linear-gradient(90deg, #000 0 4px, #fff 4px 8px)');
        const pattern = await page.screenshot({ path: path.join(artifacts, `glass-${theme}-${opacity}-${blur}.png`), animations: 'disabled' });
        report.pattern = await samplePng(pattern, report.points); reports.push(report);
      }
    }
    for (const theme of ['light', 'dark']) for (const opacity of [12, 32, 70]) {
      const sharp = reports.find(item => item.theme === theme && item.setting === opacity && item.blur === 0).pattern.clock.deviation;
      const blurred = reports.find(item => item.theme === theme && item.setting === opacity && item.blur === 20).pattern.clock.deviation;
      assert.ok(sharp > 10 && blurred < sharp * .35, `${theme}/${opacity}: pattern actually blurs (${sharp} → ${blurred})`);
    }
    for (const theme of ['light', 'dark']) for (const name of ['clock', 'sheet', 'section']) {
      const backdrop = theme === 'light' ? '#000' : '#fff';
      const values = [12, 32, 70].map(opacity => pixels.get(`${theme}/${opacity}/0/${backdrop}`)[name].mean);
      assert.ok(Math.abs(values[2] - values[0]) > 15, `${theme}/${name}: endpoints have visible pixel separation ${values}`);
      assert.ok(theme === 'light' ? values[0] < values[1] && values[1] < values[2] : values[0] > values[1] && values[1] > values[2], 'opacity has a monotonic visible effect');
    }
    // A saved endpoint must survive both warm reload and a newly opened tab.
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
    for (const target of [page, await page.context().newPage()]) {
      if (target !== page) { await target.goto(url); await ready(target); }
      assert.deepEqual(await target.evaluate(() => ({ opacity: getComputedStyle(document.documentElement).getPropertyValue('--ui-frame-opacity').trim(), blur: getComputedStyle(document.getElementById('clock-widget')).backdropFilter, mirror: OpenTabBoot.readMirror()?.uiOpacity })), { opacity: '0.70', blur: 'blur(20px)', mirror: 70 });
      if (target !== page) await target.close();
    }
    // Explicit fixture construction uses the existing schema, never a migration
    // added by this repair. Switching scene wallpapers must not reset globals.
    await page.evaluate(async () => {
      const raw = await chrome.storage.local.get(null), schema = OpenTabSceneSchema;
      let graph = schema.migrateLegacy(raw);
      graph = schema.create(graph, { id: 'glass-scene', name: 'Glass check', iconKey: 'home', homeGroupId: 'glass-home', homeName: 'Home', profile: { background: { type: 'gradient', value: 'linear-gradient(#fff, #fff)', source: 'gradient' } } });
      await chrome.storage.local.set(graph);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
    await page.locator('#scene-switcher .scene-trigger').click();
    await page.locator('.scene-dialog[open] [data-scene-id="glass-scene"] [data-scene-action="switch"]').click();
    await page.waitForFunction(() => OpenTabSceneNavigation.getView()?.sceneId === 'glass-scene');
    await ready(page);
    assert.deepEqual(await page.evaluate(() => ({ opacity: getComputedStyle(document.documentElement).getPropertyValue('--ui-frame-opacity').trim(), blur: getComputedStyle(document.getElementById('clock-widget')).backdropFilter })), { opacity: '0.70', blur: 'blur(20px)' });
    const stored = await worker.evaluate(() => chrome.storage.local.get(['uiOpacity', 'uiBlur', 'sceneProfiles']));
    assert.equal(stored.uiOpacity, 70); assert.equal(stored.uiBlur, 20);
    assert.ok(stored.sceneProfiles.every(profile => !Object.hasOwn(profile, 'uiOpacity') && !Object.hasOwn(profile, 'uiBlur')), 'opacity and blur remain global, never scene fields');
    fs.writeFileSync(path.join(artifacts, 'interface-glass.json'), JSON.stringify({ reports, pixels: Object.fromEntries(pixels) }, null, 2));
    console.log('Glass: real slider endpoints, black/white pixels, patterned blur, nested contrast, reload/new-tab persistence and global scene semantics passed.');
  } finally {
    await worker.evaluate(async original => { await chrome.storage.local.clear(); await chrome.storage.local.set(original); }, original);
    await page.evaluate(() => { sessionStorage.removeItem('opentab.scene.view'); localStorage.removeItem('opentab.scene.last'); });
    await page.emulateMedia({ reducedMotion: null }); await page.setViewportSize(viewport);
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
  }
}
