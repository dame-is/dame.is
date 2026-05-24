import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { CreatingGridSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { relativeTime, compareIsoDesc } from '../lib/time.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/FeedFilters.css';
import './Creating.css';

export default function Creating() {
  const [kind, setKind] = useState(null);
  const [params] = useSearchParams();
  const q = params.get('q') || '';

  const { items: works, status } = useLiveFeed({
    name: 'creations',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 });
    },
    mapItems: (snap) => {
      if (!Array.isArray(snap)) return [];
      return snap
        .filter((r) => r?.value)
        .sort((a, b) => compareIsoDesc(a.value?.createdAt, b.value?.createdAt));
    },
  });

  const loading = status === 'loading';
  const safeWorks = works || [];
  const kinds = Array.from(new Set(safeWorks.map((r) => r.value?.kind).filter(Boolean)));
  const filtered = useMemo(
    () =>
      safeWorks.filter((r) => {
        const v = r.value || {};
        if (kind && v.kind !== kind) return false;
        return matchesQuery(
          [v.title, v.summary, v.body, v.kind, v.slug].filter(Boolean).join(' '),
          q,
        );
      }),
    [safeWorks, kind, q],
  );

  return (
    <PageShell
      title="Creating"
      intro="A portfolio of works — art, software, writing, music, and more."
      atUri={`at://${ME_DID}/is.dame.page/creating`}
      headTitle="Creating — Dame is&hellip;"
    >
      {kinds.length > 1 && (
        <div className="feed-filters">
          <div className="feed-chips">
            <button
              type="button"
              className={`feed-chip ${!kind ? 'is-active' : ''}`}
              onClick={() => setKind(null)}
            >
              <span className="small-caps">all</span>
            </button>
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                className={`feed-chip ${kind === k ? 'is-active' : ''}`}
                onClick={() => setKind(k)}
              >
                <span className="small-caps">{k}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {loading ? (
        <CreatingGridSkeleton cells={6} />
      ) : filtered.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No works match that search.' : 'No works yet.'}
        </p>
      ) : (
        <ul className="creating-grid reveal-stagger">
          {filtered.map((r, i) => {
            const v = r.value || {};
            const slug = v.slug;
            const thumb = v.media?.find((m) => m?.kind === 'image' && m?.url);
            return (
              <li key={r.uri || i} className="creating-grid-cell">
                <Link to={`/creating/${slug}`} className="creating-grid-link">
                  {thumb ? (
                    <img src={thumb.url} alt={thumb.alt || ''} loading="lazy" />
                  ) : (
                    <div className="creating-grid-placeholder" aria-hidden="true">&#x2767;</div>
                  )}
                  <div className="creating-grid-meta">
                    <span className="small-caps creating-grid-kind">{v.kind}</span>
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
