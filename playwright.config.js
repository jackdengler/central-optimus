// @ts-check
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Fixed location so the weather line is deterministic (the fixture
    // stubs Open-Meteo for these coordinates).
    geolocation: { latitude: 34.05, longitude: -118.24 },
    permissions: ["geolocation"],
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
  // Build the Tailwind stylesheet (gitignored) before serving the launcher.
  webServer: {
    command: `npm run build && npx --yes http-server launcher -p ${PORT} -a ${HOST} -c-1 --silent`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
