// @ts-check
import { test, expect } from "./fixtures.js";

/* The phone keeps summaries in IndexedDB and revalidates them with the
   file's ETag, so an unchanged budget.json answers 304. A summary cached
   by an older build (version 2, before the months field existed) must
   not be served again: its SUMMARY_VERSION no longer matches, so it is refetched. */
test("a summary cached by an older build is replaced, not served on a 304", async ({
  page,
}) => {
  await page.route(/private-data-storage\/contents\/budget\.json$/, (route) =>
    route.request().headers()["if-none-match"]
      ? route.fulfill({ status: 304 })
      : route.fallback(),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const db = await new Promise((res) => {
      const r = indexedDB.open("co.data", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("summaries");
      r.onsuccess = () => res(r.result);
    });
    await new Promise((res) => {
      const tx = db.transaction("summaries", "readwrite");
      tx.objectStore("summaries").put(
        {
          v: 2,
          day,
          etag: '"old"',
          summary: {
            lastMonth: { month: "2026-08", spend: 300 },
            avgPerMonth: 300,
            avgMonths: 1,
          },
          at: Date.now(),
        },
        "jackdengler/private-data-storage/budget.json",
      );
      tx.oncomplete = res;
    });
  });
  await page.reload();
  await expect(page.locator("#app.is-entering")).toHaveCount(0);
  const band = page.locator('.band[data-app="budget-together"]');
  const veil = band.locator(".veils");
  const b = await veil.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(band.locator(".veil-row--income .veil")).toHaveText("1,000");
  await expect(band.locator(".veil-row--rate .veil")).toHaveText("70");
  await page.mouse.up();
});
