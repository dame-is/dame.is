import { useEffect, useRef, useState } from 'react';
import { getProfile } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { ME_DID } from '../config.js';

// The Bluesky avatar is a content-addressed CDN URL — its blob CID (and so
// the URL) changes whenever the avatar image changes. Dame's avatar is
// regenerated every hour to track the sun's position, so a URL grabbed once
// on mount goes stale for anyone who leaves the tab open across the hour.
//
// We keep it current by re-fetching the profile on the shared refresh tick,
// throttled to a few minutes — the avatar only turns over hourly, so there's
// no need to hammer the AppView every 30s. The tick's visibility handler also
// fires a refresh the moment the tab regains focus, so returning after a while
// snaps to the current avatar immediately.
const AVATAR_REFETCH_MS = 5 * 60_000;

/**
 * Current avatar URL for the site owner, kept fresh across hourly changes.
 * Returns `null` until the first (snapshot or live) value resolves, so callers
 * can fall back to a placeholder glyph while it loads.
 */
export function useAvatar() {
  const [avatar, setAvatar] = useState(null);
  const cancelledRef = useRef(false);
  const avatarRef = useRef(null);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    cancelledRef.current = false;

    async function refresh() {
      // Only actually hit the network every few minutes — the tick fires far
      // more often than the avatar changes.
      const now = Date.now();
      if (now - lastFetchRef.current < AVATAR_REFETCH_MS) return;
      lastFetchRef.current = now;
      try {
        const live = await getProfile(ME_DID, { cache: 'no-store' });
        if (cancelledRef.current) return;
        if (live?.avatar && live.avatar !== avatarRef.current) {
          avatarRef.current = live.avatar;
          setAvatar(live.avatar);
        }
      } catch {
        // Network hiccup — keep showing the last-known avatar.
      }
    }

    async function boot() {
      const seed = await fetchSnapshot('profile');
      if (!cancelledRef.current && seed?.avatar) {
        avatarRef.current = seed.avatar;
        setAvatar(seed.avatar);
      }
      // Force the boot fetch past the throttle so we replace the (possibly
      // hours-old) snapshot avatar with the current one right away.
      lastFetchRef.current = 0;
      refresh();
    }

    boot();
    const unsubscribe = subscribeRefreshTick(refresh);
    return () => {
      cancelledRef.current = true;
      unsubscribe();
    };
  }, []);

  return avatar;
}
