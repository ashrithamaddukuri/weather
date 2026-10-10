// =====================================================
// WeatherNow · app.js
// Uses Open-Meteo (free, no API key needed)
// =====================================================

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

let currentTempC = null;
let currentFeelsC = null;
let currentUnit = 'C';

// ---------- Follow-me state ----------
let followEnabled = false;
let watchId = null;
let lastFollowLat = null;
let lastFollowLon = null;
const FOLLOW_THRESHOLD_KM = 5;

// ---------- Weather codes ----------
const weatherCodes = {
  0:  { label: 'Clear Sky',         emoji: '☀️' },
  1:  { label: 'Mainly Clear',      emoji: '🌤️' },
  2:  { label: 'Partly Cloudy',     emoji: '⛅' },
  3:  { label: 'Overcast',          emoji: '☁️' },
  45: { label: 'Foggy',             emoji: '🌫️' },
  48: { label: 'Icy Fog',           emoji: '🌫️' },
  51: { label: 'Light Drizzle',     emoji: '🌦️' },
  53: { label: 'Drizzle',           emoji: '🌦️' },
  55: { label: 'Heavy Drizzle',     emoji: '🌧️' },
  61: { label: 'Light Rain',        emoji: '🌧️' },
  63: { label: 'Rain',              emoji: '🌧️' },
  65: { label: 'Heavy Rain',        emoji: '🌧️' },
  71: { label: 'Light Snow',        emoji: '🌨️' },
  73: { label: 'Snow',              emoji: '❄️' },
  75: { label: 'Heavy Snow',        emoji: '❄️' },
  80: { label: 'Rain Showers',      emoji: '🌦️' },
  81: { label: 'Showers',           emoji: '🌧️' },
  82: { label: 'Violent Showers',   emoji: '⛈️' },
  95: { label: 'Thunderstorm',      emoji: '⛈️' },
  96: { label: 'Hail Storm',        emoji: '⛈️' },
  99: { label: 'Heavy Hail Storm',  emoji: '⛈️' },
};
const getWeatherInfo = c => weatherCodes[c] || { label: 'Unknown', emoji: '🌡️' };

// ---------- Clock ----------
function updateClock() {
  const now = new Date();
  document.getElementById('dateTime').textContent =
    now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
updateClock();
setInterval(updateClock, 30000);

// ---------- Toast ----------
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Distance helper ----------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// =====================================================
// GEOLOCATION
// =====================================================
function useMyLocation() {
  if (!navigator.geolocation) { showToast('Geolocation not supported'); return; }
  showToast('📍 Getting your location...');
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude, longitude } = pos.coords;
      lastFollowLat = latitude;
      lastFollowLon = longitude;
      const name = await reverseGeocode(latitude, longitude);
      fetchWeather(latitude, longitude, name.city, name.country);
      showToast(`📍 ${name.city}`);
    },
    () => showToast('❌ Location permission denied'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`${REVERSE_URL}?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const d = await res.json();
    return {
      city: d.city || d.locality || d.principalSubdivision || 'My Location',
      country: d.countryName || ''
    };
  } catch {
    return { city: 'My Location', country: '' };
  }
}

// =====================================================
// FOLLOW ME
// =====================================================
function toggleFollow() {
  followEnabled = !followEnabled;
  const btn = document.getElementById('followBtn');
  const dot = document.getElementById('followDot');
  const label = document.getElementById('followLabel');

  if (followEnabled) {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported');
      followEnabled = false;
      return;
    }
    btn.classList.add('active');
    dot.style.display = 'inline-block';
    label.textContent = '🟢 Following';

    watchId = navigator.geolocation.watchPosition(
      async pos => {
        const { latitude, longitude } = pos.coords;
        if (lastFollowLat != null) {
          const km = haversineKm(lastFollowLat, lastFollowLon, latitude, longitude);
          if (km < FOLLOW_THRESHOLD_KM) return; // skip small movement
        }
        lastFollowLat = latitude;
        lastFollowLon = longitude;
        const name = await reverseGeocode(latitude, longitude);
        fetchWeather(latitude, longitude, name.city, name.country);
        showToast(`📍 Updated · ${name.city}`);
      },
      () => {
        showToast('❌ Location error');
        toggleFollow();
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
    showToast('🔁 Following your location');
  } else {
    btn.classList.remove('active');
    dot.style.display = 'none';
    label.textContent = '🔁 Follow me';
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    showToast('⏹ Stopped following');
  }
}

// =====================================================
// SEARCH
// =====================================================
const input = document.getElementById('searchInput');
const suggestionsBox = document.getElementById('suggestions');
let debounceTimer;

input.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const q = input.value.trim();
  if (q.length < 2) { suggestionsBox.classList.add('hidden'); return; }
  debounceTimer = setTimeout(() => fetchSuggestions(q), 300);
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { suggestionsBox.classList.add('hidden'); search(); }
});

document.getElementById('searchBtn').addEventListener('click', () => {
  suggestionsBox.classList.add('hidden');
  search();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-section')) suggestionsBox.classList.add('hidden');
});

async function fetchSuggestions(query) {
  try {
    const res = await fetch(`${GEO_URL}?name=${encodeURIComponent(query)}&count=5&language=en`);
    const data = await res.json();
    if (!data.results) { suggestionsBox.classList.add('hidden'); return; }
    suggestionsBox.innerHTML = data.results.map(r =>
      `<div class="suggestion-item" onclick="selectCity('${r.name.replace(/'/g, "\\'")}', ${r.latitude}, ${r.longitude}, '${(r.country || '').replace(/'/g, "\\'")}')">
        📍 ${r.name}${r.admin1 ? ', ' + r.admin1 : ''}, ${r.country || ''}
      </div>`
    ).join('');
    suggestionsBox.classList.remove('hidden');
  } catch {
    suggestionsBox.classList.add('hidden');
  }
}

function selectCity(name, lat, lon, country) {
  input.value = name;
  suggestionsBox.classList.add('hidden');
  fetchWeather(lat, lon, name, country);
}

async function search() {
  const q = input.value.trim();
  if (!q) return;
  showSkeleton(true);
  hideError();
  try {
    const res = await fetch(`${GEO_URL}?name=${encodeURIComponent(q)}&count=1&language=en`);
    const data = await res.json();
    if (!data.results?.length) { showError(); showSkeleton(false); return; }
    const { name, latitude, longitude, country } = data.results[0];
    input.value = name;
    await fetchWeather(latitude, longitude, name, country);
  } catch {
    showError();
    showSkeleton(false);
  }
}

// =====================================================
// WEATHER FETCH
// =====================================================
async function fetchWeather(lat, lon, cityName, country) {
  showSkeleton(true);
  hideError();
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: [
        'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
        'wind_speed_10m', 'wind_direction_10m', 'visibility', 'surface_pressure',
        'weather_code', 'uv_index', 'precipitation'
      ].join(','),
      hourly: ['temperature_2m', 'weather_code', 'precipitation_probability', 'apparent_temperature'].join(','),
      daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset'].join(','),
      timezone: 'auto',
      forecast_days: 5
    });

    const [wRes, aRes] = await Promise.all([
      fetch(`${WEATHER_URL}?${params}`),
      fetch(`${AIR_URL}?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5,pm10&timezone=auto`).catch(() => null)
    ]);

    const data = await wRes.json();
    let air = null;
    if (aRes?.ok) { try { air = await aRes.json(); } catch {} }

    renderWeather(data, cityName, country, air);
  } catch {
    showError();
  }
  showSkeleton(false);
}

// ---------- AQI helper ----------
function aqiLabel(aqi) {
  if (aqi == null) return '—';
  if (aqi <= 50)  return `${aqi} Good`;
  if (aqi <= 100) return `${aqi} Moderate`;
  if (aqi <= 150) return `${aqi} Unhealthy*`;
  if (aqi <= 200) return `${aqi} Unhealthy`;
  if (aqi <= 300) return `${aqi} Very Unhealthy`;
  return `${aqi} Hazardous`;
}

// =====================================================
// RENDER
// =====================================================
function renderWeather(data, cityName, country, air) {
  const c = data.current, d = data.daily, h = data.hourly;

  currentTempC = c.temperature_2m;
  currentFeelsC = c.apparent_temperature;
  currentUnit = 'C';
  syncUnitButtons();

  document.getElementById('cityName').textContent = cityName;
  document.getElementById('countryName').textContent = country || '';

  const info = getWeatherInfo(c.weather_code);
  document.getElementById('weatherEmoji').textContent = info.emoji;
  document.getElementById('weatherDesc').textContent = info.label;
  updateTemps();

  // Stats
  document.getElementById('humidity').textContent = `${c.relative_humidity_2m}%`;
  document.getElementById('wind').textContent = `${Math.round(c.wind_speed_10m)} km/h`;
  document.getElementById('visibility').textContent = `${(c.visibility / 1000).toFixed(1)} km`;
  document.getElementById('pressure').textContent = `${Math.round(c.surface_pressure)} hPa`;
  document.getElementById('uvIndex').textContent = c.uv_index ?? '—';

  // Extra details
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const windDir = dirs[Math.round(c.wind_direction_10m / 45) % 8];
  document.getElementById('windDir').textContent = `${windDir} (${Math.round(c.wind_direction_10m)}°)`;
  document.getElementById('precipitation').textContent = c.precipitation != null ? `${c.precipitation} mm` : '—';

  // Air quality
  if (air?.current) {
    document.getElementById('airQuality').textContent = aqiLabel(air.current.us_aqi);
  } else {
    document.getElementById('airQuality').textContent = '—';
  }

  // Alert banner
  const alertBox = document.getElementById('alertBanner');
  const code = c.weather_code;
  if (code >= 95) {
    alertBox.textContent = '⛈️ Thunderstorm warning — stay indoors if possible.';
    alertBox.classList.remove('hidden');
  } else if ((code >= 65 && code <= 67) || (code >= 81 && code <= 82)) {
    alertBox.textContent = '🌧️ Heavy rain expected — carry an umbrella.';
    alertBox.classList.remove('hidden');
  } else if (code >= 75 && code <= 77) {
    alertBox.textContent = '❄️ Heavy snow warning — travel with caution.';
    alertBox.classList.remove('hidden');
  } else if (c.uv_index >= 8) {
    alertBox.textContent = '☀️ Very high UV — wear sunscreen.';
    alertBox.classList.remove('hidden');
  } else {
    alertBox.classList.add('hidden');
  }

  renderHourly(h);
  renderForecast(d);
  renderSunSchedule(d.sunrise[0], d.sunset[0]);

  document.getElementById('weatherCard').classList.remove('hidden');
  updateBackground(code);
}

// =====================================================
// HOURLY FORECAST
// =====================================================
function renderHourly(hourly) {
  const scroll = document.getElementById('hourlyScroll');
  const now = new Date();
  now.setMinutes(0, 0, 0);

  let startIdx = hourly.time.findIndex(t => new Date(t) >= now);
  if (startIdx < 0) startIdx = 0;

  const slice = 24;
  const items = [];
  for (let i = startIdx; i < Math.min(startIdx + slice, hourly.time.length); i++) {
    const time = new Date(hourly.time[i]);
    const isNow = i === startIdx;
    const label = isNow
      ? 'Now'
      : time.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }).replace(' ', '');
    const info = getWeatherInfo(hourly.weather_code[i]);
    const tempC = hourly.temperature_2m[i];
    const temp = Math.round(currentUnit === 'C' ? tempC : tempC * 9 / 5 + 32);
    const pop = hourly.precipitation_probability?.[i];
    items.push(`
      <div class="hourly-item ${isNow ? 'now' : ''}" data-c="${tempC}">
        <div class="hr-time">${label}</div>
        <span class="hr-emoji">${info.emoji}</span>
        <div class="hr-temp">${temp}°</div>
        ${pop != null && pop > 10 ? `<div class="hr-pop">💧${pop}%</div>` : ''}
      </div>
    `);
  }
  scroll.innerHTML = items.join('');
}

function updateHourlyTemps() {
  document.querySelectorAll('.hourly-item').forEach(el => {
    const c = parseFloat(el.dataset.c);
    const t = Math.round(currentUnit === 'C' ? c : c * 9 / 5 + 32);
    el.querySelector('.hr-temp').textContent = `${t}°`;
  });
}

// =====================================================
// TEMPERATURE UNITS
// =====================================================
function updateTemps() {
  const temp  = currentUnit === 'C' ? currentTempC : toF(currentTempC);
  const feels = currentUnit === 'C' ? currentFeelsC : toF(currentFeelsC);
  const unit  = currentUnit === 'C' ? '°C' : '°F';
  document.getElementById('tempValue').textContent = `${Math.round(temp)}${unit}`;
  document.getElementById('feelsLike').textContent = `${Math.round(feels)}${unit}`;
  updateHourlyTemps();
}
const toF = c => c * 9 / 5 + 32;

function switchUnit(u) {
  currentUnit = u;
  syncUnitButtons();
  updateTemps();
}
function syncUnitButtons() {
  document.getElementById('btnC').classList.toggle('active', currentUnit === 'C');
  document.getElementById('btnF').classList.toggle('active', currentUnit === 'F');
}

// =====================================================
// 5-DAY FORECAST
// =====================================================
function renderForecast(daily) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  document.getElementById('forecastRow').innerHTML = daily.time.map((ds, i) => {
    const day = days[new Date(ds).getDay()];
    const info = getWeatherInfo(daily.weather_code[i]);
    const hi = Math.round(daily.temperature_2m_max[i]);
    const lo = Math.round(daily.temperature_2m_min[i]);
    return `<div class="forecast-item">
      <div class="fc-day">${i === 0 ? 'Today' : day}</div>
      <span class="fc-emoji">${info.emoji}</span>
      <div class="fc-high">${hi}°</div>
      <div class="fc-low">${lo}°</div>
    </div>`;
  }).join('');
}

// =====================================================
// SUN SCHEDULE
// =====================================================
function renderSunSchedule(sr, ss) {
  const fmt = t => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  document.getElementById('sunrise').textContent = fmt(sr);
  document.getElementById('sunset').textContent  = fmt(ss);

  const now = Date.now();
  const rise = new Date(sr).getTime();
  const set = new Date(ss).getTime();
  const pct = Math.min(100, Math.max(0, ((now - rise) / (set - rise)) * 100));
  document.getElementById('sunProgress').style.width = `${pct}%`;
  document.getElementById('sunDot').style.left = `${pct}%`;
}

// =====================================================
// DYNAMIC BACKGROUND
// =====================================================
function updateBackground(code) {
  const b = document.body;
  if ([0, 1].includes(code))
    b.style.background = 'linear-gradient(145deg,#f0f9ff 0%,#bae6fd 40%,#e0f2fe 100%)';
  else if ([2, 3].includes(code))
    b.style.background = 'linear-gradient(145deg,#e2e8f0 0%,#cbd5e1 40%,#e8edf5 100%)';
  else if ([45, 48].includes(code))
    b.style.background = 'linear-gradient(145deg,#f1f5f9 0%,#e2e8f0 40%,#f8fafc 100%)';
  else if (code >= 60 && code <= 82)
    b.style.background = 'linear-gradient(145deg,#dbeafe 0%,#a5b4fc 40%,#e0e7ff 100%)';
  else if (code >= 71 && code <= 77)
    b.style.background = 'linear-gradient(145deg,#f0f9ff 0%,#e0f2fe 40%,#ede9fe 100%)';
  else if (code >= 95)
    b.style.background = 'linear-gradient(145deg,#ede9fe 0%,#c4b5fd 40%,#fce7f3 100%)';
  else
    b.style.background = 'linear-gradient(145deg,#dbeafe 0%,#ede9fe 40%,#fce7f3 100%)';
}

// =====================================================
// HELPERS
// =====================================================
function quickSearch(city) {
  input.value = city;
  search();
}
function showSkeleton(s) {
  document.getElementById('skeleton').classList.toggle('hidden', !s);
  if (s) document.getElementById('weatherCard').classList.add('hidden');
}
function showError() { document.getElementById('errorMsg').classList.remove('hidden'); }
function hideError() { document.getElementById('errorMsg').classList.add('hidden'); }

// =====================================================
// BOOT
// =====================================================
quickSearch('London');
