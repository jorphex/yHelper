const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, baseURL: base } = require('./browser.cjs');
const output = process.env.WALLET_TIMING_OUTPUT || path.resolve(__dirname, '../data/verification/landing/wallet-timing.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
(async () => {
 const browser = await chromium.launch(require('./browser.cjs').chromiumOptions);
 const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
 await context.addInitScript(() => {
  window.__walletInteractions = [];
  addEventListener('click', event => {
   if (event.target.closest?.('#connect-btn')) window.__walletInteractions.push({ clickedAt: performance.now() });
  }, true);
  new MutationObserver(() => {
   const interaction = window.__walletInteractions.at(-1);
   if (interaction && !interaction.openedAt && document.querySelector('w3m-modal')?.classList.contains('open')) interaction.openedAt = performance.now();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
 });
 const page = await context.newPage(); const start = Date.now(); const requests = [], responses = [];
 page.on('request', r => { if (r.url().startsWith('https://esm.sh/')) requests.push({ url: r.url(), at_ms: Date.now() - start }); });
 page.on('response', r => { if (/walletconnect|reown/.test(r.url())) responses.push({ url: r.url(), status: r.status(), at_ms: Date.now() - start }); });
 await page.goto(base, { waitUntil: 'domcontentloaded' });
 await page.waitForFunction(() => ['3d', 'static'].includes(document.documentElement.dataset.presentation) && Number(getComputedStyle(document.querySelector('#entry')).opacity) > .9);
 if (process.env.WALLET_IDLE_MS) await page.waitForTimeout(Number(process.env.WALLET_IDLE_MS));
 assert.equal(await page.evaluate(() => !!document.querySelector('w3m-modal')?.open), false, 'Warm-up opened the wallet modal');
 const tap = Date.now();await page.locator('#connect-btn').tap();
 await page.waitForFunction(() => document.querySelector('w3m-modal')?.open === true, null, { timeout: 90000 });
 const opened = Date.now();
 await page.getByText('MetaMask', { exact: true }).first().waitFor({ state: 'visible', timeout: 60000 });
 const result = { checked_at: new Date().toISOString(), tap_at_ms: tap-start, modal_after_tap_ms: opened-tap, wallets_after_tap_ms: Date.now()-tap, esm_request_count: requests.length, esm_last_request_at_ms: requests.at(-1)?.at_ms, requests, responses };
 await page.locator('[data-testid="w3m-header-close"]').click();
 await page.waitForFunction(() => document.querySelector('#connect-btn .btn-label').textContent === 'Connect wallet');
 const retry = Date.now();await page.locator('#connect-btn').tap();
 await page.waitForFunction(() => document.querySelector('w3m-modal')?.open === true, null, { timeout: 15000 });
 result.reopen_after_tap_ms = Date.now() - retry;
 result.browser_click_to_open_ms = await page.evaluate(() => window.__walletInteractions.map(t => t.openedAt - t.clickedAt));
 assert.equal(requests.length, 0, 'SDK still imports from esm.sh');
 fs.writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
 console.log(JSON.stringify({tap_at_ms:result.tap_at_ms,modal_after_tap_ms:result.modal_after_tap_ms,wallets_after_tap_ms:result.wallets_after_tap_ms,esm_request_count:result.esm_request_count,reopen_after_tap_ms:result.reopen_after_tap_ms,browser_click_to_open_ms:result.browser_click_to_open_ms}));
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
