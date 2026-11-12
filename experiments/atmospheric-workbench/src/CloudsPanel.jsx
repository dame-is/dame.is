// The clouds bench's controls: the sky's weather while looking round, and
// one cloud's shape while it is on the turntable.

import { Button } from './host.js';
import { Pick, Slider, SunControl, Switch } from './controls.jsx';
import { TYPES, TYPE_KEYS } from './sky/clouds.js';

const TYPE_OPTIONS = TYPE_KEYS.map((k) => ({
  value: k,
  label: TYPES[k].name,
  title: TYPES[k].blurb,
}));

const HANDS = [
  { value: 'turn', label: 'Turn' },
  { value: 'puff', label: 'Add puffs' },
  { value: 'poke', label: 'Poke' },
];

const times = (v) => `${(+v).toFixed(1)}×`;
const moodWord = (v) =>
  v < 0.2 ? 'Fair' : v < 0.45 ? 'Grey' : v < 0.7 ? 'Heavy' : 'Stormy';

function Table({ sky, cloud, compact }) {
  const T = TYPES[cloud.type];
  return (
    <div className="atmo-panel">
      <div className="atmo-group">
        <h3 className="atmo-group-title">Hands</h3>
        <Pick
          label="Hands"
          options={HANDS}
          value={cloud.tool}
          onChange={sky.setTool}
          compact={false}
        />
        <p className="atmo-hint">{cloud.hint}</p>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">Kind</h3>
        <Pick
          label="Kind of cloud"
          options={TYPE_OPTIONS}
          value={cloud.type}
          onChange={sky.setType}
          compact={compact}
        />
        <p className="atmo-hint">{T.blurb}</p>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">Shape</h3>
        <div className="atmo-fields">
          <Slider
            label="Size"
            value={cloud.P.size}
            min={0.5}
            max={2.2}
            step={0.05}
            format={times}
            onChange={(v) => sky.setShape('size', v)}
          />
          <Slider
            label="Height"
            value={cloud.P.height}
            min={0.5}
            max={2}
            step={0.05}
            format={times}
            onChange={(v) => sky.setShape('height', v)}
          />
          <Slider
            label="Fluff"
            value={cloud.P.fluff}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => sky.setShape('fluff', v)}
          />
          <Slider
            label="Puffs"
            value={cloud.P.count}
            min={0.4}
            max={1.8}
            step={0.05}
            format={() => cloud.puffs}
            onChange={(v) => sky.setShape('count', v)}
          />
        </div>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">Weather</h3>
        <div className="atmo-fields">
          <Slider
            label="Mood"
            value={cloud.P.mood}
            min={0}
            max={1}
            step={0.01}
            format={moodWord}
            onChange={(v) => sky.setShape('mood', v)}
          />
          <div className="atmo-row">
            <Switch on={cloud.P.rain} onChange={sky.setRain}>
              Rain
            </Switch>
            <Switch on={cloud.P.thunder} onChange={sky.setThunder}>
              Thunder
            </Switch>
          </div>
        </div>
      </div>

      <div className="atmo-row atmo-row--end">
        <Button size="sm" onClick={sky.surprise}>
          Surprise me
        </Button>
        <Button size="sm" onClick={sky.copy}>
          Make a copy
        </Button>
        <Button size="sm" variant="primary" onClick={sky.release}>
          Release to the sky
        </Button>
      </div>
    </div>
  );
}

export default function CloudsPanel({ sky, snap, compact }) {
  if (snap.table)
    return <Table sky={sky} cloud={snap.table} compact={compact} />;
  const picked = snap.picked;
  return (
    <div className="atmo-panel">
      {picked ? (
        <div className="atmo-group">
          <h3 className="atmo-group-title">{picked.name}</h3>
          <p className="atmo-hint">{TYPES[picked.type].blurb}</p>
          <div className="atmo-row">
            <Button size="sm" variant="primary" onClick={sky.toTable}>
              Put it on the turntable
            </Button>
            <Button size="sm" onClick={sky.pop}>
              Pop it
            </Button>
            <Button size="sm" onClick={sky.putDown}>
              Put it down
            </Button>
          </div>
        </div>
      ) : (
        <p className="atmo-hint">
          Drag the sky to look round. Tap a cloud to pick it up, drag it to move
          it, and double-tap it to put it on the turntable.
        </p>
      )}

      <div className="atmo-group">
        <h3 className="atmo-group-title">New cloud</h3>
        <div className="atmo-row">
          {TYPE_KEYS.map((k) => (
            <Button
              key={k}
              size="sm"
              title={TYPES[k].blurb}
              onClick={() => sky.addCloud(k)}
            >
              {TYPES[k].name}
            </Button>
          ))}
        </div>
      </div>

      <div className="atmo-group">
        <h3 className="atmo-group-title">Sky</h3>
        <div className="atmo-fields">
          <SunControl sky={sky} snap={snap} />
          <Slider
            label="Clouds"
            value={Math.min(24, snap.cover)}
            min={0}
            max={24}
            step={1}
            onChange={sky.setCover}
          />
          <Slider
            label="Wind"
            value={snap.knots}
            min={0}
            max={40}
            step={1}
            format={(v) => `${v} kt`}
            onChange={sky.setWind}
          />
        </div>
      </div>
    </div>
  );
}
