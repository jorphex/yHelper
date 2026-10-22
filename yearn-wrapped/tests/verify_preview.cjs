// Run from yearn-wrapped/: YEARN_WRAPPED_TEST_URL=https://host/prefix/ node tests/verify_preview.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, baseURL: base } = require('./browser.cjs');
const folder = path.resolve(__dirname, '../data/preview');
assert(process.env.YEARN_WRAPPED_TEST_URL, 'Set YEARN_WRAPPED_TEST_URL to the deployed preview URL');
fs.mkdirSync(folder, { recursive: true });
const prefix = new URL(base).pathname.replace(/\/$/, "");
// The demo wallet is the one the shipped sample shows: multi-vault, two chains, five
// years of history. It is heavier to build than the old single-vault whale, so the
// build budget is wider.
const address = '0xB9Ed955fc3A389229A1873F631669a40c345F5F4';

(async () => {
  const browser = await chromium.launch(require('./browser.cjs').chromiumOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.setDefaultTimeout(300000);
  page.setDefaultNavigationTimeout(300000);
  const errors = [], escapedRequests = [], directUpstreams = [], apiResponses = [], edgeRequests = [], analyticsErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const source = message.location().url;
    if (source.startsWith('https://static.cloudflareinsights.com/beacon.min.js/') && message.text() === 'Failed to load resource: net::ERR_CONNECTION_REFUSED') {
      analyticsErrors.push({ source, message: message.text() });
    } else errors.push(message.text());
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === new URL(base).origin && url.pathname.startsWith('/cdn-cgi/')) edgeRequests.push(url.pathname);
    else if (url.origin === new URL(base).origin && !url.pathname.startsWith(prefix + '/')) escapedRequests.push(url.pathname);
    if (url.hostname === 'yearn.fi' || url.hostname === 'indexer.hyperindex.xyz') directUpstreams.push(url.href);
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname === prefix + '/api/recap') apiResponses.push({ status: response.status(), cache: response.headers()['x-recap-cache'] });
  });
  async function settle() {
    await page.waitForFunction(() => [...document.querySelectorAll('#deck .card')].every(card => Math.abs(Number(getComputedStyle(card).opacity) - (card.classList.contains('active') ? 1 : 0)) < .01));
  }
  try {
    const landing = await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(landing.status(), 200);
    assert.match(landing.headers()['x-robots-tag'], /noindex/);
    await page.getByRole('textbox', { name: 'Wallet address or ENS name' }).fill(address);
    await page.screenshot({ path: path.join(folder, 'public-landing-desktop.png') });
    await Promise.all([
      page.waitForURL(url => url.pathname === prefix + '/replay.html'),
      page.getByRole('button', { name: 'Replay my year' }).click(),
    ]);
    await page.waitForFunction(() => /yearn indexer.*yearn\.fi.*CoinGecko/.test(document.querySelector('#data-source').textContent));
    // Card count comes from the payload, so adding a card does not break the
    // public check; the floor is what matters (a deck this thin means cards
    // failed to build, not that the deck changed).
    const cards = await page.locator('#deck .card').count();
    assert.ok(cards >= 12, `expected at least 12 cards, got ${cards}`);
    assert.equal(await page.locator('#dots .dot').count(), cards);
    await settle();
    await page.screenshot({ path: path.join(folder, 'public-replay-desktop.png') });
    for (let index = 1; index < cards; index++) {
      await page.keyboard.press('ArrowRight');
      assert(await page.locator('#deck .card').nth(index).evaluate(card => card.classList.contains('active')));
    }
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: '' }));
    const posted = page.waitForEvent('popup');
    await page.locator('[data-action=post]').click();
    const composer = await posted;
    await composer.waitForLoadState();
    const caption = new URL(composer.url()).searchParams.get('text');
    assert.ok(caption.includes(base), 'Share caption must preserve the preview base');
    assert.ok(!caption.toLowerCase().includes(address.toLowerCase()), 'Share caption must omit wallet identity');
    await composer.close();
    await page.locator('a.brand').click();
    await page.waitForURL(base);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLanding = await page.reload({ waitUntil: 'networkidle' });
    assert.equal(mobileLanding.status(), 200, 'mobile landing reload must succeed before interacting');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('textbox', { name: 'Wallet address or ENS name' }).fill(address);
    await Promise.all([
      page.waitForURL(url => url.pathname === prefix + '/replay.html'),
      page.getByRole('button', { name: 'Replay my year' }).click(),
    ]);
    await page.waitForFunction(() => document.querySelectorAll('#deck .card').length >= 12);
    await settle();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(folder, 'public-replay-mobile.png') });
    assert(apiResponses.length >= 2 && apiResponses.every(response => response.status === 200));
    assert.equal(apiResponses.at(-1).cache, 'HIT');
    assert.deepEqual(escapedRequests, []);
    assert.deepEqual(directUpstreams, []);
    assert.deepEqual(errors, []);
    const result = { passed: true, checked_at: new Date().toISOString(), public_url: base, desktop_and_mobile: true, cards, address_submission: true, brand_return_stays_in_preview: true, api_responses: apiResponses, escaped_requests: escapedRequests, browser_upstream_requests: directUpstreams, cloudflare_edge_requests: edgeRequests, cloudflare_analytics_errors: analyticsErrors, errors };
    fs.writeFileSync(path.join(folder, 'public-browser.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(`Public landing, address submission, live ${cards}-card replay, navigation, and mobile checks passed.`);
  } finally {
    await context.tracing.stop({ path: path.join(folder, 'public-trace.zip') });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
