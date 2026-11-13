import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  Camera,
  ChevronDown,
  ChevronLeft,
  Dices,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button, Segmented } from './host.js';
import { createBench, LIGHTS, SPEEDS } from './bench.js';
import { decodeDish } from './recipe.js';
import { cultureById } from './cultures.js';
import { additionById } from './additions.js';
import { DROPS } from './tools.js';
import {
  additionSwatch,
  cultureSwatch,
  CulturesPanel,
  handling,
  IncubatorPanel,
  MediaPanel,
  PlatesPanel,
  RecipesPanel,
  RecordPanel,
  TrayPanel,
} from './Panels.jsx';
import FieldNotes from './FieldNotes.jsx';
import { describeMedia, formatHours } from './format.js';
import { PITCH, TITLE } from './meta.js';
import { saveBlob } from './save.js';
import { useCompact } from './useCompact.js';
import './culturing.css';

/** Why the bench couldn't start, in a sentence. */
const UNSUPPORTED = {
  webgl2:
    'This bench is drawn with WebGL 2, which this browser doesn’t offer or has switched off.',
  float:
    'This bench keeps its plates in floating-point textures, which this device’s graphics can’t draw into.',
  shader:
    'This device’s graphics driver wouldn’t take the bench’s shaders. A different browser may.',
};

const noSubscription = () => () => {};

/** The room a dish's number takes under it, in px: its drop and its line. */
const LABEL_ROOM = 22;

/** The four lights as a row of keys, each saying what it shows on hover. */
const LIGHT_KEYS = LIGHTS.map((l) => ({
  value: l.value,
  label: l.label,
  title: l.hint,
}));

/**
 * The menus, in the order the bar has them. Each opens a panel (Panels.jsx)
 * that works on the plate in hand, or on the one picked across the bench.
 */
const MENUS = [
  { id: 'plates', title: 'Plates', Panel: PlatesPanel },
  { id: 'cultures', title: 'Cultures', Panel: CulturesPanel },
  { id: 'tray', title: 'Tray', Panel: TrayPanel },
  { id: 'media', title: 'Media', Panel: MediaPanel },
  { id: 'incubator', title: 'Incubator', Panel: IncubatorPanel },
  { id: 'recipes', title: 'Recipes', Panel: RecipesPanel },
  { id: 'record', title: 'Record', Panel: RecordPanel },
];
const MENU = Object.fromEntries(MENUS.map((m) => [m.id, m]));

/** On a phone the bar along the bottom has room for five. */
const TABS = ['cultures', 'tray', 'media', 'incubator', 'more'];

/**
 * The bench on a canvas of its own. The canvas is made here rather than in
 * the markup because the bench hands its WebGL context back when it is
 * disposed, and a context can't be had twice from one canvas: in
 * development React mounts every effect twice, and the second mount would
 * find the first's context already gone.
 */
function useBench(stageRef, incoming, reduceMotion) {
  const [bench, setBench] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const canvas = document.createElement('canvas');
    canvas.className = 'cult-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      'A laboratory bench with petri dishes on it, seen from above.',
    );
    canvas.setAttribute('aria-describedby', 'cult-keys');
    stage.prepend(canvas);
    // Growth is motion. Someone who has asked for less of it starts with
    // the incubator stopped, and presses play if they want it.
    const made = createBench(canvas, { incoming, playing: !reduceMotion });
    if (made.error) {
      canvas.remove();
      setError(made.error);
      return undefined;
    }
    setBench(made);
    return () => {
      made.dispose();
      canvas.remove();
      setBench(null);
    };
  }, [stageRef, incoming, reduceMotion]);
  return { bench, error };
}

/** The plate a link carried, read once, and taken out of the address so a
 *  reload doesn't bring it in a second time. */
function useIncomingPlate() {
  const location = useLocation();
  const navigate = useNavigate();
  const [incoming] = useState(() => {
    const text = new URLSearchParams(location.search).get('plate');
    return text ? decodeDish(text) : null;
  });
  useEffect(() => {
    if (new URLSearchParams(location.search).has('plate')) {
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);
  return incoming;
}

function usePrefersReducedMotion() {
  const [reduce] = useState(
    () =>
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return reduce;
}

/**
 * Full screen where the browser has it. Where it doesn't (an iPhone), a
 * bench set in a page is laid over the whole window instead; one that has
 * the window already has nothing to gain, and offers nothing.
 */
function useFullscreen(rootRef, fill) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setExpanded(
        Boolean(rootRef.current) &&
          document.fullscreenElement === rootRef.current,
      );
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [rootRef]);
  const able =
    typeof document !== 'undefined' &&
    (Boolean(document.fullscreenEnabled) || !fill);
  const toggle = () => {
    const root = rootRef.current;
    if (!root) return;
    const overlay = () => {
      root.classList.toggle('cult--expanded');
      setExpanded(root.classList.contains('cult--expanded'));
    };
    if (document.fullscreenElement === root) document.exitFullscreen?.();
    else if (root.classList.contains('cult--expanded')) overlay();
    else if (root.requestFullscreen) root.requestFullscreen().catch(overlay);
    else overlay();
  };
  return { able, expanded, toggle };
}

/**
 * What the page lays over the canvas, told to the bench so it frames the
 * plates in what is left (bench.js setInsets). Anything marked
 * `data-inset="top"` or `"bottom"` is a bar that stays; `"over"` is
 * something pulled up from the bottom that comes and goes (a sheet, the
 * line saying what is in hand), which moves the camera but not the plates.
 * Measured after every render, which is a few times a second at most, and
 * whenever the window changes size.
 */
function useInsets(rootRef, bench) {
  const [room, setRoom] = useState({ top: 0, bottom: 0, height: 0 });
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    let top = 0;
    let bottom = 0;
    let over = 0;
    for (const el of root.querySelectorAll('[data-inset]')) {
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const kind = el.dataset.inset;
      if (kind === 'top') top = Math.max(top, r.bottom - box.top);
      else if (kind === 'bottom') bottom = Math.max(bottom, box.bottom - r.top);
      else over = Math.max(over, box.bottom - r.top);
    }
    const sheet = Math.max(0, over - bottom);
    bench?.setInsets({ top: top + 8, bottom: bottom + 8, sheet });
    setRoom((was) =>
      was.top === top && was.bottom === bottom && was.height === box.height
        ? was
        : { top, bottom, height: box.height },
    );
  }, [rootRef, bench]);
  useLayoutEffect(measure);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef, measure]);
  return room;
}

/** "Broth agar, 1.5 % agar. 30 °C." for the plate in hand. */
function describePlate(plate) {
  const media = describeMedia(plate);
  return `${media.charAt(0).toUpperCase()}${media.slice(1)}, ${plate.agar} % agar. ${plate.env.temperature} °C.`;
}

/** The plate's hour, and what is keeping it from moving on, if anything. */
function describeAge(snap, plate) {
  const age = formatHours(plate.hours);
  if (plate.replaying) {
    return `replaying, ${age} of ${formatHours(plate.goal)}`;
  }
  if (plate.catching) {
    const line = `re-growing, ${age} of ${formatHours(plate.goal)}`;
    return plate.waiting ? `${line}, stopped` : line;
  }
  if (plate.held) return `${age}, in the fridge`;
  if (!snap.playing) return `${age}, stopped`;
  return age;
}

/**
 * One of a few, picked: the system's own picker behind a box the size of a
 * single key, for where a row of keys won't fit.
 */
function Pick({ label, options, value, onChange, className = '' }) {
  return (
    <span className={`cult-select ${className}`.trim()}>
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const next = options.find((o) => String(o.value) === e.target.value);
          if (next) onChange(next.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} aria-hidden="true" />
    </span>
  );
}

/** Start and stop the incubator. */
function PlayButton({ bench, snap, compact }) {
  return (
    <Button
      variant={compact ? 'icon' : undefined}
      on={snap.playing}
      className="cult-play"
      aria-pressed={snap.playing}
      aria-label={snap.playing ? 'Incubating' : 'Stopped'}
      title={snap.playing ? 'Stop the incubator' : 'Start the incubator'}
      onClick={() => bench.setPlaying(!snap.playing)}
    >
      {snap.playing ? (
        <Pause size={16} aria-hidden="true" />
      ) : (
        <Play size={16} aria-hidden="true" />
      )}
      {!compact && (snap.playing ? 'Incubating' : 'Stopped')}
    </Button>
  );
}

/**
 * Watch the plate in hand grow again from the pour (bench.js replay). While
 * it does, the same button goes straight to the end.
 */
function Replay({ bench, snap, label = true }) {
  const plate = snap.dishes[snap.selected];
  if (snap.mode !== 'plate' || !plate) return null;
  const hint = plate.replaying
    ? 'Skip to the end of the replay'
    : 'Watch this plate grow again from the start';
  return (
    <Button
      variant={label ? undefined : 'icon'}
      on={plate.replaying}
      aria-pressed={plate.replaying}
      aria-label={hint}
      title={hint}
      disabled={!plate.replaying && !plate.events.length}
      onClick={() => bench.replay(snap.selected)}
    >
      <Rewind size={16} aria-hidden="true" />
      {label && (plate.replaying ? 'Replaying' : 'Replay')}
    </Button>
  );
}

/**
 * Deal plates nobody chose (chance.js): the one picked up, or, across the
 * bench, all of them. It can be pressed again and again, since what it
 * throws away is only what it dealt. A plate with someone's own work on it
 * is asked after first: one press arms it for a few seconds, the next goes
 * through.
 */
function Randomize({ bench, snap, className = '' }) {
  const inPlate = snap.mode === 'plate';
  const plate = snap.dishes[snap.selected];
  const sure = inPlate
    ? Boolean(plate?.touched)
    : snap.dishes.some((d) => d.touched);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  // Looking at something else is a different question.
  useEffect(() => {
    setArmed(false);
  }, [snap.mode, snap.selected]);

  const what = inPlate ? `plate ${snap.selected + 1}` : 'every plate';
  const hint = armed
    ? `Throw away what’s on ${what} and randomize`
    : `Randomize ${what}`;
  return (
    <Button
      variant={armed ? 'danger' : 'quiet'}
      className={`cult-randomize ${className}`.trim()}
      aria-label={hint}
      title={hint}
      onClick={() => {
        if (sure && !armed) {
          setArmed(true);
          bench.say(
            `Press again to throw away what’s on ${what} and randomize.`,
          );
          return;
        }
        setArmed(false);
        if (inPlate) bench.randomize(snap.selected);
        else bench.randomizeBench();
      }}
    >
      <Dices size={16} aria-hidden="true" />
      <span className="cult-label-wide">
        {armed ? 'Press again' : 'Randomize'}
      </span>
    </Button>
  );
}

/**
 * The camera's buttons: back to the bench, closer, further, from above,
 * and the view put back. Two fingers do the zooming on a phone.
 */
function ViewTools({ bench, snap, compact }) {
  const inPlate = snap.mode === 'plate';
  return (
    <div
      className="cult-view"
      role="group"
      aria-label="View"
      data-inset={compact ? undefined : 'bottom'}
    >
      {inPlate && (
        <Button
          variant="icon"
          aria-label="All plates"
          title="Put the plate down and see them all"
          onClick={bench.leave}
        >
          <LayoutGrid size={16} aria-hidden="true" />
        </Button>
      )}
      {!compact && (
        <>
          <Button
            variant="icon"
            aria-label="Come closer"
            title="Come closer (scroll, or +)"
            onClick={() => bench.zoomBy(0.75)}
          >
            <ZoomIn size={16} aria-hidden="true" />
          </Button>
          <Button
            variant="icon"
            aria-label="Stand back"
            title="Stand back (scroll, or −)"
            onClick={() => bench.zoomBy(1.33)}
          >
            <ZoomOut size={16} aria-hidden="true" />
          </Button>
        </>
      )}
      {inPlate && (
        <Button
          variant="icon"
          aria-label="Look straight down"
          title="Look straight down"
          onClick={bench.topView}
        >
          <ArrowDownToLine size={16} aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="icon"
        aria-label="Put the view back"
        title="Put the view back (Home)"
        onClick={bench.resetView}
      >
        <RotateCcw size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * What is in hand, said where the plate is rather than in a menu: so a menu
 * can be closed, or a sheet put away, and the hand still known. A culture's
 * drop can be sized here; everything else about it is in its menu.
 */
function Holding({ bench, snap, compact }) {
  const tool = snap.tool;
  if (!tool) return null;
  const culture = tool.kind === 'culture' ? cultureById(tool.id) : null;
  const addition = tool.kind === 'addition' ? additionById(tool.id) : null;
  const item = culture || addition;
  if (!item) return null;
  const hint = culture
    ? 'Touch the gel to leave a drop, or drag to draw a streak.'
    : handling(addition);
  return (
    <div
      className="cult-holding"
      role="status"
      data-inset={compact ? 'over' : undefined}
    >
      <div className="cult-holding-line">
        {culture
          ? cultureSwatch(culture)
          : additionSwatch(addition, tool.color || null)}
        <span className="cult-holding-what">
          <strong>{item.name}</strong>
          <span className="cult-holding-hint"> {hint}</span>
        </span>
      </div>
      <div className="cult-holding-keys">
        {culture && (
          <Segmented
            label="How big a drop to leave"
            options={DROPS.map((d) => ({
              value: d.value,
              label: d.label,
              title: d.hint,
            }))}
            value={snap.drop}
            onChange={bench.setDrop}
          />
        )}
        <Button variant="text" onClick={() => bench.arm(null)}>
          Put it down
        </Button>
      </div>
    </div>
  );
}

/** What the bench is, how to look at it, and the ways out. */
function About({ onNotes, onExit, exitLabel, reactHref }) {
  return (
    <div className="cult-about">
      <p className="cult-about-pitch">{PITCH}</p>
      <h3 className="cult-group-head">Looking round</h3>
      <ul className="cult-about-keys">
        <li>
          Drag to turn the plate. With something picked up, drag on the gel to
          draw.
        </li>
        <li>
          Scroll or pinch to come closer, toward the pointer. Double-click the
          gel for a closer look there, and again until the whole plate is back.
        </li>
        <li>
          Right-drag, or hold shift and drag, to slide across the plate. On a
          phone, two fingers slide, pinch and turn it.
        </li>
        <li>
          Keys: arrows turn, shift and the arrows slide, + and − come closer and
          stand back, Home puts the view back, a number picks up that plate,
          space starts and stops the incubator.
        </li>
      </ul>
      <div className="cult-actions">
        <Button size="sm" onClick={onNotes}>
          What is real here
        </Button>
        {reactHref && (
          <Button size="sm" as={Link} to={reactHref}>
            Say what you make of it
          </Button>
        )}
        {onExit && (
          <Button size="sm" variant="text" onClick={onExit}>
            Back to {exitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A menu on the bar, and the panel it drops. The panel sits under its own
 * button, moved left only as far as it must to stay in the window.
 */
function Menu({ id, label, title, open, onToggle, children, wide }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    const bar = trigger?.closest('.cult-bar');
    if (!trigger || !panel || !bar) return;
    const room = bar.clientWidth;
    const want =
      trigger.getBoundingClientRect().left - bar.getBoundingClientRect().left;
    setLeft(Math.max(8, Math.min(want, room - panel.offsetWidth - 8)));
  }, [open]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`cult-menu-trigger${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={`cult-menu-${id}`}
        onClick={() => onToggle(id)}
      >
        {label}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <section
          ref={panelRef}
          id={`cult-menu-${id}`}
          className={`cult-drop cult-drop--${id}${wide ? ' cult-drop--wide' : ''}`}
          aria-label={title}
          style={{ left }}
        >
          {children}
        </section>
      )}
    </>
  );
}

/** A sheet pulled up over the bench on a phone, with its name and a way to
 *  put it away (or back to the list it was opened from). */
function Sheet({ title, onClose, onBack, tall, children }) {
  return (
    <section
      className={`cult-sheet${tall ? ' cult-sheet--tall' : ''}`}
      aria-label={title}
      data-inset="over"
    >
      <header className="cult-sheet-head">
        {onBack && (
          <Button variant="icon" aria-label="Back" onClick={onBack}>
            <ChevronLeft size={18} aria-hidden="true" />
          </Button>
        )}
        <h2 className="cult-sheet-title">{title}</h2>
        <Button variant="icon" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </Button>
      </header>
      <div className="cult-sheet-body">{children}</div>
    </section>
  );
}

/**
 * The workbench, with the window to itself (`fill`) or set in a page. The
 * bench is the whole of it; everything that works it is laid over the
 * picture. On a wide window that is a menu bar along the top, the
 * incubator's strip in one bottom corner and the camera's buttons in the
 * other. On a phone it is a bar along the top for the plate and the
 * incubator, the camera's buttons on the picture, and tabs along the bottom
 * that pull up a sheet. Whatever is laid over the picture is measured and
 * the plates are framed in what it leaves (useInsets).
 *
 * `onExit` and `exitLabel` are the way back out, and `reactHref` where to
 * say what you made of it, when the page round the bench has them.
 */
export default function Workbench({
  fill = false,
  onExit = null,
  exitLabel = 'the site',
  reactHref = null,
}) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const labelsRef = useRef([]);
  const centreRef = useRef(null);
  const selectedRef = useRef(0);
  const floorRef = useRef(Infinity);
  const incoming = useIncomingPlate();
  const reduceMotion = usePrefersReducedMotion();
  const compact = useCompact();
  const { bench, error } = useBench(stageRef, incoming, reduceMotion);
  const snap = useSyncExternalStore(
    useCallback(
      (fn) => (bench ? bench.subscribe(fn) : noSubscription()),
      [bench],
    ),
    () => (bench ? bench.getSnapshot() : null),
  );
  const [open, setOpen] = useState(null);
  const full = useFullscreen(rootRef, fill);
  const room = useInsets(rootRef, bench);

  selectedRef.current = snap?.selected ?? 0;
  floorRef.current = room.height - room.bottom - LABEL_ROOM;

  // With the window to itself the bench takes the wheel; set in a page, a
  // plain wheel scrolls the page unless the bench has been made full screen.
  useEffect(() => {
    bench?.setCaptureWheel(fill || full.expanded);
  }, [bench, fill, full.expanded]);

  // The numbers under the dishes follow the camera, and so does the mark
  // on the middle of the plate in hand. They are moved by hand, a style at
  // a time, so sixty redraws a second don't go through React.
  useEffect(() => {
    if (!bench) return undefined;
    return bench.onFrame((places) => {
      const floor = floorRef.current;
      places.forEach((p, i) => {
        const el = labelsRef.current[i];
        if (el) {
          el.style.transform = `translate(${p.x.toFixed(1)}px, ${Math.min(p.y, floor).toFixed(1)}px) translate(-50%, 0.5em)`;
        }
      });
      const middle = places[selectedRef.current];
      if (centreRef.current && middle) {
        centreRef.current.style.transform = `translate(${middle.x.toFixed(1)}px, ${middle.cy.toFixed(1)}px) translate(-50%, -50%)`;
      }
    });
  }, [bench]);

  // A menu or a sheet is put away by a press anywhere outside it and its
  // bar. A press on the bench still does what it would have: pick a menu
  // item, then touch the gel.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const root = rootRef.current;
      if (!root || !root.contains(e.target)) return;
      if (e.target.closest('.cult-drop, .cult-sheet, .cult-bar, .cult-tabs'))
        return;
      setOpen(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // Moving between a phone and a wide window, what was open on one may not
  // be on the other.
  useEffect(() => {
    setOpen(null);
  }, [compact]);

  const close = useCallback(() => setOpen(null), []);
  const toggle = useCallback(
    (id) => setOpen((was) => (was === id ? null : id)),
    [],
  );

  const takePhoto = useCallback(async () => {
    if (!bench) return;
    const blob = await bench.photo();
    if (!blob) return;
    const state = bench.getSnapshot();
    const plate = state.dishes[state.selected];
    saveBlob(
      blob,
      state.mode === 'plate' && plate
        ? `plate-${state.selected + 1}-${Math.round(plate.hours)}h.png`
        : 'bench.png',
    );
  }, [bench]);

  if (error) {
    return (
      <div className={`cult cult--failed${fill ? ' cult--fill' : ''}`}>
        <div className="cult-failed">
          <h1 className="cult-failed-title">{TITLE}</h1>
          <p>{UNSUPPORTED[error] || UNSUPPORTED.webgl2}</p>
          <p>{PITCH} The notes below still say what it would have shown.</p>
          {onExit && (
            <Button size="sm" onClick={onExit}>
              Back to {exitLabel}
            </Button>
          )}
          <FieldNotes />
        </div>
      </div>
    );
  }

  const inPlate = snap?.mode === 'plate';
  const plate = snap ? snap.dishes[snap.selected] : null;
  const panelProps = () => ({
    bench,
    snap,
    // Once something is picked up the menu or the sheet goes, to give the
    // plate back; what is in hand is said beside the incubator's strip.
    onPick: close,
    onDone: close,
  });
  const about = (
    <About
      onNotes={() => setOpen('notes')}
      onExit={onExit}
      exitLabel={exitLabel}
      reactHref={reactHref}
    />
  );

  return (
    <section
      ref={rootRef}
      className={`cult${fill ? ' cult--fill' : ''}${compact ? ' cult--compact' : ''}`}
      aria-label="Workbench"
      data-mode={snap?.mode || 'bench'}
      data-armed={snap?.tool ? snap.tool.kind : undefined}
      style={{
        '--cult-top': `${room.top}px`,
        '--cult-bottom': `${room.bottom}px`,
        '--cult-h': `${room.height}px`,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          // Back to the button that opened it, as a menu does.
          rootRef.current
            ?.querySelector(`[aria-controls="cult-menu-${open}"]`)
            ?.focus();
          setOpen(null);
        }
      }}
    >
      <div className="cult-stage" ref={stageRef}>
        {/* The canvas is put here by useBench. */}
        {snap && !inPlate && (
          <ol className="cult-labels" aria-hidden="true">
            {snap.dishes.map((dish, i) => (
              <li
                key={i}
                className="cult-label"
                ref={(el) => {
                  labelsRef.current[i] = el;
                }}
              >
                {i + 1}
                {dish.replaying
                  ? ', replaying'
                  : dish.catching
                    ? ', re-growing'
                    : dish.held
                      ? ', in the fridge'
                      : ''}
              </li>
            ))}
          </ol>
        )}
        {/* The middle of the plate in hand, while a culture is held over
            it: where "in the middle" is, to aim at or away from. */}
        {snap && (
          <span className="cult-centre" ref={centreRef} aria-hidden="true" />
        )}
      </div>

      <p id="cult-keys" className="visually-hidden">
        With the bench focused: arrow keys turn the view, shift and the arrows
        slide it, plus and minus come closer and stand back, Home puts the view
        back, a number picks up that plate, Enter picks up the selected one,
        Escape puts it down, and space starts and stops the incubator.
      </p>

      {snap?.notice && (
        <p className="cult-notice" role="status" key={snap.notice.id}>
          {snap.notice.text}
        </p>
      )}
      {snap?.lost && (
        <p className="cult-notice cult-notice--stay" role="alert">
          The browser took the graphics context away. Reload the page to grow
          the bench again from its recipes.
        </p>
      )}
      {!snap && <p className="cult-loading">Setting up the bench…</p>}

      {snap && !compact && (
        <>
          <header className="cult-bar" data-inset="top">
            <h1 className="cult-wordmark">
              <Menu
                id="about"
                label={TITLE}
                title={`About ${TITLE}`}
                open={open === 'about'}
                onToggle={toggle}
              >
                {about}
              </Menu>
            </h1>
            <nav className="cult-menus" aria-label="Workbench">
              {MENUS.map(({ id, title, Panel }) => (
                <Menu
                  key={id}
                  id={id}
                  label={
                    id === 'plates'
                      ? inPlate
                        ? `Plate ${snap.selected + 1}`
                        : 'Plates'
                      : title
                  }
                  title={title}
                  open={open === id}
                  onToggle={toggle}
                  wide={[
                    'cultures',
                    'tray',
                    'media',
                    'incubator',
                    'recipes',
                  ].includes(id)}
                >
                  <div className="cult-panel">
                    <Panel {...panelProps()} />
                  </div>
                </Menu>
              ))}
            </nav>
            <div className="cult-bar-end">
              <Segmented
                className="cult-light-keys"
                label="Light"
                options={LIGHT_KEYS}
                value={snap.light}
                onChange={bench.setLight}
              />
              <Pick
                className="cult-light-pick"
                label="Light"
                options={LIGHT_KEYS}
                value={snap.light}
                onChange={(value) => {
                  bench.setLight(value);
                  const light = LIGHTS.find((l) => l.value === value);
                  if (light) bench.say(light.hint);
                }}
              />
              <Button
                aria-label="Photograph"
                title={
                  inPlate ? 'Photograph this plate' : 'Photograph the bench'
                }
                onClick={takePhoto}
              >
                <Camera size={16} aria-hidden="true" />
                <span className="cult-label-wide">Photograph</span>
              </Button>
              <Randomize bench={bench} snap={snap} />
              {full.able && (
                <Button
                  variant="icon"
                  aria-label={
                    full.expanded ? 'Leave full screen' : 'Full screen'
                  }
                  title={full.expanded ? 'Leave full screen' : 'Full screen'}
                  onClick={full.toggle}
                >
                  {full.expanded ? (
                    <Minimize2 size={16} aria-hidden="true" />
                  ) : (
                    <Maximize2 size={16} aria-hidden="true" />
                  )}
                </Button>
              )}
            </div>
          </header>

          {open === 'notes' && (
            <aside className="cult-notes-panel" aria-label="What is real here">
              <Button
                variant="icon"
                className="cult-notes-close"
                aria-label="Close"
                onClick={close}
              >
                <X size={18} aria-hidden="true" />
              </Button>
              <FieldNotes />
            </aside>
          )}

          <div className="cult-foot">
            <Holding bench={bench} snap={snap} compact={false} />
            <div
              className="cult-transport"
              role="toolbar"
              aria-label="Incubator"
              data-inset="bottom"
            >
              <PlayButton bench={bench} snap={snap} />
              <Segmented
                label="Incubator speed"
                options={SPEEDS}
                value={snap.speed}
                onChange={bench.setSpeed}
              />
              <Replay bench={bench} snap={snap} />
              <p className="cult-caption">
                {inPlate && plate ? (
                  <>
                    <span className="cult-caption-pour">
                      Plate {snap.selected + 1} of {snap.dishes.length}.{' '}
                      {describePlate(plate)}
                    </span>{' '}
                    <span className="cult-caption-age">
                      {describeAge(snap, plate)}.
                    </span>
                  </>
                ) : (
                  <span className="cult-caption-pour">
                    {snap.dishes.length} plates. Click one to pick it up.
                  </span>
                )}
              </p>
            </div>
          </div>
          <ViewTools bench={bench} snap={snap} compact={false} />
        </>
      )}

      {snap && compact && (
        <>
          <header className="cult-bar cult-bar--compact" data-inset="top">
            <h1 className="visually-hidden">{TITLE}</h1>
            <button
              type="button"
              className={`cult-menu-trigger${open === 'plates' ? ' is-open' : ''}`}
              aria-expanded={open === 'plates'}
              onClick={() => toggle('plates')}
            >
              {inPlate ? `Plate ${snap.selected + 1}` : 'Plates'}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            <div className="cult-bar-end" role="toolbar" aria-label="Incubator">
              <PlayButton bench={bench} snap={snap} compact />
              <Pick
                label="Incubator speed"
                options={SPEEDS}
                value={snap.speed}
                onChange={bench.setSpeed}
              />
              <Pick
                label="Light"
                options={LIGHT_KEYS}
                value={snap.light}
                onChange={(value) => {
                  bench.setLight(value);
                  const light = LIGHTS.find((l) => l.value === value);
                  if (light) bench.say(light.hint);
                }}
              />
            </div>
          </header>
          <p className="cult-caption cult-caption--stage" data-inset="top">
            {inPlate && plate ? (
              <>
                <span className="cult-caption-pour">
                  {describePlate(plate)}
                </span>{' '}
                <span className="cult-caption-age">
                  {describeAge(snap, plate)}.
                </span>
              </>
            ) : (
              <span className="cult-caption-pour">
                Tap a plate to pick it up.
              </span>
            )}
          </p>
          <ViewTools bench={bench} snap={snap} compact />

          {!open && <Holding bench={bench} snap={snap} compact />}

          {open && open !== 'more' && open !== 'notes' && open !== 'about' && (
            <Sheet
              title={MENU[open].title}
              onClose={close}
              onBack={
                open === 'recipes' || open === 'record'
                  ? () => setOpen('more')
                  : null
              }
            >
              <div className="cult-panel">
                {(() => {
                  const { Panel } = MENU[open];
                  return <Panel key={open} {...panelProps()} />;
                })()}
              </div>
            </Sheet>
          )}
          {open === 'more' && (
            <Sheet title="More" onClose={close}>
              <ul className="cult-more">
                {['recipes', 'record'].map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="cult-item"
                      onClick={() => setOpen(id)}
                    >
                      <span className="cult-item-name">{MENU[id].title}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="cult-item"
                    onClick={() => setOpen('about')}
                  >
                    <span className="cult-item-name">About {TITLE}</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="cult-item"
                    onClick={() => setOpen('notes')}
                  >
                    <span className="cult-item-name">What is real here</span>
                  </button>
                </li>
              </ul>
              <div className="cult-actions">
                <Replay bench={bench} snap={snap} />
                <Button
                  onClick={() => {
                    close();
                    takePhoto();
                  }}
                >
                  <Camera size={16} aria-hidden="true" />
                  Photograph
                </Button>
                <Randomize
                  bench={bench}
                  snap={snap}
                  className="cult-randomize--named"
                />
                {full.able && (
                  <Button onClick={full.toggle}>
                    {full.expanded ? 'Leave full screen' : 'Full screen'}
                  </Button>
                )}
                {onExit && (
                  <Button variant="text" onClick={onExit}>
                    Back to {exitLabel}
                  </Button>
                )}
              </div>
            </Sheet>
          )}
          {open === 'about' && (
            <Sheet
              title={`About ${TITLE}`}
              onClose={close}
              onBack={() => setOpen('more')}
            >
              {about}
            </Sheet>
          )}
          {open === 'notes' && (
            <Sheet
              title="What is real here"
              tall
              onClose={close}
              onBack={() => setOpen('more')}
            >
              <FieldNotes />
            </Sheet>
          )}

          <nav className="cult-tabs" aria-label="Workbench" data-inset="bottom">
            {TABS.map((id) => {
              const on =
                open === id ||
                (id === 'more' &&
                  ['more', 'recipes', 'record', 'about', 'notes'].includes(
                    open,
                  ));
              return (
                <button
                  key={id}
                  type="button"
                  className={`cult-tab${on ? ' is-on' : ''}`}
                  aria-expanded={on}
                  onClick={() => toggle(id)}
                >
                  {id === 'more' ? 'More' : MENU[id].title}
                </button>
              );
            })}
          </nav>
        </>
      )}
    </section>
  );
}
