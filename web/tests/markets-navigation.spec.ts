import { expect, test, type Page } from "@playwright/test";

const vault = { vault_address: `0x${"1".repeat(40)}`, chain_id: 1, symbol: "Review vault", token_symbol: "USDC", market: "stablecoins", tvl_usd: 2_000_000, est_apy: .05, realized_apy_30d: .04, momentum_7d_30d: .01 };
const catalog = { pagination: { total: 1, limit: 250, offset: 0 }, rows: [vault], facets: { chains: [{ chain_id: 1, vaults: 1 }] } };
const composition = { summary: { vaults: 1, total_tvl_usd: 2_000_000 }, chains: [{ chain_id: 1, vaults: 1, tvl_usd: 2_000_000, share_tvl: 1 }], categories: [{ category: "stablecoins", vaults: 1, tvl_usd: 2_000_000, share_tvl: 1 }], tokens: [{ token_symbol: "USDC", vaults: 1, tvl_usd: 2_000_000, share_tvl: 1 }] };

async function sources(page: Page, failed?: string) {
  const requests: string[] = [];
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.pathname === `/api/${failed}`) return route.fulfill({ status: 503, body: "Unavailable" });
    const window = url.searchParams.get("window");
    const count = window === "30d" ? 30 : window === "24h" ? 1 : 7;
    const changes = { summary: { vaults_eligible: count, vaults_with_change: count, tracked_tvl_usd: 2_000_000, flat_vaults: count }, movers: { risers: [], fallers: [] } };
    return route.fulfill({ json: url.pathname === "/api/discover" ? catalog : url.pathname === "/api/composition" ? composition : changes });
  });
  return requests;
}

for (const scenario of [
  { view: "structure", failed: "discover", heading: "Selected vault set" },
  { view: "vaults", failed: "composition", heading: "Vault comparison" },
]) {
  test(`${scenario.view} stays usable when background ${scenario.failed} fails`, async ({ page }, testInfo) => {
    const requests = await sources(page, scenario.failed);
    await page.goto(`/markets?view=${scenario.view}`);
    await expect.poll(() => requests.filter(path => path === `/api/${scenario.failed}`).length).toBe(3);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: scenario.heading, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Data unavailable", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("isolated-source-error.png") });
  });
}

test("Composition reports its own error and retains navigation to healthy cached data", async ({ page }, testInfo) => {
  await sources(page, "composition");
  await page.goto("/markets?view=structure");
  await expect(page.getByRole("heading", { name: "Data unavailable", exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("Tracked TVL", { exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Vault research views" }).getByRole("link", { name: "Find a vault", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open Review vault on Yearn" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("navigate-after-source-error.png") });
});

for (const width of [1440, 390]) {
  test(`Warm views and windows switch without server waits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests = await sources(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/markets?view=changes&universe=raw&market=stablecoins");
    await expect(page.getByRole("heading", { name: "7 days vs preceding 7 days", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    // The asset selector also needs an unfiltered composition for its counts.
    expect(requests).toHaveLength(6);
    let serverNavigations = 0;
    await page.route("**/markets?**", async route => {
      if (new URL(route.request().url()).searchParams.has("_rsc") && route.request().headers()["next-router-prefetch"] !== "1") {
        serverNavigations++;
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
      await route.continue();
    });
    const warmRequests = requests.length;
    const durations: number[] = [];
    const start = Date.now();
    await page.locator("select").filter({ has: page.locator('option[value="30d"]') }).selectOption("30d");
    await expect(page.locator(".kpi-card").filter({ hasText: "Comparable vaults" }).locator(".kpi-value")).toHaveText("30");
    durations.push(Date.now() - start);
    await expect(page).toHaveURL(/window=30d/);
    const nav = page.getByRole("navigation", { name: "Vault research views" });
    for (const [link, heading] of [["Composition", "Selected vault set"], ["Find a vault", "Vault comparison"]]) {
      const started = Date.now();
      await nav.getByRole("link", { name: link, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      durations.push(Date.now() - started);
      await expect(page).toHaveURL(/universe=raw/);
      await expect(page).toHaveURL(/market=stablecoins/);
    }
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Selected vault set", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "30 days vs preceding 30 days", exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Selected vault set", exact: true })).toBeVisible();
    expect(serverNavigations).toBe(0);
    expect(requests.length - warmRequests).toBe(0);
    expect(durations.every(duration => duration < 1000)).toBe(true);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach("switching-results", { body: JSON.stringify({ width, durations, serverNavigations, warmRequests, requestsAfterSwitching: requests.length }), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("cached-navigation.png") });
  });
}

test("Research deep links and legacy redirects retain the selected view and filters", async ({ page }, testInfo) => {
  await sources(page);
  for (const [view, heading] of [["structure", "Selected vault set"], ["changes", "7 days vs preceding 7 days"], ["vaults", "Vault comparison"]]) {
    await page.goto(`/markets?view=${view}&universe=raw&market=stablecoins`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/markets?view=compare&token=USDC&universe=raw&market=stablecoins");
  await expect(page).toHaveURL(/view=vaults/);
  await expect(page).not.toHaveURL(/token=|view=compare/);
  await expect(page).toHaveURL(/market=stablecoins/);
  await page.screenshot({ path: testInfo.outputPath("legacy-redirect.png") });
});
