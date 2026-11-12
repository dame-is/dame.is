// <AtmosphericWorkbench />: the whole experiment as one component. Three
// benches share one stage, and under them are the notes on which parts are
// borrowed from where.
//
//   Clouds   a sky to look round, and a turntable to reshape one cloud on
//   Light    ice in the air and rain across from the sun: halos and bows
//   Rays     one prism, crystal or raindrop, and the light through it
//
// The first two are the same sky (sky/engine.js), drawn with WebGL. The
// third is a drawing of its own (raytable/RayTable.jsx).
//
//   storage   where the sky is kept: { load, save }. Leave it out for
//             localStorage; pass null to keep nothing. Keep the same object
//             between renders, or the sky is built again.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button, Segmented } from './host.js';
import { browserStorage, createSky } from './sky/engine.js';
import CloudsPanel from './CloudsPanel.jsx';
import LightPanel from './LightPanel.jsx';
import { RAY_START, RayPanel, RayStage } from './raytable/RayTable.jsx';
import FieldNotes from './FieldNotes.jsx';
import { CRYSTALS } from './optics/displays.js';
import { TYPES } from './sky/clouds.js';
import { useCompact } from './useCompact.js';
import './atmospheric-workbench.css';

const BENCHES = [
  { value: 'clouds', label: 'Clouds' },
  { value: 'light', label: 'Halos and bows' },
  { value: 'rays', label: 'Rays' },
];

const noSubscription = () => () => {};

function usePrefersReducedMotion() {
  const [reduce] = useState(
    () =>
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return reduce;
}

/**
 * The sky, in the stage. The engine makes its own canvas: it hands its WebGL
 * context back when it is taken down, and a context can't be had twice from
 * one canvas, which is what React's double mount in development would ask.
 */
function useSky(stageRef, storage, reduceMotion) {
  const [sky, setSky] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let made = null;
    try {
      made = createSky(stage, { storage, reduceMotion });
      setSky(made);
      setFailed(false);
    } catch (error) {
      console.error(error);
      setFailed(true);
    }
    return () => {
      made?.destroy();
      setSky(null);
    };
  }, [stageRef, storage, reduceMotion]);
  return { sky, failed };
}

const millions = (n) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)} million`
    : `${Math.round(n / 1000).toLocaleString('en-US')} thousand`;

/** What is on the stage, in a line under it. */
function Caption({ snap }) {
  const sun = snap.night
    ? 'Night, the moon up'
    : `Sun ${Math.round(snap.sun)}° up`;
  let parts;
  if (snap.bench === 'light') {
    const inAir = CRYSTALS.filter((c) => snap.air[c.key].amount > 0.004).map(
      (c) => c.name.toLowerCase(),
    );
    if (snap.rain > 0.004) inAir.push('rain');
    parts = [
      sun,
      inAir.length ? `In the air: ${inAir.join(', ')}` : 'Clear air',
      snap.rays > 0
        ? `${millions(snap.rays)} rays traced${snap.tracing ? ', still tracing' : ''}`
        : null,
    ];
  } else if (snap.table) {
    const c = snap.table;
    parts = [
      c.name,
      TYPES[c.type].sci,
      `Base ${c.base}, tops ${c.tops}`,
      `${c.puffs} puffs`,
    ];
  } else if (snap.picked) {
    const c = snap.picked;
    parts = [
      c.name,
      TYPES[c.type].sci,
      `Base ${c.base}, tops ${c.tops}`,
      `${c.puffs} puffs`,
    ];
  } else {
    parts = [
      sun,
      `${snap.cover} ${snap.cover === 1 ? 'cloud' : 'clouds'} in reach`,
      `Wind ${snap.knots} kt`,
    ];
  }
  return (
    <figcaption className="atmo-caption">
      {parts.filter(Boolean).join('. ')}.
    </figcaption>
  );
}

const defaultStorage = browserStorage();

export default function AtmosphericWorkbench({ storage = defaultStorage }) {
  const stageRef = useRef(null);
  const reduceMotion = usePrefersReducedMotion();
  const compact = useCompact();
  const { sky, failed } = useSky(stageRef, storage, reduceMotion);
  const snap = useSyncExternalStore(
    useCallback((fn) => (sky ? sky.subscribe(fn) : noSubscription()), [sky]),
    () => (sky ? sky.getSnapshot() : null),
    () => null,
  );

  // The ray table is a drawing of its own, so "which bench" is the page's to
  // know; the sky only knows whether it is showing clouds or light.
  const [rays, setRays] = useState(false);
  const [ray, setRay] = useState(RAY_START);
  const changeRay = useCallback(
    (patch) => setRay((was) => ({ ...was, ...patch })),
    [],
  );
  const bench = rays ? 'rays' : snap?.bench || 'clouds';
  const setBench = (next) => {
    setRays(next === 'rays');
    if (next !== 'rays') sky?.setBench(next);
  };
  useEffect(() => {
    sky?.setPaused(rays);
  }, [sky, rays]);

  // Without WebGL there is no sky, but the ray table is drawn on a plain
  // canvas and still works.
  const skyless = failed && !rays;

  return (
    <>
      <section
        className="atmo"
        aria-label="Workbench"
        data-bench={bench}
        data-mode={snap?.mode}
        data-tool={snap?.table?.tool}
      >
        <div className="atmo-grid">
          <div className="atmo-main">
            <figure className="atmo-figure">
              <div className="atmo-stage" ref={stageRef} hidden={rays}>
                {/* The canvas is put here by useSky. */}
                {snap?.notice && (
                  <p className="atmo-notice" role="status" key={snap.notice.id}>
                    {snap.notice.text}
                  </p>
                )}
                {snap?.lost && (
                  <p className="atmo-notice atmo-notice--stay" role="alert">
                    The browser took the graphics context away. Reload the page
                    to get the sky back.
                  </p>
                )}
                {!snap && !failed && (
                  <p className="atmo-loading">Putting the sky up…</p>
                )}
                {skyless && (
                  <p className="atmo-loading">
                    The sky is drawn with WebGL, and this browser wouldn’t start
                    it. The ray table doesn’t need it.
                  </p>
                )}
              </div>
              {rays && (
                <RayStage
                  state={ray}
                  onChange={changeRay}
                  reduceMotion={reduceMotion}
                />
              )}
              {snap && !rays && <Caption snap={snap} />}
            </figure>

            <div
              className="atmo-bar"
              role="toolbar"
              aria-label="Bench and view"
            >
              <Segmented
                label="Bench"
                options={BENCHES}
                value={bench}
                onChange={setBench}
              />
              {snap && !rays && (
                <div className="atmo-bar-end">
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label="Zoom in"
                    title="Zoom in"
                    onClick={() => sky.zoomBy(1 / 1.2)}
                  >
                    <ZoomIn size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label="Zoom out"
                    title="Zoom out"
                    onClick={() => sky.zoomBy(1.2)}
                  >
                    <ZoomOut size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label="Put the view back"
                    title="Put the view back"
                    onClick={sky.resetView}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="atmo-side">
            {snap && bench === 'clouds' && (
              <CloudsPanel sky={sky} snap={snap} compact={compact} />
            )}
            {snap && bench === 'light' && (
              <LightPanel sky={sky} snap={snap} compact={compact} />
            )}
            {rays && (
              <RayPanel state={ray} onChange={changeRay} compact={compact} />
            )}
          </div>
        </div>
      </section>
      <FieldNotes />
    </>
  );
}
