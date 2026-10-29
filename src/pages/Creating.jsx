import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FlatLedger from '../components/FlatLedger.jsx';
import SectionViewSwitch from '../components/SectionViewSwitch.jsx';
import CreatingFilters, { filterCreatingItems } from '../components/CreatingFilters.jsx';
import { CreatingGridSkeleton, FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useImagesReady } from '../hooks/useImagesReady.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useSectionView } from '../hooks/useFeedLayout.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { compareIsoDesc, formatYear } from '../lib/time.js';
import { smartenText } from '../lib/smartPunctuation.js';
import { coverThumb, swapToOriginal } from '../lib/creatingHelpers.js';
import { showOnCreating, isDraft, workSlug, workCategory } from '../lib/publications.js';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/FeedFilters.css';
import './Creating.css';

const STANDARD_DOC = 'site.standard.document';

/** A work's year, the portfolio's folio. Ages ("1y ago") went stale and
 *  rounded the same record two ways on two pages. Read through lib/time.js:
 *  a back-filled work dated '2019-01-01T00:00:00.000Z' is a piece from 2019,
 *  where the reader's own calendar put it in 2018 anywhere west of London. */
function yearOf(v) {
  const y = Number(formatYear(v?.createdAt));
  return y ? y : null;
}

/**
 * One work as a plate: the cover cropped to 4:3 on bare paper inside a
 * neutral keyline, then "software · 2026" and the title. A work with no
 * cover gets a title page instead of an empty box: an inset rule, the kind
 * top left, the title centred, the year bottom right.
 */
function WorkPlate({ record }) {
  const v = record.value || {};
  // Blog-homed docs cross-posted here may lack a `path`; fall back to the
  // rkey so the link still resolves at /creating/:slug.
  const slug = workSlug(v) || rkeyFromAtUri(record.uri);
  const thumb = coverThumb(v);
  const category = workCategory(v);
  const year = yearOf(v);
  const title = smartenText(v.title || slug);
  return (
    <li className="creating-plate" data-nsid={nsidFromAtUri(record.uri) || undefined}>
      <Link to={`/creating/${slug}`} className="creating-plate-link">
        {thumb ? (
          <img
            className="creating-plate-cover"
            src={thumb.url}
            alt={thumb.alt || ''}
            loading="lazy"
            onError={(e) => swapToOriginal(e, thumb.original)}
          />
        ) : (
          <div className="creating-plate-title-page" aria-hidden="true">
            <span className="creating-plate-tp-kind">{category}</span>
            <span className="creating-plate-tp-title">{title}</span>
            <span className="creating-plate-tp-year">{year}</span>
          </div>
        )}
        <span className="creating-plate-caption">
          <span className="creating-plate-kind">{[category, year].filter(Boolean).join(' · ')}</span>
          <span className="creating-plate-title">{title}</span>
        </span>
      </Link>
    </li>
  );
}

// How many leading covers to preload before revealing the grid — roughly
// the first couple of rows, enough for a clean first paint. The rest keep
// lazy-loading in the grid.
const COVER_WAIT = 12;

/**
 * Creative works now live as `site.standard.document` records in the
 * portfolio publication; legacy `is.dame.creating.work` records are read
 * alongside them so nothing is orphaned during the migration. Standard docs
 * arrive via the `blogs` snapshot, filtered by `showOnCreating` (portfolio-
 * homed docs, plus any blog-homed doc cross-posted here with a `creating`
 * tag); legacy works via `creations`.
 */
async function loadWorks() {
  const pds = await resolvePds(ME_DID);
  const [stdDocs, legacy] = await Promise.all([
    listRecords(pds, { repo: ME_DID, collection: STANDARD_DOC, max: 200 }),
    listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 }),
  ]);
  transformRecords(stdDocs, STANDARD_DOC, pds, ME_DID);
  transformRecords(legacy, COLLECTIONS.creating, pds, ME_DID);
  return [...stdDocs.filter((r) => showOnCreating(r?.value)), ...legacy];
}

export default function Creating() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { title, intro } = usePageContent('creating');

  const { items: works, status } = useLiveFeed({
    strategy: 'snapshot-first',
    fetchSnapshotOverride: async () => {
      const [creations, blogs] = await Promise.all([
        fetchSnapshot('creations'),
        fetchSnapshot('blogs'),
      ]);
      const std = Array.isArray(blogs) ? blogs.filter((r) => showOnCreating(r?.value)) : [];
      return [...std, ...(Array.isArray(creations) ? creations : [])];
    },
    fetchLive: loadWorks,
    mapItems: (snap) => {
      if (!Array.isArray(snap)) return [];
      // Runs against both the snapshot and the live payload, so this is the
      // single gate that keeps drafts off the feed regardless of source — the
      // live PDS fetch (loadWorks) otherwise re-includes drafted works.
      return snap
        .filter((r) => r?.value && !isDraft(r.value))
        .sort((a, b) => compareIsoDesc(a.value?.createdAt, b.value?.createdAt));
    },
  });

  const [view, setView] = useSectionView('creating', 'plates');
  const ledger = view === 'index';
  const loading = status === 'loading';
  const safeWorks = useMemo(() => works || [], [works]);
  const kinds = useMemo(
    () => Array.from(new Set(safeWorks.map((r) => workCategory(r.value)).filter(Boolean))),
    [safeWorks],
  );
  const counts = useMemo(() => {
    const c = {};
    for (const r of safeWorks) {
      const k = workCategory(r.value);
      if (!k) continue;
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [safeWorks]);
  const filtered = useMemo(
    () => filterCreatingItems(safeWorks, params, kinds),
    [safeWorks, params, kinds],
  );

  // Hold the skeleton until the first rows' cover images are ready, so the
  // grid doesn't swap in with blank cells that pop as they download. Once
  // revealed we stay revealed — later filter/search changes just re-render
  // the grid (their covers are already cached) rather than re-skeletoning.
  // The ledger draws no covers, so it preloads none — it is the default
  // layout, and a dozen hidden image downloads only competed with the requests
  // the page actually needed. Switching to cards later just lazy-loads the
  // grid, since `revealed` has already latched.
  const coverUrls = useMemo(
    () =>
      ledger
        ? []
        : filtered
            .slice(0, COVER_WAIT)
            .map((r) => coverThumb(r.value)?.url)
            .filter(Boolean),
    [filtered, ledger],
  );
  const coversReady = useImagesReady(coverUrls);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!loading && coversReady) setRevealed(true);
  }, [loading, coversReady]);
  // The ledger table shows no cover art, so it needn't wait on cover preloads
  // the way the grid does — it paints as soon as the works are loaded.
  const showSkeleton = ledger ? loading : loading || (filtered.length > 0 && !revealed);

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/creating`}
      headTitle="dame.is creating"
    >
      <SectionViewSwitch view={view} onChange={setView} label="View the portfolio as" />
      <CreatingFilters kinds={kinds} counts={counts} />
      {showSkeleton ? (
        ledger ? (
          <FeedSkeleton rows={6} label="Loading works" />
        ) : (
          <CreatingGridSkeleton cells={6} />
        )
      ) : filtered.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No works match that search.' : 'No works yet.'}
        </p>
      ) : ledger ? (
        // The index: the ledger with the year as its folio, printed once
        // per run with a dotted leader down to the run's last work, so the
        // column reads 2026 to 2011 like a book's index.
        <FlatLedger
          rows={filtered.map((r, i) => {
            const v = r.value || {};
            const slug = workSlug(v) || rkeyFromAtUri(r.uri);
            const year = yearOf(v);
            const prev = i > 0 ? yearOf(filtered[i - 1].value) : null;
            return {
              key: r.uri || i,
              href: `/creating/${slug}`,
              title: smartenText(v.title || slug),
              kind: workCategory(v),
              time: year ? String(year) : null,
              runCont: year != null && year === prev,
              nsid: nsidFromAtUri(r.uri),
              atUri: r.uri || null,
              cid: r.cid || null,
            };
          })}
        />
      ) : (
        // Plates in reading order, row by row, newest first (the round-robin
        // masonry read top-to-bottom per column instead).
        <ul className="creating-plates reveal-stagger">
          {filtered.map((r, i) => (
            <WorkPlate key={r.uri || i} record={r} />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
