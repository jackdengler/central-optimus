// @ts-check
import { test, expect, dataFixtures } from "./fixtures.js";

async function appsByHome(page) {
  return page.evaluate(async () => {
    const r = await fetch("./apps.json");
    const { apps } = await r.json();
    return {
      band: apps.filter((a) => a.home === "band").map((a) => a.id),
      strip: apps.filter((a) => a.home === "strip").map((a) => a.id),
    };
  });
}

test.describe("home", () => {
  test("every app in apps.json has exactly one band or strip slot", async ({
    page,
  }) => {
    await page.goto("/");
    const { band, strip } = await appsByHome(page);
    for (const id of band)
      await expect(page.locator(`#bands .band[data-app="${id}"]`)).toHaveCount(
        1,
      );
    for (const id of strip)
      await expect(
        page.locator(`#strip .strip-item[data-app="${id}"]`),
      ).toHaveCount(1);
  });

  test("bands show live readings from the data repo", async ({ page }) => {
    await page.goto("/");
    const fitness = page.locator('.band[data-app="fitness-tracker"]');
    await expect(fitness.locator(".band-num")).toHaveText("10");
    await expect(fitness.locator(".band-sub")).toContainText("LAST 5D AGO");
    // Movies reads like Scores: tickets, then must-sees, then likelies.
    const rows = page.locator(
      '.band[data-app="upcoming-movies"] .score-row-mini',
    );
    await expect(rows.locator("b")).toHaveText([
      "BOOKED",
      "BOOKED",
      "MUST",
      "LIKELY",
    ]);
    await expect(rows.nth(0)).toContainText("DIGGER · ");
    await expect(rows.nth(2)).toContainText("LATER FILM · ");
    await expect(
      page.locator('.band[data-app="upcoming-movies"]'),
    ).not.toContainText("SEEN ALREADY");
    // Less-used apps are names only: no numbers on the strip.
    await expect(page.locator('.strip-item[data-app="parlay"]')).toHaveText(
      /^\s*PARLAY\s*$/i,
    );
    await expect(
      page.locator('.strip-item[data-app="recipe-book"]'),
    ).not.toContainText(/\d/);
  });

  test("the most urgent band leads, with no reason tag", async ({ page }) => {
    await page.goto("/");
    const first = page.locator("#bands .band").first();
    await expect(first).toHaveAttribute("data-app", "fitness-tracker");
    await expect(page.locator(".band-reason")).toHaveCount(0);
  });

  test("a release within two days takes the top spot", async ({ page }) => {
    const data = dataFixtures();
    const soon = new Date();
    soon.setDate(soon.getDate() + 1);
    const key = soon.toLocaleDateString("en-CA");
    data["data/interests.json"].marks.a.date = key;
    data["data/interests.json"].marks.b.date = key;
    await page.route(
      /private-data-storage\/contents\/data%2Finterests\.json|private-data-storage\/contents\/data\/interests\.json/,
      (r) =>
        r.fulfill({
          json: data["data/interests.json"],
          headers: { ETag: '"m"' },
        }),
    );
    await page.goto("/");
    const first = page.locator("#bands .band").first();
    await expect(first).toHaveAttribute("data-app", "upcoming-movies", {
      timeout: 10_000,
    });
    await expect(first.locator(".score-row-mini").first()).toContainText(
      "DIGGER · ",
    );
  });

  test("budget figures stay out of the DOM until held", async ({ page }) => {
    await page.goto("/");
    const band = page.locator('.band[data-app="budget-together"]');
    await expect(band.locator(".veil")).toHaveCount(3);
    await expect(band.locator(".veil").first()).toHaveText("");
    await band.locator(".hold").dispatchEvent("pointerdown");
    await expect(band).toHaveClass(/is-revealed/);
    // Feb (last month): p1 income 1,000 (p2's 900 is not his), spend 300
    // solo → 70% saved.
    await expect(band.locator('.veil[data-key="income"]')).toHaveText("1,000");
    await expect(band.locator('.veil[data-key="spend"]')).toHaveText("300");
    await expect(band.locator('.veil[data-key="rate"]')).toHaveText("70");
  });

  test("search filters the screen and Enter opens the top match", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("#search").fill("mov");
    await expect(
      page.locator('.band[data-app="upcoming-movies"]'),
    ).toBeVisible();
    await expect(
      page.locator('.band[data-app="fitness-tracker"]'),
    ).toBeHidden();
    await expect(page.locator('.strip-item[data-app="parlay"]')).toBeHidden();
    await page.locator("#search").press("Enter");
    await expect(page).toHaveURL(/#app\/upcoming-movies$/);
  });

  test("number keys launch in on-screen order", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#bands .band").first()).toHaveAttribute(
      "data-app",
      "fitness-tracker",
    );
    await page.keyboard.press("1");
    await expect(page).toHaveURL(/#app\/fitness-tracker$/);
  });

  test("holding the tape fast-forwards it; letting go eases it back", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#tape-track")).toContainText(/, JACK/);
    await expect(page.locator("#app.is-entering")).toHaveCount(0);
    const rate = () =>
      page
        .locator("#tape-track")
        .evaluate((e) => e.getAnimations()[0]?.playbackRate);
    expect(await rate()).toBe(1);
    const box = await page.locator(".tape").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(rate).toBe(6);
    await page.mouse.up();
    await expect.poll(rate).toBe(1);
  });

  test("nothing scrolls sideways and strip targets are 44px", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#strip .strip-item")).toHaveCount(7);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const heights = await page
      .locator("#strip .strip-item")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
});
