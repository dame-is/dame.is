import { useEffect, useState } from 'react';
import { fetchSnapshot } from '../lib/snapshot.js';
import { linkPreviewsName } from '../lib/linkPreviews.js';

// The live answers, by document version, kept for the visit: a version's
// links don't change, and coming back to an essay shouldn't ask again. A
// failed read isn't kept, so the next visit tries again.
const liveReads = new Map(); // `${uri} ${cid}` -> Promise<data | null>

function readLive(uri, cid) {
  const key = `${uri} ${cid}`;
  if (!liveReads.has(key)) {
    const read = fetch(`/api/link-previews?${new URLSearchParams({ uri, cid })}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data) => {
        if (!data) liveReads.delete(key);
        return data;
      });
    liveReads.set(key, read);
  }
  return liveReads.get(key);
}

const IDLE = { status: 'idle', previews: {}, icons: {} };

/**
 * The hover previews for a document's links: `{ status, previews, icons }`,
 * `previews` keyed by each link as written and `icons` by the key a preview's
 * `icon` names (lib/linkPreviews.js).
 *
 * Read from the build's file for the document first. Links the build didn't
 * look up, because the document was published or edited since, are asked of
 * /api/link-previews for this exact version (`cid`); links the build tried
 * and couldn't read aren't asked again. `status` is 'loading' until both have
 * answered, which is what tells a link to keep room for its icon.
 */
export function useLinkPreviews({ atUri, cid, links }) {
  const name = linkPreviewsName(atUri);
  const key = name && links.length ? `${atUri} ${cid || ''} ${links.join(' ')}` : '';
  const [state, setState] = useState(() => (key ? { ...IDLE, status: 'loading' } : IDLE));

  useEffect(() => {
    if (!key) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    setState((prev) => (prev.status === 'idle' ? { ...IDLE, status: 'loading' } : prev));
    (async () => {
      const file = await fetchSnapshot(name);
      // Copied: a snapshot read is shared by every caller, never theirs to change.
      const previews = { ...(file?.previews || {}) };
      const icons = { ...(file?.icons || {}) };
      const known = new Set([...Object.keys(previews), ...(file?.failed || [])]);
      const missing = links.filter((url) => !known.has(url));
      if (missing.length && cid) {
        if (file && !cancelled) setState({ status: 'loading', previews: { ...previews }, icons: { ...icons } });
        const live = await readLive(atUri, cid);
        Object.assign(previews, live?.previews || {});
        Object.assign(icons, live?.icons || {});
      }
      if (!cancelled) setState({ status: 'ready', previews, icons });
    })();
    return () => {
      cancelled = true;
    };
    // `key` stands for atUri, cid and links.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
