/**
 * SkyCMD - Sterne Layer
 * Zeichnet Sterne auf Canvas mit B-V Farbindex
 */
export class StarsLayer {
  constructor(ctx, projection) {
    this.ctx = ctx;
    this.projection = projection;
  }

  draw(stars, starNames = {}, options = {}) {
    const { showNames = true, scaleFactor = 1 } = options;
    const { hideBelowHorizon = false } = options;
    const ctx = this.ctx;
    let drawn = 0;
    const pickables = [];

    for (const star of stars) {
      // Stars are pre-filtered by SQL API: mag_max constraint is applied at source
      const p = this.projection.project(star.ra, star.dec);
      if (!p.visible) continue;
      if (hideBelowHorizon && p.alt < 0) continue;
      const size = Math.max(0.5, (6.5 - star.mag) * scaleFactor * 0.8);
      const color = this._bvToColor(star.bv);
      const nameData = starNames[star.id];
      const propername = nameData?.propername;

      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      drawn += 1;
      pickables.push({
        kind: 'star',
        id: star.id,
        label: propername || star.id,
        propername,
        mag: star.mag,
        ra: star.ra,
        dec: star.dec,
        x: p.x,
        y: p.y,
        radius: Math.max(4, size + 2),
      });

      if (showNames && propername) {
        const name = propername;
        ctx.fillStyle = 'rgba(200,200,255,0.7)';
        ctx.font = `${Math.max(9, size * 2)}px sans-serif`;
        ctx.fillText(name, p.x + size + 2, p.y - size - 2);
      }
    }

    return { drawn, pickables };
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