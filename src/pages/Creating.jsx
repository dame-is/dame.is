import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import CreatingFilters, { filterCreatingItems } from '../components/CreatingFilters.jsx';
import { CreatingGridSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useImagesReady } from '../hooks/useImagesReady.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { relativeTime, compareIsoDesc } from '../lib/time.js';
import { coverThumb } from '../lib/creatingHelpers.js';
import { isPortfolioDoc, workSlug, workCategory } from '../lib/publications.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/FeedFilters.css';
import './Creating.css';

const STANDARD_DOC = 'site.standard.document';

// How many leading covers to preload before revealing the grid — roughly
// the first couple of rows, enough for a clean first paint. The rest keep
// lazy-loading in the grid.
const COVER_WAIT = 12;

/**
 * Creative works now live as `site.standard.document` records in the
 * portfolio publication; legacy `is.dame.creating.work` records are read
 * alongside them so nothing is orphaned during the migration. Standard docs
 * arrive via the `blogs` snapshot (filtered to the portfolio publication);
 * legacy works via `creations`.
 */
async function loadWorks() {
  const pds = await resolvePds(ME_DID);
  const [stdDocs, legacy] = await Promise.all([
    listRecords(pds, { repo: ME_DID, collection: STANDARD_DOC, max: 200 }),
    listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 }),
  ]);
  transformRecords(stdDocs, STANDARD_DOC, pds, ME_DID);
  transformRecords(legacy, COLLECTIONS.creating, pds, ME_DID);
  return [...stdDocs.filter((r) => isPortfolioDoc(r?.value)), ...legacy];
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
      const std = Array.isArray(blogs) ? blogs.filter((r) => isPortfolioDoc(r?.value)) : [];
      return [...std, ...(Array.isArray(creations) ? creations : [])];
    },
    fetchLive: loadWorks,
    mapItems: (snap) => {
      if (!Array.isArray(snap)) return [];
      return snap
        .filter((r) => r?.value)
        .sort((a, b) => compareIsoDesc(a.value?.createdAt, b.value?.createdAt));
    },
  });

  const loading = status === 'loading';
  const safeWorks = works || [];
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
  const coverUrls = useMemo(
    () => filtered.slice(0, COVER_WAIT).map((r) => coverThumb(r.value)?.url).filter(Boolean),
    [filtered],
  );
  const coversReady = useImagesReady(coverUrls);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!loading && coversReady) setRevealed(true);
  }, [loading, coversReady]);
  const showSkeleton = loading || (filtered.length > 0 && !revealed);

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/creating`}
      headTitle="dame.is creating"
    >
      <CreatingFilters kinds={kinds} counts={counts} />
      {showSkeleton ? (
        <CreatingGridSkeleton cells={6} />
      ) : filtered.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No works match that search.' : 'No works yet.'}
        </p>
      ) : (
        <ul className="creating-grid reveal-stagger">
          {filtered.map((r, i) => {
            const v = r.value || {};
            const slug = workSlug(v);
            const thumb = coverThumb(v);
            const category = workCategory(v);
            return (
              <li key={r.uri || i} className="creating-grid-cell">
                <Link to={`/creating/${slug}`} className="creating-grid-link">
                  {thumb ? (
                    <img src={thumb.url} alt={thumb.alt || ''} loading="lazy" />
                  ) : (
                    <div className="creating-grid-placeholder" aria-hidden="true">&#x2767;</div>
                  )}
                  <div className="creating-grid-meta">
                    {category && <span className="small-caps creating-grid-kind">{category}</span>}
                    <h3 className="creating-grid-title">{v.title || slug}</h3>
                    {v.createdAt && <span className="gutter">{relativeTime(v.createdAt)}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
