import { useEffect, useRef, useState } from 'react';
import { useProfile } from '../hooks/useProfile.js';

/**
 * Animated count-up for follower / following counts. Ports the spirit of
 * js/main.js:619-802 — short ramp from 0 to the actual count whenever the
 * value changes.
 */
function useCountUp(target, ms = 700) {
  const [n, setN] = useState(typeof target === 'number' ? target : 0);
  const startRef = useRef(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (typeof target !== 'number') return;
    cancelAnimationFrame(rafRef.current);
    fromRef.current = n;
    startRef.current = performance.now();
    function tick(t) {
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setN(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);

  return n;
}

export default function ProfileStats() {
  const { profile } = useProfile();
  const followers = useCountUp(profile?.followersCount ?? null);
  const following = useCountUp(profile?.followsCount ?? null);
  if (typeof profile?.followersCount !== 'number') {
    return null;
  }
  return (
    <span className="chrome-signal chrome-signal-stats">
      <span className="chrome-signal-label">follows</span>
      <span className="chrome-signal-value">
        <strong>{followers.toLocaleString()}</strong>
        <span> · </span>
        <strong>{following.toLocaleString()}</strong>
      </span>
    </span>
  );
}
