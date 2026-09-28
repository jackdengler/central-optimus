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
// ignored instead of rendered with missing fields.
const SUMMARY_VERSION = 1;

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
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = localDayKey(d);
      return { day: key, lifted: liftDays.has(key), isToday: key === today, future: key > today };
    });

    const since30 = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
    const month = [...liftDays].filter((k) => k >= since30 && k <= today).sort();

    const weights = (Array.isArray(json?.weightLogs) ? json.weightLogs : [])
      .map((w) => ({ day: toDayKey(w.date), weight: Number(w.weight) }))
      .filter((w) => w.day && Number.isFinite(w.weight))
      .sort((a, b) => (a.day < b.day ? -1 : 1));
    const latestWeight = weights[weights.length - 1] || null;

    return {
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
      weight: latestWeight ? { day: latestWeight.day, value: latestWeight.weight } : null,
    };
  },

  parlay(json) {
    const results = json?.betResults && typeof json.betResults === "object" ? json.betResults : {};
    const at = json?.betResultsAt && typeof json.betResultsAt === "object" ? json.betResultsAt : {};
    const graded = Object.entries(results)
      .filter(([, r]) => r === "win" || r === "loss")
      .sort(([a], [b]) => (at[a] ?? 0) - (at[b] ?? 0))
      .map(([, r]) => (r === "win" ? "W" : "L"));
    const wins = graded.filter((r) => r === "W").length;
    const losses = graded.length - wins;
    const parlays = Array.isArray(json?.parlays) ? json.parlays : [];
    return {
      event: typeof json?.eventName === "string" ? json.eventName : null,
      parlays: parlays.length,
      open: parlays.filter((p) => p && p.placed && !isParlaySettled(p, results)).length,
      wins,
      losses,
      hitRate: graded.length ? wins / graded.length : null,
      sequence: graded,
    };
  },

  movies(json, now = new Date()) {
    const today = localDayKey(now);
    const marks = json?.marks && typeof json.marks === "object" ? Object.values(json.marks) : [];
    const upcoming = marks
      .filter(
        (m) =>
          m &&
          (m.level === "booked" || m.level === "must") &&
          !m.watched_date &&
          typeof m.date === "string" &&
          toDayKey(m.date) >= today,
      )
      .map((m) => ({ title: String(m.title || "Untitled"), day: toDayKey(m.date), level: m.level }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.title.localeCompare(b.title)));
    const next = upcoming[0] || null;
    // Everything opening on the next release day, booked tickets first.
    const nextGroup = next
      ? upcoming
          .filter((m) => m.day === next.day)
          .sort((a, b) => (a.level === b.level ? 0 : a.level === "booked" ? -1 : 1))
      : [];
    return {
      next: next
        ? { day: next.day, daysUntil: daysBetween(today, next.day), titles: nextGroup.map((m) => m.title) }
        : null,
      booked: marks.filter((m) => m && m.level === "booked").length,
      mustSee: marks.filter((m) => m && m.level === "must").length,
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
    const custom = Array.isArray(json?.customCategories) ? json.customCategories : [];
    const ignored = new Set(["insurance", "transfer", "investing", "gambling", "cash"]);
    for (const c of custom) if (c && c.ignored) ignored.add(c.id);
    const excludedMonths = new Set(Array.isArray(json?.excludedFromAvg) ? json.excludedFromAvg : []);
    const thisMonth = localDayKey(now).slice(0, 7);

    const byMonth = new Map(); // month → p1 spend
    const liveShared = new Map(); // "month|category" → unsettled shared total
    const add = (m, v) => byMonth.set(m, (byMonth.get(m) || 0) + v);
    for (const t of txns) {
      if (!t || t.excluded || typeof t.date !== "string" || !(t.amount > 0)) continue;
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
    const complete = [...byMonth.keys()].filter((m) => m < thisMonth).sort();
    const lastMonth = complete[complete.length - 1] || null;
    const avgMonths = complete.filter((m) => !excludedMonths.has(m));
    const avg = avgMonths.length
      ? avgMonths.reduce((s, m) => s + byMonth.get(m), 0) / avgMonths.length
      : null;
    // Sensitive: rendered behind the privacy veil.
    return {
      lastMonth: lastMonth ? { month: lastMonth, spend: Math.round(byMonth.get(lastMonth)) } : null,
      avgPerMonth: avg == null ? null : Math.round(avg),
      avgMonths: avgMonths.length,
    };
  },

  recipes(json) {
    const list = Array.isArray(json?.recipes) ? json.recipes : [];
    const latest = [...list].sort((a, b) =>
      String(a.createdAt || "") < String(b.createdAt || "") ? 1 : -1,
    )[0];
    return { count: list.length, latest: latest ? String(latest.title || "") : null };
  },
};

// p1's share of an unsettled shared category total for one month —
// budget-together's getCatSplitAmts. Legacy data stores a bare ratio.
function p1CatShare(split, total) {
  if (typeof split === "number") return total * (Number.isNaN(split) ? 0.5 : split);
  const s = split || {};
  if (s.mode === "dollar") return Math.min(Math.max(s.p1Amt || 0, 0), total);
  const pct = (s.mode || "pct") === "pct" && s.p1Pct != null ? s.p1Pct : 50;
  return (total * pct) / 100;
}

// A placed parlay is settled once any leg lost or every leg is graded.
function isParlaySettled(parlay, results) {
  const legs = Array.isArray(parlay.betIds) ? parlay.betIds : [];
  if (!legs.length) return false;
  if (legs.some((id) => results[id] === "loss")) return true;
  return legs.every((id) => results[id] === "win" || results[id] === "loss");
}

/* ---------- source registry ---------- */

// app id → file in the data repo + its summarizer.
export const SOURCES = {
  "fitness-tracker": { path: "fitness.json", summarize: summarize.fitness },
  parlay: { path: "data.json", summarize: summarize.parlay },
  "upcoming-movies": { path: "data/interests.json", summarize: summarize.movies },
  "recipe-book": { path: "recipes.json", summarize: summarize.recipes },
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
export async function loadLiveData({ token, repo, onUpdate, now = () => new Date() }) {
  if (!token || !repo) return;
  const db = await openDb();
  await Promise.all(
    Object.entries(SOURCES).map(async ([appId, src]) => {
      const key = `${repo}/${src.path}`;
      const today = localDayKey(now());
      const cached = await idb(db, "readonly", (s) => s.get(key));
      const usable = cached && cached.v === SUMMARY_VERSION ? cached : null;
      if (usable) onUpdate(appId, { summary: usable.summary, stale: true, at: usable.at });
      // Summaries hold day-relative fields ("3 days ago", this week's
      // strip), so a cached one is only reusable on the day it was
      // computed. Revalidate with the ETag then; otherwise fetch in full
      // (at most one uncached fetch per file per day).
      const etag = usable && usable.day === today ? usable.etag : null;
      try {
        const res = await fetchSource({ token, repo, path: src.path, etag });
        if (res.notModified) {
          onUpdate(appId, { summary: usable.summary, stale: false, at: Date.now() });
          await idb(db, "readwrite", (s) => s.put({ ...usable, at: Date.now() }, key));
          return;
        }
        const summary = src.summarize(res.json, now());
        const record = { v: SUMMARY_VERSION, day: today, etag: res.etag, summary, at: Date.now() };
        await idb(db, "readwrite", (s) => s.put(record, key));
        onUpdate(appId, { summary, stale: false, at: record.at });
      } catch (error) {
        onUpdate(appId, { summary: usable ? usable.summary : null, stale: true, error });
      }
    }),
  );
}
