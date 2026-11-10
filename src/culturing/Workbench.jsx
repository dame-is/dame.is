import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  Camera,
  ChevronDown,
  Dices,
  LayoutGrid,
  Pause,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Button from '../components/Button.jsx';
import Segmented from '../components/Segmented.jsx';
import { createBench, LIGHTS, SPEEDS } from './bench.js';
import { decodeDish } from './recipe.js';
import { mediumById } from './media.js';
import Tray from './Tray.jsx';
import { formatHours } from './format.js';
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
 * "Plate 2 of 6. Broth agar, 1.5 % agar. 30 °C. 41 h." On a phone it is one
 * line, and what is cut short is the pour, never the hour: the hour is the
 * part that changes.
 */
function Caption({ snap, compact }) {
  const plate = snap.dishes[snap.selected];
  if (!plate) return null;
  const medium = mediumById(plate.medium);
  const parts = [
    `Plate ${snap.selected + 1} of ${snap.dishes.length}`,
    `${medium?.name || 'Agar'}, ${plate.agar} % agar`,
    `${plate.env.temperature} °C`,
  ];
  const stopped = compact ? 'stopped' : 'incubator stopped';
  let age = formatHours(plate.hours);
  if (plate.catching) {
    age = `${compact ? 're-growing' : 're-growing from its recipe'}, ${formatHours(plate.hours)} of ${formatHours(plate.goal)}`;
    if (plate.waiting) age = `${age}, ${stopped}`;
  } else if (plate.held) {
    age = `${age}, in the fridge`;
  } else if (!snap.playing) {
    age = `${age}, ${stopped}`;
  }
  return (
    <figcaption className="cult-caption">
      <span className="cult-caption-pour">{parts.join('. ')}.</span>{' '}
      <span className="cult-caption-age">{age}.</span>
    </figcaption>
  );
}

/**
 * One of a few, picked. A row of keys where there is room for one; on a
 * phone, the system's own picker behind a box the size of a single key.
 */
function Pick({ label, options, value, onChange, compact }) {
  if (!compact) {
    return (
      <Segmented
        label={label}
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }
  return (
    <span className="cult-select">
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

/** The camera's controls: back to the bench, closer, further, from above. */
function ViewTools({ bench, inPlate, compact }) {
  return (
    <>
      {inPlate && (
        <Button size="sm" className="cult-tool-back" onClick={bench.leave}>
          <LayoutGrid size={14} aria-hidden="true" />
          All plates
        </Button>
      )}
      {/* Two fingers do this on a phone, and the picture is small enough
          already without two more buttons on it. */}
      {inPlate && !compact && (
        <>
          <Button
            size="sm"
            variant="icon"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => bench.zoomBy(0.8)}
          >
            <ZoomIn size={14} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="icon"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => bench.zoomBy(1.25)}
          >
            <ZoomOut size={14} aria-hidden="true" />
          </Button>
        </>
      )}
      {inPlate && (
        <Button
          size="sm"
          variant="icon"
          aria-label="Look straight down"
          title="Look straight down"
          onClick={bench.topView}
        >
          <ArrowDownToLine size={14} aria-hidden="true" />
        </Button>
      )}
      {/* Across the bench a finger can only turn the view a little, and
          can turn it back; the corner is left to the picture. */}
      {(inPlate || !compact) && (
        <Button
          size="sm"
          variant="icon"
          aria-label="Put the view back"
          title="Put the view back"
          onClick={bench.resetView}
        >
          <RotateCcw size={14} aria-hidden="true" />
        </Button>
      )}
    </>
  );
}

/** The shutter. On a phone it is a square on the picture it takes. */
function Photograph({ inPlate, compact, onClick }) {
  return (
    <Button
      size="sm"
      variant={compact ? 'icon' : 'quiet'}
      className="cult-photo"
      aria-label="Photograph"
      title={inPlate ? 'Photograph this plate' : 'Photograph the bench'}
      onClick={onClick}
    >
      <Camera size={14} aria-hidden="true" />
      {!compact && 'Photograph'}
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
function Randomize({ bench, snap, compact }) {
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
      size="sm"
      variant={armed ? 'danger' : 'quiet'}
      className="cult-randomize"
      aria-label={hint}
      title={hint}
      onClick={() => {
        if (sure && !armed) {
          setArmed(true);
          // A phone's bar has no room for the question, so the stage asks.
          if (compact) {
            bench.say(
              `Press again to throw away what’s on ${what} and randomize.`,
            );
          }
          return;
        }
        setArmed(false);
        if (inPlate) bench.randomize(snap.selected);
        else bench.randomizeBench();
      }}
    >
      <Dices size={14} aria-hidden="true" />
      {!compact && (armed ? `Throw ${what} away and randomize` : 'Randomize')}
    </Button>
  );
}

export default function Workbench() {
  const stageRef = useRef(null);
  const labelsRef = useRef([]);
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

  // The numbers under the dishes follow the camera. They are moved by
  // hand, a style at a time, so sixty redraws a second don't go through
  // React.
  useEffect(() => {
    if (!bench) return undefined;
    return bench.onFrame((places) => {
      // On a short stage the front row sits against the bottom edge: its
      // numbers stay inside the frame instead of being cut off by it.
      const floor = (stageRef.current?.clientHeight ?? Infinity) - LABEL_ROOM;
      places.forEach((p, i) => {
        const el = labelsRef.current[i];
        if (el) {
          el.style.transform = `translate(${p.x.toFixed(1)}px, ${Math.min(p.y, floor).toFixed(1)}px) translate(-50%, 0.5em)`;
        }
      });
    });
  }, [bench]);

  const takePhoto = useCallback(async () => {
    if (!bench) return;
    const blob = await bench.photo();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const state = bench.getSnapshot();
    const plate = state.dishes[state.selected];
    link.href = url;
    link.download =
      state.mode === 'plate' && plate
        ? `plate-${state.selected + 1}-${Math.round(plate.hours)}h.png`
        : 'bench.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [bench]);

  if (error) {
    return (
      <p className="empty-note">
        {UNSUPPORTED[error] || UNSUPPORTED.webgl2} The notes below still say
        what it would have shown.
      </p>
    );
  }

  const inPlate = snap?.mode === 'plate';
  return (
    <section
      className="cult"
      aria-label="Workbench"
      data-mode={snap?.mode || 'bench'}
      data-armed={snap?.tool ? snap.tool.kind : undefined}
    >
      <div className="cult-grid">
        <div className="cult-main">
          <figure className="cult-figure">
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
                      {dish.catching
                        ? ' · re-growing'
                        : dish.held
                          ? ' · fridge'
                          : ''}
                    </li>
                  ))}
                </ol>
              )}
              {/* On a phone the camera's controls and its shutter sit on the
                  picture, where a map keeps its own, and leave the bar a
                  single row with room for what its pickers say. */}
              {snap && compact && (
                <div
                  className="cult-stage-tools"
                  role="group"
                  aria-label="View"
                >
                  <ViewTools bench={bench} inPlate={inPlate} compact />
                  <Photograph inPlate={inPlate} compact onClick={takePhoto} />
                </div>
              )}
              {snap?.notice && (
                <p className="cult-notice" role="status" key={snap.notice.id}>
                  {snap.notice.text}
                </p>
              )}
              {snap?.lost && (
                <p className="cult-notice cult-notice--stay" role="alert">
                  The browser took the graphics context away. Reload the page to
                  grow the bench again from its recipes.
                </p>
              )}
              {!snap && <p className="cult-loading">Setting up the bench…</p>}
            </div>
            {snap && <Caption snap={snap} compact={compact} />}
          </figure>

          <p id="cult-keys" className="visually-hidden">
            With the bench focused: arrow keys turn the view, plus and minus
            zoom, a number picks up that plate, Enter picks up the selected one,
            Escape puts it down, and space starts and stops the incubator.
          </p>

          {snap && (
            <div
              className="cult-bar"
              role="toolbar"
              aria-label="Incubator and view"
            >
              <div className="cult-bar-group">
                <Button
                  size="sm"
                  on={snap.playing}
                  className="cult-play"
                  aria-pressed={snap.playing}
                  aria-label={snap.playing ? 'Incubating' : 'Stopped'}
                  title={
                    snap.playing ? 'Stop the incubator' : 'Start the incubator'
                  }
                  onClick={() => bench.setPlaying(!snap.playing)}
                >
                  {snap.playing ? (
                    <Pause size={14} aria-hidden="true" />
                  ) : (
                    <Play size={14} aria-hidden="true" />
                  )}
                  {!compact && (snap.playing ? 'Incubating' : 'Stopped')}
                </Button>
                <Pick
                  label="Incubator speed"
                  options={SPEEDS}
                  value={snap.speed}
                  onChange={bench.setSpeed}
                  compact={compact}
                />
              </div>
              <div className="cult-bar-group">
                <Pick
                  label="Light"
                  options={LIGHT_KEYS}
                  value={snap.light}
                  onChange={(value) => {
                    bench.setLight(value);
                    // A picker has no tooltips: say what this light shows.
                    const light = LIGHTS.find((l) => l.value === value);
                    if (compact && light) bench.say(light.hint);
                  }}
                  compact={compact}
                />
              </div>
              <div className="cult-bar-group cult-bar-group--end">
                {!compact && <ViewTools bench={bench} inPlate={inPlate} />}
                <Randomize bench={bench} snap={snap} compact={compact} />
                {!compact && (
                  <Photograph inPlate={inPlate} onClick={takePhoto} />
                )}
              </div>
            </div>
          )}
        </div>

        {snap && <Tray bench={bench} snap={snap} compact={compact} />}
      </div>
    </section>
  );
}
