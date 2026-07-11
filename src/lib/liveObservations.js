// Surface brand-new iNaturalist observations on the home feed before the
// mirror cron has written them to the PDS.
//
// The home feed reads observations from mirrored `is.dame.{mothing,observing}.
// observation` records, which the cron refreshes every few hours. This module
// closes the remaining gap: it asks iNaturalist directly for anything logged
// after the newest mirrored observation and shapes those into feed items.
//
// Each item is built from the SAME record value the mirror writes
// (`mothingObservationValue` / `observingObservationValue`) and borrows the
// deterministic `at://…/<iNat id>` URI the mirror will assign, so once the
// observation IS mirrored the two are one and the same feed entry — the feed
// dedupes on at:// URI, so there's never a duplicate. Location is stripped
// upstream in `normalizeObservation`; it never reaches here.

import { ME_DID, INATURALIST_USER, MOTHING_OBSERVATION_NSID, OBSERVING_OBSERVATION_NSID } from '../config.js';
import {
  fetchObservationsNewerThanId,
  mothingObservationValue,
  observingObservationValue,
} from './inaturalist.js';

// A short in-memory cache so the home feed's 30s background polls don't hit
// iNaturalist every tick — a fresh observation still shows within the TTL.
// Keyed by the inputs that change the result (newest mirrored id, user, which
// verbs are wanted). Node one-shot runs never hit the second call.
const TTL_MS = 120_000;
let cache = null;

/**
 * @returns {Promise<object[]>} feed items for observations newer than the
 *   newest mirrored one, shaped like the mirrored observation feed items.
 */
export async function fetchLiveObservationItems({
  me = ME_DID,
  newestMirroredId,
  user = INATURALIST_USER,
  wantMothing = true,
  wantObserving = true,
  warn = () => {},
} = {}) {
  if (!newestMirroredId || (!wantMothing && !wantObserving)) return [];

  const key = `${me}|${newestMirroredId}|${user}|${wantMothing ? 1 : 0}${wantObserving ? 1 : 0}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.items;

  let observations;
  try {
    observations = await fetchObservationsNewerThanId({ user, sinceId: newestMirroredId });
  } catch (err) {
    warn('liveObservations: iNaturalist fetch failed:', err?.message || err);
    return cache && cache.key === key ? cache.items : [];
  }

  const items = [];
  for (const obs of observations) {
    if (obs?.id == null) continue;
    const isMoth = Boolean(obs.isMoth);
    if (isMoth ? !wantMothing : !wantObserving) continue;
    const nsid = isMoth ? MOTHING_OBSERVATION_NSID : OBSERVING_OBSERVATION_NSID;
    const value = isMoth ? mothingObservationValue(obs) : observingObservationValue(obs);
    items.push({
      verb: isMoth ? 'mothing' : 'observing',
      source: 'inaturalist',
      createdAt: value.createdAt || null,
      atUri: `at://${me}/${nsid}/${obs.id}`,
      cid: null,
      payload: value,
      // Not yet on the PDS — the row links out to iNaturalist (ObservationCard
      // already does), so a click never lands on a missing record page.
      _live: true,
    });
  }

  cache = { key, at: Date.now(), items };
  return items;
}
