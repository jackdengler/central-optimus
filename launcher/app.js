import { initCityScene } from "./city-scene.js";

const TOKEN_KEY = "co.gh.token";
const LAYOUT_KEY = "co.layout";
let APPS = [];
let citySceneInitialized = false;

const APP_GLYPHS = {
  parlay: `<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.6a1.6 1.6 0 1 0 0 3.2V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.2a1.6 1.6 0 1 0 0-3.2V8z"/><path d="M10 9v6M14 9v6"/>`,
  "budget-together": `<circle cx="9.5" cy="12" r="4.5"/><circle cx="14.5" cy="12" r="4.5"/>`,
  "upcoming-movies": `<rect x="4" y="6" width="16" height="13" rx="1.8"/><path d="M4 10h16M4 15h16"/><path d="M8 6v4M8 15v4M16 6v4M16 15v4"/>`,
  cornerman: `<path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z"/><path d="M9.5 12.5l2 2 3.5-4"/>`,
  "polished-space": `<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2-5.2-1.8 5.2-1.8z"/><path d="M18.5 16.5l.55 1.45L20.5 18.5l-1.45.55L18.5 20.5l-.55-1.45L16.5 18.5l1.45-.55z"/>`,
  tbd: `<path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9z"/><path d="M4.5 8l7.5 5.5L19.5 8"/><path d="M17 3.5l.6 1.4L19 5.5l-1.4.6L17 7.5l-.6-1.4L15 5.5l1.4-.6z"/>`,
};
const DEFAULT_GLYPH = `<circle cx="12" cy="12" r="7"/><path d="M12 8v4l2.5 2"/>`;

function getLayout() {
  const v = localStorage.getItem(LAYOUT_KEY);
  return v === "grid" ? "grid" : "balloons";
}
function setLayout(v) {
  localStorage.setItem(LAYOUT_KEY, v === "grid" ? "grid" : "balloons");
}

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

function launchApp(app) {
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
  for (const app of apps) {
    const a = document.createElement("a");
    a.className = "tile";
    a.href = app.url || app.path;
    if (app.openInNew) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else if (app.url) {
      a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
        e.preventDefault();
        openEmbed(app);
      });
    }
    const color = app.color || "#c96a47";
    const shade = app.shade || darkenHex(color);
    a.style.setProperty("--tile-color", color);
    a.style.setProperty("--tile-shade", shade);
    const glyph = APP_GLYPHS[app.id] || DEFAULT_GLYPH;
    a.innerHTML = `
      <div class="tile-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>
      </div>
      <svg class="tile-chevron" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 17L17 7M9 7h8v8"/>
      </svg>
      <div class="tile-meta">
        <h2 class="tile-name"></h2>
        <p class="tile-subtitle"></p>
      </div>
    `;
    a.querySelector(".tile-name").textContent = app.name;
    a.querySelector(".tile-subtitle").textContent = app.subtitle || "";
    grid.appendChild(a);
  }
}

function renderApps(apps) {
  const layout = getLayout();
  const main = document.getElementById("app");
  const header = document.getElementById("app-header");
  const grid = document.getElementById("grid");
  const body = document.body;
  if (layout === "grid") {
    if (main) main.hidden = false;
    if (header) header.hidden = false;
    if (grid) grid.hidden = false;
    body.classList.add("bg-optimus-bg", "text-optimus-text");
    renderTiles(apps);
    return;
  }
  if (main) main.hidden = true;
  if (header) header.hidden = true;
  if (grid) grid.hidden = true;
  if (citySceneInitialized) return;
  const container = document.getElementById("city-root");
  if (!container || !apps.length) return;
  initCityScene({
    container,
    apps: apps.map((a) => ({
      name: a.name,
      url: a.url,
      iconUrl: a.iconUrl,
      color: a.color || "#3B82F6",
      shade: a.shade || darkenHex(a.color || "#3B82F6"),
      _app: a,
    })),
    onLaunch: (balloonApp) => launchApp(balloonApp._app || balloonApp),
    onSettings: openSettings,
  });
  citySceneInitialized = true;
}

function openSettings() {
  const dialog = document.getElementById("settings");
  if (!dialog) return;
  const current = getLayout();
  dialog
    .querySelectorAll('input[name="layout"]')
    .forEach((input) => {
      input.checked = input.value === current;
      input.onchange = () => {
        if (!input.checked) return;
        const next = input.value;
        if (next === current) return;
        setLayout(next);
        dialog.close();
        location.reload();
      };
    });
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
      <button id="embed-back" type="button" class="rounded-full border border-optimus-border px-3 py-1.5 text-sm text-optimus-muted hover:text-optimus-text hover:border-optimus-accent">← Back</button>
      <div id="embed-title" class="flex-1 truncate text-sm font-medium"></div>
    </div>
    <iframe id="embed-frame" class="flex-1 w-full border-0" referrerpolicy="no-referrer" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
  `;
  document.body.appendChild(wrap);
  document.getElementById("embed-back").addEventListener("click", () => {
    if (location.hash.startsWith("#app/")) history.back();
    else hideEmbed();
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
    renderApps(APPS);
    handleHash();
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
document.getElementById("lock").addEventListener("click", lockAndReload);
document.getElementById("settings-lock").addEventListener("click", lockAndReload);
document.getElementById("header-settings").addEventListener("click", openSettings);

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
