/**
 * SkyCMD - Katalog-Loader
 * Laedt alle Sternkataloge und DSO-Daten
 */
export class CatalogManager {
  constructor(basePath = '/data/catalogs') {
    this.basePath = basePath;
    this.catalogApiPath = '/api/catalog/stars';
    this.activeStarCatalog = 'mag4';
    this.currentMagMax = null;
    this.sources = {
      starNames: 'star_names.json',
      dso: 'dso_base.json',
      constellations: 'constellations.json',
      constellationBoundaries: 'constellation_boundaries_iau.json',
    };
    this.stars = [];
    this.starNames = {};
    this.dso = [];
    this.constellations = [];
    this.constellationBoundaries = [];
  }

  setSources(partial = {}) {
    if (!partial || typeof partial !== 'object') return;
    // Handle backward compatibility: if 'stars' is passed as a catalog name
    if (partial.stars && typeof partial.stars === 'string' && ['mag4', 'tycho2'].includes(partial.stars)) {
      this.activeStarCatalog = partial.stars;
    }
    // Merge non-stars fields into sources
    const { stars, ...otherSources } = partial;
    this.sources = {
      ...this.sources,
      ...otherSources,
    };
  }

  getSources() {
    return { ...this.sources };
  }

  getStarCatalogOptions() {
    return ['mag4', 'tycho2'];
  }

  getActiveStarCatalog() {
    return this.activeStarCatalog;
  }

  async setStarCatalog(catalogName) {
    if (!['mag4', 'tycho2'].includes(catalogName)) {
      console.error(`Unknown star catalog: ${catalogName}`);
      return false;
    }
    this.activeStarCatalog = catalogName;
    await this.loadStars(this.currentMagMax);
    return true;
  }

  async loadAll() {
    await Promise.all([
      this.loadStars(this.currentMagMax),
      this.loadStarNames(),
      this.loadDSO(),
      this.loadConstellations(),
      this.loadConstellationBoundaries(),
    ]);
  }

  async loadStars(magMax = null) {
    if (magMax !== null && Number.isFinite(magMax)) {
      this.currentMagMax = magMax;
    }
    const effectiveMag = this.currentMagMax;
    try {
      // Use stored/provided magMax or allow unlimited
      const params = new URLSearchParams({
        catalog: this.activeStarCatalog,
        limit: 2000000,
      });
      if (effectiveMag !== null && Number.isFinite(effectiveMag)) {
        params.append('mag_max', String(Math.max(1, effectiveMag)));
      }
      const dbRes = await fetch(`${this.catalogApiPath}?${params}`, { cache: 'no-store' });
      if (!dbRes.ok) {
        throw new Error(`API returned ${dbRes.status}`);
      }
      const payload = await dbRes.json();
      if (!Array.isArray(payload?.items) || payload.items.length === 0) {
        throw new Error('No items in API response');
      }
      this.stars = payload.items;
      const magDisplay = effectiveMag !== null ? ` (mag ≤ ${effectiveMag})` : '';
      console.log(`Loaded ${this.stars.length} stars from ${this.activeStarCatalog} catalog${magDisplay}`);
      return this.stars;
    } catch (err) {
      console.error(`Failed to load ${this.activeStarCatalog} stars from API:`, err);
      this.stars = [];
      return this.stars;
    }
  }

  async loadStarNames() {
    const res = await fetch(`${this.basePath}/${this.sources.starNames}`);
    const arr = await res.json();
    this.starNames = {};
    arr.forEach((s) => {
      const id = s?.id;
      if (!id) return;
      const current = this.starNames[id];
      const currentIsIau = String(current?.source || '').toUpperCase() === 'IAU';
      const nextIsIau = String(s?.source || '').toUpperCase() === 'IAU';

      // Priority rule: IAU name wins over any other designation source.
      if (!current || (!currentIsIau && nextIsIau)) {
        this.starNames[id] = s;
      }
    });
    return this.starNames;
  }

  async loadDSO() {
    const res = await fetch(`${this.basePath}/${this.sources.dso}`);
    this.dso = await res.json();
    return this.dso;
  }

  async loadConstellations() {
    const res = await fetch(`${this.basePath}/${this.sources.constellations}`);
    this.constellations = await res.json();
    return this.constellations;
  }

  async loadConstellationBoundaries() {
    const res = await fetch(`${this.basePath}/${this.sources.constellationBoundaries}`);
    const geojson = await res.json();
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    this.constellationBoundaries = features.map(feature => {
      const rings = [];
      const processCoords = (coords) => coords.map(([lon, lat]) => {
        // GeoJSON uses [lon, lat]. Convert lon (-180..180°) to RA (0..24h)
        let raHours = ((lon % 360) + 360) % 360 / 15.0;
        return { ra: raHours, dec: lat };
      });
      if (feature.geometry.type === 'Polygon') {
        feature.geometry.coordinates.forEach(ring => rings.push(processCoords(ring)));
      } else if (feature.geometry.type === 'MultiPolygon') {
        feature.geometry.coordinates.forEach(poly =>
          poly.forEach(ring => rings.push(processCoords(ring)))
        );
      } else if (feature.geometry.type === 'LineString') {
        rings.push(processCoords(feature.geometry.coordinates));
      } else if (feature.geometry.type === 'MultiLineString') {
        feature.geometry.coordinates.forEach(line => rings.push(processCoords(line)));
      }
      return { id: feature.id || feature.ids || '', rings };
    }).filter((item) => Array.isArray(item.rings) && item.rings.length > 0);
    console.log(`Loaded ${this.constellationBoundaries.length} constellation boundaries`);
    return this.constellationBoundaries;
  }

  getStars() { return this.stars; }
  getStarName(hip) { return this.starNames[hip]; }
  getDSO() { return this.dso; }
  getConstellations() { return this.constellations; }
  getConstellationBoundaries() { return this.constellationBoundaries; }
}