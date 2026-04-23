// weather.js
// Lightweight weather chip for the launcher hero. Uses Open-Meteo
// (no API key) and the browser's geolocation API. Caches the reading
// for 15 minutes in localStorage. Calls onUpdate(payload) whenever a
// fresh reading lands so callers (e.g. buddy) can react.

const COORDS_KEY = "co.weather.coords";
const CACHE_KEY = "co.weather.cache";
const CACHE_TTL_MS = 15 * 60 * 1000;
const REFRESH_MS = 15 * 60 * 1000;
const STYLE_ID = "co-weather-styles";

const CODE_META = {
  0: { label: "Clear", icon: "sun", kind: "clear" },
  1: { label: "Mostly clear", icon: "sun", kind: "clear" },
  2: { label: "Partly cloudy", icon: "cloud-sun", kind: "cloudy" },
  3: { label: "Overcast", icon: "cloud", kind: "cloudy" },
  45: { label: "Foggy", icon: "fog", kind: "fog" },
  48: { label: "Foggy", icon: "fog", kind: "fog" },
  51: { label: "Drizzle", icon: "rain", kind: "rain" },
  53: { label: "Drizzle", icon: "rain", kind: "rain" },
  55: { label: "Drizzle", icon: "rain", kind: "rain" },
  56: { label: "Freezing drizzle", icon: "rain", kind: "rain" },
  57: { label: "Freezing drizzle", icon: "rain", kind: "rain" },
  61: { label: "Rain", icon: "rain", kind: "rain" },
  63: { label: "Rain", icon: "rain", kind: "rain" },
  65: { label: "Heavy rain", icon: "rain", kind: "rain" },
  66: { label: "Freezing rain", icon: "rain", kind: "rain" },
  67: { label: "Freezing rain", icon: "rain", kind: "rain" },
  71: { label: "Snow", icon: "snow", kind: "snow" },
  73: { label: "Snow", icon: "snow", kind: "snow" },
  75: { label: "Heavy snow", icon: "snow", kind: "snow" },
  77: { label: "Snow grains", icon: "snow", kind: "snow" },
  80: { label: "Rain showers", icon: "rain", kind: "rain" },
  81: { label: "Rain showers", icon: "rain", kind: "rain" },
  82: { label: "Heavy showers", icon: "rain", kind: "rain" },
  85: { label: "Snow showers", icon: "snow", kind: "snow" },
  86: { label: "Snow showers", icon: "snow", kind: "snow" },
  95: { label: "Thunderstorm", icon: "storm", kind: "storm" },
  96: { label: "Thunderstorm", icon: "storm", kind: "storm" },
  99: { label: "Thunderstorm", icon: "storm", kind: "storm" },
};

const ICONS = {
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>`,
  "cloud-sun": `<circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1"/><path d="M17 19H9a4 4 0 1 1 .9-7.9A5 5 0 0 1 19 13a4 4 0 0 1-2 6z"/>`,
  cloud: `<path d="M17 19H8a4.5 4.5 0 0 1-.8-8.93A5.5 5.5 0 0 1 18 11a4 4 0 0 1-1 8z"/>`,
  fog: `<path d="M17 11H8a4.5 4.5 0 0 1-.8-8.93A5.5 5.5 0 0 1 18 4a4 4 0 0 1-1 7z" transform="translate(0 1)"/><path d="M4 16h16M6 19h12M8 22h8"/>`,
  rain: `<path d="M17 13H8a4.5 4.5 0 0 1-.8-8.93A5.5 5.5 0 0 1 18 6a4 4 0 0 1-1 7z"/><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>`,
  snow: `<path d="M17 13H8a4.5 4.5 0 0 1-.8-8.93A5.5 5.5 0 0 1 18 6a4 4 0 0 1-1 7z"/><path d="M10 19l0 2M10 19l-1.5 1M10 19l1.5 1M14 19l0 2M14 19l-1.5 1M14 19l1.5 1"/>`,
  storm: `<path d="M17 13H8a4.5 4.5 0 0 1-.8-8.93A5.5 5.5 0 0 1 18 6a4 4 0 0 1-1 7z"/><path d="M12 16l-2 4h3l-1 3"/>`,
};

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .co-weather {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      letter-spacing: 0.2em;
    }
    .co-weather-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }
    .co-weather-icon svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .co-weather-text {
      font-variant-numeric: tabular-nums;
    }
  `;
  document.head.appendChild(s);
}

function loadCoords() {
  try {
    const raw = localStorage.getItem(COORDS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.lat === "number" && typeof v?.lon === "number") return v;
  } catch {}
  return null;
}
function saveCoords(lat, lon) {
  localStorage.setItem(COORDS_KEY, JSON.stringify({ lat, lon }));
}
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.ts !== "number") return null;
    if (Date.now() - v.ts > CACHE_TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}
function saveCache(payload) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ ts: Date.now(), ...payload }),
  );
}

function requestCoords() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 60 * 60 * 1000, timeout: 10_000 },
    );
  });
}

async function fetchWeather(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const data = await res.json();
  const temp = Math.round(data?.current?.temperature_2m);
  const code = data?.current?.weather_code;
  const meta = CODE_META[code] || { label: "—", icon: "cloud", kind: "cloudy" };
  let kind = meta.kind;
  if (kind === "clear" && Number.isFinite(temp)) {
    if (temp >= 85) kind = "hot";
    else if (temp <= 32) kind = "cold";
  }
  return { temp, code, label: meta.label, icon: meta.icon, kind };
}

function renderChip(mountEl, payload) {
  if (!mountEl) return;
  mountEl.hidden = false;
  const glyph = ICONS[payload.icon] || ICONS.cloud;
  mountEl.classList.add("co-weather");
  mountEl.innerHTML = `
    <span class="co-weather-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">${glyph}</svg>
    </span>
    <span class="co-weather-text">${Number.isFinite(payload.temp) ? `${payload.temp}°` : "—"}</span>
  `;
  mountEl.setAttribute("title", payload.label);
  mountEl.setAttribute("aria-label", `${payload.label}, ${payload.temp}°F`);
}

export function initWeather({ mountEl, onUpdate } = {}) {
  ensureStyles();

  const cached = loadCache();
  if (cached) {
    renderChip(mountEl, cached);
    onUpdate?.(cached);
  }

  let cancelled = false;
  let refreshTimer = 0;

  const run = async () => {
    if (cancelled) return;
    let coords = loadCoords();
    if (!coords) {
      coords = await requestCoords();
      if (coords) saveCoords(coords.lat, coords.lon);
    }
    if (!coords) return;
    try {
      const payload = await fetchWeather(coords.lat, coords.lon);
      if (cancelled) return;
      saveCache(payload);
      renderChip(mountEl, payload);
      onUpdate?.(payload);
    } catch (err) {
      console.warn("weather fetch failed:", err);
    }
  };

  run();
  refreshTimer = setInterval(run, REFRESH_MS);

  return {
    destroy() {
      cancelled = true;
      clearInterval(refreshTimer);
    },
  };
}
