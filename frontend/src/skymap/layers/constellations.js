/**
 * SkyCMD - Sternbilder Layer
 * Zeichnet Linien und IAU-Grenzen
 */
export class ConstellationsLayer {
  constructor(ctx, projection) {
    this.ctx = ctx;
    this.projection = projection;
  }

  drawLines(constellations, options = {}) {
    const { color = "rgba(80,120,180,0.6)", lineWidth = 0.8 } = options;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([]);
    for (const con of constellations) {
      for (const linePoints of con.lines) {
        if (!linePoints || linePoints.length < 2) continue;
        const projected = linePoints.map(p => this.projection.project(p.ra, p.dec));
        for (let i = 0; i < projected.length - 1; i++) {
          const a = projected[i];
          const b = projected[i + 1];
          if (!a.visible && !b.visible) continue;
          const dx = Math.abs(b.x - a.x);
          const dy = Math.abs(b.y - a.y);
          if (dx > 300 || dy > 300) continue; // Horizontsprung
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  drawBoundaries(boundaries, options = {}) {
    if (!Array.isArray(boundaries) || boundaries.length === 0) {
      return;
    }
    const { color = "rgba(120, 180, 220, 0.8)", lineWidth = 1.2 } = options;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([3, 3]);
    let drawnCount = 0;
    for (const boundary of boundaries) {
      for (const ring of boundary.rings) {
        if (ring.length < 2) continue;
        const projected = ring.map(p => this.projection.project(p.ra, p.dec));
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < projected.length; i++) {
          const pt = projected[i];
          if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
          else {
            const prev = projected[i - 1];
            const dx = Math.abs(pt.x - prev.x);
            const dy = Math.abs(pt.y - prev.y);
            if (dx > 200 || dy > 200) { ctx.moveTo(pt.x, pt.y); }
            else { ctx.lineTo(pt.x, pt.y); }
          }
        }
        ctx.stroke();
        drawnCount++;
      }
    }
    ctx.setLineDash([]);
  }

  drawLabels(constellations, options = {}) {
    const { hideBelowHorizon = false } = options;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(165, 188, 228, 0.78)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const con of constellations || []) {
      const center = this._constellationCenter(con);
      if (!center) continue;
      const p = this.projection.project(center.ra, center.dec);
      if (!p.visible) continue;
      if (hideBelowHorizon && p.alt < 0) continue;

      const label = String(con?.id || con?.name || '').trim();
      if (!label) continue;

      ctx.fillText(label, p.x, p.y);
    }
  }

  _constellationCenter(con) {
    const lines = Array.isArray(con?.lines) ? con.lines : [];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;

    for (const line of lines) {
      const points = Array.isArray(line) ? line : [];
      for (const pt of points) {
        if (!Number.isFinite(pt?.ra) || !Number.isFinite(pt?.dec)) continue;
        const raRad = ((Number(pt.ra) % 24) + 24) % 24 * 15 * Math.PI / 180;
        const decRad = Number(pt.dec) * Math.PI / 180;
        const cosDec = Math.cos(decRad);
        sx += cosDec * Math.cos(raRad);
        sy += cosDec * Math.sin(raRad);
        sz += Math.sin(decRad);
        count += 1;
      }
    }

    if (count < 1) return null;
    const len = Math.hypot(sx, sy, sz) || 1;
    const x = sx / len;
    const y = sy / len;
    const z = sz / len;
    let raRad = Math.atan2(y, x);
    if (raRad < 0) raRad += 2 * Math.PI;
    const decRad = Math.asin(Math.max(-1, Math.min(1, z)));
    return {
      ra: (raRad * 180 / Math.PI) / 15,
      dec: decRad * 180 / Math.PI,
    };
  }
}