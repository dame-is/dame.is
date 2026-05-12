import { useEffect, useState } from 'react';
import { getProfile } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID } from '../config.js';

export function useProfile() {
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setStatus('loading');
      const seed = await fetchSnapshot('profile');
      if (!cancelled && seed && Object.keys(seed).length) setProfile(seed);
      try {
        const live = await getProfile(ME_DID);
        if (!cancelled && live) {
          setProfile(live);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus(seed ? 'stale' : 'error');
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { profile, status };
}
