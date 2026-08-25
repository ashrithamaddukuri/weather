// Using Open-Meteo (free, no API key needed) + Geocoding API
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

let currentTempC = null;
let currentFeelsC = null;
let currentUnit = 'C';

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

function getWeatherInfo(code) {
  return weatherCodes[code] || { label: 'Unknown', emoji: '🌡️' };
}

// Clock
function updateClock() {
  const now = new Date();
  const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  document.getElementById('dateTime').textContent = now.toLocaleString('en-US', opts);
}
updateClock();
setInterval(updateClock, 30000);

// Search input events
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
  suggestionsBox.classList.add('hidden'); search();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-section')) suggestionsBox.classList.add('hidden');
});

async function fetchSuggestions(query) {
  try {
    const res = await fetch(`${GEO_URL}?name=${encodeURIComponent(query)}&count=5&language=en`);
    const data = await res.json();
    if (!data.results) { suggestionsBox.classList.add('hidden'); return; }
    renderSuggestions(data.results);
  } catch { suggestionsBox.classList.add('hidden'); }
}

function renderSuggestions(results) {
  suggestionsBox.innerHTML = results.map(r =>
    `<div class="suggestion-item" onclick="selectCity('${r.name}', ${r.latitude}, ${r.longitude}, '${r.country || ''}')">
      📍 ${r.name}${r.admin1 ? ', ' + r.admin1 : ''}, ${r.country || ''}
    </div>`
  ).join('');
  suggestionsBox.classList.remove('hidden');
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
    if (!data.results || data.results.length === 0) { showError(); showSkeleton(false); return; }
    const { name, latitude, longitude, country } = data.results[0];
    input.value = name;
    await fetchWeather(latitude, longitude, name, country);
  } catch { showError(); showSkeleton(false); }
}

async function fetchWeather(lat, lon, cityName, country) {
  showSkeleton(true);
  hideError();
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: [
        'temperature_2m','apparent_temperature','relative_humidity_2m',
        'wind_speed_10m','visibility','surface_pressure','weather_code','uv_index'
      ].join(','),
      daily: ['weather_code','temperature_2m_max','temperature_2m_min','sunrise','sunset'].join(','),
      timezone: 'auto',
      forecast_days: 5
    });
    const res = await fetch(`${WEATHER_URL}?${params}`);
    const data = await res.json();
    renderWeather(data, cityName, country);
  } catch { showError(); }
  showSkeleton(false);
}

function renderWeather(data, cityName, country) {
  const c = data.current;
  const d = data.daily;

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

  document.getElementById('humidity').textContent = `${c.relative_humidity_2m}%`;
  document.getElementById('wind').textContent = `${Math.round(c.wind_speed_10m)} km/h`;
  document.getElementById('visibility').textContent = `${(c.visibility / 1000).toFixed(1)} km`;
  document.getElementById('pressure').textContent = `${Math.round(c.surface_pressure)} hPa`;
  document.getElementById('uvIndex').textContent = c.uv_index ?? '—';

  renderForecast(d);
  renderSunSchedule(d.sunrise[0], d.sunset[0]);

  document.getElementById('weatherCard').classList.remove('hidden');
  updateBackground(c.weather_code);
}

function updateTemps() {
  const temp    = currentUnit === 'C' ? currentTempC   : toF(currentTempC);
  const feels   = currentUnit === 'C' ? currentFeelsC  : toF(currentFeelsC);
  const unit    = currentUnit === 'C' ? '°C' : '°F';
  document.getElementById('tempValue').textContent  = `${Math.round(temp)}${unit}`;
  document.getElementById('feelsLike').textContent  = `${Math.round(feels)}${unit}`;
}

function toF(c) { return c * 9/5 + 32; }

function switchUnit(unit) {
  currentUnit = unit;
  syncUnitButtons();
  updateTemps();
}

function syncUnitButtons() {
  document.getElementById('btnC').classList.toggle('active', currentUnit === 'C');
  document.getElementById('btnF').classList.toggle('active', currentUnit === 'F');
}

function renderForecast(daily) {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const row = document.getElementById('forecastRow');
  row.innerHTML = daily.time.map((dateStr, i) => {
    const day = days[new Date(dateStr).getDay()];
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

function renderSunSchedule(sunriseISO, sunsetISO) {
  const fmt = t => {
    const d = new Date(t);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };
  document.getElementById('sunrise').textContent = fmt(sunriseISO);
  document.getElementById('sunset').textContent  = fmt(sunsetISO);

  const now  = Date.now();
  const rise = new Date(sunriseISO).getTime();
  const set  = new Date(sunsetISO).getTime();
  const pct  = Math.min(100, Math.max(0, ((now - rise) / (set - rise)) * 100));

  document.getElementById('sunProgress').style.width = `${pct}%`;
  document.getElementById('sunDot').style.left = `${pct}%`;
}

// Dynamic background tint based on weather
function updateBackground(code) {
  const body = document.body;
  body.style.transition = 'background 1.2s ease';
  if ([0, 1].includes(code))
    body.style.background = 'linear-gradient(145deg, #dbeafe 0%, #bfdbfe 40%, #e0f2fe 100%)';
  else if ([2, 3].includes(code))
    body.style.background = 'linear-gradient(145deg, #e2e8f0 0%, #dde9f5 40%, #e8edf5 100%)';
  else if ([45, 48].includes(code))
    body.style.background = 'linear-gradient(145deg, #f1f5f9 0%, #e2e8f0 40%, #f8fafc 100%)';
  else if (code >= 60 && code <= 82)
    body.style.background = 'linear-gradient(145deg, #dbeafe 0%, #c7d2fe 40%, #e0e7ff 100%)';
  else if (code >= 71 && code <= 77)
    body.style.background = 'linear-gradient(145deg, #f0f9ff 0%, #e0f2fe 40%, #f5f3ff 100%)';
  else if (code >= 95)
    body.style.background = 'linear-gradient(145deg, #ede9fe 0%, #ddd6fe 40%, #fce7f3 100%)';
  else
    body.style.background = 'linear-gradient(145deg, #dbeafe 0%, #ede9fe 40%, #fce7f3 100%)';
}

function quickSearch(city) {
  input.value = city;
  search();
}

function showSkeleton(show) {
  document.getElementById('skeleton').classList.toggle('hidden', !show);
  if (show) document.getElementById('weatherCard').classList.add('hidden');
}
function showError()  { document.getElementById('errorMsg').classList.remove('hidden'); }
function hideError()  { document.getElementById('errorMsg').classList.add('hidden'); }

// Load a default city on startup
quickSearch('London');
