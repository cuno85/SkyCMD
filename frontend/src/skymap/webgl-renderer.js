/**
 * SkyCMD - WebGL Renderer
 */
import { Projection } from './projection.js';
import { CatalogManager } from './catalog.js';
import { ConstellationResolver } from './constellationResolver.js';

const OBJECT_LABEL_FONT_STACK = '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif';

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
      showGalacticEquator: false,
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
      showMilkyWay: true,
      magLimit: 6.5,
      starNameMagLimit: 6.5,
      constellationLabelLanguage: 'de',
      milkyWayMode: 'nasa-texture',
      milkyWayIsoSmoothness: 1.5,
      milkyWayIsoBrightness: 1.0,
      milkyWayIsoContrast: 1.0,
      starHeuristicMode: 'ultra',
      starVisualProfile: 'planetarium',
      bindConstellationLinesToStars: true,
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

    this.constellationResolver = new ConstellationResolver();

    this.ready = false;
    this._rafPending = false;
    this._renderErrorLogged = false;

    // Caches the last successfully placed screen position per constellation abbr.
    // Keeps labels from jumping when the camera pans.
    this._constellationLabelCache = new Map();

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
      in float aIntensity;
      out vec3 vColor;
      out float vIntensity;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
        gl_PointSize = aSize;
        vColor = aColor;
        vIntensity = aIntensity;
      }`,
      `#version 300 es
      precision mediump float;
      in vec3 vColor;
      in float vIntensity;
      out vec4 outColor;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float r = length(uv) * 2.0;
        if (r > 1.0) discard;

        float core = exp(-16.0 * r * r);
        float halo = exp(-3.2 * r * r) * 0.55;
        float alpha = clamp((core + halo) * vIntensity, 0.0, 1.0);

        float colorBlend = clamp(0.22 + core * 0.92, 0.0, 1.0);
        vec3 color = mix(vec3(1.0), vColor, colorBlend);
        outColor = vec4(color, alpha);
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
    this.pointIntensityBuffer = gl.createBuffer();

    this.lineVao = gl.createVertexArray();
    this.linePosBuffer = gl.createBuffer();
    this.lineColorBuffer = gl.createBuffer();

    this.fillVao = gl.createVertexArray();
    this.fillPosBuffer = gl.createBuffer();

    // NASA Deep Star Map texture program (full-screen quad + equatorial UV lookup in FS)
    this.mwTexProgram = this._createProgram(
      `#version 300 es
      in vec2 aPos;
      void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,
      `#version 300 es
      precision highp float;
      uniform sampler2D uMwTex;
      // Combined camera-to-equatorial rotation matrix (column-major):
      // transforms a camera-space unit vector to an equatorial unit vector.
      uniform mat3 uCamToEqu;
      // dot(uCamZenithRow, camDir) gives sin(altitude) for horizon clipping.
      uniform vec3 uCamZenithRow;
      uniform vec2 uCanvasSize;
      uniform vec2 uCenter;
      uniform vec2 uScale;
      uniform float uDistance;
      uniform int uHideHorizon;
      uniform float uBrightness;
      uniform float uContrast;
      uniform int uIsoMode;
      uniform float uIsoLevels;
      uniform float uIsoBlurPx;
      out vec4 outColor;
      const float PI = 3.14159265358979323846;

      float luma(vec3 c) {
        return dot(c, vec3(0.2126, 0.7152, 0.0722));
      }

      float blurredLuma(vec2 uv) {
        vec2 texel = 1.0 / vec2(textureSize(uMwTex, 0));
        float lod = clamp(log2(max(uIsoBlurPx * 2.0, 1.0)), 0.0, 7.0);
        vec2 r = texel * (1.2 + uIsoBlurPx * 0.45);

        // 9-tap weighted blur (4/2/1 kernel) to suppress star-like speckle noise.
        float w = 0.0;
        float s = 0.0;

        float c = luma(textureLod(uMwTex, uv, lod).rgb);
        s += c * 4.0; w += 4.0;

        float ax = luma(textureLod(uMwTex, uv + vec2( r.x, 0.0), lod).rgb);
        float bx = luma(textureLod(uMwTex, uv + vec2(-r.x, 0.0), lod).rgb);
        float ay = luma(textureLod(uMwTex, uv + vec2(0.0,  r.y), lod).rgb);
        float by = luma(textureLod(uMwTex, uv + vec2(0.0, -r.y), lod).rgb);
        s += (ax + bx + ay + by) * 2.0; w += 8.0;

        float d1 = luma(textureLod(uMwTex, uv + vec2( r.x,  r.y), lod).rgb);
        float d2 = luma(textureLod(uMwTex, uv + vec2(-r.x,  r.y), lod).rgb);
        float d3 = luma(textureLod(uMwTex, uv + vec2( r.x, -r.y), lod).rgb);
        float d4 = luma(textureLod(uMwTex, uv + vec2(-r.x, -r.y), lod).rgb);
        s += (d1 + d2 + d3 + d4); w += 4.0;

        float lum = clamp(s / max(w, 1e-6), 0.0, 1.0);
        // Keep slider behavior: brightness/contrast still shape the final bands.
        lum = pow(clamp(lum * uBrightness, 0.0, 1.0), max(0.35, uContrast * 0.85));
        // Remove tiny low-luminance islands and keep only meaningful MW structure.
        lum = smoothstep(0.08, 0.96, lum);
        return lum;
      }

      void main() {
        float sx = gl_FragCoord.x - uCenter.x;
        float sy = (uCanvasSize.y - gl_FragCoord.y) - uCenter.y;
        float scaleX = max(uScale.x, 1e-6);
        float scaleY = max(uScale.y, 1e-6);
        float X = -sx / scaleX;
        float Y = -sy / scaleY;
        float factor = max(uDistance + 1.0, 1e-6);
        float u = X / factor;
        float v = Y / factor;
        float q = u * u + v * v;
        float disc = max(0.0, 1.0 + q * (1.0 - uDistance * uDistance));
        float zc = (-q * uDistance + sqrt(disc)) / (q + 1.0);
        float k = uDistance + zc;
        vec3 camDir = normalize(vec3(u * k, v * k, zc));
        if (uHideHorizon != 0 && dot(uCamZenithRow, camDir) < 0.0) { discard; }
        vec3 eqDir = normalize(uCamToEqu * camDir);
        float ra_rad = atan(eqDir.y, eqDir.x);
        float dec_rad = asin(clamp(eqDir.z, -1.0, 1.0));
        // Plate carree: RA=0h at u=0.5, RA increases to the left (canonical NASA SVS 4851)
        float texU = fract(0.5 - ra_rad / (2.0 * PI));
        // Source image uses top-left image origin; invert V so north stays north on sky.
        float texV = 1.0 - ((dec_rad + PI * 0.5) / PI);
        vec3 rgb = texture(uMwTex, vec2(texU, texV)).rgb;
        // Optional gamma/contrast and brightness
        rgb = pow(max(rgb, vec3(0.0)), vec3(uContrast));
        rgb *= uBrightness;

        if (uIsoMode != 0) {
          float lum = blurredLuma(vec2(texU, texV));
          float levels = max(3.0, uIsoLevels);

          float idx = floor(lum * levels);
          float band = idx / max(levels - 1.0, 1.0);

          // Atlas-like cool palette with gentle inner brightening.
          vec3 low = vec3(0.05, 0.09, 0.17);
          vec3 mid = vec3(0.21, 0.30, 0.44);
          vec3 high = vec3(0.70, 0.77, 0.88);
          vec3 bandColor = mix(low, mid, smoothstep(0.0, 0.65, band));
          bandColor = mix(bandColor, high, smoothstep(0.52, 1.0, band));
          bandColor *= (0.50 + 0.75 * lum);

          float fracL = fract(lum * levels);
          float distToBorder = min(fracL, 1.0 - fracL);
          float contour = 1.0 - smoothstep(0.0, 0.15, distToBorder);

          // Keep contours subtle (atlas style, not neon outlines).
          rgb = mix(bandColor, vec3(0.84, 0.89, 0.96), contour * 0.22);
        }
        outColor = vec4(rgb, 1.0);
      }`,
    );
    this.mwTexVao = gl.createVertexArray();
    this.mwTexPosBuffer = gl.createBuffer();
    this.mwNasaTex = null;      // loaded lazily
    this.mwNasaTexLoading = false;

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
    // Extend atlas with domain symbols (DSO classes, German labels, misc astronomy).
    const extraChars = ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', 'ß', '°', 'Δ', '●', '◌', '⊗', '⬭', '□', '■', '◇', '◉', '✶', '⊕', '⋈', '✦'];
    for (const ch of extraChars) {
      if (!chars.includes(ch)) chars.push(ch);
    }

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
    ctx.font = `500 15px ${OBJECT_LABEL_FONT_STACK}`;

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
    this._rebuildConstellationResolver();

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
    this._rebuildConstellationResolver();
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
      const pointIntensity = [];
      const labels = [];

      const pushPoint = (obj, size, color, kind, label, intensity = 0.9) => {
        const p = this.projection.project(obj.ra, obj.dec);
        if (!p.visible) return;
        if (this.options.showHorizonFill && p.alt < 0) return;

        const transmission = this.projection.extinctionTransmission(p.alt);
        const attenuatedIntensity = intensity * (0.32 + transmission * 0.68);

        const ndc = this._toNdc(p.x, p.y);
        pointPos.push(ndc.x, ndc.y);
        pointSize.push(size);
        pointColor.push(color[0], color[1], color[2]);
        pointIntensity.push(attenuatedIntensity);
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
          labels.push({ x: p.x + 8, y: p.y - 10, text: String(label).slice(0, 24), color: [1.0, 0.88, 0.58], kind: 'planet' });
        }
        if (kind === 'dso' && this.options.showDSOLabels && label) {
          const dsoStyle = this._dsoStyle(obj.type);
          const dsoLabel = String(label).slice(0, 24);
          labels.push({ x: p.x + 7, y: p.y - 8, text: dsoLabel, color: dsoStyle.labelColor, kind: 'dso' });
        }
        if (kind === 'star' && this.options.showStarNames && label) {
          labels.push({ x: p.x + 6, y: p.y - 6, text: String(label).slice(0, 26), color: [0.9, 0.93, 1.0], kind: 'star' });
        }
      };

      const pushDsoMarker = (obj, style, label) => {
        const p = this.projection.project(obj.ra, obj.dec);
        if (!p.visible) return false;
        if (this.options.showHorizonFill && p.alt < 0) return false;

        const transmission = this.projection.extinctionTransmission(p.alt);
        const markerColor = style.color.map((c) => c * (0.25 + transmission * 0.75));

        // Draw as explicit glyph marker to keep DSO symbols clearly visible at all zoom levels.
        const symbol = (this.glyphMap && this.glyphMap[style.symbol]) ? style.symbol : '*';
        labels.push({
          x: p.x - 6,
          y: p.y - 10,
          text: symbol,
          color: markerColor,
          scale: 1.35,
          kind: 'dso-marker',
        });

        this.pickables.push({
          kind: 'dso',
          id: obj.id,
          label,
          ra: obj.ra,
          dec: obj.dec,
          mag: obj.mag,
          x: p.x,
          y: p.y,
          radius: 11,
          name: obj.name,
          type: obj.type,
        });

        if (this.options.showDSOLabels && label) {
          labels.push({ x: p.x + 8, y: p.y - 8, text: String(label).slice(0, 24), color: style.labelColor, kind: 'dso' });
        }
        return true;
      };

      if (this.options.showStars) {
        const stars = this.catalog.getStars();
        const rawProfile = String(this.options?.starVisualProfile || 'planetarium');
        const profile = rawProfile === 'enhanced' ? 'planetarium' : rawProfile;
        const heuristic = this._computeStarHeuristic(view.fovDeg, this.canvas.width, this.canvas.height, stars.length);
        const magLimit = Number.isFinite(this.options?.magLimit)
          ? Number(this.options.magLimit)
          : 6.5;
        const effectiveMagLimit = this._effectiveMagLimit(magLimit, profile);
        const gridCols = Math.max(1, Math.ceil(this.canvas.width / heuristic.cellPx));
        const gridRows = Math.max(1, Math.ceil(this.canvas.height / heuristic.cellPx));
        const occupancy = new Uint8Array(gridCols * gridRows);

        let visibleStars = 0;
        let brightRendered = 0;
        let faintRendered = 0;
        const faintStride = 1;

        const tryRenderStar = (star, allowDense = false, ignoreDensity = false) => {
          if (!Number.isFinite(star?.mag)) return false;
          if (star.mag > effectiveMagLimit) return false;
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
          const baseColor = this._bvColor(bv);
          const visual = this._starVisual(star.mag, p.alt, profile);
          const transmission = this.projection.extinctionTransmission(p.alt);
          const color = this._mixColor([1.0, 1.0, 1.0], baseColor, visual.colorSaturation);
          const size = visual.size;
          const starId = String(star.id || star.name || 'star');
          const nameData = this.catalog.getStarNameForStar(star) || {};
          const displayName = this._formatStarDisplayName(starId, nameData);
          const commonName = this._commonStarName(nameData);

          pointPos.push(ndc.x, ndc.y);
          pointSize.push(size);
          pointColor.push(color[0], color[1], color[2]);
          pointIntensity.push(visual.intensity * (0.3 + transmission * 0.7));
          this.pickables.push({
            kind: 'star',
            id: starId,
            label: displayName,
            propername: nameData?.propername,
            propernameDe: nameData?.propername_de,
            aliases: Array.isArray(nameData?.aliases) ? [...nameData.aliases] : [],
            bayer: nameData?.bayer,
            flamsteed: nameData?.flamsteed,
            ra: star.ra,
            dec: star.dec,
            mag: star.mag,
            x: p.x,
            y: p.y,
            radius: Math.max(6, size + 2),
            name: displayName,
          });

          const starNameMagLimit = Number.isFinite(this.options?.starNameMagLimit)
            ? Number(this.options.starNameMagLimit)
            : 6.5;
          if (this.options.showStarNames && displayName && Number.isFinite(star?.mag) && star.mag <= starNameMagLimit) {
            labels.push({ x: p.x + 6, y: p.y - 6, text: String(displayName).slice(0, 26), color: [0.9, 0.93, 1.0], kind: 'star' });
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
        this.stats.starVisualProfile = profile;
        this.stats.starEffectiveMagLimit = effectiveMagLimit;
      } else {
        this.stats.visibleStars = 0;
      }

      if (this.options.showDSO) {
        let visibleDso = 0;
        for (const obj of this.catalog.getDSO()) {
          const dsoStyle = this._dsoStyle(obj.type);
          const dsoLabel = this._formatDsoDisplayLabel(obj);
          if (pushDsoMarker(obj, dsoStyle, dsoLabel)) {
            visibleDso += 1;
          }
        }
        this.stats.visibleDSO = visibleDso;
      } else {
        this.stats.visibleDSO = 0;
      }

      if (this.options.showPlanets) {
        let visiblePlanets = 0;
        for (const planet of this.planets) {
          pushPoint(planet, 6.0, [1.0, 0.85, 0.35], 'planet', planet.name || planet.id, 0.95);
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
        pushPoint(body, 3.0, color, kind || 'smallbody', body.name || body.id, 0.76);
      }

      if (this.options.showConstellationLabels) {
        this._appendConstellationLabels(labels);
      }

      if (this.options.showCardinalDirections) {
        this._appendCardinalLabels(labels);
      }

      // Draw the NASA Deep Star Map texture first (under all vector overlays and stars).
      this._drawMwNasaTexture();
      this._drawLines();
      this._drawPoints(pointPos, pointSize, pointColor, pointIntensity);
      this._drawSelectionLines();
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
      const scale = Math.max(0.75, Math.min(2.2, Number(entry.scale) || 1));
      const text = String(entry.text).slice(0, maxChars);
      const col = Array.isArray(entry.color) ? entry.color : [0.9, 0.95, 1.0];
      for (const ch of text) {
        const glyph = this.glyphMap[ch];
        if (!glyph) continue;
        addGlyphQuad(penX, penY, (glyph.w - 5) * scale, (this.textCellH - 8) * scale, glyph, col);
        penX += (glyph.w - 7) * scale;
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

  _drawPoints(pointPos, pointSize, pointColor, pointIntensity) {
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

    const intensityLoc = gl.getAttribLocation(this.pointProgram, 'aIntensity');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointIntensityBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointIntensity), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(intensityLoc);
    gl.vertexAttribPointer(intensityLoc, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, pointSize.length);
  }

  // ── NASA Deep Star Map texture ────────────────────────────────────────────

  async _loadNasaMwTex(url) {
    if (this.mwNasaTexLoading || this.mwNasaTex) return;
    this.mwNasaTexLoading = true;
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = (err) => reject(err);
        el.src = url;
      });
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      // Wrap RA (s) cyclically; clamp Dec (t) at poles.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.mwNasaTex = tex;
      this.requestDraw();
    } catch (e) {
      console.warn('NASA MW texture failed to load:', e);
    }
    this.mwNasaTexLoading = false;
  }

  _drawMwNasaTexture() {
    if (!this.options.showMilkyWay) return;
    const mode = String(this.options?.milkyWayMode || 'nasa-texture');
    const drawNasaTexture = mode === 'nasa-texture' || mode === 'isophotes';
    if (!drawNasaTexture) return;
    if (!this.mwNasaTex) {
      // Kick off async load; next frame will draw once ready.
      this._loadNasaMwTex('data/milkyway_4k.jpg');
      return;
    }
    const gl = this.gl;
    const view = this.projection.getViewState();
    const blend = Math.max(0, Math.min(1, Number(view?.blendToPlanar ?? 0)));
    const distance = 1 - blend;
    const scaleX = this.projection.stereoScale * (1 - blend) + this.projection.gnomonicScaleX * blend;
    const scaleY = this.projection.stereoScale * (1 - blend) + this.projection.gnomonicScaleY * blend;

    // Camera basis vectors (in horizontal/Alt-Az frame: x=East, y=North, z=Zenith).
    const ri = this.projection.right;
    const up = this.projection.up;
    const fw = this.projection.forward;

    // Horizontal → equatorial rotation matrix.
    // Derivation: express each horizontal basis vector in equatorial coordinates.
    //   East  → equatorial: (sin(LST), -cos(LST), 0)
    //   North → equatorial: (-sin(φ)·cos(LST), -sin(φ)·sin(LST), cos(φ))
    //   Zenith→ equatorial: (cos(φ)·cos(LST),  cos(φ)·sin(LST),  sin(φ))
    // where LST_rad = lst * π/12;  φ = this.projection.lat (radians).
    const lstRad = (this.projection.lst ?? 0) * Math.PI / 12;
    const lat = this.projection.lat ?? 0;
    const sinL = Math.sin(lstRad), cosL = Math.cos(lstRad);
    const sinP = Math.sin(lat),  cosP = Math.cos(lat);

    // Apply M_h2e to a horizontal vector v = {x:East, y:North, z:Zenith}.
    // This is the transpose (inverse) of the standard equatorial->horizontal ENU matrix.
    const h2e = (v) => ({
      x: -sinL * v.x - sinP * cosL * v.y + cosP * cosL * v.z,
      y:  cosL * v.x - sinP * sinL * v.y + cosP * sinL * v.z,
      z:               cosP        * v.y +        sinP  * v.z,
    });

    const c0 = h2e(ri);
    const c1 = h2e(up);
    const c2 = h2e(fw);
    // Column-major mat3 for WebGL uniformMatrix3fv (transpose=false).
    const camToEqu = [c0.x, c0.y, c0.z, c1.x, c1.y, c1.z, c2.x, c2.y, c2.z];

    const brightness = Math.max(0.1, Math.min(4.0, Number(this.options?.milkyWayIsoBrightness ?? 1.0)));
    const contrast = Math.max(0.3, Math.min(3.0, Number(this.options?.milkyWayIsoContrast ?? 1.0)));
    const smoothness = Math.max(0, Math.min(4, Number(this.options?.milkyWayIsoSmoothness ?? 1.5)));
    const isophoteMode = mode === 'isophotes';
    const isophoteLevels = Math.max(3, Math.round(4 + (smoothness / 4) * 7));
    const isophoteBlurPx = Math.max(2.0, 4.6 - smoothness * 0.75);

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    gl.useProgram(this.mwTexProgram);
    gl.bindVertexArray(this.mwTexVao);

    const posLoc = gl.getAttribLocation(this.mwTexProgram, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mwTexPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const loc = (name) => gl.getUniformLocation(this.mwTexProgram, name);
    gl.uniform2f(loc('uCanvasSize'), this.canvas.width, this.canvas.height);
    gl.uniform2f(loc('uCenter'), this.projection.cx, this.projection.cy);
    gl.uniform2f(loc('uScale'), scaleX, scaleY);
    gl.uniform1f(loc('uDistance'), distance);
    gl.uniformMatrix3fv(loc('uCamToEqu'), false, camToEqu);
    gl.uniform3f(loc('uCamZenithRow'), ri.z, up.z, fw.z);
    gl.uniform1i(loc('uHideHorizon'), this.options.showHorizonFill ? 1 : 0);
    gl.uniform1f(loc('uBrightness'), brightness);
    gl.uniform1f(loc('uContrast'), contrast);
    gl.uniform1i(loc('uIsoMode'), isophoteMode ? 1 : 0);
    gl.uniform1f(loc('uIsoLevels'), isophoteLevels);
    gl.uniform1f(loc('uIsoBlurPx'), isophoteBlurPx);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mwNasaTex);
    gl.uniform1i(loc('uMwTex'), 0);

    // Additive blending: dark sky pixels (0,0,0) add nothing; bright MW adds color.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _drawLines() {
    const gl = this.gl;
    const linePos = [];
    const lineColor = [];
    const maxProjectedJumpX = this.canvas.width * 1.8;
    const maxProjectedJumpY = this.canvas.height * 1.8;
    const starSnapper = this.options.showConstellationLines && this.options.bindConstellationLinesToStars
      ? this._createConstellationStarSnapper()
      : null;

    const hasAcceptableProjectedJump = (a, b) => {
      if (!a || !b) return false;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
        return false;
      }
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      return dx <= maxProjectedJumpX && dy <= maxProjectedJumpY;
    };

    const pushProjectedSegment = (p1, p2, color, hideBelowHorizon = false) => {
      let a = p1;
      let b = p2;

      if (!Number.isFinite(a?.x) || !Number.isFinite(a?.y) || !Number.isFinite(a?.alt)
        || !Number.isFinite(b?.x) || !Number.isFinite(b?.y) || !Number.isFinite(b?.alt)) {
        return;
      }

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
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        if (!hasAcceptableProjectedJump(a, b)) continue;
        pushProjectedSegment(a, b, color, hideBelowHorizon);
      }
    };

    const pushSegment = (a, b, color, hideBelowHorizon = false) => {
      let p1 = this.projection.project(a.ra, a.dec);
      let p2 = this.projection.project(b.ra, b.dec);
      if (starSnapper && color[2] > 0.65 && color[0] < 0.4) {
        p1 = starSnapper(p1);
        p2 = starSnapper(p2);
      }
      if (!hasAcceptableProjectedJump(p1, p2)) return;
      pushProjectedSegment(p1, p2, color, hideBelowHorizon);
    };

    // Reference lines
    if (this.options.showCelestialEquator) {
      pushProjectedPolyline(this._buildEquatorProjectedPoints(), [0.47, 0.86, 0.98], this.options.showHorizonFill);
    }

    if (this.options.showGalacticEquator) {
      pushProjectedPolyline(this._buildGalacticEquatorProjectedPoints(), [0.82, 0.62, 1.0], this.options.showHorizonFill);
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
      for (const boundary of this.catalog.getConstellationBoundaries() || []) {
        const lines = Array.isArray(boundary)
          ? [boundary]
          : Array.isArray(boundary?.rings)
            ? boundary.rings
            : [];

        for (const line of lines) {
          if (!Array.isArray(line) || line.length < 2) continue;
          for (let i = 1; i < line.length; i++) {
            const prev = line[i - 1];
            const curr = line[i];
            // Catalog boundary loader already converts lon->RA in hours.
            pushSegment(
              { ra: prev.ra, dec: prev.dec },
              { ra: curr.ra, dec: curr.dec },
              [0.45, 0.55, 0.75],
              hideBoundariesBelowHorizon,
            );
          }
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

  _createConstellationStarSnapper() {
    const stars = (this.pickables || []).filter((p) => (
      p && p.kind === 'star' && Number.isFinite(p.x) && Number.isFinite(p.y)
    ));
    if (!stars.length) return null;

    const cellSize = 24;
    const maxSnapPx = 14;
    const maxSnapSq = maxSnapPx * maxSnapPx;
    const grid = new Map();

    const keyOf = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    for (const s of stars) {
      const key = keyOf(s.x, s.y);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(s);
    }

    return (projected) => {
      if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !projected.visible) {
        return projected;
      }

      const cx = Math.floor(projected.x / cellSize);
      const cy = Math.floor(projected.y / cellSize);
      let best = null;
      let bestSq = maxSnapSq;

      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const bucket = grid.get(`${cx + ox},${cy + oy}`);
          if (!bucket) continue;
          for (const s of bucket) {
            const dx = s.x - projected.x;
            const dy = s.y - projected.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestSq) {
              bestSq = d2;
              best = s;
            }
          }
        }
      }

      if (!best) return projected;
      return {
        ...projected,
        x: best.x,
        y: best.y,
      };
    };
  }

  _buildEquatorProjectedPoints() {
    const points = [];
    for (let ra = 0; ra <= 24.0001; ra += 0.25) {
      points.push(this.projection.project(ra, 0));
    }
    return points;
  }

  _galacticToEquatorial(lDeg, bDeg) {
    const l = (lDeg * Math.PI) / 180;
    const b = (bDeg * Math.PI) / 180;

    const cosB = Math.cos(b);
    const xg = cosB * Math.cos(l);
    const yg = cosB * Math.sin(l);
    const zg = Math.sin(b);

    // IAU 1958/1984 (J2000) rotation matrix transpose: galactic -> equatorial.
    const xe = -0.0548755604 * xg + 0.4941094279 * yg - 0.8676661490 * zg;
    const ye = -0.8734370902 * xg - 0.4448296300 * yg - 0.1980763734 * zg;
    const ze = -0.4838350155 * xg + 0.7469822445 * yg + 0.4559837762 * zg;

    let raHours = (Math.atan2(ye, xe) * 12) / Math.PI;
    if (raHours < 0) raHours += 24;
    const decDeg = (Math.asin(Math.max(-1, Math.min(1, ze))) * 180) / Math.PI;

    return { ra: raHours, dec: decDeg };
  }

  _buildGalacticEquatorProjectedPoints() {
    const points = [];
    for (let lDeg = 0; lDeg <= 360.0001; lDeg += 2) {
      const eq = this._galacticToEquatorial(lDeg, 0);
      points.push(this.projection.project(eq.ra, eq.dec));
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
        kind: 'cardinal',
      });
    }
  }

  _appendConstellationLabels(labels) {
    if (!Array.isArray(labels)) return;

    const constellations = this.catalog.getConstellations() || [];
    const maxLabels = 96;
    let addedCount = 0;
    const language = String(this.options?.constellationLabelLanguage || 'de').toLowerCase() === 'latin'
      ? 'latin'
      : 'de';
    const occupied = [];
    const starBoxes = [];

    const estimateLabelBox = (entry) => {
      if (!entry || !entry.text) return null;
      const scale = Math.max(0.75, Math.min(2.2, Number(entry.scale) || 1));
      const text = String(entry.text);
      const charW = 10 * scale;
      const w = Math.max(10, text.length * charW);
      const h = Math.max(10, (this.textCellH || 24) * scale * 0.75);
      return {
        x0: Number(entry.x) - 2,
        y0: Number(entry.y) - 2,
        x1: Number(entry.x) + w + 2,
        y1: Number(entry.y) + h + 2,
      };
    };

    const intersects = (a, b, pad = 0) => {
      if (!a || !b) return false;
      return !(a.x1 + pad < b.x0 || a.x0 - pad > b.x1 || a.y1 + pad < b.y0 || a.y0 - pad > b.y1);
    };

    for (let i = 0; i < labels.length; i += 1) {
      const existing = labels[i];
      const box = estimateLabelBox(existing);
      if (!box) continue;
      if (String(existing?.kind || '') === 'star') {
        starBoxes.push({ idx: i, box });
      } else if (String(existing?.kind || '') !== 'dso-marker') {
        occupied.push(box);
      }
    }

    for (let ci = 0; ci < constellations.length && addedCount < maxLabels; ci += 1) {
      const c = constellations[ci];
      const abbr = String(c?.id || '').trim().toUpperCase();
      const preferred = String(this.catalog.getConstellationNameById(abbr, language) || '').trim();
      const text = (preferred && preferred.length <= 20) ? preferred : (abbr || preferred);
      if (!text) continue;

      const projectedPoints = [];
      const projectedSegments = [];

      for (const line of c?.lines || []) {
        if (!Array.isArray(line)) continue;
        let prev = null;
        for (const p of line) {
          const ra = Number(p?.ra);
          const dec = Number(p?.dec);
          if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;

          const pr = this.projection.project(ra, dec);
          if (!pr.visible) {
            prev = null;
            continue;
          }
          if (this.options.showHorizonFill && pr.alt < 0) {
            prev = null;
            continue;
          }

          const prTagged = Object.assign({}, pr, { srcRa: ra, srcDec: dec });
          projectedPoints.push(prTagged);
          if (prev) {
            projectedSegments.push({ a: prev, b: prTagged });
          }
          prev = prTagged;
        }
      }

      if (projectedPoints.length < 2) continue;

      // Screen-space centroid as the global target for candidate ranking.
      let mx = 0;
      let my = 0;
      for (const p of projectedPoints) {
        mx += p.x;
        my += p.y;
      }
      mx /= projectedPoints.length;
      my /= projectedPoints.length;

      // ── Sky-anchored position cache ────────────────────────────────────────
      // Stores RA/Dec of the chosen anchor + pixel offset so that the label
      // re-projects correctly every frame as the camera rotates/pans.
      const cached = this._constellationLabelCache.get(abbr);
      if (cached && cached.srcRa !== null && cached.srcDec !== null) {
        const cacheProj = this.projection.project(cached.srcRa, cached.srcDec);
        if (cacheProj.visible && !(this.options.showHorizonFill && cacheProj.alt < 0)) {
          const cx = cacheProj.x + cached.dx;
          const cy = cacheProj.y + cached.dy;
          const cacheMargin = 20;
          const onScreen = cx > cacheMargin && cy > cacheMargin
            && cx < this.canvas.width - cacheMargin
            && cy < this.canvas.height - cacheMargin;
          if (onScreen) {
            const cachedEntry = {
              x: cx, y: cy, text: text.slice(0, 24),
              color: [0.72, 0.8, 0.95], scale: 1.28, kind: 'constellation',
            };
            const cachedBox = estimateLabelBox(cachedEntry);
            let cachedOverlaps = false;
            for (const existing of occupied) {
              if (intersects(cachedBox, existing, 3)) { cachedOverlaps = true; break; }
            }
            if (!cachedOverlaps) {
              const removeStar = [];
              for (const s of starBoxes) {
                if (intersects(cachedBox, s.box, 1)) removeStar.push(s.idx);
              }
              if (removeStar.length > 0) {
                removeStar.sort((a, b) => b - a);
                for (const idx of removeStar) {
                  if (idx >= 0 && idx < labels.length && String(labels[idx]?.kind || '') === 'star') {
                    labels.splice(idx, 1);
                  }
                }
                starBoxes.length = 0;
                for (let si = 0; si < labels.length; si += 1) {
                  const l = labels[si];
                  if (String(l?.kind || '') !== 'star') continue;
                  const sb = estimateLabelBox(l);
                  if (sb) starBoxes.push({ idx: si, box: sb });
                }
              }
              labels.push(cachedEntry);
              occupied.push(cachedBox);
              addedCount += 1;
              continue; // tracked the sky correctly – skip full heuristic
            }
          }
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      const anchors = [];
      const pushAnchor = (x, y, len = 0, srcRa = null, srcDec = null) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const margin = Math.min(x, y, this.canvas.width - x, this.canvas.height - y);
        if (margin < 12) return;
        anchors.push({ x, y, len, srcRa, srcDec });
      };

      pushAnchor(mx, my, 0); // centroid has no single sky coord

      // Fallback anchor near centroid from actual points.
      let nearest = projectedPoints[0];
      let nearestD2 = Number.POSITIVE_INFINITY;
      for (const p of projectedPoints) {
        const dx = p.x - mx;
        const dy = p.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) {
          nearest = p;
          nearestD2 = d2;
        }
      }
      pushAnchor(nearest.x, nearest.y, 0, nearest.srcRa, nearest.srcDec);

      // Prefer middle points of longer visible segments.
      for (const seg of projectedSegments) {
        const dx = seg.b.x - seg.a.x;
        const dy = seg.b.y - seg.a.y;
        const len = Math.hypot(dx, dy);
        if (len < 6) continue;
        // Average RA with wrap-around guard (24h boundary).
        const raDiff = Math.abs(seg.a.srcRa - seg.b.srcRa);
        const midRa = raDiff > 12
          ? ((seg.a.srcRa + seg.b.srcRa + 24) * 0.5) % 24
          : (seg.a.srcRa + seg.b.srcRa) * 0.5;
        const midDec = (seg.a.srcDec + seg.b.srcDec) * 0.5;
        pushAnchor((seg.a.x + seg.b.x) * 0.5, (seg.a.y + seg.b.y) * 0.5, len, midRa, midDec);
      }

      if (anchors.length === 0) continue;

      // Deduplicate nearby anchors and rank by center proximity, edge safety and segment support.
      const deduped = [];
      const minSep = 10;
      for (const a of anchors) {
        let exists = false;
        for (const b of deduped) {
          const ddx = a.x - b.x;
          const ddy = a.y - b.y;
          if ((ddx * ddx + ddy * ddy) < (minSep * minSep)) {
            exists = true;
            if (a.len > b.len) {
              b.x = a.x;
              b.y = a.y;
              b.len = a.len;
              b.srcRa = a.srcRa;
              b.srcDec = a.srcDec;
            }
            break;
          }
        }
        if (!exists) deduped.push({ ...a });
      }

      deduped.sort((a, b) => {
        const da = Math.hypot(a.x - mx, a.y - my);
        const db = Math.hypot(b.x - mx, b.y - my);
        const ma = Math.min(a.x, a.y, this.canvas.width - a.x, this.canvas.height - a.y);
        const mb = Math.min(b.x, b.y, this.canvas.width - b.x, this.canvas.height - b.y);
        const sa = (-da * 1.0) + (ma * 0.7) + Math.min(80, a.len) * 0.6;
        const sb = (-db * 1.0) + (mb * 0.7) + Math.min(80, b.len) * 0.6;
        return sb - sa;
      });

      const offsets = [
        { dx: 6, dy: -6 },
        { dx: 12, dy: -10 },
        { dx: -10, dy: -10 },
        { dx: 8, dy: 8 },
        { dx: -12, dy: 8 },
        { dx: 0, dy: -12 },
      ];

      let placed = false;
      for (const anchor of deduped.slice(0, 16)) {
        for (const o of offsets) {
          const candidate = {
            x: anchor.x + o.dx,
            y: anchor.y + o.dy,
            text: text.slice(0, 24),
            color: [0.72, 0.8, 0.95],
            scale: 1.28,
            kind: 'constellation',
          };
          const candidateBox = estimateLabelBox(candidate);
          if (!candidateBox) continue;

          let overlaps = false;
          for (const existing of occupied) {
            if (intersects(candidateBox, existing, 3)) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) continue;

          // Prefer constellation labels over star labels: remove colliding star names locally.
          const removeStarIdx = [];
          for (const s of starBoxes) {
            if (intersects(candidateBox, s.box, 1)) {
              removeStarIdx.push(s.idx);
            }
          }
          if (removeStarIdx.length > 0) {
            removeStarIdx.sort((a, b) => b - a);
            for (const idx of removeStarIdx) {
              if (idx >= 0 && idx < labels.length && String(labels[idx]?.kind || '') === 'star') {
                labels.splice(idx, 1);
              }
            }

            // Rebuild star box index after deletions to keep indices valid.
            starBoxes.length = 0;
            for (let si = 0; si < labels.length; si += 1) {
              const l = labels[si];
              if (String(l?.kind || '') !== 'star') continue;
              const sb = estimateLabelBox(l);
              if (sb) starBoxes.push({ idx: si, box: sb });
            }
          }

          // Cache sky coords + offset so the label tracks rotation correctly.
          if (anchor.srcRa !== null && anchor.srcDec !== null) {
            this._constellationLabelCache.set(abbr, { srcRa: anchor.srcRa, srcDec: anchor.srcDec, dx: o.dx, dy: o.dy });
          }
          labels.push(candidate);
          occupied.push(candidateBox);
          addedCount += 1;
          placed = true;
          break;
        }
        if (placed) break;
      }

      if (!placed) continue;
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

  _starVisual(mag, altDeg = 45, profile = 'planetarium') {
    const m = Number.isFinite(mag) ? Number(mag) : 6.5;
    const alt = Number.isFinite(altDeg) ? Number(altDeg) : 45;
    const modeRaw = String(profile || 'planetarium');
    const mode = modeRaw === 'enhanced' ? 'planetarium' : modeRaw;
    const normalized = ['planetarium', 'realistic', 'conservative'].includes(mode)
      ? mode
      : 'planetarium';

    const sinAlt = Math.max(0.06, Math.sin((Math.max(-5, alt) * Math.PI) / 180));
    const airMass = Math.min(10, 1 / sinAlt);
    const extinctionCoeff = normalized === 'planetarium' ? 0.14 : normalized === 'conservative' ? 0.34 : 0.22;
    const extinctionMag = extinctionCoeff * Math.max(0, airMass - 1);
    const apparentMag = m + extinctionMag;

    const rel = Math.max(0, Math.min(1, (6.5 - apparentMag) / 8));
    const sizeScale = normalized === 'planetarium' ? 1.65 : normalized === 'conservative' ? 0.58 : 1.0;
    const intensityScale = normalized === 'planetarium' ? 1.55 : normalized === 'conservative' ? 0.56 : 1.0;
    const satBase = normalized === 'conservative' ? 0.04 : normalized === 'planetarium' ? 0.14 : 0.1;
    const size = (1.3 + Math.pow(rel, 0.62) * 8.1) * sizeScale;
    const intensity = Math.max(0.2, Math.min(1.25, (0.22 + Math.pow(rel, 0.85) * 1.05) * intensityScale));
    const colorSaturation = Math.max(0.06, Math.min(1.0, satBase + Math.pow(rel, 1.15) * 0.9));
    return { size, intensity, colorSaturation };
  }

  _effectiveMagLimit(magLimit, profile = 'planetarium') {
    const modeRaw = String(profile || 'planetarium');
    const mode = modeRaw === 'enhanced' ? 'planetarium' : modeRaw;
    const normalized = ['planetarium', 'realistic', 'conservative'].includes(mode)
      ? mode
      : 'planetarium';
    if (mode === 'conservative') return Math.max(2.5, Math.min(25, magLimit - 1.5));
    if (normalized === 'planetarium') return Math.max(2.5, Math.min(25, magLimit + 0.8));
    return Math.max(2.5, Math.min(25, magLimit));
  }

  _dsoStyle(typeRaw) {
    const type = String(typeRaw || '').trim().toLowerCase();
    const map = {
      // Requested palette: marker colors and legend colors are intentionally identical.
      open_cluster: { symbol: '◌', color: [1.0, 0.9, 0.15], labelColor: [1.0, 0.92, 0.28], size: 8.0, intensity: 1.05 },
      globular_cluster: { symbol: '⊗', color: [1.0, 0.9, 0.15], labelColor: [1.0, 0.92, 0.28], size: 8.8, intensity: 1.1 },
      galaxy: { symbol: '⬭', color: [1.0, 0.28, 0.28], labelColor: [1.0, 0.42, 0.42], size: 9.2, intensity: 1.12 },
      emission_nebula: { symbol: '□', color: [1.0, 0.55, 0.75], labelColor: [1.0, 0.65, 0.8], size: 8.6, intensity: 1.08 },
      dark_nebula: { symbol: '■', color: [0.62, 0.44, 0.28], labelColor: [0.72, 0.54, 0.38], size: 8.2, intensity: 1.0 },
      reflection_nebula: { symbol: '◇', color: [0.35, 0.6, 1.0], labelColor: [0.46, 0.68, 1.0], size: 8.6, intensity: 1.08 },
      planetary_nebula: { symbol: '◉', color: [0.28, 0.9, 0.34], labelColor: [0.42, 0.94, 0.48], size: 8.8, intensity: 1.1 },
      supernova_remnant: { symbol: '✶', color: [0.72, 0.45, 0.95], labelColor: [0.78, 0.55, 0.97], size: 8.8, intensity: 1.1 },
      exoplanet: { symbol: '⊕', color: [0.22, 0.86, 0.82], labelColor: [0.34, 0.9, 0.86], size: 8.0, intensity: 1.04 },
      double_star: { symbol: '⋈', color: [0.78, 0.8, 0.84], labelColor: [0.86, 0.88, 0.92], size: 8.0, intensity: 1.02 },
      quasar: { symbol: '✦', color: [1.0, 1.0, 1.0], labelColor: [0.97, 0.98, 1.0], size: 8.2, intensity: 1.14 },
    };

    // Accept frequent aliases and misspellings.
    const aliases = {
      cluster_open: 'open_cluster',
      glob_cluster: 'globular_cluster',
      emission: 'emission_nebula',
      dark: 'dark_nebula',
      reflection: 'reflection_nebula',
      reflexion_nebula: 'reflection_nebula',
      relexionsnebel: 'reflection_nebula',
      planetary: 'planetary_nebula',
      snr: 'supernova_remnant',
      supernova: 'supernova_remnant',
      exoplanets: 'exoplanet',
      binary_star: 'double_star',
      double: 'double_star',
    };
    const key = aliases[type] || type;
    return map[key] || { symbol: '•', color: [0.5, 0.8, 1.0], labelColor: [0.62, 0.84, 1.0], size: 8.0, intensity: 1.04 };
  }

  _formatDsoDisplayLabel(obj) {
    const id = String(obj?.id || '').trim();
    const name = String(obj?.name || '').trim();
    if (id && name && id.toLowerCase() !== name.toLowerCase()) {
      return `${id} (${name})`;
    }
    return id || name || 'DSO';
  }

  _mixColor(a, b, t) {
    const mixT = Math.max(0, Math.min(1, t));
    return [
      a[0] + (b[0] - a[0]) * mixT,
      a[1] + (b[1] - a[1]) * mixT,
      a[2] + (b[2] - a[2]) * mixT,
    ];
  }

  _rebuildConstellationResolver() {
    this.constellationResolver.rebuild(
      this.catalog.getConstellations(),
      this.catalog.getConstellationBoundaries(),
      this.catalog.starNames,
    );
  }

  getConstellationInfo(target, decDegOverride = null) {
    return this.constellationResolver.getInfo(target, decDegOverride);
  }

  getConstellationNameById(abbr) {
    return this.constellationResolver.getNameById(abbr);
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

  _commonStarName(nameData = {}) {
    const properDe = String(nameData?.propername_de || '').trim();
    const proper = String(nameData?.propername || '').trim();
    if (properDe) return properDe;
    if (proper) return proper;
    const aliases = Array.isArray(nameData?.aliases) ? nameData.aliases : [];
    for (const alias of aliases) {
      const cleaned = String(alias || '').trim();
      if (cleaned) return cleaned;
    }
    return '';
  }

  _formatStarShortName(starId, nameData = {}) {
    const common = this._commonStarName(nameData);
    if (common) return common;

    const starIdSafe = String(starId || '').trim();
    const idFromNameData = String(nameData?.id || '').trim();
    const matchedId = String(nameData?.matchedId || '').trim();

    const hipCandidate = [starIdSafe, matchedId, idFromNameData].find((value) => /^HIP\s*\d+/i.test(value));
    if (hipCandidate) return hipCandidate;

    const flamsteed = String(nameData?.flamsteed || '').trim();
    if (flamsteed) return flamsteed;

    const bayer = String(nameData?.bayer || '').trim();
    if (bayer) return bayer;

    return starIdSafe;
  }

  _formatStarDisplayName(starId, nameData = {}) {
    return this._formatStarShortName(starId, nameData);
  }

  _normalizeStarResult(star, names) {
    const starId = String(star.id || star.name || 'star');
    const nameData = this.catalog.getStarNameForStar(star) || names[starId] || {};
    const displayName = this._formatStarDisplayName(starId, nameData);
    return {
      kind: 'star',
      id: starId,
      label: displayName,
      name: displayName,
      propername: nameData?.propername,
      propernameDe: nameData?.propername_de,
      aliases: Array.isArray(nameData?.aliases) ? [...nameData.aliases] : [],
      bayer: nameData?.bayer,
      flamsteed: nameData?.flamsteed,
      mag: star.mag,
      ra: star.ra,
      dec: star.dec,
    };
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
      const nameData = this.catalog.getStarNameForStar(star) || names[starId] || {};
      const propername = this._commonStarName(nameData);
      const bayer = String(nameData?.bayer || '');
      const flamsteed = String(nameData?.flamsteed || '');
      const aliases = Array.isArray(nameData?.aliases) ? nameData.aliases : [];
      const haystacks = [starId, propername, bayer, flamsteed, ...aliases];
      if (!haystacks.some((entry) => String(entry || '').toLowerCase().includes(q))) continue;
      pushResult(this._normalizeStarResult(star, names), haystacks);
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
