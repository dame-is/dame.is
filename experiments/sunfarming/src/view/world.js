// What stands on the island, kept in step with the game.
//
// The game is the truth and this only mirrors it: every frame it looks for
// tiles whose `thing` is no longer the one it drew, and redraws those. There
// are no "building placed" messages to miss or apply twice; loading a save,
// starting over, a home moving up a tier and placing one panel all go
// through the same comparison.
//
// It also draws what the island does in answer: smoke from the generator
// while it runs, the fuel boat that comes for as long as fuel is burned, and
// the gulls and flowers that turn up as the sun takes over.

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { KINDS, TERRAIN } from '../sim/catalog.js';
import { turbineFactor } from '../sim/game.js';
import { neighbours } from '../sim/island.js';
import { conducts } from '../sim/network.js';
import { createRng } from '../sim/rng.js';
import { hourOf } from '../sim/sun.js';
import { SEA_Y, tileX, tileY, tileZ } from './layout.js';
import { PARTS, SMOKE_AT, WIRE_ANCHOR } from './models.js';
import { bar, merge } from './shapes.js';
import { INK } from './toon.js';

const WIRE = '#33304a';
const STRIP = '#4a4f66';
const POP_SECONDS = 0.38;
const PUFFS = 5;
const GULLS = 6;
const FLOWER_COLORS = ['#ffd23f', '#ff8fb1', '#ffffff', '#c59bff', '#ff9d5c'];
const UP = new Vector3(0, 1, 0);

// A little overshoot on the way in: things land with a bounce.
function pop(t) {
  if (t >= 1) return 1;
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

// The badge over anything that makes or stores power but can't reach a
// home: a yellow disc with a struck-through bolt.
function createBadgeTexture() {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.beginPath();
  c.arc(size / 2, size / 2, size / 2 - 7, 0, Math.PI * 2);
  c.fillStyle = '#ffd84a';
  c.fill();
  c.lineWidth = 7;
  c.strokeStyle = INK;
  c.stroke();
  c.beginPath();
  c.moveTo(54, 20);
  c.lineTo(34, 52);
  c.lineTo(48, 52);
  c.lineTo(42, 76);
  c.lineTo(63, 43);
  c.lineTo(49, 43);
  c.closePath();
  c.fillStyle = INK;
  c.fill();
  c.beginPath();
  c.moveTo(24, 72);
  c.lineTo(72, 24);
  c.lineWidth = 9;
  c.strokeStyle = '#f2473a';
  c.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// The pool of warm light round a home whose lamps are on, seen after dark.
function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const fade = c.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  fade.addColorStop(0, 'rgba(255, 214, 110, 0.9)');
  fade.addColorStop(0.35, 'rgba(255, 190, 80, 0.38)');
  fade.addColorStop(1, 'rgba(255, 170, 60, 0)');
  c.fillStyle = fade;
  c.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createWorld(scene, game, materials, models) {
  const { size, terrain } = game;
  const root = new Group();
  root.name = 'things';
  scene.add(root);

  const slots = new Array(size * size).fill(null);
  const plots = new Map();

  const lampOn = new MeshBasicMaterial({ color: '#8dff6a' });
  const lampOff = materials.solid('#33414a');
  const windowLit = new MeshBasicMaterial({ color: '#ffe38a' });
  const windowDark = materials.solid('#3d4d6e');
  const badgeTexture = createBadgeTexture();
  const badgeMaterial = new SpriteMaterial({
    map: badgeTexture,
    depthTest: false,
    transparent: true,
  });
  const glowTexture = createGlowTexture();
  const glowMaterial = new SpriteMaterial({
    map: glowTexture,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0,
  });

  // Before the first sync nothing should bounce in: a loaded island is
  // already built.
  let settled = false;

  function model(kind, variant, tier) {
    const { geometry, outline } = models.get(kind, variant, tier);
    const mesh = new Mesh(geometry, materials.toon);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (outline) mesh.add(new Mesh(outline, materials.outline));
    return mesh;
  }

  function build(idx, thing, now) {
    const group = new Group();
    group.position.set(tileX(idx, size), tileY(terrain, idx), tileZ(idx, size));
    const body = model(thing.kind, thing.variant, thing.tier);
    group.add(body);
    const slot = {
      thing,
      group,
      body,
      born: settled ? now : -1e9,
      links: null,
    };
    const def = KINDS[thing.kind];

    if (PARTS[thing.kind]) {
      slot.part = model(PARTS[thing.kind].part);
      slot.part.position.set(...PARTS[thing.kind].at);
      body.add(slot.part);
      slot.spin = (idx * 1.7) % 6.28;
    }
    if (def.stores) {
      const big = thing.kind === 'bank';
      const lamp = models.get('batteryLamp').geometry;
      slot.lamps = [0, 1, 2, 3].map((i) => {
        const mesh = new Mesh(lamp, lampOff);
        mesh.position.set(
          (big ? -0.27 : -0.21) + i * (big ? 0.18 : 0.14),
          big ? 0.655 : 0.535,
          0.06,
        );
        if (big) mesh.scale.set(1.3, 1, 1.5);
        body.add(mesh);
        return mesh;
      });
    } else if (thing.kind === 'house') {
      slot.windows = new Mesh(
        models.get('houseWindows', 0, thing.tier).geometry,
        windowDark,
      );
      body.add(slot.windows);
      body.rotation.y = (Math.abs(thing.variant) % 4) * (Math.PI / 2);
      slot.glow = new Sprite(glowMaterial);
      slot.glow.scale.setScalar(2.4 + thing.tier * 0.3);
      slot.glow.position.y = 0.3;
      slot.glow.visible = false;
      group.add(slot.glow);
    } else if (thing.kind === 'tree') {
      slot.sway = (idx * 2.399) % 6.28;
      body.rotation.y = (thing.variant % 16) * 0.39;
      body.scale.setScalar(0.88 + ((thing.variant >> 4) % 8) * 0.045);
      slot.rest = body.scale.x;
    } else if (thing.kind === 'rock') {
      body.scale.setScalar(0.85 + ((thing.variant >> 3) % 6) * 0.07);
      slot.rest = body.scale.x;
    } else if (thing.kind === 'generator') {
      const puff = models.get('puff').geometry;
      slot.smoke = 0;
      slot.puffs = Array.from({ length: PUFFS }, () => {
        const mesh = new Mesh(puff, materials.toon);
        mesh.visible = false;
        group.add(mesh);
        return mesh;
      });
    }

    if (
      thing.kind !== 'cable' &&
      thing.kind !== 'house' &&
      def.conducts &&
      !def.scenery
    ) {
      if (thing.kind !== 'generator') {
        slot.badge = new Sprite(badgeMaterial);
        slot.badge.scale.setScalar(0.42);
        slot.badgeY = thing.kind === 'turbine' ? 2.2 : 1.05;
        slot.badge.position.y = slot.badgeY;
        slot.badge.renderOrder = 10;
        slot.badge.visible = false;
        group.add(slot.badge);
      }
    }

    root.add(group);
    return slot;
  }

  function dropLinks(slot) {
    if (!slot?.links) return;
    slot.group.remove(slot.links);
    slot.links.geometry.dispose();
    slot.links = null;
  }

  function clear(idx) {
    const slot = slots[idx];
    if (!slot) return;
    dropLinks(slot);
    root.remove(slot.group);
    slots[idx] = null;
  }

  // The wires and ground strips that run from one tile to the things it
  // touches. A power line draws a sagging wire to each neighbour; two
  // buildings side by side get a strip along the ground between them.
  function relink(current, idx) {
    const slot = slots[idx];
    if (!slot) return;
    dropLinks(slot);
    const thing = current.things[idx];
    if (!conducts(thing)) return;
    const parts = [];
    const x = idx % size;
    const z = Math.floor(idx / size);
    const here = tileY(terrain, idx);
    for (const n of neighbours(idx, size)) {
      const other = current.things[n];
      if (!conducts(other)) continue;
      const dx = (n % size) - x;
      const dz = Math.floor(n / size) - z;
      const dy = tileY(terrain, n) - here;
      if (thing.kind === 'cable') {
        const top = WIRE_ANCHOR.cable.y;
        if (other.kind === 'cable') {
          // Half a span each: the two halves meet in the middle of the sag.
          const quarter = [dx * 0.25, top + dy * 0.25 - 0.07, dz * 0.25];
          const middle = [dx * 0.5, top + dy * 0.5 - 0.1, dz * 0.5];
          parts.push(
            bar([0, top, 0], quarter, 0.03, WIRE),
            bar(quarter, middle, 0.03, WIRE),
          );
        } else {
          const anchor = WIRE_ANCHOR[other.kind];
          const reach = 1 - anchor.inset;
          const end = [dx * reach, anchor.y + dy, dz * reach];
          const middle = [
            end[0] * 0.5,
            (top + end[1]) * 0.5 - 0.06,
            end[2] * 0.5,
          ];
          parts.push(
            bar([0, top, 0], middle, 0.03, WIRE),
            bar(middle, end, 0.03, WIRE),
          );
        }
      } else if (
        other.kind !== 'cable' &&
        n > idx &&
        !(thing.kind === 'house' && other.kind === 'house')
      ) {
        parts.push(bar([0, 0.035, 0], [dx, 0.035 + dy, dz], 0.075, STRIP));
      }
    }
    if (!parts.length) return;
    slot.links = new Mesh(merge(parts), materials.toon);
    slot.links.castShadow = true;
    slot.group.add(slot.links);
  }

  /* ── the pier and the fuel boat ───────────────────────────────────────── */

  let pier = null;
  let boat = null;
  const seaward = new Vector3();
  const dock = new Vector3();
  const generatorAt = game.things.findIndex(
    (thing) => thing?.kind === 'generator',
  );
  if (game.pier >= 0 && generatorAt >= 0) {
    seaward
      .set(
        (game.pier % size) - (generatorAt % size),
        0,
        Math.floor(game.pier / size) - Math.floor(generatorAt / size),
      )
      .normalize();
    const heading = Math.atan2(seaward.x, seaward.z);
    pier = model('pier');
    pier.position.set(tileX(game.pier, size), 0, tileZ(game.pier, size));
    pier.rotation.y = heading;
    root.add(pier);
    boat = model('boat');
    boat.rotation.y = heading + Math.PI;
    boat.visible = false;
    root.add(boat);
    dock.copy(pier.position).addScaledVector(seaward, 1.25);
    dock.x += seaward.z * 0.42;
    dock.z -= seaward.x * 0.42;
  }

  // The boat comes in after daybreak with the day's fuel, lies at the pier
  // through the morning and goes out again; it stops coming once a day has
  // passed with the generator silent.
  function sail(current, now) {
    if (!boat) return;
    const hour = hourOf(current.time);
    const burning =
      current.things[generatorAt]?.kind === 'generator' &&
      (!current.yesterday || current.yesterday.diesel > 0.05);
    let away = 1;
    if (hour >= 7 && hour < 8.5) away = 1 - (hour - 7) / 1.5;
    else if (hour >= 8.5 && hour < 10.5) away = 0;
    else if (hour >= 10.5 && hour < 12) away = (hour - 10.5) / 1.5;
    boat.visible = burning && away < 1;
    if (!boat.visible) return;
    const ease = away * away * (3 - 2 * away);
    boat.position.copy(dock).addScaledVector(seaward, ease * 16);
    boat.position.y = SEA_Y + 0.06 + Math.sin(now * 1.7) * 0.02;
    boat.rotation.z = Math.sin(now * 1.3) * 0.04;
  }

  /* ── what the island does in answer ───────────────────────────────────── */

  // Flowers: a scatter over the grass, more of it showing the more of the
  // island's power comes from the sun.
  const rng = createRng(game.spec.seed + 303);
  const spots = [];
  for (let idx = 0; idx < terrain.length; idx += 1) {
    if (terrain[idx] !== TERRAIN.GRASS || game.plots.includes(idx)) continue;
    const count = rng() < 0.55 ? 1 + Math.floor(rng() * 3) : 0;
    for (let i = 0; i < count; i += 1) {
      spots.push({
        idx,
        x: tileX(idx, size) + (rng() - 0.5) * 0.8,
        z: tileZ(idx, size) + (rng() - 0.5) * 0.8,
        scale: 0.7 + rng() * 0.8,
        color: FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)],
        order: rng(),
      });
    }
  }
  spots.sort((a, b) => a.order - b.order);
  const flowers = new InstancedMesh(
    models.get('flower').geometry,
    materials.solid('#ffffff'),
    Math.max(1, spots.length),
  );
  flowers.count = spots.length;
  flowers.receiveShadow = true;
  const tint = new Color();
  spots.forEach((spot, i) => flowers.setColorAt(i, tint.set(spot.color)));
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  root.add(flowers);
  const matrix = new Matrix4();
  const still = new Quaternion();
  const where = new Vector3();
  const grown = new Vector3();
  let bloom = -1;
  let bloomed = -1;
  let planted = true;

  function tend(share) {
    bloom = bloom < 0 ? share : bloom + (share - bloom) * 0.02;
    const showing = Math.round(spots.length * Math.min(1, bloom * 1.1));
    if (showing === bloomed && !planted) return;
    bloomed = showing;
    planted = false;
    spots.forEach((spot, i) => {
      const up = i < showing && !slots[spot.idx];
      where.set(spot.x, tileY(terrain, spot.idx), spot.z);
      grown.setScalar(up ? spot.scale : 0);
      flowers.setMatrixAt(i, matrix.compose(where, still, grown));
    });
    flowers.instanceMatrix.needsUpdate = true;
  }

  // Gulls: none over a smoky island, a few over a clean one.
  const wingMaterial = materials.solid('#ffffff');
  const gulls = Array.from({ length: GULLS }, (_, i) => {
    const bird = new Group();
    const left = new Mesh(models.get('wing').geometry, wingMaterial);
    const right = new Mesh(models.get('wing').geometry, wingMaterial);
    right.scale.x = -1;
    left.castShadow = true;
    right.castShadow = true;
    bird.add(left, right);
    bird.visible = false;
    root.add(bird);
    return {
      bird,
      left,
      right,
      radius: 3.5 + rng() * (size * 0.3),
      height: 2.6 + rng() * 2.2,
      speed: (0.16 + rng() * 0.14) * (i % 2 ? 1 : -1),
      phase: rng() * 6.28,
    };
  });

  function fly(share, now) {
    const flying = Math.round(GULLS * Math.max(0, share - 0.15));
    gulls.forEach((gull, i) => {
      gull.bird.visible = i < flying;
      if (!gull.bird.visible) return;
      const a = gull.phase + now * gull.speed;
      gull.bird.position.set(
        Math.cos(a) * gull.radius,
        gull.height + Math.sin(now * 0.7 + gull.phase) * 0.3,
        Math.sin(a) * gull.radius,
      );
      gull.bird.rotation.y = -a + (gull.speed > 0 ? 0 : Math.PI);
      const flap = Math.sin(now * 7 + gull.phase) * 0.5;
      gull.left.rotation.z = flap;
      gull.right.rotation.z = -flap;
    });
  }

  /* ── keeping in step ──────────────────────────────────────────────────── */

  /** Redraw every tile whose thing has changed since it was last drawn. */
  function sync(current, now) {
    const touched = new Set();
    for (let idx = 0; idx < slots.length; idx += 1) {
      const thing = current.things[idx];
      const slot = slots[idx];
      if ((slot?.thing || null) === (thing || null)) continue;
      clear(idx);
      if (thing) slots[idx] = build(idx, thing, now);
      touched.add(idx);
      for (const n of neighbours(idx, size)) touched.add(n);
    }
    for (const idx of touched) relink(current, idx);
    if (touched.size) planted = true;

    // The plots the village hasn't built on yet are pegged out.
    current.plots.forEach((idx, i) => {
      const wanted = i >= current.houses && !current.things[idx];
      const marker = plots.get(idx);
      if (wanted && !marker) {
        const mesh = new Mesh(models.get('plot').geometry, materials.toon);
        mesh.position.set(
          tileX(idx, size),
          tileY(terrain, idx),
          tileZ(idx, size),
        );
        mesh.receiveShadow = true;
        root.add(mesh);
        plots.set(idx, mesh);
      } else if (!wanted && marker) {
        root.remove(marker);
        plots.delete(idx);
      }
    });
    settled = true;
  }

  const facing = new Vector3();
  const turned = new Quaternion();

  /**
   * The parts that move: gauges, windows, badges, the bounce, the breeze,
   * the smoke. `env` is `{ night, sun, dt }`: how dark it is, the way to the
   * sun (or null when it is down), and how long since the last frame.
   */
  function update(current, now, env) {
    const { night, sun, dt } = env;
    windowLit.color.set(night > 0.5 ? '#ffd65c' : '#fff0b8');
    glowMaterial.opacity = night * 0.85;
    const blowing = turbineFactor(current.flow.wind);

    // A tracker's head faces the sun, as far over as its yoke lets it, and
    // lies flat at night.
    if (sun) facing.set(sun.x, Math.max(sun.y, 0.62), sun.z).normalize();
    else facing.copy(UP);
    turned.setFromUnitVectors(UP, facing);

    for (let idx = 0; idx < slots.length; idx += 1) {
      const slot = slots[idx];
      if (!slot) continue;
      const { thing, body } = slot;

      const age = (now - slot.born) / POP_SECONDS;
      if (age < 1.2) {
        body.scale.setScalar(
          Math.max(0.001, pop(Math.max(0, age))) * (slot.rest || 1),
        );
      }

      if (slot.part) {
        if (thing.kind === 'tracker') slot.part.quaternion.slerp(turned, 0.08);
        else {
          slot.spin += dt * (0.25 + blowing * 7);
          slot.part.rotation.z = slot.spin;
        }
      }
      if (slot.lamps) {
        const capacity = KINDS[thing.kind].capacityKwh;
        const lit =
          thing.charge < 0.05
            ? 0
            : Math.min(4, Math.ceil((thing.charge / capacity) * 4 - 1e-6));
        slot.lamps.forEach((lamp, i) => {
          lamp.material = i < lit ? lampOn : lampOff;
        });
      }
      if (slot.windows)
        slot.windows.material = thing.lit ? windowLit : windowDark;
      if (slot.glow) slot.glow.visible = thing.lit && night > 0.02;
      if (slot.badge) {
        slot.badge.visible = thing.live === false;
        if (slot.badge.visible) {
          slot.badge.position.y = slot.badgeY + Math.sin(now * 3 + idx) * 0.05;
        }
      }
      if (slot.sway !== undefined) {
        body.rotation.z = Math.sin(now * 1.3 + slot.sway) * 0.04;
        body.rotation.x = Math.cos(now * 0.9 + slot.sway) * 0.025;
      }
      if (slot.puffs) {
        // The smoke thickens and thins with the engine, and leans downwind.
        slot.smoke +=
          ((thing.running ? 1 : 0) - slot.smoke) * Math.min(1, dt * 2.5);
        slot.puffs.forEach((puff, i) => {
          const p = (now * 0.3 + i / PUFFS) % 1;
          const s = Math.sin(p * Math.PI) * (0.6 + p * 1.5) * slot.smoke;
          puff.visible = s > 0.02;
          puff.scale.setScalar(Math.max(0.001, s));
          puff.position.set(
            SMOKE_AT[0] + p * 0.5 + Math.sin(now + i * 2) * 0.04,
            SMOKE_AT[1] + p * 1.5,
            SMOKE_AT[2] + p * 0.2,
          );
        });
      }
    }

    const share = current.yesterday ? current.yesterday.clean : 0;
    tend(share);
    fly(share, now);
    sail(current, now);
  }

  return {
    sync,
    update,
    dispose() {
      for (let idx = 0; idx < slots.length; idx += 1) clear(idx);
      for (const marker of plots.values()) root.remove(marker);
      plots.clear();
      scene.remove(root);
      flowers.dispose();
      flowers.material.dispose();
      wingMaterial.dispose();
      lampOn.dispose();
      lampOff.dispose();
      windowLit.dispose();
      windowDark.dispose();
      badgeMaterial.dispose();
      badgeTexture.dispose();
      glowMaterial.dispose();
      glowTexture.dispose();
    },
  };
}
