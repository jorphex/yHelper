/* Run with the local service active: node yearn-wrapped/tests/verify_browser.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./browser.cjs');
// Same wallet as the shipped sample, so the deck-end test walks the deck people
// actually see in sample mode rather than a different shape of wallet.
const address = '0xB9Ed955fc3A389229A1873F631669a40c345F5F4';
const baseURL = (process.env.YEARN_WRAPPED_TEST_URL || 'http://127.0.0.1:8767').replace(/\/?$/, '/');
const output = path.resolve(__dirname, '../data/verification/browser');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch(require('./browser.cjs').chromiumOptions);
  // Clipboard permissions so the copy path exercises the clipboard write rather than
  // its download fallback; the fallback is still asserted to be a valid image below.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => {
    window.__shareTexts = [];
    const drawText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.width === 1200 && this.canvas.height === 630) window.__shareTexts.push(String(text));
      return drawText.call(this, text, ...args);
    };
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  const errors = [], upstreamRequests = [], apiResponses = [], analyticsErrors = [];
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
    if (url.hostname === 'yearn.fi' || url.hostname === 'indexer.hyperindex.xyz') upstreamRequests.push(url.href);
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/api/recap')) apiResponses.push({ status: response.status(), cache: response.headers()['x-recap-cache'] });
  });
  async function settledCards() {
    await page.waitForFunction(() => [...document.querySelectorAll('#deck .card')].every(card =>
      Math.abs(Number(getComputedStyle(card).opacity) - (card.classList.contains('active') ? 1 : 0)) < 0.01));
  }
  try {
    await page.goto(`${baseURL}replay.html?address=${address}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#deck .card').length > 0);
    // Provenance must name every upstream the deck shows data from; the wording is
    // allowed to change, the sources are not.
    assert.match(await page.locator('#data-source').textContent(), /yearn indexer.*yearn\.fi.*CoinGecko/);
    const cardCount = await page.locator('#deck .card').count();
    assert.ok(cardCount >= 10, `expected a full deck, got ${cardCount} cards`);
    assert.equal(await page.locator('#dots .dot').count(), cardCount);
    assert.equal(apiResponses[0].status, 200);
    await settledCards();
    await page.screenshot({ path: path.join(output, 'desktop-intro.png') });
    for (let index = 1; index < cardCount; index++) {
      await page.keyboard.press('ArrowRight');
      assert(await page.locator('#deck .card').nth(index).evaluate(card => card.classList.contains('active')));
      assert.equal(await page.locator('#dots .dot').nth(index).getAttribute('class'), 'dot on');
    }
    assert(await page.locator('#deck .card.active').evaluate(card => card.classList.contains('is-summary')));
    await page.keyboard.press('ArrowLeft');
    const painted = (selector) => page.waitForFunction((sel) => {
      const canvas = document.querySelector(sel);
      if (!canvas) return false;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some((value, index) => index % 4 === 3 && value > 0);
    }, selector, { timeout: 5000 });
    const CURVE = 'canvas.spark[aria-label^="portfolio value"]';
    const MARKET = 'canvas.spark[aria-label^="ETH price"]';
    await painted(CURVE);
    assert.equal(await page.locator(CURVE).evaluate((canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some((value, index) => index % 4 === 3 && value > 0);
    }), true);
    // The market card is a second chart surface; prove it draws too, not just
    // the curve. Charts only paint when their card is first shown.
    assert.equal(await page.locator(MARKET).count(), 1, 'expected exactly one market chart');
    await settledCards();
    await page.screenshot({ path: path.join(output, 'desktop-curve.png') });
    await page.keyboard.press('Home');
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowRight');   // first activity
    await page.keyboard.press('ArrowRight');   // the year outside
    await painted(MARKET);
    await settledCards();
    await page.screenshot({ path: path.join(output, 'desktop-market.png') });
    // Share: the card on screen has to leave the page as an image, by clipboard and
    // by file. The saved file's own IHDR is the proof of size, because 1200x630 is
    // the number X's card crop depends on and an encoder can quietly drift.
    await page.waitForSelector('#recap-actions:not([hidden])', { timeout: 10000 });
    const copyButton = page.locator('#recap-actions [data-action="copy"]');
    await copyButton.click();
    await page.waitForFunction(() => document.querySelector('#recap-actions [data-action="copy"]').classList.contains('is-done'), null, { timeout: 20000 });
    const copyState = await copyButton.evaluate((button) => button.querySelector('.btn-label').textContent.trim().toLowerCase());
    assert.ok(['copied', 'saved'].includes(copyState), `copy reported "${copyState}"`);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.locator('#recap-actions [data-action="download"]').click(),
    ]);
    const sharePath = path.join(output, download.suggestedFilename());
    await download.saveAs(sharePath);
    const shareHead = fs.readFileSync(sharePath);
    assert.match(download.suggestedFilename(), /^yearn-wrapped-\d{4}-.+\.png$/);
    assert.equal(shareHead.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(shareHead.readUInt32BE(16), 1200);
    assert.equal(shareHead.readUInt32BE(20), 630);
    await page.locator('#deck').focus();
    await page.keyboard.press('End');
    const closingTitle = await page.locator('.card.active .card-title').innerText();
    assert.match(await page.locator('.card.active .card-sub').innerText(), /your year(?: so far|, wrapped)/);
    assert.ok(await page.locator('.card.active .card-stat').count() >= 2, 'Closing recap needs supporting metrics');
    await page.evaluate(() => { window.__shareTexts = []; });
    await copyButton.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__shareTexts.some(text => /as of/.test(text)));
    await page.waitForFunction(() => !document.querySelector('#recap-actions').classList.contains('is-busy'));
    assert.equal(await page.locator('.card.active .card-title').innerText(), closingTitle, 'Copying must not change slides');
    assert((await page.evaluate(() => window.__shareTexts)).some(text => /your year so far/.test(text)), 'Closing export lost the partial-year qualifier');
    const summaryBig = await page.locator('.card.active .card-big').textContent();
    assert((await page.evaluate(() => window.__shareTexts)).includes(summaryBig), 'Closing export lost its main metric');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#deck .card').count(), cardCount);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await settledCards();
    await page.screenshot({ path: path.join(output, 'mobile-intro.png') });
    // Native vertical touch scrolling must not be mistaken for a horizontal swipe.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await settledCards();
    const touchSession = await context.newCDPSession(page);
    await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 230, y: 420 }] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170, y: 160 }] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.card.active .card-title').innerText(), 'THE YEAR OUTSIDE');
    assert(await page.locator('#deck').evaluate(deck => deck.scrollTop > 0), 'Dense slide did not scroll with touch');
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 260, y: 250 }] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 250 }] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('.card.active .card-title').textContent === 'vaults explored');
    assert.equal(await page.locator('#deck').evaluate(deck => deck.scrollTop), 0, 'Next slide retained the previous scroll');
    assert.equal(apiResponses.at(-1).cache, 'HIT');
    assert.deepEqual(upstreamRequests, []);
    assert.deepEqual(errors, []);
    const result = { passed: true, checked_at: new Date().toISOString(), base_url: baseURL, cards: cardCount, dots: cardCount, navigation: 'all cards reached with arrow keys; Home jumps to the first card', touch: 'vertical scrolling retains the slide; horizontal swipe advances and resets scroll', charts_painted: ['portfolio curve', 'market ETH chart'], share: { copy_state: copyState, closing_copy_retains_date_and_partial_year: true, file: download.suggestedFilename(), bytes: fs.statSync(sharePath).size, pixels: [shareHead.readUInt32BE(16), shareHead.readUInt32BE(20)] }, mobile_width: 390, api_responses: apiResponses, browser_upstream_requests: upstreamRequests, cloudflare_analytics_errors: analyticsErrors, console_errors: errors };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.tracing.stop({ path: path.join(output, 'trace.zip') });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
