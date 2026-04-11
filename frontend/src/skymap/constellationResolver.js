export class ConstellationResolver {
  constructor() {
    this._ready = false;
    this._nameById = new Map();
    this._centers = [];
    this._centersById = new Map();
    this._boundarySegmentsByConstellation = new Map();
    this._starNames = {};
  }

  rebuild(constellations = [], boundaries = [], starNames = {}) {
    this._nameById = new Map();
    this._centers = [];
    this._centersById = new Map();
    this._boundarySegmentsByConstellation = new Map();
    this._starNames = starNames || {};

    for (const c of constellations || []) {
      const id = String(c?.id || '').trim();
      const name = String(c?.name || '').trim();
      if (!id) continue;
      this._nameById.set(id, name || id);

      const center = this._constellationCenter(c);
      if (!center) continue;
      const entry = { id, name: name || id, ra: center.ra, dec: center.dec };
      this._centers.push(entry);
      this._centersById.set(id, entry);
    }

    for (const boundary of boundaries || []) {
      const ids = String(boundary?.id || '')
        .split(',')
        .map((part) => String(part || '').trim())
        .filter(Boolean);
      if (ids.length !== 2) continue;

      for (const ring of boundary?.rings || []) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        for (let i = 1; i < ring.length; i += 1) {
          const prev = ring[i - 1];
          const curr = ring[i];
          if (!Number.isFinite(prev?.ra) || !Number.isFinite(prev?.dec)) continue;
          if (!Number.isFinite(curr?.ra) || !Number.isFinite(curr?.dec)) continue;

          const segment = {
            a: { ra: Number(prev.ra), dec: Number(prev.dec) },
            b: { ra: Number(curr.ra), dec: Number(curr.dec) },
            ids,
          };
          this._addBoundarySegment(ids[0], segment);
          this._addBoundarySegment(ids[1], segment);
        }
      }
    }

    this._ready = true;
  }

  getNameById(abbr) {
    const key = String(abbr || '').trim();
    if (!key) return '';
    return this._nameById.get(key) || '';
  }

  getInfo(target, decDegOverride = null) {
    let ra = null;
    let dec = null;
    let starId = '';
    if (typeof target === 'object' && target !== null) {
      ra = target.ra;
      dec = target.dec;
      starId = String(target.id || '').trim();
    } else {
      ra = target;
      dec = decDegOverride;
    }

    if (!this._ready || !Number.isFinite(ra) || !Number.isFinite(dec)) return null;

    const byStarName = this._starNames?.[starId]?.constellation;
    if (byStarName && this._nameById.has(byStarName)) {
      return { abbr: byStarName, name: this._nameById.get(byStarName) };
    }

    const seed = this._nearestCenter(ra, dec);
    if (!seed) return null;
    const resolvedId = this._resolveByBoundaries(seed.id, ra, dec) || seed.id;
    return {
      abbr: resolvedId,
      name: this._nameById.get(resolvedId) || resolvedId,
    };
  }

  _addBoundarySegment(constellationId, segment) {
    if (!this._boundarySegmentsByConstellation.has(constellationId)) {
      this._boundarySegmentsByConstellation.set(constellationId, []);
    }
    this._boundarySegmentsByConstellation.get(constellationId).push(segment);
  }

  _constellationCenter(con) {
    const lines = Array.isArray(con?.lines) ? con.lines : [];
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;

    for (const line of lines) {
      const points = Array.isArray(line) ? line : [];
      for (const pt of points) {
        if (!Number.isFinite(pt?.ra) || !Number.isFinite(pt?.dec)) continue;
        const v = this._toSkyVector(pt.ra, pt.dec);
        sumX += v.x;
        sumY += v.y;
        sumZ += v.z;
        count += 1;
      }
    }

    if (count < 1) return null;
    const len = Math.hypot(sumX, sumY, sumZ) || 1;
    const x = sumX / len;
    const y = sumY / len;
    const z = sumZ / len;
    let raRad = Math.atan2(y, x);
    if (raRad < 0) raRad += 2 * Math.PI;
    const decRad = Math.asin(Math.max(-1, Math.min(1, z)));
    return {
      ra: (raRad * 180 / Math.PI) / 15,
      dec: decRad * 180 / Math.PI,
    };
  }

  _toSkyVector(raHours, decDeg) {
    const raRad = ((Number(raHours) % 24) + 24) % 24 * 15 * Math.PI / 180;
    const decRad = Number(decDeg) * Math.PI / 180;
    const cosDec = Math.cos(decRad);
    return {
      x: cosDec * Math.cos(raRad),
      y: cosDec * Math.sin(raRad),
      z: Math.sin(decRad),
    };
  }

  _angularSeparationDeg(ra1Hours, dec1Deg, ra2Hours, dec2Deg) {
    const a = this._toSkyVector(ra1Hours, dec1Deg);
    const b = this._toSkyVector(ra2Hours, dec2Deg);
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    return Math.acos(dot) * 180 / Math.PI;
  }

  _nearestCenter(ra, dec) {
    let best = null;
    let bestSep = Infinity;
    for (const c of this._centers) {
      const sep = this._angularSeparationDeg(ra, dec, c.ra, c.dec);
      if (sep < bestSep) {
        bestSep = sep;
        best = c;
      }
    }
    return best;
  }

  _resolveByBoundaries(startId, targetRa, targetDec) {
    let currentId = startId;
    const target = this._projectLocal(targetRa, targetDec, targetRa, targetDec);
    const startCenter = this._centersById.get(startId);
    if (!startCenter) return startId;

    let current = this._projectLocal(startCenter.ra, startCenter.dec, targetRa, targetDec);
    const visited = new Set([currentId]);

    for (let step = 0; step < 24; step += 1) {
      const segments = this._boundarySegmentsByConstellation.get(currentId) || [];
      let bestHit = null;

      for (const segment of segments) {
        const a = this._projectLocal(segment.a.ra, segment.a.dec, targetRa, targetDec);
        const b = this._projectLocal(segment.b.ra, segment.b.dec, targetRa, targetDec);
        const hit = this._segmentIntersection(current, target, a, b);
        if (!hit) continue;
        if (hit.t <= 1e-6 || hit.t >= 1 - 1e-6) continue;
        if (!bestHit || hit.t < bestHit.t || (Math.abs(hit.t - bestHit.t) < 1e-6 && hit.u < bestHit.u)) {
          bestHit = {
            ...hit,
            ids: segment.ids,
          };
        }
      }

      if (!bestHit) return currentId;

      const nextId = bestHit.ids[0] === currentId ? bestHit.ids[1] : bestHit.ids[0];
      if (!nextId || nextId === currentId) return currentId;
      if (visited.has(nextId)) return currentId;

      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const epsilon = 1e-4;
      current = {
        x: bestHit.x + dx * epsilon,
        y: bestHit.y + dy * epsilon,
      };
      currentId = nextId;
      visited.add(currentId);
    }

    return currentId;
  }

  _projectLocal(ra, dec, refRa, refDec) {
    const decRefRad = Number(refDec) * Math.PI / 180;
    const scaleX = Math.max(0.15, Math.cos(decRefRad));
    return {
      x: this._unwrapRa(ra, refRa) * 15 * scaleX,
      y: Number(dec),
    };
  }

  _unwrapRa(ra, referenceRa) {
    let x = Number(ra);
    const ref = Number(referenceRa);
    while (x - ref > 12) x -= 24;
    while (x - ref < -12) x += 24;
    return x;
  }

  _segmentIntersection(p1, p2, q1, q2) {
    const r = { x: p2.x - p1.x, y: p2.y - p1.y };
    const s = { x: q2.x - q1.x, y: q2.y - q1.y };
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-9) return null;

    const qp = { x: q1.x - p1.x, y: q1.y - p1.y };
    const t = (qp.x * s.y - qp.y * s.x) / denom;
    const u = (qp.x * r.y - qp.y * r.x) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return {
      t,
      u,
      x: p1.x + t * r.x,
      y: p1.y + t * r.y,
    };
  }
}