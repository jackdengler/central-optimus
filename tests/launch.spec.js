// @ts-check
import { test, expect } from "./fixtures.js";

// Tapping a band grows the app layer out of it; the iframe carries the
// app URL from apps.json. The fixture intercepts every app URL.

test.describe("launching an app", () => {
  test("Movies band opens upcoming-movies in the app layer", async ({ page }) => {
    await page.goto("/");
    await page.locator('.band[data-app="upcoming-movies"] .band-hit').click();
    await expect(page).toHaveURL(/#app\/upcoming-movies$/);
    const frame = page.locator("#embed-frame");
    await expect(frame).toHaveAttribute("src", "https://jackdengler.github.io/upcoming-movies/");
    await expect(frame).toHaveAttribute("title", /Movies/i);
    await expect(page.locator("#embed")).toBeVisible();
    await expect(page.locator("#embed-title")).toHaveText("Movies");
    await expect(page.frameLocator("#embed-frame").locator('[data-fake-app-id="upcoming-movies"]')).toBeVisible();
  });

  test("strip items launch too", async ({ page }) => {
    await page.goto("/");
    await page.locator('.strip-item[data-app="parlay"]').click();
    await expect(page).toHaveURL(/#app\/parlay$/);
    await expect(page.locator("#embed-frame")).toHaveAttribute("src", "https://jackdengler.github.io/parlay/");
  });

  test("Home closes the app and restores the launcher", async ({ page }) => {
    await page.goto("/");
    await page.locator('.band[data-app="upcoming-movies"] .band-hit').click();
    await expect(page.locator("#embed")).toBeVisible();
    await page.locator("#embed-home").click();
    await expect(page.locator("#embed")).toBeHidden();
    await expect(page).not.toHaveURL(/#app\//);
    await expect(page.locator("#bands")).toBeVisible();
  });

  test("Escape closes an open app", async ({ page }) => {
    await page.goto("/");
    await page.locator('.band[data-app="upcoming-movies"] .band-hit').click();
    await expect(page.locator("#embed")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#embed")).toBeHidden();
  });

  test("browser back closes the app", async ({ page }) => {
    await page.goto("/");
    await page.locator('.band[data-app="upcoming-movies"] .band-hit').click();
    await expect(page).toHaveURL(/#app\/upcoming-movies$/);
    await page.goBack();
    await expect(page.locator("#embed")).toBeHidden();
  });

  test("deep link #app/upcoming-movies opens straight into the app", async ({ page }) => {
    await page.goto("/#app/upcoming-movies");
    await expect(page.locator("#embed")).toBeVisible();
    await expect(page.locator("#embed-frame")).toHaveAttribute("src", "https://jackdengler.github.io/upcoming-movies/");
  });
});
