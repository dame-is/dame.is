// The bench: plates, a clock, a camera and a hand.
//
// This is the whole workbench without the page around it. It owns the WebGL
// context, grows the plates, draws them, and turns what a pointer does on
// the canvas into things that happen to a plate. The page (Culturing.jsx)
// reads a snapshot of it and calls its methods; nothing in here knows about
// React, and none of the per-frame work goes through it.

import { detectCapabilities } from './gl.js';
import { createSimulation } from './simulation.js';
import { createRenderer, GEL_Y, OUTER_RADIUS } from './renderer.js';
import { DETAILS, DISH, gridSize, hexToLinear } from './units.js';
import {
  benchLayout,
  fitDistance,
  orbit,
  pickPlane,
  project,
} from './camera.js';
import {
  act,
  advance,
  begin,
  behind,
  draw as drawPart,
  record,
  replayOf,
  setEnv as setLiveEnv,
  settle,
  tickReplay,
} from './incubate.js';
import {
  cleanDish,
  createDish,
  encodeDish,
  MAX_HOURS,
  packDish,
  RECIPE_VERSION,
} from './recipe.js';
import { OPENING_BENCH, RECIPES, recipeById } from './recipes.js';
import { cultureById } from './cultures.js';
import { additionById } from './additions.js';
import { randomDish } from './chance.js';
import {
  DEFAULT_DROP,
  DROPS,
  dropRadius,
  FULL,
  SPOT_RADIUS,
  unmixed,
  wetDropsUnder,
} from './tools.js';
import { SLOTS } from './pack.js';

export const STORAGE_KEY = 'dame.culturing.bench';
export const MAX_DISHES = 8;

/** Incubator hours per second of watching. */
export const SPEEDS = [
  { value: 0.5, label: '30 min/s' },
  { value: 2, label: '2 h/s' },
  { value: 8, label: '8 h/s' },
  { value: 24, label: '1 day/s' },
];

/** The four ways of looking at a plate (shaders/scene.js). */
export const LIGHTS = [
  {
    value: 0,
    label: 'Bench',
    hint: 'A lamp from one side: relief, texture, sheen.',
  },
  {
    value: 1,
    label: 'Light table',
    hint: 'Lit from underneath: density, and whatever is dissolved in the gel.',
  },
  {
    value: 2,
    label: 'Ultraviolet',
    hint: 'A 365 nm lamp in a dark room: only what fluoresces.',
  },
  { value: 3, label: 'Dark', hint: 'Nothing but what the plate gives off.' },
];

const DEFAULT_VIEW = {
  speed: 2,
  light: 0,
  stretch: 3,
  lampAz: 215,
  lampEl: 36,
  drop: DEFAULT_DROP,
  detail: 'standard',
};

/** The bench top: matte black, like the epoxy of a real one. */
const BENCH_COLOUR = hexToLinear('#141517');

const RAD = Math.PI / 180;
const BENCH_ELEVATION = 60 * RAD;
const PLATE_ELEVATION = 50 * RAD;
const MIN_ELEVATION = 12 * RAD;
const MAX_ELEVATION = 89 * RAD;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.3;
/** A drag shorter than this, in CSS px, is a click. */
const CLICK_SLOP = 5;
/** Points along a stroke are kept at least this far apart, mm. */
const STROKE_SPACING = 0.7;
/** A strip dragged less than this far, mm, is set down as if touched. */
const STRIP_DRAG = 3;
/** The most simulation steps one frame may spend, across every plate. */
const MAX_BUDGET = 40;

/** Whether this is a device to go easy on: a phone, or little memory. */
function modestDevice() {
  const coarse =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small =
    Math.min(window.screen?.width || 1e4, window.screen?.height || 1e4) < 720;
  const lowMemory = (navigator.deviceMemory || 8) <= 4;
  return coarse || small || lowMemory;
}

function dishFromRecipe(id) {
  const recipe = recipeById(id);
  if (!recipe) return createDish();
  // The recipe's own events are copied: a plate's record is its to change.
  const dish = cleanDish({
    ...recipe.dish,
    events: recipe.dish.events.map((e) => ({ ...e })),
    hours: recipe.start || 0,
    recipe: id,
  });
  return dish;
}

function openingDishes() {
  return OPENING_BENCH.map((entry) =>
    entry.recipe ? dishFromRecipe(entry.recipe) : createDish(entry.medium),
  );
}

/**
 * Whether a plate's record holds anything done to it by hand, as far as the
 * record can say. A recipe off the shelf with nothing added is not; neither
 * is a plate with nothing on it. Anything else might be somebody's work,
 * and is asked after before it is thrown away.
 */
function workedOn(dish) {
  if (!dish.events.length) return false;
  const recipe = dish.recipe ? recipeById(dish.recipe) : null;
  return !(recipe && recipe.dish.events.length === dish.events.length);
}

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || raw.v !== RECIPE_VERSION || !Array.isArray(raw.dishes))
      return null;
    const dishes = raw.dishes.slice(0, MAX_DISHES).map(cleanDish);
    if (!dishes.length) return null;
    return { ...raw, dishes };
  } catch {
    return null;
  }
}

/**
 * Create the bench on a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {object} [options.incoming]  a dish that arrived in a link
 * @param {boolean} [options.playing]  false to start with the incubator
 *   stopped; plates are still grown back to where they were left
 * @returns the bench, or `{ error }` when this device can't run it
 */
export function createBench(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return { error: 'webgl2' };
  const caps = detectCapabilities(gl);
  if (!caps.ok) return { error: 'float' };

  const saved = loadSaved();
  const modest = modestDevice();
  const known = (detail) => DETAILS.some((d) => d.value === detail);

  let sim;
  let renderer;
  /** The simulation and what draws it, at a level of detail. */
  function build(detail) {
    sim = createSimulation(gl, caps, gridSize(detail, modest));
    renderer = createRenderer(gl, sim);
  }
  let startDetail = known(saved?.detail) ? saved.detail : DEFAULT_VIEW.detail;
  try {
    build(startDetail);
  } catch (err) {
    // The finer grid asks more of a device than the standard one, and it
    // was this device that was asked for it: try once more without.
    if (startDetail === DEFAULT_VIEW.detail) {
      console.error('[culturing] could not start', err);
      return { error: 'shader' };
    }
    startDetail = DEFAULT_VIEW.detail;
    try {
      build(startDetail);
    } catch (again) {
      console.error('[culturing] could not start', again);
      return { error: 'shader' };
    }
  }

  // ------------------------------------------------------------ state

  const view = {
    ...DEFAULT_VIEW,
    ...(saved
      ? {
          speed: SPEEDS.some((s) => s.value === saved.speed)
            ? saved.speed
            : DEFAULT_VIEW.speed,
          stretch: Number.isFinite(saved.stretch)
            ? saved.stretch
            : DEFAULT_VIEW.stretch,
          lampAz: Number.isFinite(saved.lampAz)
            ? saved.lampAz
            : DEFAULT_VIEW.lampAz,
          lampEl: Number.isFinite(saved.lampEl)
            ? saved.lampEl
            : DEFAULT_VIEW.lampEl,
          drop: DROPS.some((d) => d.value === saved.drop)
            ? saved.drop
            : DEFAULT_VIEW.drop,
        }
      : null),
    detail: startDetail,
  };
  let entries = [];
  let selected = saved
    ? Math.min(saved.selected | 0, saved.dishes.length - 1)
    : 0;
  let mode = 'bench'; // 'bench' (all of them) or 'plate' (one, up close)
  let playing = options.playing !== false;
  let tool = null;
  let notice = null;
  let noticeTimer = 0;
  let noticeCount = 0;
  let disposed = false;
  let lost = false;
  let dirty = true; // the scene needs drawing again
  let lightDirty = true; // every plate's display needs composing again

  function makeEntry(dish, touched = false) {
    const plate = sim.createPlate();
    return {
      dish,
      plate,
      live: begin(sim, plate, dish),
      display: renderer.createDisplay(),
      centre: [0, 0],
      // The hour it is being grown back to: where it stood when it was put
      // on the bench. Stopping the incubator never takes it below this.
      owed: dish.hours,
      // Stopped part-way back to that hour, until the incubator starts.
      waiting: false,
      // Something on it was done by hand, and would be lost with it.
      touched,
      // Being watched again from the pour (incubate.js replayOf), or null.
      replay: null,
    };
  }

  function restart(entry) {
    // A replay cut short by something else being done to the plate: the
    // plate goes back to being as old as it was.
    if (entry.replay) {
      entry.dish.hours = Math.max(entry.dish.hours, entry.replay.goal);
    }
    entry.live = begin(sim, entry.plate, entry.dish);
    entry.owed = entry.dish.hours;
    entry.waiting = false;
    entry.replay = null;
    lightDirty = true;
  }

  entries = saved
    ? saved.dishes.map((dish) => makeEntry(dish, workedOn(dish)))
    : openingDishes().map((dish) => makeEntry(dish));
  // A plate that arrived in a link takes a place on the bench: a new one
  // if there is room, otherwise an untouched plate's. Nothing anyone has
  // grown is thrown away for it.
  let incomingRefused = false;
  if (options.incoming) {
    const blank = entries.map((e) => e.dish.events.length).lastIndexOf(0);
    if (entries.length < MAX_DISHES) {
      entries.push(makeEntry(options.incoming, true));
      selected = entries.length - 1;
      mode = 'plate';
    } else if (blank >= 0) {
      entries[blank].dish = options.incoming;
      entries[blank].touched = true;
      restart(entries[blank]);
      selected = blank;
      mode = 'plate';
    } else {
      incomingRefused = true;
    }
  }

  // ----------------------------------------------------------- camera

  let width = 1;
  let height = 1;
  let layout = benchLayout(entries.length, 1);
  const user = {
    benchAz: 0,
    benchEl: BENCH_ELEVATION,
    az: 0,
    el: PLATE_ELEVATION,
    zoom: 1,
  };
  const cam = { target: [0, 0, 0], az: 0, el: BENCH_ELEVATION, dist: 800 };
  let camera = null;

  function relayout() {
    layout = benchLayout(entries.length, width / height);
    entries.forEach((entry, i) => {
      entry.centre = layout.centres[i];
    });
  }

  function cameraGoal() {
    const aspect = width / height;
    if (mode === 'plate' && entries[selected]) {
      const [x, z] = entries[selected].centre;
      return {
        target: [x, GEL_Y, z],
        az: user.az,
        el: user.el,
        dist:
          fitDistance(OUTER_RADIUS, OUTER_RADIUS, user.el, aspect, 1.1) *
          user.zoom,
      };
    }
    return {
      target: [0, 0, 0],
      az: user.benchAz,
      el: user.benchEl,
      dist: fitDistance(layout.halfW, layout.halfH, user.benchEl, aspect, 1.02),
    };
  }

  /** Ease the camera toward where it should be. True while it is moving. */
  function moveCamera(seconds, snap) {
    const goal = cameraGoal();
    const k = snap ? 1 : 1 - Math.exp(-seconds / 0.16);
    let moving = false;
    const ease = (from, to) => {
      const next = from + (to - from) * k;
      if (Math.abs(to - next) > 1e-4 * (1 + Math.abs(to))) moving = true;
      return next;
    };
    cam.target = cam.target.map((v, i) => ease(v, goal.target[i]));
    // The short way round.
    let dAz = goal.az - cam.az;
    dAz -= Math.round(dAz / (2 * Math.PI)) * 2 * Math.PI;
    cam.az = ease(cam.az, cam.az + dAz);
    cam.el = ease(cam.el, goal.el);
    cam.dist = ease(cam.dist, goal.dist);
    camera = orbit({
      target: cam.target,
      azimuth: cam.az,
      elevation: cam.el,
      distance: cam.dist,
      aspect: width / height,
    });
    return moving;
  }

  // ------------------------------------------------------------ store

  const listeners = new Set();
  const frameListeners = new Set();
  let snapshot = null;
  let lastEmit = 0;

  function buildSnapshot() {
    return {
      mode,
      selected,
      playing,
      speed: view.speed,
      light: view.light,
      stretch: view.stretch,
      lampAz: view.lampAz,
      lampEl: view.lampEl,
      drop: view.drop,
      detail: view.detail,
      tool,
      notice,
      lost,
      size: sim.grid.size,
      canAdd: entries.length < MAX_DISHES,
      canRemove: entries.length > 1,
      dishes: entries.map(({ dish, live, waiting, touched, replay }) => ({
        medium: dish.medium,
        agar: live.medium.agar,
        nutrient: live.medium.nutrient,
        env: live.env,
        hours: live.plate.hours,
        goal: replay ? replay.goal : dish.hours,
        // Being watched again from the pour.
        replaying: Boolean(replay),
        // Re-growing from its recipe, not being watched.
        catching: !replay && behind(live) > Math.max(1.5, view.speed),
        // Stopped before it got back there.
        waiting,
        held: dish.held,
        touched,
        slots: live.slots.slice(),
        full: live.slots.length >= SLOTS,
        events: dish.events,
        recipe: dish.recipe || null,
      })),
    };
  }

  function emit() {
    if (disposed) return;
    snapshot = buildSnapshot();
    lastEmit = performance.now();
    for (const listener of listeners) listener();
    scheduleSave();
  }

  function say(text) {
    noticeCount += 1;
    notice = { id: noticeCount, text };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice = null;
      emit();
    }, 5000);
    emit();
  }

  // ------------------------------------------------------------- save

  let saveTimer = 0;
  function save() {
    saveTimer = 0;
    if (disposed) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: RECIPE_VERSION,
          selected,
          speed: view.speed,
          stretch: view.stretch,
          lampAz: view.lampAz,
          lampEl: view.lampEl,
          detail: view.detail,
          drop: view.drop,
          dishes: entries.map((entry) => packDish(asRecorded(entry))),
        }),
      );
    } catch {
      // Private mode, or full: the bench just isn't remembered.
    }
  }
  /** A plate's record at its true age: a replay in progress winds the
   *  clock back, and that is not something to write down or send. */
  function asRecorded({ dish, replay }) {
    return replay ? { ...dish, hours: replay.goal } : dish;
  }

  function scheduleSave() {
    if (!saveTimer) saveTimer = setTimeout(save, 1200);
  }

  // ------------------------------------------------------------- loop

  let raf = 0;
  let last = 0;
  let frameTime = 1 / 60;
  let budget = 6;
  let turn = 0;
  let onScreen = true;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w === canvas.width && h === canvas.height) return false;
    canvas.width = w;
    canvas.height = h;
    width = w;
    height = h;
    relayout();
    dirty = true;
    return true;
  }

  function lampVector() {
    const az = view.lampAz * RAD;
    const el = view.lampEl * RAD;
    return [
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    ];
  }

  function frame(time) {
    raf = requestAnimationFrame(frame);
    if (lost || !onScreen) {
      last = time;
      return;
    }
    const seconds = Math.min(0.1, Math.max(0, (time - last) / 1000));
    last = time;
    const first = camera === null;
    resize();

    // How much simulating a frame can afford: more while frames come in
    // on time, less as soon as they don't.
    frameTime += (seconds - frameTime) * 0.1;
    if (frameTime > 0.024) budget = Math.max(1, budget * 0.9);
    else if (frameTime < 0.0185) budget = Math.min(MAX_BUDGET, budget + 0.2);

    // The clocks. A plate that is watched keeps time with the wall; one
    // that is behind its recipe (just restored) is left to catch up.
    const lead = Math.max(0.3, view.speed * 0.6);
    if (playing) {
      for (const { dish, live, replay } of entries) {
        if (replay || dish.held || behind(live) > lead) continue;
        dish.hours = Math.min(MAX_HOURS, dish.hours + seconds * view.speed);
      }
    }
    // A plate being replayed keeps its own time, incubator or no incubator,
    // until it is back at the hour it stood at.
    for (const entry of entries) {
      if (!entry.replay) continue;
      if (tickReplay(entry.live, entry.replay, seconds)) {
        entry.replay = null;
        entry.waiting = false;
        emit();
      }
    }

    // The steps: the plate being looked at first, then the rest in turn.
    let left = Math.max(1, Math.round(budget));
    const order = entries.map((_, i) => i).filter((i) => i !== selected);
    turn = (turn + 1) % Math.max(1, order.length);
    const rotated = order.slice(turn).concat(order.slice(0, turn));
    const queue = entries[selected] ? [selected, ...rotated] : rotated;
    queue.forEach((index, place) => {
      if (left <= 0) return;
      const entry = entries[index];
      if (entry.waiting && !entry.replay) return;
      const share = place === 0 ? Math.ceil(left * 0.7) : Math.ceil(left / 2);
      left -= advance(sim, entry.live, Math.max(1, Math.min(left, share)));
    });

    const moving = moveCamera(seconds, first);

    // Draw only what has changed.
    const light = {
      mode: view.light,
      lamp: lampVector(),
      stretch: view.stretch,
    };
    let composed = false;
    for (const entry of entries) {
      if (entry.live.stale || lightDirty) {
        renderer.compose(
          entry.live.plate,
          entry.display,
          entry.live.look,
          light,
        );
        entry.live.stale = false;
        composed = true;
      }
    }
    lightDirty = false;
    if (composed || moving || dirty) {
      renderer.draw({
        width,
        height,
        viewProj: camera.viewProj,
        eye: camera.eye,
        light,
        bench: BENCH_COLOUR,
        dishes: entries.map((entry, i) => ({
          centre: entry.centre,
          display: entry.display,
          close: mode === 'plate' && i === selected,
        })),
      });
      dirty = false;
      if (frameListeners.size) {
        const places = entries.map((entry) => place(entry.centre));
        for (const listener of frameListeners) listener(places);
      }
    }

    // The page hears about the clocks a few times a second, not sixty.
    if (time - lastEmit > 250 && (composed || snapshot === null)) emit();
  }

  /** Where a dish is on the canvas, in CSS pixels: its near edge. */
  function place(centre) {
    const rect = { w: canvas.clientWidth, h: canvas.clientHeight };
    const front = project(camera, [centre[0], 0, centre[1] + OUTER_RADIUS]);
    const middle = project(camera, [centre[0], GEL_Y, centre[1]]);
    return {
      x: ((middle[0] + 1) / 2) * rect.w,
      y: ((1 - front[1]) / 2) * rect.h,
      cy: ((1 - middle[1]) / 2) * rect.h,
    };
  }

  // ------------------------------------------------------------- hand

  /** What is under a point on the canvas: which dish, and where on it. */
  function hit(clientX, clientY) {
    if (!camera) return null;
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const at = pickPlane(camera, nx, ny, GEL_Y);
    if (!at) return null;
    let best = null;
    entries.forEach((entry, index) => {
      const dx = at[0] - entry.centre[0];
      const dz = at[1] - entry.centre[1];
      const r = Math.hypot(dx, dz);
      if (r <= OUTER_RADIUS + 3 && (!best || r < best.r)) {
        // Plate space: x to the right, y away from the viewer.
        best = { index, r, mm: [dx, -dz], onGel: r <= DISH.radius - 0.4 };
      }
    });
    return best;
  }

  const pointers = new Map();
  let gesture = null;

  function beginStroke(index, mm) {
    const entry = entries[index];
    if (!tool || !entry) return null;
    if (tool.kind === 'culture') {
      const { slots } = entry.live;
      if (!slots.includes(tool.id) && slots.length >= SLOTS) {
        say(FULL);
        return null;
      }
      return {
        entry,
        event: {
          do: 'streak',
          culture: tool.id,
          seed: (Math.random() * 1e6) | 0,
          path: [mm],
        },
        segments: 0,
        draws: true,
      };
    }
    const item = additionById(tool.id);
    if (!item) return null;
    return {
      entry,
      event: { do: 'add', addition: tool.id, path: [mm] },
      segments: 0,
      // Anything off the tray can be dragged: a blade cuts, a loop
      // scrapes, a drop or a dye is drawn as a line, and a disc is laid
      // down as a ribbon of soaked paper. A touch sets one down. A strip
      // is laid whole when the hand lifts, pointing the way it was dragged.
      draws: !item.strip,
      strip: item.strip || null,
    };
  }

  function extendStroke(stroke, mm) {
    if (!stroke.draws) return;
    const { path } = stroke.event;
    const tail = path[path.length - 1];
    if (Math.hypot(mm[0] - tail[0], mm[1] - tail[1]) < STROKE_SPACING) return;
    if (path.length >= 400) return;
    path.push(mm);
    const result = drawPart(
      sim,
      stroke.entry.live,
      stroke.event,
      stroke.segments,
    );
    if (result.refused) say(result.refused);
    else stroke.segments = result.segments;
  }

  /** A drop of a culture, the size the hand is set to leave. */
  function dropOf(cultureId, x, y, seed = (Math.random() * 1e6) | 0) {
    const event = { do: 'spot', culture: cultureId, seed, x, y };
    const radius = dropRadius(view.drop);
    if (radius !== SPOT_RADIUS) event.size = radius;
    return event;
  }

  /**
   * Put a drop on a plate. One that lands in another culture's drop while
   * that is still wet mixes with it (tools.js): both are written down as
   * one mixed drop, and since the first was put down whole, the plate is
   * grown again from its record, which is the work of a moment that early.
   * Returns the reason if it was refused.
   */
  function putDrop(entry, event) {
    const { dish, live } = entry;
    const at = Math.floor(live.plate.hours * 1000) / 1000;
    const under = wetDropsUnder(dish.events.slice(0, live.cursor), {
      ...event,
      at,
    });
    if (!under.length) return act(sim, live, event);
    if (!live.slots.includes(event.culture) && live.slots.length >= SLOTS) {
      return FULL;
    }
    const whole = under.filter((i) => !dish.events[i].mixed);
    if (!whole.length) return act(sim, live, { ...event, mixed: true });
    for (const i of whole) dish.events[i] = { ...dish.events[i], mixed: true };
    dish.events.splice(live.cursor, 0, { ...event, mixed: true, at });
    dish.hours = Math.max(dish.hours, live.plate.hours);
    restart(entry);
    dirty = true;
    return null;
  }

  function endStroke(stroke, mm) {
    const { entry, event } = stroke;
    if (event.path.length > 1) {
      record(entry.live, event);
      entry.touched = true;
      emit();
      return;
    }
    if (stroke.strip) {
      const [start] = event.path;
      const run = Math.hypot(mm[0] - start[0], mm[1] - start[1]);
      if (run > STRIP_DRAG) {
        const k = stroke.strip.length / run;
        const end = [
          start[0] + (mm[0] - start[0]) * k,
          start[1] + (mm[1] - start[1]) * k,
        ];
        const round = (v) => Math.round(v * 100) / 100;
        const refused = act(sim, entry.live, {
          do: 'add',
          addition: event.addition,
          path: [start, end].map((p) => p.map(round)),
        });
        if (refused) say(refused);
        else entry.touched = true;
        emit();
        return;
      }
    }
    // Never dragged: a single touch of the loop, or something set down.
    const [x, y] = stroke.draws || stroke.strip ? event.path[0] : mm;
    const refused =
      event.do === 'streak'
        ? putDrop(entry, dropOf(event.culture, x, y, event.seed))
        : act(sim, entry.live, { do: 'add', addition: event.addition, x, y });
    if (refused) say(refused);
    else entry.touched = true;
    emit();
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // A second finger: whatever the first was doing, this is now a pinch.
      if (gesture?.stroke?.event.path.length > 1) endStroke(gesture.stroke);
      const [a, b] = [...pointers.values()];
      gesture = {
        kind: 'pinch',
        span: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: user.zoom,
        mid: [(a.x + b.x) / 2, (a.y + b.y) / 2],
      };
      return;
    }
    const under = hit(e.clientX, e.clientY);
    const stroke =
      mode === 'plate' && under && under.index === selected && under.onGel
        ? beginStroke(under.index, under.mm)
        : null;
    gesture = {
      kind: stroke ? 'stroke' : 'orbit',
      stroke,
      under,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      if (mode === 'plate') {
        user.zoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, gesture.zoom * (gesture.span / Math.max(span, 1))),
        );
      }
      turnBy(mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
      gesture.mid = mid;
      dirty = true;
      return;
    }
    const dx = e.clientX - gesture.lastX;
    const dy = e.clientY - gesture.lastY;
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;
    if (
      Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) >
      CLICK_SLOP
    ) {
      gesture.moved = true;
    }
    if (gesture.kind === 'stroke') {
      const under = hit(e.clientX, e.clientY);
      if (under && under.index === selected && under.onGel) {
        extendStroke(gesture.stroke, under.mm);
        gesture.under = under;
      }
      return;
    }
    if (gesture.moved) turnBy(dx, dy);
  }

  function onPointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    canvas.releasePointerCapture?.(e.pointerId);
    const done = gesture;
    if (!done) return;
    if (done.kind === 'pinch') {
      if (pointers.size < 2) gesture = null;
      return;
    }
    gesture = null;
    if (done.kind === 'stroke') {
      endStroke(done.stroke, done.under.mm);
      return;
    }
    if (done.moved || e.type === 'pointercancel') return;
    // A click: on a dish it picks that dish up; off them all, in the plate
    // view, it puts the plate back down.
    const under = hit(e.clientX, e.clientY);
    if (under) {
      if (under.index !== selected || mode !== 'plate') enter(under.index);
      else if (tool && !under.onGel) say('The loop only reaches the gel.');
    } else if (mode === 'plate') {
      leave();
    }
  }

  /** Turn the view by a drag of so many CSS pixels. */
  function turnBy(dx, dy) {
    const k = 0.006;
    if (mode === 'plate') {
      user.az -= dx * k;
      user.el = Math.min(
        MAX_ELEVATION,
        Math.max(MIN_ELEVATION, user.el + dy * k),
      );
    } else {
      user.benchAz = Math.min(0.9, Math.max(-0.9, user.benchAz - dx * k));
      user.benchEl = Math.min(
        MAX_ELEVATION,
        Math.max(32 * RAD, user.benchEl + dy * k),
      );
    }
    dirty = true;
  }

  function zoomBy(factor) {
    if (mode !== 'plate') {
      if (factor < 1 && entries[selected]) enter(selected);
      return;
    }
    const next = user.zoom * factor;
    if (next > MAX_ZOOM * 1.02 && factor > 1) {
      leave();
      return;
    }
    user.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    dirty = true;
  }

  function onWheel(e) {
    // A pinch on a trackpad arrives as a wheel with ctrl held; so does a
    // deliberate ctrl-scroll. A plain wheel is the page's, to scroll with.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * 0.01));
  }

  function onKeyDown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = 12;
    const keys = {
      ArrowLeft: () => turnBy(step, 0),
      ArrowRight: () => turnBy(-step, 0),
      ArrowUp: () => turnBy(0, step),
      ArrowDown: () => turnBy(0, -step),
      '+': () => zoomBy(0.87),
      '=': () => zoomBy(0.87),
      '-': () => zoomBy(1.15),
      Enter: () => (mode === 'plate' ? null : enter(selected)),
      Escape: () => (tool ? arm(null) : leave()),
      ' ': () => setPlaying(!playing),
    };
    const digit = Number(e.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= entries.length) {
      e.preventDefault();
      enter(digit - 1);
      return;
    }
    const handler = keys[e.key];
    if (!handler) return;
    e.preventDefault();
    handler();
  }

  function onContextLost(e) {
    e.preventDefault();
    lost = true;
    emit();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('webglcontextlost', onContextLost);

  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          dirty = true;
        })
      : null;
  resizeObserver?.observe(canvas);
  const viewObserver =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
          onScreen = entry.isIntersecting;
          dirty = true;
        })
      : null;
  viewObserver?.observe(canvas);
  const onPageHide = () => {
    if (saveTimer) clearTimeout(saveTimer);
    save();
  };
  window.addEventListener('pagehide', onPageHide);

  // ---------------------------------------------------------- actions

  function select(index) {
    if (!entries[index]) return;
    selected = index;
    dirty = true;
    emit();
  }

  function enter(index) {
    if (!entries[index]) return;
    if (index !== selected || mode !== 'plate') {
      user.zoom = 1;
      user.az = 0;
      user.el = PLATE_ELEVATION;
    }
    selected = index;
    mode = 'plate';
    dirty = true;
    emit();
  }

  function leave() {
    if (mode === 'bench') return;
    mode = 'bench';
    tool = null;
    dirty = true;
    emit();
  }

  /**
   * Start or stop the incubator. Stopped means every plate stays as it is
   * on screen: one that was being watched is held at the hour it has
   * reached (its clock runs ahead of it at speed, see `settle`), and one
   * still growing back to where it was left waits where it stands, and
   * goes on from there when the incubator starts again.
   */
  function setPlaying(value) {
    if (playing === Boolean(value)) return;
    playing = Boolean(value);
    for (const entry of entries) {
      if (playing) {
        entry.waiting = false;
      } else {
        settle(entry.live, entry.owed);
        entry.waiting = behind(entry.live) > 0;
      }
    }
    emit();
  }

  function setSpeed(value) {
    if (!SPEEDS.some((s) => s.value === value)) return;
    view.speed = value;
    emit();
  }

  function setLight(value) {
    view.light = Math.min(3, Math.max(0, value | 0));
    lightDirty = true;
    emit();
  }

  function setStretch(value) {
    view.stretch = Math.min(8, Math.max(1, value));
    lightDirty = true;
    emit();
  }

  function setLamp({ az, el }) {
    if (Number.isFinite(az)) view.lampAz = ((az % 360) + 360) % 360;
    if (Number.isFinite(el)) view.lampEl = Math.min(80, Math.max(8, el));
    lightDirty = true;
    emit();
  }

  /** Pick up a culture or something off the tray, or put it down (null). */
  function arm(next) {
    tool =
      next && (cultureById(next.id) || additionById(next.id)) ? next : null;
    // The page marks the middle of the plate while something is in hand,
    // and is told where that is with each drawing.
    dirty = true;
    if (tool && mode !== 'plate') enter(selected);
    else emit();
  }

  /** Put a different plate where one was. Nothing on it is by hand yet. */
  function swap(entry, dish) {
    entry.replay = null;
    entry.dish = dish;
    entry.touched = false;
    restart(entry);
    dirty = true;
  }

  function replace(index, dish) {
    const entry = entries[index];
    if (!entry) return;
    swap(entry, dish);
    emit();
  }

  /** Throw a plate's contents away and pour it again. */
  function pour(index, mediumId, { agar = null, nutrient = null } = {}) {
    const entry = entries[index];
    if (!entry) return;
    replace(
      index,
      createDish(mediumId, { agar, nutrient, env: { ...entry.live.env } }),
    );
  }

  function loadRecipe(index, recipeId) {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    replace(index, dishFromRecipe(recipeId));
    if (Number.isInteger(recipe.light)) setLight(recipe.light);
    else if (view.light !== 0) setLight(0);
  }

  function setEnv(index, patch) {
    const entry = entries[index];
    if (!entry) return;
    setLiveEnv(sim, entry.live, patch);
    emit();
  }

  function setHeld(index, held) {
    const entry = entries[index];
    if (!entry) return;
    entry.dish.held = Boolean(held);
    // In the fridge it stops where it is, as it does when the incubator is
    // stopped; it still gets back to wherever it was left.
    if (entry.dish.held) settle(entry.live, entry.owed);
    emit();
  }

  /** Spread a culture over the whole plate. */
  function spread(index, cultureId) {
    const entry = entries[index];
    if (!entry || !cultureById(cultureId)) return;
    const refused = act(sim, entry.live, {
      do: 'lawn',
      culture: cultureId,
      seed: (Math.random() * 1e6) | 0,
    });
    if (refused) say(refused);
    else entry.touched = true;
    emit();
  }

  /** A drop of a culture at a point, without a pointer to put it there. */
  function spot(index, cultureId, x, y) {
    const entry = entries[index];
    if (!entry || !cultureById(cultureId)) return;
    const refused = putDrop(entry, dropOf(cultureId, x, y));
    if (refused) say(refused);
    else entry.touched = true;
    emit();
  }

  /**
   * Work every plate out on a finer or a coarser grid (units.js gridSize).
   * The grid is what a plate's state is kept on, so there is nothing to
   * convert: the old plates are let go and every one is grown again from
   * its record. If the device can't hold the finer grid, it goes back to
   * the one it had and says so.
   */
  function setDetail(value) {
    if (!known(value) || value === view.detail) return;
    const kept = entries.map((entry) => ({
      dish: asRecorded(entry),
      touched: entry.touched,
    }));
    for (const entry of entries) {
      sim.disposePlate(entry.plate);
      renderer.disposeDisplay(entry.display);
    }
    renderer.dispose();
    sim.dispose();
    gesture = null;
    try {
      build(value);
      view.detail = value;
    } catch (err) {
      console.error('[culturing] could not change the grid', err);
      build(view.detail);
      say('This device couldn’t take the finer grid.');
    }
    entries = kept.map(({ dish, touched }) => makeEntry(dish, touched));
    relayout();
    lightDirty = true;
    dirty = true;
    emit();
  }

  /** How big a drop the hand leaves from now on (tools.js DROPS). */
  function setDrop(value) {
    if (!DROPS.some((d) => d.value === value)) return;
    view.drop = value;
    emit();
  }

  /** Something off the tray, set down at a point. */
  function put(index, additionId, x, y) {
    const entry = entries[index];
    if (!entry || !additionById(additionId)) return;
    act(sim, entry.live, { do: 'add', addition: additionId, x, y });
    entry.touched = true;
    emit();
  }

  /** Take back the last thing done to a plate, and grow it again without. */
  function undo(index) {
    const entry = entries[index];
    if (!entry || !entry.dish.events.length) return;
    const { dish, live } = entry;
    // The last thing that has actually happened, not one still to come.
    const at = Math.max(0, live.cursor - 1);
    dish.events.splice(at, 1);
    // What it was mixed with, if anything, is a drop of its own again.
    dish.events = unmixed(dish.events);
    dish.hours = Math.max(dish.hours, live.plate.hours);
    delete dish.recipe;
    restart(entry);
    entry.touched = workedOn(dish);
    dirty = true;
    emit();
  }

  /**
   * Watch a plate grow again from the pour to the hour it stands at, in
   * about twelve seconds whatever its age. Nothing in its record changes:
   * it is the same recipe grown once more, at a pace that can be followed.
   * Asked again while it is replaying, it goes straight to the end.
   */
  function replay(index) {
    const entry = entries[index];
    if (!entry) return;
    if (entry.replay) {
      entry.dish.hours = entry.replay.goal;
      entry.replay = null;
      entry.waiting = false;
      emit();
      return;
    }
    const goal = Math.max(entry.dish.hours, entry.live.plate.hours);
    if (!entry.dish.events.length || goal < 1) {
      say('Nothing has grown on this plate yet.');
      return;
    }
    entry.dish.hours = 0;
    restart(entry);
    // Stopping the incubator part-way never leaves it short of where it was.
    entry.owed = goal;
    entry.replay = replayOf(goal);
    dirty = true;
    emit();
  }

  function addDish(mediumId = 'broth') {
    if (entries.length >= MAX_DISHES) return;
    entries.push(makeEntry(createDish(mediumId)));
    relayout();
    enter(entries.length - 1);
  }

  function removeDish(index) {
    if (entries.length <= 1 || !entries[index]) return;
    const [gone] = entries.splice(index, 1);
    sim.disposePlate(gone.plate);
    renderer.disposeDisplay(gone.display);
    selected = Math.min(selected, entries.length - 1);
    mode = 'bench';
    tool = null;
    relayout();
    dirty = true;
    emit();
  }

  /** Deal a plate nobody chose (chance.js) onto one place on the bench. */
  function randomize(index) {
    const entry = entries[index];
    if (!entry) return;
    swap(entry, randomDish());
    // Whatever it is, it is worth seeing in ordinary light first.
    if (view.light !== 0) setLight(0);
    else emit();
  }

  /** The same, for every plate on the bench at once. */
  function randomizeBench() {
    for (const entry of entries) swap(entry, randomDish());
    if (view.light !== 0) setLight(0);
    else emit();
  }

  function resetBench() {
    for (const entry of entries) {
      sim.disposePlate(entry.plate);
      renderer.disposeDisplay(entry.display);
    }
    entries = openingDishes().map((dish) => makeEntry(dish));
    selected = 0;
    mode = 'bench';
    tool = null;
    // Everything about the view but the grid, which is the plates' own.
    Object.assign(view, DEFAULT_VIEW, { detail: view.detail });
    lightDirty = true;
    relayout();
    dirty = true;
    emit();
  }

  function resetView() {
    user.az = 0;
    user.el = PLATE_ELEVATION;
    user.zoom = 1;
    user.benchAz = 0;
    user.benchEl = BENCH_ELEVATION;
    dirty = true;
  }

  function topView() {
    user.el = MAX_ELEVATION;
    user.az = 0;
    dirty = true;
  }

  /** The canvas as it stands, as a PNG. */
  function photo() {
    return new Promise((resolve) => {
      // Drawn and read in one go: the drawing buffer doesn't outlive the
      // frame it was drawn in.
      dirty = true;
      lightDirty = true;
      cancelAnimationFrame(raf);
      frame(performance.now());
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  /** A link that carries one plate's recipe. */
  function shareLink(index) {
    const entry = entries[index];
    if (!entry) return null;
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('plate', encodeDish(asRecorded(entry)));
    return url.toString();
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    clearTimeout(noticeTimer);
    if (saveTimer) clearTimeout(saveTimer);
    save();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    window.removeEventListener('pagehide', onPageHide);
    resizeObserver?.disconnect();
    viewObserver?.disconnect();
    listeners.clear();
    frameListeners.clear();
    if (!lost) {
      for (const entry of entries) {
        sim.disposePlate(entry.plate);
        renderer.disposeDisplay(entry.display);
      }
      renderer.dispose();
      sim.dispose();
    }
    // Hand the context back now rather than when the canvas is collected:
    // a browser only allows a handful, and the page may be visited again.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  resize();
  relayout();
  snapshot = buildSnapshot();
  raf = requestAnimationFrame(frame);
  if (incomingRefused) {
    say(
      'The bench is full. Discard a plate to make room for the one in the link.',
    );
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    /** A line on the stage for a few seconds, from the page around it. */
    say,
    /** Called with each dish's place on the canvas whenever it is redrawn. */
    onFrame(listener) {
      frameListeners.add(listener);
      dirty = true;
      return () => frameListeners.delete(listener);
    },
    select,
    enter,
    leave,
    setPlaying,
    setSpeed,
    setLight,
    setStretch,
    setLamp,
    arm,
    pour,
    loadRecipe,
    setEnv,
    setHeld,
    spread,
    spot,
    setDrop,
    setDetail,
    put,
    undo,
    replay,
    addDish,
    removeDish,
    randomize,
    randomizeBench,
    resetBench,
    resetView,
    topView,
    zoomBy,
    turnBy,
    photo,
    shareLink,
    dispose,
    recipes: RECIPES,
  };
}
