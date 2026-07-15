/* ==========================================================================
   METEO / 04 — Weather Terminal
   Data: Open-Meteo (free, no API key)
   ========================================================================== */

/* ============================== Constants ================================ */
const API = {
    GEO: "https://geocoding-api.open-meteo.com/v1/search",
    REV: "https://geocoding-api.open-meteo.com/v1/reverse",
    WX: "https://api.open-meteo.com/v1/forecast",
    AQ: "https://air-quality-api.open-meteo.com/v1/air-quality",
};

const LS = {
    RECENT: "meteo04_recent_searches",
    FAV: "meteo04_favorites",
    UNIT: "meteo04_unit", // "c" | "f"
};

/* ---- Timing (all values in milliseconds unless noted) ---- */
const AUTOCOMPLETE_DEBOUNCE_MS = 220;
const GEOLOCATION_TIMEOUT_MS = 8000;
const GEOLOCATION_CACHE_TTL_MS = 60000;
const COPY_FEEDBACK_MS = 1600;
const CLOCK_TICK_MS = 1000;

/* ---- Behavior thresholds & limits ---- */
const MAX_RECENT_SEARCHES = 6;
const AUTOCOMPLETE_MIN_CHARS = 2;
const AUTOCOMPLETE_RESULT_COUNT = 6;
const FORECAST_DAYS = 5;
const HOURLY_HOURS = 24;
const SAME_PLACE_EPSILON_DEG = 0.02; // lat/lon delta below which two places are "same"

/* ---- SVG geometry (all values in SVG user units / px) ---- */
const SUN_ARC = {
    // viewBox 400 × 190
    cx: 200, cy: 170, rx: 160, ry: 130,
    // horizon line endpoints (padded 20px from the viewBox edges)
    horizonX1: 20, horizonX2: 380, horizonY: 170,
    // tick label vertical offset (below horizon)
    labelY: 185,
    // sun dot + halo radii
    sunDotR: 5,
    sunHaloR: 14,
    // angular sweep: 180° = left horizon (sunrise), 0° = right horizon (sunset)
    startDeg: 180,
    endDeg: 0,
};

const CHART_DIMS = { W: 480, H: 120, PAD_L: 28, PAD_R: 6, PAD_T: 8, PAD_B: 18 };
// Wind chart needs wider left padding to fit 3-digit y-axis labels
const WIND_CHART_LEFT_PAD = 34;
const WIND_CHART_DIMS = { ...CHART_DIMS, PAD_L: WIND_CHART_LEFT_PAD };

/* ---- AQI classification bands (upper bound exclusive, label) ---- */
const AQI_BANDS = [
    [20, "Good"],
    [40, "Fair"],
    [60, "Moderate"],
    [80, "Poor"],
    [100, "Very poor"],
    [Infinity, "Extremely poor"],
];

/* ---- Unit conversion ---- */
const F_OFFSET = 32;
const F_RATIO = 9 / 5;
const MPH_PER_KMH = 0.621371;

/* ---- SVG namespace ---- */
const SVG_NS = "http://www.w3.org/2000/svg";

/* ---- Time math ---- */
const MIN_PER_HOUR = 60;

/* -------------------------- WMO weather code map ------------------------- */
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
const wmo = (code) => WMO[code] || { label: "Unknown", icon: "cloud" };

/* ---------------------------- DOM references ----------------------------- */
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

/* -------------------------------- State ---------------------------------- */
let unit = localStorage.getItem(LS.UNIT) || "c";
let currentPlace = null;
let currentData = null;
let currentAQ = null;

/* =============================== Helpers ================================= */
function toF(c) { return c * F_RATIO + F_OFFSET; }
function toMph(kmh) { return kmh * MPH_PER_KMH; }
function fmtTemp(c) {
    if (c == null || isNaN(c)) return "—";
    return Math.round(unit === "f" ? toF(c) : c);
}
function fmtWind(kmh) {
    if (kmh == null || isNaN(kmh)) return "—";
    return Math.round(unit === "f" ? toMph(kmh) : kmh);
}
const tempUnitLabel = () => (unit === "f" ? "°F" : "°C");
const windUnitLabel = () => (unit === "f" ? "mph" : "km/h");

function slug(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function samePlace(a, b) {
    if (!a || !b) return false;
    return (
        Math.abs(a.latitude - b.latitude) < SAME_PLACE_EPSILON_DEG &&
        Math.abs(a.longitude - b.longitude) < SAME_PLACE_EPSILON_DEG
    );
}

// Time helpers
function toMinutes(iso) {
    const [, time] = iso.split("T");
    const [h, m] = time.split(":").map(Number);
    return h * MIN_PER_HOUR + m;
}
const fmtHHMM = (iso) => iso.split("T")[1].slice(0, 5);

/* ---------- Safe DOM builders (defensive; textContent by default) -------- */
function el(tag, opts = {}) {
    const node = document.createElement(tag);
    if (opts.className) node.className = opts.className;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.testid) node.setAttribute("data-testid", opts.testid);
    if (opts.attrs) {
        for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
    }
    if (opts.children) opts.children.forEach((c) => c && node.appendChild(c));
    return node;
}
function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}
function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}
// Lucide icon element created via textContent-safe DOM (icon name is
// whitelisted via WMO map; still we validate to be defensive).
function iconEl(name, className, strokeWidth = "1.5") {
    const safe = /^[a-z0-9-]+$/i.test(name) ? name : "cloud";
    const i = document.createElement("i");
    i.setAttribute("data-lucide", safe);
    if (className) i.className = className;
    i.setAttribute("stroke-width", strokeWidth);
    return i;
}

/* ============================= Clock ==================================== */
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
setInterval(tickClock, CLOCK_TICK_MS);
tickClock();

/* ============================= Unit toggle ============================== */
function applyUnitButtons() {
    unitToggle.querySelectorAll(".unit-btn").forEach((b) => {
        const active = b.dataset.unit === unit;
        b.classList.toggle("active", active);
        b.classList.toggle("bg-volt", active);
        b.classList.toggle("text-black", active);
        b.classList.toggle("text-white/60", !active);
    });
}
function handleUnitToggle(e) {
    const btn = e.target.closest(".unit-btn");
    if (!btn) return;
    const next = btn.dataset.unit;
    if (next === unit) return;
    unit = next;
    localStorage.setItem(LS.UNIT, unit);
    applyUnitButtons();
    if (currentData && currentPlace) renderWeather(currentPlace, currentData, false);
}
unitToggle.addEventListener("click", handleUnitToggle);
applyUnitButtons();

/* =========================== Storage: recent ============================ */
function loadRecent() {
    try {
        const raw = localStorage.getItem(LS.RECENT);
        return raw ? JSON.parse(raw) : [];
    } catch (err) {
        console.warn("meteo04: failed to parse recent searches from localStorage", err);
        return [];
    }
}
function saveRecent(list) {
    localStorage.setItem(LS.RECENT, JSON.stringify(list.slice(0, MAX_RECENT_SEARCHES)));
}
function addRecent(place) {
    const list = loadRecent().filter((p) => !samePlace(p, place));
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

/* ========================== Storage: favorites ========================== */
function loadFavs() {
    try {
        const raw = localStorage.getItem(LS.FAV);
        return raw ? JSON.parse(raw) : [];
    } catch (err) {
        console.warn("meteo04: failed to parse favorites from localStorage", err);
        return [];
    }
}
const saveFavs = (list) => localStorage.setItem(LS.FAV, JSON.stringify(list));
const isFav = (place) => loadFavs().some((p) => samePlace(p, place));
function toggleFav(place) {
    let list = loadFavs();
    list = list.some((p) => samePlace(p, place))
        ? list.filter((p) => !samePlace(p, place))
        : [place, ...list];
    saveFavs(list);
    renderFavorites();
    updateFavBtn();
}

/* =========================== Chip builders ============================== */
// Uses textContent for all user-supplied strings (defensive XSS-safe rendering)
function buildChip({ place, index, variant, onSelect, onRemove }) {
    const chip = document.createElement("button");
    chip.className = "chip" + (variant === "fav" ? " fav" : "");
    chip.setAttribute(
        "data-testid",
        (variant === "fav" ? "fav-chip-" : "recent-chip-") + slug(place.name)
    );

    const label = document.createElement("span");
    const prefix = variant === "fav" ? "★ " : "";
    const suffix = place.country_code ? " · " + place.country_code : "";
    label.textContent = prefix + place.name + suffix;

    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "×";
    x.dataset.role = "remove";

    chip.appendChild(label);
    chip.appendChild(x);

    chip.addEventListener("click", (e) => {
        if (e.target.dataset.role === "remove") {
            e.stopPropagation();
            onRemove(index);
        } else {
            onSelect(place);
        }
    });
    return chip;
}

function renderRecent() {
    const list = loadRecent();
    clearNode(recentWrap);
    if (list.length === 0) {
        const empty = el("span", {
            className: "font-mono text-xs text-white/25 uppercase tracking-wider",
            text: "— no history yet —",
        });
        empty.id = "recent-empty";
        recentWrap.appendChild(empty);
        return;
    }
    list.forEach((p, i) => {
        recentWrap.appendChild(
            buildChip({
                place: p, index: i, variant: "recent",
                onSelect: fetchAndRender,
                onRemove: removeRecent,
            })
        );
    });
}

function renderFavorites() {
    const list = loadFavs();
    if (list.length === 0) {
        favWrap.classList.add("hidden");
        clearNode(favList);
        return;
    }
    favWrap.classList.remove("hidden");
    clearNode(favList);
    list.forEach((p, i) => {
        favList.appendChild(
            buildChip({
                place: p, index: i, variant: "fav",
                onSelect: fetchAndRender,
                onRemove: (idx) => {
                    const arr = loadFavs();
                    arr.splice(idx, 1);
                    saveFavs(arr);
                    renderFavorites();
                    updateFavBtn();
                },
            })
        );
    });
}

function updateFavBtn() {
    if (!currentPlace) { favBtn.classList.add("hidden"); return; }
    favBtn.classList.remove("hidden");
    const on = isFav(currentPlace);
    $("fav-btn-label").textContent = on ? "Saved" : "Save as favorite";
    favBtn.classList.toggle("text-volt", on);
    favBtn.classList.toggle("border-volt", on);
}

/* ============================= Autocomplete ============================= */
let acItems = [];
let acIndex = -1;
let debounceTimer = null;

input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < AUTOCOMPLETE_MIN_CHARS) { closeAC(); return; }
    debounceTimer = setTimeout(() => searchCities(q), AUTOCOMPLETE_DEBOUNCE_MS);
});

input.addEventListener("keydown", (e) => {
    if (ac.classList.contains("hidden")) {
        if (e.key === "Enter") { e.preventDefault(); handleEnter(); }
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
    } else if (e.key === "Escape") { closeAC(); }
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
    ac.querySelectorAll(".ac-item").forEach((elm, i) => {
        elm.classList.toggle("active", i === acIndex);
    });
}
function closeAC() {
    ac.classList.add("hidden");
    clearNode(ac);
    acItems = [];
    acIndex = -1;
}

function buildACItem(place, i) {
    const row = document.createElement("div");
    row.className = "ac-item";
    row.setAttribute("data-i", i);
    row.setAttribute("data-testid", "autocomplete-item-" + i);

    const city = document.createElement("div");
    city.className = "ac-city";
    city.textContent = place.name + (place.admin1 ? ", " + place.admin1 : "");

    const meta = document.createElement("div");
    meta.className = "ac-meta";
    meta.textContent = (place.country || "") + " · " + (place.country_code || "");

    row.appendChild(city);
    row.appendChild(meta);
    row.addEventListener("click", () => pickPlace(acItems[i]));
    return row;
}

async function searchCities(q, autopick = false) {
    try {
        const url = `${API.GEO}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
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
        clearNode(ac);
        list.forEach((p, i) => ac.appendChild(buildACItem(p, i)));
        ac.classList.remove("hidden");
        if (autopick) pickPlace(list[0]);
    } catch (err) {
        console.warn("meteo04: geocoding search failed", err);
        showError("Search failed. Check your connection.");
    }
}
function pickPlace(place) {
    input.value = place.name;
    closeAC();
    fetchAndRender(place);
}

/* ============================ Weather fetch ============================= */
function buildWxURL(place) {
    return (
        `${API.WX}?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,pressure_msl` +
        `&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset` +
        `&timezone=auto&forecast_days=${FORECAST_DAYS}` +
        `&wind_speed_unit=kmh&temperature_unit=celsius`
    );
}
function buildAqUrl(place) {
    return (
        `${API.AQ}?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide&timezone=auto`
    );
}

async function fetchAndRender(place) {
    clearError();
    showStatus(`Fetching ${place.name}…`);
    try {
        const [wxRes, aqRes] = await Promise.all([
            fetch(buildWxURL(place)),
            fetch(buildAqUrl(place)).catch((err) => {
                // AQI is optional/nice-to-have; failure must not block the main weather view.
                console.info("meteo04: air-quality fetch failed — continuing without AQI", err);
                return null;
            }),
        ]);
        if (!wxRes.ok) throw new Error("Weather API error");
        const data = await wxRes.json();
        let aq = null;
        if (aqRes && aqRes.ok) {
            try {
                aq = await aqRes.json();
            } catch (err) {
                console.warn("meteo04: could not parse air-quality JSON — continuing without AQI", err);
                aq = null;
            }
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
        console.error("meteo04: weather fetch failed", err);
        hideStatus();
        showError("Could not load weather. Please try again.");
    }
}

/* ========================== renderWeather (small) ======================= */
// Kept intentionally small — delegates to focused sub-renderers.
function renderWeather(place, data, animate) {
    document.body.classList.add("has-results");
    results.classList.remove("hidden");
    if (animate) {
        results.classList.remove("rise");
        void results.offsetWidth; // reflow to restart animation
        results.classList.add("rise");
    }
    renderHeaderPanel(place, data);
    renderCurrentPanel(data);
    renderDetailsPanel(data);
    renderHourly(data);
    renderSunArc(data);
    renderAQI(currentAQ);
    renderPrecipChart(data);
    renderWindChart(data);
    renderForecast(data, animate);
    shareBtn.classList.remove("hidden");
    updateFavBtn();
    if (window.lucide) window.lucide.createIcons();
    if (animate) results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderHeaderPanel(place, data) {
    $("city-name").textContent = place.name;
    $("country-line").textContent =
        [place.admin1, place.country].filter(Boolean).join(" · ") || "—";
    $("coords").textContent = `${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`;
    const localNow = new Date(data.current.time);
    $("current-time").textContent = localNow.toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit",
    });
}

function renderCurrentPanel(data) {
    const cur = data.current;
    const meta = wmo(cur.weather_code);
    $("current-temp").textContent = fmtTemp(cur.temperature_2m);
    $("temp-unit-lbl").textContent = tempUnitLabel();
    $("current-condition").textContent = meta.label;
    $("feels-like").textContent = fmtTemp(cur.apparent_temperature);

    const iconWrap = $("current-icon-wrap");
    clearNode(iconWrap);
    iconWrap.appendChild(iconEl(meta.icon, "w-14 h-14 md:w-20 md:h-20 text-volt", "1.2"));

    const ambient = $("ambient-icon");
    if (ambient) ambient.setAttribute("data-lucide", /^[a-z0-9-]+$/i.test(meta.icon) ? meta.icon : "cloud");
}

function renderDetailsPanel(data) {
    const cur = data.current;
    $("humidity").textContent = Math.round(cur.relative_humidity_2m);
    $("wind").textContent = fmtWind(cur.wind_speed_10m);
    $("wind-unit-lbl").textContent = windUnitLabel();
    $("pressure").textContent = Math.round(cur.pressure_msl);
    $("uv").textContent =
        data.daily && data.daily.uv_index_max ? Math.round(data.daily.uv_index_max[0]) : "—";
    $("forecast-unit-lbl").textContent = tempUnitLabel();
}

function renderForecast(data, animate) {
    const forecastEl = $("forecast");
    clearNode(forecastEl);
    const days = data.daily.time || [];
    days.forEach((iso, i) => {
        forecastEl.appendChild(buildForecastCard(data, iso, i, animate));
    });
}

function buildForecastCard(data, iso, i, animate) {
    const d = new Date(iso + "T00:00:00");
    const code = data.daily.weather_code[i];
    const m = wmo(code);
    const hi = fmtTemp(data.daily.temperature_2m_max[i]);
    const lo = fmtTemp(data.daily.temperature_2m_min[i]);
    const dayName = d.toLocaleDateString("en-GB", { weekday: "short" });
    const dateBits = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

    const card = el("div", {
        className: `f-card ${animate ? "rise rise-" + Math.min(i + 1, 5) : ""}`,
        testid: `forecast-day-${i}`,
    });
    const head = el("div");
    head.appendChild(el("div", { className: "f-day", text: i === 0 ? "Today" : dayName }));
    head.appendChild(el("div", { className: "f-date", text: dateBits }));
    card.appendChild(head);

    const iconWrap = el("div", { className: "f-icon" });
    iconWrap.appendChild(iconEl(m.icon, "w-9 h-9", "1.3"));
    card.appendChild(iconWrap);

    const row = el("div", { className: "w-full flex items-end justify-between" });
    row.appendChild(el("div", { className: "f-cond", text: m.label }));
    const temps = el("div", { className: "f-temps" });
    temps.appendChild(el("span", { className: "f-hi", text: `${hi}°` }));
    temps.appendChild(el("span", { className: "f-lo", text: `${lo}°` }));
    row.appendChild(temps);
    card.appendChild(row);
    return card;
}

/* ---------------------------- Hourly strip ------------------------------- */
function next24Slice(data) {
    const hourly = data.hourly;
    if (!hourly || !hourly.time) return null;
    const nowIso = data.current.time;
    const startIdx = Math.max(
        0,
        hourly.time.findIndex((t) => t.slice(0, 13) === nowIso.slice(0, 13))
    );
    const end = Math.min(hourly.time.length, startIdx + HOURLY_HOURS);
    return { startIdx, end };
}

function renderHourly(data) {
    const strip = $("hourly");
    const slice = next24Slice(data);
    clearNode(strip);
    if (!slice) return;
    const hourly = data.hourly;
    for (let i = slice.startIdx; i < slice.end; i++) {
        strip.appendChild(buildHourlyCell(hourly, i, i === slice.startIdx));
    }
}

function buildHourlyCell(hourly, i, isNow) {
    const d = new Date(hourly.time[i]);
    const hh = String(d.getHours()).padStart(2, "0");
    const meta = wmo(hourly.weather_code[i]);
    const t = fmtTemp(hourly.temperature_2m[i]);
    const pop = hourly.precipitation_probability ? hourly.precipitation_probability[i] : null;

    const cell = el("div", {
        className: "h-cell" + (isNow ? " now" : ""),
        testid: `hourly-cell-${isNow ? 0 : i}`,
    });
    cell.appendChild(el("div", { className: "h-time", text: isNow ? "Now" : hh + ":00" }));
    const iconWrap = el("div", { className: "h-icon" });
    iconWrap.appendChild(iconEl(meta.icon, "w-5 h-5", "1.4"));
    cell.appendChild(iconWrap);
    cell.appendChild(el("div", { className: "h-temp", text: `${t}°` }));
    cell.appendChild(el("div", { className: "h-pop", text: pop != null ? pop + "%" : "" }));
    return cell;
}

/* ------------------------------ Sun arc ---------------------------------- */
function polarToXY({ cx, cy, rx, ry, angleDeg }) {
    const rad = (Math.PI / 180) * angleDeg;
    return { x: cx + rx * Math.cos(rad), y: cy - ry * Math.sin(rad) };
}
function describeArc({ cx, cy, rx, ry, startDeg, endDeg }) {
    const start = polarToXY({ cx, cy, rx, ry, angleDeg: startDeg });
    const end = polarToXY({ cx, cy, rx, ry, angleDeg: endDeg });
    const large = 0;
    const sweep = endDeg > startDeg ? 0 : 1;
    return `M ${start.x} ${start.y} A ${rx} ${ry} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

function renderSunArc(data) {
    const svg = $("sun-arc");
    if (!svg || !data.daily || !data.daily.sunrise) return;
    const sunriseISO = data.daily.sunrise[0];
    const sunsetISO = data.daily.sunset[0];
    const nowISO = data.current.time;
    const sunriseMin = toMinutes(sunriseISO);
    const sunsetMin = toMinutes(sunsetISO);
    const nowMin = toMinutes(nowISO);
    const total = sunsetMin - sunriseMin || 1;
    const progress = Math.max(0, Math.min(1, (nowMin - sunriseMin) / total));

    const { cx, cy, rx, ry, horizonX1, horizonX2, horizonY, labelY, sunDotR, sunHaloR, startDeg, endDeg } = SUN_ARC;
    const angle = Math.PI * (1 - progress);
    const sunX = cx + rx * Math.cos(angle);
    const sunY = cy - ry * Math.sin(angle);
    const partialEndDeg = startDeg - (startDeg - endDeg) * progress;
    const fillEnd = describeArc({ cx, cy, rx, ry, startDeg, endDeg: partialEndDeg });
    const fullArc = describeArc({ cx, cy, rx, ry, startDeg, endDeg });

    const dayHours = Math.floor(total / MIN_PER_HOUR);
    const dayMins = total % MIN_PER_HOUR;
    $("day-length").textContent = `day · ${dayHours}h ${String(dayMins).padStart(2, "0")}m`;
    $("sunrise-time").textContent = fmtHHMM(sunriseISO);
    $("sunset-time").textContent = fmtHHMM(sunsetISO);

    clearNode(svg);
    svg.appendChild(svgEl("path", { class: "arc-track", d: fullArc }));
    svg.appendChild(svgEl("path", { class: "arc-fill", d: fillEnd }));
    svg.appendChild(svgEl("line", {
        class: "horizon", x1: horizonX1, y1: horizonY, x2: horizonX2, y2: horizonY,
    }));
    svg.appendChild(svgEl("circle", { class: "sun-halo", cx: sunX, cy: sunY, r: sunHaloR }));
    svg.appendChild(svgEl("circle", { class: "sun-dot", cx: sunX, cy: sunY, r: sunDotR }));
    const lRise = svgEl("text", {
        class: "tick-label", x: horizonX1, y: labelY, "text-anchor": "start",
    });
    lRise.textContent = "Sunrise";
    const lSet = svgEl("text", {
        class: "tick-label", x: horizonX2, y: labelY, "text-anchor": "end",
    });
    lSet.textContent = "Sunset";
    svg.appendChild(lRise);
    svg.appendChild(lSet);
}

/* -------------------------------- AQI ------------------------------------ */
function renderAQI(aq) {
    const valEl = $("aqi-value");
    const labelEl = $("aqi-label");
    const marker = $("aqi-marker");
    if (!aq || !aq.current || aq.current.european_aqi == null) {
        valEl.textContent = "—";
        labelEl.textContent = "Unavailable";
        marker.style.left = "0%";
        ["aqi-pm25", "aqi-pm10", "aqi-o3", "aqi-no2"].forEach((id) => ($(id).textContent = "—"));
        return;
    }
    const v = Math.round(aq.current.european_aqi);
    valEl.textContent = v;
    labelEl.textContent = AQI_BANDS.find((b) => v < b[0])[1];
    marker.style.left = Math.max(0, Math.min(100, v)) + "%";
    const cur = aq.current;
    $("aqi-pm25").textContent = cur.pm2_5 != null ? cur.pm2_5.toFixed(1) : "—";
    $("aqi-pm10").textContent = cur.pm10 != null ? cur.pm10.toFixed(1) : "—";
    $("aqi-o3").textContent = cur.ozone != null ? Math.round(cur.ozone) : "—";
    $("aqi-no2").textContent = cur.nitrogen_dioxide != null ? Math.round(cur.nitrogen_dioxide) : "—";
}

/* --------------------------- Mini charts --------------------------------- */
function renderPrecipChart(data) {
    const svg = $("precip-chart");
    const slice = next24Slice(data);
    if (!svg || !slice) return;
    clearNode(svg);
    const hourly = data.hourly;
    const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = CHART_DIMS;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const n = slice.end - slice.startIdx;
    const gap = 2;
    const bw = (chartW - gap * (n - 1)) / n;

    let maxPop = 0;
    const values = [];
    for (let i = slice.startIdx; i < slice.end; i++) {
        const v = hourly.precipitation_probability ? hourly.precipitation_probability[i] || 0 : 0;
        values.push(v);
        if (v > maxPop) maxPop = v;
    }
    $("precip-max").textContent = `max ${maxPop}%`;

    [0, 50, 100].forEach((g) => {
        const y = PAD_T + chartH - (g / 100) * chartH;
        svg.appendChild(svgEl("line", { class: "grid-line", x1: PAD_L, y1: y, x2: W - PAD_R, y2: y }));
        const label = svgEl("text", {
            class: "grid-label", x: PAD_L - 6, y: y + 3, "text-anchor": "end",
        });
        label.textContent = `${g}%`;
        svg.appendChild(label);
    });

    values.forEach((v, i) => {
        const x = PAD_L + i * (bw + gap);
        const h = (v / 100) * chartH;
        const y = PAD_T + chartH - h;
        svg.appendChild(svgEl("rect", {
            class: "bar",
            x: x.toFixed(1), y: y.toFixed(1),
            width: bw.toFixed(1), height: Math.max(h, 1).toFixed(1),
        }));
    });
}

function renderWindChart(data) {
    const svg = $("wind-chart");
    const slice = next24Slice(data);
    if (!svg || !slice) return;
    const hourly = data.hourly;
    if (!hourly.wind_speed_10m) return;
    clearNode(svg);

    const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = WIND_CHART_DIMS;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const n = slice.end - slice.startIdx;

    const values = [];
    let maxRaw = 0;
    for (let i = slice.startIdx; i < slice.end; i++) {
        const kmh = hourly.wind_speed_10m[i] || 0;
        const v = unit === "f" ? toMph(kmh) : kmh;
        values.push(v);
        if (v > maxRaw) maxRaw = v;
    }
    const yMax = Math.max(10, Math.ceil(maxRaw / 5) * 5);
    $("wind-max").textContent = `peak ${Math.round(maxRaw)} ${windUnitLabel()}`;

    [0, yMax / 2, yMax].forEach((g) => {
        const y = PAD_T + chartH - (g / yMax) * chartH;
        svg.appendChild(svgEl("line", { class: "grid-line", x1: PAD_L, y1: y, x2: W - PAD_R, y2: y }));
        const label = svgEl("text", {
            class: "grid-label", x: PAD_L - 6, y: y + 3, "text-anchor": "end",
        });
        label.textContent = String(Math.round(g));
        svg.appendChild(label);
    });

    const stepX = chartW / Math.max(1, n - 1);
    const points = values.map((v, i) => [PAD_L + i * stepX, PAD_T + chartH - (v / yMax) * chartH]);
    const linePath = points.map((p, i) =>
        (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)
    ).join(" ");
    const areaPath =
        `M ${points[0][0].toFixed(1)} ${(PAD_T + chartH).toFixed(1)} ` +
        points.map((p) => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") +
        ` L ${points[points.length - 1][0].toFixed(1)} ${(PAD_T + chartH).toFixed(1)} Z`;

    svg.appendChild(svgEl("path", { class: "wind-area", d: areaPath }));
    svg.appendChild(svgEl("path", { class: "wind-line", d: linePath }));
    svg.appendChild(svgEl("circle", {
        class: "wind-dot", cx: points[0][0].toFixed(1), cy: points[0][1].toFixed(1), r: 3,
    }));
}

/* ============================ Geolocation =============================== */
async function reverseGeocode(latitude, longitude) {
    try {
        const r = await fetch(
            `${API.REV}?latitude=${latitude}&longitude=${longitude}&count=1&language=en&format=json`
        );
        const j = await r.json();
        return (j.results && j.results[0]) || null;
    } catch (err) {
        console.warn("meteo04: reverse geocoding failed — proceeding with raw coords", err);
        return null;
    }
}
function placeFromCoords(latitude, longitude, found) {
    if (found) {
        return {
            name: found.name, country: found.country, country_code: found.country_code,
            admin1: found.admin1, latitude, longitude,
        };
    }
    return { name: "My location", country: "", country_code: "", admin1: "", latitude, longitude };
}
async function onGeoSuccess(pos) {
    const { latitude, longitude } = pos.coords;
    const found = await reverseGeocode(latitude, longitude);
    fetchAndRender(placeFromCoords(latitude, longitude, found));
}
function onGeoError(err) {
    hideStatus();
    showError(err.code === 1 ? "Location permission denied." : "Could not determine your location.");
}
function handleUseMyLocation() {
    if (!navigator.geolocation) { showError("Geolocation not supported by your browser."); return; }
    showStatus("Locating…");
    navigator.geolocation.getCurrentPosition(onGeoSuccess, onGeoError, {
        enableHighAccuracy: false,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: GEOLOCATION_CACHE_TTL_MS,
    });
}
geoBtn.addEventListener("click", handleUseMyLocation);

/* ============================== Share URL =============================== */
function updateShareURL(place) {
    const url = new URL(window.location.href);
    url.searchParams.set("city", place.name);
    url.searchParams.set("lat", place.latitude.toFixed(4));
    url.searchParams.set("lon", place.longitude.toFixed(4));
    if (place.country_code) url.searchParams.set("cc", place.country_code);
    window.history.replaceState({}, "", url);
}
function flashShareLabel(text) {
    $("share-btn-label").textContent = text;
    setTimeout(() => ($("share-btn-label").textContent = "Copy link"), COPY_FEEDBACK_MS);
}
async function handleShareClick() {
    const url = window.location.href;
    // Preferred path: async Clipboard API (secure contexts + modern browsers).
    try {
        await navigator.clipboard.writeText(url);
        flashShareLabel("Copied!");
        return;
    } catch (clipboardErr) {
        // Common in older/insecure browsers or when permission is denied.
        // We intentionally continue with the execCommand fallback below.
        console.info(
            "meteo04: navigator.clipboard.writeText unavailable, using execCommand fallback",
            clipboardErr
        );
    }
    // Fallback path: temporary <textarea> + document.execCommand("copy").
    const ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
        flashShareLabel("Copied!");
    } catch (execErr) {
        console.error("meteo04: clipboard fallback failed", execErr);
        showError("Could not copy link. Copy from address bar.");
    }
    document.body.removeChild(ta);
}
shareBtn.addEventListener("click", handleShareClick);
favBtn.addEventListener("click", () => { if (currentPlace) toggleFav(currentPlace); });

/* ============================ URL boot loader =========================== */
function parseURLCity() {
    const p = new URLSearchParams(window.location.search);
    const city = p.get("city");
    const lat = parseFloat(p.get("lat"));
    const lon = parseFloat(p.get("lon"));
    if (!city || isNaN(lat) || isNaN(lon)) return null;
    return {
        name: city, country: "", country_code: p.get("cc") || "",
        admin1: "", latitude: lat, longitude: lon,
    };
}

/* ============================== UI helpers ============================== */
function showStatus(msg) { statusText.textContent = msg; statusBar.classList.remove("hidden"); }
function hideStatus() { statusBar.classList.add("hidden"); }
function showError(msg) { errorText.textContent = msg; errorBox.classList.remove("hidden"); }
function clearError() { errorBox.classList.add("hidden"); }

/* ================================= Boot ================================= */
document.addEventListener("DOMContentLoaded", () => {
    renderRecent();
    renderFavorites();
    if (window.lucide) window.lucide.createIcons();
    input.focus();
    const urlPlace = parseURLCity();
    if (urlPlace) fetchAndRender(urlPlace);
});
