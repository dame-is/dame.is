import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { CreatingGridSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, getRecord, toAtUri } from '../lib/atproto.js';
import { fetchChannelMeta, fetchAllBlocks, arenaText } from '../lib/arena.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Curating.css';

// Live-fetch result for "this gallery does not exist / is disabled". A
// sentinel (rather than null) so useLiveFeed treats it as a resolved value
// and it replaces any stale snapshot render.
const NOT_FOUND = { notFound: true };

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function reverseSearchUrl(imageUrl) {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
}

export default function CuratingChannel() {
  const { slug } = useParams();
  const [lightbox, setLightbox] = useState(-1);

  const { items, status } = useLiveFeed({
    strategy: 'snapshot-first',
    name: `curating-${slug}`,
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      let record;
      try {
        record = await getRecord(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.arenaChannel,
          rkey: slug,
        });
      } catch (err) {
        // The PDS answers 400 RecordNotFound for unknown rkeys; anything
        // else (network, 5xx) should keep the snapshot render instead of
        // flashing "not found".
        if (err?.status === 400 || err?.status === 404) return NOT_FOUND;
        throw err;
      }
      const v = record?.value || {};
      if (!v.arenaSlug || v.enabled === false) return NOT_FOUND;
      const meta = await fetchChannelMeta(v.arenaSlug);
      // The meta call carries the channel's updated_at; when it matches
      // the snapshot we already painted from, reuse those blocks instead
      // of re-paginating the whole channel (the expensive part).
      const snap = await fetchSnapshot(`curating-${slug}`).catch(() => null);
      const snapIsCurrent =
        snap?.gallery?.arenaSlug === v.arenaSlug &&
        Boolean(snap?.gallery?.updatedAt) &&
        snap.gallery.updatedAt === meta?.updated_at;
      const { blocks, truncated } = snapIsCurrent
        ? { blocks: snap.blocks || [], truncated: !!snap.truncated }
        : await fetchAllBlocks(v.arenaSlug);
      return {
        gallery: {
          slug,
          arenaSlug: v.arenaSlug,
          title: v.title || arenaText(meta?.title) || slug,
          description: v.description || arenaText(meta?.description) || '',
          blockCount: blocks.length,
          updatedAt: meta?.updated_at || null,
        },
        truncated,
        blocks,
        // Carry the record cid so the page can hint at its backing record; the
        // at-uri itself is derived from the slug (the rkey is the slug).
        recordCid: record?.cid || null,
      };
    },
    mapItems: (d) => {
      if (!d) return null;
      if (d.notFound) return d;
      if (!d.gallery) return null;
      return {
        gallery: d.gallery,
        blocks: d.blocks || [],
        truncated: !!d.truncated,
        recordCid: d.recordCid || null,
      };
    },
    deps: [slug],
  });

  if (status === 'loading') {
    return (
      <PageShell headTitle={`${slug} — dame.is`}>
        <CreatingGridSkeleton cells={9} />
      </PageShell>
    );
  }

  if (status === 'error' || !items || items.notFound) {
    const missing = status !== 'error';
    return (
      <PageShell
        title={missing ? 'Gallery not found' : 'Gallery unavailable'}
        headTitle="Not found — dame.is"
      >
        <p>
          {missing ? (
            <>No gallery with slug <code>{slug}</code>.{' '}</>
          ) : (
            <>Couldn&rsquo;t load this gallery right now.{' '}</>
          )}
          <Link to="/curating">Back to curating.</Link>
        </p>
      </PageShell>
    );
  }

  const { gallery, blocks, truncated, recordCid } = items;
  // Only image/link blocks are lightbox-navigable; text tiles are not.
  const visualBlocks = blocks.filter((b) => b.type !== 'text');

  return (
    <PageShell
      title={arenaText(gallery.title) || undefined}
      intro={arenaText(gallery.description) || undefined}
      // Register the backing arena-channel record so owner edit mode offers
      // "Edit page" for this gallery. The rkey is the slug, so the at-uri is
      // deterministic even before the live fetch resolves.
      atUri={toAtUri({ did: ME_DID, collection: COLLECTIONS.arenaChannel, rkey: slug })}
      cid={recordCid || undefined}
      headTitle={`${gallery.title} — dame.is`}
    >
      <div className="curating-channel-meta gutter">
        <span>{gallery.blockCount} {gallery.blockCount === 1 ? 'block' : 'blocks'}</span>
      </div>

      {blocks.length === 0 ? (
        <p className="feed-empty">No blocks in this gallery yet.</p>
      ) : (
        <>
          <ul className="curating-block-grid reveal-stagger">
            {blocks.map((b) => {
              if (b.type === 'text') {
                return (
                  <li key={b.id} className="curating-block">
                    <div className="curating-text-card">
                      <span>{b.text}</span>
                    </div>
                  </li>
                );
              }
              // Image / link tile — opens the lightbox at its position among
              // the visual (non-text) blocks. A link tile is captioned with
              // the page title, falling back to its domain.
              const vIndex = visualBlocks.indexOf(b);
              const caption =
                b.type === 'link'
                  ? b.sourceTitle || b.title || (b.sourceUrl ? hostname(b.sourceUrl) : null)
                  : null;
              return (
                <li key={b.id} className="curating-block">
                  <button
                    type="button"
                    className="curating-block-button"
                    onClick={() => setLightbox(vIndex)}
                    aria-label={b.alt ? `View image: ${b.alt}` : `View image ${vIndex + 1}`}
                  >
                    <img
                      src={b.thumb.src}
                      srcSet={b.thumb.src2x ? `${b.thumb.src2x} 2x` : undefined}
                      alt={b.alt}
                      loading="lazy"
                      decoding="async"
                    />
                    {caption && <span className="curating-block-domain gutter">{caption}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {truncated && (
            <p className="curating-truncated gutter">
              Showing the first {blocks.length} blocks.
            </p>
          )}
          <Lightbox
            open={lightbox >= 0}
            index={Math.max(0, lightbox)}
            onClose={() => setLightbox(-1)}
            images={visualBlocks.map((b) => ({
              src: b.large,
              alt: b.alt,
              width: b.width || undefined,
              height: b.height || undefined,
              thumb: b.thumb?.src || undefined,
              sourceUrl: b.sourceUrl || undefined,
              searchUrl: reverseSearchUrl(b.large),
            }))}
          />
        </>
      )}
    </PageShell>
  );
}
