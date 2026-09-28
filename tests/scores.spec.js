// @ts-check
import { test, expect, espn } from "./fixtures.js";
import { parseSchedule, parseUfc, headline } from "../launcher/scores.js";

const now = new Date(2026, 8, 26, 10, 8);
const ev = (date, state, us, them, extra = {}) => ({
  date,
  competitions: [
    {
      competitors: [
        { homeAway: "home", team: { abbreviation: "PIT" }, score: us == null ? undefined : { value: us, displayValue: String(us) }, ...extra.mine },
        { homeAway: "away", team: { abbreviation: "BAL", displayName: "Baltimore Ravens" }, score: them == null ? undefined : String(them), ...extra.opp },
      ],
      status: { type: { state, completed: state === "post", shortDetail: extra.detail || "" } },
    },
  ],
});

test.describe("scores parsers", () => {
  test("schedule → last result, next game, live game", () => {
    const s = parseSchedule(
      {
        events: [
          ev("2026-09-14T17:00Z", "post", 10, 20),
          ev("2026-09-21T17:00Z", "post", 24, 17),
          ev("2026-09-28T17:00Z", "pre"),
          ev("2026-10-05T17:00Z", "pre"),
        ],
      },
      "PIT",
      now,
    );
    expect(s.live).toBeNull();
    expect(s.last).toMatchObject({ us: "24", them: "17", result: "W", opp: "BAL", home: true });
    expect(s.next.date).toBe("2026-09-28T17:00Z");
  });

  test("an in-progress game is live with its clock", () => {
    const s = parseSchedule({ events: [ev("2026-09-26T17:00Z", "in", 7, 3, { detail: "Q2 4:12" })] }, "PIT", now);
    expect(s.live).toMatchObject({ us: "7", them: "3", detail: "Q2 4:12" });
  });

  test("ESPN's winner flag beats the score comparison", () => {
    const s = parseSchedule({ events: [ev("2026-09-21T17:00Z", "post", 20, 20, { mine: { winner: false }, opp: { winner: true } })] }, "PIT", now);
    expect(s.last.result).toBe("L");
  });

  test("UFC card: the main event is the last bout", () => {
    const u = parseUfc(espn().ufc);
    expect(u.card.name).toBe("UFC 320");
    expect(u.card.main.map((f) => f.name)).toEqual(["A. Fighter", "B. Fighter"]);
  });

  test("headline prefers live, then soonest upcoming, then latest final", () => {
    const pit = { label: "Steelers", ...parseSchedule({ events: [ev("2026-09-21T17:00Z", "post", 24, 17), ev("2026-09-28T17:00Z", "pre")] }, "PIT", now) };
    const psu = { label: "Penn State", ...parseSchedule({ events: [ev("2026-10-03T19:00Z", "pre")] }, "PIT", now) };
    expect(headline([pit, psu], now)).toMatchObject({ kind: "next", team: { label: "Steelers" } });
    const live = { label: "Penn State", live: { us: "7", them: "0" } };
    expect(headline([pit, live], now).kind).toBe("live");
    expect(headline([{ label: "X", last: pit.last }], now).kind).toBe("final");
  });
});

test.describe("scores on the home screen", () => {
  test("the Scores band shows the soonest game and the tape carries results", async ({ page }) => {
    await page.goto("/");
    const band = page.locator('.band[data-app="scores"]');
    await expect(band.locator(".band-sub")).toContainText("PIT @ CIN · ");
    await expect(page.locator("#tape-track")).toContainText("STEELERS W 24–17 VS BAL");
  });

  test("tapping the band opens the scores panel for every team", async ({ page }) => {
    await page.goto("/");
    await page.locator('.band[data-app="scores"] .band-hit').click();
    const panel = page.locator("#scores-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".score-team")).toHaveText(["STEELERS", "PENN STATE", "UFC"]);
    await expect(panel).toContainText("W 24–17 VS BAL");
    await expect(panel).toContainText("A. FIGHTER VS B. FIGHTER");
    await page.locator("#scores-home").click();
    await expect(panel).toBeHidden();
  });

  test("a live game takes the top band", async ({ page }) => {
    const data = espn();
    data.psu.events.push({
      date: new Date().toISOString(),
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { abbreviation: "PSU" }, score: "14" },
            { homeAway: "away", team: { abbreviation: "OSU" }, score: "10" },
          ],
          status: { type: { state: "in", shortDetail: "Q3 8:01" } },
        },
      ],
    });
    await page.route(/site\.api\.espn\.com\/.*\/teams\/213\//, (r) => r.fulfill({ json: data.psu }));
    await page.goto("/");
    const first = page.locator("#bands .band").first();
    await expect(first).toHaveAttribute("data-app", "scores", { timeout: 10_000 });
    await expect(first.locator(".band-num")).toHaveText("14–10");
    await expect(first.locator(".band-reason")).toContainText("LIVE");
  });
});

test.describe("offline + feel", () => {
  test("going offline says so, with the last sync time", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.locator("#sync-line")).toContainText("SYNCED");
    await context.setOffline(true);
    await expect(page.locator("#sync-line")).toContainText("OFFLINE · AS OF");
    await context.setOffline(false);
  });

  test("the sound action toggles and remembers the setting", async ({ page }) => {
    await page.goto("/");
    await page.locator("#search").fill("sound");
    await page.locator("#search").press("Enter");
    expect(await page.evaluate(() => localStorage.getItem("co.sound"))).toBe("0");
  });
});
