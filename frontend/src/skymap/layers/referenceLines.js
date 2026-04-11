/**
 * SkyCMD - Referenzlinien Layer
 * Zeichnet Himmelsaequator, lokalen Meridian und Ekliptik.
 */
export class ReferenceLinesLayer {
  constructor(ctx, projection) {
    this.ctx = ctx;
    this.projection = projection;
  }

  draw(options = {}) {
    const {
      showCelestialEquator = true,
      showEquatorialGrid = false,
      showMeridian = true,
      showEcliptic = true,
      showEclipticGrid = false,
      showAzimuthGrid = false,
      showHorizonLine = true,
      showHorizonFill = true,
      showCardinalDirections = true,
    } = options;

    const horizon = this._buildHorizonPoints();

    if (showHorizonFill) {
      this._drawHorizonFill(horizon);
    }

    if (showCelestialEquator) {
      this._drawCurve(this._buildEquatorPoints(), {
        color: 'rgba(120, 220, 255, 0.75)',
        width: 1,
        dash: [6, 4],
        hideBelowHorizon: showHorizonFill,
      });
    }

    if (showEquatorialGrid) {
      this._drawEquatorialGrid(showHorizonFill);
    }

    if (showMeridian) {
      this._drawProjectedCurve(this._buildMeridianProjectedPoints(), {
        color: 'rgba(255, 192, 110, 0.78)',
        width: 1,
        dash: [5, 4],
      });
    }

    if (showEcliptic) {
      this._drawCurve(this._buildEclipticPoints(), {
        color: 'rgba(172, 255, 138, 0.8)',
        width: 1.1,
        dash: [10, 4],
        hideBelowHorizon: showHorizonFill,
      });
    }

    if (showEclipticGrid) {
      this._drawEclipticGrid(showHorizonFill);
    }

    if (showAzimuthGrid) {
      this._drawAzimuthGrid();
    }

    if (showHorizonLine) {
      this._drawProjectedCurve(horizon, {
        color: 'rgba(255, 170, 120, 0.92)',
        width: 1.25,
        dash: [],
      });
    }

    if (showCardinalDirections) {
      this._drawCardinalDirections();
    }
  }

  _drawCurve(samples, style) {
    if (!samples || samples.length < 2) return;
    const projected = samples.map((p) => this.projection.project(p.ra, p.dec));
    this._drawProjectedCurve(projected, style);
  }

  _drawProjectedCurve(projected, style) {
    if (!projected || projected.length < 2) return;
    const ctx = this.ctx;
    const hideBelowHorizon = Boolean(style?.hideBelowHorizon);

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash || []);

    for (let i = 0; i < projected.length - 1; i += 1) {
      const a = projected[i];
      const b = projected[i + 1];
      if (!a.visible && !b.visible) continue;
      if (hideBelowHorizon && (a.alt < 0 || b.alt < 0)) continue;

      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx > 320 || dy > 320) continue;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  _drawHorizonFill(horizonProjected) {
    // Horizontflaeche deaktiviert: kein olivgruener Hintergrund.
    void horizonProjected;
  }

  _extractVisibleHorizonStrip(horizonProjected) {
    const strips = [];
    let current = [];

    const pushCurrent = () => {
      if (current.length >= 2) strips.push(current);
      current = [];
    };

    for (let i = 0; i < horizonProjected.length; i += 1) {
      const p = horizonProjected[i];
      if (!p?.visible || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        pushCurrent();
        continue;
      }

      if (current.length > 0) {
        const prev = current[current.length - 1];
        if (Math.abs(p.x - prev.x) > 320 || Math.abs(p.y - prev.y) > 320) {
          pushCurrent();
        }
      }

      current.push(p);
    }
    pushCurrent();

    if (!strips.length) return [];
    strips.sort((a, b) => b.length - a.length);
    const strip = strips[0].slice();

    // Wenn die sichtbare Kurve geschlossen ist (voller Kreis), waehlen wir
    // explizit den oberen Bogen von links nach rechts als Horizontkante.
    const first = strip[0];
    const last = strip[strip.length - 1];
    const closes = Math.hypot(last.x - first.x, last.y - first.y) < 12;
    if (closes && strip.length >= 8) {
      let minXIndex = 0;
      let maxXIndex = 0;
      for (let i = 1; i < strip.length; i += 1) {
        if (strip[i].x < strip[minXIndex].x) minXIndex = i;
        if (strip[i].x > strip[maxXIndex].x) maxXIndex = i;
      }

      const forwardArc = [];
      for (let i = minXIndex; ; i = (i + 1) % strip.length) {
        forwardArc.push(strip[i]);
        if (i === maxXIndex) break;
      }

      const backwardArc = [];
      for (let i = minXIndex; ; i = (i - 1 + strip.length) % strip.length) {
        backwardArc.push(strip[i]);
        if (i === maxXIndex) break;
      }

      const avgYForward = forwardArc.reduce((sum, p) => sum + p.y, 0) / forwardArc.length;
      const avgYBackward = backwardArc.reduce((sum, p) => sum + p.y, 0) / backwardArc.length;
      return avgYForward <= avgYBackward ? forwardArc : backwardArc;
    }

    // Offene Kurve: nach links->rechts normalisieren.
    if (strip[0].x <= strip[strip.length - 1].x) return strip;
    return strip.reverse();
  }

  _buildEquatorPoints() {
    const points = [];
    for (let ra = 0; ra <= 24.0001; ra += 0.25) {
      points.push({ ra, dec: 0 });
    }
    return points;
  }

  _buildMeridianProjectedPoints() {
    const points = [];

    // Sueden -> Zenit
    for (let alt = 0; alt <= 90; alt += 2) {
      points.push(this.projection.projectHorizontal(180, alt));
    }

    // Zenit -> Norden
    for (let alt = 88; alt >= 0; alt -= 2) {
      points.push(this.projection.projectHorizontal(0, alt));
    }

    return points;
  }

  _buildHorizonPoints() {
    const points = [];
    for (let az = 0; az <= 360; az += 2) {
      points.push(this.projection.projectHorizontal(az, 0));
    }
    return points;
  }

  _drawCardinalDirections() {
    const ctx = this.ctx;
    const points = [
      { label: 'N', az: 0 },
      { label: 'O', az: 90 },
      { label: 'S', az: 180 },
      { label: 'W', az: 270 },
    ];

    ctx.save();
    ctx.font = '700 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const item of points) {
      const p = this.projection.projectHorizontal(item.az, 2);
      if (!p.visible) continue;

      ctx.fillStyle = 'rgba(10, 24, 35, 0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(164, 205, 242, 0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(220, 239, 255, 0.96)';
      ctx.fillText(item.label, p.x, p.y + 0.3);
    }

    ctx.restore();
  }

  _buildEclipticPoints() {
    const points = [];

    for (let lambdaDeg = 0; lambdaDeg <= 360.0001; lambdaDeg += 2) {
      points.push(this._eclipticToEquatorial(lambdaDeg, 0));
    }

    return points;
  }

  _eclipticToEquatorial(lambdaDeg, betaDeg) {
    const eps = (23.439291 * Math.PI) / 180;
    const lambda = (lambdaDeg * Math.PI) / 180;
    const beta = (betaDeg * Math.PI) / 180;

    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    const sinBeta = Math.sin(beta);
    const cosBeta = Math.cos(beta);

    const raRad = Math.atan2(
      sinLambda * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
      cosLambda,
    );
    const decRad = Math.asin(sinBeta * Math.cos(eps) + cosBeta * Math.sin(eps) * sinLambda);

    let raHours = (raRad * 12) / Math.PI;
    if (raHours < 0) raHours += 24;
    return {
      ra: raHours,
      dec: (decRad * 180) / Math.PI,
    };
  }

  _drawEclipticGrid(hideBelowHorizon) {
    const lonColor = 'rgba(132, 232, 180, 0.24)';
    const latColor = 'rgba(112, 214, 165, 0.19)';

    for (let lon = 0; lon < 360; lon += 30) {
      const line = [];
      for (let beta = -90; beta <= 90; beta += 3) {
        line.push(this._eclipticToEquatorial(lon, beta));
      }
      this._drawCurve(line, {
        color: lonColor,
        width: 0.55,
        dash: [3, 5],
        hideBelowHorizon,
      });
    }

    for (let beta = -60; beta <= 60; beta += 30) {
      const line = [];
      for (let lon = 0; lon <= 360; lon += 3) {
        line.push(this._eclipticToEquatorial(lon, beta));
      }
      this._drawCurve(line, {
        color: latColor,
        width: 0.55,
        dash: [2, 6],
        hideBelowHorizon,
      });
    }
  }

  _drawEquatorialGrid(hideBelowHorizon) {
    const raColor = 'rgba(110, 205, 255, 0.2)';
    const decColor = 'rgba(130, 225, 255, 0.16)';

    for (let ra = 0; ra < 24; ra += 1) {
      const line = [];
      for (let dec = -90; dec <= 90; dec += 3) {
        line.push({ ra, dec });
      }
      this._drawCurve(line, {
        color: raColor,
        width: 0.55,
        dash: [3, 5],
        hideBelowHorizon,
      });
    }

    for (let dec = -60; dec <= 60; dec += 30) {
      const line = [];
      for (let ra = 0; ra <= 24; ra += 0.2) {
        line.push({ ra, dec });
      }
      this._drawCurve(line, {
        color: decColor,
        width: 0.55,
        dash: [2, 6],
        hideBelowHorizon,
      });
    }
  }

  _drawAzimuthGrid() {
    const circleColor = 'rgba(130, 170, 255, 0.18)';
    const spokeColor = 'rgba(160, 190, 255, 0.16)';

    for (let alt = 15; alt <= 75; alt += 15) {
      const ring = [];
      for (let az = 0; az <= 360; az += 3) {
        ring.push(this.projection.projectHorizontal(az, alt));
      }
      this._drawProjectedCurve(ring, {
        color: circleColor,
        width: 0.5,
        dash: [2, 6],
      });
    }

    for (let az = 0; az < 360; az += 30) {
      const spoke = [];
      for (let alt = 0; alt <= 90; alt += 2) {
        spoke.push(this.projection.projectHorizontal(az, alt));
      }
      this._drawProjectedCurve(spoke, {
        color: spokeColor,
        width: 0.5,
        dash: [2, 6],
      });
    }
  }
}
