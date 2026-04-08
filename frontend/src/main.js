/**
 * SkyCMD — Main Entry Point
 * Initialisiert alle Module und startet die App.
 */

export const APP_VERSION = '0.1.0';

async function init() {
  // Version-Badge setzen
  document.getElementById('version-badge').textContent = `v${APP_VERSION}`;
  document.title = `SkyCMD ${APP_VERSION}`;

  // TODO: Module hier initialisieren
  // const skymap = new SkyMap(...);
  // const controls = new Controls(...);
  // const panels = new Panels(...);

  console.log(`SkyCMD ${APP_VERSION} — bereit.`);
}

document.addEventListener('DOMContentLoaded', init);
