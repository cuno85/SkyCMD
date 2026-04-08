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
    const { color = "rgba(60,80,120,0.4)", lineWidth = 0.5 } = options;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([3, 3]);
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
      }
    }
    ctx.setLineDash([]);
  }
}