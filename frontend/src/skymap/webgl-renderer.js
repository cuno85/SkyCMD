/**
 * SkyCMD - WebGL Renderer (GPU-accelerated)
 * High-performance rendering for millions of stars and objects
 */

import { Projection } from './projection.js';
import { CatalogManager } from './catalog.js';

export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    
    if (!this.gl) {
      throw new Error('WebGL 2 not supported by browser');
    }

    this.projection = new Projection(canvas.width, canvas.height);
    this.catalog = new CatalogManager();
    
    this.programs = {};
    this.buffers = {};
    this.vaos = {};
    this.textures = {};
    
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
    this.selectedObject = null;
    this.dataSourceOptions = {
      useBackendSmallBodies: true,
    };
    
    this.ready = false;
    this._renderErrorLogged = false;
    
    this._init();
  }

  _init() {
    const gl = this.gl;
    
    // Setup WebGL state
    gl.clearColor(8/255, 14/255, 26/255, 1.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Create shader programs
    this._createStarProgram();
    this._createLineProgram();
    this._createBackgroundProgram();
    
    // Setup canvas resize handling
    this._setupCanvasResize();
  }

  _createStarProgram() {
    const gl = this.gl;
    
    const vertexSrc = `#version 300 es
      in vec2 position;
      in float magnitude;
      in vec3 color;
      
      uniform float magLimit;
      
      out VS_OUT {
        float magnitude;
        vec3 color;
      } vs_out;
      
      void main() {
        // Skip stars fainter than mag limit
        if (magnitude > magLimit) {
          gl_Position = vec4(0.0);
          return;
        }
        
        gl_Position = vec4(position, 0.0, 1.0);
        
        // Size based on magnitude
        float size = max(0.5, (6.5 - magnitude) * 0.8);
        gl_PointSize = size;
        
        vs_out.magnitude = magnitude;
        vs_out.color = color;
      }
    `;
    
    const fragmentSrc = `#version 300 es
      precision mediump float;
      
      in VS_OUT {
        float magnitude;
        vec3 color;
      } fs_in;
      
      out vec4 FragColor;
      
      void main() {
        // Circular point rendering
        vec2 uv = gl_PointCoord - 0.5;
        float dist = dot(uv, uv);
        
        if (dist > 0.25) discard;
        
        // Smooth falloff
        float alpha = 1.0 - sqrt(dist) * 2.0;
        FragColor = vec4(fs_in.color, alpha * 0.9);
      }
    `;
    
    this.programs.star = this._createProgram(vertexSrc, fragmentSrc);
  }

  _createLineProgram() {
    const gl = this.gl;
    
    const vertexSrc = `#version 300 es
      in vec2 position;
      in vec3 color;
      
      uniform mat4 projectionMatrix;
      
      out vec3 vertexColor;
      
      void main() {
        gl_Position = projectionMatrix * vec4(position, 0.0, 1.0);
        vertexColor = color;
      }
    `;
    
    const fragmentSrc = `#version 300 es
      precision mediump float;
      
      in vec3 vertexColor;
      out vec4 FragColor;
      
      void main() {
        FragColor = vec4(vertexColor, 0.8);
      }
    `;
    
    this.programs.line = this._createProgram(vertexSrc, fragmentSrc);
  }

  _createBackgroundProgram() {
    const gl = this.gl;
    
    const vertexSrc = `#version 300 es
      in vec2 position;
      
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;
    
    const fragmentSrc = `#version 300 es
      precision mediump float;
      out vec4 FragColor;
      
      void main() {
        FragColor = vec4(8.0/255.0, 14.0/255.0, 26.0/255.0, 1.0);
      }
    `;
    
    this.programs.background = this._createProgram(vertexSrc, fragmentSrc);
  }

  _createProgram(vertexSrc, fragmentSrc) {
    const gl = this.gl;
    
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertex, vertexSrc);
    gl.compileShader(vertex);
    
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS)) {
      console.error('Vertex shader error:', gl.getShaderInfoLog(vertex));
      throw new Error('Vertex shader compilation failed');
    }
    
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragment, fragmentSrc);
    gl.compileShader(fragment);
    
    if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
      console.error('Fragment shader error:', gl.getShaderInfoLog(fragment));
      throw new Error('Fragment shader compilation failed');
    }
    
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      throw new Error('Program linking failed');
    }
    
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    
    return program;
  }

  _setupCanvasResize() {
    const resizeCanvas = () => {
      const rect = this.canvas.getBoundingClientRect();
      if (this.canvas.width !== rect.width || this.canvas.height !== rect.height) {
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.projection = new Projection(this.canvas.width, this.canvas.height);
      }
    };
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
  }

  async reconfigureCatalogSources(sources = {}) {
    this.catalog.setSources(sources);
    await this.catalog.loadAll();
    await this.catalog.loadConstellationBoundaries();
    this.stats.totalStars = this.catalog.getStars().length;
    this.stats.totalDSO = this.catalog.getDSO().length;
    this._uploadStarData();
    this.ready = true;
    this.render();
  }

  _uploadStarData() {
    const gl = this.gl;
    const stars = this.catalog.getStars();
    
    if (stars.length === 0) return;
    
    // Build vertex data with per-frame projection
    const positions = new Float32Array(stars.length * 2);
    const magnitudes = new Float32Array(stars.length);
    const colors = new Float32Array(stars.length * 3);
    let visibleCount = 0;
    
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      
      // Project to screen using current projection
      const p = this.projection.project(star.ra, star.dec);
      
      // Convert to NDC (Normalized Device Coordinates: -1 to 1)
      const x = (p.x / this.canvas.width) * 2 - 1;
      const y = 1 - (p.y / this.canvas.height) * 2;
      
      positions[i * 2] = x;
      positions[i * 2 + 1] = y;
      
      magnitudes[i] = star.mag;
      
      // Star color based on B-V color index
      const bv = star.bv || 0.0;
      let r, g, b;
      
      // B-V color mapping (Yerkes spectral type approximation)
      if (bv < -0.4) {
        r = 0.7; g = 0.85; b = 1.0; // Blue (O/B stars)
      } else if (bv < 0.0) {
        r = 0.8; g = 0.9; b = 1.0;  // Blue-white (A stars)
      } else if (bv < 0.5) {
        r = 1.0; g = 0.95; b = 0.9; // White (F stars)
      } else if (bv < 1.0) {
        r = 1.0; g = 0.85; b = 0.6; // Yellow (G stars)
      } else {
        r = 1.0; g = 0.6; b = 0.3;  // Orange-red (K/M stars)
      }
      
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      
      visibleCount++;
    }
    
    // Create VAO
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    
    // Position buffer
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    const posLoc = gl.getAttribLocation(this.programs.star, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    // Magnitude buffer
    const magBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, magBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, magnitudes, gl.STATIC_DRAW);
    
    const magLoc = gl.getAttribLocation(this.programs.star, 'magnitude');
    gl.enableVertexAttribArray(magLoc);
    gl.vertexAttribPointer(magLoc, 1, gl.FLOAT, false, 0, 0);
    
    // Color buffer
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    
    const colorLoc = gl.getAttribLocation(this.programs.star, 'color');
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
    
    this.vaos.stars = vao;
    this.buffers.starCount = stars.length;
  }

  render() {
    const gl = this.gl;
    const startTime = performance.now();
    
    try {
      gl.clear(gl.COLOR_BUFFER_BIT);
      
      // Render stars
      if (this.options.showStars && this.vaos.stars) {
        gl.useProgram(this.programs.star);
        gl.bindVertexArray(this.vaos.stars);
        
        const magLimitLoc = gl.getUniformLocation(this.programs.star, 'magLimit');
        gl.uniform1f(magLimitLoc, this.options.magLimit);
        
        gl.drawArrays(gl.POINTS, 0, this.buffers.starCount);
        this.stats.visibleStars = this.buffers.starCount;
      }
      
      this.stats.renderMs = performance.now() - startTime;
      this._renderErrorLogged = false;
    } catch (error) {
      if (!this._renderErrorLogged) {
        console.error('WebGL Render Error:', error);
        this._renderErrorLogged = true;
      }
    }
  }

  requestDraw() {
    // For now, render immediately (could be batched with requestAnimationFrame)
    this.render();
  }

  setMagLimit(limit) {
    this.options.magLimit = limit;
    this.requestDraw();
  }

  toggleOption(name, value) {
    if (name in this.options) {
      this.options[name] = value;
      this.requestDraw();
    }
  }

  getStats() {
    return { ...this.stats };
  }

  getPickables() {
    return [...this.pickables];
  }

  observeObject(obj) {
    this.selectedObject = obj;
    this.requestDraw();
  }
}
