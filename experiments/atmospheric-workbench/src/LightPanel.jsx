// The light bench's controls: a shelf of skies to start from, what is in the
// air, and the camera's exposure.

import { Button } from './host.js';
import { Slider, SunControl } from './controls.jsx';
import { CRYSTALS, DISPLAYS } from './optics/displays.js';

const percent = (v) => `${Math.round(v * 100)}%`;

// Length over width. A plate is a coin; a column is a pencil.
const shapeWord = (ratio) =>
  ratio < 0.5
    ? 'thin plate'
    : ratio < 0.9
      ? 'thick plate'
      : ratio <= 1.2
        ? 'as long as wide'
        : ratio < 2.5
          ? 'short column'
          : 'long column';

function Crystal({ sky, kind, state }) {
  const inAir = state.amount > 0.004;
  return (
    <li className="atmo-crystal" data-on={inAir || undefined}>
      <div className="atmo-crystal-head">
        <h4 className="atmo-crystal-name">{kind.name}</h4>
        <p className="atmo-hint">
          {kind.how} Known for: {kind.makes.join(', ').toLowerCase()}.
        </p>
      </div>
      <div className="atmo-fields">
        <Slider
          label="How much"
          value={state.amount}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v > 0.004 ? percent(v) : 'none')}
          onChange={(v) => sky.setCrystal(kind.key, { amount: v })}
        />
        {inAir && (
          <Slider
            label="Shape"
            value={state.ratio}
            min={0.1}
            max={4}
            step={0.1}
            format={(v) => `${v.toFixed(1)}, ${shapeWord(v)}`}
            onChange={(v) => sky.setCrystal(kind.key, { ratio: v })}
          />
        )}
        {inAir && kind.wobbles && (
          <Slider
            label="Wobble"
            value={state.wobble}
            min={0}
            max={12}
            step={0.25}
            format={(v) => `${v}°`}
            onChange={(v) => sky.setCrystal(kind.key, { wobble: v })}
          />
        )}
      </div>
    </li>
  );
}

function rainNote(snap) {
  if (snap.rain <= 0.004) return 'Rain falling across from the sun.';
  if (snap.sun > 51) {
    return 'The sun is above 51°, so both bows are under the horizon. Lower it.';
  }
  if (snap.sun > 42) {
    return 'The sun is above 42°, so the main bow is under the horizon and only the top of the second one shows.';
  }
  return 'Turn your back to the sun to see it.';
}

export default function LightPanel({ sky, snap }) {
  const current = DISPLAYS.find((d) => d.key === snap.display);
  return (
    <div className="atmo-panel">
      <div className="atmo-group">
        <h3 className="atmo-group-title">Start from</h3>
        <div className="atmo-row">
          {DISPLAYS.map((d) => (
            <Button
              key={d.key}
              size="sm"
              on={snap.display === d.key}
              aria-pressed={snap.display === d.key}
              title={d.note}
              onClick={() => sky.show(d.key)}
            >
              {d.name}
            </Button>
          ))}
        </div>
        <p className="atmo-hint">
          {current
            ? current.note
            : 'Each sets the sun and the air and turns you to look. Nothing is drawn as an arc: change what is in the air and the picture is traced again.'}
        </p>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">Sun</h3>
        <div className="atmo-fields">
          <SunControl sky={sky} snap={snap} />
        </div>
        <div className="atmo-row">
          <Button size="sm" onClick={() => sky.face('sun')}>
            Face the sun
          </Button>
          <Button size="sm" onClick={() => sky.face('above')}>
            Look up
          </Button>
          <Button size="sm" onClick={() => sky.face('away')}>
            Turn your back to it
          </Button>
        </div>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">Ice in the air</h3>
        <ul className="atmo-crystals">
          {CRYSTALS.map((kind) => (
            <Crystal
              key={kind.key}
              sky={sky}
              kind={kind}
              state={snap.air[kind.key]}
            />
          ))}
        </ul>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">Rain</h3>
        <div className="atmo-fields">
          <Slider
            label="Shower"
            value={snap.rain}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v > 0.004 ? percent(v) : 'none')}
            onChange={sky.setShower}
            hint={rainNote(snap)}
          />
        </div>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">Camera</h3>
        <div className="atmo-fields">
          <Slider
            label="Exposure"
            value={snap.exposure}
            min={0}
            max={1}
            step={0.05}
            format={(v) => {
              const stops = (v - 0.5) * 4;
              return `${stops > 0 ? '+' : ''}${stops.toFixed(1)} stops`;
            }}
            onChange={sky.setExposure}
          />
        </div>
      </div>
    </div>
  );
}
