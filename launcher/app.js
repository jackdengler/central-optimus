import { initWeather } from "./weather.js";
import { mountLittleGuy } from "./little-guy.js";
import { startMovement } from "./mechanism.js";

function haptic(pattern) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch (_) {}
}

const TOKEN_KEY = "co.gh.token";
const PIP_POS_KEY = "co.pip.pos";
const PIP_SIZE_KEY = "co.pip.size";
const PIP_ONBOARDED_KEY = "co.mascot.onboarded";
const PIP_MIN_SIZE = 72;
const PIP_MAX_SIZE = 320;

// Launch animation timing, taken from the prototype. The zoom runs 1100ms
// to the fourth wheel; the embed starts fading in at 720ms so the app
// reveals from within the hub before the camera actually lands. A tiny
// buffer on top of 1100ms gives the camera a moment to settle.
const LAUNCH_ZOOM_MS = 1100;
const LAUNCH_OVERLAY_DELAY_MS = 720;
const LAUNCH_BUFFER_MS = 50;

// Close animation timing. The overlay fades out first, then the camera
// pulls back — otherwise the app and the mechanism both dissolve at the
// same moment and the transition reads as a hard cut.
const CLOSE_OVERLAY_FADE_MS = 180;

let APPS = [];
let weatherController = null;
let buddyController = null;
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
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
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

function setPublishStamp() {
  const el = document.getElementById("publish-time");
  if (!el) return;
  const now = new Date();
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
  el.textContent = `published ${ptDateFmt.format(now)} · ${ptFmt.format(now)} PT`;
}

/* ---------- App launch orchestration ----------
   Each tile in the grid has data-app="<app-id>". On tap we trigger the
   camera zoom toward the fourth wheel, then at 720ms begin opening the
   embed (so the app reveals from within the spinning hub), and at
   ~1150ms the camera lands. Close reverses: overlay fades out first,
   then the camera pulls back for 800ms. */

function launchApp(appId) {
  const app = APPS.find((a) => a.id === appId);
  if (!app) {
    // Placeholder — app doesn't exist in registry. Still play the zoom
    // so the icon feels alive, but bail out before navigating.
    if (watchCanvas && !reducedMotion && watchCanvas._launch) {
      watchCanvas._launch("fourthWheel");
      setTimeout(() => watchCanvas._close && watchCanvas._close(), 900);
    }
    haptic(8);
    return;
  }
  haptic(8);

  if (reducedMotion || !watchCanvas || !watchCanvas._launch) {
    openEmbed(app);
    return;
  }

  watchCanvas._launch("fourthWheel");
  // Begin the crossfade on the shell so greeting/grid fade out during
  // the dive, giving "pulled into the mechanism" rather than "cut to app."
  const shell = document.getElementById("app");
  if (shell) shell.classList.add("app-open");

  setTimeout(() => openEmbed(app), LAUNCH_OVERLAY_DELAY_MS);
  // (The iframe's own CSS opacity transition handles the final fade-in.)
  void LAUNCH_ZOOM_MS;
  void LAUNCH_BUFFER_MS;
}

function closeActiveApp() {
  const wrap = document.getElementById("embed");
  const shell = document.getElementById("app");
  if (!wrap || wrap.hidden) return;

  wrap.classList.remove("embed-open");

  if (reducedMotion || !watchCanvas || !watchCanvas._close) {
    hideEmbed();
    if (shell) shell.classList.remove("app-open");
    return;
  }

  setTimeout(() => {
    hideEmbed();
    watchCanvas._close();
    if (shell) shell.classList.remove("app-open");
  }, CLOSE_OVERLAY_FADE_MS);
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
  wrap.className =
    "fixed inset-0 z-50 flex flex-col bg-optimus-bg text-optimus-text";
  wrap.innerHTML = `
    <div id="embed-bar" class="flex items-center gap-2 px-3 py-2 border-b border-optimus-border bg-optimus-surface" style="padding-top: max(env(safe-area-inset-top), 0.5rem);">
      <button id="embed-home" type="button" aria-label="Home" class="inline-flex items-center gap-1.5 rounded-full border border-optimus-border px-3 py-1.5 text-sm font-medium text-optimus-muted hover:text-optimus-text hover:border-optimus-accent">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.5 11.5L12 4l8.5 7.5"/>
          <path d="M5.5 10.5V19a1.5 1.5 0 0 0 1.5 1.5h3.5V15h3v5.5H17a1.5 1.5 0 0 0 1.5-1.5v-8.5"/>
        </svg>
        <span>Home</span>
      </button>
      <div id="embed-title" class="flex-1 truncate text-sm font-medium"></div>
    </div>
    <iframe id="embed-frame" class="flex-1 w-full border-0" referrerpolicy="no-referrer" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
  `;
  document.body.appendChild(wrap);
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
  // Force reflow so the transition from opacity:0 → 1 plays.
  void wrap.offsetWidth;
  wrap.classList.add("embed-open");
  const hash = `#app/${app.id}`;
  if (location.hash !== hash) {
    history.pushState({ embed: app.id }, "", hash);
  }
}

function hideEmbed() {
  const wrap = document.getElementById("embed");
  if (!wrap) return;
  wrap.hidden = true;
  wrap.classList.remove("embed-open");
  const frame = document.getElementById("embed-frame");
  if (frame) frame.src = "about:blank";
}

function handleHash() {
  const m = location.hash.match(/^#app\/(.+)$/);
  if (!m) {
    closeActiveApp();
    return;
  }
  const app = APPS.find((a) => a.id === m[1] && a.url);
  if (app) openEmbed(app);
  else closeActiveApp();
}

window.addEventListener("popstate", handleHash);

/* ---------- Pip (FaceTime-style mascot overlay) ---------- */

function clampPipPos(x, y, el) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const margin = 12;
  const maxX = window.innerWidth - w - margin;
  const maxY = window.innerHeight - h - margin;
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(margin, y)),
  };
}

function applyPipPos(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}

function applyPipSize(el, size) {
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
}

function loadPipPos() {
  try {
    const raw = localStorage.getItem(PIP_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === "number" && typeof p?.y === "number") return p;
  } catch (_) {}
  return null;
}

function loadPipSize() {
  try {
    const raw = localStorage.getItem(PIP_SIZE_KEY);
    if (!raw) return null;
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= PIP_MIN_SIZE && n <= PIP_MAX_SIZE) return n;
  } catch (_) {}
  return null;
}

function showPipHintOnce() {
  const pip = document.getElementById("pip");
  const hint = document.getElementById("pip-hint");
  if (!pip || !hint) return;
  try {
    if (localStorage.getItem(PIP_ONBOARDED_KEY) === "1") return;
  } catch (_) {}
  hint.hidden = false;
  requestAnimationFrame(() => {
    hint.classList.add("pip-hint-show");
  });
  const dismiss = () => {
    hint.classList.remove("pip-hint-show");
    setTimeout(() => {
      hint.hidden = true;
    }, 260);
    try {
      localStorage.setItem(PIP_ONBOARDED_KEY, "1");
    } catch (_) {}
    pip.removeEventListener("pointerdown", dismiss);
  };
  setTimeout(dismiss, 4200);
  pip.addEventListener("pointerdown", dismiss, { once: true });
}

function flashPipActive() {
  const pip = document.getElementById("pip");
  if (!pip) return;
  haptic(12);
  pip.classList.add("pip-active");
  setTimeout(() => pip.classList.remove("pip-active"), 320);
}

function setupPip() {
  const pip = document.getElementById("pip");
  const stage = document.getElementById("pip-stage");
  if (!pip || !stage) return;
  pip.hidden = false;

  if (buddyController) buddyController.destroy();
  buddyController = mountLittleGuy(stage);

  setTimeout(showPipHintOnce, 900);

  const storedSize = loadPipSize();
  if (storedSize) applyPipSize(pip, storedSize);

  const placeDefault = () => {
    const margin = 16;
    const x = window.innerWidth - pip.offsetWidth - margin;
    const y = window.innerHeight - pip.offsetHeight - margin;
    applyPipPos(pip, x, y);
  };

  const stored = loadPipPos();
  if (stored) {
    const { x, y } = clampPipPos(stored.x, stored.y, pip);
    applyPipPos(pip, x, y);
  } else {
    placeDefault();
  }

  window.addEventListener("resize", () => {
    const r = pip.getBoundingClientRect();
    const { x, y } = clampPipPos(r.left, r.top, pip);
    applyPipPos(pip, x, y);
  });

  const pointers = new Map();
  let gesture = null;

  const savePos = () => {
    const r = pip.getBoundingClientRect();
    try {
      localStorage.setItem(
        PIP_POS_KEY,
        JSON.stringify({ x: r.left, y: r.top }),
      );
    } catch (_) {}
  };
  const saveSize = () => {
    try {
      localStorage.setItem(PIP_SIZE_KEY, String(pip.offsetWidth));
    } catch (_) {}
  };

  const startPinch = () => {
    const pts = [...pointers.values()];
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const r = pip.getBoundingClientRect();
    gesture = {
      type: "pinch",
      initialDist: Math.max(1, dist),
      initialSize: r.width,
      centerX: r.left + r.width / 2,
      centerY: r.top + r.height / 2,
      changed: false,
    };
    pip.classList.add("pip-dragging");
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      pip.setPointerCapture(e.pointerId);
    } catch (_) {}
    if (pointers.size === 1) {
      const r = pip.getBoundingClientRect();
      gesture = {
        type: "drag",
        startX: e.clientX,
        startY: e.clientY,
        offX: e.clientX - r.left,
        offY: e.clientY - r.top,
        moved: false,
      };
    } else if (pointers.size === 2) {
      startPinch();
    }
  };

  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;

    if (gesture.type === "drag") {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(dx, dy) > 5) {
        gesture.moved = true;
        pip.classList.add("pip-dragging");
      }
      if (gesture.moved) {
        const { x, y } = clampPipPos(
          e.clientX - gesture.offX,
          e.clientY - gesture.offY,
          pip,
        );
        applyPipPos(pip, x, y);
      }
    } else if (gesture.type === "pinch") {
      const pts = [...pointers.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const raw = gesture.initialSize * (dist / gesture.initialDist);
      const size = Math.max(PIP_MIN_SIZE, Math.min(PIP_MAX_SIZE, raw));
      applyPipSize(pip, size);
      const left = gesture.centerX - size / 2;
      const top = gesture.centerY - size / 2;
      const clamped = clampPipPos(left, top, pip);
      applyPipPos(pip, clamped.x, clamped.y);
      gesture.changed = true;
    }
  };

  const onUp = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try {
      pip.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (!gesture) return;

    if (gesture.type === "pinch") {
      if (gesture.changed) {
        saveSize();
        savePos();
      }
      gesture = { type: "ended" };
    }

    if (pointers.size === 0) {
      if (gesture?.type === "drag") {
        if (gesture.moved) {
          savePos();
          haptic([4, 20, 4]);
        } else {
          flashPipActive();
        }
      }
      pip.classList.remove("pip-dragging");
      gesture = null;
    }
  };

  pip.addEventListener("pointerdown", onDown);
  pip.addEventListener("pointermove", onMove);
  pip.addEventListener("pointerup", onUp);
  pip.addEventListener("pointercancel", onUp);
}

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
    handleHash();
    setupPip();
    startWatchCanvas();

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
  if (!watchCanvas || watchCanvas._launch) return;
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    startMovement(watchCanvas);
  } catch (err) {
    console.warn("mechanism failed to start:", err);
  }
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
