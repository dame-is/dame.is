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
    const made = createBench(canvas, { incoming });
    if (made.error) {
      canvas.remove();
      setError(made.error);
      return undefined;
    }
    // Growth is motion. Someone who has asked for less of it starts with
    // the incubator stopped, and presses play if they want it.
    if (reduceMotion) made.setPlaying(false);
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

/** "Plate 2 of 6. Broth agar, 1.5 % agar. 30 °C. 41 h." */
function Caption({ snap }) {
  const plate = snap.dishes[snap.selected];
  if (!plate) return null;
  const medium = mediumById(plate.medium);
  const parts = [
    `Plate ${snap.selected + 1} of ${snap.dishes.length}`,
    `${medium?.name || 'Agar'}, ${plate.agar} % agar`,
    `${plate.env.temperature} °C`,
  ];
  let age = formatHours(plate.hours);
  if (plate.catching) {
    age = `re-growing from its recipe, ${formatHours(plate.hours)} of ${formatHours(plate.goal)}`;
  } else if (plate.held) {
    age = `${age}, in the fridge`;
  } else if (!snap.playing) {
    age = `${age}, incubator stopped`;
  }
  return (
    <figcaption className="cult-caption">
      {parts.join('. ')}. <span className="cult-caption-age">{age}.</span>
    </figcaption>
  );
}

export default function Workbench() {
  const stageRef = useRef(null);
  const labelsRef = useRef([]);
  const incoming = useIncomingPlate();
  const reduceMotion = usePrefersReducedMotion();
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
      places.forEach((p, i) => {
        const el = labelsRef.current[i];
        if (el) {
          el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, 0.5em)`;
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
            {snap && <Caption snap={snap} />}
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
                  aria-pressed={snap.playing}
                  onClick={() => bench.setPlaying(!snap.playing)}
                >
                  {snap.playing ? (
                    <Pause size={14} aria-hidden="true" />
                  ) : (
                    <Play size={14} aria-hidden="true" />
                  )}
                  {snap.playing ? 'Incubating' : 'Stopped'}
                </Button>
                <Segmented
                  label="Incubator speed"
                  options={SPEEDS}
                  value={snap.speed}
                  onChange={bench.setSpeed}
                />
              </div>
              <div className="cult-bar-group">
                <Segmented
                  label="Light"
                  options={LIGHTS.map((l) => ({
                    value: l.value,
                    label: l.label,
                    title: l.hint,
                  }))}
                  value={snap.light}
                  onChange={bench.setLight}
                />
              </div>
              <div className="cult-bar-group">
                {inPlate && (
                  <>
                    <Button size="sm" onClick={bench.leave}>
                      <LayoutGrid size={14} aria-hidden="true" />
                      All plates
                    </Button>
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
                    <Button
                      size="sm"
                      variant="icon"
                      aria-label="Look straight down"
                      title="Look straight down"
                      onClick={bench.topView}
                    >
                      <ArrowDownToLine size={14} aria-hidden="true" />
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="icon"
                  aria-label="Put the view back"
                  title="Put the view back"
                  onClick={bench.resetView}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                </Button>
                <Button size="sm" onClick={takePhoto}>
                  <Camera size={14} aria-hidden="true" />
                  Photograph
                </Button>
              </div>
            </div>
          )}
        </div>

        {snap && <Tray bench={bench} snap={snap} />}
      </div>
    </section>
  );
}
