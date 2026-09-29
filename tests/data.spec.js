// @ts-check
import { test, expect } from "@playwright/test";
import { summarize, SOURCES, SUMMARY_VERSION } from "../launcher/data.js";
import { dataFixtures } from "./fixtures.js";

// Pure summarizer tests (no browser). Budget cases mirror budget-together's
// compute('p1') rules; the port was checked against that code on the real
// ledger (0 mismatches over 12 months).

const now = new Date(2026, 8, 26, 10, 8); // Sat 26 Sep 2026, local

test.describe("budget summarizer", () => {
  const base = { catSplits: {}, excludedFromAvg: [], customCategories: [] };
  const tx = (date, amount, extra = {}) => ({
    date,
    amount,
    category: "dining",
    person: "p1",
    shared: false,
    ...extra,
  });

  test("counts only Jack's solo spend plus his share of shared spend", () => {
    const s = summarize.budget(
      {
        ...base,
        transactions: [
          tx("2026-08-02", 100),
          tx("2026-08-03", 999, { person: "p2" }), // partner's solo: not mine
          tx("2026-08-04", 200, { shared: true }), // default split 50%
        ],
      },
      now,
    );
    expect(s.lastMonth).toMatchObject({ month: "2026-08", spend: 200 });
  });

  test("honours pct and fixed-dollar category splits, per month", () => {
    const s = summarize.budget(
      {
        ...base,
        catSplits: {
          groceries: { mode: "pct", p1Pct: 75 },
          housing: { mode: "dollar", p1Amt: 3075 },
        },
        transactions: [
          tx("2026-08-01", 400, { category: "groceries", shared: true }),
          tx("2026-08-01", 2500, {
            category: "housing",
            shared: true,
            person: "p2",
          }),
          tx("2026-08-15", 2500, {
            category: "housing",
            shared: true,
            person: "p2",
          }),
        ],
      },
      now,
    );
    // 75% of 400 = 300; housing total 5000 → Jack covers a fixed 3075.
    expect(s.lastMonth.spend).toBe(300 + 3075);
  });

  test("settled transactions keep their frozen settledSplit", () => {
    const s = summarize.budget(
      {
        ...base,
        catSplits: { groceries: { mode: "pct", p1Pct: 75 } },
        transactions: [
          tx("2026-08-01", 100, {
            category: "groceries",
            shared: true,
            settled: true,
            settledSplit: 0.65,
          }),
        ],
      },
      now,
    );
    expect(s.lastMonth.spend).toBe(65);
  });

  test("skips refunds, excluded rows and ignored categories", () => {
    const s = summarize.budget(
      {
        ...base,
        customCategories: [{ id: "pets", ignored: true }],
        transactions: [
          tx("2026-08-01", 50),
          tx("2026-08-01", -20), // refund / income sign
          tx("2026-08-01", 70, { excluded: true }),
          ...[
            "gambling",
            "cash",
            "insurance",
            "transfer",
            "investing",
            "pets",
          ].map((category) => tx("2026-08-01", 1000, { category })),
        ],
      },
      now,
    );
    expect(s.lastMonth.spend).toBe(50);
  });

  test("average skips excludedFromAvg months and the month in progress", () => {
    const s = summarize.budget(
      {
        ...base,
        excludedFromAvg: ["2026-06"],
        transactions: [
          tx("2026-06-01", 9999),
          tx("2026-07-01", 100),
          tx("2026-08-01", 300),
          tx("2026-09-01", 5000),
        ],
      },
      now,
    );
    expect(s.lastMonth).toMatchObject({ month: "2026-08", spend: 300 });
    expect(s.avgPerMonth).toBe(200);
    expect(s.avgMonths).toBe(2);
  });

  test("income vs spend and savings rate, as budget-together's ring card", () => {
    const inc = (date, amount, person = "p1", extra = {}) => ({
      date,
      amount: -amount,
      category: "income",
      person,
      shared: false,
      ...extra,
    });
    const s = summarize.budget(
      {
        ...base,
        transactions: [
          tx("2026-08-03", 1500),
          inc("2026-08-01", 4000),
          inc("2026-08-15", 1000),
          inc("2026-08-15", 3000, "p2"), // not Jack's
          inc("2026-08-20", 500, "p1", { excluded: true }), // excluded
          inc("2026-09-01", 9000), // month in progress
        ],
      },
      now,
    );
    expect(s.lastMonth).toEqual({
      month: "2026-08",
      spend: 1500,
      income: 5000,
      saved: 3500,
      rate: 70,
    });
    // No income → no rate (never a divide-by-zero "−∞%").
    const t = summarize.budget(
      { ...base, transactions: [tx("2026-08-03", 100)] },
      now,
    );
    expect(t.lastMonth.rate).toBeNull();
  });
});

test.describe("fitness summarizer", () => {
  test("30-day lift count, days since last lift, and the usual gap", () => {
    const logs = ["2026-09-20", "2026-09-21", "2026-09-23", "2026-08-01"].map(
      (d, i) => ({ id: i, name: "Workout B", date: d, duration: 42, sets: [] }),
    );
    const s = summarize.fitness({ workoutLogs: logs }, now);
    expect(s.last30).toEqual(["2026-09-20", "2026-09-21", "2026-09-23"]);
    expect(s.lastLift).toMatchObject({
      day: "2026-09-23",
      daysAgo: 3,
      name: "Workout B",
      minutes: 42,
    });
    expect(s.medianGap).toBe(2);
  });
});

test.describe("movies summarizer", () => {
  test("next release groups same-day titles, booked first", () => {
    const s = summarize.movies(
      {
        marks: {
          a: { level: "must", title: "Ghost", date: "2026-10-02" },
          b: { level: "booked", title: "Verity", date: "2026-10-02" },
          c: { level: "booked", title: "Digger", date: "2026-10-02" },
          d: { level: "not", title: "Skip", date: "2026-09-27" },
        },
      },
      now,
    );
    expect(s.next.daysUntil).toBe(6);
    expect(s.next.titles.slice(0, 2).sort()).toEqual(["Digger", "Verity"]);
    expect(s.next.titles[2]).toBe("Ghost");
  });
});

/* Cached summaries are reused across deploys (a same-day 304 keeps the
   stored one), so a new field only reaches the phone if SUMMARY_VERSION
   moves with it. When this fails: bump SUMMARY_VERSION in data.js, then
   update both the version and the shapes below. */
test("summary shapes are pinned to SUMMARY_VERSION", () => {
  const shape = (v) =>
    Array.isArray(v)
      ? [v.length ? shape(v[0]) : null]
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, shape(v[k])]),
          )
        : v === null
          ? "null"
          : typeof v;
  const data = dataFixtures();
  const shapes = Object.fromEntries(
    Object.entries(SOURCES).map(([id, src]) => [
      id,
      shape(src.summarize(data[src.path], now)),
    ]),
  );
  expect({ version: SUMMARY_VERSION, shapes }).toEqual({
    version: 3,
    shapes: {
      "fitness-tracker": {
        last30: ["string"],
        lifts84: ["string"],
        lastLift: {
          day: "string",
          daysAgo: "number",
          minutes: "number",
          name: "string",
          sets: "number",
        },
        liftsThisWeek: "number",
        medianGap: "number",
        week: [
          {
            day: "string",
            future: "boolean",
            isToday: "boolean",
            lifted: "boolean",
          },
        ],
        weight: "null",
      },
      "upcoming-movies": {
        booked: "number",
        calendar: {
          counts: { booked: "number", likely: "number", must: "number" },
          days: [{ day: "string", kind: "string" }],
        },
        mustSee: "number",
        next: { day: "string", daysUntil: "number", titles: ["string"] },
        rows: [
          {
            day: "string",
            daysUntil: "number",
            kind: "string",
            title: "string",
          },
        ],
      },
      "budget-together": {
        avgMonths: "number",
        avgPerMonth: "number",
        months: [{ month: "string", spend: "number" }],
        lastMonth: {
          income: "number",
          month: "string",
          rate: "number",
          saved: "number",
          spend: "number",
        },
      },
    },
  });
});
