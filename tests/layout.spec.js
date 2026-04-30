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

  test("launcher grid renders 6 tiles in two rows", async ({ page }) => {
    await page.goto("/");
    const tiles = page.locator("#launcher-grid .icon[data-app]");
    await expect(tiles).toHaveCount(6);

    // Tiles should split into rows — first 4 share a baseline, the
    // remaining 2 share a baseline below it.
    const ys = await tiles.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top))
    );
    expect(ys).toHaveLength(6);
    const firstRow = ys.slice(0, 4);
    const secondRow = ys.slice(4);
    // Within a row, baselines align (tolerate a few px of subpixel).
    expect(Math.max(...firstRow) - Math.min(...firstRow)).toBeLessThan(4);
    expect(Math.max(...secondRow) - Math.min(...secondRow)).toBeLessThan(4);
    // Second row sits below the first.
    expect(Math.min(...secondRow)).toBeGreaterThan(Math.max(...firstRow));
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
