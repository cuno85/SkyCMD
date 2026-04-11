/**
 * SkyCMD - Stereographisch auf Maximalzoom-out, gnomonisch beim Reinzoomen
 * Konvertiert RA/Dec in Bildschirmkoordinaten
 */
import { buildTimeState, gmstHoursFromUt } from '../astronomy/time.js';

const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const AU_KM = 149597870.7;

export class Projection {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height / 2;
    this.radius = Math.min(width, height) / 2 * 0.95;
    this.viewRadius = this.radius;

    this.eps = 1e-9;
    this.minFov = 5;
    this.maxFov = 202.3;
    this.fovDeg = this.maxFov;
    this.projectionMode = 'auto';
    this.stereographicOnlyAtOrAboveDeg = 202.3;
    this.gnomonicFullAtOrBelowDeg = 45.1;
    this.stellariumLikeBlendCenterDeg = 50;
    this.stellariumLikeBlendSteepness = 0.17;

    this.centerAzDeg = 0;
    this.centerAltDeg = 90;
    this.lat = 0;
    this.lon = 0;
    this.date = new Date();
    this.timeState = buildTimeState(this.date);
    this.lst = 0;
    this.atmosphere = {
      temperatureC: 10,
      pressureHpa: 1013.25,
      transparencyIndex: 4,
      extinctionK: 0.24,
      enableRefraction: true,
    };

    this._updateCameraBasis();
    this._recomputeScales();
    this._runStereographicSelfTests();
  }

  _clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  _wrapDeg(v) {
    let n = v % 360;
    if (n < 0) n += 360;
    return n;
  }

  _toRad(deg) {
    return deg * Math.PI / 180;
  }

  _toDeg(rad) {
    return rad * 180 / Math.PI;
  }

  _norm3(v) {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  _dot3(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  _cross3(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  _smoothstep01(t) {
    const x = this._clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  _recomputeScales() {
    const halfFovRad = this._toRad(this.fovDeg * 0.5);
    this.viewHalfWidth = this.width / 2;
    this.viewHalfHeight = this.height / 2;
    this.stereoScale = this.viewRadius / (2 * Math.tan(halfFovRad * 0.5));
    const gnomonicExtent = Math.max(Math.tan(halfFovRad), this.eps);
    this.gnomonicScaleX = this.viewHalfWidth / gnomonicExtent;
    this.gnomonicScaleY = this.viewHalfHeight / gnomonicExtent;
  }

  _projectionBlend() {
    const threshold = this.gnomonicFullAtOrBelowDeg;
    return this.fovDeg > threshold ? 0 : 1;
  }

  _perspectiveDistanceFromBlend(blend) {
    // d=1 => stereographisch, d=0 => gnomonisch
    return this._lerp(1, 0, this._clamp(blend, 0, 1));
  }

  _forwardPerspectiveFamily(v, distance) {
    const denom = distance + v.z;
    if (denom < this.eps) return null;
    const factor = distance + 1;
    return {
      X: (factor * v.x) / denom,
      Y: (factor * v.y) / denom,
    };
  }

  _backwardPerspectiveFamily(X, Y, distance) {
    const factor = Math.max(distance + 1, this.eps);
    const u = X / factor;
    const v = Y / factor;
    const q = u * u + v * v;
    const disc = Math.max(0, 1 + q * (1 - distance * distance));
    const z = (-q * distance + Math.sqrt(disc)) / (q + 1);
    const k = distance + z;
    return this._norm3({
      x: u * k,
      y: v * k,
      z,
    });
  }

  _planarBlend() {
    return this._projectionBlend();
  }

  _forwardStereographic(v) {
    const denom = 1 + v.z;
    if (denom < this.eps) return null;
    return { X: (2 * v.x) / denom, Y: (2 * v.y) / denom };
  }

  _runStereographicSelfTests() {
    const c0 = this._forwardStereographic({ x: 0, y: 0, z: 1 });
    if (!c0 || Math.abs(c0.X) > 1e-6 || Math.abs(c0.Y) > 1e-6) {
      console.warn('Projection self-test failed: center mapping');
    }

    const c1 = this._forwardStereographic({ x: 1, y: 0, z: 0 });
    if (!c1 || Math.abs(c1.X - 2) > 1e-6) {
      console.warn('Projection self-test failed: equator mapping');
    }

    const X = 1;
    const Y = 0.5;
    const v = this.stereographicBackward(X, Y);
    const c2 = this._forwardStereographic(v);
    if (!c2 || Math.abs(c2.X - X) > 1e-6 || Math.abs(c2.Y - Y) > 1e-6) {
      console.warn('Projection self-test failed: roundtrip mapping');
    }
  }

  _forwardGnomonic(v) {
    if (v.z < this.eps) return null;
    return {
      X: v.x / v.z,
      Y: v.y / v.z,
    };
  }

  setProjectionMode(mode) {
    // Manueller Override ist deaktiviert: Das Verhalten ist fest verdrahtet.
    this.projectionMode = 'auto';
  }

  _resolvedProjectionMode(blend = this._projectionBlend()) {
    if (blend >= 0.999) return 'gnomonic';
    if (blend <= 0.001) return 'stereographic';
    return 'transition';
  }

  stereographicBackward(X, Y) {
    const d = X * X + Y * Y;
    const denom = d + 4;
    return {
      x: (4 * X) / denom,
      y: (4 * Y) / denom,
      z: (4 - d) / denom,
    };
  }

  projectCameraVector(v) {
    const normed = this._norm3(v);
    const blend = this._projectionBlend();
    const distance = this._perspectiveDistanceFromBlend(blend);
    const projected = this._forwardPerspectiveFamily(normed, distance);
    if (!projected) return null;
    const resolvedMode = this._resolvedProjectionMode(blend);

    const scaleX = this._lerp(this.stereoScale, this.gnomonicScaleX, blend);
    const scaleY = this._lerp(this.stereoScale, this.gnomonicScaleY, blend);
    // Himmelskarten-Konvention: Osten links, Westen rechts.
    const sx = -scaleX * projected.X;
    const sy = -scaleY * projected.Y;

    const screenX = this.cx + sx;
    const screenY = this.cy + sy;
    const r = Math.hypot(sx, sy);

    const theta = Math.acos(this._clamp(normed.z, -1, 1));
    const insideRect = screenX >= -2 && screenX <= this.width + 2 && screenY >= -2 && screenY <= this.height + 2;
    // Immer rechteckig clippen: kein kreisfoermiger Himmelsausschnitt.
    const visible = insideRect;

    return {
      x: screenX,
      y: screenY,
      r,
      theta,
      visible,
    };
  }

  _horizontalVector(azDeg, altDeg) {
    const az = this._toRad(azDeg);
    const alt = this._toRad(altDeg);
    const cosAlt = Math.cos(alt);
    return {
      x: cosAlt * Math.sin(az),   // Ost
      y: cosAlt * Math.cos(az),   // Nord
      z: Math.sin(alt),           // Zenit
    };
  }

  _cameraToWorld(cam) {
    return this._norm3({
      x: this.right.x * cam.x + this.up.x * cam.y + this.forward.x * cam.z,
      y: this.right.y * cam.x + this.up.y * cam.y + this.forward.y * cam.z,
      z: this.right.z * cam.x + this.up.z * cam.y + this.forward.z * cam.z,
    });
  }

  _worldToHorizontal(world) {
    const alt = Math.asin(this._clamp(world.z, -1, 1));
    let az = Math.atan2(world.x, world.y);
    if (az < 0) az += 2 * Math.PI;
    return {
      azDeg: this._toDeg(az),
      altDeg: this._toDeg(alt),
    };
  }

  screenToCameraVector(screenX, screenY) {
    const sx = screenX - this.cx;
    const sy = screenY - this.cy;

    const blend = this._projectionBlend();
    const distance = this._perspectiveDistanceFromBlend(blend);
    const scaleX = this._lerp(this.stereoScale, this.gnomonicScaleX, blend);
    const scaleY = this._lerp(this.stereoScale, this.gnomonicScaleY, blend);
    const X = -sx / Math.max(scaleX, this.eps);
    const Y = -sy / Math.max(scaleY, this.eps);
    return this._backwardPerspectiveFamily(X, Y, distance);
  }

  _updateCameraBasis() {
    this.forward = this._norm3(this._horizontalVector(this.centerAzDeg, this.centerAltDeg));

    const worldUp = { x: 0, y: 0, z: 1 };
    let right = this._cross3(worldUp, this.forward);
    if (Math.hypot(right.x, right.y, right.z) < 1e-6) {
      const az = this._toRad(this.centerAzDeg);
      right = { x: Math.cos(az), y: -Math.sin(az), z: 0 };
    }
    this.right = this._norm3(right);
    this.up = this._norm3(this._cross3(this.forward, this.right));
  }

  setObserver(lat, lon, date) {
    this.lat = lat * Math.PI / 180;
    this.lon = lon;
    this.date = date;
    this.timeState = buildTimeState(date);
    this.lst = gmstHoursFromUt(date, lon);
  }

  setAtmosphere(partial = {}) {
    if (!partial || typeof partial !== 'object') return;
    const next = { ...this.atmosphere };
    if (Number.isFinite(partial.temperatureC)) {
      next.temperatureC = Math.max(-50, Math.min(50, Number(partial.temperatureC)));
    }
    if (Number.isFinite(partial.pressureHpa)) {
      next.pressureHpa = Math.max(300, Math.min(1100, Number(partial.pressureHpa)));
    }
    if (Number.isFinite(partial.transparencyIndex)) {
      next.transparencyIndex = Math.max(1, Math.min(8, Number(partial.transparencyIndex)));
    }
    if (typeof partial.enableRefraction === 'boolean') {
      next.enableRefraction = partial.enableRefraction;
    }
    const t = Number.isFinite(next.transparencyIndex) ? Number(next.transparencyIndex) : 4;
    next.extinctionK = Math.max(0.08, Math.min(0.9, 0.08 + (t - 1) * 0.09));
    this.atmosphere = next;
  }

  airmassFromAltDeg(altDeg) {
    if (!Number.isFinite(altDeg)) return Number.POSITIVE_INFINITY;
    if (altDeg <= -1) return Number.POSITIVE_INFINITY;
    const z = 90 - altDeg;
    if (z <= 0) return 1;
    if (z >= 90) return Number.POSITIVE_INFINITY;
    const zr = this._toRad(z);
    return 1.0 / (Math.cos(zr) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
  }

  extinctionTransmission(altDeg) {
    const x = this.airmassFromAltDeg(altDeg);
    if (!Number.isFinite(x)) return 0;
    const k = Number.isFinite(this.atmosphere?.extinctionK) ? Number(this.atmosphere.extinctionK) : 0.24;
    const exponent = -0.4 * k * Math.max(0, x - 1);
    return Math.max(0, Math.min(1, Math.pow(10, exponent)));
  }

  _refractionDeg(altDeg) {
    if (!this.atmosphere?.enableRefraction) return 0;
    if (!Number.isFinite(altDeg) || altDeg < -1 || altDeg > 89.9) return 0;
    const pressure = Number.isFinite(this.atmosphere.pressureHpa) ? Number(this.atmosphere.pressureHpa) : 1013.25;
    const temp = Number.isFinite(this.atmosphere.temperatureC) ? Number(this.atmosphere.temperatureC) : 10;
    const tanArg = this._toRad(altDeg + 10.3 / (altDeg + 5.11));
    const rArcMin = (1.02 / Math.tan(Math.max(this.eps, tanArg))) * (pressure / 1010) * (283 / (273 + temp));
    return rArcMin / 60.0;
  }

  _radecToAltAz(raHours, decDeg) {
    const ha = (this.lst - raHours) * 15.0 * Math.PI / 180.0;
    const dec = decDeg * Math.PI / 180.0;

    const sinAlt = Math.sin(dec) * Math.sin(this.lat)
                 + Math.cos(dec) * Math.cos(this.lat) * Math.cos(ha);
    const alt = Math.asin(this._clamp(sinAlt, -1, 1));

    const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(this.lat))
                / (Math.cos(alt) * Math.cos(this.lat) + 1e-10);
    let az = Math.acos(this._clamp(cosAz, -1, 1));
    if (Math.sin(ha) > 0) az = 2 * Math.PI - az;

    return {
      altDeg: this._toDeg(alt),
      azDeg: this._toDeg(az),
      alt,
      az,
    };
  }

  _normalizeRaHours(raHours) {
    let ra = Number(raHours) % 24;
    if (ra < 0) ra += 24;
    return ra;
  }

  _isSolarSystemObject(obj) {
    const kind = String(obj?.kind || '').toLowerCase();
    const id = String(obj?.id || '').toLowerCase();
    if (kind === 'planet' || kind === 'luminary' || kind === 'comet' || kind === 'asteroid' || kind === 'satellite' || kind === 'tle') {
      return true;
    }
    return id === 'sun' || id === 'moon';
  }

  _extractDistanceAu(obj) {
    if (Number.isFinite(obj?.distanceAu) && obj.distanceAu > 0) return Number(obj.distanceAu);
    if (Number.isFinite(obj?.distanceKm) && obj.distanceKm > 0) return Number(obj.distanceKm) / AU_KM;
    return null;
  }

  _topocentricRaDecFromGeocentric(raHours, decDeg, distanceAu) {
    if (!Number.isFinite(raHours) || !Number.isFinite(decDeg) || !Number.isFinite(distanceAu) || distanceAu <= 0) {
      return { raHours: this._normalizeRaHours(raHours), decDeg };
    }

    const raRad = this._toRad(raHours * 15);
    const decRad = this._toRad(decDeg);
    const cosDec = Math.cos(decRad);

    // Geocentric object vector in equatorial frame (AU)
    const objX = distanceAu * cosDec * Math.cos(raRad);
    const objY = distanceAu * cosDec * Math.sin(raRad);
    const objZ = distanceAu * Math.sin(decRad);

    // Observer geocentric vector in equatorial frame (AU), height ~= 0
    const observerRadiusAu = EARTH_EQUATORIAL_RADIUS_KM / AU_KM;
    const lstRad = this._toRad(this.lst * 15);
    const cosLat = Math.cos(this.lat);
    const sinLat = Math.sin(this.lat);
    const obsX = observerRadiusAu * cosLat * Math.cos(lstRad);
    const obsY = observerRadiusAu * cosLat * Math.sin(lstRad);
    const obsZ = observerRadiusAu * sinLat;

    // Topocentric vector
    const topX = objX - obsX;
    const topY = objY - obsY;
    const topZ = objZ - obsZ;
    const topR = Math.hypot(topX, topY, topZ);
    if (topR < this.eps) {
      return { raHours: this._normalizeRaHours(raHours), decDeg };
    }

    let topRaRad = Math.atan2(topY, topX);
    if (topRaRad < 0) topRaRad += 2 * Math.PI;
    const topDecRad = Math.asin(this._clamp(topZ / topR, -1, 1));

    return {
      raHours: this._normalizeRaHours(this._toDeg(topRaRad) / 15),
      decDeg: this._toDeg(topDecRad),
    };
  }

  getTopocentricRaDecForObject(obj) {
    if (!obj || !Number.isFinite(obj.ra) || !Number.isFinite(obj.dec)) return null;
    if (!this._isSolarSystemObject(obj)) {
      return { raHours: this._normalizeRaHours(obj.ra), decDeg: obj.dec };
    }
    const distanceAu = this._extractDistanceAu(obj);
    if (!Number.isFinite(distanceAu)) {
      return { raHours: this._normalizeRaHours(obj.ra), decDeg: obj.dec };
    }
    return this._topocentricRaDecFromGeocentric(obj.ra, obj.dec, distanceAu);
  }

  projectObject(obj) {
    const corrected = this.getTopocentricRaDecForObject(obj);
    if (!corrected) return { x: 0, y: 0, alt: 0, az: 0, visible: false };
    return this.project(corrected.raHours, corrected.decDeg);
  }

  setViewCenter(azDeg, altDeg) {
    this.centerAzDeg = this._wrapDeg(azDeg);
    this.centerAltDeg = this._clamp(altDeg, -89.5, 89.5);
    this._updateCameraBasis();
  }

  panByPixels(dx, dy) {
    const degPerPixel = this.fovDeg / Math.max(this.viewRadius * 2, 1);
    const cosAlt = Math.max(Math.cos(this._toRad(this.centerAltDeg)), 0.2);
    const deltaAz = -(dx * degPerPixel) / cosAlt;
    const deltaAlt = dy * degPerPixel;
    this.setViewCenter(this.centerAzDeg + deltaAz, this.centerAltDeg + deltaAlt);
  }

  zoomByFactor(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.fovDeg = this._clamp(this.fovDeg / factor, this.minFov, this.maxFov);
    this._recomputeScales();
  }

  setFov(fovDeg) {
    this.fovDeg = this._clamp(fovDeg, this.minFov, this.maxFov);
    this._recomputeScales();
  }

  centerOnRaDec(raHours, decDeg) {
    const h = this._radecToAltAz(raHours, decDeg);
    this.setViewCenter(h.azDeg, h.altDeg);
  }

  centerOnScreenPoint(screenX, screenY) {
    const cam = this.screenToCameraVector(screenX, screenY);
    const world = this._cameraToWorld(cam);
    const h = this._worldToHorizontal(world);
    this.setViewCenter(h.azDeg, h.altDeg);
  }

  horizontalFromScreenPoint(screenX, screenY) {
    const cam = this.screenToCameraVector(screenX, screenY);
    const world = this._cameraToWorld(cam);
    return this._worldToHorizontal(world);
  }

  getViewState() {
    const blend = this._projectionBlend();
    const resolvedMode = this._resolvedProjectionMode(blend);
    return {
      fovDeg: this.fovDeg,
      centerAzDeg: this.centerAzDeg,
      centerAltDeg: this.centerAltDeg,
      blendToPlanar: blend,
      modeLabel: resolvedMode,
      projectionModeSetting: this.projectionMode,
      deltaTSeconds: this.timeState.deltaTSeconds,
      utIso: this.timeState.utDate.toISOString(),
      ttIso: this.timeState.ttDate.toISOString(),
    };
  }

  project(ra_hours, dec_deg) {
    const h = this._radecToAltAz(ra_hours, dec_deg);
    const apparentAlt = h.altDeg + this._refractionDeg(h.altDeg);
    const world = this._horizontalVector(h.azDeg, apparentAlt);
    const cam = {
      x: this._dot3(world, this.right),
      y: this._dot3(world, this.up),
      z: this._dot3(world, this.forward),
    };

    const p = this.projectCameraVector(cam);
    if (!p) return { x: 0, y: 0, alt: apparentAlt, altTrue: h.altDeg, az: h.azDeg, visible: false };
    return {
      x: p.x,
      y: p.y,
      alt: apparentAlt,
      altTrue: h.altDeg,
      az: h.azDeg,
      visible: p.visible,
    };
  }

  projectHorizontal(azDeg, altDeg) {
    const world = this._horizontalVector(azDeg, altDeg);
    const cam = {
      x: this._dot3(world, this.right),
      y: this._dot3(world, this.up),
      z: this._dot3(world, this.forward),
    };

    const p = this.projectCameraVector(cam);
    if (!p) return { x: 0, y: 0, alt: altDeg, az: azDeg, visible: false };
    return {
      x: p.x,
      y: p.y,
      alt: altDeg,
      az: azDeg,
      visible: p.visible,
    };
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height / 2;
    this.radius = Math.min(width, height) / 2 * 0.95;
    this.viewRadius = this.radius;
    this._recomputeScales();
  }
}