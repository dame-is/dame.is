// The sea: one big flat sheet, coloured entirely by a shader.
//
// It knows how far every point is from the island (a small texture baked
// from the grid, below), and everything it draws comes from that distance:
// pale shallows stepping down to deep blue in hard bands, a line of foam
// along the shore, and rings of foam that travel in toward the beach. Out at
// sea, the bright edges of slowly drifting cells stand in for wave crests.

import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';
import { TERRAIN } from '../sim/catalog.js';
import { SEA_Y } from './layout.js';

/** Texels per tile, tiles of open water kept round the grid, and the range. */
const RESOLUTION = 4;
const MARGIN = 8;
const MAX_DISTANCE = 6;

// For every texel, how many tiles away the nearest land is (0 on land).
function bakeShore(terrain, size) {
  const span = size + MARGIN * 2;
  const width = span * RESOLUTION;
  const data = new Uint8Array(width * width);
  const land = [];
  for (let idx = 0; idx < terrain.length; idx += 1) {
    if (terrain[idx] !== TERRAIN.WATER)
      land.push([idx % size, Math.floor(idx / size)]);
  }
  for (let j = 0; j < width; j += 1) {
    for (let i = 0; i < width; i += 1) {
      // In tile coordinates, where tile (x, z) covers [x, x+1] × [z, z+1].
      const px = (i + 0.5) / RESOLUTION - MARGIN;
      const pz = (j + 0.5) / RESOLUTION - MARGIN;
      let best = MAX_DISTANCE * MAX_DISTANCE;
      for (const [x, z] of land) {
        const dx = Math.max(x - px, 0, px - (x + 1));
        const dz = Math.max(z - pz, 0, pz - (z + 1));
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
      }
      data[j * width + i] = Math.round((Math.sqrt(best) / MAX_DISTANCE) * 255);
    }
  }
  const texture = new DataTexture(
    data,
    width,
    width,
    RedFormat,
    UnsignedByteType,
  );
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, half: span / 2 };
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform sampler2D uShore;
  uniform float uHalf;
  uniform float uMaxDistance;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uTint;
  uniform vec3 uHorizon;
  varying vec3 vWorld;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec2 hash2(vec2 p) {
    return vec2(hash(p), hash(p + 17.17));
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // How close p is to the border between two drifting cells: small on the
  // borders, larger inside. The borders are the crests.
  float cellEdge(vec2 p, float t) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float nearest = 8.0;
    float second = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = hash2(cell + g);
        o = 0.5 + 0.38 * sin(t + 6.2831 * o);
        float d = length(g + o - f);
        if (d < nearest) { second = nearest; nearest = d; }
        else if (d < second) { second = d; }
      }
    }
    return second - nearest;
  }

  void main() {
    vec2 p = vWorld.xz;
    vec2 uv = (p + uHalf) / (2.0 * uHalf);
    float d = uMaxDistance;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      d = texture2D(uShore, uv).r * uMaxDistance;
    }

    // A slow wobble, so nothing that follows the coast is a ruled line.
    float wobble = noise(p * 1.3 + uTime * 0.18) - 0.5;
    float dw = d + wobble * 0.22;

    // Depth in three hard bands.
    vec3 color = uDeep;
    color = mix(color, uMid, 1.0 - step(2.6, dw + wobble * 0.5));
    color = mix(color, uShallow, 1.0 - step(1.05, dw));

    // Crests out at sea: only scraps of the cells' borders, in drifting
    // patches, so they read as scattered glints and not as a net.
    float edge = cellEdge(p * 0.62 + vec2(uTime * 0.035, uTime * 0.02), uTime * 0.35);
    float patchy = smoothstep(0.6, 0.72, noise(p * 0.21 + vec2(uTime * 0.03, uTime * 0.011)));
    float crest = (1.0 - smoothstep(0.03, 0.045, edge)) * patchy * step(1.5, dw);
    color = mix(color, uFoam, crest * 0.5);

    // Foam: rings that travel in to the beach, then the line where it lands.
    float ring = sin(dw * 8.5 + uTime * 1.25);
    float rings = step(0.8, ring) * (1.0 - smoothstep(0.35, 1.25, dw)) * step(0.12, dw);
    float shore = 1.0 - step(0.115, dw);
    color = mix(color, uFoam, max(shore, rings * 0.85));

    color *= uTint;

    // Fade into the sky at the horizon.
    float far = length(vWorld.xz - cameraPosition.xz);
    color = mix(color, uHorizon, smoothstep(70.0, 320.0, far));

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createWater(game) {
  const shore = bakeShore(game.terrain, game.size);
  const uniforms = {
    uTime: { value: 0 },
    uShore: { value: shore.texture },
    uHalf: { value: shore.half },
    uMaxDistance: { value: MAX_DISTANCE },
    uDeep: { value: new Color('#1f7fd1') },
    uMid: { value: new Color('#2f9be0') },
    uShallow: { value: new Color('#5fd0e6') },
    uFoam: { value: new Color('#ffffff') },
    uTint: { value: new Color('#ffffff') },
    uHorizon: { value: new Color('#69c3f3') },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  });
  const geometry = new PlaneGeometry(1400, 1400);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.position.y = SEA_Y;
  mesh.name = 'sea';

  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
      shore.texture.dispose();
    },
  };
}
