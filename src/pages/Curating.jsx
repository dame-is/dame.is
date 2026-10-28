import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FlatLedger from '../components/FlatLedger.jsx';
import SectionViewSwitch from '../components/SectionViewSwitch.jsx';
import { CreatingGridSkeleton, FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useImagesReady } from '../hooks/useImagesReady.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useSectionView } from '../hooks/useFeedLayout.jsx';
import { formatDateFull } from '../lib/time.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import {
  fetchChannelMeta,
  fetchChannelPage,
  normalizeBlock,
  pickCoverThumb,
  channelStrip,
  arenaText,
} from '../lib/arena.js';
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

  const snap = await fetchSnapshot('curating')
    .then((s) => new Map((s?.galleries || []).map((g) => [g.slug, g])))
    .catch(() => new Map());

  const galleries = [];
  for (const g of enabled) {
    try {
      const meta = await fetchChannelMeta(g.value.arenaSlug);
      let cover = snap.get(g.rkey)?.cover || null;
      let strip = snap.get(g.rkey)?.strip || null;
      if (!cover || !strip) {
        // No snapshot cover or strip yet — derive them from the first page,
        // honouring the author's chosen cover block when it happens to be on
        // that page.
        const page = await fetchChannelPage(g.value.arenaSlug, 1, 10);
        const blocks = (page?.data || []).map(normalizeBlock).filter(Boolean);
        cover = cover || pickCoverThumb(blocks, g.value.coverBlockId);
        strip = strip || channelStrip(blocks);
      }
      galleries.push({
        slug: g.rkey,
        arenaSlug: g.value.arenaSlug,
        title: g.value.title || arenaText(meta?.title) || g.rkey,
        description: g.value.description || arenaText(meta?.description) || '',
        blockCount: meta?.counts?.blocks ?? null,
        cover,
        strip,
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

  const [view, setView] = useSectionView('curating', 'plates');
  const ledger = view === 'index';
  const loading = status === 'loading';
  const list = galleries || [];

  // Hold the skeleton until the first rows' gallery covers are ready, so
  // the grid doesn't swap in with blank cells that pop as they download.
  // Once revealed we stay revealed. The ledger shows no covers, so it needn't
  // wait on them.
  const coverUrls = useMemo(
    () => list.slice(0, 2).flatMap(stripOf).map((b) => b.thumb?.src).filter(Boolean).slice(0, COVER_WAIT),
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
      <SectionViewSwitch view={view} onChange={setView} label="View the galleries as" />
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
        // One row per channel, in the owner's order: what it holds, before
        // its name is read.
        <ul className="curating-rows reveal-stagger">
          {list.map((g) => (
            <ChannelRow key={g.slug} gallery={g} />
          ))}
        </ul>
      )}
    </PageShell>
  );
}

/** A channel's first blocks, or its cover alone for a snapshot without them. */
function stripOf(g) {
  if (Array.isArray(g?.strip) && g.strip.length) return g.strip;
  return g?.cover ? [{ id: 'cover', type: 'image', alt: '', thumb: g.cover }] : [];
}

/**
 * A channel as a contact-sheet row: its title, are.na's description in
 * italic, the first six blocks cropped square (text blocks stay as words),
 * and the count and date as a folio at the right. The word stays "blocks",
 * since channels mix images, text and links.
 */
function ChannelRow({ gallery: g }) {
  const href = `/curating/${g.slug}`;
  const strip = stripOf(g);
  return (
    <li className="curating-row">
      <div className="curating-row-head">
        <h2 className="curating-row-title">
          <Link to={href}>{g.title}</Link>
        </h2>
        <p className="curating-row-folio">
          {g.blockCount != null && (
            <span>
              {g.blockCount} {g.blockCount === 1 ? 'block' : 'blocks'}
            </span>
          )}
          {g.updatedAt && <span>updated {formatDateFull(g.updatedAt)}</span>}
        </p>
      </div>
      {g.description && <p className="curating-row-desc">{g.description}</p>}
      {strip.length > 0 && (
        <Link to={href} className="curating-row-strip" tabIndex={-1} aria-hidden="true">
          {strip.map((b) =>
            b.type === 'text' ? (
              <span key={b.id} className="curating-strip-cell curating-strip-text">
                <span>{b.text}</span>
              </span>
            ) : (
              <img
                key={b.id}
                className="curating-strip-cell"
                src={b.thumb.src}
                srcSet={b.thumb.src2x ? `${b.thumb.src2x} 2x` : undefined}
                alt=""
                loading="lazy"
              />
            ),
          )}
        </Link>
      )}
    </li>
  );
}
