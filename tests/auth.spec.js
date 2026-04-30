// @ts-check
import { test, expect, auth } from "./fixtures.js";

test.describe("PAT auth gate", () => {
  test("a stored, valid PAT skips the gate dialog", async ({ page }) => {
    await page.goto("/");
    // The gate dialog is in the DOM but should never open when storage
    // already has a valid token.
    await expect(page.locator("#launcher-grid")).toBeVisible({
      timeout: 10_000,
    });
    const open = await page
      .locator("#gate")
      .evaluate((el) => /** @type {HTMLDialogElement} */ (el).open);
    expect(open).toBe(false);
  });

  test("an invalid token surfaces the gate and accepts a fresh PAT", async ({
    page,
  }) => {
    // Wipe the seeded token before app code runs so the gate opens.
    await page.addInitScript((tokenKey) => {
      try {
        localStorage.removeItem(tokenKey);
      } catch {}
    }, auth.TOKEN_KEY);

    await page.goto("/");
    const dialog = page.locator("#gate");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.locator("#token").fill(auth.FAKE_TOKEN);
    await page.locator('#gate-form button[type="submit"]').click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.locator("#launcher-grid")).toBeVisible();
    // Token persisted for the next launch.
    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      auth.TOKEN_KEY
    );
    expect(stored).toBe(auth.FAKE_TOKEN);
  });

  test("a wrong-account token shows an inline error", async ({ page }) => {
    await page.addInitScript((tokenKey) => {
      try {
        localStorage.removeItem(tokenKey);
      } catch {}
    }, auth.TOKEN_KEY);

    // Override the route once for this test so verifyToken returns a
    // login that doesn't match config.githubUser.
    await page.route("https://api.github.com/user", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ login: "someone-else", id: 99 }),
      });
    });

    await page.goto("/");
    await expect(page.locator("#gate")).toBeVisible();
    await page.locator("#token").fill("github_pat_wrong_account");
    await page.locator('#gate-form button[type="submit"]').click();

    const error = page.locator("#gate-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/someone-else/i);
    // Gate stays open until the correct account's token is provided.
    await expect(page.locator("#gate")).toBeVisible();
  });
});
