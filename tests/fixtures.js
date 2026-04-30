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
      { tokenKey: TOKEN_KEY, token: FAKE_TOKEN }
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

    // Iframe URLs for each app — return a tiny stand-in HTML so we never
    // hit the public internet during tests.
    const appHosts = [
      "https://jackdengler.github.io/upcoming-movies/",
      "https://jackdengler.github.io/parlay/",
      "https://jackdengler.github.io/cornerman-site/",
      "https://jackdengler.github.io/polished-space/",
      "https://jackdengler.github.io/clean-script/",
    ];
    for (const url of appHosts) {
      await page.route(url + "**", async (route) => {
        const id = url.replace("https://jackdengler.github.io/", "").replace(/\/$/, "");
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: fakeAppHtml(id),
        });
      });
    }
    // Budget Together is a Google Apps Script URL.
    await page.route(/script\.google\.com\/macros\/.*/i, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: fakeAppHtml("budget-together"),
      });
    });

    await use(page);
  },
});

export { expect };
export const auth = { TOKEN_KEY, FAKE_TOKEN, ALLOWED_LOGIN };
