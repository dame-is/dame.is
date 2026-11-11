// The look: flat colour in a few hard steps of light, and a dark line round
// everything that stands on the island.
//
// Both halves are the oldest tricks there are for it. The steps come from a
// tiny ramp texture that MeshToonMaterial reads instead of smooth shading.
// The line is a second copy of each model, drawn inside out and pushed
// outwards a little along its normals, so only its rim shows past the model
// in front of it (an "inverted hull").

import {
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** The ink every outline is drawn in. */
export const INK = '#2a2440';

// Three steps of light: turned away, glancing, facing. Nearest-neighbour
// filtering is what keeps the edges between them hard.
function createRamp() {
  const steps = new Uint8Array([150, 208, 255]);
  const texture = new DataTexture(
    steps,
    steps.length,
    1,
    RedFormat,
    UnsignedByteType,
  );
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The materials the whole scene shares. One toon material serves every
 * model, because the models carry their colours on their vertices; that is
 * also what lets a building be a single mesh.
 */
export function createMaterials() {
  const ramp = createRamp();

  const toon = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });

  // The same, see-through: the ghost of a building under the cursor.
  const ghost = new MeshToonMaterial({
    vertexColors: true,
    gradientMap: ramp,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });

  const outline = new ShaderMaterial({
    uniforms: {
      uThickness: { value: 0.02 },
      uColor: { value: new Color(INK) },
    },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      void main() {
        vec3 pushed = position + normalize(normal) * uThickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pushed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: BackSide,
  });

  return {
    ramp,
    toon,
    ghost,
    outline,
    /** A flat-coloured toon material, for the few things that change colour. */
    solid(color, options = {}) {
      return new MeshToonMaterial({ color, gradientMap: ramp, ...options });
    },
    dispose() {
      ramp.dispose();
      toon.dispose();
      ghost.dispose();
      outline.dispose();
    },
  };
}

/**
 * The hull for a model's outline: the same shape with its corners welded and
 * its normals averaged across them. A box's own normals point straight out of
 * each face, so pushing along those would split it at every edge; averaged,
 * the corners travel diagonally and the hull stays closed.
 */
export function outlineGeometry(geometry) {
  const bare = new BufferGeometry();
  bare.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) bare.setIndex(geometry.index.clone());
  const welded = mergeVertices(bare, 1e-3);
  welded.computeVertexNormals();
  bare.dispose();
  return welded;
}
