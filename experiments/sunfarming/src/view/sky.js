// The sky and the light: what colour the day is at each hour, where the sun
// and the moon stand, how much cloud is over them, and a ring of clouds
// drifting round the island.
//
// One directional light does duty as both sun and moon. It is the sun from
// dawn to dusk and the moon the rest of the time, and its strength falls to
// nothing at both changeovers, so the swap is never seen. Where it stands
// comes from the rules (src/sim/sun.js), season and all, because the shadow
// it throws is the shade the rules charge for.

import {
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { createRng } from '../sim/rng.js';
import {
  arcDirection,
  isDaylight,
  moonArc,
  seasonAt,
  skyHour,
  sunArc,
} from '../sim/sun.js';
import { skyAt as weatherAt } from '../sim/weather.js';
import { blob, merge } from './shapes.js';

// The day in keyframes, on a clock that dawns at 6 and darkens at 18 (the
// season stretches the real day onto it). `light` and `power` are the sun or
// moon; `high` and `low` the two halves of the fill light (from the sky, and
// bounced off the ground); `sea` multiplies the water's colours; `night` is
// 1 in the dark.
// prettier-ignore
const KEYS = [
  { h: 0, sky: '#101a4a', light: '#a9bcff', power: 0.6, high: '#5a74d6', low: '#2b3580', fill: 1.9, sea: '#3f5cb0', night: 1 },
  { h: 4.6, sky: '#17225a', light: '#a9bcff', power: 0.45, high: '#5a74d6', low: '#2b3580', fill: 1.9, sea: '#3f5cb0', night: 1 },
  { h: 6, sky: '#f8b98f', light: '#ffb67c', power: 0, high: '#ffd9bb', low: '#a98aa6', fill: 2.6, sea: '#d9b4bd', night: 0.45 },
  { h: 7.4, sky: '#a9def8', light: '#fff0d0', power: 1.65, high: '#d6eeff', low: '#93b780', fill: 1.25, sea: '#f4f7ff', night: 0 },
  { h: 12, sky: '#6cc6f4', light: '#ffffff', power: 2.15, high: '#d6eeff', low: '#a0c88a', fill: 1.05, sea: '#ffffff', night: 0 },
  { h: 16.4, sky: '#8fd1f3', light: '#fff0d0', power: 1.7, high: '#d6eeff', low: '#93b780', fill: 1.25, sea: '#f8f4ff', night: 0 },
  { h: 18, sky: '#f8a271', light: '#ffa064', power: 0, high: '#ffc9a2', low: '#a98aa6', fill: 2.6, sea: '#e0aaa4', night: 0.45 },
  { h: 19.4, sky: '#3d3a80', light: '#a9bcff', power: 0.3, high: '#7474cc', low: '#3a3a80', fill: 2.0, sea: '#6466b4', night: 1 },
  { h: 21, sky: '#101a4a', light: '#a9bcff', power: 0.6, high: '#5a74d6', low: '#2b3580', fill: 1.9, sea: '#3f5cb0', night: 1 },
  { h: 24, sky: '#101a4a', light: '#a9bcff', power: 0.6, high: '#5a74d6', low: '#2b3580', fill: 1.9, sea: '#3f5cb0', night: 1 },
].map((k) => ({
  ...k,
  sky: new Color(k.sky),
  light: new Color(k.light),
  high: new Color(k.high),
  low: new Color(k.low),
  sea: new Color(k.sea),
}));

// What cloud does to the colours: everything drifts toward these.
const OVERCAST = new Color('#9fb0c0');
const OVERCAST_SEA = new Color('#7f93a6');
const OVERCAST_GROUND = new Color('#8f9a9c');
const CLOUD_WHITE = new Color('#ffffff');
const CLOUD_GREY = new Color('#aab4c0');

/** The colours of the sky at an hour of its own clock, blended into `out`. */
export function skyColours(hour, out) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= hour) i += 1;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (hour - a.h) / (b.h - a.h)));
  out.sky.copy(a.sky).lerp(b.sky, t);
  out.light.copy(a.light).lerp(b.light, t);
  out.high.copy(a.high).lerp(b.high, t);
  out.low.copy(a.low).lerp(b.low, t);
  out.sea.copy(a.sea).lerp(b.sea, t);
  out.power = a.power + (b.power - a.power) * t;
  out.fill = a.fill + (b.fill - a.fill) * t;
  out.night = a.night + (b.night - a.night) * t;
  return out;
}

function cloud(rng) {
  const parts = [];
  const puffs = 3 + Math.floor(rng() * 3);
  let x = 0;
  for (let i = 0; i < puffs; i += 1) {
    const r = 0.9 + rng() * 0.9;
    parts.push(
      blob(
        r,
        '#ffffff',
        [x, r * 0.25, (rng() - 0.5) * 0.9],
        [1.25, 0.62, 1],
        2,
      ),
    );
    x += r * (0.9 + rng() * 0.5);
  }
  const geometry = merge(parts);
  geometry.translate(-x / 2, 0, 0);
  return geometry;
}

export function createSky(scene, materials) {
  const state = {
    sky: new Color(),
    light: new Color(),
    high: new Color(),
    low: new Color(),
    sea: new Color(),
    power: 0,
    fill: 0,
    night: 0,
    // How overcast it is, 0 (clear) to 1, eased so the weather never snaps.
    cloud: 0,
  };
  const direction = new Vector3();
  const other = new Vector3();
  const aim = { x: 0, y: 0, z: 0 };
  const ember = new Color('#ff6a33');

  const fill = new HemisphereLight('#ffffff', '#ffffff', 1);
  scene.add(fill);

  const sun = new DirectionalLight('#ffffff', 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // The discs in the sky. They ride with the camera, far off along the way
  // the light comes from, so they are always "at the horizon's distance".
  const discGeometry = new CircleGeometry(1, 40);
  const sunDisc = new Mesh(
    discGeometry,
    new MeshBasicMaterial({ color: '#fff6c4', fog: false, depthWrite: false }),
  );
  const moonDisc = new Mesh(
    discGeometry,
    new MeshBasicMaterial({ color: '#eef2ff', fog: false, depthWrite: false }),
  );
  sunDisc.renderOrder = -2;
  moonDisc.renderOrder = -2;
  scene.add(sunDisc, moonDisc);

  // Clouds, in a wide ring round the island so they never sit over the
  // tiles being built on.
  const rng = createRng(4242);
  const cloudMaterial = materials.solid('#ffffff', {
    emissive: '#9fb4d8',
    emissiveIntensity: 0.3,
  });
  const clouds = new Group();
  clouds.name = 'clouds';
  const cloudGeometries = [];
  for (let i = 0; i < 14; i += 1) {
    const geometry = cloud(rng);
    cloudGeometries.push(geometry);
    const mesh = new Mesh(geometry, cloudMaterial);
    const angle = (i / 14) * Math.PI * 2 + rng() * 0.4;
    const radius = 20 + rng() * 24;
    mesh.position.set(
      Math.cos(angle) * radius,
      4.5 + rng() * 5,
      Math.sin(angle) * radius,
    );
    mesh.rotation.y = rng() * Math.PI;
    mesh.userData.size = 0.9 + rng() * 0.9;
    clouds.add(mesh);
  }
  scene.add(clouds);

  return {
    state,
    /** The way to the light right now, from the island. */
    direction,
    /** Whether that light is the sun (true) or the moon. */
    day: true,
    /** Size the shadow's reach to the island being drawn. */
    fit(size) {
      const reach = size * 0.62 + 4;
      sun.shadow.camera.left = -reach;
      sun.shadow.camera.right = reach;
      sun.shadow.camera.top = reach;
      sun.shadow.camera.bottom = -reach;
      sun.shadow.camera.updateProjectionMatrix();
    },
    update(game, camera, elapsed, dt) {
      const { time, spec } = game;
      const season = seasonAt(spec, time);
      skyColours(skyHour(time, season), state);

      // Cloud takes the colour out of the sky and most of the sun's light,
      // and gives a little of it back as an even grey fill.
      const overcast = 1 - weatherAt(spec, time).sun;
      state.cloud +=
        (overcast - state.cloud) *
        Math.min(1, (dt || 0) * 0.6 + (elapsed < 0.5 ? 1 : 0));
      const dim = state.cloud * (1 - state.night);
      state.sky.lerp(OVERCAST, dim * 0.9);
      state.high.lerp(OVERCAST, dim * 0.75);
      state.low.lerp(OVERCAST_GROUND, dim * 0.6);
      state.sea.lerp(OVERCAST_SEA, dim * 0.95);
      state.power *= 1 - dim * 0.82;
      state.fill *= 1 + dim * 0.28;
      scene.background = state.sky;

      const day = isDaylight(time, season);
      this.day = day;
      const arc = day ? sunArc(time, season) : moonArc(time, season);
      arcDirection(arc, season.lean, aim);
      direction.set(aim.x, aim.y, aim.z);
      sun.position.copy(direction).multiplyScalar(55);
      sun.target.position.set(0, 0, 0);
      sun.color.copy(state.light);
      sun.intensity = state.power;
      fill.color.copy(state.high);
      fill.groundColor.copy(state.low);
      fill.intensity = state.fill;

      // Both discs are always somewhere on their arcs; the one that is down
      // is simply below the sea.
      const place = (disc, at, size) => {
        const phi = at * Math.PI;
        other.set(
          Math.cos(phi),
          Math.sin(phi) * Math.cos(season.lean),
          Math.sin(phi) * Math.sin(season.lean),
        );
        disc.visible = at > -0.04 && at < 1.04;
        disc.position.copy(camera.position).addScaledVector(other, 600);
        disc.scale.setScalar(size);
        disc.lookAt(camera.position);
      };
      const sunAt = sunArc(time, season);
      place(sunDisc, sunAt, 30 * (1 - state.cloud * 0.5));
      place(moonDisc, day ? -1 : moonArc(time, season), 22);
      // The sun reddens as it gets low, and pales behind cloud.
      const low = Math.max(
        0,
        1 - Math.sin(Math.min(1, Math.max(0, sunAt)) * Math.PI) * 2.2,
      );
      sunDisc.material.color
        .set('#fff6c4')
        .lerp(ember, low * 0.8)
        .lerp(OVERCAST, state.cloud * 0.7);

      // More, bigger, greyer clouds on a grey day.
      clouds.rotation.y = elapsed * (0.006 + state.cloud * 0.01);
      cloudMaterial.color.copy(CLOUD_WHITE).lerp(CLOUD_GREY, state.cloud);
      cloudMaterial.emissiveIntensity = 0.3 - state.night * 0.22;
      clouds.children.forEach((mesh, i) => {
        const shown = i < 8 + Math.round(state.cloud * 6);
        mesh.visible = shown;
        mesh.scale.setScalar(mesh.userData.size * (1 + state.cloud * 0.9));
      });
    },
    dispose() {
      scene.remove(fill, sun, sun.target, sunDisc, moonDisc, clouds);
      sun.shadow.map?.dispose();
      discGeometry.dispose();
      sunDisc.material.dispose();
      moonDisc.material.dispose();
      cloudMaterial.dispose();
      for (const g of cloudGeometries) g.dispose();
    },
  };
}
