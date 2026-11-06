import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Produced by e2e_rates.py through HTTP sources, worker normalization, PostgreSQL and the API.
const source = path.resolve(__dirname, "../../reports/rate-fixes/api-results.json");
test.skip(!fs.existsSync(source), "Run api/tests/e2e_rates.py to generate the source/API evidence first.");

for (const mode of ["valid", "stale_price"] as const) {
  test(`Staking displays a verified APR range and boosted stYFIx rate: ${mode}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const evidence = JSON.parse(fs.readFileSync(source, "utf8"));
    const state = evidence.staking[mode];
    await page.route("**/api/styfi?**", route => route.fulfill({ json: {
      current_reward_state: state, summary: { reward_epoch: 18 }, reward_token: { symbol: "yvUSDC-1", decimals: 18 },
      freshness: { latest_snapshot_age_seconds: 0, latest_snapshot_at: new Date().toISOString() },
      series: { snapshots: [], epochs: [] }, recent_activity: [],
    } }));
    await page.goto("/");
    const home = page.locator(".product-entry").filter({ has: page.getByRole("heading", { name: /stYFI/ }) });
    await expect(home.locator(".product-metric")).toHaveText(mode === "valid" ? "8.00–20.00%" : "Unavailable");
    await page.goto("/styfi");
    const rate = page.locator(".kpi-card").filter({ hasText: "stYFI APR range" });
    await expect(rate).toContainText(mode === "valid" ? "8.00–20.00%" : "Unavailable");
    if (mode === "valid") await expect(rate).toContainText("stYFIx 20.00% APR");
    else await expect(rate).not.toContainText("8.00%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`staking-${mode}-mobile.png`) });
  });
}

for (const pending of [false, true]) {
  test(`Staking allocations include Vote Boost and disjoint base shares; pending=${pending}`, async ({ page }, testInfo) => {
    const evidence = JSON.parse(fs.readFileSync(source, "utf8"));
    const data = pending ? evidence.pending_allocations : evidence.epoch_allocations;
    await page.route("**/api/styfi?**", route => route.fulfill({ json: data }));
    await page.goto("/styfi");
    const table = page.getByRole("table", { name: "Epoch allocations" });
    await expect(table.getByRole("columnheader", { name: "Vote Boost" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "stYFIx", exact: true })).toHaveCount(0);
    const row = table.getByRole("row").filter({ has: page.locator('td[data-label="Epoch"]').filter({ hasText: /^17$/ }) });
    await expect(row).toContainText(pending ? "Pending" : "Finalized");
    if (pending) await expect(row.locator('td[data-label="Vote Boost"]')).toHaveText("Pending");
    else {
      await expect(page.getByText("Base reward split · settled epoch 17", { exact: true })).toBeVisible();
      await expect(page.locator(".bar-list li").filter({ hasText: "Direct stYFI" })).toContainText("70%");
      await expect(page.locator(".bar-list li").filter({ hasText: "stYFIx" })).toContainText("30%");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`epoch-allocation-${pending ? "pending" : "settled"}.png`), fullPage: true });
  });
}

test("Vault discovery displays net estimates and the locked yvUSD option", async ({ page }, testInfo) => {
  const evidence = JSON.parse(fs.readFileSync(source, "utf8"));
  await page.route("**/api/discover?**", route => route.fulfill({ json: evidence.discover }));
  await page.goto("/markets?view=vaults&universe=raw");
  for (const [symbol, apy] of [["Locked yvUSD", "7.73%"], ["yvcrvUSD-2", "6.25%"]]) {
    await expect(page.getByRole("row").filter({ hasText: symbol })).toContainText(apy);
  }
  await page.screenshot({ path: testInfo.outputPath("net-vault-estimates.png") });
});

test("Locked yvUSD is a core mover with combined realized returns and USDC share values", async ({ page }, testInfo) => {
  const evidence = JSON.parse(fs.readFileSync(source, "utf8"));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const json = url.pathname.endsWith("/history") ? evidence.locked_history
      : url.pathname === "/api/changes" ? evidence.changes
      : url.pathname === "/api/composition" ? { categories: [], chains: [], tokens: [], summary: { vaults: 2, total_tvl_usd: 1500 } }
      : evidence.core;
    return route.fulfill({ json });
  });
  await page.goto("/markets?view=changes");
  await expect(page.getByRole("row").filter({ hasText: "Locked yvUSD" })).toContainText("10.24%");
  await page.goto("/markets?view=vaults");
  await page.getByRole("row").filter({ hasText: "Locked yvUSD" }).getByRole("link", { name: "Locked yvUSD" }).click();
  await expect(page.getByRole("heading", { name: "Locked yvUSD", exact: true })).toBeVisible();
  await expect(page.locator(".vault-metrics")).toContainText("7.73%");
  await expect(page.locator(".vault-metrics")).toContainText("10.24%");
  await expect(page.locator(".vault-chart-caption")).toContainText("USDC per vault share");
  await page.screenshot({ path: testInfo.outputPath("locked-yvusd-core.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".vault-chart-caption")).toContainText("USDC per vault share");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("locked-yvusd-mobile.png"), fullPage: true });
});
