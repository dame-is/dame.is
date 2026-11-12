// The ray table, drawn: a dark bench seen from above, a beam of white light
// coming in from the left, and one prism, crystal or raindrop in its way.
//
// Round the edge of the table is a band, like a strip of film bent into a
// circle. It shows where the light lands when the shape is turned every way
// and lit all over (trace.js, ringOf), which is what a cloud of crystals
// does. The bright edge in that band is the halo.
//
// Two components share one state, kept by the workbench: the stage (this
// drawing) and the panel (its controls).

import { useEffect, useRef, useState } from 'react';
import { Pick, Slider, Switch } from '../controls.jsx';
import {
  BANDS,
  SHAPES,
  SHAPE_KEYS,
  knownAngle,
  mainExit,
  reachOf,
  ringOf,
  traceRay,
} from './trace.js';

const DEG = Math.PI / 180;
const INK = '233, 228, 212';

// The table's lettering is in the page's own face.
const faceOf = (canvas) => getComputedStyle(canvas).fontFamily || 'serif';

/** Where each shape starts: a ray a little past its least turn. */
const STARTS = {
  hex: { turn: 4, beam: 0.3 },
  side: { turn: 29, beam: 0.45 },
  prism: { turn: 84, beam: 0.3 },
  drop: { turn: 0, beam: 0.86 },
};

export const RAY_START = {
  shape: 'hex',
  ...STARTS.hex,
  wide: false,
  tumble: false,
};

const SHAPE_OPTIONS = SHAPE_KEYS.map((k) => ({
  value: k,
  label: SHAPES[k].name,
}));

// The band is worked out once for each shape, the first time it is shown.
const rings = new Map();

/** The offsets across the beam that are traced: one ray, or a sheaf. */
function offsets(state) {
  const reach = reachOf(state.shape);
  if (!state.wide) return [state.beam * reach];
  const out = [];
  const n = 23;
  for (let i = 0; i < n; i++)
    out.push((((i + 0.5) / n) * 2 - 1) * reach * 0.97);
  return out;
}

function draw(canvas, state, ring) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const dpr = w / (canvas.clientWidth || w);
  const cx = w / 2;
  const cy = h / 2;
  const span = Math.min(w, h);
  const R = span * 0.445;
  // On a wide table the shape can be bigger without crowding the band.
  const u = span * 0.125;
  const X = (x) => cx + x * u;
  const Y = (y) => cy - y * u;
  const shape = SHAPES[state.shape];

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#0b0c0d';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'butt';

  // The band round the edge.
  ctx.lineWidth = span * 0.03;
  if (ring) {
    for (let b = 0; b < 720; b++) {
      const r = ring[b * 3];
      const g = ring[b * 3 + 1];
      const bl = ring[b * 3 + 2];
      if (r + g + bl < 0.004) continue;
      const a = -(b / 2 - 180) * DEG;
      ctx.strokeStyle = `rgb(${255 * Math.sqrt(r)}, ${255 * Math.sqrt(g)}, ${255 * Math.sqrt(bl)})`;
      ctx.beginPath();
      // a hair over half a degree, so neighbours leave no seam
      ctx.arc(cx, cy, R, a - 0.3 * DEG, a + 0.3 * DEG);
      ctx.stroke();
    }
  }
  ctx.lineWidth = dpr;
  ctx.strokeStyle = `rgba(${INK}, 0.22)`;
  for (const edge of [R - span * 0.015, R + span * 0.015]) {
    ctx.beginPath();
    ctx.arc(cx, cy, edge, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Marks on it: straight on, and the angle this shape is known for.
  const mark = (deg, text) => {
    const a = -deg * DEG;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.strokeStyle = `rgba(${INK}, 0.7)`;
    ctx.beginPath();
    ctx.moveTo(cx + c * (R + span * 0.018), cy + s * (R + span * 0.018));
    ctx.lineTo(cx + c * (R + span * 0.034), cy + s * (R + span * 0.034));
    ctx.stroke();
    if (!text) return;
    ctx.fillStyle = `rgba(${INK}, 0.85)`;
    ctx.fillText(text, cx + c * (R + span * 0.06), cy + s * (R + span * 0.06));
  };
  const face = faceOf(canvas);
  ctx.font = `${12 * dpr}px ${face}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const known = knownAngle(state.shape);
  if (shape.circle) {
    // measured from straight back, the way a rainbow is from the point
    // opposite the sun
    mark(180 - 42, '42°');
    mark(-(180 - 42));
    mark(180 - 51, '51°');
    mark(-(180 - 51));
  } else {
    mark(known, `${Math.round(known)}°`);
    mark(-known);
  }
  mark(0);

  // The path the light would have kept to.
  ctx.setLineDash([3 * dpr, 5 * dpr]);
  ctx.strokeStyle = `rgba(${INK}, 0.25)`;
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // The shape itself.
  ctx.beginPath();
  if (shape.circle) ctx.arc(cx, cy, u, 0, Math.PI * 2);
  else {
    const c = Math.cos(state.turn * DEG);
    const s = Math.sin(state.turn * DEG);
    shape.outline.forEach(([x, y], i) => {
      const px = X(x * c - y * s);
      const py = Y(x * s + y * c);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
  }
  ctx.fillStyle = 'rgba(160, 200, 235, 0.13)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 225, 245, 0.55)';
  ctx.stroke();

  // The light. Each colour is a ray of its own, added to the others, so
  // where they run together they are white and where they part they aren't.
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = (state.wide ? 1 : 1.5) * dpr;
  const far = R / u;
  const gain = state.wide ? 0.55 : 1;
  for (const oy of offsets(state)) {
    for (const band of BANDS) {
      const { segments } = traceRay(state.shape, state.turn, oy, band.nm);
      for (const seg of segments) {
        let { x1, y1 } = seg;
        let x0 = seg.x0;
        if (x1 === null) {
          // out to the band
          const b = seg.x0 * seg.dx + seg.y0 * seg.dy;
          const t =
            -b +
            Math.sqrt(
              Math.max(0, b * b - (seg.x0 ** 2 + seg.y0 ** 2 - far * far)),
            );
          x1 = seg.x0 + seg.dx * t;
          y1 = seg.y0 + seg.dy * t;
        }
        // the beam comes in from the band, not from off the table
        if (!seg.inside && x0 < -far)
          x0 = -Math.sqrt(Math.max(0, far * far - seg.y0 ** 2));
        // brightness is squeezed, so the faint ray that makes a rainbow shows
        const a = Math.min(1, Math.pow(seg.power, 0.36) * gain);
        if (a < 0.03) continue;
        const [r, g, bl] = band.rgb;
        ctx.strokeStyle = `rgba(${Math.min(255, r * 80)}, ${Math.min(255, g * 80)}, ${Math.min(255, bl * 80)}, ${a})`;
        ctx.beginPath();
        ctx.moveTo(X(x0), Y(seg.y0));
        ctx.lineTo(X(x1), Y(y1));
        ctx.stroke();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // How far the ray in hand was turned.
  if (!state.wide) {
    const exit = mainExit(
      state.shape,
      state.turn,
      state.beam * reachOf(state.shape),
    );
    if (exit) {
      const turnedBy = exit.deviation;
      const r = R * 0.62;
      ctx.strokeStyle = `rgba(${INK}, 0.6)`;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, -turnedBy * DEG, turnedBy > 0);
      ctx.stroke();
      const mid = (-turnedBy / 2) * DEG;
      const shown = shape.circle
        ? 180 - Math.abs(turnedBy)
        : Math.abs(turnedBy);
      ctx.fillStyle = `rgba(${INK}, 0.95)`;
      ctx.font = `${14 * dpr}px ${face}`;
      // for a drop the number is the angle left over, so it sits by the gap
      const at = shape.circle
        ? -(turnedBy + (Math.sign(turnedBy) * (180 - Math.abs(turnedBy))) / 2) *
          DEG
        : mid;
      ctx.fillText(
        `${shown.toFixed(1)}°`,
        cx + Math.cos(at) * (r + 22 * dpr),
        cy + Math.sin(at) * (r + 22 * dpr),
      );
    }
  }
}

/** What the ray in hand did, in a line under the table. */
export function rayCaption(state) {
  const shape = SHAPES[state.shape];
  const known = knownAngle(state.shape);
  if (state.wide) {
    return shape.circle
      ? `${shape.name}. Rays all across it. The ones that bounce once inside come back no more than ${known.toFixed(1)}° off the way they came.`
      : `${shape.name}. Rays all across it. None that cross the ${shape.wedge}° wedge is turned less than ${known.toFixed(1)}°.`;
  }
  const exit = mainExit(
    state.shape,
    state.turn,
    state.beam * reachOf(state.shape),
  );
  if (!exit) {
    return `${shape.name}. From here the ray doesn’t get out that way.`;
  }
  if (shape.circle) {
    return `${shape.name}. This ray comes back ${(180 - Math.abs(exit.deviation)).toFixed(1)}° off the way it came. The most it can is ${known.toFixed(1)}°, for green light.`;
  }
  const by = Math.abs(exit.deviation);
  return by < 1
    ? `${shape.name}. This ray goes in one face and out the one opposite, which doesn’t turn it at all.`
    : `${shape.name}. This ray is turned ${by.toFixed(1)}°. The least a ${shape.wedge}° wedge of it can turn green light is ${known.toFixed(1)}°.`;
}

export function RayStage({ state, onChange, reduceMotion }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [ring, setRing] = useState(() => rings.get(state.shape) || null);

  // The band takes a moment to work out, so the table is drawn first.
  useEffect(() => {
    const have = rings.get(state.shape);
    setRing(have || null);
    if (have) return undefined;
    const id = setTimeout(() => {
      const made = ringOf(state.shape);
      rings.set(state.shape, made);
      setRing(made);
    }, 30);
    return () => clearTimeout(id);
  }, [state.shape]);

  // Sized to its box, at the screen's own resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    const fit = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      draw(canvas, stateRef.current, rings.get(stateRef.current.shape));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draw(canvasRef.current, state, ring);
  }, [state, ring]);

  // Turning by itself, a sixth of a turn a second.
  const tumbling = state.tumble && !SHAPES[state.shape].circle;
  useEffect(() => {
    if (!tumbling) return undefined;
    let id = 0;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      onChange({ turn: (s.turn + dt * 18) % SHAPES[s.shape].fold });
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [tumbling, onChange]);

  // A drag turns the shape about its middle; on a drop, which looks the same
  // from every side, it moves the ray up and down instead.
  const drag = useRef(null);
  const angleAt = (e) => {
    const box = canvasRef.current.getBoundingClientRect();
    return Math.atan2(
      -(e.clientY - box.top - box.height / 2),
      e.clientX - box.left - box.width / 2,
    );
  };
  const beamAt = (e) => {
    const box = canvasRef.current.getBoundingClientRect();
    const u = Math.min(box.width, box.height) * 0.125;
    const y = -(e.clientY - box.top - box.height / 2) / u;
    return Math.max(-0.98, Math.min(0.98, y / reachOf(stateRef.current.shape)));
  };
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { angle: angleAt(e) };
    if (SHAPES[state.shape].circle) onChange({ beam: beamAt(e) });
    else if (state.tumble) onChange({ tumble: false });
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const s = stateRef.current;
    if (SHAPES[s.shape].circle) {
      onChange({ beam: beamAt(e) });
      return;
    }
    const angle = angleAt(e);
    let by = (angle - drag.current.angle) / DEG;
    by -= Math.round(by / 360) * 360;
    drag.current.angle = angle;
    const fold = SHAPES[s.shape].fold;
    onChange({ turn: (((s.turn + by) % fold) + fold) % fold });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e) => {
    const s = stateRef.current;
    const fold = SHAPES[s.shape].fold;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (SHAPES[s.shape].circle) return;
      const by = e.key === 'ArrowLeft' ? step : -step;
      onChange({ turn: (((s.turn + by) % fold) + fold) % fold });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const by = (e.key === 'ArrowUp' ? 0.02 : -0.02) * step;
      onChange({ beam: Math.max(-0.98, Math.min(0.98, s.beam + by)) });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <div className="atmo-stage atmo-stage--table">
        <canvas
          ref={canvasRef}
          className="atmo-canvas"
          tabIndex={0}
          role="img"
          aria-label={`${SHAPES[state.shape].name} on a dark bench, with a beam of white light going through it from the left.`}
          aria-describedby="atmo-ray-keys"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        />
        {!ring && (
          <p className="atmo-notice atmo-notice--stay">
            Turning it every way to see where the light lands…
          </p>
        )}
      </div>
      <figcaption className="atmo-caption">{rayCaption(state)}</figcaption>
      <p id="atmo-ray-keys" className="visually-hidden">
        With the table focused: left and right arrows turn the shape, up and
        down move the ray across it. Hold Shift for bigger steps.
        {reduceMotion ? '' : ' It can also be left turning by itself.'}
      </p>
    </>
  );
}

export function RayPanel({ state, onChange, compact }) {
  const shape = SHAPES[state.shape];
  return (
    <div className="atmo-panel">
      <div className="atmo-group">
        <h3 className="atmo-group-title">On the table</h3>
        <Pick
          label="What is on the table"
          options={SHAPE_OPTIONS}
          value={state.shape}
          onChange={(next) => onChange({ shape: next, ...STARTS[next] })}
          compact={compact}
        />
        <p className="atmo-hint">{shape.note}</p>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">The ray</h3>
        <div className="atmo-fields">
          {!shape.circle && (
            <Slider
              label="Turn it"
              value={Math.round(state.turn * 2) / 2}
              min={0}
              max={shape.fold}
              step={0.5}
              format={(v) => `${v}°`}
              onChange={(v) => onChange({ turn: v, tumble: false })}
            />
          )}
          <Slider
            label="Where it goes in"
            value={state.beam}
            min={-0.98}
            max={0.98}
            step={0.01}
            format={(v) =>
              Math.abs(v) < 0.005
                ? 'dead centre'
                : `${Math.round(Math.abs(v) * 100)}% of the way to the ${v > 0 ? 'top' : 'bottom'} edge`
            }
            onChange={(v) => onChange({ beam: v, wide: false })}
          />
          <div className="atmo-row">
            <Switch on={state.wide} onChange={(on) => onChange({ wide: on })}>
              Rays all across it
            </Switch>
            {!shape.circle && (
              <Switch
                on={state.tumble}
                onChange={(on) => onChange({ tumble: on })}
              >
                Keep it turning
              </Switch>
            )}
          </div>
        </div>
      </div>

      <p className="atmo-hint">
        The band round the edge is where the light lands if{' '}
        {shape.circle
          ? 'rays go in all across the drop'
          : 'the shape is turned every way and lit all over'}
        , which is what a sky full of them does. Its bright edge is the{' '}
        {shape.circle ? 'rainbow' : 'halo'}.
      </p>
    </div>
  );
}
