import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Produced by e2e_rates.py through HTTP sources, worker normalization, PostgreSQL and the API.
const source = path.resolve(__dirname, "../../reports/rate-fixes/api-results.json");

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

test("Vault discovery displays net estimates and the locked yvUSD option", async ({ page }, testInfo) => {
  const evidence = JSON.parse(fs.readFileSync(source, "utf8"));
  await page.route("**/api/discover?**", route => route.fulfill({ json: evidence.discover }));
  await page.goto("/markets?view=vaults&universe=raw");
  for (const [symbol, apy] of [["Locked yvUSD", "7.73%"], ["yvcrvUSD-2", "6.25%"]]) {
    await expect(page.getByRole("row").filter({ hasText: symbol })).toContainText(apy);
  }
  await page.screenshot({ path: testInfo.outputPath("net-vault-estimates.png") });
});
