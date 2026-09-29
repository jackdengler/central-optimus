// @ts-check
import { test, expect } from "./fixtures.js";

/* Light / dark mode: one shared localStorage key (co.theme) that the
   launcher and its same-origin apps all read. */
test.describe("theme", () => {
  test("defaults to dark and the header button toggles light, persisted", async ({
    page,
  }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.locator("#theme").click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(page.locator("#theme")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await page.evaluate(() => localStorage.getItem("co.theme"))).toBe(
      "light",
    );
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toBe("rgb(245, 242, 234)");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
  });

  test("the search action flips the theme too", async ({ page }) => {
    await page.goto("/");
    await page.locator("#search").fill("light");
    await page.locator("#search").press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
