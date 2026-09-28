// ==========================================================
// js/scene.js
// Motor de animación 2D con three.js.
//
// Se usan dos lienzos (canvas) de pantalla completa con una cámara
// ortográfica medida en píxeles CSS, así las coordenadas de three.js
// coinciden con las del DOM (getBoundingClientRect):
//   - #scene-back  (detrás del contenido): campo de puntos y las cajas
//                  y conexiones del recorrido de una petición.
//   - #scene-front (delante del contenido): el robot Bit, los paquetes
//                  que viajan entre capas y el confeti.
// El texto siempre vive en el DOM; three.js solo dibuja el movimiento.
// ==========================================================

(function () {
  'use strict';

  const THREE = window.THREE;
  const Scene = { ready: false };
  window.Scene = Scene;
  if (!THREE) return;

  // Sin gestión de color: los hex de las variables CSS se pintan tal cual
  THREE.ColorManagement.enabled = false;

  const MAIN = ['cliente', 'express', 'routes', 'controllers', 'services', 'models', 'mysql'];
  const SIDE_LINK = { utils: 'services', middleware: 'express' };

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionQuery.matches;
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', (e) => { reduced = e.matches; });

  // ---------------------------------------------------------- utilidades
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const TOKEN_NAMES = [
    '--bg-dot', '--surface', '--line-strong', '--accent', '--accent-tint', '--success', '--danger',
    '--bot-body', '--bot-edge', '--bot-shade', '--bot-screen', '--bot-eye', '--bot-cheek', '--bot-shadow',
    '--m-get', '--m-post', '--m-put', '--m-delete',
  ];
  const tokens = {};
  function readTokens() {
    const cs = getComputedStyle(document.documentElement);
    for (const name of TOKEN_NAMES) {
      if (!tokens[name]) tokens[name] = new THREE.Color('#888888');
      const value = cs.getPropertyValue(name).trim();
      if (value) tokens[name].setStyle(value);
    }
  }
  const tok = (name) => tokens[name];

  function addRoundedRect(path, w, h, r) {
    const x = -w / 2;
    const y = -h / 2;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    path.moveTo(x + r, y);
    path.lineTo(x + w - r, y);
    path.quadraticCurveTo(x + w, y, x + w, y + r);
    path.lineTo(x + w, y + h - r);
    path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    path.lineTo(x + r, y + h);
    path.quadraticCurveTo(x, y + h, x, y + h - r);
    path.lineTo(x, y + r);
    path.quadraticCurveTo(x, y, x + r, y);
    return path;
  }
  const rrGeometry = (w, h, r) => new THREE.ShapeGeometry(addRoundedRect(new THREE.Shape(), w, h, r), 6);
  function rrRingGeometry(w, h, r, t) {
    const shape = addRoundedRect(new THREE.Shape(), w, h, r);
    shape.holes.push(addRoundedRect(new THREE.Path(), w - 2 * t, h - 2 * t, Math.max(0, r - t)));
    return new THREE.ShapeGeometry(shape, 6);
  }
  function basic(color, opacity = 1) {
    return new THREE.MeshBasicMaterial({
      color: color.clone(), transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  function makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // ---------------------------------------------------------- trazos gruesos (líneas con guiones animados)
  const STROKE_VERT = `
    attribute float aDist;
    varying float vDist;
    void main() {
      vDist = aDist;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const STROKE_FRAG = `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uDash;
    uniform float uGap;
    uniform float uOffset;
    varying float vDist;
    void main() {
      if (uDash > 0.0) {
        float m = mod(vDist - uOffset, uDash + uGap);
        if (m > uDash) discard;
      }
      gl_FragColor = vec4(uColor, uOpacity);
    }`;

  function strokeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1 },
        uDash: { value: 0 },
        uGap: { value: 0 },
        uOffset: { value: 0 },
      },
      vertexShader: STROKE_VERT,
      fragmentShader: STROKE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  // Convierte una polilínea en una tira de triángulos con grosor real
  function strokeGeometry(points, width) {
    const n = points.length;
    const pos = new Float32Array(n * 6);
    const dist = new Float32Array(n * 2);
    const index = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(n - 1, i + 1)];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const hw = width / 2;
      pos.set([p.x - ty * hw, p.y + tx * hw, 0, p.x + ty * hw, p.y - tx * hw, 0], i * 6);
      if (i > 0) acc += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
      dist[i * 2] = acc;
      dist[i * 2 + 1] = acc;
      if (i < n - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
    g.setIndex(index);
    return g;
  }

  function makePath(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function pointAt(path, t) {
    const target = clamp(t, 0, 1) * path.len;
    const { pts, cum } = path;
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] >= target) {
        const seg = cum[i] - cum[i - 1] || 1;
        const k = (target - cum[i - 1]) / seg;
        return { x: lerp(pts[i - 1].x, pts[i].x, k), y: lerp(pts[i - 1].y, pts[i].y, k) };
      }
    }
    return pts[pts.length - 1];
  }
  function sampleQuad(out, p0, p1, p2, steps) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y });
    }
  }

  // ---------------------------------------------------------- estado global
  let backR;
  let frontR;
  let camera;
  let W = 0;
  let H = 0;
  let time = 0;
  let stageEl = null;
  let glowTex = null;
  let dots = null;
  let strip = null;
  let stageGraph = null;
  let bit = null;
  let confetti = null;
  let bitSlot = null;
  let currentFlow = { lit: [], mode: 'idle' };
  let bootQueue = [];
  const clock = new THREE.Clock();
  const mouse = { x: 0, y: 0, has: false };
  const scenes = {
    backFull: new THREE.Scene(),
    backStage: new THREE.Scene(),
    frontFull: new THREE.Scene(),
    frontStage: new THREE.Scene(),
  };
  const graphs = () => [strip, stageGraph].filter(Boolean);

  // ---------------------------------------------------------- campo de puntos
  const DOT_VERT = `
    uniform float uTime;
    uniform vec2 uMouse;
    uniform vec3 uRipple;
    uniform float uPixelRatio;
    uniform float uMotion;
    uniform float uIntro;
    uniform vec2 uCenter;
    attribute float aSeed;
    varying float vAlpha;
    varying float vHeat;
    void main() {
      vec3 p = position;
      float hover = 1.0 - smoothstep(0.0, 150.0, distance(p.xy, uMouse));
      float wave = sin(p.x * 0.011 + uTime * 0.55) * cos(p.y * 0.013 - uTime * 0.4);
      float age = uTime - uRipple.z;
      float ring = exp(-pow((distance(p.xy, uRipple.xy) - age * 1100.0) / 70.0, 2.0)) * (1.0 - smoothstep(0.0, 1.4, age));
      float maxR = length(uCenter) * 2.4;
      float reveal = 1.0 - smoothstep(uIntro * maxR - 160.0, uIntro * maxR, distance(p.xy, uCenter));
      vHeat = clamp(hover * 0.8 + ring, 0.0, 1.0);
      vAlpha = (0.6 + 0.25 * wave * uMotion + 0.4 * hover + 0.9 * ring) * reveal;
      gl_PointSize = (1.7 + 1.3 * hover + 2.4 * ring + 0.3 * aSeed) * uPixelRatio;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`;
  const DOT_FRAG = `
    uniform vec3 uColor;
    uniform vec3 uAccent;
    varying float vAlpha;
    varying float vHeat;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float edge = 1.0 - smoothstep(0.32, 0.5, d);
      gl_FragColor = vec4(mix(uColor, uAccent, vHeat), clamp(vAlpha, 0.0, 1.0) * edge);
    }`;

  class DotField {
    constructor(scene) {
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAccent: { value: new THREE.Color() },
          uTime: { value: 0 },
          uMouse: { value: new THREE.Vector2(-9999, 9999) },
          uRipple: { value: new THREE.Vector3(0, 0, -99) },
          uPixelRatio: { value: 1 },
          uMotion: { value: 1 },
          uIntro: { value: 0 },
          uCenter: { value: new THREE.Vector2() },
        },
        vertexShader: DOT_VERT,
        fragmentShader: DOT_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
      this.points.frustumCulled = false;
      scene.add(this.points);
      this.intro = 0;
    }

    build(w, h, dpr) {
      const gap = w < 700 ? 22 : 28;
      const cols = Math.ceil(w / gap) + 1;
      const rows = Math.ceil(h / gap) + 1;
      const pos = new Float32Array(cols * rows * 3);
      const seed = new Float32Array(cols * rows);
      const ox = (w - (cols - 1) * gap) / 2;
      const oy = (h - (rows - 1) * gap) / 2;
      let i = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          pos[i * 3] = ox + c * gap;
          pos[i * 3 + 1] = -(oy + r * gap);
          seed[i] = Math.random();
          i++;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      this.points.geometry.dispose();
      this.points.geometry = g;
      this.material.uniforms.uPixelRatio.value = dpr;
      this.material.uniforms.uCenter.value.set(w / 2, -h / 2);
    }

    ripple(x, y) {
      if (!reduced) this.material.uniforms.uRipple.value.set(x, -y, time);
    }

    update(dt) {
      const u = this.material.uniforms;
      this.intro = Math.min(1, this.intro + dt / 1.6);
      u.uTime.value = time;
      u.uMotion.value = reduced ? 0 : 1;
      u.uIntro.value = reduced ? 1 : easeOut(this.intro);
      if (mouse.has && !reduced) u.uMouse.value.set(mouse.x, -mouse.y);
      else u.uMouse.value.set(-9999, 9999);
      u.uColor.value.copy(tok('--bg-dot'));
      u.uAccent.value.copy(tok('--accent'));
    }
  }

  // ---------------------------------------------------------- director del recorrido (paquetes)
  function chain(from, to) {
    const a = MAIN.indexOf(from);
    const b = MAIN.indexOf(to);
    const hops = [];
    const step = a < b ? 1 : -1;
    for (let i = a; i !== b; i += step) hops.push([MAIN[i], MAIN[i + step]]);
    return hops;
  }

  function buildHops(mode, lit) {
    const mainLit = lit.filter((id) => MAIN.includes(id));
    const sideLit = lit.filter((id) => SIDE_LINK[id]);
    let target = null;
    if (mode === 'full') target = 'mysql';
    else if (mode === 'error') target = 'services';
    else if (mode === 'request') {
      if (mainLit.length) target = MAIN[Math.max(...mainLit.map((id) => MAIN.indexOf(id)))];
      else if (sideLit.length) target = SIDE_LINK[sideLit[0]];
    }
    if (!target) return [];

    const excursions = mode === 'error' ? ['utils'] : sideLit;
    const hops = [];
    for (const [a, b] of chain('cliente', target)) {
      hops.push({ from: a, to: b, kind: 'req', dur: 0.36 });
      for (const side of excursions) {
        if (SIDE_LINK[side] === b) {
          hops.push({ from: b, to: side, kind: 'req', dur: 0.5 });
          hops.push({ from: side, to: b, kind: mode === 'error' ? 'err' : 'req', dur: 0.5 });
        }
      }
    }
    if (mode === 'error') {
      hops.push({ from: 'services', to: 'middleware', kind: 'err', dur: 0.9 });
      hops.push({ from: 'middleware', to: 'cliente', kind: 'err', dur: 0.8 });
    } else {
      for (const [a, b] of chain(target, 'cliente')) hops.push({ from: a, to: b, kind: 'res', dur: 0.32 });
    }
    hops[hops.length - 1].last = true;
    return hops;
  }

  const director = {
    hops: [],
    index: 0,
    p: 0,
    wait: 0,
    loop: true,
    reqColor: '--accent',
    onDone: null,
    current: null,

    play(hops, { loop = true, reqColor = '--accent', onDone = null } = {}) {
      this.hops = hops;
      this.index = 0;
      this.p = 0;
      this.wait = hops.length ? 0.5 : 0;
      this.loop = loop;
      this.reqColor = reqColor;
      this.onDone = onDone;
      this.current = null;
      for (const g of graphs()) g.resetTrail();
    },

    colorFor(kind) {
      if (kind === 'res') return tok('--success');
      if (kind === 'err') return tok('--danger');
      return tok(this.reqColor);
    },

    finish() {
      const cb = this.onDone;
      this.onDone = null;
      if (cb) cb();
    },

    update(dt) {
      this.current = null;
      if (!this.hops.length) return;
      if (reduced) {
        if (!this.loop) {
          this.hops = [];
          this.finish();
        }
        return;
      }
      if (this.wait > 0) {
        this.wait -= dt;
        return;
      }
      const hop = this.hops[this.index];
      this.p += dt / hop.dur;
      if (this.p >= 1) {
        for (const g of graphs()) g.arrive(hop.to, hop.kind);
        this.index += 1;
        this.p = 0;
        if (this.index >= this.hops.length) {
          this.index = 0;
          this.finish();
          if (this.loop) this.wait = 1.4;
          else this.hops = [];
          for (const g of graphs()) g.resetTrail();
          return;
        }
        const next = this.hops[this.index];
        this.wait = next.from === hop.to && hop.kind !== next.kind ? 0.28 : 0.05;
        return;
      }
      this.current = { hop, p: easeInOut(this.p) };
    },
  };

  // ---------------------------------------------------------- grafo del recorrido
  class FlowGraph {
    constructor({ container, back, front, layout }) {
      this.container = container;
      this.layout = layout;
      this.back = back;
      this.front = front;
      this.opacity = layout === 'strip' ? 1 : 0;
      this.group = new THREE.Group();
      this.packetGroup = new THREE.Group();
      back.add(this.group);
      front.add(this.packetGroup);
      this.nodes = new Map();
      this.links = new Map();
      this.pathCache = new Map();
      this.extraLinks = [];
      this.busBase = 0;

      container.querySelectorAll('[data-node]').forEach((el) => {
        const id = el.dataset.node;
        const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
        const node = {
          id, el, radius, w: 0, h: 0, rect: null, visible: false,
          baseLit: 0, passLit: 0, lit: 0, flash: 0, flashKind: 'req',
          halo: new THREE.Mesh(new THREE.BufferGeometry(), basic(tok('--accent'), 0)),
          fill: new THREE.Mesh(new THREE.BufferGeometry(), basic(tok('--surface'), 0)),
          ring: new THREE.Mesh(new THREE.BufferGeometry(), basic(tok('--line-strong'), 0)),
        };
        node.halo.renderOrder = 1;
        node.fill.renderOrder = 2;
        node.ring.renderOrder = 3;
        this.group.add(node.halo, node.fill, node.ring);
        this.nodes.set(id, node);
      });

      // Paquete: cabeza + resplandor + estela
      this.headColor = new THREE.Color();
      this.head = new THREE.Mesh(new THREE.CircleGeometry(layout === 'strip' ? 4 : 5, 24), basic(tok('--accent'), 1));
      this.glow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(), transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }),
      );
      this.glow.scale.setScalar(layout === 'strip' ? 26 : 34);
      this.head.renderOrder = 6;
      this.glow.renderOrder = 5;
      this.trail = [];
      this.history = [];
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(this.head.geometry, basic(tok('--accent'), 0));
        m.renderOrder = 4;
        this.trail.push(m);
        this.packetGroup.add(m);
      }
      this.packetGroup.add(this.glow, this.head);
      this.head.visible = false;
      this.glow.visible = false;
    }

    dispose() {
      this.back.remove(this.group);
      this.front.remove(this.packetGroup);
      const seen = new Set();
      const free = (obj) => {
        obj.traverse((o) => {
          if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
          if (o.material && !seen.has(o.material)) { seen.add(o.material); o.material.dispose(); }
        });
      };
      free(this.group);
      free(this.packetGroup);
    }

    setExtraLinks(pairs) {
      this.extraLinks = pairs;
    }

    applyLit(lit, boot) {
      for (const n of this.nodes.values()) {
        n.baseLit = !boot && lit.has(n.id) ? 1 : 0;
        n.passLit = 0;
      }
    }

    light(id) {
      const n = this.nodes.get(id);
      if (n) {
        n.baseLit = 1;
        n.flash = 1;
        n.flashKind = 'req';
      }
    }

    arrive(id, kind) {
      const n = this.nodes.get(id);
      if (!n) return;
      n.flash = 1;
      n.flashKind = kind;
      if (currentFlow.mode === 'full' || currentFlow.mode === 'send') n.passLit = kind === 'req' ? 1 : 0;
    }

    resetTrail() {
      this.history.length = 0;
    }

    sigOf(r) {
      return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    }

    pathFor(aId, bId) {
      const a = this.nodes.get(aId);
      const b = this.nodes.get(bId);
      if (!a || !b || !a.visible || !b.visible) return null;
      const key = `${aId}>${bId}`;
      const sig = `${this.sigOf(a.rect)}|${this.sigOf(b.rect)}|${Math.round(this.busBase)}`;
      let cached = this.pathCache.get(key);
      if (!cached || cached.sig !== sig) {
        cached = { sig, path: this.computePath(a, b) };
        this.pathCache.set(key, cached);
      }
      return cached.path;
    }

    computePath(a, b) {
      const ra = a.rect;
      const rb = b.rect;
      const ia = MAIN.indexOf(a.id);
      const ib = MAIN.indexOf(b.id);
      let pts;
      if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1) {
        pts = this.straight(ra, rb);
      } else if (this.layout === 'strip') {
        const level = a.id === 'middleware' || b.id === 'middleware' ? 2 : 1;
        pts = this.bus(ra, rb, this.busBase + (level === 2 ? 7 : 1));
      } else {
        pts = this.sCurve(ra, rb);
      }
      return makePath(pts.map((p) => ({ x: p.x, y: -p.y })));
    }

    straight(ra, rb) {
      const acx = ra.left + ra.width / 2;
      const acy = ra.top + ra.height / 2;
      const bcx = rb.left + rb.width / 2;
      const bcy = rb.top + rb.height / 2;
      if (Math.abs(bcx - acx) > Math.abs(bcy - acy)) {
        const dir = Math.sign(bcx - acx);
        return [{ x: dir > 0 ? ra.right : ra.left, y: acy }, { x: dir > 0 ? rb.left : rb.right, y: bcy }];
      }
      const dir = Math.sign(bcy - acy);
      return [{ x: acx, y: dir > 0 ? ra.bottom : ra.top }, { x: bcx, y: dir > 0 ? rb.top : rb.bottom }];
    }

    // Línea tipo "bus" por debajo de la franja, para saltos entre nodos no vecinos
    bus(ra, rb, y) {
      const ax = ra.left + ra.width / 2;
      const bx = rb.left + rb.width / 2;
      const r = 5;
      const sx = Math.sign(bx - ax) || 1;
      const pts = [{ x: ax, y: ra.bottom }, { x: ax, y: y - r }];
      sampleQuad(pts, { x: ax, y: y - r }, { x: ax, y }, { x: ax + sx * r, y }, 5);
      pts.push({ x: bx - sx * r, y });
      sampleQuad(pts, { x: bx - sx * r, y }, { x: bx, y }, { x: bx, y: y - r }, 5);
      pts.push({ x: bx, y: rb.bottom });
      return pts;
    }

    // Curva en S entre una capa principal y una transversal (diagrama vertical)
    sCurve(ra, rb) {
      const leftFirst = ra.left < rb.left;
      const L = leftFirst ? ra : rb;
      const R = leftFirst ? rb : ra;
      const p0 = { x: L.right, y: L.top + L.height / 2 };
      const p3 = { x: R.left, y: R.top + R.height / 2 };
      const dx = (p3.x - p0.x) / 2;
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const u = 1 - t;
        pts.push({
          x: u * u * u * p0.x + 3 * u * u * t * (p0.x + dx) + 3 * u * t * t * (p3.x - dx) + t * t * t * p3.x,
          y: u * u * u * p0.y + 3 * u * u * t * p0.y + 3 * u * t * t * p3.y + t * t * t * p3.y,
        });
      }
      return leftFirst ? pts : pts.reverse();
    }

    wantedLinks() {
      const pairs = [];
      const present = MAIN.filter((id) => this.nodes.has(id));
      for (let i = 0; i < present.length - 1; i++) pairs.push([present[i], present[i + 1]]);
      if (this.layout !== 'strip') {
        for (const side of Object.keys(SIDE_LINK)) if (this.nodes.has(side)) pairs.push([SIDE_LINK[side], side]);
      }
      for (const pair of this.extraLinks) pairs.push(pair);
      return pairs;
    }

    update(dt) {
      const fade = damp(this.opacity, 1, 5, dt);
      this.opacity = this.layout === 'strip' ? 1 : fade;
      const o = this.opacity;
      let busBase = 0;

      for (const n of this.nodes.values()) {
        const r = n.el.getBoundingClientRect();
        n.visible = r.width > 0 && r.height > 0;
        n.rect = r;
        n.halo.visible = n.fill.visible = n.ring.visible = n.visible;
        if (!n.visible) continue;
        busBase = Math.max(busBase, r.bottom);
        if (Math.abs(r.width - n.w) > 0.5 || Math.abs(r.height - n.h) > 0.5) {
          n.w = r.width;
          n.h = r.height;
          n.fill.geometry.dispose();
          n.ring.geometry.dispose();
          n.halo.geometry.dispose();
          n.fill.geometry = rrGeometry(n.w, n.h, n.radius);
          n.ring.geometry = rrRingGeometry(n.w, n.h, n.radius, 1.5);
          n.halo.geometry = rrGeometry(n.w + 10, n.h + 10, n.radius + 5);
        }
        const cx = r.left + r.width / 2;
        const cy = -(r.top + r.height / 2);
        n.fill.position.set(cx, cy, 0);
        n.ring.position.set(cx, cy, 0);
        n.halo.position.set(cx, cy, 0);

        n.lit = damp(n.lit, Math.max(n.baseLit, n.passLit), 7, dt);
        n.flash = Math.max(0, n.flash - dt * 1.8);
        const flashColor = n.flashKind === 'res' ? tok('--success') : n.flashKind === 'err' ? tok('--danger') : tok('--accent');
        const k = clamp(n.lit, 0, 1);
        n.fill.material.color.copy(tok('--surface')).lerp(tok('--accent-tint'), k);
        n.ring.material.color.copy(tok('--line-strong')).lerp(tok('--accent'), k).lerp(flashColor, n.flash);
        n.halo.material.color.copy(tok('--accent')).lerp(flashColor, n.flash);
        n.fill.material.opacity = o;
        n.ring.material.opacity = o;
        const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3);
        n.halo.material.opacity = o * (k * (0.1 + 0.08 * pulse) + n.flash * 0.35);
      }
      this.busBase = busBase + 4;

      // Conexiones
      const active = director.hops.length > 0 && !reduced;
      const wanted = new Set();
      for (const [a, b] of this.wantedLinks()) {
        const key = `${a}|${b}`;
        wanted.add(key);
        const path = this.pathFor(a, b);
        let link = this.links.get(key);
        if (!link) {
          link = { mesh: new THREE.Mesh(new THREE.BufferGeometry(), strokeMaterial()), sig: '' };
          link.mesh.renderOrder = 0;
          this.group.add(link.mesh);
          this.links.set(key, link);
        }
        link.mesh.visible = !!path;
        if (!path) continue;
        const sig = this.pathCache.get(`${a}>${b}`).sig;
        if (link.sig !== sig) {
          link.mesh.geometry.dispose();
          link.mesh.geometry = strokeGeometry(path.pts, 1.5);
          link.sig = sig;
        }
        const u = link.mesh.material.uniforms;
        const isError = currentFlow.mode === 'error' && (a === 'middleware' || b === 'middleware');
        u.uColor.value.copy(isError ? tok('--danger') : tok('--line-strong'));
        u.uOpacity.value = o * (isError ? 0.75 : 0.95);
        u.uDash.value = active ? 3 : 0;
        u.uGap.value = 4;
        u.uOffset.value = time * 16;
      }
      for (const [key, link] of this.links) {
        if (!wanted.has(key)) {
          this.group.remove(link.mesh);
          link.mesh.geometry.dispose();
          link.mesh.material.dispose();
          this.links.delete(key);
        }
      }

      this.updatePacket();
    }

    updatePacket() {
      const cur = director.current;
      let point = null;
      if (cur) {
        const path = this.pathFor(cur.hop.from, cur.hop.to);
        if (path) {
          point = pointAt(path, cur.p);
          this.headColor.copy(director.colorFor(cur.hop.kind));
        }
      }
      if (point) {
        this.history.push(point);
        if (this.history.length > 9) this.history.shift();
      } else if (this.history.length) {
        this.history.shift();
      }
      this.head.visible = this.glow.visible = !!point;
      if (point) {
        this.head.position.set(point.x, point.y, 0);
        this.glow.position.set(point.x, point.y, 0);
        this.head.material.color.copy(this.headColor);
        this.glow.material.color.copy(this.headColor);
        this.head.material.opacity = this.opacity;
        this.glow.material.opacity = 0.55 * this.opacity;
      }
      for (let i = 0; i < this.trail.length; i++) {
        const m = this.trail[i];
        const h = this.history[this.history.length - 2 - i];
        m.visible = !!h;
        if (!h) continue;
        const k = 1 - i / this.trail.length;
        m.position.set(h.x, h.y, 0);
        m.scale.setScalar(0.35 + 0.55 * k);
        m.material.color.copy(this.headColor);
        m.material.opacity = 0.45 * k * this.opacity;
      }
    }
  }

  // ---------------------------------------------------------- Bit, el robot
  class Robot {
    constructor(scene) {
      this.root = new THREE.Group();
      scene.add(this.root);
      this.bob = new THREE.Group();
      this.root.add(this.bob);
      this.pos = { x: 0, y: 0, s: 0.5, init: false };

      const m = (name, opacity = 1) => basic(tok(name), opacity);
      this.mats = {
        body: m('--bot-body'),
        edge: m('--bot-edge'),
        shade: m('--bot-shade'),
        screen: m('--bot-screen'),
        eye: m('--bot-eye'),
        cheek: m('--bot-cheek', 0.8),
        accent: m('--accent'),
        shadow: m('--bot-shadow', 0.14),
        glare: basic(new THREE.Color('#ffffff'), 0.12),
        glow: new THREE.MeshBasicMaterial({ map: glowTex, color: tok('--accent').clone(), transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }),
      };

      const add = (geo, mat, x, y, parent, order) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, 0);
        mesh.renderOrder = order;
        parent.add(mesh);
        return mesh;
      };

      this.shadow = add(new THREE.CircleGeometry(1, 40), this.mats.shadow, 0, -88, this.root, 0);
      this.shadow.scale.set(36, 5, 1);

      // Brazos (detrás del cuerpo). Pivote en el hombro, cuelgan hacia abajo.
      this.armL = new THREE.Group();
      this.armR = new THREE.Group();
      this.armL.position.set(-31, -44, 0);
      this.armR.position.set(31, -44, 0);
      this.bob.add(this.armL, this.armR);
      for (const arm of [this.armL, this.armR]) {
        add(rrGeometry(11, 30, 5.5), this.mats.shade, 0, -14, arm, 1);
        add(new THREE.CircleGeometry(7.5, 24), this.mats.edge, 0, -30, arm, 2);
        add(new THREE.CircleGeometry(6, 24), this.mats.body, 0, -30, arm, 3);
      }

      // Cuerpo, cuello y orejas
      add(rrGeometry(64, 42, 16), this.mats.edge, 0, -54, this.bob, 4);
      add(rrGeometry(60, 38, 14), this.mats.body, 0, -54, this.bob, 5);
      this.belly = add(new THREE.CircleGeometry(4.5, 24), this.mats.accent, 0, -54, this.bob, 6);
      add(rrGeometry(18, 12, 4), this.mats.shade, 0, -32, this.bob, 4);
      add(rrGeometry(10, 26, 5), this.mats.shade, -54, 6, this.bob, 4);
      add(rrGeometry(10, 26, 5), this.mats.shade, 54, 6, this.bob, 4);

      // Antena
      this.antenna = new THREE.Group();
      this.antenna.position.set(0, 43, 0);
      this.bob.add(this.antenna);
      add(rrGeometry(4, 18, 2), this.mats.shade, 0, 8, this.antenna, 4);
      this.bulbGlow = add(new THREE.PlaneGeometry(44, 44), this.mats.glow, 0, 20, this.antenna, 3);
      this.bulb = add(new THREE.CircleGeometry(7.5, 28), this.mats.accent, 0, 20, this.antenna, 5);

      // Cabeza y pantalla
      add(rrGeometry(104, 78, 28), this.mats.edge, 0, 6, this.bob, 6);
      add(rrGeometry(100, 74, 26), this.mats.body, 0, 6, this.bob, 7);
      add(rrGeometry(78, 52, 16), this.mats.screen, 0, 5, this.bob, 8);
      add(rrGeometry(20, 4.5, 2.2), this.mats.glare, -21, 25, this.bob, 9);

      // Cara (se desplaza para "mirar")
      this.face = new THREE.Group();
      this.face.position.set(0, 5, 0);
      this.bob.add(this.face);
      this.eyes = [-15, 15].map((x) => add(rrGeometry(12, 17, 6), this.mats.eye, x, 7, this.face, 10));
      this.happy = new THREE.Group();
      this.face.add(this.happy);
      for (const x of [-15, 15]) {
        for (const dir of [-1, 1]) {
          const bar = add(rrGeometry(10, 3.6, 1.8), this.mats.eye, x + dir * 3.4, 6, this.happy, 10);
          bar.rotation.z = -dir * 0.65;
        }
      }
      this.smile = add(new THREE.RingGeometry(5.2, 8.2, 24, 1, Math.PI * 1.12, Math.PI * 0.76), this.mats.eye, 0, -2, this.face, 10);
      this.mouth = add(new THREE.CircleGeometry(4.6, 24), this.mats.eye, 0, -8, this.face, 10);
      this.cheeks = [-27, 27].map((x) => add(new THREE.CircleGeometry(4.2, 20), this.mats.cheek, x, -5, this.face, 10));

      this.blinkT = 1.5;
      this.blink = 0;
      this.talkUntil = 0;
      this.mood = 'talk';
      this.hop = 0;
      this.hopV = 0;
      this.nextCheer = 0;
      this.happyUntil = 0;
      this.spin = 0;
      this.look = new THREE.Vector2(2, 0);
      this.armRz = 0.14;
      this.armLz = -0.14;
    }

    kick(v = 240) {
      if (!reduced) this.hopV = v;
    }

    update(dt) {
      // Posición: sigue al elemento del DOM que le sirve de "casa"
      let target = null;
      if (bitSlot) {
        const r = bitSlot.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) target = { x: r.left + r.width / 2, y: r.top + r.height / 2, s: Math.min(r.height / 172, r.width / 132) };
      }
      this.root.visible = !!target;
      if (!target) return;
      if (!this.pos.init || reduced) {
        this.pos.x = target.x;
        this.pos.y = target.y;
        this.pos.s = target.s;
        this.pos.init = true;
      } else {
        this.pos.x = damp(this.pos.x, target.x, 6, dt);
        this.pos.y = damp(this.pos.y, target.y, 6, dt);
        this.pos.s = damp(this.pos.s, target.s, 6, dt);
      }
      const s = this.pos.s;
      this.root.position.set(this.pos.x, -this.pos.y + 9 * s, 0);
      this.root.scale.setScalar(s);

      // Flotar + saltos
      const talking = time < this.talkUntil && !reduced;
      if (this.mood === 'celebrate' && !reduced && this.hop === 0 && time > this.nextCheer) {
        this.hopV = 250;
        this.nextCheer = time + 1.1;
      }
      if (this.hopV !== 0 || this.hop > 0) {
        this.hopV -= 950 * dt;
        this.hop += this.hopV * dt;
        if (this.hop <= 0) {
          this.hop = 0;
          this.hopV = 0;
        }
      }
      const bobY = reduced ? 0 : Math.sin(time * 2.1) * 3.5;
      const stretch = clamp(this.hopV / 2400, -0.08, 0.08);
      this.bob.position.y = bobY + this.hop;
      this.bob.scale.set(1 - stretch, 1 + stretch, 1);
      const lift = clamp((bobY + this.hop) / 120, -0.2, 1);
      this.shadow.scale.set(36 * (1 - 0.45 * lift), 5 * (1 - 0.3 * lift), 1);
      this.mats.shadow.opacity = 0.14 * (1 - 0.6 * lift);

      // Parpadeo
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blink = 1;
        this.blinkT = 2.2 + Math.random() * 3.2;
      }
      this.blink = Math.max(0, this.blink - dt * 7);
      const blinkScale = 1 - 0.9 * Math.sin(this.blink * Math.PI);

      // Mirada: sigue al puntero; si no hay, mira hacia el contenido
      let lx = 2.5;
      let ly = 0;
      if (this.mood === 'think') {
        lx = -3;
        ly = 3;
      } else if (mouse.has) {
        lx = clamp((mouse.x - this.pos.x) / 260, -1, 1) * 4;
        ly = clamp(-(mouse.y - this.pos.y) / 260, -1, 1) * 3;
      }
      this.look.x = damp(this.look.x, lx, 8, dt);
      this.look.y = damp(this.look.y, ly, 8, dt);
      this.face.position.set(this.look.x, 5 + this.look.y, 0);

      // Expresión
      const happy = this.mood === 'celebrate' || this.mood === 'wave' || time < this.happyUntil;
      const surprised = this.mood === 'surprised';
      for (const eye of this.eyes) {
        eye.visible = !happy;
        eye.scale.set(surprised ? 1.15 : 1, blinkScale * (surprised ? 1.15 : 1), 1);
      }
      this.happy.visible = happy;
      if (talking) {
        this.smile.visible = false;
        this.mouth.visible = true;
        this.mouth.scale.set(1, 0.3 + 0.7 * Math.abs(Math.sin(time * 13)), 1);
      } else if (surprised) {
        this.smile.visible = false;
        this.mouth.visible = true;
        this.mouth.scale.set(0.8, 0.8, 1);
      } else {
        this.smile.visible = true;
        this.mouth.visible = false;
      }

      // Brazos
      let rT = 0.14 + Math.sin(time * 1.7) * 0.06;
      let lT = -0.14 - Math.sin(time * 1.7 + 0.8) * 0.06;
      if (reduced) {
        rT = 0.14;
        lT = -0.14;
      } else if (this.mood === 'celebrate') {
        rT = 2.5 + Math.sin(time * 9) * 0.25;
        lT = -2.5 - Math.sin(time * 9 + 0.6) * 0.25;
      } else if (this.mood === 'wave') {
        rT = 2.45 + Math.sin(time * 8) * 0.38;
      } else if (surprised) {
        rT = 1.05;
        lT = -1.05;
      } else if (talking) {
        rT = 1.3 + Math.sin(time * 3) * 0.12;
      }
      this.armRz = damp(this.armRz, rT, 10, dt);
      this.armLz = damp(this.armLz, lT, 10, dt);
      this.armR.rotation.z = this.armRz;
      this.armL.rotation.z = this.armLz;

      // Antena
      const pulse = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(time * (talking ? 9 : 3));
      this.bulbGlow.material.opacity = 0.3 + 0.5 * pulse;
      this.bulb.scale.setScalar(1 + 0.08 * pulse);
      this.spin = Math.max(0, this.spin - dt * 1.6);
      this.antenna.rotation.z = (reduced ? 0 : Math.sin(time * 2.3) * 0.06) + Math.sin(this.spin * 18) * 0.35 * this.spin;

      // Colores del tema
      const M = this.mats;
      M.body.color.copy(tok('--bot-body'));
      M.edge.color.copy(tok('--bot-edge'));
      M.shade.color.copy(tok('--bot-shade'));
      M.screen.color.copy(tok('--bot-screen'));
      M.eye.color.copy(tok('--bot-eye'));
      M.cheek.color.copy(tok('--bot-cheek'));
      M.accent.color.copy(tok('--accent'));
      M.shadow.color.copy(tok('--bot-shadow'));
      M.glow.color.copy(tok('--accent'));
    }
  }

  // ---------------------------------------------------------- confeti
  class Confetti {
    constructor(scene) {
      this.max = 180;
      this.mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
        this.max,
      );
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 20;
      const white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < this.max; i++) this.mesh.setColorAt(i, white);
      this.mesh.count = 0;
      scene.add(this.mesh);
      this.parts = [];
      this.dummy = new THREE.Object3D();
    }

    burst(x, y, n = 110) {
      if (reduced) return;
      const palette = ['--m-post', '--m-get', '--m-put', '--m-delete', '--accent', '--bot-eye'];
      for (let i = 0; i < n; i++) {
        if (this.parts.length >= this.max) this.parts.shift();
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.3;
        const speed = 360 + Math.random() * 460;
        this.parts.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          rot: Math.random() * 6,
          vr: (Math.random() - 0.5) * 14,
          w: 5 + Math.random() * 5,
          h: 8 + Math.random() * 7,
          life: 2.2 + Math.random() * 1.3,
          age: 0,
          color: tok(palette[i % palette.length]).clone(),
        });
      }
    }

    update(dt) {
      const parts = this.parts;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age > p.life) {
          parts.splice(i, 1);
          continue;
        }
        p.vy += 900 * dt;
        p.vx *= 1 - 0.9 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
      const d = this.dummy;
      parts.forEach((p, i) => {
        const fade = 1 - clamp((p.age - (p.life - 0.5)) / 0.5, 0, 1);
        d.position.set(p.x, -p.y, 0);
        d.rotation.set(0, 0, p.rot);
        d.scale.set(p.w * fade, (p.h * Math.abs(Math.cos(p.age * 6 + p.rot)) + 0.6) * fade, 1);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        this.mesh.setColorAt(i, p.color);
      });
      this.mesh.count = parts.length;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------- ciclo principal
  function makeRenderer(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setClearColor(0x000000, 0);
    r.autoClear = false;
    return r;
  }

  // Se mide el propio lienzo (no window.innerHeight) para que las
  // coordenadas de three.js coincidan siempre con las del DOM
  function resize() {
    const canvas = backR.domElement;
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const r of [backR, frontR]) {
      r.setPixelRatio(dpr);
      r.setSize(W, H, false);
    }
    camera.left = 0;
    camera.right = W;
    camera.top = 0;
    camera.bottom = -H;
    camera.updateProjectionMatrix();
    dots.build(W, H, dpr);
  }

  function render() {
    const sr = stageEl.getBoundingClientRect();
    const passes = [
      [backR, scenes.backFull, scenes.backStage],
      [frontR, scenes.frontFull, scenes.frontStage],
    ];
    for (const [r, full, stage] of passes) {
      r.setScissorTest(false);
      r.clear();
      r.render(full, camera);
      if (stage.children.length && sr.height > 0) {
        r.setScissorTest(true);
        r.setScissor(sr.left, H - sr.bottom, sr.width, sr.height);
        r.render(stage, camera);
        r.setScissorTest(false);
      }
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (document.hidden) return;
    time += dt;

    while (bootQueue.length && (reduced || bootQueue[0].at <= time)) {
      const { id } = bootQueue.shift();
      for (const g of graphs()) g.light(id);
    }

    dots.update(dt);
    director.update(dt);
    for (const g of graphs()) g.update(dt);
    bit.update(dt);
    confetti.update(dt);
    render();
  }

  function extraLinksFor(hops, lit) {
    const pairs = [];
    const seen = new Set();
    const addPair = (a, b) => {
      if (MAIN.includes(a) && MAIN.includes(b) && Math.abs(MAIN.indexOf(a) - MAIN.indexOf(b)) === 1) return;
      const key = [a, b].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push([a, b]);
    };
    for (const h of hops) addPair(h.from, h.to);
    for (const id of lit) if (SIDE_LINK[id]) addPair(SIDE_LINK[id], id);
    return pairs;
  }

  function applyFlow(flow) {
    currentFlow = flow;
    const lit = new Set(flow.lit || []);
    const boot = flow.mode === 'boot' && !reduced;
    for (const g of graphs()) g.applyLit(lit, boot);
    bootQueue = boot ? (flow.lit || []).map((id, i) => ({ at: time + 0.3 + i * 0.13, id })) : [];
    const hops = buildHops(flow.mode, flow.lit || []);
    for (const g of graphs()) g.setExtraLinks(extraLinksFor(hops, flow.lit || []));
    director.play(hops, { loop: true });
  }

  // ---------------------------------------------------------- API pública
  Scene.init = function init({ back, front, stage, pipeline }) {
    try {
      backR = makeRenderer(back);
      frontR = makeRenderer(front);
    } catch (err) {
      return false;
    }
    stageEl = stage;
    camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
    camera.position.z = 10;
    readTokens();
    glowTex = makeGlowTexture();
    dots = new DotField(scenes.backFull);
    strip = new FlowGraph({ container: pipeline, back: scenes.backFull, front: scenes.frontFull, layout: 'strip' });
    bit = new Robot(scenes.frontFull);
    confetti = new Confetti(scenes.frontFull);
    resize();

    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(back);
    window.addEventListener('pointermove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.has = true;
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { mouse.has = false; });
    new MutationObserver(readTokens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', readTokens);

    Scene.ready = true;
    requestAnimationFrame(loop);
    return true;
  };

  Scene.setSlide = function setSlide({ slideEl, slot, flow, mood, ripple }) {
    if (!Scene.ready) return;
    if (stageGraph) {
      stageGraph.dispose();
      stageGraph = null;
    }
    const container = slideEl.querySelector('[data-graph]');
    if (container) stageGraph = new FlowGraph({ container, back: scenes.backStage, front: scenes.frontStage, layout: 'vertical' });
    bitSlot = slot;
    applyFlow(flow || { lit: [], mode: 'idle' });
    bit.mood = mood || 'talk';
    bit.kick(mood === 'celebrate' ? 300 : 200);
    if (ripple) dots.ripple(bit.pos.x || W / 2, bit.pos.y || H / 2);
    if (mood === 'celebrate') setTimeout(() => Scene.burst(), 350);
  };

  Scene.talk = function talk(ms) {
    if (bit) bit.talkUntil = time + ms / 1000;
  };

  Scene.poke = function poke() {
    if (!bit) return;
    bit.kick(340);
    bit.happyUntil = time + 1.3;
    bit.spin = 1;
    if (bit.mood === 'celebrate') Scene.burst();
  };

  Scene.burst = function burst() {
    if (bit && confetti) confetti.burst(bit.pos.x, bit.pos.y - 40 * bit.pos.s);
  };

  // Envía una petición de prueba por el recorrido (paso 22)
  Scene.send = function send(request) {
    return new Promise((resolve) => {
      if (!Scene.ready || reduced) {
        resolve();
        return;
      }
      const methodToken = { GET: '--m-get', POST: '--m-post', PUT: '--m-put', DELETE: '--m-delete' }[request.method] || '--accent';
      const mode = request.error ? 'error' : 'full';
      const saved = currentFlow;
      currentFlow = { lit: saved.lit, mode: request.error ? 'error' : 'send' };
      for (const g of graphs()) for (const n of g.nodes.values()) n.passLit = 0;
      const hops = buildHops(mode, []);
      for (const g of graphs()) g.setExtraLinks(extraLinksFor(hops, []));
      bit.mood = 'talk';
      director.play(hops, {
        loop: false,
        reqColor: methodToken,
        onDone: () => {
          bit.mood = request.error ? 'surprised' : 'talk';
          bit.happyUntil = request.error ? 0 : time + 1.2;
          bit.kick(request.error ? 120 : 220);
          applyFlow(saved);
          resolve();
        },
      });
    });
  };
})();
