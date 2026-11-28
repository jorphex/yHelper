import { expect, test, type Locator } from "@playwright/test";

const CRVUSD_MARKET = "0x7582b47486f75f5d675f260d357972cd0dbeea2e";

function clippedOptionLabels(controls: Locator) {
  return controls.evaluateAll(fields => {
    const measure = document.createElement("canvas").getContext("2d")!;
    return (fields as HTMLSelectElement[]).flatMap(field => {
      const style = getComputedStyle(field);
      measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const available = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return Array.from(field.options, option => option.label).filter(label => measure.measureText(label).width > available + 1);
    });
  });
}

test("Flex market links reveal the selected detail and retain periods", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let releaseMarkets!: () => void;
  const marketsReady = new Promise<void>(resolve => { releaseMarkets = resolve; });
  await page.route("**/api/flex/markets?status=all", async route => {
    await marketsReady;
    await route.continue();
  });
  await page.goto("/flex?days=7&pnl_days=90#flex-performance-title");
  const performance = page.getByRole("heading", { name: "Performance", exact: true });
  await expect(performance).toBeFocused().finally(releaseMarkets);
  await expect(page.getByRole("heading", { name: "Rates", exact: true })).toBeVisible();
  await expect(performance).toBeInViewport();
  const market = page.getByRole("table", { name: "Markets", exact: true })
    .getByRole("row").filter({ hasText: "siUSD/USDC" });
  const open = market.getByRole("link", { name: "siUSD/USDC", exact: true });
  await expect(open).toBeVisible();
  await expect(page).toHaveURL(/market=0x[0-9a-f]{40}#flex-performance-title$/);
  await expect(market.locator('[data-column="debt_usd"]')).toBeVisible();
  for (const width of [1440, 1024, 720, 390, 320, 361]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.locator(".flex-market-table-wrap").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  const sort = page.getByLabel("Sort markets");
  await expect(market.locator('[data-column="debt_usd"]')).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
  expect(await clippedOptionLabels(sort)).toEqual([]);
  await sort.selectOption("debt_usd:ascending");
  await expect(market.locator(".flex-card-sort-value")).toHaveText(/^Debt \$/);
  await expect(market.locator('[data-label="Idle liquidity"]')).toHaveText(/\$[\d,.]+\s*[\d,.]+ USDC/);
  await open.click();
  await expect(page).toHaveURL(/market=0x[0-9a-f]{40}#flex-detail-title$/);
  expect(new URL(page.url()).searchParams.get("days")).toBe("7");
  expect(new URL(page.url()).searchParams.get("pnl_days")).toBe("90");
  const heading = page.getByRole("heading", { name: "siUSD/USDC", exact: true });
  await expect(heading).toBeInViewport();
  await expect(page.getByRole("combobox", { name: "Choose a market" })).toHaveValue(new URL(page.url()).searchParams.get("market")!);
  await page.reload();
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

test("Flex keeps the Activity deep link in view as market detail loads", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseMarkets!: () => void;
  const marketsReady = new Promise<void>(resolve => { releaseMarkets = resolve; });
  await page.route("**/api/flex/markets?status=all", async route => {
    await marketsReady;
    await route.continue();
  });
  await page.goto("/flex#flex-activity-title");
  const heading = page.getByRole("heading", { name: "Protocol activity", exact: true });
  await expect(heading).toBeFocused().finally(releaseMarkets);
  await expect(page.getByRole("heading", { name: "Rates", exact: true })).toBeVisible();
  await expect(heading).toBeInViewport();
});

test("Flex shows covered collateral carry, distinct price sources, and price-shock LTV", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let finishFirstQuote!: () => void;
  let finishFailedRetry!: () => void;
  const firstQuote = new Promise<void>(resolve => { finishFirstQuote = resolve; });
  const failedRetry = new Promise<void>(resolve => { finishFailedRetry = resolve; });
  let attempts = 0;
  await page.route(`**/api/flex/markets/${CRVUSD_MARKET}/peg`, async route => {
    const attempt = ++attempts;
    if (attempt === 1) await firstQuote;
    if (attempt === 2) await failedRetry;
    if (attempt === 1 || attempt === 2 || attempt === 4) {
      await route.fulfill({ status: 503, json: { detail: "Curve quote is temporarily unavailable." } });
      return;
    }
    await route.fulfill({ json: {
      asset_symbol: "crvUSD", usdc_per_token: attempt === 3 ? 0.997844 : 0.997845, pool_address: "0x4dece678ceceb27446b35c672dc7d61f30bad69e",
      block_number: 26505804, block_time: "2026-11-27T10:00:00+00:00",
    } });
  });
  await page.goto("/flex");
  const markets = page.getByRole("table", { name: "Markets", exact: true });
  const market = markets.getByRole("link", { name: "yvcrvUSD-2/USDC", exact: true });
  await market.click();
  const pricing = page.getByRole("region", { name: "Collateral and pricing" });
  const collateral = pricing.getByText("7-day collateral APR", { exact: true }).locator("..");
  await expect(collateral).toContainText("Share return in crvUSD");
  await expect(collateral.locator("time")).toHaveText(/UTC$/);
  await expect(pricing).toContainText(/USDC per yvcrvUSD-2/);
  await expect(pricing.getByText("Loading quote…")).toBeVisible().finally(finishFirstQuote);
  await expect(pricing.getByText("Quote temporarily unavailable.")).toBeVisible();
  const retry = pricing.getByRole("button", { name: "Retry quote" });
  await retry.focus();
  await page.keyboard.press("Enter");
  try {
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
  } finally {
    finishFailedRetry();
  }
  await expect(retry).toHaveAttribute("aria-disabled", "false");
  await expect(retry).toBeFocused();
  await page.keyboard.press("Enter");
  const quote = pricing.getByText("Curve sell quote", { exact: true }).locator("..");
  await expect(quote).toContainText(/0\.997844.*USDC per crvUSD/);
  await expect(quote.locator("dd").first()).toBeFocused();
  expect(attempts).toBe(3);
  const picker = page.getByRole("combobox", { name: "Choose a market" });
  await page.clock.setFixedTime(new Date(Date.now() + 61_000));
  await picker.selectOption({ label: "siUSD/USDC" });
  await expect(quote).toBeHidden();
  await picker.selectOption({ label: "yvcrvUSD-2/USDC" });
  await expect(quote.getByRole("status")).toHaveText("Refresh failed. Showing the last quote.");
  await expect(quote).toContainText(/0\.997844.*USDC per crvUSD/);
  await expect(quote.locator("time")).toHaveAttribute("datetime", "2026-11-27T10:00:00+00:00");
  await retry.click();
  await expect(quote).toContainText(/0\.997845.*USDC per crvUSD/);
  await expect(retry).toBeHidden();
  const leverage = pricing.getByLabel("Leverage (×)");
  const rate = pricing.getByLabel("Borrow rate (%)");
  await leverage.fill("1");
  await rate.fill("");
  await expect(rate).toHaveAttribute("aria-invalid", "false");
  const [collateralApr] = (await collateral.locator(".flex-pricing-value").innerText()).split("\n");
  const apr = pricing.getByText("Estimated equity APR", { exact: true }).locator("../dd");
  await expect(apr).toHaveText(collateralApr);
  await pricing.getByLabel("Oracle price drop (%)").fill("90");
  await expect(pricing.getByText("Further drop to liquidation", { exact: true }).locator("../dd")).toHaveText("No debt");
  await leverage.fill("2");
  await expect(apr).toHaveText("—");
  await rate.fill("6");
  await pricing.getByLabel("Oracle price drop (%)").fill("20");
  await expect(pricing.getByText("62.50%", { exact: true })).toBeVisible();
  await expect(pricing.getByText("31.25%", { exact: true })).toBeVisible();
  await expect(pricing.getByText("Liquidation limit", { exact: true }).locator("../dd")).toHaveText("90.91%");
  const carry = await apr.innerText();
  await pricing.getByLabel("Oracle price drop (%)").fill("50");
  await expect(pricing.getByText("At or above limit", { exact: true })).toBeVisible();
  await expect(pricing.locator('[data-limit="breached"]')).toContainText("100.00%");
  await pricing.getByLabel("Oracle price drop (%)").fill("100");
  await expect(pricing.getByLabel("Oracle price drop (%)")).toHaveAccessibleDescription(/below 100%/);
  await expect(apr).toHaveText(carry);
  await pricing.getByLabel("Oracle price drop (%)").fill("20");
  await rate.fill("");
  await expect(apr).toHaveText("—");
  await expect(pricing.getByText("62.50%", { exact: true })).toBeVisible();
  await rate.fill("6");
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
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect.poll(() => page.locator(".flex-chart-panel .flex-chart-interactive").evaluateAll(([first, second]) => {
    const utilization = first.getBoundingClientRect();
    const rates = second.getBoundingClientRect();
    return rates.x > utilization.x && Math.abs(rates.y - utilization.y) < 1;
  })).toBe(true);
});

test("Flex scenario handles exact borrowing and liquidation limits", async ({ page }) => {
  await page.route(`**/api/flex/markets/${CRVUSD_MARKET}`, async route => {
    const response = await route.fetch();
    const detail = await response.json();
    detail.risk.minimum_annual_interest_rate = 0.07;
    detail.risk.maximum_annual_interest_rate = 0.29;
    await route.fulfill({ response, json: detail });
  });
  await page.goto(`/flex?market=${CRVUSD_MARKET}`);
  const rate = page.getByLabel("Borrow rate (%)");
  const apr = page.getByText("Estimated equity APR", { exact: true }).locator("../dd");
  for (const value of ["7", "29"]) {
    await rate.fill(value);
    await expect(rate).toHaveAttribute("aria-invalid", "false");
    await expect(rate).toHaveJSProperty("validationMessage", "");
    await expect(apr).not.toHaveText("—");
  }
  for (const value of ["6.999", "29.001"]) {
    await rate.fill(value);
    await expect(rate).toHaveAccessibleDescription("Enter 7%–29%.");
    await expect(apr).toHaveText("—");
  }
  await page.getByLabel("Leverage (×)").fill("5.5");
  const drop = page.getByLabel("Oracle price drop (%)");
  const atLimit = page.getByText("At or above limit", { exact: true });
  await drop.fill("9.99");
  await expect(atLimit).toBeHidden();
  await drop.fill("10");
  await expect(atLimit).toBeVisible();
});

test("Flex activity pages grouped redemptions inside the selected market", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/flex");
  const activity = page.getByRole("region", { name: "Protocol activity" });
  await activity.getByLabel("Activity market").selectOption({ label: "ysyBOLD/USDC · v1.1.0" });
  await activity.getByLabel("Activity event").selectOption("redemption");
  const marketFilter = (await activity.getByLabel("Activity market").boundingBox())!;
  const eventFilter = (await activity.getByLabel("Activity event").boundingBox())!;
  expect(marketFilter.y + marketFilter.height).toBeLessThan(eventFilter.y);
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
  await page.evaluate(() => document.fonts.ready);
  for (const width of [430, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await clippedOptionLabels(activity.locator("select")), `Activity labels clipped at ${width}px`).toEqual([]);
  }
});
