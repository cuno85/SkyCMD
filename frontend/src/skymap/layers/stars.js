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
    const { magLimit = 6.5, showNames = true, scaleFactor = 1 } = options;
    const ctx = this.ctx;
    for (const star of stars) {
      if (star.mag > magLimit) continue;
      const p = this.projection.project(star.ra, star.dec);
      if (!p.visible) continue;
      const size = Math.max(0.5, (6.5 - star.mag) * scaleFactor * 0.8);
      const color = this._bvToColor(star.bv);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (showNames && starNames[star.id]) {
        const name = starNames[star.id].propername;
        ctx.fillStyle = 'rgba(200,200,255,0.7)';
        ctx.font = `${Math.max(9, size * 2)}px sans-serif`;
        ctx.fillText(name, p.x + size + 2, p.y - size - 2);
      }
    }
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