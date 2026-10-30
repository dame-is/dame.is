import { useEffect, useRef, useState } from 'react';
import { createProfileAsker } from '../lib/profileAsker.js';

/**
 * Profiles for whichever accounts are in `dids`, resolved as new ones appear,
 * keyed by DID. See profileAsker for why an answer is never thrown away.
 */
export function useProfiles(dids) {
  const [profiles, setProfiles] = useState({});
  const asker = useRef(null);
  // One string, so the ask below runs when the set of accounts changes rather
  // than on every render that builds a new array of the same ones.
  const key = Array.from(new Set((dids || []).filter(Boolean))).sort().join('\n');

  useEffect(() => {
    const a = createProfileAsker({
      onFound: (found) => setProfiles((old) => ({ ...old, ...found })),
    });
    asker.current = a;
    return () => {
      a.close();
      if (asker.current === a) asker.current = null;
    };
  }, []);

  useEffect(() => {
    if (key) asker.current?.ask(key.split('\n'));
  }, [key]);

  return profiles;
}
