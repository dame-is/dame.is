// The reaction time, while it is still being made.
//
// Every other number on this project is finished. This one is the measurement
// running: from the moment the breaking like landed to the moment the artist
// closes replies, which is the single figure the whole thing exists to take.
// It is worth watching precisely because you can still change it.
//
// The arithmetic is deliberately the same arithmetic the record will carry.
// The like's instant comes from its record key — the PDS write clock — and
// "now" is this machine's clock, which is exactly the pair `seal()` subtracts
// when it writes `reactionMs`. So what this reads at the instant you press the
// button is, to within the render, what the record will say forever. Any skew
// between the two clocks is in both numbers equally, as it has been in every
// reaction time this project has ever recorded.
//
// Its own component, and its own re-render: this ticks twenty times a second
// next to a panel holding a firehose and three hundred feed rows, and the only
// thing that should be re-rendering at that rate is the digits.

import { useEffect, useState } from 'react';
import { fmtStopwatch } from '../lib/ratioed.js';
import './RatioedClock.css';

// Fast enough that the hundredths look continuous rather than sampled, slow
// enough that it isn't animation. A rAF loop would be 60 renders a second to
// show a number that only has 100 distinct states per second anyway.
const TICK_MS = 50;

/**
 * `fromMs` is the epoch millisecond the clock counts from. `running` false
 * freezes it where it is — which is what the seal does, and what makes the
 * last number on screen the one that was true when the button was pressed.
 */
export default function RatioedClock({ fromMs, running = true, decimals = 2, className = '' }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  if (!Number.isFinite(fromMs)) return null;
  return (
    <span className={`rk-clock${className ? ` ${className}` : ''}`}>
      {fmtStopwatch(now - fromMs, decimals)}
    </span>
  );
}
