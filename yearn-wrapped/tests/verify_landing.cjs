// Run against a running local service, or set YEARN_WRAPPED_TEST_URL to the preview URL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox } = require('./browser.cjs');
const base = (process.env.YEARN_WRAPPED_TEST_URL || 'http://127.0.0.1:8767/').replace(/\/?$/, '/');
const browserName = process.env.YEARN_WRAPPED_BROWSER || 'chromium';
const output = path.resolve(__dirname, '../data/verification/landing', browserName);
const address = '0xdFDC17F784e16D7634AC270911D98755C68Ae220';
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = browserName === 'firefox'
    ? await firefox.launch({ headless: false, firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.out-of-process': false, 'gfx.webrender.software': true } })
    : await chromium.launch(require('./browser.cjs').chromiumOptions);
  const results = [];
  try {
    for (const variant of (process.env.LANDING_VARIANTS?.split(',') || ['desktop', 'mobile', 'no-webgl', 'no-cdn', 'mobile-walletconnect'])) {
      const context = await browser.newContext({ viewport: variant === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, isMobile: browserName === 'chromium' && variant !== 'desktop', hasTouch: variant !== 'desktop' });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const errors = [], failed = [], graphicsWarnings = [], importWarnings = [];
      if (variant === 'no-webgl' || variant === 'mobile-walletconnect') await context.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/.test(type) ? null : original.call(this, type, ...args); };
      });
      if (variant === 'no-cdn') await context.route('https://cdn.jsdelivr.net/**', route => route.abort());
      // Use the real injected-wallet button path without requesting a person's wallet.
      if (!variant.endsWith('walletconnect')) await context.addInitScript(wallet => { window.ethereum = { request: async ({ method }) => {
        if (method !== 'eth_requestAccounts') throw new Error('Unexpected wallet method: ' + method);
        return [wallet];
      } }; }, address);
      // Keep verification independent of recap upstream availability; no replay page is loaded.
      await context.route('**/api/recap?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure()?.errorText }));
      page.on('console', message => { if (/background unavailable/.test(message.text())) graphicsWarnings.push(message.text()); if (/Import maps are not allowed/.test(message.text())) importWarnings.push(message.text()); });
      try {
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => ['3d', 'static'].includes(document.documentElement.dataset.presentation));
        const animated = ['desktop', 'mobile', 'no-cdn', 'mobile-3d-walletconnect'].includes(variant);
        if (animated) {
          assert.equal(await page.locator('#stage').evaluate(canvas => canvas.classList.contains('is-rendered')), true);
          assert.equal(await page.evaluate(async () => typeof (await import('./vendor/scene/hero.js')).createHero), 'function');
          assert.deepEqual(importWarnings, []);
        }
        else {
          assert.equal(await page.evaluate(() => document.documentElement.dataset.presentation), 'static');
          assert.match(await page.locator('body').evaluate(body => getComputedStyle(body).backgroundImage), /radial-gradient/);
        }
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#entry')).opacity) > .99
          && getComputedStyle(document.querySelector('#entry')).filter === 'none');
        await page.locator('#address-input').fill('invalid');
        await page.locator('#replay-btn').click();
        await page.waitForFunction(() => document.querySelector('#entry-status').textContent.includes("doesn't look like"));
        await page.locator('#address-input').fill('');
        if (variant.endsWith('walletconnect')) await page.evaluate(() => {
          document.querySelector('#connect-btn').addEventListener('click', () => performance.mark('test-wallet-click'), { once: true, capture: true });
        });
        let walletModalMs = null;
        await page.locator('#connect-btn').click();
        if (variant.endsWith('walletconnect')) {
          await page.waitForFunction(() => document.querySelector('w3m-modal')?.open === true, null, { timeout: 60000 });
          await page.locator('w3m-modal').locator('wui-card').waitFor({ state: 'visible' });
          walletModalMs = await page.evaluate(() => Math.round(performance.now() - performance.getEntriesByName('test-wallet-click')[0].startTime));
          await page.getByText('MetaMask', { exact: true }).first().waitFor({ state: 'visible', timeout: 60000 });
        } else {
          await page.waitForFunction(() => document.querySelector('#entry-status').textContent.includes('wallet connected'));
          assert.match(await page.locator('#connect-btn').innerText(), /0xdFDC/);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        let painted = null;
        if (animated) {
          painted = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
            const canvas = document.querySelector('#stage'), gl = canvas.getContext('webgl2');
            let lit = 0;
            for (const x of [.15, .5, .75]) for (const y of [.2, .5, .8]) {
              const rgba = new Uint8Array(4);
              gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
              if (rgba[0] + rgba[1] + rgba[2] > 40) lit++;
            }
            resolve(lit);
          })));
          assert(painted > 0, 'WebGL canvas did not paint a visible scene');
        }
        await page.screenshot({ path: path.join(output, variant + '.png') });
        assert.deepEqual(errors, []);
        results.push({ variant, passed: true, wallet_button: true, wallet_modal_ms: walletModalMs, invalid_address_feedback: true, painted_samples: painted, request_failures: failed, graphics_warnings: graphicsWarnings });
      } finally {
        await context.tracing.stop({ path: path.join(output, variant + '-trace.zip') }).catch(() => {});
        await context.close();
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, browser: browserName, base, checked_at: new Date().toISOString(), results }, null, 2) + '\n');
    console.log('Landing background and wallet controls passed on desktop/mobile and with WebGL/CDN unavailable.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
