// Compare actual rendered pixels with animation time frozen and the cursor moved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, chromiumOptions, baseURL } = require('./browser.cjs');
const output = path.resolve(process.env.FIELD_OUTPUT || 'data/verification/loader-field/motion');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch(chromiumOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.addInitScript(() => { window.ethereum = {}; });
  const page = await context.newPage();
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.presentation === '3d');
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '* { animation-play-state: paused !important; transition: none !important; }' });
    await page.evaluate(() => {
      const time = performance.now();
      Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
    });
    await page.mouse.move(80, 100);
    await page.waitForTimeout(1800);
    const first = await page.screenshot({ path: path.join(output, 'cursor-left.png') });
    await page.mouse.move(1360, 800);
    await page.waitForTimeout(1800);
    const second = await page.screenshot({ path: path.join(output, 'cursor-right.png') });
    const measured = await page.evaluate(async ({ a, b }) => {
      const pixels = async src => {
        const image = new Image(); image.src = 'data:image/png;base64,' + src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [first, second] = await Promise.all([pixels(a), pixels(b)]);
      const region = (left, top, width, height) => {
        let delta = 0, brightness = 0;
        for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
          const i = (y * 1440 + x) * 4;
          for (let c = 0; c < 3; c++) { delta += Math.abs(first[i + c] - second[i + c]); brightness += first[i + c]; }
        }
        return { delta: delta / (width * height * 3), brightness: brightness / (width * height * 3) };
      };
      // Keep the field comparison clear of light spilling from the moving symbol.
      return { field: region(16, 120, 360, 700), background: region(16, 120, 520, 700), quietBackground: region(16, 100, 600, 100), symbol: region(700, 120, 700, 650), canvasTransform: getComputedStyle(document.getElementById('stage')).transform };
    }, { a: first.toString('base64'), b: second.toString('base64') });
    const passed = measured.field.delta < .05 && measured.canvasTransform === 'none' && measured.symbol.delta > .2;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed, ...measured }, null, 2) + '\n');
    console.log(JSON.stringify({ passed, ...measured }));
    if (!process.env.FIELD_OBSERVE) assert(passed, 'background pixels must stay fixed while the symbol responds');
  } finally {
    await context.tracing.stop({ path: path.join(output, 'trace.zip') });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
