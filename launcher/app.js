import { initWeather } from "./weather.js";
import { startMovement } from "./mechanism.js";

function haptic(pattern) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch (_) {}
}

/* Block the page itself from pinch-zooming. The viewport meta has
   user-scalable=no but iOS Safari ignores it in standalone PWA mode.
   We stop the WebKit gesture* events (two-finger zoom on iOS) and
   ctrl+wheel (desktop trackpad pinch) at the document level so the
   shell stays put — the watch canvas owns its own pinch handler and
   consumes the pointer events directly. */
(function lockPagePinchZoom() {
  const swallow = (e) => { e.preventDefault(); };
  ["gesturestart", "gesturechange", "gestureend"].forEach((evt) => {
    document.addEventListener(evt, swallow, { passive: false });
  });
  document.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener("wheel", (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
})();

const TOKEN_KEY = "co.gh.token";
const GESTURE_LOCK_KEY = "co.bg.locked";

/* -------------------------------------------------------------------
   Motion choreography
   -------------------------------------------------------------------
   Three camera states drive the whole experience:
     wide     — entire watch framed on screen (boot + pre-launch + pre-close)
     ambient  — plate fills viewport, mechanism is the UI backdrop
     (closeup — legacy dive into the 4th wheel; used only by reduced motion)

   Boot:        wide → ambient              (--boot-zoom-ms)
                shell fades in during the last stretch (--boot-shell-delay-ms)
   Launch tap:  ambient → wide              (--pull-out-ms)
                then flip card 180° (--flip-ms) — app is on the back face
   Close:       flip back (--flip-ms)
                then wide → ambient         (--close-zoom-ms)

   Durations live in input.css as CSS custom properties on :root and are
   read here via getComputedStyle so the CSS transition and JS timeouts
   share a single source of truth.
   ------------------------------------------------------------------- */
function readMs(name, fallback) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return fallback;
  if (raw.endsWith("ms")) return parseFloat(raw);
  if (raw.endsWith("s"))  return parseFloat(raw) * 1000;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? fallback : n;
}
const TIMING = {
  bootZoom:       readMs("--boot-zoom-ms",       500),
  bootShellDelay: readMs("--boot-shell-delay-ms", 280),
  pullOut:        readMs("--pull-out-ms",        280),
  flip:           readMs("--flip-ms",            500),
  closeZoom:      readMs("--close-zoom-ms",      420),
  closeShellLead: readMs("--close-shell-lead-ms", 150),
};

let APPS = [];
let weatherController = null;
let clockTimer = null;
let watchCanvas = null;
let reducedMotion = false;

/* Flip state machine — guards launch/close against re-entry from
   double-taps, popstate during animation, and ESC mid-flip. */
let flipState = "idle"; // 'idle' | 'opening' | 'open' | 'closing'
let activeAppId = null;
let lastLaunchTrigger = null; // tile element to restore focus to on close
// Snapshot of the watch camera at the moment of launch so close can
// tween back to the exact view the user was looking at — including
// any pinch/pan/rotation they had applied. Null until the first launch.
let preLaunchCamera = null;

const REDUCED_MOTION_MQL = window.matchMedia("(prefers-reduced-motion: reduce)");
reducedMotion = REDUCED_MOTION_MQL.matches;
REDUCED_MOTION_MQL.addEventListener("change", (e) => {
  reducedMotion = e.matches;
});

/* Promise that resolves when the flip card finishes its page-flop
   animation. Listens for both animationend (the keyframe path) and
   transitionend (fallback if anything reverts to a plain transition),
   with a timer ~60ms past the declared duration as a last resort. */
function awaitFlip(card) {
  return new Promise((resolve) => {
    if (!card) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      card.removeEventListener("animationend", onAnimEnd);
      card.removeEventListener("transitionend", onTransEnd);
      clearTimeout(timer);
      resolve();
    };
    const onAnimEnd = (e) => {
      if (e.target === card) finish();
    };
    const onTransEnd = (e) => {
      if (e.target === card && e.propertyName === "transform") finish();
    };
    card.addEventListener("animationend", onAnimEnd);
    card.addEventListener("transitionend", onTransEnd);
    const timer = setTimeout(finish, TIMING.flip + 60);
  });
}

async function loadJSON(path) {
  // Retry transient failures (offline, 5xx) with exponential backoff;
  // 4xx fails fast since retrying won't change the answer.
  const delays = [250, 1000];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (res.ok) return res.json();
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Failed to load ${path}: ${res.status}`);
      }
      lastErr = new Error(`Failed to load ${path}: ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

/* Returns a discriminated result so the caller can render the right
   copy. Network errors, 401, rate-limit, and wrong-account each have
   distinct meanings to the user. */
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
  if (
    res.status === 403 &&
    res.headers.get("x-ratelimit-remaining") === "0"
  ) {
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

/* ---------- Live data (greeting, date, time, publish stamp) ---------- */

const pad = (n) => String(n).padStart(2, "0");

function fmtTime12(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad(m)} ${ampm}`;
}

function fmtDate(d) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

function greetingFor(d) {
  const h = d.getHours();
  if (h < 5) return "Still up,";
  if (h < 12) return "Good morning,";
  if (h < 17) return "Good afternoon,";
  if (h < 21) return "Good evening,";
  return "Good night,";
}

function titleCaseFirstName(config) {
  const first = (config.firstName || config.githubUser || "")
    .toString()
    .split(/[\s.]/)[0];
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function tickClock(config) {
  const now = new Date();
  const greet = document.getElementById("greet-time");
  const name = document.getElementById("greet-name");
  const date = document.getElementById("today-date");
  const live = document.getElementById("live-time");
  if (greet) greet.textContent = greetingFor(now);
  if (name) name.textContent = titleCaseFirstName(config);
  if (date) date.textContent = fmtDate(now);
  if (live) live.textContent = fmtTime12(now);
}

function startClock(config) {
  tickClock(config);
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(() => tickClock(config), 10_000);
}

async function setPublishStamp() {
  const el = document.getElementById("publish-time");
  if (!el) return;
  let when = new Date();
  try {
    const res = await fetch("./build.json", { cache: "no-cache" });
    if (res.ok) {
      const info = await res.json();
      const d = info?.builtAt ? new Date(info.builtAt) : null;
      if (d && !Number.isNaN(d.valueOf())) when = d;
    }
  } catch {}
  const ptFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const ptDateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  });
  el.textContent = `published ${ptDateFmt.format(when)} · ${ptFmt.format(when)} PT`;
}

/* ---------- App launch orchestration ----------
   Tile tap reverses the boot zoom and then flips the card:
     ambient → wide → flip 180° (app on back face)
   The shell fades out during the pull-out; the iframe mounts before
   the flip so it has loading time to cover, and a cream curtain
   (`.flip-back.is-loading`) hides any pre-paint flash until the
   iframe's load event fires. Close is the exact reverse: unflip,
   then zoom back in.

   The flipState machine guards every entry point — double-taps, ESC
   mid-flip, popstate during animation, and a tile tap during a close
   are all coalesced. */

async function launchApp(appId, opts = {}) {
  if (flipState !== "idle") return;
  const app = APPS.find((a) => a.id === appId);
  if (!app) {
    haptic(8);
    return;
  }
  haptic(8);

  flipState = "opening";
  activeAppId = appId;
  lastLaunchTrigger =
    opts.trigger ||
    document.querySelector(`#launcher-grid a.icon[data-app="${CSS.escape(appId)}"]`) ||
    null;

  const shell = document.getElementById("app");
  const card = document.getElementById("flip-card");

  // a11y: hide the front face from screen readers while the back is in view.
  const front = document.querySelector(".flip-front");
  const back = document.getElementById("flip-back");

  const finishOpen = () => {
    flipState = "open";
    if (front) front.setAttribute("aria-hidden", "true");
    if (back) back.removeAttribute("aria-hidden");
    if (card) card.classList.remove("is-flipping");
    // Move focus into the iframe so keyboard users land inside the app.
    const frame = document.getElementById("embed-frame");
    if (frame) {
      try { frame.focus({ preventScroll: true }); } catch (_) {}
    }
  };

  if (reducedMotion || !watchCanvas || !watchCanvas._setCamera) {
    if (shell) shell.classList.add("app-open");
    openEmbed(app);
    if (card) card.classList.add("is-flipped");
    finishOpen();
    return;
  }

  if (shell) shell.classList.add("app-open");
  // Snapshot the live camera (cx/cy/R + name) BEFORE we tween away so
  // closeActiveApp can restore the user back to the exact view they
  // had — including any pinch/pan they applied — instead of always
  // landing on the ambient preset.
  if (watchCanvas._getCameraState) {
    preLaunchCamera = watchCanvas._getCameraState();
  }
  // Camera pull-out (ambient → wide) and the page-flop animation run
  // CONCURRENTLY so the watch is visibly receding while the card lifts
  // toward the viewer — one integrated motion rather than "zoom, pause,
  // flip". Pull-out duration is shorter than the flip so the watch
  // settles in time for the back face to dominate.
  watchCanvas._setCamera("wide", TIMING.pullOut);
  openEmbed(app);

  // Add .is-flipping in the SAME task as .is-flipped so the matched
  // animation selector resolves directly to .is-flipping.is-flipped
  // (flip-page-forward) and starts at the current rotation rather than
  // briefly matching .is-flipping:not(.is-flipped) and snapping back.
  if (card) {
    card.classList.add("is-flipping");
    card.classList.add("is-flipped");
  }
  await awaitFlip(card);
  if (flipState !== "opening") return;
  finishOpen();
}

async function closeActiveApp() {
  const wrap = document.getElementById("embed");
  const shell = document.getElementById("app");
  const card = document.getElementById("flip-card");
  if (!wrap || wrap.hidden) return;
  if (flipState !== "open" && flipState !== "opening") return;

  flipState = "closing";
  const front = document.querySelector(".flip-front");
  const back = document.getElementById("flip-back");
  if (front) front.removeAttribute("aria-hidden");
  if (back) back.setAttribute("aria-hidden", "true");

  const finishClose = () => {
    flipState = "idle";
    activeAppId = null;
    if (card) card.classList.remove("is-flipping");
    hideEmbed();
    if (lastLaunchTrigger) {
      try { lastLaunchTrigger.focus({ preventScroll: true }); } catch (_) {}
    }
    lastLaunchTrigger = null;
  };

  if (reducedMotion || !watchCanvas || !watchCanvas._setCamera) {
    if (card) card.classList.remove("is-flipped");
    if (shell) shell.classList.remove("app-open");
    finishClose();
    return;
  }

  // Page-flop and camera zoom-in run CONCURRENTLY — the front face
  // settles into the plane just as the watch arrives at ambient, so
  // close reads as one integrated motion mirroring the launch. Both
  // classes toggle in the same task so the matched animation is
  // .is-flipping:not(.is-flipped) (flip-page-back) from frame one,
  // never briefly the forward direction.
  if (card) {
    card.classList.add("is-flipping");
    card.classList.remove("is-flipped");
  }
  if (watchCanvas && watchCanvas._setCamera) {
    // Restore the exact pre-launch view (cx/cy/R) — preserves any
    // pinch/pan the user had applied. Falls back to the ambient
    // preset for direct deep-links where we never captured a state.
    watchCanvas._setCamera(preLaunchCamera || "ambient", TIMING.closeZoom);
  }
  setTimeout(() => {
    if (shell) shell.classList.remove("app-open");
  }, Math.max(0, TIMING.flip - TIMING.closeShellLead));

  await awaitFlip(card);
  if (flipState !== "closing") return;
  finishClose();
}

function wireLauncherGrid() {
  const grid = document.getElementById("launcher-grid");
  if (!grid) return;
  grid.querySelectorAll(".icon[data-app]").forEach((el) => {
    el.addEventListener("click", () => {
      const appId = el.dataset.app;
      launchApp(appId, { trigger: el });
    });
  });
}

function wireGlobalShortcuts() {
  window.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    const typing =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable);
    if (e.key === "Escape") {
      closeActiveApp();
      return;
    }
    if (
      !typing &&
      /^[1-9]$/.test(e.key) &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      const idx = parseInt(e.key, 10) - 1;
      const tile = document.querySelectorAll(
        "#launcher-grid .icon[data-app]",
      )[idx];
      if (tile) {
        e.preventDefault();
        tile.click();
      }
    }
  });
}

/* ---------- Embed iframe (how each app actually opens) ---------- */

function ensureEmbedShell() {
  let wrap = document.getElementById("embed");
  if (wrap) return wrap;
  wrap = document.createElement("div");
  wrap.id = "embed";
  wrap.hidden = true;
  wrap.className = "embed-shell";
  wrap.innerHTML = `
    <div class="embed-bar">
      <button id="embed-home" type="button" aria-label="Home" class="embed-home">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.5 11.5L12 4l8.5 7.5"/>
          <path d="M5.5 10.5V19a1.5 1.5 0 0 0 1.5 1.5h3.5V15h3v5.5H17a1.5 1.5 0 0 0 1.5-1.5v-8.5"/>
        </svg>
        <span>Home</span>
      </button>
      <div id="embed-title" class="embed-title"></div>
    </div>
    <iframe id="embed-frame" class="embed-frame" title="App" referrerpolicy="no-referrer" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
  `;
  const back = document.getElementById("flip-back") || document.body;
  back.appendChild(wrap);
  document.getElementById("embed-home").addEventListener("click", () => {
    if (location.hash) {
      history.pushState(null, "", location.pathname + location.search);
    }
    closeActiveApp();
  });

  // Spinner + failure overlay sit on the .flip-back curtain so they
  // appear above the iframe. CSS keys both off classes on .flip-back:
  // .is-loading shows the spinner, .is-failed shows the failure card.
  if (back && !back.querySelector(".embed-loading")) {
    const loading = document.createElement("div");
    loading.className = "embed-loading";
    loading.setAttribute("aria-hidden", "true");
    loading.innerHTML = `<div class="embed-spinner" aria-hidden="true"></div>`;
    back.appendChild(loading);
  }
  if (back && !back.querySelector(".embed-failure")) {
    const failure = document.createElement("div");
    failure.className = "embed-failure";
    failure.setAttribute("role", "alert");
    failure.innerHTML = `
      <div class="embed-failure-card">
        <h3>Couldn't load app</h3>
        <p id="embed-failure-msg">The app didn't respond in time.</p>
        <div class="embed-failure-actions">
          <button type="button" id="embed-failure-close">Close</button>
          <button type="button" id="embed-failure-retry" class="is-primary">Retry</button>
        </div>
      </div>
    `;
    back.appendChild(failure);
    failure.querySelector("#embed-failure-close").addEventListener("click", () => {
      closeActiveApp();
    });
    failure.querySelector("#embed-failure-retry").addEventListener("click", () => {
      const app = APPS.find((a) => a.id === activeAppId);
      if (app) reloadEmbed(app);
    });
  }

  // Cream curtain on .flip-back hides any pre-paint flash from the iframe
  // until it fires its load event. Each openEmbed adds .is-loading; the
  // load handler clears it. A 10s watchdog flips to .is-failed if the
  // load event never arrives.
  const frame = wrap.querySelector("#embed-frame");
  frame.addEventListener("load", () => {
    clearEmbedTimeout();
    if (back && back.classList) {
      back.classList.remove("is-loading");
      back.classList.remove("is-failed");
    }
    sendPatHandshake(frame);
  });

  return wrap;
}

let embedLoadTimer = null;
const EMBED_LOAD_TIMEOUT_MS = 10000;

function clearEmbedTimeout() {
  if (embedLoadTimer) {
    clearTimeout(embedLoadTimer);
    embedLoadTimer = null;
  }
}

function armEmbedTimeout(appName) {
  clearEmbedTimeout();
  embedLoadTimer = setTimeout(() => {
    const back = document.getElementById("flip-back");
    if (!back) return;
    back.classList.remove("is-loading");
    back.classList.add("is-failed");
    const msg = back.querySelector("#embed-failure-msg");
    if (msg) {
      msg.textContent = `${appName || "The app"} didn't respond in time.`;
    }
  }, EMBED_LOAD_TIMEOUT_MS);
}

function reloadEmbed(app) {
  const frame = document.getElementById("embed-frame");
  const back = document.getElementById("flip-back");
  if (!frame) return;
  if (back) {
    back.classList.remove("is-failed");
    back.classList.add("is-loading");
  }
  // Force a reload even if the URL is the same as last time.
  frame.src = "about:blank";
  // Yield a tick so the about:blank actually swaps before the real src.
  setTimeout(() => {
    frame.src = embedUrlFor(app);
    armEmbedTimeout(app.name);
  }, 0);
}

/* PostMessage handshake for PAT-gated apps. The PAT is delivered only
   through this channel — never through the iframe URL — so it can't
   leak via history, session restore, or any URL-aware logging the
   embedded app does. The message targets the iframe's specific origin
   and stays in memory. */
function sendPatHandshake(frame) {
  if (!frame || !frame.contentWindow) return;
  const id = activeAppId;
  if (!id) return;
  const app = APPS.find((a) => a.id === id);
  if (!app || app.auth !== "pat") return;
  const pat = localStorage.getItem(TOKEN_KEY) || "";
  if (!pat) return;
  let origin;
  try {
    origin = new URL(app.url).origin;
  } catch (_) {
    return;
  }
  try {
    frame.contentWindow.postMessage({ type: "co.pat", pat }, origin);
  } catch (_) {}
}

function embedUrlFor(app) {
  // PAT-gated apps receive the token via postMessage (see sendPatHandshake)
  // rather than a URL query param, which would leak through history,
  // session restore, and any URL-aware logging the embedded app does.
  return app.url;
}

function openEmbed(app) {
  const wrap = ensureEmbedShell();
  document.getElementById("embed-title").textContent = app.name;
  const frame = document.getElementById("embed-frame");
  const back = document.getElementById("flip-back");
  if (back) back.classList.remove("is-failed");
  // Iframe title reflects the active app so screen readers announce it
  // instead of a generic "App".
  frame.title = app.name;
  const src = embedUrlFor(app);
  if (frame.src !== src) {
    if (back) back.classList.add("is-loading");
    frame.src = src;
    armEmbedTimeout(app.name);
  }
  wrap.hidden = false;
  const hash = `#app/${app.id}`;
  if (location.hash !== hash) {
    history.pushState({ embed: app.id }, "", hash);
  }
}

function hideEmbed() {
  const wrap = document.getElementById("embed");
  if (!wrap) return;
  wrap.hidden = true;
  clearEmbedTimeout();
  const back = document.getElementById("flip-back");
  if (back) {
    back.classList.remove("is-loading");
    back.classList.remove("is-failed");
  }
  const frame = document.getElementById("embed-frame");
  if (frame) frame.src = "about:blank";
}

/* Back/forward navigation: sync the flip state without pushing more
   history entries (launchApp/openEmbed already pushState themselves
   when invoked from a tile tap). The state-machine guard inside
   launchApp/closeActiveApp coalesces popstate during an in-flight
   flip — it's a no-op then and the next idle state catches up. */
function handleHash() {
  const m = location.hash.match(/^#app\/(.+)$/);
  if (!m) {
    if (flipState === "open" || flipState === "opening") closeActiveApp();
    return;
  }
  const app = APPS.find((a) => a.id === m[1] && a.url);
  if (!app) {
    if (flipState === "open" || flipState === "opening") closeActiveApp();
    return;
  }
  if (flipState === "idle") launchApp(app.id);
}

window.addEventListener("popstate", handleHash);

/* ---------- Auth + bootstrap ---------- */

function revealApp(title) {
  document.getElementById("app").hidden = false;
  document.title = title || "Central Optimus";
}

async function unlock(config, registry) {
  const dialog = document.getElementById("gate");
  const form = document.getElementById("gate-form");
  const input = document.getElementById("token");
  const error = document.getElementById("gate-error");

  if (!config.githubUser) {
    document.body.textContent =
      "Set githubUser in config.json before the launcher will load.";
    return;
  }

  const finish = () => {
    if (dialog.open) dialog.close();
    revealApp(config.title);
    APPS = registry.apps || [];
    startClock(config);
    setPublishStamp();
    wireLauncherGrid();
    startWatchCanvas();
    wireGestureLock();
    bootSequence();

    const weatherEl = document.getElementById("hero-weather");
    if (weatherEl) {
      if (weatherController) weatherController.destroy();
      weatherController = initWeather({
        mountEl: weatherEl,
        onUpdate: () => {
          weatherEl.hidden = false;
        },
        onError: () => {},
      });
    }
  };

  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) {
    const result = await verifyToken(existing, config.githubUser);
    if (result.ok) {
      finish();
      return;
    }
    // Keep the cached token across transient/network errors so the user
    // doesn't have to paste it again every time GitHub hiccups.
    if (result.reason !== "network" && result.reason !== "rate-limit") {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  dialog.showModal();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    const token = input.value.trim();
    const result = await verifyToken(token, config.githubUser);
    if (result.ok) {
      localStorage.setItem(TOKEN_KEY, token);
      finish();
      return;
    }
    error.textContent = gateErrorMessage(result, config.githubUser);
    error.hidden = false;
    if (result.reason === "wrong-account" || result.reason === "unauthorized") {
      input.value = "";
    }
    input.focus();
  });
}

/* Background gesture lock — the corner button toggles whether the
   watch canvas accepts pinch/drag. State persists across reloads so
   the user's preference survives navigating away and back. */
function applyGestureLock(locked) {
  const btn = document.getElementById("lock");
  if (btn) {
    btn.dataset.state = locked ? "locked" : "unlocked";
    const label = locked ? "Unlock background" : "Lock background";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", locked ? "true" : "false");
    btn.title = label;
  }
  if (watchCanvas && watchCanvas._setGestureLock) {
    watchCanvas._setGestureLock(locked);
  }
}

function wireGestureLock() {
  const initial = localStorage.getItem(GESTURE_LOCK_KEY) === "1";
  applyGestureLock(initial);
  const btn = document.getElementById("lock");
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener("click", () => {
    const next = btn.dataset.state !== "locked";
    localStorage.setItem(GESTURE_LOCK_KEY, next ? "1" : "0");
    applyGestureLock(next);
    haptic(6);
  });
}

function startWatchCanvas() {
  watchCanvas = document.querySelector(".watch-canvas");
  if (!watchCanvas || watchCanvas._setCamera) return;
  try {
    startMovement(watchCanvas);
  } catch (err) {
    console.warn("mechanism failed to start:", err);
  }
}

/* Boot choreography — decides between the "zoom from wide" opening and
   the direct-to-app path (reload on an #app/<id> hash). */
function bootSequence() {
  const shell = document.getElementById("app");
  const card = document.getElementById("flip-card");

  const hashMatch = location.hash.match(/^#app\/(.+)$/);
  const hashApp = hashMatch
    ? APPS.find((a) => a.id === hashMatch[1] && a.url)
    : null;

  if (hashApp) {
    // Reloaded directly into an app — skip the boot zoom, land the
    // camera at wide (so the back of the flip card reads against a
    // framed watch if the user closes), and flip immediately.
    if (watchCanvas && watchCanvas._setCamera) {
      watchCanvas._setCamera("wide", 0);
    }
    if (shell) {
      shell.classList.remove("is-booting");
      shell.classList.add("app-open");
    }
    flipState = "open";
    activeAppId = hashApp.id;
    openEmbed(hashApp);
    if (card) card.classList.add("is-flipped");
    const front = document.querySelector(".flip-front");
    const back = document.getElementById("flip-back");
    if (front) front.setAttribute("aria-hidden", "true");
    if (back) back.removeAttribute("aria-hidden");
    return;
  }

  if (reducedMotion || !watchCanvas || !watchCanvas._setCamera) {
    if (watchCanvas && watchCanvas._setCamera) {
      watchCanvas._setCamera("ambient", 0);
    }
    if (shell) shell.classList.remove("is-booting");
    return;
  }

  // Fresh boot: camera starts at 'wide' (mechanism's default), tween
  // in to 'ambient' over the boot-zoom duration. The shell's fade-in
  // is held until the shell-delay so the greeting lands as the
  // mechanism settles behind it rather than floating over a tiny watch.
  watchCanvas._setCamera("ambient", TIMING.bootZoom);
  setTimeout(() => {
    if (shell) shell.classList.remove("is-booting");
  }, TIMING.bootShellDelay);
}

wireGlobalShortcuts();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function showBootError(err, retry) {
  console.error(err);
  let overlay = document.getElementById("boot-error");
  if (overlay) overlay.remove();
  overlay = document.createElement("div");
  overlay.id = "boot-error";
  overlay.className = "boot-error";
  overlay.innerHTML = `
    <div class="boot-error-card">
      <h2>Couldn't load launcher</h2>
      <p>${(err && err.message) || "Something went wrong."}</p>
      <button type="button" id="boot-error-retry">Retry</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document
    .getElementById("boot-error-retry")
    .addEventListener("click", () => {
      overlay.remove();
      retry();
    });
}

(function bootLauncher() {
  const start = async () => {
    try {
      const [config, registry] = await Promise.all([
        loadJSON("./config.json"),
        loadJSON("./apps.json"),
      ]);
      await unlock(config, registry);
    } catch (err) {
      showBootError(err, start);
    }
  };
  start();
})();
