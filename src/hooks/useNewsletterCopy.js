import { useLiveFeed } from './useLiveFeed.js';
import { resolvePds, getRecord, isRecordNotFound } from '../lib/atproto.js';
import { DEFAULT_NEWSLETTER_COPY, mergeNewsletterCopy } from '../lib/newsletterCopy.js';
import { ME_DID, COLLECTIONS } from '../config.js';

// One live read a visit. A post can hold several forms and each asks; the
// record is the same record each time. A failure isn't kept, so a later form
// gets to try.
let liveRead = null;
function readLive() {
  if (!liveRead) {
    const read = (async () => {
      const pds = await resolvePds(ME_DID);
      try {
        return await getRecord(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.newsletter,
          rkey: 'self',
        });
      } catch (err) {
        // No record is an answer: the built-in words.
        if (isRecordNotFound(err)) return { value: {} };
        throw err;
      }
    })();
    liveRead = read;
    read.catch(() => {
      if (liveRead === read) liveRead = null;
    });
  }
  return liveRead;
}

/**
 * The newsletter's words (lib/newsletterCopy.js), the build's snapshot first
 * and the PDS over it. Never empty: until either answers, and if neither
 * does, it is the built-in wording.
 */
export function useNewsletterCopy() {
  const { items } = useLiveFeed({
    name: 'newsletter',
    strategy: 'snapshot-first',
    fetchLive: readLive,
    mapItems: (data) => mergeNewsletterCopy(data?.value),
  });
  return items || DEFAULT_NEWSLETTER_COPY;
}
