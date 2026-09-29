// @ts-check
import { test, expect, espn } from "./fixtures.js";

/* Round 10: long-press peek, swipe to a second reading, score moments,
   weather in the header, tilt parallax. */

async function home(page) {
  await page.goto("/");
  await expect(
    page.locator('.band[data-app="fitness-tracker"] .band-num'),
  ).toHaveText("10");
  await expect(page.locator("#app.is-entering")).toHaveCount(0);
}

async function centre(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe("long-press peek", () => {
  test("holding a band opens its actions and does not launch it", async ({
    page,
  }) => {
    await home(page);
    const band = page.locator('.band[data-app="fitness-tracker"]');
    const c = await centre(band);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(page.locator("#peek")).toBeVisible();
    await expect(band).toHaveClass(/is-peeking/);
    await expect(page.locator(".peek-act")).toHaveText([
      "OPEN",
      "MORE",
      "REFRESH",
    ]);
    await expect(page).not.toHaveURL(/#app\//);
    await page.keyboard.press("Escape");
    await expect(page.locator("#peek")).toBeHidden();
    await expect(band).not.toHaveClass(/is-peeking/);
  });

  test("OPEN launches the app; the budget sheet can reveal", async ({
    page,
  }) => {
    await home(page);
    await page
      .locator('.band[data-app="budget-together"] .band-hit')
      .dispatchEvent("contextmenu");
    await expect(page.locator(".peek-act")).toHaveText([
      "OPEN",
      "MORE",
      "REVEAL",
      "REFRESH",
    ]);
    await page.locator(".peek-act", { hasText: "REVEAL" }).click();
    await expect(
      page.locator('.band[data-app="budget-together"] .veil-row--income .veil'),
    ).toHaveText("1,000");
    await page
      .locator('.band[data-app="upcoming-movies"] .band-hit')
      .dispatchEvent("contextmenu");
    await page.locator(".peek-act", { hasText: "OPEN" }).click();
    await expect(page).toHaveURL(/#app\/upcoming-movies$/);
    await expect(page.locator("#peek")).toBeHidden();
  });

  test("tapping the scrim closes the sheet", async ({ page }) => {
    await home(page);
    await page
      .locator('.band[data-app="scores"] .band-hit')
      .dispatchEvent("contextmenu");
    await page.mouse.click(5, 5);
    await expect(page.locator("#peek")).toBeHidden();
  });
});

test.describe("swipe for a second reading", () => {
  test("a sideways drag flips the band and back, without launching", async ({
    page,
  }) => {
    await home(page);
    const band = page.locator('.band[data-app="fitness-tracker"]');
    const c = await centre(band);
    const drag = async (dx) => {
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + dx / 2, c.y, { steps: 4 });
      await page.mouse.move(c.x + dx, c.y, { steps: 4 });
      await page.mouse.up();
    };
    await drag(-120);
    await expect(band).toHaveAttribute("data-view", "alt");
    // Every lift in the fixture falls inside 12 weeks: 11 in all.
    await expect(band.locator(".heat i.on")).toHaveCount(11);
    await expect(band.locator(".alt-cap")).toHaveText("11 LIFTS · 12 WEEKS");
    await expect(band.locator(".view-dots i.on")).toHaveCount(1);
    await expect(page).not.toHaveURL(/#app\//);
    // A small drag is not a swipe: nothing flips, nothing opens.
    await drag(-20);
    await expect(band).toHaveAttribute("data-view", "alt");
    await expect(page).not.toHaveURL(/#app\//);
    await drag(120);
    await expect(band).toHaveAttribute("data-view", "");
    await expect(band.locator(".band-num")).toHaveText("10");
  });

  test("each band's second view, and it survives a data refresh", async ({
    page,
  }) => {
    await home(page);
    for (const hit of await page.locator(".band-hit").all()) {
      await hit.focus();
      await hit.press("ArrowRight");
    }
    const movies = page.locator('.band[data-app="upcoming-movies"]');
    await expect(movies.locator(".cal i")).toHaveCount(35);
    await expect(movies.locator(".cal i.booked")).not.toHaveCount(0);
    // Two films booked on one day count as two.
    await expect(movies.locator(".alt-cap")).toHaveText("2 BOOKED · 1 MUST");
    const budget = page.locator('.band[data-app="budget-together"]');
    await expect(budget.locator(".bar")).not.toHaveCount(0);
    await expect(budget.locator(".bars")).not.toContainText(/\d/);
    await expect(
      page.locator('.band[data-app="scores"] .score-row-mini').first(),
    ).toContainText("2-1 · W 24–17");
    // A refresh re-renders every band; the second view stays put.
    await page.locator("#search").fill("refresh");
    await page.locator("#search").press("Enter");
    await expect(page.locator("#sync-line")).toContainText("SYNCED");
    await expect(movies).toHaveAttribute("data-view", "alt");
    await expect(movies.locator(".cal i")).toHaveCount(35);
  });
});

test.describe("score moments", () => {
  test("a live score going up flips, flashes and leads the tape", async ({
    page,
  }) => {
    let us = 7;
    await page.route(/site\.api\.espn\.com\/.*\/teams\/pit\//, (route) => {
      const json = espn().steelers;
      json.events.push({
        date: new Date().toISOString(),
        competitions: [
          {
            competitors: [
              {
                homeAway: "home",
                team: { abbreviation: "PIT" },
                score: String(us),
              },
              {
                homeAway: "away",
                team: { abbreviation: "CIN" },
                score: "3",
              },
            ],
            status: { type: { state: "in", shortDetail: "Q2 4:12" } },
          },
        ],
      });
      return route.fulfill({ json });
    });
    await page.clock.install();
    await home(page);
    const band = page.locator('.band[data-app="scores"]');
    await expect(band.locator(".score-row-mini.is-live")).toContainText("7–3");
    us = 14;
    await page.clock.runFor(61_000); // the live poll
    await expect(page.locator("#tape-track")).toContainText(
      "TOUCHDOWN STEELERS · PIT 14–3 CIN",
    );
    await expect(band).toHaveClass(/is-scored/);
    await expect(
      band.locator('.score-row-mini[data-team="steelers"]'),
    ).toHaveClass(/is-scoring/);
  });
});

test.describe("weather in the header", () => {
  const weather = (current, daily = {}) => ({
    current,
    daily: {
      sunrise: ["2026-09-26T06:49"],
      sunset: ["2026-09-26T18:44"],
      ...daily,
    },
  });

  test("rain draws streaks behind the header", async ({ page }) => {
    await page.route(/api\.open-meteo\.com/, (r) =>
      r.fulfill({ json: weather({ temperature_2m: 61, weather_code: 63 }) }),
    );
    await home(page);
    await expect(page.locator(".top")).toHaveClass(/is-rain/);
    await expect(page.locator(".tape")).not.toHaveClass(/is-alert/);
  });

  test("a heat warning takes over the tape", async ({ page }) => {
    await page.route(/api\.open-meteo\.com/, (r) =>
      r.fulfill({
        json: weather(
          { temperature_2m: 88, weather_code: 0 },
          { temperature_2m_max: [101] },
        ),
      }),
    );
    await home(page);
    await expect(page.locator(".tape")).toHaveClass(/is-alert/);
    const text = await page.locator("#tape-track span").first().textContent();
    expect(text?.startsWith("HEAT WARNING · HIGH 101° — ")).toBe(true);
    expect(text?.split("HEAT WARNING").length).toBeGreaterThan(2);
    await expect(page.locator(".top")).not.toHaveClass(/is-rain/);
  });

  test("a mild clear day changes nothing", async ({ page }) => {
    await home(page);
    await expect(page.locator(".top")).not.toHaveClass(/is-rain/);
    await expect(page.locator(".tape")).not.toHaveClass(/is-alert/);
  });
});

test.describe("tilt", () => {
  const tilt = (page, gamma, beta) =>
    page.evaluate(
      ([g, b]) =>
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientation", {
            gamma: g,
            beta: b,
          }),
        ),
      [gamma, beta],
    );
  const tiltX = (page) =>
    page.evaluate(() =>
      Number(document.documentElement.style.getPropertyValue("--tilt-x") || 0),
    );

  test("tilting drifts the bands; search turns it off", async ({ page }) => {
    await home(page);
    await tilt(page, 0, 40);
    await tilt(page, 10, 40);
    await expect.poll(() => tiltX(page)).toBeGreaterThan(0.5);
    const shift = await page
      .locator(".band-read")
      .first()
      .evaluate((el) => getComputedStyle(el).translate);
    expect(shift).not.toBe("none");
    await page.locator("#search").fill("tilt");
    await page.locator("#search").press("Enter");
    expect(await tiltX(page)).toBe(0);
    await tilt(page, -10, 40);
    expect(await tiltX(page)).toBe(0);
  });

  test("reduced motion never listens", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await home(page);
    await tilt(page, 0, 40);
    await tilt(page, 10, 40);
    await page.waitForTimeout(200);
    expect(await tiltX(page)).toBe(0);
  });
});
