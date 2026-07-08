import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import Comments from '../components/Comments.jsx';
import { BlogPostSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { formatDateLong, relativeTime } from '../lib/time.js';
import { dayOfLife } from '../lib/dayOfLife.js';
import { getPostThread } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { isPortfolioDoc } from '../lib/publications.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Blogging.css';

/**
 * Single blog-post page. The same URL — `/blogging/:id` — fronts two
 * lexicons, both addressed by rkey and both storing leaflet-format block
 * content:
 *
 *   - site.standard.document — standard.site docs
 *   - pub.leaflet.document   — leaflet.pub docs
 *
 * `:id` is matched as an rkey against the standard-doc snapshot first, then
 * the leaflet snapshot. The result drives a per-kind renderer below.
 */
export default function BlogPost() {
  const { slug: id } = useParams();

  const { items: resolution, status: feedStatus } = useLiveFeed({
    name: 'blogs',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const records = await listRecords(pds, {
        repo: ME_DID,
        collection: COLLECTIONS.blogging,
        max: 200,
      });
      // Bake `_url` onto image/cover blob refs (and a summary) so live-fetched
      // posts — ones not yet in the prefetched snapshot — render their images.
      // The snapshot path already does this at build time via transformRecords.
      transformRecords(records, COLLECTIONS.blogging, pds, ME_DID);
      return records;
    },
    mapItems: (data) => resolveById(data, id),
    deps: [id],
  });

  const [commentsUri, setCommentsUri] = useState(null);
  const [replies, setReplies] = useState([]);
  const [repliesStatus, setRepliesStatus] = useState('idle');

  // Comments resolution. Standard docs may carry an optional `commentsUri`
  // field pointing at a Bluesky post thread.
  useEffect(() => {
    let cancelled = false;
    if (!resolution || !resolution.record) return;
    async function resolveCommentsUri() {
      if (resolution.kind === 'standard') {
        return resolution.record?.value?.commentsUri || null;
      }
      return null;
    }
    resolveCommentsUri().then((uri) => {
      if (!cancelled) setCommentsUri(uri || null);
    });
    return () => {
      cancelled = true;
    };
  }, [resolution, id]);

  useEffect(() => {
    let cancelled = false;
    if (!commentsUri) {
      setReplies([]);
      setRepliesStatus('idle');
      return;
    }
    setRepliesStatus('loading');
    (async () => {
      try {
        const thread = await getPostThread(commentsUri, { depth: 6, parentHeight: 0 });
        if (cancelled) return;
        const childReplies = Array.isArray(thread?.thread?.replies)
          ? thread.thread.replies
          : [];
        setReplies(childReplies);
        setRepliesStatus('ready');
      } catch {
        if (!cancelled) setRepliesStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commentsUri]);

  if (feedStatus === 'loading') {
    return (
      <PageShell headTitle={`${id} — dame.is`}>
        <article className="blog-article">
          <BlogPostSkeleton paragraphs={4} />
        </article>
      </PageShell>
    );
  }

  if (!resolution || !resolution.record) {
    return (
      <PageShell title="Post not found" headTitle="Not found — dame.is">
        <p>
          No blog post with id <code>{id}</code>.{' '}
          <Link to="/blogging">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  return (
    <StandardPostBody
      record={resolution.record}
      id={id}
      commentsUri={commentsUri}
      replies={replies}
      repliesStatus={repliesStatus}
    />
  );
}

function resolveById(data, id) {
  // `data` is the `blogs` array of site.standard.document records.
  const blogs = Array.isArray(data) ? data : [];
  // Portfolio standard-docs are creative works, not blog posts.
  const standard = blogs.find((r) => endsWithRkey(r?.uri, id) && !isPortfolioDoc(r?.value));
  return standard ? { kind: 'standard', record: standard } : null;
}

function StandardPostBody({ record, id, commentsUri, replies, repliesStatus }) {
  const value = record?.value || {};
  const created = value.publishedAt || value.createdAt;
  const dayNum = created ? dayOfLife(created) : null;
  const title = value.title || id;

  return (
    <PageShell
      title={title}
      atUri={record?.uri}
      cid={record?.cid}
      headTitle={`${title} — dame.is`}
      eyebrow={
        <Link to="/blogging" className="page-back small-caps">
          ← Blog
        </Link>
      }
    >
      <article className="blog-article reveal">
        <div className="blog-article-meta">
          {created && <span>{formatDateLong(created)}</span>}
          {dayNum && <span>· Day {dayNum.toLocaleString()}</span>}
          {created && <span>· {relativeTime(created)}</span>}
          <span className="blog-article-tag">standard.site</span>
        </div>
        {/* The `description` field is intentionally not rendered here — it's the
            open-graph / feed-summary blurb, and on the post itself it just
            duplicated the opening lines of the body. */}
        <LeafletDocument doc={value.content} />
        {commentsUri && (
          <Comments
            atUri={commentsUri}
            replies={replies}
            status={repliesStatus}
          />
        )}
      </article>
    </PageShell>
  );
}


function endsWithRkey(uri, rkey) {
  if (!uri || !rkey) return false;
  const m = String(uri).match(/\/([^/]+)$/);
  return m && m[1] === rkey;
}
