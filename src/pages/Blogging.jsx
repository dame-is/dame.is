import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { BloggingTocSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { relativeTime, formatDateFull, compareIsoDesc } from '../lib/time.js';
import { isPortfolioDoc } from '../lib/publications.js';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';
import './Blogging.css';

/**
 * The blog index. Backed by `site.standard.document` records (in the
 * `blogs` snapshot), addressed by rkey. Portfolio standard-docs are filtered
 * out — they live on /creating. (pub.leaflet.document is deprecated and no
 * longer fetched.)
 */
export default function Blogging() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { title, intro } = usePageContent('blogging');

  const { items: entries, status } = useLiveFeed({
    name: 'blogs',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const records = await listRecords(pds, {
        repo: ME_DID,
        collection: COLLECTIONS.blogging,
        max: 200,
      });
      // Match the snapshot path: bake blob `_url`s (and a summary fallback) so
      // live-fetched posts render consistently with prefetched ones.
      transformRecords(records, COLLECTIONS.blogging, pds, ME_DID);
      return records;
    },
    mapItems: mergeBlogEntries,
  });

  const loading = status === 'loading';
  const safeEntries = entries || [];
  const filtered = useMemo(
    () =>
      safeEntries.filter((e) =>
        matchesQuery([e.title, e.summary, e.id].filter(Boolean).join(' '), q),
      ),
    [safeEntries, q],
  );

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/blogging`}
      headTitle="dame.is blogging"
    >
      {loading ? (
        <BloggingTocSkeleton rows={5} />
      ) : filtered.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No blog posts match that search.' : 'No blog posts yet.'}
        </p>
      ) : (
        <ol className="blogging-toc reveal-stagger">
          {filtered.map((e, i) => (
            <li
              key={e.uri || i}
              className="blogging-toc-entry"
              data-nsid={nsidFromAtUri(e.uri) || undefined}
            >
              <Link to={e.href} className="blogging-toc-link">
                <span className="blogging-toc-num gutter">{String(i + 1).padStart(2, '0')}</span>
                <span className="blogging-toc-body">
                  <h3 className="blogging-toc-title">{e.title}</h3>
                  {e.summary && <p className="blogging-toc-summary">{e.summary}</p>}
                </span>
                <span className="blogging-toc-meta gutter">
                  {e.createdAt && (
                    <>
                      <span className="blogging-toc-rel">{relativeTime(e.createdAt)}</span>
                      <span className="blogging-toc-date">{formatDateFull(e.createdAt)}</span>
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}

function mergeBlogEntries(data) {
  // `data` is the `blogs` snapshot/live array of site.standard.document
  // records. (pub.leaflet.document is deprecated and no longer fetched.)
  const blogs = Array.isArray(data) ? data : [];
  return blogs
    // Portfolio standard-docs live on /creating, not the blog.
    .filter((r) => r?.value && !isPortfolioDoc(r.value))
    .map(normalizeStandard)
    .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));
}

function normalizeStandard(record) {
  const v = record.value || {};
  const rkey = rkeyFromAtUri(record.uri);
  return {
    kind: 'standard',
    uri: record.uri,
    id: rkey,
    title: v.title || rkey || 'Untitled',
    summary: v.description || '',
    createdAt: v.publishedAt || v.createdAt || '',
    href: `/blogging/${rkey}`,
  };
}
