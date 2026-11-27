import { expect, test } from "@playwright/test";

test("Flex market links reveal the selected detail and retain periods", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/flex?days=7&pnl_days=90");
  const market = page.getByRole("table", { name: "Markets", exact: true })
    .getByRole("row").filter({ hasText: "siUSD/USDC" });
  const open = market.getByRole("link", { name: "siUSD/USDC", exact: true });
  await expect(open).toBeVisible();
  for (const width of [1440, 1024, 720, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.locator(".flex-market-table-wrap").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  const sort = page.getByLabel("Sort markets");
  await sort.selectOption("debt_usd:ascending");
  await expect(sort).toHaveValue("debt_usd:ascending");
  await expect(market.locator('[data-label="Idle liquidity"]')).toHaveText(/\$[\d,.]+\s*[\d,.]+ USDC/);
  await open.click();
  await expect(page).toHaveURL(/market=0x[0-9a-f]{40}#flex-detail-title$/);
  expect(new URL(page.url()).searchParams.get("days")).toBe("7");
  expect(new URL(page.url()).searchParams.get("pnl_days")).toBe("90");
  await expect(page.getByRole("heading", { name: "Market detail", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "siUSD/USDC", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  const heading = page.getByRole("heading", { name: "Market detail", exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

test("Flex shows covered collateral carry, distinct price sources, and price-shock LTV", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/flex");
  const markets = page.getByRole("table", { name: "Markets", exact: true });
  const market = markets.getByRole("link", { name: "yvcrvUSD-2/USDC", exact: true });
  await market.click();
  const pricing = page.getByRole("region", { name: "Collateral and pricing" });
  const collateral = pricing.getByText("7-day collateral APR", { exact: true }).locator("..");
  await expect(collateral).toContainText("Share return in crvUSD");
  await expect(collateral.locator("time")).toHaveText(/UTC$/);
  await expect(pricing).toContainText(/USDC per yvcrvUSD-2/);
  await expect(pricing).toContainText(/USDC per crvUSD/);
  await pricing.getByLabel("Leverage (×)").fill("1");
  const [collateralApr] = (await collateral.locator(".flex-pricing-value").innerText()).split("\n");
  await expect(pricing.getByText("Estimated equity APR", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText(collateralApr);
  await pricing.getByLabel("Leverage (×)").fill("2");
  await pricing.getByLabel("Borrow rate (%)").fill("6");
  await pricing.getByLabel("Oracle price drop (%)").fill("20");
  await expect(pricing.getByText("62.50%", { exact: true })).toBeVisible();
  await expect(pricing.getByText("31.25%", { exact: true })).toBeVisible();
  await pricing.getByLabel("Oracle price drop (%)").fill("50");
  await expect(pricing.getByText("At or above limit", { exact: true })).toBeVisible();
  await pricing.getByLabel("Oracle price drop (%)").fill("100");
  await expect(pricing.getByRole("status")).toContainText("below 100%");
  await pricing.getByLabel("Oracle price drop (%)").fill("20");
  const address = new URL(page.url()).searchParams.get("market");
  const history = await (await page.request.get(`/api/flex/markets/${address}/history?days=30&interval=day`)).json();
  const priceHistory = page.getByRole("group", { name: /^Oracle price history/ });
  await priceHistory.focus();
  await priceHistory.press("ArrowLeft");
  const tooltip = priceHistory.locator(".flex-chart-tooltip");
  await expect(tooltip).toContainText(/Price.*USDC/);
  await expect(priceHistory.locator(".flex-chart-tooltip time")).toHaveAttribute("datetime", history.points.at(-2).block_time);
  const chartBox = (await priceHistory.boundingBox())!;
  await priceHistory.hover({ position: { x: chartBox.width * 0.62, y: chartBox.height / 3 } });
  const tooltipBox = (await tooltip.boundingBox())!;
  expect(tooltipBox.x).toBeGreaterThanOrEqual(chartBox.x - 1);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await pricing.screenshot({ path: testInfo.outputPath("pricing-mobile.png") });
});

test("Flex activity pages grouped redemptions inside the selected market", async ({ page }) => {
  await page.goto("/flex");
  const activity = page.getByRole("region", { name: "Protocol activity" });
  await activity.getByLabel("Activity market").selectOption({ label: "ysyBOLD/USDC · v1.1.0" });
  await activity.getByLabel("Activity event").selectOption("redemption");
  const rows = activity.locator("tbody tr");
  await expect(rows.first()).toContainText(/troves? · up to [\d.]+%/);
  await expect(rows).toHaveCount(12);
  await activity.getByRole("button", { name: "Show more activity" }).click();
  await expect(rows.nth(12)).toBeVisible();
  const loaded = await rows.evaluateAll(elements => elements.map(row => row.querySelector("a")?.href));
  expect(new Set(loaded).size).toBe(loaded.length);
  const request = page.waitForRequest(request => {
    const params = new URL(request.url()).searchParams;
    return request.url().includes("/api/flex/activity?") && params.get("event") === "borrow";
  });
  await activity.getByLabel("Activity event").selectOption("borrow");
  const filters = new URL((await request).url()).searchParams;
  expect(filters.has("market_address")).toBe(true);
  expect(filters.has("cursor")).toBe(false);
  expect(filters.has("group_redemptions")).toBe(false);
  await expect(rows.first()).toContainText("Borrowed");
});
