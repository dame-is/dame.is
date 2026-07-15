import { useLiveFeed } from './useLiveFeed.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { normalizeVitals } from '../lib/vitals.js';
import { ME_DID, COLLECTIONS } from '../config.js';

/**
 * The is.dame.state append log as a time-ordered array of normalized samples
 * (oldest → newest), for the /logging dashboard. Snapshot-first (the build
 * writes the newest ~200 to state.json) then live via listRecords. Each sample
 * is `{ ...vitals, t }` where `t` is the capture time in ms; readings that came
 * back empty/0 (see normalizeVitals) are simply absent on that sample.
 */
export function useStateHistory({ max = 500 } = {}) {
  const { items, status } = useLiveFeed({
    name: 'state',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.state, max });
    },
    mapItems: toSamples,
  });
  return { samples: items || [], status };
}

function toSamples(records) {
  if (!Array.isArray(records)) return [];
  return records
    .map((r) => {
      const v = normalizeVitals(r?.value);
      if (!v || !v.sampledAt) return null;
      const t = Date.parse(v.sampledAt);
      if (!Number.isFinite(t)) return null;
      return { ...v, t };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}
