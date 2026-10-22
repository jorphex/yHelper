// Real cold/refresh loads, including constrained network/CPU; saves timings and traces.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, chromiumOptions, baseURL } = require('./browser.cjs');
const output = path.resolve(__dirname, '../data/verification/cold-start', process.env.STARTUP_MODE || 'after');
fs.mkdirSync(output, { recursive: true });
const profiles = [
  { name: 'desktop', width: 1440, height: 900, cpu: 1 },
  { name: 'mobile', width: 390, height: 844, cpu: 2, latency: 120, bytes: 375000 },
  { name: 'slower-cpu', width: 390, height: 844, cpu: 4, latency: 120, bytes: 375000 },
];

(async () => {
  const browser = await chromium.launch(chromiumOptions);
  const results = [];
  try {
    for (const profile of profiles) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height } });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await context.addInitScript(() => {
        window.startupFrames = [];
        const timer = setInterval(() => {
          if (!document.querySelector('#entry')) return;
          const visible = getComputedStyle(document.body).visibility !== 'hidden';
          const complete = ['.topbar', '.headline', '#entry'].every(selector => {
            const style = getComputedStyle(document.querySelector(selector));
            return style.visibility !== 'hidden' && Number(style.opacity) > .99 && style.filter === 'none';
          });
          window.startupFrames.push({ time: performance.now(), visible, complete, mode: document.documentElement.dataset.presentation });
          if (performance.now() > 6000) clearInterval(timer);
        }, 20);
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      if (profile.bytes) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency,
        downloadThroughput: profile.bytes, uploadThroughput: profile.bytes });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const pass of ['cold', 'refresh']) {
        if (pass === 'cold') await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        else await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => ['3d', 'static'].includes(document.documentElement.dataset.presentation));
        await page.waitForTimeout(1800);
        const result = await page.evaluate(() => ({
          mode: document.documentElement.dataset.presentation,
          visible: performance.getEntriesByName('wrapped-visible')[0]?.startTime,
          frames: window.startupFrames,
          assets: performance.getEntriesByType('resource').filter(e => /vendor\/scene|contour|walletconnect\.js|main\.js|woff2/.test(e.name))
            .map(e => ({ name: e.name.split('/').pop(), start: e.startTime, end: e.responseEnd, bytes: e.transferSize })),
        }));
        assert.equal(result.mode, '3d', `${profile.name} ${pass}: scene missed the first visit`);
        assert(result.visible < 3000, `${profile.name}: first presentation exceeded the bounded window`);
        assert(result.frames.filter(f => f.visible).every(f => f.complete && f.mode === '3d'), 'Incomplete UI or background switch');
        const hero = result.assets.find(e => e.name === 'hero.js');
        const shared = result.assets.find(e => e.name === 'shared.js');
        assert(shared && shared.start <= hero.start + 100, `${profile.name} ${pass}: shared dependency was discovered late: ${JSON.stringify({ shared, hero })}`);
        const wallet = result.assets.find(e => e.name === 'walletconnect.js');
        if (wallet) assert(wallet.start >= result.visible, 'Wallet download competed with the first scene');
        // Address entry must be usable on that first visit too.
        await page.locator('#address-input').fill('invalid');
        await page.locator('#replay-btn').click();
        await page.waitForFunction(() => document.querySelector('#entry-status').textContent.includes("doesn't look like"));
        await page.screenshot({ path: path.join(output, `${profile.name}-${pass}.png`) });
        results.push({ profile: profile.name, pass, ...result });
      }
      assert.deepEqual(errors, []);
      await context.tracing.stop({ path: path.join(output, `${profile.name}-trace.zip`) });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, baseURL, results }, null, 2));
    console.log(JSON.stringify(results.map(({ frames, assets, ...result }) => result), null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
