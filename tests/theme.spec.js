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

/* Team palettes: a second key (co.team) layered over either mode. */
test.describe("team colours", () => {
  test("the team button cycles Classic → Steelers → Penn State → Amherst, persisted", async ({
    page,
  }) => {
    await page.goto("/");
    const html = page.locator("html");
    const btn = page.locator("#team");
    await expect(html).not.toHaveAttribute("data-team", /.+/);
    await btn.click();
    await expect(html).toHaveAttribute("data-team", "steelers");
    await expect(btn).toHaveAttribute("aria-label", "Team colours: Steelers");
    const tape = await page.evaluate(
      () => getComputedStyle(document.querySelector(".tape")).backgroundColor,
    );
    expect(tape).toBe("rgb(255, 182, 18)");
    await btn.click();
    await expect(html).toHaveAttribute("data-team", "psu");
    await btn.click();
    await expect(html).toHaveAttribute("data-team", "amherst");
    await page.reload();
    await expect(html).toHaveAttribute("data-team", "amherst");
    await page.locator("#team").click();
    await expect(html).not.toHaveAttribute("data-team", /.+/);
    expect(await page.evaluate(() => localStorage.getItem("co.team"))).toBe(
      null,
    );
  });

  test("a team keeps the light/dark choice and vice versa", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("#search").fill("penn state theme");
    await page.locator("#search").press("Enter");
    await page.locator("#theme").click();
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-team", "psu");
    await expect(html).toHaveAttribute("data-theme", "light");
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toBe("rgb(243, 246, 251)");
  });

  test("every team and mode keeps text on the page and on the tape readable", async ({
    page,
  }) => {
    await page.goto("/");
    const results = await page.evaluate(() => {
      const hex = (c) => {
        const m = c.match(/\d+/g).map(Number);
        return m.slice(0, 3);
      };
      const lum = ([r, g, b]) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const probe = document.createElement("i");
      document.body.append(probe);
      const token = (name) => {
        probe.style.color = `var(${name})`;
        return hex(getComputedStyle(probe).color);
      };
      const out = [];
      for (const team of window.coTheme.teams) {
        for (const mode of ["dark", "light"]) {
          window.coTheme.setTeam(team);
          window.coTheme.set(mode);
          const ground = token("--ground");
          out.push({
            combo: `${team || "classic"}/${mode}`,
            ink: ratio(token("--ink"), ground),
            ink3: ratio(token("--ink-3"), ground),
            accentInk: ratio(token("--accent-ink"), ground),
            onAccent: ratio(token("--on-accent"), token("--accent")),
          });
        }
      }
      probe.remove();
      return out;
    });
    for (const r of results) {
      for (const k of ["ink", "ink3", "accentInk", "onAccent"]) {
        expect(r[k], `${r.combo} ${k}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
