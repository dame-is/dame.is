// The few controls the three benches share, built from the site's kit.

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Segmented } from './host.js';
import { SUN_RANGE } from './sky/engine.js';

/** A labelled slider with what it reads beside the label. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  format = String,
  onChange,
  hint,
}) {
  const id = useId();
  return (
    <div className="atmo-field">
      <label htmlFor={id} className="atmo-field-label">
        {label}
      </label>
      <output htmlFor={id} className="atmo-field-value">
        {format(value)}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="atmo-field-hint">{hint}</p>}
    </div>
  );
}

/** On or off, as a key that stays down. */
export function Switch({ on, onChange, children, ...rest }) {
  return (
    <Button
      size="sm"
      on={on}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      {...rest}
    >
      {children}
    </Button>
  );
}

/**
 * One of a few, picked. A row of keys where there is room for one; on a
 * phone, the system's own picker behind a box the size of a single key.
 */
export function Pick({ label, options, value, onChange, compact }) {
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
    <span className="atmo-select">
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

const sunWords = (deg) => {
  if (deg < 0) return 'just set';
  if (deg < 3) return 'on the horizon';
  if (deg < 12) return 'low';
  if (deg < 35) return 'mid-morning';
  if (deg < 60) return 'high';
  return 'near overhead';
};

/** How high the sun is, and whether it is night. Both benches of sky use it. */
export function SunControl({ sky, snap }) {
  return (
    <div className="atmo-sun">
      <Slider
        label={snap.night ? 'Moon' : 'Sun'}
        value={Math.round(snap.sun)}
        min={SUN_RANGE[0]}
        max={SUN_RANGE[1]}
        step={1}
        format={(v) => `${v}° up, ${sunWords(v)}`}
        onChange={sky.setSun}
      />
      <Switch on={snap.night} onChange={sky.setNight}>
        Night
      </Switch>
    </div>
  );
}
