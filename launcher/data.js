/* =====================================================================
   Live data layer: one small reading per app, pulled from the
   owner's private data repo with the launcher PAT.

   Flow per source file:
     1. Emit the cached summary (IndexedDB) immediately, so modules
        paint instantly on boot, even offline.
     2. Revalidate with the GitHub Contents API using If-None-Match.
        A 304 costs no rate-limit budget and keeps the cached summary.
     3. On 200, summarize the raw JSON, cache {etag, summary}, emit.

   Only summaries are persisted, never the raw files. Every summarizer is
   a pure function of (json, now), so it can be unit-tested against
   fixture data.
   ===================================================================== */

const DB_NAME = "co.data";
const STORE = "summaries";
// Bump when a summarizer's output shape changes so stale caches are
// ignored instead of rendered with missing fields (a same-day 304 would
// otherwise keep serving the old shape). tests/data.spec.js pins the
// shapes to this number.
// 2: budget lastMonth gained income/saved/rate; movies gained rows.
export const SUMMARY_VERSION = 2;

const DAY_MS = 86_400_000;

/* ---------- date helpers (local time) ---------- */

function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "2026-09-23" or "2026-09-23T21:42:29.642Z" → local day key. Bare
// dates are calendar dates already; timestamps convert to local time.
function toDayKey(value) {
  if (typeof value !== "string" || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : localDayKey(d);
}

function dayKeyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(fromKey, toKey) {
  return Math.round((dayKeyToDate(toKey) - dayKeyToDate(fromKey)) / DAY_MS);
}

/* ---------- summarizers (pure) ---------- */

export const summarize = {
  fitness(json, now = new Date()) {
    const today = localDayKey(now);
    const logs = Array.isArray(json?.workoutLogs) ? json.workoutLogs : [];
    const lifts = logs
      .map((w) => ({ ...w, day: toDayKey(w.date) }))
      .filter((w) => w.day && w.day <= today)
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const liftDays = new Set(lifts.map((w) => w.day));
    const last = lifts[lifts.length - 1] || null;

    // Current week, Sunday → Saturday.
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - now.getDay(),
    );
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + i,
      );
      const key = localDayKey(d);
      return {
        day: key,
        lifted: liftDays.has(key),
        isToday: key === today,
        future: key > today,
      };
    });

    const since30 = localDayKey(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29),
    );
    const month = [...liftDays]
      .filter((k) => k >= since30 && k <= today)
      .sort();

    const weights = (Array.isArray(json?.weightLogs) ? json.weightLogs : [])
      .map((w) => ({ day: toDayKey(w.date), weight: Number(w.weight) }))
      .filter((w) => w.day && Number.isFinite(w.weight))
      .sort((a, b) => (a.day < b.day ? -1 : 1));
    const latestWeight = weights[weights.length - 1] || null;

    // Usual rhythm: the median gap in days between consecutive lift days.
    const days = [...liftDays].sort();
    const gaps = days
      .slice(1)
      .map((d, i) => daysBetween(days[i], d))
      .sort((a, b) => a - b);
    const medianGap = gaps.length
      ? gaps[Math.floor((gaps.length - 1) / 2)]
      : null;

    return {
      medianGap,
      lastLift: last
        ? {
            day: last.day,
            daysAgo: daysBetween(last.day, today),
            name: typeof last.name === "string" ? last.name : "Workout",
            minutes: Number.isFinite(last.duration) ? last.duration : null,
            sets: Array.isArray(last.sets) ? last.sets.length : null,
          }
        : null,
      week,
      liftsThisWeek: week.filter((d) => d.lifted).length,
      last30: month,
      // Sensitive: rendered behind the privacy veil.
      weight: latestWeight
        ? { day: latestWeight.day, value: latestWeight.weight }
        : null,
    };
  },

  movies(json, now = new Date()) {
    const today = localDayKey(now);
    const marks =
      json?.marks && typeof json.marks === "object"
        ? Object.values(json.marks)
        : [];
    const upcoming = marks
      .filter(
        (m) =>
          m &&
          (m.level === "booked" || m.level === "must") &&
          !m.watched_date &&
          typeof m.date === "string" &&
          toDayKey(m.date) >= today,
      )
      .map((m) => ({
        title: String(m.title || "Untitled"),
        day: toDayKey(m.date),
        level: m.level,
      }))
      .sort((a, b) =>
        a.day < b.day ? -1 : a.day > b.day ? 1 : a.title.localeCompare(b.title),
      );
    const next = upcoming[0] || null;
    // Everything opening on the next release day, booked tickets first.
    const nextGroup = next
      ? upcoming
          .filter((m) => m.day === next.day)
          .sort((a, b) =>
            a.level === b.level ? 0 : a.level === "booked" ? -1 : 1,
          )
      : [];
    return {
      next: next
        ? {
            day: next.day,
            daysUntil: daysBetween(today, next.day),
            titles: nextGroup.map((m) => m.title),
          }
        : null,
      booked: marks.filter((m) => m && m.level === "booked").length,
      mustSee: marks.filter((m) => m && m.level === "must").length,
      rows: movieRows(marks, today),
    };
  },

  /* Jack's (person1) spend, mirroring budget-together's compute('p1')
     in docs/mobile.html so the launcher never disagrees with the app:
     positive amounts only, not excluded, not gambling/cash (hidden
     categories) nor ignored ones (insurance, transfer, investing, or a
     custom category flagged ignored). Solo p1 spend counts in full; shared
     spend counts at p1's share: settled → its frozen settledSplit,
     unsettled → the live catSplits rule applied per month+category (so a
     fixed-dollar split applies once per month). */
  budget(json, now = new Date()) {
    const txns = Array.isArray(json?.transactions) ? json.transactions : [];
    const custom = Array.isArray(json?.customCategories)
      ? json.customCategories
      : [];
    const ignored = new Set([
      "insurance",
      "transfer",
      "investing",
      "gambling",
      "cash",
    ]);
    for (const c of custom) if (c && c.ignored) ignored.add(c.id);
    const excludedMonths = new Set(
      Array.isArray(json?.excludedFromAvg) ? json.excludedFromAvg : [],
    );
    const thisMonth = localDayKey(now).slice(0, 7);

    const byMonth = new Map(); // month → p1 spend
    const incByMonth = new Map(); // month → p1 income
    const liveShared = new Map(); // "month|category" → unsettled shared total
    const add = (m, v) => byMonth.set(m, (byMonth.get(m) || 0) + v);
    for (const t of txns) {
      // Income: p1's negative-amount "income" rows (compute()'s `inc`).
      // Gambling only nets into income in the app's opt-in betting mode.
      if (
        t &&
        !t.excluded &&
        typeof t.date === "string" &&
        t.amount < 0 &&
        t.category === "income" &&
        t.person === "p1"
      ) {
        const m = t.date.slice(0, 7);
        incByMonth.set(m, (incByMonth.get(m) || 0) - t.amount);
      }
      if (!t || t.excluded || typeof t.date !== "string" || !(t.amount > 0))
        continue;
      if (ignored.has(t.category)) continue;
      const month = t.date.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, 0);
      if (!t.shared) {
        if (t.person === "p1") add(month, t.amount);
      } else if (t.settled && t.settledSplit != null) {
        add(month, t.amount * t.settledSplit);
      } else {
        const key = `${month}|${t.category}`;
        liveShared.set(key, (liveShared.get(key) || 0) + t.amount);
      }
    }
    for (const [key, total] of liveShared) {
      const [month, cat] = key.split("|");
      add(month, p1CatShare(json?.catSplits?.[cat], total));
    }

    // Complete months only (the current month is still in progress).
    const complete = [...new Set([...byMonth.keys(), ...incByMonth.keys()])]
      .filter((m) => m < thisMonth)
      .sort();
    const lastMonth = complete[complete.length - 1] || null;
    const avgMonths = complete.filter((m) => !excludedMonths.has(m));
    const avg = avgMonths.length
      ? avgMonths.reduce((s, m) => s + (byMonth.get(m) || 0), 0) /
        avgMonths.length
      : null;
    // Savings rate the way the app's ring card shows it: (income − spend) /
    // income, rounded; null without income.
    const spendLast = lastMonth ? byMonth.get(lastMonth) || 0 : 0;
    const incLast = lastMonth ? incByMonth.get(lastMonth) || 0 : 0;
    // Sensitive: rendered behind the privacy veil.
    return {
      lastMonth: lastMonth
        ? {
            month: lastMonth,
            spend: Math.round(spendLast),
            income: Math.round(incLast),
            saved: Math.round(incLast - spendLast),
            rate:
              incLast > 0
                ? Math.round(((incLast - spendLast) / incLast) * 100)
                : null,
          }
        : null,
      avgPerMonth: avg == null ? null : Math.round(avg),
      avgMonths: avgMonths.length,
    };
  },
};

/* Rows for the Movies band, like the Scores band: tickets first (up to
   two, by ticket date), then upcoming must-sees, keeping at least one
   likely when there is one; 4 rows at most. A row's day is the ticket
   date for bookings, else the release date. Watched titles never show. */
function movieRows(marks, today, max = 4) {
  const pick = (level, dayOf) =>
    marks
      .filter(
        (m) =>
          m &&
          m.level === level &&
          !m.watched_date &&
          typeof dayOf(m) === "string",
      )
      .map((m) => ({
        kind: level,
        title: String(m.title || "Untitled"),
        day: toDayKey(dayOf(m)),
      }))
      .filter((r) => r.day >= today)
      .sort((a, b) =>
        a.day < b.day ? -1 : a.day > b.day ? 1 : a.title.localeCompare(b.title),
      );
  const booked = pick("booked", (m) => m.booked_date || m.date).slice(0, 2);
  const likely = pick("likely", (m) => m.date);
  const must = pick("must", (m) => m.date).slice(
    0,
    max - booked.length - (likely.length ? 1 : 0),
  );
  const rows = [...booked, ...must];
  return [...rows, ...likely.slice(0, max - rows.length)].map((r) => ({
    ...r,
    daysUntil: daysBetween(today, r.day),
  }));
}

// p1's share of an unsettled shared category total for one month —
// budget-together's getCatSplitAmts. Legacy data stores a bare ratio.
function p1CatShare(split, total) {
  if (typeof split === "number")
    return total * (Number.isNaN(split) ? 0.5 : split);
  const s = split || {};
  if (s.mode === "dollar") return Math.min(Math.max(s.p1Amt || 0, 0), total);
  const pct = (s.mode || "pct") === "pct" && s.p1Pct != null ? s.p1Pct : 50;
  return (total * pct) / 100;
}

/* ---------- source registry ---------- */

// app id → file in the data repo + its summarizer.
export const SOURCES = {
  "fitness-tracker": { path: "fitness.json", summarize: summarize.fitness },
  "upcoming-movies": {
    path: "data/interests.json",
    summarize: summarize.movies,
  },
  "budget-together": { path: "budget.json", summarize: summarize.budget },
};

/* ---------- IndexedDB cache (best effort) ---------- */

function openDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function idb(db, mode, fn) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/* ---------- fetch ---------- */

async function fetchSource({ token, repo, path, etag }) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(etag ? { "If-None-Match": etag } : {}),
      },
      cache: "no-store",
    },
  );
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return { json: await res.json(), etag: res.headers.get("ETag") };
}

/* Loads every source. onUpdate(appId, {summary, stale, error}) fires
   once from cache (if present) and again after revalidation. Resolves
   when all sources have settled. */
export async function loadLiveData({
  token,
  repo,
  onUpdate,
  now = () => new Date(),
}) {
  if (!token || !repo) return;
  const db = await openDb();
  await Promise.all(
    Object.entries(SOURCES).map(async ([appId, src]) => {
      const key = `${repo}/${src.path}`;
      const today = localDayKey(now());
      const cached = await idb(db, "readonly", (s) => s.get(key));
      const usable = cached && cached.v === SUMMARY_VERSION ? cached : null;
      if (usable)
        onUpdate(appId, {
          summary: usable.summary,
          stale: true,
          at: usable.at,
        });
      // Summaries hold day-relative fields ("3 days ago", this week's
      // strip), so a cached one is only reusable on the day it was
      // computed. Revalidate with the ETag then; otherwise fetch in full
      // (at most one uncached fetch per file per day).
      const etag = usable && usable.day === today ? usable.etag : null;
      try {
        const res = await fetchSource({ token, repo, path: src.path, etag });
        if (res.notModified) {
          onUpdate(appId, {
            summary: usable.summary,
            stale: false,
            at: Date.now(),
          });
          await idb(db, "readwrite", (s) =>
            s.put({ ...usable, at: Date.now() }, key),
          );
          return;
        }
        const summary = src.summarize(res.json, now());
        const record = {
          v: SUMMARY_VERSION,
          day: today,
          etag: res.etag,
          summary,
          at: Date.now(),
        };
        await idb(db, "readwrite", (s) => s.put(record, key));
        onUpdate(appId, { summary, stale: false, at: record.at });
      } catch (error) {
        onUpdate(appId, {
          summary: usable ? usable.summary : null,
          stale: true,
          error,
        });
      }
    }),
  );
}

/* Wipe every cached summary (used on lock, so veiled figures don't
   outlive the session that was allowed to see them). */
export async function clearLiveData() {
  const db = await openDb();
  await idb(db, "readwrite", (s) => s.clear());
}
