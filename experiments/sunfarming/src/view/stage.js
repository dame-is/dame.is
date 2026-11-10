// The picture: a three.js scene of the island, a camera on a boom, and the
// cursor. It draws a `game` and answers "which tile is under this pixel";
// it never changes the game, and knows nothing about tools or coins.

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { TERRAIN } from '../sim/catalog.js';
import { GRASS_Y, SAND_Y, tileAt, tileX, tileY, tileZ } from './layout.js';
import { PARTS, createModels } from './models.js';
import { createSky } from './sky.js';
import { createGridLines, createSunOverlay, createTerrain } from './terrain.js';
import { createMaterials } from './toon.js';
import { createWater } from './water.js';
import { createWorld } from './world.js';

const FOV = 30;
const PITCH_MIN = 0.36;
const PITCH_MAX = 1.36;
const DISTANCE_MIN = 6;

const CURSOR_COLORS = {
  look: '#ffffff',
  ok: '#ffe45c',
  bad: '#ff5a4d',
  remove: '#ff8a3d',
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function createStage(canvas, game) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.5, 2000);
  const materials = createMaterials();
  const models = createModels();
  const sky = createSky(scene, materials);

  // The island and everything on it, rebuilt whole for a new island.
  let land = null;

  function setGame(next) {
    if (land) {
      scene.remove(
        land.terrain.mesh,
        land.grid.lines,
        land.water.mesh,
        land.sunmap.mesh,
      );
      land.terrain.dispose();
      land.grid.dispose();
      land.sunmap.dispose();
      land.water.dispose();
      land.world.dispose();
    }
    const terrain = createTerrain(next, materials);
    const grid = createGridLines(next);
    const water = createWater(next);
    const sunmap = createSunOverlay(next);
    const world = createWorld(scene, next, materials, models);
    scene.add(terrain.mesh, grid.lines, water.mesh, sunmap.mesh);
    sky.fit(next.size);
    land = { game: next, terrain, grid, water, sunmap, world, showGrid: false };
  }
  setGame(game);

  /* ── the camera, on a boom round a point on the ground ────────────────── */

  // `goal` is where the player has asked the camera to be; `now` eases after
  // it, so every pan, turn and zoom glides instead of jumping.
  const goal = { x: 0, z: 0, yaw: 0.6, pitch: 0.84, distance: 30 };
  const now = { ...goal };
  let fitted = true;
  let width = 1;
  let height = 1;

  // Far enough back to see the whole island at this pitch and this shape of
  // window: a phone held upright has to stand a long way off.
  function fitDistance() {
    // The land stops a tile or two short of the grid's edge all round.
    const radius = land.game.size / 2 - 1;
    const half = (FOV * Math.PI) / 360;
    const across = radius / Math.tan(Math.atan(Math.tan(half) * camera.aspect));
    const down = (radius * Math.sin(goal.pitch) + 1.5) / Math.tan(half);
    return clamp(Math.max(across, down) * 1.04, 16, 90);
  }

  const distanceMax = () => Math.max(46, fitDistance() * 1.25);

  function placeCamera() {
    const cosPitch = Math.cos(now.pitch);
    camera.position.set(
      now.x + Math.sin(now.yaw) * cosPitch * now.distance,
      Math.sin(now.pitch) * now.distance,
      now.z + Math.cos(now.yaw) * cosPitch * now.distance,
    );
    camera.lookAt(now.x, 0, now.z);
  }

  function resize(w, h, pixelRatio = 1) {
    width = Math.max(1, Math.floor(w));
    height = Math.max(1, Math.floor(h));
    renderer.setPixelRatio(clamp(pixelRatio, 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (fitted) {
      goal.distance = fitDistance();
      now.distance = goal.distance;
    } else {
      goal.distance = clamp(goal.distance, DISTANCE_MIN, distanceMax());
    }
  }

  const limit = () => land.game.size / 2 + 2;

  /** Slide the view by a drag of this many pixels, as if pulling the ground. */
  function pan(dxPixels, dyPixels) {
    const perPixel =
      (2 * now.distance * Math.tan((FOV * Math.PI) / 360)) / height;
    const right = dxPixels * perPixel;
    const forward = (dyPixels * perPixel) / Math.max(0.35, Math.sin(now.pitch));
    goal.x = clamp(
      goal.x - Math.cos(goal.yaw) * right - Math.sin(goal.yaw) * forward,
      -limit(),
      limit(),
    );
    goal.z = clamp(
      goal.z + Math.sin(goal.yaw) * right - Math.cos(goal.yaw) * forward,
      -limit(),
      limit(),
    );
  }

  /** Step the view across the ground, in tiles, relative to the screen. */
  function nudge(rightTiles, forwardTiles) {
    goal.x = clamp(
      goal.x +
        Math.cos(goal.yaw) * rightTiles -
        Math.sin(goal.yaw) * forwardTiles,
      -limit(),
      limit(),
    );
    goal.z = clamp(
      goal.z -
        Math.sin(goal.yaw) * rightTiles -
        Math.cos(goal.yaw) * forwardTiles,
      -limit(),
      limit(),
    );
  }

  function orbit(yaw, pitch = 0) {
    goal.yaw += yaw;
    goal.pitch = clamp(goal.pitch + pitch, PITCH_MIN, PITCH_MAX);
  }

  /** Multiply the camera's distance: below 1 moves in, above 1 moves out. */
  function zoom(factor) {
    fitted = false;
    goal.distance = clamp(goal.distance * factor, DISTANCE_MIN, distanceMax());
  }

  /* ── which tile is under a pixel ──────────────────────────────────────── */

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const hit = new Vector3();
  const grassPlane = new Plane(new Vector3(0, 1, 0), -GRASS_Y);
  const sandPlane = new Plane(new Vector3(0, 1, 0), -SAND_Y);

  /**
   * The tile under a point of the canvas (in CSS pixels from its top left),
   * or -1. The grass stands a step above the beach, so the higher plane is
   * tried first and believed only if it lands on grass.
   */
  function pick(px, py) {
    pointer.set((px / width) * 2 - 1, -(py / height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const { terrain, size } = land.game;
    if (raycaster.ray.intersectPlane(grassPlane, hit)) {
      const idx = tileAt(hit.x, hit.z, size);
      if (idx >= 0 && terrain[idx] === TERRAIN.GRASS) return idx;
    }
    if (raycaster.ray.intersectPlane(sandPlane, hit))
      return tileAt(hit.x, hit.z, size);
    return -1;
  }

  /* ── the cursor: a frame on the tile, and a ghost of what would go there ─ */

  const cursor = new Group();
  cursor.visible = false;
  const frameMaterial = new MeshBasicMaterial({ color: CURSOR_COLORS.look });
  const washMaterial = new MeshBasicMaterial({
    color: CURSOR_COLORS.look,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const edge = new BoxGeometry(1, 0.045, 0.06);
  for (const [x, z, turn] of [
    [0, -0.47, 0],
    [0, 0.47, 0],
    [-0.47, 0, Math.PI / 2],
    [0.47, 0, Math.PI / 2],
  ]) {
    const side = new Mesh(edge, frameMaterial);
    side.position.set(x, 0.03, z);
    side.rotation.y = turn;
    cursor.add(side);
  }
  const washGeometry = new PlaneGeometry(0.94, 0.94);
  washGeometry.rotateX(-Math.PI / 2);
  const wash = new Mesh(washGeometry, washMaterial);
  wash.position.y = 0.02;
  cursor.add(wash);
  scene.add(cursor);

  const ghostBad = materials.ghost.clone();
  ghostBad.color.set('#ff6b5e');
  let ghost = null;
  let ghostKind = null;

  /**
   * Show the cursor on tile `idx` (or hide it with -1). `tone` is one of
   * look / ok / bad / remove; `kind` is the building to show a ghost of.
   */
  function setCursor({ idx = -1, tone = 'look', kind = null } = {}) {
    const { terrain, size } = land.game;
    if (idx < 0) {
      cursor.visible = false;
      if (ghost) ghost.visible = false;
      return;
    }
    cursor.visible = true;
    cursor.position.set(
      tileX(idx, size),
      tileY(terrain, idx),
      tileZ(idx, size),
    );
    frameMaterial.color.set(CURSOR_COLORS[tone] || CURSOR_COLORS.look);
    washMaterial.color.copy(frameMaterial.color);

    if (kind !== ghostKind) {
      if (ghost) scene.remove(ghost);
      ghost = null;
      ghostKind = kind;
      const shape = kind ? models.get(kind) : null;
      if (shape) {
        ghost = new Group();
        ghost.add(new Mesh(shape.geometry, materials.ghost));
        const moving = PARTS[kind];
        if (moving) {
          const part = new Mesh(
            models.get(moving.part).geometry,
            materials.ghost,
          );
          part.position.set(...moving.at);
          ghost.add(part);
        }
        for (const mesh of ghost.children) mesh.renderOrder = 5;
        scene.add(ghost);
      }
    }
    if (ghost) {
      // No ghost where something already stands: the frame says no by itself.
      ghost.visible = !land.game.things[idx] && terrain[idx] !== TERRAIN.WATER;
      const material = tone === 'ok' ? materials.ghost : ghostBad;
      for (const mesh of ghost.children) mesh.material = material;
      ghost.position.copy(cursor.position);
    }
  }

  function showGrid(on) {
    land.showGrid = Boolean(on);
    land.grid.lines.visible = land.showGrid;
  }

  /**
   * Show the sun map (what sunMap() in src/sim/shade.js returns), or put it
   * away with null.
   */
  function showSunMap(map) {
    land.sunmap.mesh.visible = Boolean(map);
    if (map) land.sunmap.paint(map, land.game.things);
  }

  /* ── drawing a frame ──────────────────────────────────────────────────── */

  function render(elapsed, dt) {
    const ease = 1 - Math.exp(-Math.min(0.1, dt) * 14);
    now.x += (goal.x - now.x) * ease;
    now.z += (goal.z - now.z) * ease;
    now.yaw += (goal.yaw - now.yaw) * ease;
    now.pitch += (goal.pitch - now.pitch) * ease;
    now.distance += (goal.distance - now.distance) * ease;
    placeCamera();

    const { game: current, water, world } = land;
    sky.update(current, camera, elapsed, dt);
    water.uniforms.uTime.value = elapsed;
    water.uniforms.uTint.value.copy(sky.state.sea);
    water.uniforms.uHorizon.value.copy(sky.state.sky);
    // The line keeps roughly the same width on screen however far out the
    // camera is.
    materials.outline.uniforms.uThickness.value = clamp(
      now.distance * 0.0011,
      0.01,
      0.07,
    );

    world.sync(current, elapsed);
    world.update(current, elapsed, {
      night: sky.state.night,
      sun: sky.day ? sky.direction : null,
      dt,
    });
    if (cursor.visible) {
      const pulse = 1 + Math.sin(elapsed * 6) * 0.025;
      cursor.scale.set(pulse, 1, pulse);
    }
    renderer.render(scene, camera);
  }

  return {
    canvas,
    setGame(next) {
      setGame(next);
      showGrid(false);
      setCursor({ idx: -1 });
      goal.x = 0;
      goal.z = 0;
      fitted = true;
      goal.distance = fitDistance();
    },
    resize,
    render,
    pick,
    pan,
    nudge,
    orbit,
    zoom,
    setCursor,
    showGrid,
    showSunMap,
    dispose() {
      land.terrain.dispose();
      land.grid.dispose();
      land.sunmap.dispose();
      land.water.dispose();
      land.world.dispose();
      sky.dispose();
      models.dispose();
      materials.dispose();
      ghostBad.dispose();
      frameMaterial.dispose();
      washMaterial.dispose();
      edge.dispose();
      washGeometry.dispose();
      renderer.dispose();
      // The canvas was made for this stage and goes with it, so the context
      // can be handed back at once instead of waiting to be collected.
      renderer.forceContextLoss();
    },
  };
}
