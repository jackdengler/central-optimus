// @ts-check
import { test as base, expect } from "@playwright/test";

const TOKEN_KEY = "co.gh.token";
const FAKE_TOKEN = "github_pat_test_token";
const ALLOWED_LOGIN = "jackdengler";

// Minimal HTML stand-in for an embedded app. Each fake app renders a
// banner the launcher tests can assert against, and `?app=` lets us
// distinguish which app's URL the iframe loaded.
const fakeAppHtml = (appId) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Fake ${appId}</title>
  <style>
    body { margin: 0; font-family: system-ui; background: #F5EFE6; }
    .banner { padding: 24px; font-size: 18px; }
    .banner b { font-family: 'PT Serif', serif; }
  </style>
</head>
<body>
  <div class="banner" data-fake-app-id="${appId}">
    Fake <b>${appId}</b> running inside the launcher.
  </div>
</body>
</html>`;

/**
 * Shared fixture for every launcher test:
 *  - disable the SW
 *  - intercept the GitHub API auth check so we don't need a real PAT
 *  - intercept each app's iframe URL so launching doesn't depend on
 *    public github.io being reachable from the test environment
 *  - pre-seed `localStorage` with a token so the auth gate auto-passes
 *    (tests that need to drive the gate manually clear it themselves)
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({ tokenKey, token }) => {
        // Disable the launcher's service worker — its install-time reload
        // races against page queries. Both upcoming-movies and the launcher
        // guard registration with `"serviceWorker" in navigator`, so we
        // need a stub object (not undefined) whose `register` is a no-op.
        try {
          const stub = {
            register: () => Promise.reject(new Error("disabled in tests")),
            ready: new Promise(() => {}),
            addEventListener: () => {},
            removeEventListener: () => {},
            getRegistration: () => Promise.resolve(undefined),
            getRegistrations: () => Promise.resolve([]),
          };
          Object.defineProperty(navigator, "serviceWorker", {
            configurable: true,
            get: () => stub,
          });
        } catch {}
        try {
          localStorage.setItem(tokenKey, token);
        } catch {}
      },
      { tokenKey: TOKEN_KEY, token: FAKE_TOKEN },
    );

    // GitHub auth check.
    await page.route("https://api.github.com/user", async (route) => {
      const auth = route.request().headers()["authorization"] || "";
      if (!auth.includes(FAKE_TOKEN) && !auth.includes("test_token")) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ message: "Bad credentials" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ login: ALLOWED_LOGIN, id: 1 }),
      });
    });

    // Every app is on jackdengler.github.io — return a tiny stand-in page
    // so launching never depends on the public internet.
    await page.route(
      /^https:\/\/jackdengler\.github\.io\/.*/,
      async (route) => {
        const id =
          new URL(route.request().url()).pathname.split("/")[1] || "app";
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: fakeAppHtml(id),
        });
      },
    );

    // Private data repo (GitHub Contents API) → deterministic fixtures.
    await page.route(
      /^https:\/\/api\.github\.com\/repos\/[^/]+\/private-data-storage\/contents\/(.+)$/,
      async (route) => {
        const path = decodeURIComponent(
          route.request().url().split("/contents/")[1],
        );
        const body = dataFixtures()[path];
        if (!body) return route.fulfill({ status: 404, body: "{}" });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            ETag: `"${path}"`,
            "Access-Control-Expose-Headers": "ETag",
          },
          body: JSON.stringify(body),
        });
      },
    );

    // ESPN (scores): deterministic, ESPN-shaped payloads.
    await page.route(/^https:\/\/site\.api\.espn\.com\/.*/, async (route) => {
      const url = route.request().url();
      const body = url.includes("/teams/pit/")
        ? espn().steelers
        : url.includes("/teams/213/")
          ? espn().psu
          : espn().ufc;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });

    // Weather + reverse geocode: fixed, offline.
    await page.route(/api\.open-meteo\.com/, (route) =>
      route.fulfill({
        json: {
          current: { temperature_2m: 68, weather_code: 0 },
          daily: {
            sunrise: ["2026-09-26T06:49"],
            sunset: ["2026-09-26T18:44"],
          },
        },
      }),
    );
    await page.route(/api\.bigdatacloud\.net/, (route) =>
      route.fulfill({ json: { city: "Los Angeles" } }),
    );

    await use(page);
  },
});

/* Local day key N days before today (tests run in the browser's zone). */
function dayKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Synthetic data repo, relative to today:
   - Fitness: lifts every 2 days, last one 5 days ago → 5D > usual 2D,
     so Fitness leads with a reason tag. 10 lifts in the last 30 days.
   - Movies: next booked release in 6 days.
   - Budget: two months of spend with a category split. */
export function dataFixtures() {
  const lifts = [5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 40].map((d, i) => ({
    id: i,
    name: "Workout B",
    date: `${dayKey(d)}T12:00:00`,
    duration: 42,
    sets: new Array(21).fill({}),
  }));
  return {
    "fitness.json": { workoutLogs: lifts, weightLogs: [] },
    "data/interests.json": {
      marks: {
        a: { level: "booked", title: "Digger", date: dayKey(-6) },
        b: { level: "booked", title: "Verity", date: dayKey(-6) },
        c: { level: "must", title: "Later Film", date: dayKey(-20) },
        d: { level: "likely", title: "Maybe Film", date: dayKey(-25) },
        e: {
          level: "must",
          title: "Seen Already",
          date: dayKey(-9),
          watched_date: dayKey(0),
        },
      },
    },
    "data.json": {
      eventName: "UFC 314",
      parlays: [{ id: "p", betIds: ["x", "y"], placed: true }],
      betResults: { x: "win", y: "loss", z: "win" },
      betResultsAt: { x: 1, y: 2, z: 3 },
    },
    "recipes.json": {
      recipes: [{ title: "Korean Beef Bowl", createdAt: "2026-09-01" }],
    },
    "budget.json": {
      transactions: [
        {
          date: "2026-01-05",
          amount: 100,
          category: "dining",
          person: "p1",
          shared: false,
        },
        {
          date: "2026-01-06",
          amount: 200,
          category: "groceries",
          person: "p2",
          shared: true,
        },
        {
          date: "2026-02-05",
          amount: 300,
          category: "dining",
          person: "p1",
          shared: false,
        },
        {
          date: "2026-02-01",
          amount: -1000,
          category: "income",
          person: "p1",
          shared: false,
        },
        {
          date: "2026-02-01",
          amount: -900,
          category: "income",
          person: "p2",
          shared: false,
        },
      ],
      catSplits: { groceries: { mode: "pct", p1Pct: 75 } },
      excludedFromAvg: [],
    },
  };
}

/* ESPN-shaped fixtures. daysFromNow(n, h) → ISO string n days out at h:00 local. */
function daysFromNow(n, h = 13) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
}
function teamEvent({
  date,
  state,
  us,
  them,
  home = true,
  abbr = "PIT",
  opp = "BAL",
  oppName = "Baltimore Ravens",
  win,
  detail,
}) {
  const mine = {
    homeAway: home ? "home" : "away",
    team: { abbreviation: abbr },
    ...(us != null ? { score: { value: us, displayValue: String(us) } } : {}),
    ...(win != null ? { winner: win } : {}),
  };
  const other = {
    homeAway: home ? "away" : "home",
    team: { abbreviation: opp, displayName: oppName },
    ...(them != null ? { score: String(them) } : {}),
    ...(win != null ? { winner: !win } : {}),
  };
  return {
    date,
    competitions: [
      {
        competitors: [mine, other],
        status: {
          type: {
            state,
            completed: state === "post",
            shortDetail: detail || (state === "post" ? "Final" : "Sun 1:00 PM"),
          },
        },
      },
    ],
  };
}
export function espn(overrides = {}) {
  return {
    steelers: {
      events: [
        teamEvent({
          date: daysFromNow(-4),
          state: "post",
          us: 24,
          them: 17,
          win: true,
        }),
        teamEvent({
          date: daysFromNow(3),
          state: "pre",
          home: false,
          opp: "CIN",
          oppName: "Cincinnati Bengals",
        }),
      ],
    },
    psu: {
      events: [
        teamEvent({
          date: daysFromNow(-2),
          state: "post",
          us: 31,
          them: 20,
          abbr: "PSU",
          opp: "UCLA",
          win: true,
        }),
        teamEvent({
          date: daysFromNow(5, 15),
          state: "pre",
          abbr: "PSU",
          opp: "OSU",
          home: false,
        }),
      ],
    },
    ufc: {
      events: [
        {
          name: "UFC 320: Ankalaev vs. Pereira 2",
          shortName: "UFC 320",
          date: daysFromNow(6, 19),
          status: { type: { state: "pre" } },
          competitions: [
            {
              competitors: [
                { athlete: { shortName: "C. Prelim" } },
                { athlete: { shortName: "D. Prelim" } },
              ],
            },
            {
              competitors: [
                { athlete: { shortName: "M. Ankalaev" } },
                { athlete: { shortName: "A. Pereira" } },
              ],
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

export { expect };
export const auth = { TOKEN_KEY, FAKE_TOKEN, ALLOWED_LOGIN };
