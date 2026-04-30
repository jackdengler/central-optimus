// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("launcher grid", () => {
  test("each apps.json entry has a tile, and tile order matches DOM", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible();

    const apps = await page.evaluate(async () => {
      const r = await fetch("./apps.json");
      return r.json();
    });
    expect(Array.isArray(apps.apps)).toBe(true);

    for (const app of apps.apps) {
      // index.html ships the tiles statically — every app in the registry
      // should have a corresponding tile, even if `app.url` is missing.
      const tile = page.locator(
        `#launcher-grid .icon[data-app="${app.id}"]`
      );
      await expect(tile, `tile for ${app.id}`).toHaveCount(1);
    }
  });

  test("Movies tile has the wine-red accent color from apps.json", async ({
    page,
  }) => {
    await page.goto("/");
    const tile = page.locator('#launcher-grid .icon[data-app="upcoming-movies"]');
    await expect(tile).toBeVisible();
    const accent = await tile.evaluate(
      (el) => getComputedStyle(el).getPropertyValue("--tile-accent").trim()
    );
    expect(accent.toLowerCase()).toBe("#a32929");
  });

  test("number-key shortcut launches the corresponding tile", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible();

    // Tile #1 is Movies → upcoming-movies (per index.html ordering).
    await page.keyboard.press("1");
    await expect(page).toHaveURL(/#app\/upcoming-movies$/, { timeout: 10_000 });
  });
});
