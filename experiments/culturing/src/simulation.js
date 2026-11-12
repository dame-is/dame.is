// The simulation: plates as float textures, and the passes that advance them.
//
// A plate's state is four groups of textures (shaders/common.js lists every
// channel): the surface (motile, settled, memory), the agar (three textures
// of dissolved things, at half resolution), the reagents put on from the
// tray (three more, shaders/reagents.js) and the wrinkle field. A step
// draws each group from the last into a scratch group and swaps the two, so
// every plate owns exactly one copy of its state and the engine keeps one
// spare for all of them.
//
// This file knows the order things happen in and nothing about what a
// culture is; the numbers arrive already converted (pack.js).

import {
  createFullscreen,
  createProgram,
  createTarget,
  createTexture,
  disposeTarget,
  FULLSCREEN_VERTEX,
} from './gl.js';
import { createGrid, DISH } from './units.js';
import { vesselUniforms } from './vessels.js';
import { CULTURE_FRAGMENT } from './shaders/culture.js';
import { AGAR_FRAGMENT } from './shaders/agar.js';
import { REAGENT_FRAGMENT } from './shaders/reagents.js';
import { WRINKLE_A_FRAGMENT, WRINKLE_B_FRAGMENT } from './shaders/wrinkle.js';
import {
  POUR_AGAR_FRAGMENT,
  POUR_SURFACE_FRAGMENT,
  STAMP_AGAR_FRAGMENT,
  STAMP_REAGENT_FRAGMENT,
  STAMP_SURFACE_FRAGMENT,
} from './shaders/stamp.js';

/** How far one wrinkle sub-step moves the field. Explicit, so bounded by the
 *  fourth-derivative term at the grid scale: stable under about 0.07. */
const WRINKLE_DT = 0.06;
/** Wrinkle sub-steps per biology step. */
const WRINKLE_SUBSTEPS = 2;

const ZERO = [0, 0, 0, 0];

export function createSimulation(gl, caps, size) {
  const grid = createGrid(size);
  const N = grid.size;
  const NC = grid.chemSize;
  const fullscreen = createFullscreen(gl);
  const programs = {
    culture: createProgram(gl, FULLSCREEN_VERTEX, CULTURE_FRAGMENT, 'culture'),
    agar: createProgram(gl, FULLSCREEN_VERTEX, AGAR_FRAGMENT, 'agar'),
    reagents: createProgram(
      gl,
      FULLSCREEN_VERTEX,
      REAGENT_FRAGMENT,
      'reagents',
    ),
    wrinkleA: createProgram(
      gl,
      FULLSCREEN_VERTEX,
      WRINKLE_A_FRAGMENT,
      'wrinkleA',
    ),
    wrinkleB: createProgram(
      gl,
      FULLSCREEN_VERTEX,
      WRINKLE_B_FRAGMENT,
      'wrinkleB',
    ),
    stampSurface: createProgram(
      gl,
      FULLSCREEN_VERTEX,
      STAMP_SURFACE_FRAGMENT,
      'stampSurface',
    ),
    stampAgar: createProgram(
      gl,
      FULLSCREEN_VERTEX,
      STAMP_AGAR_FRAGMENT,
      'stampAgar',
    ),
    stampReagents: createProgram(
      gl,
      FULLSCREEN_VERTEX,
      STAMP_REAGENT_FRAGMENT,
      'stampReagents',
    ),
    pourSurface: createProgram(
      gl,
      FULLSCREEN_VERTEX,
      POUR_SURFACE_FRAGMENT,
      'pourSurface',
    ),
    pourAgar: createProgram(
      gl,
      FULLSCREEN_VERTEX,
      POUR_AGAR_FRAGMENT,
      'pourAgar',
    ),
  };

  // Every pass reads state texel by texel. The one place it is wanted
  // between texels (the surface pass reading the half-resolution agar) does
  // its own interpolation, so nothing here depends on the hardware being
  // able to filter a 32-bit float texture, which most phones can't.
  const stateTexture = (n) =>
    createTexture(gl, n, n, {
      internalFormat: caps.stateFormat,
      filter: gl.NEAREST,
    });

  function createSurface() {
    const B = stateTexture(N);
    const D = stateTexture(N);
    const AUX = stateTexture(N);
    return { B, D, AUX, target: createTarget(gl, [B, D, AUX]) };
  }
  function createAgar() {
    const C0 = stateTexture(NC);
    const C1 = stateTexture(NC);
    const C2 = stateTexture(NC);
    const C3 = stateTexture(NC);
    return { C0, C1, C2, C3, target: createTarget(gl, [C0, C1, C2, C3]) };
  }
  function createReagents() {
    const R0 = stateTexture(NC);
    const R1 = stateTexture(NC);
    const R2 = stateTexture(NC);
    return { R0, R1, R2, target: createTarget(gl, [R0, R1, R2]) };
  }
  /** What lies over a plate's lid: white lets the light through. */
  const LID = 256;
  function createLid() {
    const texture = createTexture(gl, LID, LID, {
      internalFormat: gl.RGBA8,
      filter: gl.LINEAR,
    });
    return texture;
  }
  let lidCanvas = null;
  /**
   * Mask a plate's lid with a word, in black, across the middle; or clear
   * it. Drawn in the page's own type, a little soft, as a mask laid on the
   * outside of the lid is: the light bends round its edges on the way down.
   */
  function setLid(plate, text = '') {
    if (!lidCanvas) {
      lidCanvas = document.createElement('canvas');
      lidCanvas.width = LID;
      lidCanvas.height = LID;
    }
    const ctx = lidCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, LID, LID);
    if (text) {
      const family =
        getComputedStyle(document.body).fontFamily || 'Georgia, serif';
      // As big as fits across about two thirds of the dish.
      let size = LID * 0.34;
      ctx.font = `600 ${size}px ${family}`;
      const wide = ctx.measureText(text).width;
      const room = LID * 0.68;
      if (wide > room) size *= room / wide;
      ctx.font = `600 ${size}px ${family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.filter = 'blur(1px)';
      ctx.fillText(text, LID / 2, LID / 2);
      ctx.filter = 'none';
    }
    gl.bindTexture(gl.TEXTURE_2D, plate.lid);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      lidCanvas,
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  function createWrinkle() {
    const WR = stateTexture(N);
    return { WR, target: createTarget(gl, [WR]) };
  }

  const scratch = {
    surface: createSurface(),
    agar: createAgar(),
    reagents: createReagents(),
    wrinkle: createWrinkle(),
  };

  function begin(target, n) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, n, n);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  function swap(plate, key) {
    const mine = plate[key];
    plate[key] = scratch[key];
    scratch[key] = mine;
  }

  /** A plate with storage and nothing on it: not even agar until poured. */
  function createPlate() {
    return {
      surface: createSurface(),
      agar: createAgar(),
      reagents: createReagents(),
      wrinkle: createWrinkle(),
      lid: createLid(),
      // Whether anything has been put in the reagent textures: until it
      // has, they are all zero and their pass is skipped.
      stained: false,
      steps: 0,
      hours: 0,
    };
  }

  function disposePlate(plate) {
    disposeTarget(gl, plate.surface.target);
    disposeTarget(gl, plate.agar.target);
    disposeTarget(gl, plate.reagents.target);
    disposeTarget(gl, plate.wrinkle.target);
    gl.deleteTexture(plate.lid);
  }

  function stampSurface(plate, stamp) {
    const program = programs.stampSurface;
    begin(scratch.surface.target, N);
    program.use();
    program.textures({
      uB: plate.surface.B,
      uD: plate.surface.D,
      uAux: plate.surface.AUX,
      uMask: plate.surface.AUX,
    });
    program.set({
      uTexels: N,
      uMaskScale: 1,
      uSpan: grid.span,
      uFrom: stamp.from,
      uTo: stamp.to || stamp.from,
      uRadius: stamp.radius,
      uFeather: stamp.feather ?? Math.min(stamp.radius * 0.5, 0.6),
      uRing: stamp.ring || 0,
      uSpeckle: stamp.speckle ?? 1,
      uClump: stamp.clump || 0,
      uSeed: stamp.seed >>> 0,
      uNeedsAgar: stamp.needsAgar !== false,
      uTaper: 0,
      uRamp: false,
      uClear0: stamp.clearB || ZERO,
      uAdd0: stamp.addB || ZERO,
      uClear1: stamp.clearD || ZERO,
      uAdd1: stamp.addD || ZERO,
      uClear2: stamp.clearAux || ZERO,
      uAdd2: stamp.addAux || ZERO,
    });
    fullscreen.draw();
    swap(plate, 'surface');
  }

  /** The uniforms a stamp into one of the half-resolution groups takes. */
  function chemStamp(stamp) {
    return {
      uTexels: NC,
      uMaskScale: 2,
      uSpan: grid.span,
      uFrom: stamp.from,
      uTo: stamp.to || stamp.from,
      uRadius: stamp.radius ?? 0,
      uFeather: stamp.feather ?? Math.min((stamp.radius ?? 0) * 0.5, 0.8),
      uRing: 0,
      uSpeckle: 1,
      uClump: 0,
      uSeed: 0,
      uNeedsAgar: stamp.needsAgar !== false,
      uTaper: stamp.taper || 0,
      uRamp: Boolean(stamp.ramp),
      uClear0: stamp.clear0 || ZERO,
      uAdd0: stamp.add0 || ZERO,
      uClear1: stamp.clear1 || ZERO,
      uAdd1: stamp.add1 || ZERO,
      uClear2: stamp.clear2 || ZERO,
      uAdd2: stamp.add2 || ZERO,
      uClear3: stamp.clear3 || ZERO,
      uAdd3: stamp.add3 || ZERO,
    };
  }

  function stampAgar(plate, stamp) {
    const program = programs.stampAgar;
    begin(scratch.agar.target, NC);
    program.use();
    program.textures({
      uC0: plate.agar.C0,
      uC1: plate.agar.C1,
      uC2: plate.agar.C2,
      uC3: plate.agar.C3,
      uMask: plate.surface.AUX,
    });
    program.set(chemStamp(stamp));
    fullscreen.draw();
    swap(plate, 'agar');
  }

  function stampReagents(plate, stamp) {
    const program = programs.stampReagents;
    begin(scratch.reagents.target, NC);
    program.use();
    program.textures({
      uR0: plate.reagents.R0,
      uR1: plate.reagents.R1,
      uR2: plate.reagents.R2,
      uMask: plate.surface.AUX,
    });
    program.set(chemStamp(stamp));
    fullscreen.draw();
    swap(plate, 'reagents');
    if (stamp.add0 || stamp.add1) plate.stained = true;
  }

  function clearReagents(plate) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, plate.reagents.target.framebuffer);
    gl.viewport(0, 0, NC, NC);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    plate.stained = false;
  }

  function clearWrinkle(plate) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, plate.wrinkle.target.framebuffer);
    gl.viewport(0, 0, N, N);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Pour a plate: fresh agar to the wall, nothing growing, the clock at
   * zero. `vessel` is a vessels.js id and `media` one `{ nutrient, ph }` per
   * compartment, in the libraries' units; the seed decides where the gel is
   * a little uneven.
   */
  function pour(plate, { vessel = 'dish', media }, seed = 1) {
    const shape = { ...vesselUniforms(vessel), uRadius: DISH.radius };
    begin(scratch.surface.target, N);
    programs.pourSurface.use();
    programs.pourSurface.set({
      ...shape,
      uTexels: N,
      uSpan: grid.span,
      uSeed: seed >>> 0,
    });
    fullscreen.draw();
    swap(plate, 'surface');

    const each = (fn) =>
      Array.from({ length: 6 }, (_, i) => fn(media[i] || media[0]));
    begin(scratch.agar.target, NC);
    programs.pourAgar.use();
    programs.pourAgar.set({
      ...shape,
      uTexels: NC,
      uSpan: grid.span,
      uNutrient: each((m) => m.nutrient),
      uPh: each((m) => m.ph || 0),
    });
    fullscreen.draw();
    swap(plate, 'agar');
    clearReagents(plate);
    clearWrinkle(plate);
    plate.steps = 0;
    plate.hours = 0;
  }

  /**
   * One step. `u` is the packed uniform set for this plate (pack.js) plus
   * the few values that change with the clock: uWet, uLight.
   */
  function step(plate, u) {
    const clock = { uHours: plate.hours, uStep: plate.steps };

    begin(scratch.surface.target, N);
    programs.culture.use();
    programs.culture.textures({
      uB: plate.surface.B,
      uD: plate.surface.D,
      uAux: plate.surface.AUX,
      uC0: plate.agar.C0,
      uC1: plate.agar.C1,
      uC3: plate.agar.C3,
      uLid: plate.lid,
    });
    programs.culture.set(u);
    programs.culture.set({ ...clock, uChemSize: NC });
    fullscreen.draw();
    swap(plate, 'surface');

    begin(scratch.agar.target, NC);
    programs.agar.use();
    programs.agar.textures({
      uB: plate.surface.B,
      uD: plate.surface.D,
      uAux: plate.surface.AUX,
      uC0: plate.agar.C0,
      uC1: plate.agar.C1,
      uC2: plate.agar.C2,
      uC3: plate.agar.C3,
    });
    programs.agar.set(u);
    fullscreen.draw();
    swap(plate, 'agar');

    if (plate.stained) {
      begin(scratch.reagents.target, NC);
      programs.reagents.use();
      programs.reagents.textures({
        uB: plate.surface.B,
        uD: plate.surface.D,
        uAux: plate.surface.AUX,
        uC0: plate.agar.C0,
        uR0: plate.reagents.R0,
        uR1: plate.reagents.R1,
        uR2: plate.reagents.R2,
      });
      programs.reagents.set(u);
      fullscreen.draw();
      swap(plate, 'reagents');
    }

    if (u.wrinkles) {
      for (let k = 0; k < WRINKLE_SUBSTEPS; k += 1) {
        begin(scratch.wrinkle.target, N);
        programs.wrinkleA.use();
        programs.wrinkleA.textures({
          uWr: plate.wrinkle.WR,
          uAux: plate.surface.AUX,
          uD: plate.surface.D,
        });
        programs.wrinkleA.set(u);
        programs.wrinkleA.set({
          uWrHours: grid.dt / WRINKLE_SUBSTEPS,
          uMmPerTexel: grid.dx,
        });
        fullscreen.draw();

        begin(plate.wrinkle.target, N);
        programs.wrinkleB.use();
        programs.wrinkleB.textures({
          uWrA: scratch.wrinkle.WR,
          uAux: plate.surface.AUX,
          uD: plate.surface.D,
        });
        programs.wrinkleB.set({
          uWrAfter: u.uWrAfter,
          uWrSets: u.uWrSets,
          uWrDt: WRINKLE_DT,
          uStep: plate.steps * WRINKLE_SUBSTEPS + k,
          uSeed: u.uSeed,
        });
        fullscreen.draw();
      }
    }

    plate.steps += 1;
    plate.hours += grid.dt;
  }

  function dispose() {
    for (const key in programs) programs[key].dispose();
    disposeTarget(gl, scratch.surface.target);
    disposeTarget(gl, scratch.agar.target);
    disposeTarget(gl, scratch.reagents.target);
    disposeTarget(gl, scratch.wrinkle.target);
    fullscreen.dispose();
  }

  return {
    grid,
    fullscreen,
    createPlate,
    disposePlate,
    pour,
    step,
    stampSurface,
    stampAgar,
    stampReagents,
    setLid,
    dispose,
  };
}
