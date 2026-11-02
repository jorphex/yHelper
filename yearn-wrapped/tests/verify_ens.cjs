// Browser E2E: ENS cache reuse, concurrent submission, RPC fallback and provider cleanup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, chromiumOptions } = require('./browser.cjs');
const output = path.resolve(__dirname, '../../reports/rpc-optimization');
const base = process.env.YEARN_WRAPPED_TEST_URL || 'http://127.0.0.1:8768/';
const address = '0x' + '1'.repeat(40);
const browserName = process.env.YEARN_WRAPPED_BROWSER || 'chromium';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = browserName === 'firefox'
    ? await firefox.launch({ headless: true, ...(process.env.FIREFOX_PATH ? { executablePath: process.env.FIREFOX_PATH } : {}) })
    : await chromium.launch(chromiumOptions);
  const events = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await context.tracing.start({ screenshots: true, snapshots: true });
    await context.addInitScript(() => {
      window.ethereum = {};
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : original.call(this, type, ...args); };
      const schedule = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 6000 ? 150 : delay, ...args);
    });
    await context.route('**/api/recap?*', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await context.route('**/replay.html?*', route => route.fulfill({ contentType: 'text/html', body: '<main>Replay opened</main>' }));
    await context.route('https://esm.sh/ethers@6.13.4', route => route.fulfill({ contentType: 'application/javascript', body: `
      export class JsonRpcProvider {
        constructor(url) { this.url = url; console.log('ENS_EVENT ' + JSON.stringify({op:'create',url})); }
        async resolveName(name) {
          console.log('ENS_EVENT ' + JSON.stringify({op:'resolve',name,url:this.url}));
          if(name==='fallback.eth' && this.url.includes('cloudflare')) return new Promise(()=>{});
          await new Promise(resolve=>setTimeout(resolve,80));
          return '${address}';
        }
        destroy() { console.log('ENS_EVENT ' + JSON.stringify({op:'destroy',url:this.url})); }
      }
    ` }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if(message.text().startsWith('ENS_EVENT ')) events.push(JSON.parse(message.text().slice(10))); });
    await page.goto(base);
    await page.locator('#address-input').waitFor();
    for(const name of ['first.eth', 'second.eth', 'first.eth', 'fallback.eth']) {
      await page.locator('#address-input').fill(name);
      await page.waitForFunction(name => document.querySelector('#entry-status').textContent.includes(name + ' →'), name);
    }
    assert.equal(events.filter(e=>e.op==='resolve' && e.name==='first.eth').length, 1);
    assert.equal(events.filter(e=>e.op==='resolve' && e.name==='fallback.eth').length, 2);
    assert.equal(events.filter(e=>e.op==='create').length, events.filter(e=>e.op==='destroy').length);
    await page.screenshot({ path: path.join(output, `ens-mobile-${browserName}.png`) });
    await page.locator('#address-input').fill('coalesce.eth');
    await page.waitForFunction(() => document.querySelector('#entry-status').textContent.includes('resolving coalesce'));
    await page.waitForTimeout(440);
    await page.locator('#replay-btn').click();
    await page.waitForURL('**/replay.html?*');
    assert.equal(events.filter(e=>e.op==='resolve' && e.name==='coalesce.eth').length, 1);
    assert.equal(events.filter(e=>e.op==='create').length, events.filter(e=>e.op==='destroy').length);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, `ens-results-${browserName}.json`), JSON.stringify({ passed: true, cache_reused: true, fallback: true, coalesced: true, providers_destroyed: true, events }, null, 2));
    await context.tracing.stop({ path: path.join(output, `ens-trace-${browserName}.zip`) });
    await context.close();
    console.log('ENS browser E2E passed: cache, fallback, concurrent resolution, provider cleanup.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
