import { useEffect, useState } from 'react';
import { resolvePds, listRecordsPage, getPosts, getProfile, rkeyFromAtUri } from '../lib/atproto.js';
import { recordHrefFor } from '../lib/verbRegistry.js';
import { gapBetween, neighbourWhen, recordSentence, sentenceText } from '../lib/recordPlate.js';
import { ME_DID } from '../config.js';

const timeOf = (v) => v?.createdAt || v?.playedTime || v?.playedAt || v?.publishedAt || null;

/**
 * Who or what a reference record points at, as a short name: a liked or
 * reposted post's author handle, a followed account's name. Null for content
 * records, or when the lookup fails (the sentence then reads without it).
 */
export async function subjectNames(values) {
  const postUris = [];
  const dids = [];
  for (const v of values) {
    const s = v?.subject;
    if (typeof s?.uri === 'string' && s.uri.includes('/app.bsky.feed.post/')) postUris.push(s.uri);
    else if (typeof s === 'string' && s.startsWith('did:')) dids.push(s);
  }
  const names = new Map();
  try {
    const posts = postUris.length ? await getPosts(postUris) : {};
    for (const [uri, p] of Object.entries(posts)) if (p?.handle) names.set(uri, `@${p.handle}`);
  } catch {
    /* names stay unset; the sentence reads without them */
  }
  await Promise.all(
    dids.slice(0, 3).map(async (did) => {
      try {
        const p = await getProfile(did);
        names.set(did, p?.displayName || (p?.handle ? `@${p.handle}` : null));
      } catch {
        /* as above */
      }
    }),
  );
  return (v) => {
    const s = v?.subject;
    return names.get(typeof s === 'string' ? s : s?.uri) || null;
  };
}

/**
 * The records either side of this one in its collection, for the foot's
 * earlier / later strip. Record keys are TIDs, so key order is time order:
 * listRecords' default (newest first) with the rkey as cursor gives the next
 * older record, and `reverse` gives the next newer. Two one-record reads,
 * plus one hydration call when the neighbours are references.
 *
 * Returns `{ earlier, later, ready }`, each neighbour shaped for SequenceFoot
 * (`{ to, title, meta }`) or null at either end of the collection.
 */
export function useRecordNeighbours({ verb, collection, rkey, createdAt }) {
  const [state, setState] = useState({ earlier: null, later: null, ready: false });

  useEffect(() => {
    if (!verb || !collection || !rkey) return undefined;
    let cancelled = false;
    setState({ earlier: null, later: null, ready: false });
    (async () => {
      try {
        const pds = await resolvePds(ME_DID);
        const [older, newer] = await Promise.all([
          listRecordsPage(pds, { repo: ME_DID, collection, limit: 1, cursor: rkey }).catch(() => null),
          listRecordsPage(pds, { repo: ME_DID, collection, limit: 1, cursor: rkey, reverse: true }).catch(
            () => null,
          ),
        ]);
        const before = older?.records?.[0] || null;
        const after = newer?.records?.[0] || null;
        const nameOf = await subjectNames([before?.value, after?.value]);
        const shape = (rec, dir) => {
          if (!rec) return null;
          const value = rec.value || {};
          const at = timeOf(value);
          const sentence = recordSentence(verb, value, { subject: nameOf(value) });
          const recRkey = rkeyFromAtUri(rec.uri);
          const gap = at && createdAt ? `${gapBetween(at, createdAt)} ${dir}` : null;
          return {
            to: recordHrefFor(verb, { atUri: rec.uri, rkey: recRkey }) || null,
            title: sentenceText(sentence),
            meta: [at ? neighbourWhen(at, createdAt) : null, gap].filter(Boolean).join(' · '),
          };
        };
        if (!cancelled) {
          setState({ earlier: shape(before, 'earlier'), later: shape(after, 'later'), ready: true });
        }
      } catch {
        if (!cancelled) setState({ earlier: null, later: null, ready: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verb, collection, rkey, createdAt]);

  return state;
}
