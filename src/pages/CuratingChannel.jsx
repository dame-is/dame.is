import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import Lightbox from '../components/Lightbox.jsx';
import SortSwitch from '../components/SortSwitch.jsx';
import { formatDateFull } from '../lib/time.js';
import { CreatingGridSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useSortParam } from '../hooks/useSortParam.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, getRecord, toAtUri } from '../lib/atproto.js';
import {
  fetchChannelMeta,
  fetchAllBlocks,
  arenaText,
  orderBlocks,
  resolveBlockOrder,
  BLOCK_ORDERS,
} from '../lib/arena.js';
import { videoEmbedSrc } from '../lib/videoEmbed.js';
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

// The player for an Embed block whose host we can frame (YouTube, Vimeo);
// null for the rest, which open as their preview image like a link does.
// Autoplays — the reader clicked the tile to watch it.
function playerSrc(b) {
  if (b.type !== 'embed') return null;
  const src = videoEmbedSrc(b.sourceUrl);
  return src ? `${src}?autoplay=1` : null;
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
          // How the record wants the blocks laid out. Applied at render rather
          // than baked in here, so a random gallery is random per visit and a
          // change to the record takes hold without waiting for a rebuild.
          blockOrder: v.blockOrder || undefined,
          pinnedBlockIds: Array.isArray(v.pinnedBlockIds) ? v.pinnedBlockIds : undefined,
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

  // One seed for the visit. A gallery paints from the build snapshot and then
  // again from are.na, and a re-render (opening the lightbox) paints a third
  // time — an unseeded shuffle would deal the page anew each time, under the
  // reader. Fresh per mount, so "random" still means a different gallery when
  // you come back.
  const [shuffleSeed] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const gallery = items?.notFound ? null : items?.gallery || null;
  // The record's blockOrder is where the gallery starts (newest when it names
  // none); the sort switch at the top lets a reader take it elsewhere. Pins
  // lead whichever order is picked.
  const [sort, setSort] = useSortParam(resolveBlockOrder(gallery?.blockOrder), resolveBlockOrder);
  const blocks = useMemo(
    () =>
      orderBlocks(gallery ? items?.blocks : [], {
        order: sort,
        pinned: gallery?.pinnedBlockIds,
        seed: shuffleSeed,
      }),
    [items, gallery, sort, shuffleSeed],
  );

  if (status === 'loading') {
    return (
      <PageShell headTitle={`${slug} — dame.is`}>
        <CreatingGridSkeleton cells={9} />
      </PageShell>
    );
  }

  // A transient failure (snapshot and are.na both out of reach) must not read
  // as "not found" — not in the page, and not in the tab or history either,
  // where a shared link would carry it. Keep the URL and offer another go, as
  // the other detail pages do. Only a resolved-but-absent gallery is a 404.
  if (status === 'error') {
    return (
      <PageShell
        title="Couldn’t load this right now"
        headTitle="Couldn’t load — dame.is"
      >
        <p>
          Couldn&rsquo;t load this gallery right now — refresh to try again.
        </p>
        <p>
          <button type="button" onClick={() => window.location.reload()}>
            Refresh
          </button>{' '}
          <Link to="/curating">Back to curating.</Link>
        </p>
      </PageShell>
    );
  }

  if (!items || items.notFound) {
    return (
      <PageShell title="Gallery not found" headTitle="Not found — dame.is">
        <p>
          No gallery with slug <code>{slug}</code>.{' '}
          <Link to="/curating">Back to curating.</Link>
        </p>
      </PageShell>
    );
  }

  const { truncated, recordCid } = items;
  // Only image/link/embed blocks are lightbox-navigable; text tiles are not.
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
        {gallery.blockCount > 1 && (
          <SortSwitch
            value={sort}
            options={BLOCK_ORDERS}
            onChange={setSort}
            label="Sort the blocks by"
          />
        )}
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
              // Image / link / embed tile — opens the lightbox at its position
              // among the visual (non-text) blocks. A link or embed tile is
              // captioned with the page title, falling back to its domain.
              const vIndex = visualBlocks.indexOf(b);
              const caption =
                b.type === 'link' || b.type === 'embed'
                  ? b.sourceTitle || b.title || (b.sourceUrl ? hostname(b.sourceUrl) : null)
                  : null;
              const playable = Boolean(playerSrc(b));
              const noun = playable ? 'video' : 'image';
              // A captioned tile's name starts with its caption, so what's on
              // screen is what a screen reader says and what voice control
              // can be told to press; a bare image tile names its picture.
              const label = caption
                ? `${caption}, view ${noun}`
                : b.alt
                  ? `View ${noun}: ${b.alt}`
                  : `View ${noun} ${vIndex + 1}`;
              const img = (
                <img
                  src={b.thumb.src}
                  srcSet={b.thumb.src2x ? `${b.thumb.src2x} 2x` : undefined}
                  alt={b.alt}
                  loading="lazy"
                  decoding="async"
                />
              );
              return (
                <li key={b.id} className="curating-block">
                  <button
                    type="button"
                    className="curating-block-button"
                    onClick={() => setLightbox(vIndex)}
                    aria-label={label}
                  >
                    {playable ? (
                      <span className="curating-block-media">
                        {img}
                        <span className="curating-block-play" aria-hidden="true">
                          <Play />
                        </span>
                      </span>
                    ) : (
                      img
                    )}
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
            images={visualBlocks.map((b) => {
              const embedSrc = playerSrc(b);
              // A player sizes to its own aspect, not the preview image's
              // (YouTube's is a letterboxed 4:3 frame around a 16:9 video).
              const size = embedSrc ? b.embed || {} : b;
              // The caption says where the image came from. An are.na title
              // that's only a filename ("0_0-1-.jpeg") says nothing, so the
              // channel stands in for it.
              const named = b.title && !/\.(jpe?g|png|gif|webp|avif)$/i.test(b.title) ? b.title : null;
              return {
                src: b.large,
                alt: b.alt,
                caption: named || gallery?.title || undefined,
                credit: [
                  'are.na',
                  b.connectedAt ? `connected ${formatDateFull(b.connectedAt)}` : null,
                  size.width && size.height ? `${size.width}×${size.height}` : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                width: size.width || undefined,
                height: size.height || undefined,
                thumb: b.thumb?.src || undefined,
                sourceUrl: b.sourceUrl || undefined,
                embedSrc: embedSrc || undefined,
                // Reverse-searching a video's poster frame finds nothing worth
                // having, so embeds keep only their source link.
                searchUrl: b.type === 'embed' ? undefined : reverseSearchUrl(b.large),
              };
            })}
          />
        </>
      )}
    </PageShell>
  );
}
