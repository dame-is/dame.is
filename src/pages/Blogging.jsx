import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FlatLedger from '../components/FlatLedger.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { BloggingTocSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { relativeTime, formatDateFull, compareIsoDesc } from '../lib/time.js';
import { showOnBlog, isDraft } from '../lib/publications.js';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';
import './Blogging.css';

/**
 * The blog index. Backed by `site.standard.document` records (in the
 * `blogs` snapshot), addressed by rkey. Portfolio-homed standard-docs are
 * filtered out — they live on /creating — unless one opts back in with a
 * `blog` cross-post tag (see `showOnBlog`). (pub.leaflet.document is
 * deprecated and no longer fetched.)
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

  const { layout } = useFeedLayout();
  const ledger = layout === 'ledger';
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
      ) : ledger ? (
        <FlatLedger
          rows={filtered.map((e, i) => ({
            key: e.uri || i,
            href: e.href,
            title: e.title,
            time: e.createdAt ? relativeTime(e.createdAt) : null,
            nsid: nsidFromAtUri(e.uri),
            atUri: e.uri || null,
            cid: e.cid || null,
          }))}
        />
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
    // Blog-homed docs plus any portfolio doc cross-posted with a `blog` tag.
    // Portfolio-only docs live on /creating. Drafts stay hidden — the live PDS
    // fetch returns them, so filter here where snapshot and live both pass.
    .filter((r) => r?.value && !isDraft(r.value) && showOnBlog(r.value))
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
