// @ts-check
import { test, expect } from "./fixtures.js";

// End-to-end launch: tap Movies tile, watch the flip card open, and verify
// the iframe carries the upcoming-movies URL. The fixture intercepts that
// URL so we don't depend on the public site being reachable.

test.describe("launching upcoming-movies from the launcher", () => {
  test("Movies tile opens the upcoming-movies app inside an iframe", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible({
      timeout: 10_000,
    });

    const tile = page.locator(
      '#launcher-grid .icon[data-app="upcoming-movies"]'
    );
    await expect(tile).toBeVisible();
    await tile.click();

    // The launcher pushes #app/<id> to history before flipping.
    await expect(page).toHaveURL(/#app\/upcoming-movies$/, { timeout: 10_000 });

    // Embed shell injects an iframe with id="embed-frame" pointing at the
    // app URL declared in apps.json.
    const frame = page.locator("#embed-frame");
    await expect(frame).toHaveAttribute(
      "src",
      "https://jackdengler.github.io/upcoming-movies/",
      { timeout: 10_000 }
    );
    // Iframe title should reflect the launched app for screen readers.
    await expect(frame).toHaveAttribute("title", /Movies/i);

    // Wait for the flip card to land on the back face.
    await expect(page.locator("#flip-card")).toHaveClass(/is-flipped/, {
      timeout: 10_000,
    });

    // Drill into the iframe and confirm the launcher actually rendered the
    // upcoming-movies banner (intercepted by the fixture).
    const inner = page.frameLocator("#embed-frame");
    await expect(
      inner.locator('[data-fake-app-id="upcoming-movies"]')
    ).toBeVisible({ timeout: 10_000 });

    // Header bar shows the app's name.
    await expect(page.locator("#embed-title")).toHaveText("Movies");
    await expect(page.locator("#embed-home")).toBeVisible();
  });

  test("Home button closes the embed and restores the launcher", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible();
    await page
      .locator('#launcher-grid .icon[data-app="upcoming-movies"]')
      .click();
    await expect(page.locator("#flip-card")).toHaveClass(/is-flipped/, {
      timeout: 10_000,
    });

    await page.locator("#embed-home").click();
    await expect(page.locator("#flip-card")).not.toHaveClass(/is-flipped/, {
      timeout: 10_000,
    });
    // Hash either gets cleared or rolls back to the bare launcher URL.
    await expect(page).not.toHaveURL(/#app\/upcoming-movies/);
    await expect(page.locator("#launcher-grid")).toBeVisible();
  });

  test("Escape closes an open app", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible();
    await page
      .locator('#launcher-grid .icon[data-app="upcoming-movies"]')
      .click();
    await expect(page.locator("#flip-card")).toHaveClass(/is-flipped/, {
      timeout: 10_000,
    });

    await page.keyboard.press("Escape");
    await expect(page.locator("#flip-card")).not.toHaveClass(/is-flipped/, {
      timeout: 10_000,
    });
  });

  test("deep-link to #app/upcoming-movies launches directly into the app", async ({
    page,
  }) => {
    await page.goto("/#app/upcoming-movies");
    // bootSequence skips the zoom and lands on the back face immediately.
    await expect(page.locator("#flip-card")).toHaveClass(/is-flipped/, {
      timeout: 10_000,
    });
    await expect(page.locator("#embed-frame")).toHaveAttribute(
      "src",
      "https://jackdengler.github.io/upcoming-movies/"
    );
  });
});
