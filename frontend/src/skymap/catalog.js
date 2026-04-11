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
      starNameSupplements: ['star_names_de_designations.json', 'star_designations_hyg.json'],
      starNameModernIndex: 'stellarium_modern_index_v25_1.json',
      constellationNames: 'constellation_names_de_latin_v1.json',
      dso: 'all',
      milkyWay: 'mw.json',
      constellations: 'constellations_modern_stellarium_v25_1.json',
      constellationBoundaries: 'constellation_boundaries_iau.json',
    };
    this.stars = [];
    this.starNames = {};
    this.namedStarPositions = [];
    this.namedStarBuckets = new Map();
    this.namedStarBucketSizeDeg = 2;
    this.starNameResolutionCache = new Map();
    this.dso = [];
    this.milkyWay = [];
    this.constellations = [];
    this.constellationBoundaries = [];
    this.constellationNamesById = new Map();
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
      this.loadMilkyWay(),
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
      let stars = payload.items;
      if (this.activeStarCatalog === 'tycho2') {
        stars = await this._mergeTychoWithBrightHip(stars, effectiveMag);
      }

      this.stars = stars;
      this.starNameResolutionCache.clear();
      const magDisplay = effectiveMag !== null ? ` (mag ≤ ${effectiveMag})` : '';
      console.log(`Loaded ${this.stars.length} stars from ${this.activeStarCatalog} catalog${magDisplay}`);
      return this.stars;
    } catch (err) {
      console.error(`Failed to load ${this.activeStarCatalog} stars from API:`, err);
      this.stars = [];
      return this.stars;
    }
  }

  _bucketKeyForStarRaDec(raHours, decDeg, bucketSizeDeg = 1) {
    const raDeg = ((Number(raHours) * 15) % 360 + 360) % 360;
    const decClamped = Math.max(-90, Math.min(90, Number(decDeg)));
    const raCellCount = Math.max(1, Math.floor(360 / bucketSizeDeg));
    const raCell = Math.floor(raDeg / bucketSizeDeg) % raCellCount;
    const decCell = Math.floor((decClamped + 90) / bucketSizeDeg);
    return `${raCell}:${decCell}`;
  }

  _buildStarBuckets(stars, bucketSizeDeg = 1) {
    const buckets = new Map();
    for (const star of stars) {
      const ra = Number(star?.ra);
      const dec = Number(star?.dec);
      if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
      const key = this._bucketKeyForStarRaDec(ra, dec, bucketSizeDeg);
      const existing = buckets.get(key);
      if (existing) existing.push(star);
      else buckets.set(key, [star]);
    }
    return buckets;
  }

  _hasNearbyMatch(star, buckets, bucketSizeDeg = 1, maxSepDeg = 0.2, maxMagDelta = 1.5) {
    const ra = Number(star?.ra);
    const dec = Number(star?.dec);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) return false;

    const raDeg = ((ra * 15) % 360 + 360) % 360;
    const raCellCount = Math.max(1, Math.floor(360 / bucketSizeDeg));
    const baseRaCell = Math.floor(raDeg / bucketSizeDeg) % raCellCount;
    const baseDecCell = Math.floor((Math.max(-90, Math.min(90, dec)) + 90) / bucketSizeDeg);
    const starMag = Number(star?.mag);

    for (let dRa = -1; dRa <= 1; dRa += 1) {
      const raCell = (baseRaCell + dRa + raCellCount) % raCellCount;
      for (let dDec = -1; dDec <= 1; dDec += 1) {
        const decCell = baseDecCell + dDec;
        const key = `${raCell}:${decCell}`;
        const candidates = buckets.get(key);
        if (!Array.isArray(candidates)) continue;
        for (const candidate of candidates) {
          const sep = this._angularDistanceDeg(
            raDeg,
            dec,
            ((Number(candidate?.ra) * 15) % 360 + 360) % 360,
            Number(candidate?.dec),
          );
          if (sep > maxSepDeg) continue;

          const candidateMag = Number(candidate?.mag);
          if (Number.isFinite(starMag) && Number.isFinite(candidateMag)) {
            if (Math.abs(starMag - candidateMag) > maxMagDelta) continue;
          }
          return true;
        }
      }
    }
    return false;
  }

  async _mergeTychoWithBrightHip(tychoStars, effectiveMag) {
    if (!Array.isArray(tychoStars) || tychoStars.length === 0) return tychoStars;

    try {
      const brightLimit = Number.isFinite(effectiveMag)
        ? Math.max(1.5, Math.min(3.2, Number(effectiveMag)))
        : 3.2;

      const params = new URLSearchParams({
        catalog: 'mag4',
        limit: 5000,
        mag_max: String(brightLimit),
      });
      const res = await fetch(`${this.catalogApiPath}?${params}`, { cache: 'no-store' });
      if (!res.ok) return tychoStars;
      const payload = await res.json();
      const brightHip = Array.isArray(payload?.items) ? payload.items : [];
      if (brightHip.length === 0) return tychoStars;

      const merged = [...tychoStars];
      const buckets = this._buildStarBuckets(tychoStars, 1);
      for (const hipStar of brightHip) {
        const id = String(hipStar?.id || '').trim();
        if (!/^HIP\s*\d+/i.test(id)) continue;
        if (this._hasNearbyMatch(hipStar, buckets, 1, 0.2, 1.5)) continue;
        merged.push(hipStar);
      }

      merged.sort((a, b) => {
        const ma = Number.isFinite(Number(a?.mag)) ? Number(a.mag) : 99;
        const mb = Number.isFinite(Number(b?.mag)) ? Number(b.mag) : 99;
        if (ma !== mb) return ma - mb;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      });
      return merged;
    } catch {
      return tychoStars;
    }
  }

  async loadStarNames() {
    const res = await fetch(`${this.basePath}/${this.sources.starNames}`);
    const arr = await res.json();

    // Optional supplemental metadata (e.g. German proper names, Bayer/Flamsteed).
    let supplement = [];
    const rawSupplements = this.sources.starNameSupplements;
    const supplementFiles = Array.isArray(rawSupplements)
      ? rawSupplements
      : [rawSupplements];
    for (const file of supplementFiles) {
      const supplementFile = String(file || '').trim();
      if (!supplementFile) continue;
      try {
        const suppRes = await fetch(`${this.basePath}/${supplementFile}`);
        if (suppRes.ok) {
          const parsed = await suppRes.json();
          if (Array.isArray(parsed)) supplement = supplement.concat(parsed);
        }
      } catch {
        // Supplement is optional; ignore load errors.
      }
    }

    // Optional Stellarium modern index with extensive HIP common names.
    let stellariumCommonNames = null;
    const modernIndexFile = String(this.sources.starNameModernIndex || '').trim();
    if (modernIndexFile) {
      try {
        const modernRes = await fetch(`${this.basePath}/${modernIndexFile}`);
        if (modernRes.ok) {
          const parsed = await modernRes.json();
          if (parsed && typeof parsed === 'object' && parsed.common_names && typeof parsed.common_names === 'object') {
            stellariumCommonNames = parsed.common_names;
          }
        }
      } catch {
        // Optional source; ignore load errors.
      }
    }

    this.starNames = {};
    arr.forEach((s) => {
      const id = s?.id;
      if (!id) return;
      const starId = String(id).trim();
      if (!starId) return;
      const incomingName = String(s?.propername || '').trim();
      const bayer = String(s?.bayer || '').trim();
      const flamsteed = String(s?.flamsteed || '').trim();
      const current = this.starNames[starId];
      if (!current) {
        const aliases = [];
        if (incomingName) aliases.push(incomingName);
        if (bayer && !aliases.includes(bayer)) aliases.push(bayer);
        if (flamsteed && !aliases.includes(flamsteed)) aliases.push(flamsteed);
        this.starNames[starId] = {
          ...s,
          id: starId,
          aliases,
        };
        return;
      }

      const aliases = Array.isArray(current.aliases) ? [...current.aliases] : [];
      if (incomingName && !aliases.includes(incomingName)) aliases.push(incomingName);
      if (bayer && !aliases.includes(bayer)) aliases.push(bayer);
      if (flamsteed && !aliases.includes(flamsteed)) aliases.push(flamsteed);

      // Keep a stable primary name but enrich metadata from additional rows.
      this.starNames[starId] = {
        ...s,
        ...current,
        id: starId,
        aliases,
      };
    });

    supplement.forEach((s) => {
      const id = String(s?.id || '').trim();
      if (!id) return;
      const current = this.starNames[id] || { id };
      const aliases = Array.isArray(current.aliases) ? [...current.aliases] : [];
      const incomingName = String(s?.propername || '').trim();
      const bayer = String(s?.bayer || '').trim();
      const flamsteed = String(s?.flamsteed || '').trim();
      if (incomingName && !aliases.includes(incomingName)) aliases.push(incomingName);
      if (bayer && !aliases.includes(bayer)) aliases.push(bayer);
      if (flamsteed && !aliases.includes(flamsteed)) aliases.push(flamsteed);
      this.starNames[id] = {
        ...current,
        ...s,
        id,
        aliases,
      };
    });

    if (stellariumCommonNames && typeof stellariumCommonNames === 'object') {
      for (const [idRaw, entries] of Object.entries(stellariumCommonNames)) {
        const id = String(idRaw || '').trim();
        if (!id) continue;
        if (!Array.isArray(entries) || entries.length === 0) continue;

        const current = this.starNames[id] || { id };
        const aliases = Array.isArray(current.aliases) ? [...current.aliases] : [];
        for (const item of entries) {
          const english = String(item?.english || '').trim();
          if (!english) continue;
          if (!aliases.includes(english)) aliases.push(english);
        }

        const preferred = aliases.find((value) => String(value || '').trim()) || '';
        this.starNames[id] = {
          ...current,
          id,
          propername: String(current?.propername || '').trim() || preferred,
          aliases,
        };
      }
    }

    await this._buildNamedStarPositionIndex();
    this.starNameResolutionCache.clear();

    return this.starNames;
  }

  async _buildNamedStarPositionIndex() {
    this.namedStarPositions = [];
    this.namedStarBuckets = new Map();

    const namedIds = new Set(Object.keys(this.starNames || {}));
    if (namedIds.size === 0) return;

    try {
      let stars = null;
      // Prefer HIP7 as positional index so we can resolve many more named stars.
      for (const sourceFile of ['stars_hip7.json', 'stars_mag4.json']) {
        const res = await fetch(`${this.basePath}/${sourceFile}`);
        if (!res.ok) continue;
        const parsed = await res.json();
        if (Array.isArray(parsed) && parsed.length > 0) {
          stars = parsed;
          break;
        }
      }
      if (!Array.isArray(stars)) return;

      const bucketSize = this.namedStarBucketSizeDeg;
      for (const star of stars) {
        const id = String(star?.id || '').trim();
        if (!id || !namedIds.has(id)) continue;
        const raHours = Number(star?.ra);
        const decDeg = Number(star?.dec);
        if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) continue;

        const raDeg = ((raHours * 15) % 360 + 360) % 360;
        const item = { id, raDeg, decDeg };
        this.namedStarPositions.push(item);

        const key = this._bucketKey(raDeg, decDeg, bucketSize);
        const bucket = this.namedStarBuckets.get(key);
        if (bucket) bucket.push(item);
        else this.namedStarBuckets.set(key, [item]);
      }
    } catch {
      // Optional helper index for Tycho2->HIP fallback.
    }
  }

  _bucketKey(raDeg, decDeg, bucketSize = this.namedStarBucketSizeDeg) {
    const raNorm = ((raDeg % 360) + 360) % 360;
    const raCellCount = Math.max(1, Math.floor(360 / bucketSize));
    const raCell = Math.floor(raNorm / bucketSize) % raCellCount;
    const decClamped = Math.max(-90, Math.min(90, decDeg));
    const decCell = Math.floor((decClamped + 90) / bucketSize);
    return `${raCell}:${decCell}`;
  }

  _angularDistanceDeg(ra1Deg, dec1Deg, ra2Deg, dec2Deg) {
    const toRad = Math.PI / 180;
    const ra1 = ra1Deg * toRad;
    const dec1 = dec1Deg * toRad;
    const ra2 = ra2Deg * toRad;
    const dec2 = dec2Deg * toRad;

    const sinDec = Math.sin(dec1) * Math.sin(dec2);
    const cosDec = Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
    const cosAngle = Math.max(-1, Math.min(1, sinDec + cosDec));
    return Math.acos(cosAngle) / toRad;
  }

  _resolveStarNameByPosition(star) {
    if (!Array.isArray(this.namedStarPositions) || this.namedStarPositions.length === 0) return null;
    const raHours = Number(star?.ra);
    const decDeg = Number(star?.dec);
    if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) return null;

    const raDeg = ((raHours * 15) % 360 + 360) % 360;
    const bucketSize = this.namedStarBucketSizeDeg;
    const raCellCount = Math.max(1, Math.floor(360 / bucketSize));
    const baseRaCell = Math.floor(raDeg / bucketSize) % raCellCount;
    const baseDecCell = Math.floor((Math.max(-90, Math.min(90, decDeg)) + 90) / bucketSize);

    let best = null;
    let bestSep = Number.POSITIVE_INFINITY;
    const seen = new Set();

    for (let dRa = -1; dRa <= 1; dRa += 1) {
      const raCell = (baseRaCell + dRa + raCellCount) % raCellCount;
      for (let dDec = -1; dDec <= 1; dDec += 1) {
        const decCell = baseDecCell + dDec;
        const key = `${raCell}:${decCell}`;
        const candidates = this.namedStarBuckets.get(key);
        if (!Array.isArray(candidates) || candidates.length === 0) continue;
        for (const candidate of candidates) {
          if (seen.has(candidate.id)) continue;
          seen.add(candidate.id);
          const sep = this._angularDistanceDeg(raDeg, decDeg, candidate.raDeg, candidate.decDeg);
          if (sep < bestSep) {
            bestSep = sep;
            best = candidate;
          }
        }
      }
    }

    if (!best) return null;

    // Keep fallback conservative to avoid wrong name assignment.
    if (bestSep > 0.12) return null;

    const nameData = this.starNames[best.id];
    if (!nameData) return null;

    const catalogMag = Number(star?.mag);
    const nameMag = Number(nameData?.magnitude);
    if (Number.isFinite(catalogMag) && Number.isFinite(nameMag)) {
      if (Math.abs(catalogMag - nameMag) > 3.5) return null;
    }

    return {
      ...nameData,
      matchedId: best.id,
    };
  }

  async loadDSO() {
    const filter = String(this.sources.dso || 'all');
    // Accept 'all', 'messier', 'ngc'; treat legacy filename values as 'all'.
    const allowed = new Set(['all', 'messier', 'ngc']);
    const catalog = allowed.has(filter) ? filter : 'all';
    const res = await fetch(`/api/catalog/dso?catalog=${encodeURIComponent(catalog)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    this.dso = Array.isArray(payload?.items) ? payload.items : [];
    return this.dso;
  }

  async loadMilkyWay() {
    const fileName = String(this.sources.milkyWay || '').trim();
    if (!fileName) {
      this.milkyWay = [];
      return this.milkyWay;
    }

    try {
      const res = await fetch(`${this.basePath}/${fileName}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();
      const features = Array.isArray(geojson?.features) ? geojson.features : [];

      this.milkyWay = features.map((feature) => {
        const featureId = String(feature?.id || '').trim();
        const levelMatch = featureId.match(/(\d+)/);
        const level = levelMatch ? Number.parseInt(levelMatch[1], 10) : 0;
        const rings = [];
        const processCoords = (coords) => coords.map(([lon, lat]) => {
          const raHours = ((Number(lon) % 360) + 360) % 360 / 15.0;
          return { ra: raHours, dec: Number(lat) };
        });

        const geometry = feature?.geometry || {};
        if (geometry.type === 'Polygon') {
          geometry.coordinates.forEach((ring) => rings.push(processCoords(ring)));
        } else if (geometry.type === 'MultiPolygon') {
          geometry.coordinates.forEach((poly) => {
            poly.forEach((ring) => rings.push(processCoords(ring)));
          });
        }

        return { id: featureId, level, rings };
      }).filter((item) => Array.isArray(item.rings) && item.rings.length > 0);

      this.milkyWay.sort((a, b) => a.level - b.level);
      return this.milkyWay;
    } catch {
      this.milkyWay = [];
      return this.milkyWay;
    }
  }

  async loadConstellations() {
    const res = await fetch(`${this.basePath}/${this.sources.constellations}`);
    this.constellations = await res.json();

    const namesById = new Map();
    for (const c of this.constellations) {
      const abbr = String(c?.id || '').trim().toUpperCase();
      if (!abbr) continue;
      namesById.set(abbr, {
        english: String(c?.name || '').trim(),
        latin: '',
        german: '',
      });
    }

    const modernIndexFile = String(this.sources.starNameModernIndex || '').trim();
    if (modernIndexFile) {
      try {
        const modernRes = await fetch(`${this.basePath}/${modernIndexFile}`);
        if (modernRes.ok) {
          const parsed = await modernRes.json();
          const constellationEntries = Array.isArray(parsed?.constellations) ? parsed.constellations : [];
          for (const item of constellationEntries) {
            const rawId = String(item?.id || '').trim();
            const abbr = rawId ? rawId.split(' ').pop().toUpperCase() : '';
            if (!abbr) continue;

            const common = item?.common_name || {};
            const english = String(common?.english || '').trim();
            const latin = String(common?.native || '').trim();
            const existing = namesById.get(abbr) || {
              english: '',
              latin: '',
              german: '',
            };

            namesById.set(abbr, {
              english: english || existing.english,
              latin: latin || existing.latin,
              german: existing.german || '',
            });
          }
        }
      } catch {
        // Optional source; fallback to already available names.
      }
    }

    const namesOverrideFile = String(this.sources.constellationNames || '').trim();
    if (namesOverrideFile) {
      try {
        const namesRes = await fetch(`${this.basePath}/${namesOverrideFile}`);
        if (namesRes.ok) {
          const rows = await namesRes.json();
          if (Array.isArray(rows)) {
            for (const row of rows) {
              const abbr = String(row?.id || '').trim().toUpperCase();
              if (!abbr) continue;
              const existing = namesById.get(abbr) || { english: '', latin: '', german: '' };
              const german = String(row?.german || '').trim();
              const latin = String(row?.latin || '').trim();
              const english = String(row?.english || '').trim();
              namesById.set(abbr, {
                english: english || existing.english,
                latin: latin || existing.latin,
                german: german || existing.german,
              });
            }
          }
        }
      } catch {
        // Optional source; keep existing derived labels.
      }
    }

    this.constellationNamesById = namesById;
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
  getStarName(starId) {
    const id = String(starId || '').trim();
    if (!id) return null;
    return this.starNames[id] || null;
  }

  getStarNameForStar(star) {
    if (!star || typeof star !== 'object') return null;
    const id = String(star.id || star.name || '').trim();
    if (id && this.starNames[id]) return this.starNames[id];

    if (id && this.starNameResolutionCache.has(id)) {
      return this.starNameResolutionCache.get(id);
    }

    const resolved = this._resolveStarNameByPosition(star);
    if (id) this.starNameResolutionCache.set(id, resolved || null);
    return resolved;
  }
  getDSO() { return this.dso; }
  getMilkyWay() { return this.milkyWay; }
  getConstellations() { return this.constellations; }
  getConstellationBoundaries() { return this.constellationBoundaries; }
  getConstellationNameById(abbr, language = 'de') {
    const key = String(abbr || '').trim().toUpperCase();
    if (!key) return '';
    const entry = this.constellationNamesById.get(key);
    if (!entry) return '';
    const lang = String(language || 'de').toLowerCase();
    if (lang === 'latin') {
      return String(entry.latin || entry.english || key).trim();
    }
    return String(entry.german || entry.english || entry.latin || key).trim();
  }
}