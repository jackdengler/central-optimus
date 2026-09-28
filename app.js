import { initWeather } from "./weather.js";
import { loadLiveData, clearLiveData } from "./data.js";
import { feel, soundOn, setSound } from "./feel.js";
import { loadScores, headline } from "./scores.js";

/* =====================================================================
   Central Optimus — Big Type launcher.

   Home = header (clock/date/weather) · accent ticker tape · three live
   bands (urgency-ordered) · strip of the other apps · search.
   Tapping a band grows the app layer out of it (clip-path from the
   band's rect to full screen); closing collapses it back.
   ===================================================================== */

const TOKEN_KEY = "co.gh.token";
const EMBED_LOAD_TIMEOUT_MS = 10_000;
const REVEAL_MS = 5_000;

let CONFIG = {};
let APPS = [];
const DATA = {}; // appId → { summary, stale, at, error }
let weatherController = null;
let openAppId = null;
let embedTimer = 0;
let lastDataLoad = 0;
let SCORES = null; // { teams, at, stale }
let scoresTimer = 0;

const $ = (sel) => document.querySelector(sel);
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Numbers roll up to their value (ease-out, ~0.7s). The final text is
   laid out first and its width held, so a count never nudges the band's
   layout; data-counting marks a node mid-roll (tests wait on it).
   startAt is on the performance.now() clock, so a roll can be resumed on
   a re-rendered node exactly where it was. */
function countUp(
  node,
  to,
  {
    from = 0,
    ms = 700,
    startAt = performance.now(),
    fmt = String,
    prefix = "",
    suffix = "",
  } = {},
) {
  const show = (v) => (node.textContent = prefix + fmt(v) + suffix);
  show(to);
  const token = {};
  node._count = token;
  if (reducedMotion() || from === to) return;
  node.style.minWidth = `${node.offsetWidth}px`;
  node.dataset.counting = "";
  const step = (t) => {
    if (node._count !== token) return;
    const p = Math.max(0, Math.min(1, (t - startAt) / ms));
    show(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
    if (p < 1) return requestAnimationFrame(step);
    node.style.minWidth = "";
    delete node.dataset.counting;
  };
  step(performance.now());
}
function stopCount(node) {
  node._count = null;
  node.style.minWidth = "";
  delete node.dataset.counting;
}

/* Block page pinch-zoom (iOS ignores user-scalable=no in standalone). */
["gesturestart", "gesturechange", "gestureend"].forEach((evt) =>
  document.addEventListener(evt, (e) => e.preventDefault(), { passive: false }),
);

/* ---------- formatting ---------- */

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const pad = (n) => String(n).padStart(2, "0");

function localDayKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayKeyDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtClock(d) {
  const h = d.getHours() % 12 || 12;
  return {
    hm: [String(h), pad(d.getMinutes())],
    ampm: d.getHours() < 12 ? "AM" : "PM",
  };
}
function fmtTime(d) {
  const { hm, ampm } = fmtClock(d);
  return `${hm[0]}:${hm[1]} ${ampm}`;
}
function hhmmTo12(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)}`;
}
function greeting(d, name) {
  const h = d.getHours();
  const part =
    h < 5
      ? "STILL UP"
      : h < 12
        ? "GOOD MORNING"
        : h < 17
          ? "GOOD AFTERNOON"
          : h < 21
            ? "GOOD EVENING"
            : "GOOD NIGHT";
  return `${part}, ${name.toUpperCase()}`;
}
function fmtGameTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return "";
  const t = fmtTime(d);
  if (d.toDateString() === now.toDateString()) return `TODAY ${t}`;
  const days = Math.round(
    (new Date(d.toDateString()) - new Date(now.toDateString())) / 86_400_000,
  );
  return days > 0 && days < 7
    ? `${DAYS[d.getDay()]} ${t}`
    : `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function money(n) {
  return Math.round(n).toLocaleString("en-US");
}
// Readable text colour on a band: near-black on light fills, white on dark.
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function inkFor(hex) {
  return luminance(hex) > 0.12 ? "#0b0b0b" : "#ffffff";
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const SVG = {
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v16"/><path d="M5.5 13l6.5 6.5 6.5-6.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};

/* ---------- JSON + auth ---------- */

async function loadJSON(path) {
  const delays = [250, 1000];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (res.ok) return res.json();
      lastErr = new Error(`Failed to load ${path}: ${res.status}`);
      if (res.status >= 400 && res.status < 500) throw lastErr;
    } catch (err) {
      lastErr = err;
    }
    if (attempt < delays.length)
      await new Promise((r) => setTimeout(r, delays[attempt]));
  }
  throw lastErr;
}

/* Discriminated result so the gate can show the right copy. */
async function verifyToken(token, expectedLogin) {
  let res;
  try {
    res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (_) {
    return { ok: false, reason: "network" };
  }
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    return { ok: false, reason: "rate-limit" };
  }
  if (!res.ok) return { ok: false, reason: "api", status: res.status };
  let user;
  try {
    user = await res.json();
  } catch (_) {
    return { ok: false, reason: "api" };
  }
  if (typeof user.login !== "string") return { ok: false, reason: "api" };
  if (user.login.toLowerCase() !== expectedLogin.toLowerCase()) {
    return { ok: false, reason: "wrong-account", login: user.login };
  }
  return { ok: true };
}

function gateErrorMessage(result, expectedLogin) {
  switch (result.reason) {
    case "network":
      return "Couldn't reach GitHub. Check your connection and try again.";
    case "unauthorized":
      return "GitHub rejected that token. Double-check or create a new one.";
    case "rate-limit":
      return "GitHub rate limit hit. Try again in a minute.";
    case "wrong-account":
      return `That token belongs to ${result.login}, not ${expectedLogin}.`;
    default:
      return "Sign-in failed. Try again.";
  }
}

/* ---------- header: clock, date, weather ---------- */

function tickClock() {
  const now = new Date();
  const { hm, ampm } = fmtClock(now);
  const clock = $("#clock");
  const turned = clock.dataset.hm && clock.dataset.hm !== hm.join(":");
  clock.dataset.hm = hm.join(":");
  clock.innerHTML = "";
  if (turned && !reducedMotion()) {
    clock.classList.remove("is-turning");
    void clock.offsetWidth; // restart the drop-in
    clock.classList.add("is-turning");
  }
  clock.append(hm[0], el("span", "colon", ":"), hm[1]);
  clock.setAttribute("datetime", now.toISOString());
  $("#ampm").textContent = ampm;
  $("#today-date").textContent =
    `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

function startClock() {
  tickClock();
  // Re-sync on the minute boundary, then every minute.
  setTimeout(
    () => {
      tickClock();
      renderTape();
      setInterval(() => {
        tickClock();
        renderTape();
      }, 60_000);
    },
    60_000 - (Date.now() % 60_000),
  );
}

function setWeatherLine(payload) {
  $("#weather-line").classList.toggle("is-stale", !!payload?.stale);
  // Geocoders return civil names ("Township of Wayne"); keep the place.
  const place = (payload?.place || CONFIG.location || "")
    .toUpperCase()
    .replace(/^(TOWNSHIP|CITY|TOWN|VILLAGE|BOROUGH) OF /, "");
  const short = place === "LOS ANGELES" ? "LA" : place;
  const temp = Number.isFinite(payload?.temp) ? `${payload.temp}°` : "";
  const label =
    payload?.label && payload.label !== "—" ? payload.label.toUpperCase() : "";
  $("#weather-line").textContent = [short, temp, label]
    .filter(Boolean)
    .join(" ");
  const sunset = hhmmTo12(payload?.sunset);
  const sun = $("#sun-line");
  if (sunset) {
    sun.innerHTML = `SUN${SVG.down}${sunset}`;
    sun.setAttribute("aria-label", `Sunset ${sunset}`);
    sun.hidden = false;
  }
}

async function setPublishStamp() {
  let when = null;
  try {
    const res = await fetch("./build.json", { cache: "no-cache" });
    if (res.ok) {
      const info = await res.json();
      const d = info?.builtAt ? new Date(info.builtAt) : null;
      if (d && !Number.isNaN(d.valueOf())) when = d;
    }
  } catch {}
  $("#publish-time").textContent = when
    ? `PUBLISHED ${MONTHS[when.getMonth()]} ${when.getDate()}`
    : "PREVIEW";
}

/* ---------- bands ---------- */

const bandApps = () => APPS.filter((a) => a.home === "band");
const stripApps = () => APPS.filter((a) => a.home === "strip");

function buildBands() {
  const wrap = $("#bands");
  wrap.innerHTML = "";
  for (const app of bandApps()) {
    const band = el("div", "band");
    band.dataset.app = app.id;
    band.style.setProperty("--band-bg", app.color);
    band.style.setProperty("--band-fg", inkFor(app.color));
    // Light bands (e.g. Scores gold) carry dark readings; white fails there.
    if (luminance(app.color) > 0.35)
      band.style.setProperty("--band-hi", "#0b0b0b");
    const hit = el("button", "band-hit");
    hit.type = "button";
    hit.addEventListener("pointerdown", () => feel("tick"));
    hit.addEventListener("click", () => launchApp(app.id, band));
    band.append(
      hit,
      el("p", "band-name", (app.label || app.name).toUpperCase()),
      el("div", "band-read"),
    );
    if (app.id === "budget-together") band.append(buildHold(band));
    wrap.append(band);
  }
}

function buildHold(band) {
  const btn = el("button", "hold");
  btn.type = "button";
  btn.setAttribute("aria-label", "Hold to reveal spend");
  let timer = 0;
  const reveal = (e) => {
    e?.preventDefault?.();
    clearTimeout(timer);
    if (!band.classList.contains("is-revealed")) feel("tear");
    fillVeils(band, true);
    band.classList.add("is-revealed");
  };
  const release = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      band.classList.remove("is-revealed");
      // Wait for the redaction to slide back before dropping the figures.
      setTimeout(() => {
        if (!band.classList.contains("is-revealed")) fillVeils(band, false);
      }, 400);
    }, REVEAL_MS);
  };
  btn.addEventListener("pointerdown", reveal);
  ["pointerup", "pointercancel", "pointerleave"].forEach((t) =>
    btn.addEventListener(t, release),
  );
  btn.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") reveal(e);
  });
  btn.addEventListener("keyup", release);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  return btn;
}

// Figures are only in the DOM while revealed, so the veil is real privacy
// on screen (and nothing sensitive sits in the accessibility tree).
function fillVeils(band, show) {
  const s = DATA["budget-together"]?.summary;
  band.querySelectorAll(".veil").forEach((v) => {
    const key = v.dataset.key;
    const val = s?.lastMonth?.[key];
    if (show && Number.isFinite(val))
      countUp(v, Math.round(val), {
        fmt: key === "rate" ? String : money,
        ms: 600,
      });
    else if (show) v.textContent = "—";
    else {
      stopCount(v);
      v.textContent = "";
    }
  });
}

function readingFor(app) {
  const entry = DATA[app.id];
  const s = entry?.summary;
  const read = el("div", "band-read");
  const num = el("span", "band-num");
  const sub = el("span", "band-sub");
  let label = "";

  if (app.id === "scores") return scoresReading(read);
  if (!s) {
    num.textContent = "—";
    sub.append(el("span", null, entry?.error ? "OFFLINE" : "SYNCING"));
    label = entry?.error ? "no data" : "loading";
  } else if (app.id === "fitness-tracker") {
    num.textContent = String(s.last30.length);
    sub.append(el("span", null, "LIFTS / 30 DAYS"));
    if (s.lastLift) {
      const ago =
        s.lastLift.daysAgo === 0 ? "TODAY" : `${s.lastLift.daysAgo}D AGO`;
      sub.append(
        el(
          "span",
          null,
          `LAST ${ago} · ${String(s.lastLift.name).toUpperCase()}`,
        ),
      );
    }
    read.append(num, sub, ticks(s.last30));
    label = `${s.last30.length} lifts in the last 30 days${s.lastLift ? `, last lift ${s.lastLift.daysAgo} days ago` : ""}`;
  } else if (app.id === "upcoming-movies" && s.rows?.length) {
    // Like the Scores band: tickets first, then must-sees and likelies,
    // each with its date (ticket date for bookings, else release date).
    const TAG = { booked: "BOOKED", must: "MUST", likely: "LIKELY" };
    const says = [];
    const list = el("span", "score-rows");
    for (const r of s.rows) {
      const when = shortWhen(dayKeyDate(r.day).toISOString(), true);
      const row = el("span", `score-row-mini is-${r.kind}`);
      row.append(
        el("b", null, TAG[r.kind]),
        el("span", null, `${r.title.toUpperCase()} · ${when}`),
      );
      list.append(row);
      says.push(
        `${TAG[r.kind].toLowerCase()} ${r.title}, ${when.toLowerCase()}`,
      );
    }
    read.classList.add("is-rows");
    read.append(list);
    label = says.join("; ");
  } else if (app.id === "upcoming-movies") {
    num.textContent = "—";
    sub.append(el("span", null, "NOTHING BOOKED"));
    label = "nothing booked or coming up";
  } else if (app.id === "budget-together") {
    const month = s.lastMonth
      ? MONTHS[Number(s.lastMonth.month.slice(5, 7)) - 1]
      : "LAST MO";
    // Last month: income vs spend, and the savings rate — all veiled.
    const veils = el("span", "veils");
    for (const [key, text, pre, post] of [
      ["income", `${month} IN`, "$", ""],
      ["spend", `${month} OUT`, "$", ""],
      ["rate", "SAVED", "", "%"],
    ]) {
      const row = el("span", `veil-row veil-row--${key}`);
      const v = el("span", "veil");
      v.dataset.key = key;
      const lab = el("span", "veil-label", text);
      if (key === "income") lab.insertAdjacentHTML("beforeend", SVG.eye);
      row.append(lab);
      if (pre) row.append(el("span", "veil-dollar", pre));
      row.append(v);
      if (post) row.append(el("span", "veil-dollar", post));
      veils.append(row);
    }
    const hint = el("span", "hold-hint");
    hint.innerHTML = `${SVG.eye}<span>HOLD TO SEE</span>`;
    read.append(veils, hint);
    label =
      "last month's income, spend and savings rate hidden, press and hold the figures to reveal";
  }
  if (!read.childElementCount) read.append(num, sub);
  const asof = el(
    "span",
    "band-asof",
    entry?.at ? `AS OF ${fmtTime(new Date(entry.at))}` : "AS OF —",
  );
  read.append(asof);
  return { read, label };
}

/* One row per team: live score, else the next game (or UFC main event),
   else the last result. Surnames only for fighters so a row fits. */
const surname = (n) =>
  String(n || "")
    .replace(/^(?:[A-Z]\.\s*)+/i, "")
    .toUpperCase();

function shortWhen(iso, dateOnly = false, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return "";
  const days = Math.round(
    (new Date(d.toDateString()) - new Date(now.toDateString())) / 86_400_000,
  );
  const day =
    days === 0
      ? "TODAY"
      : days > 0 && days < 7
        ? DAYS[d.getDay()]
        : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (dateOnly) return day;
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes() ? `:${String(d.getMinutes()).padStart(2, "0")}` : "";
  return `${day} ${h}${m}${d.getHours() < 12 ? "A" : "P"}`;
}

function scoreRow(t) {
  const tag = t.abbr || t.label.toUpperCase();
  if (t.live) {
    const g = t.live;
    return {
      tag,
      text: `${g.us ?? 0}–${g.them ?? 0} ${g.home ? "VS" : "@"} ${g.opp} · ${String(g.detail).toUpperCase()}`,
      live: true,
      say: `${t.label} live, ${g.us} to ${g.them}`,
    };
  }
  if (t.next) {
    const g = t.next;
    return {
      tag,
      text: `${g.home ? "VS" : "@"} ${g.opp} · ${shortWhen(g.date)}`,
      say: `${t.label} ${g.home ? "vs" : "at"} ${g.oppName || g.opp}, ${fmtGameTime(g.date)}`,
    };
  }
  if (t.card) {
    const c = t.card;
    const fight = c.main
      ? `${surname(c.main[0].name)} VS ${surname(c.main[1].name)}`
      : String(c.name).toUpperCase();
    if (c.state === "in")
      return {
        tag,
        text: `${fight} · LIVE`,
        live: true,
        say: `${c.name} live`,
      };
    if (c.state === "post")
      return {
        tag,
        text: c.winner ? `${surname(c.winner)} WON` : `${fight} · FINAL`,
        say: `${c.name} final`,
      };
    return {
      tag,
      text: `${fight} · ${shortWhen(c.date, c.dateOnly)}`,
      say: `${c.name}, ${fight.toLowerCase()}, ${shortWhen(c.date, c.dateOnly).toLowerCase()}`,
    };
  }
  if (t.last) {
    const g = t.last;
    return {
      tag,
      text: `${g.result} ${g.us}–${g.them} ${g.home ? "VS" : "@"} ${g.opp}`,
      say: `${t.label} last ${g.result === "W" ? "won" : "lost"} ${g.us} to ${g.them}`,
    };
  }
  return {
    tag,
    text: t.error ? "OFFLINE" : "NO GAMES",
    say: `${t.label} no games`,
  };
}

function scoresReading(read) {
  const teams = SCORES?.teams || [];
  if (!teams.length) {
    read.append(
      el("span", "band-num", "—"),
      el("span", "band-sub", SCORES ? "NO GAMES" : "SYNCING"),
    );
    return { read, label: "loading" };
  }
  const list = el("span", "score-rows");
  const says = [];
  for (const t of teams) {
    const r = scoreRow(t);
    const row = el("span", `score-row-mini${r.live ? " is-live" : ""}`);
    row.append(el("b", null, r.tag), el("span", null, r.text));
    list.append(row);
    says.push(r.say);
  }
  read.classList.add("is-rows");
  read.append(
    list,
    el(
      "span",
      "band-asof",
      SCORES?.at ? `AS OF ${fmtTime(new Date(SCORES.at))}` : "AS OF —",
    ),
  );
  return { read, label: says.join("; ") };
}

function ticks(last30) {
  const set = new Set(last30);
  const wrap = el("span", "ticks");
  wrap.setAttribute("aria-hidden", "true");
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const key = localDayKey(
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - i),
    );
    const t = el("i", set.has(key) ? "on" : i === 0 ? "today" : "");
    wrap.append(t);
  }
  return wrap;
}

/* Most urgent first: a release ≤2 days out, then a lift gap past the
   usual rhythm, otherwise registry order (Fitness first). */
function urgency() {
  const fit = DATA["fitness-tracker"]?.summary;
  const mov = DATA["upcoming-movies"]?.summary;
  const game = SCORES ? headline(SCORES.teams) : null;
  if (game?.kind === "live") return "scores";
  if (mov?.next && mov.next.daysUntil <= 2) return "upcoming-movies";
  if (game?.kind === "today") return "scores";
  if (
    fit?.lastLift &&
    fit.medianGap != null &&
    fit.lastLift.daysAgo > fit.medianGap
  )
    return "fitness-tracker";
  return null;
}

function renderBands() {
  const wrap = $("#bands");
  const lead = urgency();
  const order = bandApps().map((a) => a.id);
  if (lead) order.sort((a, b) => (a === lead ? -1 : b === lead ? 1 : 0));
  order.forEach((id, i) => {
    const app = APPS.find((a) => a.id === id);
    const band = wrap.querySelector(`.band[data-app="${id}"]`);
    if (!app || !band) return;
    wrap.append(band); // re-append in urgency order
    band.classList.toggle("is-flip", i % 2 === 1);
    band.style.setProperty("--i", i);
    const { read, label } = readingFor(app);
    band.querySelector(".band-read").replaceWith(read);
    band.classList.toggle(
      "is-stale",
      id === "scores"
        ? !!SCORES?.stale && !!SCORES?.at && navigator.onLine === false
        : !!DATA[id]?.error,
    );
    if (band.classList.contains("is-revealed")) fillVeils(band, true);
    band
      .querySelector(".band-hit")
      .setAttribute("aria-label", `${app.name}. ${label}.`);
  });
  fitBandNames();
  rollBandNumbers();
}

// Band figures ("10", "T–6") roll from the last value shown (0 at first
// paint) whenever the number changes. renderBands rebuilds the reading on
// every data/scores/weather update, so an in-flight roll is resumed on the
// new node instead of being dropped.
const shownNum = new Map();
const rolls = new Map(); // band id → { from, to, startAt, ms }
function rollBandNumbers() {
  const now = performance.now();
  const entering = $("#app").classList.contains("is-entering");
  document.querySelectorAll(".band").forEach((band) => {
    const id = band.dataset.app;
    const num = band.querySelector(".band-num");
    const m = num && /^(\D*)(\d+)(\D*)$/.exec(num.textContent);
    if (!m) return shownNum.delete(id);
    const to = Number(m[2]);
    const text = { prefix: m[1], suffix: m[3] };
    const roll = rolls.get(id);
    if (roll && roll.to === to && now < roll.startAt + roll.ms)
      return countUp(num, to, { ...roll, ...text });
    const from = shownNum.get(id) ?? 0;
    shownNum.set(id, to);
    if (from === to) return;
    // While home deals in, wait for this band to land before rolling.
    const delay = entering
      ? 520 + (Number(band.style.getPropertyValue("--i")) || 0) * 80
      : 0;
    const next = { from, to, startAt: now + delay, ms: 700 };
    rolls.set(id, next);
    countUp(num, to, { ...next, ...text });
  });
}

/* Keeps every band's text inside its diagonal. The clip runs from
   (0, slant)→(W, 0) on top and (W, H − slant)→(0, H) underneath, so the
   usable height depends on where the reading sits: a right-hand reading
   loses the most at the bottom, a left-hand one at the top. The reading
   goes compact (drops secondary lines) when it can't fit, then the app
   name fills the column beside it. Also sizes the budget hold target. */
function fitBandNames() {
  const slant = 18;
  const pad = 4;
  document.querySelectorAll(".band").forEach((band) => {
    const name = band.querySelector(".band-name");
    const read = band.querySelector(".band-read");
    const W = band.clientWidth;
    const H = band.clientHeight;
    if (!name || !read || !W) return;
    const flip = band.classList.contains("is-flip");
    const limits = () => {
      const xl = flip ? 16 : W - 16 - read.offsetWidth;
      const xr = xl + read.offsetWidth;
      const top = slant * (1 - xl / W) + pad;
      return { top, bottom: H - (slant * xr) / W - pad };
    };
    band.classList.remove("is-compact");
    let lim = limits();
    if (read.offsetHeight > lim.bottom - lim.top) {
      band.classList.add("is-compact");
      lim = limits();
    }
    // Scores rows sit at the top; its name goes underneath when the band is
    // tall enough, else beside them (whichever lets it be bigger). Other
    // bands put the name beside the reading, centred in the room left.
    const rows = read.classList.contains("is-rows");
    const spare = Math.max(0, lim.bottom - lim.top - read.offsetHeight);
    const top = lim.top + (rows ? 0 : Math.min(spare / 2, 10));
    read.style.top = `${top.toFixed(1)}px`;

    name.style.setProperty("--name-size", "100px");
    const perPx = name.scrollWidth / 100;
    const fit = (col, floor) =>
      Math.min(col / perPx, (H - slant - 6 - floor) / 0.86);
    const MIN = 30;
    read.style.maxWidth = "";
    let under = rows ? fit(W - 28, top + read.offsetHeight + 6) : 0;
    if (rows && under < MIN) {
      // Too short to stack: keep a column for the name; long rows ellipsize.
      read.style.maxWidth = `${W - 14 - 16 - 12 - MIN * perPx}px`;
      under = 0;
    }
    const beside = fit(W - 14 - 16 - read.offsetWidth - 12, slant);
    const size = Math.max(24, Math.min(Math.max(beside, under), 120));
    name.style.setProperty("--name-size", `${size.toFixed(1)}px`);

    const hold = band.querySelector(".hold");
    if (hold) {
      Object.assign(hold.style, {
        left: `${read.offsetLeft - 6}px`,
        top: `${read.offsetTop - 4}px`,
        width: `${read.offsetWidth + 12}px`,
        height: `${Math.max(44, read.offsetHeight + 8)}px`,
      });
    }
  });
}

/* ---------- strip ---------- */

function buildStrip() {
  const nav = $("#strip");
  nav.innerHTML = "";
  for (const [i, app] of stripApps().entries()) {
    const btn = el("button", "strip-item");
    btn.type = "button";
    btn.dataset.app = app.id;
    btn.style.setProperty("--i", i);
    btn.style.setProperty("--app-color", app.color);
    btn.addEventListener("pointerdown", () => feel("tick"));
    btn.addEventListener("click", () => launchApp(app.id, btn));
    nav.append(btn);
  }
  renderStrip();
}

function renderStrip() {
  // Less-used apps: a quiet index of names (no readings), each marked with
  // a slanted swatch of its colour.
  document.querySelectorAll(".strip-item").forEach((btn) => {
    const app = APPS.find((a) => a.id === btn.dataset.app);
    btn.innerHTML = "";
    btn.append(
      el("i", "strip-swatch"),
      el("span", null, app.label || app.name),
    );
    btn.setAttribute("aria-label", app.name);
  });
}

/* ---------- ticker tape ---------- */

function headlines() {
  const out = [
    greeting(new Date(), CONFIG.firstName || CONFIG.githubUser || ""),
  ];
  const fit = DATA["fitness-tracker"]?.summary;
  const mov = DATA["upcoming-movies"]?.summary;
  const par = DATA.parlay?.summary;
  const rec = DATA["recipe-book"]?.summary;
  if (fit) out.push(`${fit.last30.length} LIFTS IN 30 DAYS`);
  if (fit?.lastLift)
    out.push(
      fit.lastLift.daysAgo === 0
        ? "LIFTED TODAY"
        : `${fit.lastLift.daysAgo}D SINCE LAST LIFT`,
    );
  if (mov?.next) {
    const t = mov.next.titles.slice(0, 2).join(" + ").toUpperCase();
    out.push(
      mov.next.daysUntil <= 0
        ? `${t} OUT TODAY`
        : `${t} IN ${mov.next.daysUntil} DAYS`,
    );
  }
  if (par?.hitRate != null)
    out.push(
      `PARLAY ${Math.round(par.hitRate * 100)}%${par.open ? ` · ${par.open} OPEN` : ""}`,
    );
  if (rec) out.push(`${rec.count} RECIPES`);
  for (const t of SCORES?.teams || []) {
    const name = t.label.toUpperCase();
    if (t.live)
      out.push(
        `${name} ${t.live.us}–${t.live.them} ${String(t.live.detail).toUpperCase()}`,
      );
    else if (t.last)
      out.push(
        `${name} ${t.last.result} ${t.last.us}–${t.last.them} ${t.last.home ? "VS" : "@"} ${t.last.opp}`,
      );
    if (!t.live && t.next)
      out.push(
        `${name} ${t.next.home ? "VS" : "@"} ${t.next.opp} ${fmtGameTime(t.next.date)}`,
      );
    if (t.card) {
      if (t.card.state === "post" && t.card.winner)
        out.push(
          `${String(t.card.name).toUpperCase()}: ${t.card.winner.toUpperCase()} WINS MAIN EVENT`,
        );
      else if (t.card.state !== "post") {
        const main = t.card.main
          ? `: ${surname(t.card.main[0].name)} VS ${surname(t.card.main[1].name)}`
          : "";
        const when = t.card.dateOnly
          ? shortWhen(t.card.date, true)
          : fmtGameTime(t.card.date);
        out.push(`${String(t.card.name).toUpperCase()}${main} ${when}`);
      }
    }
  }
  return out;
}

let lastTape = "";
function renderTape() {
  const lines = headlines();
  const text = lines.join(" — ") + " — ";
  if (text === lastTape) return;
  lastTape = text;
  const track = $("#tape-track");
  track.innerHTML = "";
  // Two copies side by side; the track slides by exactly one copy (-50%).
  const reps = Math.max(1, Math.ceil(60 / text.length));
  const copy = text.repeat(reps);
  track.append(el("span", null, copy), el("span", null, copy));
  // A live game speeds the tape up (and marks it) until it ends.
  const liveGame = !!SCORES?.teams?.some((t) => t.live);
  $(".tape").classList.toggle("is-live", liveGame);
  track.style.setProperty(
    "--tape-s",
    `${Math.round(copy.length * (liveGame ? 0.14 : 0.28))}s`,
  );
  const live = $("#tape-live");
  if (!live.textContent) live.textContent = lines[0];
}

// Hold the tape to fast-forward it; it eases back to speed on release.
const TAPE_FAST = 6;
function wireTape() {
  const tape = $(".tape");
  let rate = 1;
  let target = 1;
  let frame = 0;
  const step = () => {
    rate += (target - rate) * 0.18;
    if (Math.abs(target - rate) < 0.05) rate = target;
    $("#tape-track")
      .getAnimations()
      .forEach((a) => a.updatePlaybackRate(rate));
    frame = rate === target ? 0 : requestAnimationFrame(step);
  };
  const to = (next) => {
    target = next;
    if (!frame) frame = requestAnimationFrame(step);
  };
  tape.addEventListener("pointerdown", () => to(TAPE_FAST));
  ["pointerup", "pointercancel", "pointerleave"].forEach((t) =>
    tape.addEventListener(t, () => to(1)),
  );
  tape.addEventListener("contextmenu", (e) => e.preventDefault());
}

/* ---------- live data ---------- */

const SYNC_KEY = "co.synced.at";
let syncing = false;

/* Status line: SYNCING while a refresh runs, SYNCED h:mm when everything
   came back, otherwise OFFLINE with the time of the last good sync so an
   old number is never mistaken for a fresh one. */
function renderSyncLine() {
  const v = `V${CONFIG.version || "2.0"}`;
  let last = null;
  try {
    last = Number(localStorage.getItem(SYNC_KEY)) || null;
  } catch (_) {}
  const at = last ? fmtTime(new Date(last)) : "—";
  const failed = Object.values(DATA).some((e) => e?.error);
  const offline = navigator.onLine === false;
  document.body.classList.toggle("is-offline", offline || failed);
  $("#sync-line").textContent =
    syncing && !offline
      ? `${v} · SYNCING`
      : offline || failed
        ? `${v} · OFFLINE · AS OF ${at}`
        : `${v} · SYNCED ${at}`;
}

async function refreshData() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || !CONFIG.dataRepo || syncing) return;
  lastDataLoad = Date.now();
  syncing = true;
  renderSyncLine();
  await loadLiveData({
    token,
    repo: CONFIG.dataRepo,
    onUpdate(appId, entry) {
      DATA[appId] = entry;
      renderBands();
      renderStrip();
      renderTape();
    },
  });
  syncing = false;
  if (!Object.values(DATA).some((e) => e?.error)) {
    try {
      localStorage.setItem(SYNC_KEY, String(Date.now()));
    } catch (_) {}
  }
  renderSyncLine();
}

/* ---------- scores ---------- */

function renderScoresPanel() {
  const list = $("#scores-list");
  list.innerHTML = "";
  if (!SCORES?.teams?.length) {
    list.append(el("p", "scores-empty", "SYNCING SCORES…"));
    return;
  }
  for (const t of SCORES.teams) {
    const row = el("section", "score-row");
    row.append(el("h2", "score-team", t.label.toUpperCase()));
    const lines = el("div", "score-lines");
    const line = (tag, text, cls) => {
      const p = el("p", `score-line${cls ? ` ${cls}` : ""}`);
      p.append(el("b", null, tag), el("span", null, text));
      lines.append(p);
    };
    if (t.live)
      line(
        "LIVE",
        `${t.live.us}–${t.live.them} ${t.live.home ? "VS" : "@"} ${t.live.opp} · ${String(t.live.detail).toUpperCase()}`,
        "is-live",
      );
    if (t.last)
      line(
        "LAST",
        `${t.last.result} ${t.last.us}–${t.last.them} ${t.last.home ? "VS" : "@"} ${t.last.opp}`,
      );
    if (t.next)
      line(
        "NEXT",
        `${t.next.home ? "VS" : "@"} ${t.next.opp} · ${fmtGameTime(t.next.date)}`,
      );
    if (t.card) {
      line(
        t.card.state === "post" ? "LAST" : "NEXT",
        `${String(t.card.name).toUpperCase()} · ${t.card.dateOnly ? shortWhen(t.card.date, true) : fmtGameTime(t.card.date)}`,
      );
      if (t.card.main)
        line(
          "MAIN",
          `${t.card.main[0].name} VS ${t.card.main[1].name}${t.card.winner ? ` · ${t.card.winner} WINS` : ""}`.toUpperCase(),
        );
    }
    if (t.error && !t.last && !t.next && !t.card) line("—", "COULDN'T LOAD");
    if (!lines.childElementCount) line("—", "NO GAMES SCHEDULED");
    row.append(lines);
    list.append(row);
  }
  const at = SCORES.at ? fmtTime(new Date(SCORES.at)) : "—";
  list.append(
    el(
      "p",
      "scores-foot",
      `${SCORES.stale ? "OFFLINE · " : ""}AS OF ${at} · ESPN`,
    ),
  );
}

async function refreshScores() {
  clearTimeout(scoresTimer);
  await loadScores(CONFIG.teams, (payload) => {
    SCORES = payload;
    renderBands();
    renderTape();
    if (openAppId === "scores") renderScoresPanel();
  });
  // Poll every minute while a game is live, otherwise every 30 minutes.
  const live = SCORES?.teams?.some((t) => t.live);
  scoresTimer = setTimeout(refreshScores, live ? 60_000 : 30 * 60_000);
}

/* ---------- theme ---------- */

// theme.js (loaded in <head>) owns the co.theme key; this only drives it.
function labelThemeButton() {
  const light = window.coTheme?.get() === "light";
  const btn = $("#theme");
  btn.setAttribute(
    "aria-label",
    light ? "Switch to dark mode" : "Switch to light mode",
  );
  btn.setAttribute("aria-pressed", String(light));
}

function toggleTheme() {
  window.coTheme?.toggle();
  feel("tick");
  $("#tape-live").textContent =
    window.coTheme?.get() === "light" ? "Light mode" : "Dark mode";
}

document.addEventListener("co:theme", () => {
  if ($("#theme")) labelThemeButton();
});

/* ---------- search ---------- */

const ACTIONS = [
  { label: "Lock", keywords: "lock sign out logout", run: () => lock() },
  {
    label: "Refresh",
    keywords: "refresh sync reload update",
    run: () => refreshData(),
  },
  {
    label: "Light / dark mode",
    keywords: "theme light dark mode appearance",
    run: () => toggleTheme(),
  },
  {
    label: "Sound",
    keywords: "sound audio mute unmute volume",
    run: () => {
      setSound(!soundOn());
      if (soundOn()) feel("tick");
      $("#tape-live").textContent = soundOn() ? "Sound on" : "Sound off";
    },
  },
];

function matches(q, ...fields) {
  return fields.some((f) =>
    String(f || "")
      .toLowerCase()
      .includes(q),
  );
}

function applySearch() {
  const q = $("#search").value.trim().toLowerCase();
  let first = null;
  const visibleOrder = [
    ...document.querySelectorAll(".band"),
    ...document.querySelectorAll(".strip-item"),
  ];
  for (const node of visibleOrder) {
    const app = APPS.find((a) => a.id === node.dataset.app);
    const hit =
      !q || matches(q, app.name, app.label, app.subtitle, app.keywords);
    node.classList.toggle("is-filtered", !hit);
    if (hit && q && !first) first = app;
  }
  requestAnimationFrame(fitBandNames);
  const action =
    q && !first ? ACTIONS.find((a) => matches(q, a.label, a.keywords)) : null;
  return { first, action };
}

function wireSearch() {
  const input = $("#search");
  input.addEventListener("input", applySearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const { first, action } = applySearch();
      if (first) {
        const origin = document.querySelector(
          `[data-app="${CSS.escape(first.id)}"]`,
        );
        input.blur();
        launchApp(first.id, origin);
      } else if (action) {
        action.run();
      }
      input.value = "";
      applySearch();
    } else if (e.key === "Escape") {
      input.value = "";
      applySearch();
      input.blur();
    }
  });
}

/* ---------- open / close an app ---------- */

function originFor(appId) {
  return (
    document.querySelector(`.band[data-app="${CSS.escape(appId)}"]`) ||
    document.querySelector(`.strip-item[data-app="${CSS.escape(appId)}"]`)
  );
}

const layerFor = (appId) =>
  APPS.find((a) => a.id === appId)?.panel ? $("#scores-panel") : $("#embed");

/* ---------- launch / collapse ----------
   An app grows out of its band (or strip tile) in the band's own diagonal
   shape. As it grows, the band's colour covers the screen and the band's
   name flies up into the app bar's title; then the colour lifts off the
   app. Closing plays the same moves backwards: colour covers, the title
   flies home onto the band, the shape collapses into the band's diagonal.
   Web Animations, one timing for both directions. */
const LAUNCH = { ms: 560, easing: "cubic-bezier(0.65, 0, 0.25, 1)" };

function originPolygon(node) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = node?.getBoundingClientRect?.();
  const pt = (x, y) => `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  if (!r || !r.width)
    return `polygon(${pt(0, vh * 0.4)}, ${pt(vw, vh * 0.4)}, ${pt(vw, vh * 0.6)}, ${pt(0, vh * 0.6)})`;
  const slant = node.classList.contains("band")
    ? parseFloat(getComputedStyle(node).getPropertyValue("--slant")) || 18
    : 0;
  return `polygon(${pt(r.left, r.top + slant)}, ${pt(r.right, r.top)}, ${pt(r.right, r.bottom - slant)}, ${pt(r.left, r.bottom)})`;
}
const fullPolygon = () =>
  `polygon(0px 0px, ${window.innerWidth}px 0px, ${window.innerWidth}px ${window.innerHeight}px, 0px ${window.innerHeight}px)`;

const nameOf = (node) =>
  node?.querySelector?.(".band-name") || node?.querySelector?.("span") || null;

// A stand-in for the name that flies between the band and the app bar.
// It's laid out at `toEl` (final size) and animated in from `fromEl`.
function flyName(fromEl, toEl, text) {
  const a = fromEl?.getBoundingClientRect();
  const b = toEl?.getBoundingClientRect();
  if (!a?.width || !b?.width) return null;
  const fly = el("div", "launch-name", text);
  const to = getComputedStyle(toEl);
  Object.assign(fly.style, {
    left: `${b.left}px`,
    top: `${b.top}px`,
    fontSize: to.fontSize,
    letterSpacing: to.letterSpacing,
    color: getComputedStyle(fromEl).color,
  });
  document.body.append(fly);
  const f = fly.getBoundingClientRect();
  const k = a.height / (f.height || 1);
  fly.animate(
    [
      {
        transform: `translate(${a.left - f.left}px, ${a.top - f.top}px) scale(${k})`,
        color: getComputedStyle(fromEl).color,
      },
      { transform: "none", color: to.color },
    ],
    { duration: LAUNCH.ms, easing: LAUNCH.easing, fill: "both" },
  );
  return fly;
}

function coverFor(layer) {
  let cover = layer.querySelector(":scope > .launch-cover");
  if (!cover) {
    cover = el("div", "launch-cover");
    cover.setAttribute("aria-hidden", "true");
    layer.append(cover);
  }
  return cover;
}

// Stop any launch/collapse still running on a layer (fast re-taps).
function settleLayer(layer) {
  for (const a of layer._anims || []) a.cancel();
  layer._anims = [];
  layer._fly?.remove();
  layer._fly = null;
  const title = layer.querySelector(".embed-title");
  if (title) title.style.opacity = "";
}

function launchApp(appId, originEl, { animate = true } = {}) {
  const app = APPS.find((a) => a.id === appId && (a.url || a.panel));
  if (!app || openAppId === appId) return;
  if (openAppId) closeApp({ fromHistory: true, quiet: true });
  // Only an animated launch gets the whoosh; deep links open silently.
  if (animate) feel("open");
  openAppId = appId;
  const embed = layerFor(appId);
  embed.style.setProperty("--app-color", app.color);
  embed.style.setProperty("--app-fg", inkFor(app.color));
  if (app.panel) {
    renderScoresPanel();
  } else {
    $("#embed-title").textContent = app.label || app.name;
    const frame = $("#embed-frame");
    frame.title = app.name;
    embed.classList.remove("is-failed");
    if (frame.getAttribute("src") !== app.url) {
      embed.classList.add("is-loading");
      frame.src = app.url;
      armEmbedTimeout(app);
    }
  }
  if (location.hash !== `#app/${app.id}`)
    history.pushState({ app: app.id }, "", `#app/${app.id}`);

  settleLayer(embed);
  embed.hidden = false;
  $("#app").setAttribute("aria-hidden", "true");
  if (animate && !reducedMotion()) {
    const origin = originEl || originFor(appId);
    const title = embed.querySelector(".embed-title");
    const cover = coverFor(embed);
    const timing = { duration: LAUNCH.ms, easing: LAUNCH.easing };
    const grow = embed.animate(
      [{ clipPath: originPolygon(origin) }, { clipPath: fullPolygon() }],
      timing,
    );
    // Colour holds while the shape grows, then lifts off the app.
    const lift = cover.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }],
      { duration: LAUNCH.ms + 280, easing: "ease-out", fill: "forwards" },
    );
    embed._fly = flyName(nameOf(origin), title, app.label || app.name);
    if (embed._fly && title) title.style.opacity = "0";
    embed._anims = [grow, lift];
    grow.finished
      .then(() => {
        embed._fly?.remove();
        embed._fly = null;
        if (title) title.style.opacity = "";
      })
      .catch(() => {});
  }
  embed.querySelector(".embed-home").focus({ preventScroll: true });
}

function closeApp({ fromHistory = false, quiet = false } = {}) {
  if (!openAppId) return;
  const embed = layerFor(openAppId);
  const appId = openAppId;
  const app = APPS.find((a) => a.id === appId);
  openAppId = null;
  clearTimeout(embedTimer);
  if (!quiet) feel("close");
  $("#app").removeAttribute("aria-hidden");
  if (!fromHistory && location.hash)
    history.pushState(null, "", location.pathname + location.search);
  settleLayer(embed);
  const finish = () => {
    settleLayer(embed);
    embed.hidden = true;
    embed.classList.remove("is-loading", "is-failed");
    // Keep the iframe document resident: reopening the same app is instant.
    originFor(appId)
      ?.querySelector?.(".band-hit")
      ?.focus({ preventScroll: true });
  };
  if (reducedMotion() || quiet) return finish();
  // The launch in reverse: colour covers, the title flies home, the shape
  // collapses into the band's diagonal.
  const origin = originFor(appId);
  const title = embed.querySelector(".embed-title");
  const cover = coverFor(embed);
  const fade = cover.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 180,
    easing: "ease-out",
    fill: "forwards",
  });
  const shrink = embed.animate(
    [{ clipPath: fullPolygon() }, { clipPath: originPolygon(origin) }],
    { duration: LAUNCH.ms, easing: LAUNCH.easing, delay: 80, fill: "forwards" },
  );
  embed._fly = flyName(title, nameOf(origin), app?.label || app?.name || "");
  if (embed._fly && title) title.style.opacity = "0";
  embed._anims = [fade, shrink];
  shrink.finished.then(finish).catch(() => {});
}

function armEmbedTimeout(app) {
  clearTimeout(embedTimer);
  embedTimer = setTimeout(() => {
    const embed = $("#embed");
    embed.classList.remove("is-loading");
    embed.classList.add("is-failed");
    $("#embed-failure-msg").textContent =
      navigator.onLine === false
        ? `You're offline, and ${app.name} isn't saved on this phone yet.`
        : `${app.name} didn't respond in time.`;
  }, EMBED_LOAD_TIMEOUT_MS);
}

/* The PAT is delivered only by postMessage to the app's exact origin,
   never in the iframe URL (history / session restore / referrer leaks). */
function sendPatHandshake(frame) {
  const app = APPS.find((a) => a.id === openAppId);
  if (!app || app.auth !== "pat" || !frame.contentWindow) return;
  const pat = localStorage.getItem(TOKEN_KEY);
  if (!pat) return;
  try {
    frame.contentWindow.postMessage(
      { type: "co.pat", pat },
      new URL(app.url).origin,
    );
  } catch (_) {}
}

function wireEmbed() {
  const frame = $("#embed-frame");
  frame.addEventListener("load", () => {
    if (!frame.getAttribute("src")) return;
    clearTimeout(embedTimer);
    $("#embed").classList.remove("is-loading", "is-failed");
    sendPatHandshake(frame);
  });
  $("#embed-home").addEventListener("click", () => closeApp());
  $("#scores-home").addEventListener("click", () => closeApp());
  $("#embed-failure-close").addEventListener("click", () => closeApp());
  $("#embed-failure-retry").addEventListener("click", () => {
    const app = APPS.find((a) => a.id === openAppId);
    if (!app) return;
    $("#embed").classList.replace("is-failed", "is-loading");
    frame.src = "about:blank";
    setTimeout(() => {
      frame.src = app.url;
      armEmbedTimeout(app);
    }, 0);
  });
}

function handleHash() {
  const m = location.hash.match(/^#app\/(.+)$/);
  if (!m) return closeApp({ fromHistory: true });
  if (m[1] !== openAppId) launchApp(m[1], null, { animate: openAppId == null });
}

/* ---------- keyboard ---------- */

function wireKeys() {
  window.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(
      document.activeElement?.tagName || "",
    );
    if (e.key === "Escape" && openAppId) return closeApp();
    if (
      (e.key === "k" && (e.metaKey || e.ctrlKey)) ||
      (e.key === "/" && !typing)
    ) {
      e.preventDefault();
      if (openAppId) closeApp();
      $("#search").focus();
      return;
    }
    if (
      !typing &&
      !openAppId &&
      /^[1-9]$/.test(e.key) &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      const nodes = [
        ...document.querySelectorAll(".band"),
        ...document.querySelectorAll(".strip-item"),
      ];
      const node = nodes[Number(e.key) - 1];
      if (node) {
        e.preventDefault();
        launchApp(node.dataset.app, node);
      }
    }
  });
}

/* ---------- lock / unlock ---------- */

async function lock() {
  localStorage.removeItem(TOKEN_KEY);
  closeApp();
  await clearLiveData();
  for (const k of Object.keys(DATA)) delete DATA[k];
  location.reload();
}

let started = false;
function startHome() {
  if (started) return;
  started = true;
  $("#app").hidden = false;
  if (!reducedMotion()) {
    $("#app").classList.add("is-entering");
    setTimeout(() => $("#app").classList.remove("is-entering"), 1400);
  }
  document.title = CONFIG.title || "Central Optimus";
  startClock();
  setWeatherLine(null);
  setPublishStamp();
  buildBands();
  buildStrip();
  renderBands();
  renderTape();
  wireTape();
  wireSearch();
  $("#lock").addEventListener("click", lock);
  $("#theme").addEventListener("click", toggleTheme);
  labelThemeButton();
  document.fonts?.ready.then(fitBandNames);
  window.addEventListener("resize", () => requestAnimationFrame(fitBandNames));
  weatherController?.destroy();
  weatherController = initWeather({
    mountEl: null,
    onUpdate: setWeatherLine,
    onError: () => {},
  });
  renderSyncLine();
  refreshData();
  refreshScores();
  // Offline-first: everything above painted from cache; when the network
  // comes back, re-sync data and weather without waiting for a relaunch.
  window.addEventListener("online", () => {
    refreshData();
    refreshScores();
    weatherController?.refresh?.();
  });
  window.addEventListener("offline", renderSyncLine);
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      Date.now() - lastDataLoad > 5 * 60_000
    )
      refreshData();
  });
  // Deep link (#app/<id>) at boot: open straight into the app, no animation.
  const m = location.hash.match(/^#app\/(.+)$/);
  if (m) launchApp(m[1], null, { animate: false });
}

async function unlock() {
  const dialog = $("#gate");
  const form = $("#gate-form");
  const input = $("#token");
  const error = $("#gate-error");
  if (!CONFIG.githubUser) {
    document.body.textContent =
      "Set githubUser in config.json before the launcher will load.";
    return;
  }
  const showGate = (message) => {
    error.hidden = !message;
    if (message) error.textContent = message;
    if (!dialog.open) dialog.showModal();
    input.focus();
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    const token = input.value.trim();
    const result = await verifyToken(token, CONFIG.githubUser);
    if (result.ok) {
      localStorage.setItem(TOKEN_KEY, token);
      if (dialog.open) dialog.close();
      startHome();
      return;
    }
    error.textContent = gateErrorMessage(result, CONFIG.githubUser);
    error.hidden = false;
    if (result.reason === "wrong-account" || result.reason === "unauthorized")
      input.value = "";
    input.focus();
  });

  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) {
    // Optimistic reveal; re-verify in the background and only fall back to
    // the gate if the token is genuinely bad (not on network/rate limits).
    startHome();
    verifyToken(existing, CONFIG.githubUser).then((result) => {
      if (
        result.ok ||
        result.reason === "network" ||
        result.reason === "rate-limit"
      )
        return;
      localStorage.removeItem(TOKEN_KEY);
      showGate(gateErrorMessage(result, CONFIG.githubUser));
    });
    return;
  }
  showGate();
}

function showBootError(err, retry) {
  console.error(err);
  document.getElementById("boot-error")?.remove();
  const overlay = el("div", "boot-error");
  overlay.id = "boot-error";
  const btn = el("button", "square-btn wide is-accent", "RETRY");
  btn.type = "button";
  btn.addEventListener("click", () => {
    overlay.remove();
    retry();
  });
  overlay.append(
    el("h2", null, "COULDN'T LOAD"),
    el("p", null, err?.message || "Something went wrong."),
    btn,
  );
  document.body.append(overlay);
}

/* ---------- boot ---------- */

wireKeys();
wireEmbed();
window.addEventListener("popstate", handleHash);
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch(() => {}),
  );
}

(function boot() {
  const start = async () => {
    try {
      const [config, registry] = await Promise.all([
        loadJSON("./config.json"),
        loadJSON("./apps.json"),
      ]);
      CONFIG = config;
      APPS = registry.apps || [];
      await unlock();
    } catch (err) {
      showBootError(err, start);
    }
  };
  start();
})();
