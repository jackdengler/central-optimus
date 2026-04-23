import { initWeather } from "./weather.js";

const TOKEN_KEY = "co.gh.token";
let APPS = [];
let weatherController = null;
let paletteIndex = 0;
let paletteResults = [];
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

function greetingFor(date, firstName) {
  const h = date.getHours();
  let prefix;
  if (h < 5) prefix = "Working late";
  else if (h < 12) prefix = "Good morning";
  else if (h < 17) prefix = "Good afternoon";
  else if (h < 22) prefix = "Good evening";
  else prefix = "Good night";
  const name = firstName ? `, ${firstName}` : "";
  return `${prefix}${name}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}
function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function updateHero(config) {
  const now = new Date();
  const first = (config.firstName || config.githubUser || "").split(/[\s.]/)[0];
  const pretty = first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
  const g = document.getElementById("greeting-text");
  const d = document.getElementById("hero-date");
  const t = document.getElementById("hero-time");
  if (g) g.textContent = greetingFor(now, pretty);
  if (d) d.textContent = formatDate(now);
  if (t) t.textContent = formatTime(now);
}

function startClock(config) {
  updateHero(config);
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(() => updateHero(config), 30_000);
}

function launchApp(app) {
  if (!app) return;
  if (app.openInNew) {
    window.open(app.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (app.url) openEmbed(app);
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
    const shortcut = idx < 9 ? `<span class="tile-shortcut" aria-hidden="true">${idx + 1}</span>` : "";
    a.innerHTML = `
      ${shortcut}
      <div class="tile-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>
      </div>
      <div class="tile-meta">
        <h2 class="tile-name"></h2>
        <p class="tile-subtitle"></p>
      </div>
    `;
    a.querySelector(".tile-name").textContent = app.name;
    a.querySelector(".tile-subtitle").textContent = app.subtitle || "";
    grid.appendChild(a);
  });
}

function populateStatus(apps) {
  const count = apps.length;
  const heroCount = document.getElementById("hero-app-count");
  if (heroCount) heroCount.textContent = String(count);
  const statusCount = document.getElementById("status-count");
  if (statusCount) statusCount.textContent = `${count} ${count === 1 ? "app" : "apps"}`;
}

function renderApps(apps, config) {
  document.getElementById("app").hidden = false;
  document.getElementById("app-header").hidden = false;
  document.getElementById("hero").hidden = false;
  document.getElementById("apps-section").hidden = false;
  document.getElementById("status-bar").hidden = false;
  document.body.classList.add("bg-optimus-bg", "text-optimus-text");
  renderTiles(apps);
  populateStatus(apps);
  startClock(config || {});
}

function openSettings() {
  const dialog = document.getElementById("settings");
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
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

/* ---------- Command palette ---------- */

function paletteOpen() {
  const dialog = document.getElementById("palette");
  const input = document.getElementById("palette-input");
  if (!dialog || dialog.open) return;
  input.value = "";
  renderPalette("");
  dialog.showModal();
  requestAnimationFrame(() => input.focus());
}

function paletteClose() {
  const dialog = document.getElementById("palette");
  if (dialog && dialog.open) dialog.close();
}

function matchScore(app, q) {
  if (!q) return 1;
  const needle = q.toLowerCase();
  const hay = `${app.name} ${app.subtitle || ""} ${app.blurb || ""} ${app.id}`.toLowerCase();
  if (hay.includes(needle)) {
    if (app.name.toLowerCase().startsWith(needle)) return 3;
    if (app.name.toLowerCase().includes(needle)) return 2;
    return 1;
  }
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return 0.5;
  }
  return 0;
}

function renderPalette(query) {
  const list = document.getElementById("palette-results");
  if (!list) return;
  const scored = APPS
    .map((app, idx) => ({ app, idx, score: matchScore(app, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx);
  paletteResults = scored.map((x) => x.app);
  paletteIndex = 0;
  list.innerHTML = "";
  if (!paletteResults.length) {
    const li = document.createElement("li");
    li.className = "palette-empty";
    li.textContent = query ? `No matches for "${query}"` : "No apps registered.";
    list.appendChild(li);
    return;
  }
  paletteResults.forEach((app, i) => {
    const li = document.createElement("li");
    li.className = "palette-item";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", i === 0 ? "true" : "false");
    const color = app.color || "#c96a47";
    const shade = app.shade || darkenHex(color);
    li.style.setProperty("--tile-color", color);
    li.style.setProperty("--tile-shade", shade);
    const glyph = APP_GLYPHS[app.id] || DEFAULT_GLYPH;
    li.innerHTML = `
      <div class="palette-item-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">${glyph}</svg>
      </div>
      <div class="palette-item-body">
        <div class="palette-item-name"></div>
        <div class="palette-item-subtitle"></div>
      </div>
      <kbd class="palette-item-hint">↵</kbd>
    `;
    li.querySelector(".palette-item-name").textContent = app.name;
    li.querySelector(".palette-item-subtitle").textContent =
      app.blurb || app.subtitle || "";
    li.addEventListener("mousemove", () => setPaletteIndex(i));
    li.addEventListener("click", (e) => {
      e.preventDefault();
      paletteLaunch(i);
    });
    list.appendChild(li);
  });
}

function setPaletteIndex(i) {
  if (i < 0 || i >= paletteResults.length) return;
  paletteIndex = i;
  const list = document.getElementById("palette-results");
  if (!list) return;
  [...list.children].forEach((child, idx) => {
    if (child.classList.contains("palette-item")) {
      child.setAttribute("aria-selected", idx === i ? "true" : "false");
      if (idx === i) child.scrollIntoView({ block: "nearest" });
    }
  });
}

function paletteLaunch(i = paletteIndex) {
  const app = paletteResults[i];
  if (!app) return;
  paletteClose();
  launchApp(app);
}

function wirePalette() {
  const dialog = document.getElementById("palette");
  const input = document.getElementById("palette-input");
  const form = document.getElementById("palette-form");
  const openBtn = document.getElementById("palette-open");
  if (!dialog || !input || !form) return;

  openBtn?.addEventListener("click", paletteOpen);
  input.addEventListener("input", () => renderPalette(input.value.trim()));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    paletteLaunch();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) paletteClose();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPaletteIndex(Math.min(paletteIndex + 1, paletteResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPaletteIndex(Math.max(paletteIndex - 1, 0));
    } else if (e.key === "Escape") {
      paletteClose();
    }
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
    const paletteDialog = document.getElementById("palette");
    const paletteOpenNow = paletteDialog && paletteDialog.open;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (paletteOpenNow) paletteClose();
      else paletteOpen();
      return;
    }

    if (e.key === "/" && !typing && !paletteOpenNow) {
      e.preventDefault();
      paletteOpen();
      return;
    }

    if (!typing && !paletteOpenNow && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const idx = parseInt(e.key, 10) - 1;
      const app = APPS[idx];
      if (app) {
        e.preventDefault();
        launchApp(app);
      }
    }
  });
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

    const weatherEl = document.getElementById("hero-weather");
    const weatherSep = document.querySelector(".eyebrow-sep-weather");
    if (weatherEl) {
      if (weatherController) weatherController.destroy();
      weatherController = initWeather({
        mountEl: weatherEl,
        onUpdate: () => {
          if (weatherSep) weatherSep.hidden = false;
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
document.getElementById("settings-lock")?.addEventListener("click", lockAndReload);
document.getElementById("header-settings")?.addEventListener("click", openSettings);

wirePalette();
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
