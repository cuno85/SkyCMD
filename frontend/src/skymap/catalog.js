/**
 * SkyCMD - Katalog-Loader
 * Laedt alle Sternkataloge und DSO-Daten
 */
export class CatalogManager {
  constructor(basePath = '../../data/catalogs') {
    this.basePath = basePath;
    this.stars = [];
    this.starNames = {};
    this.dso = [];
    this.constellations = [];
    this.constellationBoundaries = [];
  }

  async loadAll() {
    await Promise.all([
      this.loadStars(),
      this.loadStarNames(),
      this.loadDSO(),
      this.loadConstellations(),
    ]);
  }

  async loadStars() {
    const res = await fetch(`${this.basePath}/stars_mag4.json`);
    this.stars = await res.json();
    return this.stars;
  }

  async loadStarNames() {
    const res = await fetch(`${this.basePath}/star_names.json`);
    const arr = await res.json();
    this.starNames = {};
    arr.forEach(s => { this.starNames[s.hip] = s; });
    return this.starNames;
  }

  async loadDSO() {
    const res = await fetch(`${this.basePath}/dso_base.json`);
    this.dso = await res.json();
    return this.dso;
  }

  async loadConstellations() {
    const res = await fetch(`${this.basePath}/constellations.json`);
    this.constellations = await res.json();
    return this.constellations;
  }

  async loadConstellationBoundaries() {
    const res = await fetch(`${this.basePath}/constellation_boundaries_iau.json`);
    const geojson = await res.json();
    this.constellationBoundaries = geojson.features.map(feature => {
      const rings = [];
      const processCoords = (coords) => coords.map(([lon, lat]) => ({
        ra: -lon / 15.0,
        dec: lat
      }));
      if (feature.geometry.type === 'Polygon') {
        feature.geometry.coordinates.forEach(ring => rings.push(processCoords(ring)));
      } else if (feature.geometry.type === 'MultiPolygon') {
        feature.geometry.coordinates.forEach(poly =>
          poly.forEach(ring => rings.push(processCoords(ring)))
        );
      }
      return { id: feature.id, rings };
    });
    return this.constellationBoundaries;
  }

  getStars() { return this.stars; }
  getStarName(hip) { return this.starNames[hip]; }
  getDSO() { return this.dso; }
  getConstellations() { return this.constellations; }
  getConstellationBoundaries() { return this.constellationBoundaries; }
}