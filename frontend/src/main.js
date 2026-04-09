/**
 * SkyCMD v0.1.0 - Main Entry Point
 */
import { WebGLRenderer } from './skymap/webgl-renderer.js';

export const APP_VERSION = '0.1.0';

let renderer;
let animFrame;
let fpsValue = 0;
let framesSinceSample = 0;
let lastSampleTs = 0;
let hoveredObject = null;
let selectedObject = null;
let isDragging = false;
let dragMoved = false;
let lastDragX = 0;
let lastDragY = 0;
let touchIsPanning = false;
let touchLastX = 0;
let touchLastY = 0;
let pinchLastDistance = 0;
let activeHeaderPanel = null;
let searchModalOpen = false;
let searchSuggestions = [];
let activeSuggestionIndex = -1;
let activeSearchRequestId = 0;
let recentSearches = [];
let timeCorrectionInfoOpen = false;
let autoTimeIntervalId = null;
let dateTimeTextFallbackEnabled = false;
let standortResults = [];
let selectedStandortLabel = 'Halle (Saale)';
let selectedLocationInfoOpen = false;
let selectedLocationInfoRequestId = 0;
const selectedLocationTimeZoneCache = new Map();

// Beobachter-Standardwerte (Halle/Saale)
const DEFAULT_LAT = 51.48;
const DEFAULT_LON = 11.97;
const RECENT_SEARCHES_KEY = 'skycmd.recentSearches';
const DISPLAY_SETTINGS_KEY = 'skycmd.displaySettings';
const DATA_SOURCE_SETTINGS_KEY = 'skycmd.dataSourceSettings';
const DISPLAY_OPTION_KEYS = [
  'showPlanets',
  'showComets',
  'showAsteroids',
  'showStars',
  'showDSO',
  'showConstellationLines',
  'showConstellationBoundaries',
  'showConstellationLabels',
  'showCelestialEquator',
  'showMeridian',
  'showEcliptic',
  'showEclipticGrid',
  'showAzimuthGrid',
  'showHorizonLine',
  'showHorizonFill',
  'showCardinalDirections',
  'showStarNames',
  'showDSOLabels',
];
const TLE_PROVIDER_PRESETS = {
  'celestrak-active': 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
  'celestrak-stations': 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
};

async function init() {
  // Version-Badge setzen
  const badge = document.getElementById('version-badge');
  if (badge) badge.textContent = `v${APP_VERSION}`;
  document.title = `SkyCMD ${APP_VERSION}`;

  // Canvas initialisieren
  const canvas = document.getElementById('sky-canvas');
  if (!canvas) { console.error('Canvas #sky-canvas nicht gefunden'); return; }

  renderer = new WebGLRenderer(canvas);
  const initialNow = new Date();
  const datetimeInput = document.getElementById('datetime-input');
  if (datetimeInput) {
    setDateTimeInputValue(datetimeInput, initialNow);
    updateGermanTimeFormat(initialNow);
  }
  resize();
  await renderer.init();
  await initDataSourceControls();
  const initialDateValue = document.getElementById('datetime-input')?.value;
  const initialDate = parseObserverDateTime(initialDateValue);
  renderer.setObserver(DEFAULT_LAT, DEFAULT_LON, initialDate);
  applyDisplaySettings();
  recentSearches = loadRecentSearches();
  renderRecentSearches();

  // Controls
  document.getElementById('lat-input')?.addEventListener('change', updateObserver);
  document.getElementById('lon-input')?.addEventListener('change', updateObserver);
  document.getElementById('standort-apply-btn')?.addEventListener('click', applyManualStandort);
  document.getElementById('standort-search-btn')?.addEventListener('click', runStandortSearch);
  document.getElementById('standort-search-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runStandortSearch();
    }
  });
  document.getElementById('standort-gps-btn')?.addEventListener('click', locateByGps);
  document.getElementById('standort-network-btn')?.addEventListener('click', locateByNetwork);
  document.getElementById('selected-location-info-btn')?.addEventListener('click', toggleSelectedLocationInfo);
  document.getElementById('selected-location-info-btn')?.addEventListener('focus', openSelectedLocationInfo);
  document.getElementById('selected-location-info-btn')?.addEventListener('blur', closeSelectedLocationInfo);
  document.getElementById('selected-location-card')?.addEventListener('mouseenter', openSelectedLocationInfo);
  document.getElementById('selected-location-card')?.addEventListener('mouseleave', closeSelectedLocationInfo);
  document.getElementById('datetime-input')?.addEventListener('input', updateObserver);
  document.getElementById('datetime-input')?.addEventListener('keydown', onDateTimeKeyAdjust);
  document.getElementById('datetime-input')?.addEventListener('click', onDateTimeClick);
  document.getElementById('datetime-now-btn')?.addEventListener('click', setDateTimeToNow);
  document.getElementById('time-auto-toggle')?.addEventListener('change', onAutoTimeToggleChange);
  document.getElementById('time-auto-play-btn')?.addEventListener('click', toggleAutoTime);
  setDateTimeToNow();
  // Manche Embedded-Browser setzen datetime-local erst nach dem ersten Layout korrekt.
  window.setTimeout(() => setDateTimeToNow(), 60);
  window.setTimeout(() => ensureDateTimeInitialized(), 140);
  const autoToggle = document.getElementById('time-auto-toggle');
  setAutoTimeMode(autoToggle ? Boolean(autoToggle.checked) : true);
  updateAutoTimeButton();

  // Suche
  document.getElementById('search-btn')?.addEventListener('click', runSearch);
  document.getElementById('search-reset-btn')?.addEventListener('click', resetView);
  document.getElementById('time-correction-info-btn')?.addEventListener('click', toggleTimeCorrectionInfo);
  document.getElementById('header-search-btn')?.addEventListener('click', toggleSearchPanel);
  document.getElementById('header-atlas-btn')?.addEventListener('click', () => toggleHeaderPanel('atlas'));
    document.getElementById('header-standort-btn')?.addEventListener('click', () => toggleHeaderPanel('standort'));
  document.getElementById('header-layout-btn')?.addEventListener('click', () => toggleHeaderPanel('layout'));
  document.getElementById('header-hardware-btn')?.addEventListener('click', () => toggleHeaderPanel('hardware'));
  document.getElementById('header-properties-btn')?.addEventListener('click', () => toggleHeaderPanel('properties'));
  document.getElementById('search-modal-close')?.addEventListener('click', closeSearchModal);
  document.getElementById('search-include-satellites')?.addEventListener('change', refreshSearchSuggestions);
  document.getElementById('starCatalog')?.addEventListener('change', onStarCatalogChange);
  document.getElementById('catalog-apply-btn')?.addEventListener('click', applyCatalogSelection);
  document.getElementById('sync-tle-btn')?.addEventListener('click', () => triggerFeedSync('satellites_tle', 'TLE'));
  document.getElementById('sync-comets-btn')?.addEventListener('click', () => triggerFeedSync('comets', 'Kometen'));
  document.getElementById('sync-asteroids-btn')?.addEventListener('click', () => triggerFeedSync('asteroids_daily', 'Asteroiden'));
  document.getElementById('sync-all-btn')?.addEventListener('click', triggerSyncAll);
  document.getElementById('default-include-satellites')?.addEventListener('change', onDefaultIncludeSatellitesChange);
  document.getElementById('use-backend-smallbodies')?.addEventListener('change', onUseBackendSmallBodiesChange);
  document.getElementById('tle-provider-save-btn')?.addEventListener('click', saveTleProviderConfig);
  document.getElementById('tle-provider-test-btn')?.addEventListener('click', testTleProviderConfig);
  document.getElementById('tle-provider-select')?.addEventListener('change', onTleProviderSelectChange);
  document.getElementById('search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSuggestionSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSuggestionSelection(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSuggestionIndex >= 0 && searchSuggestions[activeSuggestionIndex]) {
        applySearchResult(searchSuggestions[activeSuggestionIndex]);
      } else {
        runSearch();
      }
      return;
    }
    if (e.key === 'Escape' && searchModalOpen) {
      closeSearchModal();
    }
  });
  document.getElementById('search-input')?.addEventListener('input', onSearchInput);
  window.addEventListener('keydown', onWindowKeyDown);
  document.addEventListener('mousedown', onDocumentMouseDown);

  // Standortanzeige links initialisieren.
  updateSelectedLocationDisplay(DEFAULT_LAT, DEFAULT_LON, selectedStandortLabel);

  // Checkboxen
  DISPLAY_OPTION_KEYS.forEach((key) => {
    document.getElementById(key)?.addEventListener('change', (e) => {
      renderer.options[key] = e.target.checked;
      saveDisplaySettings();
      renderer.render();
    });
  });
  // Explizit fuer kleine Koerper: manche Embedded-Browser liefern bei versteckten Panels
  // nur input-Events. Daher werden beide Event-Typen abgefangen.
  const bindSmallBodyToggle = (id, optKey) => {
    const el = document.getElementById(id);
    if (!el) return;
    const apply = () => {
      renderer.options[optKey] = Boolean(el.checked);
      saveDisplaySettings();
      renderer.render();
    };
    el.addEventListener('change', apply);
    el.addEventListener('input', apply);
  };
  bindSmallBodyToggle('showComets', 'showComets');
  bindSmallBodyToggle('showAsteroids', 'showAsteroids');

  // Magnitude Slider
  document.getElementById('mag-limit')?.addEventListener('input', (e) => {
    renderer.options.magLimit = parseFloat(e.target.value);
    saveDisplaySettings();
    renderer.render();
  });

  // Resize
  window.addEventListener('resize', () => { resize(); renderer.render(); });

  // Hover + Klick
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mouseleave', onCanvasMouseLeave);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('dblclick', onCanvasDoubleClick);
  canvas.addEventListener('mousedown', onCanvasMouseDown);
  window.addEventListener('mouseup', onCanvasMouseUp);
  canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
  canvas.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onCanvasTouchMove, { passive: false });
  canvas.addEventListener('touchend', onCanvasTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onCanvasTouchEnd, { passive: false });

  // Render-Loop + Status
  startRenderLoop();

  // Live-Uhr: jede Minute neu rendern
  setInterval(() => {
    if (!document.getElementById('datetime-input')?.value) {
      renderer.setObserver(DEFAULT_LAT, DEFAULT_LON, new Date());
    }
  }, 60000);

  console.log(`SkyCMD ${APP_VERSION} bereit.`);
}

function updateObserver() {
  const parsedCoords = parseAndValidateCoordinates(
    document.getElementById('lat-input')?.value,
    document.getElementById('lon-input')?.value,
  );
  const lat = parsedCoords ? parsedCoords.lat : DEFAULT_LAT;
  const lon = parsedCoords ? parsedCoords.lon : DEFAULT_LON;
  const dtVal = document.getElementById('datetime-input')?.value;
  const date = parseObserverDateTime(dtVal);
  renderer.setObserver(lat, lon, date);
  updateGermanTimeFormat(date);
}

function setStandortSearchStatus(message) {
  const status = document.getElementById('standort-search-status');
  if (status) status.textContent = message;
}

function setStandortAutoStatus(message) {
  const status = document.getElementById('standort-auto-status');
  if (status) status.textContent = message;
}

function updateSelectedLocationDisplay(lat, lon, label) {
  const target = document.getElementById('selected-location-display');
  if (!target) return;
  const latText = formatDms(lat, 'lat');
  const lonText = formatDms(lon, 'lon');
  const name = String(label || '').trim();
  target.textContent = name || `${latText} · ${lonText}`;
  target.title = `${latText} · ${lonText}`;
  const coordsTarget = document.getElementById('selected-location-coords');
  if (coordsTarget) coordsTarget.textContent = `${latText} · ${lonText}`;
  refreshSelectedLocationTimeZone(lat, lon);
}

async function resolveSelectedLocationTimeZone(lat, lon) {
  const key = `${Math.round(Number(lat) * 1000) / 1000},${Math.round(Number(lon) * 1000) / 1000}`;
  if (selectedLocationTimeZoneCache.has(key)) {
    return selectedLocationTimeZoneCache.get(key);
  }
  try {
    const url = `https://timeapi.io/api/TimeZone/coordinate?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const tz = String(payload?.timeZone || payload?.timezone || '').trim();
    if (!tz) throw new Error('No timezone');
    selectedLocationTimeZoneCache.set(key, tz);
    return tz;
  } catch {
    const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unbekannt';
    selectedLocationTimeZoneCache.set(key, fallback);
    return fallback;
  }
}

async function refreshSelectedLocationTimeZone(lat, lon) {
  const tzTarget = document.getElementById('selected-location-timezone');
  if (!tzTarget) return;
  const reqId = ++selectedLocationInfoRequestId;
  tzTarget.textContent = 'Ermittle...';
  const tz = await resolveSelectedLocationTimeZone(lat, lon);
  if (reqId !== selectedLocationInfoRequestId) return;
  tzTarget.textContent = tz;
}

function openSelectedLocationInfo() {
  const panel = document.getElementById('selected-location-info');
  const button = document.getElementById('selected-location-info-btn');
  if (!panel || !button) return;
  selectedLocationInfoOpen = true;
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
}

function closeSelectedLocationInfo() {
  const panel = document.getElementById('selected-location-info');
  const button = document.getElementById('selected-location-info-btn');
  selectedLocationInfoOpen = false;
  if (panel) panel.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
}

function toggleSelectedLocationInfo(event) {
  event?.stopPropagation();
  if (selectedLocationInfoOpen) {
    closeSelectedLocationInfo();
    return;
  }
  openSelectedLocationInfo();
}

function formatDms(value, kind) {
  const abs = Math.abs(Number(value));
  if (!Number.isFinite(abs)) return '';

  let deg = Math.floor(abs);
  let minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat);
  let sec = (minFloat - min) * 60;

  sec = Math.round(sec * 100) / 100;
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }

  const hemi = kind === 'lat'
    ? (value < 0 ? 'S' : 'N')
    : (value < 0 ? 'W' : 'E');

  return `${deg}° ${String(min).padStart(2, '0')}' ${sec.toFixed(2).padStart(5, '0')}" ${hemi}`;
}

function parseCoordinateValue(raw, kind) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  // Support decimal input as fallback (e.g. 51.48)
  const decimal = Number(text.replace(',', '.'));
  if (Number.isFinite(decimal)) {
    const limit = kind === 'lat' ? 90 : 180;
    if (decimal < -limit || decimal > limit) return null;
    return decimal;
  }

  // DMS examples: 51° 28' 48" N | 11 58 12 E | -11°58'12"
  const upper = text.toUpperCase().replace(',', '.').replace(/[º]/g, '°');
  const hemiMatch = upper.match(/[NSEW]/);
  const hemi = hemiMatch ? hemiMatch[0] : null;
  const nums = upper.match(/[-+]?\d+(?:\.\d+)?/g) || [];
  if (!nums.length) return null;

  const degRaw = Number(nums[0]);
  const minRaw = nums.length > 1 ? Number(nums[1]) : 0;
  const secRaw = nums.length > 2 ? Number(nums[2]) : 0;
  if (!Number.isFinite(degRaw) || !Number.isFinite(minRaw) || !Number.isFinite(secRaw)) return null;
  if (minRaw < 0 || minRaw >= 60 || secRaw < 0 || secRaw >= 60) return null;

  let sign = degRaw < 0 ? -1 : 1;
  if (hemi) {
    sign = (hemi === 'S' || hemi === 'W') ? -1 : 1;
  }

  const absDeg = Math.abs(degRaw) + (minRaw / 60) + (secRaw / 3600);
  const result = sign * absDeg;
  const limit = kind === 'lat' ? 90 : 180;
  if (result < -limit || result > limit) return null;
  if (kind === 'lat' && (hemi === 'E' || hemi === 'W')) return null;
  if (kind === 'lon' && (hemi === 'N' || hemi === 'S')) return null;
  return result;
}

function parseAndValidateCoordinates(latRaw, lonRaw) {
  const lat = parseCoordinateValue(latRaw, 'lat');
  const lon = parseCoordinateValue(lonRaw, 'lon');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function applyCoordinates(lat, lon, message, label) {
  const coord = parseAndValidateCoordinates(lat, lon);
  if (!coord) {
    setStandortAutoStatus('Ungültige Koordinaten.');
    return;
  }
  const latInput = document.getElementById('lat-input');
  const lonInput = document.getElementById('lon-input');
  if (latInput) latInput.value = formatDms(coord.lat, 'lat');
  if (lonInput) lonInput.value = formatDms(coord.lon, 'lon');
  selectedStandortLabel = String(label || '').trim();
  updateSelectedLocationDisplay(coord.lat, coord.lon, selectedStandortLabel);
  updateObserver();
  if (message) setStandortAutoStatus(message);
}

function applyManualStandort() {
  const latRaw = document.getElementById('lat-input')?.value;
  const lonRaw = document.getElementById('lon-input')?.value;
  const coord = parseAndValidateCoordinates(latRaw, lonRaw);
  if (!coord) {
    setStandortAutoStatus('Bitte gültige Breite/Länge eingeben.');
    return;
  }
  applyCoordinates(coord.lat, coord.lon, 'Standort aus manuellen Koordinaten übernommen.', 'Manueller Standort');
}

function renderStandortResults() {
  const container = document.getElementById('standort-search-results');
  if (!container) return;
  if (!standortResults.length) {
    container.innerHTML = '<div class="search-empty">Keine Treffer gefunden.</div>';
    return;
  }
  container.innerHTML = standortResults.map((item, index) => `<button type="button" class="search-item" data-standort-index="${index}" role="option">
      <span class="search-item__meta">
        <span class="search-item__title">${escapeHtml(item.name)}</span>
        <span class="search-item__subtitle">${escapeHtml(formatDms(item.lat, 'lat'))} · ${escapeHtml(formatDms(item.lon, 'lon'))}</span>
      </span>
      <span class="search-item__kind">Ort</span>
    </button>`).join('');
  container.querySelectorAll('[data-standort-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-standort-index'));
      const item = standortResults[index];
      if (!item) return;
      applyCoordinates(item.lat, item.lon, `Standort gesetzt: ${item.name}`, item.name);
      setStandortSearchStatus(`Treffer übernommen: ${item.name}`);
    });
  });
}

async function runStandortSearch() {
  const input = document.getElementById('standort-search-input');
  const query = input?.value?.trim();
  if (!query) {
    setStandortSearchStatus('Bitte einen Ort eingeben.');
    return;
  }
  setStandortSearchStatus('Suche läuft...');
  standortResults = [];
  renderStandortResults();

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'de',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    standortResults = Array.isArray(rows)
      ? rows.map((row) => ({
        name: String(row.display_name || '').trim(),
        lat: Number(row.lat),
        lon: Number(row.lon),
      })).filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon) && row.name)
      : [];
    if (!standortResults.length) {
      setStandortSearchStatus(`Keine Orte zu "${query}" gefunden.`);
      renderStandortResults();
      return;
    }
    setStandortSearchStatus(`${standortResults.length} Treffer gefunden.`);
    renderStandortResults();
  } catch (error) {
    setStandortSearchStatus(`Ortsdatenbank nicht erreichbar (${error?.message || 'Fehler'}).`);
    standortResults = [];
    renderStandortResults();
  }
}

function locateByGps() {
  if (!navigator.geolocation) {
    setStandortAutoStatus('GPS im Browser nicht verfügbar.');
    return;
  }
  setStandortAutoStatus('GPS-Ortung läuft...');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position?.coords?.latitude;
      const lon = position?.coords?.longitude;
      applyCoordinates(lat, lon, 'Standort per GPS übernommen.', 'GPS-Standort');
    },
    (err) => {
      setStandortAutoStatus(`GPS-Ortung fehlgeschlagen: ${err?.message || 'Unbekannter Fehler'}`);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 },
  );
}

async function locateByNetwork() {
  setStandortAutoStatus('Netzwerk-Ortung läuft...');
  const providers = [
    async () => {
      const res = await fetch('https://ipapi.co/json/');
      if (!res.ok) throw new Error(`ipapi HTTP ${res.status}`);
      const row = await res.json();
      return {
        lat: Number(row.latitude),
        lon: Number(row.longitude),
        source: row.city ? `${row.city} (ipapi)` : 'ipapi',
      };
    },
    async () => {
      const res = await fetch('https://ipwho.is/');
      if (!res.ok) throw new Error(`ipwho.is HTTP ${res.status}`);
      const row = await res.json();
      if (row.success === false) throw new Error('ipwho.is no success');
      return {
        lat: Number(row.latitude),
        lon: Number(row.longitude),
        source: row.city ? `${row.city} (ipwho.is)` : 'ipwho.is',
      };
    },
  ];

  for (const provider of providers) {
    try {
      const result = await provider();
      if (!parseAndValidateCoordinates(result.lat, result.lon)) continue;
      applyCoordinates(result.lat, result.lon, `Standort über Netzwerk übernommen: ${result.source}`, result.source);
      return;
    } catch {
      // try next provider
    }
  }
  setStandortAutoStatus('Netzwerk-Ortung nicht möglich.');
}

function ensureDateTimeInitialized() {
  const input = document.getElementById('datetime-input');
  if (!input) return;
  if (!input.value || Number.isNaN(parseObserverDateTime(input.value).getTime())) {
    setDateTimeInputValue(input, new Date());
  }
  updateObserver();
}

function setDateTimeToNow() {
  const input = document.getElementById('datetime-input');
  if (!input) return;
  // Preserve cursor position when auto-timer updates value while user is in the field.
  // Restore is deferred via requestAnimationFrame because the browser moves the cursor
  // to the end asynchronously after input.value is assigned.
  const isFocused = document.activeElement === input;
  const selStart = isFocused ? input.selectionStart : null;
  const selEnd   = isFocused ? input.selectionEnd   : null;
  setDateTimeInputValue(input, new Date());
  if (isFocused && selStart !== null) {
    requestAnimationFrame(() => {
      if (document.activeElement === input) {
        input.setSelectionRange(selStart, selEnd);
      }
    });
  }
  updateObserver();
}

function onAutoTimeToggleChange(event) {
  const enabled = Boolean(event?.target?.checked);
  setAutoTimeMode(enabled);
}

function setAutoTimeMode(enabled) {
  if (autoTimeIntervalId) {
    window.clearInterval(autoTimeIntervalId);
    autoTimeIntervalId = null;
  }
  if (!enabled) return;

  autoTimeIntervalId = window.setInterval(() => {
    setDateTimeToNow();
  }, 1000);
}

function toggleAutoTime() {
  const isRunning = autoTimeIntervalId !== null;
  setAutoTimeMode(!isRunning);
  updateAutoTimeButton();
}

function updateAutoTimeButton() {
  const btn = document.getElementById('time-auto-play-btn');
  if (!btn) return;
  const isRunning = autoTimeIntervalId !== null;
  btn.textContent = isRunning ? '⏸' : '▶';
  btn.setAttribute('aria-label', isRunning ? 'Zeit-Ablauf pausieren' : 'Zeit-Ablauf starten');
}

// Selection ranges per segment in "TT.MM.JJJJ HH:MM:SS MEZ"
// e.g. "09.04.2026 22:49:03 MESZ"
//       0123456789012345678901234
const SEGMENT_RANGES = {
  day:    [0,  2],
  month:  [3,  5],
  year:   [6,  10],
  hour:   [11, 13],
  minute: [14, 16],
  second: [17, 19],
};

function inferStepUnitFromCursor(input) {
  const start = Number.isFinite(input.selectionStart) ? input.selectionStart : -1;
  // Format: TT.MM.JJJJ HH:MM:SS MEZ
  if (start >= 17) return 'second';
  if (start >= 14) return 'minute';
  if (start >= 11) return 'hour';
  if (start >= 6) return 'year';
  if (start >= 3) return 'month';
  return 'day';
}

// When user clicks into the datetime field, snap-select the whole segment they clicked on.
function onDateTimeClick(event) {
  const input = event.currentTarget;
  const unit = inferStepUnitFromCursor(input);
  const range = SEGMENT_RANGES[unit];
  if (range) input.setSelectionRange(range[0], range[1]);
}

function onDateTimeKeyAdjust(event) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();

  const input = document.getElementById('datetime-input');
  if (!input) return;
  const unit = inferStepUnitFromCursor(input);

  const current = parseObserverDateTime(input.value);

  // Manuelle Zeitschritte pausieren den Auto-Modus, damit Eingaben nicht sofort ueberschrieben werden.
  if (autoTimeIntervalId !== null) {
    setAutoTimeMode(false);
    updateAutoTimeButton();
  }

  const delta = event.key === 'ArrowUp' ? 1 : -1;

  // Use millisecond arithmetic so overflows cascade automatically (60s → +1min, 60min → +1h, etc.)
  const MS = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };
  let adjusted;
  if (unit === 'month') {
    adjusted = new Date(current);
    adjusted.setMonth(adjusted.getMonth() + delta);
  } else if (unit === 'year') {
    adjusted = new Date(current);
    adjusted.setFullYear(adjusted.getFullYear() + delta);
  } else {
    adjusted = new Date(current.getTime() + delta * (MS[unit] || MS.minute));
  }

  input.value = toDateTimeLocalValue(adjusted);
  // Restore cursor to the same segment after browser defers the cursor-end jump
  const range = SEGMENT_RANGES[unit];
  if (range) requestAnimationFrame(() => input.setSelectionRange(range[0], range[1]));
  updateObserver();
}

function parseObserverDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date();

  // ISO local mit T oder Leerzeichen, optional Sekunden.
  const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (isoLike) {
    const normalized = `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}T${isoLike[4]}:${isoLike[5]}:${isoLike[6] || '00'}`;
    const parsedIso = new Date(normalized);
    if (!Number.isNaN(parsedIso.getTime())) return parsedIso;
  }

  // Deutsches Anzeigeformat: dd.mm.yyyy hh:mm[:ss] [MEZ/MESZ]
  const germanLike = raw.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(MEZ|MESZ)?$/);
  if (germanLike) {
    const day = String(germanLike[1]).padStart(2, '0');
    const month = String(germanLike[2]).padStart(2, '0');
    const year = germanLike[3];
    const hour = String(germanLike[4]).padStart(2, '0');
    const minute = germanLike[5];
    const second = germanLike[6] || '00';
    const suffix = germanLike[7]; // 'MEZ', 'MESZ', or undefined
    // Use explicit UTC offset so parsing is always unambiguous regardless of system timezone
    let offset;
    if (suffix === 'MESZ') {
      offset = '+02:00';
    } else if (suffix === 'MEZ') {
      offset = '+01:00';
    } else {
      // Auto-detect: probe noon UTC on that day (noon avoids DST-switch edge cases)
      const probe = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), 12));
      offset = getBerlinTimeZoneLabel(probe) === 'MESZ' ? '+02:00' : '+01:00';
    }
    const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
    const parsedGerman = new Date(normalized);
    if (!Number.isNaN(parsedGerman.getTime())) return parsedGerman;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return new Date();
}

function getBerlinTimeZoneLabel(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 'MEZ';
  // Compute the actual UTC offset for Europe/Berlin at the given instant by comparing
  // the numerical local time in Berlin vs UTC. en-US gives consistent MM/DD/YYYY format.
  try {
    const berlinMs = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Berlin' })).getTime();
    const utcMs = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    const offsetHours = Math.round((berlinMs - utcMs) / 3600000);
    return offsetHours >= 2 ? 'MESZ' : 'MEZ';
  } catch {
    // Fallback: rough DST check via UTC month (MESZ: last Sunday March – last Sunday October)
    const m = d.getUTCMonth() + 1; // 1-12
    if (m > 3 && m < 10) return 'MESZ';
    if (m === 3) {
      const lastSunMarch = new Date(Date.UTC(d.getUTCFullYear(), 2, 31));
      lastSunMarch.setUTCDate(31 - lastSunMarch.getUTCDay());
      return d >= lastSunMarch ? 'MESZ' : 'MEZ';
    }
    if (m === 10) {
      const lastSunOct = new Date(Date.UTC(d.getUTCFullYear(), 9, 31));
      lastSunOct.setUTCDate(31 - lastSunOct.getUTCDay());
      return d < lastSunOct ? 'MESZ' : 'MEZ';
    }
    return 'MEZ';
  }
}

function updateGermanTimeFormat(date) {
  // Timezone ist jetzt direkt in der Zeit eingebunden, diese Funktion ist nicht mehr nötig
}

function resize() {
  const container = document.getElementById('map-container');
  if (!container || !renderer) return;
  const width = Math.max(320, (container.clientWidth || window.innerWidth - 280) - 16);
  const height = Math.max(320, (container.clientHeight || window.innerHeight - 60) - 16);
  renderer.resize(width, height);
}

function startRenderLoop() {
  const loop = (ts) => {
    if (!renderer) return;
    renderer.render();

    framesSinceSample += 1;
    if (!lastSampleTs) lastSampleTs = ts;
    if (ts - lastSampleTs >= 1000) {
      fpsValue = Math.round((framesSinceSample * 1000) / (ts - lastSampleTs));
      framesSinceSample = 0;
      lastSampleTs = ts;
    }

    updateStatusOverlay();
    animFrame = requestAnimationFrame(loop);
  };

  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = requestAnimationFrame(loop);
}

function updateStatusOverlay() {
  const stats = renderer.getStats();
  const safeRenderMs = Number.isFinite(stats.renderMs) ? stats.renderMs : 0;
  const safeFovDeg = Number.isFinite(stats.fovDeg) ? stats.fovDeg : 0;
  const safeDeltaT = Number.isFinite(stats.deltaTSeconds) ? stats.deltaTSeconds : 0;
  const canvas = document.getElementById('sky-canvas');
  const renderMsEl = document.getElementById('stat-render-ms');
  const fpsEl = document.getElementById('stat-fps');
  const starsEl = document.getElementById('stat-stars');
  const dsoEl = document.getElementById('stat-dso');
  const selectedEl = document.getElementById('stat-selected');
  const fovEl = document.getElementById('stat-fov');
  const modeEl = document.getElementById('stat-mode');
  if (renderMsEl) renderMsEl.textContent = `${safeRenderMs.toFixed(1)} ms`;
  if (fpsEl) fpsEl.textContent = String(fpsValue);
  if (starsEl) starsEl.textContent = `${stats.visibleStars} / ${stats.totalStars}`;
  if (dsoEl) dsoEl.textContent = `${stats.visibleDSO} / ${stats.totalDSO}`;
  if (selectedEl) selectedEl.textContent = selectedObject?.label || '-';
  if (fovEl) fovEl.textContent = `${safeFovDeg.toFixed(1)} deg`;
  if (modeEl) modeEl.textContent = stats.projectionMode;
  const propertyProjectionEl = document.getElementById('property-projection');
  const propertyFovEl = document.getElementById('property-fov');
  const propertyDeltaTEl = document.getElementById('property-delta-t');
  const propertyUtEl = document.getElementById('property-ut');
  const propertyTtEl = document.getElementById('property-tt');
  const propertySelectionEl = document.getElementById('property-selection');
  const timeCorrectionDeltaDisplayEl = document.getElementById('time-correction-delta-display');
  const utCompact = formatIsoCompact(stats.utIso);
  const ttCompact = formatIsoCompact(stats.ttIso);
  if (propertyProjectionEl) propertyProjectionEl.textContent = stats.projectionMode;
  if (propertyFovEl) propertyFovEl.textContent = `${safeFovDeg.toFixed(1)} deg`;
  if (propertyDeltaTEl) propertyDeltaTEl.textContent = `${safeDeltaT.toFixed(2)} s`;
  if (propertyUtEl) propertyUtEl.textContent = utCompact;
  if (propertyTtEl) propertyTtEl.textContent = ttCompact;
  if (propertySelectionEl) propertySelectionEl.textContent = selectedObject?.label || '-';
  if (timeCorrectionDeltaDisplayEl) timeCorrectionDeltaDisplayEl.textContent = `ΔT ${safeDeltaT.toFixed(2)} s`;

  if (canvas) {
    canvas.classList.toggle('is-transition', stats.planarBlend > 0.12 && stats.planarBlend <= 0.85);
    canvas.classList.toggle('is-planar', stats.planarBlend > 0.85);
  }
}

function focusSearchPanel() {
  const input = document.getElementById('search-input');
  if (input) {
    input.focus();
    input.select();
  }
  refreshSearchSuggestions();
}

function toggleSearchPanel() {
  if (searchModalOpen) {
    closeSearchModal();
    return;
  }
  openSearchModal();
  focusSearchPanel();
}

function openSearchModal() {
  const modal = document.getElementById('search-modal');
  const button = document.getElementById('header-search-btn');
  if (!modal) return;
  if (searchModalOpen) return;
  searchModalOpen = true;
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('is-open'));
  modal.setAttribute('aria-hidden', 'false');
  if (button) {
    button.classList.add('is-active');
    button.setAttribute('aria-expanded', 'true');
  }
  activeHeaderPanel = null;
  setHeaderPanelVisibility('atlas', false);
  setHeaderPanelVisibility('layout', false);
  setHeaderPanelVisibility('hardware', false);
  setHeaderPanelVisibility('properties', false);
  loadAndDisplaySearchDataInfo();
  refreshSearchSuggestions();
  renderRecentSearches();
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal');
  const button = document.getElementById('header-search-btn');
  if (!modal) return;
  if (!searchModalOpen && modal.hidden) return;
  searchModalOpen = false;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    if (!searchModalOpen) modal.hidden = true;
  }, 180);
  if (button) {
    button.classList.remove('is-active');
    button.setAttribute('aria-expanded', 'false');
  }
  activeSuggestionIndex = -1;
}

function onDocumentMouseDown(event) {
  const infoPanel = document.getElementById('time-correction-info');
  const infoButton = document.getElementById('time-correction-info-btn');
  const locationInfoPanel = document.getElementById('selected-location-info');
  const locationInfoButton = document.getElementById('selected-location-info-btn');
  const locationInfoCard = document.getElementById('selected-location-card');
  const target = event.target;
  if (timeCorrectionInfoOpen && !infoPanel?.contains(target) && !infoButton?.contains(target)) {
    closeTimeCorrectionInfo();
  }
  if (selectedLocationInfoOpen
    && !locationInfoPanel?.contains(target)
    && !locationInfoButton?.contains(target)
    && !locationInfoCard?.contains(target)) {
    closeSelectedLocationInfo();
  }
  if (!searchModalOpen) return;
  const modal = document.getElementById('search-modal');
  const trigger = document.getElementById('header-search-btn');
  if (modal?.contains(target) || trigger?.contains(target)) return;
  closeSearchModal();
}

function onWindowKeyDown(event) {
  if (event.key === 'Escape') {
    if (timeCorrectionInfoOpen) closeTimeCorrectionInfo();
    if (selectedLocationInfoOpen) closeSelectedLocationInfo();
    if (searchModalOpen) closeSearchModal();
    if (activeHeaderPanel) toggleHeaderPanel(activeHeaderPanel);
  }
}

function toggleTimeCorrectionInfo(event) {
  event?.stopPropagation();
  if (timeCorrectionInfoOpen) {
    closeTimeCorrectionInfo();
    return;
  }
  const infoPanel = document.getElementById('time-correction-info');
  const infoButton = document.getElementById('time-correction-info-btn');
  if (!infoPanel || !infoButton) return;
  timeCorrectionInfoOpen = true;
  infoPanel.hidden = false;
  infoButton.setAttribute('aria-expanded', 'true');
}

function closeTimeCorrectionInfo() {
  const infoPanel = document.getElementById('time-correction-info');
  const infoButton = document.getElementById('time-correction-info-btn');
  timeCorrectionInfoOpen = false;
  if (infoPanel) infoPanel.hidden = true;
  if (infoButton) infoButton.setAttribute('aria-expanded', 'false');
}

function setHeaderPanelVisibility(panelName, visible) {
  const mappings = {
    standort: {
      panel: document.getElementById('standort-panel'),
      button: document.getElementById('header-standort-btn'),
    },
    atlas: {
      panel: document.getElementById('atlas-panel'),
      button: document.getElementById('header-atlas-btn'),
    },
    layout: {
      panel: document.getElementById('layout-panel'),
      button: document.getElementById('header-layout-btn'),
    },
    hardware: {
      panel: document.getElementById('hardware-panel'),
      button: document.getElementById('header-hardware-btn'),
    },
    properties: {
      panel: document.getElementById('properties-panel'),
      button: document.getElementById('header-properties-btn'),
    },
  };
  const target = mappings[panelName];
  if (!target) return;
  target.panel.hidden = !visible;
  target.button.classList.toggle('is-active', visible);
  target.button.setAttribute('aria-expanded', visible ? 'true' : 'false');
}

function toggleHeaderPanel(panelName) {
  const nextState = activeHeaderPanel === panelName ? null : panelName;
  closeSearchModal();
  activeHeaderPanel = nextState;
  setHeaderPanelVisibility('standort', nextState === 'standort');
  setHeaderPanelVisibility('atlas', nextState === 'atlas');
  setHeaderPanelVisibility('layout', nextState === 'layout');
  setHeaderPanelVisibility('hardware', nextState === 'hardware');
  setHeaderPanelVisibility('properties', nextState === 'properties');
  if (nextState === 'properties') {
    refreshBackendSyncStatus();
  }
}

function canvasRelativePosition(event) {
  const rect = event.target.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function formatObjectTooltip(obj) {
  const kind = obj.kind === 'star'
    ? 'Stern'
    : (obj.kind === 'planet'
      ? 'Planet'
      : (obj.kind === 'comet'
        ? 'Komet'
        : (obj.kind === 'asteroid' ? 'Asteroid' : 'DSO')));
  const symbol = obj.kind === 'planet' && obj.symbol ? `${obj.symbol} ` : '';
  const mag = Number.isFinite(obj.mag) ? `Mag ${obj.mag.toFixed(2)}` : 'Mag n/a';
  const distance = Number.isFinite(obj.distanceKm)
    ? `${Math.round(obj.distanceKm).toLocaleString('de-DE')} km`
    : (Number.isFinite(obj.distanceAu) ? `${obj.distanceAu.toFixed(3)} AU` : null);
  const distanceLine = distance ? `<br>Dist ${distance}` : '';
  const id = obj.id ? `(${obj.id})` : '';
  return `${kind} ${id}<br>${symbol}${obj.label}<br>${mag}${distanceLine}`;
}

function showTooltip(clientX, clientY, html) {
  const tooltip = document.getElementById('object-tooltip');
  if (!tooltip) return;
  tooltip.innerHTML = html;
  tooltip.style.left = `${clientX + 14}px`;
  tooltip.style.top = `${clientY + 14}px`;
  tooltip.classList.add('is-visible');
}

function hideTooltip() {
  const tooltip = document.getElementById('object-tooltip');
  if (!tooltip) return;
  tooltip.classList.remove('is-visible');
}

function onCanvasMouseMove(event) {
  if (!renderer) return;

  if (isDragging) {
    const dx = event.clientX - lastDragX;
    const dy = event.clientY - lastDragY;
    lastDragX = event.clientX;
    lastDragY = event.clientY;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      dragMoved = true;
      renderer.panByPixels(dx, dy);
      hideTooltip();
    }
    return;
  }

  const pos = canvasRelativePosition(event);
  hoveredObject = renderer.pickObjectAt(pos.x, pos.y, 12);
  if (!hoveredObject) {
    hideTooltip();
    return;
  }
  showTooltip(event.clientX, event.clientY, formatObjectTooltip(hoveredObject));
}

function onCanvasMouseLeave() {
  hoveredObject = null;
  hideTooltip();
}

function onCanvasClick(event) {
  if (!renderer) return;
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  const pos = canvasRelativePosition(event);
  const hit = renderer.pickObjectAt(pos.x, pos.y, 14);
  if (!hit) return;
  selectedObject = hit;
  renderer.setSelectedObject(hit);
  updateSearchStatus(`Ausgewaehlt: ${hit.label}`);
}

function onCanvasDoubleClick(event) {
  if (!renderer) return;
  event.preventDefault();
  const pos = canvasRelativePosition(event);
  renderer.centerOnScreenPoint(pos.x, pos.y);
  updateSearchStatus('Ansicht auf Doppelklick zentriert.');
}

function onCanvasMouseDown(event) {
  if (event.button !== 0) return;
  isDragging = true;
  dragMoved = false;
  lastDragX = event.clientX;
  lastDragY = event.clientY;
  const canvas = document.getElementById('sky-canvas');
  if (canvas) canvas.style.cursor = 'grabbing';
}

function onCanvasMouseUp() {
  isDragging = false;
  const canvas = document.getElementById('sky-canvas');
  if (canvas) canvas.style.cursor = 'grab';
}

function onCanvasWheel(event) {
  event.preventDefault();
  if (!renderer) return;
  const factor = Math.exp(-event.deltaY * 0.0015);
  renderer.zoomByFactor(factor);
}

function touchDistance(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

function onCanvasTouchStart(event) {
  if (!renderer) return;
  if (event.touches.length === 1) {
    const t = event.touches[0];
    touchIsPanning = true;
    touchLastX = t.clientX;
    touchLastY = t.clientY;
    pinchLastDistance = 0;
  } else if (event.touches.length >= 2) {
    touchIsPanning = false;
    pinchLastDistance = touchDistance(event.touches[0], event.touches[1]);
  }
  event.preventDefault();
}

function onCanvasTouchMove(event) {
  if (!renderer) return;
  if (event.touches.length === 1 && touchIsPanning) {
    const t = event.touches[0];
    const dx = t.clientX - touchLastX;
    const dy = t.clientY - touchLastY;
    touchLastX = t.clientX;
    touchLastY = t.clientY;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      renderer.panByPixels(dx, dy);
      hideTooltip();
    }
  } else if (event.touches.length >= 2) {
    const d = touchDistance(event.touches[0], event.touches[1]);
    if (pinchLastDistance > 0) {
      const factor = d / pinchLastDistance;
      renderer.zoomByFactor(factor);
    }
    pinchLastDistance = d;
    touchIsPanning = false;
  }
  event.preventDefault();
}

function onCanvasTouchEnd(event) {
  if (!renderer) return;
  if (event.touches.length === 0) {
    touchIsPanning = false;
    pinchLastDistance = 0;
  } else if (event.touches.length === 1) {
    const t = event.touches[0];
    touchIsPanning = true;
    touchLastX = t.clientX;
    touchLastY = t.clientY;
    pinchLastDistance = 0;
  }
  event.preventDefault();
}

async function runSearch() {
  const input = document.getElementById('search-input');
  const query = input?.value?.trim();
  if (!query) {
    updateSearchStatus('Bitte Suchbegriff eingeben.');
    return;
  }

  let result = activeSuggestionIndex >= 0 && searchSuggestions[activeSuggestionIndex]
    ? searchSuggestions[activeSuggestionIndex]
    : renderer.findObject(query);
  if (!result) {
    const remote = await fetchBackendSearchSuggestions(query, 1);
    result = remote[0] || null;
  }
  if (!result) {
    updateSearchStatus(`Kein Treffer fuer "${query}".`);
    await refreshSearchSuggestions();
    return;
  }

  applySearchResult(result);
}

function resetView() {
  renderer.resetView();
  selectedObject = null;
  renderer.setSelectedObject(null);
  updateSearchStatus('Ansicht zurueckgesetzt.');
}

function updateSearchStatus(message) {
  const status = document.getElementById('search-status');
  if (status) status.textContent = message;
}

function onSearchInput() {
  refreshSearchSuggestions();
}

async function fetchBackendSearchSuggestions(query, limit = 12) {
  const q = String(query || '').trim();
  if (!q) return [];

  const date = parseObserverDateTime(document.getElementById('datetime-input')?.value);
  const datetimeIso = date.toISOString();
  const includeSatellites = Boolean(document.getElementById('search-include-satellites')?.checked);
  const url = `/api/solar-system/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}&datetime_iso=${encodeURIComponent(datetimeIso)}&include_satellites=${includeSatellites ? 'true' : 'false'}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const payload = await res.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item) => ({
      kind: String(item?.kind || '').toLowerCase(),
      id: String(item?.id || '').trim(),
      label: String(item?.label || item?.name || item?.id || '').trim(),
      name: String(item?.name || item?.label || item?.id || '').trim(),
      mag: Number.isFinite(Number(item?.mag)) ? Number(item.mag) : undefined,
      distanceAu: Number.isFinite(Number(item?.distanceAu)) ? Number(item.distanceAu) : undefined,
      ra: Number(item?.ra),
      dec: Number(item?.dec),
      hasPosition: item?.hasPosition === true,
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : 0,
      source: 'backend',
    })).filter((item) => item.id && item.label);
  } catch {
    return [];
  }
}

function mergeSearchResults(localItems, remoteItems, limit = 12) {
  const merged = [];
  const seen = new Set();
  const allItems = [...localItems, ...remoteItems];

  for (const item of allItems) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  merged.sort((a, b) => {
    const scoreA = Number.isFinite(a.score) ? a.score : 0;
    const scoreB = Number.isFinite(b.score) ? b.score : 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    const magA = Number.isFinite(a.mag) ? a.mag : 99;
    const magB = Number.isFinite(b.mag) ? b.mag : 99;
    if (magA !== magB) return magA - magB;
    return String(a.label || '').localeCompare(String(b.label || ''));
  });

  return merged.slice(0, limit);
}

async function refreshSearchSuggestions() {
  const input = document.getElementById('search-input');
  const query = input?.value?.trim() || '';
  const requestId = ++activeSearchRequestId;
  if (!query) {
    searchSuggestions = [];
    activeSuggestionIndex = -1;
    renderSearchSuggestions();
    return;
  }

  const localResults = renderer.searchObjects(query, 8);
  const remoteResults = await fetchBackendSearchSuggestions(query, 12);
  if (requestId !== activeSearchRequestId) return;

  searchSuggestions = mergeSearchResults(localResults, remoteResults, 12);
  searchSuggestions = await enrichSearchSuggestionsWithConstellations(searchSuggestions);
  if (requestId !== activeSearchRequestId) return;
  activeSuggestionIndex = searchSuggestions.length ? 0 : -1;
  renderSearchSuggestions();
}

function formatRaHours(raHours) {
  if (!Number.isFinite(raHours)) return '-';
  const ra = ((Number(raHours) % 24) + 24) % 24;
  const hours = Math.floor(ra);
  const minutesFloat = (ra - hours) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${seconds.toFixed(1).padStart(4, '0')}s`;
}

function formatDecDegrees(decDegrees) {
  if (!Number.isFinite(decDegrees)) return '-';
  const sign = decDegrees < 0 ? '-' : '+';
  const abs = Math.abs(Number(decDegrees));
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return `${sign}${String(deg).padStart(2, '0')}° ${String(min).padStart(2, '0')}' ${sec.toFixed(0).padStart(2, '0')}"`;
}

function formatConstellation(item) {
  const abbr = String(item?.constellation || '').trim();
  if (!abbr) return '';
  const name = renderer?.getConstellationNameById(abbr) || '';
  return name ? `${abbr} (${name})` : abbr;
}

function fallbackConstellationEnrichment(items) {
  return (items || []).map((item) => {
    if (!Number.isFinite(item?.ra) || !Number.isFinite(item?.dec)) return item;
    if (item.constellation) return item;
    const local = renderer?.getConstellationInfo(item);
    return local?.abbr ? { ...item, constellation: local.abbr } : item;
  });
}

async function enrichSearchSuggestionsWithConstellations(items) {
  const input = Array.isArray(items) ? items : [];
  const candidates = input
    .filter((item) => Number.isFinite(item?.ra) && Number.isFinite(item?.dec))
    .map((item) => ({
      id: `${item.kind || 'obj'}:${item.id || item.label || Math.random()}`,
      ra: Number(item.ra),
      dec: Number(item.dec),
    }));

  if (!candidates.length) return input;

  try {
    const res = await fetch('/api/constellations/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: candidates }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    const byId = new Map();
    rows.forEach((row) => {
      byId.set(String(row?.id || ''), String(row?.constellation || '').trim());
    });

    return input.map((item) => {
      if (!Number.isFinite(item?.ra) || !Number.isFinite(item?.dec)) return item;
      const key = `${item.kind || 'obj'}:${item.id || item.label || ''}`;
      const abbr = byId.get(key);
      if (abbr) return { ...item, constellation: abbr };
      return item;
    });
  } catch {
    return fallbackConstellationEnrichment(input);
  }
}

async function loadAndDisplaySearchDataInfo() {
  const infoDiv = document.getElementById('search-data-info');
  if (!infoDiv) return;
  
  try {
    console.log('Loading search data info...');
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = await res.json();
    console.log('Status response:', status);
    
    const feeds = Array.isArray(status?.feeds) ? status.feeds : [];
    let info = '';
    
    if (feeds.length > 0) {
      feeds.forEach(feed => {
        const feedName = feed?.feed || '?';
        const count = feed?.count || 0;
        const lastSuccess = feed?.last_success_utc 
          ? new Date(feed.last_success_utc).toLocaleString('de-DE') 
          : 'nie';
        info += `<div><strong>${feedName}:</strong> ${count} Objekte · Zuletzt: ${lastSuccess}</div>`;
      });
    }
    
    if (info) {
      infoDiv.innerHTML = info;
      infoDiv.style.display = 'block';
      console.log('Search data info loaded');
    } else {
      console.warn('No feed data available');
      infoDiv.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load search data info:', err);
    infoDiv.style.display = 'none';
  }
}

function renderSearchSuggestions() {
  loadAndDisplaySearchDataInfo();
  const container = document.getElementById('search-suggestions');
  if (!container) return;
  if (!searchSuggestions.length) {
    container.innerHTML = '<div class="search-empty">Keine Treffer. Versuche M31, Sirius oder HIP 32349.</div>';
    return;
  }
  container.innerHTML = searchSuggestions.map((item, index) => {
    let subtitle = item.kind === 'star'
      ? `${item.id}${Number.isFinite(item.mag) ? ` · Mag ${item.mag.toFixed(2)}` : ''}`
      : `${item.id}${item.type ? ` · ${item.type}` : ''}`;
    if ((item.kind === 'asteroid' || item.kind === 'comet') && Number.isFinite(item.mag)) {
      subtitle = `${subtitle} · Mag ${item.mag.toFixed(2)}`;
    }
    if (item.kind === 'satellite') {
      subtitle = `${item.id} · TLE`;
    }
    if (!Number.isFinite(item.ra) || !Number.isFinite(item.dec)) {
      subtitle = `${subtitle} · Ohne Position`;
    } else {
      const constellation = formatConstellation(item);
      subtitle = `${subtitle} · RA ${formatRaHours(item.ra)} · Dec ${formatDecDegrees(item.dec)}`;
      if (constellation) {
        subtitle = `${subtitle} · ${constellation}`;
      }
    }
    return `<button type="button" class="search-item${index === activeSuggestionIndex ? ' is-active' : ''}" data-search-index="${index}" role="option" aria-selected="${index === activeSuggestionIndex}">
      <span class="search-item__meta">
        <span class="search-item__title">${escapeHtml(item.label)}</span>
        <span class="search-item__subtitle">${escapeHtml(subtitle)}</span>
      </span>
      <span class="search-item__kind">${item.kind}</span>
    </button>`;
  }).join('');
  container.querySelectorAll('[data-search-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-search-index'));
      const item = searchSuggestions[index];
      if (item) applySearchResult(item);
    });
  });
}

function moveSuggestionSelection(direction) {
  if (!searchSuggestions.length) return;
  activeSuggestionIndex = (activeSuggestionIndex + direction + searchSuggestions.length) % searchSuggestions.length;
  renderSearchSuggestions();
}

function applySearchResult(result) {
  if (!Number.isFinite(result?.ra) || !Number.isFinite(result?.dec)) {
    const kindLabel = result?.kind === 'satellite' ? 'Satellit' : 'Objekt';
    updateSearchStatus(`${kindLabel} gefunden, aber aktuell nicht zentrierbar (keine berechenbare Position): ${result.label}`);
    const input = document.getElementById('search-input');
    if (input) input.value = result.label;
    rememberRecentSearch(result.label);
    renderRecentSearches();
    return;
  }
  selectedObject = result;
  renderer.centerOnObject(result);
  const input = document.getElementById('search-input');
  if (input) input.value = result.label;
  updateSearchStatus(`Zentriert auf: ${result.label}`);
  rememberRecentSearch(result.label);
  renderRecentSearches();
  closeSearchModal();
}

function loadRecentSearches() {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function loadDisplaySettings() {
  try {
    const raw = window.localStorage.getItem(DISPLAY_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDisplaySettings() {
  if (!renderer) return;
  const payload = { magLimit: renderer.options.magLimit };
  DISPLAY_OPTION_KEYS.forEach((key) => {
    payload[key] = Boolean(renderer.options[key]);
  });
  try {
    window.localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(payload));
  } catch {
    // localStorage ist optional.
  }
}

function applyDisplaySettings() {
  if (!renderer) return;
  const settings = loadDisplaySettings();

  DISPLAY_OPTION_KEYS.forEach((key) => {
    if (typeof settings[key] === 'boolean') {
      renderer.options[key] = settings[key];
    }
    const checkbox = document.getElementById(key);
    if (checkbox) checkbox.checked = Boolean(renderer.options[key]);
  });

  if (Number.isFinite(settings.magLimit)) {
    renderer.options.magLimit = Math.max(3, Math.min(7, Number(settings.magLimit)));
  }
  const magInput = document.getElementById('mag-limit');
  if (magInput) magInput.value = String(renderer.options.magLimit);
  const magLabel = document.getElementById('mag-label');
  if (magLabel) magLabel.textContent = String(renderer.options.magLimit);

  // Sternkatalog initialisieren
  const dataSettings = loadDataSourceSettings();
  const starCatalogSelect = document.getElementById('starCatalog');
  if (starCatalogSelect) {
    starCatalogSelect.value = dataSettings.starCatalog || 'mag4';
  }
}

function loadDataSourceSettings() {
  const defaults = {
    starCatalog: 'mag4',
    dsoCatalog: 'dso_base.json',
    constellationsCatalog: 'constellations.json',
    useBackendSmallBodies: true,
    defaultIncludeSatellites: false,
  };
  try {
    const raw = window.localStorage.getItem(DATA_SOURCE_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      ...defaults,
      ...parsed,
      useBackendSmallBodies: parsed.useBackendSmallBodies !== false,
      defaultIncludeSatellites: parsed.defaultIncludeSatellites === true,
    };
  } catch {
    return defaults;
  }
}

function saveDataSourceSettings(settings) {
  try {
    window.localStorage.setItem(DATA_SOURCE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage ist optional.
  }
}

function setCatalogApplyStatus(message) {
  const el = document.getElementById('catalog-apply-status');
  if (el) el.textContent = message;
}

function setSyncStatusText(message) {
  const el = document.getElementById('sync-status-text');
  if (el) el.textContent = message;
}

function formatSyncTimestamp(value) {
  if (!value) return 'Noch nie';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

function findFeedState(feeds, names) {
  for (const name of names) {
    const hit = feeds.find((row) => String(row?.feed || '').toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

async function refreshBackendSyncStatus() {
  try {
    const res = await fetch('/api/solar-system/sync-status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const feeds = Array.isArray(payload?.feeds) ? payload.feeds : [];

    const tle = findFeedState(feeds, ['satellites_tle']);
    const comets = findFeedState(feeds, ['comets']);
    const asteroids = findFeedState(feeds, ['asteroids_daily', 'asteroids_full']);

    const tleEl = document.getElementById('sync-last-tle');
    const cometsEl = document.getElementById('sync-last-comets');
    const asteroidsEl = document.getElementById('sync-last-asteroids');
    if (tleEl) tleEl.textContent = formatSyncTimestamp(tle?.lastSuccessUtc);
    if (cometsEl) cometsEl.textContent = formatSyncTimestamp(comets?.lastSuccessUtc);
    if (asteroidsEl) asteroidsEl.textContent = formatSyncTimestamp(asteroids?.lastSuccessUtc);

    const intervalSeconds = Number(payload?.intervalSeconds);
    const intervalHours = Number.isFinite(intervalSeconds) ? (intervalSeconds / 3600).toFixed(1) : '-';
    setSyncStatusText(`Sync-Status geladen. Intervall: ${intervalHours} h.`);
  } catch (error) {
    setSyncStatusText(`Sync-Status nicht verfügbar (${error?.message || 'Fehler'}).`);
  }
}

async function triggerFeedSync(feed, label) {
  setSyncStatusText(`${label}: manueller Abruf läuft...`);
  try {
    const res = await fetch(`/api/solar-system/sync-now?feed=${encodeURIComponent(feed)}`, {
      method: 'POST',
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) detail = String(err.detail);
      } catch {
        // ignore json parse errors
      }
      throw new Error(detail);
    }
    const payload = await res.json();
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const result = rows[0] || {};
    const inserted = Number(result?.inserted || 0);
    const updated = Number(result?.updated || 0);
    setSyncStatusText(`${label}: abgeschlossen (neu ${inserted}, aktualisiert ${updated}).`);
    await refreshBackendSyncStatus();
    renderer.lastSmallBodyRequestKey = null;
    updateObserver();
  } catch (error) {
    setSyncStatusText(`${label}: Abruf fehlgeschlagen (${error?.message || 'Fehler'}).`);
  }
}

function getSelectedTleProviderUrl() {
  const mode = document.getElementById('tle-provider-select')?.value || 'celestrak-active';
  if (mode === 'custom') {
    return String(document.getElementById('tle-provider-custom-url')?.value || '').trim();
  }
  return TLE_PROVIDER_PRESETS[mode] || TLE_PROVIDER_PRESETS['celestrak-active'];
}

function detectTleProviderMode(url) {
  const value = String(url || '').trim();
  if (!value) return 'celestrak-active';
  for (const [mode, preset] of Object.entries(TLE_PROVIDER_PRESETS)) {
    if (preset === value) return mode;
  }
  return 'custom';
}

function onTleProviderSelectChange() {
  const mode = document.getElementById('tle-provider-select')?.value || 'celestrak-active';
  const input = document.getElementById('tle-provider-custom-url');
  if (!input) return;
  if (mode === 'custom') {
    input.disabled = false;
    return;
  }
  input.value = TLE_PROVIDER_PRESETS[mode] || '';
  input.disabled = true;
}

async function saveTleProviderConfig() {
  const tleUrl = getSelectedTleProviderUrl();
  if (!tleUrl) {
    setSyncStatusText('TLE-Provider URL fehlt.');
    return;
  }
  setSyncStatusText('TLE-Provider wird gespeichert...');
  try {
    const res = await fetch('/api/solar-system/feed-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tleUrl }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setSyncStatusText('TLE-Provider gespeichert.');
    await refreshBackendSyncStatus();
  } catch (error) {
    setSyncStatusText(`TLE-Provider konnte nicht gespeichert werden (${error?.message || 'Fehler'}).`);
  }
}

async function testTleProviderConfig() {
  const tleUrl = getSelectedTleProviderUrl();
  if (!tleUrl) {
    setSyncStatusText('TLE-Provider URL fehlt.');
    return;
  }
  setSyncStatusText('TLE-Provider Test läuft...');
  try {
    const res = await fetch(`/api/solar-system/sync-now?feed=satellites_tle&source_url=${encodeURIComponent(tleUrl)}`, {
      method: 'POST',
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) detail = String(err.detail);
      } catch {
        // ignore json parse errors
      }
      throw new Error(detail);
    }
    const payload = await res.json();
    const result = (Array.isArray(payload?.results) ? payload.results : [])[0] || {};
    const inserted = Number(result?.inserted || 0);
    const updated = Number(result?.updated || 0);
    setSyncStatusText(`TLE-Test erfolgreich (neu ${inserted}, aktualisiert ${updated}).`);
    await refreshBackendSyncStatus();
  } catch (error) {
    setSyncStatusText(`TLE-Test fehlgeschlagen (${error?.message || 'Fehler'}).`);
  }
}

async function triggerSyncAll() {
  setSyncStatusText('Alle Feeds: manueller Abruf läuft...');
  try {
    const res = await fetch('/api/solar-system/sync-now', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const okRows = rows.filter((row) => row?.status === 'ok').length;
    setSyncStatusText(`Alle Feeds abgeschlossen (${okRows}/${rows.length} erfolgreich).`);
    await refreshBackendSyncStatus();
    renderer.lastSmallBodyRequestKey = null;
    updateObserver();
  } catch (error) {
    setSyncStatusText(`Alle Feeds fehlgeschlagen (${error?.message || 'Fehler'}).`);
  }
}

async function onStarCatalogChange() {
  const catalogSelect = document.getElementById('starCatalog');
  if (!catalogSelect || !renderer) return;
  
  const catalogName = catalogSelect.value;
  const settings = loadDataSourceSettings();
  settings.starCatalog = catalogName;
  saveDataSourceSettings(settings);
  
  try {
    console.log(`Switching to star catalog: ${catalogName}`);
    await renderer.catalog.setStarCatalog(catalogName);
    renderer.render();
    console.log(`Star catalog switched to ${catalogName}`);
  } catch (error) {
    console.error(`Failed to switch star catalog:`, error);
    catalogSelect.value = settings.starCatalog;
  }
}

async function applyCatalogSelection() {
  const starsCatalog = document.getElementById('catalog-stars-select')?.value || 'stars_mag4.json';
  const dsoCatalog = document.getElementById('catalog-dso-select')?.value || 'dso_base.json';
  const constellationsCatalog = document.getElementById('catalog-constellations-select')?.value || 'constellations.json';
  const useBackendSmallBodies = Boolean(document.getElementById('use-backend-smallbodies')?.checked);
  const defaultIncludeSatellites = Boolean(document.getElementById('default-include-satellites')?.checked);

  const settings = {
    starsCatalog,
    dsoCatalog,
    constellationsCatalog,
    useBackendSmallBodies,
    defaultIncludeSatellites,
  };

  setCatalogApplyStatus('Lade Kataloge neu...');
  try {
    renderer.setDataSourceOptions({ useBackendSmallBodies });
    await renderer.reconfigureCatalogSources({
      stars: starsCatalog,
      dso: dsoCatalog,
      constellations: constellationsCatalog,
    });
    saveDataSourceSettings(settings);

    const searchIncludeSat = document.getElementById('search-include-satellites');
    if (searchIncludeSat) searchIncludeSat.checked = defaultIncludeSatellites;

    setCatalogApplyStatus('Kataloge erfolgreich neu geladen.');
    refreshSearchSuggestions();
  } catch (error) {
    setCatalogApplyStatus(`Katalog-Neuladen fehlgeschlagen (${error?.message || 'Fehler'}).`);
  }
}

function onDefaultIncludeSatellitesChange() {
  const enabled = Boolean(document.getElementById('default-include-satellites')?.checked);
  const searchIncludeSat = document.getElementById('search-include-satellites');
  if (searchIncludeSat) searchIncludeSat.checked = enabled;
  const settings = loadDataSourceSettings();
  settings.defaultIncludeSatellites = enabled;
  saveDataSourceSettings(settings);
  refreshSearchSuggestions();
}

function onUseBackendSmallBodiesChange() {
  const enabled = Boolean(document.getElementById('use-backend-smallbodies')?.checked);
  renderer.setDataSourceOptions({ useBackendSmallBodies: enabled });
  const settings = loadDataSourceSettings();
  settings.useBackendSmallBodies = enabled;
  saveDataSourceSettings(settings);
  updateObserver();
}

async function initDataSourceControls() {
  const settings = loadDataSourceSettings();

  const starsSelect = document.getElementById('catalog-stars-select');
  const dsoSelect = document.getElementById('catalog-dso-select');
  const constellationsSelect = document.getElementById('catalog-constellations-select');
  const useSmallBodies = document.getElementById('use-backend-smallbodies');
  const defaultIncludeSat = document.getElementById('default-include-satellites');
  const searchIncludeSat = document.getElementById('search-include-satellites');
  const tleProviderSelect = document.getElementById('tle-provider-select');
  const tleProviderCustomInput = document.getElementById('tle-provider-custom-url');

  if (starsSelect) starsSelect.value = settings.starsCatalog;
  if (dsoSelect) dsoSelect.value = settings.dsoCatalog;
  if (constellationsSelect) constellationsSelect.value = settings.constellationsCatalog;
  if (useSmallBodies) useSmallBodies.checked = Boolean(settings.useBackendSmallBodies);
  if (defaultIncludeSat) defaultIncludeSat.checked = Boolean(settings.defaultIncludeSatellites);
  if (searchIncludeSat) searchIncludeSat.checked = Boolean(settings.defaultIncludeSatellites);

  try {
    const res = await fetch('/api/solar-system/feed-config');
    if (res.ok) {
      const cfg = await res.json();
      const tleUrl = String(cfg?.tleUrl || '').trim();
      const mode = detectTleProviderMode(tleUrl);
      if (tleProviderSelect) tleProviderSelect.value = mode;
      if (tleProviderCustomInput) tleProviderCustomInput.value = tleUrl;
      onTleProviderSelectChange();
    }
  } catch {
    onTleProviderSelectChange();
  }

  renderer.setDataSourceOptions({ useBackendSmallBodies: Boolean(settings.useBackendSmallBodies) });
  try {
    await renderer.reconfigureCatalogSources({
      stars: settings.starsCatalog,
      dso: settings.dsoCatalog,
      constellations: settings.constellationsCatalog,
    });
    setCatalogApplyStatus('Kataloge bereit.');
  } catch {
    setCatalogApplyStatus('Kataloge mit Standardquelle geladen.');
  }
  refreshBackendSyncStatus();
}

function rememberRecentSearch(query) {
  const text = String(query || '').trim();
  if (!text) return;
  recentSearches = [text, ...recentSearches.filter((item) => item !== text)].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches));
  } catch {
    // localStorage ist optional.
  }
}

function renderRecentSearches() {
  const container = document.getElementById('search-recents');
  if (!container) return;
  if (!recentSearches.length) {
    container.innerHTML = '<div class="search-empty">Noch keine letzten Suchanfragen.</div>';
    return;
  }
  container.innerHTML = recentSearches.map((item) => `<button type="button" class="search-chip" data-recent-search="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
  container.querySelectorAll('[data-recent-search]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.getAttribute('data-recent-search') || '';
      const input = document.getElementById('search-input');
      if (input) {
        input.value = value;
        input.focus();
      }
      refreshSearchSuggestions();
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatIsoCompact(value) {
  if (!value) return '-';
  return value.replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
}

// Format a Date as Berlin local time using Intl, independent of the system timezone.
function formatBerlinParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  return Object.fromEntries(parts.map((x) => [x.type, x.value]));
}

function toDateTimeLocalValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const p = formatBerlinParts(d);
  const tz = getBerlinTimeZoneLabel(d);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second} ${tz}`;
}

function toDateTimeLocalValueWithoutSeconds(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const p = formatBerlinParts(d);
  const tz = getBerlinTimeZoneLabel(d);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute} ${tz}`;
}

function enableDateTimeTextFallback(input) {
  if (!input || dateTimeTextFallbackEnabled) return;
  dateTimeTextFallbackEnabled = true;
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = 'TT.MM.JJJJ HH:MM:SS MEZ';
}

function setDateTimeInputValue(input, date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return;

  const withSeconds = toDateTimeLocalValue(d);
  const withoutSeconds = toDateTimeLocalValueWithoutSeconds(d);

  // Text input: mit Sekunden
  if (input.type === 'text') {
    input.value = withSeconds;
    return;
  }

  // Datetime-local: versuchen mit und ohne Sekunden
  input.value = withoutSeconds;
  if (input.value && input.type === 'datetime-local') {
    input.value = withSeconds;
  }

  // Fallback: valueAsDate
  if (!input.value && input.type === 'datetime-local') {
    try {
      input.valueAsDate = d;
    } catch {
      // no-op
    }
  }

  // 4) Robuster Fallback fuer Embedded-Browser: auf Textfeld wechseln.
  if (!input.value) {
    enableDateTimeTextFallback(input);
    input.value = withSeconds;
  }

}

document.addEventListener('DOMContentLoaded', init);