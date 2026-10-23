import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run in the real installed extension, with production CSS and Flatpickr markup.
// Black/white backdrops bound alpha compositing; busy wallpaper checks layering.
export async function verifyWallpaperReadability(page, artifacts) {
  await page.waitForSelector('.group-tab');
  const originalViewport = page.viewportSize();
  const originalClass = await page.getAttribute('body', 'class');
  const reports = [];
  const originalBackdrop = await page.getAttribute('#background-layer', 'style');
  const originalBodyStyle = await page.getAttribute('body', 'style');
  const originalRootStyle = await page.getAttribute('html', 'style');
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' }).then(node => node.evaluate(el => { el.id = 'readability-no-motion'; }));
  try {
    for (const theme of ['light', 'dark']) for (const width of [1280, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => {
        document.body.classList.toggle('theme-light', theme === 'light');
        OpenTabBoot.applyUiOpacity(12);
        document.querySelector('#background-layer').style.background = 'repeating-conic-gradient(#fff 0% 25%, #051326 0% 50%) 0 0 / 24px 24px';
      }, theme);
      await page.locator('#calendar-popover').evaluate(el => el.classList.add('hidden'));
      await page.locator('.group-tab').first().hover();
      await page.keyboard.press('Tab');
      await page.locator('.group-tab').first().focus();
      const groupState = await page.locator('.group-tab').first().evaluate(el => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, image: style.backgroundImage, color: style.color, outline: style.outlineStyle, width: style.outlineWidth, hovered: el.matches(':hover'), focused: el.matches(':focus-visible') };
      });
      assert.equal(groupState.hovered, true, 'group hover state is exercised');
      assert.equal(groupState.focused, true, 'group keyboard focus state is exercised');
      assert.equal(groupState.outline, 'solid', 'group keyboard focus has a visible outline');
      assert.equal(groupState.width, '2px');
      await page.screenshot({ path: path.join(artifacts, `wallpaper-groups-${theme}-${width}.png`), animations: 'disabled' });
      await page.locator('#calendar-popover').evaluate(el => el.classList.remove('hidden'));
      const report = await page.evaluate(() => {
        const rgba = value => {
          const nums = value.match(/[\d.]+/g)?.map(Number);
          if (!nums || nums.length < 3) throw Error(`Unsupported color: ${value}`);
          return [...nums.slice(0, 3), nums[3] ?? 1];
        };
        const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
        const lum = color => color.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
        const samples = [];
        function sample(el, label, root) {
          const chain = []; let node = el;
          while (node && node !== root.parentElement) { chain.unshift(node); node = node.parentElement; }
          for (const backdrop of [[0, 0, 0], [255, 255, 255]]) {
            let bg = backdrop;
            for (const item of chain) {
              const style = getComputedStyle(item);
              bg = over(rgba(style.backgroundColor), bg);
              // Local state backgrounds use a uniform two-stop overlay, not a spatial gradient.
              const overlay = style.backgroundImage.match(/^linear-gradient\((rgba?\([^)]+\))/);
              if (overlay) bg = over(rgba(overlay[1]), bg);
            }
            const style = getComputedStyle(el);
            samples.push({ label, backdrop, ratio: ratio(over(rgba(style.color), bg), bg) });
          }
        }
        const group = document.querySelector('.group-tab');
        const wasActive = group.classList.contains('active');
        for (const active of [false, true]) {
          group.classList.toggle('active', active);
          sample(group, `group-${active ? 'active' : 'inactive'}`, group);
          const count = group.querySelector('.group-tab-count');
          if (count) sample(count, 'group-count', group);
        }
        group.classList.toggle('active', wasActive);
        sample(document.querySelector('.group-add-btn'), 'group-add', document.querySelector('.group-add-btn'));
        const panel = document.querySelector('#calendar-popover');
        for (const selector of ['.flatpickr-weekday', '.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay):not(.selected)', '.flatpickr-day.prevMonthDay', '.flatpickr-day.selected', '.calendar-legend']) {
          const el = panel.querySelector(selector); if (el) sample(el, selector, panel);
        }
        // Exercise both annotation colors even when this month's dates lack one.
        const normal = panel.querySelector('.flatpickr-day:not(.selected):not(.prevMonthDay):not(.nextMonthDay)');
        for (const kind of ['holiday', 'solar-term']) {
          const clone = normal.cloneNode(true); clone.classList.add(`has-${kind}`);
          clone.innerHTML = '8<span class="fp-meta">Test</span>'; normal.parentElement.append(clone);
          sample(clone.querySelector('.fp-meta'), kind, panel);
          clone.classList.add('selected'); sample(clone.querySelector('.fp-meta'), `selected-${kind}`, panel); clone.remove();
        }
        const panelRect = panel.getBoundingClientRect();
        const daysRect = panel.querySelector('.flatpickr-days').getBoundingClientRect();
        // Recreate the user's overlap without changing stacking contexts.
        const bar = document.querySelector('#group-tabs-bar'); const saved = bar.getAttribute('style');
        const rect = bar.getBoundingClientRect();
        bar.style.transform = `translateY(${panelRect.top + 120 - rect.top}px)`;
        const top = document.elementFromPoint(panelRect.left + panelRect.width / 2, panelRect.top + 125);
        const calendarOnTop = !!top?.closest('#calendar-popover');
        if (saved === null) bar.removeAttribute('style'); else bar.setAttribute('style', saved);
        return { samples, calendarOnTop, panel: { left: panelRect.left, right: panelRect.right }, days: { left: daysRect.left, right: daysRect.right }, viewport: innerWidth };
      });
      assert.equal(report.calendarOnTop, true, 'calendar paints above overlapping group tabs');
      assert.ok(report.panel.left >= 0 && report.panel.right <= width, 'calendar stays in viewport');
      assert.ok(report.days.left >= report.panel.left && report.days.right <= report.panel.right, 'narrow date grid stays inside calendar');
      for (const sample of report.samples) assert.ok(sample.ratio >= 4.5, `${theme}/${width} ${sample.label}: ${sample.ratio.toFixed(2)}:1`);
      reports.push({ theme, width, groupState, ...report });
      await page.screenshot({ path: path.join(artifacts, `wallpaper-readability-${theme}-${width}.png`), animations: 'disabled' });
    }
    fs.writeFileSync(path.join(artifacts, 'wallpaper-readability.json'), JSON.stringify(reports, null, 2));
  } finally {
    await page.evaluate(({ original, originalBackdrop, originalBodyStyle, originalRootStyle }) => {
      document.body.className = original || '';
      if (originalRootStyle === null) document.documentElement.removeAttribute('style'); else document.documentElement.setAttribute('style', originalRootStyle);
      if (originalBodyStyle === null) document.body.removeAttribute('style'); else document.body.setAttribute('style', originalBodyStyle);
      const backdrop = document.querySelector('#background-layer');
      if (originalBackdrop === null) backdrop.removeAttribute('style'); else backdrop.setAttribute('style', originalBackdrop);
      document.querySelector('#readability-no-motion')?.remove();
    }, { original: originalClass, originalBackdrop, originalBodyStyle, originalRootStyle });
    await page.setViewportSize(originalViewport);
  }
}
