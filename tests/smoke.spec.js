// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("smoke", () => {
  test("loads the Big Type home with bands, strip and clock", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Central Optimus/i);
    await expect(page.locator("#bands .band")).toHaveCount(4, { timeout: 10_000 });
    await expect(page.locator("#strip .strip-item")).toHaveCount(7);
    await expect(page.locator("#clock")).not.toHaveText(/--/);
    await expect(page.locator("#today-date")).not.toBeEmpty();
    await expect(page.locator("#weather-line")).toContainText("68°");
  });

  test("the ticker greets by first name", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#tape-track")).toContainText(/, JACK/);
  });

  test("loads without console errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
    });
    await page.goto("/");
    await expect(page.locator("#bands .band")).toHaveCount(4, { timeout: 10_000 });
    await expect(page.locator('.band[data-app="fitness-tracker"] .band-num')).toHaveText("10");
    const real = errors.filter(
      (e) =>
        !/icons\/|apple-touch-icon|favicon|manifest|splash|build\.json|404/i.test(e) &&
        !/ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(e),
    );
    expect(real, real.join("\n")).toEqual([]);
  });
});
