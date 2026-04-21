import { initCityScene } from "./city-scene.js";

const TOKEN_KEY = "co.gh.token";
const LAYOUT_KEY = "co.layout";
let APPS = [];
let citySceneInitialized = false;

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
    const initial = (app.name || "?").trim().charAt(0).toUpperCase();
    a.innerHTML = `<div class="tile-icon"></div><h2 class="tile-name"></h2>`;
    const icon = a.querySelector(".tile-icon");
    const color = app.color || "#c96a47";
    const shade = app.shade || darkenHex(color);
    a.style.setProperty("--tile-color", color);
    a.style.setProperty("--tile-shade", shade);
    icon.textContent = initial;
    a.querySelector(".tile-name").textContent = app.name;
    grid.appendChild(a);
  }
}

function renderApps(apps) {
  const layout = getLayout();
  const header = document.getElementById("app-header");
  const grid = document.getElementById("grid");
  const body = document.body;
  if (layout === "grid") {
    if (header) header.hidden = false;
    if (grid) grid.hidden = false;
    body.classList.add("bg-optimus-bg", "text-optimus-text");
    renderTiles(apps);
    return;
  }
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
  const titleEl = document.getElementById("title");
  const accent = titleEl?.querySelector(".title-accent");
  if (accent) accent.textContent = title;
  else if (titleEl) titleEl.textContent = title;
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
