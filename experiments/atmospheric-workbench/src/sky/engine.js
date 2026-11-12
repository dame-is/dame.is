// The sky on the bench: clouds you can pick up and reshape on a turntable,
// and the light that ice and rain make of the sun.
//
// The clouds and the turntable are atmosphere.online's sky (its sky.js),
// brought over with its camera changed: there it flew, here it stands still
// and looks round, because here the sky sits in a page that has to scroll.
// A cloud is a few hundred soft puffs, all drawn in one instanced batch and
// sorted back to front each frame (clouds.js, puff.js).
//
// The light is new. Halos are traced a ray at a time through ice crystals
// (optics/halo.js) into a picture of the whole sky, which the dome then
// wears; the rainbow is a table of brightness by angle from the point
// opposite the sun (optics/rainbow.js). Neither is drawn as an arc.
//
// This file owns the canvas, the clock and the pointer. It is not React: the
// component reads `getSnapshot()` and calls the methods at the bottom.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  GEN,
  OPENING_SKY,
  TYPES,
  TYPE_KEYS,
  metres,
  mulberry,
} from './clouds.js';
import { makeNoise, puffMaterial } from './puff.js';
import { COLOR_KEYS, SUN_BEARING, skyAt, sunVector } from './palette.js';
import { createExposure } from '../optics/exposure.js';
import { SKY_REACH } from '../optics/halo.js';
import { BOW_REACH, rainbowTable } from '../optics/rainbow.js';
import {
  CRYSTALS,
  CRYSTAL_KEYS,
  DISPLAYS,
  emptyAir,
} from '../optics/displays.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const r2 = (v) => Math.round(v * 100) / 100;

const MAX_PUFFS = 12000;
const MAX_DROPS = 3000;
const BOLT_N = 14;
// The sky wraps round east to west every 2 × WRAP, and fades out near the seam.
const WRAP = 120;
const FAR_WRAP = 1800;
// Where the bench stands, and which way it faces when nothing has turned it.
const HOME = new THREE.Vector3(0, 9, 34);
const HOME_YAW = Math.PI;
const HOME_PITCH = 0.068;
const FOV = { clouds: 50, light: 82 };
const FOV_RANGE = { clouds: [28, 70], light: [35, 112] };
const SUN_RANGE = [-1, 90];

const HINTS = {
  turn: 'Drag to turn the table.',
  puff: 'Brush over the cloud to grow new puffs.',
  poke: 'Tap or brush puffs to poke them out.',
};

export const TOOLS = ['turn', 'puff', 'poke'];
export { TYPES, TYPE_KEYS, CRYSTALS, DISPLAYS, SUN_RANGE };

/** Where the sky is kept between visits. */
export function browserStorage(key = 'atmospheric-workbench:v1') {
  return {
    load() {
      try {
        return JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        return null;
      }
    },
    save(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Private windows and full disks: the sky just isn't kept.
      }
    },
  };
}

/**
 * Build the sky in `host`. Throws if the browser won't give a WebGL context.
 *
 *   storage       { load, save }, or null to keep nothing
 *   reduceMotion  no drift, no billow, no easing of the camera
 */
export function createSky(host, { storage = null, reduceMotion = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'atmo-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'A sky of clouds, seen from among them, with the sun off to one side.',
  );
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: (devicePixelRatio || 1) < 2,
    alpha: false,
    powerPreference: 'high-performance',
  });
  // Every colour here is painted for the screen and handed to the shaders as
  // it is, the way atmosphere.online's were. Nothing is converted on the way
  // in (rgb(), below) or on the way out.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  host.prepend(canvas);
  const reduce = reduceMotion;
  const coarse =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  /* ---------- what the bench is set to ---------- */
  let bench = 'clouds';
  let sunAltitude = 23.5;
  let night = false;
  let knots = 12;
  const air = emptyAir();
  let rainAmount = 0;
  let exposure = 0.5;
  let display = null;
  let rays = 0;
  let tracing = false;
  let notice = null;
  let noticeId = 0;
  let noticeTimer = 0;

  /* ---------- colours, eased toward the sun's height ---------- */
  const rgb = (c, v) => c.setRGB(v[0], v[1], v[2]);
  const S = { sunDir: new THREE.Vector3(), stars: 0, fogMax: 0.72 };
  const G = {};
  for (const k of COLOR_KEYS) {
    S[k] = new THREE.Color();
    G[k] = new THREE.Color();
  }
  const goalSun = new THREE.Vector3();
  let goalStars = 0;
  let goalFog = 0.72;
  function setSky(instant) {
    const p = skyAt(sunAltitude, night);
    for (const k of COLOR_KEYS) {
      rgb(G[k], p[k]);
      if (instant) S[k].copy(G[k]);
    }
    // At night the light is the moon, and it keeps a little height so the
    // clouds are lit from somewhere.
    goalSun.set(...sunVector(night ? Math.max(sunAltitude, 6) : sunAltitude));
    goalStars = p.stars;
    goalFog = p.fogMax;
    if (instant) {
      S.sunDir.copy(goalSun);
      S.stars = goalStars;
      S.fogMax = goalFog;
    }
  }

  /* ---------- scene ---------- */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV.clouds, 1, 0.5, 2600);
  camera.position.copy(HOME);
  // The orbit controls turn the table; looking round the sky is done by hand
  // (lookCam, below). A wheel is left to the page unless Ctrl is held (which
  // is also what a trackpad pinch sends), so the page still scrolls.
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) {
        e.stopImmediatePropagation();
        return;
      }
      if (mode !== 'table') {
        e.preventDefault();
        zoomBy(Math.exp(e.deltaY * 0.01));
      }
    },
    { passive: false },
  );
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;
  controls.minDistance = 9;
  controls.maxDistance = 110;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.66;

  const noise = makeNoise(256);
  const uTime = { value: 0 };
  const uFlash = { value: 0 };
  // What the sky is multiplied by: 1, or less while it is stopped down for
  // the light.
  const uDim = { value: new THREE.Color(1, 1, 1) };
  const cloudDim = new THREE.Color(1, 1, 1);

  // The picture of the halos, and the rainbow's table.
  const blank = () => {
    const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  };
  let haloTex = blank();
  const bowTex = (() => {
    const bins = 1024;
    const table = rainbowTable({ bins });
    const data = new Uint8Array(bins * 4);
    for (let i = 0; i < bins; i++) {
      for (let c = 0; c < 3; c++) {
        data[i * 4 + c] = 255 * Math.sqrt(Math.min(1, table[i * 3 + c]));
      }
      data[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(data, bins, 1, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  })();

  // the dome: the gradient and warm sun, stars at night, a sea of cloud
  // below the horizon, and over those the light the ice and the rain make
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTop: { value: S.top },
        uMid: { value: S.mid },
        uLow: { value: S.low },
        uHor: { value: S.hor },
        uFloor: { value: S.floor },
        uSunDir: { value: S.sunDir },
        uSunCol: { value: S.sunCol },
        uStorm: { value: S.storm },
        uStars: { value: 0 },
        uFlash,
        uTime,
        uDim,
        uNoise: { value: noise },
        uHalo: { value: haloTex },
        uHaloGain: { value: 0 },
        uBow: { value: bowTex },
        uBowGain: { value: 0 },
        uBearing: { value: new THREE.Vector2(...SUN_BEARING) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uTop, uMid, uLow, uHor, uFloor, uSunDir, uSunCol, uStorm;
        uniform float uStars, uFlash, uTime, uHaloGain, uBowGain; uniform vec3 uDim;
        uniform sampler2D uNoise, uHalo, uBow; uniform vec2 uBearing;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir); float y = d.y, t = clamp(y, 0.0, 1.0);
          vec3 c = mix(uHor, uLow, smoothstep(0.0, 0.12, t));
          c = mix(c, uMid, smoothstep(0.1, 0.4, t));
          c = mix(c, uTop, smoothstep(0.35, 0.95, t));
          if (y < 0.0){
            vec2 uv = d.xz / max(-y, 0.035) * 0.035 + vec2(uTime * 0.0015, 0.0);
            float n = texture2D(uNoise, uv).r * 0.62 + texture2D(uNoise, uv * 2.7 + 0.37).r * 0.38;
            vec3 below = mix(uFloor * vec3(0.88, 0.88, 0.94), uFloor, smoothstep(0.36, 0.7, n));
            c = mix(below, uHor, smoothstep(-0.14, 0.0, y));
          }
          vec3 sun = normalize(uSunDir);
          float above = smoothstep(-0.03, 0.04, y);
          // rain between here and the far sky: a grey veil where the bow will be
          float away = acos(clamp(dot(d, -sun), -1.0, 1.0)) / radians(${BOW_REACH.toFixed(1)});
          float shower = uBowGain * above * (1.0 - smoothstep(0.75, 1.25, away));
          c = mix(c, uStorm, shower * 0.4);
          // stopped down, the way a camera is to catch a halo
          c *= uDim;
          float sd = max(dot(d, sun), 0.0);
          c += uSunCol * (pow(sd, 5.0) * 0.22 * uDim.g + pow(sd, 40.0) * 0.35 + smoothstep(0.9988, 0.9993, sd) * 0.9);
          if (uStars > 0.01){
            vec3 q = floor(d * 420.0);
            float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            c += vec3(step(0.9982, h) * uStars * (0.6 + 0.4 * sin(uTime * 2.0 + h * 60.0)) * smoothstep(0.02, 0.25, y));
          }
          // the halos: a picture of the whole sky, the zenith in its middle
          if (uHaloGain > 0.003){
            vec2 lev = vec2(dot(d.xz, uBearing), d.x * uBearing.y - d.z * uBearing.x);
            float fl = length(lev);
            float down = acos(clamp(y, -1.0, 1.0)) / radians(${SKY_REACH.toFixed(1)});
            vec3 h = texture2D(uHalo, 0.5 + 0.5 * down * (fl > 1e-5 ? lev / fl : vec2(0.0))).rgb;
            c += h * h * mix(vec3(1.0), uSunCol, 0.35) * uHaloGain * above;
          }
          // the rainbow: brightness by angle from the point opposite the sun
          if (uBowGain > 0.003 && away < 1.0){
            vec3 b = texture2D(uBow, vec2(away, 0.5)).rgb;
            c += b * b * mix(vec3(1.0), uSunCol, 0.3) * uBowGain * above * 0.85;
          }
          c += uFlash * vec3(0.22, 0.22, 0.3);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  /* ---------- puffs ---------- */
  const puffGeo = new THREE.InstancedBufferGeometry();
  {
    const pl = new THREE.PlaneGeometry(2, 2);
    puffGeo.index = pl.index;
    puffGeo.setAttribute('position', pl.getAttribute('position'));
  }
  const attr = (n) =>
    new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_PUFFS * n),
      n,
    ).setUsage(THREE.DynamicDrawUsage);
  const aPos = attr(3);
  const aRad = attr(1);
  const aData = attr(4);
  const aFx = attr(4);
  const aShape = attr(4);
  puffGeo.setAttribute('aPos', aPos);
  puffGeo.setAttribute('aRad', aRad);
  puffGeo.setAttribute('aData', aData);
  puffGeo.setAttribute('aFx', aFx);
  puffGeo.setAttribute('aShape', aShape);
  puffGeo.instanceCount = 0;
  const uSunView = { value: new THREE.Vector3() };
  const puffLit = new THREE.Color();
  const puffShadow = new THREE.Color();
  const puffFog = new THREE.Color();
  const puffStorm = new THREE.Color();
  const puffMat = puffMaterial({
    uTime,
    uSunView,
    noise,
    lit: puffLit,
    shadow: puffShadow,
    rim: S.rim,
    storm: puffStorm,
    fog: puffFog,
    accent: new THREE.Color().setRGB(0.5, 0.545, 1),
    fogNear: 55,
    fogFar: 240,
    fogMax: 0.72,
    billow: reduce ? 0 : 1,
  });
  const puffMesh = new THREE.Mesh(puffGeo, puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 5;
  scene.add(puffMesh);

  /* ---------- the turntable ---------- */
  // It comes up just ahead of wherever the camera is looking (see openTable).
  const TABLE = new THREE.Vector3(0, 2, 16);
  let tableTop = TABLE.y + 0.25;
  const tableMat = new THREE.ShaderMaterial({
    uniforms: {
      uShadowR: { value: 0.5 },
      uLit: { value: S.lit },
      uShadow: { value: S.shadow },
      uSunDir: { value: S.sunDir },
    },
    vertexShader: `varying vec3 vP; varying vec3 vNw; varying vec3 vW;
      void main(){ vP = position; vNw = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uShadowR; uniform vec3 uLit, uShadow, uSunDir;
      varying vec3 vP; varying vec3 vNw; varying vec3 vW;
      vec3 holo(float t){
        t = fract(t) * 6.0;
        vec3 c0 = vec3(.557,.608,1.0), c1 = vec3(.525,.875,.769), c2 = vec3(1.0,.851,.471), c3 = vec3(1.0,.706,.584), c4 = vec3(.961,.702,.839), c5 = vec3(.765,.722,1.0);
        if (t < 1.0) return mix(c0, c1, t); if (t < 2.0) return mix(c1, c2, t - 1.0); if (t < 3.0) return mix(c2, c3, t - 2.0);
        if (t < 4.0) return mix(c3, c4, t - 3.0); if (t < 5.0) return mix(c4, c5, t - 4.0); return mix(c5, c0, t - 5.0);
      }
      void main(){
        vec3 V = normalize(cameraPosition - vW), Nw = normalize(vNw);
        float r = length(vP.xz), ang = atan(vP.z, vP.x);
        vec3 col;
        if (Nw.y > 0.5){
          vec3 base = mix(vec3(.965,.965,.99), uLit, .25);
          float band = smoothstep(.16, .24, r) * (1.0 - smoothstep(.95, .99, r));
          float sweep = .5 + .5 * sin(ang * 2.0 + V.x * 2.5 + V.z * 1.5);
          col = mix(base, holo(ang / 6.2831 * 2.0 + r * .8 + V.x * .35), band * (.16 + .34 * sweep * sweep));
          col *= .985 + .015 * (.5 + .5 * sin(r * 260.0));
          col = mix(col, uShadow, (1.0 - smoothstep(0.0, .012, abs(r - .6))) * .16);
          col = mix(col, mix(uShadow, vec3(1.0), .55), smoothstep(.11, .10, r) * .7);
          col = mix(col, col * mix(uShadow, vec3(1.0), .35), (1.0 - smoothstep(uShadowR * .3, uShadowR, r)) * .55);
          col = mix(col, vec3(1.0), smoothstep(.97, 1.0, r) * .6);
        } else {
          float f = pow(1.0 - abs(dot(V, Nw)), 2.0);
          col = mix(mix(uShadow, vec3(1.0), .6), holo(ang / 6.2831 * 3.0 + vP.y), .25 + .25 * f);
          col = mix(col, vec3(1.0), f * .4) * (.9 + .2 * (vP.y + .25));
        }
        col *= .93 + .09 * clamp(dot(Nw, normalize(uSunDir)), 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const tableMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.5, 160, 1),
    tableMat,
  );
  tableMesh.position.copy(TABLE);
  tableMesh.scale.setScalar(0.001);
  tableMesh.visible = false;
  scene.add(tableMesh);
  let tableShow = 0;
  let tableR = 8;

  /* ---------- rain and lightning ---------- */
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MAX_DROPS * 6), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  rainGeo.setDrawRange(0, 0);
  const rainMat = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 3;
  scene.add(rain);
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(BOLT_N * 2 * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  {
    const idx = [];
    for (let i = 0; i < BOLT_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    boltGeo.setIndex(idx);
  }
  const boltMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  boltMat.color.setRGB(1, 0.99, 0.965);
  const bolt = new THREE.Mesh(boltGeo, boltMat);
  bolt.frustumCulled = false;
  bolt.renderOrder = 6;
  scene.add(bolt);
  const boltPts = Array.from({ length: BOLT_N }, () => new THREE.Vector3());
  let boltLife = 0;
  let boltW = 0.16;

  /* ---------- clouds ---------- */
  const clouds = [];
  const typeCount = Object.fromEntries(TYPE_KEYS.map((k) => [k, 0]));
  // 'sky' looks round and picks clouds up; 'table' has one on the turntable
  let mode = 'sky';
  let selected = null;
  let hovered = null;
  let tableCloud = null;
  let tool = 'turn';
  let drag = null;
  let nextId = 1;

  // A puff as drawn (x … st), and where it's gliding to (tx … tst).
  const puffFrom = (g, kind) => {
    const ax = g.ax ?? 0;
    const ay = g.ay ?? 1;
    const az = g.az ?? 0;
    const st = g.st ?? 1;
    return {
      kind,
      x: g.x,
      y: g.y,
      z: g.z,
      r: g.r,
      sh: g.sh,
      hl: g.hl,
      ax,
      ay,
      az,
      st,
      seed: Math.random(),
      tx: g.x,
      ty: g.y,
      tz: g.z,
      tr: g.r,
      tsh: g.sh,
      tax: ax,
      tay: ay,
      taz: az,
      tst: st,
    };
  };
  function makeCloud(type, o) {
    const T = TYPES[type];
    let name = o.name;
    if (name) {
      const n = +(name.match(/(\d+)$/) || [])[1] || 0;
      typeCount[type] = Math.max(typeCount[type], n);
    } else name = `${T.name} no. ${++typeCount[type]}`;
    const c = {
      id: nextId++,
      type,
      seed: o.seed ?? (Math.random() * 1e9) | 0,
      name,
      P: {
        size: o.size ?? 1,
        height: o.height ?? 1,
        fluff: o.fluff ?? 0.5,
        count: o.count ?? 1,
        mood: o.mood ?? T.mood,
        rain: o.rain ?? T.rain,
        thunder: o.thunder ?? T.thunder,
      },
      pos: o.pos.clone(),
      home: null,
      rotY: o.rotY ?? Math.random() * TAU,
      puffs: [],
      holes: o.holes ? o.holes.map((h) => ({ ...h })) : [],
      top: 1,
      under: 0,
      ext: 6,
      fade: o.instant ? 1 : 0,
      fadeTo: 1,
      form: o.instant ? 0 : 1,
      sel: 0,
      flash: 0,
      reflash: 0,
      nextBolt: 2 + Math.random() * 5,
      drops: [],
      alpha: T.alpha,
      ero: T.ero,
      bob: Math.random() * TAU,
      bobY: 0,
      popping: false,
      dead: false,
      onTable: false,
      returning: false,
    };
    rebuild(c);
    if (o.extras) for (const p of o.extras) c.puffs.push({ ...p, r: 0 });
    if (o.instant) for (const p of c.puffs) p.r = p.tr;
    // a new one forms: its puffs start gathered round the core and billow out
    else
      for (const p of c.puffs) {
        p.x *= 0.3;
        p.y *= 0.3;
        p.z *= 0.3;
      }
    measure(c);
    clouds.push(c);
    return c;
  }
  // Regenerate a cloud's puffs and let the ones it has glide to their new
  // spots and shapes (that glide is the morph).
  function rebuild(c) {
    const gen = GEN[c.type](c.seed, c.P).sort((a, b) => a.y - b.y);
    const gens = c.puffs.filter((p) => p.kind === 'gen');
    const extras = c.puffs.filter((p) => p.kind === 'x');
    const next = [];
    for (let i = 0; i < gen.length; i++) {
      const g = gen[i];
      const hole = c.holes.some(
        (h) =>
          (g.x - h.x) ** 2 + (g.y - h.y) ** 2 + (g.z - h.z) ** 2 < h.r * h.r,
      );
      const p = gens[i] || { ...puffFrom(g, 'gen'), r: 0 };
      p.tx = g.x;
      p.ty = g.y;
      p.tz = g.z;
      p.tr = hole ? 0 : g.r;
      p.tsh = g.sh;
      p.hl = g.hl;
      p.dying = false;
      p.tax = g.ax ?? 0;
      p.tay = g.ay ?? 1;
      p.taz = g.az ?? 0;
      p.tst = g.st ?? 1;
      next.push(p);
    }
    for (let i = gen.length; i < gens.length; i++) {
      const p = gens[i];
      p.tr = 0;
      p.dying = true;
      next.push(p);
    }
    c.puffs = next.concat(extras);
    measure(c);
  }
  // how far a puff reaches along one of the cloud's own axes, stretch and all
  const reach = (p, a) =>
    p.tr *
    Math.sqrt(
      Math.max(
        0.01,
        1 +
          ((p.tst * p.tst - 1) * a * a) /
            (p.tax * p.tax + p.tay * p.tay + p.taz * p.taz || 1),
      ),
    );
  function measure(c) {
    let top = 0.5;
    let under = 0;
    let ext = 1;
    for (const p of c.puffs) {
      if (p.tr <= 0) continue;
      const hy = reach(p, p.tay);
      top = Math.max(top, p.ty + hy * 0.5);
      under = Math.max(under, hy * 0.9 - p.ty);
      ext = Math.max(
        ext,
        Math.abs(p.tx) + reach(p, p.tax),
        Math.abs(p.tz) + reach(p, p.taz),
      );
    }
    c.top = top;
    c.under = under;
    c.ext = ext;
  }
  const livePuffs = (c) => c.puffs.reduce((n, p) => n + (p.tr > 0 ? 1 : 0), 0);
  function setType(c, type) {
    if (c.type === type) return;
    const T = TYPES[type];
    c.type = type;
    c.holes = [];
    for (const p of c.puffs)
      if (p.kind === 'x') {
        p.tr = 0;
        p.dying = true;
      }
    c.P.mood = T.mood;
    c.P.rain = T.rain;
    c.P.thunder = T.thunder;
    c.name = `${T.name} no. ${++typeCount[type]}`;
    rebuild(c);
  }
  function pop(c) {
    c.popping = true;
    c.fadeTo = 0;
    for (const p of c.puffs) {
      p.tx = p.x * 1.7 + (Math.random() - 0.5) * 3;
      p.ty = p.y * 1.4 + Math.random() * 2.5;
      p.tz = p.z * 1.7 + (Math.random() - 0.5) * 3;
      p.tr = 0;
    }
    if (selected === c) select(null);
  }
  function worldToLocal(c, w) {
    const s = c.P.size;
    const cs = Math.cos(c.rotY);
    const sn = Math.sin(c.rotY);
    const dx = w.x - c.pos.x;
    const dy = w.y - c.pos.y - c.bobY;
    const dz = w.z - c.pos.z;
    return {
      x: (dx * cs - dz * sn) / s,
      y: dy / s,
      z: (dx * sn + dz * cs) / s,
    };
  }
  function strike(c) {
    c.flash = 1;
    c.reflash = 0.1;
    const s = c.P.size;
    const cs = Math.cos(c.rotY);
    const sn = Math.sin(c.rotY);
    const lx = (Math.random() - 0.5) * 6;
    const lz = (Math.random() - 0.5) * 3;
    const sx = c.pos.x + (lx * cs + lz * sn) * s;
    const sz = c.pos.z + (-lx * sn + lz * cs) * s;
    const sy = c.pos.y + c.bobY + 0.8 * s;
    const ey = c.onTable ? tableTop + 0.02 : sy - 20;
    let jx = 0;
    let jz = 0;
    for (let i = 0; i < BOLT_N; i++) {
      if (i > 0 && i < BOLT_N - 1) {
        jx += (Math.random() - 0.5) * 1.4 * s;
        jz += (Math.random() - 0.5) * 1.4 * s;
        jx *= 0.8;
        jz *= 0.8;
      }
      boltPts[i].set(sx + jx, lerp(sy, ey, i / (BOLT_N - 1)), sz + jz);
    }
    boltLife = 0.24;
    boltW = 0.1 + 0.08 * s;
    uFlash.value = Math.max(
      uFlash.value,
      c.onTable || camera.position.distanceTo(c.pos) < 90 ? 0.5 : 0.2,
    );
  }

  /* ---------- the far sky ---------- */
  // Clouds out past the ones you can reach, so the horizon isn't bare. Only
  // the wind moves them, slowly; they haze over with distance, and are never
  // picked, saved or counted. The same ones every visit.
  const far = [];
  {
    const R = mulberry(52201);
    const add = (type, d, a, y, size, count) => {
      const T = TYPES[type];
      const P = {
        size,
        height: 0.8 + R() * 0.5,
        fluff: 0.55 + R() * 0.3,
        count,
        mood: T.mood * 0.6,
      };
      const grow = 1 / Math.sqrt(count);
      const f = {
        type,
        P,
        rotY: R() * TAU,
        rel: new THREE.Vector3(Math.cos(a) * d, y, Math.sin(a) * d),
        alpha: T.alpha * 0.95,
        ero: T.ero * (0.55 + P.fluff * 0.9),
      };
      f.puffs = GEN[type]((R() * 1e9) | 0, P).map((g) =>
        puffFrom({ ...g, r: g.r * grow }, 'far'),
      );
      measure(f);
      far.push(f);
    };
    for (let i = 0; i < 30; i++) {
      const q = R();
      const type =
        q < 0.48
          ? 'cumulus'
          : q < 0.7
            ? 'stratus'
            : q < 0.86
              ? 'cirrus'
              : q < 0.94
                ? 'nimbus'
                : 'lenticular';
      const [lo, hi] = TYPES[type].alt;
      add(
        type,
        400 + R() * 650,
        R() * TAU,
        (lo + R() * (hi - lo)) * (type === 'cirrus' ? 2.2 : 1.4),
        (type === 'stratus' ? 5 : 3.5) + R() * 3,
        0.3,
      );
    }
    // a low bank right along the horizon, all the way round
    for (let i = 0; i < 24; i++) {
      add(
        R() < 0.5 ? 'stratus' : 'cumulus',
        1150 + R() * 300,
        ((i + R() * 0.8) / 24) * TAU,
        -3 + R() * 8,
        8 + R() * 5,
        0.22,
      );
    }
  }

  /* ---------- per frame: move every puff, stage it, sort back to front ---------- */
  // The staging arrays stay unsorted, so picking can map a hit back to its
  // cloud and puff.
  const stPos = new Float32Array(MAX_PUFFS * 3);
  const stRad = new Float32Array(MAX_PUFFS);
  const stData = new Float32Array(MAX_PUFFS * 4);
  const stFx = new Float32Array(MAX_PUFFS * 4);
  const stAx = new Float32Array(MAX_PUFFS * 4);
  const depth = new Float32Array(MAX_PUFFS);
  const order = new Uint32Array(MAX_PUFFS);
  const pkCloud = new Array(MAX_PUFFS);
  const pkPuff = new Array(MAX_PUFFS);
  let nStage = 0;
  const fwd = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tableLift = (c) => (c.P.rain ? 2.6 : 0.5) * c.P.size;
  const wind = () => (reduce ? 0 : knots * 0.12);
  const picking = () => bench === 'clouds' && mode === 'sky';

  // Stage a cloud's puffs with its base at (bx, by, bz). owner is what a
  // pick on them finds (none for the far sky).
  function stage(c, bx, by, bz, ca, ero, sel, flash, isFar, owner, n) {
    const s = c.P.size;
    const cs = Math.cos(c.rotY);
    const sn = Math.sin(c.rotY);
    const my = by + c.top * s * 0.45;
    const sun = S.sunDir;
    const cam = camera.position;
    for (const p of c.puffs) {
      if (p.r < 0.004 || n >= MAX_PUFFS) continue;
      const lx = p.x * s;
      const ly = p.y * s;
      const lz = p.z * s;
      const wx = bx + lx * cs + lz * sn;
      const wy = by + ly;
      const wz = bz - lx * sn + lz * cs;
      const ox = wx - bx;
      const oy = wy - my;
      const oz = wz - bz;
      const ol = Math.hypot(ox, oy, oz) || 1;
      const side = (ox * sun.x + oy * sun.y + oz * sun.z) / ol;
      const h = p.hl ?? clamp(p.y / c.top, 0, 1);
      const al = Math.hypot(p.ax, p.ay, p.az) || 1;
      const i4 = n * 4;
      stPos[n * 3] = wx;
      stPos[n * 3 + 1] = wy;
      stPos[n * 3 + 2] = wz;
      stRad[n] = p.r * s;
      stData[i4] = 0.1 + 0.5 * h + 0.45 * (0.5 + 0.5 * side);
      stData[i4 + 1] = clamp(p.sh + c.P.mood * 0.55 * (1 - h * 0.55), 0, 0.92);
      stData[i4 + 2] = ca;
      stData[i4 + 3] = p.seed;
      stFx[i4] = sel;
      stFx[i4 + 1] = flash;
      stFx[i4 + 2] = ero;
      stFx[i4 + 3] = isFar;
      stAx[i4] = (p.ax * cs + p.az * sn) / al;
      stAx[i4 + 1] = p.ay / al;
      stAx[i4 + 2] = (p.az * cs - p.ax * sn) / al;
      stAx[i4 + 3] = p.st;
      depth[n] =
        (wx - cam.x) * fwd.x + (wy - cam.y) * fwd.y + (wz - cam.z) * fwd.z;
      pkCloud[n] = owner;
      pkPuff[n] = p;
      n++;
    }
    return n;
  }

  function updateClouds(dt) {
    const kPos = 1 - Math.exp(-dt * 5);
    const kForm = 1 - Math.exp(-dt * 1.6);
    const kFade = 1 - Math.exp(-dt * 2.5);
    const kSel = 1 - Math.exp(-dt * 8);
    const cam = camera.position;
    camera.getWorldDirection(fwd);
    let n = 0;
    for (const c of clouds) {
      const T = TYPES[c.type];
      c.fade += (c.fadeTo - c.fade) * kFade;
      if (c.fadeTo === 0 && c.fade < 0.01) {
        c.dead = true;
        continue;
      }
      const lit = picking()
        ? c === selected
          ? 1
          : c === hovered
            ? 0.45
            : 0
        : 0;
      c.sel += (lit - c.sel) * kSel;
      c.alpha += (T.alpha - c.alpha) * kPos;
      c.ero += (T.ero - c.ero) * kPos;
      const s = c.P.size;
      if (c.onTable) {
        tmpV.set(TABLE.x, tableTop + c.under * s + tableLift(c), TABLE.z);
        c.pos.lerp(tmpV, 1 - Math.exp(-dt * 3.2));
      } else if (c.returning) {
        c.pos.lerp(c.home, 1 - Math.exp(-dt * 2.4));
        if (c.pos.distanceTo(c.home) < 0.1) c.returning = false;
      } else if (!(drag && drag.cloud === c && drag.moved)) {
        c.pos.x += wind() * T.drift * dt;
        // round the seam to the other side
        const rel = c.pos.x - cam.x;
        if (Math.abs(rel) > WRAP)
          c.pos.x -= Math.round(rel / (WRAP * 2)) * WRAP * 2;
      }
      c.bob += dt * 0.25;
      c.bobY = c.onTable || reduce ? 0 : Math.sin(c.bob) * 0.25;
      if (c.P.thunder && !c.popping && !reduce) {
        c.nextBolt -= dt;
        if (c.nextBolt < 0) {
          strike(c);
          c.nextBolt = 2.5 + Math.random() * 6;
        }
      }
      if (c.reflash > 0) {
        c.reflash -= dt;
        if (c.reflash <= 0) c.flash = 0.75;
      }
      c.flash *= Math.exp(-dt * 9);

      // fade at the seam, near the camera, and around the table while it's out
      let ca = c.fade * c.alpha;
      if (!c.onTable) {
        ca *= 1 - smooth(WRAP - 25, WRAP, Math.abs(c.pos.x - cam.x));
        ca *= smooth(4 * s + 3, 10 * s + 8, cam.distanceTo(c.pos));
        if (mode === 'table')
          ca *= 0.85 * smooth(12, 26, c.pos.distanceTo(TABLE));
      }
      // a forming cloud's puffs glide out slowly; after that they keep up with the sliders
      const k = c.form > 0 ? kForm : kPos;
      c.form = Math.max(0, c.form - dt / 2.5);
      let gone = 0;
      for (const p of c.puffs) {
        p.x += (p.tx - p.x) * k;
        p.y += (p.ty - p.y) * k;
        p.z += (p.tz - p.z) * k;
        p.r += (p.tr - p.r) * k;
        p.sh += (p.tsh - p.sh) * k;
        // an axis turned end for end is the same shape, so it turns the short way round
        if (p.ax * p.tax + p.ay * p.tay + p.az * p.taz < 0) {
          p.tax = -p.tax;
          p.tay = -p.tay;
          p.taz = -p.taz;
        }
        p.ax += (p.tax - p.ax) * k;
        p.ay += (p.tay - p.ay) * k;
        p.az += (p.taz - p.az) * k;
        p.st += (p.tst - p.st) * k;
        if (p.dying && p.r < 0.01) {
          p.gone = true;
          gone++;
        }
      }
      if (gone) c.puffs = c.puffs.filter((p) => !p.gone);
      if (ca >= 0.003) {
        n = stage(
          c,
          c.pos.x,
          c.pos.y + c.bobY,
          c.pos.z,
          ca,
          c.ero * (0.55 + c.P.fluff * 0.9),
          c.sel,
          c.flash,
          0,
          c,
          n,
        );
      }
    }
    let died = false;
    for (let i = clouds.length - 1; i >= 0; i--) {
      if (!clouds[i].dead) continue;
      if (clouds[i] === selected) select(null);
      clouds.splice(i, 1);
      died = true;
    }
    if (died) changed();
    const wf = wind() * dt * 0.35;
    for (const f of far) {
      f.rel.x += wf * TYPES[f.type].drift;
      if (Math.abs(f.rel.x) > FAR_WRAP)
        f.rel.x -= Math.sign(f.rel.x) * FAR_WRAP * 2;
      const ca =
        f.alpha *
        (1 - smooth(FAR_WRAP - 250, FAR_WRAP, Math.abs(f.rel.x))) *
        smooth(330, 420, Math.hypot(f.rel.x, f.rel.z));
      if (ca >= 0.003)
        n = stage(
          f,
          cam.x + f.rel.x,
          f.rel.y,
          cam.z + f.rel.z,
          ca,
          f.ero,
          0,
          0,
          1,
          null,
          n,
        );
    }
    nStage = n;
    for (let i = 0; i < n; i++) order[i] = i;
    order.subarray(0, n).sort((a, b) => depth[b] - depth[a]);
    const P = aPos.array;
    const Rr = aRad.array;
    const D = aData.array;
    const F = aFx.array;
    const A = aShape.array;
    for (let i = 0; i < n; i++) {
      const j = order[i];
      P[i * 3] = stPos[j * 3];
      P[i * 3 + 1] = stPos[j * 3 + 1];
      P[i * 3 + 2] = stPos[j * 3 + 2];
      Rr[i] = stRad[j];
      for (let k = 0; k < 4; k++) {
        D[i * 4 + k] = stData[j * 4 + k];
        F[i * 4 + k] = stFx[j * 4 + k];
        A[i * 4 + k] = stAx[j * 4 + k];
      }
    }
    puffGeo.instanceCount = n;
    aPos.needsUpdate =
      aRad.needsUpdate =
      aData.needsUpdate =
      aFx.needsUpdate =
      aShape.needsUpdate =
        true;
  }

  function updateRain(dt) {
    const arr = rainGeo.attributes.position.array;
    let m = 0;
    for (const c of clouds) {
      if (!c.P.rain || c.fade < 0.2 || c.popping) {
        c.drops.length = 0;
        continue;
      }
      const s = c.P.size;
      const want = Math.min(260, Math.round(80 * s * (0.6 + c.P.mood)));
      const W =
        (c.type === 'nimbus' ? 5.5 : c.type === 'stratus' ? 9 : 4.5) * s;
      const Dp = 2.6 * s;
      const fall = c.onTable ? Math.max(0.5, c.pos.y - tableTop) : 18;
      while (c.drops.length < want) {
        c.drops.push({
          x: (Math.random() - 0.5) * 2 * W,
          z: (Math.random() - 0.5) * 2 * Dp,
          y: -Math.random() * fall,
          v: 10 + Math.random() * 5,
        });
      }
      if (c.drops.length > want) c.drops.length = want;
      const cs = Math.cos(c.rotY);
      const sn = Math.sin(c.rotY);
      const by = c.pos.y + c.bobY + 0.5 * s;
      for (const d of c.drops) {
        d.y -= d.v * dt;
        if (d.y < -fall) {
          d.y += fall;
          d.x = (Math.random() - 0.5) * 2 * W;
          d.z = (Math.random() - 0.5) * 2 * Dp;
        }
        if (m >= MAX_DROPS) break;
        const wx = c.pos.x + d.x * cs + d.z * sn;
        const wz = c.pos.z - d.x * sn + d.z * cs;
        const y = by + d.y;
        const o = m * 6;
        arr[o] = wx;
        arr[o + 1] = y;
        arr[o + 2] = wz;
        arr[o + 3] = wx - wind() * 0.04;
        arr[o + 4] = Math.min(by, y + 0.75);
        arr[o + 5] = wz;
        m++;
      }
    }
    rainGeo.setDrawRange(0, m * 2);
    rainGeo.attributes.position.needsUpdate = true;
    rainMat.color.copy(S.rain);
    rainMat.opacity = night || sunAltitude < 3 ? 0.62 : 0.5;
  }

  const boltSide = new THREE.Vector3();
  const boltDir = new THREE.Vector3();
  const boltView = new THREE.Vector3();
  function updateBolt(dt) {
    if (boltLife <= 0) {
      boltMat.opacity = 0;
      return;
    }
    boltLife -= dt;
    const arr = boltGeo.attributes.position.array;
    for (let i = 0; i < BOLT_N; i++) {
      const a = boltPts[Math.max(0, i - 1)];
      const b = boltPts[Math.min(BOLT_N - 1, i + 1)];
      const p = boltPts[i];
      boltDir.subVectors(b, a).normalize();
      boltView.subVectors(camera.position, p).normalize();
      boltSide
        .crossVectors(boltDir, boltView)
        .normalize()
        .multiplyScalar(boltW * (1 - (i / BOLT_N) * 0.5));
      arr.set(
        [
          p.x - boltSide.x,
          p.y - boltSide.y,
          p.z - boltSide.z,
          p.x + boltSide.x,
          p.y + boltSide.y,
          p.z + boltSide.z,
        ],
        i * 6,
      );
    }
    boltGeo.attributes.position.needsUpdate = true;
    boltMat.opacity =
      clamp(boltLife / 0.24, 0, 1) *
      (boltLife > 0.14 || boltLife < 0.06 ? 1 : 0.35);
  }

  /* ---------- picking: a ray against every puff drawn last frame ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function rayFrom(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }
  function pick(e, only) {
    const ray = rayFrom(e);
    const o = ray.origin;
    const d = ray.direction;
    let best = -1;
    let bestT = Infinity;
    for (let i = 0; i < nStage; i++) {
      const c = pkCloud[i];
      if (!c || (only ? c !== only : c.popping || c.fade < 0.3 || c.onTable))
        continue;
      // into the puff's own space, where it's a unit sphere: moved to its
      // centre, scaled by its radius, and its axis squashed (or drawn out) by
      // its stretch; t stays in world units
      const r = stRad[i] * 0.85;
      const i4 = i * 4;
      const ax = stAx[i4];
      const ay = stAx[i4 + 1];
      const az = stAx[i4 + 2];
      const k = 1 / stAx[i4 + 3] - 1;
      let ox = (o.x - stPos[i * 3]) / r;
      let oy = (o.y - stPos[i * 3 + 1]) / r;
      let oz = (o.z - stPos[i * 3 + 2]) / r;
      let dx = d.x / r;
      let dy = d.y / r;
      let dz = d.z / r;
      const oa = (ox * ax + oy * ay + oz * az) * k;
      const da = (dx * ax + dy * ay + dz * az) * k;
      ox += oa * ax;
      oy += oa * ay;
      oz += oa * az;
      dx += da * ax;
      dy += da * ay;
      dz += da * az;
      const A = dx * dx + dy * dy + dz * dz;
      const B = ox * dx + oy * dy + oz * dz;
      const disc = B * B - A * (ox * ox + oy * oy + oz * oz - 1);
      if (disc < 0) continue;
      const q = Math.sqrt(disc);
      if (-B + q < 0) continue;
      const th = (-B - q) / A;
      if (th < bestT) {
        bestT = th;
        best = i;
      }
    }
    if (best < 0) return null;
    return {
      cloud: pkCloud[best],
      puff: pkPuff[best],
      point: ray.at(Math.max(0, bestT), new THREE.Vector3()),
      center: new THREE.Vector3(
        stPos[best * 3],
        stPos[best * 3 + 1],
        stPos[best * 3 + 2],
      ),
      rad: stRad[best],
    };
  }

  /* ---------- camera ---------- */
  // Standing still, the view is a compass bearing, a tilt and a field of
  // view, each eased toward where it has been asked to go.
  const look = {
    yaw: HOME_YAW,
    pitch: HOME_PITCH,
    fov: FOV.clouds,
    dy: 0,
    dp: 0,
    vy: 0,
    vp: 0,
    down: false,
  };
  let lookGoal = null;
  const zoom = { clouds: FOV.clouds, light: FOV.light };
  let tween = null;
  let camGoal = null;
  let userBusy = false;
  let lastTouch = -10;
  let clockT = 0;
  let vw = 1;
  let vh = 1;
  const keys = new Set();
  const held = (k) => (keys.has(k) ? 1 : 0);

  const lookDir = (out) => {
    const cp = Math.cos(look.pitch);
    return out.set(
      Math.sin(look.yaw) * cp,
      Math.sin(look.pitch),
      Math.cos(look.yaw) * cp,
    );
  };
  function lookCam(dt) {
    let dy = look.dy;
    let dp = look.dp;
    look.dy = look.dp = 0;
    if (look.down) {
      if (dt > 1e-3) {
        const kv = 1 - Math.exp(-dt * 20);
        look.vy = lerp(look.vy, dy / dt, kv);
        look.vp = lerp(look.vp, dp / dt, kv);
      }
    } else if (!reduce) {
      // a drag coasts a little once it's let go
      dy += look.vy * dt;
      dp += look.vp * dt;
      const kd = Math.exp(-dt * 5);
      look.vy *= kd;
      look.vp *= kd;
    }
    const turn = held('left') - held('right');
    const tilt = held('up') - held('down');
    if (turn || tilt || dy || dp) lookGoal = null;
    if (lookGoal) {
      const k = reduce ? 1 : 1 - Math.exp(-dt * 3.5);
      // the short way round
      let by = lookGoal.yaw - look.yaw;
      by -= Math.round(by / TAU) * TAU;
      look.yaw += by * k;
      look.pitch = lerp(look.pitch, lookGoal.pitch, k);
      if (Math.abs(by) < 1e-3 && Math.abs(lookGoal.pitch - look.pitch) < 1e-3)
        lookGoal = null;
    }
    look.yaw += dy + turn * 1.2 * dt;
    look.pitch = clamp(look.pitch + dp + tilt * 0.9 * dt, -0.35, 1.53);
    camera.position.copy(HOME);
    controls.target.copy(HOME).add(lookDir(tmpV).multiplyScalar(40));
    camera.lookAt(controls.target);
  }
  function tweenCam(pos, target, dur, done) {
    tween = {
      p0: camera.position.clone(),
      t0: controls.target.clone(),
      p1: pos.clone(),
      t1: target.clone(),
      t: 0,
      dur: reduce ? 0.01 : dur,
      done,
    };
    controls.enabled = false;
  }
  controls.addEventListener('start', () => {
    userBusy = true;
    camGoal = null;
    lastTouch = clockT;
  });
  controls.addEventListener('end', () => {
    userBusy = false;
    lastTouch = clockT;
  });
  function tableFocus(c) {
    const s = c.P.size;
    const lift = tableLift(c);
    const tall = lift + (c.under + c.top) * s;
    const target = new THREE.Vector3(TABLE.x, tableTop + tall * 0.45, TABLE.z);
    const hw = Math.max(c.ext * s, 6.5) + 1;
    const hv = tall * 0.55 + hw * 0.35 + 1;
    const tv = Math.tan(THREE.MathUtils.degToRad(FOV.clouds / 2));
    const th = tv * camera.aspect;
    return { target, dist: clamp(Math.max(hv / tv, hw / th), 13, 100) };
  }
  const reframe = (c) => {
    if (mode === 'table' && !tween) camGoal = tableFocus(c);
  };
  function zoomBy(factor) {
    if (mode === 'table') {
      const off = camera.position.clone().sub(controls.target);
      off.setLength(
        clamp(
          off.length() * factor,
          controls.minDistance,
          controls.maxDistance,
        ),
      );
      camera.position.copy(controls.target).add(off);
      camGoal = null;
      return;
    }
    const [lo, hi] = FOV_RANGE[bench];
    zoom[bench] = clamp(zoom[bench] * factor, lo, hi);
  }
  /** Turn to face a point `above` degrees over the sun, or away from it. */
  function face(where) {
    const yaw = Math.atan2(SUN_BEARING[0], SUN_BEARING[1]);
    const alt = sunAltitude * DEG;
    const half = (zoom.light / 2) * DEG;
    if (where === 'away')
      lookGoal = { yaw: yaw + Math.PI, pitch: clamp(half - 0.3, 0.15, 0.5) };
    else if (where === 'above')
      lookGoal = { yaw, pitch: clamp(alt + 0.55, 0.3, 1.3) };
    else if (where === 'below')
      lookGoal = { yaw, pitch: clamp(alt - 0.55, 0.2, 1.1) };
    // the sun a little under the middle, so the top of a halo fits
    else
      lookGoal = {
        yaw,
        pitch: clamp(alt + 0.12, Math.min(alt, half - 0.25), 1.45),
      };
  }

  /* ---------- picking a cloud up, and the turntable ---------- */
  function select(c) {
    if (selected === c) return;
    selected = c;
    changed();
  }
  function say(text) {
    noticeId += 1;
    notice = { id: noticeId, text };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice = null;
      changed();
    }, 3600);
    changed();
  }
  // The table comes up a little ahead of and below the camera, and the camera
  // comes round to look at it.
  function openTable(c) {
    if (mode === 'table' || !c || bench !== 'clouds') return;
    lookDir(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    TABLE.set(HOME.x + fwd.x * 18, 2, HOME.z + fwd.z * 18);
    tableTop = TABLE.y + 0.25;
    mode = 'table';
    tableCloud = c;
    c.home = c.pos.clone();
    c.onTable = true;
    c.returning = false;
    selected = c;
    tool = 'turn';
    lookGoal = null;
    const f = tableFocus(c);
    const dir = new THREE.Vector3(
      -fwd.x - fwd.z * 0.18,
      0.42,
      -fwd.z + fwd.x * 0.18,
    ).normalize();
    tweenCam(
      f.target.clone().addScaledVector(dir, f.dist),
      f.target,
      1.5,
      () => {
        controls.enabled = true;
        controls.update();
      },
    );
    changed();
  }
  // Leaving the table sends the cloud home, to a height that suits its
  // (maybe new) kind.
  function closeTable(instant) {
    if (mode !== 'table') return;
    const c = tableCloud;
    c.home.y = clamp(c.home.y, ...TYPES[c.type].alt);
    c.onTable = false;
    mode = 'sky';
    tableCloud = null;
    controls.enabled = false;
    camGoal = null;
    const back = HOME.clone().add(
      lookDir(new THREE.Vector3()).multiplyScalar(40),
    );
    if (instant) {
      c.pos.copy(c.home);
      c.returning = false;
      tableShow = 0;
      tween = null;
      camera.position.copy(HOME);
      controls.target.copy(back);
    } else {
      c.returning = true;
      tweenCam(HOME, back, 1.4);
      say(`Released at ${metres(c.home.y)}`);
    }
    changed();
    dirty();
  }

  const skyCount = () =>
    clouds.filter((c) => !c.popping && c.fadeTo > 0).length;
  function randomSpot(type) {
    const [lo, hi] = TYPES[type].alt;
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * TAU;
      const r = 28 + Math.random() * 65;
      const p = new THREE.Vector3(
        HOME.x + Math.cos(a) * r,
        lo + Math.random() * (hi - lo),
        -10 + Math.sin(a) * r,
      );
      if (p.distanceTo(HOME) > 26) return p;
    }
    return new THREE.Vector3(HOME.x, lo, -60);
  }
  const randomType = () => {
    const r = Math.random();
    return r < 0.55
      ? 'cumulus'
      : r < 0.7
        ? 'stratus'
        : r < 0.85
          ? 'cirrus'
          : r < 0.93
            ? 'lenticular'
            : 'nimbus';
  };

  function brushAt(hit) {
    const c = tableCloud;
    const s = c.P.size;
    if (tool === 'puff') {
      if (c.puffs.length > 1600) {
        say('This cloud is as full as it gets');
        return;
      }
      const nrm = hit.point.clone().sub(hit.center).normalize();
      const p0 = hit.puff;
      const rNew = clamp(
        (p0.tr || p0.r || 0.8) * (0.55 + Math.random() * 0.5),
        0.35,
        2.2,
      );
      const L = worldToLocal(
        c,
        hit.point.clone().addScaledVector(nrm, rNew * s * 0.35),
      );
      // shaped like the puff it grew from, so brushing on a streak draws out more streak
      c.puffs.push({
        ...puffFrom(
          {
            x: L.x,
            y: L.y,
            z: L.z,
            r: rNew,
            sh: p0.tsh ?? p0.sh,
            ax: p0.tax,
            ay: p0.tay,
            az: p0.taz,
            st: p0.tst,
          },
          'x',
        ),
        r: 0,
      });
    } else {
      const L = worldToLocal(c, hit.center);
      const rad = (hit.rad / s) * 1.1 + 0.35;
      c.holes.push({ x: L.x, y: L.y, z: L.z, r: rad });
      for (const p of c.puffs) {
        if (
          (p.tx - L.x) ** 2 + (p.ty - L.y) ** 2 + (p.tz - L.z) ** 2 <
          rad * rad
        ) {
          p.tr = 0;
          if (p.kind === 'x') p.dying = true;
        }
      }
    }
    measure(c);
    changed();
    dirty();
  }

  /* ---------- pointer ---------- */
  // Looking round, a drag that starts on a cloud moves it and one on the sky
  // turns the view; a second finger pinches to zoom. On the table every drag
  // turns it (the orbit controls do that) unless a brush is in hand.
  let lastTap = { c: null, t: 0 };
  let brushT = 0;
  let hoverT = 0;
  let pinch = 0;
  const dragPlane = new THREE.Plane();
  const planeHit = new THREE.Vector3();
  const fingers = new Map();
  const spread = () => {
    const [a, b] = [...fingers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  function onDown(e) {
    if (tween) return;
    if (!e.isPrimary) {
      if (fingers.size === 1 && mode === 'sky') {
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        canvas.setPointerCapture(e.pointerId);
        pinch = spread();
        if (drag) drag.moved = true;
      }
      return;
    }
    if (mode === 'sky') {
      const hit = picking() ? pick(e) : null;
      if (hit) {
        camera.getWorldDirection(fwd);
        dragPlane.setFromNormalAndCoplanarPoint(fwd, hit.cloud.pos);
        rayFrom(e).intersectPlane(dragPlane, planeHit);
        drag = {
          id: e.pointerId,
          cloud: hit.cloud,
          sx: e.clientX,
          sy: e.clientY,
          moved: false,
          off: hit.cloud.pos.clone().sub(planeHit),
        };
      } else {
        drag = {
          id: e.pointerId,
          cloud: null,
          sx: e.clientX,
          sy: e.clientY,
          moved: false,
        };
        fingers.clear();
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        look.down = true;
        look.vy = look.vp = 0;
      }
      canvas.setPointerCapture(e.pointerId);
    } else if (tool !== 'turn') {
      const hit = pick(e, tableCloud);
      if (hit) {
        controls.enabled = false;
        drag = { id: e.pointerId, brush: true };
        canvas.setPointerCapture(e.pointerId);
        brushAt(hit);
        brushT = lastTouch = clockT;
      }
    }
  }
  function onMove(e) {
    const f = fingers.get(e.pointerId);
    if (f) {
      const dx = e.clientX - f.x;
      const dy = e.clientY - f.y;
      f.x = e.clientX;
      f.y = e.clientY;
      if (fingers.size === 1) {
        // the sky moves with the finger
        const k = (look.fov * DEG) / vh;
        look.dy += dx * k;
        look.dp += dy * k;
      } else {
        const s = spread();
        if (pinch > 0 && s > 0) zoomBy(pinch / s);
        pinch = s;
      }
    }
    if (drag && drag.id !== e.pointerId) return;
    if (drag && drag.brush) {
      if (clockT - brushT > (tool === 'puff' ? 0.035 : 0.06)) {
        const hit = pick(e, tableCloud);
        if (hit) brushAt(hit);
        brushT = lastTouch = clockT;
      }
      return;
    }
    if (drag) {
      if (
        !drag.moved &&
        Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6
      )
        drag.moved = true;
      if (drag.cloud && drag.moved) {
        if (rayFrom(e).intersectPlane(dragPlane, planeHit)) {
          const p = planeHit.add(drag.off);
          p.y = clamp(p.y, 1.5, 42);
          drag.cloud.pos.copy(p);
        }
        select(drag.cloud);
        canvas.style.cursor = 'grabbing';
      }
      return;
    }
    if (e.pointerType === 'mouse' && !tween && clockT - hoverT > 0.05) {
      hoverT = clockT;
      if (mode === 'sky') {
        const hit = picking() ? pick(e) : null;
        hovered = hit ? hit.cloud : null;
        canvas.style.cursor = hit ? 'grab' : '';
      } else {
        const hit = tool !== 'turn' && pick(e, tableCloud);
        canvas.style.cursor = hit ? (tool === 'puff' ? 'copy' : 'pointer') : '';
      }
    }
  }
  function onUp(e) {
    if (fingers.delete(e.pointerId) && !fingers.size) look.down = false;
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.brush) {
      const c = drag.cloud;
      if (c && !drag.moved) {
        if (lastTap.c === c && clockT - lastTap.t < 0.4) {
          openTable(c);
          lastTap.c = null;
        } else {
          select(c);
          lastTap = { c, t: clockT };
        }
      } else if (!c && !drag.moved && picking()) select(null);
      if (c && drag.moved) {
        changed();
        dirty();
      }
    }
    drag = null;
    if (mode === 'table' && !tween) controls.enabled = true;
    canvas.style.cursor = '';
  }
  const onLeave = () => {
    if (!drag) hovered = null;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);

  // The keyboard, while the sky has the focus: arrows look round, plus and
  // minus zoom, Escape puts down what's in hand.
  const KEYS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  };
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (mode === 'table') closeTable();
      else if (selected) select(null);
      else return;
      e.stopPropagation();
      return;
    }
    if (e.key === '+' || e.key === '=' || e.key === '-') {
      zoomBy(e.key === '-' ? 1.15 : 1 / 1.15);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const k = KEYS[e.key];
    if (!k || mode !== 'sky') return;
    keys.add(k);
    e.preventDefault();
    e.stopPropagation();
  }
  const onKeyUp = (e) => {
    const k = KEYS[e.key];
    if (k) keys.delete(k);
  };
  const onBlur = () => keys.clear();
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', onBlur);

  /* ---------- the light: ice in the air, rain opposite the sun ---------- */
  const mapSize = coarse ? 768 : 1024;
  const budget = coarse ? 5e6 : 16e6;
  let traceId = 0;
  let traceTimer = 0;
  const shares = () =>
    CRYSTAL_KEYS.filter((k) => air[k].amount > 0.004).map((k) => ({
      kind: k,
      ratio: air[k].ratio,
      wobble: air[k].wobble,
      share: air[k].amount,
    }));
  // More ice in the air scatters more light, up to a point; the slider is
  // two stops either side of the middle.
  const gain = () => {
    let total = 0;
    for (const k of CRYSTAL_KEYS) total += air[k].amount;
    return 0.05 * Math.pow(2, (exposure - 0.5) * 4) * Math.min(total, 1.6);
  };
  const darkroom = createExposure((msg) => {
    if (msg.id !== traceId) return;
    if (haloTex.image.width !== msg.size) {
      haloTex.dispose();
      haloTex = new THREE.DataTexture(
        msg.image,
        msg.size,
        msg.size,
        THREE.RGBAFormat,
      );
      haloTex.magFilter = haloTex.minFilter = THREE.LinearFilter;
      dome.material.uniforms.uHalo.value = haloTex;
    } else haloTex.image.data = msg.image;
    haloTex.needsUpdate = true;
    rays = msg.rays;
    tracing = !msg.done;
    changed();
  });
  function trace() {
    clearTimeout(traceTimer);
    traceTimer = 0;
    const crystals = shares();
    traceId += 1;
    if (bench !== 'light' || !crystals.length) {
      darkroom.stop();
      rays = 0;
      tracing = false;
      changed();
      return;
    }
    tracing = true;
    darkroom.start({
      id: traceId,
      size: mapSize,
      sunAltitude: Math.max(sunAltitude, 0),
      crystals,
      gain: gain(),
      budget,
    });
    changed();
  }
  // A slider being dragged asks many times a second; trace for the last ask.
  function traceSoon() {
    if (traceTimer) return;
    traceTimer = setTimeout(trace, 70);
  }

  /* ---------- saving: the sky lives in this browser ---------- */
  function save() {
    if (!storage) return;
    storage.save({
      v: 1,
      bench,
      sun: r2(sunAltitude),
      night,
      knots,
      air,
      rain: r2(rainAmount),
      exposure: r2(exposure),
      clouds: clouds
        .filter((c) => !c.popping && c.fadeTo > 0)
        .map((c) => {
          const at = c.home && (c.onTable || c.returning) ? c.home : c.pos;
          return {
            type: c.type,
            name: c.name,
            seed: c.seed,
            P: c.P,
            pos: [r2(at.x), r2(at.y), r2(at.z)],
            rotY: r2(c.rotY),
            holes: c.holes.map((h) => [r2(h.x), r2(h.y), r2(h.z), r2(h.r)]),
            // a brushed-on puff, then its axis and stretch if it isn't round
            extras: c.puffs
              .filter((p) => p.kind === 'x' && !p.dying)
              .map((p) => [
                r2(p.tx),
                r2(p.ty),
                r2(p.tz),
                r2(p.tr),
                r2(p.tsh),
                ...(p.tst === 1
                  ? []
                  : [r2(p.tax), r2(p.tay), r2(p.taz), r2(p.tst)]),
              ]),
          };
        }),
    });
  }
  let saveTimer = 0;
  function dirty() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  }

  /* ---------- the opening sky: what was saved, or a fresh one ---------- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const saved = storage?.load();
  if (saved && saved.v === 1 && Array.isArray(saved.clouds)) {
    knots = clamp(+saved.knots || 0, 0, 40);
    sunAltitude = clamp(+saved.sun || 0, ...SUN_RANGE);
    night = !!saved.night;
    rainAmount = clamp(+saved.rain || 0, 0, 1);
    exposure = clamp(saved.exposure ?? 0.5, 0, 1);
    for (const k of CRYSTAL_KEYS) {
      const s = saved.air?.[k];
      if (!s) continue;
      air[k].amount = clamp(+s.amount || 0, 0, 1);
      air[k].ratio = clamp(+s.ratio || air[k].ratio, 0.05, 6);
      air[k].wobble = clamp(+s.wobble || 0, 0, 30);
    }
    for (const s of saved.clouds) {
      if (!TYPES[s.type] || !Array.isArray(s.pos)) continue;
      makeCloud(s.type, {
        ...s.P,
        name: s.name,
        seed: s.seed,
        pos: V(...s.pos),
        rotY: s.rotY,
        instant: true,
        holes: (s.holes || []).map(([x, y, z, r]) => ({ x, y, z, r })),
        extras: (s.extras || []).map(([x, y, z, r, sh, ax, ay, az, st]) =>
          puffFrom({ x, y, z, r, sh, ax, ay, az, st }, 'x'),
        ),
      });
    }
    if (saved.bench === 'light') bench = 'light';
  } else {
    OPENING_SKY.forEach(([t, x, y, z, size], i) =>
      makeCloud(t, {
        pos: V(x, y, z),
        size,
        seed: i ? 9001 + i * 131 : 41027,
        rotY: i ? undefined : 0.3,
        instant: true,
      }),
    );
    // A first visit to the light finds something in the air.
    air.random.amount = 1;
  }
  setSky(true);
  if (bench === 'light') face('sun');
  look.fov = zoom[bench];

  /* ---------- what the page reads ---------- */
  let snapshot = null;
  const listeners = new Set();
  function changed() {
    snapshot = null;
    for (const fn of listeners) fn();
  }
  function describe(c) {
    const base = c.home && (c.onTable || c.returning) ? c.home.y : c.pos.y;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      base: metres(base),
      tops: metres(base + c.top * c.P.size),
      puffs: livePuffs(c),
      P: { ...c.P },
    };
  }
  function getSnapshot() {
    if (snapshot) return snapshot;
    snapshot = {
      bench,
      mode,
      sun: sunAltitude,
      night,
      knots,
      cover: skyCount(),
      picked: selected && mode === 'sky' ? describe(selected) : null,
      table: tableCloud
        ? { ...describe(tableCloud), tool, hint: HINTS[tool] }
        : null,
      air: Object.fromEntries(CRYSTAL_KEYS.map((k) => [k, { ...air[k] }])),
      rain: rainAmount,
      exposure,
      display,
      rays,
      tracing,
      notice,
      lost,
    };
    return snapshot;
  }

  /* ---------- loop ---------- */
  function resize() {
    vw = host.clientWidth || 1;
    vh = host.clientHeight || 1;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
  }
  const resizer = new ResizeObserver(() => {
    resize();
    if (tableCloud) reframe(tableCloud);
  });
  resizer.observe(host);
  let onScreen = true;
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) wake();
  });
  watcher.observe(host);
  let paused = false;
  let running = false;
  let lost = false;
  let last = 0;
  let statT = 0;
  let lightShow = bench === 'light' ? 1 : 0;
  let frameId = 0;
  function frame(now) {
    running = false;
    if (paused || !onScreen || lost || document.hidden) return;
    wake();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clockT += dt;
    uTime.value = clockT;

    const kSky = reduce ? 1 : 1 - Math.exp(-dt * 2.2);
    for (const k of COLOR_KEYS) S[k].lerp(G[k], kSky);
    S.sunDir.lerp(goalSun, kSky).normalize();
    S.stars = lerp(S.stars, goalStars, kSky);
    S.fogMax = lerp(S.fogMax, goalFog, kSky);
    dome.material.uniforms.uStars.value = S.stars;
    puffMat.uniforms.uFogMax.value = S.fogMax;
    uFlash.value *= Math.exp(-dt * 7);

    // In the light the whole sky is stopped down, clouds and all, so there is
    // room above it for a halo to be brighter than.
    lightShow = lerp(
      lightShow,
      bench === 'light' ? 1 : 0,
      reduce ? 1 : 1 - Math.exp(-dt * 3),
    );
    // Red goes first, the way a deep blue sky is deep: (0.5, 0.6, 0.8).
    const stop = lightShow * (night ? 0.2 : 1);
    uDim.value.setRGB(1 - 0.5 * stop, 1 - 0.4 * stop, 1 - 0.2 * stop);
    cloudDim.setRGB(1 - 0.34 * stop, 1 - 0.3 * stop, 1 - 0.2 * stop);
    puffLit.copy(S.lit).multiply(cloudDim);
    puffShadow.copy(S.shadow).multiply(cloudDim);
    puffFog.copy(S.fog).multiply(uDim.value);
    puffStorm.copy(S.storm).multiply(cloudDim);
    const u = dome.material.uniforms;
    u.uHaloGain.value = lightShow * (rays > 0 ? 1 : 0) * (night ? 0.7 : 1);
    u.uBowGain.value = lightShow * rainAmount * (night ? 0.5 : 1);

    look.fov = lerp(
      look.fov,
      mode === 'table' ? FOV.clouds : zoom[bench],
      reduce ? 1 : 1 - Math.exp(-dt * 5),
    );
    if (Math.abs(camera.fov - look.fov) > 0.01) {
      camera.fov = look.fov;
      camera.updateProjectionMatrix();
    }
    if (tween) {
      tween.t += dt;
      const k = ease(Math.min(1, tween.t / tween.dur));
      controls.target.lerpVectors(tween.t0, tween.t1, k);
      camera.position.lerpVectors(tween.p0, tween.p1, k);
      camera.lookAt(controls.target);
      if (tween.t >= tween.dur) {
        const done = tween.done;
        tween = null;
        done?.();
      }
    } else if (mode === 'table') {
      if (camGoal && !userBusy) {
        const kG = 1 - Math.exp(-dt * 3);
        const off = camera.position.clone().sub(controls.target);
        const d = off.length();
        controls.target.lerp(camGoal.target, kG);
        camera.position
          .copy(controls.target)
          .addScaledVector(off.normalize(), lerp(d, camGoal.dist, kG));
        if (
          Math.abs(d - camGoal.dist) < 0.05 &&
          controls.target.distanceTo(camGoal.target) < 0.05
        )
          camGoal = null;
      }
      controls.update();
    } else lookCam(dt);

    dome.position.copy(camera.position);
    camera.updateMatrixWorld();
    uSunView.value.copy(S.sunDir).transformDirection(camera.matrixWorldInverse);

    if (tableCloud && !userBusy && !drag && clockT - lastTouch > 1.5 && !reduce)
      tableCloud.rotY += dt * 0.16;
    updateClouds(dt);
    updateRain(dt);
    updateBolt(dt);

    // the table rises in with a little overshoot and grows to fit what sits on it
    tableShow = lerp(
      tableShow,
      mode === 'table' ? 1 : 0,
      1 - Math.exp(-dt * (mode === 'table' ? 3 : 5)),
    );
    if (tableCloud)
      tableR = lerp(
        tableR,
        clamp(tableCloud.ext * tableCloud.P.size * 0.9, 6.5, 18),
        1 - Math.exp(-dt * 3),
      );
    const e = 1 + Math.sin(tableShow * Math.PI) * 0.06 * (1 - tableShow);
    tableMesh.visible = tableShow > 0.01;
    tableMesh.scale.set(
      tableR * tableShow * e,
      Math.max(0.001, tableShow),
      tableR * tableShow * e,
    );
    tableMesh.position.set(TABLE.x, TABLE.y - (1 - tableShow) * 3, TABLE.z);
    if (tableCloud) {
      tableMesh.rotation.y = tableCloud.rotY;
      tableMat.uniforms.uShadowR.value = clamp(
        (tableCloud.ext * tableCloud.P.size * 0.75) / tableR,
        0.2,
        1,
      );
    }

    // heights and puff counts change as a cloud drifts and forms
    statT += dt;
    if (statT > 0.5) {
      statT = 0;
      if (selected || tableCloud) changed();
    }
    renderer.render(scene, camera);
  }
  function wake() {
    if (running || paused || lost) return;
    running = true;
    frameId = requestAnimationFrame(frame);
  }
  const onVisible = () => {
    if (!document.hidden) {
      last = performance.now();
      wake();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    changed();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  resize();
  last = performance.now();
  wake();
  if (bench === 'light') trace();

  /* ---------- what the page can ask for ---------- */
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot,
    say,

    /** 'clouds' or 'light'. */
    setBench(next) {
      if (next === bench || (next !== 'clouds' && next !== 'light')) return;
      closeTable(true);
      bench = next;
      selected = null;
      hovered = null;
      if (bench === 'light') {
        face('sun');
        trace();
      } else {
        lookGoal = { yaw: HOME_YAW, pitch: HOME_PITCH };
        darkroom.stop();
        tracing = false;
      }
      changed();
      dirty();
    },
    /** Stop drawing (another bench has the stage) or start again. */
    setPaused(on) {
      paused = on;
      if (!on) {
        last = performance.now();
        wake();
      }
    },
    setSun(altitude) {
      sunAltitude = clamp(altitude, ...SUN_RANGE);
      display = null;
      setSky(false);
      if (bench === 'light') traceSoon();
      changed();
      dirty();
    },
    setNight(on) {
      night = !!on;
      setSky(false);
      changed();
      dirty();
    },
    zoomBy,
    /** Back to the view the bench opens on, or facing the sun. */
    resetView() {
      if (mode === 'table') {
        if (tableCloud) camGoal = tableFocus(tableCloud);
        return;
      }
      zoom[bench] = FOV[bench];
      if (bench === 'light') face('sun');
      else lookGoal = { yaw: HOME_YAW, pitch: HOME_PITCH };
    },
    face,

    /* clouds */
    addCloud(type) {
      if (mode !== 'sky' || !TYPES[type]) return;
      const [lo, hi] = TYPES[type].alt;
      const base =
        type === 'cirrus'
          ? 62
          : type === 'lenticular'
            ? 50
            : type === 'nimbus'
              ? 46
              : 36;
      lookDir(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      const lean = Math.random() < 0.5 ? 1 : -1;
      const pos = new THREE.Vector3();
      // straight ahead, or the first clear spot to one side of it
      for (let i = 0; i < 9; i++) {
        const a =
          Math.atan2(fwd.x, fwd.z) +
          lean * (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.28;
        const d = base + i * 4;
        pos.set(
          HOME.x + Math.sin(a) * d,
          lerp(lo, hi, 0.4),
          clamp(HOME.z + Math.cos(a) * d, -140, 120),
        );
        if (
          clouds.every(
            (o) => o.popping || o.pos.distanceTo(pos) > o.ext * o.P.size + 10,
          )
        )
          break;
      }
      const c = makeCloud(type, { pos });
      selected = c;
      // look up at it if it formed above the frame
      const up = Math.atan2(
        pos.y + 4 - HOME.y,
        Math.hypot(pos.x - HOME.x, pos.z - HOME.z),
      );
      lookGoal = {
        yaw: Math.atan2(pos.x - HOME.x, pos.z - HOME.z),
        pitch: clamp(up, 0, 1.2),
      };
      say(`A new ${TYPES[type].name.toLowerCase()} is forming`);
      dirty();
    },
    /** How many clouds are in reach: more form, or the furthest fade. */
    setCover(want) {
      let have = skyCount();
      while (have < want) {
        const t = randomType();
        makeCloud(t, {
          pos: randomSpot(t),
          size: 0.8 + Math.random() * 0.6,
          height: 0.8 + Math.random() * 0.5,
        });
        have++;
      }
      if (have > want) {
        const pool = clouds
          .filter(
            (c) => !c.popping && c.fadeTo > 0 && c !== selected && !c.onTable,
          )
          .sort((a, b) => b.pos.distanceTo(HOME) - a.pos.distanceTo(HOME));
        for (const c of pool) {
          if (have <= want) break;
          c.fadeTo = 0;
          c.popping = true;
          have--;
        }
      }
      changed();
      dirty();
    },
    setWind(kt) {
      knots = clamp(Math.round(kt), 0, 40);
      changed();
      dirty();
    },
    putDown() {
      select(null);
    },
    pop() {
      if (!selected || mode !== 'sky') return;
      const name = selected.name;
      pop(selected);
      say(`${name} is gone`);
      dirty();
    },
    toTable() {
      openTable(selected);
    },
    release() {
      closeTable(false);
    },
    setTool(next) {
      if (!TOOLS.includes(next)) return;
      tool = next;
      changed();
    },
    /** size, height, fluff, count or mood, on the cloud on the table. */
    setShape(key, value) {
      const c = tableCloud;
      if (!c || !(key in c.P)) return;
      c.P[key] = value;
      if (key !== 'size' && key !== 'mood') rebuild(c);
      reframe(c);
      changed();
      dirty();
    },
    setType(type) {
      const c = tableCloud;
      if (!c || !TYPES[type]) return;
      setType(c, type);
      reframe(c);
      changed();
      dirty();
    },
    setRain(on) {
      const c = tableCloud;
      if (!c) return;
      c.P.rain = !!on;
      reframe(c);
      changed();
      dirty();
    },
    setThunder(on) {
      const c = tableCloud;
      if (!c) return;
      c.P.thunder = !!on;
      if (c.P.thunder) {
        strike(c);
        c.nextBolt = 2 + Math.random() * 3;
      }
      changed();
      dirty();
    },
    surprise() {
      const c = tableCloud;
      if (!c) return;
      const t = TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)];
      c.seed = (Math.random() * 1e9) | 0;
      c.holes = [];
      for (const p of c.puffs)
        if (p.kind === 'x') {
          p.tr = 0;
          p.dying = true;
        }
      if (t !== c.type) setType(c, t);
      Object.assign(c.P, {
        size: 0.7 + Math.random() * 0.9,
        height: 0.7 + Math.random() * 0.9,
        fluff: 0.2 + Math.random() * 0.7,
        count: 0.7 + Math.random() * 0.7,
      });
      rebuild(c);
      reframe(c);
      say(`Rolled a new ${TYPES[c.type].name.toLowerCase()}`);
      dirty();
    },
    copy() {
      const c = tableCloud;
      if (!c) return;
      makeCloud(c.type, {
        pos: c.home.clone().add(new THREE.Vector3(16, 0, 6)),
        seed: c.seed,
        ...c.P,
        rotY: c.rotY,
        holes: c.holes,
        extras: c.puffs
          .filter((p) => p.kind === 'x' && !p.dying)
          .map((p) => ({ ...p })),
      });
      say('A copy is drifting next to its spot in the sky');
      dirty();
    },

    /* light */
    /** amount, ratio or wobble of one kind of crystal. */
    setCrystal(key, patch) {
      if (!air[key]) return;
      Object.assign(air[key], patch);
      display = null;
      traceSoon();
      changed();
      dirty();
    },
    setShower(amount) {
      rainAmount = clamp(amount, 0, 1);
      display = null;
      changed();
      dirty();
    },
    setExposure(value) {
      exposure = clamp(value, 0, 1);
      darkroom.setGain(gain());
      changed();
      dirty();
    },
    /** One of DISPLAYS: set the sun and the air for it, and turn to look. */
    show(key) {
      const d = DISPLAYS.find((x) => x.key === key);
      if (!d) return;
      sunAltitude = d.sun;
      setSky(false);
      const fresh = emptyAir();
      for (const k of CRYSTAL_KEYS)
        Object.assign(air[k], fresh[k], d.air[k] || {});
      rainAmount = d.rain || 0;
      display = d.key;
      zoom.light = FOV.light;
      face(d.look);
      trace();
      dirty();
    },

    destroy() {
      cancelAnimationFrame(frameId);
      paused = true;
      clearTimeout(saveTimer);
      clearTimeout(noticeTimer);
      clearTimeout(traceTimer);
      save();
      darkroom.dispose();
      resizer.disconnect();
      watcher.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      controls.dispose();
      listeners.clear();
      scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      noise.dispose();
      haloTex.dispose();
      bowTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
