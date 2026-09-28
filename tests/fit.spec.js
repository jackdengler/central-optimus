// @ts-check
import { test, expect, espn, dataFixtures } from "./fixtures.js";

/* Every visible piece of a band's reading must sit inside that band's
   diagonal clip: top edge (0, slant)→(W, 0), bottom edge (W, H − slant)→(0, H).
   Long names are the worst case (they must ellipsize, not spill). */
const PHONES = [
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "iPhone SE", width: 375, height: 667 },
];

async function longNames(page) {
  const data = dataFixtures();
  data["fitness.json"].workoutLogs.forEach(
    (l) => (l.name = "Workout B — Upper Body Hypertrophy Push"),
  );
  await page.route(/private-data-storage\/contents\/fitness\.json$/, (r) =>
    r.fulfill({ json: data["fitness.json"], headers: { ETag: '"f2"' } }),
  );
  const ufc = espn().ufc;
  ufc.events[0].name = "UFC Fight Night: Staines-Worthington vs. Abushaarowski";
  await page.route(/site\.api\.espn\.com\/.*\/mma\//, (r) =>
    r.fulfill({ json: ufc }),
  );
}

for (const phone of PHONES) {
  test(`band readings stay inside their diagonal on ${phone.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await longNames(page);
    await page.goto("/");
    await expect(
      page.locator('.band[data-app="fitness-tracker"] .band-num'),
    ).toHaveText("10");
    await expect(page.locator(".score-row-mini")).toHaveCount(3);
    const bad = await page.evaluate(() => {
      const slant = 18;
      const out = [];
      for (const band of document.querySelectorAll(".band")) {
        const b = band.getBoundingClientRect();
        const parts = band.querySelectorAll(
          ".band-read > *, .band-sub > span, .score-row-mini, .veil-row, .band-name",
        );
        for (const el of parts) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || getComputedStyle(el).display === "none")
            continue;
          const xl = r.left - b.left;
          const xr = r.right - b.left;
          const top = r.top - b.top;
          const bottom = r.bottom - b.top;
          const minTop = slant * (1 - xl / b.width);
          const maxBottom = b.height - (slant * xr) / b.width;
          const label = `${band.dataset.app} ${el.className || el.tagName}`;
          if (xl < 0 || xr > b.width + 0.5)
            out.push(
              `${label}: x ${xl.toFixed(0)}–${xr.toFixed(0)} of ${b.width}`,
            );
          if (top < minTop - 0.5)
            out.push(`${label}: top ${top.toFixed(1)} < ${minTop.toFixed(1)}`);
          if (bottom > maxBottom + 0.5)
            out.push(
              `${label}: bottom ${bottom.toFixed(1)} > ${maxBottom.toFixed(1)}`,
            );
        }
        // The app name and the reading never overlap.
        const n = band.querySelector(".band-name").getBoundingClientRect();
        const rd = band.querySelector(".band-read").getBoundingClientRect();
        const overlap =
          n.left < rd.right &&
          rd.left < n.right &&
          n.top < rd.bottom &&
          rd.top < n.bottom;
        if (overlap) out.push(`${band.dataset.app}: name overlaps reading`);
      }
      return out;
    });
    expect(bad).toEqual([]);
  });
}
