import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FlatLedger from '../components/FlatLedger.jsx';
import SectionViewSwitch from '../components/SectionViewSwitch.jsx';
import SortSwitch from '../components/SortSwitch.jsx';
import { CreatingGridSkeleton, FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useImagesReady } from '../hooks/useImagesReady.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useSectionView } from '../hooks/useSectionView.js';
import { useSortParam } from '../hooks/useSortParam.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import {
  fetchChannelMeta,
  fetchChannelPage,
  normalizeBlock,
  pickCoverThumb,
  channelStrip,
  arenaText,
  orderGalleries,
  resolveGalleryOrder,
  GALLERY_ORDERS,
  DEFAULT_GALLERY_ORDER,
  galleryFacts,
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
 *
 * are.na failing must never read as "no galleries": a channel whose refresh
 * fails keeps its snapshot entry, and if every refresh fails the whole pass
 * throws, so useLiveFeed leaves the snapshot on screen untouched.
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

  const snapBySlug = await fetchSnapshot('curating')
    .then((s) => new Map((s?.galleries || []).map((g) => [g.slug, g])))
    .catch(() => new Map());

  const galleries = [];
  let refreshed = 0;
  for (const g of enabled) {
    const snap = snapBySlug.get(g.rkey) || null;
    try {
      const meta = await fetchChannelMeta(g.value.arenaSlug);
      let cover = snap?.cover || null;
      let strip = snap?.strip || null;
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
        createdAt: meta?.created_at || snap?.createdAt || null,
      });
      refreshed += 1;
    } catch {
      // A channel that fails live keeps its snapshot entry (if it has one),
      // with the record's own fields — just read fresh — laid over it. Only
      // channels still enabled get here, so one switched off since the build
      // stays off.
      if (snap) {
        galleries.push({
          ...snap,
          title: g.value.title || snap.title,
          description: g.value.description || snap.description,
          order: g.value.order ?? 0,
        });
      }
    }
  }
  if (enabled.length > 0 && refreshed === 0) {
    throw new Error('are.na unreachable: no gallery refreshed');
  }
  return { galleries };
}

// Which of a thumb's two sizes the row's <img> will actually fetch. It offers
// `src2x` as a 2x srcset candidate, which browsers take on retina and phone
// screens — so preloading `src` alone held the skeleton for images those
// screens never show, and then downloaded every cover a second time.
function coverForScreen(cover) {
  if (!cover?.src) return null;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return dpr >= 1.5 && cover.src2x ? cover.src2x : cover.src;
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
  const [sort, setSort] = useSortParam(DEFAULT_GALLERY_ORDER, resolveGalleryOrder);
  const list = useMemo(() => orderGalleries(galleries || [], sort), [galleries, sort]);

  // Hold the skeleton until the first two rows' strips are ready, so the
  // rows don't swap in with blank cells that pop as they download.
  // Once revealed we stay revealed. The ledger shows no covers, so it neither
  // waits on them nor downloads them.
  const coverUrls = useMemo(
    () =>
      ledger
        ? []
        : list
            .slice(0, 2)
            .flatMap(stripOf)
            .map((b) => coverForScreen(b.thumb))
            .filter(Boolean)
            .slice(0, COVER_WAIT),
    [list, ledger],
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
      <div className="collection-controls">
        <SortSwitch
          value={sort}
          options={GALLERY_ORDERS}
          onChange={setSort}
          label="Sort the galleries by"
        />
        <SectionViewSwitch view={view} onChange={setView} label="View the galleries as" />
      </div>
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
        // One row per channel, in the order the sort switch asks for: what it
        // holds, before its name is read.
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
 * A channel as a contact-sheet row: its title, then when it last changed, how
 * many blocks it holds and how old it is on one line under it, are.na's
 * description in italic, and a row of its first blocks cropped square, one to
 * each column of the page grid (text blocks stay as words). The word stays "blocks", since channels mix images, text and
 * links.
 */
function ChannelRow({ gallery: g }) {
  const href = `/curating/${g.slug}`;
  const strip = stripOf(g);
  const facts = galleryFacts(g);
  return (
    <li className="curating-row">
      <div className="curating-row-head">
        <h2 className="curating-row-title">
          <Link to={href}>{g.title}</Link>
        </h2>
        {facts.length > 0 && <p className="curating-facts">{facts.join(' · ')}</p>}
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
