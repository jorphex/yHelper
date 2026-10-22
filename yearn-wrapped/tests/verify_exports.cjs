// Save every real slide through the UI and compare its text, colors and geometry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, baseURL, chromiumOptions } = require('./browser.cjs');
const output = process.env.EXPORT_OUTPUT || path.resolve(__dirname, '../data/verification/layout-review/after');
const fixture = process.env.RECAP_FIXTURE || path.resolve(__dirname, '../site/assets/sample-recap.json');
const normalize = value => String(value).replace(/\s+/g, ' ').trim().toLowerCase();
const headingGeometry = el => {
  const center = node => { const box = node.getBoundingClientRect(); return box.x + box.width / 2; };
  const title = el.querySelector('.card-title');
  const stamp = el.querySelector('.stamp');
  return { titleCentered: Math.abs(center(title) - center(el)) < 1,
    stampCentered: !stamp || Math.abs(center(stamp) - center(el)) < 1,
    separateRows: !stamp || stamp.getBoundingClientRect().top > title.getBoundingClientRect().bottom + 2 };
};
fs.mkdirSync(output, { recursive: true });

(async () => {
  const useFirefox = process.env.YEARN_WRAPPED_BROWSER === 'firefox';
  const browser = await (useFirefox ? firefox.launch({ headless: true }) : chromium.launch(chromiumOptions));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.exportInk = [];
    window.exportImages = [];
    window.exportRects = [];
    const rect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function(x, y, width, height) {
      if (this.canvas.width === 1200 && this.canvas.height === 630) window.exportRects.push({ x, y, width, height, color: String(this.fillStyle) });
      return rect.call(this, x, y, width, height);
    };
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
      if (this.canvas.width === 1200 && this.canvas.height === 630) {
        const m = this.measureText(text);
        const transform = this.getTransform();
        const corners = [[x - m.actualBoundingBoxLeft, y - m.actualBoundingBoxAscent],
          [x + m.actualBoundingBoxRight, y - m.actualBoundingBoxAscent],
          [x - m.actualBoundingBoxLeft, y + m.actualBoundingBoxDescent],
          [x + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent]]
          .map(([cx, cy]) => new DOMPoint(cx, cy).matrixTransform(transform));
        window.exportInk.push({ text: String(text), color: String(this.fillStyle), font: this.font,
          left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
          top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) });
      }
      return original.call(this, text, x, y, ...rest);
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
      if (this.canvas.width === 1200 && this.canvas.height === 630) window.exportImages.push(image.src);
      return draw.call(this, image, ...args);
    };
  });
  const results = [];
  try {
    const payload = JSON.parse(fs.readFileSync(fixture));
    await page.route('**/api/recap?*', route => route.fulfill({ json: payload }));
    await page.goto(baseURL + 'replay.html?address=' + payload.address);
    await page.waitForSelector('.card.active');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('boot')).opacity === '0');
    await page.evaluate(() => document.fonts.ready);
    const actions = await page.locator('.recap-action').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      const label = button.querySelector('.btn-label');
      const icon = button.querySelector('.action-icon');
      return { name: button.getAttribute('aria-label'), title: button.title, width: box.width, height: box.height,
        icon: !!icon && icon.getBoundingClientRect().width >= 18,
        labelHidden: label.getBoundingClientRect().width <= 1 && getComputedStyle(label).clipPath === 'inset(50%)' };
    }));
    assert.equal(actions.length, 3);
    assert(actions.every(action => action.name && action.title && action.icon && action.labelHidden && action.width === 44 && action.height === 44), 'compact icon buttons retain labels and 44px targets');
    const total = await page.locator('.card').count();
    for (let i = 0; i < total; i++) {
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.card.active')).opacity) > 0.99);
      if (i === 0) {
        for (const action of ['copy', 'download', 'post']) assert(await page.locator(`[data-action="${action}"]`).isDisabled(), 'identity card must not be shareable');
        await page.locator('.recap-action').evaluateAll(buttons => buttons.forEach(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true }))));
        await page.waitForTimeout(150);
        assert.deepEqual(await page.evaluate(() => window.exportInk), [], 'synthetic clicks must not export identity');
        await page.screenshot({ path: path.join(output, '1-private-slide.png') });
        results.push({ slide: 1, private: true, actions_disabled: true });
        await page.locator('#deck').focus(); await page.keyboard.press('ArrowRight');
        continue;
      }
      assert(await page.locator('[data-action="download"]').isEnabled());
      const expected = await page.locator('.card.active').evaluate(el => {
        const text = selector => el.querySelector(selector)?.textContent.trim().replace(/\s+/g, ' ') || '';
        const color = selector => { const node = el.querySelector(selector); return node ? getComputedStyle(node).color : ''; };
        const counter = el.querySelector('.card-big[data-count]');
        const count = counter && Number(counter.dataset.count);
        const big = counter ? (counter.dataset.money === '1' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(count)
          : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(count) + (counter.dataset.suffix || '')) : text('.card-big');
        return { title: text('.card-title'), big, line: text('.card-line'),
          sub: el.querySelector('.card-sub a') || text('.card-title') === 'your wallet' ? '' : text('.card-sub'),
          quip: text('.card-quip'), stamp: text('.stamp'), chartTitle: text('.spark-title'),
          details: [...el.querySelectorAll('.card-list li')].flatMap(li => li.children.length ? [...li.children].map(n => n.textContent.trim()) : [li.textContent.trim()]),
          monthly: el.querySelectorAll('.bar-col').length, hours: el.querySelectorAll('.hours i').length,
          colors: { title: color('.card-title'), line: color('.card-line'), sub: color('.card-sub'), quip: color('.card-quip'), stamp: color('.stamp') },
          dual: el.dataset.spark ? JSON.parse(el.dataset.spark).second?.length > 1 : false,
          stats: [...el.querySelectorAll('.card-stat')].map(s => ({ value: s.querySelector('.stat-value').textContent.trim(), label: s.querySelector('.stat-label').textContent.trim(), color: getComputedStyle(s.querySelector('.stat-value')).color })) };
      });
      const alignment = await page.locator('.card.active').evaluate(el => [...el.querySelectorAll('.card-stat')].every(stat => {
        const center = node => { const r = node.getBoundingClientRect(); return r.x + r.width / 2; };
        return [...stat.children].every(child => Math.abs(center(child) - center(stat)) < 1);
      }));
      assert(alignment, expected.title + ': supporting text must be centered');
      const heading = await page.locator('.card.active').evaluate(headingGeometry);
      assert(Object.values(heading).every(Boolean), expected.title + ': title and sticker independently centered on separate rows');
      assert(await page.locator('.card.active .card-list').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none' && Number(getComputedStyle(node).opacity) === 1)), 'reduced-motion lists must be immediately readable');
      if (expected.title === 'longest holding streak') {
        assert(expected.stats.some(s => /\d{2}\/\d{2}–\d{2}\/\d{2}/.test(s.value)), 'compact holding window');
        const rows = await page.locator('.card.active .stat-value').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().bottom));
        assert(Math.max(...rows) - Math.min(...rows) < 2, 'holding window stays on the stats row');
      }
      await page.evaluate(() => { window.exportInk = []; window.exportImages = []; window.exportRects = []; });
      const download = page.waitForEvent('download');
      await page.locator('[data-action="download"]').click();
      await (await download).saveAs(path.join(output, `${i + 1}-export.png`));
      const ink = await page.evaluate(() => window.exportInk);
      const images = await page.evaluate(() => window.exportImages);
      const rects = await page.evaluate(() => window.exportRects);
      assert(images.some(src => src.endsWith('/assets/yearn-wrapped-lockup.svg')), 'export must use shared vector lockup');
      const rendered = normalize(ink.map(item => item.text).join(' '));
      const market = expected.title === 'the year outside';
      const colorHex = css => '#' + css.match(/[\d.]+/g).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
      const hasText = text => assert(rendered.includes(normalize(text)), `${expected.title}: missing ${text}`);
      hasText(expected.title);
      if (!/^0x/.test(expected.big)) hasText(expected.big);
      for (const part of market ? [] : ['line', 'sub', 'quip', 'stamp', 'chartTitle']) if (expected[part]) hasText(expected[part]);
      if (!market) expected.details.forEach(hasText);
      if (expected.monthly) {
        hasText('Deposits'); hasText('Exits');
        const activeBars = payload.cards.depositsWithdrawn.monthly.reduce((sum, row) => sum + Number(row.deposits > 0) + Number(row.withdrawals > 0), 0);
        assert.equal(rects.filter(r => r.width <= 80 && r.height > 0).length, activeBars, 'nonzero monthly bars exported');
      }
      if (expected.hours) {
        hasText('Activity by hour · local time');
        assert(rects.filter(r => r.width < 30 && r.height >= 2).length >= expected.hours, 'hourly chart exported');
      }
      const stats = market ? expected.stats.slice(0, 2) : expected.stats;
      for (const stat of stats) {
        hasText(stat.value); hasText(stat.label);
        assert(ink.some(item => normalize(item.text) === normalize(stat.value) && item.color === colorHex(stat.color)), `stat color: ${stat.value}`);
      }
      assert(ink.some(item => normalize(item.text) === normalize(expected.title) && item.color === colorHex(expected.colors.title)), 'title scene color');
      const titleInk = ink.find(item => normalize(item.text) === normalize(expected.title));
      assert(Math.abs((titleInk.left + titleInk.right) / 2 - 600) < 5, expected.title + ': export title centered independently');
      if (expected.stamp && !market) {
        const stamp = ink.find(item => normalize(item.text) === normalize(expected.stamp));
        assert(Math.abs((stamp.left + stamp.right) / 2 - 600) < 5 && stamp.top > titleInk.bottom + 5 && stamp.top - titleInk.bottom < 40, 'export sticker centered closely below the topic');
      }
      if (expected.quip && !market) assert(ink.some(item => item.color === colorHex(expected.colors.quip) && normalize(expected.quip).includes(normalize(item.text))), 'quip tone');
      if (market) {
        assert(ink.map(item => item.text).join(' ').split(/\s+/).length <= 48, 'ETH image reading budget');
        if (expected.quip) assert(!rendered.includes(normalize(expected.quip)), 'ETH image must omit the long aside');
        if (expected.dual) assert(rendered.includes('each line uses its own scale'), 'dual chart scale disclosure');
      }
      for (const item of ink) {
        assert(item.left >= 42 && item.right <= 1158 && item.top >= 30 && item.bottom <= 598,
          `${expected.title}: clipped text ${JSON.stringify(item)}`);
      }
      for (let a = 0; a < ink.length; a++) for (let b = a + 1; b < ink.length; b++) {
        const p = ink[a], q = ink[b];
        const overlap = Math.min(p.right, q.right) - Math.max(p.left, q.left) > 2 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 2;
        assert(!overlap, `${expected.title}: text collision ${p.text} / ${q.text}`);
      }
      assert(!rendered.includes(payload.address.toLowerCase()), 'wallet privacy');
      const png = fs.readFileSync(path.join(output, `${i + 1}-export.png`));
      assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
      await page.screenshot({ path: path.join(output, `${i + 1}-slide.png`) });
      results.push({ slide: i + 1, ...expected, ink });
      await page.locator('#deck').focus();
      if (i < total - 1) await page.keyboard.press('ArrowRight');
    }
    const closing = results.at(-1);
    assert(closing.stats.length >= 2 && !closing.big.includes('next harvest'), 'closing image must summarize actual metrics');
    assert.match(closing.sub, /as of/);
    if (payload.cards.vaultGrowth?.isComplete && Math.abs(payload.cards.vaultGrowth.totalGrowthUsd) >= 0.01) {
      assert.match(closing.line, /vault yield earned/);
      assert.equal(closing.big, new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(payload.cards.vaultGrowth.totalGrowthUsd));
    }
    await page.locator('#deck').focus(); await page.keyboard.press('Home');
    assert(await page.locator('[data-action="copy"]').isDisabled(), 'returning to identity disables sharing again');
    await page.keyboard.press('End');
    assert(await page.locator('[data-action="copy"]').isEnabled(), 'summary remains shareable');
    assert.deepEqual(errors, []);
    // Both entry points use the identical vector at the same apparent height.
    const mobile = [];
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
      for (const url of ['index.html', 'replay.html?address=' + payload.address]) {
        await page.goto(baseURL + url);
        await page.waitForSelector('.brand-lockup');
        const box = await page.locator('.brand-lockup').boundingBox();
        assert.equal(box.height, 24);
        assert(box.x >= 0 && box.x + box.width <= width);
        await page.screenshot({ path: path.join(output, `brand-${width}-${url.startsWith('index') ? 'entry' : 'deck'}.png`) });
        if (width <= 390 && url.startsWith('replay')) {
          await page.waitForSelector('.card.active');
          await page.waitForFunction(() => getComputedStyle(document.getElementById('boot')).opacity === '0');
          await page.locator('#deck').focus();
          for (let i = 0; i < total; i++) {
            if (i) await page.keyboard.press('ArrowRight');
            await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.card.active')).opacity) > 0.99);
            const geometry = await page.locator('.card.active').evaluate(el => {
              const rows = [...el.querySelectorAll('.stat-value')].map(node => node.getBoundingClientRect().bottom);
              return { title: el.querySelector('.card-title').textContent, sideways: document.documentElement.scrollWidth > innerWidth,
                streakRow: !el.classList.contains('is-streak') || !rows.length || Math.max(...rows) - Math.min(...rows) < 2 };
            });
            const heading = await page.locator('.card.active').evaluate(headingGeometry);
            assert(Object.values(heading).every(Boolean), `${width}px ${geometry.title}: title or sticker alignment`);
            assert(!geometry.sideways && geometry.streakRow, `${width}px ${geometry.title}: reflow or holding-window row`);
            if (['your wallet', 'first activity', 'vaults explored', 'deposits made', 'longest holding streak', 'how you move'].includes(geometry.title) || i === total - 1) {
              await page.screenshot({ path: path.join(output, `${width}-${i + 1}-slide.png`) });
            }
            mobile.push({ width, slide: i + 1, ...geometry });
          }
        }
      }
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, browser: useFirefox ? 'firefox' : 'chromium', slides: results, mobile, errors }, null, 2));
    console.log(`Private intro and ${total - 1} slide/export pairs passed: alignment, graphics, summary, colors, bounds, privacy, PNG size.`);
  } finally {
    await context.tracing.stop({ path: path.join(output, 'trace.zip') });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
