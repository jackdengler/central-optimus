// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("visual", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "visual snapshots run only on chromium");

  test("home", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('.band[data-app="fitness-tracker"] .band-num')).toHaveText("10");
    await expect(page.locator(".score-row-mini")).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    // Mask what churns: clock/date/weather, the moving tape, sync time.
    await expect(page).toHaveScreenshot("home.png", {
      mask: [page.locator(".top"), page.locator(".tape"), page.locator(".status"), page.locator(".ticks")],
      animations: "disabled",
      maxDiffPixelRatio: 0.03,
    });
  });

  test("app open", async ({ page }) => {
    await page.goto("/");
    await page.locator('.band[data-app="upcoming-movies"] .band-hit').click();
    await expect(page.locator("#embed")).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot("app-open.png", {
      mask: [page.locator("#embed-frame")],
      animations: "disabled",
      maxDiffPixelRatio: 0.03,
    });
  });
});
