import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import MasonryGrid from '../components/MasonryGrid.jsx';
import FlatLedger from '../components/FlatLedger.jsx';
import { CreatingGridSkeleton, FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useImagesReady } from '../hooks/useImagesReady.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { fetchChannelMeta, fetchChannelPage, normalizeBlock, pickCoverThumb, arenaText } from '../lib/arena.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Creating.css';
import './Curating.css';

// How many leading covers to preload before revealing the grid — roughly
// the first couple of rows. The rest keep lazy-loading in the grid.
const COVER_WAIT = 12;

/**
 * Which galleries exist is an `is.dame.arena.channel` record per channel
 * (rkey = site slug); the images themselves live on are.na. The live pass
 * re-reads the records, refreshes each channel's title/description/count
 * from the are.na API, and reuses the snapshot's cover so it costs one
 * request per channel (plus one page fetch for channels added since the
 * last build).
 */
async function loadGalleries() {
  const pds = await resolvePds(ME_DID);
  const records = await listRecords(pds, {
    repo: ME_DID,
    collection: COLLECTIONS.arenaChannel,
    max: 100,
  });
  const enabled = records
    .map((r) => ({ rkey: rkeyFromAtUri(r.uri), value: r.value || {} }))
    .filter((g) => g.rkey && g.value.arenaSlug && g.value.enabled !== false)
    .sort((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0));

  const snapCovers = await fetchSnapshot('curating')
    .then((s) => new Map((s?.galleries || []).map((g) => [g.slug, g.cover])))
    .catch(() => new Map());

  const galleries = [];
  for (const g of enabled) {
    try {
      const meta = await fetchChannelMeta(g.value.arenaSlug);
      let cover = snapCovers.get(g.rkey) || null;
      if (!cover) {
        // No snapshot cover yet — derive one from the first page, honouring the
        // author's chosen cover block when it happens to be on that page.
        const page = await fetchChannelPage(g.value.arenaSlug, 1, 10);
        const blocks = (page?.data || []).map(normalizeBlock).filter(Boolean);
        cover = pickCoverThumb(blocks, g.value.coverBlockId);
      }
      galleries.push({
        slug: g.rkey,
        arenaSlug: g.value.arenaSlug,
        title: g.value.title || arenaText(meta?.title) || g.rkey,
        description: g.value.description || arenaText(meta?.description) || '',
        blockCount: meta?.counts?.blocks ?? null,
        cover,
        order: g.value.order ?? 0,
        updatedAt: meta?.updated_at || null,
      });
    } catch {
      // A channel that fails live just keeps its snapshot presence (if any).
    }
  }
  return { galleries };
}

export default function Curating() {
  const { title, intro } = usePageContent('curating');

  const { items: galleries, status } = useLiveFeed({
    strategy: 'snapshot-first',
    name: 'curating',
    fetchLive: loadGalleries,
    mapItems: (d) => (Array.isArray(d?.galleries) ? d.galleries : null),
  });

  const { layout } = useFeedLayout();
  const ledger = layout === 'ledger';
  const loading = status === 'loading';
  const list = galleries || [];

  // Hold the skeleton until the first rows' gallery covers are ready, so
  // the grid doesn't swap in with blank cells that pop as they download.
  // Once revealed we stay revealed. The ledger shows no covers, so it needn't
  // wait on them.
  const coverUrls = useMemo(
    () => list.slice(0, COVER_WAIT).map((g) => g.cover?.src).filter(Boolean),
    [list],
  );
  const coversReady = useImagesReady(coverUrls);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!loading && coversReady) setRevealed(true);
  }, [loading, coversReady]);
  const showSkeleton = ledger ? loading : loading || (list.length > 0 && !revealed);

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/curating`}
      headTitle="dame.is curating"
    >
      {showSkeleton ? (
        ledger ? (
          <FeedSkeleton rows={6} label="Loading galleries" />
        ) : (
          <CreatingGridSkeleton cells={6} />
        )
      ) : list.length === 0 ? (
        <p className="feed-empty">No galleries yet.</p>
      ) : ledger ? (
        <FlatLedger
          rows={list.map((g) => ({
            key: g.slug,
            href: `/curating/${g.slug}`,
            title: g.title,
            time:
              g.blockCount != null
                ? `${g.blockCount} ${g.blockCount === 1 ? 'block' : 'blocks'}`
                : null,
            nsid: COLLECTIONS.arenaChannel,
            // The gallery's backing channel record — its rkey is the slug.
            atUri: `at://${ME_DID}/${COLLECTIONS.arenaChannel}/${g.slug}`,
          }))}
        />
      ) : (
        <MasonryGrid
          items={list}
          renderItem={(g) => (
            <li key={g.slug} className="creating-grid-cell">
              <Link to={`/curating/${g.slug}`} className="creating-grid-link">
                {g.cover?.src ? (
                  <img
                    src={g.cover.src}
                    srcSet={g.cover.src2x ? `${g.cover.src2x} 2x` : undefined}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="creating-grid-placeholder" aria-hidden="true">&#x273A;</div>
                )}
                <div className="creating-grid-meta">
                  <h3 className="creating-grid-title">{g.title}</h3>
                  {g.blockCount != null && (
                    <span className="gutter">{g.blockCount} {g.blockCount === 1 ? 'block' : 'blocks'}</span>
                  )}
                </div>
              </Link>
            </li>
          )}
        />
      )}
    </PageShell>
  );
}
