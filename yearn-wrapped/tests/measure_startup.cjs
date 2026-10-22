// Cold-load presentation evidence. MODE identifies before/after without changing the page.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium, chromiumOptions, baseURL } = require('./browser.cjs');
const mode = process.env.STARTUP_MODE || 'before';
const output = path.resolve(__dirname, '../data/verification/startup', mode);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch(chromiumOptions);
  const results = [];
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await context.addInitScript(() => {
        window.__startup = [];
        const start = performance.now();
        const timer = setInterval(() => {
          const stage = document.querySelector('#stage'), entry = document.querySelector('#entry'), line = document.querySelector('.hl-line');
          if (!stage || !entry || !line) return;
          const visible = getComputedStyle(document.body).visibility !== 'hidden' && Number(getComputedStyle(document.body).opacity) > .01;
          window.__startup.push({ ms: Math.round(performance.now()-start), visible,
            entry: visible && Number(getComputedStyle(entry).opacity) > .95 && getComputedStyle(entry).filter === 'none',
            title: visible && !getComputedStyle(line).clipPath.includes('100%'),
            scene: stage.classList.contains('is-rendered'),
            fallback: visible && !stage.classList.contains('is-rendered'),
            state: document.documentElement.dataset.presentation || null,
          });
          if (performance.now()-start > 5000) clearInterval(timer);
        }, 20);
      });
      const page = await context.newPage();
      const requests = [];
      page.on('request', req => requests.push(req.url()));
      await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5500);
      const samples = await page.evaluate(() => window.__startup);
      const presentation = await page.evaluate(() => performance.getEntriesByName('wrapped-visible')[0]?.startTime);
      const first = predicate => samples.find(predicate)?.ms ?? null;
      const result = { mobile, presentation_ms: presentation, first_background_ms: first(s=>s.visible), complete_ui_ms:first(s=>s.entry&&s.title), scene_ms:first(s=>s.visible&&s.scene), fallback_ms:first(s=>s.fallback), transitions:[...new Set(samples.filter(s=>s.visible).map(s=>s.scene?'3d':'static'))], external_graphics_requests:requests.filter(u=>u.includes('cdn.jsdelivr.net')), samples };
      if (mode !== 'before') {
        assert(samples.some(s=>s.visible), 'Page never became visible');
        assert(samples.filter(s=>s.visible).every(s=>s.entry&&s.title), 'Partial UI became visible');
        assert.deepEqual(result.transitions, ['3d'], 'Healthy cold load did not present a single complete 3D scene');
        assert.equal(result.external_graphics_requests.length, 0);
      }
      results.push(result);
      await page.screenshot({ path: path.join(output, mobile?'mobile.png':'desktop.png') });
      await context.tracing.stop({ path: path.join(output, mobile?'mobile-trace.zip':'desktop-trace.zip') });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'timing.json'), JSON.stringify(results,null,2));
    console.log(JSON.stringify(results.map(({samples,external_graphics_requests,...r})=>({...r,external_graphics_requests:external_graphics_requests.length})),null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
