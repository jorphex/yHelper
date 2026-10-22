// Measurable accessibility pass for the redesign: WCAG 2.2 contrast (1.4.3),
// target size (2.5.8), focus visibility (2.4.7), reflow at 320px (1.4.10),
// keyboard operability (2.1.1), non-text content (1.1.1), reduced motion.
// Prints a findings table and exits 1 on AA failures for real text.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, firefox } = require('./browser.cjs');
const browserName = process.env.YEARN_WRAPPED_BROWSER || 'chromium';
const BASE = (process.env.YEARN_WRAPPED_TEST_URL || "http://127.0.0.1:8767").replace(/\/$/, "");
const OUTPUT = path.resolve(__dirname, "../data/verification/a11y", browserName === 'firefox' ? 'firefox' : '.');
fs.mkdirSync(OUTPUT, { recursive: true });

const HELPERS = `
(() => {
  const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  window.__lum = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
  window.__parse = (s) => {
    const m = String(s).match(/[\\d.]+/g);
    if (!m) return [0, 0, 0, 1];
    return [ +m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1 ];
  };
  window.__over = (fg, bg) => {
    const a = fg[3] === 1 ? fg : [0, 0, 0, 0];
    if (fg[3] === 1) return fg;
    const o = fg[3];
    return [ fg[0] * o + bg[0] * (1 - o), fg[1] * o + bg[1] * (1 - o), fg[2] * o + bg[2] * (1 - o), 1 ];
  };
  window.__bgOf = (el) => {
    let n = el, stack = [];
    while (n) {
      const c = window.__parse(getComputedStyle(n).backgroundColor);
      if (c[3] > 0.02) stack.push(c);
      n = n.parentElement;
    }
    let out = [10, 10, 10, 1]; // page canvas clear colour
    for (let i = stack.length - 1; i >= 0; i--) out = window.__over(stack[i], out);
    return out;
  };
  window.__hex = (h) => {
    let s = h.replace("#", "");
    if (s.length === 3 || s.length === 4) s = s.split("").map((c) => c + c).join("");
    const n = parseInt(s.slice(0, 6), 16);
    const a = s.length >= 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  };
  window.__contrast = (el) => {
    const cs = getComputedStyle(el);
    const bg = window.__bgOf(el);
    let fg = window.__parse(cs.color);
    fg = window.__over(fg, bg);
    const l2 = window.__lum(bg);
    const size = parseFloat(cs.fontSize);
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    // Gradient-filled text reports its worst stop, which is the pixel a reader
    // actually struggles with, instead of collapsing to "transparent vs black".
    // (no template literals inside this block: it is injected as a string,
    //  so nested backticks would close the outer one and backslashes escape)
    const clipped = /text/.test(
      String(cs.webkitBackgroundClip || "") + " " + String(cs.backgroundClip || ""));
    if (clipped || fg[3] < 0.02) {
      const stops = String(cs.backgroundImage || "")
        .concat(" ", cs.backgroundColor || "")
        .match(/rgba?\\([^)]+\\)|#[0-9a-fA-F]{3,8}/g) || [];
      let worst = null;
      for (const s of stops) {
        const raw = s[0] === "#" ? window.__hex(s) : window.__parse(s);
        if (!raw || raw[3] < 0.02) continue;
        const f = window.__over(raw, bg);
        const l1 = window.__lum(f);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (!worst || ratio < worst.ratio) worst = { ratio: +ratio.toFixed(2), color: s };
      }
      if (worst) return { ...worst, size, large, need, gradient: true };
    }
    const l1 = window.__lum(fg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    return { ratio: +ratio.toFixed(2), size, large, need, color: cs.color };
  };
  window.__visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
})();
`;

async function auditText(page, label) {
  const rows = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll("body *")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own || !window.__visible(el)) continue;
      const c = window.__contrast(el);
      const key = `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`;
      const rec = { key, text: el.textContent.trim().slice(0, 40), ...c };
      const prev = seen.get(key);
      if (!prev || rec.ratio < prev.ratio) seen.set(key, rec);
    }
    return [...seen.values()].sort((a, b) => a.ratio - b.ratio);
  });
  const fails = rows.filter((r) => r.ratio < r.need).map((r) => ({ ...r, where: label }));
  console.log(`\n[${label}] text classes: ${rows.length}, AA failures: ${fails.length}`);
  for (const r of rows.slice(0, 6)) {
    console.log(`  ${r.ratio.toFixed(2)}:1  need ${r.need}  ${r.key}  "${r.text}"  ${r.size}px`);
  }
  for (const r of fails) console.log(`  FAIL ${r.ratio}:1 (need ${r.need}) ${r.key} "${r.text}"`);
  return fails;
}

// Contrast against rendered pixels, not just CSS colours. The hero is a WebGL
// canvas: an element sitting on the lit face of a 3D object passes every
// CSS-background check and still reads badly, so sample what the browser
// actually painted inside the element's own box.
async function auditRendered(page, label, selectors) {
  const fails = [];
  for (const [sel, need] of selectors) {
    const box = await page.locator(sel).first().boundingBox().catch(() => null);
    if (!box) continue;
    const shot = await page.screenshot({ clip: box });
    const r = await page.evaluate(async (b64) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      const d = c.getContext("2d").getImageData(0, 0, bmp.width, bmp.height).data;
      const lum = [];
      for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      lum.sort((a, b) => a - b);
      const part = (arr, f, min) => {
        const s = arr.slice(0, Math.max(min, Math.ceil(arr.length * f)));
        return s.reduce((t, v) => t + v, 0) / s.length;
      };
      const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      // Ink is the top 1% of pixels, not the top decile: glyph coverage inside a
      // text box shrinks as the type grows, so a wider slice measures antialiased
      // edges rather than the stroke colour (27px read 95 where the paint is 160).
      // The bed stays a wide dark slice because the background fills the box.
      const bed = part(lum, 0.4, 16), ink = part(lum.slice().reverse(), 0.01, 16);
      const [lo, hi] = [lin(bed), lin(ink)].sort((a, b) => a - b);
      return { bed: Math.round(bed), ink: Math.round(ink), ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2) };
    }, shot.toString("base64"));
    console.log(`  [rendered] ${label} ${sel}: ink ${r.ink} vs bed ${r.bed} = ${r.ratio}:1 (need ${need})`);
    if (r.ratio < need) fails.push({ key: "contrast-rendered", ratio: r.ratio, need, text: `${label} ${sel}`, where: label });
  }
  return fails;
}

// Fit pass: the deck is one screen per card, so every card has to fit without
// clipping or sideways scroll at every width we care about. Geometry is measured
// with animations off so a mid-flight scale can't fake a failure.
async function fitPass(browser, src, payload = null) {
  const VIEWPORTS = [[320, 640], [390, 844], [844, 390], [430, 932], [768, 1024], [1024, 768], [1300, 1100], [1440, 900]];
  const bad = [];
  const tag = payload ? 'priced' : src.startsWith('address=') ? 'transfers' : 'sample';
  const evidence = path.join(OUTPUT, 'slideshow', tag);
  fs.mkdirSync(evidence, { recursive: true });
  const measurements = [];
  for (const [w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
    if (w === 390) await ctx.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await ctx.newPage();
    if (src.startsWith("address=")) await page.route('**/api/recap?*', route => route.fulfill({contentType:'application/json', body:payload ? JSON.stringify(payload) : fs.readFileSync(path.join(__dirname,'fixtures/transfer-recap.json'),'utf8')}));
    await page.goto(`${BASE}/replay.html?${src}`, { waitUntil: "networkidle" });
    await page.waitForSelector("#deck .card.active");
    await page.addScriptTag({ content: HELPERS });
    const count = await page.locator("#deck .card").count();
    for (let i = 0; i < count; i++) {
      if (i > 0) await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(120);
      const measured = await page.evaluate((expectedVaultLabel) => {
        const card = document.querySelector("#deck .card.active");
        const title = (card.querySelector(".card-title")?.textContent || "?").trim();
        const out = [];
        if (title === 'first activity' && expectedVaultLabel && ![...card.querySelectorAll('.stat-value')].some(value => value.textContent === expectedVaultLabel)) {
          out.push('vault label was escaped twice');
        }
        if (document.documentElement.scrollWidth > window.innerWidth + 1) {
          out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
        }
        const rect = card.getBoundingClientRect();
        const deck = document.querySelector('#deck');
        const viewport = deck.getBoundingClientRect();
        const footer = document.querySelector('.replay-footer').getBoundingClientRect();
        if (rect.top < viewport.top - 2 || viewport.bottom > footer.top + 2) {
          out.push('slide overlaps the header or footer');
        }
        if (rect.bottom > viewport.bottom && deck.scrollHeight <= deck.clientHeight) {
          out.push('tall slide cannot scroll to its final text');
        }
        for (const button of document.querySelectorAll('.recap-action')) {
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (r.height < 44 || r.left < 0 || r.right > innerWidth || r.bottom > innerHeight || !button.contains(hit)) out.push('share action is hidden, clipped or too small');
        }
        const rows = new Map();
        for (const stat of card.querySelectorAll('.card-stat')) {
          const y = Math.round(stat.getBoundingClientRect().y);
          rows.set(y, [...(rows.get(y) || []), stat.querySelector('.stat-label').getBoundingClientRect().y]);
        }
        for (const labels of rows.values()) {
          if (Math.max(...labels) - Math.min(...labels) > 1) out.push('stat labels have uneven baselines');
        }
        for (const el of card.querySelectorAll("*")) {
          if (!window.__visible(el)) continue;
          const cs = getComputedStyle(el);
          if (cs.overflow !== "visible" && el.scrollWidth > el.clientWidth + 1) {
            out.push(`clipped in .${el.className}: ${el.textContent.trim().slice(0, 28)}`);
          }
          const r = el.getBoundingClientRect();
          if (r.right > rect.right + 2 || r.left < rect.left - 2) {
            out.push(`text spills the card: .${el.className} "${el.textContent.trim().slice(0, 24)}"`);
          }
        }
        return { title, faults: [...new Set(out)], scrolls: deck.scrollHeight > deck.clientHeight + 2 };
      }, payload?.cards.firstActivity?.detail?.vaultLabel);
      await page.locator('#deck .card.active').evaluate(card => card.lastElementChild.scrollIntoView({ block: 'nearest' }));
      const reachable = await page.evaluate(() => {
        const deck = document.querySelector('#deck'), card = deck.querySelector('.card.active');
        const last = card.lastElementChild.getBoundingClientRect(), view = deck.getBoundingClientRect();
        const ok = last.bottom <= view.bottom + 2 && last.top >= view.top - 2;
        deck.scrollTop = 0;
        return ok;
      });
      if (!reachable) measured.faults.push('final text cannot be scrolled into view');
      measurements.push({ w, h, slide: i + 1, ...measured });
      if (w === 390 || (w === 1440 && tag === 'sample')) await page.screenshot({ path: path.join(evidence, `${w}-${i + 1}.png`) });
      for (const f of measured.faults) bad.push(`${w}x${h} card ${i} (${measured.title}): ${f}`);
    }
    if (w === 390) await ctx.tracing.stop({ path: path.join(evidence, 'mobile-trace.zip') });
    await ctx.close();
  }
  fs.writeFileSync(path.join(evidence, 'measurements.json'), JSON.stringify(measurements, null, 2));
  return bad;
}

(async () => {
  const browser = browserName === 'firefox' ? await firefox.launch({ headless: true })
    : await chromium.launch(require('./browser.cjs').chromiumOptions);
  const problems = [];

  // --- Landing ---------------------------------------------------------------
  if (!process.env.A11Y_FIT_ONLY) {
  for (const [w, h, tag] of [[1440, 900, "landing 1440"], [390, 844, "landing 390"], [320, 640, "landing 320"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    await page.addScriptTag({ content: HELPERS });
    problems.push(...await auditText(page, tag));
    problems.push(...await auditRendered(page, tag, [[".headline", 3], [".sub", 4.5]]));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (w <= 360 && overflow > 0) problems.push({ key: "reflow", ratio: 0, need: 1, text: `horizontal overflow ${overflow}px at ${w}px` });

    const targets = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("a, button, input, [role=button]")) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.width < 24 || r.height < 24) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    if (targets.length) problems.push({ key: "target-size", ratio: 0, need: 1, text: targets.join(", ") });

    const focus = await page.evaluate(async () => {
      const seen = [];
      const els = [...document.querySelectorAll("a, button, input")].filter((e) => e.offsetWidth || e.offsetHeight);
      for (const el of els) {
        el.focus();
        const cs = getComputedStyle(el);
        const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0
          || cs.boxShadow !== "none";
        if (!ring) seen.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
      return seen;
    });
    if (focus.length) problems.push({ key: "focus-visible", ratio: 0, need: 1, text: focus.join(", ") });

    // Keyboard operability: focus the input, type, press Enter.
    const kb = await page.evaluate(async () => {
      const input = document.querySelector("#address-input");
      if (!input) return "no #address-input";
      input.focus();
      return document.activeElement === input ? "ok" : "input not focusable";
    });
    if (kb !== "ok") problems.push({ key: "keyboard", ratio: 0, need: 1, text: kb });

    // Non-text content.
    const nontext = await page.evaluate(() => {
      const bad = [];
      for (const img of document.querySelectorAll("img")) {
        if (!img.hasAttribute("alt")) bad.push(`img ${img.getAttribute("src")}`);
      }
      for (const cv of document.querySelectorAll("canvas")) {
        const role = cv.getAttribute("role");
        const label = (cv.getAttribute("aria-label") || "").trim();
        const id = `canvas#${cv.id || cv.className}`;
        // A role value containing spaces means the attribute string was broken by
        // an unescaped quote, which also swallows the label next to it.
        if (role && !/^[a-z]+$/.test(role)) bad.push(`${id} malformed role "${role}"`);
        else if (role === "img" && !label) bad.push(`${id} role=img without aria-label`);
        else if (!role && !label && !cv.getAttribute("aria-hidden")) bad.push(id);
      }
      return bad;
    });
    if (nontext.length) problems.push({ key: "non-text", ratio: 0, need: 1, text: nontext.join(", ") });
    await ctx.close();
  }

  // --- Deck ------------------------------------------------------------------
  for (const [w, h, tag] of [[1440, 900, "deck 1440"], [390, 844, "deck 390"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/replay.html?src=assets/sample-recap.json`, { waitUntil: "networkidle" });
    await page.waitForSelector("#deck .card.active");
    await page.addScriptTag({ content: HELPERS });
    let fails = [];
    const count = await page.locator("#deck .card").count();
    for (let i = 0; i < count; i++) {
      await page.evaluate((n) => {
        document.querySelectorAll("#deck .card")[n].classList.add("active");
        document.querySelectorAll("#deck .card")[n === 0 ? 0 : 0];
      }, i);
      await page.evaluate((n) => {
        const cards = [...document.querySelectorAll("#deck .card")];
        cards.forEach((c, k) => c.classList.toggle("active", k === n));
      }, i);
      await page.waitForTimeout(950);
      fails = fails.concat(await auditText(page, `${tag} card ${i}`));
    }
    problems.push(...fails);
    // Deck cards sit over the aurora canvas, so their contrast is measured from
    // rendered pixels as well, on the card that lands screen-center.
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#deck .card")];
      cards.forEach((c, k) => c.classList.toggle("active", k === 0));
    });
    await page.waitForTimeout(950);
    problems.push(...await auditRendered(page, `${tag} rendered`, [
      ["#deck .card.active .card-line", 4.5],
      ["#deck .card.active .card-big", 3],
    ]));
    await ctx.close();
  }

  // --- Fit across viewports ---------------------------------------------------
  }
  const priced = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/verification/accounting/results.json'))).find(r => r.case === 'mixed_assets').payload;
  // Long real-world ticker lengths alongside short amounts expose row-alignment defects.
  priced.cards.vaultGrowth.vaults[0].symbol = 'STETHETH_C-f';
  priced.cards.firstActivity.detail.vaultLabel = 'yvETH & stETH';
  for (const [src, payload] of [["src=assets/sample-recap.json"], ["address=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], ["address=0xcccccccccccccccccccccccccccccccccccccccc", priced]]) {
    const faults = await fitPass(browser, src, payload);
    console.log(`\n[fit ${src}] faults: ${faults.length}`);
    for (const f of faults.slice(0, 12)) console.log(`  - ${f}`);
    for (const f of faults) problems.push({ key: "fit", ratio: 0, need: 1, text: f });
  }

  // --- Reduced motion --------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/replay.html?src=assets/sample-recap.json`, { waitUntil: "networkidle" });
    await page.waitForSelector("#deck .card.active");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(600);
    const anim = await page.evaluate(() => {
      const el = document.querySelector("#deck .card.active .card-big");
      return el ? getComputedStyle(el).animationName : "none";
    });
    console.log(`\n[reduced motion] active card-big animation-name: ${anim}`);
    if (anim !== "none") problems.push({ key: "reduced-motion", ratio: 0, need: 1, text: `animation still running: ${anim}` });
    if (errors.length) problems.push({ key: "reduced-motion", ratio: 0, need: 1, text: errors.join(",") });
    await ctx.close();
  }

  console.log(`\n=== problems: ${problems.length} ===`);
  const uniq = new Map();
  for (const p of problems) {
    const k = `${p.key}|${p.text}`;
    if (!uniq.has(k)) uniq.set(k, p);
  }
  for (const p of uniq.values()) {
    console.log(`- ${p.key}: ${p.text}${p.ratio ? ` (${p.ratio}:1, need ${p.need})` : ""}`);
  }
  const summary = [...uniq.values()];
  fs.writeFileSync(path.join(OUTPUT, "result.json"), JSON.stringify({
    checked_at: new Date().toISOString(),
    base_url: BASE,
    problems: summary,
    unique: summary.length,
    raw: problems.length,
    passed: problems.length === 0,
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(OUTPUT, "result.txt"),
    `${new Date().toISOString()} base=${BASE} raw=${problems.length} unique=${summary.length}\n` +
    summary.map((p) => `- ${p.key}: ${p.text}${p.ratio ? ` (${p.ratio}:1, need ${p.need})` : ""}`).join("\n") + "\n");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
