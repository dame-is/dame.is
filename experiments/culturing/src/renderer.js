// Drawing the bench.
//
// For each plate the renderer keeps four display textures (what the surface
// is: display.js) and one of shadows, refreshed from the plate's state
// whenever it is about to be drawn. The scene itself is small: a bench, one
// displaced sheet per plate, and a ring of polystyrene around each.

import {
  createProgram,
  createTarget,
  createTexture,
  disposeTarget,
  FULLSCREEN_VERTEX,
} from './gl.js';
import { DISH } from './units.js';
import {
  BLOCK,
  DIVIDER,
  vesselUniforms,
  WELL_RADIUS,
  WELLS,
} from './vessels.js';
import { COMPOSE_FRAGMENT, SHADE_FRAGMENT } from './shaders/display.js';
import {
  BENCH_FRAGMENT,
  BENCH_VERTEX,
  GLASS_FRAGMENT,
  GLASS_VERTEX,
  SLAB_FRAGMENT,
  SLAB_VERTEX,
  SURFACE_FRAGMENT,
  SURFACE_VERTEX,
} from './shaders/scene.js';

/** Heights above the bench, mm: the dish's floor, and the gel poured on it. */
export const FLOOR_Y = 1;
export const GEL_Y = FLOOR_Y + DISH.agarDepth;
/** The dish's outer radius: what its footprint on the bench is. */
export const OUTER_RADIUS = DISH.radius + DISH.wallThickness;

/** How far a vessel reaches from its middle, across and in depth, mm. */
export function footprint(vessel) {
  if (vessel === 'wells') return { halfW: BLOCK.halfW, halfD: BLOCK.halfD };
  return { halfW: OUTER_RADIUS, halfD: OUTER_RADIUS };
}

/**
 * Quads along a side of a plate's sheet. Up close it is one to a texel, as
 * far as that goes: a fold is only a few texels wide, and on a coarser sheet
 * its crest comes out as a row of teeth against the bench when the plate is
 * tilted. Across the bench nobody can tell.
 */
const MESH_NEAR = 384;
const MESH_FAR = 72;
/** Segments around the dish wall. */
const WALL_SEGMENTS = 128;

function gridMesh(gl, quads) {
  const side = quads + 1;
  const positions = new Float32Array(side * side * 2);
  let k = 0;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      positions[k++] = (x / quads) * 2 - 1;
      positions[k++] = (y / quads) * 2 - 1;
    }
  }
  // More corners than sixteen bits can count, on the finer sheets.
  const wide = side * side > 65535;
  const indices = new (wide ? Uint32Array : Uint16Array)(quads * quads * 6);
  k = 0;
  for (let y = 0; y < quads; y += 1) {
    for (let x = 0; x < quads; x += 1) {
      const a = y * side + x;
      indices[k++] = a;
      indices[k++] = a + 1;
      indices[k++] = a + side;
      indices[k++] = a + 1;
      indices[k++] = a + side + 1;
      indices[k++] = a + side;
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return {
    count: indices.length,
    draw() {
      gl.bindVertexArray(vao);
      gl.drawElements(
        gl.TRIANGLES,
        indices.length,
        wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        0,
      );
    },
    dispose() {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
    },
  };
}

/** Positions and normals, interleaved, as a mesh to draw as triangles. */
function trianglesMesh(gl, data) {
  const array = new Float32Array(data);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  const count = array.length / 6;
  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    },
    dispose() {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
    },
  };
}

/**
 * A box, as a mesh: a bi-plate's dividing wall, or the six-well plate's
 * block. Positions are relative to the vessel's centre on the bench.
 */
function boxMesh(gl, halfX, halfZ, y0, y1, faces = 'all') {
  const data = [];
  const quad = (a, b, c, d, n) => {
    for (const p of [a, b, c, a, c, d]) data.push(...p, ...n);
  };
  const x = [-halfX, halfX];
  const z = [-halfZ, halfZ];
  if (faces === 'all') {
    quad(
      [x[0], y1, z[0]],
      [x[1], y1, z[0]],
      [x[1], y1, z[1]],
      [x[0], y1, z[1]],
      [0, 1, 0],
    );
  }
  quad(
    [x[1], y0, z[0]],
    [x[1], y1, z[0]],
    [x[1], y1, z[1]],
    [x[1], y0, z[1]],
    [1, 0, 0],
  );
  quad(
    [x[0], y0, z[1]],
    [x[0], y1, z[1]],
    [x[0], y1, z[0]],
    [x[0], y0, z[0]],
    [-1, 0, 0],
  );
  quad(
    [x[0], y0, z[0]],
    [x[0], y1, z[0]],
    [x[1], y1, z[0]],
    [x[1], y0, z[0]],
    [0, 0, -1],
  );
  quad(
    [x[1], y0, z[1]],
    [x[1], y1, z[1]],
    [x[0], y1, z[1]],
    [x[0], y0, z[1]],
    [0, 0, 1],
  );
  return trianglesMesh(gl, data);
}

/** A flat rectangle facing up: the six-well plate's deck. */
function deckMesh(gl, halfX, halfZ, y) {
  const data = [];
  const n = [0, 1, 0];
  for (const p of [
    [-halfX, y, -halfZ],
    [halfX, y, -halfZ],
    [halfX, y, halfZ],
    [-halfX, y, -halfZ],
    [halfX, y, halfZ],
    [-halfX, y, halfZ],
  ]) {
    data.push(...p, ...n);
  }
  return trianglesMesh(gl, data);
}

/**
 * The dish wall: an inner and an outer cylinder and the flat rim between
 * them. Positions are relative to the dish's centre on the bench. A well's
 * wall is the same, smaller, with no rim of its own: the deck is its rim.
 */
function wallMesh(gl, inner = DISH.radius, outer = OUTER_RADIUS, rim = true) {
  const top = DISH.wallHeight;
  const data = [];
  const quad = (a, b, c, d, n) => {
    for (const p of [a, b, c, a, c, d]) data.push(...p, ...n(p));
  };
  for (let i = 0; i < WALL_SEGMENTS; i += 1) {
    const t0 = (i / WALL_SEGMENTS) * Math.PI * 2;
    const t1 = ((i + 1) / WALL_SEGMENTS) * Math.PI * 2;
    const at = (radius, t, y) => [
      Math.cos(t) * radius,
      y,
      Math.sin(t) * radius,
    ];
    const radial = (sign) => (p) => {
      const l = Math.hypot(p[0], p[2]) || 1;
      return [(sign * p[0]) / l, 0, (sign * p[2]) / l];
    };
    // Wound so each face is front-facing from the side it is seen from:
    // the outer wall from outside, the inner from inside, the rim from above.
    quad(
      at(outer, t0, 0),
      at(outer, t0, top),
      at(outer, t1, top),
      at(outer, t1, 0),
      radial(1),
    );
    quad(
      at(inner, t0, FLOOR_Y),
      at(inner, t1, FLOOR_Y),
      at(inner, t1, top),
      at(inner, t0, top),
      radial(-1),
    );
    if (rim) {
      quad(
        at(inner, t0, top),
        at(inner, t1, top),
        at(outer, t1, top),
        at(outer, t0, top),
        () => [0, 1, 0],
      );
    }
  }
  return trianglesMesh(gl, data);
}

/**
 * The edge of the gel: a strip round the inside of the wall, as tall as the
 * pour. Each vertex is (cos, 0 or 1, sin); the shader gives it a radius and
 * a height.
 */
function slabMesh(gl) {
  const data = [];
  for (let i = 0; i < WALL_SEGMENTS; i += 1) {
    const t0 = (i / WALL_SEGMENTS) * Math.PI * 2;
    const t1 = ((i + 1) / WALL_SEGMENTS) * Math.PI * 2;
    const a = [Math.cos(t0), Math.sin(t0)];
    const b = [Math.cos(t1), Math.sin(t1)];
    data.push(
      a[0],
      0,
      a[1],
      b[0],
      0,
      b[1],
      b[0],
      1,
      b[1],
      a[0],
      0,
      a[1],
      b[0],
      1,
      b[1],
      a[0],
      1,
      a[1],
    );
  }
  const array = new Float32Array(data);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const count = array.length / 3;
  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    },
    dispose() {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
    },
  };
}

export function createRenderer(gl, sim) {
  const N = sim.grid.size;
  const NC = sim.grid.chemSize;

  const programs = {
    compose: createProgram(gl, FULLSCREEN_VERTEX, COMPOSE_FRAGMENT, 'compose'),
    shade: createProgram(gl, FULLSCREEN_VERTEX, SHADE_FRAGMENT, 'shade'),
    bench: createProgram(gl, BENCH_VERTEX, BENCH_FRAGMENT, 'bench'),
    surface: createProgram(gl, SURFACE_VERTEX, SURFACE_FRAGMENT, 'surface'),
    slab: createProgram(gl, SLAB_VERTEX, SLAB_FRAGMENT, 'slab'),
    glass: createProgram(gl, GLASS_VERTEX, GLASS_FRAGMENT, 'glass'),
  };
  const near = gridMesh(gl, Math.min(N, MESH_NEAR));
  const far = gridMesh(gl, MESH_FAR);
  const wall = wallMesh(gl);
  const slab = slabMesh(gl);
  const divider = boxMesh(
    gl,
    DIVIDER,
    Math.sqrt(DISH.radius ** 2 - DIVIDER ** 2),
    FLOOR_Y,
    DISH.wallHeight,
  );
  const well = wallMesh(gl, WELL_RADIUS, WELL_RADIUS + 0.9, false);
  const block = boxMesh(
    gl,
    BLOCK.halfW,
    BLOCK.halfD,
    0,
    DISH.wallHeight,
    'sides',
  );
  const deck = deckMesh(gl, BLOCK.halfW, BLOCK.halfD, DISH.wallHeight);

  /** The display textures for one plate. Half floats: these are for the
   *  eye, and the hardware will interpolate them. */
  function createDisplay() {
    const make = (mips = false) =>
      createTexture(gl, N, N, {
        internalFormat: gl.RGBA16F,
        filter: gl.LINEAR,
        mips,
      });
    const relief = make();
    const colony = make();
    const agar = make();
    const glow = make(true);
    const shade = createTexture(gl, N, N, {
      internalFormat: gl.RGBA8,
      filter: gl.LINEAR,
    });
    return {
      relief,
      colony,
      agar,
      glow,
      shade,
      target: createTarget(gl, [relief, colony, agar, glow]),
      shadeTarget: createTarget(gl, [shade]),
    };
  }

  function disposeDisplay(display) {
    disposeTarget(gl, display.target);
    disposeTarget(gl, display.shadeTarget);
  }

  /**
   * Refresh a plate's display textures from its state.
   *
   * @param {object} plate    a simulation plate
   * @param {object} display  from createDisplay()
   * @param {object} look     packLook() for the plate
   * @param {object} light    { mode, lamp: [x, y, z] toward the lamp, stretch }
   */
  function compose(plate, display, look, light) {
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, display.target.framebuffer);
    gl.viewport(0, 0, N, N);
    programs.compose.use();
    programs.compose.textures({
      uB: plate.surface.B,
      uD: plate.surface.D,
      uAux: plate.surface.AUX,
      uWr: plate.wrinkle.WR,
      uC0: plate.agar.C0,
      uC1: plate.agar.C1,
      uC2: plate.agar.C2,
      uC3: plate.agar.C3,
      uR0: plate.reagents.R0,
      uR1: plate.reagents.R1,
      uR2: plate.reagents.R2,
    });
    programs.compose.set(look);
    programs.compose.set({
      uChemSize: NC,
      uLightMode: light.mode,
      uMmPerTexel: sim.grid.dx,
    });
    sim.fullscreen.draw();

    gl.bindTexture(gl.TEXTURE_2D, display.glow);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.bindFramebuffer(gl.FRAMEBUFFER, display.shadeTarget.framebuffer);
    programs.shade.use();
    programs.shade.textures({ uRelief: display.relief });
    programs.shade.set({
      uTexel: 1 / N,
      uMmPerTexel: sim.grid.dx,
      uStretch: light.stretch,
      // Plate space runs (x, up, -z): the texture's y is away from the
      // viewer.
      uLamp: [light.lamp[0], light.lamp[1], -light.lamp[2]],
    });
    sim.fullscreen.draw();
  }

  /**
   * Draw the bench.
   *
   * @param {object} scene
   * @param {number} scene.width, scene.height  the drawing buffer
   * @param {Float32Array} scene.viewProj
   * @param {number[]} scene.eye
   * @param {object} scene.light   { mode, lamp, stretch }
   * @param {number[]} scene.bench linear RGB
   * @param {object[]} scene.dishes  { centre: [x, z], display, close }
   */
  function draw(scene) {
    const { light } = scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, scene.width, scene.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    const dishes = new Float32Array(32);
    scene.dishes.slice(0, 8).forEach((dish, i) => {
      // The bench's shading is round; a block is shaded as the circle
      // that fits inside it lengthways.
      const { halfW, halfD } = footprint(dish.vessel);
      dishes[i * 4] = dish.centre[0];
      dishes[i * 4 + 1] = dish.centre[1];
      dishes[i * 4 + 2] = (halfW + halfD) / 2;
      dishes[i * 4 + 3] = DISH.wallHeight;
    });
    const shared = {
      uViewProj: scene.viewProj,
      uEye: scene.eye,
      uLightMode: light.mode,
      uLamp: light.lamp,
      uBench: scene.bench,
      uDishes: dishes,
      uDishCount: Math.min(scene.dishes.length, 8),
    };

    programs.bench.use();
    programs.bench.set(shared);
    programs.bench.set({ uExtent: [2400, 2400] });
    sim.fullscreen.draw();

    const plateShape = {
      uSpan: sim.grid.span,
      uRadius: DISH.radius,
      uEdge: 2.5 * sim.grid.dx,
      uTop: GEL_Y,
      uFloor: FLOOR_Y,
    };
    programs.surface.use();
    programs.surface.set(shared);
    programs.surface.set(plateShape);
    programs.surface.set({ uStretch: light.stretch, uTexels: N });
    for (const dish of scene.dishes) {
      if (!dish.display) continue;
      programs.surface.textures({
        uRelief: dish.display.relief,
        uColony: dish.display.colony,
        uAgar: dish.display.agar,
        uGlow: dish.display.glow,
        uShade: dish.display.shade,
      });
      programs.surface.set({
        ...vesselUniforms(dish.vessel),
        uCentre: [dish.centre[0], 0, dish.centre[1]],
        uDetail: dish.close ? 1 : 0,
      });
      (dish.close ? near : far).draw();
    }

    programs.slab.use();
    programs.slab.set(shared);
    programs.slab.set(plateShape);
    for (const dish of scene.dishes) {
      if (!dish.display) continue;
      programs.slab.textures({ uAgar: dish.display.agar });
      programs.slab.set({ uCentre: [dish.centre[0], 0, dish.centre[1]] });
      if (dish.vessel === 'wells') {
        programs.slab.set({ uRadius: WELL_RADIUS });
        for (const offset of WELLS) {
          programs.slab.set({ uOffset: offset });
          slab.draw();
        }
        programs.slab.set({ uRadius: DISH.radius });
      } else {
        programs.slab.set({ uOffset: [0, 0] });
        slab.draw();
      }
    }

    // The walls are clear, so they go last, furthest first, back faces
    // before front ones.
    const byDistance = scene.dishes
      .map((dish) => ({
        dish,
        distance: Math.hypot(
          dish.centre[0] - scene.eye[0],
          dish.centre[1] - scene.eye[2],
        ),
      }))
      .sort((a, b) => b.distance - a.distance);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    programs.glass.use();
    programs.glass.set(shared);
    programs.glass.set({ uRadius: DISH.radius, uHoled: 0, uRimScatter: 1 });
    const both = (mesh) => {
      gl.cullFace(gl.FRONT);
      mesh.draw();
      gl.cullFace(gl.BACK);
      mesh.draw();
    };
    for (const { dish } of byDistance) {
      const [x, z] = dish.centre;
      programs.glass.set({
        ...vesselUniforms(dish.vessel),
        uCentre: [x, 0, z],
      });
      if (dish.vessel === 'wells') {
        // The block: its sides, a wall round each well, and the deck over
        // them all, open where the wells are.
        both(block);
        for (const [wx, wy] of WELLS) {
          programs.glass.set({ uCentre: [x + wx, 0, z - wy] });
          both(well);
        }
        programs.glass.set({
          uCentre: [x, 0, z],
          uHoled: 1,
          uRimScatter: 0.35,
        });
        both(deck);
        programs.glass.set({ uHoled: 0, uRimScatter: 1 });
        continue;
      }
      both(wall);
      if (dish.vessel === 'split') both(divider);
    }
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function dispose() {
    for (const key in programs) programs[key].dispose();
    near.dispose();
    far.dispose();
    wall.dispose();
    slab.dispose();
    divider.dispose();
    well.dispose();
    block.dispose();
    deck.dispose();
  }

  return { createDisplay, disposeDisplay, compose, draw, dispose };
}
