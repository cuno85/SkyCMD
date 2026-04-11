/**
 * SkyCMD - Deep-Sky-Objekte Layer
 * Zeichnet Messier + NGC Objekte
 */
const OBJECT_LABEL_FONT_STACK = '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif';

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
        this.ctx.font = `600 9px ${OBJECT_LABEL_FONT_STACK}`;
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
      cluster_open: 'OC',
      globular_cluster: 'GC',
      glob_cluster: 'GC',
      emission_nebula: 'EN',
      emission: 'EN',
      dark_nebula: 'DN',
      reflection_nebula: 'RN',
      reflexion_nebula: 'RN',
      relexionsnebel: 'RN',
      supernova_remnant: 'SNR',
      snr: 'SNR',
      galaxy: 'GAL',
      planetary_nebula: 'PN',
      exoplanet: 'EXO',
      double_star: 'DBL',
      binary_star: 'DBL',
      quasar: 'QSO',
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
      case 'DN': // Dunkelnebel
        ctx.rect(x - r, y - r, r * 2, r * 2);
        ctx.fillStyle = 'rgba(120,140,170,0.35)';
        ctx.fill();
        ctx.stroke();
        break;
      case 'GAL': // Galaxie
        ctx.ellipse(x, y, r * 1.5, r * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'EXO': // Exoplanet
        ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.moveTo(x - r * 1.3, y); ctx.lineTo(x + r * 1.3, y);
        ctx.stroke();
        break;
      case 'DBL': // Doppelstern
        ctx.arc(x - 2, y, r * 0.45, 0, Math.PI * 2);
        ctx.arc(x + 2, y, r * 0.45, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'QSO': // Quasar
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.3, y - r * 0.3);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x + r * 0.3, y + r * 0.3);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.3, y + r * 0.3);
        ctx.lineTo(x - r, y);
        ctx.lineTo(x - r * 0.3, y - r * 0.3);
        ctx.closePath();
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
      RN: '#aaaaff', DN: '#7f8ca3', SNR: '#ff88aa', GAL: '#ffaaff',
      PN: '#44ffff', EXO: '#8fd9ff', DBL: '#ffe7a1', QSO: '#ffc5da'
    };
    const aliases = {
      open_cluster: 'OC',
      cluster_open: 'OC',
      globular_cluster: 'GC',
      glob_cluster: 'GC',
      emission_nebula: 'EN',
      emission: 'EN',
      dark_nebula: 'DN',
      reflection_nebula: 'RN',
      reflexion_nebula: 'RN',
      relexionsnebel: 'RN',
      supernova_remnant: 'SNR',
      snr: 'SNR',
      galaxy: 'GAL',
      planetary_nebula: 'PN',
      exoplanet: 'EXO',
      double_star: 'DBL',
      binary_star: 'DBL',
      quasar: 'QSO',
    };
    const code = colors[type] ? type : aliases[normalized];
    return colors[code] || '#cccccc';
  }
}