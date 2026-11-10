// What stands on the island, kept in step with the game.
//
// The game is the truth and this only mirrors it: every frame it looks for
// tiles whose `thing` is no longer the one it drew, and redraws those. There
// are no "building placed" messages to miss or apply twice; loading a save,
// starting over and placing one panel all go through the same comparison.

import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';
import { KINDS } from '../sim/catalog.js';
import { neighbours } from '../sim/island.js';
import { conducts } from '../sim/network.js';
import { tileX, tileY, tileZ } from './layout.js';
import { WIRE_ANCHOR } from './models.js';
import { bar, merge } from './shapes.js';
import { INK } from './toon.js';

const WIRE = '#33304a';
const STRIP = '#4a4f66';
const POP_SECONDS = 0.38;

// A little overshoot on the way in: things land with a bounce.
function pop(t) {
  if (t >= 1) return 1;
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

// The badge over anything that makes or stores power but can't reach a
// house: a yellow disc with a struck-through bolt.
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

// The pool of warm light round a house whose lamps are on, seen after dark.
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

  function model(kind, variant) {
    const { geometry, outline } = models.get(kind, variant);
    const mesh = new Mesh(geometry, materials.toon);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (outline) mesh.add(new Mesh(outline, materials.outline));
    return mesh;
  }

  function build(idx, thing, now) {
    const group = new Group();
    group.position.set(tileX(idx, size), tileY(terrain, idx), tileZ(idx, size));
    const body = model(thing.kind, thing.variant);
    group.add(body);
    const slot = {
      thing,
      group,
      body,
      born: settled ? now : -1e9,
      links: null,
    };

    if (thing.kind === 'battery') {
      const lamp = models.get('batteryLamp').geometry;
      slot.lamps = [0, 1, 2, 3].map((i) => {
        const mesh = new Mesh(lamp, lampOff);
        mesh.position.set(-0.21 + i * 0.14, 0.535, 0.06);
        body.add(mesh);
        return mesh;
      });
    } else if (thing.kind === 'house') {
      slot.windows = new Mesh(models.get('houseWindows').geometry, windowDark);
      body.add(slot.windows);
      body.rotation.y = (Math.abs(thing.variant) % 4) * (Math.PI / 2);
      slot.glow = new Sprite(glowMaterial);
      slot.glow.scale.setScalar(2.6);
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
    }

    if (thing.kind === 'panel' || thing.kind === 'battery') {
      slot.badge = new Sprite(badgeMaterial);
      slot.badge.scale.setScalar(0.42);
      slot.badge.position.y = thing.kind === 'panel' ? 1.0 : 1.05;
      slot.badge.renderOrder = 10;
      slot.badge.visible = false;
      group.add(slot.badge);
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
  function relink(game, idx) {
    const slot = slots[idx];
    if (!slot) return;
    dropLinks(slot);
    const thing = game.things[idx];
    if (!conducts(thing)) return;
    const parts = [];
    const x = idx % size;
    const z = Math.floor(idx / size);
    const here = tileY(terrain, idx);
    for (const n of neighbours(idx, size)) {
      const other = game.things[n];
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

  /** Redraw every tile whose thing has changed since it was last drawn. */
  function sync(game, now) {
    const touched = new Set();
    for (let idx = 0; idx < slots.length; idx += 1) {
      const thing = game.things[idx];
      const slot = slots[idx];
      if ((slot?.thing || null) === (thing || null)) continue;
      clear(idx);
      if (thing) slots[idx] = build(idx, thing, now);
      touched.add(idx);
      for (const n of neighbours(idx, size)) touched.add(n);
    }
    for (const idx of touched) relink(game, idx);

    // The plots the village hasn't built on yet are pegged out.
    game.plots.forEach((idx, i) => {
      const wanted = i >= game.houses && !game.things[idx];
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

  /** The parts that move: gauges, windows, badges, the bounce, the breeze. */
  function update(game, now, night) {
    windowLit.color.set(night > 0.5 ? '#ffd65c' : '#fff0b8');
    glowMaterial.opacity = night * 0.85;
    const capacity = KINDS.battery.capacityKwh;
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

      if (slot.lamps) {
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
          slot.badge.position.y =
            (thing.kind === 'panel' ? 1.0 : 1.05) +
            Math.sin(now * 3 + idx) * 0.05;
        }
      }
      if (slot.sway !== undefined) {
        body.rotation.z = Math.sin(now * 1.3 + slot.sway) * 0.04;
        body.rotation.x = Math.cos(now * 0.9 + slot.sway) * 0.025;
      }
    }
  }

  return {
    sync,
    update,
    dispose() {
      for (let idx = 0; idx < slots.length; idx += 1) clear(idx);
      for (const marker of plots.values()) root.remove(marker);
      plots.clear();
      scene.remove(root);
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
