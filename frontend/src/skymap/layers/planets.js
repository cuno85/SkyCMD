/**
 * SkyCMD - Planeten Layer
 * Zeichnet geozentrische Planetenpositionen aus dem Backend (VSOP87).
 */
export class PlanetsLayer {
  constructor(ctx, projection) {
    this.ctx = ctx;
    this.projection = projection;
  }

  draw(planets, options = {}) {
    const { showLabels = true, hideBelowHorizon = false } = options;
    let drawn = 0;
    const pickables = [];

    for (const planet of planets || []) {
      const p = this.projection.projectObject(planet);
      if (!p.visible) continue;
      if (hideBelowHorizon && p.alt < 0) continue;

      this._drawPlanetSymbol(p.x, p.y, planet.id);
      drawn += 1;

      pickables.push({
        kind: 'planet',
        id: planet.id,
        label: planet.name,
        name: planet.name,
        symbol: this._planetSymbol(planet.id),
        mag: planet.mag,
        distanceAu: planet.distanceAu,
        distanceKm: planet.distanceKm,
        source: planet.source,
        ra: planet.ra,
        dec: planet.dec,
        x: p.x,
        y: p.y,
        radius: 10,
      });

      if (showLabels) {
        this.ctx.fillStyle = 'rgba(190, 255, 172, 0.95)';
        this.ctx.font = '10px sans-serif';
        this.ctx.fillText(planet.name, p.x + 8, p.y - 7);
      }
    }

    return { drawn, pickables };
  }

  _drawPlanetSymbol(x, y, planetId) {
    const ctx = this.ctx;
    const color = this._planetColor(planetId);
    const symbol = this._planetSymbol(planetId);
    const isLuminary = planetId === 'sun' || planetId === 'moon';
    const coreRadius = isLuminary ? 4.8 : 3.8;
    const haloRadius = isLuminary ? 8.8 : 7.0;

    ctx.beginPath();
    ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200, 245, 180, 0.75)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(225, 255, 210, 0.95)';
    ctx.font = '12px "Segoe UI Symbol", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, x, y + 0.5);
  }

  _planetColor(planetId) {
    const colors = {
      mercury: '#cfd9c0',
      venus: '#ffe0a3',
      mars: '#ff8b73',
      jupiter: '#ffd7a8',
      saturn: '#ffeeb4',
      uranus: '#9ee8f2',
      neptune: '#97b7ff',
      sun: '#ffe27b',
      moon: '#d7def2',
    };
    return colors[String(planetId || '').toLowerCase()] || '#dcffd0';
  }

  _planetSymbol(planetId) {
    const symbols = {
      mercury: '\u263F',
      venus: '\u2640',
      mars: '\u2642',
      jupiter: '\u2643',
      saturn: '\u2644',
      uranus: '\u2645',
      neptune: '\u2646',
      sun: '\u2609',
      moon: '\u263D',
    };
    return symbols[String(planetId || '').toLowerCase()] || '\u25CF';
  }
}
