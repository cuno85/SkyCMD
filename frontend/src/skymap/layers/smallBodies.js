/**
 * SkyCMD - Small Bodies Layer
 * Zeichnet Kometen und Asteroiden mit eigenen Symbolen.
 */
const OBJECT_LABEL_FONT_STACK = '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif';

export class SmallBodiesLayer {
  constructor(ctx, projection) {
    this.ctx = ctx;
    this.projection = projection;
  }

  draw(objects, options = {}) {
    const {
      showComets = true,
      showAsteroids = true,
      showLabels = true,
      hideBelowHorizon = false,
    } = options;

    let drawn = 0;
    const pickables = [];

    for (const obj of objects || []) {
      const kind = String(obj?.kind || '').toLowerCase();
      if (kind === 'comet' && !showComets) continue;
      if (kind === 'asteroid' && !showAsteroids) continue;
      if (kind !== 'comet' && kind !== 'asteroid') continue;

      const p = this.projection.projectObject(obj);
      if (!p.visible) continue;
      if (hideBelowHorizon && p.alt < 0) continue;

      if (kind === 'comet') {
        this._drawComet(p.x, p.y);
      } else {
        this._drawAsteroid(p.x, p.y);
      }
      drawn += 1;

      const label = obj.name || obj.id || (kind === 'comet' ? 'Komet' : 'Asteroid');
      pickables.push({
        kind,
        id: obj.id,
        label,
        name: obj.name,
        mag: obj.mag,
        distanceAu: obj.distanceAu,
        source: obj.source,
        ra: obj.ra,
        dec: obj.dec,
        x: p.x,
        y: p.y,
        radius: 9,
      });

      if (showLabels) {
        this.ctx.fillStyle = kind === 'comet' ? 'rgba(170, 230, 255, 0.95)' : 'rgba(225, 215, 195, 0.95)';
        this.ctx.font = `600 10px ${OBJECT_LABEL_FONT_STACK}`;
        this.ctx.fillText(label, p.x + 8, p.y - 7);
      }
    }

    return { drawn, pickables };
  }

  _drawComet(x, y) {
    const ctx = this.ctx;
    // Tail
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 5);
    ctx.lineTo(x + 1, y + 1);
    ctx.strokeStyle = 'rgba(130, 210, 255, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Coma
    ctx.beginPath();
    ctx.arc(x, y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(130, 220, 255, 0.35)';
    ctx.fill();

    // Nucleus
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200, 245, 255, 0.95)';
    ctx.fill();
  }

  _drawAsteroid(x, y) {
    const ctx = this.ctx;
    const r = 4.2;
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      const px = x + r * Math.cos(a);
      const py = y + r * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(199, 179, 144, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 235, 200, 0.95)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
