import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { BloggingTocSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { relativeTime, compareIsoDesc } from '../lib/time.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';
import './Blogging.css';

/**
 * The blog index. Backed by two collections under one URL shape:
 *
 *   - site.standard.document — standard.site docs, addressed by rkey
 *   - pub.leaflet.document   — leaflet.pub docs, addressed by rkey
 *
 * Both store leaflet-format block content and are addressed by rkey. The
 * snapshot file stores them separately under `blogs.json` / `leaflets.json`
 * (standard docs now take the legacy `blogs` slot); the live path issues two
 * `listRecords` calls in parallel. The mapper normalizes both into a single
 * timestamp-sorted ToC.
 */
export default function Blogging() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { title, intro } = usePageContent('blogging');

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
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/blogging`}
      headTitle="Blogging — Dame is&hellip;"
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
    ...blogs.filter((r) => r?.value).map(normalizeStandard),
    ...leaflets.filter((r) => r?.value).map(normalizeLeaflet),
  ].sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));
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
