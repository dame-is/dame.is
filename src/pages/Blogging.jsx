import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedSearch, { matchesQuery } from '../components/FeedSearch.jsx';
import { BloggingTocSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { relativeTime, compareIsoDesc } from '../lib/time.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';
import './Blogging.css';

/**
 * The blog index. Backed by two collections under one URL shape:
 *
 *   - is.dame.blogging.post — own lexicon, addressed by `slug`
 *   - pub.leaflet.document  — leaflet.pub docs, addressed by rkey
 *
 * The snapshot file stores them separately under `blogs.json` / `leaflets.json`;
 * the live path issues two `listRecords` calls in parallel. The mapper
 * normalizes both into a single timestamp-sorted ToC.
 */
export default function Blogging() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';

  const { items: entries, status } = useLiveFeed({
    strategy: 'snapshot-first',
    fetchSnapshotOverride: async () => {
      const [blogs, leaflets] = await Promise.all([
        fetchSnapshot('blogs'),
        fetchSnapshot('leaflets'),
      ]);
      return { blogs, leaflets };
    },
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const [blogs, leaflets] = await Promise.all([
        listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.blogging, max: 200 }),
        listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.leaflet, max: 200 }),
      ]);
      return { blogs, leaflets };
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
      title="Blogging"
      intro="A book of long-form posts. Each entry is an is.dame.blogging.post or pub.leaflet.document record."
      atUri={`at://${ME_DID}/is.dame.page/blogging`}
      headTitle="Blogging — Dame is&hellip;"
    >
      <div className="feed-filters feed-filters-search-only">
        <FeedSearch label="Search blog posts" />
      </div>
      {loading ? (
        <BloggingTocSkeleton rows={5} />
      ) : filtered.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No blog posts match that search.' : 'No blog posts yet.'}
        </p>
      ) : (
        <ol className="blogging-toc">
          {filtered.map((e, i) => (
            <li key={e.uri || i} className="blogging-toc-entry">
              <Link to={e.href} className="blogging-toc-link">
                <span className="blogging-toc-num gutter">{String(i + 1).padStart(2, '0')}</span>
                <span className="blogging-toc-body">
                  <h3 className="blogging-toc-title">
                    {e.title}
                    {e.kind === 'leaflet' && (
                      <span className="blogging-toc-source small-caps" aria-label="From leaflet">
                        leaflet
                      </span>
                    )}
                  </h3>
                  {e.summary && <p className="blogging-toc-summary">{e.summary}</p>}
                </span>
                <span className="blogging-toc-meta gutter">
                  {e.createdAt ? relativeTime(e.createdAt) : ''}
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
  if (!data) return [];
  const blogs = Array.isArray(data.blogs) ? data.blogs : [];
  const leaflets = Array.isArray(data.leaflets) ? data.leaflets : [];
  return [
    ...blogs.filter((r) => r?.value).map(normalizeBlog),
    ...leaflets.filter((r) => r?.value).map(normalizeLeaflet),
  ].sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));
}

function normalizeBlog(record) {
  const v = record.value || {};
  const slug = v.slug || rkeyFromAtUri(record.uri);
  return {
    kind: 'blog',
    uri: record.uri,
    id: slug,
    title: v.title || slug || 'Untitled',
    summary: v.summary,
    createdAt: v.createdAt || '',
    href: `/blogging/${slug}`,
  };
}

function normalizeLeaflet(record) {
  const v = record.value || {};
  const rkey = rkeyFromAtUri(record.uri);
  const created = v.publishedAt || v.createdAt || '';
  return {
    kind: 'leaflet',
    uri: record.uri,
    id: rkey,
    title: v.title || rkey || 'Untitled',
    summary: v.description || v.summary || '',
    createdAt: created,
    href: `/blogging/${rkey}`,
  };
}
