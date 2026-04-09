/**
 * SkyCMD v0.1.0 - Main Entry Point
 */
import { SkyMapRenderer } from './skymap/renderer.js';

export const APP_VERSION = '0.1.0';

let renderer;
let animFrame;

// Beobachter-Standardwerte (Halle/Saale)
const DEFAULT_LAT = 51.48;
const DEFAULT_LON = 11.97;

async function init() {
  // Version-Badge setzen
  const badge = document.getElementById('version-badge');
  if (badge) badge.textContent = `v${APP_VERSION}`;
  document.title = `SkyCMD ${APP_VERSION}`;

  // Canvas initialisieren
  const canvas = document.getElementById('sky-canvas');
  if (!canvas) { console.error('Canvas #sky-canvas nicht gefunden'); return; }

  renderer = new SkyMapRenderer(canvas);
  resize();
  await renderer.init();
  renderer.setObserver(DEFAULT_LAT, DEFAULT_LON, new Date());

  // Controls
  document.getElementById('lat-input')?.addEventListener('input', updateObserver);
  document.getElementById('lon-input')?.addEventListener('input', updateObserver);
  document.getElementById('datetime-input')?.addEventListener('input', updateObserver);

  // Checkboxen
  ['showStars','showDSO','showConstellationLines','showConstellationBoundaries',
   'showStarNames','showDSOLabels'].forEach(key => {
    document.getElementById(key)?.addEventListener('change', (e) => {
      renderer.options[key] = e.target.checked;
      renderer.render();
    });
  });

  // Magnitude Slider
  document.getElementById('mag-limit')?.addEventListener('input', (e) => {
    renderer.options.magLimit = parseFloat(e.target.value);
    renderer.render();
  });

  // Resize
  window.addEventListener('resize', () => { resize(); renderer.render(); });

  // Erster Render
  renderer.render();

  // Live-Uhr: jede Minute neu rendern
  setInterval(() => {
    if (!document.getElementById('datetime-input')?.value) {
      renderer.setObserver(DEFAULT_LAT, DEFAULT_LON, new Date());
      renderer.render();
    }
  }, 60000);

  console.log(`SkyCMD ${APP_VERSION} bereit.`);
}

function updateObserver() {
  const lat = parseFloat(document.getElementById('lat-input')?.value) || DEFAULT_LAT;
  const lon = parseFloat(document.getElementById('lon-input')?.value) || DEFAULT_LON;
  const dtVal = document.getElementById('datetime-input')?.value;
  const date = dtVal ? new Date(dtVal) : new Date();
  renderer.setObserver(lat, lon, date);
  renderer.render();
}

function resize() {
  const container = document.getElementById('map-container');
  if (!container || !renderer) return;
  const size = Math.min(container.clientWidth || window.innerWidth - 280, container.clientHeight || window.innerHeight - 60) - 20;
  renderer.resize(size, size);
}

document.addEventListener('DOMContentLoaded', init);