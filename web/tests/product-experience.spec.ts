import { expect, test } from "@playwright/test";

const address = `0x${"1".repeat(40)}`;
const transaction = `0x${"2".repeat(64)}`;
const vault = { vault_address: address, chain_id: 1, symbol: "Needle", token_symbol: "USDC", market: "stablecoins", tvl_usd: 2_000_000, est_apy: .05, realized_apy_30d: .04, momentum_7d_30d: .01 };
const catalog = { pagination: { total: 1, limit: 250, offset: 0 }, rows: [vault], facets: { chains: [{ chain_id: 1, vaults: 1 }] } };

test("Home keeps every destination available when sources fail", async ({ page }) => {
  const pulseRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("overview-pulse")) pulseRequests.push(request.url()); });
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/");
  await expect(page.getByText("Staking snapshot is unavailable")).toBeVisible();
  for (const name of ["View staking rewards", "Explore lending markets", "View locker rewards", "Vault reports →", "Find a vault"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  expect(pulseRequests).toEqual([]);
});

test("Home distinguishes delayed snapshots from current rates", async ({ page }) => {
  await page.route("**/api/styfi?**", (route) => route.fulfill({ json: { summary: { reward_epoch: 15 }, current_reward_state: { styfi_current_apr: .1234 }, freshness: { latest_snapshot_age_seconds: 7200 } } }));
  await page.route("**/api/flex/markets?**", (route) => route.fulfill({ json: { freshness: { data_state: "delayed" }, rows: [], summary: {} } }));
  await page.route("**/api/ylockers/rewards?**", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/");
  await expect(page.getByText("Staking snapshot is delayed")).toBeVisible();
  await expect(page.getByText("Market snapshot is delayed")).toBeVisible();
  await expect(page.getByText("12.34%", { exact: true })).toHaveCount(0);
});

test("Vault search includes later API pages and keeps its query in the URL", async ({ page }) => {
  await page.route("**/api/discover?**", (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset") || 0);
    const rows = offset ? [vault] : Array.from({ length: 250 }, (_, i) => ({ ...vault, symbol: `Other${i}`, vault_address: `0x${i.toString(16).padStart(40, "0")}` }));
    return route.fulfill({ json: { ...catalog, pagination: { total: 251, limit: 250, offset }, rows } });
  });
  await page.goto("/markets");
  const input = page.getByRole("searchbox", { name: "Find by vault name, asset, or address" });
  await input.pressSequentially("Needle", { delay: 75 });
  await expect(page.getByRole("table", { name: "Vault comparison" }).locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Open Needle on Yearn" })).toBeVisible();
  await expect(page).toHaveURL(/q=Needle/);
  await page.reload();
  await expect(input).toHaveValue("Needle");
  await expect(page.getByRole("link", { name: "Reports", exact: true })).toHaveAttribute("href", new RegExp(`vault_address=${address}&chain_id=1`));
});

test("Reports find a named vault and disclose exact accounting without rounding", async ({ page }) => {
  await page.route("**/api/discover?**", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/reports?**", (route) => route.fulfill({ json: {
    available_chains: [{ chain_id: 1, chain_label: "Ethereum" }],
    recent: [{ chain_id: 1, block_time: "2026-09-05T05:00:00Z", tx_hash: transaction, log_index: 0, vault_address: address, vault_symbol: "Needle", token_symbol: "TEST", token_decimals: 18, strategy_address: address, report_type: "realized_result", gain: "1234567890123456789", loss: "1", fee_assets: "123456789012345678", refund_assets: "0", debt_after: "900719925474099312345678901234567890" }],
  } }));
  await page.goto("/reports");
  await expect(page.locator("#report-vault-options option")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Find a vault by name or address" }).fill("Needle");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`vault_address=${address}`));
  await expect(page).toHaveURL(/chain_id=1/);
  const summary = page.locator(".report-evidence summary").first();
  await summary.focus();
  await page.keyboard.press("Enter");
  const evidence = page.locator(".report-evidence[open]");
  await expect(evidence).toContainText("1.234567890123456789 TEST");
  await expect(evidence).toContainText("0.000000000000000001 TEST");
  await expect(evidence).toContainText("900,719,925,474,099,312.34567890123456789 TEST");
  await expect(evidence.getByRole("link", { name: transaction })).toHaveAttribute("href", `https://etherscan.io/tx/${transaction}`);
  await page.keyboard.press("Enter");
  await expect(page.locator(".report-evidence[open]")).toHaveCount(0);
});

for (const width of [1440, 720, 390]) {
  test(`Product pages reflow and disclose evidence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const path of ["/", "/markets", "/markets?view=changes", "/markets?view=structure", "/reports", "/reports?view=lockers", "/styfi", "/flex"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
      for (const summary of await page.locator("main > div summary, main summary").all()) {
        // Only open the first report row; other disclosures contain distinct functionality.
        if (await summary.evaluate((el) => el.closest(".report-evidence") !== null) && await page.locator(".report-evidence[open]").count()) continue;
        if (!await summary.isVisible()) continue;
        await summary.focus();
        await page.keyboard.press("Enter");
        expect(await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open)).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} expanded`).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test("Mobile navigation and Flex chart controls stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/flex", { waitUntil: "networkidle" });
  await expect(page.getByRole("navigation", { name: "Primary", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Primary", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await page.getByRole("button", { name: "90 days", exact: true }).click();
  await expect(page).toHaveURL(/days=90/);
  const capacity = page.locator('.flex-redemption-section [tabindex="0"]').first();
  await expect(capacity).toBeVisible();
  await capacity.focus();
  await page.keyboard.press("ArrowRight");
  await expect(capacity).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
