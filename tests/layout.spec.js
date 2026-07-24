// @ts-check
import { test, expect } from "./fixtures.js";

// Layout / spacing checks for the launcher. Computed-style and bounding-box
// based — they catch broken Tailwind builds, missing CSS variables, and
// grid collapse without the fragility of pixel-perfect screenshot diffs.

test.describe("launcher layout", () => {
  test("background is the cream surface", async ({ page }) => {
    await page.goto("/");
    const bg = await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    // #f6f1e7 = rgb(246, 241, 231)
    expect(bg).toMatch(/rgb\(\s*246,\s*241,\s*231\s*\)/);
  });

  test("greeting block sits at the top of the shell", async ({ page }) => {
    await page.goto("/");
    const shell = page.locator("#app");
    await expect(shell).toBeVisible({ timeout: 10_000 });

    const greeting = page.locator(".greeting");
    await expect(greeting).toBeVisible();
    const box = await greeting.boundingBox();
    expect(box).not.toBeNull();
    // Greeting should be near the top — within the first 40% of the
    // viewport — and occupy a reasonable vertical chunk.
    const viewport = page.viewportSize();
    if (viewport) {
      expect(box.y).toBeLessThan(viewport.height * 0.4);
    }
    expect(box.height).toBeGreaterThan(40);
  });

  test("launcher grid renders every app across a 4-column grid", async ({
    page,
  }) => {
    await page.goto("/");
    const tiles = page.locator("#launcher-grid .icon[data-app]");

    // Tile count should track apps.json rather than a hard-coded number,
    // so adding an app doesn't silently leave this assertion stale.
    const expected = await page.evaluate(async () => {
      const r = await fetch("./apps.json");
      const j = await r.json();
      return j.apps.length;
    });
    await expect(tiles).toHaveCount(expected);

    // Tiles split into rows of 4: within a row baselines align, and each
    // row sits below the one before it. Row-count-agnostic so adding an
    // app (spilling into a new row) doesn't make this assertion stale.
    const ys = await tiles.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top))
    );
    expect(ys).toHaveLength(expected);
    const rows = [];
    for (let i = 0; i < ys.length; i += 4) rows.push(ys.slice(i, i + 4));
    // Within a row, baselines align (tolerate a few px of subpixel).
    for (const row of rows) {
      expect(Math.max(...row) - Math.min(...row)).toBeLessThan(4);
    }
    // Each row sits strictly below the previous one.
    for (let i = 1; i < rows.length; i++) {
      expect(Math.min(...rows[i])).toBeGreaterThan(Math.max(...rows[i - 1]));
    }
  });

  test("tiles share a square aspect and matching size", async ({ page }) => {
    await page.goto("/");
    // The shell starts in `is-booting`; wait for the boot sequence to end
    // before measuring — tiles read as 0×0 mid-fade.
    await expect(page.locator("#app.is-booting")).toHaveCount(0, {
      timeout: 5_000,
    });
    const tiles = page.locator("#launcher-grid .icon[data-app] .tile");
    await expect.poll(
      async () => {
        const box = await tiles.first().boundingBox();
        return box ? Math.round(box.width) : 0;
      },
      { timeout: 5_000 }
    ).toBeGreaterThan(40);

    const sizes = await tiles.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      })
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const { w, h } of sizes) {
      expect(w).toBeGreaterThan(40);
      expect(h).toBeGreaterThan(40);
      expect(Math.abs(w - h)).toBeLessThanOrEqual(2);
    }
    const widths = sizes.map((s) => s.w);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });

  test("flip card front face fills its scene", async ({ page }) => {
    await page.goto("/");
    const front = page.locator(".flip-front");
    await expect(front).toBeVisible();
    const box = await front.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    if (viewport) {
      expect(box.width).toBeGreaterThan(viewport.width * 0.7);
      expect(box.height).toBeGreaterThan(viewport.height * 0.5);
    }
  });

  test("when an app is open the iframe fills the back face", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#launcher-grid")).toBeVisible();
    await page
      .locator('#launcher-grid .icon[data-app="upcoming-movies"]')
      .click();
    const frame = page.locator("#embed-frame");
    await expect(frame).toBeVisible({ timeout: 10_000 });
    const box = await frame.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    if (viewport) {
      // Iframe should occupy nearly the full viewport — minus the top bar.
      expect(box.width).toBeGreaterThan(viewport.width * 0.7);
      expect(box.height).toBeGreaterThan(viewport.height * 0.5);
    }
  });
});
