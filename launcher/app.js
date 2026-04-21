const TOKEN_KEY = "co.gh.token";

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

function renderApps(apps) {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
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
    const initial = (app.name || "?").trim().charAt(0).toUpperCase();
    a.innerHTML = `
      <div class="tile-icon"></div>
      <h2 class="tile-name"></h2>
      <p class="tile-desc"></p>
    `;
    const icon = a.querySelector(".tile-icon");
    if (app.color) icon.style.background = app.color;
    icon.textContent = initial;
    a.querySelector(".tile-name").textContent = app.name;
    a.querySelector(".tile-desc").textContent = app.description || "";
    grid.appendChild(a);
  }
}

function showApp(title) {
  document.getElementById("app").hidden = false;
  document.getElementById("title").textContent = title;
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
    renderApps(registry.apps || []);
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

document.getElementById("lock").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
});

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
