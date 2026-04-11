/**
 * SkyCMD - SkyMap Renderer
 * Koordiniert alle Layer auf dem Canvas
 */
import { Projection } from './projection.js';
import { CatalogManager } from './catalog.js';
import { StarsLayer } from './layers/stars.js';
import { DSOLayer } from './layers/dso.js';
import { ConstellationsLayer } from './layers/constellations.js';
import { PlanetsLayer } from './layers/planets.js';
import { ReferenceLinesLayer } from './layers/referenceLines.js';
import { SmallBodiesLayer } from './layers/smallBodies.js';
import { ConstellationResolver } from './constellationResolver.js';

export class SkyMapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.projection = new Projection(canvas.width, canvas.height);
    this.catalog = new CatalogManager();
    this.layers = {
      stars: new StarsLayer(this.ctx, this.projection),
      dso: new DSOLayer(this.ctx, this.projection),
      constellations: new ConstellationsLayer(this.ctx, this.projection),
      planets: new PlanetsLayer(this.ctx, this.projection),
      smallBodies: new SmallBodiesLayer(this.ctx, this.projection),
      referenceLines: new ReferenceLinesLayer(this.ctx, this.projection),
    };
    this.options = {
      showStars: true,
      showDSO: true,
      showPlanets: true,
      showComets: true,
      showAsteroids: true,
      showConstellationLines: true,
      showConstellationBoundaries: false,
      showConstellationLabels: false,
      showCelestialEquator: true,
      showEquatorialGrid: false,
      showMeridian: true,
      showEcliptic: true,
      showEclipticGrid: false,
      showAzimuthGrid: false,
      showHorizonLine: true,
      showHorizonFill: true,
      showCardinalDirections: true,
      showStarNames: true,
      showDSOLabels: true,
      showPlanetLabels: true,
      showMilkyWay: true,
      magLimit: 6.5,
      starNameMagLimit: 6.5,
      milkyWayMode: 'nasa-texture',
      milkyWayIsoSmoothness: 1.5,
      milkyWayIsoBrightness: 1.0,
      milkyWayIsoContrast: 1.0,
      starVisualProfile: 'planetarium',
    };
    this.stats = {
      totalStars: 0,
      visibleStars: 0,
      totalDSO: 0,
      visibleDSO: 0,
      totalPlanets: 0,
      visiblePlanets: 0,
      renderMs: 0,
    };
    this.pickables = [];
    this.planets = [];
    this.smallBodies = [];
    this.lastPlanetRequestKey = null;
    this.lastSmallBodyRequestKey = null;
    this.selectedObject = null;
    this.dataSourceOptions = {
      useBackendSmallBodies: true,
    };
    this.constellationResolver = new ConstellationResolver();
    this.ready = false;
    this._renderErrorLogged = false;
  }

  async reconfigureCatalogSources(sources = {}) {
    this.catalog.setSources(sources);
    await this.catalog.loadAll();
    this._rebuildConstellationResolver();
    this.stats.totalStars = this.catalog.getStars().length;
    this.stats.totalDSO = this.catalog.getDSO().length;
    this.render();
  }

  _rebuildConstellationResolver() {
    this.constellationResolver.rebuild(
      this.catalog.getConstellations(),
      this.catalog.getConstellationBoundaries(),
      this.catalog.starNames,
    );
  }

  getConstellationInfo(target, decDegOverride = null) {
    return this.constellationResolver.getInfo(target, decDegOverride);
  }

  getConstellationNameById(abbr) {
    return this.constellationResolver.getNameById(abbr);
  }

  setDataSourceOptions(options = {}) {
    this.dataSourceOptions = {
      ...this.dataSourceOptions,
      ...options,
    };
    if (!this.dataSourceOptions.useBackendSmallBodies) {
      this.smallBodies = [];
      this.lastSmallBodyRequestKey = null;
      this.render();
    }
  }

  async init() {
    try {
      await this.catalog.loadAll();
    } catch (error) {
      console.error('Kataloge konnten nicht vollstaendig geladen werden:', error);
    }

    try {
      await this.catalog.loadConstellationBoundaries();
    } catch (error) {
      console.warn('Konstellationsgrenzen konnten nicht geladen werden:', error);
    }

    this.stats.totalStars = this.catalog.getStars().length;
    this.stats.totalDSO = this.catalog.getDSO().length;
    this._rebuildConstellationResolver();

    try {
      await this._refreshPlanets(new Date());
    } catch {
      // _refreshPlanets behandelt Fehler bereits intern.
    }

    try {
      await this._refreshSmallBodies(new Date());
    } catch {
      // _refreshSmallBodies behandelt Fehler bereits intern.
    }

    this.ready = true;
    console.log('SkyMapRenderer: Kataloge geladen.');
  }

  setObserver(lat, lon, date) {
    this.projection.setObserver(lat, lon, date);
    this._refreshPlanets(date);
    this._refreshSmallBodies(date);
  }

  _planetRequestKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  async _refreshPlanets(date) {
    const requestKey = this._planetRequestKey(date);
    if (!requestKey || requestKey === this.lastPlanetRequestKey) return;
    this.lastPlanetRequestKey = requestKey;
    const dt = date instanceof Date ? date : new Date(date);
    const query = encodeURIComponent(dt.toISOString());

    try {
      const response = await fetch(`/api/planets?datetime_iso=${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const planets = Array.isArray(payload?.planets) ? payload.planets : [];
      this.planets = planets
        .filter((p) => Number.isFinite(p?.ra) && Number.isFinite(p?.dec))
        .map((p) => ({
          id: String(p.id || '').toLowerCase(),
          name: p.name || p.id || 'Planet',
          kind: p.kind || 'planet',
          symbol: p.symbol,
          ra: Number(p.ra),
          dec: Number(p.dec),
          mag: Number.isFinite(p.mag) ? Number(p.mag) : null,
          distanceAu: Number.isFinite(p.distanceAu) ? Number(p.distanceAu) : null,
          distanceKm: Number.isFinite(p.distanceKm) ? Number(p.distanceKm) : null,
          elongationDeg: Number.isFinite(p.elongationDeg) ? Number(p.elongationDeg) : null,
          phaseAngleDeg: Number.isFinite(p.phaseAngleDeg) ? Number(p.phaseAngleDeg) : null,
          source: p.source,
        }));
      this.stats.totalPlanets = this.planets.length;
    } catch (error) {
      console.warn('Planeten konnten nicht geladen werden:', error);
      this.planets = [];
      this.stats.totalPlanets = 0;
    }
  }

  async _refreshSmallBodies(date) {
    if (!this.dataSourceOptions.useBackendSmallBodies) return;
    const requestKey = this._planetRequestKey(date);
    if (!requestKey || requestKey === this.lastSmallBodyRequestKey) return;
    this.lastSmallBodyRequestKey = requestKey;
    const dt = date instanceof Date ? date : new Date(date);
    const query = encodeURIComponent(dt.toISOString());

    try {
      const response = await fetch(`/api/solar-system/positions?datetime_iso=${query}&asteroid_limit=600&comet_limit=250&mag_limit=18`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const asteroids = Array.isArray(payload?.asteroids) ? payload.asteroids : [];
      const comets = Array.isArray(payload?.comets) ? payload.comets : [];
      this.smallBodies = [...asteroids, ...comets]
        .filter((x) => Number.isFinite(x?.ra) && Number.isFinite(x?.dec))
        .map((x) => ({
          id: x.id,
          name: x.name,
          kind: x.kind,
          ra: Number(x.ra),
          dec: Number(x.dec),
          mag: Number.isFinite(x.mag) ? Number(x.mag) : null,
          distanceAu: Number.isFinite(x.distanceAu) ? Number(x.distanceAu) : null,
          source: x.source,
        }));
    } catch (error) {
      console.warn('Kleine Koerper konnten nicht geladen werden:', error);
      this.smallBodies = [];
    }
  }

  render() {
    if (!this.ready) return;
    const started = performance.now();
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    try {
      this.pickables = [];

      // Hintergrund
      ctx.fillStyle = '#050a14';
      ctx.fillRect(0, 0, width, height);

      ctx.save();

      // Layer zeichnen
      if (this.options.showConstellationBoundaries) {
        this.layers.constellations.drawBoundaries(this.catalog.getConstellationBoundaries());
      }
      if (this.options.showConstellationLines) {
        this.layers.constellations.drawLines(this.catalog.getConstellations());
      }
      if (this.options.showConstellationLabels) {
        const canDrawLabels = typeof this.layers.constellations?.drawLabels === 'function';
        if (canDrawLabels) {
          this.layers.constellations.drawLabels(this.catalog.getConstellations(), {
            hideBelowHorizon: this.options.showHorizonFill,
          });
        } else {
          console.warn('Constellation labels are enabled, but drawLabels() is unavailable. Reload app to update modules.');
        }
      }
      this.layers.referenceLines.draw({
        showCelestialEquator: this.options.showCelestialEquator,
        showEquatorialGrid: this.options.showEquatorialGrid,
        showMeridian: this.options.showMeridian,
        showEcliptic: this.options.showEcliptic,
        showEclipticGrid: this.options.showEclipticGrid,
        showAzimuthGrid: this.options.showAzimuthGrid,
        showHorizonLine: this.options.showHorizonLine,
        showHorizonFill: this.options.showHorizonFill,
        showCardinalDirections: this.options.showCardinalDirections,
      });
      if (this.options.showDSO) {
        const dsoResult = this.layers.dso.draw(this.catalog.getDSO(), {
          showLabels: this.options.showDSOLabels,
          hideBelowHorizon: this.options.showHorizonFill,
        });
        this.stats.visibleDSO = dsoResult.drawn;
        this.pickables.push(...dsoResult.pickables);
      } else {
        this.stats.visibleDSO = 0;
      }
      if (this.options.showPlanets) {
        const planetsResult = this.layers.planets.draw(this.planets, {
          showLabels: this.options.showPlanetLabels,
          hideBelowHorizon: this.options.showHorizonFill,
        });
        this.stats.visiblePlanets = planetsResult.drawn;
        this.pickables.push(...planetsResult.pickables);
      } else {
        this.stats.visiblePlanets = 0;
      }
      const showComets = this.options.showComets === true;
      const showAsteroids = this.options.showAsteroids === true;
      if (showComets || showAsteroids) {
        const filteredSmallBodies = (this.smallBodies || []).filter((obj) => {
          const kind = String(obj?.kind || '').toLowerCase();
          if (kind === 'comet') return showComets;
          if (kind === 'asteroid') return showAsteroids;
          return false;
        });
        const smallBodyResult = this.layers.smallBodies.draw(filteredSmallBodies, {
          showComets,
          showAsteroids,
          showLabels: true,
          hideBelowHorizon: this.options.showHorizonFill,
        });
        this.pickables.push(...smallBodyResult.pickables);
      }
      if (this.options.showStars) {
        const starsResult = this.layers.stars.draw(
          this.catalog.getStars(),
          this.catalog.starNames,
          {
            showNames: this.options.showStarNames,
            resolveStarName: (star) => this.catalog.getStarNameForStar(star) || this.catalog.starNames?.[star?.id] || {},
            hideBelowHorizon: this.options.showHorizonFill,
            magLimit: Number.isFinite(this.options?.magLimit) ? Number(this.options.magLimit) : 6.5,
            starNameMagLimit: Number.isFinite(this.options?.starNameMagLimit) ? Number(this.options.starNameMagLimit) : 6.5,
            starVisualProfile: String(this.options?.starVisualProfile || 'planetarium'),
          }
        );
        this.stats.visibleStars = starsResult.drawn;
        this.pickables.push(...starsResult.pickables);
      } else {
        this.stats.visibleStars = 0;
      }

      if (this.selectedObject) {
        this._drawSelection(this.selectedObject);
      }

      ctx.restore();
      this._renderErrorLogged = false;
    } catch (error) {
      this.stats.visibleStars = 0;
      this.stats.visibleDSO = 0;
      this.stats.visiblePlanets = 0;
      this.pickables = [];
      ctx.fillStyle = '#050a14';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(255, 185, 110, 0.95)';
      ctx.font = '12px monospace';
      ctx.fillText('Render-Fehler: Details in der Konsole', 14, 24);
      if (!this._renderErrorLogged) {
        console.error('Render-Fehler in SkyMapRenderer:', error);
        this._renderErrorLogged = true;
      }
    }

    this.stats.renderMs = performance.now() - started;
  }

  _drawSelection(target) {
    const p = this.projection.projectObject(target);
    if (!p.visible) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 210, 95, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 14, p.y);
    ctx.lineTo(p.x + 14, p.y);
    ctx.moveTo(p.x, p.y - 14);
    ctx.lineTo(p.x, p.y + 14);
    ctx.strokeStyle = 'rgba(255, 210, 95, 0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  getStats() {
    const view = this.projection.getViewState();
    return {
      ...this.stats,
      catalogReady: this.ready,
      fovDeg: view.fovDeg,
      centerAzDeg: view.centerAzDeg,
      centerAltDeg: view.centerAltDeg,
      projectionMode: view.modeLabel,
      planarBlend: view.blendToPlanar,
      deltaTSeconds: view.deltaTSeconds,
      utIso: view.utIso,
      ttIso: view.ttIso,
    };
  }

  setSelectedObject(obj) {
    this.selectedObject = obj || null;
  }

  pickObjectAt(canvasX, canvasY, maxDistance = 10) {
    if (!this.pickables.length) return null;
    let best = null;
    let bestDist = maxDistance;
    for (const item of this.pickables) {
      const dx = item.x - canvasX;
      const dy = item.y - canvasY;
      const dist = Math.hypot(dx, dy);
      const hit = Math.max(item.radius || 6, 6);
      if (dist <= hit && dist <= bestDist) {
        best = item;
        bestDist = dist;
      }
    }
    return best;
  }

  centerOnCoordinates(ra, dec) {
    this.projection.centerOnRaDec(ra, dec);
    this.render();
  }

  centerOnObject(obj) {
    if (!obj) return;
    this.setSelectedObject(obj);
    const p = this.projection.projectObject(obj);
    if (Number.isFinite(p.az) && Number.isFinite(p.alt)) {
      this.projection.setViewCenter(p.az, p.alt);
      this.render();
      return;
    }
    this.centerOnCoordinates(obj.ra, obj.dec);
  }

  resetPan() {
    this.projection.setViewCenter(0, 90);
    this.render();
  }

  resetView() {
    this.projection.setViewCenter(0, 90);
    this.projection.setFov(120);
    this.selectedObject = null;
    this.render();
  }

  panByPixels(dx, dy) {
    this.projection.panByPixels(dx, dy);
    this.render();
  }

  zoomByFactor(factor) {
    this.projection.zoomByFactor(factor);
    this.render();
  }

  centerOnScreenPoint(screenX, screenY) {
    this.projection.centerOnScreenPoint(screenX, screenY);
    this.render();
  }

  _normalizeDsoResult(obj) {
    return {
      kind: 'dso',
      id: obj.id,
      label: obj.name || obj.id,
      name: obj.name,
      type: obj.type,
      mag: obj.mag,
      ra: obj.ra,
      dec: obj.dec,
    };
  }

  _normalizeStarResult(star, names) {
    const propername = names[star.id]?.propername;
    return {
      kind: 'star',
      id: star.id,
      label: propername || star.id,
      propername,
      mag: star.mag,
      ra: star.ra,
      dec: star.dec,
    };
  }

  _normalizePlanetResult(planet) {
    return {
      kind: 'planet',
      id: planet.id,
      label: planet.name,
      name: planet.name,
      symbol: planet.symbol,
      mag: planet.mag,
      distanceAu: planet.distanceAu,
      distanceKm: planet.distanceKm,
      ra: planet.ra,
      dec: planet.dec,
    };
  }

  _normalizeSmallBodyResult(body) {
    return {
      kind: body.kind,
      id: body.id,
      label: body.name || body.id,
      name: body.name,
      mag: body.mag,
      distanceAu: body.distanceAu,
      ra: body.ra,
      dec: body.dec,
    };
  }

  searchObjects(query, limit = 8) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];

    const results = [];
    const seen = new Set();
    const pushResult = (item, haystacks) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return;
      let score = 0;
      for (const text of haystacks) {
        const value = String(text || '').toLowerCase();
        if (!value) continue;
        if (value === q) score = Math.max(score, 100);
        else if (value.startsWith(q)) score = Math.max(score, 70);
        else if (value.includes(q)) score = Math.max(score, 40);
      }
      if (score > 0) {
        results.push({ ...item, score });
        seen.add(key);
      }
    };

    const dso = this.catalog.getDSO();
    for (const obj of dso) {
      pushResult(this._normalizeDsoResult(obj), [obj.id, obj.name, obj.type]);
    }

    for (const planet of this.planets) {
      pushResult(this._normalizePlanetResult(planet), [planet.id, planet.name]);
    }

    const showComets = this.options.showComets === true;
    const showAsteroids = this.options.showAsteroids === true;
    for (const body of this.smallBodies) {
      const kind = String(body?.kind || '').toLowerCase();
      if (kind === 'comet' && !showComets) continue;
      if (kind === 'asteroid' && !showAsteroids) continue;
      pushResult(this._normalizeSmallBodyResult(body), [body.id, body.name]);
    }

    const stars = this.catalog.getStars();
    const names = this.catalog.starNames;
    for (const star of stars) {
      const propername = names[star.id]?.propername;
      if (!propername && !String(star.id || '').toLowerCase().includes(q)) continue;
      pushResult(this._normalizeStarResult(star, names), [star.id, propername]);
    }

    results.sort((a, b) => b.score - a.score || (a.mag ?? 99) - (b.mag ?? 99) || a.label.localeCompare(b.label));
    return results.slice(0, limit);
  }

  findObject(query) {
    return this.searchObjects(query, 1)[0] || null;
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.projection.resize(width, height);
  }
}