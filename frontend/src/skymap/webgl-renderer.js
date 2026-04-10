/**
 * SkyCMD - WebGL Renderer
 */
import { Projection } from './projection.js';
import { CatalogManager } from './catalog.js';

export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, stencil: true });
    if (!this.gl) throw new Error('WebGL2 nicht verfuegbar.');

    this.projection = new Projection(canvas.width, canvas.height);
    this.catalog = new CatalogManager();

    this.options = {
      showStars: true,
      showDSO: true,
      showPlanets: true,
      showComets: true,
      showAsteroids: true,
      showConstellationLines: true,
      showConstellationBoundaries: false,
      showConstellationLabels: false,
      showCelestialEquator: true,
      showEquatorialGrid: false,
      showMeridian: true,
      showEcliptic: true,
      showEclipticGrid: false,
      showAzimuthGrid: false,
      showHorizonLine: true,
      showHorizonFill: true,
      showCardinalDirections: true,
      showStarNames: true,
      showDSOLabels: true,
      showPlanetLabels: true,
      magLimit: 6.5,
      starHeuristicMode: 'ultra',
    };

    this.stats = {
      totalStars: 0,
      visibleStars: 0,
      totalDSO: 0,
      visibleDSO: 0,
      totalPlanets: 0,
      visiblePlanets: 0,
      renderMs: 0,
    };

    this.pickables = [];
    this.planets = [];
    this.smallBodies = [];
    this.lastPlanetRequestKey = null;
    this.lastSmallBodyRequestKey = null;
    this.selectedObject = null;
    this.dataSourceOptions = {
      useBackendSmallBodies: true,
    };

    this._constellationNameById = new Map();
    this._constellationCenters = [];
    this._constellationIndexReady = false;

    this.ready = false;
    this._rafPending = false;
    this._renderErrorLogged = false;

    this._initWebGL();
  }

  _initWebGL() {
    const gl = this.gl;
    gl.clearColor(5 / 255, 10 / 255, 20 / 255, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.pointProgram = this._createProgram(
      `#version 300 es
      in vec2 aPos;
      in float aSize;
      in vec3 aColor;
      out vec3 vColor;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
        gl_PointSize = aSize;
        vColor = aColor;
      }`,
      `#version 300 es
      precision mediump float;
      in vec3 vColor;
      out vec4 outColor;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = dot(uv, uv);
        if (d > 0.25) discard;
        float alpha = 1.0 - smoothstep(0.0, 0.25, d);
        outColor = vec4(vColor, alpha);
      }`
    );

    this.lineProgram = this._createProgram(
      `#version 300 es
      in vec2 aPos;
      in vec3 aColor;
      out vec3 vColor;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
        vColor = aColor;
      }`,
      `#version 300 es
      precision mediump float;
      in vec3 vColor;
      out vec4 outColor;
      void main() {
        outColor = vec4(vColor, 0.9);
      }`
    );

    this.fillProgram = this._createProgram(
      `#version 300 es
      in vec2 aPos;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
      }`,
      `#version 300 es
      precision mediump float;
      uniform vec4 uColor;
      uniform vec2 uCanvasSize;
      uniform vec2 uCenter;
      uniform vec2 uScale;
      uniform float uDistance;
      uniform float uViewRadius;
      uniform float uCosHalfFov;
      uniform int uUseRectClip;
      uniform vec3 uRight;
      uniform vec3 uUp;
      uniform vec3 uForward;
      out vec4 outColor;
      void main() {
        float sx = gl_FragCoord.x - uCenter.x;
        float sy = (uCanvasSize.y - gl_FragCoord.y) - uCenter.y;

        bool useRect = (uUseRectClip != 0);
        if (!useRect && length(vec2(sx, sy)) > uViewRadius) {
          discard;
        }

        float scaleX = max(uScale.x, 1e-6);
        float scaleY = max(uScale.y, 1e-6);
        // Must match projection.screenToCameraVector(): X uses mirrored sign.
        float X = -sx / scaleX;
        float Y = -sy / scaleY;

        float factor = max(uDistance + 1.0, 1e-6);
        float u = X / factor;
        float v = Y / factor;
        float q = u * u + v * v;
        float disc = max(0.0, 1.0 + q * (1.0 - uDistance * uDistance));
        float z = (-q * uDistance + sqrt(disc)) / (q + 1.0);
        float k = uDistance + z;
        vec3 cam = normalize(vec3(u * k, v * k, z));

        if (!useRect && cam.z < uCosHalfFov) {
          discard;
        }

        vec3 world = uRight * cam.x + uUp * cam.y + uForward * cam.z;
        if (world.z >= 0.0) {
          discard;
        }

        outColor = uColor;
      }`
    );

    this.textProgram = this._createProgram(
      `#version 300 es
      in vec2 aPos;
      in vec2 aUv;
      in vec3 aColor;
      out vec2 vUv;
      out vec3 vColor;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
        vUv = aUv;
        vColor = aColor;
      }`,
      `#version 300 es
      precision mediump float;
      in vec2 vUv;
      in vec3 vColor;
      uniform sampler2D uAtlas;
      out vec4 outColor;
      void main() {
        float a = texture(uAtlas, vUv).r;
        if (a < 0.05) discard;
        outColor = vec4(vColor, a);
      }`
    );

    this.pointVao = gl.createVertexArray();
    this.pointPosBuffer = gl.createBuffer();
    this.pointSizeBuffer = gl.createBuffer();
    this.pointColorBuffer = gl.createBuffer();

    this.lineVao = gl.createVertexArray();
    this.linePosBuffer = gl.createBuffer();
    this.lineColorBuffer = gl.createBuffer();

    this.fillVao = gl.createVertexArray();
    this.fillPosBuffer = gl.createBuffer();

    this.textVao = gl.createVertexArray();
    this.textPosBuffer = gl.createBuffer();
    this.textUvBuffer = gl.createBuffer();
    this.textColorBuffer = gl.createBuffer();

    this._initTextAtlas();
  }

  _initTextAtlas() {
    const gl = this.gl;
    const chars = [];
    for (let code = 32; code <= 126; code += 1) chars.push(String.fromCharCode(code));

    const cols = 16;
    const rows = Math.ceil(chars.length / cols);
    const cellW = 18;
    const cellH = 24;
    const atlasW = cols * cellW;
    const atlasH = rows * cellH;

    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = atlasW;
    atlasCanvas.height = atlasH;
    const ctx = atlasCanvas.getContext('2d');
    if (!ctx) {
      this.textAtlas = null;
      this.glyphMap = {};
      return;
    }

    ctx.clearRect(0, 0, atlasW, atlasH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '700 15px sans-serif';

    this.glyphMap = {};
    chars.forEach((ch, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = col * cellW;
      const y = row * cellH;
      ctx.fillText(ch, x + 1, y + 3);

      this.glyphMap[ch] = {
        u0: x / atlasW,
        v0: y / atlasH,
        u1: (x + cellW) / atlasW,
        v1: (y + cellH) / atlasH,
        w: cellW,
      };
    });

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, atlasCanvas);
    this.textAtlas = tex;
    this.textCellH = cellH;
  }

  _createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs) || 'VS compile error');

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fs) || 'FS compile error');

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program link error');

    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  async init() {
    try {
      await this.catalog.loadAll();
    } catch (error) {
      console.error('Kataloge konnten nicht vollstaendig geladen werden:', error);
    }

    try {
      await this.catalog.loadConstellationBoundaries();
    } catch (error) {
      console.warn('Konstellationsgrenzen konnten nicht geladen werden:', error);
    }

    this.stats.totalStars = this.catalog.getStars().length;
    this.stats.totalDSO = this.catalog.getDSO().length;

    try {
      await this._refreshPlanets(new Date());
    } catch {
      // already logged
    }

    try {
      await this._refreshSmallBodies(new Date());
    } catch {
      // already logged
    }

    this.ready = true;
    this.requestDraw();
    console.log('WebGLRenderer: Kataloge geladen.');
  }

  setDataSourceOptions(options = {}) {
    this.dataSourceOptions = {
      ...this.dataSourceOptions,
      ...options,
    };
    if (!this.dataSourceOptions.useBackendSmallBodies) {
      this.smallBodies = [];
      this.lastSmallBodyRequestKey = null;
      this.requestDraw();
    }
  }

  async reconfigureCatalogSources(sources = {}) {
    this.catalog.setSources(sources);
    await this.catalog.loadAll();
    await this.catalog.loadConstellationBoundaries();
    this._constellationIndexReady = false;
    this.stats.totalStars = this.catalog.getStars().length;
    this.stats.totalDSO = this.catalog.getDSO().length;
    this.requestDraw();
  }

  setObserver(lat, lon, date) {
    this.projection.setObserver(lat, lon, date);
    this._refreshPlanets(date);
    this._refreshSmallBodies(date);
    this.requestDraw();
  }

  _planetRequestKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  async _refreshPlanets(date) {
    const requestKey = this._planetRequestKey(date);
    if (!requestKey || requestKey === this.lastPlanetRequestKey) return;
    this.lastPlanetRequestKey = requestKey;
    const dt = date instanceof Date ? date : new Date(date);
    const query = encodeURIComponent(dt.toISOString());

    try {
      const response = await fetch(`/api/planets?datetime_iso=${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const planets = Array.isArray(payload?.planets) ? payload.planets : [];
      this.planets = planets.filter((p) => Number.isFinite(p?.ra) && Number.isFinite(p?.dec)).map((p) => ({
        id: String(p.id || '').toLowerCase(),
        name: p.name || p.id || 'Planet',
        kind: p.kind || 'planet',
        symbol: p.symbol,
        ra: Number(p.ra),
        dec: Number(p.dec),
        mag: Number.isFinite(p.mag) ? Number(p.mag) : null,
        distanceAu: Number.isFinite(p.distanceAu) ? Number(p.distanceAu) : null,
        distanceKm: Number.isFinite(p.distanceKm) ? Number(p.distanceKm) : null,
      }));
      this.stats.totalPlanets = this.planets.length;
    } catch (error) {
      console.warn('Planeten konnten nicht geladen werden:', error);
      this.planets = [];
      this.stats.totalPlanets = 0;
    }
  }

  async _refreshSmallBodies(date) {
    if (!this.dataSourceOptions.useBackendSmallBodies) return;
    const requestKey = this._planetRequestKey(date);
    if (!requestKey || requestKey === this.lastSmallBodyRequestKey) return;
    this.lastSmallBodyRequestKey = requestKey;
    const dt = date instanceof Date ? date : new Date(date);
    const query = encodeURIComponent(dt.toISOString());

    try {
      const response = await fetch(`/api/solar-system/positions?datetime_iso=${query}&asteroid_limit=600&comet_limit=250&mag_limit=18`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const asteroids = Array.isArray(payload?.asteroids) ? payload.asteroids : [];
      const comets = Array.isArray(payload?.comets) ? payload.comets : [];
      this.smallBodies = [...asteroids, ...comets]
        .filter((x) => Number.isFinite(x?.ra) && Number.isFinite(x?.dec))
        .map((x) => ({
          id: x.id,
          name: x.name,
          kind: x.kind,
          ra: Number(x.ra),
          dec: Number(x.dec),
          mag: Number.isFinite(x.mag) ? Number(x.mag) : null,
          distanceAu: Number.isFinite(x.distanceAu) ? Number(x.distanceAu) : null,
        }));
    } catch (error) {
      console.warn('Kleine Koerper konnten nicht geladen werden:', error);
      this.smallBodies = [];
    }
  }

  _toNdc(x, y) {
    return {
      x: (x / this.canvas.width) * 2 - 1,
      y: 1 - (y / this.canvas.height) * 2,
    };
  }

  _computeStarHeuristic(fovDeg, width, height, totalStars) {
    const mode = String(this.options?.starHeuristicMode || 'balanced').toLowerCase();
    const pixels = Math.max(1, width * height);
    const zoomBase = 160 / Math.max(fovDeg, 5);

    let zoomBoost;
    let baseBudget;
    let budgetMin;
    let budgetCap;
    let brightLimit;
    let cellPx;
    let maxPerCell;

    if (mode === 'ultra') {
      zoomBoost = Math.max(1.2, Math.min(5.5, zoomBase));
      baseBudget = Math.floor(pixels / 4);
      budgetMin = 30000;
      budgetCap = 500000;
      brightLimit = Math.max(5.5, Math.min(11.0, 5.5 + zoomBase * 2.4));
      cellPx = Math.max(1.0, Math.min(2.4, 2.4 - zoomBase * 0.35));
      maxPerCell = Math.max(2, Math.min(12, Math.round(2 + zoomBase * 2.1)));
    } else {
      zoomBoost = Math.max(1.0, Math.min(3.5, 140 / Math.max(fovDeg, 5)));
      baseBudget = Math.floor(pixels / 8);
      budgetMin = 12000;
      budgetCap = 380000;
      brightLimit = Math.max(3.5, Math.min(9.5, 3.5 + (140 / Math.max(fovDeg, 5)) * 2.0));
      cellPx = Math.max(1.6, Math.min(3.6, 3.8 - (140 / Math.max(fovDeg, 5)) * 0.52));
      maxPerCell = Math.max(1, Math.min(5, Math.round(1 + (120 / Math.max(fovDeg, 5)) * 1.35)));
    }

    const budget = Math.max(budgetMin, Math.min(budgetCap, Math.floor(baseBudget * zoomBoost)));

    return {
      budget: Math.min(budget, Math.max(1, totalStars)),
      brightLimit,
      cellPx,
      maxPerCell,
      zoomBoost,
      mode,
    };
  }

  requestDraw() {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      this.render();
    });
  }

  render() {
    if (!this.ready) return;
    const started = performance.now();
    const gl = this.gl;

    try {
      const view = this.projection.getViewState();
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.pickables = [];

      const pointPos = [];
      const pointSize = [];
      const pointColor = [];
      const labels = [];

      const pushPoint = (obj, size, color, kind, label) => {
        const p = this.projection.project(obj.ra, obj.dec);
        if (!p.visible) return;
        if (this.options.showHorizonFill && p.alt < 0) return;

        const ndc = this._toNdc(p.x, p.y);
        pointPos.push(ndc.x, ndc.y);
        pointSize.push(size);
        pointColor.push(color[0], color[1], color[2]);
        this.pickables.push({
          kind,
          id: obj.id,
          label,
          ra: obj.ra,
          dec: obj.dec,
          mag: obj.mag,
          x: p.x,
          y: p.y,
          radius: Math.max(6, size + 2),
          name: obj.name,
          type: obj.type,
        });

        if (kind === 'planet' && this.options.showPlanetLabels && label) {
          labels.push({ x: p.x + 8, y: p.y - 10, text: String(label).slice(0, 24), color: [1.0, 0.88, 0.58] });
        }
        if (kind === 'dso' && this.options.showDSOLabels && label) {
          labels.push({ x: p.x + 7, y: p.y - 8, text: String(label).slice(0, 24), color: [0.62, 0.84, 1.0] });
        }
        if (kind === 'star' && this.options.showStarNames && obj.mag <= 2.5 && label) {
          labels.push({ x: p.x + 6, y: p.y - 6, text: String(label).slice(0, 18), color: [0.9, 0.93, 1.0] });
        }
      };

      if (this.options.showStars) {
        const stars = this.catalog.getStars();
        const heuristic = this._computeStarHeuristic(view.fovDeg, this.canvas.width, this.canvas.height, stars.length);
        const magLimit = Number.isFinite(this.options?.magLimit)
          ? Number(this.options.magLimit)
          : 6.5;
        const gridCols = Math.max(1, Math.ceil(this.canvas.width / heuristic.cellPx));
        const gridRows = Math.max(1, Math.ceil(this.canvas.height / heuristic.cellPx));
        const occupancy = new Uint8Array(gridCols * gridRows);

        let visibleStars = 0;
        let brightRendered = 0;
        let faintRendered = 0;
        const faintStride = 1;

        const tryRenderStar = (star, allowDense = false, ignoreDensity = false) => {
          if (!Number.isFinite(star?.mag)) return false;
          if (star.mag > magLimit) return false;
          const p = this.projection.project(star.ra, star.dec);
          if (!p.visible) return false;
          if (this.options.showHorizonFill && p.alt < 0) return false;

          const gx = Math.max(0, Math.min(gridCols - 1, Math.floor(p.x / heuristic.cellPx)));
          const gy = Math.max(0, Math.min(gridRows - 1, Math.floor(p.y / heuristic.cellPx)));
          const gIdx = gy * gridCols + gx;
          if (!ignoreDensity && !allowDense && occupancy[gIdx] >= heuristic.maxPerCell) return false;
          occupancy[gIdx] = Math.min(255, occupancy[gIdx] + 1);

          const ndc = this._toNdc(p.x, p.y);
          const bv = Number.isFinite(star?.bv) ? star.bv : 0.3;
          const color = this._bvColor(bv);
          const size = Math.max(0.9, Math.min(5.2, (7.0 - star.mag) * 0.9));
          const starId = String(star.id || star.name || 'star');
          const propername = this.catalog.starNames?.[starId]?.propername;
          const displayName = this._formatStarDisplayName(starId, propername);

          pointPos.push(ndc.x, ndc.y);
          pointSize.push(size);
          pointColor.push(color[0], color[1], color[2]);
          this.pickables.push({
            kind: 'star',
            id: starId,
            label: displayName,
            ra: star.ra,
            dec: star.dec,
            mag: star.mag,
            x: p.x,
            y: p.y,
            radius: Math.max(6, size + 2),
            name: displayName,
          });

          if (this.options.showStarNames && star.mag <= 2.5 && (propername || starId)) {
            labels.push({ x: p.x + 6, y: p.y - 6, text: String(propername || starId).slice(0, 18), color: [0.9, 0.93, 1.0] });
          }

          return true;
        };

        // Wissenschaftlich/strikt: zeige alle Katalogsterne bis zum gesetzten Mag-Limit.
        for (let i = 0; i < stars.length; i += 1) {
          if (tryRenderStar(stars[i], true, true)) {
            visibleStars += 1;
            if (stars[i].mag <= heuristic.brightLimit) brightRendered += 1;
            else faintRendered += 1;
          }
        }

        this.stats.visibleStars = visibleStars;
        this.stats.starBudget = visibleStars;
        this.stats.starBrightLimit = heuristic.brightLimit;
        this.stats.starSamplingStride = faintStride;
        this.stats.starBrightRendered = brightRendered;
        this.stats.starFaintRendered = faintRendered;
        this.stats.starMaxPerCell = heuristic.maxPerCell;
        this.stats.starHeuristicMode = heuristic.mode;
      } else {
        this.stats.visibleStars = 0;
      }

      if (this.options.showDSO) {
        let visibleDso = 0;
        for (const obj of this.catalog.getDSO()) {
          pushPoint(obj, 4.0, [0.5, 0.8, 1.0], 'dso', obj.name || obj.id);
          visibleDso += 1;
        }
        this.stats.visibleDSO = visibleDso;
      } else {
        this.stats.visibleDSO = 0;
      }

      if (this.options.showPlanets) {
        let visiblePlanets = 0;
        for (const planet of this.planets) {
          pushPoint(planet, 6.0, [1.0, 0.85, 0.35], 'planet', planet.name || planet.id);
          visiblePlanets += 1;
        }
        this.stats.visiblePlanets = visiblePlanets;
      } else {
        this.stats.visiblePlanets = 0;
      }

      const showComets = this.options.showComets === true;
      const showAsteroids = this.options.showAsteroids === true;
      for (const body of this.smallBodies) {
        const kind = String(body?.kind || '').toLowerCase();
        if (kind === 'comet' && !showComets) continue;
        if (kind === 'asteroid' && !showAsteroids) continue;
        const color = kind === 'comet' ? [0.55, 1.0, 0.75] : [0.9, 0.9, 0.95];
        pushPoint(body, 3.0, color, kind || 'smallbody', body.name || body.id);
      }

      if (this.options.showCardinalDirections) {
        this._appendCardinalLabels(labels);
      }

      this._drawLines();
      this._drawPoints(pointPos, pointSize, pointColor);
      this._drawSelectionLines();
      if (this.options.showHorizonFill) {
        this._drawHorizonFillMask();
      }
      this._drawLabels(labels);

      this._renderErrorLogged = false;
    } catch (error) {
      if (!this._renderErrorLogged) {
        console.error('Render-Fehler in WebGLRenderer:', error);
        this._renderErrorLogged = true;
      }
      this.pickables = [];
      this.stats.visibleStars = 0;
      this.stats.visibleDSO = 0;
      this.stats.visiblePlanets = 0;
    }

    this.stats.renderMs = performance.now() - started;
  }

  _drawHorizonFillMask() {
    const gl = this.gl;
    const overlay = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    const view = this.projection.getViewState();
    const blend = Math.max(0, Math.min(1, Number(view?.blendToPlanar || 0)));
    const distance = 1 - blend;
    const scaleX = this.projection.stereoScale * (1 - blend) + this.projection.gnomonicScaleX * blend;
    const scaleY = this.projection.stereoScale * (1 - blend) + this.projection.gnomonicScaleY * blend;
    const useRectClip = view?.modeLabel === 'gnomonic' || view?.modeLabel === 'transition';
    const halfFovRad = (Number(this.projection.fovDeg) * Math.PI) / 360;
    const cosHalfFov = Math.cos(halfFovRad);

    gl.useProgram(this.fillProgram);
    gl.bindVertexArray(this.fillVao);

    const posLoc = gl.getAttribLocation(this.fillProgram, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fillPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, overlay, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(gl.getUniformLocation(this.fillProgram, 'uCanvasSize'), this.canvas.width, this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.fillProgram, 'uCenter'), this.projection.cx, this.projection.cy);
    gl.uniform2f(gl.getUniformLocation(this.fillProgram, 'uScale'), scaleX, scaleY);
    gl.uniform1f(gl.getUniformLocation(this.fillProgram, 'uDistance'), distance);
    gl.uniform1f(gl.getUniformLocation(this.fillProgram, 'uViewRadius'), this.projection.viewRadius);
    gl.uniform1f(gl.getUniformLocation(this.fillProgram, 'uCosHalfFov'), cosHalfFov);
    gl.uniform1i(gl.getUniformLocation(this.fillProgram, 'uUseRectClip'), useRectClip ? 1 : 0);
    gl.uniform3f(gl.getUniformLocation(this.fillProgram, 'uRight'), this.projection.right.x, this.projection.right.y, this.projection.right.z);
    gl.uniform3f(gl.getUniformLocation(this.fillProgram, 'uUp'), this.projection.up.x, this.projection.up.y, this.projection.up.z);
    gl.uniform3f(gl.getUniformLocation(this.fillProgram, 'uForward'), this.projection.forward.x, this.projection.forward.y, this.projection.forward.z);
    const colorLoc = gl.getUniformLocation(this.fillProgram, 'uColor');
    gl.uniform4f(colorLoc, 0.06, 0.12, 0.08, 0.62);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _drawLabels(labels) {
    if (!this.textAtlas || !Array.isArray(labels) || labels.length === 0) return;
    const gl = this.gl;

    const pos = [];
    const uv = [];
    const color = [];
    const maxLabels = 260;
    const maxChars = 28;

    const addGlyphQuad = (x, y, w, h, glyph, col) => {
      const p0 = this._toNdc(x, y);
      const p1 = this._toNdc(x + w, y);
      const p2 = this._toNdc(x, y + h);
      const p3 = this._toNdc(x + w, y + h);

      pos.push(
        p0.x, p0.y,
        p1.x, p1.y,
        p2.x, p2.y,
        p2.x, p2.y,
        p1.x, p1.y,
        p3.x, p3.y,
      );

      uv.push(
        glyph.u0, glyph.v0,
        glyph.u1, glyph.v0,
        glyph.u0, glyph.v1,
        glyph.u0, glyph.v1,
        glyph.u1, glyph.v0,
        glyph.u1, glyph.v1,
      );

      for (let i = 0; i < 6; i += 1) {
        color.push(col[0], col[1], col[2]);
      }
    };

    for (let li = 0; li < labels.length && li < maxLabels; li += 1) {
      const entry = labels[li];
      if (!entry || !entry.text) continue;
      let penX = entry.x;
      const penY = entry.y;
      const text = String(entry.text).slice(0, maxChars);
      const col = Array.isArray(entry.color) ? entry.color : [0.9, 0.95, 1.0];
      for (const ch of text) {
        const glyph = this.glyphMap[ch] || this.glyphMap['?'];
        if (!glyph) continue;
        addGlyphQuad(penX, penY, glyph.w - 5, this.textCellH - 8, glyph, col);
        penX += glyph.w - 7;
      }
    }

    if (!pos.length) return;

    gl.useProgram(this.textProgram);
    gl.bindVertexArray(this.textVao);

    const posLoc = gl.getAttribLocation(this.textProgram, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uvLoc = gl.getAttribLocation(this.textProgram, 'aUv');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textUvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

    const colorLoc = gl.getAttribLocation(this.textProgram, 'aColor');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(color), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textAtlas);
    const atlasLoc = gl.getUniformLocation(this.textProgram, 'uAtlas');
    gl.uniform1i(atlasLoc, 0);

    gl.drawArrays(gl.TRIANGLES, 0, pos.length / 2);
  }

  _drawPoints(pointPos, pointSize, pointColor) {
    if (pointSize.length === 0) return;
    const gl = this.gl;
    gl.useProgram(this.pointProgram);
    gl.bindVertexArray(this.pointVao);

    const posLoc = gl.getAttribLocation(this.pointProgram, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointPos), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const sizeLoc = gl.getAttribLocation(this.pointProgram, 'aSize');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointSizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointSize), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(sizeLoc);
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 0, 0);

    const colorLoc = gl.getAttribLocation(this.pointProgram, 'aColor');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointColor), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, pointSize.length);
  }

  _drawLines() {
    const gl = this.gl;
    const linePos = [];
    const lineColor = [];

    const pushProjectedSegment = (p1, p2, color, hideBelowHorizon = false) => {
      let a = p1;
      let b = p2;

      if (hideBelowHorizon) {
        if (a.alt < 0 && b.alt < 0) return;
        if (a.alt < 0 || b.alt < 0) {
          const denom = a.alt - b.alt;
          if (Math.abs(denom) < 1e-6) return;
          const t = Math.max(0, Math.min(1, a.alt / denom));
          const clipped = {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            alt: 0,
            visible: true,
          };
          if (a.alt < 0) a = clipped;
          else b = clipped;
        }
      }

      if (!a.visible && !b.visible) return;
      if (this.options.showHorizonFill && a.alt < 0 && b.alt < 0) return;
      const n1 = this._toNdc(a.x, a.y);
      const n2 = this._toNdc(b.x, b.y);
      linePos.push(n1.x, n1.y, n2.x, n2.y);
      lineColor.push(color[0], color[1], color[2], color[0], color[1], color[2]);
    };

    const pushProjectedPolyline = (points, color, hideBelowHorizon = false) => {
      if (!points || points.length < 2) return;
      // Only drop truly discontinuous jumps (projection branch cuts),
      // not legitimate long edge segments near the viewport border.
      const maxJumpX = this.canvas.width * 1.8;
      const maxJumpY = this.canvas.height * 1.8;
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);
        if (dx > maxJumpX || dy > maxJumpY) continue;
        pushProjectedSegment(a, b, color, hideBelowHorizon);
      }
    };

    const pushSegment = (a, b, color, hideBelowHorizon = false) => {
      const p1 = this.projection.project(a.ra, a.dec);
      const p2 = this.projection.project(b.ra, b.dec);
      pushProjectedSegment(p1, p2, color, hideBelowHorizon);
    };

    // Reference lines
    if (this.options.showCelestialEquator) {
      pushProjectedPolyline(this._buildEquatorProjectedPoints(), [0.47, 0.86, 0.98], this.options.showHorizonFill);
    }

    if (this.options.showEquatorialGrid) {
      const equatorialGrid = this._buildEquatorialGridProjected();
      for (const line of equatorialGrid) {
        pushProjectedPolyline(line.points, line.color, this.options.showHorizonFill);
      }
    }

    if (this.options.showMeridian) {
      pushProjectedPolyline(this._buildMeridianProjectedPoints(), [1.0, 0.75, 0.45], this.options.showHorizonFill);
    }

    if (this.options.showEcliptic) {
      pushProjectedPolyline(this._buildEclipticProjectedPoints(), [0.67, 1.0, 0.54], this.options.showHorizonFill);
    }

    if (this.options.showHorizonLine) {
      pushProjectedPolyline(this._buildHorizonProjectedPoints(), [1.0, 0.67, 0.47], false);
    }

    if (this.options.showEclipticGrid) {
      const eclipticGrid = this._buildEclipticGridProjected();
      for (const line of eclipticGrid) {
        pushProjectedPolyline(line.points, line.color, this.options.showHorizonFill);
      }
    }

    if (this.options.showAzimuthGrid) {
      const azimuthGrid = this._buildAzimuthGridProjected();
      for (const line of azimuthGrid) {
        pushProjectedPolyline(line.points, line.color, this.options.showHorizonFill);
      }
    }

    if (this.options.showConstellationLines) {
      const hideConstellationsBelowHorizon = this.options.showHorizonFill;
      for (const c of this.catalog.getConstellations() || []) {
        for (const line of c.lines || []) {
          for (let i = 1; i < line.length; i++) {
            pushSegment(line[i - 1], line[i], [0.33, 0.46, 0.7], hideConstellationsBelowHorizon);
          }
        }
      }
    }

    if (this.options.showConstellationBoundaries) {
      const hideBoundariesBelowHorizon = this.options.showHorizonFill;
      for (const poly of this.catalog.getConstellationBoundaries() || []) {
        for (let i = 1; i < poly.length; i++) {
          const prev = poly[i - 1];
          const curr = poly[i];
          pushSegment(
            { ra: prev.ra / 15, dec: prev.dec },
            { ra: curr.ra / 15, dec: curr.dec },
            [0.45, 0.55, 0.75],
            hideBoundariesBelowHorizon,
          );
        }
      }
    }

    if (!linePos.length) return;

    gl.useProgram(this.lineProgram);
    gl.bindVertexArray(this.lineVao);

    const posLoc = gl.getAttribLocation(this.lineProgram, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(linePos), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const colorLoc = gl.getAttribLocation(this.lineProgram, 'aColor');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineColor), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINES, 0, linePos.length / 2);
  }

  _buildEquatorProjectedPoints() {
    const points = [];
    for (let ra = 0; ra <= 24.0001; ra += 0.25) {
      points.push(this.projection.project(ra, 0));
    }
    return points;
  }

  _buildMeridianProjectedPoints() {
    const points = [];
    for (let alt = 0; alt <= 90; alt += 2) {
      points.push(this.projection.projectHorizontal(180, alt));
    }
    for (let alt = 88; alt >= 0; alt -= 2) {
      points.push(this.projection.projectHorizontal(0, alt));
    }
    return points;
  }

  _buildHorizonProjectedPoints() {
    const points = [];
    for (let az = 0; az <= 360; az += 2) {
      points.push(this.projection.projectHorizontal(az, 0));
    }
    return points;
  }

  _appendCardinalLabels(labels) {
    if (!Array.isArray(labels)) return;
    const cardinalPoints = [
      { text: 'N', az: 0 },
      { text: 'O', az: 90 },
      { text: 'S', az: 180 },
      { text: 'W', az: 270 },
    ];

    for (const c of cardinalPoints) {
      const p = this.projection.projectHorizontal(c.az, 0);
      if (!p.visible) continue;
      if (this.options.showHorizonFill && p.alt < 0) continue;

      const vx = this.projection.cx - p.x;
      const vy = this.projection.cy - p.y;
      const len = Math.hypot(vx, vy) || 1;
      const inset = 14;

      labels.push({
        x: p.x + (vx / len) * inset - 4,
        y: p.y + (vy / len) * inset - 8,
        text: c.text,
        color: [1.0, 0.26, 0.26],
      });
    }
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

  _buildEclipticProjectedPoints() {
    const points = [];
    for (let lambdaDeg = 0; lambdaDeg <= 360.0001; lambdaDeg += 2) {
      const eq = this._eclipticToEquatorial(lambdaDeg, 0);
      points.push(this.projection.project(eq.ra, eq.dec));
    }
    return points;
  }

  _buildEclipticGridProjected() {
    const lines = [];

    for (let lon = 0; lon < 360; lon += 30) {
      const line = [];
      for (let beta = -90; beta <= 90; beta += 3) {
        const eq = this._eclipticToEquatorial(lon, beta);
        line.push(this.projection.project(eq.ra, eq.dec));
      }
      lines.push({ points: line, color: [0.4, 0.72, 0.58] });
    }

    for (let beta = -60; beta <= 60; beta += 30) {
      const line = [];
      for (let lon = 0; lon <= 360; lon += 3) {
        const eq = this._eclipticToEquatorial(lon, beta);
        line.push(this.projection.project(eq.ra, eq.dec));
      }
      lines.push({ points: line, color: [0.36, 0.68, 0.54] });
    }

    return lines;
  }

  _buildEquatorialGridProjected() {
    const lines = [];

    for (let ra = 0; ra < 24; ra += 1) {
      const line = [];
      for (let dec = -90; dec <= 90; dec += 3) {
        line.push(this.projection.project(ra, dec));
      }
      lines.push({ points: line, color: [0.37, 0.68, 0.84] });
    }

    for (let dec = -60; dec <= 60; dec += 30) {
      const line = [];
      for (let ra = 0; ra <= 24; ra += 0.2) {
        line.push(this.projection.project(ra, dec));
      }
      lines.push({ points: line, color: [0.42, 0.74, 0.86] });
    }

    return lines;
  }

  _buildAzimuthGridProjected() {
    const lines = [];

    for (let alt = 15; alt <= 75; alt += 15) {
      const ring = [];
      for (let az = 0; az <= 360; az += 3) {
        ring.push(this.projection.projectHorizontal(az, alt));
      }
      lines.push({ points: ring, color: [0.42, 0.52, 0.72] });
    }

    for (let az = 0; az < 360; az += 30) {
      const spoke = [];
      for (let alt = 0; alt <= 90; alt += 2) {
        spoke.push(this.projection.projectHorizontal(az, alt));
      }
      lines.push({ points: spoke, color: [0.48, 0.58, 0.76] });
    }

    return lines;
  }

  _drawSelectionLines() {
    if (!this.selectedObject) return;
    const projected = this.projection.projectObject(this.selectedObject);
    if (!projected.visible) return;

    const gl = this.gl;
    const c = this._toNdc(projected.x, projected.y);
    const px = 2 / Math.max(this.canvas.width, 1);
    const py = 2 / Math.max(this.canvas.height, 1);
    const rX = 12 * px;
    const rY = 12 * py;
    const hX = 16 * px;
    const hY = 16 * py;

    const linePos = [
      c.x - rX, c.y, c.x + rX, c.y,
      c.x, c.y - rY, c.x, c.y + rY,
      c.x - hX, c.y, c.x - rX, c.y,
      c.x + rX, c.y, c.x + hX, c.y,
      c.x, c.y - hY, c.x, c.y - rY,
      c.x, c.y + rY, c.x, c.y + hY,
    ];
    const lineColor = [];
    for (let i = 0; i < linePos.length / 2; i += 1) {
      lineColor.push(1.0, 0.82, 0.38);
    }

    gl.useProgram(this.lineProgram);
    gl.bindVertexArray(this.lineVao);

    const posLoc = gl.getAttribLocation(this.lineProgram, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(linePos), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const colorLoc = gl.getAttribLocation(this.lineProgram, 'aColor');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineColor), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINES, 0, linePos.length / 2);
  }

  _bvColor(bv) {
    if (bv < -0.2) return [0.72, 0.85, 1.0];
    if (bv < 0.2) return [0.9, 0.95, 1.0];
    if (bv < 0.8) return [1.0, 0.96, 0.82];
    if (bv < 1.4) return [1.0, 0.84, 0.55];
    return [1.0, 0.68, 0.4];
  }

  _toSkyVector(raHours, decDeg) {
    const raRad = ((Number(raHours) % 24) + 24) % 24 * 15 * Math.PI / 180;
    const decRad = Number(decDeg) * Math.PI / 180;
    const cosDec = Math.cos(decRad);
    return { x: cosDec * Math.cos(raRad), y: cosDec * Math.sin(raRad), z: Math.sin(decRad) };
  }

  _angularSeparationDeg(ra1Hours, dec1Deg, ra2Hours, dec2Deg) {
    const a = this._toSkyVector(ra1Hours, dec1Deg);
    const b = this._toSkyVector(ra2Hours, dec2Deg);
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    return Math.acos(dot) * 180 / Math.PI;
  }

  _ensureConstellationIndex() {
    if (this._constellationIndexReady) return;
    this._constellationNameById = new Map();
    this._constellationCenters = [];
    for (const c of this.catalog.getConstellations() || []) {
      const id = String(c?.id || '').trim();
      const name = String(c?.name || '').trim();
      if (!id) continue;
      this._constellationNameById.set(id, name || id);

      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let count = 0;
      for (const line of c.lines || []) {
        for (const p of line || []) {
          if (!Number.isFinite(p?.ra) || !Number.isFinite(p?.dec)) continue;
          const v = this._toSkyVector(p.ra, p.dec);
          sumX += v.x;
          sumY += v.y;
          sumZ += v.z;
          count += 1;
        }
      }
      if (count <= 0) continue;
      const len = Math.hypot(sumX, sumY, sumZ) || 1;
      const x = sumX / len;
      const y = sumY / len;
      const z = sumZ / len;
      let raRad = Math.atan2(y, x);
      if (raRad < 0) raRad += 2 * Math.PI;
      const decRad = Math.asin(Math.max(-1, Math.min(1, z)));
      this._constellationCenters.push({ id, name: name || id, ra: (raRad * 180 / Math.PI) / 15, dec: decRad * 180 / Math.PI });
    }
    this._constellationIndexReady = true;
  }

  getConstellationInfo(target, decDegOverride = null) {
    let ra = null;
    let dec = null;
    let starId = '';
    if (typeof target === 'object' && target !== null) {
      ra = target.ra;
      dec = target.dec;
      starId = String(target.id || '').trim();
    } else {
      ra = target;
      dec = decDegOverride;
    }
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
    this._ensureConstellationIndex();

    const byStarName = this.catalog.starNames?.[starId]?.constellation;
    if (byStarName && this._constellationNameById.has(byStarName)) {
      return { abbr: byStarName, name: this._constellationNameById.get(byStarName) };
    }

    let best = null;
    let bestSep = Infinity;
    for (const c of this._constellationCenters) {
      const sep = this._angularSeparationDeg(ra, dec, c.ra, c.dec);
      if (sep < bestSep) {
        bestSep = sep;
        best = c;
      }
    }
    if (!best) return null;
    return { abbr: best.id, name: best.name };
  }

  getConstellationNameById(abbr) {
    const key = String(abbr || '').trim();
    if (!key) return '';
    this._ensureConstellationIndex();
    return this._constellationNameById.get(key) || '';
  }

  getStats() {
    const view = this.projection.getViewState();
    return {
      ...this.stats,
      catalogReady: this.ready,
      fovDeg: view.fovDeg,
      centerAzDeg: view.centerAzDeg,
      centerAltDeg: view.centerAltDeg,
      projectionMode: view.modeLabel,
      planarBlend: view.blendToPlanar,
      deltaTSeconds: view.deltaTSeconds,
      utIso: view.utIso,
      ttIso: view.ttIso,
    };
  }

  setSelectedObject(obj) {
    this.selectedObject = obj || null;
    this.requestDraw();
  }

  pickObjectAt(canvasX, canvasY, maxDistance = 10) {
    if (!this.pickables.length) return null;
    let best = null;
    let bestDist = maxDistance;
    for (const item of this.pickables) {
      const dx = item.x - canvasX;
      const dy = item.y - canvasY;
      const dist = Math.hypot(dx, dy);
      const hit = Math.max(item.radius || 6, 6);
      if (dist <= hit && dist <= bestDist) {
        best = item;
        bestDist = dist;
      }
    }
    return best;
  }

  centerOnCoordinates(ra, dec) { this.projection.centerOnRaDec(ra, dec); this.requestDraw(); }

  centerOnObject(obj) {
    if (!obj) return;
    this.setSelectedObject(obj);
    const p = this.projection.projectObject(obj);
    if (Number.isFinite(p.az) && Number.isFinite(p.alt)) {
      this.projection.setViewCenter(p.az, p.alt);
      this.requestDraw();
      return;
    }
    this.centerOnCoordinates(obj.ra, obj.dec);
  }

  resetPan() { this.projection.setViewCenter(0, 90); this.requestDraw(); }

  resetView() {
    this.projection.setViewCenter(0, 90);
    this.projection.setFov(120);
    this.selectedObject = null;
    this.requestDraw();
  }

  panByPixels(dx, dy) { this.projection.panByPixels(dx, dy); this.requestDraw(); }

  zoomByFactor(factor) { this.projection.zoomByFactor(factor); this.requestDraw(); }

  centerOnScreenPoint(screenX, screenY) { this.projection.centerOnScreenPoint(screenX, screenY); this.requestDraw(); }

  _normalizeDsoResult(obj) { return { kind: 'dso', id: obj.id, label: obj.name || obj.id, name: obj.name, type: obj.type, mag: obj.mag, ra: obj.ra, dec: obj.dec }; }

  _formatStarDisplayName(starId, propername) {
    if (propername) return `${propername} (${starId})`;
    return starId;
  }

  _normalizeStarResult(star, names) {
    const starId = String(star.id || star.name || 'star');
    const propername = names[starId]?.propername;
    const displayName = this._formatStarDisplayName(starId, propername);
    return { kind: 'star', id: starId, label: displayName, name: displayName, propername, mag: star.mag, ra: star.ra, dec: star.dec };
  }

  _normalizePlanetResult(planet) {
    return { kind: 'planet', id: planet.id, label: planet.name, name: planet.name, symbol: planet.symbol, mag: planet.mag, distanceAu: planet.distanceAu, distanceKm: planet.distanceKm, ra: planet.ra, dec: planet.dec };
  }

  _normalizeSmallBodyResult(body) {
    return { kind: body.kind, id: body.id, label: body.name || body.id, name: body.name, mag: body.mag, distanceAu: body.distanceAu, ra: body.ra, dec: body.dec };
  }

  searchObjects(query, limit = 8) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const results = [];
    const seen = new Set();
    const pushResult = (item, haystacks) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return;
      let score = 0;
      for (const text of haystacks) {
        const value = String(text || '').toLowerCase();
        if (!value) continue;
        if (value === q) score = Math.max(score, 100);
        else if (value.startsWith(q)) score = Math.max(score, 70);
        else if (value.includes(q)) score = Math.max(score, 40);
      }
      if (score > 0) {
        results.push({ ...item, score });
        seen.add(key);
      }
    };

    for (const obj of this.catalog.getDSO()) pushResult(this._normalizeDsoResult(obj), [obj.id, obj.name, obj.type]);
    for (const planet of this.planets) pushResult(this._normalizePlanetResult(planet), [planet.id, planet.name]);

    const showComets = this.options.showComets === true;
    const showAsteroids = this.options.showAsteroids === true;
    for (const body of this.smallBodies) {
      const kind = String(body?.kind || '').toLowerCase();
      if (kind === 'comet' && !showComets) continue;
      if (kind === 'asteroid' && !showAsteroids) continue;
      pushResult(this._normalizeSmallBodyResult(body), [body.id, body.name]);
    }

    const stars = this.catalog.getStars();
    const names = this.catalog.starNames;
    for (const star of stars) {
      const starId = String(star.id || star.name || '');
      const propername = names[starId]?.propername;
      if (!propername && !starId.toLowerCase().includes(q)) continue;
      pushResult(this._normalizeStarResult(star, names), [starId, propername]);
    }

    results.sort((a, b) => b.score - a.score || (a.mag ?? 99) - (b.mag ?? 99) || a.label.localeCompare(b.label));
    return results.slice(0, limit);
  }

  findObject(query) { return this.searchObjects(query, 1)[0] || null; }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.projection.resize(width, height);
    this.gl.viewport(0, 0, width, height);
    this.requestDraw();
  }
}
