import { initWeather } from "./weather.js";
import { startMovement } from "./mechanism.js";

function haptic(pattern) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch (_) {}
}

/* Block all pinch-zoom paths. The viewport meta has user-scalable=no
   but iOS Safari ignores it in standalone PWA mode. We also stop the
   WebKit gesture* events (two-finger zoom on iOS) and ctrl+wheel
   (desktop trackpad pinch). touch-action on html/body in CSS handles
   the passive case; this catches active gesture attempts. */
(function lockPinchZoom() {
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

/* -------------------------------------------------------------------
   Motion choreography
   -------------------------------------------------------------------
   Three camera states drive the whole experience:
     wide     — entire watch framed on screen (boot + pre-launch + pre-close)
     ambient  — plate fills viewport, mechanism is the UI backdrop
     (closeup — legacy dive into the 4th wheel; used only by reduced motion)

   Boot:        wide → ambient              (BOOT_ZOOM_MS)
                shell fades in during the last stretch (BOOT_SHELL_DELAY)
   Launch tap:  ambient → wide              (PULL_OUT_MS)
                then flip card 180° (FLIP_MS) — app is on the back face
   Close:       flip back (FLIP_MS)
                then wide → ambient         (CLOSE_ZOOM_MS)
   ------------------------------------------------------------------- */
const BOOT_ZOOM_MS     = 500;
const BOOT_SHELL_DELAY = 280;
const PULL_OUT_MS      = 280;
const FLIP_MS          = 500;   // keep in sync with .flip-card CSS transition
const CLOSE_ZOOM_MS    = 420;
const CLOSE_SHELL_LEAD = 150;   // shell fade starts this much before flip lands

let APPS = [];
let weatherController = null;
let clockTimer = null;
let watchCanvas = null;
let reducedMotion = false;

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function verifyToken(token, expectedLogin) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return false;
  const user = await res.json();
  return (
    typeof user.login === "string" &&
    user.login.toLowerCase() === expectedLogin.toLowerCase()
  );
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
   The shell fades out during the pull-out; the iframe is mounted a bit
   before the flip starts so it has loading time to cover. Close is the
   exact reverse: unflip, then zoom back in. */

function launchApp(appId) {
  const app = APPS.find((a) => a.id === appId);
  if (!app) {
    haptic(8);
    return;
  }
  haptic(8);

  const shell = document.getElementById("app");
  const card = document.getElementById("flip-card");

  if (reducedMotion || !watchCanvas || !watchCanvas._setCamera) {
    if (shell) shell.classList.add("app-open");
    openEmbed(app);
    if (card) card.classList.add("is-flipped");
    return;
  }

  if (shell) shell.classList.add("app-open");
  watchCanvas._setCamera("wide", PULL_OUT_MS);

  // Mount the iframe partway through the pull-out so network/render
  // overlap with the camera move. The flip itself waits until the
  // wide shot has landed so the user sees the full watch for an
  // instant before it turns over.
  setTimeout(() => openEmbed(app), Math.max(0, PULL_OUT_MS - 280));
  setTimeout(() => {
    if (card) card.classList.add("is-flipped");
  }, PULL_OUT_MS + 40);
}

function closeActiveApp() {
  const wrap = document.getElementById("embed");
  const shell = document.getElementById("app");
  const card = document.getElementById("flip-card");
  if (!wrap || wrap.hidden) return;

  if (reducedMotion || !watchCanvas || !watchCanvas._setCamera) {
    if (card) card.classList.remove("is-flipped");
    hideEmbed();
    if (shell) shell.classList.remove("app-open");
    return;
  }

  // Flip back first — camera is still at 'wide' so the front face lands
  // showing the whole watch. Then zoom back in to ambient and fade the
  // shell in near the tail of the flip.
  if (card) card.classList.remove("is-flipped");
  setTimeout(() => {
    if (shell) shell.classList.remove("app-open");
  }, Math.max(0, FLIP_MS - CLOSE_SHELL_LEAD));
  setTimeout(() => {
    if (watchCanvas && watchCanvas._setCamera) {
      watchCanvas._setCamera("ambient", CLOSE_ZOOM_MS);
    }
    hideEmbed();
  }, FLIP_MS);
}

function wireLauncherGrid() {
  const grid = document.getElementById("launcher-grid");
  if (!grid) return;
  grid.querySelectorAll("a.icon[data-app]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
      e.preventDefault();
      const appId = el.dataset.app;
      launchApp(appId);
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
        "#launcher-grid a.icon[data-app]",
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
    <iframe id="embed-frame" class="embed-frame" referrerpolicy="no-referrer" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
  `;
  const back = document.getElementById("flip-back") || document.body;
  back.appendChild(wrap);
  document.getElementById("embed-home").addEventListener("click", () => {
    if (location.hash) {
      history.pushState(null, "", location.pathname + location.search);
    }
    closeActiveApp();
  });
  return wrap;
}

function embedUrlFor(app) {
  if (app.auth !== "pat") return app.url;
  const pat = localStorage.getItem(TOKEN_KEY) || "";
  const u = new URL(app.url);
  u.searchParams.set("pat", pat);
  return u.toString();
}

function openEmbed(app) {
  const wrap = ensureEmbedShell();
  document.getElementById("embed-title").textContent = app.name;
  const frame = document.getElementById("embed-frame");
  const src = embedUrlFor(app);
  if (frame.src !== src) frame.src = src;
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
  const frame = document.getElementById("embed-frame");
  if (frame) frame.src = "about:blank";
}

/* Back/forward navigation: sync the flip state without pushing more
   history entries (launchApp/openEmbed already pushState themselves
   when invoked from a tile tap). */
function handleHash() {
  const card = document.getElementById("flip-card");
  const m = location.hash.match(/^#app\/(.+)$/);
  if (!m) {
    if (card && card.classList.contains("is-flipped")) closeActiveApp();
    return;
  }
  const app = APPS.find((a) => a.id === m[1] && a.url);
  if (!app) {
    if (card && card.classList.contains("is-flipped")) closeActiveApp();
    return;
  }
  if (card && !card.classList.contains("is-flipped")) {
    launchApp(app.id);
  }
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
    bootSequence();

    const lockBtn = document.getElementById("lock");
    if (lockBtn) {
      lockBtn.dataset.state = "unlocked";
      lockBtn.setAttribute("aria-label", "Sign out");
      lockBtn.title = "Sign out";
    }

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
  if (existing && (await verifyToken(existing, config.githubUser))) {
    finish();
    return;
  }
  if (existing) localStorage.removeItem(TOKEN_KEY);

  dialog.showModal();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    const token = input.value.trim();
    const ok = await verifyToken(token, config.githubUser);
    if (ok) {
      localStorage.setItem(TOKEN_KEY, token);
      finish();
    } else {
      error.hidden = false;
      input.value = "";
      input.focus();
    }
  });
}

function lockAndReload() {
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
}

document.getElementById("lock")?.addEventListener("click", lockAndReload);

function startWatchCanvas() {
  watchCanvas = document.querySelector(".watch-canvas");
  if (!watchCanvas || watchCanvas._setCamera) return;
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    openEmbed(hashApp);
    if (card) card.classList.add("is-flipped");
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
  // in to 'ambient' over BOOT_ZOOM_MS. The shell's fade-in is held
  // until BOOT_SHELL_DELAY so the greeting lands as the mechanism
  // settles behind it rather than floating over a tiny watch.
  watchCanvas._setCamera("ambient", BOOT_ZOOM_MS);
  setTimeout(() => {
    if (shell) shell.classList.remove("is-booting");
  }, BOOT_SHELL_DELAY);
}

wireGlobalShortcuts();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

(async () => {
  try {
    const [config, registry] = await Promise.all([
      loadJSON("./config.json"),
      loadJSON("./apps.json"),
    ]);
    await unlock(config, registry);
  } catch (err) {
    document.body.textContent = "Failed to load launcher.";
    console.error(err);
  }
})();
