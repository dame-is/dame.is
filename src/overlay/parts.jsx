// Small pieces every overlay widget shares: the label over a reading, the
// dash for nothing to say, and a clock that ticks on the second.

import { useEffect, useState } from 'react';
import { labelOf } from '../lib/overlay.js';

export const DASH = '—';

/** The small-caps line over a widget's reading: its own, its kind's, or `fallback`. */
export function Label({ widget, fallback }) {
  const text = labelOf(widget) || '';
  const shown = text || fallback || '';
  return shown ? <p className="ov-label">{shown}</p> : null;
}

/** A clock that ticks every `ms`, aligned to the second. */
export function useTicker(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, ms - (Date.now() % ms) + 5);
    };
    timer = window.setTimeout(tick, ms - (Date.now() % ms) + 5);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return now;
}
