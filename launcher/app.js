import { initWeather } from "./weather.js";
import { mountLittleGuy } from "./little-guy.js";

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
const RECENTS_KEY = "co.recents";
const RECENTS_MAX = 3;
const PIP_MIN_SIZE = 72;
const PIP_MAX_SIZE = 320;
let APPS = [];
let weatherController = null;
let buddyController = null;
let clockTimer = null;

const APP_GLYPHS = {
  parlay: `<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.6a1.6 1.6 0 1 0 0 3.2V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.2a1.6 1.6 0 1 0 0-3.2V8z"/><path d="M10 9v6M14 9v6"/>`,
  "budget-together": `<circle cx="9.5" cy="12" r="4.5"/><circle cx="14.5" cy="12" r="4.5"/>`,
  "upcoming-movies": `<rect x="4" y="6" width="16" height="13" rx="1.8"/><path d="M4 10h16M4 15h16"/><path d="M8 6v4M8 15v4M16 6v4M16 15v4"/>`,
  cornerman: `<path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z"/><path d="M9.5 12.5l2 2 3.5-4"/>`,
  "polished-space": `<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2-5.2-1.8 5.2-1.8z"/><path d="M18.5 16.5l.55 1.45L20.5 18.5l-1.45.55L18.5 20.5l-.55-1.45L16.5 18.5l1.45-.55z"/>`,
  tbd: `<path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9z"/><path d="M4.5 8l7.5 5.5L19.5 8"/><path d="M17 3.5l.6 1.4L19 5.5l-1.4.6L17 7.5l-.6-1.4L15 5.5l1.4-.6z"/>`,
  "clean-script": `<path d="M7 4h8l4 4v11a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 19V5.5A1.5 1.5 0 0 1 7 4z"/><path d="M14.5 4v4.5H19"/><path d="M8.5 12.5h7M8.5 15.5h7M8.5 18h4"/>`,
};
const DEFAULT_GLYPH = `<circle cx="12" cy="12" r="7"/><path d="M12 8v4l2.5 2"/>`;

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
  return typeof user.login === "string" && user.login.toLowerCase() === expectedLogin.toLowerCase();
}

function darkenHex(hex, amount = 0.45) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#1E40AF";
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const GREETING_BANDS = [
  { until: 5, variants: ["Working late", "Still up", "Burning the oil"] },
  { until: 11, variants: ["Morning", "Good morning", "Rise and shine"] },
  { until: 17, variants: ["Afternoon", "Good afternoon"] },
  { until: 22, variants: ["Evening", "Good evening"] },
  { until: 24, variants: ["Working late", "Night owl"] },
];

function pickVariant(variants, seed) {
  if (!variants.length) return "";
  return variants[seed % variants.length];
}

function greetingFor(date, firstName, { sparse = false } = {}) {
  if (sparse) {
    const name = firstName ? `, ${firstName}` : "";
    return `Getting set up${name}`;
  }
  const h = date.getHours();
  const band = GREETING_BANDS.find((b) => h < b.until) || GREETING_BANDS[0];
  const seed = date.getDate() + (date.getMonth() * 31);
  const prefix = pickVariant(band.variants, seed);
  const name = firstName ? `, ${firstName}` : "";
  return `${prefix}${name}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function updateHero(config) {
  const now = new Date();
  const first = (config.firstName || config.githubUser || "").split(/[\s.]/)[0];
  const pretty = first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
  const shell = document.getElementById("app");
  const sparse = shell?.dataset.density === "sparse";
  const g = document.getElementById("greeting-text");
  const d = document.getElementById("hero-date");
  if (g) g.textContent = greetingFor(now, pretty, { sparse });
  if (d) d.textContent = formatDate(now);
}

function startClock(config) {
  updateHero(config);
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(() => updateHero(config), 30_000);
}

function loadRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch (_) {
    return [];
  }
}

function recordRecent(appId) {
  if (!appId) return;
  const existing = loadRecents().filter((id) => id !== appId);
  const next = [appId, ...existing].slice(0, RECENTS_MAX);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch (_) {}
  renderRecents(APPS);
}

function launchApp(app) {
  if (!app) return;
  recordRecent(app.id);
  if (app.openInNew) {
    window.open(app.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (app.url) openEmbed(app);
}

function buildTile(app, idx, { showShortcut = true } = {}) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = app.url || app.path;
  a.dataset.appId = app.id;
  if (app.openInNew) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    haptic(8);
    recordRecent(app.id);
    if (!app.openInNew && app.url) {
      e.preventDefault();
      openEmbed(app);
    }
  });
  const color = app.color || "#c96a47";
  const shade = app.shade || darkenHex(color);
  a.style.setProperty("--tile-color", color);
  a.style.setProperty("--tile-shade", shade);
  const glyph = APP_GLYPHS[app.id] || DEFAULT_GLYPH;
  const shortcut =
    showShortcut && idx < 9
      ? `<span class="tile-shortcut" aria-hidden="true">${idx + 1}</span>`
      : "";
  a.innerHTML = `
    <div class="tile-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>
      ${shortcut}
    </div>
    <h2 class="tile-name"></h2>
  `;
  a.querySelector(".tile-name").textContent = app.name;
  return a;
}

function renderTiles(apps) {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  grid.hidden = false;
  grid.innerHTML = "";
  if (!apps.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  apps.forEach((app, idx) => {
    grid.appendChild(buildTile(app, idx));
  });
}

function renderRecents(apps) {
  const section = document.getElementById("recents-section");
  const grid = document.getElementById("recents-grid");
  if (!section || !grid) return;
  const ids = loadRecents();
  const recent = ids
    .map((id) => apps.find((a) => a.id === id))
    .filter(Boolean)
    .slice(0, RECENTS_MAX);
  if (!recent.length) {
    section.hidden = true;
    grid.innerHTML = "";
    return;
  }
  section.hidden = false;
  grid.innerHTML = "";
  recent.forEach((app, idx) => {
    grid.appendChild(buildTile(app, idx, { showShortcut: false }));
  });
}

function populateStatus(apps) {
  const count = apps.length;
  const heroCount = document.getElementById("hero-app-count");
  if (heroCount) heroCount.textContent = String(count);
  const shell = document.getElementById("app");
  if (shell) {
    const density = count <= 3 ? "sparse" : count >= 9 ? "dense" : "normal";
    shell.dataset.density = density;
  }
  wireAppsSearch(apps);
}

function wireAppsSearch(apps) {
  const input = document.getElementById("apps-search");
  if (!input) return;
  const dense = apps.length >= 9;
  input.hidden = !dense;
  if (!dense) {
    input.value = "";
    filterGrid("");
    return;
  }
  if (input.dataset.wired === "1") return;
  input.dataset.wired = "1";
  input.addEventListener("input", () => filterGrid(input.value));
}

function filterGrid(query) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  const q = query.trim().toLowerCase();
  grid.querySelectorAll(".tile").forEach((el) => {
    const name = el.querySelector(".tile-name")?.textContent?.toLowerCase() || "";
    el.hidden = q.length > 0 && !name.includes(q);
  });
}

function renderApps(apps, config) {
  document.getElementById("app").hidden = false;
  document.getElementById("app-header").hidden = false;
  document.getElementById("hero").hidden = false;
  document.getElementById("apps-section").hidden = false;
  document.getElementById("status-bar").hidden = false;
  document.body.classList.add("bg-optimus-bg", "text-optimus-text");
  renderTiles(apps);
  renderRecents(apps);
  populateStatus(apps);
  startClock(config || {});
  loadBuildInfo();
}

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
    hideEmbed();
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
  document.getElementById("app").hidden = true;
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
  document.getElementById("app").hidden = false;
}

function handleHash() {
  const m = location.hash.match(/^#app\/(.+)$/);
  if (!m) {
    hideEmbed();
    return;
  }
  const app = APPS.find((a) => a.id === m[1] && a.url);
  if (app) openEmbed(app);
  else hideEmbed();
}

window.addEventListener("popstate", handleHash);

function showApp(title) {
  document.getElementById("app").hidden = false;
  document.title = title;
}

function wireGlobalShortcuts() {
  window.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    const typing =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable);
    if (!typing && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const idx = parseInt(e.key, 10) - 1;
      const app = APPS[idx];
      if (app) {
        e.preventDefault();
        launchApp(app);
      }
    }
  });
}

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
    showApp(config.title);
    APPS = registry.apps || [];
    renderApps(APPS, config);
    handleHash();
    setupPip();
    const lockBtn = document.getElementById("lock");
    if (lockBtn) {
      lockBtn.dataset.state = "unlocked";
      lockBtn.setAttribute("aria-label", "Sign out");
      lockBtn.title = "Sign out";
    }

    const weatherEl = document.getElementById("hero-weather");
    const weatherSep = document.querySelector(".eyebrow-sep-weather");
    if (weatherEl) {
      if (weatherController) weatherController.destroy();
      weatherController = initWeather({
        mountEl: weatherEl,
        onUpdate: () => {
          if (weatherSep) weatherSep.hidden = false;
          setStatus("nominal", "All systems nominal");
        },
        onError: () => {
          setStatus("degraded", "Weather offline");
        },
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

function formatUpdatedAgo(date, now = new Date()) {
  const diffMs = now - date;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

async function loadBuildInfo() {
  const wrap = document.getElementById("status-updated");
  const timeEl = document.getElementById("status-updated-time");
  if (!wrap || !timeEl) return;
  try {
    const res = await fetch("./build-info.json", { cache: "no-cache" });
    if (!res.ok) return;
    const info = await res.json();
    const iso = info?.commitDate;
    if (!iso) return;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    timeEl.dateTime = date.toISOString();
    timeEl.title = date.toLocaleString();
    timeEl.textContent = formatUpdatedAgo(date);
    wrap.hidden = false;
  } catch (_) {}
}

function setStatus(state, label) {
  const indicator = document.getElementById("status-indicator");
  const text = document.getElementById("status-label");
  if (indicator) indicator.dataset.status = state;
  if (text && label) text.textContent = label;
}

function wireBuildReveal() {
  const indicator = document.querySelector(".status-indicator");
  const build = document.getElementById("status-build");
  if (!indicator || !build) return;
  let timer = null;
  const reveal = () => {
    build.hidden = !build.hidden;
  };
  const start = (e) => {
    if (e.type === "pointerdown" && e.button !== undefined && e.button !== 0) return;
    clearTimeout(timer);
    timer = setTimeout(reveal, 700);
  };
  const cancel = () => clearTimeout(timer);
  indicator.addEventListener("pointerdown", start);
  indicator.addEventListener("pointerup", cancel);
  indicator.addEventListener("pointerleave", cancel);
  indicator.addEventListener("pointercancel", cancel);
}
wireBuildReveal();

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
