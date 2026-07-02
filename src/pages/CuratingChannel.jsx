import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { CreatingGridSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, getRecord } from '../lib/atproto.js';
import { fetchChannelMeta, fetchAllBlocks } from '../lib/arena.js';
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
      const { blocks, truncated } = await fetchAllBlocks(v.arenaSlug);
      return {
        gallery: {
          slug,
          arenaSlug: v.arenaSlug,
          title: v.title || meta?.title || slug,
          description: v.description || meta?.description || '',
          blockCount: blocks.length,
        },
        truncated,
        blocks,
      };
    },
    mapItems: (d) => {
      if (!d) return null;
      if (d.notFound) return d;
      if (!d.gallery) return null;
      return { gallery: d.gallery, blocks: d.blocks || [], truncated: !!d.truncated };
    },
    deps: [slug],
  });

  if (status === 'loading') {
    return (
      <PageShell headTitle={`${slug} — Dame is…`}>
        <CreatingGridSkeleton cells={9} />
      </PageShell>
    );
  }

  if (status === 'error' || !items || items.notFound) {
    const missing = status !== 'error';
    return (
      <PageShell
        title={missing ? 'Gallery not found' : 'Gallery unavailable'}
        headTitle="Not found — Dame is…"
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

  const { gallery, blocks, truncated } = items;

  return (
    <PageShell
      title={gallery.title}
      intro={gallery.description || undefined}
      headTitle={`${gallery.title} — Dame is…`}
      eyebrow={
        <Link to="/curating" className="page-back small-caps">
          ← Curating
        </Link>
      }
    >
      <div className="curating-channel-meta gutter">
        <span>{gallery.blockCount} images</span>
      </div>

      {blocks.length === 0 ? (
        <p className="feed-empty">No images in this gallery yet.</p>
      ) : (
        <>
          <ul className="curating-block-grid reveal-stagger">
            {blocks.map((b, i) => {
              const domain = b.type === 'link' && b.sourceUrl ? hostname(b.sourceUrl) : null;
              return (
                <li key={b.id} className="curating-block">
                  <button
                    type="button"
                    className="curating-block-button"
                    onClick={() => setLightbox(i)}
                    aria-label={b.alt ? `View image: ${b.alt}` : `View image ${i + 1}`}
                  >
                    <img
                      src={b.thumb.src}
                      srcSet={b.thumb.src2x ? `${b.thumb.src2x} 2x` : undefined}
                      alt={b.alt}
                      loading="lazy"
                      decoding="async"
                    />
                    {domain && <span className="curating-block-domain gutter">{domain}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {truncated && (
            <p className="curating-truncated gutter">
              Showing the first {blocks.length} images.
            </p>
          )}
          <Lightbox
            open={lightbox >= 0}
            index={Math.max(0, lightbox)}
            onClose={() => setLightbox(-1)}
            images={blocks.map((b) => ({
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
