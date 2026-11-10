// The game, running: a `game` (src/sim), a picture of it (src/view), the
// clock that moves one and redraws the other, and the pointer and keys that
// turn into building. It owns a canvas inside the element it is given and
// knows nothing about React; the HUD reads `getSnapshot()` and calls the
// methods below.

import { BUILDABLE, GROW_AT, KINDS } from './sim/catalog.js';
import {
  GOALS,
  canPlace,
  canRemove,
  createGame,
  describeTile,
  deserialize,
  nextGoal,
  place,
  remove,
  serialize,
  step,
} from './sim/game.js';
import { DEFAULT_SEED } from './sim/island.js';
import { dayOf, formatClock, hourOf, isDaylight } from './sim/sun.js';
import { createStage } from './view/stage.js';

/** Island hours that pass in one real second at 1× speed: a day in 96 s. */
export const HOURS_PER_SECOND = 0.25;
export const SPEEDS = Object.freeze([1, 3, 10]);
export const TOOLS = Object.freeze(['look', ...BUILDABLE, 'remove']);

const SAVE_KEY = 'sunfarming:save:v1';
const SAVE_EVERY_MS = 8000;
const SNAPSHOT_EVERY_MS = 180;
const TOAST_MS = 4200;
// A press that travels less than this is a tap, not a drag.
const TAP_SLOP = 7;

/**
 * Where the game is kept between visits. Anything with these three methods
 * will do; this one is the browser's localStorage, which can be missing or
 * refuse (a private window), in which case the island just isn't kept.
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

  let game = deserialize(storage?.load()) || createGame({ seed: DEFAULT_SEED });
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
  };
  let toastId = 0;
  let destroyed = false;

  /* ── what the HUD reads ───────────────────────────────────────────────── */

  const listeners = new Set();
  let snapshot = null;
  let snapshotKey = '';
  let snapshotAt = 0;

  function buildSnapshot() {
    const { flow } = game;
    const goal = nextGoal(game);
    const focus = ui.hover >= 0 ? ui.hover : ui.selected;
    const info = focus >= 0 ? describeTile(game, focus) : null;
    let action = null;
    if (focus >= 0 && ui.tool === 'remove') {
      const can = canRemove(game, focus);
      if (can.ok)
        action =
          can.coins >= 0
            ? `Take it up: +${can.coins}`
            : `Clear it: ${can.coins}`;
      else if (can.message) action = can.message;
    } else if (focus >= 0 && BUILDABLE.includes(ui.tool)) {
      const can = canPlace(game, ui.tool, focus);
      action = can.ok
        ? `Build a ${KINDS[ui.tool].name.toLowerCase()}: -${KINDS[ui.tool].cost}`
        : can.message;
    }
    return {
      tool: ui.tool,
      speed: ui.speed,
      paused: ui.paused,
      coins: Math.floor(game.coins),
      day: dayOf(game.time),
      clock: formatClock(game.time),
      hour: Math.floor(hourOf(game.time) * 2) / 2,
      daylight: isDaylight(game.time),
      sun: round1(flow.sun * 100),
      makingKw: round1(flow.generatingKw),
      peakKw: round1(flow.peakKw),
      wantedKw: round1(flow.demandKw),
      sentKw: round1(flow.deliveredKw),
      chargingKw: round1(flow.chargingKw),
      wastedKw: round1(flow.wastedKw),
      storedKwh: round1(flow.storedKwh),
      capacityKwh: round1(flow.capacityKwh),
      litHouses: flow.litHouses,
      houses: game.houses,
      plots: game.plots.length,
      todayShare:
        game.today.demanded > 0
          ? Math.round((game.today.delivered / game.today.demanded) * 100)
          : 0,
      growAt: Math.round(GROW_AT * 100),
      goal: goal
        ? {
            key: goal.key,
            title: goal.title,
            hint: goal.hint,
            reward: goal.reward,
          }
        : null,
      goals: GOALS.map((g) => ({
        key: g.key,
        title: g.title,
        reward: g.reward,
        done: Boolean(game.goals[g.key]),
      })),
      info: info ? { ...info, action } : null,
      toasts: ui.toasts,
      afford: Object.fromEntries(
        BUILDABLE.map((kind) => [kind, game.coins >= KINDS[kind].cost]),
      ),
      seed: game.seed,
    };
  }

  function publish(force = false) {
    const next = buildSnapshot();
    const key = JSON.stringify(next);
    snapshotAt = performance.now();
    if (!force && key === snapshotKey) return;
    snapshot = next;
    snapshotKey = key;
    for (const listener of listeners) listener();
  }

  function toast(text, tone = 'note') {
    if (!text) return;
    // The same thing said twice in a row (a drag across the sea) is said once.
    const last = ui.toasts[ui.toasts.length - 1];
    if (last && last.text === text) {
      last.until = performance.now() + TOAST_MS;
      return;
    }
    toastId += 1;
    ui.toasts = [
      ...ui.toasts.slice(-2),
      { id: toastId, text, tone, until: performance.now() + TOAST_MS },
    ];
    publish();
  }

  /* ── saving ───────────────────────────────────────────────────────────── */

  let savedAt = performance.now();
  let dirty = false;
  function save() {
    dirty = false;
    savedAt = performance.now();
    storage?.save(serialize(game));
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
    ui.tool = tool;
    ui.selected = -1;
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
      return true;
    }
    const result =
      ui.tool === 'remove' ? remove(game, idx) : place(game, ui.tool, idx);
    if (result.ok) {
      dirty = true;
      return true;
    }
    if (result.reason === 'coins') {
      toast(result.message, 'warn');
      return false;
    }
    if (!quiet && result.message) toast(result.message, 'warn');
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
    const idx = stage.pick(at.x, at.y);
    stroke = {
      id: event.pointerId,
      mode: turning ? 'orbit' : ui.tool === 'look' ? 'pan' : 'paint',
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
      stroke.live = applyTool(idx, false);
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
    }

    if (stroke.mode === 'orbit') stage.orbit(-dx * 0.006, dy * 0.005);
    else if (stroke.mode === 'pan') {
      if (stroke.moved) stage.pan(dx, dy);
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

    if (
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
    const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    stage.zoom(Math.exp(Math.max(-120, Math.min(120, step)) * 0.0022));
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
    if (event.target !== host && event.target !== canvas) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const digit = Number(key);
    let handled = true;
    if (digit >= 1 && digit <= TOOLS.length) setTool(TOOLS[digit - 1]);
    else if (key === 'Escape') setTool('look');
    else if (key === 'x' || key === 'Backspace' || key === 'Delete')
      setTool('remove');
    else if (key === ' ') api.setPaused(!ui.paused);
    else if (key === 'w' || key === 'ArrowUp') stage.nudge(0, 1.5);
    else if (key === 's' || key === 'ArrowDown') stage.nudge(0, -1.5);
    else if (key === 'a' || key === 'ArrowLeft') stage.nudge(-1.5, 0);
    else if (key === 'd' || key === 'ArrowRight') stage.nudge(1.5, 0);
    else if (key === 'q') stage.orbit(-Math.PI / 4);
    else if (key === 'e') stage.orbit(Math.PI / 4);
    else if (key === '=' || key === '+') stage.zoom(0.8);
    else if (key === '-' || key === '_') stage.zoom(1.25);
    else handled = false;
    if (handled) {
      event.preventDefault();
      // A key the game used is not also a shortcut for the page it sits in.
      if (key !== 'Escape') event.stopPropagation();
    }
  }

  /* ── the loop ─────────────────────────────────────────────────────────── */

  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let onScreen = true;

  function report(event) {
    if (event.type === 'morning') {
      const percent = Math.round(event.share * 100);
      let text = `Day ${event.day}: the village got ${percent}% of the power it wanted.`;
      if (event.grew) text += ' A family moved in.';
      else if (event.houses < game.plots.length && event.share < GROW_AT) {
        text += ` At ${Math.round(GROW_AT * 100)}% a new family moves in.`;
      }
      toast(text, event.grew ? 'good' : 'note');
    } else if (event.type === 'goal') {
      toast(`${event.title}. +${event.reward} coins`, 'good');
    }
  }

  function tick(time) {
    frame = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
    last = time;
    elapsed += dt;

    if (!ui.paused && dt > 0) {
      const events = step(game, dt * HOURS_PER_SECOND * ui.speed);
      if (events.length) {
        dirty = true;
        events.forEach(report);
      }
    }

    const live = ui.toasts.filter((t) => t.until > time);
    if (live.length !== ui.toasts.length) {
      ui.toasts = live;
      publish();
    } else if (time - snapshotAt > SNAPSHOT_EVERY_MS) {
      publish();
    }
    if (time - savedAt > SAVE_EVERY_MS || (dirty && time - savedAt > 1500))
      save();

    stage.render(elapsed, dt);
  }

  function start() {
    if (frame || destroyed || !onScreen || document.hidden) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
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
  host.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', save);

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
      publish();
    },
    setPaused(paused) {
      ui.paused = Boolean(paused);
      publish();
    },
    /** Turn the view an eighth of the way round: -1 left, 1 right. */
    turn(direction) {
      stage.orbit((Math.PI / 4) * Math.sign(direction));
    },
    /** Move the view in (1) or out (-1). */
    zoom(direction) {
      stage.zoom(direction > 0 ? 0.78 : 1.28);
    },
    /** Start over on a new island: a given seed, or one out of the air. */
    newIsland(seed = Math.floor(Math.random() * 1e9)) {
      game = createGame({ seed });
      stage.setGame(game);
      ui.hover = -1;
      ui.selected = -1;
      ui.tool = 'look';
      ui.paused = false;
      ui.toasts = [];
      save();
      publish(true);
    },
    /** For tests and the console: the live game object. */
    get game() {
      return game;
    },
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
      host.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
      listeners.clear();
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
