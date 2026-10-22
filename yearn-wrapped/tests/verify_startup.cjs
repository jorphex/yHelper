// Landing startup E2E: a complete first frame and a permanent, bounded fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, chromiumOptions, baseURL } = require('./browser.cjs');
const output = path.resolve(__dirname, '../data/verification/startup/failures');
fs.mkdirSync(output, { recursive: true });
const cases = ['slow-scene', 'slow-contour', 'slow-shared', 'late-scene', 'late-contour', 'failed-scene', 'no-webgl', 'slow-fonts', 'failed-main', 'no-js', 'reduced-motion'];

(async () => {
  const browser = await chromium.launch(chromiumOptions);
  const results = [];
  try {
    for (const variant of cases) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 },
        javaScriptEnabled: variant !== 'no-js', reducedMotion: variant === 'reduced-motion' ? 'reduce' : 'no-preference' });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await context.addInitScript(blockWebGL => {
        // Avoid unrelated wallet network work in startup/failure scenarios.
        window.ethereum = { request: async () => ['0x' + 'a'.repeat(40)] };
        window.__startup = [];
        window.__webglContexts = 0;
        window.__sceneRAF = 0;
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          if (/webgl/.test(type)) { window.__webglContexts++; if (blockWebGL) return null; }
          return getContext.call(this, type, ...args);
        };
        const raf = requestAnimationFrame;
        window.requestAnimationFrame = callback => {
          if (new Error().stack.includes('/vendor/scene/hero.js')) window.__sceneRAF++;
          return raf(callback);
        };
        setInterval(() => {
          if (!document.querySelector('#entry')) return;
          const visible = getComputedStyle(document.body).visibility !== 'hidden';
          const complete = ['.topbar', '.headline', '#entry'].every(selector => {
            const style = getComputedStyle(document.querySelector(selector));
            return style.visibility !== 'hidden' && Number(style.opacity) > .99 && style.filter === 'none';
          });
          window.__startup.push({ ms: performance.now(), visible, complete,
            mode: document.documentElement.dataset.presentation, scene: document.querySelector('#stage').classList.contains('is-rendered') });
        }, 20);
      }, variant === 'no-webgl');
      const delayed = ['slow-scene', 'late-scene'].includes(variant) ? '**/vendor/scene/hero.js'
        : ['slow-contour', 'late-contour'].includes(variant) ? '**/assets/yearn-symbol-contour.json'
        : variant === 'slow-shared' ? '**/vendor/scene/shared.js'
        : variant === 'slow-fonts' ? '**/assets/fonts/*.woff2' : null;
      if (delayed) await context.route(delayed, async route => {
        await new Promise(resolve => setTimeout(resolve, variant.startsWith('late-') ? 3400 : variant === 'slow-fonts' ? 2400 : 1100));
        await route.continue().catch(() => {});
      });
      if (variant === 'failed-scene') await context.route('**/vendor/scene/hero.js', route => route.abort());
      if (variant === 'failed-main') await context.route('**/main.js', route => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        if (variant !== 'no-js') await page.waitForFunction(() => ['3d', 'static'].includes(document.documentElement.dataset.presentation));
        await page.locator('#connect-btn').waitFor({ state: 'visible' });
        const initial = await page.evaluate(() => ({ mode: document.documentElement.dataset.presentation,
          font: getComputedStyle(document.querySelector('.headline')).fontFamily,
          mark: performance.getEntriesByName('wrapped-visible')[0]?.startTime }));
        const expect3D = ['slow-scene', 'slow-contour', 'slow-shared', 'slow-fonts', 'reduced-motion'].includes(variant);
        assert.equal(initial.mode, variant === 'no-js' ? undefined : expect3D ? '3d' : 'static', variant);
        if (delayed || variant === 'failed-main') assert(initial.mark < (variant === 'slow-fonts' || variant === 'failed-main' ? 1300 : 2850), `${variant}: presentation exceeded its budget (${initial.mark}ms)`);
        if (variant === 'slow-fonts') assert(!initial.font.includes('Aeonik'), 'Stalled fonts must not cause a late reflow');
        if (delayed) await page.waitForTimeout(2700);
        else await page.waitForTimeout(200);
        const final = await page.evaluate(() => ({ mode: document.documentElement.dataset.presentation,
          font: getComputedStyle(document.querySelector('.headline')).fontFamily,
          samples: window.__startup || [], webgl: window.__webglContexts, sceneRAF: window.__sceneRAF }));
        assert.equal(final.mode, initial.mode, 'Late graphics changed the selected background');
        assert.equal(final.font, initial.font, 'Late fonts changed the visible layout');
        assert(final.samples.filter(s => s.visible).every(s => s.complete), 'A partial UI became visible');
        assert(final.samples.filter(s => s.visible).every(s => s.scene === expect3D), 'Background changed after presentation');
        if (['late-scene', 'late-contour'].includes(variant)) assert.equal(final.webgl, 0, 'Late scene created an unseen renderer');
        if (!expect3D || variant === 'reduced-motion') assert.equal(final.sceneRAF || 0, 0, 'Unseen or reduced-motion scene kept rendering');
        if (!['failed-main', 'no-js'].includes(variant)) {
          await page.locator('#address-input').fill('invalid');
          await page.locator('#replay-btn').click();
          await page.waitForFunction(() => document.querySelector('#entry-status').textContent.includes("doesn't look like"));
        }
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(output, variant + '.png') });
        results.push({ variant, passed: true, presentation_ms: initial.mark, mode: initial.mode || 'no-js', scene_raf: final.sceneRAF || 0 });
      } finally {
        await context.tracing.stop({ path: path.join(output, variant + '-trace.zip') });
        await context.close();
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, base: baseURL, results }, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
