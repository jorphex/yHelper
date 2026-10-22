// Exercise the real document boundary with fast/slow data and graphics.
// Writes timings, screenshots, a Playwright trace and a video for each case.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, chromiumOptions, baseURL } = require('./browser.cjs');
const output = path.resolve(process.env.HANDOFF_OUTPUT || 'data/verification/handoff/after');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../site/assets/sample-recap.json')));
const variants = process.env.HANDOFF_VARIANTS?.split(',') || ['cached', 'loading', 'mobile', 'mobile-network', 'slow-document', 'stalled-transition', 'slow-graphics', 'slow-contour', 'slow-replay', 'failed-graphics', 'no-webgl', 'reduced-motion', 'failed-data', 'direct'];
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browserName = process.env.YEARN_WRAPPED_BROWSER || 'chromium';
  const browser = await (browserName === 'firefox' ? firefox.launch({ headless: true }) : chromium.launch(chromiumOptions));
  const results = [];
  try {
    for (const variant of variants) {
      const folder = path.join(output, variant);
      fs.mkdirSync(folder, { recursive: true });
      const viewport = variant.startsWith('mobile') ? { width: 390, height: 844 } : { width: 960, height: 720 };
      const context = await browser.newContext({ viewport, reducedMotion: variant === 'reduced-motion' ? 'reduce' : 'no-preference', recordVideo: { dir: folder, size: viewport } });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const samples = [], errors = [], violations = [];
      await context.exposeBinding('recordHandoff', (_source, sample) => samples.push(sample));
      await context.addInitScript(noWebGL => {
        window.ethereum = { request: async () => ['0x' + 'a'.repeat(40)] };
        let bootFrames = 0;
        const raf = requestAnimationFrame;
        window.requestAnimationFrame = callback => {
          const boot = new Error().stack.includes('/vendor/scene/boot3d.js');
          return raf(time => { if (boot) bootFrames++; callback(time); });
        };
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          if (/webgl/.test(type)) {
            if (this.id === 'boot-stage') window.__gpuCover = Number(getComputedStyle(document.querySelector('.launch-flash')).opacity);
            if (noWebGL) return null;
          }
          return get.call(this, type, ...args);
        };
        const sample = () => {
          if (!document.body || !document.querySelector('.launch-flash, #boot')) return;
          const flash = document.querySelector('.launch-flash');
          const boot = document.getElementById('boot');
          const css = node => node && getComputedStyle(node);
          window.recordHandoff({ time: performance.timeOrigin + performance.now(), doc: location.pathname.endsWith('replay.html') ? 'replay' : 'landing',
            launching: document.body.classList.contains('launching'), curtain: flash ? Number(css(flash).opacity) : null,
            opaque: flash ? /rgb\(10, 10, 10\)$/.test(css(flash).background) || css(flash).backgroundColor === 'rgb(10, 10, 10)' : false,
            bodyOpacity: Number(css(document.body).opacity), done: boot?.classList.contains('done'), bootOpacity: boot ? Number(css(boot).opacity) : null,
            stage: !!document.querySelector('#boot-stage.is-3d'), bootFrames, bodyY: window.__bootStage?.debug().y, gpuCover: window.__gpuCover,
            bootBackground: boot && css(boot).backgroundColor, circularCover: flash && css(flash).backgroundImage.includes('radial-gradient'),
            fallbackMark: !!document.querySelector('.boot-fallback'), legacySpinner: !!document.querySelector('.boot-orbit'),
            active: !!document.querySelector('.card.active') }).catch(() => {});
        };
        setInterval(sample, 20);
        addEventListener('pagehide', sample);
      }, variant === 'no-webgl');
      const delay = variant === 'cached' ? 0 : 4200;
      await context.route('**/api/recap?*', async route => {
        await new Promise(resolve => setTimeout(resolve, delay));
        await route.fulfill(variant === 'failed-data' ? { status: 502, body: '{}' } : { json: fixture }).catch(() => {});
      });
      if (variant === 'slow-document') await context.route('**/replay.html?*', async route => {
        if (route.request().isNavigationRequest()) await new Promise(resolve => setTimeout(resolve, 700));
        await route.continue();
      });
      if (variant === 'slow-graphics') await context.route('**/vendor/scene/boot3d.js', async route => {
        await new Promise(resolve => setTimeout(resolve, 1400)); await route.continue().catch(() => {});
      });
      if (variant === 'failed-graphics') await context.route('**/vendor/scene/boot3d.js', route => route.abort());
      if (variant === 'slow-replay') await context.route('**/replay.js', async route => {
        await new Promise(resolve => setTimeout(resolve, 1400)); await route.continue();
      });
      if (variant === 'slow-contour') {
        let requests = 0;
        await context.route('**/assets/yearn-symbol-contour.json', async route => {
          if (++requests > 1) await new Promise(resolve => setTimeout(resolve, 1400));
          await route.continue().catch(() => {});
        });
      }
      const page = await context.newPage();
      if (variant === 'mobile-network' && browserName === 'chromium') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: 375000, uploadThroughput: 375000 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
      }
      page.on('pageerror', error => errors.push(error.message));
      let clickedAt;
      try {
        if (variant === 'direct') {
          clickedAt = Date.now();
          await page.goto(baseURL + 'replay.html?address=' + fixture.address, { waitUntil: 'domcontentloaded' });
        } else {
          await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => ['3d', 'static'].includes(document.documentElement.dataset.presentation));
          if (variant === 'stalled-transition') await page.addStyleTag({ content: '.launch-flash { transition-duration: 2s !important; }' });
          await page.locator('#address-input').fill(fixture.address);
          await page.locator('#replay-btn').click();
          clickedAt = Date.now();
          await page.waitForURL('**/replay.html?*');
        }
        await page.waitForTimeout(650);
        await page.screenshot({ path: path.join(folder, 'arrival.png') });
        await page.waitForSelector('.card.active');
        await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('boot')).opacity) === 0);
        await page.waitForTimeout(750);
        await page.screenshot({ path: path.join(folder, 'recap.png') });
        assert.deepEqual(errors, [], `${variant}: browser errors`);
        const before = samples.filter(s => s.doc === 'landing' && s.launching);
        const after = samples.filter(s => s.doc === 'replay');
        const first = after[0];
        const check = (ok, why) => { if (!ok) violations.push(why); };
        if (variant !== 'direct') {
          check(before.some(s => s.curtain === 1 && s.opaque), 'depart before the scene is fully covered');
          check(first?.curtain === 1 && first.bodyOpacity === 1, 'incoming document does not paint the same covered frame first');
          const opening = after.findIndex(s => s.curtain < 1);
          check(opening >= 0 && after.slice(opening).every(s => s.curtain <= after[opening].curtain + .03), 'curtain flashes back during arrival');
        } else check(after.every(s => !s.curtain), 'direct entry replays the launch effect');
        if (variant === 'cached') check(!after.some(s => !s.done && s.curtain < 1), 'cached recap flashes a loader');
        if (['failed-graphics', 'no-webgl'].includes(variant)) check(!after.some(s => s.stage), 'failed graphics create a loader');
        const loading = after.filter(s => !s.done);
        check(loading.every(s => !s.legacySpinner), 'legacy spinner returned');
        check(loading.every(s => s.fallbackMark), 'missing stable Yearn-mark fallback');
        check(loading.every(s => s.bootBackground === 'rgba(0, 0, 0, 0)'), 'loading overlay hides the atmospheric background');
        check([...before, ...after].every(s => !s.circularCover), 'detached circular transition glow');
        check(after.every(s => s.gpuCover === undefined || s.gpuCover < .01), 'loader GPU preparation interrupts the arrival fade');
        if (browserName === 'chromium' && !['cached', 'failed-graphics', 'no-webgl'].includes(variant)) {
          const frames = loading.filter(s => s.stage);
          check(frames.length > 3, 'WebGL device never receives its 3D loader');
          if (variant !== 'reduced-motion') check(Math.max(...frames.map(s => s.bodyY)) - Math.min(...frames.map(s => s.bodyY)) > .02, '3D loader does not bounce');
        }
        const fading = after.filter(s => s.done && s.bootOpacity > .05 && s.bootOpacity < .95);
        if (fading.some(s => s.stage) && variant !== 'reduced-motion') check(fading.at(-1).bootFrames > fading[0].bootFrames, '3D loader stops while its fade is still visible');
        const finished = after.filter(s => s.done && s.bootOpacity === 0);
        if (finished.length > 5) check(finished.at(-1).bootFrames <= finished[3].bootFrames + 1, 'hidden loader keeps rendering');
        check(after.some(s => s.active && s.bootOpacity === 0), 'recap never becomes visible');
        check(after.find(s => s.curtain < 1)?.time - first?.time < 1400, 'incoming curtain exceeds its readiness budget');
        results.push({ variant, passed: !violations.length, clickedAt, video: path.relative(output, await page.video().path()), violations, errors, samples });
      } finally {
        await context.tracing.stop({ path: path.join(folder, 'trace.zip') });
        await context.close();
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: browserName, baseURL, results }, null, 2));
  console.log(JSON.stringify(results.map(({ variant, passed, violations }) => ({ variant, passed, violations })), null, 2));
  if (!process.env.HANDOFF_OBSERVE) assert(results.every(r => r.passed), 'handoff checks failed; inspect videos, traces and results');
})().catch(error => { console.error(error); process.exitCode = 1; });
