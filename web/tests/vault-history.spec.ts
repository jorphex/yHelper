import { expect, test, type Page } from "@playwright/test";

const address = `0x${"1".repeat(40)}`;
const today = Math.floor(Date.now() / 86400000) * 86400;
const points = Array.from({ length: 91 }, (_, index) => ({ timestamp: today - (90 - index) * 86400, pps: 1.05 + index * .0001, apy_7d: .04 + index * .0001, tvl_usd: 2_000_000 + index * 1000 }));
const vault = { chain_id: 1, vault_address: address, symbol: "yvUSDC-1", name: "USDC yVault", token_symbol: "USDC", est_apy: .06 };
const history = { vault, points, source_freshness: { state: "ready" }, history_state: "ready", history_delayed: false, retry_after_seconds: 0, pps_source: "kong", tvl_source: "kong", fetched_at: new Date().toISOString() };
const listing = { pagination: { total: 1, limit: 250, offset: 0 }, facets: { chains: [{ chain_id: 1, vaults: 1 }] }, rows: [{ ...vault, tvl_usd: 2_000_000, market: "stablecoins", realized_apy_30d: .05, momentum_7d_30d: .01 }] };

async function sources(page: Page, partial = false, overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    calls.push(url.pathname);
    if (url.pathname.endsWith("/history")) return route.fulfill({ json: { ...(partial ? { ...history, history_state: "partial", tvl_source: "unavailable", points: points.map(point => ({ ...point, tvl_usd: null })) } : history), ...overrides } });
    return route.fulfill({ json: url.pathname === "/api/discover" ? listing : { rows: [], categories: [{ category: "stablecoins", vaults: 1, tvl_usd: 2_000_000 }], chains: [], tokens: [], summary: { vaults: 1 }, facets: { chains: [] } } });
  });
  return calls;
}

for (const width of [1440, 390, 601, 768, 1024]) {
  test(`Vault history preserves navigation and switches cached periods at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const calls = await sources(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const from = "/markets?view=vaults&market=stablecoins&universe=raw&chain=1&q=USDC&sort=apy_30d%3Adesc";
    await page.goto(from);
    await page.getByRole("link", { name: "View yvUSDC-1 performance" }).click();
    await expect(page.getByRole("heading", { name: "yvUSDC-1", exact: true })).toBeVisible();
    await expect(page.getByTestId("vault-history-chart")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Yearn" })).toHaveAttribute("href", new RegExp(`/vaults/1/${address}`, "i"));
    const loaded = calls.length;
    expect(calls.filter(path => path.endsWith("/history"))).toHaveLength(1);
    const durations: number[] = [];
    for (const days of [7, 90, 30]) {
      const started = Date.now();
      await page.getByRole("button", { name: `${days}d`, exact: true }).click();
      await expect(page.getByTestId("tvl-bar")).toHaveCount(days + 1);
      durations.push(Date.now() - started);
    }
    expect(calls).toHaveLength(loaded);
    expect(durations.every(duration => duration < 1000)).toBe(true);
    const slider = page.getByRole("slider", { name: "Explore vault history" });
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "1");
    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", "30");
    const box = await slider.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + 80);
    expect(Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(5);
    expect(Number(await slider.getAttribute("aria-valuenow"))).toBeLessThan(25);
    await expect(page.getByTestId("apy-line")).toHaveAttribute("d", /^M.+L/);
    await expect(page.getByTestId("pps-line")).toHaveAttribute("d", /^M.+L/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 1024) {
      const back = await page.getByRole("link", { name: "← Vaults" }).boundingBox();
      expect(back!.x).toBeGreaterThan(56);
    }
    await page.screenshot({ path: testInfo.outputPath(`vault-history-${width}.png`), fullPage: true });
    await testInfo.attach("history-checks", { body: JSON.stringify({ width, durations, calls }), contentType: "application/json" });
    await page.getByRole("link", { name: "← Vaults" }).click();
    await expect.poll(() => new URL(page.url()).search).toBe(new URL(from, "https://example.test").search);
    await expect(page.getByRole("searchbox")).toHaveValue("USDC");
    expect(errors).toEqual([]);
  });
}

test("Deep links do not load other research views and keep failed TVL honest", async ({ page }, testInfo) => {
  const calls = await sources(page, true);
  await page.goto(`/markets/vault/1/${address}?from=${encodeURIComponent("https://evil.test")}`);
  await expect(page.getByRole("heading", { name: "yvUSDC-1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Vaults" })).toHaveAttribute("href", "/markets?view=vaults");
  await expect(page.getByTestId("tvl-bar")).toHaveCount(0);
  await expect(page.getByText("TVL history unavailable.", { exact: false })).toBeVisible();
  expect(calls).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("partial-history.png"), fullPage: true });
});

test("Stored and cached sources do not hide valid TVL", async ({ page }, testInfo) => {
  for (const tvlSource of ["kong", "cached"]) {
    await sources(page, false, { history_state: "partial", pps_source: "stored", tvl_source: tvlSource });
    await page.goto(`/markets/vault/1/${address}`);
    await expect(page.getByTestId("tvl-bar")).toHaveCount(31);
    await expect(page.locator(".vault-history-note")).toContainText("Using stored share prices.");
    await expect(page.locator(".vault-history-note")).not.toContainText("TVL history unavailable");
    if (tvlSource === "cached") await expect(page.locator(".vault-history-note")).toContainText("Using cached history.");
    await page.screenshot({ path: testInfo.outputPath(`stored-pps-${tvlSource}-tvl.png`), fullPage: true });
    await page.unrouteAll();
  }
});

test("Old stored APY is dated and flagged despite partial coverage", async ({ page }, testInfo) => {
  await sources(page, true, { pps_source: "stored", history_delayed: true, points: points.map(point => ({ ...point, timestamp: point.timestamp - 10 * 86400, tvl_usd: null })) });
  await page.goto(`/markets/vault/1/${address}`);
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format((today - 10 * 86400) * 1000);
  await expect(page.locator(".vault-metrics dt").filter({ hasText: "7d realized APY" })).toContainText(date);
  await expect(page.locator(".vault-history-note")).toContainText("History is delayed.");
  await expect(page.locator(".vault-history-note")).toContainText("Using stored share prices.");
  await page.screenshot({ path: testInfo.outputPath("old-stored-apy.png"), fullPage: true });
});

test("Retry exposes the cooldown and prevents duplicate requests in flight", async ({ page }, testInfo) => {
  await page.clock.install();
  let calls = 0;
  let release: (() => void) | undefined;
  await page.route("**/api/vaults/*/*/history", async route => {
    calls++;
    if (calls === 1) return route.fulfill({ json: { ...history, history_state: "partial", tvl_source: "cached", retry_after_seconds: 3 } });
    await new Promise<void>(resolve => { release = resolve; });
    return route.fulfill({ json: history });
  });
  await page.goto(`/markets/vault/1/${address}`);
  const waiting = page.getByRole("button", { name: /Retry in \d+s/ });
  await expect(waiting).toBeDisabled();
  expect(calls).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("retry-cooldown.png"), fullPage: true });
  await page.clock.fastForward(4000);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  expect(calls).toBe(2);
  release!();
  await expect(page.locator(".vault-history-note")).not.toContainText("Using cached history.");
  await testInfo.attach("retry-calls", { body: JSON.stringify({ calls, cooldownSeconds: 3 }), contentType: "application/json" });
});

test("Zero APY has readable ticks and filtered APY uses an honest empty label", async ({ page }, testInfo) => {
  for (const apy of [0, null]) {
    await sources(page, false, { points: points.map(point => ({ ...point, pps: 1, apy_7d: apy })) });
    await page.goto(`/markets/vault/1/${address}`);
    await expect(page.getByTestId("vault-history-chart")).toBeVisible();
    if (apy === 0) {
      const ticks = (await page.locator(".vault-axis-tick").allTextContents()).filter(text => text.endsWith("%"));
      expect(new Set(ticks).size).toBe(5);
    } else {
      await expect(page.getByTestId("vault-history-chart")).toContainText("Realized APY unavailable");
      await expect(page.getByTestId("vault-history-chart")).not.toContainText("7 full days needed");
    }
    await page.screenshot({ path: testInfo.outputPath(`apy-${apy}.png`), fullPage: true });
    await page.unrouteAll();
  }
});
