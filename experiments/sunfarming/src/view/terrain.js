// The island's ground: one mesh, a square of colour per tile, with a wall
// wherever a tile stands above its neighbour (grass over beach, beach over
// sea). The two greens and two sands alternate like a chessboard, which is
// all the grid the game needs most of the time.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Mesh,
} from 'three';
import { TERRAIN } from '../sim/catalog.js';
import { hash2 } from '../sim/rng.js';
import { SKIRT_Y, tileX, tileY, tileZ } from './layout.js';

const GRASS = ['#86d45f', '#79c955'];
const SAND = ['#f6e3a6', '#efd896'];
const EARTH = '#c0905a';
const SKIRT = '#dcc587';

export function createTerrain(game, materials) {
  const { terrain, size } = game;
  const positions = [];
  const normals = [];
  const colors = [];
  const color = new Color();
  const tint = new Color();

  // Four corners, anticlockwise as seen from outside, and the way they face.
  const quad = (corners, normal, hex, lighten = 0) => {
    color.set(hex);
    if (lighten)
      color.lerp(
        tint.set(lighten > 0 ? '#ffffff' : '#000000'),
        Math.abs(lighten),
      );
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[i]);
      normals.push(...normal);
      colors.push(color.r, color.g, color.b);
    }
  };

  const heightAt = (x, z) => {
    if (x < 0 || z < 0 || x >= size || z >= size) return SKIRT_Y;
    const idx = z * size + x;
    return terrain[idx] === TERRAIN.WATER ? SKIRT_Y : tileY(terrain, idx);
  };

  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = z * size + x;
      if (terrain[idx] === TERRAIN.WATER) continue;
      const grass = terrain[idx] === TERRAIN.GRASS;
      const h = tileY(terrain, idx);
      const x0 = tileX(idx, size) - 0.5;
      const x1 = x0 + 1;
      const z0 = tileZ(idx, size) - 0.5;
      const z1 = z0 + 1;
      const top = (grass ? GRASS : SAND)[(x + z) % 2];
      // A breath of difference from tile to tile, so it reads as painted.
      const wobble = (hash2(x, z, 91) - 0.5) * 0.05;

      quad(
        [
          [x0, h, z0],
          [x0, h, z1],
          [x1, h, z1],
          [x1, h, z0],
        ],
        [0, 1, 0],
        top,
        wobble,
      );

      const wall = (lo, corners, normal) => {
        if (lo >= h - 1e-6) return;
        quad(
          corners.map(([cx, up, cz]) => [cx, up ? h : lo, cz]),
          normal,
          grass && lo > SKIRT_Y ? EARTH : SKIRT,
        );
      };
      // prettier-ignore
      wall(heightAt(x + 1, z), [[x1, 1, z1], [x1, 0, z1], [x1, 0, z0], [x1, 1, z0]], [1, 0, 0]);
      // prettier-ignore
      wall(heightAt(x - 1, z), [[x0, 1, z0], [x0, 0, z0], [x0, 0, z1], [x0, 1, z1]], [-1, 0, 0]);
      // prettier-ignore
      wall(heightAt(x, z + 1), [[x0, 1, z1], [x0, 0, z1], [x1, 0, z1], [x1, 1, z1]], [0, 0, 1]);
      // prettier-ignore
      wall(heightAt(x, z - 1), [[x1, 1, z0], [x1, 0, z0], [x0, 0, z0], [x0, 1, z0]], [0, 0, -1]);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array(normals), 3),
  );
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Float32Array(colors), 3),
  );
  const mesh = new Mesh(geometry, materials.toon);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  return {
    mesh,
    dispose() {
      geometry.dispose();
    },
  };
}

/**
 * The grid drawn out in lines, a hair above the ground: shown while a
 * building tool is in hand, when exactly which tile matters.
 */
export function createGridLines(game) {
  const { terrain, size } = game;
  const points = [];
  const lift = 0.012;
  for (let idx = 0; idx < terrain.length; idx += 1) {
    if (terrain[idx] === TERRAIN.WATER) continue;
    const y = tileY(terrain, idx) + lift;
    const x0 = tileX(idx, size) - 0.5;
    const z0 = tileZ(idx, size) - 0.5;
    // prettier-ignore
    points.push(
      x0, y, z0, x0 + 1, y, z0,
      x0 + 1, y, z0, x0 + 1, y, z0 + 1,
      x0 + 1, y, z0 + 1, x0, y, z0 + 1,
      x0, y, z0 + 1, x0, y, z0,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(points), 3),
  );
  const material = new LineBasicMaterial({
    color: '#1d3b2a',
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.visible = false;
  lines.name = 'grid';
  return {
    lines,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
