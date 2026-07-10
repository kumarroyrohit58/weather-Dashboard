/* ==========================================================================
   METEO / 04 — Weather Terminal
   Data: Open-Meteo (free, no API key)
   ========================================================================== */

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WX_URL = "https://api.open-meteo.com/v1/forecast";
const LS_KEY = "meteo04_recent_searches";
const MAX_RECENT = 6;

/* ----------------------------- Weather codes ------------------------------ */
// Mapping Open-Meteo WMO weather codes -> label + lucide icon name
const WMO = {
  0: { label: "Clear sky", icon: "sun" },
  1: { label: "Mainly clear", icon: "sun" },
  2: { label: "Partly cloudy", icon: "cloud-sun" },
  3: { label: "Overcast", icon: "cloud" },
  45: { label: "Fog", icon: "cloud-fog" },
  48: { label: "Rime fog", icon: "cloud-fog" },
  51: { label: "Light drizzle", icon: "cloud-drizzle" },
  53: { label: "Drizzle", icon: "cloud-drizzle" },
  55: { label: "Dense drizzle", icon: "cloud-drizzle" },
  56: { label: "Freezing drizzle", icon: "cloud-drizzle" },
  57: { label: "Freezing drizzle", icon: "cloud-drizzle" },
  61: { label: "Light rain", icon: "cloud-rain" },
  63: { label: "Rain", icon: "cloud-rain" },
  65: { label: "Heavy rain", icon: "cloud-rain-wind" },
  66: { label: "Freezing rain", icon: "cloud-rain" },
  67: { label: "Freezing rain", icon: "cloud-rain" },
  71: { label: "Light snow", icon: "cloud-snow" },
  73: { label: "Snow", icon: "cloud-snow" },
  75: { label: "Heavy snow", icon: "snowflake" },
  77: { label: "Snow grains", icon: "cloud-snow" },
  80: { label: "Rain showers", icon: "cloud-rain" },
  81: { label: "Rain showers", icon: "cloud-rain" },
  82: { label: "Violent showers", icon: "cloud-rain-wind" },
  85: { label: "Snow showers", icon: "cloud-snow" },
  86: { label: "Heavy snow showers", icon: "cloud-snow" },
  95: { label: "Thunderstorm", icon: "cloud-lightning" },
  96: { label: "Thunder + hail", icon: "cloud-lightning" },
  99: { label: "Severe thunder", icon: "cloud-lightning" },
};

function wmo(code) {
  return WMO[code] || { label: "Unknown", icon: "cloud" };
}

/* ---------------------------- DOM references ------------------------------ */
const $ = (id) => document.getElementById(id);
const input = $("search-input");
const searchBtn = $("search-btn");
const ac = $("autocomplete");
const recentWrap = $("recent-searches");
const recentEmpty = $("recent-empty");
const statusBar = $("status-bar");
const statusText = $("status-text");
const results = $("results");
const errorBox = $("error-box");
const errorText = $("error-text");

/* -------------------------------- Clock ---------------------------------- */
function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const c = $("clock");
  if (c) c.textContent = `${hh}:${mm}:${ss}`;

  const dd = $("today-date");
  if (dd) {
    const opts = { weekday: "short", day: "2-digit", month: "short", year: "numeric" };
    dd.textContent = now.toLocaleDateString("en-GB", opts).replace(/,/g, " ·");
  }
}
setInterval(tickClock, 1000);
tickClock();

/* ---------------------------- Recent searches ---------------------------- */
function loadRecent() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveRecent(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}
function addRecent(place) {
  const list = loadRecent().filter(
    (p) => !(p.latitude === place.latitude && p.longitude === place.longitude)
  );
  list.unshift(place);
  saveRecent(list);
  renderRecent();
}
function removeRecent(index) {
  const list = loadRecent();
  list.splice(index, 1);
  saveRecent(list);
  renderRecent();
}
function renderRecent() {
  const list = loadRecent();
  recentWrap.innerHTML = "";
  if (list.length === 0) {
    const span = document.createElement("span");
    span.id = "recent-empty";
    span.className = "font-mono text-xs text-white/25 uppercase tracking-wider";
    span.textContent = "— no history yet —";
    recentWrap.appendChild(span);
    return;
  }
  list.forEach((p, i) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.setAttribute("data-testid", `recent-chip-${slug(p.name)}`);
    chip.innerHTML = `<span>${escapeHTML(p.name)}${p.country_code ? " · " + p.country_code : ""}</span><span class="x">×</span>`;
    // Click chip -> re-search. Click "×" -> remove.
    chip.addEventListener("click", (e) => {
      const isX = e.target.classList.contains("x");
      if (isX) {
        e.stopPropagation();
        removeRecent(i);
      } else {
        fetchAndRender(p);
      }
    });
    recentWrap.appendChild(chip);
  });
}

/* ------------------------------ Autocomplete ----------------------------- */
let acItems = [];
let acIndex = -1;
let debounceTimer = null;

input.addEventListener("input", () => {
  const q = input.value.trim();
  clearTimeout(debounceTimer);
  if (q.length < 2) {
    closeAC();
    return;
  }
  debounceTimer = setTimeout(() => searchCities(q), 220);
});

input.addEventListener("keydown", (e) => {
  if (ac.classList.contains("hidden")) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEnter();
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    acIndex = Math.min(acIndex + 1, acItems.length - 1);
    paintACSelection();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    acIndex = Math.max(acIndex - 1, 0);
    paintACSelection();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (acIndex >= 0 && acItems[acIndex]) {
      pickPlace(acItems[acIndex]);
    } else {
      handleEnter();
    }
  } else if (e.key === "Escape") {
    closeAC();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#search-wrapper")) closeAC();
});

searchBtn.addEventListener("click", handleEnter);

function handleEnter() {
  const q = input.value.trim();
  if (!q) return;
  // If we have autocomplete results, pick the first one; else fetch top match directly
  if (acItems.length > 0) {
    pickPlace(acItems[0]);
  } else {
    searchCities(q, true);
  }
}

function paintACSelection() {
  ac.querySelectorAll(".ac-item").forEach((el, i) => {
    el.classList.toggle("active", i === acIndex);
  });
}

function closeAC() {
  ac.classList.add("hidden");
  ac.innerHTML = "";
  acItems = [];
  acIndex = -1;
}

async function searchCities(q, autopick = false) {
  try {
    const url = `${GEO_URL}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
    const res = await fetch(url);
    const data = await res.json();
    const list = data.results || [];
    acItems = list;
    acIndex = -1;

    if (list.length === 0) {
      closeAC();
      if (autopick) showError(`No city found for "${q}".`);
      return;
    }

    ac.innerHTML = list
      .map(
        (p, i) => `
        <div class="ac-item" data-i="${i}" data-testid="autocomplete-item-${i}">
          <div class="ac-city">${escapeHTML(p.name)}${p.admin1 ? ", " + escapeHTML(p.admin1) : ""}</div>
          <div class="ac-meta">${escapeHTML(p.country || "")} · ${p.country_code || ""}</div>
        </div>`
      )
      .join("");
    ac.classList.remove("hidden");
    ac.querySelectorAll(".ac-item").forEach((el) => {
      el.addEventListener("click", () => {
        const i = Number(el.dataset.i);
        pickPlace(acItems[i]);
      });
    });

    if (autopick) pickPlace(list[0]);
  } catch (err) {
    showError("Search failed. Check your connection.");
  }
}

function pickPlace(place) {
  input.value = place.name;
  closeAC();
  fetchAndRender(place);
}

/* --------------------------- Weather fetch/render ------------------------ */
async function fetchAndRender(place) {
  clearError();
  showStatus(`Fetching ${place.name}…`);
  try {
    const url =
      `${WX_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,pressure_msl` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max` +
      `&timezone=auto&forecast_days=5&wind_speed_unit=kmh&temperature_unit=celsius`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Weather API error");
    const data = await res.json();
    renderWeather(place, data);
    addRecent({
      name: place.name,
      country: place.country,
      country_code: place.country_code,
      admin1: place.admin1,
      latitude: place.latitude,
      longitude: place.longitude,
    });
    hideStatus();
  } catch (err) {
    hideStatus();
    showError("Could not load weather. Please try again.");
  }
}

function renderWeather(place, data) {
  document.body.classList.add("has-results");
  results.classList.remove("hidden");
  results.classList.add("rise");

  // Header
  $("city-name").textContent = place.name;
  $("country-line").textContent =
    [place.admin1, place.country].filter(Boolean).join(" · ") || "—";
  $("coords").textContent = `${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`;

  // Current time in that city
  const localNow = new Date(data.current.time);
  $("current-time").textContent = localNow.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const cur = data.current;
  const meta = wmo(cur.weather_code);
  $("current-temp").textContent = Math.round(cur.temperature_2m);
  $("current-condition").textContent = meta.label;
  $("feels-like").textContent = Math.round(cur.apparent_temperature);
  $("humidity").textContent = Math.round(cur.relative_humidity_2m);
  $("wind").textContent = Math.round(cur.wind_speed_10m);
  $("pressure").textContent = Math.round(cur.pressure_msl);
  $("uv").textContent =
    data.daily && data.daily.uv_index_max ? Math.round(data.daily.uv_index_max[0]) : "—";

  // Swap current icon
  const iconWrap = $("current-icon-wrap");
  iconWrap.innerHTML = `<i data-lucide="${meta.icon}" class="w-14 h-14 md:w-20 md:h-20 text-volt" stroke-width="1.2"></i>`;

  // Ambient bg icon
  const ambient = $("ambient-icon");
  if (ambient) {
    ambient.setAttribute("data-lucide", meta.icon);
  }

  // 5-day forecast
  const days = data.daily.time || [];
  const forecastEl = $("forecast");
  forecastEl.innerHTML = "";
  days.forEach((iso, i) => {
    const d = new Date(iso + "T00:00:00");
    const code = data.daily.weather_code[i];
    const m = wmo(code);
    const hi = Math.round(data.daily.temperature_2m_max[i]);
    const lo = Math.round(data.daily.temperature_2m_min[i]);
    const dayName = d.toLocaleDateString("en-GB", { weekday: "short" });
    const dateBits = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    const card = document.createElement("div");
    card.className = `f-card rise rise-${Math.min(i + 1, 5)}`;
    card.setAttribute("data-testid", `forecast-day-${i}`);
    card.innerHTML = `
      <div>
        <div class="f-day">${i === 0 ? "Today" : dayName}</div>
        <div class="f-date">${dateBits}</div>
      </div>
      <div class="f-icon"><i data-lucide="${m.icon}" class="w-9 h-9" stroke-width="1.3"></i></div>
      <div class="w-full flex items-end justify-between">
        <div class="f-cond">${m.label}</div>
        <div class="f-temps">
          <span class="f-hi">${hi}°</span>
          <span class="f-lo">${lo}°</span>
        </div>
      </div>
    `;
    forecastEl.appendChild(card);
  });

  // Rebuild icons
  if (window.lucide) window.lucide.createIcons();

  // Scroll into view (smooth)
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --------------------------------- UI ------------------------------------ */
function showStatus(msg) {
  statusText.textContent = msg;
  statusBar.classList.remove("hidden");
}
function hideStatus() {
  statusBar.classList.add("hidden");
}
function showError(msg) {
  errorText.textContent = msg;
  errorBox.classList.remove("hidden");
}
function clearError() {
  errorBox.classList.add("hidden");
}

/* ------------------------------- Helpers --------------------------------- */
function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (s) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[s]));
}
function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ------------------------------- Boot ----------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  renderRecent();
  if (window.lucide) window.lucide.createIcons();
  input.focus();
});
