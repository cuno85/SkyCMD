/**
 * SkyCMD - Katalog-Loader
 * Laedt alle Sternkataloge und DSO-Daten
 */
export class CatalogManager {
  constructor(basePath = '/data/catalogs') {
    this.basePath = basePath;
    this.starCatalogOptions = {
      mag4: 'stars_mag4.json',
      tycho2: 'stars_tycho2.json',
    };
    this.activeStarCatalog = 'mag4';
    this.sources = {
      stars: this.starCatalogOptions.mag4,
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
    this.sources = {
      ...this.sources,
      ...partial,
    };
  }

  getSources() {
    return { ...this.sources };
  }

  getStarCatalogOptions() {
    return Object.keys(this.starCatalogOptions);
  }

  getActiveStarCatalog() {
    return this.activeStarCatalog;
  }

  async setStarCatalog(catalogName) {
    if (!this.starCatalogOptions[catalogName]) {
      console.error(`Unknown star catalog: ${catalogName}`);
      return false;
    }
    this.activeStarCatalog = catalogName;
    this.sources.stars = this.starCatalogOptions[catalogName];
    await this.loadStars();
    return true;
  }

  async loadAll() {
    await Promise.all([
      this.loadStars(),
      this.loadStarNames(),
      this.loadDSO(),
      this.loadConstellations(),
      this.loadConstellationBoundaries(),
    ]);
  }

  async loadStars() {
    try {
      const res = await fetch(`${this.basePath}/${this.sources.stars}`);
      if (!res.ok) {
        console.warn(`Star catalog ${this.sources.stars} not found, falling back to mag4`);
        if (this.activeStarCatalog !== 'mag4') {
          this.activeStarCatalog = 'mag4';
          this.sources.stars = this.starCatalogOptions.mag4;
          return this.loadStars();
        }
        this.stars = [];
        return this.stars;
      }
      this.stars = await res.json();
      console.log(`Loaded ${this.stars.length} stars from ${this.activeStarCatalog} catalog`);
      return this.stars;
    } catch (err) {
      console.error(`Failed to load star catalog ${this.sources.stars}:`, err);
      this.stars = [];
      return this.stars;
    }
  }

  async loadStarNames() {
    const res = await fetch(`${this.basePath}/${this.sources.starNames}`);
    const arr = await res.json();
    this.starNames = {};
    arr.forEach(s => { this.starNames[s.id] = s; });
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