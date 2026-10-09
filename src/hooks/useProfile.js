import { useEffect, useState } from 'react';
import { getProfile } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID } from '../config.js';

// The last profile any mount saw. The top chrome's expanded row unmounts when
// it collapses, so without this every re-open started from nothing (a "—",
// then the snapshot, then the live fetch, each landing mid-animation) and
// replayed the follower count-up from 0.
let lastProfile = null;

export function useProfile() {
  const [profile, setProfileState] = useState(lastProfile);
  const [status, setStatus] = useState(lastProfile ? 'ready' : 'idle');

  useEffect(() => {
    let cancelled = false;
    const setProfile = (next) => {
      lastProfile = next;
      setProfileState(next);
    };
    async function run() {
      // A remembered profile is newer than the build's snapshot, so the
      // snapshot is only worth reading on the first mount.
      const remembered = lastProfile;
      if (!remembered) setStatus('loading');
      const seed = remembered ? null : await fetchSnapshot('profile');
      if (!cancelled && seed && Object.keys(seed).length) setProfile(seed);
      try {
        const live = await getProfile(ME_DID);
        if (!cancelled && live) {
          setProfile(live);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus(seed || remembered ? 'stale' : 'error');
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { profile, status };
}
