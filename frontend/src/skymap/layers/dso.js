/**
 * SkyCMD - Deep-Sky-Objekte Layer
 * Zeichnet Messier + NGC Objekte
 */
export class DSOLayer {
  constructor(ctx, projection) {
    this.ctx = ctx;
    this.projection = projection;
  }

  draw(dsoList, options = {}) {
    const { showLabels = true, hideBelowHorizon = false } = options;
    let drawn = 0;
    const pickables = [];

    for (const obj of dsoList) {
      const p = this.projection.project(obj.ra, obj.dec);
      if (!p.visible) continue;
      if (hideBelowHorizon && p.alt < 0) continue;
      this._drawSymbol(p.x, p.y, obj.type);

      drawn += 1;
      pickables.push({
        kind: 'dso',
        id: obj.id,
        label: obj.name || obj.id,
        name: obj.name,
        type: obj.type,
        mag: obj.mag,
        ra: obj.ra,
        dec: obj.dec,
        x: p.x,
        y: p.y,
        radius: 8,
      });

      if (showLabels && obj.name) {
        this.ctx.fillStyle = 'rgba(180,220,180,0.8)';
        this.ctx.font = '9px sans-serif';
        this.ctx.fillText(obj.name, p.x + 7, p.y + 4);
      }
    }

    return { drawn, pickables };
  }

  _drawSymbol(x, y, type) {
    const ctx = this.ctx;
    const r = 5;
    const normalized = String(type || '').toLowerCase();
    const aliases = {
      open_cluster: 'OC',
      globular_cluster: 'GC',
      emission_nebula: 'EN',
      reflection_nebula: 'RN',
      supernova_remnant: 'SNR',
      galaxy: 'GAL',
      planetary_nebula: 'PN',
    };
    const code = aliases[normalized] || type;
    ctx.strokeStyle = this._typeColor(type);
    ctx.lineWidth = 1;
    ctx.beginPath();
    switch (code) {
      case 'OC': // Offener Sternhaufen
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'GC': // Kugelsternhaufen
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
        ctx.stroke();
        break;
      case 'EN': case 'RN': case 'SNR': // Nebel
        ctx.rect(x - r, y - r, r * 2, r * 2);
        ctx.stroke();
        break;
      case 'GAL': // Galaxie
        ctx.ellipse(x, y, r * 1.5, r * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      default:
        ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
    }
  }

  _typeColor(type) {
    const normalized = String(type || '').toLowerCase();
    const colors = {
      OC: '#ffff88', GC: '#ffaa44', EN: '#88ff88',
      RN: '#aaaaff', SNR: '#ff88aa', GAL: '#ffaaff',
      PN: '#44ffff'
    };
    const aliases = {
      open_cluster: 'OC',
      globular_cluster: 'GC',
      emission_nebula: 'EN',
      reflection_nebula: 'RN',
      supernova_remnant: 'SNR',
      galaxy: 'GAL',
      planetary_nebula: 'PN',
    };
    const code = colors[type] ? type : aliases[normalized];
    return colors[code] || '#cccccc';
  }
}