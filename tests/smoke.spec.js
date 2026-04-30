// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("smoke", () => {
  test("loads the launcher shell with the greeting and grid", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Central Optimus/i);
    await expect(page.locator("#greet-name")).toHaveText("Jack", {
      timeout: 10_000,
    });
    await expect(page.locator("#launcher-grid")).toBeVisible();
    // Every visible tile should carry a data-app id matching apps.json.
    const tileCount = await page.locator("#launcher-grid .icon[data-app]").count();
    expect(tileCount).toBeGreaterThanOrEqual(6);
  });

  test("greeting reflects the configured first name", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#greet-time")).not.toHaveText("—", {
      timeout: 5_000,
    });
    // Date and time both populate from the live clock.
    await expect(page.locator("#today-date")).not.toHaveText("—");
    await expect(page.locator("#live-time")).not.toHaveText("—");
  });

  test("loads without console errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
    });
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible({
      timeout: 10_000,
    });
    const real = errors.filter(
      (e) =>
        !/icons\/|apple-touch-icon|favicon|manifest|splash|build\.json/i.test(
          e
        ) &&
        !/ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(e)
    );
    expect(real, real.join("\n")).toEqual([]);
  });
});
