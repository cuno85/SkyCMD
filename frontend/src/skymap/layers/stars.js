/**
 * SkyCMD - Sterne Layer
 * Zeichnet Sterne auf Canvas mit B-V Farbindex
 */
const OBJECT_LABEL_FONT_STACK = '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif';

export class StarsLayer {
  constructor(ctx, projection) {
    this.ctx = ctx;
    this.projection = projection;
  }

  draw(stars, starNames = {}, options = {}) {
    const { showNames = true, scaleFactor = 1, magLimit = 6.5, starNameMagLimit = 6.5 } = options;
    const resolveNameData = typeof options?.resolveStarName === 'function'
      ? options.resolveStarName
      : (star) => starNames[star?.id] || {};
    const rawProfile = String(options?.starVisualProfile || 'planetarium');
    const profile = rawProfile === 'enhanced' ? 'planetarium' : rawProfile;
    const effectiveMagLimit = this._effectiveMagLimit(magLimit, profile);
    const { hideBelowHorizon = false } = options;
    const ctx = this.ctx;
    let drawn = 0;
    const pickables = [];

    for (const star of stars) {
      if (!Number.isFinite(star?.mag) || star.mag > effectiveMagLimit) continue;
      const p = this.projection.project(star.ra, star.dec);
      if (!p.visible) continue;
      if (hideBelowHorizon && p.alt < 0) continue;
      const size = this._starRadius(star.mag, scaleFactor, profile);
      const color = this._bvToColor(star.bv);
      const nameData = resolveNameData(star) || {};
      const commonName = this._starCommonName(nameData);
      const fullLabel = this._starFullLabel(star.id, nameData);

      {
        const haloBoost = profile === 'planetarium' ? 1.45 : profile === 'conservative' ? 0.6 : 1.0;
        const alphaBase = profile === 'planetarium' ? 0.5 : profile === 'conservative' ? 0.22 : 0.4;
        const halo = size * (star.mag <= 1.8 ? 2.8 : 1.8) * haloBoost;
        const gradient = ctx.createRadialGradient(p.x, p.y, size * 0.2, p.x, p.y, halo);
        gradient.addColorStop(0, this._hexToRgba(color, star.mag <= 1.8 ? alphaBase : alphaBase * 0.45));
        gradient.addColorStop(1, this._hexToRgba(color, 0));
        ctx.beginPath();
        ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      drawn += 1;
      pickables.push({
        kind: 'star',
        id: star.id,
        label: fullLabel,
        propername: nameData?.propername,
        propernameDe: nameData?.propername_de,
        aliases: Array.isArray(nameData?.aliases) ? [...nameData.aliases] : [],
        bayer: nameData?.bayer,
        flamsteed: nameData?.flamsteed,
        mag: star.mag,
        ra: star.ra,
        dec: star.dec,
        x: p.x,
        y: p.y,
        radius: Math.max(4, size + 2),
      });

      if (showNames && fullLabel && Number.isFinite(star?.mag) && star.mag <= Number(starNameMagLimit)) {
        const name = fullLabel;
        ctx.fillStyle = 'rgba(200,200,255,0.7)';
        ctx.font = `${Math.max(9, size * 2)}px ${OBJECT_LABEL_FONT_STACK}`;
        ctx.fillText(name, p.x + size + 2, p.y - size - 2);
      }
    }

    return { drawn, pickables };
  }

  _starRadius(mag, scaleFactor = 1, profile = 'realistic') {
    const flux = Math.pow(10, -0.2 * Number(mag));
    const modeRaw = String(profile || 'planetarium');
    const mode = modeRaw === 'enhanced' ? 'planetarium' : modeRaw;
    const normalized = ['planetarium', 'realistic', 'conservative'].includes(mode)
      ? mode
      : 'planetarium';
    const modeScale = normalized === 'planetarium' ? 1.55 : normalized === 'conservative' ? 0.62 : 1.0;
    return Math.max(1.0, Math.min(6.5, (1.05 + 3.0 * Math.pow(flux, 0.9)) * scaleFactor * modeScale));
  }

  _effectiveMagLimit(magLimit, profile = 'realistic') {
    const modeRaw = String(profile || 'planetarium');
    const mode = modeRaw === 'enhanced' ? 'planetarium' : modeRaw;
    const normalized = ['planetarium', 'realistic', 'conservative'].includes(mode)
      ? mode
      : 'planetarium';
    if (mode === 'conservative') return Math.max(2.5, Math.min(25, Number(magLimit) - 1.5));
    if (normalized === 'planetarium') return Math.max(2.5, Math.min(25, Number(magLimit) + 0.8));
    return Math.max(2.5, Math.min(25, Number(magLimit)));
  }

  _starCommonName(nameData = {}) {
    const properDe = String(nameData?.propername_de || '').trim();
    const proper = String(nameData?.propername || '').trim();
    if (properDe) return properDe;
    if (proper) return proper;
    const aliases = Array.isArray(nameData?.aliases) ? nameData.aliases : [];
    for (const alias of aliases) {
      const cleaned = String(alias || '').trim();
      if (cleaned) return cleaned;
    }
    return '';
  }

  _starFullLabel(starId, nameData = {}) {
    const id = String(starId || '').trim();
    const common = this._starCommonName(nameData);
    if (common) return common;

    const idFromNameData = String(nameData?.id || '').trim();
    const matchedId = String(nameData?.matchedId || '').trim();
    const hipCandidate = [id, matchedId, idFromNameData].find((value) => /^HIP\s*\d+/i.test(value));
    if (hipCandidate) return hipCandidate;

    const flamsteed = String(nameData?.flamsteed || '').trim();
    if (flamsteed) return flamsteed;

    const bayer = String(nameData?.bayer || '').trim();
    if (bayer) return bayer;

    return id;
  }

  _hexToRgba(hex, alpha) {
    const val = String(hex || '#ffffff').replace('#', '');
    const safe = val.length === 6 ? val : 'ffffff';
    const r = Number.parseInt(safe.slice(0, 2), 16);
    const g = Number.parseInt(safe.slice(2, 4), 16);
    const b = Number.parseInt(safe.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  _bvToColor(bv) {
    if (bv === undefined || bv === null) return '#ffffff';
    if (bv < -0.3) return '#aaaaff';
    if (bv < 0.0)  return '#ccccff';
    if (bv < 0.3)  return '#ffffff';
    if (bv < 0.6)  return '#ffffcc';
    if (bv < 1.0)  return '#ffcc88';
    if (bv < 1.5)  return '#ff9944';
    return '#ff6622';
  }
}