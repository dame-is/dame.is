import { useEffect, useState } from 'react';
import { dayOfLifeSnapshot } from '../lib/dayOfLife.js';

/**
 * Live-ticking day-of-life snapshot. Re-evaluates on UTC-noon boundaries and
 * every 60s for safety.
 */
export function useLiveDayOfLife() {
  const [snap, setSnap] = useState(() => dayOfLifeSnapshot());

  useEffect(() => {
    const id = setInterval(() => setSnap(dayOfLifeSnapshot()), 60_000);
    return () => clearInterval(id);
  }, []);

  return snap;
}
