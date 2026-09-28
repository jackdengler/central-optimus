/* =====================================================================
   Scores: last result + next game for the owner's teams, from ESPN's
   public site API (no key, CORS-enabled). Teams live in config.json:

     { "id": "steelers", "label": "Steelers", "abbr": "PIT",
       "sport": "football", "league": "nfl", "team": "pit" }
     { "id": "ufc", "label": "UFC", "sport": "mma", "league": "ufc" }

   Team sports read /teams/{team}/schedule; UFC reads the league
   scoreboard (the current / next card). Offline-first: the last good
   payload is kept in localStorage and painted before any network call.
   Parsers are pure (and tested) and tolerate ESPN's two score shapes:
   a string ("24") or an object ({ value, displayValue }).
   ===================================================================== */

const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const CACHE_KEY = "co.scores";

const scoreOf = (c) => {
  const s = c?.score;
  if (s == null) return null;
  const v = typeof s === "object" ? (s.displayValue ?? s.value) : s;
  return v === "" || v == null ? null : String(v).replace(/\.0$/, "");
};

function gameFromEvent(ev, abbr) {
  const comp = ev?.competitions?.[0];
  const cs = Array.isArray(comp?.competitors) ? comp.competitors : [];
  if (!comp || cs.length < 2) return null;
  const mine =
    cs.find(
      (c) =>
        String(c.team?.abbreviation || "").toUpperCase() ===
        String(abbr || "").toUpperCase(),
    ) || cs[0];
  const opp = cs.find((c) => c !== mine) || cs[1];
  const st = comp.status?.type || ev.status?.type || {};
  const state = st.state || (st.completed ? "post" : "pre");
  const us = scoreOf(mine);
  const them = scoreOf(opp);
  let result = null;
  if (state === "post" && us != null && them != null) {
    const a = Number(us);
    const b = Number(them);
    if (mine.winner === true) result = "W";
    else if (opp.winner === true) result = "L";
    else result = a > b ? "W" : a < b ? "L" : "T";
  }
  return {
    date: ev.date || comp.date || null,
    home: mine.homeAway === "home",
    opp: String(
      opp.team?.abbreviation || opp.team?.shortDisplayName || "OPP",
    ).toUpperCase(),
    oppName: opp.team?.displayName || opp.team?.shortDisplayName || "",
    state, // "pre" | "in" | "post"
    detail: st.shortDetail || st.detail || "",
    us,
    them,
    result,
  };
}

/* Team schedule → { live, next, last }. */
export function parseSchedule(json, abbr, now = new Date()) {
  const events = Array.isArray(json?.events) ? json.events : [];
  const games = events
    .map((e) => gameFromEvent(e, abbr))
    .filter((g) => g && g.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const live = games.find((g) => g.state === "in") || null;
  const next =
    games.find(
      (g) =>
        g.state === "pre" &&
        new Date(g.date) >= new Date(now.getTime() - 6 * 3600e3),
    ) || null;
  const last = [...games].reverse().find((g) => g.state === "post") || null;
  return { live, next, last };
}

/* UFC → the next real card (a numbered event or Fight Night, never a
   Contender Series week) and its main event. The scoreboard carries the
   current card; when that is a Contender Series week, the next card comes
   from the league calendar, whose labels read "UFC 320: Ankalaev vs.
   Pereira 2". The title names the main event, so it wins over bout order;
   ESPN's last listed bout is the fallback. */
const DWCS = /contender series/i;

function mainFromTitle(title) {
  const tail = String(title || "")
    .split(":")
    .slice(1)
    .join(":");
  const parts = tail.split(/\s+vs\.?\s+/i).map((p) => p.trim());
  return parts.length === 2 && parts[0] && parts[1] ? parts : null;
}

function cardFromEvent(ev) {
  const comps = Array.isArray(ev.competitions) ? ev.competitions : [];
  const bout = comps[comps.length - 1];
  const fighters = (bout?.competitors || []).map((c) => ({
    name: c.athlete?.shortName || c.athlete?.displayName || "",
    winner: c.winner === true,
  }));
  const titled = mainFromTitle(ev.name);
  const st = ev.status?.type || bout?.status?.type || {};
  return {
    name: ev.shortName || String(ev.name || "UFC").split(":")[0],
    date: ev.date || null,
    state: st.state || (st.completed ? "post" : "pre"),
    main: titled
      ? titled.map((name) => ({ name }))
      : fighters.length === 2
        ? fighters
        : null,
    winner: fighters.find((f) => f.winner)?.name || null,
  };
}

export function parseUfc(json, now = new Date()) {
  const events = Array.isArray(json?.events) ? json.events : [];
  const real = events.find((e) => !DWCS.test(`${e?.name} ${e?.shortName}`));
  if (real) return { card: cardFromEvent(real) };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cal = json?.leagues?.[0]?.calendar;
  const next = (Array.isArray(cal) ? cal : [])
    .filter((c) => c && typeof c === "object" && c.label && !DWCS.test(c.label))
    .filter((c) => new Date(c.endDate || c.startDate) >= today)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  if (next) {
    const titled = mainFromTitle(next.label);
    return {
      card: {
        name: String(next.label).split(":")[0].trim(),
        date: next.startDate || null,
        dateOnly: true, // calendar dates are the event day, not the start time
        state: "pre",
        main: titled ? titled.map((name) => ({ name })) : null,
        winner: null,
      },
    };
  }
  return { card: events[0] ? cardFromEvent(events[0]) : null };
}

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  } catch (_) {
    return null;
  }
}
function saveCache(v) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(v));
  } catch (_) {}
}

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/* Paint cache first, then fetch every team. onUpdate({teams, at, stale}). */
export async function loadScores(teams, onUpdate) {
  if (!Array.isArray(teams) || !teams.length) return;
  const cached = loadCache();
  if (cached?.teams) onUpdate({ ...cached, stale: true });
  const out = await Promise.all(
    teams.map(async (t) => {
      try {
        if (t.sport === "mma") {
          return {
            ...t,
            ...parseUfc(await getJSON(`${BASE}/mma/${t.league}/scoreboard`)),
          };
        }
        const json = await getJSON(
          `${BASE}/${t.sport}/${t.league}/teams/${t.team}/schedule`,
        );
        return { ...t, ...parseSchedule(json, t.abbr) };
      } catch (error) {
        const prev = cached?.teams?.find((c) => c.id === t.id);
        return { ...(prev || t), error: String(error) };
      }
    }),
  );
  const failed = out.some((t) => t.error);
  const payload = { teams: out, at: failed && cached ? cached.at : Date.now() };
  if (!failed) saveCache(payload);
  onUpdate({ ...payload, stale: failed });
  return payload;
}

/* The single most relevant item for the band: a live game, else a game
   today, else the soonest next game/card, else the latest result. */
export function headline(teams, now = new Date()) {
  const list = Array.isArray(teams) ? teams : [];
  const live = list.find((t) => t.live);
  if (live) return { team: live, game: live.live, kind: "live" };
  const dayKey = (d) => new Date(d).toDateString();
  const upcoming = list
    .map((t) => ({
      team: t,
      date: t.next?.date || (t.card?.state === "pre" ? t.card.date : null),
    }))
    .filter((x) => x.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (upcoming[0]) {
    const u = upcoming[0];
    const kind = dayKey(u.date) === now.toDateString() ? "today" : "next";
    return {
      team: u.team,
      game: u.team.next || null,
      card: u.team.card || null,
      kind,
    };
  }
  const last = list
    .filter((t) => t.last)
    .sort((a, b) => (a.last.date < b.last.date ? 1 : -1))[0];
  return last ? { team: last, game: last.last, kind: "final" } : null;
}
