/**
 * SkyCMD - SkyMap Renderer
 * Koordiniert alle Layer auf dem Canvas
 */
import { Projection } from './projection.js';
import { CatalogManager } from './catalog.js';
import { StarsLayer } from './layers/stars.js';
import { DSOLayer } from './layers/dso.js';
import { ConstellationsLayer } from './layers/constellations.js';

export class SkyMapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.projection = new Projection(canvas.width, canvas.height);
    this.catalog = new CatalogManager();
    this.layers = {
      stars: new StarsLayer(this.ctx, this.projection),
      dso: new DSOLayer(this.ctx, this.projection),
      constellations: new ConstellationsLayer(this.ctx, this.projection),
    };
    this.options = {
      showStars: true,
      showDSO: true,
      showConstellationLines: true,
      showConstellationBoundaries: false,
      showStarNames: true,
      showDSOLabels: true,
      magLimit: 6.5,
    };
    this.ready = false;
  }

  async init() {
    await this.catalog.loadAll();
    await this.catalog.loadConstellationBoundaries();
    this.ready = true;
    console.log('SkyMapRenderer: Kataloge geladen.');
  }

  setObserver(lat, lon, date) {
    this.projection.setObserver(lat, lon, date);
  }

  render() {
    if (!this.ready) return;
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    // Hintergrund
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, width, height);

    // Horizontkreis
    ctx.beginPath();
    ctx.arc(this.projection.cx, this.projection.cy, this.projection.radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(80,120,160,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.clip();

    // Layer zeichnen
    if (this.options.showConstellationBoundaries) {
      this.layers.constellations.drawBoundaries(this.catalog.getConstellationBoundaries());
    }
    if (this.options.showConstellationLines) {
      this.layers.constellations.drawLines(this.catalog.getConstellations());
    }
    if (this.options.showDSO) {
      this.layers.dso.draw(this.catalog.getDSO(), { showLabels: this.options.showDSOLabels });
    }
    if (this.options.showStars) {
      this.layers.stars.draw(
        this.catalog.getStars(),
        this.catalog.starNames,
        { magLimit: this.options.magLimit, showNames: this.options.showStarNames }
      );
    }

    ctx.restore();
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.projection.resize(width, height);
  }
}