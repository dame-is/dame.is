import { useEffect, useRef, useState } from 'react';
import { useAlbumArt } from '../hooks/useAlbumArt.js';

/** How far ahead of the viewport a cover starts resolving. */
const LOOKAHEAD = '500px';

/**
 * An album's cover.
 *
 * Nothing in a teal.fm play carries artwork — the lookup ladder needs a
 * recording (an ISRC, an Apple song id, or a track and artist to search on), so
 * an album's cover is really one of its tracks' covers, which for every release
 * that isn't a compilation is the same image. `payload` is therefore a play
 * record's value, not an album.
 *
 * Resolution waits until the plate is near the viewport. The shelf runs to a
 * couple of hundred albums, and a cover costs a lookup before it costs an image
 * — so eager resolution would open a request per album the moment the page
 * mounted, for a screenful the reader can see. Each answer is cached in
 * localStorage, so scrolling back up costs nothing.
 *
 * A miss (or a plate nobody has scrolled to) draws the empty square rather than
 * nothing, so the shelf stays a grid instead of collapsing around the records
 * Apple has never heard of.
 */
export default function AlbumCover({ payload, alt = '', size = 300, className = '' }) {
  const ref = useRef(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return undefined;
    // No observer (an older engine, a test renderer): resolve rather than
    // leave every cover blank forever.
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return undefined;
    }
    const node = ref.current;
    if (!node) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: LOOKAHEAD },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [near]);

  const state = useAlbumArt(near ? payload : null, { size });
  const url = state.status === 'hit' ? state.art?.url : null;

  return (
    <span
      ref={ref}
      className={['album-cover', url ? '' : 'album-cover-empty', className]
        .filter(Boolean)
        .join(' ')}
    >
      {url && <img src={url} alt={alt} loading="lazy" decoding="async" width={size} height={size} />}
    </span>
  );
}
