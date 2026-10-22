// Reproduce social-widget cosmetic filtering without changing browser settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { firefox, baseURL } = require('./browser.cjs');
const output = path.resolve(__dirname, '../data/verification/share-visibility');
// Fanboy Social's global rules ###sharebar and ##.sharebar:
// https://github.com/easylist/easylist/blob/master/fanboy-addon/fanboy_social_general_hide.txt
const filterCSS = '#sharebar, .sharebar { display: none !important; }';
const address = process.env.RECAP_ADDRESS;
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(baseURL + 'replay.html?' + (address ? 'address=' + address : 'src=assets/sample-recap.json'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card.active', { timeout: 240000 });
    await page.addStyleTag({ content: filterCSS });
    for (const action of ['copy', 'download', 'post']) {
      assert(await page.locator(`[data-action="${action}"]`).isVisible(), `${action} is hidden by the social-widget filter`);
      assert(await page.locator(`[data-action="${action}"]`).isDisabled(), 'identity card sharing is disabled');
    }
    await page.locator('#deck').focus();
    await page.keyboard.press('ArrowRight');
    // Copy succeeds through the clipboard or its download fallback.
    const download = page.waitForEvent('download');
    await page.locator('[data-action="copy"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="copy"]').classList.contains('is-done'));
    const feedback = await page.locator('[data-action="copy"]').evaluate(button => ({
      check: Number(getComputedStyle(button.querySelector('.action-check')).opacity),
      icon: Number(getComputedStyle(button.querySelector('.action-icon')).opacity),
      live: button.querySelector('.btn-label').getAttribute('aria-live'),
    }));
    assert.deepEqual(feedback, { check: 1, icon: 0, live: 'polite' }, 'icon feedback remains visible and announced');
    const copyResult = await page.locator('[data-action="copy"] .btn-label').textContent();
    assert(['copied', 'saved'].includes(copyResult.toLowerCase()));
    let exported;
    if (copyResult.toLowerCase() === 'saved') exported = await download;
    else {
      const saved = page.waitForEvent('download');
      await page.locator('[data-action="download"]').click();
      exported = await saved;
    }
    await exported.saveAs(path.join(output, 'firefox-export.png'));
    const image = fs.readFileSync(path.join(output, 'firefox-export.png'));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16), 1200);
    assert.equal(image.readUInt32BE(20), 630);
    await page.locator('#deck').focus();
    await page.keyboard.press('End');
    assert(await page.locator('[data-action="copy"]').isVisible());
    await page.screenshot({ path: path.join(output, 'firefox-filter-active.png') });
    // Block both popup and clipboard: never confirm an action that failed.
    await page.evaluate(() => {
      window.open = () => null;
      navigator.clipboard.writeText = async () => { throw new Error('clipboard refused'); };
    });
    await page.locator('[data-action="post"]').click();
    await page.waitForFunction(() => document.getElementById('recap-actions').dataset.error === 'allow pop-ups to open X');
    assert.equal(await page.locator('[data-action="post"]').evaluate(button => button.classList.contains('is-done')), false);
    assert.equal(await page.locator('[data-action="post"] .btn-label').textContent(), 'Blocked');
    await page.screenshot({ path: path.join(output, 'firefox-blocked-post.png') });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, url: page.url(), filter: filterCSS,
      actions_visible: ['copy', 'download', 'post'], copy_result: copyResult, export_png: [1200, 630], closing_actions_visible: true, blocked_post_feedback: true, errors }, null, 2));
    console.log('Firefox image actions and PNG export passed with the social-widget filter active.');
  } finally {
    await context.tracing.stop({ path: path.join(output, 'filter-trace.zip') });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
