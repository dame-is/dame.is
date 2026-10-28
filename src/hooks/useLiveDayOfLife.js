import { useEffect, useState } from 'react';
import { dayOfLifeSnapshot } from '../lib/dayOfLife.js';

/**
 * Live-ticking day-of-life snapshot. Re-evaluated every 60s, so the count
 * turns over within a minute of midnight in New York (lib/dayOfLife.js
 * counts on Dame's calendar), whatever the reader's zone. The previous
 * snapshot is kept when nothing has changed, which is every tick but one a day,
 * so the chrome bar isn't re-rendered once a minute to say the same thing.
 */
export function useLiveDayOfLife() {
  const [snap, setSnap] = useState(() => dayOfLifeSnapshot());

  useEffect(() => {
    const id = setInterval(() => {
      const next = dayOfLifeSnapshot();
      // Everything in the snapshot moves with the day count.
      setSnap((prev) => (prev.day === next.day ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  return snap;
}
