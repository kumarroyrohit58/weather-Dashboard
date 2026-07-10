/* ==========================================================================
   METEO / 04 — Weather Terminal
   Data: Open-Meteo (free, no API key)
   ========================================================================== */

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REV_URL = "https://geocoding-api.open-meteo.com/v1/reverse";
const WX_URL = "https://api.open-meteo.com/v1/forecast";
const AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

const LS_RECENT = "meteo04_recent_searches";
const LS_FAV = "meteo04_favorites";
const LS_UNIT = "meteo04_unit"; // "c" | "f"
const MAX_RECENT = 6;

/* ----------------------------- Weather codes ------------------------------ */
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
const statusBar = $("status-bar");
const statusText = $("status-text");
const results = $("results");
const errorBox = $("error-box");
const errorText = $("error-text");
const geoBtn = $("geo-btn");
const shareBtn = $("share-btn");
const favBtn = $("fav-btn");
const favWrap = $("favorites-wrap");
const favList = $("favorites");
const unitToggle = $("unit-toggle");

/* -------------------------- App state ------------------------------------ */
let unit = localStorage.getItem(LS_UNIT) || "c";
let currentPlace = null; // last successfully fetched place
let currentData = null; // last raw weather data
let currentAQ = null; // last air quality data

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

/* ---------------------------- Unit helpers ------------------------------- */
function toF(c) {
  return (c * 9) / 5 + 32;
}
function toMph(kmh) {
  return kmh * 0.621371;
}
function fmtTemp(c) {
  if (c == null || isNaN(c)) return "—";
  return Math.round(unit === "f" ? toF(c) : c);
}
function tempUnitLabel() {
  return unit === "f" ? "°F" : "°C";
}
function fmtWind(kmh) {
  if (kmh == null || isNaN(kmh)) return "—";
  return Math.round(unit === "f" ? toMph(kmh) : kmh);
}
function windUnitLabel() {
  return unit === "f" ? "mph" : "km/h";
}

/* ----------------------------- Unit toggle ------------------------------- */
function applyUnitButtons() {
  unitToggle.querySelectorAll(".unit-btn").forEach((b) => {
    const isActive = b.dataset.unit === unit;
    b.classList.toggle("active", isActive);
    b.classList.toggle("bg-volt", isActive);
    b.classList.toggle("text-black", isActive);
    b.classList.toggle("text-white/60", !isActive);
  });
}
unitToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".unit-btn");
  if (!btn) return;
  const next = btn.dataset.unit;
  if (next === unit) return;
  unit = next;
  localStorage.setItem(LS_UNIT, unit);
  applyUnitButtons();
  if (currentData && currentPlace) renderWeather(currentPlace, currentData, false);
});
applyUnitButtons();

/* ---------------------------- Storage: recent ---------------------------- */
function loadRecent() {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveRecent(list) {
  localStorage.setItem(LS_RECENT, JSON.stringify(list.slice(0, MAX_RECENT)));
}
function addRecent(place) {
  const list = loadRecent().filter(
    (p) => !samePlace(p, place)
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

/* --------------------------- Storage: favorites -------------------------- */
function loadFavs() {
  try {
    const raw = localStorage.getItem(LS_FAV);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveFavs(list) {
  localStorage.setItem(LS_FAV, JSON.stringify(list));
}
function isFav(place) {
  return loadFavs().some((p) => samePlace(p, place));
}
function toggleFav(place) {
  let list = loadFavs();
  if (list.some((p) => samePlace(p, place))) {
    list = list.filter((p) => !samePlace(p, place));
  } else {
    list.unshift(place);
  }
  saveFavs(list);
  renderFavorites();
  updateFavBtn();
}
function samePlace(a, b) {
  if (!a || !b) return false;
  return (
    Math.abs(a.latitude - b.latitude) < 0.02 &&
    Math.abs(a.longitude - b.longitude) < 0.02
  );
}

/* ------------------------- Render: chips (recent + fav) ------------------ */
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
    chip.addEventListener("click", (e) => {
      if (e.target.classList.contains("x")) {
        e.stopPropagation();
        removeRecent(i);
      } else {
        fetchAndRender(p);
      }
    });
    recentWrap.appendChild(chip);
  });
}
function renderFavorites() {
  const list = loadFavs();
  if (list.length === 0) {
    favWrap.classList.add("hidden");
    favList.innerHTML = "";
    return;
  }
  favWrap.classList.remove("hidden");
  favList.innerHTML = "";
  list.forEach((p, i) => {
    const chip = document.createElement("button");
    chip.className = "chip fav";
    chip.setAttribute("data-testid", `fav-chip-${slug(p.name)}`);
    chip.innerHTML = `<span>★ ${escapeHTML(p.name)}${p.country_code ? " · " + p.country_code : ""}</span><span class="x">×</span>`;
    chip.addEventListener("click", (e) => {
      if (e.target.classList.contains("x")) {
        e.stopPropagation();
        const arr = loadFavs();
        arr.splice(i, 1);
        saveFavs(arr);
        renderFavorites();
        updateFavBtn();
      } else {
        fetchAndRender(p);
      }
    });
    favList.appendChild(chip);
  });
}
function updateFavBtn() {
  if (!currentPlace) {
    favBtn.classList.add("hidden");
    return;
  }
  favBtn.classList.remove("hidden");
  const on = isFav(currentPlace);
  $("fav-btn-label").textContent = on ? "Saved" : "Save as favorite";
  favBtn.classList.toggle("text-volt", on);
  favBtn.classList.toggle("border-volt", on);
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
    if (acIndex >= 0 && acItems[acIndex]) pickPlace(acItems[acIndex]);
    else handleEnter();
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
  if (acItems.length > 0) pickPlace(acItems[0]);
  else searchCities(q, true);
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
      el.addEventListener("click", () => pickPlace(acItems[Number(el.dataset.i)]));
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
      `&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset` +
      `&timezone=auto&forecast_days=5&wind_speed_unit=kmh&temperature_unit=celsius`;
    const aqUrl =
      `${AQ_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide&timezone=auto`;
    const [res, aqRes] = await Promise.all([fetch(url), fetch(aqUrl).catch(() => null)]);
    if (!res.ok) throw new Error("Weather API error");
    const data = await res.json();
    let aq = null;
    if (aqRes && aqRes.ok) {
      try { aq = await aqRes.json(); } catch { aq = null; }
    }
    currentPlace = { ...place };
    currentData = data;
    currentAQ = aq;
    renderWeather(currentPlace, data, true);
    addRecent(currentPlace);
    updateFavBtn();
    updateShareURL(currentPlace);
    hideStatus();
  } catch (err) {
    hideStatus();
    showError("Could not load weather. Please try again.");
  }
}

function renderWeather(place, data, animate) {
  document.body.classList.add("has-results");
  results.classList.remove("hidden");
  if (animate) {
    results.classList.remove("rise");
    // reflow to restart animation
    void results.offsetWidth;
    results.classList.add("rise");
  }

  // Header
  $("city-name").textContent = place.name;
  $("country-line").textContent =
    [place.admin1, place.country].filter(Boolean).join(" · ") || "—";
  $("coords").textContent = `${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`;

  const localNow = new Date(data.current.time);
  $("current-time").textContent = localNow.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const cur = data.current;
  const meta = wmo(cur.weather_code);
  $("current-temp").textContent = fmtTemp(cur.temperature_2m);
  $("temp-unit-lbl").textContent = tempUnitLabel();
  $("current-condition").textContent = meta.label;
  $("feels-like").textContent = fmtTemp(cur.apparent_temperature);
  $("humidity").textContent = Math.round(cur.relative_humidity_2m);
  $("wind").textContent = fmtWind(cur.wind_speed_10m);
  $("wind-unit-lbl").textContent = windUnitLabel();
  $("pressure").textContent = Math.round(cur.pressure_msl);
  $("uv").textContent =
    data.daily && data.daily.uv_index_max ? Math.round(data.daily.uv_index_max[0]) : "—";
  $("forecast-unit-lbl").textContent = tempUnitLabel();

  // Icon swap
  const iconWrap = $("current-icon-wrap");
  iconWrap.innerHTML = `<i data-lucide="${meta.icon}" class="w-14 h-14 md:w-20 md:h-20 text-volt" stroke-width="1.2"></i>`;
  const ambient = $("ambient-icon");
  if (ambient) ambient.setAttribute("data-lucide", meta.icon);

  // ---- Hourly (next 24h from current hour) ----
  renderHourly(data);

  // ---- Sun arc (sunrise/sunset) ----
  renderSunArc(data);

  // ---- Air quality ----
  renderAQI(currentAQ);

  // ---- Precipitation + Wind mini-charts ----
  renderPrecipChart(data);
  renderWindChart(data);

  // ---- 5-day forecast ----
  const days = data.daily.time || [];
  const forecastEl = $("forecast");
  forecastEl.innerHTML = "";
  days.forEach((iso, i) => {
    const d = new Date(iso + "T00:00:00");
    const code = data.daily.weather_code[i];
    const m = wmo(code);
    const hi = fmtTemp(data.daily.temperature_2m_max[i]);
    const lo = fmtTemp(data.daily.temperature_2m_min[i]);
    const dayName = d.toLocaleDateString("en-GB", { weekday: "short" });
    const dateBits = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    const card = document.createElement("div");
    card.className = `f-card ${animate ? "rise rise-" + Math.min(i + 1, 5) : ""}`;
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

  // Show share/fav buttons
  shareBtn.classList.remove("hidden");
  updateFavBtn();

  if (window.lucide) window.lucide.createIcons();

  if (animate) results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSunArc(data) {
  const svg = $("sun-arc");
  if (!svg || !data.daily || !data.daily.sunrise) return;
  const sunriseISO = data.daily.sunrise[0];
  const sunsetISO = data.daily.sunset[0];
  const nowISO = data.current.time;
  // Parse as local (Open-Meteo already returns times in requested timezone)
  const sunriseMin = toMinutes(sunriseISO);
  const sunsetMin = toMinutes(sunsetISO);
  const nowMin = toMinutes(nowISO);

  // Arc geometry: half circle from (40, 170) to (360, 170), peak (200, 30)
  const cx = 200, cy = 170, rx = 160, ry = 130;
  const total = sunsetMin - sunriseMin || 1;
  let progress = (nowMin - sunriseMin) / total;
  progress = Math.max(0, Math.min(1, progress));

  // Angle sweeps from 180° (left horizon) to 0° (right horizon)
  const angle = Math.PI * (1 - progress);
  const sunX = cx + rx * Math.cos(angle);
  const sunY = cy - ry * Math.sin(angle);

  // Fill path from left to current sun position
  const fillEnd = describeArc(cx, cy, rx, ry, 180, 180 - 180 * progress);
  const fullArc = describeArc(cx, cy, rx, ry, 180, 0);

  const dayHours = Math.floor(total / 60);
  const dayMins = total % 60;
  $("day-length").textContent = `day · ${dayHours}h ${String(dayMins).padStart(2, "0")}m`;
  $("sunrise-time").textContent = fmtHHMM(sunriseISO);
  $("sunset-time").textContent = fmtHHMM(sunsetISO);

  svg.innerHTML = `
    <path class="arc-track" d="${fullArc}" />
    <path class="arc-fill" d="${fillEnd}" />
    <line class="horizon" x1="20" y1="170" x2="380" y2="170" />
    <circle class="sun-halo" cx="${sunX}" cy="${sunY}" r="14" />
    <circle class="sun-dot" cx="${sunX}" cy="${sunY}" r="5" />
    <text class="tick-label" x="20" y="185" text-anchor="start">Sunrise</text>
    <text class="tick-label" x="380" y="185" text-anchor="end">Sunset</text>
  `;
}

function toMinutes(iso) {
  // iso like "2026-01-10T07:24"
  const [, time] = iso.split("T");
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
function fmtHHMM(iso) {
  return iso.split("T")[1].slice(0, 5);
}
function polarToXY(cx, cy, rx, ry, angleDeg) {
  const rad = (Math.PI / 180) * angleDeg;
  return { x: cx + rx * Math.cos(rad), y: cy - ry * Math.sin(rad) };
}
function describeArc(cx, cy, rx, ry, startDeg, endDeg) {
  const start = polarToXY(cx, cy, rx, ry, startDeg);
  const end = polarToXY(cx, cy, rx, ry, endDeg);
  const large = 0;
  const sweep = endDeg > startDeg ? 0 : 1;
  return `M ${start.x} ${start.y} A ${rx} ${ry} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

function renderAQI(aq) {
  const valEl = $("aqi-value");
  const labelEl = $("aqi-label");
  const marker = $("aqi-marker");
  if (!aq || !aq.current || aq.current.european_aqi == null) {
    valEl.textContent = "—";
    labelEl.textContent = "Unavailable";
    marker.style.left = "0%";
    $("aqi-pm25").textContent = "—";
    $("aqi-pm10").textContent = "—";
    $("aqi-o3").textContent = "—";
    $("aqi-no2").textContent = "—";
    return;
  }
  const v = Math.round(aq.current.european_aqi);
  valEl.textContent = v;
  const bands = [
    [20, "Good"],
    [40, "Fair"],
    [60, "Moderate"],
    [80, "Poor"],
    [100, "Very poor"],
    [Infinity, "Extremely poor"],
  ];
  labelEl.textContent = bands.find((b) => v < b[0])[1];
  const pct = Math.max(0, Math.min(100, v));
  marker.style.left = pct + "%";
  const cur = aq.current;
  $("aqi-pm25").textContent = cur.pm2_5 != null ? cur.pm2_5.toFixed(1) : "—";
  $("aqi-pm10").textContent = cur.pm10 != null ? cur.pm10.toFixed(1) : "—";
  $("aqi-o3").textContent = cur.ozone != null ? Math.round(cur.ozone) : "—";
  $("aqi-no2").textContent = cur.nitrogen_dioxide != null ? Math.round(cur.nitrogen_dioxide) : "—";
}

function next24Slice(data) {
  const hourly = data.hourly;
  if (!hourly || !hourly.time) return null;
  const nowIso = data.current.time;
  const startIdx = Math.max(
    0,
    hourly.time.findIndex((t) => t.slice(0, 13) === nowIso.slice(0, 13))
  );
  const end = Math.min(hourly.time.length, startIdx + 24);
  return { startIdx, end };
}

function renderPrecipChart(data) {
  const svg = $("precip-chart");
  const slice = next24Slice(data);
  if (!svg || !slice) return;
  const hourly = data.hourly;
  const W = 480, H = 120, PAD_L = 28, PAD_R = 6, PAD_T = 8, PAD_B = 18;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const n = slice.end - slice.startIdx;
  const gap = 2;
  const bw = (chartW - gap * (n - 1)) / n;

  let maxPop = 0;
  const values = [];
  for (let i = slice.startIdx; i < slice.end; i++) {
    const v = hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0;
    values.push(v || 0);
    if (v > maxPop) maxPop = v;
  }
  $("precip-max").textContent = `max ${maxPop}%`;

  // Grid lines at 0, 50, 100
  let out = "";
  [0, 50, 100].forEach((g) => {
    const y = PAD_T + chartH - (g / 100) * chartH;
    out += `<line class="grid-line" x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" />`;
    out += `<text class="grid-label" x="${PAD_L - 6}" y="${y + 3}" text-anchor="end">${g}%</text>`;
  });

  values.forEach((v, i) => {
    const x = PAD_L + i * (bw + gap);
    const h = (v / 100) * chartH;
    const y = PAD_T + chartH - h;
    out += `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" />`;
  });
  svg.innerHTML = out;
}

function renderWindChart(data) {
  const svg = $("wind-chart");
  const slice = next24Slice(data);
  if (!svg || !slice) return;
  const hourly = data.hourly;
  if (!hourly.wind_speed_10m) return;
  const W = 480, H = 120, PAD_L = 34, PAD_R = 6, PAD_T = 8, PAD_B = 18;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const n = slice.end - slice.startIdx;
  const rawVals = [];
  let maxRaw = 0;
  for (let i = slice.startIdx; i < slice.end; i++) {
    const kmh = hourly.wind_speed_10m[i] || 0;
    const v = unit === "f" ? toMph(kmh) : kmh;
    rawVals.push(v);
    if (v > maxRaw) maxRaw = v;
  }
  const yMax = Math.max(10, Math.ceil(maxRaw / 5) * 5);
  $("wind-max").textContent = `peak ${Math.round(maxRaw)} ${windUnitLabel()}`;

  // Grid
  let out = "";
  [0, yMax / 2, yMax].forEach((g) => {
    const y = PAD_T + chartH - (g / yMax) * chartH;
    out += `<line class="grid-line" x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" />`;
    out += `<text class="grid-label" x="${PAD_L - 6}" y="${y + 3}" text-anchor="end">${Math.round(g)}</text>`;
  });

  // Line + area
  const stepX = chartW / Math.max(1, n - 1);
  const points = rawVals.map((v, i) => {
    const x = PAD_L + i * stepX;
    const y = PAD_T + chartH - (v / yMax) * chartH;
    return [x, y];
  });
  const linePath = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const areaPath =
    `M ${points[0][0].toFixed(1)} ${(PAD_T + chartH).toFixed(1)} ` +
    points.map((p) => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") +
    ` L ${points[points.length - 1][0].toFixed(1)} ${(PAD_T + chartH).toFixed(1)} Z`;

  out += `<path class="wind-area" d="${areaPath}" />`;
  out += `<path class="wind-line" d="${linePath}" />`;
  out += `<circle class="wind-dot" cx="${points[0][0].toFixed(1)}" cy="${points[0][1].toFixed(1)}" r="3" />`;
  svg.innerHTML = out;
}

function renderHourly(data) {
  const hourly = data.hourly;
  if (!hourly || !hourly.time) return;
  const nowIso = data.current.time; // "YYYY-MM-DDTHH:MM"
  const startIdx = Math.max(
    0,
    hourly.time.findIndex((t) => t.slice(0, 13) === nowIso.slice(0, 13))
  );
  const end = Math.min(hourly.time.length, startIdx + 24);
  const strip = $("hourly");
  strip.innerHTML = "";
  for (let i = startIdx; i < end; i++) {
    const d = new Date(hourly.time[i]);
    const hh = String(d.getHours()).padStart(2, "0");
    const meta = wmo(hourly.weather_code[i]);
    const t = fmtTemp(hourly.temperature_2m[i]);
    const pop = hourly.precipitation_probability ? hourly.precipitation_probability[i] : null;
    const cell = document.createElement("div");
    cell.className = "h-cell" + (i === startIdx ? " now" : "");
    cell.setAttribute("data-testid", `hourly-cell-${i - startIdx}`);
    cell.innerHTML = `
      <div class="h-time">${i === startIdx ? "Now" : hh + ":00"}</div>
      <div class="h-icon"><i data-lucide="${meta.icon}" class="w-5 h-5" stroke-width="1.4"></i></div>
      <div class="h-temp">${t}°</div>
      <div class="h-pop">${pop != null ? pop + "%" : ""}</div>
    `;
    strip.appendChild(cell);
  }
}

/* ------------------------------ Geolocation ------------------------------ */
geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showError("Geolocation not supported by your browser.");
    return;
  }
  showStatus("Locating…");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      // Reverse geocode to get a name
      try {
        const r = await fetch(
          `${REV_URL}?latitude=${latitude}&longitude=${longitude}&count=1&language=en&format=json`
        );
        const j = await r.json();
        const found = (j.results && j.results[0]) || null;
        const place = found
          ? {
              name: found.name,
              country: found.country,
              country_code: found.country_code,
              admin1: found.admin1,
              latitude,
              longitude,
            }
          : {
              name: "My location",
              country: "",
              country_code: "",
              admin1: "",
              latitude,
              longitude,
            };
        fetchAndRender(place);
      } catch {
        fetchAndRender({
          name: "My location",
          country: "",
          country_code: "",
          admin1: "",
          latitude,
          longitude,
        });
      }
    },
    (err) => {
      hideStatus();
      showError(
        err.code === 1
          ? "Location permission denied."
          : "Could not determine your location."
      );
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
  );
});

/* ------------------------------ Share URL -------------------------------- */
function updateShareURL(place) {
  const url = new URL(window.location.href);
  url.searchParams.set("city", place.name);
  url.searchParams.set("lat", place.latitude.toFixed(4));
  url.searchParams.set("lon", place.longitude.toFixed(4));
  if (place.country_code) url.searchParams.set("cc", place.country_code);
  window.history.replaceState({}, "", url);
}
shareBtn.addEventListener("click", async () => {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    $("share-btn-label").textContent = "Copied!";
    setTimeout(() => ($("share-btn-label").textContent = "Copy link"), 1600);
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      $("share-btn-label").textContent = "Copied!";
      setTimeout(() => ($("share-btn-label").textContent = "Copy link"), 1600);
    } catch {
      showError("Could not copy link. Copy from address bar.");
    }
    document.body.removeChild(ta);
  }
});

/* ------------------------------ Favorites -------------------------------- */
favBtn.addEventListener("click", () => {
  if (!currentPlace) return;
  toggleFav(currentPlace);
});

/* -------------------------- Boot & URL parsing --------------------------- */
function parseURLCity() {
  const p = new URLSearchParams(window.location.search);
  const city = p.get("city");
  const lat = parseFloat(p.get("lat"));
  const lon = parseFloat(p.get("lon"));
  if (city && !isNaN(lat) && !isNaN(lon)) {
    return {
      name: city,
      country: "",
      country_code: p.get("cc") || "",
      admin1: "",
      latitude: lat,
      longitude: lon,
    };
  }
  return null;
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
  renderFavorites();
  if (window.lucide) window.lucide.createIcons();
  input.focus();

  // If a city is in the URL, auto-load it
  const urlPlace = parseURLCity();
  if (urlPlace) {
    fetchAndRender(urlPlace);
  }
});
