// The game, running: a `game` (src/sim), a picture of it (src/view), the
// clock that moves one and redraws the other, the pointer and keys that turn
// into building, and the book it is all saved in. It owns a canvas inside the
// element it is given and knows nothing about React; the HUD reads
// `getSnapshot()` and calls the methods below.

import { BUILDABLE, GROW_AT, KINDS, TIERS } from './sim/catalog.js';
import {
  GOALS,
  canPlace,
  canRemove,
  costOf,
  createGame,
  dawnPlan,
  describeTile,
  deserialize,
  generatorTile,
  isUnlocked,
  nextGoal,
  place,
  remove,
  serialize,
  step,
} from './sim/game.js';
import {
  FREE_BUILD,
  ISLANDS,
  TUTORIAL,
  dateKey,
  isOpen,
  markDone,
  nextIsland,
  readProgress,
  specById,
  todaysIsland,
  withUnlocked,
} from './sim/islands.js';
import {
  advanceLesson,
  inLesson,
  lessonHolds,
  lessonNow,
  lessonSteps,
} from './sim/lesson.js';
import { sunMap } from './sim/shade.js';
import { dayOf, formatClock, hourOf, isDaylight, seasonAt } from './sim/sun.js';
import { forecast } from './sim/weather.js';
import { createSound } from './audio/sound.js';
import { createStage } from './view/stage.js';

/** Island hours that pass in one real second at 1× speed: a day in 96 s. */
export const HOURS_PER_SECOND = 0.25;
export const SPEEDS = Object.freeze([1, 3, 10]);
export const TOOLS = Object.freeze(['look', ...BUILDABLE, 'remove']);

const SAVE_KEY = 'sunfarming:book:v2';
const BOOK_VERSION = 2;
const SAVE_EVERY_MS = 8000;
const SNAPSHOT_EVERY_MS = 180;
const TOAST_MS = 4600;
// A press that travels less than this is a tap, not a drag.
const TAP_SLOP = 7;

/**
 * Where the game is kept between visits. Anything with these three methods
 * will do; this one is the browser's localStorage, which can be missing or
 * refuse (a private window), in which case nothing is kept.
 */
export function browserStorage(key = SAVE_KEY) {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(data) {
      try {
        window.localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // Full, blocked or absent: play on without a save.
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Nothing to clear, then.
      }
    },
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const percent = (n) => Math.round(n * 100);
const usesSunMap = (tool) => tool === 'panel' || tool === 'tracker';

/**
 * Start the game inside `host`.
 *
 * `storage` is where it is saved (see browserStorage; pass null to keep
 * nothing). `captureWheel` lets a plain scroll wheel zoom; left off, the
 * wheel belongs to the page the game is embedded in, and zooming is a pinch
 * or ctrl + wheel, as on a map.
 */
export function createSunfarm({
  host,
  storage = browserStorage(),
  captureWheel = false,
} = {}) {
  if (!host) throw new Error('createSunfarm needs a host element');

  const canvas = document.createElement('canvas');
  canvas.className = 'sunfarm-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'The island: a grid of grass and beach in the sea, with a village and whatever has been built.',
  );
  host.prepend(canvas);

  /* ── the book: every island's save, and what has been done ────────────── */

  // `{ current, progress, saves }`: which island is being played, what has
  // been finished and unlocked across all of them, and each island's game.
  const book = (() => {
    const data = storage?.load();
    const ok = data && typeof data === 'object' && data.v === BOOK_VERSION;
    return {
      // Somebody who has never played starts on the tutorial island.
      current:
        ok && typeof data.current === 'string' ? data.current : TUTORIAL.id,
      progress: readProgress(ok ? data.progress : null),
      saves:
        ok && data.saves && typeof data.saves === 'object'
          ? { ...data.saves }
          : {},
    };
  })();

  // An island's game: its save if there is a good one, or a fresh start.
  function gameFor(id) {
    // Anything that isn't an island that can be played yet is the first one.
    const spec = (isOpen(book.progress, id) && specById(id)) || ISLANDS[0];
    const saved = deserialize(book.saves[spec.id]);
    // Yesterday's "today's island" is not today's.
    if (saved && (!spec.daily || saved.spec.date === spec.date)) return saved;
    return createGame({ spec, unlocked: book.progress.unlocked });
  }

  let game = gameFor(book.current);
  book.current = game.spec.id;

  // Throws when WebGL isn't to be had; the caller says so on the page.
  let stage;
  try {
    stage = createStage(canvas, game);
  } catch (error) {
    canvas.remove();
    throw error;
  }

  const ui = {
    tool: 'look',
    speed: 1,
    paused: false,
    hover: -1,
    selected: -1,
    toasts: [],
    // The last morning's report, and whether the island has just been
    // finished (until the HUD has said so).
    finished: null,
    // Whether the view has been moved by hand on this island: the first
    // thing the tutorial asks for.
    looked: false,
  };
  // Sound: off until the first press inside the game, and off for good if
  // the player has said so before. A browser only lets sound start from the
  // end of a press (a finger going down doesn't count), so it is woken on
  // pointerup, click and keydown.
  const MUTED_KEY = 'sunfarming:muted';
  const readMuted = () => {
    try {
      return window.localStorage.getItem(MUTED_KEY) === '1';
    } catch {
      return false;
    }
  };
  const sound = createSound({ muted: readMuted() });
  const wake = () => sound.unlock();

  let toastId = 0;
  let destroyed = false;
  // Counts every change to what stands on the island, so the sun map knows
  // when it is out of date.
  let built = 0;
  let sunlight = null;
  let sunlightKey = '';

  /* ── what the HUD reads ───────────────────────────────────────────────── */

  const listeners = new Set();
  let snapshot = null;
  let snapshotKey = '';
  let snapshotAt = 0;

  function chart() {
    const entry = (spec) => {
      const result = book.progress.done[spec.id];
      const done =
        result && (!spec.daily || result.date === spec.date)
          ? result.day
          : null;
      return {
        id: spec.id,
        name: spec.name,
        blurb: spec.blurb,
        open: isOpen(book.progress, spec.id),
        done,
        current: spec.id === game.spec.id,
        started: Boolean(book.saves[spec.id]) || spec.id === game.spec.id,
      };
    };
    return {
      lesson: entry(TUTORIAL),
      islands: ISLANDS.map(entry),
      today: entry(todaysIsland()),
      free: entry(FREE_BUILD),
    };
  }

  /* ── the tutorial ─────────────────────────────────────────────────────── */

  // What the lesson (src/sim/lesson.js) can't see for itself: what is in
  // hand, what has been looked at, what the clock is set to.
  const seen = () => ({
    tool: ui.tool,
    selected: ui.selected,
    looked: ui.looked,
    speed: ui.speed,
    paused: ui.paused,
  });

  // Where the lesson is pointing, as it was last drawn on the ground.
  let marksKey = '';
  function teach() {
    const now = inLesson(game) ? lessonNow(game, seen()) : null;
    const key = now ? now.tiles.join(',') : '';
    if (key !== marksKey) {
      marksKey = key;
      stage.setMarks(now ? now.tiles : []);
    }
    return now;
  }

  // Move the lesson on if the step it is on has just been done. Called every
  // frame and after everything the player does; it is a handful of counts.
  function learn() {
    if (!inLesson(game)) return false;
    const passed = advanceLesson(game, seen());
    if (!passed.length) return false;
    dirty = true;
    if (inLesson(game)) sound.play('lesson');
    return true;
  }

  function refreshSunMap() {
    if (!usesSunMap(ui.tool)) {
      if (sunlight) stage.showSunMap(null);
      sunlight = null;
      sunlightKey = '';
      return;
    }
    const key = `${game.spec.id}:${dayOf(game.time)}:${built}`;
    if (key === sunlightKey) return;
    sunlightKey = key;
    sunlight = sunMap(game, seasonAt(game.spec, game.time));
    stage.showSunMap(sunlight);
  }

  function buildSnapshot() {
    const { flow, spec } = game;
    const goal = nextGoal(game);
    const lesson = teach();
    const season = seasonAt(spec, game.time);
    const focus = ui.hover >= 0 ? ui.hover : ui.selected;
    const info = focus >= 0 ? describeTile(game, focus) : null;
    let action = null;
    if (focus >= 0 && ui.tool === 'remove') {
      const can = canRemove(game, focus);
      if (can.ok) {
        action =
          can.coins > 0
            ? `Take it up: +${can.coins}`
            : can.coins < 0
              ? `Clear it: ${can.coins}`
              : 'Take it up';
      } else if (can.message) action = can.message;
    } else if (focus >= 0 && BUILDABLE.includes(ui.tool)) {
      const can = canPlace(game, ui.tool, focus);
      const cost = costOf(game, ui.tool);
      action = can.ok
        ? `Build a ${KINDS[ui.tool].name.toLowerCase()}${cost ? `: -${cost}` : ''}`
        : can.message;
      if (can.ok && sunlight && sunlight[focus] >= 0) {
        info.lines = [
          ...info.lines,
          `Sun here: ${percent(sunlight[focus])}% of the day’s light.`,
        ];
      }
    }
    const plan = dawnPlan(game);
    const tiers = [0, 0, 0, 0];
    for (let i = 0; i < game.houses; i += 1)
      tiers[game.things[game.plots[i]].tier] += 1;
    const today = game.today;
    return {
      island: {
        id: spec.id,
        name: spec.name,
        free: Boolean(spec.free),
        daily: Boolean(spec.daily),
        date: spec.date || null,
        lesson: Boolean(spec.lesson),
      },
      // The tutorial's step, if the island has one and it isn't over: what
      // to say, and which control to point at (the ground it points at is
      // drawn by the stage).
      lesson: lesson
        ? {
            index: lesson.index,
            total: lesson.total,
            key: lesson.key,
            say: lesson.say,
            more: lesson.more,
            point: lesson.point,
          }
        : null,
      // The clock is waiting on the tutorial.
      held: Boolean(lesson?.hold),
      tool: ui.tool,
      speed: ui.speed,
      paused: ui.paused,
      coins: Math.floor(game.coins),
      day: dayOf(game.time),
      clock: formatClock(game.time),
      hour: Math.floor(hourOf(game.time) * 2) / 2,
      daylight: isDaylight(game.time, season),
      season: spec.seasons ? season.name : null,
      forecast: forecast(spec, game.time, 3).map((sky) => ({
        key: sky.key,
        name: sky.name,
      })),
      // How much of what the village has had today came from sun and wind.
      clean:
        today.delivered > 0.01 ? percent(today.clean / today.delivered) : null,
      cleanYesterday: game.yesterday ? percent(game.yesterday.clean) : null,
      served:
        today.demanded > 0.01
          ? percent(today.delivered / today.demanded)
          : null,
      makingKw: round1(flow.solarKw + flow.windKw),
      peakKw: round1(flow.peakKw),
      windKw: round1(flow.windKw),
      shaded: flow.shadedPanels,
      dieselKw: round1(flow.dieselKw),
      generator: generatorTile(game) >= 0,
      fuelToday: Math.round(today.fuel),
      wantedKw: round1(flow.demandKw),
      sentKw: round1(flow.deliveredKw),
      chargingKw: round1(flow.chargingKw),
      storedKwh: round1(flow.storedKwh),
      capacityKwh: round1(flow.capacityKwh),
      litHouses: flow.litHouses,
      houses: game.houses,
      plots: game.plots.length,
      tiers: tiers.slice(1, spec.maxTier + 1),
      tierNames: TIERS.slice(1, spec.maxTier + 1).map((tier) => tier.name),
      growAt: percent(GROW_AT),
      dawn: { moves: plan.moves, upgrades: plan.upgrades.length },
      goal: goal
        ? {
            key: goal.key,
            title: goal.title,
            hint: goal.hint,
            reward: goal.reward,
          }
        : null,
      goals: spec.free
        ? []
        : spec.lesson
          ? lessonSteps(game).map((s) => ({ ...s, reward: 0 }))
          : GOALS.map((g) => ({
              key: g.key,
              title: g.title,
              reward: g.reward,
              done: Boolean(game.goals[g.key]),
            })),
      done: game.done ? game.done.day : null,
      finished: ui.finished,
      info: info ? { ...info, action } : null,
      toasts: ui.toasts,
      muted: sound.muted,
      tools: BUILDABLE.map((kind) => ({
        tool: kind,
        cost: costOf(game, kind),
        afford: game.coins >= costOf(game, kind),
        locked: !isUnlocked(game, kind),
        unlock: KINDS[kind].unlock || null,
      })),
      chart: chart(),
    };
  }

  function publish(force = false) {
    refreshSunMap();
    const next = buildSnapshot();
    const key = JSON.stringify(next);
    snapshotAt = performance.now();
    if (!force && key === snapshotKey) return;
    snapshot = next;
    snapshotKey = key;
    for (const listener of listeners) listener();
  }

  function toast(text, tone = 'note', life = TOAST_MS) {
    if (!text) return;
    // The same thing said twice in a row (a drag across the sea) is said once.
    const last = ui.toasts[ui.toasts.length - 1];
    if (last && last.text === text) {
      last.until = performance.now() + life;
      return;
    }
    toastId += 1;
    ui.toasts = [
      ...ui.toasts.slice(-2),
      { id: toastId, text, tone, until: performance.now() + life },
    ];
    publish();
  }

  /* ── saving ───────────────────────────────────────────────────────────── */

  let savedAt = performance.now();
  let dirty = false;
  function save() {
    dirty = false;
    savedAt = performance.now();
    book.saves[game.spec.id] = serialize(game);
    storage?.save({
      v: BOOK_VERSION,
      current: book.current,
      progress: book.progress,
      saves: book.saves,
    });
  }

  /* ── tools ────────────────────────────────────────────────────────────── */

  function refreshCursor() {
    const idx =
      ui.hover >= 0 ? ui.hover : ui.tool === 'look' ? ui.selected : -1;
    if (idx < 0) {
      stage.setCursor({ idx: -1 });
      return;
    }
    if (ui.tool === 'look') stage.setCursor({ idx, tone: 'look' });
    else if (ui.tool === 'remove') {
      stage.setCursor({
        idx,
        tone: canRemove(game, idx).ok ? 'remove' : 'bad',
      });
    } else {
      stage.setCursor({
        idx,
        tone: canPlace(game, ui.tool, idx).ok ? 'ok' : 'bad',
        kind: ui.tool,
      });
    }
  }

  function setTool(tool) {
    if (!TOOLS.includes(tool)) return;
    if (BUILDABLE.includes(tool) && !isUnlocked(game, tool)) {
      toast(
        `${KINDS[tool].name}: ${KINDS[tool].unlock.toLowerCase()}.`,
        'note',
      );
      sound.play('deny');
      return;
    }
    if (tool !== ui.tool) sound.play('tap');
    ui.tool = tool;
    ui.selected = -1;
    learn();
    // The stylesheet picks the pointer's shape from this.
    host.dataset.tool = tool === 'look' ? 'look' : 'build';
    stage.showGrid(tool !== 'look');
    refreshCursor();
    publish();
  }

  /**
   * Use the tool in hand on a tile. `quiet` is a drag passing over: it builds
   * where it can and says nothing where it can't, except for running out of
   * coins, which ends the stroke. Returns false when the stroke should stop.
   */
  function applyTool(idx, quiet = false) {
    if (idx < 0) return true;
    if (ui.tool === 'look') {
      ui.selected = ui.selected === idx ? -1 : idx;
      learn();
      return true;
    }
    const result =
      ui.tool === 'remove' ? remove(game, idx) : place(game, ui.tool, idx);
    if (result.ok) {
      dirty = true;
      built += 1;
      learn();
      if (ui.tool === 'remove') sound.play('remove');
      else sound.place(result.kind);
      if (result.kind === 'generator') {
        toast(
          'The generator goes back on the boat. The island is on its own now.',
          'good',
          7000,
        );
      }
      return true;
    }
    if (result.reason === 'coins') {
      toast(result.message, 'warn');
      sound.play('deny');
      return false;
    }
    if (!quiet && result.message) {
      toast(result.message, 'warn');
      sound.play('deny');
    }
    return true;
  }

  /* ── pointer ──────────────────────────────────────────────────────────── */

  const pointers = new Map();
  // What the one finger or button that is down is doing.
  let stroke = null;
  // The last distance, angle and centre of a two-finger gesture.
  let pinch = null;

  const local = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // Every tile on a path from one tile to another, a step at a time along
  // the grid, so a fast drag doesn't leave gaps in a power line.
  function tilesBetween(from, to) {
    const { size } = game;
    const out = [];
    let x = from % size;
    let z = Math.floor(from / size);
    const tx = to % size;
    const tz = Math.floor(to / size);
    while (x !== tx || z !== tz) {
      if (Math.abs(tx - x) >= Math.abs(tz - z)) x += Math.sign(tx - x);
      else z += Math.sign(tz - z);
      out.push(z * size + x);
    }
    return out;
  }

  function measurePinch() {
    const [a, b] = [...pointers.values()];
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  function onPointerDown(event) {
    host.focus({ preventScroll: true });
    const at = local(event);
    pointers.set(event.pointerId, at);
    canvas.setPointerCapture?.(event.pointerId);

    if (pointers.size === 2) {
      // A second finger: whatever the first was doing, it is a gesture now.
      stroke = null;
      pinch = measurePinch();
      return;
    }
    if (pointers.size > 2) return;

    const turning = event.pointerType === 'mouse' && event.button !== 0;
    // A mouse paints with any building tool. A finger has to be able to move
    // the view, so it paints only with the power line, which is drawn; with
    // everything else a drag pans and a tap builds.
    const drags = event.pointerType !== 'mouse' && ui.tool !== 'cable';
    const idx = stage.pick(at.x, at.y);
    stroke = {
      id: event.pointerId,
      mode: turning ? 'orbit' : ui.tool === 'look' || drags ? 'pan' : 'paint',
      startX: at.x,
      startY: at.y,
      lastX: at.x,
      lastY: at.y,
      moved: false,
      tile: idx,
      live: true,
    };
    if (stroke.mode === 'paint') {
      ui.hover = idx;
      // A mouse press builds at once. A finger might be the first of two,
      // so its first tile waits until it moves (a stroke) or lifts (a tap).
      if (event.pointerType === 'mouse') stroke.live = applyTool(idx, false);
      else stroke.waiting = true;
      refreshCursor();
      publish();
    }
  }

  function onPointerMove(event) {
    const at = local(event);
    const held = pointers.has(event.pointerId);
    if (held) pointers.set(event.pointerId, at);

    if (pinch && pointers.size === 2) {
      const next = measurePinch();
      if (pinch.distance > 0 && next.distance > 0)
        stage.zoom(pinch.distance / next.distance);
      let turn = next.angle - pinch.angle;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      stage.orbit(-turn);
      stage.pan(next.x - pinch.x, next.y - pinch.y);
      pinch = next;
      ui.looked = true;
      return;
    }

    if (!held || !stroke || stroke.id !== event.pointerId) {
      // Just a mouse passing over.
      if (event.pointerType === 'mouse' && pointers.size === 0) {
        const idx = stage.pick(at.x, at.y);
        if (idx !== ui.hover) {
          ui.hover = idx;
          refreshCursor();
          publish();
        }
      }
      return;
    }

    const dx = at.x - stroke.lastX;
    const dy = at.y - stroke.lastY;
    stroke.lastX = at.x;
    stroke.lastY = at.y;
    if (
      !stroke.moved &&
      Math.hypot(at.x - stroke.startX, at.y - stroke.startY) > TAP_SLOP
    ) {
      stroke.moved = true;
      if (stroke.waiting) {
        stroke.waiting = false;
        stroke.live = applyTool(stroke.tile, false);
        publish();
      }
    }
    // Still deciding what this touch is.
    if (stroke.waiting) return;

    if (stroke.mode === 'orbit') {
      stage.orbit(-dx * 0.006, dy * 0.005);
      ui.looked = true;
    } else if (stroke.mode === 'pan') {
      if (stroke.moved) {
        stage.pan(dx, dy);
        ui.looked = true;
      }
    } else {
      const idx = stage.pick(at.x, at.y);
      if (idx !== ui.hover) {
        ui.hover = idx;
        if (stroke.live && idx >= 0 && stroke.tile >= 0) {
          for (const tile of tilesBetween(stroke.tile, idx)) {
            stroke.live = applyTool(tile, true);
            if (!stroke.live) break;
          }
        } else if (stroke.live && idx >= 0) {
          stroke.live = applyTool(idx, true);
        }
        if (idx >= 0) stroke.tile = idx;
        refreshCursor();
        publish();
      }
    }
  }

  function onPointerUp(event) {
    const at = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    canvas.releasePointerCapture?.(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!stroke || stroke.id !== event.pointerId) return;

    if (stroke.waiting && at && event.type === 'pointerup') {
      // The power line, tapped: one tile.
      applyTool(stroke.tile, false);
    } else if (
      stroke.mode === 'pan' &&
      !stroke.moved &&
      at &&
      event.type === 'pointerup'
    ) {
      // A tap with the looking tool picks a tile to read.
      applyTool(stage.pick(at.x, at.y), false);
    }
    if (event.pointerType !== 'mouse') ui.hover = -1;
    stroke = null;
    refreshCursor();
    publish();
  }

  function onPointerLeave(event) {
    if (event.pointerType !== 'mouse' || pointers.size) return;
    ui.hover = -1;
    refreshCursor();
    publish();
  }

  function onWheel(event) {
    // A trackpad pinch arrives as a wheel with ctrl held; so does a
    // deliberate ctrl + scroll. A plain wheel is the page's, unless the game
    // has the whole window.
    const whole = captureWheel || document.fullscreenElement === host;
    if (!whole && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    stage.zoom(Math.exp(Math.max(-120, Math.min(120, delta)) * 0.0022));
    ui.looked = true;
  }

  const onContextMenu = (event) => event.preventDefault();

  /* ── keys ─────────────────────────────────────────────────────────────── */

  function onKeyDown(event) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    // Keys work anywhere in the game, but not under an open card, never in
    // a field, and a button keeps the keys that press it.
    const target = event.target;
    if (host.querySelector('.sunfarm-veil')) return;
    if (target.matches?.('input, textarea, select, [contenteditable]')) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (
      target !== host &&
      target !== canvas &&
      (key === ' ' || key === 'Enter')
    )
      return;
    const digit = Number(key);
    let handled = true;
    if (digit >= 1 && digit <= TOOLS.length) setTool(TOOLS[digit - 1]);
    else if (key === 'Escape') setTool('look');
    else if (key === 'x' || key === 'Backspace' || key === 'Delete')
      setTool('remove');
    else if (key === ' ') api.setPaused(!ui.paused);
    else if (
      (key.length === 1 && 'wasdqe=+-_'.includes(key)) ||
      key.startsWith('Arrow')
    ) {
      ui.looked = true;
      moveView(key);
    } else handled = false;
    if (handled) {
      event.preventDefault();
      // A key the game used is not also a shortcut for the page it sits in.
      if (key !== 'Escape') event.stopPropagation();
    }
  }

  function moveView(key) {
    if (key === 'w' || key === 'ArrowUp') stage.nudge(0, 1.5);
    else if (key === 's' || key === 'ArrowDown') stage.nudge(0, -1.5);
    else if (key === 'a' || key === 'ArrowLeft') stage.nudge(-1.5, 0);
    else if (key === 'd' || key === 'ArrowRight') stage.nudge(1.5, 0);
    else if (key === 'q') stage.orbit(-Math.PI / 4);
    else if (key === 'e') stage.orbit(Math.PI / 4);
    else if (key === '=' || key === '+') stage.zoom(0.8);
    else if (key === '-' || key === '_') stage.zoom(1.25);
  }

  /* ── the loop ─────────────────────────────────────────────────────────── */

  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let onScreen = true;

  // What happened, said to the player.
  function report(event) {
    if (event.type === 'morning') {
      const parts = [
        `Day ${event.day}: ${percent(event.clean)}% from sun and wind.`,
      ];
      if (event.fuel >= 1) parts.push(`Fuel cost ${Math.round(event.fuel)}.`);
      else if (event.share >= GROW_AT) parts.push('The generator never ran.');
      if (event.moved) parts.push('A family moved in.');
      if (event.upgraded === 1) parts.push('A home moved up.');
      else if (event.upgraded > 1)
        parts.push(`${event.upgraded} homes moved up.`);
      if (event.share < GROW_AT) {
        parts.push(
          `The village only got ${percent(event.share)}% of what it wanted, so nobody moved.`,
        );
      }
      toast(
        parts.join(' '),
        event.moved || event.upgraded ? 'good' : 'note',
        7000,
      );
    } else if (event.type === 'goal') {
      // On the tutorial island the card that follows says it.
      if (!game.spec.lesson)
        toast(`${event.title}. +${event.reward} coins`, 'good', 6000);
    } else if (event.type === 'unlock') {
      book.progress = withUnlocked(book.progress, [event.kind]);
      toast(
        `New to build: ${event.name.toLowerCase()}. ${KINDS[event.kind].blurb}`,
        'good',
        8000,
      );
    } else if (event.type === 'house' || event.type === 'upgrade') {
      built += 1;
    } else if (event.type === 'done') {
      book.progress = markDone(book.progress, game.spec, event.day);
      const next = nextIsland(game.spec.id);
      ui.finished = {
        id: game.spec.id,
        name: game.spec.name,
        day: event.day,
        next: next ? { id: next.id, name: next.name, blurb: next.blurb } : null,
        daily: Boolean(game.spec.daily),
        date: game.spec.date || null,
        lesson: Boolean(game.spec.lesson),
      };
    }
  }

  function tick(time) {
    frame = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
    last = time;
    elapsed += dt;

    // The view moved, something was looked at: the lesson may have moved on.
    if (learn()) publish();

    // The clock waits while the tutorial has the player build.
    if (!ui.paused && !lessonHolds(game) && dt > 0) {
      const events = step(game, dt * HOURS_PER_SECOND * ui.speed);
      if (events.length) {
        dirty = true;
        events.forEach(report);
        learn();
        const heard = [
          'done',
          'unlock',
          'goal',
          'upgrade',
          'house',
          'morning',
        ].find((type) => events.some((event) => event.type === type));
        if (heard) sound.play(heard);
        publish();
      }
    }

    const live = ui.toasts.filter((t) => t.until > time);
    if (live.length !== ui.toasts.length) {
      ui.toasts = live;
      publish();
    } else if (time - snapshotAt > SNAPSHOT_EVERY_MS) {
      publish();
      sound.ambience({
        wind: game.flow.wind,
        generator: game.flow.dieselKw > 0.01,
        night: isDaylight(game.time, seasonAt(game.spec, game.time)) ? 0 : 1,
        clean: game.yesterday ? game.yesterday.clean : 0,
        paused: ui.paused,
      });
    }
    if (time - savedAt > SAVE_EVERY_MS || (dirty && time - savedAt > 1500))
      save();

    stage.render(elapsed, dt);
  }

  function start() {
    if (frame || destroyed || !onScreen || document.hidden) return;
    last = 0;
    frame = requestAnimationFrame(tick);
    sound.hold(false);
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    sound.hold(true);
  }

  const onVisibility = () => {
    if (document.hidden) {
      stop();
      save();
    } else start();
  };

  const resizer = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    stage.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    // Draw at once: a resized canvas is blank until its next frame.
    if (!frame) stage.render(elapsed, 0);
  });
  resizer.observe(canvas);

  // Nothing is simulated or drawn while the game is scrolled out of view.
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) start();
    else stop();
  });
  watcher.observe(canvas);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  host.addEventListener('pointerup', wake, true);
  host.addEventListener('click', wake, true);
  host.addEventListener('keydown', wake, true);
  host.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', save);

  // Put a different game on the stage: another island, or this one afresh.
  function show(next) {
    game = next;
    book.current = game.spec.id;
    stage.setGame(game);
    ui.hover = -1;
    ui.selected = -1;
    ui.tool = 'look';
    ui.paused = false;
    ui.toasts = [];
    ui.finished = null;
    ui.looked = false;
    marksKey = '';
    stage.setMarks([]);
    host.dataset.tool = 'look';
    built += 1;
    sunlightKey = '';
    save();
    publish(true);
  }

  const api = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    setTool,
    setSpeed(speed) {
      if (!SPEEDS.includes(speed)) return;
      ui.speed = speed;
      ui.paused = false;
      sound.play('tap');
      publish();
    },
    setPaused(paused) {
      ui.paused = Boolean(paused);
      publish();
    },
    /** Turn the sound off or on, and remember it. */
    setMuted(muted) {
      sound.setMuted(muted);
      try {
        window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
      } catch {
        // It will be asked again next time, then.
      }
      if (!muted) sound.play('tap');
      publish();
    },
    /**
     * The island being played as a result to share, once it is finished:
     * `{ island, name, date, days }`, or null before then.
     */
    result() {
      // The tutorial is not a run to compare.
      if (!game.done || game.spec.lesson) return null;
      return {
        island: game.spec.id,
        name: game.spec.name,
        date: game.spec.date || null,
        days: game.done.day,
      };
    },
    /** Turn the view an eighth of the way round: -1 left, 1 right. */
    turn(direction) {
      stage.orbit((Math.PI / 4) * Math.sign(direction));
      ui.looked = true;
    },
    /** Move the view in (1) or out (-1). */
    zoom(direction) {
      stage.zoom(direction > 0 ? 0.78 : 1.28);
      ui.looked = true;
    },
    /**
     * Go to another island, picking up where it was left or starting it
     * fresh. Does nothing for an island that isn't open yet.
     */
    openIsland(id) {
      if (!isOpen(book.progress, id) || !specById(id)) return false;
      if (id === game.spec.id) return true;
      save();
      show(gameFor(id));
      return true;
    },
    /** Go to the tutorial island and start its lesson from the beginning. */
    startTutorial() {
      save();
      delete book.saves[TUTORIAL.id];
      show(createGame({ spec: TUTORIAL, unlocked: book.progress.unlocked }));
    },
    /** Start the island being played over from nothing. */
    restart() {
      delete book.saves[game.spec.id];
      show(
        createGame({
          spec: specById(game.spec.id, game.spec.date),
          unlocked: book.progress.unlocked,
        }),
      );
    },
    /** The HUD has told the player the island is finished. */
    acknowledge() {
      ui.finished = null;
      publish();
    },
    /** A line to share for a finished island, or '' for one that isn't. */
    shareText() {
      if (!game.done || game.spec.lesson) return '';
      const where = game.spec.daily
        ? `today’s island (${dateKey()})`
        : game.spec.name;
      return `Sunfarming: ${where} off diesel and on the sun in ${game.done.day} days.`;
    },
    /** For tests and the console: the live game object. */
    get game() {
      return game;
    },
    /** For the same: where a tile is on the canvas, in CSS pixels. */
    locate: (idx) => stage.locate(idx),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      save();
      resizer.disconnect();
      watcher.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      host.removeEventListener('pointerup', wake, true);
      host.removeEventListener('click', wake, true);
      host.removeEventListener('keydown', wake, true);
      host.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
      listeners.clear();
      sound.dispose();
      stage.dispose();
      canvas.remove();
      delete host.dataset.tool;
    },
  };

  host.dataset.tool = 'look';
  publish(true);
  start();
  return api;
}
