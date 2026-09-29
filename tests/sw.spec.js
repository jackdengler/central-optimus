// @ts-check
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/* The shell works offline only if every module the page loads is in the
   service worker's precache list. */
test("every launcher module is precached by the service worker", () => {
  const read = (f) =>
    readFileSync(new URL(`../launcher/${f}`, import.meta.url), "utf8");
  const sw = read("sw.js");
  const shell = new Set([...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]));
  const html = read("index.html");
  const pending = [
    ...[...html.matchAll(/<script[^>]+src="\.\/([^"]+)"/g)].map((m) => m[1]),
  ];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith(".js")) continue;
    for (const m of read(file).matchAll(/from\s+"\.\/([^"]+)"/g))
      pending.push(m[1]);
  }
  const missing = [...seen].filter((f) => !shell.has(f));
  expect(missing).toEqual([]);
  expect(seen.has("tilt.js")).toBe(true);
});
