import { expect, test } from "@playwright/test";

test.use({ trace: "on" });

test("leaving Flex cancels its pending performance request", async ({ page }, testInfo) => {
  // A slow API request must not outlive the screen that requested it.
  let started = false;
  let aborted = false;
  page.on("requestfailed", request => {
    if (request.url().includes("/api/flex/performance?")) aborted = true;
  });
  await page.route(/\/api\/flex\/performance\?/, () => { started = true; });
  await page.goto("/flex");
  await expect.poll(() => started).toBe(true);
  await page.locator('a[href="/reports"]').first().click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect.poll(() => aborted, { timeout: 3000 }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("after-navigation.png"), fullPage: true });
});

test("an ordinary data request times out instead of staying pending", async ({ page }, testInfo) => {
  let timedOut = false;
  page.on("requestfailed", request => {
    if (request.url().includes("/api/styfi?")) timedOut = true;
  });
  await page.route(/\/api\/styfi\?/, () => {});
  await page.goto("/styfi");
  await expect.poll(() => timedOut, { timeout: 28_000 }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("request-deadline.png"), fullPage: true });
});
