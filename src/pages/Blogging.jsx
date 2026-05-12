import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedSearch, { matchesQuery } from '../components/FeedSearch.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { relativeTime } from '../lib/time.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';
import './Blogging.css';

/**
 * The blog index. Reads from two snapshots and renders them in one
 * timestamp-sorted table of contents:
 *
 *   - is.dame.blogging.post — own lexicon, addressed by `slug`
 *   - pub.leaflet.document  — leaflet.pub docs, addressed by rkey
 *
 * Each entry carries a `_kind` tag so we can render the right link target
 * and surface the right metadata fields without re-doing the type check
 * in every JSX expression.
 */
export default function Blogging() {
  const [entries, setEntries] = useState([]);
  const [params] = useSearchParams();
  const q = params.get('q') || '';

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSnapshot('blogs').then((snap) => (Array.isArray(snap) ? snap : [])),
      fetchSnapshot('leaflets').then((snap) => (Array.isArray(snap) ? snap : [])),
    ]).then(([blogs, leaflets]) => {
      if (cancelled) return;
      const merged = [
        ...blogs
          .filter((r) => r?.value)
          .map((r) => normalizeBlog(r)),
        ...leaflets
          .filter((r) => r?.value)
          .map((r) => normalizeLeaflet(r)),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setEntries(merged);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () =>
      entries.filter((e) =>
        matchesQuery(
          [e.title, e.summary, e.id].filter(Boolean).join(' '),
          q,
        ),
      ),
    [entries, q],
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
      {filtered.length === 0 ? (
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
