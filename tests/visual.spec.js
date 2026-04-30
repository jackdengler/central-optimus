// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("visual", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "visual snapshots run only on chromium"
  );

  test("launcher home", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible({
      timeout: 10_000,
    });
    // Live data churns every minute (greeting, time, weather), so mask
    // those regions and compare only the chrome that should be stable.
    await expect(page).toHaveScreenshot("launcher-home.png", {
      fullPage: false,
      mask: [
        page.locator(".greeting"),
        page.locator(".base"),
        page.locator(".watch-canvas"),
      ],
      maxDiffPixelRatio: 0.03,
    });
  });

  test("upcoming-movies launched in the back face", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible();
    await page
      .locator('#launcher-grid .icon[data-app="upcoming-movies"]')
      .click();
    await expect(page.locator("#flip-card")).toHaveClass(/is-flipped/, {
      timeout: 10_000,
    });
    await expect(page).toHaveScreenshot("launched-movies.png", {
      fullPage: false,
      mask: [page.locator("#embed-frame")],
      maxDiffPixelRatio: 0.03,
    });
  });
});
