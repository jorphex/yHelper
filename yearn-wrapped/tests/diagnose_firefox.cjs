const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tag = process.env.FIREFOX_DIAG_TAG || 'before';
const { firefox, baseURL: base } = require('./browser.cjs');
const output = path.resolve(__dirname, '../data/verification/firefox');
fs.mkdirSync(output, { recursive: true });
(async () => {
 const browser = await firefox.launch({ headless: false, firefoxUserPrefs: { 'webgl.force-enabled': true } });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
 const page = await context.newPage();const result = { console: [], failures: [], bad_responses: [] };
 page.on('console', message => result.console.push({ type: message.type(), text: message.text(), source: message.location().url }));
 page.on('pageerror', error => result.console.push({ type: 'pageerror', text: error.message }));
 page.on('requestfailed', request => result.failures.push({ url: request.url(), error: request.failure()?.errorText }));
 page.on('response', response => { if (response.status() >= 400) result.bad_responses.push({ url: response.url(), status: response.status() }); });
 try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(10000);
  result.three = await page.evaluate(async () => {
   try { return { localScene: typeof (await import('./vendor/scene/hero.js')).createHero === 'function' }; }
   catch (error) { return { error: error.message }; }
  });
  result.state = await page.evaluate(() => {
   const canvas = document.querySelector('#stage');const gl = document.createElement('canvas').getContext('webgl2');
   return { userAgent: navigator.userAgent, ready: canvas.classList.contains('is-rendered'), canvas: [canvas.width, canvas.height], webgl2: !!gl, vendor: gl?.getParameter(gl.VENDOR), renderer: gl?.getParameter(gl.RENDERER) };
  });
  await page.screenshot({ path: path.join(output, `${tag}.png`) });
  console.log(JSON.stringify(result, null, 2));
  if (tag !== 'before') { assert.equal(result.three.localScene, true); assert.equal(result.console.some(m => /Import maps are not allowed/.test(m.text)), false); }
  fs.writeFileSync(path.join(output, `${tag}.json`), JSON.stringify(result, null, 2));
 } finally {
  await context.tracing.stop({ path: path.join(output, `${tag}-trace.zip`) });
  await browser.close();
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
