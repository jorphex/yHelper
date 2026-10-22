// Browser acceptance checks for the audit failures; run after verify_accounting.py.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, chromiumOptions, baseURL } = require('./browser.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'data/verification/fixes');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'data/verification/accounting/results.json')));
const payload = cases.find(c => c.case === 'single_hold').payload;
const amount = payload.cards.vaultGrowth.totalGrowthUsd;
const result = { passed: false, checks: [] };
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch(chromiumOptions);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await ctx.addInitScript(() => {
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : gc.call(this, type, ...args); };
    window.__shareTexts = [];
    const ft = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.width === 1200 && this.canvas.height === 630) window.__shareTexts.push(String(text));
      return ft.call(this, text, ...args);
    };
    window.__walletCalls = 0;
    window.ethereum = { request: async () => { window.__walletCalls++; return ['0x' + 'b'.repeat(40)]; } };
  });
  let response = structuredClone(payload);
  await ctx.route('**/api/recap?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(baseURL + 'replay.html?src=' + encodeURIComponent('data:application/json,' + JSON.stringify(payload)));
    await page.waitForSelector('.card.active');
    assert.match(await page.locator('.card.active').innerText(), /try again shortly/);
    result.checks.push('Arbitrary data/remote sample sources are rejected');

    response.cards.firstActivity.quip = { face: '<img src=x onerror="window.__auditMarker=1">', text: '<b>plain text</b>', tone: 'calm' };
    await page.goto(baseURL + 'replay.html?address=' + payload.address);
    await page.waitForSelector('.card.active');
    assert.equal(await page.evaluate(() => window.__auditMarker), undefined);
    assert.equal(await page.locator('#deck img').count(), 0);
    // Inactive slides are intentionally hidden from rendered text/accessibility.
    await page.keyboard.press('ArrowRight');
    assert.ok((await page.locator('.card.active').innerText()).includes('<b>plain text</b>'));
    await page.keyboard.press('Home');
    result.checks.push('Payload prose is escaped and legacy face markup is ignored');

    const titles = await page.locator('.card-title').allTextContents();
    const yieldIndex = titles.indexOf('vault yield earned');
    assert.ok(yieldIndex > 0);
    for (let i = 0; i < yieldIndex; i++) await page.keyboard.press('ArrowRight');
    const download = page.waitForEvent('download');
    await page.locator('[data-action=download]').evaluate(button => button.click());
    await (await download).saveAs(path.join(output, 'immediate-share.png'));
    const expected = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount);
    assert.ok((await page.evaluate(() => window.__shareTexts)).includes(expected));
    result.checks.push('Immediate export uses the final financial amount, independent of animation');

    await page.locator('[data-action=download]').focus();
    const keyboardDownload = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    await keyboardDownload;
    assert.equal(await page.locator('.card.active .card-title').innerText(), 'VAULT YIELD EARNED');
    result.checks.push('Enter activates the focused share button without moving the deck');

    response = structuredClone(payload);
    response.cards.vaultGrowth.isComplete = false;
    response.cards.vaultGrowth.totalGrowthUsd = 999;
    response.cards.longestHoldingStreak.days = 1;
    response.cards.longestHoldingStreak.startTs = response.cards.longestHoldingStreak.endTs - 86400;
    response.cards.whatIfHeld = { isComplete: false, exitsTotal: 2, forgoneUsd: 123, forgoneAssets: -99 };
    await page.goto(baseURL + 'replay.html?address=' + payload.address);
    await page.waitForSelector('.card.active');
    assert.equal(await page.locator('.card-title').filter({ hasText: 'vault yield earned' }).count(), 0);
    assert.notEqual(await page.locator('.is-summary .card-big').textContent(), '$999.00', 'incomplete yield must not leak into the recap');
    assert.equal(await page.locator('.is-summary .card-big').textContent(), '1 day', 'single-day summary uses the holding fallback');
    assert.doesNotMatch(await page.locator('.is-summary .card-line').textContent(), /vault yield earned/);
    assert.equal(await page.locator('.card-title').filter({ hasText: 'you timed it' }).count(), 0);
    response.cards.vaultsExplored.count = '<img src=x onerror="window.__auditMarker=1">';
    await page.reload();
    await page.waitForSelector('.card.active');
    assert.match(await page.locator('.card.active').innerText(), /try again shortly/);
    assert.equal(await page.evaluate(() => window.__auditMarker), undefined);
    result.checks.push('Incomplete amounts are omitted and malformed numeric contracts fail safely');

    response = structuredClone(payload);
    response.cards.whatIfHeld = { isComplete: true, exitsTotal: 2, exitsCovered: 2, forgoneUsd: 2900, forgoneAssets: -99, vaults: [] };
    await page.goto(baseURL + 'replay.html?address=' + payload.address);
    await page.waitForSelector('.card.active');
    assert.equal(await page.locator('.card-title').filter({ hasText: 'what if?' }).count(), 1);
    assert.equal(await page.locator('.card-title').filter({ hasText: 'you timed it' }).count(), 0);
    result.checks.push('Counterfactual verdict follows comparable USD, not mixed asset units');

    await page.goto(baseURL);
    await page.locator('#address-input').fill('0x' + 'a'.repeat(40));
    await page.locator('#address-input').fill('0xinvalid');
    await page.locator('#replay-btn').click();
    assert.equal(page.url(), baseURL);
    assert.match(await page.locator('#entry-status').innerText(), /doesn't look like/);
    await page.locator('#address-input').fill('0x' + 'a'.repeat(40));
    await page.locator('#connect-btn').click();
    assert.equal(await page.evaluate(() => window.__walletCalls), 1);
    assert.equal(page.url(), baseURL);
    result.checks.push('Invalid edits cannot replay stale input; Connect still requests a wallet after pasting');
    assert.deepEqual(errors, []);

    const reduced = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    await reduced.addInitScript(() => {
      window.__starFrames = 0;
      window.__sceneFrames = 0;
      const raf = requestAnimationFrame;
      window.requestAnimationFrame = callback => {
        if (callback.name === 'tickStars') window.__starFrames++;
        if (callback.name === 'frame') window.__sceneFrames++;
        return raf(callback);
      };
    });
    const quiet = await reduced.newPage();
    await quiet.goto(baseURL + 'replay.html');
    await quiet.waitForSelector('.card.active');
    const before = await quiet.evaluate(() => window.__starFrames);
    await quiet.waitForTimeout(600);
    assert.equal(await quiet.evaluate(() => window.__starFrames), before);
    result.checks.push('Reduced-motion starfield remains a still frame');
    await quiet.screenshot({ path: path.join(output, 'mobile-replay.png') });
    await quiet.goto(baseURL);
    await quiet.waitForSelector('#stage.is-rendered');
    await quiet.waitForTimeout(700);
    const frames = await quiet.evaluate(() => window.__sceneFrames);
    await quiet.waitForTimeout(600);
    assert.equal(await quiet.evaluate(() => window.__sceneFrames), frames);
    await quiet.screenshot({ path: path.join(output, 'mobile-still-hero.png') });
    result.checks.push('Reduced-motion mobile hero renders without a continuous frame loop');
    await reduced.close();
    result.passed = true;
  } finally {
    await ctx.tracing.stop({ path: path.join(output, 'browser-trace.zip') });
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(result, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
