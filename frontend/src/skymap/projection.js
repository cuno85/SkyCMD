/**
 * SkyCMD - Azimutale aequidistante Projektion
 * Konvertiert RA/Dec in Bildschirmkoordinaten
 */
export class Projection {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height / 2;
    this.radius = Math.min(width, height) / 2 * 0.95;
  }

  setObserver(lat, lon, date) {
    this.lat = lat * Math.PI / 180;
    this.lon = lon;
    this.date = date;
    this.lst = this._calcLST(date, lon);
  }

  _calcLST(date, lon) {
    const jd = this._julianDate(date);
    const T = (jd - 2451545.0) / 36525.0;
    let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
             + 0.000387933 * T * T - T * T * T / 38710000.0;
    gmst = ((gmst % 360) + 360) % 360;
    return (gmst + lon) / 15.0;
  }

  _julianDate(date) {
    return date.getTime() / 86400000.0 + 2440587.5;
  }

  project(ra_hours, dec_deg) {
    const ha = (this.lst - ra_hours) * 15.0 * Math.PI / 180.0;
    const dec = dec_deg * Math.PI / 180.0;
    const sinAlt = Math.sin(dec) * Math.sin(this.lat)
                 + Math.cos(dec) * Math.cos(this.lat) * Math.cos(ha);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(this.lat))
                / (Math.cos(alt) * Math.cos(this.lat) + 1e-10);
    let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (Math.sin(ha) > 0) az = 2 * Math.PI - az;
    const r = this.radius * (Math.PI / 2 - alt) / (Math.PI / 2);
    const x = this.cx + r * Math.sin(az);
    const y = this.cy - r * Math.cos(az);
    return { x, y, alt: alt * 180 / Math.PI, az: az * 180 / Math.PI, visible: alt > -0.1 };
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height / 2;
    this.radius = Math.min(width, height) / 2 * 0.95;
  }
}